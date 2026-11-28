# TrussLab UI audit (milestone 6, step 1)

> **Status:** the audit of the interface before milestone 6. The redesign (Midnight Engineering Lab, `tokens.md`) addresses its findings; it is kept as the record of where the redesign started.

This is the audit that the redesign starts from. It covers every surface, control, state, flow and keyboard path of the interface as it stands after milestone 5 (load combinations), and names the sources of unnecessary complexity with evidence.

**How it was made.** No browser was available, so it was made by reading `index.html`, `style.css` and `script.js` and by measuring them with scripts, not from screenshots. Counts are exact for the source at the milestone 5 working tree, on top of `16d3fc9` (Rev 7). The screenshots that the `trusslab-ui-design` process asks for are still to be taken at 1440, 1280, 1024, 900 and 390 px; until then, anything about rendered size or overlap is inferred from the CSS and marked as such.

Users and jobs are those of `trusslab-ui-design`: beginner, student, experienced engineer, teacher.

## 1. What the interface is made of

```
┌ top bar ──────────────────────────────────────────────────────────────────────────────────┐
│ New Open… Save │ Examples… │ ↶ ↷ │ ▶ Solve  Live │ ● status pill │ Export ▾  ◫  ?          │
├ left panel (300 px) ─┬ tool strip: 6 tools │ tool options (changes per tool) │ − + Fit ─┬ right panel (340 px) ┐
│ ▸ Materials          │ λ notice (milestone 3, one-time)                                 │ INSPECTOR            │
│ ▸ Sections · groups  │                                                                  │  (selection form,    │
│ ▸ Grid & snapping    │                         canvas                                   │   results, notes)    │
│ ▸ Analysis           │   banner (top), legend (top right), HUD (bottom left), tooltip   │                      │
│ ▸ Display            │                                                                  │ CRITICAL HEALTH      │
│  (all 5 open)        ├──────────── splitter ────────────────────────────────────────────┤ REPORT               │
│                      │ Members │ Nodes & reactions │ Stiffness matrix inspector │ Log  ▾ │  (status, warnings,  │
│                      │ table / matrix / log (250 px)                                    │   combinations …)    │
├──────────────────────┴──────────────────────────────────────────────────────────────────┴──────────────────────┤
│ status bar: x, y │ snap │ tool hint ……………………………… save note │ N nodes · M members │ solve time            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
+ help dialog (6 sections), export menu (6 items), toasts (49 call sites)
```

| Region | Fixed controls | Generated content |
|---|---|---|
| Top bar | 15 buttons, 1 select, 2 inputs | status pill text |
| Left panel | 15 buttons, 5 selects, 18 inputs (12 checkboxes) in 5 sections, all open by default | material cards, section-group cards and editor, combination factors |
| Tool strip | 6 tools, zoom −/+, Fit | 0–8 tool-option fields per tool (`#toX`, `#toFx`, `#toGroup`, …) |
| Canvas | none | banner, legend, HUD, tooltip, λ notice |
| Bottom panel | 4 tabs, collapse; matrix view: 4 + 2 segmented buttons | tables, matrix, log |
| Right panel | none (2 cards) | Inspector forms, health report |
| Status bar | none | 6 readouts |

## 2. Surface by surface

### 2.1 Top bar
- **File actions** (New, Open…, Save) sit beside **Examples…**, Undo/Redo, **Solve** with **Live**, the status pill, **Export ▾**, the panels button and Help: 11 controls in one row, 4 visual groups.
- **Solve is the primary button**, but with Live on (the default) the model is already solved after every edit. The primary action of the most prominent bar is therefore redundant in the default state. It matters only with Live off, which few users need.
- **The status pill** repeats what the health report and the canvas banner say ("UNSTABLE: 1 mechanism mode", "Solved · all members safe · SF min 2.1"). It uses middle-dot strings.
- **Export ▾** mixes three kinds of output: reports, matrices, and the model file. Saving the model as a file is also **Save**, so the same job has two names in two places.
- **What is being analysed** (load case or combination, λ) is not in the top bar. It is in the fourth left-panel section, under Materials, Sections and Grid. The only other places it appears are the HUD and the health report.

### 2.2 Left panel: five open sections
| Section | What it really is | Job |
|---|---|---|
| Materials | model definition | engineer, student |
| Sections · member groups | model definition, plus "the group used for new members" (a tool setting) | engineer |
| Grid & snapping | drawing aids (tool settings) | everyone while drawing |
| Analysis | what is analysed (case or combination, λ), target SF, an assumptions note | everyone |
| Display | view settings: deformation scale, colour mode, 9 visibility toggles, units, digits | everyone, rarely |

- **Four different kinds of thing share one scrolling column**: model definition, tool settings, analysis state and view settings. The hypothesis in `trusslab-ui-design` is confirmed: they need different places.
- **All five sections are open by default.** On a 900 px-tall window the Analysis section, which holds what is analysed, starts below the fold once a model has three materials and two section groups (inferred from the CSS: each material card is about 70 px tall).
- **Analysis has grown with every milestone:** a case list, + New, a name field, Delete, + Self-weight case, + Combination, a combination's factor fields, λ slider and field, target SF, and a note. That is ten controls and two kinds of object (cases and combinations) in one block, with one name field and one Delete button acting on whichever is shown.
- **Display** has 9 checkboxes in a flat list ("Undeformed", "Deformed", "Loads", "Reactions", "Supports", "Node IDs", "Member IDs", "Force values", "Animate solve"). They are view settings of different importance: Deformed changes what results mean, Node IDs is cosmetic.
- **Section heading text** is set in ALL CAPS with letter-spacing (`.sub-h`, `.menu-h`, summaries), and "Sections · member groups" uses a middle dot.

### 2.3 Tool strip and tool options
- 6 tools with inline-SVG icons (Select V, Node N, Member M, Support S, Load L, Pan H). Labels are hidden below 1500 px (`.tool span { display: none }`), so the tools become icons only, with their letters in `title` tooltips.
- **Tool options change content per tool:** exact X/Y and "Add node" for Node; group and from/to for Member; support type for Support; Fx, Fy and a set/add/clear mode for Load. They are useful, but nothing marks them as belonging to the active tool except their position, and a long hint text follows them, cut off with an ellipsis on narrow windows.
- Zoom −, + and Fit sit at the far end of the same strip, away from the canvas they act on.

### 2.4 Canvas and its overlays
- **Four overlays share the canvas**: banner (top), legend (top right), HUD (bottom left), tooltip. The λ notice sits above it.
- **The HUD** stacks up to 5 lines in 11 px monospace: deflection scale, the analysed case or combination with its factors, incomplete self-weight, λ, δmax and SFmin. It is the only place on the canvas that names what is analysed.
- **The banner** is used for the empty model (a good next-step prompt), for an unstable structure (with Next mode) and for models that cannot be analysed. The same states also appear in the status pill and the health report.
- **Colour collisions on the canvas** (`COL` in `script.js`):
  - `#fbbf24` amber means selection, load and mechanism, and it is also `--warn` in the chrome;
  - `#34d399` green means reaction on the canvas and "ok" in the chrome;
  - `#38bdf8` cyan means hover on the canvas and the accent (active tool, active tab, focus border) in the chrome.
- **The palette is defined twice**: CSS variables in `style.css`, and a separate `COL` object in `script.js`. They agree today only because they were typed twice.
- Contrast on the canvas (computed, WCAG relative luminance): tension 5.16:1 and compression 5.04:1 against the canvas are fine; zero-force grey 3.92:1 is fine; **grid labels 2.74:1 are too low** for text.
- **What works and must be kept**: force colouring with the legend, zero-force members dashed, the deformed shape with its labelled scale, the animated mechanism mode with a written description, exact rotated supports drawn in their frame.

### 2.5 Bottom panel
- Four tabs: Members, Nodes & reactions, Stiffness matrix inspector, Solver log. Dense tables and matrices are legitimate here.
- The matrix view has two segmented controls (4 matrices, table or heatmap). This is the "dig" level and it is right that it is one tab away.
- **Tabs** have `role="tab"`, but `aria-selected` is never set (`script.js` sets `aria-expanded` only, for the Export menu).
- The panel is open at 250 px by default, taking a quarter of a 1000 px-tall window from the canvas even for a beginner who never reads a table.

### 2.6 Right panel
- **Inspector**: with nothing selected, a model summary (title, counts, load cases and combinations, the Maxwell count) and tips; with one node or member, its form, results and explanations; with several, the multi-selection form. Since milestones 4 and 5 it also explains the self-weight (W = ρ·A·L·g with the numbers) and a combination's actions at a node (each case's factored load). This is the best example in the app of the pattern to grow: the explanation next to the number.
- **"Critical health report"**: the status line, key values, the self-weight or combination block, buckling risk, failed members, stability, warnings and import notes. It has grown into the place where every milestone adds a block, in a fixed order. It is long, and the most important line for a learner ("why is it unstable?") competes with diagnostics for engineers (condition number, determinant).
- The two cards stack in one column, so a long Inspector pushes the health report out of view, and the health report has no way to stay visible while you edit.

### 2.7 Status bar
Pointer x, y; snap state ("snap 0.5 m"); a tool hint; the save note (`#sbSave`, for failures only, which is right); counts; solve time. These are useful and quiet. The tool hint duplicates the tool-options hint.

### 2.8 Help dialog
Six sections: Quick start, Shortcuts, Units & sign conventions, Supports, Method (the Direct Stiffness Method with the λ and self-weight equations), Assumptions & limitations. The content is good and honest. As a modal, though, it hides the model it explains, and nothing links a term in the interface to its paragraph.

### 2.9 Feedback: toasts, notes, tooltips
- 49 `toast()` call sites. They explain refusals well ("… is a combination: its actions are the factored sum of its load cases. Choose a load case …"), but a toast lasts 2.8 s, so it is easy to miss and hard to read at a distance (teacher).
- 59 `title=` tooltips (34 in HTML, 25 generated) and 3 "i" hint icons hold essential explanations, such as what λ multiplies. A tooltip needs a mouse, so it is invisible to touch and keyboard users.

### 2.10 Keyboard
- Shortcuts: V N M S L H (tools), F (fit), G (snap), D (deformed), Enter (solve), Delete/Backspace, Esc, ? (help), arrows (nudge, Shift for ×10), Space (pan), Ctrl+Z / Ctrl+Shift+Z. One function per setting since Rev 3.
- **Focus is not visible**: `style.css` has no `:focus-visible` rule and one `:focus` rule (a border colour on inputs). Buttons, tools, tabs, segmented controls and summaries show no focus at all.
- No `prefers-reduced-motion` handling: the solve animation and the mechanism animation always run.
- The canvas has non-pointer paths for every action (exact entry in tool options and the Inspector, member by node numbers): keep and extend them.

### 2.11 Responsive behaviour (from the CSS)
- Breakpoints at 1500 px (narrower panels), 1180 px (tool labels hidden, narrower panels again) and 920 px (one side panel at a time, through the panels button).
- No layout exists for 390 px phones: at that width the three-column grid is reduced to the canvas plus one overlay panel, the top bar's 11 controls wrap or clip, and the bottom panel still takes 250 px. What a phone should support has never been decided.

## 3. States

| State | What the user sees now | Problem |
|---|---|---|
| Empty model | banner: "Start drawing: press N … or choose one of the Examples…" | good; the only explicit next-step prompt in the app |
| No results yet / stale (Live off) | pill "Results out of date: press Solve"; health "Press Solve (Enter) or turn on Live" | fine |
| Solved | pill, health status, HUD SFmin, colours, legend | the same verdict in four places with different wording |
| Unstable | pill "UNSTABLE …", red banner with the mode and Next mode, health report with modes, animated mode | consistent; four places again |
| Invalid | pill, warning banner with the first message, health errors | fine |
| Selection: none / one / many | Inspector summary / form / multi form | good; selection colour is the warning colour |
| Hover | cyan outline (the accent colour) | collides with the accent |
| Focus | invisible on most controls | fails WCAG 2.4.7 |
| Disabled | `opacity: 0.35` | contrast of disabled labels is not specified |
| Combination shown | HUD line, health block, read-only Inspector, factor fields in the left panel | what is analysed is easy to lose sight of while editing |

## 4. Sources of unnecessary complexity, ranked

1. **Where "what is analysed" lives.** The load case or combination, λ and the target SF decide every number on the screen, yet they sit in the fourth left-panel section. They should be one always-visible control.
2. **Mixed left panel.** Model definition, tool settings, analysis state and view settings share one column, all open. They should be separate, with view settings behind a single control and model definition in its own place.
3. **The same verdict in four places** (pill, banner, health status, HUD), worded differently, plus solve time in the status bar. There should be one verdict, shown once in the chrome and once on the structure.
4. **A primary Solve button that is redundant by default** (Live on). Solve belongs next to the Live switch, as a secondary action.
5. **Colour carries several meanings**: amber is selection, load, warning and mechanism; green is ok and reaction; cyan is hover and the accent. Each meaning needs its own token, paired with a shape or label.
6. **The palette is defined twice** (CSS variables and `COL`). It should be one source, read once by the canvas.
7. **Typography of generated templates**: ALL CAPS letter-spaced labels (5 rules), 92 middle-dot strings (20 in `index.html`, 72 in `script.js`), monospace in 24 rules (including labels, the HUD and status text), and 39 font declarations below 12 px (9, 10, 10.5, 11 and 11.5 px). It looks generic and is hard to read on a projector.
8. **Card chrome for everything**: 10 box-shadows, 4 gradients, 8 different radius values (3, 4, 6, 7, 8, 9 px, 50 %, and `--radius`). The hierarchy comes from decoration rather than from space and type.
9. **Explanations hidden in tooltips** (59 `title`s, 3 "i" icons) and in a modal Help. They should sit inline, next to the value they explain, as the Inspector already does for self-weight and combinations.
10. **The bottom panel open by default** at 250 px. Tables are the "dig" level; a one-line summary is enough until the user asks for them.
11. **Two names for one job**: Save, and Export ▸ Model file. "Critical health report" is also an unusual name for the results summary.
12. **No phone layout decision.**

## 5. Accessibility findings (WCAG 2.2 AA)

| Check | Now | Needed |
|---|---|---|
| Text contrast | `--text` 12.9:1 and `--muted` 6.1:1 on panels are fine; `--dim` **3.36:1** is used for text (sub-headings, hints, the HUD) | 4.5:1 |
| Canvas text | grid labels **2.74:1** | 4.5:1 |
| Focus visible (2.4.7) | missing on buttons, tools, tabs, segmented controls, summaries | a visible ring of at least 3:1 |
| Target size (2.5.8) | `.btn.sm`, segmented buttons and the 8 px pill dot are near or below 24 px (inferred from padding) | 24 × 24 px |
| Smallest text | 9 px and 10 px in places | at least 12 px |
| Tabs | `role="tab"` without `aria-selected` | `aria-selected`, arrow-key navigation |
| Toggle buttons | `.on` class only (Auto, segmented controls) | `aria-pressed` |
| Motion | solve and mechanism animations always run | `prefers-reduced-motion`: static mode shape |
| Colour alone | zero-force is dashed (good); failure, warning and selection rely on colour | a shape or label for each |

## 6. Opportunities for contextual explanation

- **Next to each result**, the formula with the real numbers. This already exists for the self-weight and for a node's combined actions. Extend it to the member force (F = EA/L · ΔL), the stress, both safety factors and P_cr.
- **The verdict explains itself.** "Unstable" links to the mode on the canvas and to the plain-language reason. "Below target SF" names the member and the check.
- **A term links to its definition**: λ, γ, x′/y′ frames, Maxwell count, K = 1. These are the Help paragraphs, shown inline instead of in a modal.
- **The empty state is the first lesson**: the banner prompt already does this; a short three-step "place nodes, connect, support and load" strip would replace it.
- **For combinations**, show Σγᵢ·Fᵢ beside the factors as you type them, and the governing combination beside each member in the Members table.

## 7. Must keep

- The structure as the hero: force colours, dashed zero-force members, the deformed shape with its labelled scale, the animated (or static) mechanism mode with a description.
- Exact numeric entry everywhere, the shortcuts, and every non-pointer path.
- The dense tables and the matrix inspector, one action away.
- Inline explanations in the Inspector, and the honest wording that never shows numbers for unstable or stale results.
- The smoke-test contract (ids and wording in `trusslab-ui-design`). A redesign moves elements but keeps their ids, or updates the test in the same step.
