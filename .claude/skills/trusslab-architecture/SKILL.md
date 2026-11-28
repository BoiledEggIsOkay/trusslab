---
name: trusslab-architecture
description: Where code goes in TrussLab and how its files fit together, covering the double-click (file://) constraint, classic scripts and their load order, the named globals (FEA, TrussModel, TrussLab, TrussLabTest), the wrapper pattern for DOM-free files, JavaScript data registries, the save-file and autosave formats, and how to keep model, education and design logic DOM-free and testable headlessly. Use it before adding, moving, splitting or renaming any file or global, when extracting code out of script.js (milestone 2 onwards), when changing the save format, or whenever a change seems to need a build step, a module, fetch(), a server or an external library.
---

# TrussLab architecture

## Why the constraints exist

TrussLab has to open by double-clicking `index.html`, with nothing installed. Learners and teachers run it from a downloaded folder or a USB stick, often on machines where they cannot install tools. A `file://` page can load classic `<script>` tags and local CSS, but Chrome blocks ES modules and `fetch()` of local files. That is why the rules are:

- no build step, npm, package manager, bundler or frontend framework;
- no `import`/`export`, no `fetch()` of application data, no JSON files loaded at runtime;
- no server, backend, external API, or remotely hosted font, script or stylesheet;
- classic scripts in a fixed order, sharing a few explicitly named globals;
- data in JavaScript registries (objects and arrays in `.js` files).

A feature that truly needs a network goes into the documentation as an optional extension, never a requirement. A local HTTP server is a testing workaround only (`docs/development/local-testing.md`): nothing may depend on one.

## Files, globals and load order

| File | Role | Global |
|---|---|---|
| `fea-core.js` | Numerical engine, no DOM | `FEA` (plus `module.exports` under Node) |
| `model.js` | DOM-free model layer: parser, sections, constructors, supports, load cases and the generated self-weight case, load combinations (`analyzeCombination`, `combinationEnvelope`), serialisation, examples, solver input (`toAnalysisInput`) | `TrussModel` (plus `module.exports` under Node) |
| `education.js` | DOM-free teaching logic (milestones 6–9): the guided build, worked calculations (`memberCalc`, `nodeCalc`, `jointForces`), predictions and zero-force rules, free-body diagrams (`fbd`), the method of joints (`jointExercise`, `nextJoint`, `checkJointAnswers`), the Solver Explorer (`explorer`, `memberTransformation`, `assemblyContribution`, `entryContributions`). Reads `FEA.analyze()` results; never solves | `TrussEducation` |
| `design.js` | DOM-free design logic (milestone 10): section catalogue (`family`), states and checks (`designStates`, `checkDesign`), reference-chord deflection (`chordDeflection`, `checkDeflection`), fully stressed sizing (`sizeSections`, `iterateSelections`). Works on a copy; never changes the model | `TrussDesign` |
| `lessons.js` | DOM-free curriculum (milestone 11): `LESSONS`, `evaluateChallenge`, `checkAnswer`, lesson progress with injected `Storage` (`loadProgress`, `saveProgress`) | `TrussLessons` |
| `script.js` | All page code: one IIFE in numbered sections | `TrussLab` (older hook), `TrussLabTest` (smoke mode only) |
| `index.html`, `style.css`, `fonts/` | Layout, help dialog, the design tokens and components, the bundled IBM Plex subsets (SIL OFL 1.1) | none |
| `test/*.test.js` | Headless suites (jsc or Node) | none |
| `test/browser-smoke.js` | Browser smoke test, loaded by `index.html?smoke` | `TrussLabSmokeResult` (summary) |

Load order in `index.html`: `fea-core.js`, `model.js`, `education.js`, `design.js`, `lessons.js`, `script.js`. A script may use, at load time, only the globals defined by scripts above it in `index.html`. `script.js` reads what it needs once at the top of its IIFE. If a required global is missing, show a clear message on the page the way `script.js` already does when `fea-core.js` or `model.js` has not loaded, instead of failing silently.

## Pattern for a DOM-free file

Copy the wrapper that `fea-core.js` uses, so the same file works as a browser global, in Node (`require`) and in jsc (`load`):

```js
(function (root, factory) {
  'use strict';
  const FEA = root.FEA || (typeof require === 'function' ? require('./fea-core.js') : undefined);
  const api = factory(FEA);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrussModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FEA) {
  'use strict';
  // ...
  return { /* public API */ };
});
```

`module.exports` (CommonJS) is acceptable because it runs only under Node; browsers never see it. ES `import`/`export` syntax is not acceptable, because it would make the browser treat the file as a module.

### What DOM-free means here

The file must not use `document`, `window`, `localStorage`, `sessionStorage`, `location`, `navigator`, `requestAnimationFrame`, `alert`/`confirm`, canvas or CSS. It must not read UI settings either: take the values it needs (load factor, target safety factor) as parameters. It returns numbers in SI base units; formatting for display (`fmt`, unit selection) stays in `script.js`.

Check both ways:
- `grep -nE '\b(document|window|localStorage|sessionStorage|location|navigator|requestAnimationFrame|alert|confirm)\b' model.js` should print nothing except comments;
- its headless test suite loads it in jsc or Node with no DOM stand-in, which proves it at run time.

Functions that turn the model into solver input or results must not mutate the model: build new objects and arrays. Test that the model's serialised form is identical before and after the call.

## `script.js`

One IIFE in numbered sections: 1 helpers and formatting, 2 the display text for supports (`supportText`; the model objects are in `model.js`), 3 a note only (the examples are in `model.js`), 4 state, history and persistence, 5 analysis driver, 6 view, snapping and picking, 7 rendering (the canvas palette is read from the CSS tokens by `readPalette()`), 8 editing, 9 pointer and keyboard, 10 left panel, 11 inspector (with the worked-calculation formatting: `calcStep`, `mathHtml`, `qSI`, `qShow`), 12 status and results report, 13 data drawer, 14 export, 15 miscellaneous UI, 16 start-up, 17 testing adapter, 18 workspaces, presentation modes, menus, layout and the phone view-only mode, 19 the Learn workspace (activities register in `LEARN_ACTIVITIES` and `LEARN_VIEWS`: build, predict, fbd, joints, explorer, lesson), 20 the Design workspace.

Cross-cutting rules in the page code:
- **Every result shown goes through `R()`**, which returns null while a Learn exercise hides the results (`resultsHidden()`: the prediction until checked, the method of joints until complete). Code that reads `state.res` directly (Results, matrices, log, legend) checks `resultsHidden()` itself.
- **Every edit entry point checks the view-only state** (`isViewOnly()`, `refuseViewOnly()`): canvas tools, keyboard shortcuts, Inspector fields and actions, panel buttons. Editing forms are wrapped in `fieldset.edit`, which `applyViewOnly()` disables; forms rendered later must set it too (as `renderDesignTools` does).
- Workspace, Guided/Technical and the right tab are settings (`workspace`, `uiMode`, `rightTab`), changed only through `setWorkspace`, `setUiMode`, `setRightTab`.

Put new page code in the matching section. The sections call each other in both directions (undo in §4 calls `modelChanged` in §8; `solve` in §5 calls `refreshResults` in §12). So do not split `script.js` into one file per section. Move code out only when a milestone calls for it, and then along real boundaries: DOM-free logic first, then large UI areas such as rendering, panels, input or exports.

## Test interfaces

- `window.TrussLab` = `{ state, solve, buildExample, loadModel, serialize, deserialize, parseExpr, sectionProps }`. It hands out live internal state. Keep it working with the same members for compatibility, but do not write new code or tests against it.
- `window.TrussLabTest` (version 2 since milestone 3) exists only with `?smoke`. Its queries return plain copies (`model()` is file format version 2); `capture`/`restore`/`diff` provide isolation. It also exposes `storageKey`, `storageKeys` (the smoke-test keys), `userStorageKey`, `userStorageKeys` (every key that may hold the user's work, which the test checks are unchanged: the sessions, their backups, and the lesson progress `trusslab.learn.v1` with its `.unreadable` backup), `reloadStoredSession()` (runs start-up's session handling again, on the smoke-test keys), `saveNow()`, and since milestone 6 `layout()` (`'wide'`, `'narrow'` or `'phone'`), `viewOnly()` and `setViewOnlyForTest(on)` (a synthetic test cannot resize the window; `restore()` clears the override). Additive changes keep the version. A breaking change bumps it and updates `test/browser-smoke.js` in the same commit.

## Save files and autosave

The full description is in `../trusslab-engineering-rules/references/model-format.md`: the in-memory model, load cases, file format version 2, what `readModel` accepts, and saved-session storage. In short:

- `readModel` (and `deserialize`, which returns only the model) reads three kinds of input: model files, autosaved sessions, and exported report files that nest the model under `model`, in format version 2 or 1. Keep all of them working. It returns `notes` for anything skipped; the page shows them as "Import notes".
- Storage logic is DOM-free in `model.js` (`loadStoredSession`, `saveStoredSession`, `backupUnreadable`), with the storage object passed in. `script.js` passes a guarded `localStorage` (`STORE`) and the keys (`SESSION_KEYS`, or `SMOKE_SESSION_KEYS` in smoke mode); no other code touches `localStorage`.
- Autosave: `scheduleSave()` waits 400 ms, then `saveNow()` writes `{ model, settings, view, importNotes }` under `trusslab.session.v2` and reads it back. A read that fails at start-up blocks all writes until a reload. Only the keys of `DEFAULT_SETTINGS` are stored. A version 1 session is migrated at start-up and its key removed only after a verified write; an unreadable version 2 session is backed up first. Failures show a persistent note in the status bar (`#sbSave`).
- A format change bumps the version and must keep reading every earlier version's model files, autosaved sessions and report files, with a migration test for each.
- Lesson progress (milestone 11) is not part of the session: `lessons.js` stores it under `trusslab.learn.v1` (smoke mode `trusslab.smoke-test.learn.v1`, cleared at the start of a smoke run) with the same rules: no write after a failed read, unreadable text copied to `KEY.unreadable` once, write verified by reading back.
