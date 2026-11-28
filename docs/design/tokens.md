# Design tokens: Midnight Engineering Lab (milestone 6, implemented)

The maintainer chose the direction **Midnight Engineering Lab**: a calm, dark, education-first engineering workstation. It replaces the light "Drawing sheet" proposal that `directions.md` recommended. `directions.md` and `ui-audit.md` stay as the record of how the redesign was reasoned; this file is the system that is now implemented.

Every value below is a CSS custom property in `style.css` `:root`. The canvas reads the same properties once at start-up (`readPalette()` in `script.js`, section 7), so each colour has exactly one source. Semantic tokens come first; components only use tokens.

## Plan, and the review against generic defaults

- **Colour.** Room `#101722`, workspace (canvas) `#151F2C`, panels `#1C2938`, inputs `#202D3D`, rules `#2B394A`; ink `#E6EDF5` / `#9BAABD`; accent `#58C7E8` (cyan), secondary muted teal `#5FB8AB`.
- **Type.** IBM Plex Sans for the interface and for equations; IBM Plex Mono for matrix entries, IDs and numeric values. Sizes 12, 13, 14, 15, 18 and 22 px.
- **Layout.** A compact header (brand, Learn / Analyze / Design, Guided / Technical, File, Export); a context bar above the canvas that states what is analysed and the verdict; a tool rail; the canvas in the middle; a workspace panel on the left and the Inspector and Results on the right; a data drawer that is closed by default.
- **Principles.** The structure is the hero. Chrome is quiet: hierarchy from space and type, thin rules, one overlay shadow. Every colour means one thing and is paired with a second cue. Explanations sit next to the number they explain.

Reviewed against the generic defaults that `frontend-design` lists:
- *Near-black with one acid accent* (default 2): the room is a blue slate (`#101722`), not tinted black, and the cyan accent is reserved for interaction (active workspace, primary action, focus). Data colours do not reuse it.
- *SaaS card kit* (default 4): there are no cards around groups. Panels are separated by rules; elevation (one shadow) is used only for overlays (menus, popovers, the tool options, the dialog).
- *Template chrome* (default 5): no ALL-CAPS eyebrows (only the alarm word "UNSTABLE"), no middle-dot strings in the interface (the `·` left in the code is the multiplication dot of formulas such as ρ·A·L·g), no "→" on buttons. Monospace is used for data (numbers, matrices, IDs), never for labels or prose.
- *Glow, gradients, glass*: none. The only colour ramp is the force legend.

## 1. Colour

### Surfaces and ink
| Token | Value | Use |
|---|---|---|
| `--bg-app` | `#101722` | header, rail, status bar |
| `--bg-workspace` | `#151F2C` | the canvas |
| `--surface-1` | `#1C2938` | panels, overlays |
| `--surface-2` | `#202D3D` | inputs, table headers |
| `--surface-3` | `#27364A` | hover |
| `--border` | `#2B394A` | rules between regions and rows (decorative aid) |
| `--border-strong` | `#3E5168` | control outlines |
| `--text-1` | `#E6EDF5` | body text, values |
| `--text-2` | `#9BAABD` | labels, secondary text |
| `--text-3` | `#909FB4` | units, captions; the faintest readable ink (4.56:1 even on a hovered row) |
| `--text-disabled` | `#6E7D90` | disabled controls |

### Interaction and status
| Token | Value | Use | Paired cue |
|---|---|---|---|
| `--accent` / `--focus` | `#58C7E8` | active workspace, primary button, focus ring | position, underline |
| `--accent-2` | `#5FB8AB` | learning cues: explanations, current step, prediction choices | the "Why" disclosure |
| `--selection` | `#B9A1FF` | selected nodes, members and rows; hover (dashed, lighter) | halo width, dashed hover |
| `--ok` | `#6CCB8F` | solved, within limits | ✓ |
| `--warn` | `#E8B04B` | below the target SF, warnings, stale results | ! |
| `--error` | `#F27A76` | unstable, cannot analyse, failed | ✕ |

### Structural meaning (canvas and tables)
| Token | Value | Meaning | Paired cue |
|---|---|---|---|
| `--tension` | `#6E9CFF` | tension | "+" in labels and the legend, "T" in tables |
| `--compression` | `#FF9466` | compression | "−" (U+2212), "C", a heavier line (3.8 px against 3.2 px) |
| `--zero` | `#8C99AB` | zero force | dashed line |
| `--failure` | `#F47AD6` | yielded or buckled member; the mechanism mode | halo and a ✕ badge; the mode is dashed |
| `--member` | `#C3CEDB` | a member without results | solid |
| `--ghost` | `#6B7E95` | the undeformed shape under the deformed one | thin dashed line |
| `--load` | `#E6EDF5` | applied load | filled arrowhead, value label |
| `--reaction` | `#4FD1B5` | support reaction | open arrowhead, "R" label |
| `--support` | `#9BAABD` | support symbols | the symbol |
| `--settlement` | `#5FB8AB` | custom supports and settlements | δ mark |
| `--grid-minor`, `--grid-major`, `--axis` | `#19232F`, `#223042`, `#33465E` | grid and axes (decorative aids) | |
| `--grid-label` | `#909FB4` | grid numbers | |

## 2. Contrast (WCAG 2.2 relative luminance, computed)

| Foreground | on `--bg-app` | on `--bg-workspace` | on `--surface-1` | on `--surface-2` | Needed |
|---|---|---|---|---|---|
| `--text-1` | 15.24 | 14.08 | 12.50 | 11.83 | 4.5 |
| `--text-2` | 7.60 | 7.02 | 6.24 | 5.90 | 4.5 |
| `--text-3` | 6.68 | 6.17 | 5.48 | 5.19 | 4.5 (4.56 on `--surface-3`) |
| `--accent` | 9.21 | 8.50 | 7.55 | 7.15 | 3 (component), 4.5 (text) |
| `--accent-2` | 7.65 | 7.06 | 6.27 | 5.94 | 4.5 |
| `--ok` | 9.06 | 8.37 | 7.43 | 7.03 | 4.5 |
| `--warn` | 9.20 | 8.50 | 7.55 | 7.14 | 4.5 |
| `--error` | 6.70 | 6.19 | 5.49 | 5.20 | 4.5 |
| `--tension` | 6.73 | 6.22 | 5.52 | 5.23 | 3 (graphic) |
| `--compression` | 8.29 | 7.66 | 6.80 | 6.44 | 3 |
| `--zero` | 6.22 | 5.74 | 5.10 | 4.83 | 3 |
| `--failure` | 7.37 | 6.80 | 6.04 | 5.72 | 3 |
| `--selection` | 8.23 | 7.60 | 6.75 | 6.39 | 3 |
| `--reaction` | 9.52 | 8.80 | 7.81 | 7.39 | 3 |
| `--member` | 11.28 | 10.42 | 9.25 | 8.76 | 3 |
| `--ghost` | — | 3.99 | — | — | 3 |
| `--grid-label` | 6.68 | 6.17 | 5.48 | 5.19 | 4.5 |
| text on `--accent` (`#0E1A24`) | | | | | 9.02 |

Tension and compression differ mostly in hue (luminance ratio 1.23), so each has a second cue (sign, letter, line weight). Failure never relies on colour: it has a halo and a ✕ badge on the canvas and the ✕ icon in the chrome.

## 3. Typography

- `--font-ui`: `"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Bundled in `fonts/` (SIL OFL 1.1, `fonts/OFL.txt`), weights 400, 500 and 600, subsets Latin-1, Pi (arrows, math symbols, primes, sub- and superscript digits) and Greek, loaded with `unicode-range` from relative paths.
- `--font-mono`: `"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`, weights 400 and 500, Latin-1 and Pi. **Plex Mono has no Greek letters except π**, so equations (σ = N/A, ε = δ/L, λ, γ) are set in Plex Sans with tabular figures; monospace is used for numbers in tables and key-value lists, matrix entries and IDs.
- Steps: 12 px captions (the minimum anywhere), 13 px body, 14 px values, 15 px headings, 18 px panel titles, 22 px display. Sentence case everywhere. `font-variant-numeric: tabular-nums` on the body.

## 4. Space, shape, depth, motion

- Space: 4, 8, 12, 16, 24, 32 px (`--sp-1` to `--sp-6`).
- Radii: `--radius-control` 6 px (buttons, inputs, segmented controls), `--radius-overlay` 8 px (menus, popovers, the dialog, canvas plates). Panels have none.
- Elevation: `--shadow-overlay` only, on overlays.
- Motion: `--motion-fast` 120 ms for disclosure. With `prefers-reduced-motion: reduce` every transition is off, the solve animation is skipped and a mechanism mode is drawn static at full amplitude.

## 5. Components

- **Buttons**: secondary by default; one primary (accent) per context; quiet (icon) buttons in the header and rail; danger text for Delete.
- **Segmented controls and toggles**: `aria-pressed`, an accent underline when on.
- **Tabs** (workspaces, Inspector/Results, the data drawer): `role="tab"`, `aria-selected`, roving `tabindex`, arrow keys, Home and End.
- **Sections** in panels: `<details class="sec">` with a 15 px summary; no boxes.
- **Explanations**: `<details class="explain">` with a teal rule, open in Guided mode and closed in Technical mode.
- **Equations and worked calculations**: `.equation`, `.calc` (numbered steps), `table.vars` (symbol, meaning, value with unit).
- **Status**: a sentence, an icon and a status colour; status lines use a tinted background and a 3 px left rule, never a full coloured border.
- **Numbers**: a unit on every value; U+2212 for minus; "—" where there is no result.

## 6. Layout and breakpoints

| Width | Layout |
|---|---|
| > 1100 px | header, context bar, rail, canvas, left workspace panel (320 px), right panel (360 px), drawer |
| ≤ 1100 px | one side panel at a time, drawn over the canvas (the panels button cycles left, right, none) |
| ≤ 640 px | **phones, view-only**: the page scrolls; header with the three workspaces; the canvas (56 % of the height) with select and pan only; the Inspector and Results, then the workspace panel, stacked below; no rail, tool options, drawer or status bar; every edit is refused with a message |
| `pointer: coarse` | controls at least 36 px high, tools 44 px |
