---
name: trusslab-ui-design
description: How to design and change the TrussLab user interface, covering information architecture, visual hierarchy, layout, typography, colour and design tokens, interaction and progressive disclosure for beginners and experienced engineers, educational explanations and demonstrations, accessibility, keyboard navigation and responsive behaviour, all within the plain HTML, CSS and classic-JavaScript architecture. It builds on the vendored frontend-design skill and takes precedence over it for TrussLab. Use it before any change to index.html, style.css or the page-facing parts of script.js, for the UI/UX redesign milestone, for audits, wireframes, mockups or design tokens, for any educational interface, and whenever the user says the interface feels cluttered, confusing, inconsistent, generic or AI-generated, even for a small visual tweak.
---

# TrussLab UI design

TrussLab is professional engineering software that also teaches. Good design here means that a beginner can see what to do next and an engineer can read a result at a glance. Anything that does neither is noise. The maintainer finds the current interface overly complicated and generic-looking, "AI-generated". The goal is a deliberate, quiet, consistent tool, not more styling.

## How this skill relates to `frontend-design`

Read `.claude/skills/frontend-design/SKILL.md` first, then apply it through this skill:
- Use its process: ground the design in the subject, write a compact token plan (colour, type, layout, principles), review the plan against the brief and against its list of generic defaults, build, then critique with screenshots. Its writing guidance applies in full.
- Translate it from web pages to an application. The "hero" is the structure on the canvas. Spend the boldness on the structural visualisation (force colouring, the deformed shape, the mechanism mode) and keep the chrome around it quiet.
- Where it conflicts with TrussLab, this skill wins:
  - **Fonts.** No remotely hosted fonts. Use system font stacks, or bundled font files only if their licence allows redistribution (for example SIL OFL), the licence is committed with them, and they are verified to load from a double-clicked `file://` page in Chrome, Safari and Firefox.
  - **Density.** Dense tables and matrices are legitimate here when they carry data. Make dense views orderly; don't remove them.

## Users and their jobs

| User | Main job | Needs |
|---|---|---|
| Beginner | Understand forces, supports, stability, why triangles | A clear next step, plain language, safe defaults, explanations next to results |
| Student | Build, predict, analyse, check by hand | Free-body diagrams, equations with real numbers, comparison with the solver |
| Experienced engineer | Model quickly, read results, export | Keyboard entry, exact values, dense tables, matrices, diagnostics |
| Teacher | Demonstrate in class | Legible from a distance, stable layout, step-by-step reveals |

The default view serves the beginner's next step. Expert depth is always one action away, never removed.

## Principles

1. **The structure is the interface.** The canvas is the largest and most central element. Show results on the structure first (colour, labels, the deformed shape) and in tables second.
2. **Progressive disclosure, in three levels.** Glance: status, colours, the critical member. Inspect: select something and see its numbers and its explanation. Dig: matrices, the solver log, diagnostics. Collapse advanced controls; never delete them.
3. **One primary action per context.** Each view has one obvious thing to do next. Everything else is visibly secondary.
4. **Numbers are the content.**
   - Put a unit on every value, and use consistent significant digits per quantity.
   - Use tabular figures (`font-variant-numeric: tabular-nums`) in the UI face, right-aligned or decimal-aligned in columns, rather than monospace everywhere.
   - Keep the sign convention visible (tension positive) and the real minus sign (U+2212, as `fmt` does).
   - Never show numbers for unstable, invalid or stale results.
5. **Colour carries meaning, never decoration.** Reserve one colour per meaning (tension, compression, zero force, failure, warning, selection, hover, load, reaction). Never let one colour mean two things, and never use colour alone: pair it with a sign, a label or a line pattern (zero-force members are already dashed).
6. **One source of truth for every value and setting.**
   - Every colour, type size, space, radius and shadow comes from a design token.
   - Every setting changes through one function, whatever control triggers it. The D/G shortcut bugs (Rev 3) came from a shortcut and a checkbox that duplicated each other's logic.
7. **Honest visuals.** Follow `trusslab-engineering-rules`, `references/design-conventions.md` §6: label the scale factor, no "travelling load" animations, show assumptions next to results.
8. **Quiet chrome.** Avoid the generic defaults that `frontend-design` lists. Several are present in TrussLab today (see below).

## Observations about the current UI (as of `0e3dbae`)

These are starting points for the redesign audit, not the audit itself:
- **Upstream default #2:** a near-black tinted background (`--bg: #0a0e14`, canvas `#0b1118`) with a single bright cyan accent (`--accent: #38bdf8`).
- **Upstream defaults #5:**
  - ALL-CAPS, letter-spaced labels (`.sub-h`, `.menu-h`, panel summaries, card headers, help headings);
  - 62 middle-dot (`·`) strings, 10 in `index.html` and 52 in `script.js`;
  - monospace in 23 places in `style.css`, for numeric data (number inputs, the data and matrix tables, result values) as well as for labels, status text and the HUD.
- **Small text:** 39 font declarations below 12 px, with sizes of 9, 10, 10.5, 11 and 11.5 px.
- **Everything visible at once:** 11 controls in the top bar (plus 6 items in the Export menu), all 5 left-panel sections open by default, 2 right-panel cards, 4 bottom tabs, plus a banner, a legend, a HUD and tooltips over the canvas.
- **Colour collisions:**
  - amber `#fbbf24` means selection, load, warning and mechanism;
  - green `#34d399` means both "ok" and reaction.
- **Duplicated palette:** the canvas palette is hard-coded in `script.js` (`COL`), separately from the CSS variables.
- **Mixed left panel:** model definition (materials, sections), view settings, analysis settings and display options all share it.
- **Tabs:** the bottom tabs have `role="tab"` but no `aria-selected`.

## Information architecture: hypotheses to test in the redesign

- **Learn, Analyze and Design as modes over one model and one engine,** not separate applications. A mode changes what is shown and which actions are offered, never the data.
- **The workspace:** the canvas in the centre, a contextual panel for the current selection, a results and data area, and as few global controls as possible.
- **Separate what is mixed today:** model definition, analysis settings, view settings and results.

These are hypotheses for the audit to confirm or reject, not decisions.

## Architecture constraints for UI work

- Plain HTML, CSS and classic scripts only: no frameworks, no CSS preprocessors, no icon fonts, no remote assets. Icons are inline SVG, as now. See `trusslab-architecture`.
- **Tokens** are CSS custom properties in `style.css` `:root`. Use semantic names first (`--color-tension`), then component use. The canvas reads the same tokens once at start-up (`getComputedStyle(document.documentElement)`) instead of keeping its own copy.
- UI code stays in the matching `script.js` section; DOM-free logic goes elsewhere.
- **The smoke-test contract.** `test/browser-smoke.js` relies on these names and words. Renaming or rewording any of them requires updating the test in the same change:
  - ids: `#app`, `#canvas`, `#banner`, `#legend`, `#statusPill`, `#health`, `#inspector`, `#insResults`, `#leftPanel`, `#rightPanel`, `#btnExport`, `#exportMenu`, `#btnFit`, `#btnPanels`, `#btnUndo`, `#btnRedo`, `#chkLive`, `#chkSnap`, `#chkSnapNodes`, `#rngLoadFactor`, `#numLoadFactor`, `#selExample`, `#selForceUnit`, `#fileInput`, `#groupsList`, `#helpModal`, `#logText`, `#mtxView`, `#sbCounts`, `#sbSnap`, `#segGrid`, `#segMatrix`, `#segMtxMode`, `#tab-members`, `#tab-nodes`, `#tab-matrix`, `#toolOptions`, `#toX`, `#toFx`, `#toFy`, `#toGroup`, `#toLoadMode`, `#toSupType`, and from milestone 3 `#selLoadCase`, `#btnAddCase`, `#txtCaseName`, `#btnDeleteCase`, `#updateNotice`, `#btnDismissNotice`, `#sbSave`;
  - attributes and classes: `.tool[data-tool=…]`, `.tab[data-tab=…]`, `[data-show="showDeformed"]`, `[data-grid]`, `[data-mtx]`, `[data-mode]`, the class `on` for active buttons, `no-panels`, `show-left`, `show-right`, the Inspector fields `#inspector [data-f="stype"]`, `[data-f="sfixx"]`, `[data-f="sfixy"]`, and the `hidden` property of `#updateNotice` and `#sbSave`;
  - wording: "UNSTABLE" (status pill and health report), "Node N4" (Inspector title), "unstable" (Inspector note), "Analysis completed" (solver log), "Reduced" (matrix legend), "snap off" / "snap 0.5 m" (status bar), "N nodes" (status bar counts), "Load case 2" (the default name of a new case), "provides no restraint" (health report and Inspector), "scales nodal loads and prescribed support settlements alike" (the λ notice), "Changes not saved — browser storage unavailable" and "Saved. The old version 1 session could not be removed yet" (status bar, `#sbSave`), "Import notes" and "was not applied" (health report).

## Accessibility and keyboard: the quality floor

- WCAG 2.2 AA. Text contrast is at least 4.5:1 (3:1 for large text). Interface components and meaningful graphics, including member colours against the canvas and the focus ring, are at least 3:1.
- Every interactive element shows a visible focus indicator, the tab order follows the layout, there are no keyboard traps, and Esc closes overlays.
- Every canvas action has a non-pointer path: exact entry in the Inspector, connecting members by node number, the shortcuts. Keep these paths and extend them.
- Prefer native controls. Give custom widgets a role, a name and state (`aria-selected` on tabs, `aria-pressed` on toggle buttons, `aria-expanded` on menus).
- Targets are at least 24 × 24 CSS px (WCAG 2.5.8). Text stays usable at 200 % zoom. Body text is 13–14 px, and nothing is below 12 px.
- Respect `prefers-reduced-motion`. Replace the solve animation and the mechanism animation with a static display (for example, the mode shape drawn at full amplitude).
- Status changes are announced. The status pill already has `role="status"`.

## Responsive behaviour

- The canvas comes first at every width. At 920 px or less, one side panel is shown at a time (current behaviour).
- Review at fixed widths: 1440, 1280, 1024, 900 and 390 px. Decide explicitly what the phone width supports (for example, viewing and inspecting, but not full editing) instead of letting it degrade by accident.
- Pointer input already uses pointer events. Check hit targets for touch.

## Educational interface patterns

- Put the explanation next to the thing it explains, inline rather than in a modal. Give the formula, then the substitution with the real numbers from the result object.
- Plain words first, symbols second. A term links to its definition.
- **The predict, run, compare loop** needs clear states: prediction open, prediction locked, results revealed, differences explained.
- Demonstrations are driven by the real solver, never by a scripted imitation.
- Don't hide expert features from learners: let them grow into them.

## Process for the UI/UX redesign milestone

This is milestone 6 in `CLAUDE.md`. It comes after the engineering milestones 2 to 5 and before any educational interface. Do not start it, or change the current GUI, until the maintainer gives the go-ahead.

1. **Audit** the complete existing UI and write it up in `docs/design/ui-audit.md`. Cover every surface, control, state, flow and keyboard path, with the sources of unnecessary complexity identified and evidenced.
2. **Three distinct design directions** (`docs/design/directions.md`), each with:
   - a short brief;
   - a token plan in the `frontend-design` format;
   - wireframes of the main workspace, the selection state, the unstable state and the narrow layout;
   - how it handles Learn, Analyze and Design.

   Each direction must be a real alternative, not a variation in colour.
3. **Wireframes** as ASCII in Markdown, or as static SVG or HTML mock-ups in `docs/design/` that open by double-click, with no build step.
4. **A design-token system** (`docs/design/tokens.md`): colour (semantic and component), type scale, spacing, radii, elevation, motion, with contrast ratios for each pair of text and background.
5. **Approval.** Present the audit, the directions, the tokens and the wireframes. Change nothing in the GUI before the maintainer approves a direction.
6. **Implement incrementally**, one area per step: tokens first, then navigation and workspace, then panels, then the canvas. Each step needs:
   - before and after screenshots at the review widths;
   - both smoke-test modes;
   - `check.sh`;
   - a keyboard walk-through.

   The numerical engine and the application architecture stay unchanged.

Screenshots and visual review need a real browser. Report them only when they were actually taken, by you through a connected browser tool or by the maintainer. Otherwise list them as unverified and give the maintainer the steps (`docs/development/local-testing.md`).

## Checklist for any UI change

- It serves a named user and job from the table above.
- It uses existing tokens; any new value is added as a token, not inline.
- Every affected state is designed: empty model, no results yet, stale (Live off), solved, unstable, invalid model, no selection, one or several selected, hover, focus, disabled.
- There is a keyboard path, visible focus and sufficient contrast.
- The narrow layout (920 px or less) still works.
- The copy uses sentence case, plain verbs and units, with no filler, and one name per action throughout the flow.
- The smoke-test contract is kept or updated in the same change, and both smoke modes were run in a browser, or are listed as unverified.
- Screenshots exist before and after, or are listed as unverified.
