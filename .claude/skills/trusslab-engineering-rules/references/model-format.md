# Model and save-file format

Contents: 1 In-memory model · 2 Supports · 3 Load cases, loads and settlements · 4 File format version 2 · 5 What `readModel` accepts · 6 Model warnings · 7 Saved sessions in browser storage · 8 Rules for a future version 3

The code lives in `model.js` (global `TrussModel`): `serialize`, `readModel` (and `deserialize`, which returns only its model), `validateModel`, the constructors, the load-case functions, the presets and the session storage functions. `test/model.test.js` checks the behaviour described here. Check the code when in doubt: it wins over this file, and then this file needs correcting.

## 1. In-memory model

```
model    = { title, nodes: [node], members: [member], materials: [material], groups: [group], loadCases: [loadCase], activeCase }
material = { uid, preset: 'steel' | 'aluminum' | 'fir' | 'custom', name, E, fy, color }
group    = { uid, name, material, shape: { type, ...dims }, color, A, I }        // a "section" in files
node     = { uid, x, y, support: { type, angle, fixX, fixY } }
member   = { uid, n1, n2, group }
loadCase = { uid, name, loads: Map(node → { fx, fy }), settlements: Map(node → { dx, dy }) }
```

- Objects refer to each other by reference (`group.material`, `member.n1`, `member.group`, the Map keys, `model.activeCase`), not by id. A `uid` exists only for the current session and is never saved.
- Array order defines the numbering (N1, M1, load case 1, …) and the solver indices.
- Units are SI base units: m, N, Pa, m², m⁴, with angles in degrees. `fy` is the yield or limit stress.
- A model always has at least one load case, and `activeCase` is one of them. `emptyModel()` and every reader create "Load case 1".
- Material presets: steel E 200 GPa, σy 250 MPa; 6061-T6 aluminium 68.9 GPa, 276 MPa; Douglas fir 11 GPa, 49.9 MPa; custom 100 GPa, 200 MPa. Douglas fir's 49.9 MPa is the clear-wood compressive strength parallel to the grain at 12 % moisture content (USDA Wood Handbook), not a graded design value.
- Section shapes (`sectionProps`): `custom` (A and I entered directly), `rod {d}`, `chs {D, t}` (2t ≤ D), `rect {b, h}`, `rhs {b, h, t}` (2t < min(b, h)). Dimensions are in metres. A and the minimum (weak-axis) I are computed from the dimensions, assuming sharp corners.

## 2. Supports

A support holds only its restraint: which axes of its nodal frame are fixed, and the frame angle. `setSupport(node, type, angle)` sets:

| type | fixX | fixY | angle |
|---|---|---|---|
| none | false | false | 0 |
| pin | true | true | 0 |
| rollerX | false | true | 0 |
| rollerY | true | false | 0 |
| inclined | false | true | the angle given; else the current frame angle; else 30° |
| custom | as chosen; switching to custom from no fixed axis fixes both | as chosen | the angle given; else the current frame angle; else 0° |

`fixX`/`fixY` restrain the x′/y′ axes of the frame rotated by `angle`. `supportRestraint(s)` returns `{ fixX, fixY, angle }`.

**The frame angle survives a change of type.** When no angle is given (the Inspector's type list gives none), an inclined roller or a custom frame keeps the support's current frame angle, and 0° counts as an angle, not as a missing value. So the frame does not turn, and a settlement, which is stored along x′, y′, keeps its direction: a pin switched to Custom stays at 0°, an inclined roller at 45° switched to Custom keeps 45° and its single fixed axis y′. The defaults (30° for an inclined roller, 0° for a custom frame) apply only when the current angle is missing or not a finite number. Never write `angle || 30`: it turns a real 0° into 30°. A custom support may end up with neither axis fixed (the user clears both, or a file says so): it is kept as it is, it restrains nothing, and `validateModel` warns. `setSupport` never touches settlements.

## 3. Load cases, loads and settlements

- Every prescribed action belongs to a load case: nodal loads `{ fx, fy }` in N along global x, y, and settlements `{ dx, dy }` in m along the support's own frame axes x′, y′ (rotated by the support angle; with angle 0 they are global x, y).
- Read and write them with `nodeLoad`, `setNodeLoad`, `nodeSettlement`, `setNodeSettlement` (default: the active case). Setting zero removes the entry, so the Maps hold only non-zero actions.
- A settlement on an axis that is not fixed is stored, but has no effect: `toAnalysisInput` passes a settlement only on a fixed axis, and `validateModel` warns.
- `addLoadCase` (named "Load case N", not activated), `removeLoadCase` (never the last; when the active case goes, a neighbour becomes active), `setActiveLoadCase`, `removeNodeActions` (deleting nodes deletes their loads and settlements in every case), `modelHasSettlement`.
- `toAnalysisInput(model, { loadFactor: λ, loadCase, targetSF })` analyses one case (default: the active one) and multiplies all its actions by λ: `fx·λ`, `fy·λ`, `dx·λ`, `dy·λ`. See `analysis-math.md` §4.
- In `script.js`, undo snapshots are `JSON.stringify({ model: serialize(model), caseUids })`: the uids let an undo keep the load case on screen active when it still exists. Switching the active case is not an edit and is not undone.

## 4. File format version 2 (`serialize`)

```json
{
  "format": "trusslab-model", "version": 2,
  "units": { "length": "m", "force": "N", "stress": "Pa", "area": "m^2", "inertia": "m^4", "angle": "deg" },
  "title": "…",
  "materials": [{ "id": 1, "name": "…", "preset": "steel", "E": 2e11, "fy": 2.5e8, "color": "#94a3b8" }],
  "sections":  [{ "id": 1, "name": "…", "material": 1, "A": 1e-3, "I": 1e-6, "shape": { "type": "custom" }, "color": "#38bdf8" }],
  "nodes":     [{ "id": 1, "x": 0, "y": 0, "support": { "type": "pin", "angle": 0, "fixX": true, "fixY": true } }],
  "members":   [{ "id": 1, "n1": 1, "n2": 3, "section": 1 }],
  "loadCases": [{ "id": 1, "name": "Load case 1",
                  "loads":       [{ "node": 3, "fx": 0, "fy": -100000 }],
                  "settlements": [{ "node": 2, "dx": 0, "dy": -0.01 }] }],
  "activeLoadCase": 1
}
```

- Ids are 1-based. `section.material`, `member.n1`/`n2`, `member.section`, the entries' `node` and `activeLoadCase` refer to those ids.
- Load and settlement lists are sparse (non-zero entries only), in node order. Every support is written with all four fields, so a custom support with no fixed axis round-trips exactly.
- Exporting version 1 is discontinued. Model files, calculation reports (`{ meta, model, … }`; `meta` also names the analysed load case) and saved sessions all contain version 2.

## 5. What `readModel` accepts

`readModel(input)` returns `{ model, fromVersion, notes }`. `notes` (`{ msg, ref? }`) list everything that was skipped or not applied, and the page shows them under "Import notes" in the health report, so nothing is lost silently.

**Wrappers.** One rule (`nestedModel`) handles all three kinds of input: if `obj.model` is an object that has a `nodes` list or says it is a model (`format: "trusslab-model"`, or a `version`), it reads `obj.model`; otherwise `obj` itself. So it reads model files, autosaved sessions `{ model, settings, view }` and calculation reports `{ meta, model, status, … }`, and it still finds a newer model whose layout has no `nodes` list. A `version` on the wrapper itself is never read. Keep this rule.

**Versions, checked first.** The version is read before anything that belongs to the version 2 layout, so a newer file is refused as newer rather than as malformed. A version above 2 is refused: "it was written by a newer version of TrussLab (file format version N), which this version cannot read". `version` 2 is read as version 2; a missing version, or 1, as version 1, migrated in memory. Only then are the `nodes` and `members` lists required.

**Version 1 migration** (`migrateV1`), into one load case, "Load case 1":
- `node.load` becomes a load;
- a custom support's `dx`/`dy` becomes a settlement in the same frame x′, y′, even on an axis that is not fixed (where it has no effect and is warned about);
- a non-zero `dx`/`dy` on any other support type is not applied, because version 1 ignored it too, and a note says so ("…File format version 1 ignored it on this support type, so it was not applied.");
- a custom support keeps exactly its flags; a missing flag counts as false.

The page shows a one-time notice when a version 1 model, report or session with a settlement is opened or migrated, because λ now scales settlements and results at λ ≠ 1 differ from version 1.

**Malformed version 2 content** (`readLoadCasesV2`, `readEntries`):
- an entry whose node does not exist is skipped, with a note;
- an entry with a non-finite value (`null`, `""`, text, `NaN`) is skipped, with a note; a missing value counts as 0;
- a second entry for the same node in the same list is skipped, with a note: the first valid entry wins;
- a list that is not a list, or an entry that is not an object, is skipped, with a note;
- a load case whose `id` is not a positive integer, or two load cases with the same `id`, reject the file;
- a missing or empty `loadCases` gives an empty "Load case 1", with a note; an `activeLoadCase` that names no case makes the first case active, with a note;
- unknown fields are ignored, for forward compatibility. Names are trimmed and cut to 80 characters; an empty name becomes "Load case N".

**Normalisation** in both versions (`readStructure`):
- An unknown material preset becomes `custom`. Invalid E or fy falls back to the preset value. Names are cut to 80 characters and the title to 120. Colours must be `#rrggbb`.
- An unknown shape becomes `custom`. For other shapes, A and I are recomputed from the dimensions. A non-positive A or I becomes 1000 mm² or 1×10⁶ mm⁴.
- With no materials, a steel material is created; with no sections, a default section is created. `groups` is accepted instead of `sections`, and a member's `group` instead of `section`.
- An unknown support type becomes `none`.

It throws for: a value that is not an object; missing `nodes` or `members` arrays; a node with non-finite coordinates; a member that refers to a missing node or connects a node to itself; invalid or duplicate load-case ids; `loadCases` that is not a list; a version above 2.

## 6. Model warnings (`validateModel`)

Checks the solver does not make, returned as `{ msg, ref }` and shown in the health report, the Inspector and the report's `warnings`:
- "Node N: the custom support has neither x′ nor y′ fixed, so it provides no restraint."
- "Node N: the settlement along y′ in "Load case 1" has no effect, because y′ is not fixed." (x′, y′, or both)
- "Node N is not connected to any member, so its settlement in "…" has no effect."

## 7. Saved sessions in browser storage

The storage object is passed in, so this code stays DOM-free and its failures can be simulated in tests (`fakeStorage` in `test/model.test.js`).

| Key | Holds |
|---|---|
| `trusslab.session.v2` | the session `{ model (version 2), settings, view, importNotes? }`; only the keys of `DEFAULT_SETTINGS` are stored; `importNotes` only when there are any |
| `trusslab.session.v1` | a session written before milestone 3; read once, then removed after a verified version 2 write |
| `trusslab.session.v2.unreadable` (`.2`, `.3`, … up to 20) | a version 2 session that could not be read, kept unchanged |

Smoke mode uses `SMOKE_SESSION_KEYS` (`trusslab.smoke-test.session.v2`, `.v1`, `.v2.unreadable`) and never reads or writes the keys above.

- **A failed read is not a missing key.** Every read goes through `readKey`, which returns `{ ok: true, value }` (`null` when the key does not exist) or `{ ok: false, error }`. If a read throws at start-up, the key is listed in `readFailed`, nothing more is loaded (when the version 2 read fails, version 1 is not migrated over a session that may exist), and `saveStoredSession` refuses to write (`stage: 'read'`) until the page is reloaded, so nothing stored can be overwritten or removed. When the version 2 session is readable, the version 1 key is not read at all.
- `loadStoredSession(storage, keys)`: a readable version 2 session wins, and a stale version 1 key is then left alone. An unreadable version 2 session is backed up first (`backupUnreadable`: never overwrites a backup holding different data, uses the next number instead, and reads the copy back); if the backup fails, the session is kept in memory as `corruptV2` and nothing overwrites it. Otherwise a readable version 1 session is migrated in memory with its settings and view (`migrationPending`). It deletes nothing.
- `saveStoredSession(storage, keys, session, status)`: refuses after a failed read; retries a pending backup; writes the version 2 key and reads it back. The write is verified only if the text reads back exactly as written and rebuilds the same model (`readModel`, then `serialize` again, compared as JSON), since the reader normalises some values (names longer than 80 characters, a title longer than 120, a section area or material property that is not positive); a read-back that throws or fails either comparison counts as not saved (stage `verify`). Only after a verified write, and only while a migration is pending, removes the version 1 key. It returns `{ saved: false, stage: 'read' | 'backup' | 'write' | 'verify' }` or `{ saved: true, legacy: 'removed' | 'failed' | 'not-needed' }`. The page shows a persistent "Changes not saved — browser storage unavailable" note in the status bar for any failed save (the tooltip gives the reason), and a different, informational note when the session was saved but only the removal of the old version 1 key failed (it is retried on the next save). A successful save clears the note.
- **Import notes** are session data, not model data: they are saved beside the model as `importNotes` and read back with the session (`cleanNotes` drops duplicates, malformed entries and links to nodes the model does not have; at most 200). A session without `importNotes` loads as before. The page replaces them whenever a new model is loaded (Open…, an example, New), and an undo snapshot carries them, so undoing an Open… brings back the earlier model's notes.

## 8. Rules for a future version 3

- Keep reading versions 1 and 2, and all three wrappers, with a migration test for each.
- Never delete the only recoverable copy of a user's session: write and verify the new key before removing an old one.
- Bump `FORMAT_VERSION`, the session key and `TrussLabTest.version` only together with migration code and tests.
