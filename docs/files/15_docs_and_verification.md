# File Spec — Documentation and Verification

## Required docs to update

```text
docs/ai/CURRENT_STATE.md
docs/ai/TASK_LOG.md
docs/ai/ui-reskin-template-plan/16_VISUAL_GAP_CLOSURE_REPORT.md
```

If `16_VISUAL_GAP_CLOSURE_REPORT.md` does not exist, create it.

## `16_VISUAL_GAP_CLOSURE_REPORT.md` required structure

```markdown
# Visual Gap Closure Report

## Template assets reviewed

| Asset | Reviewed? | Frames/screenshots | Notes |
|---|---:|---|---|
| UI Samples/sample_01.png | Yes/No | path | notes |
| UI Samples/Sample02.mp4 | Yes/No | path(s) | notes |
| UI Samples/sample_03.mp4 | Yes/No | path(s) | notes |
| UI Samples/sample_04.mp4 | Yes/No | path(s) | notes |

## Gap checklist

| Area | Template expectation | Current AWKIT gap | Files/selectors fixed | Done? | Screenshot proof |
|---|---|---|---|---:|---|
| App shell | Sidebar full height, header in content | ... | ... | ✅/❌ | ... |
| Sidebar | Template nav + footer | ... | ... | ✅/❌ | ... |
| Header | Title/status/actions cluster | ... | ... | ✅/❌ | ... |
| Canvas | dotted full workspace | ... | ... | ✅/❌ | ... |
| Nodes | white cards + lavender selected | ... | ... | ✅/❌ | ... |
| Connectors | curved violet + labels/add | ... | ... | ✅/❌ | ... |
| Right drawer | floating panel + internal scroll | ... | ... | ✅/❌ | ... |
| Node palette | floating searchable list | ... | ... | ✅/❌ | ... |
| Zoom pill | bottom-center pill | ... | ... | ✅/❌ | ... |
| Motion | hover/slide/flow/pop/shimmer | ... | ... | ✅/❌ | ... |
| Overflows | no page-wide overflow | ... | ... | ✅/❌ | ... |
| Shared pages | cards/forms/tables polished | ... | ... | ✅/❌ | ... |

## Verification

| Command | Result | Notes |
|---|---|---|
| npm run build | pass/fail | ... |
| npm run verify:flow-designer | pass/fail | ... |
| npm run verify:workflow-builder | pass/fail | ... |
| npm run verify:reports | pass/fail | ... |
| npm run verify:instance-monitor | pass/fail | ... |
| npm run verify:recorder | pass/fail | ... |
| npm run verify:data-editor | pass/fail | ... |
| npm run ai:memory | pass/fail | ... |

## Remaining gaps

List only real remaining gaps with reason and next action.
```

## Screenshot requirements

Save before/after screenshots under:

```text
docs/ai/ui-reskin-template-plan/screenshots/before/
docs/ai/ui-reskin-template-plan/screenshots/after/
```

Minimum after screenshots:

```text
dashboard.png
flow-designer.png
scenario-builder.png
workflow-designer.png
recorder.png
instances.png
reports-overview.png
settings.png
```

## Verification commands

Run available commands:

```bash
npm run build
npm run typecheck
npm run verify:flow-designer
npm run verify:workflow-builder
npm run verify:reports
npm run verify:instance-monitor
npm run verify:data-editor
npm run verify:recorder
npm run ai:memory
```

If canvas/connector changes touch runtime-adjacent code, also run:

```bash
npm run verify:runner
npm run verify:runtime-status
npm run verify:telemetry
```

Do not run long stress/packaging suites unless requested.

## Final report format

The agent's final answer must include:

```text
Template assets reviewed:
Frames extracted:
Files changed:
Selectors/components changed:
Canvas fixes:
Node fixes:
Connector fixes:
Drawer/panel fixes:
Overflow fixes:
Animation fixes:
Shared page polish:
Screenshot paths:
Verification command results:
Remaining gaps:
Runtime behavior changed? No/Yes with explanation:
Committed? No/Yes with commit hash:
```
