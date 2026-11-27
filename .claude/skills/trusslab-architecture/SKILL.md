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
| `model.js` | DOM-free model layer: parser, sections, constructors, supports, serialisation, examples, solver input (`toAnalysisInput`) | `TrussModel` (plus `module.exports` under Node) |
| `script.js` | All page code: one IIFE in numbered sections | `TrussLab` (older hook), `TrussLabTest` (smoke mode only) |
| `index.html`, `style.css` | Layout, help dialog, theme | none |
| `test/*.test.js` | Headless suites (jsc or Node) | none |
| `test/browser-smoke.js` | Browser smoke test, loaded by `index.html?smoke` | `TrussLabSmokeResult` (summary) |

A script may use, at load time, only the globals defined by scripts above it in `index.html`. `script.js` reads what it needs once at the top of its IIFE. If a required global is missing, show a clear message on the page the way `script.js` already does when `fea-core.js` or `model.js` has not loaded, instead of failing silently.

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

One IIFE in numbered sections: 1 helpers and formatting, 2 the display text for supports (`supportText`; the model objects are in `model.js`), 3 a note only (the examples are in `model.js`), 4 state, history and persistence, 5 analysis driver, 6 view, snapping and picking, 7 rendering, 8 editing, 9 pointer and keyboard, 10 left panel, 11 inspector, 12 status and health report, 13 bottom panel, 14 export, 15 miscellaneous UI, 16 start-up, 17 testing adapter.

Put new page code in the matching section. The sections call each other in both directions (undo in §4 calls `modelChanged` in §8; `solve` in §5 calls `refreshResults` in §12). So do not split `script.js` into one file per section. Move code out only when a milestone calls for it, and then along real boundaries: DOM-free logic first, then large UI areas such as rendering, panels, input or exports.

## Test interfaces

- `window.TrussLab` = `{ state, solve, buildExample, loadModel, serialize, deserialize, parseExpr, sectionProps }`. It hands out live internal state. Keep it working with the same members for compatibility, but do not write new code or tests against it.
- `window.TrussLabTest` (version 1) exists only with `?smoke`. Its queries return plain copies; `capture`/`restore`/`diff` provide isolation. Additive changes keep version 1. A breaking change bumps the version and updates `test/browser-smoke.js` in the same commit.

## Save files and autosave

The full description is in `../trusslab-engineering-rules/references/model-format.md`: the in-memory model, file format version 1, what `deserialize` accepts, and the compatibility requirements for version 2. In short:

- `deserialize` reads three kinds of input: model files, autosaved sessions, and exported report files that nest the model under `model`. Keep all three working.
- Autosave: `scheduleSave()` waits 400 ms, then writes `{ model, settings, view }` to `localStorage` under `trusslab.session.v1`. Only the keys of `DEFAULT_SETTINGS` are stored. In smoke mode the key is `trusslab.smoke-test.session`.
- A format change bumps the version and must keep reading version 1 model files, autosaved sessions and report files, with a migration test for each.
