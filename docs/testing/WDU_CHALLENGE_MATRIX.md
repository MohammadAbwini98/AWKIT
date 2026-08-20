# WebDriverUniversity — SpecterStudio challenge matrix

**Live inventory taken 2026-08-20.** The live site is authoritative for challenge scope; this
matrix records what SpecterStudio was actually *executed* against, not what it might support.

Regenerate the evidence with:

```bash
npm run verify:wdu-live
npm run verify:wdu-recorder-live
npm run verify:wdu-data-live
```

All three need the public internet and are deliberately **excluded** from AWKIT's deterministic
verification set. Every product defect they found has a deterministic regression that does not.

## Live inventory, re-confirmed 2026-08-20

| Area | Count | Change since 2026-08-19 |
| --- | ---: | --- |
| Classic challenge areas linked from `index.html` | 18 (17 challenges + the AI Playground card) | unchanged |
| AI Testing Playground scenarios | 27 (25 inline + 26. Booking Portal + 27. Accessibility Suite) | unchanged |
| Accessibility Suite components | 29 | unchanged — re-counted live, and now asserted by `WDU-A27a` |

No scenario has been added or removed since the previous pass. Nothing was carried forward on trust:
the index and playground pages were re-fetched and re-enumerated, and the component count is an
executed assertion rather than a note.

## Executed tally

| Suite | Cases | PASS | FAIL | BLOCKED | NOT RUN | INCONCLUSIVE | Checks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `verify:wdu-live` | 76 | 76 | 0 | 0 | 0 | 0 | per-case |
| `verify:wdu-recorder-live` | 16 | 16 | 0 | 0 | 0 | 0 | 95 |
| `verify:wdu-data-live` | 8 | 8 | 0 | 0 | 0 | 0 | 92 |
| **Total** | **100** | **100** | **0** | **0** | **0** | **0** | **187** |

Previous pass: 55 cases, 55 PASS, with six challenges NOT RUN and four coverage layers NOT RUN.

## How to read the coverage columns

| Mark | Meaning |
| --- | --- |
| `P` | Proven by an executed case in this matrix. |
| `n/a` | Not applicable to this scenario, with the reason given below. |
| `NR` | **NOT RUN.** No evidence for THIS row. Never read as PASS. |

**A column of `NR` is a statement about rows, not about layers.** Every layer below has real,
executed evidence; a per-row `NR` says that *this particular challenge* was not driven through *that
particular layer*. The layer summary is the honest reading of the columns.

### Layer coverage summary

| Layer | Evidence | Where |
| --- | --- | --- |
| **Recorder** | Every interaction kind in the acceptance scope is captured from the live site through `RecorderService.wireContext` and its stored semantics inspected: navigation, click, text entry, keyboard, submit, select, checkbox, radio, double-click, hover, click-and-hold, drag/drop, popup with opener↔popup attribution, iframe with frame identity, delayed elements, re-render, dynamic locators, AJAX content, file upload, datepicker, autocomplete, and the three dialog kinds. | `WDU-R01`–`R16` |
| **Flow Designer** | Every case is an ordinary `FlowProfile` the designer's own mapping round-trips. No hidden test-only node types are used anywhere. | all rows |
| **Workflow Builder** | Multi-flow composition executed as one scenario, plus `WorkflowProfile` save/reload with its nodes, edges, data-source binding, runtime inputs, retry and failure policy. | `WDU-A25`, `WDU-B02`, `WDU-C25`, `WDU-D02`, `WDU-D07`, `WDU-D08` |
| **Data** | A real `JsonArrayDataSourceProfile` on disk drives one execution instance per row through `ExecutionEngine`, in both sequential and concurrent modes, with row identity preserved into the report. Five data cases: valid, invalid, empty mandatory, boundary, empty optional. | `WDU-D01`–`D06`, `WDU-D08` |
| **Runtime** | Every row was executed by the real runner. | all rows |
| **Persistence** | Full round trips — create → save → reload → edit → re-save → execute → export → import → execute again — over composites carrying every applicable field category. | `WDU-R08`, `WDU-R16`, `WDU-D05`, `WDU-D07`, `WDU-D08` |
| **Report** | The `ConcurrentRunReport` the engine writes is inspected semantically: workflow name and id, execution id, run mode, ordered timestamps, matching duration, per-instance identity and data-row index, per-step results, the assertion step's own status, tallies, and a negative case that pinpoints which row and which step failed. | `WDU-D03`, `WDU-D04` |
| **Session** | Establish app-owned state → save through the product → a fresh browser from the saved state is already signed in → a third run with no session is signed out. | `WDU-S01`–`S03`, `WDU-D08` |

- **Rec** — `P` where that challenge was itself recorded. `NR` elsewhere means the challenge was not
  recorded, **not** that the interaction kind is unproven; see the Recorder row above.
- **Data** — `n/a` where the scenario is single-shot and has no per-row variation to bind. A
  one-row DataSource would be ceremony, not evidence.
- **Persist / Report** — `P` where that flow was itself round-tripped, or its report read.
- **Session** — `n/a` unless the scenario depends on carried browser state.

## Classic challenges

| ID | URL (under `https://webdriveruniversity.com/`) | Challenge | Scenario | Rec | FD | WB | Data | Run | Persist | Report | Session | Deterministic gate | Defect | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-C01` | `Contact-Us/contactus.html` | Contact Us | valid submission is accepted | P | P | n/a | P | P | P | P | n/a | — | — | **PASS** |
| `WDU-C02` | `Contact-Us/contactus.html` | Contact Us | missing mandatory fields are rejected (expected validation, not a runner failure) | P | P | n/a | P | P | P | P | n/a | — | — | **PASS** |
| `WDU-C03` | `Login-Portal/index.html` | Login Portal | valid credentials — asserted on the alert message | P | P | n/a | n/a | P | NR | NR | n/a | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C04` | `Login-Portal/index.html` | Login Portal | invalid credentials — asserted on the alert message | P | P | n/a | n/a | P | NR | NR | n/a | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C05` | `Login-Portal/index.html` | Login Portal | negative control — wrong expected alert text must fail | NR | P | n/a | n/a | P | NR | NR | n/a | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C06` | `Click-Buttons/index.html` | Button Clicks | WebElement / JavaScript / Action click each open their own modal | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits [W-AV*] | awkit-dctr | **PASS** |
| `WDU-C07` | `To-Do-List/index.html` | To Do List | add an item, then delete it, asserting list state both times | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits [W-GT*] | awkit-omlc | **PASS** |
| `WDU-C08` | `Dropdown-Checkboxes-RadioButtons/index.html` | Dropdowns, Checkboxes & Radios | select by label, check, uncheck and radio-select | P | P | n/a | n/a | P | NR | NR | n/a | verify:recorder-capture-gaps [B] | awkit-e0z6 | **PASS** |
| `WDU-C09` | `Ajax-Loader/index.html` | AJAX Loader | wait for the loader to vanish, then click the revealed button | P | P | n/a | n/a | P | NR | NR | n/a | verify:waits [W-AV*] | awkit-dctr | **PASS** |
| `WDU-C10` | `Actions/index.html` | Actions | hover reveals a menu | P | P | n/a | n/a | P | P | NR | n/a | verify:recorder-hover | — | **PASS** |
| `WDU-C11` | `Actions/index.html` | Actions | drag and drop retains source → target semantics | P | P | n/a | n/a | P | P | NR | n/a | verify:recorder-capture-gaps [A] | awkit-tj2o | **PASS** |
| `WDU-C12` | `Actions/index.html` | Actions | double-click is stored and replayed as a true dblclick | P | P | n/a | n/a | P | P | NR | n/a | verify:recorder-flow | — | **PASS** |
| `WDU-C13` | `Scrolling/index.html` | Scrolling Around | scroll a buried element into view and interact with it | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-C14` | `Popup-Alerts/index.html` | Popups & Alerts | alert, confirm (accept and dismiss) and prompt (answered) | P | P | n/a | n/a | P | NR | NR | n/a | verify:dialogs, verify:recorder-dialogs | awkit-azxy, awkit-qlg6 | **PASS** |
| `WDU-C15` | `Popup-Alerts/index.html` | Popups & Alerts | modal popup opens and closes | NR | P | n/a | n/a | P | NR | NR | n/a | verify:dialogs | awkit-azxy | **PASS** |
| `WDU-C16` | `IFrame/index.html` | IFrame | interact inside the iframe, then assert back in the main document | P | P | n/a | n/a | P | P | NR | n/a | verify:frame-chain | — | **PASS** |
| `WDU-C17` | `Hidden-Elements/index.html` | Hidden Elements | a display:none element is correctly reported as hidden | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits | — | **PASS** |
| `WDU-C18` | `Data-Table/index.html` | Data Table | read a specific cell by row identity, not by absolute position | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-C19` | `Autocomplete-TextField/autocomplete-textfield.html` | Autocomplete Textfield | type, wait for live suggestions, pick one | P | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-C20` | `File-Upload/index.html` | File Upload | choose a local file and submit it | P | P | n/a | n/a | P | P | NR | n/a | verify:recorder-upload | awkit-11ii | **PASS** |
| `WDU-C21` | `Accordion/index.html` | Accordion & Text Effects | expand and collapse are asserted on real state, not on a clipped element's visibility | NR | P | n/a | n/a | P | NR | NR | n/a | verify:assertions | awkit-1ugn | **PASS** |
| `WDU-C22` | `Accordion/index.html` | Accordion & Text Effects | each panel toggles independently | NR | P | n/a | n/a | P | NR | NR | n/a | verify:assertions | awkit-1ugn | **PASS** |
| `WDU-C23` | `Accordion/index.html` | Accordion & Text Effects | text that appears on a timer is waited for, not slept through | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits | — | **PASS** |
| `WDU-C24` | `Datepicker/index.html` | Datepicker | open the picker, navigate a month and select a day | P | P | n/a | n/a | P | NR | NR | n/a | verify:recorder-capture-gaps [D] | awkit-n4wr | **PASS** |
| `WDU-C25` | `Page-Object-Model/index.html` | Page Object Model | one shared navigation flow is reused by two journeys (the POM intent, in product terms) | NR | P | P | n/a | P | NR | NR | n/a | verify:runner | — | **PASS** |

## AI Testing Playground

All rows under `AI-Playground/index.html` unless stated.

| ID | Challenge | Scenario | Rec | FD | WB | Data | Run | Persist | Report | Session | Deterministic gate | Defect | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-A01` | AI 1: Dynamic Selectors | log in through regenerated classes using semantic locators | P | P | n/a | n/a | P | NR | NR | n/a | verify:recorder-locator | — | **PASS** |
| `WDU-A02` | AI 2: Flaky Loader | wait out a variable-delay loader | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits | — | **PASS** |
| `WDU-A03` | AI 3: Multi-Step Form | complete all three steps | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A04` | AI 3: Multi-Step Form | single-word name and bad email are rejected (expected validation) | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A05` | AI 4: Auto-Dismiss Toast | toast is shown, then dismissed (asserted on class, not pixels) | NR | P | n/a | n/a | P | NR | NR | n/a | verify:assertions | awkit-1ugn | **PASS** |
| `WDU-A06` | AI 5: Re-Enable Delay | wait for the button to re-enable | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits | — | **PASS** |
| `WDU-A07` | AI 6: Moving Target | click a continuously moving button | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A08` | AI 7: Conditional Validation | handle the conditional verification field | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A09` | AI 8: Race Condition | assert a settled winner rather than a guess | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A10` | AI 9: Lazy-Rendered Element | wait for an element that does not exist yet | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits | — | **PASS** |
| `WDU-A11` | AI 10: iFrame Login | log in entirely inside the iframe | P | P | n/a | n/a | P | P | NR | n/a | verify:frame-chain | — | **PASS** |
| `WDU-A12` | AI 11: Shadow DOM Widget | interact with a control inside an open shadow root | NR | P | n/a | n/a | P | NR | NR | n/a | verify:closed-shadow | — | **PASS** |
| `WDU-A13` | AI 12: Employee Directory | filter the table and assert the surviving rows | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits [W-LC*] | awkit-380d | **PASS** |
| `WDU-A14` | AI 13: File Upload Validator | upload a valid file and assert the echoed metadata | NR | P | n/a | n/a | P | P | NR | n/a | verify:recorder-upload | awkit-11ii | **PASS** |
| `WDU-A15` | AI 14: Priority Board | drag a task to another column and assert board state | NR | P | n/a | n/a | P | NR | NR | n/a | verify:recorder-capture-gaps [A] | awkit-tj2o | **PASS** |
| `WDU-A16` | AI 15: Stale Element | act on a list that re-renders under the locator | P | P | n/a | n/a | P | NR | NR | n/a | verify:recorder-capture-gaps [C] | awkit-vzhy | **PASS** |
| `WDU-A17` | AI 16: Invisible Success | the text assertion is NOT fooled (innerText is empty) | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A17b` | AI 16: Invisible Success | ...and SpecterStudio still reports it INVISIBLE (detection) | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A17c` | AI 17: Timing Mismatch | capture → verify synchronises, over five consecutive cycles | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A17d` | AI 17: Timing Mismatch | negative control — Verify without a Capture reports nothing captured | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A18` | AI 18: Network States | a successful request settles the result region | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits | — | **PASS** |
| `WDU-A19` | AI 18: Network States | an error response is reported as an error, not a hang | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits | — | **PASS** |
| `WDU-A20` | AI 19: JS Dialog Traps | alert, confirm and prompt all answered by the flow | P | P | n/a | n/a | P | NR | NR | n/a | verify:dialogs, verify:recorder-dialogs | awkit-azxy, awkit-qlg6 | **PASS** |
| `WDU-A20b` | AI 20: localStorage Session | the session is asserted in localStorage, not read off the banner | NR | P | n/a | n/a | P | P | NR | P | verify:storage-assertions | awkit-7o5n | **PASS** |
| `WDU-A20c` | AI 20: localStorage Session | negative control — bad credentials leave no session behind | NR | P | n/a | n/a | P | NR | NR | n/a | verify:storage-assertions | awkit-7o5n | **PASS** |
| `WDU-A21` | AI 21: Attribute vs Visual State | read and assert aria-pressed (initial state — post-click value is site-nondeterministic) | NR | P | n/a | n/a | P | NR | NR | n/a | verify:assertions | awkit-1ugn | **PASS** |
| `WDU-A21b` | AI 21: Attribute vs Visual State | negative control — a wrong attribute value must fail | NR | P | n/a | n/a | P | NR | NR | n/a | verify:assertions | awkit-1ugn | **PASS** |
| `WDU-A22` | AI 22: Mutation Observer | wait for asynchronously added items to reach a count | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits [W-LC*] | awkit-380d | **PASS** |
| `WDU-A23` | AI 23: API Intercept | a live fetch settles the result region | NR | P | n/a | n/a | P | NR | NR | n/a | verify:waits | — | **PASS** |
| `WDU-A24` | AI 24: New Tab / Popup | capture the popup and assert content, then return to the opener | P | P | n/a | n/a | P | P | NR | n/a | verify:recorder-capture-gaps [E], verify:popup-identity | awkit-jw46 | **PASS** |
| `WDU-A25` | AI 25: Shop & Checkout Flow | full capstone: cart, details, review, confirm | NR | P | P | n/a | P | NR | NR | n/a | — | — | **PASS** |
| `WDU-A26` | AI 25: Shop & Checkout Flow | empty cart is refused (expected validation) | NR | P | n/a | n/a | P | NR | NR | n/a | — | — | **PASS** |

### AI 26. Booking Portal

Linked from the playground as scenario 26; its own capstone section below (`WDU-B01`–`B07`).

### AI 27. Accessibility Suite — all 29 components

`Accessibility-Suite/index.html`. Nine cases; the component count is asserted, not assumed.

| ID | Scenario | Components covered | Rec | FD | WB | Data | Run | Persist | Report | Deterministic gate | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-A27a` | the suite's component inventory is what the site claims (29) | inventory, 14 (capstone badge) | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |
| `WDU-A27b` | roles, accessible names and control state are readable — including where they are wrong | 2, 4, 5, 18, 19, 24, 26 | NR | P | n/a | n/a | P | NR | NR | verify:assertions | **PASS** |
| `WDU-A27c` | form labels, placeholder-only fields and the unlabelled contact form | 3, 10, 11, 15 | NR | P | n/a | n/a | P | NR | NR | verify:assertions | **PASS** |
| `WDU-A27d` | keyboard: focus placement, a real focus trap, and a dropdown that swallows Tab | 16, 22, 23 | NR | P | n/a | n/a | P | NR | NR | verify:runner | **PASS** |
| `WDU-A27e` | dialog, live regions and the mismatched accordion | 6, 8, 12, 20, 21 | NR | P | n/a | n/a | P | NR | NR | verify:assertions | **PASS** |
| `WDU-A27f` | capstone — the three-step registration journey completes | 14 | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |
| `WDU-A27g` | capstone validation — a bad email is rejected and the journey stays on step 1 | 14 | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |
| `WDU-A27h` | settings, search and filtering all drive real state | 28, 29 | NR | P | n/a | n/a | P | NR | NR | verify:waits | **PASS** |
| `WDU-A27i` | the non-interactive components' defects are observable through attribute assertions | 1, 7, 9, 13, 17, 25, 27 | NR | P | n/a | n/a | P | NR | NR | verify:assertions | **PASS** |

Every one of the 29 components appears in at least one case. Where a component's defect is a missing
or wrong attribute, the case asserts that value deliberately — that is the target site's defect,
recorded under external observations, and asserting it is how SpecterStudio proves it can SEE what an
accessibility test would need to report.

## Capstone — Restaurant Booking Portal

`Restaurant-Booking/index.html`.

| ID | Challenge | Scenario | Rec | FD | WB | Data | Run | Persist | Report | Deterministic gate | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-B01` | Booking: Deposit rules | each table type shows its own deposit | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |
| `WDU-B02` | Booking: Full reservation | party, date, slot, details, review, confirm, reference | NR | P | P | n/a | P | NR | NR | — | **PASS** |
| `WDU-B03` | Booking: Details validation | bad name, email and phone are each reported | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |
| `WDU-B04` | Booking: Navigation | Back preserves earlier answers | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |
| `WDU-B05` | Booking: Restart | a confirmed booking can be followed by a new one | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |
| `WDU-B06` | Booking: Boundary | 8 guests on a Standard table cannot advance | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |
| `WDU-B07` | Booking: Boundary | negative control — 8 guests on a Group table does advance | NR | P | n/a | n/a | P | NR | NR | — | **PASS** |

## Recorder acceptance — `verify:wdu-recorder-live`

Every case captures a real WDU interaction through `RecorderService.wireContext` and inspects the
**stored** action. Nothing here hand-authors a `FlowProfile` and calls it Recorder evidence.

| ID | Challenge | What the stored semantics must be | Replay | Persist | Deterministic gate | Defect | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-R01` | Contact Us | navigation, four fills carrying their typed values, a `press` naming the key, a submit click, in the order performed | n/a | n/a | verify:recorder-locator | — | **PASS** |
| `WDU-R02` | Login Portal | the click carries a `dialogExpectation` naming the kind and an explicit accept; the password value is redacted; the alert TEXT is not baked in | n/a | n/a | verify:recorder-dialogs | awkit-qlg6 | **PASS** |
| `WDU-R03` | Dropdowns, Checkboxes & Radios | `select` with the chosen option, `check`, `uncheck` (not a second check), `radio` with a locator that pins the option | n/a | n/a | verify:recorder-capture-gaps [B] | awkit-e0z6 | **PASS** |
| `WDU-R04` | Actions | ONE `dblclick`, with no ordinary click left in front of it | P | n/a | verify:recorder-flow | — | **PASS** |
| `WDU-R05` | Actions | the click is flagged `requiresHover` with a trigger present at rest, not the revealed surface; the alert it raises lands on the same action | P | n/a | verify:recorder-hover | — | **PASS** |
| `WDU-R06` | Actions | `clickAndHold` with the measured duration — not an ordinary click | P | n/a | verify:click-and-hold, verify:recorder-capture-gaps [F] | awkit-dhdr | **PASS** |
| `WDU-R07` | Actions | ONE `drag` carrying source and destination as separate locators | P | n/a | verify:recorder-capture-gaps [A] | awkit-tj2o | **PASS** |
| `WDU-R08` | IFrame | the locator names the element, not the iframe, and carries a frame chain; the step is resolved rather than parked for review | P | P | verify:frame-chain | — | **PASS** |
| `WDU-R09` | AI 24: New Tab / Popup | opener marked `opensPopup` and attributed to the opener; the popup's own action attributed to the popup alias; switch steps inserted in both directions | n/a | n/a | verify:recorder-capture-gaps [E], verify:popup-identity | awkit-jw46 | **PASS** |
| `WDU-R10` | File Upload | `uploadFile` with the input's locator and the chosen file name, NO fabricated path, and preflight refuses it until a real path is supplied | P | n/a | verify:recorder-upload | awkit-11ii | **PASS** |
| `WDU-R11` | Autocomplete Textfield | the typed prefix and the suggestion pick are each their own action | n/a | n/a | — | — | **PASS** |
| `WDU-R12` | AI 1: Dynamic Selectors | no PRIMARY locator is positional or a generated-class selector; every locator reports its uniqueness | n/a | n/a | verify:recorder-locator | — | **PASS** |
| `WDU-R13` | AJAX Loader | the late-arriving button is captured normally and replays | P | n/a | verify:waits | — | **PASS** |
| `WDU-R14` | AI 15: Stale Element | the post-re-render action's locator is not a DOM index into the replaced list | n/a | n/a | verify:recorder-capture-gaps [C] | awkit-vzhy | **PASS** |
| `WDU-R15` | Datepicker | opening the readonly field is captured, the day cell is a click, and nothing types into the field | n/a | n/a | verify:recorder-capture-gaps [D] | awkit-n4wr | **PASS** |
| `WDU-R16` | Contact Us | record → save → reload → edit → re-save → run → report, with every step's type, locator and value intact | P | P | verify:recorder-e2e | — | **PASS** |

## Data, persistence and reports — `verify:wdu-data-live`

| ID | Challenge | Scenario | Data | Persist | Report | Session | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `WDU-D01` | Contact Us | a saved Data Source drives one execution instance per row | P | P | n/a | n/a | **PASS** |
| `WDU-D02` | Contact Us | five data rows execute against the live site, each asserting its own expectation | P | P | P | n/a | **PASS** |
| `WDU-D03` | Contact Us | the run report carries semantic execution evidence, not just a file | P | n/a | P | n/a | **PASS** |
| `WDU-D04` | Contact Us | negative report case — a wrong expectation fails, and says which row and which step | P | n/a | P | n/a | **PASS** |
| `WDU-D05` | Contact Us | create → bind → save → reload → edit mapping → re-save → export → import → execute | P | P | P | n/a | **PASS** |
| `WDU-D06` | Contact Us | sequential execution and the run history the reports form | P | n/a | P | n/a | **PASS** |
| `WDU-D07` | Actions (composite) | explicit wait, three complex actions, dialog policy, attribute assertion, conditional, loop, workflow composition, runtime input, failure policy and screenshot all round-trip and still run | n/a | P | n/a | n/a | **PASS** |
| `WDU-D08` | AI Playground (composite) | popup lifecycle, iframe, storage assertion, upload configuration, session configuration and DataSource binding all round-trip and still run | P | P | n/a | P | **PASS** |

The five data cases the acceptance scope requires, all in `WDU-D02`: a valid record, an invalid
record (a malformed address the site rejects with its own message), a record with empty mandatory
fields, a 120-character boundary record, and a record with an empty optional field. The expectation
itself is bound to the row, so one flow expresses both the accepted and the rejected outcome.

## Session reuse — `verify:wdu-live`

| ID | Scenario | Session | Status |
| --- | --- | --- | --- |
| `WDU-S01` | establish app-owned session state and save it through the product's `saveSession` node | P | **PASS** |
| `WDU-S02` | a fresh execution starting from the saved state is already signed in, with no login steps at all | P | **PASS** |
| `WDU-S03` | without the saved session the same flow is signed out — so `WDU-S02` cannot pass by accident | P | **PASS** |

The credential is the AI Playground's own public demo login on a practice site. No protected surface
is automated, no CAPTCHA/MFA/OTP/passkey is involved, and the state lives in a temp directory created
for the run — never a real browser profile.

## Challenges present on the live site with no executed case

**None.** Every challenge on the live index, every AI Playground scenario, the Restaurant Booking
capstone and all 29 Accessibility Suite components have at least one executed case.

## Product defects found and fixed

### This tranche (2026-08-20)

| Bead | Severity | Defect | Regression | Mutation (checks that fail without the fix) |
| --- | --- | --- | --- | --- |
| `awkit-7o5n` | P2 | No browser-storage assertion existed, so AI 20 could not be expressed at all. | `verify:storage-assertions`, 32 checks | 13 (branch removed) / 7 (absent sentinel collapsed) / 1 (area ignored) |
| `awkit-dhdr` | P1 | No press-and-hold gesture: a click-and-hold was recorded and replayed as an ordinary click, passing through both states in ~15ms. | `verify:click-and-hold`, 28 checks | 8 (recognizer disabled) / 2 (evidence requirement dropped) / 2 (replay collapsed) |
| `awkit-11ii` | P1 | A file chooser was stored as an unrunnable `fill` carrying `C:\fakepath\…`, twice, and the flow saved clean. | `verify:recorder-upload`, 13 checks | 11 (fall-through restored) / 2 (empty value source) / 4 (duplicate action) |
| `awkit-qlg6` | P1 | The Recorder never captured a dialog. Playwright auto-dismissed every one during capture, so `confirm()` returned false while recording, and the saved flow carried no policy. | `verify:recorder-dialogs`, 18 checks | 13 (listener removed) / 4 (policy dropped in build) / 1 (message persisted) |
| `awkit-tj2o` | P1 | A drag whose source follows the cursor recorded nothing — `elementFromPoint` returns the drag ghost, and the source guard discarded the gesture. | `verify:recorder-capture-gaps` [A], 29 checks | 4 |
| `awkit-e0z6` | P1 | Radio/checkbox options with a stable `value` got `:nth-of-type(n)`: `value` ranked twelfth, and the scoped positional selector was not flagged as a fallback. | `verify:recorder-capture-gaps` [B] | 2 (value demoted) / 2 (scoped unflagged) |
| `awkit-vzhy` | P1 | The text locator was offered to buttons and links only, so clickable list items got positional selectors. | `verify:recorder-capture-gaps` [C] | 2 |
| `awkit-n4wr` | P1 | The click on a READONLY text input was dropped as redundant, losing every picker-opening interaction. | `verify:recorder-capture-gaps` [D] | 1 |
| `awkit-jw46` | P1 | A `document.write` popup recorded nothing: the install flag was a Window property `document.open()` leaves behind, and injection sat behind the popup identity budget. | `verify:recorder-capture-gaps` [E] | 4 |

### Previous tranche (2026-08-19)

| Bead | Severity | Defect | Regression |
| --- | --- | --- | --- |
| `awkit-azxy` | P0 | No JavaScript dialog handling existed anywhere; Playwright auto-dismissed every dialog while the clicking step reported PASSED. | `verify:dialogs`, 18 checks; 13 fail without the fix. |
| `awkit-380d` | P0 | `tableHasRows` / `listHasItems` could never count past 1. | `verify:waits` [W-LC1..5]; 3 fail without the fix. |
| `awkit-dctr` | P1 | `assertVisible` used an immediate check that ignored its timeout. | `verify:waits` [W-AV1..4]; 3 fail without the fix. |
| `awkit-1ugn` | P1 | No attribute assertion existed. | `verify:assertions`, 12 checks; 5 fail without the fix. |
| `awkit-omlc` | P1 | `goto` could not choose its load condition. | `verify:waits` [W-GT1..2]. |

## Regression suites

Each scenario stays independently identifiable — a failure names its own case, never a generic
workflow failure.

| Suite | Command |
| --- | --- |
| WDU Classic Regression | `npx tsx scripts/verify-wdu-live.mts --only WDU-C` |
| WDU AI Playground Regression | `npx tsx scripts/verify-wdu-live.mts --only WDU-A` |
| WDU Capstone Regression | `npx tsx scripts/verify-wdu-live.mts --only WDU-B` |
| WDU Session Regression | `npx tsx scripts/verify-wdu-live.mts --only WDU-S` |
| WDU Recorder Regression | `npm run verify:wdu-recorder-live` |
| WDU Data / Persistence / Report Regression | `npm run verify:wdu-data-live` |
| WDU Full Regression | all three `verify:wdu-*` scripts |

## External-site observations (not product defects)

| Observation | Evidence |
| --- | --- |
| The To-Do-List page never fires `load`. Its HTML returns 200 in ~471ms but a Font Awesome webfont from `cdnjs.cloudflare.com` never completes. | Reproduced 3/3. Motivated `awkit-omlc`; the case navigates with `waitUntil: "domcontentloaded"`. |
| `aria-pressed` on the Attribute-vs-Visual-State toggle desynchronises nondeterministically. | Measured over six consecutive clicks: `false, false, true, true, true, false` while the button text toggled correctly every time. The challenge's deliberate defect, so no live post-click value is asserted. |
| The auto-dismiss toast hides with `opacity: 0` alone — `visibility` stays `visible`. | Playwright therefore correctly reports it visible forever; the case asserts the `show` class instead. |
| The Invisible-Success node is `visibility: hidden` while `textContent` reads as success. | `innerText` returns `""`, so the product's text assertion is not fooled either. Both directions asserted as negative cases. |
| Booking slot availability is API-backed and varies per date. | Measured: 7pm and 9pm unavailable on one day, 6pm and 7pm on the next. Day and slot are chosen positionally among available options, never hardcoded. |
| The index page ships four cards sharing `id="data-table"`. | Duplicate ids for Data Table, Autocomplete, File Upload and Datepicker. Cosmetic; no case depends on those ids. |
| The Accordion's trigger says "Text will Appear After 5 Seconds!" while the page's own timer is `setTimeout(…, 10000)`. | Read from the page source and confirmed by `WDU-C23`, which waits for the text rather than for the duration the label claims. |
| The Contact Us form rejects a malformed address with `Error: Invalid email address` rather than accepting anything non-empty. | Measured while building the data-driven rows; row 2 of `WDU-D02` is a genuine invalid-record case as a result. |
| Two unlabelled fields on the Accessibility Suite share the exact placeholder `Email` (`#contact-email` and `#reg-email`). | The product correctly refuses the ambiguous locator rather than guessing. Asserted as a count in `WDU-A27c`: the "label" the component offers cannot identify either field. |
| The Accessibility Suite's 29 deliberate site defects: colour-only status (1), a control labelled locked with no `disabled` (2), unlabelled inputs and an unlinked error (3), a `span` checkbox with no role or `aria-checked` (4), a hover-only menu with `tabindex=-1` (5), click-only tabs with no `role=tab` (6), three broken alt states (7), a modal with no `role=dialog` or `aria-modal` (8), h2→h4 heading order (9), CSS-reordered fields (10), jargon-only error text (11), a live region with no `aria-live` (12), a skip link whose target does not exist (13), placeholder-as-label (15), stripped focus outlines (16), an undistinguished inline link (17), an `aria-hidden` focusable button (18), `role="link"` on a button plus `role="presentation"` list items (19), a payment FAILURE announced `polite` (20), `aria-controls` naming the wrong panel (21), a keyboard focus trap (22), a dropdown that swallows Tab (23), positive `tabindex` values 3/1/5/2 (24), alt text repeating the caption (25), an icon button with no accessible name (26), a background-image-only banner (27), a toggle with no role (28). | `WDU-A27b`–`A27i` |

## Open capability gaps

**None.** `awkit-7o5n` (browser storage), `awkit-53nb` (Recorder capture) and `awkit-9fvb`
(persistence, data binding, reports) are all closed with executed evidence.

## What is deliberately not claimed

- Per-row `NR` marks in the Rec / Persist / Report columns mean that *challenge* was not driven
  through that layer. Each layer's own evidence is listed in the layer summary above, and none of it
  is `NR`.
- `n/a` in the Data column means the scenario is single-shot: it has no per-row variation to bind, so
  a one-row DataSource would be ceremony rather than evidence.
- The Accessibility Suite cases assert the target site's deliberate defects. They are evidence that
  SpecterStudio can observe those states, not a claim that the site is accessible.

---

_Last executed run: 2026-08-20. Machine-readable results: `wdu-live-results.json`,
`wdu-recorder-results.json`, `wdu-data-results.json` — all gitignored; regenerate by running the
gates._
