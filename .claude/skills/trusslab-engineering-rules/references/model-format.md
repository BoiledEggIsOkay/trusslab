# Model and save-file format

Contents: 1 In-memory model · 2 Supports and settlements · 3 File format version 1 · 4 What `deserialize` accepts · 5 Compatibility requirements for version 2 (milestone 3)

The code lives in `model.js` (global `TrussModel`): `serialize`, `deserialize`, the constructors and the presets. `test/model.test.js` checks the behaviour described here. Check the code when in doubt: it wins over this file, and then this file needs correcting.

## 1. In-memory model

```
model = { title, nodes: [node], members: [member], materials: [material], groups: [group] }
material = { uid, preset: 'steel' | 'aluminum' | 'fir' | 'custom', name, E, fy, color }
group    = { uid, name, material, shape: { type, ...dims }, color, A, I }        // a "section" in files
node     = { uid, x, y, support: { type, angle, fixX, fixY, dx, dy }, load: { fx, fy } }
member   = { uid, n1, n2, group }
```

- Objects refer to each other by reference (`group.material`, `member.n1`, `member.group`), not by id. A `uid` exists only for the current session and is never saved.
- Array order defines the numbering (N1, M1, …) and the solver indices.
- Units are SI base units: m, N, Pa, m², m⁴, with angles in degrees. `fy` is the yield or limit stress.
- Material presets: steel E 200 GPa, σy 250 MPa; 6061-T6 aluminium 68.9 GPa, 276 MPa; Douglas fir 11 GPa, 49.9 MPa; custom 100 GPa, 200 MPa. Douglas fir's 49.9 MPa is the clear-wood compressive strength parallel to the grain at 12 % moisture content (USDA Wood Handbook), not a graded design value.
- Section shapes (`sectionProps`): `custom` (A and I entered directly), `rod {d}`, `chs {D, t}` (2t ≤ D), `rect {b, h}`, `rhs {b, h, t}` (2t < min(b, h)). Dimensions are in metres. A and the minimum (weak-axis) I are computed from the dimensions, assuming sharp corners.

## 2. Supports and settlements

`setSupport(node, type, angle)` sets:

| type | fixX | fixY | angle |
|---|---|---|---|
| none | false | false | 0 |
| pin | true | true | 0 |
| rollerX | false | true | 0 |
| rollerY | true | false | 0 |
| inclined | false | true | the surface angle (default 30°) |
| custom | as chosen (at least one) | as chosen | as chosen |

`fixX`/`fixY` restrain the x′/y′ axes of the frame rotated by `angle`. A prescribed displacement (settlement) `dx`/`dy` is in that frame and applies only on a fixed axis. Today it is stored on the support, and it survives saving and loading only for `custom` supports: for every other type, `setSupport` resets `dx`/`dy` to 0.

## 3. File format version 1 (`serialize`)

```json
{
  "format": "trusslab-model", "version": 1,
  "units": { "length": "m", "force": "N", "stress": "Pa", "area": "m^2", "inertia": "m^4", "angle": "deg" },
  "title": "…",
  "materials": [{ "id": 1, "name": "…", "preset": "steel", "E": 2e11, "fy": 2.5e8, "color": "#94a3b8" }],
  "sections":  [{ "id": 1, "name": "…", "material": 1, "A": 1e-3, "I": 1e-6, "shape": { "type": "custom" }, "color": "#38bdf8" }],
  "nodes":     [{ "id": 1, "x": 0, "y": 0, "support": { "type": "pin", "angle": 0, "fixX": true, "fixY": true, "dx": 0, "dy": 0 }, "load": { "fx": 0, "fy": 0 } }],
  "members":   [{ "id": 1, "n1": 1, "n2": 3, "section": 1 }]
}
```

Ids are 1-based. `section.material`, `member.n1`/`n2` and `member.section` refer to those ids. Undo snapshots are `JSON.stringify(serialize(model))`, so a format change also changes undo.

## 4. What `deserialize` accepts today

1. **A model file** as above.
2. **An autosaved session**, `{ model, settings, view }`, stored in `localStorage` under `trusslab.session.v1` (`trusslab.smoke-test.session` in smoke mode).
3. **An exported calculation report**: `{ meta, model, status, errors, warnings, determinacy, diagnostics, log }`, plus `summary`, `nodes` and `members` when solved, or `mechanismModes` when unstable. The model is nested under `model`.

`deserialize` handles cases 2 and 3 with one rule: if `obj.model.nodes` is an array, it reads `obj.model`. It also accepts `groups` instead of `sections`, and a member's `group` instead of `section`.

Normalisation while reading:
- An unknown material preset becomes `custom`. Invalid E or fy falls back to the preset value. Names are cut to 80 characters and the title to 120. Colours must be `#rrggbb`.
- An unknown shape becomes `custom`. For other shapes, A and I are recomputed from the dimensions. A non-positive A or I becomes 1000 mm² or 1×10⁶ mm⁴.
- With no materials, a steel material is created; with no sections, a default section is created.
- An unknown support type becomes `none`. A missing load becomes 0.

It throws for: a value that is not an object; missing `nodes` or `members` arrays; a node with non-finite coordinates; a member that refers to a missing node or connects a node to itself.

## 5. Compatibility requirements for version 2 (milestone 3)

Agreed: version 2 must keep reading all three of these, with a migration test for each.
1. **Existing version 1 model files**, including settlements stored on custom supports, which move into a load case.
2. **Autosaved sessions in `localStorage`** (`trusslab.session.v1`), whose nested model is version 1.
3. **Exported calculation-report files that nest the model under `model`**, including reports written by version 1. Do not drop the report-wrapper rule when restructuring `deserialize`.

Points to decide in the milestone 3 plan:
- Whether the migrated session is written back under the same key or a new one. Never lose a user's session if its migration fails: keep the original until a successful save.
- Whether exporting a version 1 file remains possible.
- How to tell users that a version 1 model with a settlement gives different results at λ ≠ 1, because λ will then scale the settlement too (README and release notes).
