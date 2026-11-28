# TrussLab: learn, analyse and design 2D trusses

TrussLab is a browser application for pin-jointed plane trusses. Build a truss, predict how it behaves, analyse it by the Direct Stiffness Method, see the equations and the solver's own matrices behind every result, and size its members. It runs entirely in the browser: no build step, no server, no external libraries, no network.

TrussLab is an educational analysis tool, not certified structural design software (see [Assumptions and limitations](#assumptions-and-limitations)).

## Running it

Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari). Double-clicking the file works (`file://`). You can also serve the folder:

```bash
python3 -m http.server 8000   # then browse to http://localhost:8000
```

| File | Purpose |
|------|---------|
| `index.html` | Page layout and the help dialog |
| `style.css` | The "Midnight Engineering Lab" design: tokens, layout, components, responsive and phone layout |
| `fonts/` | IBM Plex Sans and IBM Plex Mono subsets (SIL Open Font License 1.1, `fonts/OFL.txt`), loaded locally |
| `fea-core.js` | Numerical engine (no DOM). Usable from Node: `require('./fea-core.js').analyze(input)` |
| `model.js` | Model layer (no DOM): expression parser, materials and sections, model objects, load cases, the generated self-weight case, load combinations, the deflection criterion, the file format, the examples, the solver input and saved sessions |
| `education.js` | Teaching logic (no DOM): the guided first truss, worked calculations, predictions, free-body diagrams, the method of joints and the Solver Explorer. It reads the solver's results; it never solves anything itself |
| `design.js` | Design logic (no DOM): the section catalogue, checks over every load case or combination, fully stressed section sizing, and the reference-chord deflection check |
| `lessons.js` | The curriculum (no DOM): six lessons, their worked examples and challenges, and lesson progress storage |
| `script.js` | The page: editor, canvas, Inspector, Results, tables, matrices, exports, and the Learn and Design workspaces |
| `test/*.test.js` | Headless tests (see [Tests](#tests)) |
| `test/browser-smoke.js` | Browser smoke test of the user interface, run with `index.html?smoke` |

The session (model, view, settings) is autosaved in the browser's `localStorage` (see [Files and saved sessions](#files-and-saved-sessions)).

## Three workspaces, one model

The header switches between **Learn**, **Analyze** and **Design**. They are three views of the same model and the same solver: switching never changes the model or the analysis.

- **Analyze**: build the truss, load it, choose what is analysed, and read the results.
- **Learn**: lessons, the guided first truss, predicting tension and compression, free-body diagrams, the method of joints, and the Solver Explorer.
- **Design**: materials and sections, strength and buckling over every load case or combination, a deflection criterion, and section sizing.

**Guided** and **Technical** (header) change how much is explained, not what is computed. Guided opens the explanations and worked calculations next to the results; Technical closes them (one click away), opens the data tables, and shows the diagnostics.

The first visit opens Learn; afterwards TrussLab reopens the workspace you left.

### Layout

- The **context bar** above the canvas says what is analysed (load case or combination), the load factor λ, Live and Solve, and the verdict. **View** holds the display settings: deflected shape and scale, colouring, what is shown, grid and snapping, and units.
- The **tool rail** on the left of the canvas has the drawing tools and Undo / Redo. The options of the active tool float at the top-left of the canvas.
- The **workspace panel** (left) changes with the workspace. The **Inspector** and **Results** tabs (right) show the selection and the whole verdict.
- The **data drawer** under the canvas (closed by default) has the Members table, Nodes and reactions, the matrices and the solver log.
- At 1100 px or less, one side panel is shown at a time, over the canvas (the panels button cycles left, right, none).
- **Phones (640 px or less) are view-only**: you can open examples and files, pan and zoom, select nodes and members to inspect them, switch the load case or combination, and read results, explanations and lessons. Drawing and every edit (geometry, supports, loads, settlements, materials, sections, combinations, applying a sizing proposal) are refused with a message; the forms are shown disabled. Use a tablet or a computer to edit.

## Analyze

- **File ▸ Open an example** loads ready-made structures: Pratt, Howe and Warren trusses, an A-frame with a closed-form answer, a cantilever, a Fink roof truss in timber, an inclined roller, a support settlement, and an unstable mechanism.
- Tools: `V` select/move, `N` node, `M` member (chains; clicking empty space creates a node), `S` support, `L` load, `H` pan. Wheel zooms at the pointer; middle or right drag pans; on touch screens, pinch zooms and two fingers pan.
- Snap grid: 0.1 / 0.25 / 0.5 / 1 / 2 m. Snapped coordinates are the doubles nearest to k·step (for example exactly `0.3`, not `0.30000000000000004`).
- Exact input: every numeric field accepts expressions, for example `2*sqrt(3)`, `12/7`, `10*cos(30)` (trig in degrees).
- Supports: pin, roller (u_y = 0), roller (u_x = 0), inclined roller at angle α, and custom supports that fix x′ and/or y′ of a frame rotated by α. A custom support with neither axis fixed restrains nothing, and TrussLab warns about it.
- Load cases (Model panel): nodal loads and support settlements belong to a load case. **+ Load case** adds an empty case and shows it; the case selector in the context bar switches between cases, the name field renames the case shown, and **Delete** removes it (Ctrl+Z undoes it; the last case cannot be deleted). Switching cases is not an edit, so it is not undone; undo keeps the case you are looking at whenever it still exists.
- Load combinations: **+ Combination** adds a combination, starting as 1 × the active load case, and shows it. Combinations are listed under "Combinations" in the same selector, marked "(combination)"; the name field renames the one shown and **Delete** removes it. A factor field for each load case (the self-weight case included) sets its factor γ: any number, negative and 0 included, or empty to leave the case out. A combination's actions are F = Σ γᵢ·Fᵢ and u_s = Σ γᵢ·u_s,ᵢ; they are added up first and the combination is solved directly as one complete action state, then λ multiplies it once. Its loads are shown on the canvas and, read-only, in the Inspector; loads and settlements are entered in the load cases, never in a combination. With a combination shown, Results lists every combination solved on its own, with its lowest safety factor, and the governing value over all of them: the lowest of their own results. Safety factors, utilisations and statuses are never added across load cases. Deleting a load case removes its factor from every combination.
- Settlements: any fixed axis of any support can settle (Inspector, "Settlement in …"). A settlement is measured along the support's own axes x′, y′. A settlement on an axis that is not fixed, or on a node with no members, has no effect, and TrussLab warns about it.
- Self-weight: **+ Self-weight case** adds a generated load case and shows it. Each member weighs W = ρ·A·L·g (its material's density, its section area, its length, g = 9.80665 m/s²), and half of it acts downward at each end node. The loads are computed from the current geometry, sections and materials whenever they are needed, so they follow every edit and are never stored, never added twice, and cannot be edited by hand; the other load cases are not touched. The case is solved on its own like any other, and λ scales it. If any member's material has no density, the case is marked incomplete wherever it is shown (Results, which names the members, the Inspector, the canvas and the exported reports, as `"complete": false` with `membersWithoutDensity`), and a warning names the material: an incomplete self-weight is never presented as the structure's whole weight. A model has at most one self-weight case; **Delete** removes it.
- Load factor λ scales every action of the load case or combination shown, live: nodal loads and prescribed settlements alike. Because the model is linear, displacements, member forces and reactions scale by λ too. At λ = 0 there are no actions, so a stable structure has no displacements, member forces or reactions; a mechanism stays unstable at any λ.
- The **Inspector** shows the selected node or member and, below its values, how they were calculated (see [Worked calculations](#worked-calculations)). With nothing selected it shows the model summary.
- **Results** gives the verdict (✓ within limits, ! below the target safety factor, ✕ failed or unstable), the key values, buckling risk, failed members, the stability and numerical verification, warnings and import notes.
- The canvas: tension members blue with "+", compression members orange with "−" and a heavier line, zero-force members dashed; failed members carry a halo and a ✕ badge; loads have filled arrowheads, reactions open ones. The deflection scale runs 1× to 1000× (typed values up to 10⁶), with an Auto mode. A mechanism's mode shape is animated, or drawn still if your system asks for reduced motion.
- Export: calculation report (CSV / JSON), system matrices (CSV / JSON), PNG image, and the model file (JSON; re-open with **File ▸ Open a file…**). Reports and matrices name the analysed load case or combination (with its factors) and list the loads and settlements as applied, that is multiplied by γ and λ. A report on a model with combinations also lists every combination solved on its own and the worst case over them (`combinationResults`).

### Worked calculations

Select a member and the Inspector shows, step by step, with the solver's own numbers: its length and direction cosines, its change of length δ = c·(u_xj − u_xi) + s·(u_yj − u_yi), its force N = (E·A/L)·δ, its stress σ = N/A and strain ε = δ/L, then the yield check σ_y/|σ|, the Euler load P_cr = π²·E·I/(K·L)² with K = 1 and the buckling check P_cr/|N|, and the governing safety factor. Each step gives the equation, the substitution in SI base units (never mixed units), the result (also in your display units), its meaning, and the symbols. Select a node for its displacement and, at a support, the reaction found from the equilibrium of the isolated joint. Values are rounded for display only; the calculation uses the solver's full-precision values.

## Learn

- **Lessons**: six lessons, each with objectives, prerequisites, an introduction, an explanation, the equations and their variables, a worked example built from a real model and the solver's results, an activity to try, practice, an understanding check with immediate feedback, a summary and common misconceptions; most end with a challenge.
  1. Understanding trusses; 2. Tension and compression; 3. Supports and reactions; 4. Stress, strain and deformation; 5. Stability and buckling; 6. The Direct Stiffness Method.
- **Challenges** are judged on objective criteria from your model and the solver: stability, restraints, stresses, members. Written reasoning is never graded.
- **Progress** (lessons completed, the current lesson, exercises and challenges) is kept in the browser under its own key, `trusslab.learn.v1`, apart from your model. There are no points, streaks or leaderboards.
- **Build your first truss**: five steps (nodes, members, supports, a load, the result), each checked from your model as you go.
- **Predict: tension or compression?**: decide for every member, then check. The results stay hidden everywhere until every member has an answer; the check compares with the solver's own classification and explains each answer from the solver's δ and N (and, for a zero-force member, the joint rule that explains it). "Try the wrong ones again" keeps the right answers.
- **Free-body diagram of a joint**: any node, isolated, with every member force (tension pulls away from the joint, compression pushes on it), the load and the reaction, their x and y components, and ΣF_x = 0 and ΣF_y = 0 with the solver's numbers and the actual round-off residual.
- **Method of joints**: find every member force by hand, one joint at a time (at most two unknowns, each assumed in tension). The reactions are given. Each answer is checked against the solver (within 1 % or 0.1 % of the largest force), with a separate verdict for the sign, and "Show the solution" gives the joint's two equations solved. The results stay hidden until every member is found.
- **Solver Explorer**: fourteen stages, from the model, its numbering and degrees of freedom, through member stiffness, the transformation Tᵀ·k·T, assembly (select any entry of K to see the members that add up to it), boundary conditions, partitioning and K_ff, the load vector, the displacements, member forces and reactions, to the equilibrium check. Every matrix is the solver's own. Tables are shown up to 24 degrees of freedom; larger models get the Matrices tab (heatmap). For an unstable model the stages after K_ff are unavailable, because no solution exists.

## Design

- **Materials and sections**: as before (steel, aluminium, Douglas fir or custom; section groups with custom A and I, or a calculator for solid round, CHS, solid rectangle and RHS/SHS using the weak-axis I). The panel shows the structure's mass Σ ρ·A·L, per section group, and says when a material without density leaves members out.
- **Strength and buckling**: every member checked in every combination (or every load case when there are none, or only what is analysed), each state solved directly with λ = 1; for each member the lowest safety factor over the states, its mode and the state that governs. Never a sum of safety factors or utilisations.
- **Deflection**: a criterion you set (see [Deflection](#deflection-the-reference-chord-measure)): two reference nodes, the nodes to check, and a limit as span/ratio or an absolute value. Without one, serviceability is reported as "not configured": TrussLab does not assume a limit.
- **Section sizing**: choose a family for each section group (CHS, SHS, solid rod, sawn timber, or keep), then **Propose sections**. The proposal names, for every group, the governing member, state and check, and why the next lighter section fails; it shows the mass now and proposed, every iteration, and the final verification. **Apply the proposal** (only for an acceptable, converged result) replaces the sections, and Ctrl+Z undoes it. Proposing never changes the model.

## Files and saved sessions

- Model files, exported reports and saved sessions use file format version 2. The model's load cases are saved with their loads and settlements; each support keeps only its type, angle and fixed axes. Since milestone 4 each material also stores its `density` (kg/m³, or `null` when not set), and the self-weight case is saved as `"generated": "self-weight"` without loads, which are computed again when the file is read. Since milestone 5 the model also stores its `combinations` (each with an `id`, a `name` and `terms`: `{ "loadCase": <load case id>, "factor": γ }`) and the `activeCombination` (its id, or `null`). Since milestone 10, a model with a deflection criterion also stores `"design": { "deflection": { "chordA": id, "chordB": id, "nodes": [ids], "limit": { "type": "ratio" | "absolute", "value": v } } }` (the value is a ratio, or metres), written only when a criterion is set. All of these are optional additions to version 2, so the version number did not change: files without them still read. A malformed criterion never stops a file from opening: it is left out, with an import note.
- Opening newer files in an older TrussLab: a milestone 3 copy (Rev 5) still reads files and sessions written by this version, but silently drops what it does not know. Its materials have no density, and the self-weight case becomes an empty ordinary load case named "Self-weight". Structural data and the loads and settlements you entered are kept. If that older copy then saves, the densities and the generated case are gone from the file: back in this version, enter the densities again, delete the empty "Self-weight" case and add the self-weight case again. This applies to the autosaved session too, because every version uses the same key, `trusslab.session.v2`: opening a Rev 5 copy in the same browser rewrites the session in the older form as soon as it saves. In the same way, a milestone 4 copy (Rev 6 or Rev 7) drops the combinations, and a copy from before milestone 10 drops the deflection criterion, from a file or session it saves; everything else is kept.
- **File ▸ Open a file…** reads version 2 and version 1 model files, exported calculation reports (the model is nested under `model`) and saved sessions. A version 1 model is converted on opening:
  - its nodal loads and the settlements of its custom supports become "Load case 1";
  - version 1 ignored settlements on pins and rollers, so they are not applied now either; each one is listed under "Import notes" in Results;
  - if it has a settlement, a one-time notice explains that λ now scales settlements too, so results at λ ≠ 1 differ from version 1. **Got it** dismisses it for good.
- Files written by a newer version of TrussLab (format version 3 or later) are refused with a clear message instead of being half-read.
- The session is autosaved under `trusslab.session.v2`. A version 1 session (`trusslab.session.v1`) is converted once at start-up, with its settings and view; the old key is removed only after the new session has been written, read back unchanged and found to restore the same model. If an existing version 2 session cannot be read, it is kept unchanged under `trusslab.session.v2.unreadable` (or `.2`, `.3`, … if that name is taken) before anything is written over it. The session settings also keep the workspace, Guided or Technical, and the Inspector or Results tab.
- Lesson progress is stored separately, under `trusslab.learn.v1`. If it cannot be read, nothing is written there until the page is reloaded; unreadable stored progress is first copied to `trusslab.learn.v1.unreadable` (an existing copy is never overwritten).
- Import notes are saved with the session, so they are still in Results after the browser restarts; opening another model, an example or a new model replaces them.
- If the browser does not store the session (for example because storage is full or blocked), the status bar says "Changes not saved — browser storage unavailable" until a later save succeeds. If a saved session cannot even be read at start-up, TrussLab starts with an example and writes nothing to browser storage until the page is reloaded, so the stored session is not overwritten.

## Conventions

- Axes: x to the right, y upward, angles counter-clockwise from +x in degrees.
- Loads and reactions are positive in +x / +y. Axial force, stress and strain are positive in tension.
- Calculations and exports use SI base units (m, N, Pa, m², m⁴). Input fields use GPa, MPa, mm², mm⁴. Force and displacement display units are selectable under View.

## Method

1. Element matrix in global axes: `[kᵉ] = (EA/L)[c² cs −c² −cs; cs s² −cs −s²; …]`, where `c = Δx/L`, `s = Δy/L` and `L = hypot(Δx, Δy)`. This avoids the trigonometric round-off of computing cos(atan2(…)).
2. Assembly of the 2n × 2n `[K]` with Neumaier-compensated summation. The result is exactly symmetric.
3. Inclined supports: exact rotation of the nodal frames, `K′ = Λ K Λᵀ`, `F′ = Λ F` (no penalty springs).
4. Partition: `K_ff u_f = λF_f − K_fs(λu_s)`, where λ multiplies the nodal loads F and the prescribed settlements u_s of the active load case. For a combination, F and u_s are first combined, `F = Σ γᵢ·Fᵢ` and `u_s = Σ γᵢ·u_s,ᵢ`, and the combination is solved directly as one action state; λ then multiplies it once. In the generated self-weight case, F holds the end loads `F_y = −W/2` of every member, with `W = ρ·A·L·g` and g = 9.80665 m/s²: for a pin-ended member these are the end reactions of its own uniform weight, so the truss carries the weight as nodal loads and stays axial-only (the member's own bending under its weight is not modelled). The system is linear, so `u(λ) = λ·u(1)`, and member forces and reactions scale by λ as well.
5. **Stability verification before solving**:
   - zero-stiffness DOFs are detected;
   - Jacobi equilibration `K̃ = D^-½ K_ff D^-½`;
   - rank-revealing (pivoted) Cholesky;
   - the determinant is computed in log form, so it cannot overflow;
   - the 1-norm condition number is exact up to 200 free DOFs and estimated with Hager/Higham above that;
   - the Maxwell count m + r − 2j is reported.

   Mechanisms are reported as rigid-body motion, a zero-stiffness joint, or an internal mechanism, and the mode shape is shown.
6. Solve: LU decomposition with partial pivoting, then iterative refinement whose residuals use error-free transformations (Dot2), at about twice double precision.
7. Results:
   - reactions `R = K u − λF`, where `u` holds `λu_s` at the restrained DOFs;
   - member forces `N = (EA/L)[(u₂−u₁)c + (v₂−v₁)s]`;
   - stress `σ = N/A` and strain `ε = ΔL/L`;
   - Euler load `P_cr = π²EI/L²` with K = 1;
   - `SF = min(σy/|σ|, P_cr/|N|)`.

   Status is Safe, Yielded or Buckled.
8. Verification printed with every solve: global equilibrium (ΣFx, ΣFy, ΣM), nodal equilibrium rebuilt from the member forces, backward error, and the LU and Cholesky determinants compared with each other.
9. **Teaching and design read the solver's results; they never solve again.** The worked calculations, predictions, free-body diagrams, the method of joints and the Solver Explorer read the result object of `FEA.analyze()` (its K, K′, K_ff, b_f, u, R, element matrices and member results). The engine was not changed for them: it already returns every intermediate quantity. Design checks and sizing call `FEA.analyze()` once per load case or combination, as the analysis does.

### Section sizing (fully stressed design)

For each sized group, candidates from its family are ordered by linear mass ρ·A (by area when the material has no density). The sizing starts from the lightest candidate of every family and repeats:

1. put the current candidates into a copy of the model (the model itself is never changed);
2. analyse every required state (each combination, or each load case), so the self-weight and, in an indeterminate truss, the force distribution follow the current sections;
3. for every group, take the lightest candidate for which every member, in every state, has A ≥ SF·|N|/σ_y and, in compression, I ≥ SF·|N|·L²/(π²·E) (Euler, K = 1, weak-axis I). A candidate without I is never used in compression.

It stops when the choice repeats (converged), returns to an earlier choice (a cycle), or reaches the iteration limit (20 by default). With a deflection criterion, if the converged design fails it, the group with the largest contribution to the governing deflection per added kilogram (unit-load method: Σ N·n·L/(E·A)) is raised one size, and the strength sizing runs again with that lower bound. This is a deterministic rule of thumb, not a proof of the lightest possible design. A result is acceptable only if it converged and its final analysis passes strength, buckling and the deflection limit in every state; otherwise the status says why (cycle, iteration limit, no candidate large enough, deflection limit not met, unstable) and nothing can be applied.

The catalogue's A and I are computed from nominal dimensions of idealised shapes (sharp corners, no tolerances): an educational catalogue, not a manufacturer's table.

### Deflection: the reference-chord measure

The ratio of the model's horizontal extent to its largest total displacement is not used as a design criterion: it counts support movement and settlement as deflection and mixes directions. Instead you choose two reference nodes A and B (for example the supports of a span) and the nodes to check. For a node P with projection t of its original position on AB:

`u_ref = (1 − t)·u_A + t·u_B`,  `u_rel = u_P − u_ref`,  `δ = |u_rel · n|`

with n the unit normal of the original chord. Any rigid-body movement of the truss (a translation, or a small rotation, such as a settlement that only tilts a determinate truss) moves P exactly like u_ref across the chord, so δ measures deformation only. The limit is span/ratio (span = |AB|) or an absolute value; it is yours to choose, and TrussLab never imposes a universal one.

## Tests

`.claude/skills/trusslab-testing/scripts/check.sh` syntax-checks every `.js` file and runs every headless suite, with Node if installed, otherwise macOS JavaScriptCore:

```bash
node test/fea-core.test.js
# macOS without Node, using the built-in JavaScriptCore engine:
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/fea-core.test.js
```

| Suite | Covers |
|---|---|
| `test/fea-core.test.js` | the engine against closed forms (see below) |
| `test/model.test.js` | `model.js`: parser, sections, load cases, file format version 2 and version 1 import, λ, warnings, saved-session migration and recovery with simulated storage failures, densities and self-weight against hand statics, combinations, the deflection criterion in files, and the nine examples against `test/fixtures/examples-baseline.js` |
| `test/education.test.js` | the guided build, worked calculations (every value the solver's, closed forms for the A-frame), joint equilibrium at every node of every example, predictions and zero-force rules, free-body diagrams, the method of joints reproducing the solver's forces joint by joint, and the Solver Explorer (assembly, Tᵀ·k·T, partitioning, residuals, determinism) |
| `test/design.test.js` | the catalogue, yield and buckling requirements, single-bar sizing (tension- and buckling-controlled), every load case and combination, self-weight iteration, indeterminate trusses, convergence, cycles and the iteration cap, missing I and density, and the reference-chord deflection (closed form, settlements, limits) |
| `test/lessons.test.js` | the lesson format, worked examples against closed forms, challenge criteria, quiz answers, and lesson-progress storage with failures simulated |

Each prints one line per check and exits with a non-zero code if any check fails.

### Accuracy checks performed

| Case | Reference | Max. relative error |
|------|-----------|---------------------|
| 3-4-5 A-frame, P = 100 kN | F = −62.5 kN, u_y = −1.953125 mm (closed form) | 1.2e-16 |
| Symmetric 3-bar indeterminate truss | closed form | 3.1e-16 |
| Inclined roller at 30° | statics by hand | 3.4e-14 (cancellation in a small reaction) |
| Prescribed displacement of a bar | F = EAδ/L | 0 |
| Settlement of a determinate truss | all member forces zero | forces ≈ 1e-27 N, classified zero-force |
| Indeterminate X-braced truss with settlement (degree 2) | exact rational solution (Python `fractions`) | u 8e-17, F 6e-16, R 4e-15 |
| Square without diagonal, unsupported triangle, collinear joint | must be rejected as unstable | detected and classified correctly |
| 301-node Warren truss (599 free DOFs) | equilibrium | backward error 2.5e-17, solved in about 0.3 s |

All of them except the X-braced truss are automated in `test/fea-core.test.js`.

## Browser smoke test

`test/browser-smoke.js` checks the user interface in a real browser. Open `index.html`, add `?smoke` to the end of the address, and press Enter. Keep the tab in front and don't touch the page while it runs (about ten seconds). Browsers pause animation frames in background tabs, and the app solves and draws on them.

A panel in the top-right corner lists every check as PASS, FAIL or SKIP and ends with an overall verdict. The same lines go to the browser console, prefixed `[smoke]`, and the summary is left in `window.TrussLabSmokeResult`. `.claude/skills/trusslab-testing/scripts/browser_check.py` runs both modes in headless Google Chrome and prints the verdicts (see `docs/development/local-testing.md`).

It drives the real app through its own event handlers. It covers start-up and the examples; the tool shortcuts; adding nodes, members and loads against hand statics; an unstable support change; undo and redo; selection, dragging, Delete and box selection; keyboard behaviour on focused controls; the D, G and ? shortcuts; the section-group radios, the data drawer, the matrices, the Export menu and the side-panel button; load cases, λ, settlements, custom supports, self-weight and combinations; import notes, saved-session migration and failures (on the smoke-test keys only), autosave and opening files; and, since milestones 6 to 11, the workspaces and Guided/Technical (which must not change the model or the results), menus and keyboard tabs, the view-only phone mode (every edit refused), the guided first truss, the worked calculations, prediction (results hidden until checked), the free-body diagram, the method of joints, the Solver Explorer, the design checks, the deflection criterion and sizing (with undo), and a lesson with its progress.

**Your work is not touched.** With `?smoke`, the app keeps its sessions and lesson progress under separate storage keys (`trusslab.smoke-test.session.v2`, `trusslab.smoke-test.learn.v1` and so on), so your saved sessions, backups and lesson progress are never loaded or written. The test checks at the end that every one of them is unchanged. Close any other TrussLab tabs first, since they write your session too. The full in-memory state is captured before the first check and restored afterwards, even when a check fails, and pending autosaves are cancelled. `index.html?smoke=selftest` adds one deliberately failing scenario to show this. There, the verdict is PASS only if exactly that scenario fails and every clean-up check still passes.

The test reads the app through `window.TrussLabTest`, a small adapter that `script.js` installs only in smoke mode. It returns copies, never live objects. The older `window.TrussLab` hook is unchanged.

**Limits of synthetic events:**

- `canvas.setPointerCapture()` is replaced by a no-op during the run, because browsers refuse pointer capture for synthetic pointers. Native pointer capture is not tested.
- Synthetic key presses have no default action. The test checks that the app leaves Enter, Space and the arrow keys alone on focused controls; it cannot check that the browser then presses the button or moves the slider.
- The side-panel button has a wide-window branch and a narrow-window branch (1100 px or less). Only the branch matching the current window width runs. The phone layout's view-only behaviour is tested by forcing it on; the phone layout itself needs a narrow window.
- Browsers without `DataTransfer` report the file-opening checks as SKIP, and browsers that do not expose `Storage` report the saved-session checks as SKIP.

## Assumptions and limitations

- Pin-jointed members carry axial force only. Loads act at nodes only: self-weight too, lumped as half of each member's weight at each end node. No distributed loads, temperature, or geometric or material non-linearity. 2D only; no beams, frames or dynamics.
- Linear (small-displacement) theory: equilibrium is written in the undeformed geometry.
- Euler buckling assumes ideal pin-ended members (K = 1) about the axis of the entered I. If σ_cr exceeds σy, yielding governs. Code resistance factors, imperfections and inelastic buckling are not applied.
- The design checks and the sizing are educational: no design code, resistance factors, connection design or code load combinations. A deflection limit is only what you set.
- Douglas Fir limit stress: timber has no yield point. The preset uses 49.9 MPa, the clear-wood compressive strength parallel to grain at 12 % moisture content ([USDA Wood Handbook](https://www.fpl.fs.usda.gov/documnts/fplgtr/fplgtr190/chapter_05.pdf), coast Douglas-fir). Graded lumber design values are much lower, so edit this for your grade and design code.
- Douglas Fir density: the preset's 540 kg/m³ is an approximate representative value at 12 % moisture content. Coast Douglas-fir has a specific gravity of 0.48 at 12 % moisture content (USDA Forest Products Laboratory, *Wood Handbook*, 2021, Table 5–3b), so its density at 12 % is 1000 kg/m³ × 0.48 × 1.12 = 537.6 kg/m³, rounded to 540. Timber density varies with species, growth and moisture; enter your own value if you know it.

## Licence

TrussLab is released under MIT-0 (see `LICENCE.md`). Third-party material in this repository keeps its own licence and is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md): the IBM Plex fonts (SIL Open Font License 1.1, `fonts/OFL.txt`) and Anthropic's `frontend-design` Skill (Apache 2.0).
