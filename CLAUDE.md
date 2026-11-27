# TrussLab: working notes for Claude

TrussLab is a browser app for linear-elastic analysis of 2D pin-jointed trusses by the Direct Stiffness Method. It is being extended, one reviewed milestone at a time, into a tool for learning and design that teaches from the mathematics the solver actually performs. `README.md` is the user documentation; this file is the working agreement for changing the code.

## Skills in this repository

Load the matching skill before you start; they hold the detail this file only summarises.

- `trusslab-milestone-workflow`: how every milestone, bug fix or refactor is planned, verified, reported and committed.
- `trusslab-architecture`: files, globals, script order, and the rules for DOM-free code.
- `trusslab-engineering-rules`: the structural model, units, signs and engineering restrictions, with references for the model and save-file format, the analysis mathematics, and the design conventions.
- `trusslab-testing`: the headless suites, the browser smoke test, regression-test discipline, and `scripts/check.sh`.
- `trusslab-ui-design`: information architecture, visual hierarchy, design tokens, accessibility, keyboard and responsive rules for the TrussLab interface, the element names and wording the smoke test relies on, and the process for the UI/UX redesign milestone. Use it before any change to `index.html`, `style.css` or the page-facing parts of `script.js`, for wireframes and mock-ups, and for any educational interface.
- `frontend-design`: Anthropic's general skill for deliberate, non-generic visual design, vendored unmodified under Apache 2.0 (source, commit and hashes in its `UPSTREAM.md`). Read it through `trusslab-ui-design`, which takes precedence for TrussLab. Never edit the vendored files.

A skill for the education system will be added when that system is built.

## Hard constraints

The app must keep working when someone double-clicks `index.html` (a `file://` page) with nothing installed. That rules out a build step, npm or any package manager, frontend frameworks, ES modules (`import`/`export`), `fetch()` of application data, JSON files loaded at runtime, servers and backends, external APIs, and remotely hosted fonts, scripts or stylesheets. Use classic `<script>` files in a fixed order that share explicitly named globals, and keep data in JavaScript registries. A feature that genuinely needs a network or a backend is documented as an optional extension, never made a dependency. A local HTTP server may be used as a testing workaround (see `docs/development/local-testing.md`), but the app must never require one.

Keep `fea-core.js` one self-contained file. Change its mathematical formulation only with a stated reason, documentation, and regression tests. New model, education and design logic must not touch the DOM, so that it can be tested headlessly like the engine.

## The structural model

2D, linear-elastic, small-displacement, pin-jointed truss analysed by the Direct Stiffness Method. Members carry axial force only: never add bending to a truss member or suggest the model is 3D. Euler buckling uses the pin-ended assumption, K = 1. Support restraints act along the x′, y′ axes of a nodal frame rotated by α. Formulas, conventions and the rules for upcoming features are in `trusslab-engineering-rules`.

## Engineering restrictions

- The existing horizontal-extent / maximum-total-displacement ratio is not approved as a general structural design acceptance criterion. Do not implement the design deflection check until a physically appropriate measure has been agreed upon and documented.
- Never add safety factors, utilisations or member classifications across load cases or combinations. Solve each combination directly and take the worst governing value.
- Since milestone 3, λ scales every action of the active load case: nodal loads and prescribed settlements alike. λ = 0 gives zero results only for a stable model; a mechanism stays unstable at any λ.

## Current code

| Global | Defined in | Notes |
|---|---|---|
| `FEA` | `fea-core.js` | Numerical engine; also `module.exports` under Node |
| `TrussModel` | `model.js` | DOM-free model layer: parser, materials and sections, model objects and load cases, material densities and the generated self-weight case (`memberSelfWeight`, `selfWeightLoads`, `caseLoads`, `selfWeightSummary`), file format version 2 (`readModel` also reads version 1 files, reports and sessions), `validateModel`, examples, `toAnalysisInput`, saved-session storage with injected `Storage` (`loadStoredSession`, `saveStoredSession`); also `module.exports` under Node |
| `TrussLab` | `script.js` (end) | Older test hook that exposes live internal state. Keep it unchanged for compatibility; new code and tests must not depend on it |
| `TrussLabTest` | `script.js` section 17 | Testing adapter, version 2, installed only in smoke mode (`?smoke`) |

Script order in `index.html`: `fea-core.js`, `model.js`, then `script.js`.

Saved sessions live in `localStorage` under `trusslab.session.v2`; `trusslab.session.v1` is migrated once and removed only after a verified version 2 write, and an unreadable version 2 session is kept under `trusslab.session.v2.unreadable` (`.2`, `.3`, …). Smoke mode uses the `trusslab.smoke-test.session.*` keys and never touches the user's.

## Tests

- Headless: `.claude/skills/trusslab-testing/scripts/check.sh` syntax-checks every `.js` file and runs every `test/*.test.js` suite. Today that is `test/fea-core.test.js` (41 checks) and `test/model.test.js` (563 checks, including the nine examples at λ = 1 against the regression baseline in `test/fixtures/examples-baseline.js`).
- Browser smoke test (`test/browser-smoke.js`), in two modes:
  - `index.html?smoke` runs every scenario against the real page and must end with PASS.
  - `index.html?smoke=selftest` adds one deliberately failing scenario. It ends with PASS only if exactly that scenario fails and every clean-up check still passes, which shows that a failing test cannot damage the user's work.
- Report browser verification only when it has actually been performed in a browser. If no browser is available, say so, list the smoke test as unverified, and give the user the manual verification steps in `docs/development/local-testing.md`.

## Roadmap

Done:
- `81eac1c` Rev 1: review fixes, numerical test suite, licence, `.gitignore`.
- `0bb4657` Rev 2, milestone 1: browser smoke test and the `TrussLabTest` adapter.
- `0e3dbae` Rev 3: the D and G shortcuts refresh the legend and autosave.
- `3b88695`, `1a0b122`: `CLAUDE.md`, the project Skills, local testing notes, the vendored `frontend-design` Skill, `trusslab-ui-design` and the redesign milestone.
- `4712cba` Rev 4, milestone 2: DOM-free model layer. `model.js` (global `TrussModel`) with `toAnalysisInput`, `test/model.test.js` (206 checks) and the example baseline `test/fixtures/examples-baseline.js`. No behaviour change; file format version 1 unchanged.
- `dac8c99` Rev 5, milestone 3: load cases. Loads and settlements belong to load cases; supports keep only their restraint (type, angle, fixed axes). λ scales loads and settlements. File format version 2, reading version 1 model files, report files and autosaved sessions (with migration tests for each); verified session migration, backups of unreadable sessions, no writes after a failed read, import notes kept with the session, "Changes not saved — browser storage unavailable" status notes; model warnings (`validateModel`); `TrussLabTest` version 2.
- `1e4820c` Rev 6, milestone 4: material density and the generated self-weight load case. Materials carry a density ρ in kg/m³ (presets: steel 7850, aluminium 2700, Douglas fir 540; none for a custom material or for materials read from older files). **+ Self-weight case** adds one generated dead-load case: W = ρ·A·L·g (g = 9.80665 m/s²) per member, W/2 downward at each end node, computed from the current model whenever it is read, never stored, so it cannot go stale or accumulate; manual loads and settlements are refused in it. Saved as additive optional fields of file format version 2 (`density`, `"generated": "self-weight"`). Warnings for materials without density.
- Milestone 4 decisions (maintainer, final): file format stays version 2 with optional fields, no new session key, and the downgrade limitation for a milestone 3 build is documented (README, `model-format.md` §8). Missing densities are never filled in from a preset, even when E and σy match it, and a self-weight case with a member lacking density is marked incomplete wherever it is shown (`selfWeightSummary`: health report, node Inspector, canvas HUD, report exports). Douglas fir 540 kg/m³ is labelled an approximate representative value at 12 % moisture content (USDA FPL *Wood Handbook* 2021, Table 5–3b: specific gravity 0.48; 1000 × 0.48 × 1.12 = 537.6, rounded).

Next, strictly one at a time, each approved before the next begins:
5. Load combinations solved directly, with worst-case results.
6. UI/UX redesign, before any educational interface (follow `trusslab-ui-design`):
   - audit the complete existing UI and identify the sources of unnecessary complexity;
   - propose three distinct design directions, with wireframes and a design-token system;
   - redesign navigation and workspace organisation, and explore a unified Learn, Analyze and Design experience;
   - keep the numerical engine and the application architecture unchanged;
   - present the proposed design for approval before changing the GUI;
   - then implement incrementally, with browser screenshot reviews and regression testing at every step.
7. Prediction mode and worked calculations in the Inspector.
8. Free-body diagram of a joint (method of joints).
9. Solver Explorer for small models.
10. Section sizing. The design deflection check comes only after a physically appropriate deflection measure has been agreed and documented (see Engineering restrictions).
11. A small lesson format and the first lessons.

Not planned for now: an AI tutor, beam or frame elements, 3D, dynamics, brute-force optimisation, automated grading of written reasoning, gamification.

Update this section whenever a milestone is committed.

## Working agreement

- One step at a time. After each step, report the files changed, the test results and what is still unverified, then wait for review.
- Commits go directly to `main`. The maintainer often commits and pushes reviewed work themselves, so check `git log` before committing. Never amend, rebase or force-push commits that are already on `origin`.
- Never claim browser testing that did not happen.
- Machine-specific setup (opening the app from protected macOS folders, browser permissions, the optional local server) is in `docs/development/local-testing.md`.
