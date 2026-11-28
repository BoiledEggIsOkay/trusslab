# Progress: milestones 5–11 (continuous assignment)

Working log for the assignment that implemented milestones 6–11 in one pass, on top of the milestone 5 baseline, so that a new session (or a compacted context) can pick up where the work stopped. Detailed rules live in the Skills and their references.

Started on top of `b2bd934` (Rev 9). **Nothing was committed or pushed during this assignment**: the maintainer reviews and commits.

## Status

| Milestone | Status | Notes |
|---|---|---|
| 5 Load combinations | verified baseline | Combination tests already cover closed forms, settlements, the never-sum rule, independent results, persistence, malformed files and the nine examples; no correction needed |
| 6 UI/UX redesign (Midnight Engineering Lab) | implemented | tokens and stylesheet rewritten (`docs/design/tokens.md`); IBM Plex bundled; header with Learn / Analyze / Design and Guided / Technical; context bar; tool rail; View popover; Inspector / Results tabs; data drawer closed by default; one panel at a time ≤ 1100 px; phone view-only ≤ 640 px; guided first truss |
| 7 Prediction mode, worked calculations | implemented | `TrussEducation.memberCalc`, `nodeCalc`, `jointForces`, `checkPredictions`, `zeroForceRule`; Inspector calculations; prediction activity with every result hidden until checked |
| 8 Free-body diagrams, method of joints | implemented | `fbd`, `jointExercise`, `nextJoint`, `checkJointAnswers`; SVG free-body diagram; joint-by-joint exercise with hidden results |
| 9 Solver Explorer | implemented | fourteen stages over the solver's own matrices; entry contributions; DOF overlay; size guidance (24 DOFs) |
| 10 Sizing and deflection | implemented | `design.js`: catalogue, checks over every state, fully stressed sizing with cap, cycle detection and explicit statuses, reference-chord deflection; optional version 2 field `design` |
| 11 Lessons | implemented | `lessons.js`: six lessons in the full format, worked examples from the solver, objective challenges, progress under `trusslab.learn.v1` |

## Decisions

- **No engine change.** `FEA.analyze()` already returns every intermediate quantity (`K`, `Kt`, `Kff`, `bf`, `F`, `Ft`, `free`, `fixed`, `u`, `ut`, `R`, `Rt`, per member `ke`, `dofs`, `elong`, `force`, `Pcr`, …), so no instrumentation was added; `fea-core.js` is byte-for-byte unchanged.
- **New DOM-free files**, in this load order: `fea-core.js`, `model.js`, `education.js` (`TrussEducation`), `design.js` (`TrussDesign`), `lessons.js` (`TrussLessons`), `script.js`. New page code is in `script.js` sections 18 (workspaces, modes, menus, layout, view-only), 19 (Learn) and 20 (Design); the testing adapter stays section 17.
- **Fonts.** IBM Plex Sans 400/500/600 (Latin-1, Pi, Greek) and Plex Mono 400/500 (Latin-1, Pi) from the official release assets, unmodified, in `fonts/` with `OFL.txt`; hashes in `THIRD_PARTY_NOTICES.md`. Plex Mono has no Greek, so equations use Plex Sans with tabular figures.
- **Results are hidden** while a prediction or a method-of-joints exercise is open (`resultsHidden()`, applied in `R()` and in every view that reads `state.res` directly).
- **Phones are view-only**, enforced at every edit entry point; forms render disabled.
- **Deflection** uses the reference-chord measure, agreed in the assignment brief; the extent ratio is never a criterion. When deflection governs sizing, the group with the largest unit-load contribution per added mass is stepped up: a documented heuristic.
- **File format** stays version 2: `design.deflection` is optional and written only when set; older readers drop it (documented downgrade limitation).
- **Lesson progress** has its own key with the session's safety rules (no write after a failed read, unreadable text backed up once, verified write).
- **Browser verification** in headless Google Chrome through `.claude/skills/trusslab-testing/scripts/browser_check.py` (stdlib-only DevTools client, throwaway profile). Safari and Firefox were not driven.

## Bugs found and fixed along the way

- The model summary in the Inspector showed the previous model's Maxwell count after opening a model (it was drawn before the solve): it is now redrawn after each solve when nothing is selected. This predates the assignment.
- Sizing: the serviceability loop was capped at 20 steps and kept the strength phase's "converged" status when it stopped; it is now bounded by the available size steps and reports `deflection-not-met`.
- The deflection editor kept stale node references after undo or redo; it now rebuilds itself from the model.
- Lesson 3's first challenge was impossible (a two-bar frame on a pin and a roller is a mechanism); it became the lesson's point: add the tie.

## Tests run (final)

| What | Where | Result |
|---|---|---|
| `check.sh` | jsc (no Node on this machine) | fea-core 41/41, model 722/722, education 157/157, design 61/61, lessons 58/58 |
| `index.html?smoke` | headless Chrome (`browser_check.py`) | PASS 314 passed, 0 failed, 1 skipped (the narrow-window side-panel branch) |
| `index.html?smoke=selftest` | headless Chrome | PASS: 315 passed, the 1 deliberate failure, 1 skipped |
| Mutation checks in isolated copies | jsc and headless Chrome | each meaningful mutation caught (see the testing Skill) |
| Screenshots | headless Chrome, 1440, 1280, 1024, 820 and 390 px | reviewed; issues found were fixed (see the report) |

## Not verified

- Safari and Firefox (fonts from `file://`, layout, smoke test): to be run by hand (`docs/development/local-testing.md`).
- A physical phone or tablet (real touch, pinch zoom): only emulated in headless Chrome.
- Node.js runs of the suites (not installed here); jsc only.
