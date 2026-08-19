# WebDriverUniversity — SpecterStudio challenge matrix

**Live inventory taken 2026-08-19.** The live site is authoritative for challenge scope; this
matrix records what SpecterStudio was actually *executed* against, not what it might support.

Regenerate the evidence with:

```bash
npm run verify:wdu-live
```

That gate needs the public internet and is deliberately **excluded** from AWKIT's deterministic
verification set. Every product defect it found has a deterministic regression that does not.

## Executed tally

| PASS | FAIL | BLOCKED | NOT RUN | INCONCLUSIVE |
| ---: | ---: | ------: | ------: | -----------: |
| 55 | 0 | 0 | 0 | 0 |

55 acceptance cases executed through the real `PlaywrightRunner`.

## How to read the coverage columns

| Mark | Meaning |
| --- | --- |
| `P` | Proven by an executed case in this matrix. |
| `P*` | Partially proven — see the note on that column below. |
| `n/a` | Not applicable to this scenario. |
| `NR` | **NOT RUN.** No evidence. Never read as PASS. |

- **Rec (Recorder)** — `NR` for every row. No WebDriverUniversity challenge was captured through
  the Recorder in this pass; the flows are authored `FlowProfile`s. Recorder capture against WDU
  is tracked as `awkit-53nb` and is the single largest remaining gap.
- **FD (Flow Designer)** — `P` where the scenario is expressed as an ordinary `FlowProfile`
  (start/end nodes, action nodes, assertions, waits, locators, popup and frame metadata) that the
  designer's own mapping round-trips. No hidden test-only node types are used.
- **WB (Workflow Builder)** — `P` only where the case is genuinely composed of multiple flows run
  as one scenario. Single-flow cases are `n/a`, not `P`.
- **Data** — `P*` on the Login Portal rows: the same flow shape is driven over two credential
  records. That is parameterised authoring, **not** the product's DataSource/runtime-input
  binding, which is `NR` across this matrix (`awkit-9fvb`).
- **Run (Runner)** — `P` everywhere: every row was executed by the real runner.
- **Persist** — `NR` per row. Round-trip IS proven for the new fields in the deterministic gates
  (`verify:dialogs` [6], `verify:assertions` [D]), but no WDU flow was saved, reloaded, edited and
  re-saved through the application (`awkit-9fvb`).
- **Report** — `NR` per row. No run report was inspected for a WDU execution (`awkit-9fvb`).

## Classic challenges

### Classic

| ID | Challenge | Scenario | Rec | FD | WB | Data | Run | Persist | Report | Deterministic gate | Defect | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-C01` | Contact Us | valid submission is accepted | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C02` | Contact Us | missing mandatory fields are rejected (expected validation, not a runner failure) | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C03` | Login Portal | valid credentials — asserted on the alert message | NR | P | n/a | P* | P | NR | NR | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C04` | Login Portal | invalid credentials — asserted on the alert message | NR | P | n/a | P* | P | NR | NR | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C05` | Login Portal | negative control — wrong expected alert text must fail | NR | P | n/a | n/a | P | NR | NR | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C06` | Button Clicks | WebElement / JavaScript / Action click each open their own modal | NR | P | n/a | n/a | P | NR | NR | verify:waits [W-AV*] | awkit-dctr | **PASS** |
| `WDU-C07` | To Do List | add an item, then delete it, asserting list state both times | NR | P | n/a | n/a | P | NR | NR | verify:waits [W-GT*] | awkit-omlc | **PASS** |
| `WDU-C08` | Dropdowns, Checkboxes & Radios | select by label, check, uncheck and radio-select | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C09` | AJAX Loader | wait for the loader to vanish, then click the revealed button | NR | P | n/a | n/a | P | NR | NR | verify:waits [W-AV*] | awkit-dctr | **PASS** |
| `WDU-C10` | Actions | hover reveals a menu | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C11` | Actions | drag and drop retains source → target semantics | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C12` | Actions | double-click is stored and replayed as a true dblclick | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C13` | Scrolling Around | scroll a buried element into view and interact with it | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C14` | Popups & Alerts | alert, confirm (accept and dismiss) and prompt (answered) | NR | P | n/a | n/a | P | NR | NR | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C15` | Popups & Alerts | modal popup opens and closes | NR | P | n/a | n/a | P | NR | NR | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C16` | IFrame | interact inside the iframe, then assert back in the main document | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C17` | Hidden Elements | a display:none element is correctly reported as hidden | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C18` | Data Table | read a specific cell by row identity, not by absolute position | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C19` | Autocomplete Textfield | type, wait for live suggestions, pick one | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-C20` | File Upload | choose a local file and submit it | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |

### AI Testing Playground

| ID | Challenge | Scenario | Rec | FD | WB | Data | Run | Persist | Report | Deterministic gate | Defect | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-A01` | AI: Dynamic Selectors | log in through regenerated classes using semantic locators | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A02` | AI: Flaky Loader | wait out a variable-delay loader | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A03` | AI: Multi-Step Form | complete all three steps | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A04` | AI: Multi-Step Form | single-word name and bad email are rejected (expected validation) | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A05` | AI: Auto-Dismiss Toast | toast is shown, then dismissed (asserted on class, not pixels) | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A06` | AI: Re-Enable Delay | wait for the button to re-enable | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A07` | AI: Moving Target | click a continuously moving button | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A08` | AI: Conditional Validation | handle the conditional verification field | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A09` | AI: Race Condition | assert a settled winner rather than a guess | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A10` | AI: Lazy-Rendered Element | wait for an element that does not exist yet | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A11` | AI: iFrame Login | log in entirely inside the iframe | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A12` | AI: Shadow DOM Widget | interact with a control inside an open shadow root | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A13` | AI: Employee Directory | filter the table and assert the surviving rows | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A14` | AI: File Upload Validator | upload a valid file and assert the echoed metadata | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A15` | AI: Priority Board | drag a task to another column and assert board state | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A16` | AI: Stale Element | act on a list that re-renders under the locator | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A17` | AI: Invisible Success | the text assertion is NOT fooled (innerText is empty) | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A17b` | AI: Invisible Success | ...and SpecterStudio still reports it INVISIBLE (detection) | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A18` | AI: Network States | a successful request settles the result region | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A19` | AI: Network States | an error response is reported as an error, not a hang | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A20` | AI: JS Dialog Traps | alert, confirm and prompt all answered by the flow | NR | P | n/a | n/a | P | NR | NR | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-A21` | AI: Attribute vs Visual State | read and assert aria-pressed (initial state — post-click value is site-nondeterministic) | NR | P | n/a | n/a | P | NR | NR | verify:assertions | awkit-1ugn | **PASS** |
| `WDU-A21b` | AI: Attribute vs Visual State | negative control — a wrong attribute value must fail | NR | P | n/a | n/a | P | NR | NR | verify:assertions | awkit-1ugn | **PASS** |
| `WDU-A22` | AI: Mutation Observer | wait for asynchronously added items to reach a count | NR | P | n/a | n/a | P | NR | NR | verify:waits [W-LC*] | awkit-380d | **PASS** |
| `WDU-A23` | AI: API Intercept | a live fetch settles the result region | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A24` | AI: New Tab / Popup | capture the popup and assert content, then return to the opener | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A25` | AI: Shop & Checkout Flow | full capstone: cart, details, review, confirm | NR | P | P | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-A26` | AI: Shop & Checkout Flow | empty cart is refused (expected validation) | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |

### Capstone — Restaurant Booking Portal

| ID | Challenge | Scenario | Rec | FD | WB | Data | Run | Persist | Report | Deterministic gate | Defect | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-B01` | Booking: Deposit rules | each table type shows its own deposit | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-B02` | Booking: Full reservation | party, date, slot, details, review, confirm, reference | NR | P | P | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-B03` | Booking: Details validation | bad name, email and phone are each reported | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-B04` | Booking: Navigation | Back preserves earlier answers | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-B05` | Booking: Restart | a confirmed booking can be followed by a new one | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-B06` | Booking: Boundary | 8 guests on a Standard table cannot advance | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |
| `WDU-B07` | Booking: Boundary | negative control — 8 guests on a Group table does advance | NR | P | n/a | n/a | P | NR | NR | — | — | **PASS** |

## Challenges present on the live site with NO executed case

Recorded honestly as **NOT RUN**. These are not failures — they were not attempted.

| Challenge | URL | Why not run |
| --- | --- | --- |
| Page Object Model | `Page-Object-Model/index.html` | Its reuse concept is covered structurally by the multi-flow compositions (`WDU-A25`, `WDU-B02`) rather than by driving the page itself. The page IS driven indirectly — it is what the IFrame challenge embeds (`WDU-C16`). |
| Accordion & Text Effects | `Accordion/index.html` | Not attempted. |
| Datepicker | `Datepicker/index.html` | Not attempted as a standalone challenge; equivalent calendar navigation IS exercised against the booking portal (`WDU-B02`). |
| AI 17. Timing Mismatch | `AI-Playground/index.html` | Not attempted. |
| AI 20. localStorage Session | `AI-Playground/index.html` | **Cannot be expressed through the product model** — SpecterStudio has no browser-storage assertion or read step. Capability gap `awkit-7o5n`. |
| AI 27. Accessibility Suite | `Accessibility-Suite/index.html` | **Newly present on the live site** and not in the requested scope list. 29 components; not attempted. |

## External-site observations (not product defects)

| Observation | Evidence |
| --- | --- |
| The To-Do-List page never fires `load`. Its HTML returns 200 in ~471ms but a Font Awesome webfont from `cdnjs.cloudflare.com` never completes. | Reproduced 3/3. Motivated `awkit-omlc`; the case now navigates with `waitUntil: "domcontentloaded"`. |
| `aria-pressed` on the Attribute-vs-Visual-State toggle desynchronises nondeterministically. | Measured over six consecutive clicks: `false, false, true, true, true, false` while the button text toggled correctly every time. This is the challenge's deliberate defect, so no live post-click value is asserted. |
| The auto-dismiss toast hides with `opacity: 0` alone — `visibility` stays `visible`, `display` stays `block`. | Playwright therefore correctly reports it visible forever; an `elementHidden` wait can never fire. The case asserts the `show` class instead. |
| The Invisible-Success node is `visibility: hidden` while `textContent` reads as success. | `innerText` returns `""`, so the product's text assertion is not fooled either. Both directions asserted as negative cases. |
| Booking slot availability is API-backed and varies per date. | Measured: 7pm and 9pm unavailable on one day, 6pm and 7pm on the next. Day and slot are chosen positionally among available options, never hardcoded. |
| The index page ships four cards sharing `id="data-table"`. | Duplicate ids for Data Table, Autocomplete, File Upload and Datepicker. Cosmetic; no case depends on those ids. |

## Product defects found and fixed

| Bead | Severity | Defect | Regression |
| --- | --- | --- | --- |
| `awkit-azxy` | P0 | No JavaScript dialog handling existed anywhere. Playwright auto-dismissed every dialog, so `confirm()` always returned false and `prompt()` always returned null — while the clicking step still reported PASSED. | `verify:dialogs`, 18 checks; 13 fail without the fix. |
| `awkit-380d` | P0 | `tableHasRows` / `listHasItems` could never count past 1 with an explicit row/item locator — the counted locator was built with `.first()`. | `verify:waits` [W-LC1..5]; 3 fail without the fix. |
| `awkit-dctr` | P1 | `assertVisible` used `isVisible()`, an immediate check that ignores the timeout it is handed, so it raced any element that appears asynchronously. | `verify:waits` [W-AV1..4]; 3 fail without the fix. |
| `awkit-1ugn` | P1 | No attribute assertion existed, so an element's attribute could not be asserted at all. | `verify:assertions`, 12 checks; 5 fail without the fix. |
| `awkit-omlc` | P1 | `goto` could not choose its load condition, so one hanging subresource blocked navigation entirely. | `verify:waits` [W-GT1..2]. |

## Open capability gaps (not fixed in this pass)

| Bead | Gap |
| --- | --- |
| `awkit-7o5n` | No browser-storage (localStorage/sessionStorage) assertion or read step. Blocks AI challenge 20 entirely. |
| `awkit-53nb` | No Recorder capture of any WDU challenge — the Recorder column is NOT RUN across the whole matrix. |
| `awkit-9fvb` | No WDU save/reload/edit/re-save round trip, no DataSource binding, and no run-report inspection. |

---

_Generated from `wdu-live-results.json`. Last executed run: 2026-08-19._
