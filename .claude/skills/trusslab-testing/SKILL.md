---
name: trusslab-testing
description: How to test TrussLab. Covers running every headless check (syntax plus all test/*.test.js suites, under Node or macOS JavaScriptCore) with the bundled check.sh, writing headless tests in the repository's style, extending the browser smoke test (index.html?smoke) through the TrussLabTest adapter, proving that a regression test catches its bug, and reporting results honestly. Use it before and after every code change in this repository, when adding or fixing tests, when a test fails, when a tolerance seems wrong, and whenever the user asks whether something works or was verified.
---

# Testing TrussLab

## Run everything headless

```sh
.claude/skills/trusslab-testing/scripts/check.sh
```

The script syntax-checks every `.js` file in the repository, then runs every `test/*.test.js` suite. It uses Node if it is installed, otherwise macOS JavaScriptCore. It prints one line per file and exits non-zero if anything fails. Run it from anywhere.

### Engines

- Without Node, use the JavaScript engine built into macOS, at `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`. The maintainer's machine setup is described in `docs/development/local-testing.md`.
- In jsc, `load()` resolves paths from the current folder, so run suites from the repository root. Use `print` (there is no `console`). An uncaught error exits with code 3.
- Syntax check of one file in jsc: `jsc -e 'new Function(readFile("script.js"))'`. With Node: `node --check script.js`.
- If the shell is zsh (the macOS default), note that `$PIPESTATUS` is a bash variable and is empty there. Avoid pipes when you need an exit code, or use `${pipestatus[1]}`.

## Headless suites

Follow `test/fea-core.test.js`:

```js
'use strict';
const FEA = typeof require === 'function' ? require('../fea-core.js') : (load('fea-core.js'), globalThis.FEA);
const out = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;
// check(name, ok, detail), near(name, got, want, relTol), testCase(title, fn)
// End: print "N passed, M failed"; on failure set process.exitCode = 1 (Node) or throw (jsc).
```

- Load extra DOM-free files the same way: `require('../model.js')` under Node, `load('model.js')` under jsc, after `fea-core.js`.
- Suites: `test/fea-core.test.js` (engine), `test/model.test.js` (`model.js`), `test/education.test.js` (`education.js`: guided build, worked calculations, predictions, free-body diagrams, method of joints, Solver Explorer), `test/design.test.js` (`design.js`: catalogue, checks, sizing, deflection), `test/lessons.test.js` (`lessons.js`: lesson format, worked examples, challenges, progress storage). Each new DOM-free file gets its own suite, loading its dependencies in the `index.html` order.
- `test/model.test.js` covers `model.js`. Its example checks compare against `test/fixtures/examples-baseline.js`, the results captured from the code before milestone 2. That file is a regression baseline: never regenerate it to make a test pass. A deliberate change to an example or to the analysis updates it in the same commit, with the reason.
- Compare with closed-form or hand-statics references, and write the reference down in a comment. Use relative tolerances: about 1e-14 for direct closed forms, looser only with a stated reason, such as cancellation in a small reaction.
- Wrap each group of checks in `testCase`, so a crash counts as a failure instead of ending the run.
- Name a check by what it proves ("member 1 carries -62.5 kN (closed form)"), not by how it is computed.
- Label a test that records current behaviour, which a later milestone will change on purpose, as "TEMPORARY characterisation test", and name the milestone that replaces it.

### Storage and other browser state in headless tests

Code that touches browser storage takes the storage object as a parameter (`loadStoredSession(storage, keys)`), so a headless test can pass a stand-in. `test/model.test.js` has `fakeStorage`, whose switches make `getItem` or `setItem` (for every key or chosen keys) or `removeItem` throw, or truncate what is written (`corrupt`) or rewrite it into other valid text (`rewrite`) so that the read-back checks fail: use it to prove that no failure path deletes the only recoverable copy of a session.

### Prove that a test can fail

A test that has never been seen to fail has not been shown to detect anything.
- For a bug fix, run the new test on the unfixed code first.
- For a suite, run it against a deliberately broken copy (in the scratchpad, never the working tree). Milestones 6–11 were checked this way: a wrong member-force sign in the free-body diagram, Euler with L instead of L², the chord reference removed from the deflection, progress written after a failed read, the zero-force rule applied at a loaded joint, and, in the browser, the view-only Inspector guard and the result hiding of the prediction removed; each was caught. A mutation that a stable truss cannot observe (for example two collinear members at an unloaded joint, which is always a mechanism) is equivalent, not a gap.
- A recipe for the engine: copy `fea-core.js` into the scratchpad with `sed 's/const N = e.k \* elong;/const N = e.k * elong * (1 + 1e-9);/'`, run the suite from that folder, and confirm that it fails and exits non-zero.

## Browser smoke test

- Two modes:
  - `index.html?smoke` runs every scenario and must end with PASS.
  - `index.html?smoke=selftest` adds one deliberately failing scenario. It ends with PASS only if exactly that scenario fails and every clean-up check still passes.
- Results go to the on-page panel, the console (`[smoke]` lines) and `window.TrussLabSmokeResult`.
- **Headless Chrome**: `python3 -I .claude/skills/trusslab-testing/scripts/browser_check.py` runs both modes in headless Google Chrome (throwaway profile, stdlib-only DevTools client) and exits 1 unless both are PASS; `--shots DIR` also saves screenshots at 1440, 1280, 1024 and 390 px (phone emulation). Report it as "headless Chrome". It does not cover Safari or Firefox, real touch, or native pointer capture.
- Report browser verification only when it has actually been performed in a browser, whether by you through a connected browser tool, through `browser_check.py`, or by the user. If no browser is available, say so, list the smoke test as unverified, and give the user the manual verification steps in `docs/development/local-testing.md`.
- If the page loads without its styles, or a local server is needed, see `docs/development/local-testing.md`. A local server is a testing workaround only: never make the app or a test depend on one.

### How it works

- `script.js` installs `window.TrussLabTest` (version 2) only in smoke mode. Tests observe through it and drive the app with real DOM events. They never use `window.TrussLab`.
- Isolation:
  - smoke mode stores its sessions under its own keys (`T.storageKeys`), so the user's sessions are never read or written; the test compares every key in `T.userStorageKeys` before and after the run;
  - a scenario that simulates storage failures patches `Storage.prototype.getItem`/`setItem`/`removeItem` for the smoke-test keys only, and restores them in `finally`;
  - a scenario that loads a stored session with other settings calls `applyTestSettings()` afterwards, so later scenarios keep the test settings;
  - the whole application state is captured before the run and restored in a `finally` block, with pending autosaves cancelled;
  - every scenario has its own try/catch.

### Adding a scenario

- `scenario('name', async () => { ... })`. Start with `must(...)` for the preconditions it relies on. `must` stops the scenario; `check` records the result and carries on.
- Helpers:
  - `click(x, y)` and `drag(x0, y0, x1, y1)` take model coordinates in metres;
  - `key(k, target, mods)` returns the event, so `ev.defaultPrevented` shows whether the app handled the key; `ctrl(k, shift)`;
  - `setValue` and `setChecked` dispatch `change`; `press` clicks;
  - `loadExample(key)`, `openFile(text, name)`, `noAutosavePending()`, `savedSettings()`.
- Call `await settle()` after anything that triggers a solve (solves run on the next animation frame).
- Never trigger downloads, `confirm()` (the New button) or real file pickers. Leave the app in a state the next scenario's precondition accepts.

### What synthetic events cannot verify

- Native pointer capture: `canvas.setPointerCapture` is stubbed during the run and restored afterwards.
- Default browser actions: a synthetic Enter does not press a button, and a synthetic arrow key does not move a slider.
- The side-panel button branch that does not match the current window width.
- Opening files in browsers without `DataTransfer`, and the saved-session scenario in browsers that do not expose `Storage` (both reported as SKIP).

## Reporting results

- Give exact counts, and say where each check ran (jsc, Node, a stand-in page, or the user's browser).
- A run with any failure is not a pass. Explain every failure, even one you believe is an artefact of the environment.
- Never loosen a tolerance or delete a check to make a run pass. If a tolerance is genuinely wrong, say why and change it as a visible, reviewed decision.
