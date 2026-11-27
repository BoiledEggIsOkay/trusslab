# Design tokens (milestone 6, step 4): Direction A, Drawing sheet

The token system for the recommended direction (`directions.md`). It is a proposal: nothing in `style.css` or `script.js` changes until a direction is approved. Once approved, these become CSS custom properties in `style.css` `:root`, and the canvas reads them once at start-up with `getComputedStyle(document.documentElement)`, so `COL` in `script.js` disappears and every colour has one source.

Naming: semantic tokens first (`--color-tension`), component tokens second (`--button-primary-bg`), and components only ever use tokens.

## 1. Colour

### Surfaces and ink
| Token | Value | Use |
|---|---|---|
| `--surface-sheet` | `#F4F5F6` | the canvas (the drawing sheet) |
| `--surface-panel` | `#FFFFFF` | title block, context panel, drawer, menus |
| `--surface-sunken` | `#ECEEF0` | inputs, table headers, the drawer bar |
| `--ink-1` | `#1A1D21` | body text, values, member linework, load arrows |
| `--ink-2` | `#474E57` | secondary text, labels |
| `--ink-3` | `#646B74` | units, captions, the HUD and axis labels |
| `--ink-disabled` | `#8D949C` | disabled labels |
| `--rule` | `#D9DDE2` | separators between real regions (rail, panel, drawer, table rows) |

### Structural meaning (canvas and results)
Each meaning has one colour and one shape, so colour is never the only cue.

| Token | Value | Meaning | Paired cue |
|---|---|---|---|
| `--color-tension` | `#1D5FC4` | tension | the sign "+" in labels; "T" in tables |
| `--color-compression` | `#C2382B` | compression | the sign "−" (U+2212); "C"; a slightly heavier line (+0.5 px) |
| `--color-zero` | `#6E757E` | zero force | dashed line (as now) |
| `--color-member` | `#2B3138` | a member before analysis, or with no results | solid ink line |
| `--color-ghost` | `#80878F` | the undeformed shape under the deformed one | thin dashed line |
| `--color-load` | `#1A1D21` | nodal load | heavy filled arrowhead, value label |
| `--color-reaction` | `#0C7470` | support reaction | open arrowhead, value label |
| `--color-support` | `#474E57` | support symbols | the symbol itself |
| `--color-failure` | `#B0136E` | yielded or buckled member; unstable mode shape | 4 px halo and a ✕ badge; mode drawn dashed |

The force colour scale in the legend runs from `--color-compression` through `--color-zero` to `--color-tension`, interpolated in OKLab rather than sRGB, so the midpoint does not turn muddy.

### Status and feedback (chrome)
| Token | Value | Use | Paired cue |
|---|---|---|---|
| `--color-ok` | `#25733A` | solved, all members within limits | ✓ |
| `--color-warning` | `#8A5A00` | below target SF, warnings, stale results | ! |
| `--color-error` | `#B0136E` (= failure) | failed members, unstable, cannot analyse | ✕ |
| `--tint-ok`, `--tint-warning`, `--tint-error` | the status colour at 8 % on `--surface-panel` | the background of a status line or note | |

### Interaction
| Token | Value | Use |
|---|---|---|
| `--color-selection` | `#6A3FD1` | selected members and nodes (canvas), selected rows (tables, lists) |
| `--color-hover` | `#6A3FD1`, drawn as a 1 px dashed outline | hover on the canvas and in lists (selection is solid and 2 px) |
| `--color-focus` | `#1D5FC4` | the focus ring: 2 px solid, 2 px offset |
| `--tint-selection` | `#6A3FD1` at 10 % | the background of selected rows |
| `--color-grid-minor` | `#E4E7EA` | minor grid lines (decorative aid) |
| `--color-grid-major` | `#C9CED4` | major grid lines and the axes (decorative aid) |

### Component tokens
| Token | Value |
|---|---|
| `--button-primary-bg` / `--button-primary-ink` | `--ink-1` / `#FFFFFF` (one primary action per context) |
| `--button-secondary-bg` / `--button-secondary-ink` / `--button-secondary-rule` | `--surface-panel` / `--ink-1` / `--rule` |
| `--button-quiet-ink` | `--ink-2` (icon buttons, rail tools); `--ink-1` on hover |
| `--button-danger-ink` | `--color-error` (Delete), on a secondary button |
| `--tool-active-bg` / `--tool-active-ink` | `--surface-sunken` / `--ink-1`, plus a 2 px `--ink-1` bar on the rail edge |
| `--input-bg` / `--input-rule` / `--input-rule-focus` | `--surface-sunken` / `transparent` / `--color-focus` |
| `--tab-ink` / `--tab-active-ink` / `--tab-active-rule` | `--ink-2` / `--ink-1` / 2 px `--ink-1` underline |
| `--panel-rule` | `--rule` (1 px) between the panel and the canvas |
| `--banner-bg` | `--tint-error` or `--surface-panel`, with a 3 px left rule in the status colour |

## 2. Contrast

Computed with the WCAG 2.2 relative-luminance formula. Text needs 4.5:1. Interface components and meaningful graphics (members, arrows, the focus ring, selection) need 3:1. Grid lines and separators are decorative aids: nothing can only be read through them, so they are exempt.

| Foreground | Background | Use | Ratio | Needed |
|---|---|---|---|---|
| `--ink-1` #1A1D21 | `--surface-panel` #FFFFFF | body text | 16.91:1 | 4.5:1 |
| `--ink-1` #1A1D21 | `--surface-sheet` #F4F5F6 | canvas labels | 15.49:1 | 4.5:1 |
| `--ink-1` #1A1D21 | `--surface-sunken` #ECEEF0 | text in inputs and table headers | 14.54:1 | 4.5:1 |
| `--ink-2` #474E57 | `--surface-panel` #FFFFFF | secondary text | 8.42:1 | 4.5:1 |
| `--ink-2` #474E57 | `--surface-sunken` #ECEEF0 | secondary text in inputs | 7.24:1 | 4.5:1 |
| `--ink-3` #646B74 | `--surface-panel` #FFFFFF | tertiary text, units | 5.39:1 | 4.5:1 |
| `--ink-3` #646B74 | `--surface-sheet` #F4F5F6 | HUD and axis labels | 4.94:1 | 4.5:1 |
| `--ink-3` #646B74 | `--surface-sunken` #ECEEF0 | placeholders | 4.63:1 | 4.5:1 |
| `--ink-disabled` #8D949C | `--surface-panel` #FFFFFF | disabled text (exempt; kept ≥ 3) | 3.07:1 | 3:1 |
| `--color-ok` #25733A | `--surface-panel` #FFFFFF | status text with ✓ | 5.85:1 | 4.5:1 |
| `--color-warning` #8A5A00 | `--surface-panel` #FFFFFF | warning text with ! | 5.93:1 | 4.5:1 |
| `--color-failure` #B0136E | `--surface-panel` #FFFFFF | failure text with ✕ | 6.64:1 | 4.5:1 |
| `--color-selection` #6A3FD1 | `--surface-panel` #FFFFFF | selected row text | 6.47:1 | 4.5:1 |
| `#FFFFFF` #FFFFFF | `--ink-1` #1A1D21 | primary button label | 16.91:1 | 4.5:1 |
| `--color-tension` #1D5FC4 | `--surface-sheet` #F4F5F6 | tension member | 5.52:1 | 3:1 |
| `--color-compression` #C2382B | `--surface-sheet` #F4F5F6 | compression member | 4.94:1 | 3:1 |
| `--color-zero` #6E757E | `--surface-sheet` #F4F5F6 | zero-force member (dashed) | 4.27:1 | 3:1 |
| `--color-member` #2B3138 | `--surface-sheet` #F4F5F6 | unsolved member | 12.03:1 | 3:1 |
| `--color-ghost` #80878F | `--surface-sheet` #F4F5F6 | undeformed shape under the deformed one | 3.33:1 | 3:1 |
| `--color-selection` #6A3FD1 | `--surface-sheet` #F4F5F6 | selection | 5.93:1 | 3:1 |
| `--color-load` #1A1D21 | `--surface-sheet` #F4F5F6 | load arrow | 15.49:1 | 3:1 |
| `--color-reaction` #0C7470 | `--surface-sheet` #F4F5F6 | reaction arrow | 5.13:1 | 3:1 |
| `--color-failure` #B0136E | `--surface-sheet` #F4F5F6 | failure halo | 6.08:1 | 3:1 |
| `--color-focus` #1D5FC4 | `--surface-panel` #FFFFFF | focus ring | 6.02:1 | 3:1 |
| `--color-focus` #1D5FC4 | `--surface-sheet` #F4F5F6 | focus ring on canvas | 5.52:1 | 3:1 |
| `--color-grid-major` #C9CED4 | `--surface-sheet` #F4F5F6 | major grid line (decorative aid, exempt) | 1.45:1 | — |
| `--color-grid-minor` #E4E7EA | `--surface-sheet` #F4F5F6 | minor grid line (decorative aid, exempt) | 1.14:1 | — |
| `--rule` #D9DDE2 | `--surface-panel` #FFFFFF | separator (exempt) | 1.36:1 | — |

Pairs that hue alone separates (luminance ratio): tension/compression 1.12, compression/failure 1.23, selection/tension 1.07

Tension and compression differ mainly in hue (luminance ratio 1.12), as do compression and failure (1.23). That is why each carries a second cue: a sign and a letter for tension and compression, and a halo with a ✕ for failure. The blue and red pair stays distinguishable in the common forms of colour-vision deficiency (protanopia, deuteranopia), and the cues cover the rest.

## 3. Typography

| Token | Value |
|---|---|
| `--font-ui` | `"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Plex is bundled only after its licence (SIL OFL 1.1) is committed beside it and its `file://` loading is verified in Chrome, Safari and Firefox; until then the system stack applies |
| `--font-matrix` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace`, for the matrix view only |
| `--numerals` | `font-variant-numeric: tabular-nums` on every number: tables, the Inspector, the title block, the legend and canvas labels |

| Step | Size / line height | Weight | Use |
|---|---|---|---|
| `--type-caption` | 12 / 16 px | 400 | units, captions, the drawer bar, canvas labels at small zoom; the minimum anywhere |
| `--type-body` | 13 / 18 px | 400 | panel text, tables, form labels |
| `--type-value` | 14 / 20 px | 500 | values in the Inspector and the title block |
| `--type-heading` | 16 / 22 px | 600 | the panel heading (for example "Member M3") |
| `--type-display` | 20 / 26 px | 600 | the verdict on a narrow screen; the empty-state steps |

- Sentence case everywhere; no ALL CAPS, no letter-spacing on labels.
- No middle-dot separators: use space, a column or a line break.
- Headings in panels are set in `--type-heading` with space above, with no rule after them (today's `.sub-h::after` line goes).

## 4. Spacing

A 4 px base: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24, `--space-6` 32 px.
- Hierarchy comes from space: 24 px between groups in a panel, 8 px between a label and its value, 4 px inside compact controls.
- Targets are at least 24 × 24 px; rail tools are 40 × 40 px.

## 5. Borders, separators and radii

- Separators are 1 px `--rule`, and only between regions or table rows. There are no boxes around groups and no cards.
- Radii: `--radius-control` 4 px (buttons, inputs, segmented controls), `--radius-overlay` 6 px (menus, popovers, the Help sheet), 0 for panels and the drawer. That is three values instead of today's eight.
- Focus: `outline: 2px solid var(--color-focus); outline-offset: 2px` on `:focus-visible`, never removed.

## 6. Elevation

Elevation is for overlays only (menus, the View popover, the Help sheet, toasts): one shadow, `--shadow-overlay: 0 4px 16px rgb(26 29 33 / 0.14)`. Panels, the rail and the drawer are flat, separated by rules. There are no gradients, and the legend scale is the only colour ramp.

## 7. Motion

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 120 ms ease-out | disclosure (drawer, popovers, tabs) |
| `--motion-solve` | 450 ms ease-out | the solve animation (load growing to its value), optional |
| `--motion-mode` | 1.6 s, repeating | the mechanism mode animation |

With `prefers-reduced-motion: reduce`, every duration is 0. The mechanism mode is then drawn static at full amplitude together with the undeformed shape, and the solve animation is skipped.

## 8. States

| State | Canvas | Lists and tables | Controls |
|---|---|---|---|
| Hover | 1 px dashed `--color-selection` outline; a tooltip with the value | `--surface-sunken` row | `--ink-1` text |
| Selected | 2 px solid `--color-selection` and handles | `--tint-selection` row, 2 px left bar | n/a |
| Focus | focus ring around the canvas; the keyboard-selected item is outlined | focus ring on the row | focus ring |
| Disabled | n/a | n/a | `--ink-disabled` text, no fill, `cursor: default` |
| Stale (Live off) | member colours kept but desaturated 60 %, with "Results out of date" in the title block | numbers replaced by "—" | Solve becomes the primary button |
| Unstable | members in `--color-member`, the mode in `--color-failure`, dashed; no labels with numbers | "—" | n/a |

## 9. Warnings and errors

- A message is an icon, a status colour and a sentence. The sentence says what is wrong and what to do ("Node N4 can move sideways: add a member or a support there.").
- Placement:
  - Inline next to the field or object it concerns: the Inspector and the Results list, with a link that selects the object.
  - One banner on the canvas, only for the empty model and the unstable structure.
  - A toast only to confirm an action (Added, Deleted), at least 4 s, with any refusal also written inline.
- Status lines use the tint background and a 3 px left rule, not a full border.

## 10. Numbers

- Every value has a unit (kN, MPa, mm) in `--ink-3` after the number. The unit is chosen once (title block, View popover) and used everywhere.
- Significant digits are consistent per quantity (the current "Digits" setting), with U+2212 for minus (as `fmt` does) and ∞ for an unloaded member's SF.
- In tables, numbers are right-aligned with tabular figures, and the headers name the unit: "F [kN]".
- Sign convention: tension is positive, shown once in the legend ("+ tension") and in the column header tooltip.
- No numbers for unstable, invalid or stale results: "—" in their place.

## 11. From today's tokens

| Today (`style.css` / `COL`) | Proposed |
|---|---|
| `--bg #0a0e14`, `--canvas #0b1118`, `COL.bg` | `--surface-sheet` |
| `--panel`, `--panel-2`, `--panel-3` | `--surface-panel`, `--surface-sunken` |
| `--line`, `--line-2` | `--rule` |
| `--text`, `--muted`, `--dim` (3.36:1, too low for text) | `--ink-1`, `--ink-2`, `--ink-3` (5.39:1) |
| `--accent #38bdf8` (active tool, tab, focus, hover) | `--ink-1` for active states, `--color-focus` for focus, `--color-selection` for hover |
| `--ok`, `--warn`, `--bad` | `--color-ok`, `--color-warning`, `--color-error` |
| `--tension`, `--compression`, `--zero`, `COL.tension/compression/zero` | `--color-tension`, `--color-compression`, `--color-zero` |
| `--load`, `COL.load` (amber, also selection and warning) | `--color-load` (ink) |
| `--reaction`, `COL.reaction` (green, also ok) | `--color-reaction` (teal) |
| `COL.sel` (amber), `COL.hover` (cyan), `COL.mech` (amber), `COL.fail` | `--color-selection`, `--color-hover`, `--color-failure` |
| `COL.member`, `COL.ghost`, `COL.node`, `COL.support`, `COL.custom` | `--color-member`, `--color-ghost`, `--ink-1`, `--color-support`, `--color-support` |
| `COL.gridMinor`, `COL.gridMajor`, `COL.axis`, `COL.gridText` (2.74:1) | `--color-grid-minor`, `--color-grid-major`, `--ink-3` (4.94:1) |
| `--mono` in 24 rules | `--font-matrix` in the matrix view only |
| font sizes 9 to 16 px (39 declarations below 12 px) | the five steps above, 12 px minimum |
| 8 radius values, 10 shadows, 4 gradients | 3 radii, 1 overlay shadow, 1 ramp (the legend) |

## 12. A dark variant

Not part of this proposal. If one is wanted for dark rooms, it is the same semantic set with new values (Direction C's palette is a starting point), switched by one attribute on `<html>`. Because the canvas reads the tokens, it follows automatically. Its contrast table is computed in the same way before it ships.
