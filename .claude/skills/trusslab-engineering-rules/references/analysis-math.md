# Analysis mathematics

Contents: 1 Solver interface · 2 Pipeline and formulas · 3 Tolerances · 4 λ and settlements · 5 Solving load combinations (milestone 5) · 6 Self-weight (milestone 4)

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
6. **Partition.** K_ff u_f = F_f − K_fs u_s, where u_s holds the prescribed displacements.
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

**Current behaviour (until milestone 3).** `TrussModel.toAnalysisInput` (called by `buildInput` in `script.js`) sends `fx·λ`, `fy·λ`, and the support's `dx`/`dy` unscaled. The λ tooltip says so, and `test/model.test.js` records it in a temporary characterisation test. Therefore u(λ) = λ·u_loads + u_settlement, and the same holds for N and R.

**Agreed for milestone 3.**
- Every prescribed action belongs to a load case: nodal forces and settlements alike. Supports keep only type, frame angle and fixed axes.
- λ scales the complete combined action. Then u(λ) = λ·u(1), N(λ) = λ·N(1), R(λ) = λ·R(1), and λ = 0 gives exactly zero displacements and forces.
- Remove the old behaviour. Update the λ tooltip, the help text and the README. Replace the temporary characterisation test with tests that λ scales both loads and settlements, including the λ = 0 case.
- A settlement on an axis that is not restrained has no effect in the solver: warn about it instead of dropping it silently.

## 5. Solving load combinations (milestone 5)

For each combination c with factors γ_i on load cases i:
- F_c = Σ γ_i F_i and u_s,c = Σ γ_i u_s,i (prescribed settlements);
- call `FEA.analyze()` once on (F_c, u_s,c), and keep the complete result.

Superposing u and N would be valid for a linear model, but the workflow solves each combination directly so that every reported number is one the solver produced. Safety factors, utilisations and classifications are never added up (see `design-conventions.md` §3).

## 6. Self-weight (milestone 4)

- Materials need a density ρ (kg/m³). A member weighs W = ρ·A·L·g, with g = 9.80665 m/s² (state the value used). Gravity acts in −y.
- Self-weight is its own generated dead-load case. Each end node receives W/2: F_y,1 = F_y,2 = −ρALg/2.
- Regenerate it after any change to a section, material, or node coordinates, because it depends on the current A, ρ and L.
- No distributed loads in this milestone. The equivalent end loads above are the whole treatment.
