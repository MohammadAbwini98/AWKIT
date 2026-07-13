// Live verification of Phase A9 resource routing against real Chromium. Spins a tiny local server that
// serves an HTML page pulling an image, a stylesheet, and a script, then loads it under each profile and
// asserts the RIGHT sub-resources are aborted while the DOM still renders (flow-relevant content stays
// readable). No mock-site page authoring required; fully self-contained. Run: npx tsx scripts/verify-lean-mode.mts
import http from "node:http";
import { chromium, type BrowserContext } from "playwright";
import { installResourceRouting, loadResourceRoutingConfig, type ResourceRoutingConfig } from "../src/runner/ResourceRoutingPolicy";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const PORT = 4407;
const BASE = `http://127.0.0.1:${PORT}`;
const HTML = `<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head>
<body><h1 id="title">Lean Lab</h1><img id="pic" src="/pic.png" alt="pic"><script src="/app.js"></script></body></html>`;
// A minimal 1x1 PNG.
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f5f0000000049454e44ae426082", "hex");

function startServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(HTML);
    if (path === "/style.css") return void res.writeHead(200, { "content-type": "text/css" }).end("body{background:#fff}");
    if (path === "/app.js") return void res.writeHead(200, { "content-type": "text/javascript" }).end("window.__loaded=true;");
    if (path === "/pic.png") return void res.writeHead(200, { "content-type": "image/png" }).end(PNG);
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

/** Load the page under a routing config and report which resource types finished vs failed (aborted). */
async function loadUnder(context: BrowserContext, config: ResourceRoutingConfig) {
  await installResourceRouting(context, config);
  const page = await context.newPage();
  const finished = new Set<string>();
  const failed = new Set<string>();
  page.on("requestfinished", (r) => finished.add(`${r.resourceType()}:${new URL(r.url()).pathname}`));
  page.on("requestfailed", (r) => failed.add(`${r.resourceType()}:${new URL(r.url()).pathname}`));
  await page.goto(BASE, { waitUntil: "networkidle" });
  const title = await page.textContent("#title");
  await page.close();
  return { finished, failed, title };
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    // 1. Normal: everything loads; nothing aborted.
    {
      const ctx = await browser.newContext();
      const { finished, failed, title } = await loadUnder(ctx, loadResourceRoutingConfig({ AWKIT_RESOURCE_PROFILE: "normal" } as NodeJS.ProcessEnv));
      await ctx.close();
      check("normal loads the image", finished.has("image:/pic.png"), [...finished].join(", "));
      check("normal aborts nothing", failed.size === 0, [...failed].join(", "));
      check("normal renders the title", title === "Lean Lab");
    }

    // 2. Lean: image aborted; document + stylesheet + script still load; DOM text intact.
    {
      const ctx = await browser.newContext();
      const { finished, failed, title } = await loadUnder(ctx, loadResourceRoutingConfig({ AWKIT_RESOURCE_PROFILE: "lean" } as NodeJS.ProcessEnv));
      await ctx.close();
      check("lean aborts the image", failed.has("image:/pic.png"), `failed=${[...failed].join(", ")}`);
      check("lean keeps the stylesheet", finished.has("stylesheet:/style.css"), `finished=${[...finished].join(", ")}`);
      check("lean keeps the script", finished.has("script:/app.js"));
      check("lean still renders the title (flow content intact)", title === "Lean Lab");
    }

    // 3. Ultra-Lean: stylesheet AND image aborted; document + script still load.
    {
      const ctx = await browser.newContext();
      const { finished, failed, title } = await loadUnder(ctx, loadResourceRoutingConfig({ AWKIT_RESOURCE_PROFILE: "ultraLean" } as NodeJS.ProcessEnv));
      await ctx.close();
      check("ultraLean aborts the stylesheet", failed.has("stylesheet:/style.css"), `failed=${[...failed].join(", ")}`);
      check("ultraLean aborts the image", failed.has("image:/pic.png"));
      check("ultraLean keeps the script", finished.has("script:/app.js"));
      check("ultraLean still renders the title", title === "Lean Lab");
    }

    // 4. Allow-list URL rescues the image even under lean.
    {
      const ctx = await browser.newContext();
      const cfg = loadResourceRoutingConfig({ AWKIT_RESOURCE_PROFILE: "lean", AWKIT_ALLOW_URL_PATTERNS: "*/pic.png" } as NodeJS.ProcessEnv);
      const { finished, failed } = await loadUnder(ctx, cfg);
      await ctx.close();
      check("allow-list rescues the image under lean", finished.has("image:/pic.png") && !failed.has("image:/pic.png"), `finished=${[...finished].join(", ")}`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nLean mode (live): ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
