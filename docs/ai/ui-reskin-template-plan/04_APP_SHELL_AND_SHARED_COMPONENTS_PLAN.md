# 04 — App Shell & Shared Components Plan

Format per item: **Current problem → Target → Files/classes → Risk → Verification.**
All changes are CSS-in-`global.css` unless a `.tsx` className tweak is noted. No structural/route/IPC changes.

## `.app-shell`
- **Current:** grid ok; body inherits light bg.
- **Target:** apply `--awkit-bg-grad` behind; ensure body/`#root` transparent so glow shows.
- **Files:** `global.css` (`:root`, `.app-shell`, `body`).
- **Risk:** low. **Verify:** app opens dark; glow visible; no white flash on route change.

## `.top-header`
- **Current:** `background:#ffffff; border-bottom:1px solid #dde3ed`.
- **Target:** glass (`--awkit-glass` + blur), hairline border, tokened title/subtitle, icon-button + ghost/primary actions.
- **Files:** `global.css` `.top-header`, `.header-title`, `.header-actions`, `.toolbar-button(.primary)`, `.icon-button`; markup unchanged (`TopHeader.tsx`).
- **Risk:** low. **Verify:** header readable, actions styled, back button states correct.

## `.left-navigation`
- **Current:** hardcoded greys; active state flat.
- **Target:** vertical gradient surface, hairline right border, group labels, active = accent-soft + left gradient rail + purple icon; collapsed icon-only preserved.
- **Files:** `global.css` `.left-navigation`, `.nav-group(-label)`, `.nav-item(.active)`, `.brand-*`, `.nav-collapse-button`; markup unchanged (`LeftNavigation.tsx`, brand text still "WFS/WebFlow Studio").
- **Risk:** med (many nested selectors). **Verify:** all 5 groups render, active indicator tracks route, collapse works.

## `.status-bar`
- **Current:** hardcoded light strip.
- **Target:** glass strip, tokened chips, live pulse dot when Ready.
- **Files:** `global.css` `.status-bar`, `.status-chip(.ok/.warn/.neutral)`; markup unchanged (`StatusBar.tsx`).
- **Risk:** low. **Verify:** chips reflect offline status tone; pulse animates.

## `.work-panel`
- **Current:** tokened surface, blue left-border accent, flat.
- **Target:** radius 20, hairline, soft shadow, header divider, optional tabs/badge slot; drop the fixed 5px blue left border in favor of subtle top or none.
- **Files:** `global.css` `.work-panel`, `.section-heading`, `.page-grid`.
- **Risk:** med (reused by Reports). **Verify:** Reports + Dashboard panels both upgrade cleanly.

## `.metric-card`
- **Current:** flat border/shadow, blue left border.
- **Target:** gradient top-line, hover lift + accent border + float shadow, tokened value/delta, sparkline slot.
- **Files:** `global.css` `.metric-card`, `.metric-card-{success,warning,danger,trend}`.
- **Risk:** low-med. **Verify:** Dashboard + Reports metric strips render; success/warn/danger variants correct.

## `.section-heading` / `.page-grid`
- Tokenize text + gaps; keep grid template. **Risk:** low.

## Buttons
- `.toolbar-button`, `.toolbar-button.primary`, `.icon-button`, generic `button`: primary=gradient+glow, ghost=soft+hairline, danger tint, disabled 55%. **Files:** `global.css`. **Verify:** every page's action buttons.

## Inputs / selects / textareas
- Inset surface, hairline, 12px radius, 38px, purple focus ring. **Files:** `global.css` input/select/textarea rules. **Verify:** Settings, DataSource editor, Node/Connector properties forms.

## Checkboxes / toggles
- `accent-color: var(--awkit-purple)` for native; pill switch styling where custom. **Verify:** Settings toggles, canvas options.

## Tabs
- Segmented container (inset) + sliding active pill (soft surface + shadow). **Files:** tab classes in `global.css`. **Verify:** Reports sub-tabs, panel tabs.

## Cards / tables / badges / toolbars
- Cards: token surface+radius+shadow. Tables: muted header, hairline rows, hover soft, badge status cells. Badges: `*-soft` bg + colored text + dot; `.live` pulse. Toolbars (canvas/floating): glass. **Verify:** Instances table, Reports tables, canvas toolbars.

## Modals / alerts / toasts
- Modal: glass card + scrim + scale/fade. Alert: tinted inline banner by status. Toast: glass, slide+fade, auto-dismiss. **Verify:** any confirm dialogs, error banners.

## Skeleton / loading
- Keep shimmer, retune gradient to dark surfaces; add skeleton variants for card/table/canvas. **Verify:** initial loads show dark shimmer, not white.
