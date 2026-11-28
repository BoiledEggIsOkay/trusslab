# Three design directions (milestone 6, step 2)

> **Status:** a proposal from milestone 6, step 2, kept as the record of the reasoning. The maintainer chose a different, dark direction, **Midnight Engineering Lab**, which is implemented; its token system is `tokens.md`. The common requirements listed below (one control for what is analysed, one source per colour, no ALL CAPS or middle-dot labels, visible focus, a phone decision) were all carried into it.

Each direction answers the audit (`ui-audit.md`) differently: in how the workspace is organised, not just in colour. All three keep one model, one engine (`FEA.analyze`), every feature, the shortcuts, the `file://` constraint and the smoke-test contract ids. The token plans follow the `frontend-design` format: colour, type, layout and principles. `tokens.md` develops the full token system for the recommended direction.

Common to all three, because the audit requires it whichever direction is chosen:
- one always-visible control for **what is analysed** (load case or combination, λ);
- the verdict shown once in the chrome and once on the structure;
- one source for every colour, read by both the CSS and the canvas;
- a separate colour for each meaning, paired with a shape or label;
- text of at least 12 px, no ALL CAPS labels and no middle-dot strings;
- a visible focus ring, `aria-selected` and `aria-pressed`, and `prefers-reduced-motion`;
- an explicit decision about what a phone supports.

---

## Direction A: Drawing sheet

**Brief.** The structure sits on an engineering drawing sheet, and everything else is the drawing's apparatus: a tool rail at its edge, a title block that states the analysed state and the verdict, and one context panel that changes with what you select. It is for every user, and especially for the teacher at a projector: light, high contrast, and calm.

**Token plan**
- *Colour.* Sheet `#F4F5F6` (cool, not cream), panel `#FFFFFF`, ink `#1A1D21`, tension `#1D5FC4`, compression `#C2382B`, selection `#6A3FD1`. Loads are drawn in ink as heavy arrows, as on a drawing. Reactions are teal `#0C7470` with open arrowheads. Failure is magenta `#B0136E` with a halo and a ✕ badge, never the compression red.
- *Type.* IBM Plex Sans (SIL OFL 1.1, bundled; licence and `file://` loading to be verified in Chrome, Safari and Firefox), falling back to the system UI stack. Tabular figures for every number. Weights 400, 500 and 600, sizes 12, 13, 14, 16 and 20 px. No monospace except in the matrix view.
- *Layout.* The canvas takes all the space between a 48 px tool rail on the left and a 340 px context panel on the right. A single 44 px top bar holds the title block. Tables live in a drawer that is closed to a 28 px bar. Text is left-aligned, numbers right-aligned in columns.
- *Principles.* The sheet is the hero, and chrome is drawn like drawing furniture (rules, a title block) rather than cards. One verdict, one analysed state. An explanation sits next to every number.

**Review against the generic defaults.** The first plan was a warm off-white sheet with a serif title block, which is upstream default #1 (cream with a serif display). I moved the sheet to a cool neutral and the title block to the UI face. The plan also leaned on hairline rules everywhere with zero radius, which is default #3 (broadsheet). Rules are now kept only where they separate real structure (rail, panel, drawer), and controls keep a 4 px radius.

**Main workspace (solved)**
```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ TrussLab  File ▾  ↶ ↷ │ Analysed: [Load case 1 ▾]  λ [1.00]  │ Solved: SF min 2.14 at M3 (buckling) │ Live ☑  Solve  ? │
├────┬─────────────────────────────────────────────────────────────────┬───────────────────┤
│ ▢  │ Member tool: section [Chord 2000 mm² ▾]  from [ ] to [ ]        │ Selection Model Results│
│ ●  │                                                                 │───────────────────│
│ ╱  │          ●━━━━━━━━━●━━━━━━━━━●            tension ━━  blue      │ Nothing selected   │
│ △  │         ╱ ╲       ╱ ╲       ╱ ╲           compression ━━ red   │                   │
│ ↓  │        ╱   ╲     ╱   ╲     ╱   ╲          zero ┄┄ grey         │ Pratt truss       │
│ ✋ │       △━━━━━●━━━━━●━━━━━●━━━━━○           −120 kN … +96 kN      │ 9 nodes, 15 members│
│    │                  ⬇ 40 kN    ⬇ 40 kN                            │ statically        │
│    │                                                                 │ determinate (0)   │
│ ⤢  │                                                  Deflection ×50 │                   │
│ View│                                                                │ Next: select a    │
├────┴─────────────────────────────────────────────────────────────────┤ member to see its │
│ ▸ Members 15   Nodes 9   Matrices   Log      x 3.50 m  y 1.00 m  snap 0.5 m  │ force and checks  │
└──────────────────────────────────────────────────────────────────────┴───────────────────┘
```

**Selection state: one member**
```
                                                           │ Selection Model Results│
        ●━━━━━━━━━●━━━━━━━━━●                              │───────────────────│
       ╱ ╲       ╱ ╲  ◆◆◆  ╱ ╲     ◆ = selected (violet)  │ Member M3  N2 → N5 │
      ╱   ╲     ╱   ╲     ╱   ╲                            │ Section [Diag ▾]   │
                                                           │ Force   −84.85 kN  │
                                                           │         compression│
                                                           │ F = EA/L · ΔL      │
                                                           │   = 200 GPa × 1500 │
                                                           │   mm² / 4.24 m × … │
                                                           │ SF buckling  2.14  │
                                                           │ P_cr = π²EI/L² = … │
                                                           │ SF yield     5.30  │
                                                           │ In combinations ▸  │
```

**Unstable state**
```
┌ TrussLab … │ Analysed: [Load case 1 ▾] λ [1.00] │ ✕ Unstable: 1 mechanism mode │ … ┐
├────┬──────────────────────────────────────────────────────────┬──────────────────┤
│    │ ✕ Unstable structure. Mode 1 of 1: node N4 can move      │ Selection Model Results│
│    │   sideways without stretching any member. [Next mode]    │──────────────────│
│    │                                                          │ ✕ No results     │
│    │        ●┄┄┄┄┄┄┄●        (mode shape, magenta, dashed;    │ The stiffness     │
│    │       ╱ ╲     ╱          static when motion is reduced)  │ matrix is singular│
│    │      △━━━●━━━○                                           │ (rank 13 of 14).  │
│    │                                                          │ Add a member or a │
│    │                                                          │ support at N4.    │
│    │  member colours hidden: no numbers for an unstable model │ Maxwell count ▸   │
```

**Load cases and combinations (Model tab)**
```
│ Selection [Model] Results       │
│─────────────────────────────────│
│ Load cases                      │
│  ● Load case 1     3 loads      │  ← the one analysed is marked; click to analyse
│    Wind            2 loads      │
│    Self-weight     generated    │
│  [+ Load case] [+ Self-weight]  │
│ Combinations                    │
│    ULS 1   1.35 × Self-weight + 1.5 × Load case 1   │
│  [+ Combination]                │
│  ▾ ULS 1                        │
│     Self-weight   [1.35] γ      │
│     Load case 1   [1.5 ] γ      │
│     Wind          [    ] not included │
│     F = Σ γᵢ·Fᵢ, solved directly as one action state │
│ Materials ▸   Sections ▸        │  (collapsed; open on demand)
```

**Results tab** (the health report, reorganised in reading order): the verdict and why → the critical member and its check → warnings with links → (when combinations exist) every combination with its governing SF, and the governing one marked → stability and diagnostics, collapsed → import notes.

**Narrow layouts**
```
920 px and less                               390 px (phone: view and inspect)
┌ TrussLab ≡ │ [LC1 ▾] λ 1 │ ✓ SF 2.14 ┐       ┌ ≡  [LC1 ▾]  ✓ SF 2.14 ┐
├──┬────────────────────────────────────┤       ├────────────────────────┤
│▢ │                                    │       │                        │
│● │            canvas                  │       │       canvas           │
│╱ │                                    │       │   (pan, zoom, select)  │
│△ │                                    │       │                        │
│↓ ├────────────────────────────────────┤       ├────────────────────────┤
│✋│ ═ Selection  Model  Results         │       │ ═ Selection   Results  │
│  │ bottom sheet, half height,         │       │ sheet; editing tools   │
│  │ drag to resize                     │       │ hidden: "Open on a wider│
└──┴────────────────────────────────────┘       │ screen to edit"        │
                                                └────────────────────────┘
```

**Beginner and advanced workflows.**
- *Beginner:* the empty sheet shows a three-step strip ("Place nodes N", "Connect them M", "Support and load S L"). The Results tab opens on the verdict and the reason, and the Selection tab explains every number with its formula.
- *Advanced:* the shortcuts and exact entry are unchanged. The drawer opens with a key (T) to the tables and the matrices. The analysed-state control takes the keyboard (C to choose a case or combination).

**Learn, Analyze and Design.** These are not global modes; see the evaluation below. Learn is the explanation that every Selection and Results view already carries, and later a lesson pane. Design (milestone 10) becomes a Check section in the Results tab.

| Advantages | Disadvantages |
|---|---|
| Closest to the principle "the structure is the interface"; the canvas gains about 25 % of the width (no left panel, the drawer closed) | A light canvas is a visible change for current users; dark-room use needs a dark variant later |
| Projector- and print-friendly; colours separate by hue and pattern | The context panel carries more (three tabs); a long Results tab needs care |
| Smallest change to the architecture: every current section maps to one tab, and the ids can be kept | Bundling a font needs licence and `file://` verification |

---

## Direction B: Worksheet

**Brief.** TrussLab as a calculation worksheet. A step rail runs down the left (1 Geometry, 2 Supports, 3 Loads and combinations, 4 Analyse, 5 Check), and each step is a page of controls with its explanation. The canvas stays beside it, always in view. The steps really are a sequence, which justifies the numbering. It serves the beginner and the student first, and the teacher, who can walk a class through the steps.

**Token plan**
- *Colour.* Page `#FFFFFF`, band `#F2F4F7` (the step you are on), ink `#161A1F`, primary indigo `#2B3A8F` (one primary action per step), with the same semantic colours as A (tension `#1D5FC4`, compression `#C2382B`, failure `#B0136E`, reaction `#0C7470`).
- *Type.* Atkinson Hyperlegible (SIL OFL 1.1, from the Braille Institute; bundled, to be verified), chosen for legibility at a distance. Body 14 px, step titles 20 px, tables 13 px with tabular figures, using the system UI face if Atkinson's tabular figures prove inadequate.
- *Layout.* A 360 px worksheet column on the left with the step rail, the canvas on the right (sticky), and results inline in steps 4 and 5. Prose is left-aligned with lines under 70 characters.
- *Principles.* One step, one primary action. Every number appears with its sentence. You can always see where you are in the sequence.

**Review against the generic defaults.** A first sketch put each step in a rounded white card with a soft shadow: the SaaS card kit, default #4. Steps are now bands of the page separated by space, and only the current step is tinted.

**Main workspace (step 4, Analyse)**
```
┌ TrussLab   Pratt truss            ↶ ↷   File ▾   ?  ─────────────────────────────────────┐
├───────────────────────────────┬──────────────────────────────────────────────────────────┤
│ 1 Geometry          ✓         │                                                          │
│ 2 Supports          ✓         │        ●━━━━━━━●━━━━━━━●                                 │
│ 3 Loads             ✓         │       ╱ ╲     ╱ ╲     ╱ ╲                                │
│▌4 Analyse                     │      △━━━●━━━━━●━━━━━●━━○                                │
│   Analysed: [Load case 1 ▾]   │            ⬇ 40      ⬇ 40                                │
│   λ [1.00]  multiplies every  │                                                          │
│   load and settlement once    │                                                          │
│   ✓ Solved. The weakest member│                                      Deflection ×50       │
│   is M3: SF 2.14 (buckling)   │                                                          │
│   [Show the check for M3]     │                                                          │
│ 5 Check members               │                                                          │
├───────────────────────────────┴──────────────────────────────────────────────────────────┤
│ Members  Nodes  Matrices  Log   (drawer, closed)                                         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Selection state**: selecting a member opens step 5 at that member, and the worksheet shows its whole calculation, from the force to the stress, both safety factors and P_cr, with each line substituted.

**Unstable state**: step 4 shows "✕ The structure is a mechanism", the mode in words, and "Go to step 2: add a support at N4" as the step's primary action. Steps 4 and 5 are locked and show no numbers until the structure is stable.

**Load cases and combinations (step 3)**
```
│▌3 Loads and combinations              │
│   Case  [Load case 1 ▾] [+ Case]      │
│   Click a node to load it, or type:   │
│   N5  Fx [  0 ] Fy [ −40 ] kN         │
│   Self-weight  [Add]  (ρ·A·L·g)       │
│   Combinations                        │
│   ULS 1 = 1.35 × Self-weight          │
│         + 1.5 × Load case 1   [Edit]  │
│   [+ Combination]                     │
```

**Narrow layouts**: at 920 px and less, the worksheet and the canvas alternate (a "Sheet / Drawing" switch), and the step rail becomes a row of numbered dots. At 390 px the worksheet is read-only at steps 4 and 5, and editing asks for a wider screen.

**Beginner and advanced workflows.**
- *Beginner:* the steps are the lesson structure, and the predict, run and compare loop (milestone 7) fits naturally into step 4.
- *Advanced:* "All steps" collapses the rail into one long compact form. Shortcuts jump to steps (1 to 5).

**Learn, Analyze and Design**: Learn is the worksheet itself. Analyze is steps 1 to 4, Design is step 5 and later sizing (milestone 10). Of the three directions, this is the one where the three words describe the layout best, but at the cost of free modelling.

| Advantages | Disadvantages |
|---|---|
| The clearest next step at every moment; the best fit for lessons (milestone 11) | Imposes an order on work that experienced users do in any order; editing geometry from step 5 means jumping back |
| Explanations have room to be full sentences | The canvas loses a 360 px column permanently |
| Calm, legible, classroom-friendly | The biggest change to `index.html` and to the smoke contract's places (ids kept, structure new) |

---

## Direction C: Workbench

**Brief.** A professional analysis workbench. The canvas sits among docked, resizable panes: Model tree, Properties, Results table and Log. A command bar (Ctrl+K) reaches every action and setting by name, and the shortcuts stay. It serves the experienced engineer first, with dense, exact and fast work, and the learner through a Learn overlay that explains whatever is selected.

**Token plan**
- *Colour.* Base `#1C1E21` and panel `#24272B` (neutral graphite, not the blue-tinted near-black of today), text `#E8EAED`, tension `#6FA8FF`, compression `#FF7468`, failure magenta `#FF5FAE`, selection `#C6A2FF`. There is no accent colour: the primary action is light text on a raised graphite button.
- *Type.* The system UI stack at 12 and 13 px with tabular figures for tables, 14 px in the Properties pane. Monospace (system mono) only in the matrix pane.
- *Layout.* Docked panes around the canvas (Model tree on the left, Properties on the right, Results under the canvas, all resizable, closable and remembered), and a 36 px top bar with the command field, the analysed state and the verdict.
- *Principles.* Density with order: every pane is a table or a form. Everything is reachable by keyboard. Nothing moves unless you move it.

**Review against the generic defaults.** The first palette kept a single bright accent on near-black, which is default #2 and is what TrussLab has today. The base is now a neutral graphite, the accent is gone, and colour is reserved for structural meaning.

**Main workspace**
```
┌ ⌘K  Search actions…   │ Analysed [ULS 1 ▾] λ 1.00 │ Solved, SF min 0.94 at M7 (yield) │ ↶ ↷ ⚙ ┐
├ Model ─────────┬─────────────────────────────────────────────────┬ Properties ──────────┤
│ ▾ Nodes (9)    │                                                 │ Member M7            │
│ ▾ Members (15) │        ●━━━━━━━●━━━━━━━●                         │ Section  Chord 2000  │
│ ▾ Supports (2) │       ╱ ╲     ╱ ╲     ╱ ╲                        │ Force    −251.3 kN   │
│ ▾ Load cases   │      △━━━●━━━━━●━━━━━●━━○                        │ σ        −125.6 MPa  │
│    LC1  Wind SW│                                                 │ SF yield  0.94  ✕    │
│ ▾ Combinations │                                                 │ SF buck.  1.31       │
│    ULS 1  SLS  │                                                 │ Governing: ULS 1     │
│ ▾ Materials    │                                                 │ [Explain] (Learn)    │
├────────────────┴─────────────────────────────────────────────────┴──────────────────────┤
│ Results  [Members] Nodes  Envelope  Matrices  Log                                       │
│  #   N1→N2   Section   F [kN]    σ [MPa]   SF     Mode      Governing comb.            │
│  M7  N3→N4   Chord     −251.30   −125.65   0.94 ✕ yield     ULS 1                      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Selection state**: Properties shows the member; the Results table highlights its row; the Learn overlay (L) draws the free-body diagram and the formula beside the member on the canvas.

**Unstable state**: the top bar shows "✕ Unstable, 1 mechanism mode". The Results pane switches to a Stability tab with the mode, the rank and the nullity, and the canvas animates the mode (static under reduced motion). Number columns show "—".

**Load cases and combinations**: in the Model tree. Selecting a combination shows a factor grid in Properties (case × γ), and the Envelope tab lists, for each member, the governing combination and the value.

**Narrow layouts**: below 1180 px the side panes become tabs of one pane. At 920 px and less, panes are overlays from the edges. At 390 px the workbench shows the canvas and Properties only, read-only.

**Beginner and advanced workflows.**
- *Advanced:* the best of the three, with the command bar, the dense grids and the envelope tab.
- *Beginner:* the weakest of the three. Many panes appear at once; the Learn overlay helps, but the first impression is a professional tool.

**Learn, Analyze and Design**: Analyze is the workbench. Learn is an overlay over the selection (L), and Design is a pane (milestone 10). Modes are not needed here.

| Advantages | Disadvantages |
|---|---|
| Fastest for experts; the most room for tables and the envelope | Reproduces the "everything visible at once" problem the audit found, now in panes |
| A dark theme suits long sessions | A dark canvas projects poorly; the beginner and the teacher are served second |
| The command bar removes the need for menus | Docking, resizing and remembering panes is the most new UI code of the three |

---

## Learn, Analyze and Design: is it the right organisation?

The idea is three workspaces over one model: Learn for lessons and explanations, Analyze for modelling and solving, Design for checks and sizing.

**For it**
- It names the three jobs the roadmap serves (milestones 7 to 11 are Learn and Design features).
- A lesson needs a layout of its own: a lesson pane, step-by-step reveals, a locked prediction.
- Sizing (milestone 10) has its own controls: candidates, the iteration log, convergence.

**Against making them global modes now**
- Today there would be **two nearly empty modes**: no lessons exist until milestone 11, and no sizing until milestone 10.
- **Most actions are needed in all three.** Geometry editing, selection, load cases and the verdict are needed while learning, analysing and designing alike. Modes that hide them create "where did it go?" moments; modes that keep them all are not modes.
- **Explanations are better next to the number** (the audit's finding 9, and the `trusslab-ui-design` pattern) than in a separate Learn place. The milestone 4 and 5 Inspector texts already show this working.
- **Design results are results.** The worst SF over combinations is shown in Results today; sizing would add a Check section, not a new world.

**Recommendation.** Build one workspace now, in which Learn and Design are **views of the context panel**, not global modes:
- Selection, Model and Results tabs now;
- an **Explain** layer in Selection and Results, the Learn content of milestones 7 to 9;
- a **Check** section in Results, the Design content of milestone 10.

Only when lessons arrive (milestone 11) add a **Lesson layout** that opens a lesson pane beside the same workspace. It is a layout preset over the same model and engine, switched from the top bar. If lessons then prove to need it, "Learn / Analyze / Design" can become the names of three layout presets at that point, backed by real content.

## Recommended direction: A, Drawing sheet

1. **It fixes the audit's top findings most directly**:
   - the analysed state and the verdict move to the title block (findings 1 and 3);
   - the mixed left panel becomes a tool rail plus Model and View (finding 2);
   - colour gets one meaning per token (finding 5);
   - the tables close into a drawer (finding 10).
2. **It serves all four users without favouring one.** Beginners get the clear next step and inline explanations, engineers keep every shortcut and table one key away, and teachers get a light, high-contrast sheet that projects well. B serves beginners best but slows experts; C serves experts best but repeats the clutter for beginners.
3. **It is the safest to implement** in the existing architecture: every current section moves to one tab or the rail, ids can stay (the smoke contract survives), and nothing needs docking logic.
4. **It takes B's best idea** (the empty-state steps and the full calculation next to a number) **and C's** (the governing combination beside each member, and later a command bar), without their costs.

What I would ask you to decide with it:
- a light canvas only, or a light default with a dark variant later;
- whether to bundle IBM Plex Sans (licence committed, `file://` loading verified in three browsers) or stay with the system UI face;
- what the phone supports: proposed as viewing, selecting and inspecting, with no editing.

## Navigation structure (recommended direction)

| Place | Holds | Today's equivalent |
|---|---|---|
| Title block (top bar) | File menu (New, Open…, Save, Export ▸, Examples ▸), Undo and Redo, **Analysed** (case or combination) with λ, the verdict, Live with Solve, Help | top bar plus the Analysis section; Save and Export ▸ Model file become one item |
| Tool rail (left edge) | Select, Node, Member, Support, Load, Pan; Fit and zoom; **View** popover (deformed shape and scale, colour mode, labels, units, digits, grid and snapping) | tool strip plus the Grid & snapping and Display sections |
| Tool options (top of the canvas) | the active tool's exact-entry fields, labelled with the tool's name | `#toolOptions` |
| Canvas | the structure, the legend, the scale label, one banner (empty or unstable only) | canvas; the HUD's content moves to the title block |
| Context panel: Selection | Inspector: forms, results, the Explain text | Inspector |
| Context panel: Model | load cases and combinations (with factors), materials, sections | Materials, Sections and the case controls of Analysis |
| Context panel: Results | verdict and reason, critical member, warnings, combinations and the governing value, stability and diagnostics (collapsed), import notes; later Check (milestone 10) | health report |
| Drawer (bottom, closed) | Members, Nodes & reactions, Matrices, Log; pointer coordinates, snap and the save note in its bar | bottom panel plus status bar |
| Help | a side sheet beside the model, opened at the paragraph for the term clicked | modal dialog |

## Technical implementation plan (after approval)

The plan follows the `trusslab-ui-design` process: one area per step, each one reviewed. Every step needs:
- before and after screenshots at 1440, 1280, 1024, 900 and 390 px;
- both smoke-test modes in a real browser;
- `check.sh`;
- a keyboard walk-through.

The engine, `model.js`, the file format and the `TrussLabTest` adapter stay unchanged throughout.

1. **Tokens, no layout change.** Semantic custom properties in `style.css` `:root` (`tokens.md`), the canvas reading them once with `getComputedStyle` in place of `COL`, the type scale with a 12 px minimum, no ALL CAPS, and middle dots replaced. Smoke: no contract change expected.
2. **Accessibility floor.** `:focus-visible` rings, `aria-selected` and arrow keys on tabs, `aria-pressed` on toggles, 24 px targets, and `prefers-reduced-motion` (static mechanism shape, no solve animation). Smoke: a new check for `aria-selected`.
3. **Title block.**
   - Changes: the Analysed control and λ move out of the left panel, and the verdict replaces the pill and the HUD line; the File menu absorbs Save and Export ▸ Model.
   - Kept: the ids `#selLoadCase`, `#numLoadFactor`, `#rngLoadFactor`, `#statusPill` and `#hud`, with the contract's wording updated in the same commit where it changes.
4. **Tool rail and View popover.**
   - Changes: Grid & snapping and Display move to View, and the tool strip becomes the rail.
   - Kept: the ids `#chkSnap`, `#segGrid`, `[data-show]`, `#selForceUnit` and `.tool[data-tool]`.
5. **Context panel tabs.** Selection, Model and Results. Materials, sections, cases and combinations move into Model, and the health report becomes Results, reordered.
   - Kept: the ids `#inspector`, `#health`, `#materialsList`, `#groupsList`, `#comboEditor` and the case buttons.
   - New: `role="tablist"` with `aria-selected`.
6. **Drawer.** The bottom panel starts closed, and the status bar merges into its bar. Kept: the ids `.tab[data-tab]`, `#tab-*`, `#mtxView` and `#logText`.
7. **Canvas visuals.** The new palette, ink load arrows, open teal reaction arrows, the magenta failure halo with ✕, the violet selection, and the legend restyled. Screenshots of every state: empty, solved, stale, unstable, invalid, selection, hover, focus.
8. **Narrow layouts.** The bottom sheet at 920 px and below, and the phone's view-and-inspect decision at 390 px.

Risks to watch:
- Moving controls changes the smoke test's *places* but not its ids. Each step updates the wording list in `trusslab-ui-design` and the test together.
- A light canvas changes every screenshot users have seen, so release notes should say so.
- A bundled font is only adopted after the three-browser `file://` check, with its licence committed.
