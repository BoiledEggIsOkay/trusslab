# TrussLab: working notes for Claude

TrussLab is a browser app for linear-elastic analysis of 2D pin-jointed trusses by the Direct Stiffness Method. It is being extended, one reviewed milestone at a time, into a tool for learning and design that teaches from the mathematics the solver actually performs. `README.md` is the user documentation; this file is the working agreement for changing the code.

## Skills in this repository

Load the matching project skill before you start (the skill list describes each one); they hold the detail this file only summarises. `frontend-design` is Anthropic's general design skill, vendored unmodified under Apache 2.0 (source, commit and hashes in its `UPSTREAM.md`): read it through `trusslab-ui-design`, which takes precedence for TrussLab, and never edit the vendored files. The education and design logic (milestones 7–11) is covered by `trusslab-architecture` (files, globals, the result-hiding and view-only rules) and `trusslab-engineering-rules` (what they may compute and show).

## Hard constraints

The app must keep working when someone double-clicks `index.html` (a `file://` page) with nothing installed. That rules out a build step, npm or any package manager, frontend frameworks, ES modules (`import`/`export`), `fetch()` of application data, JSON files loaded at runtime, servers and backends, external APIs, and remotely hosted fonts, scripts or stylesheets. Use classic `<script>` files in a fixed order that share explicitly named globals, and keep data in JavaScript registries. A feature that genuinely needs a network or a backend is documented as an optional extension, never made a dependency. A local HTTP server may be used as a testing workaround (see `docs/development/local-testing.md`), but the app must never require one.

Keep `fea-core.js` one self-contained file. Change its mathematical formulation only with a stated reason, documentation, and regression tests. New model, education and design logic must not touch the DOM, so that it can be tested headlessly like the engine.

## The structural model

2D, linear-elastic, small-displacement, pin-jointed truss analysed by the Direct Stiffness Method. Members carry axial force only: never add bending to a truss member or suggest the model is 3D. Euler buckling uses the pin-ended assumption, K = 1. Support restraints act along the x′, y′ axes of a nodal frame rotated by α. Formulas, conventions and the rules for upcoming features are in `trusslab-engineering-rules`.

## Engineering restrictions

- The horizontal-extent / maximum-total-displacement ratio is not a design acceptance criterion. The design deflection check uses the agreed reference-chord measure (deflection across the line between two chosen nodes, relative to that line's own movement) against a limit the user sets; with none set, serviceability is "not configured". Never invent a universal limit.
- Never add safety factors, utilisations or member classifications across load cases or combinations. Solve each combination directly and take the worst governing value.
- Since milestone 3, λ scales every action of the active load case: nodal loads and prescribed settlements alike. Since milestone 5 it multiplies a combination once, after its factors: λ·Σγᵢ·Fᵢ. λ = 0 gives zero results only for a stable model; a mechanism stays unstable at any λ.

## Current code

| Global | Defined in | Notes |
|---|---|---|
| `FEA` | `fea-core.js` | Numerical engine; also `module.exports` under Node |
| `TrussModel` | `model.js` | DOM-free model layer: parser, materials and sections, model objects and load cases, material densities and the generated self-weight case, load combinations, file format version 2 (`readModel` also reads version 1 files, reports and sessions), `validateModel`, examples, `toAnalysisInput`, saved-session storage with injected `Storage`; also `module.exports` under Node |
| `TrussEducation` | `education.js` | DOM-free teaching logic: guided build, worked calculations, predictions, free-body diagrams, method of joints, Solver Explorer. Reads `FEA.analyze()` results, never solves |
| `TrussDesign` | `design.js` | DOM-free design logic: section catalogue, checks over every state, fully stressed sizing, reference-chord deflection. Never changes the model it is given |
| `TrussLessons` | `lessons.js` | DOM-free curriculum (six lessons), challenges, lesson progress with injected `Storage` |
| `TrussLab` | `script.js` (end) | Older test hook that exposes live internal state. Keep it unchanged for compatibility; new code and tests must not depend on it |
| `TrussLabTest` | `script.js` section 17 | Testing adapter, version 2, installed only in smoke mode (`?smoke`) |

Script order in `index.html`: `fea-core.js`, `model.js`, `education.js`, `design.js`, `lessons.js`, then `script.js`. `fea-core.js` was not changed by milestones 6–11.

Saved sessions live in `localStorage` under `trusslab.session.v2`; `trusslab.session.v1` is migrated once and removed only after a verified version 2 write, and an unreadable version 2 session is kept under `trusslab.session.v2.unreadable` (`.2`, `.3`, …). Lesson progress lives apart, under `trusslab.learn.v1`, with the same safety rules. Smoke mode uses the `trusslab.smoke-test.*` keys and never touches the user's.

## Tests

- Headless: `.claude/skills/trusslab-testing/scripts/check.sh` syntax-checks every `.js` file and runs every `test/*.test.js` suite. Today: `fea-core` 41, `model` 722 (with the nine examples at λ = 1 against the regression baseline `test/fixtures/examples-baseline.js`), `education` 157, `design` 61, `lessons` 58 checks.
- Browser smoke test (`test/browser-smoke.js`), in two modes:
  - `index.html?smoke` runs every scenario against the real page and must end with PASS.
  - `index.html?smoke=selftest` adds one deliberately failing scenario. It ends with PASS only if exactly that scenario fails and every clean-up check still passes, which shows that a failing test cannot damage the user's work.
  - `python3 -I .claude/skills/trusslab-testing/scripts/browser_check.py` runs both in headless Chrome (314 checks pass in `?smoke` today; Safari and Firefox need a manual run).
- Report browser verification only when it has actually been performed in a browser. If no browser is available, say so, list the smoke test as unverified, and give the user the manual verification steps in `docs/development/local-testing.md`.

## Roadmap

Done:
- `81eac1c` Rev 1: review fixes, numerical test suite, licence, `.gitignore`.
- `0bb4657` Rev 2, milestone 1: browser smoke test and the `TrussLabTest` adapter.
- `0e3dbae` Rev 3: the D and G shortcuts refresh the legend and autosave.
- `3b88695`, `1a0b122`: `CLAUDE.md`, the project Skills, local testing notes, the vendored `frontend-design` Skill, `trusslab-ui-design` and the redesign milestone.
- `4712cba` Rev 4, milestone 2: DOM-free model layer (`model.js`, global `TrussModel`) and the example baseline; no behaviour change.
- `dac8c99` Rev 5, milestone 3: load cases, λ on loads and settlements, file format version 2 reading version 1 files, reports and sessions, verified session storage, `validateModel`, `TrussLabTest` version 2.
- `1e4820c` Rev 6, milestone 4: material density and the generated self-weight case.
- `16d3fc9` Rev 7, milestone 4 decisions (maintainer, final): version 2 with optional fields and a documented downgrade limitation; missing densities never filled in from a preset; a self-weight case lacking a density always marked incomplete; Douglas fir 540 kg/m³ labelled approximate.
- `4ff2eb9` Rev 8, milestone 5: load combinations, each solved directly, with the worst governing value over their own results.
- Milestones 6–11, implemented in one delegated assignment and **not yet committed** (review pending; log in `docs/development/progress.md`): 6 the Midnight Engineering Lab redesign (Learn / Analyze / Design, Guided / Technical, phone view-only, IBM Plex bundled); 7 prediction and worked calculations; 8 free-body diagrams and the method of joints; 9 the Solver Explorer; 10 design checks over every state, fully stressed sizing and the reference-chord deflection (optional version 2 field `design`); 11 six lessons with challenges and stored progress.

The rules and decisions behind each milestone are in `README.md` and in `trusslab-engineering-rules` with its references.

Next: the maintainer's review of milestones 6–11 and their commit. No further milestone is scheduled.

Not planned for now: an AI tutor, beam or frame elements, 3D, dynamics, brute-force optimisation, automated grading of written reasoning, gamification.

Update this section whenever a milestone is committed.

## Working agreement

- One step at a time. After each step, report the files changed, the test results and what is still unverified, then wait for review.
- Commits go directly to `main`. The maintainer often commits and pushes reviewed work themselves, so check `git log` before committing. Never amend, rebase or force-push commits that are already on `origin`.
- Never claim browser testing that did not happen.
- Machine-specific setup (opening the app from protected macOS folders, browser permissions, the optional local server) is in `docs/development/local-testing.md`.
