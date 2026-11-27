---
name: trusslab-engineering-rules
description: The engineering and mathematical rules TrussLab follows, covering the structural model and its restrictions, units and sign conventions, supports and rotated nodal frames, and the agreed rules for load cases, settlements, the load factor λ, combinations, self-weight, sizing and deflection, with references for the model and save-file format, the analysis mathematics in fea-core.js, and the design conventions. Use it whenever you implement, review, test or explain anything that changes what TrussLab calculates, stores, imports or exports, how results are combined or checked, or how they are presented to learners, including Inspector, lesson and help text.
---

# TrussLab engineering rules

TrussLab teaches from the operations its solver really performs. Every number shown to a learner must come from a stated formula under a stated assumption, and the result object from `FEA.analyze()` is the single source of truth. Education and design code read and interpret that object; they never recompute the structural analysis themselves.

## Restrictions that apply to every milestone

- 2D, linear-elastic, small-displacement theory, with equilibrium written in the undeformed geometry. Pin-jointed members carry axial force only, and loads act at nodes only. Never add bending to a truss member, and never suggest the model is 3D.
- Euler buckling assumes ideal pin-ended members, K = 1. Keep that assumption: in a pin-jointed model, other end conditions are not consistent.
- An unstable model returns `ok: false`, mechanism modes, and no displacements. Never present numbers for it.
- Change the mathematical formulation only with a stated reason, documentation in the README's "Method" section, and regression tests.
- Never add safety factors, utilisations or member classifications across load cases or combinations: they are not linear in the loads.
- The existing horizontal-extent / maximum-total-displacement ratio is not approved as a general structural design acceptance criterion. Do not implement the design deflection check until a physically appropriate measure has been agreed upon and documented.
- Not modelled: temperature, geometric or material nonlinearity, dynamics, inelastic buckling, connection design, or design-code resistance factors. Self-weight (milestone 4) is lumped as nodal loads, W/2 at each end node; distributed loads are not modelled.

## Units and signs

- Calculations, save files and exports use SI base units: m, N, Pa, m², m⁴. The UI converts at the boundary: E in GPa, σ in MPa, A in mm², I in mm⁴, with selectable force and displacement units.
- x to the right, y upward, angles anticlockwise from +x in degrees (`FEA.util.cosSinDeg` is exact at multiples of 30° and 45°).
- Loads and reactions are positive in +x / +y, so gravity loads are negative Fy. Axial force, stress and strain are positive in tension.
- Each support restrains the x′ and/or y′ axis of a nodal frame rotated by α. Rotated frames are handled exactly, never with penalty springs.

## Agreed rules for upcoming milestones

| Milestone | Rule, in short | Details |
|---|---|---|
| 3 Load cases (done) | Every prescribed action (nodal forces and settlements) belongs to a load case; supports keep only restraint geometry. λ scales loads and settlements alike; λ = 0 gives zero results only for a stable model. File format version 2 reads version 1 files, reports and sessions | `model-format.md` §3–§7, `analysis-math.md` §4 |
| 4 Self-weight (done) | Generated dead-load case: W = ρAL·g, half to each end node, gravity −y, recomputed after any change to geometry, sections or materials (computed on every read, never stored). Densities in kg/m³; none for custom materials or older files, never inferred from a preset; a case with a member lacking density is always shown as incomplete. Douglas fir ≈ 540 kg/m³, an approximate representative value at 12 % moisture content. File format stays version 2 (optional fields; accepted downgrade limitation). No distributed loads | `analysis-math.md` §6, `model-format.md` §1, §3–§6, §8 |
| 5 Combinations (done) | F = Σγᵢ·Fᵢ and u_s = Σγᵢ·u_s,ᵢ (self-weight included) built first, then λ once; each combination solved directly with `FEA.analyze`; the worst governing value is the lowest SF among the combinations' own results, never a sum. Optional version 2 fields `combinations`, `activeCombination` | `analysis-math.md` §5, `design-conventions.md` §3, `model-format.md` §1, §3–§6, §8 |
| 10 Sizing | Discrete candidates per section group, sorted by ρA; iterate with a cap, cycle detection and an explicit not-converged result | `design-conventions.md` §4 |
| 10 Deflection | Only after a physically appropriate measure is agreed and documented | `design-conventions.md` §5 |

## References: read the one you need

- `references/model-format.md`: the in-memory model, supports, load cases, file format version 2, what `readModel` accepts (model files, autosaved sessions, report files with a nested model; version 1 migration; malformed content), model warnings, and saved-session storage and recovery. Read it before changing the model, load cases, the save format, autosave, import or export.
- `references/analysis-math.md`: the input and output of `FEA.analyze()`, the Direct Stiffness Method pipeline and its formulas, tolerances, λ and settlements, solving combinations, and self-weight lumping. Read it before writing anything that builds solver input or reads solver results.
- `references/design-conventions.md`: member checks, safety factors and status, target safety factor, material limit stresses, worst-case results over combinations, section sizing, deflection, and how to present results to learners. Read it before design checks, sizing, or any Inspector, lesson or help text.

## Testing engineering changes

Give every new formula a closed-form or hand-statics test in a headless suite, with the reference value and tolerance written down. A test that records current behaviour which a later milestone will deliberately change is labelled as a temporary characterisation test, naming the milestone that replaces it.
