# Analysis mathematics

Contents: 1 Solver interface · 2 Pipeline and formulas · 3 Tolerances · 4 λ and settlements · 5 Solving load combinations (milestone 5) · 6 Self-weight (milestone 4) · 7 Reading results for teaching and design (milestones 7–10)

The engine is `fea-core.js` (`FEA.analyze`). Treat it as fixed: build its input and read its output, and never reimplement any part of it elsewhere.

## 1. Solver interface

Input:
```
{ nodes:   [{ x, y, fx, fy, fixX, fixY, angle, dx, dy }],   // SI units; dx, dy are used only on fixed axes
  members: [{ i, j, E, A, I, fy }],                         // 0-based node indices
  options: { targetSF, ... } }                              // overrides for FEA.DEFAULTS
```

Output (main fields):
- `ok`, `stage`, `errors[{ msg, ref }]`, `warnings`, `log`, `determinacy { m, r, j, degree }`.
- `nodes[i]`: `ux`, `uy`, `u`, `rx`, `ry` (global), `rLocal`, `uLocal` (support frame), `restrained`, `rotated`, `active`.
- `members[k]`: `L`, `c`, `s`, `angle`, `k` (EA/L), `ke`, `dofs`, `elong`, `strain`, `force`, `stress`, `Pcr`, `sigmaCr`, `slenderness`, `eulerValid`, `sfYield`, `sfBuckling`, `sf`, `governs`, `state` (tension, compression or zero), `status` (safe, yielded or buckled), `lowSF`, `utilization`.
- `summary`: maximum displacements, peak tension, compression and stress, `minSF`, counts, `bucklingRisk`, `spanRatio`, `Fref`.
- `diagnostics`: rank, pivots, determinants, condition numbers, backward error, `equilibrium`, nodal residual.
- Matrices and vectors: `K`, `Kt`, `Kff`, `bf`, `F`, `u`, `R`, `dofLabels`.
- When unstable: `mechanism { nullity, modes[{ u, kind, nodes, description }], zeroDofs }`, where `kind` is zero-stiffness, rigid or internal.

## 2. Pipeline and formulas

1. **Validation.** Errors for an empty model, non-finite values, invalid member references, a member with both ends on one node, non-positive E, A, I or fy, a zero-length member, and a loaded node with no members. Warnings for duplicate members, coincident nodes, and unconnected nodes (left out of the analysis).
2. **Maxwell count.** m + r − 2j, with j the number of connected nodes.
3. **Element.** L = hypot(Δx, Δy), c = Δx/L, s = Δy/L, k = EA/L; `[kᵉ] = k[c² cs −c² −cs; cs s² −cs −s²; −c² −cs c² cs; −cs −s² cs s²]`.
4. **Assembly.** The 2n × 2n `[K]` is assembled with compensated summation, and is checked to be exactly symmetric.
5. **Rotated support frames.** K′ = Λ K Λᵀ, F′ = Λ F.
6. **Partition.** K_ff u_f = F_f − K_fs u_s, where u_s holds the prescribed displacements. `FEA.analyze()` receives F and u_s already multiplied by λ (§4).
7. **Stability, before solving.** Find zero-stiffness DOFs, scale the matrix to a unit diagonal (Jacobi equilibration), then run a pivoted Cholesky. A rank deficiency means a mechanism: no solution, and the mode shapes are returned.
8. **Solve.** LU with partial pivoting, then up to 6 steps of iterative refinement using double-word (Dot2) residuals. The determinant is computed in log form and compared between LU and Cholesky. κ₁ is exact up to 200 free DOFs and estimated (Hager/Higham) above that.
9. **Recovery.**
   - u = Λᵀ u′ and reactions R = K u − F.
   - N = k[(u₂ − u₁)c + (v₂ − v₁)s], strain ε = ΔL/L, stress σ = Eε (= N/A).
   - P_cr = π²EI/L², with σ_cr = P_cr/A.
10. **Verification.** Global ΣFx, ΣFy, and ΣM about the centroid; nodal equilibrium rebuilt from the member forces.

## 3. Tolerances (`FEA.DEFAULTS`)

| Option | Value | Role |
|---|---|---|
| `pivotTol` | 1e-11 | Rank threshold on the equilibrated pivots (at least 50·n·ε) |
| `zeroDiagTol` | 1e-13 | A diagonal below this fraction of the largest marks a zero-stiffness DOF |
| `zeroForceTol` | 1e-9 | A member is zero-force when \|N\| ≤ tol × F_ref, where F_ref = max(\|F\|, \|R\|, k_max·u_max) |
| `coincideTol` | 1e-9 | Relative to the model size: coincident nodes, zero-length members |
| `condExactMax` | 200 | Above this many free DOFs, κ₁ is estimated |
| `maxRefine` | 6 | Iterative-refinement steps |
| `illConditioned` | 1e10 | κ₁ above this triggers a near-mechanism warning |
| `targetSF` | 1.5 | Members below it are flagged `lowSF` (the UI passes the user's value) |

## 4. λ and settlements

Since milestone 3, `TrussModel.toAnalysisInput(model, { loadFactor: λ, loadCase })` (called by `buildInput` in `script.js`) builds the input from one load case, the active one by default:
- `fx = λ·F_x`, `fy = λ·F_y` for every nodal load, along global x, y;
- `dx = λ·δ_x′` on a fixed x′ axis and `dy = λ·δ_y′` on a fixed y′ axis, along the support frame rotated by `angle`; 0 on an axis that is not fixed;
- `fixX`, `fixY`, `angle` from the support (`supportRestraint`).

So the partition reads K_ff u_f = λF_f − K_fs(λu_s), and the reactions R = K u − λF, with u = λu_s at the restrained DOFs. Because the system is linear, u(λ) = λ·u(1), N(λ) = λ·N(1), R(λ) = λ·R(1), and safety factors scale as SF(λ) = SF(1)/λ.

- **λ = 0** is the zero-action state: for a stable model every displacement, member force and reaction is exactly zero. Stability does not depend on the actions, so a mechanism stays unstable at any λ, λ = 0 included, and no numbers are shown for it.
- **A settlement on an axis that is not fixed** has no effect in the solver. It is kept in the model, and `validateModel` warns about it rather than dropping it silently; the same for a settlement on a node that no member connects.
- **Tests.** `test/model.test.js` ("Load factor λ scales nodal loads and settlements alike") checks λ = 0.5, 2.5 and 0 against λ·(the λ = 1 result) and the mechanism at λ = 0. The nine examples are checked at λ = 1 against `test/fixtures/examples-baseline.js`, which is unchanged from milestone 2: at λ = 1 the old and new rules give identical solver input.
- **Version 1 models.** Before milestone 3, λ scaled loads but not settlements. A version 1 model with a settlement therefore gives different results at λ ≠ 1; the page tells the user once (see `model-format.md` §5).

## 5. Solving load combinations (milestone 5, done)

For each combination c with factors γ_i on load cases i:
- F_c = Σ γ_i F_i and u_s,c = Σ γ_i u_s,i (prescribed settlements);
- call `FEA.analyze()` once on (F_c, u_s,c), and keep the complete result.

Superposing u and N would be valid for a linear model, but the workflow solves each combination directly so that every reported number is one the solver produced. Safety factors, utilisations and classifications are never added up (see `design-conventions.md` §3).

How the code does it:
- `combinationLoads(model, c)` and `combinationSettlements(model, c)` add γᵢ·Fᵢ and γᵢ·u_s,ᵢ node by node, in load-case order, starting from 0. The self-weight case enters through `caseLoads`, so its loads are the ones computed now from the members. Settlements are added along each support's own axes x′, y′, which every case shares, because supports do not belong to load cases.
- `toAnalysisInput(model, { combination: c, loadFactor: λ })` (or with c active, by default) then multiplies the combined state by λ once: `fx = λ·Σγᵢ·F_x,i`, `dy = λ·Σγᵢ·δ_y′,i` on a fixed axis. λ is never applied to the factors and again to the sum. For a single case with γ = 1 the input is bit-identical to the case's own input, since 0 + 1·F = F.
- `analyzeCombination(model, c, opts)` calls `FEA.analyze()` on that input, for any combination, active or not; `analyzeCombinations(model, opts)` solves every combination on its own and returns one complete result per combination. Neither changes the model. Stability does not depend on the actions, so a mechanism is unstable in every combination, at any factors.
- Zero factors contribute exactly nothing; negative factors reverse a case; opposite loads cancel exactly.
- Tests: `test/model.test.js` ("Combination actions…", "Combinations of prescribed settlements…", "Each combination is solved from its complete action state…", "Non-active combinations…", "Combinations on the nine examples"). One test keeps the reason visible: a member at SF 6.0 (yield, tension) in one case and 2.53 (buckling, compression) in another has SF 24.0 in their sum, solved directly; adding utilisations would claim 1.78.

## 6. Self-weight (milestone 4, done)

- Materials need a density ρ (kg/m³). A member weighs W = ρ·A·L·g, with g = 9.80665 m/s² (standard gravity, `TrussModel.GRAVITY`; state the value used). Gravity acts in −y. Units: kg/m³ · m² · m · m/s² = kg·m/s² = N.
- Self-weight is its own generated dead-load case. Each end node receives W/2: F_y,1 = F_y,2 = −ρALg/2, F_x = 0. For a pin-ended member these are the end reactions of its own uniform weight (statics, by symmetry), so applying them at the joints is the statically equivalent lumping: the truss stays axial-only, and the member's own bending between its ends is not modelled.
- Regenerate it after any change to a section, material, or node coordinates, because it depends on the current A, ρ and L.
- No distributed loads in this milestone. The equivalent end loads above are the whole treatment.

How the code does it:
- `memberSelfWeight(member)` returns `{ density, A, L, g, W }`, with L = hypot(Δx, Δy) (the same length the solver uses) and W = 0 when the material has no density (`density` is then `null`).
- `selfWeightLoads(model)` adds −W/2 to both end nodes of every member, in member order, and returns `Map(node → { fx: 0, fy })` with non-zero entries only. It is called on every read (`caseLoads`, so `nodeLoad` and `toAnalysisInput`), never stored: "regenerate after any change" holds by construction, and repeated computation cannot accumulate.
- `toAnalysisInput(model, { loadFactor: λ, loadCase: selfWeightCase })` multiplies these loads by λ like any other (§4). The case has no settlements.
- A member whose material has no density weighs nothing here, so the case is then **incomplete**, and it must never be presented as complete (maintainer decision, milestone 4). Densities are never inferred from a preset (`model-format.md` §5). `selfWeightSummary(model)` returns `{ total, members, counted, missing, materials, complete }`: the total weight before λ of the members that have a density, the indices of those that have none, and their materials. Every place that presents the case uses it and says when it is incomplete: the health report (naming the members, "Total … from 2 of 3 members only"), the node Inspector, the canvas HUD, and the exports (the report's `meta.loadCase.complete`, `totalBeforeLoadFactor_N` and `membersWithoutDensity`, a "self-weight" row in the CSV report, and `meta.selfWeight` in the matrices export). `validateModel` also warns once per material (`model-format.md` §6). A density of 0 is a value the user chose, so it keeps the case complete.
- The self-weight case is an ordinary member of `model.loadCases` with a uid, so a combination can name it and take γ·F from `caseLoads` like any other case (milestone 5).

## 7. Reading results for teaching and design (milestones 7–10)

`fea-core.js` was not changed for the education and design features: the result already holds every intermediate quantity they need, so no diagnostic instrumentation was added.

- Used by `education.js`: per member `L`, `c`, `s`, `angle`, `k`, `ke`, `dofs`, `elong`, `force`, `stress`, `strain`, `Pcr`, `sigmaCr`, `slenderness`, `eulerValid`, `sfYield`, `sfBuckling`, `sf`, `governs`, `state`; per node `ux`, `uy`, `u`, `rx`, `ry`, `rLocal`, `restrained`, `frame`, `rotated`, `active`; the arrays `K`, `Kt`, `Kff`, `bf`, `F`, `Ft`, `u`, `ut`, `R`, `Rt`, `free`, `fixed`, `prescribed`, `dofLabels`, `ndof`, `nf`; `determinacy`, `diagnostics`, `mechanism`, `summary.Fref`.
- **Joint forces** (`jointForces`, `fbd`): a member with axial force N acts on its node with N·e, e the unit vector from that node to the member's other end (tension pulls the node toward the member, compression pushes it away). F + R + Σ N·e = 0 at every joint to round-off; the support reaction recomputed as −(F + Σ N·e) agrees with the solver's R = K·u − F (tested at every node of every example).
- **Method of joints** (`jointExercise`): with the reactions and the members already found known, the joint's two equations are solved for at most two unknown N (Cramer's rule; one unknown by projection on its member). This is the hand method, used to show it reproduces the solver (tested on every stable example); learners' answers are checked against the solver's N.
- **Solver Explorer** (`explorer`): K is the sum of the element contributions (`assemblyContribution`), kᵉ = Tᵀ·k·T with T = [c s 0 0; 0 0 c s] and k = (EA/L)[1 −1; −1 1] (`memberTransformation`), K_ff is K′ restricted to the free DOFs entry for entry, and max|K_ff·u_f − b_f| is reported as a verification. All of it reads the result; the only arithmetic checks it.
- **Design** (`design.js`): checks and sizing call `FEA.analyze(TrussModel.toAnalysisInput(model, { combination | loadCase, loadFactor: 1 }))` once per state, on a copy of the model during sizing. The unit-load sensitivity used to choose which group to stiffen for deflection analyses the same structure with a virtual self-equilibrated unit action (+n at the node, −(1 − t)·n at A, −t·n at B) and no other action.
