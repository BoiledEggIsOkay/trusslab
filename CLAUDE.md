# TrussLab: working notes for Claude

TrussLab is a browser app for linear-elastic analysis of 2D pin-jointed trusses by the Direct Stiffness Method. It is being extended, one reviewed milestone at a time, into a tool for learning and design that teaches from the mathematics the solver actually performs. `README.md` is the user documentation; this file is the working agreement for changing the code.

## Skills in this repository

Load the matching skill before you start; they hold the detail this file only summarises.

- `trusslab-milestone-workflow`: how every milestone, bug fix or refactor is planned, verified, reported and committed.
- `trusslab-architecture`: files, globals, script order, and the rules for DOM-free code.
- `trusslab-engineering-rules`: the structural model, units, signs and engineering restrictions, with references for the model and save-file format, the analysis mathematics, and the design conventions.
- `trusslab-testing`: the headless suites, the browser smoke test, regression-test discipline, and `scripts/check.sh`.

Skills for the user interface and for education will be added when those systems are built.

## Hard constraints

The app must keep working when someone double-clicks `index.html` (a `file://` page) with nothing installed. That rules out a build step, npm or any package manager, frontend frameworks, ES modules (`import`/`export`), `fetch()` of application data, JSON files loaded at runtime, servers and backends, external APIs, and remotely hosted fonts, scripts or stylesheets. Use classic `<script>` files in a fixed order that share explicitly named globals, and keep data in JavaScript registries. A feature that genuinely needs a network or a backend is documented as an optional extension, never made a dependency. A local HTTP server may be used as a testing workaround (see `docs/development/local-testing.md`), but the app must never require one.

Keep `fea-core.js` one self-contained file. Change its mathematical formulation only with a stated reason, documentation, and regression tests. New model, education and design logic must not touch the DOM, so that it can be tested headlessly like the engine.

## The structural model

2D, linear-elastic, small-displacement, pin-jointed truss analysed by the Direct Stiffness Method. Members carry axial force only: never add bending to a truss member or suggest the model is 3D. Euler buckling uses the pin-ended assumption, K = 1. Support restraints act along the x′, y′ axes of a nodal frame rotated by α. Formulas, conventions and the rules for upcoming features are in `trusslab-engineering-rules`.

## Engineering restrictions

- The existing horizontal-extent / maximum-total-displacement ratio is not approved as a general structural design acceptance criterion. Do not implement the design deflection check until a physically appropriate measure has been agreed upon and documented.
- Never add safety factors, utilisations or member classifications across load cases or combinations. Solve each combination directly and take the worst governing value.
- Until milestone 3, λ scales nodal loads but not prescribed settlements. Milestone 3 changes this on purpose so that λ scales both.

## Current code

| Global | Defined in | Notes |
|---|---|---|
| `FEA` | `fea-core.js` | Numerical engine; also `module.exports` under Node |
| `TrussLab` | `script.js` (end) | Older test hook that exposes live internal state. Keep it unchanged for compatibility; new code and tests must not depend on it |
| `TrussLabTest` | `script.js` section 17 | Testing adapter, version 1, installed only in smoke mode (`?smoke`) |

Script order in `index.html`: `fea-core.js`, then `script.js`.

## Tests

- Headless: `.claude/skills/trusslab-testing/scripts/check.sh` syntax-checks every `.js` file and runs every `test/*.test.js` suite. Today that is `test/fea-core.test.js`, with 41 checks.
- Browser smoke test (`test/browser-smoke.js`), in two modes:
  - `index.html?smoke` runs every scenario against the real page and must end with PASS.
  - `index.html?smoke=selftest` adds one deliberately failing scenario. It ends with PASS only if exactly that scenario fails and every clean-up check still passes, which shows that a failing test cannot damage the user's work.
- Report browser verification only when it has actually been performed in a browser. If no browser is available, say so, list the smoke test as unverified, and give the user the manual verification steps in `docs/development/local-testing.md`.

## Roadmap

Done:
- `81eac1c` Rev 1: review fixes, numerical test suite, licence, `.gitignore`.
- `0bb4657` Rev 2, milestone 1: browser smoke test and the `TrussLabTest` adapter.
- `0e3dbae` Rev 3: the D and G shortcuts refresh the legend and autosave.

Next, strictly one at a time, each approved before the next begins:
2. DOM-free model layer: `model.js` (global `TrussModel`) and `test/model.test.js`. No behaviour change; file format version 1 unchanged.
3. Load cases. Settlements move from supports into load cases, and λ scales loads and settlements. File format version 2, which must keep reading, with a migration test for each:
   - existing version 1 model files;
   - autosaved sessions in `localStorage` (`trusslab.session.v1`, which wrap the model together with settings and view);
   - exported calculation-report files, which nest the model under `model`.
4. Material density and a generated self-weight load case.
5. Load combinations solved directly, with worst-case results.
6. Prediction mode and worked calculations in the Inspector.
7. Free-body diagram of a joint (method of joints).
8. Solver Explorer for small models.
9. Section sizing. The design deflection check comes only after a physically appropriate deflection measure has been agreed and documented (see Engineering restrictions).
10. A small lesson format and the first lessons.

Not planned for now: an AI tutor, beam or frame elements, 3D, dynamics, brute-force optimisation, automated grading of written reasoning, gamification.

Update this section whenever a milestone is committed.

## Working agreement

- One step at a time. After each step, report the files changed, the test results and what is still unverified, then wait for review.
- Commits go directly to `main`. The maintainer often commits and pushes reviewed work themselves, so check `git log` before committing. Never amend, rebase or force-push commits that are already on `origin`.
- Never claim browser testing that did not happen.
- Machine-specific setup (opening the app from protected macOS folders, browser permissions, the optional local server) is in `docs/development/local-testing.md`.
