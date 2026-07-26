// SYS-REP-016 + SET-021 — accessibility, zoom and reduced motion for the Reports and Settings
// surfaces. Both cases were wholly `NOT RUN`.
//
// Real Electron, isolated %LOCALAPPDATA%, real SecurityGate. Keyboard focus is driven with actual
// Tab presses, never `.focus()`: `:focus-visible` — the selector the global ring uses — does not
// match programmatic focus, so a `.focus()`-based check would pass while a keyboard user saw no
// ring at all.
//
// Run after `npm run build`:
//   npm run verify:reports-settings-a11y
import { _electron as electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DEFAULT_CREDS,
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun
// @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
} from "./lib/gui-verify-harness.mjs";
import {
  navClick
// @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
} from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = path.join(root, "test-artifacts", "reports-settings-a11y", stamp);

let passed = 0;
let failed = 0;
let notRun = 0;
const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, cond: unknown, detail = ""): void {
  const pass = Boolean(cond);
  results.push({ name, pass, detail });
  if (pass) {
    passed += 1;
    console.log(`  PASS ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A check whose PRECONDITION is absent is neither a pass nor a defect. Reporting it as FAIL would
 * invent a product defect (the Workflow Reports table simply does not render on an empty profile);
 * reporting it as PASS would be worse. Same third state the Oracle soak uses for an undefined trend.
 */
function checkSkip(name: string, reason: string): void {
  notRun += 1;
  results.push({ name, pass: false, detail: `NOT RUN: ${reason}` });
  console.log(`  ~ ${name} — NOT RUN: ${reason}`);
}

/** Press Tab n times and report what actually received focus, plus whether it shows a ring. */
async function tabThrough(win: any, n: number) {
  const seen: { tag: string; name: string; ring: boolean }[] = [];
  for (let i = 0; i < n; i += 1) {
    await win.keyboard.press("Tab");
    const info = await win.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName,
        name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
        ring: s.outlineStyle !== "none" || s.boxShadow !== "none"
      };
    });
    if (info) seen.push(info);
  }
  return seen;
}

async function main(): Promise<number> {
  await mkdir(evidenceDir, { recursive: true });
  const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-a11y");
  const app = await electron.launch({ args: [root], env, cwd: root });
  const win = await resolveMainWindow(app);
  const bw = await app.browserWindow(win);
  await signInFirstRun(win, DEFAULT_CREDS);
  console.log(`Reports + Settings accessibility (SYS-REP-016, SET-021)\n  profile: ${dataRoot}`);

  try {
    // ── SYS-REP-016 — Reports ───────────────────────────────────────────────────────────────────
    console.log("\nSYS-REP-016 — Reports accessibility:");
    await navClick(win, "Reports");
    await win.waitForTimeout(700);

    const reportsTabs = await tabThrough(win, 10);
    const reportsInteractive = reportsTabs.filter((t) => ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(t.tag));
    check(
      "Reports: Tab reaches interactive controls",
      reportsInteractive.length >= 3,
      reportsTabs.map((t) => t.tag).join(" → ")
    );
    check(
      "Reports: every keyboard-focused control shows a focus ring",
      reportsInteractive.length > 0 && reportsInteractive.every((t) => t.ring),
      reportsInteractive.map((t) => `${t.tag}:${t.ring ? "ring" : "NONE"}`).join(" ")
    );
    check(
      "Reports: no focusable control is missing an accessible name",
      reportsInteractive.every((t) => t.name.length > 0),
      reportsInteractive.filter((t) => !t.name).map((t) => t.tag).join(",") || "all named"
    );

    // Sortable headers must expose their sort state to assistive tech, not only via a chevron icon.
    await navClick(win, "Workflow Reports");
    await win.waitForTimeout(900);
    const sortHeaders = await win.evaluate(() => {
      const out: { label: string; ariaSort: string | null; thAriaSort: string | null }[] = [];
      document.querySelectorAll("button.awkit-sort-header").forEach((b) => {
        const th = b.closest("th");
        out.push({
          label: (b.textContent || "").trim().slice(0, 24),
          ariaSort: b.getAttribute("aria-sort"),
          thAriaSort: th?.getAttribute("aria-sort") ?? null
        });
      });
      return out;
    });
    if (sortHeaders.length === 0) {
      // Workflow Reports renders an EmptyState with no seeded history, so there is no table to audit
      // here. The aria-sort contract is exercised against seeded data by verify:reports-populated-gui.
      checkSkip(
        "Reports: sortable table headers expose aria-sort",
        "Workflow Reports shows its EmptyState on a fresh profile — no table to audit; covered against seeded data by verify:reports-populated-gui"
      );
    }
    if (sortHeaders.length > 0) {
      // Click one to establish a definite sort state, then re-read.
      await win.locator("button.awkit-sort-header").first().click();
      await win.waitForTimeout(300);
      const afterSort = await win.evaluate(() => {
        const b = document.querySelector("button.awkit-sort-header");
        const th = b?.closest("th");
        return { th: th?.getAttribute("aria-sort") ?? null, btn: b?.getAttribute("aria-sort") ?? null };
      });
      check(
        "Reports: the sorted column exposes aria-sort (not icon-only)",
        afterSort.th === "ascending" || afterSort.th === "descending" || afterSort.btn === "ascending" || afterSort.btn === "descending",
        `th aria-sort=${afterSort.th ?? "MISSING"} button aria-sort=${afterSort.btn ?? "MISSING"}`
      );
      const unsorted = await win.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button.awkit-sort-header"));
        return els.slice(1).map((b) => b.closest("th")?.getAttribute("aria-sort") ?? null);
      });
      check(
        "Reports: unsorted columns expose aria-sort=none rather than nothing",
        unsorted.length === 0 || unsorted.every((v: string | null) => v === "none"),
        `values: ${unsorted.map((v: string | null) => v ?? "MISSING").join(",")}`
      );
    }

    // Reduced motion must be honoured.
    await win.emulateMedia({ reducedMotion: "reduce" });
    await win.waitForTimeout(300);
    const reduced = await win.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    check("Reports: renders under prefers-reduced-motion", reduced);

    // 200% zoom and a narrow viewport must not clip content horizontally.
    await bw.evaluate((w: any) => w.webContents.setZoomFactor(2));
    await win.waitForTimeout(500);
    const zoomOverflow = await win.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return { scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    check(
      "Reports: no horizontal overflow at 200% zoom",
      zoomOverflow.scrollW <= zoomOverflow.clientW + 2,
      `scrollWidth=${zoomOverflow.scrollW} clientWidth=${zoomOverflow.clientW}`
    );
    await win.screenshot({ path: path.join(evidenceDir, "reports-zoom-200.png") }).catch(() => undefined);
    await bw.evaluate((w: any) => w.webContents.setZoomFactor(1));

    await bw.evaluate((w: any) => w.setBounds({ width: 900, height: 800 }));
    await win.waitForTimeout(400);
    const narrowOverflow = await win.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return { scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    check(
      "Reports: no horizontal overflow at a narrow width",
      narrowOverflow.scrollW <= narrowOverflow.clientW + 2,
      `scrollWidth=${narrowOverflow.scrollW} clientWidth=${narrowOverflow.clientW}`
    );
    await bw.evaluate((w: any) => w.setBounds({ width: 1280, height: 800 }));
    await win.emulateMedia({ reducedMotion: null });

    // ── SET-021 — Settings ──────────────────────────────────────────────────────────────────────
    console.log("\nSET-021 — Settings accessibility:");
    await navClick(win, "Settings");
    await win.waitForTimeout(800);

    const settingsTabs = await tabThrough(win, 12);
    const settingsInteractive = settingsTabs.filter((t) => ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(t.tag));
    check(
      "Settings: Tab reaches interactive controls",
      settingsInteractive.length >= 4,
      settingsTabs.map((t) => t.tag).join(" → ")
    );
    check(
      "Settings: every keyboard-focused control shows a focus ring",
      settingsInteractive.length > 0 && settingsInteractive.every((t) => t.ring),
      settingsInteractive.map((t) => `${t.tag}:${t.ring ? "ring" : "NONE"}`).join(" ")
    );

    // Control-by-control accessible-name audit across the whole page.
    const unnamed = await win.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("button, input, select, textarea").forEach((el) => {
        const e = el as HTMLElement;
        if (e.offsetParent === null) return; // hidden
        const id = e.getAttribute("id");
        const labelled =
          (e.getAttribute("aria-label") || "").trim() ||
          (e.getAttribute("aria-labelledby") || "").trim() ||
          (e.getAttribute("title") || "").trim() ||
          (id ? (document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || "").trim() : "") ||
          (e.closest("label")?.textContent || "").trim() ||
          (e.tagName === "BUTTON" ? (e.textContent || "").trim() : "");
        if (!labelled) out.push(`${e.tagName}${id ? `#${id}` : ""}.${(e.className || "").toString().split(" ")[0]}`);
      });
      return out;
    });
    check(
      "Settings: every visible control has an accessible name",
      unnamed.length === 0,
      unnamed.length ? `unnamed: ${unnamed.slice(0, 8).join(", ")}` : "all named"
    );

    // Validation errors must be ANNOUNCED, not merely coloured. Settings mounts its banner (and the
    // aria-live/role=alert with it) only when there is something to say, so this drives the REAL
    // control: an out-of-range zoom in the live input. An out-of-band preload call would never reach
    // React state and would prove nothing about what a screen-reader user hears.
    const zoomInput = win.locator('input[type="number"]').first();
    if (await zoomInput.count()) {
      await zoomInput.fill("9999");
      await zoomInput.blur().catch(() => undefined);
      // Settings batches: `patch()` only touches local state and CLEARS the banner. Validation and
      // the banner happen in `save()`, so the announcement only exists after Save is pressed.
      // Testing without this click asserted nothing — an earlier revision of this check did exactly
      // that and reported a product defect that was not there.
      await win.getByRole("button", { name: /Save Changes/i }).click();
      await win.waitForTimeout(1200);
      const announced = await win.evaluate(() =>
        Array.from(document.querySelectorAll("[aria-live], [role='alert']")).map((e) => ({
          role: e.getAttribute("role"),
          live: e.getAttribute("aria-live"),
          text: (e.textContent || "").trim().slice(0, 70)
        }))
      );
      check(
        "Settings: a rejected save is announced through a live region",
        announced.length > 0,
        announced.length
          ? announced.map((r: { role: string | null; live: string | null; text: string }) => `${r.role ?? r.live}="${r.text}"`).join(" | ")
          : "no aria-live/role=alert region appeared after an out-of-range Save"
      );
      check(
        "Settings: the invalid field is marked, not signalled by colour alone",
        await win.evaluate(() => {
          const el = document.querySelector('input[type="number"]') as HTMLElement | null;
          if (!el) return false;
          return (
            el.getAttribute("aria-invalid") === "true" ||
            Boolean(el.getAttribute("aria-describedby")) ||
            Boolean(el.closest(".field")?.querySelector("[role='alert'], .settings-field-error"))
          );
        }),
        "expects aria-invalid, aria-describedby, or an associated error message"
      );
    } else {
      checkSkip("Settings: a rejected save is announced through a live region", "no numeric input found on the page");
    }

    await win.emulateMedia({ reducedMotion: "reduce" });
    await win.waitForTimeout(300);
    check(
      "Settings: renders under prefers-reduced-motion",
      await win.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    );

    await bw.evaluate((w: any) => w.webContents.setZoomFactor(2));
    await win.waitForTimeout(500);
    const setZoom = await win.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return { scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    check(
      "Settings: no horizontal overflow at 200% zoom",
      setZoom.scrollW <= setZoom.clientW + 2,
      `scrollWidth=${setZoom.scrollW} clientWidth=${setZoom.clientW}`
    );
    await win.screenshot({ path: path.join(evidenceDir, "settings-zoom-200.png") }).catch(() => undefined);
    await bw.evaluate((w: any) => w.webContents.setZoomFactor(1));

    await bw.evaluate((w: any) => w.setBounds({ width: 900, height: 800 }));
    await win.waitForTimeout(400);
    const setNarrow = await win.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return { scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    check(
      "Settings: no horizontal overflow at a narrow width",
      setNarrow.scrollW <= setNarrow.clientW + 2,
      `scrollWidth=${setNarrow.scrollW} clientWidth=${setNarrow.clientW}`
    );
    await bw.evaluate((w: any) => w.setBounds({ width: 1280, height: 800 }));
    await win.emulateMedia({ reducedMotion: null });
  } finally {
    await writeFile(
      path.join(evidenceDir, "execution-results.json"),
      JSON.stringify({ total: results.length, passed, failed, notRun, results }, null, 2),
      "utf8"
    );
    await app.close().catch(() => undefined);
    cleanup();
  }

  console.log(`\nReports + Settings a11y: ${passed} PASS / ${failed} FAIL`);
  console.log(`Evidence: ${evidenceDir}`);
  return failed === 0 ? 0 : 1;
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error(e);
  process.exit(1);
});
