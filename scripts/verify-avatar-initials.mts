/**
 * Verifier for the shared Teams-style avatar initials utility (Phase 3 of the admin/licensing package).
 * Repo convention: no unit-test framework — assertion scripts run under `tsx`. Run: `npm run verify:avatar`.
 */
import {
  avatarPaletteIndex,
  initialsFromIdentity,
  initialsFromName,
  type AvatarIdentity
} from "../app/renderer/lib/initials";

let passed = 0;
let failed = 0;

function check(label: string, actual: string, expected: string): void {
  if (actual === expected) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ── Core examples from the phase spec ────────────────────────────────────────
check("Mohammad Abwini -> MA", initialsFromName("Mohammad Abwini"), "MA");
check("Sarah Ahmad Khalil -> SK", initialsFromName("Sarah Ahmad Khalil"), "SK");
check("Mohammad -> MO", initialsFromName("Mohammad"), "MO");
check("M -> M", initialsFromName("M"), "M");

// ── Whitespace handling ──────────────────────────────────────────────────────
check("leading/trailing spaces", initialsFromName("   Mohammad   Abwini  "), "MA");
check("collapsed repeated spaces", initialsFromName("Sarah     Khalil"), "SK");
check("tabs/newlines as separators", initialsFromName("Sarah\t\nKhalil"), "SK");

// ── Punctuation safety ───────────────────────────────────────────────────────
check("leading punctuation ignored", initialsFromName("!Mohammad"), "MO");
check("punctuation-only token dropped", initialsFromName("Mohammad - Abwini"), "MA");
check("hyphenated single word", initialsFromName("Jean-Pierre"), "JE");
check("punctuation-only name -> empty", initialsFromName("!!! ---"), "");

// ── Arabic and Unicode scripts (Arabic has no case, so unchanged) ─────────────
const AR_MUHAMMAD = "محمد"; // محمد
const AR_ABWINI = "عبويني"; // عبويني
const AR_SARAH = "سارة"; // سارة
const AR_AHMAD = "أحمد"; // أحمد
const AR_KHALIL = "خليل"; // خليل
check("Arabic multi-word (first+last)", initialsFromName(`${AR_MUHAMMAD} ${AR_ABWINI}`), "مع"); // مع
check("Arabic three words (first+last)", initialsFromName(`${AR_SARAH} ${AR_AHMAD} ${AR_KHALIL}`), "سخ"); // سخ
check("Arabic single word (first two)", initialsFromName(AR_MUHAMMAD), "مح"); // مح

// Combining characters: "e" + U+0301 (combining acute) must stay ONE grapheme.
const E_ACUTE = "é"; // é (decomposed)
check(
  "combining mark stays with its base grapheme (2 words)",
  initialsFromName(`${E_ACUTE}va Noor`),
  (E_ACUTE + "n").toLocaleUpperCase()
);
check(
  "combining mark, single word -> first two graphemes",
  initialsFromName(`${E_ACUTE}va`),
  (E_ACUTE + "v").toLocaleUpperCase()
);

// ── Identity fallback chain ──────────────────────────────────────────────────
const emailOnly: AvatarIdentity = { displayName: "", username: "", email: "sarah.khalil@example.com" };
check("email local part -> SK", initialsFromIdentity(emailOnly), "SK");
check("username fallback", initialsFromIdentity({ displayName: "  ", username: "mabwini" }), "MA");
check("display beats username", initialsFromIdentity({ displayName: "Mohammad Abwini", username: "zzz" }), "MA");
check("missing identity -> ?", initialsFromIdentity({}), "?");
check("all-empty identity -> ?", initialsFromIdentity({ displayName: " ", username: "", email: "" }), "?");

// ── Deterministic palette selection ──────────────────────────────────────────
const idxA1 = avatarPaletteIndex({ username: "mabwini", displayName: "Mohammad Abwini" }, 6);
const idxA2 = avatarPaletteIndex({ username: "mabwini", displayName: "Mohammad Abwini" }, 6);
check("palette index is deterministic", String(idxA1), String(idxA2));
check("palette index within range", String(idxA1 >= 0 && idxA1 < 6), "true");
check(
  "palette index is case-insensitive on key",
  String(avatarPaletteIndex({ username: "MABWINI" }, 6)),
  String(avatarPaletteIndex({ username: "mabwini" }, 6))
);

console.log(`\navatar-initials: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
