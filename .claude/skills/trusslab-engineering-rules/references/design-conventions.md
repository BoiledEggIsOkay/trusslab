# Design conventions

Contents: 1 Member checks · 2 Material limit stresses · 3 Results over combinations · 4 Section sizing (milestone 10) · 5 Deflection · 6 Presenting results to learners · 7 Educational analysis and code-compliant design

## 1. Member checks (as `fea-core.js` computes them)

- SF_yield = σ_y / |σ|.
- SF_buckling = P_cr / |N|, for compression members only, with P_cr = π²EI/L², pin-ended (K = 1), about the I entered for the group (use the weak axis).
- SF = min(SF_yield, SF_buckling), and `governs` names the smaller one. Utilisation = 1/SF.
- Status: yielded or buckled when SF < 1, otherwise safe. A zero-force member has SF = ∞ and status safe.
- Target safety factor: a safe member with SF below the user's target (default 1.5) is flagged `lowSF`, shown amber and described as "safe, below target", never as failed.
- `eulerValid` is false when σ_cr > σ_y; yielding then governs. Inelastic buckling and imperfections are not modelled.
- `summary.bucklingRisk` lists compression members with SF_buckling < max(target, 1).

## 2. Material limit stresses

`fy` is the yield stress for metals. Timber has no yield point: the Douglas fir preset uses 49.9 MPa, the clear-wood compressive strength parallel to the grain at 12 % moisture content (USDA Wood Handbook). Graded design values are much lower. Keep that warning wherever timber results are shown, and never present the preset as a design value. Its density, 540 kg/m³, is likewise an approximate representative value at 12 % moisture content (`model-format.md` §1), and is labelled so.

## 3. Results over combinations

A design check evaluates every required combination separately (each solved directly, see `analysis-math.md` §5) and reports the worst governing value: the lowest SF or the highest utilisation, together with the combination and the check that produce it.

Never add safety factors, utilisations or member classifications across load cases or combinations. They are not linear in the loads, and a sum has no physical meaning.

Since milestone 5, `TrussModel.combinationEnvelope(model, runs)` takes the results of `analyzeCombinations` and returns, for every member, its lowest SF, largest tension and largest compression, each with the combination that produces it, and `governing`: the lowest SF of any member in any combination, with its member, mode and combination. Every value is read from one combination's own result. A combination that could not be solved is listed in `unsolved`, and `complete` is false: then no statement covers every combination. The page shows this in the health report when a combination is on screen, and reports export it as `combinationResults`.

## 4. Section sizing (milestone 10, implemented in `design.js`)

- **Catalogue.** Families of discrete candidates (`TrussDesign.family`: CHS, SHS, solid rods, sawn timber rectangles) with nominal dimensions. A and I are computed from the shape with `TrussModel.sectionProps` (idealised, sharp corners, weak-axis I); I is never inferred from A. An educational catalogue, not a product list.
- **States.** `designStates`: every combination when the model has any, otherwise every load case, or only what is analysed. Each state is solved directly with `FEA.analyze` at λ = 1 (factors belong in the combinations).
- **Requirements per member and state** (`candidateFailure`): A ≥ SF·|N|/σ_y; in compression also I ≥ SF·|N|·L²/(π²E) (Euler, K = 1). A candidate without I is never accepted in compression (`no-inertia`), and the report says so.
- **Iteration** (`sizeSections`, `iterateSelections`): candidates sorted by linear mass ρA (by A when the material has no density, and the mass is then marked incomplete); start from the lightest candidate of each family (deterministic); each iteration applies the selection to a copy of the model, analyses every state (so self-weight and, in an indeterminate truss, the force distribution follow the sections), and picks for each group the lightest candidate that passes every member in every state. It stops on `converged` (the selection repeats), `cycle` (it returns to an earlier selection), or `max-iterations` (20 by default). An unstable or invalid state stops it with that status.
- **Deflection in sizing.** With a criterion, a converged strength design that fails the deflection limit gets the group with the largest unit-load contribution to the governing deflection per added linear mass raised one size (a lower bound), then strength sizing runs again. Bounded by the number of available size steps. A heuristic, stated as such; when no group can grow, the status is `deflection-not-met`.
- **Acceptance.** A proposal is acceptable only if it converged and its final analysis (of the proposal itself, in every state) passes strength, buckling and the deflection limit. Otherwise nothing can be applied, and the status names the reason. Each group reports its governing member, state and mode, and why the next lighter candidate fails.
- **Model safety.** Sizing never changes the model it is given. Applying a proposal on the page is one undoable edit.
- A determinate structure without self-weight converges in two iterations (size, confirm), since its forces do not depend on the sections.

## 5. Deflection (milestone 10, implemented)

`summary.spanRatio` ((x_max − x_min) / max_i |u_i|) is not a design criterion: it counts support sliding and settlement as deflection, mixes directions, and its "span" means nothing for cantilevers and towers. It may still appear as an informational value, never as a check.

The agreed measure is the **reference chord** (`TrussDesign.chordDeflection`, `checkDeflection`). The user chooses two reference nodes A, B, the nodes P to check, and a limit (span/ratio with span = |AB|, or an absolute value in metres). For each P, with t the projection of P's original position on AB:

- u_ref = (1 − t)·u_A + t·u_B, u_rel = u_P − u_ref, δ = |u_rel · n|, n the unit normal of the original chord.
- A rigid-body translation or small rotation moves P exactly like u_ref across the chord, so δ measures deformation only. A settlement that only moves or tilts the truss gives δ = 0 (tested: equal settlement of both supports, and differential settlement of the determinate A-frame).
- The check reports the governing node and state, δ and the allowable value, and the total displacement beside it (which includes rigid-body movement).
- With no criterion set, serviceability is reported as unconfigured. Never invent a universal limit.

The criterion is stored in the model (`model.design.deflection`), saved as an optional version 2 field (`model-format.md`).

## 6. Presenting results to learners

- Show the formula, then the substitution with the actual values from the result object, in the displayed units. Example: σ = N/A = 42 500 N / 500 mm² = 85 MPa.
- State the assumption next to the result: linear, small displacement, pin-ended K = 1, loads at nodes.
- Keep animations physically honest:
  - label the deformation scale factor;
  - never animate a load "travelling" through the truss, because static equilibrium is instantaneous and has no unique load path;
  - after milestone 3, animating λ from 0 to 1 is fine, because the response is linear.
- Say "unstable: no solution" for a mechanism, and show its mode shape instead of numbers.

- **Learn activities (milestones 7–11).** Worked calculations show the equation, the substitution in SI base units (never mixed units), the result (also in display units) and its meaning, from the solver's own values (`TrussEducation.memberCalc`, `nodeCalc`). Predictions and joint answers are checked against the solver's N and its zero-force classification; the explanation uses the solver's δ and N, and a joint rule (two non-collinear members, or a collinear pair plus one) only where it applies exactly. While a prediction or a method-of-joints exercise is open, every result is hidden (`resultsHidden()`). Free-body diagrams draw tension pulling away from the joint and compression pushing on it, and show the real round-off residual. Lessons compute their worked examples from the real model; challenges are objective criteria; written reasoning is never graded.

## 7. Educational analysis and code-compliant design

TrussLab is an educational analysis tool. Code-compliant design also needs load combinations from a standard, resistance factors, imperfections, connection design and serviceability rules that the app does not implement. Keep that distinction visible in every design feature and in the README.
