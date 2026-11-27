# TrussLab: 2D Truss FEA & Load Simulator

An interactive browser application for linear-elastic analysis of pin-jointed plane trusses by the Direct Stiffness Method. It runs entirely in the browser with no build step, no server and no external libraries.

## Running it

Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari). Double-clicking the file works (`file://`). You can also serve the folder:

```bash
python3 -m http.server 8000   # then browse to http://localhost:8000
```

| File | Purpose |
|------|---------|
| `index.html` | Page layout, panels and help dialog |
| `style.css` | Dark CAD-style theme |
| `fea-core.js` | Numerical engine (no DOM). Usable from Node: `require('./fea-core.js').analyze(input)` |
| `model.js` | Model layer (no DOM): expression parser, materials and sections, model objects, the file format, the examples, and the solver input. Usable from Node: `require('./model.js')` |
| `script.js` | Editor, canvas rendering, inspector, tables, matrix inspector and exports |
| `test/fea-core.test.js` | Regression tests for the numerical engine (see [Accuracy checks performed](#accuracy-checks-performed)) |
| `test/model.test.js` | Headless tests for `model.js`, including the results of all nine examples against `test/fixtures/examples-baseline.js` |
| `test/browser-smoke.js` | Browser smoke test of the user interface, run with `index.html?smoke` (see [Browser smoke test](#browser-smoke-test)) |

The session (model, view, settings) is autosaved in the browser's `localStorage` (see [Files and saved sessions](#files-and-saved-sessions)).

## Using it

- **Examples…** loads ready-made structures: Pratt, Howe and Warren trusses, an A-frame with a closed-form answer, a cantilever, a Fink roof truss in timber, an inclined roller, a support settlement, and an unstable mechanism.
- Tools: `V` select/move, `N` node, `M` member (chains; clicking empty space creates a node), `S` support, `L` load, `H` pan. Wheel zooms at the cursor. Middle or right drag pans.
- Snap grid: 0.1 / 0.25 / 0.5 / 1.0 / 2.0 m. Snapped coordinates are the doubles nearest to k·step (for example exactly `0.3`, not `0.30000000000000004`).
- Exact input: every numeric field accepts expressions, for example `2*sqrt(3)`, `12/7`, `10*cos(30)` (trig in degrees).
- Supports: pin, roller (u_y = 0), roller (u_x = 0), inclined roller at angle α, and custom supports that fix x′ and/or y′ of a frame rotated by α. A custom support with neither axis fixed restrains nothing, and TrussLab warns about it.
- Load cases: nodal loads and support settlements belong to a load case. **+ New** adds an empty case and makes it active; the list switches between cases, the name field renames the active case, and **Delete** removes it (Ctrl+Z undoes it; the last case cannot be deleted). The active case is the one you edit and analyse. Switching cases is not an edit, so it is not undone; undo keeps the case you are looking at whenever it still exists.
- Settlements: any fixed axis of any support can settle (Inspector, "Settlement in …"). A settlement is measured along the support's own axes x′, y′. A settlement on an axis that is not fixed, or on a node with no members, has no effect, and TrussLab warns about it.
- Materials: Structural Steel (E 200 GPa, σy 250 MPa), 6061-T6 Aluminum (E 68.9 GPa, σy 276 MPa), Douglas Fir (E 11 GPa), or custom.
- Sections: section groups with custom A and I, or a calculator for solid round, CHS, solid rectangle and RHS/SHS. The calculator uses the weak-axis I.
- Load factor λ scales every action of the active load case live: nodal loads and prescribed settlements alike. Because the model is linear, displacements, member forces and reactions scale by λ too. At λ = 0 there are no actions, so a stable structure has no displacements, member forces or reactions; a mechanism stays unstable at any λ.
- Deflection scale runs 1× to 1000× on the slider (typed values up to 10⁶), with an Auto mode.
- Bottom panel: member table, node and reaction table, stiffness matrix inspector ([K], rotated [K′], reduced [K_ff] with {F_eff} and {u_f}, element [kᵉ]; table or heatmap), and the solver log.
- Export: calculation report (CSV / JSON), system matrices (CSV / JSON), PNG image, and the model file (JSON; re-open with **Open…**). Reports and matrices name the analysed load case and list the loads and settlements as applied, that is multiplied by λ.

## Files and saved sessions

- Model files, exported reports and saved sessions use file format version 2. The model's load cases are saved with their loads and settlements; each support keeps only its type, angle and fixed axes.
- **Open…** reads version 2 and version 1 model files, exported calculation reports (the model is nested under `model`) and saved sessions. A version 1 model is converted on opening:
  - its nodal loads and the settlements of its custom supports become "Load case 1";
  - version 1 ignored settlements on pins and rollers, so they are not applied now either; each one is listed under "Import notes" in the health report;
  - if it has a settlement, a one-time notice explains that λ now scales settlements too, so results at λ ≠ 1 differ from version 1. **Got it** dismisses it for good.
- Files written by a newer version of TrussLab (format version 3 or later) are refused with a clear message instead of being half-read.
- The session is autosaved under `trusslab.session.v2`. A version 1 session (`trusslab.session.v1`) is converted once at start-up, with its settings and view; the old key is removed only after the new session has been written, read back unchanged and found to restore the same model. If an existing version 2 session cannot be read, it is kept unchanged under `trusslab.session.v2.unreadable` (or `.2`, `.3`, … if that name is taken) before anything is written over it.
- Import notes are saved with the session, so they are still in the health report after the browser restarts; opening another model, an example or a new model replaces them.
- If the browser does not store the session (for example because storage is full or blocked), the status bar says "Changes not saved — browser storage unavailable" until a later save succeeds. If a saved session cannot even be read at start-up, TrussLab starts with an example and writes nothing to browser storage until the page is reloaded, so the stored session is not overwritten.

## Conventions

- Axes: x to the right, y upward, angles counter-clockwise from +x in degrees.
- Loads and reactions are positive in +x / +y. Axial force, stress and strain are positive in tension.
- Calculations and exports use SI base units (m, N, Pa, m², m⁴). Input fields use GPa, MPa, mm², mm⁴. Force and displacement display units are selectable.

## Method

1. Element matrix in global axes: `[kᵉ] = (EA/L)[c² cs −c² −cs; cs s² −cs −s²; …]`, where `c = Δx/L`, `s = Δy/L` and `L = hypot(Δx, Δy)`. This avoids the trigonometric round-off of computing cos(atan2(…)).
2. Assembly of the 2n × 2n `[K]` with Neumaier-compensated summation. The result is exactly symmetric.
3. Inclined supports: exact rotation of the nodal frames, `K′ = Λ K Λᵀ`, `F′ = Λ F` (no penalty springs).
4. Partition: `K_ff u_f = λF_f − K_fs(λu_s)`, where λ multiplies the nodal loads F and the prescribed settlements u_s of the active load case. The system is linear, so `u(λ) = λ·u(1)`, and member forces and reactions scale by λ as well.
5. **Stability verification before solving**:
   - zero-stiffness DOFs are detected;
   - Jacobi equilibration `K̃ = D^-½ K_ff D^-½`;
   - rank-revealing (pivoted) Cholesky;
   - the determinant is computed in log form, so it cannot overflow;
   - the 1-norm condition number is exact up to 200 free DOFs and estimated with Hager/Higham above that;
   - the Maxwell count m + r − 2j is reported.

   Mechanisms are reported as rigid-body motion, a zero-stiffness joint, or an internal mechanism, and the mode shape is animated.
6. Solve: LU decomposition with partial pivoting, then iterative refinement whose residuals use error-free transformations (Dot2), at about twice double precision.
7. Results:
   - reactions `R = K u − λF`, where `u` holds `λu_s` at the restrained DOFs;
   - member forces `F = (EA/L)[(u₂−u₁)c + (v₂−v₁)s]`;
   - stress `σ = F/A` and strain `ε = ΔL/L`;
   - Euler load `P_cr = π²EI/L²` with K = 1;
   - `SF = min(σy/|σ|, P_cr/|F|)`.

   Status is Safe, Yielded or Buckled.
8. Verification printed with every solve: global equilibrium (ΣFx, ΣFy, ΣM), nodal equilibrium rebuilt from the member forces, backward error, and the LU and Cholesky determinants compared with each other.

## Accuracy checks performed

These checks were run against `fea-core.js` during development. All of them except the X-braced truss are automated in `test/fea-core.test.js`. Run it from the project folder:

```bash
node test/fea-core.test.js
# macOS without Node, using the built-in JavaScriptCore engine:
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/fea-core.test.js
```

It prints one line per check and exits with a non-zero code if any check fails. `test/model.test.js` covers `model.js` (the expression parser, section properties, load cases, file format version 2 and the import of version 1 files, reports and sessions, λ scaling of loads and settlements, the model warnings, saved-session migration and recovery with simulated storage failures, the solver input, and the nine examples at λ = 1) and runs the same way.

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

## Browser smoke test

`test/browser-smoke.js` checks the user interface in a real browser. Open `index.html`, add `?smoke` to the end of the address, and press Enter. Keep the tab in front and don't touch the page while it runs (a few seconds). Browsers pause animation frames in background tabs, and the app solves and draws on them.

A panel in the top-right corner lists every check as PASS, FAIL or SKIP and ends with an overall verdict. The same lines go to the browser console, prefixed `[smoke]`, and the summary is left in `window.TrussLabSmokeResult`.

It drives the real app through its own event handlers. It sends pointer events to the canvas, key presses to the page and to focused controls, clicks buttons, and changes fields. It covers:

- start-up and the Examples menu;
- the tool shortcuts;
- adding nodes (with grid snapping), members (chained, ended with Esc) and loads, checked against hand statics;
- a support change that makes the truss unstable, which must be reported, not solved;
- undo and redo (keys and buttons);
- click, drag, Delete and box selection;
- arrow-key nudging, and Enter/Space/arrow keys on focused controls being left to those controls;
- the D, G and ? shortcuts;
- the section-group radios, the bottom tabs and matrix inspector, the Export menu and the side-panel button;
- load cases: adding, renaming, switching (not undoable) and deleting, and undo keeping the case on screen;
- λ scaling a settlement, λ = 0 on a stable structure and on a mechanism;
- the warning for a custom support that restrains nothing;
- the λ notice when opening version 1 files and reports with and without a settlement;
- switching a support to Custom without turning its frame (0° included) or its settlement;
- import notes kept after a save and restart, restored by undo, and cleared by a new model;
- migration of a version 1 session, a session that cannot be read, and the "Changes not saved" notes, with storage failures simulated on the smoke-test keys only;
- autosave;
- opening a saved session and a format-version-1 model file through the Open… file input.

**Your work is not touched.** With `?smoke`, the app keeps its sessions under separate storage keys (`trusslab.smoke-test.session.v2` and so on), so your saved sessions (`trusslab.session.v2`, `trusslab.session.v1` and any `trusslab.session.v2.unreadable` backups) are never loaded or written. The test checks at the end that every one of them is unchanged. Close any other TrussLab tabs first, since they write your session too. The full in-memory state is captured before the first check and restored afterwards, even when a check fails, and pending autosaves are cancelled. `index.html?smoke=selftest` adds one deliberately failing scenario to show this. There, the verdict is PASS only if exactly that scenario fails and every clean-up check still passes.

The test reads the app through `window.TrussLabTest`, a small adapter that `script.js` installs only in smoke mode. It returns copies, never live objects. The older `window.TrussLab` hook is unchanged.

**Limits of synthetic events:**

- `canvas.setPointerCapture()` is replaced by a no-op during the run, because browsers refuse pointer capture for synthetic pointers. Native pointer capture is not tested.
- Synthetic key presses have no default action. The test checks that the app leaves Enter, Space and the arrow keys alone on focused controls; it cannot check that the browser then presses the button or moves the slider.
- The side-panel button has a wide-window branch and a narrow-window branch (920 px or less). Only the branch matching the current window width runs.
- Browsers without `DataTransfer` report the file-opening checks as SKIP, and browsers that do not expose `Storage` report the saved-session checks as SKIP.

## Assumptions and limitations

- Pin-jointed members carry axial force only. Loads act at nodes only. No self-weight, temperature, or geometric or material non-linearity.
- Linear (small-displacement) theory: equilibrium is written in the undeformed geometry.
- Euler buckling assumes ideal pin-ended members (K = 1) about the axis of the entered I. If σ_cr exceeds σy, yielding governs. Code resistance factors and inelastic buckling are not applied.
- Douglas Fir limit stress: timber has no yield point. The preset uses 49.9 MPa, the clear-wood compressive strength parallel to grain at 12 % moisture content ([USDA Wood Handbook](https://www.fpl.fs.usda.gov/documnts/fplgtr/fplgtr190/chapter_05.pdf), coast Douglas-fir). Graded lumber design values are much lower, so edit this for your grade and design code.

## Licence

TrussLab is released under MIT-0 (see `LICENCE.md`). Third-party material in this repository keeps its own licence and is listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
