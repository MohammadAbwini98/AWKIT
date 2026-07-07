# 08 — Simplification Without Functionality Loss

**Golden rule:** simplification is **visual/organizational only**. No control, field, action, or data
path may be removed. Everything stays reachable; we reduce visual noise, not capability.

## What CAN be visually simplified
- Reduce competing borders/shadows; one hairline + soft shadow per surface.
- Consolidate redundant headings/labels; use muted secondary text instead of boxes.
- Replace dense button rows with a primary action + grouped ghost/overflow actions.
- Unify status representation (badge + icon) instead of ad-hoc colored text.
- Calmer spacing/rhythm so the same content reads lighter.

## What CANNOT be removed
Any node type/config field, connector option, recorder control, run/cancel, filters, report metric,
setting, dangerous action, or IPC-bound value. Required fields stay required and visible.

## Grouping secondary controls
- Move advanced/rarely-used options into a **collapsible "Advanced"** section (default collapsed, clearly labeled).
- Overflow/"⋯" menus for tertiary row actions — but destructive actions are **never** hidden behind overflow.

## When collapsible sections are allowed
- Only for secondary/advanced content; primary task controls stay visible.
- Collapsed state must be obvious (chevron + label) and remember per-session where reasonable.

## Required-field preservation rules
- Keep field, label, validation, and error text. If grouped, group visibly; never auto-hide a required input.
- No change to default values or submit payloads.

## Advanced-field grouping rules
- Node Properties: basic (name/type/target) visible; timeouts/retries/selectors/advanced under "Advanced".
- Connector Properties: type/label visible; shape/line/thickness/arrow/color under "Style".

## Dangerous-action visibility rules
- Delete/reset/clear stay **visible**, styled as danger, with confirm. Never collapsed, never hidden by hover-only reveal.

## Per-surface simplification
- **Recorder:** big record/stop/pause primary; locator tuning grouped; keep protected-login path.
- **Workflow properties:** two-tier (Basic/Advanced), all fields retained.
- **Instance cards:** lead with status + name + key metric; details on expand; keep cancel/artifacts.
- **Reports/dashboard:** one KPI header + chart per card; move secondary stats to a details row/tooltip.
- **Empty states:** single icon + line + one CTA (not a wall of tips).
