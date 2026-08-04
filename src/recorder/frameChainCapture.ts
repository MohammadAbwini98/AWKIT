import type { ElementHandle, Frame } from "playwright";
import type { LocatorFrameContext } from "../profiles/FlowProfile";

/** Hard ceiling on frame-chain depth (matches the runner's `MAX_FRAME_CHAIN`). */
export const MAX_FRAME_CHAIN = 8;

/**
 * Build the ordered outer→inner iframe chain for a target that lives in a child frame, using
 * Playwright's Frame graph. `frameElement()` returns the hosting `<iframe>` handle in the PARENT frame's
 * context and works across origins; the selector/identity are derived by evaluating on that handle in the
 * parent — the parent document is never scripted from the child. The identity hints (name/title/url) come
 * from the iframe ELEMENT, so they survive the child frame's own navigation. Returns undefined when a frame
 * is detached or unrepresentable, which leaves the step on the recorder's needs-review path.
 *
 * Shared by `RecorderService` (live capture binding) and the frame-chain verifier so both paths build the
 * chain identically.
 */
export async function buildFrameChain(frame: Frame): Promise<LocatorFrameContext[] | undefined> {
  const innerToOuter: LocatorFrameContext[] = [];
  const mainFrame = frame.page().mainFrame();
  let current: Frame | null = frame;
  let depth = 0;
  while (current && current !== mainFrame && depth < MAX_FRAME_CHAIN) {
    let element: ElementHandle<Node>;
    try {
      element = await current.frameElement();
    } catch {
      return undefined;
    }
    let seg: { selector: string; index: number; count: number; name?: string; title?: string; url?: string } | null = null;
    try {
      // NOTE: no named inner functions in this evaluate body — esbuild `keepNames` would wrap them in a
      // `__name(...)` helper that is undefined in the page context (the recorder's documented gotcha).
      seg = await element.evaluate((el) => {
        const iframe = el as HTMLIFrameElement;
        const id = iframe.id;
        const name = iframe.getAttribute("name");
        const title = iframe.getAttribute("title");
        const srcAttr = iframe.getAttribute("src");
        const generatedId = !!id && /\d{4}|[0-9a-f]{8}|:r[0-9a-z]+:/i.test(id);
        let cssId = id;
        try {
          cssId = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        } catch {
          cssId = id.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
        }
        let selector = "iframe";
        if (id && !generatedId) selector = "iframe#" + cssId;
        else if (name) selector = 'iframe[name="' + name.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]';
        else if (title) selector = 'iframe[title="' + title.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]';
        else if (srcAttr && srcAttr.length <= 200) selector = 'iframe[src="' + srcAttr.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]';
        const doc = iframe.ownerDocument;
        let matches: Element[] = [iframe];
        try {
          if (doc) matches = Array.prototype.slice.call(doc.querySelectorAll(selector));
        } catch {
          matches = [iframe];
        }
        const rawIndex = matches.indexOf(iframe);
        let url: string | undefined;
        try {
          const parsed = new URL(iframe.src);
          url = parsed.origin === "null" ? undefined : parsed.origin + parsed.pathname;
        } catch {
          url = undefined;
        }
        return {
          selector,
          index: rawIndex < 0 ? 0 : rawIndex,
          count: matches.length,
          name: name || undefined,
          title: title || undefined,
          url
        };
      });
    } catch {
      seg = null;
    } finally {
      await element.dispose().catch(() => undefined);
    }
    if (!seg || !seg.selector) return undefined;
    const context: LocatorFrameContext = { selector: seg.selector };
    if (seg.name) context.name = seg.name;
    if (seg.title) context.title = seg.title;
    if (seg.url) context.url = seg.url;
    if (seg.count > 1) context.index = seg.index;
    innerToOuter.push(context);
    current = current.parentFrame();
    depth += 1;
  }
  if (!innerToOuter.length) return undefined;
  return innerToOuter.reverse();
}
