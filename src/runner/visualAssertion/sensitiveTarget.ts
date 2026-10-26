import type { ElementHandle } from "playwright";

/**
 * The N6.8 sensitive-container rule, shared by every read-only element capture that could show typed values: the N6
 * visual assertion (`VisualAssertionStep`) and the N7.5 OCR assertion (`OcrStep`). One definition, so the two can never
 * drift apart. Never imports `src/visual`.
 */

/** At most this many elements are walked inside a target; a bigger target is refused as sensitive (fail closed). */
const SENSITIVE_WALK_LIMIT = 2000;

/**
 * The sensitive-input rule, applied to the target AND every input or textarea inside it, open shadow roots included
 * (N6.8 security finding 1): a wrapper around a CVV, PIN, OTP, card or SSN field is refused like the field itself, so
 * its typed value can never reach a candidate's preview pixels. Password, one-time code and card autocomplete, and a
 * name, id, label or placeholder that names such a field, all count. A walk past the limit, or any error, is
 * sensitive. Inline expressions only: this runs in the page.
 */
export function sensitiveTarget(handle: ElementHandle): Promise<boolean> {
  return handle
    .evaluate(
      (node, limit) => {
        const element = node as Element;
        // A label target is walked itself AND through its control, which may sit outside it (N6.8 security round 3, N5).
        const control = element.tagName === "LABEL" ? (element as HTMLLabelElement).control : null;
        const fields: Element[] = [];
        const stack: (Element | ShadowRoot)[] = control && !element.contains(control) ? [element, control] : [element];
        let walked = 0;
        while (stack.length > 0) {
          const current = stack.pop() as Element | ShadowRoot;
          walked += 1;
          if (walked > limit) return true;
          if (current instanceof Element) {
            // An embedded document (a hosted payment field, an embedded login) cannot be inspected from here, and its
            // pixels are part of the capture: refuse (N6.8 security round 2, N1).
            if (["IFRAME", "FRAME", "OBJECT", "EMBED"].includes(current.tagName)) return true;
            if (current.tagName === "INPUT" || current.tagName === "TEXTAREA") fields.push(current);
            if (current.shadowRoot) stack.push(current.shadowRoot);
          }
          for (const child of Array.from(current.children)) stack.push(child);
        }
        return fields.some((control) => {
          const autocomplete = (control.getAttribute("autocomplete") ?? "").toLowerCase();
          if ((control.getAttribute("type") ?? "").toLowerCase() === "password") return true;
          if (/one-time-code|current-password|new-password|cc-number|cc-csc|cc-exp/.test(autocomplete)) return true;
          // Its label text counts too: `<label for>` / wrapping labels and aria-labelledby targets (N6.8 QC round 2).
          const labelText = Array.from((control as HTMLInputElement).labels ?? [])
            .map((label) => label.textContent ?? "")
            .concat(
              (control.getAttribute("aria-labelledby") ?? "")
                .split(/\s+/)
                .filter((id) => id.length > 0)
                .map((id) => control.ownerDocument.getElementById(id)?.textContent ?? "")
            )
            .join(" ");
          // Split into words first (camelCase, snake_case, digits), so card_cvv, pinCode and cvv2 match like cvv and pin.
          const described = [control.getAttribute("name"), control.id, autocomplete, control.getAttribute("aria-label"), control.getAttribute("placeholder"), labelText]
            .join(" ")
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/[^A-Za-z]+/g, " ");
          return /otp|one ?time|passcode|\bpin\b|\bcvv\b|\bcvc\b|\bcsc\b|card ?number|credit ?card|security ?code|\bssn\b|social ?security|\bsecret\b|\btoken\b/i.test(described);
        });
      },
      SENSITIVE_WALK_LIMIT
    )
    .catch(() => true);
}
