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

`fy` is the yield stress for metals. Timber has no yield point: the Douglas fir preset uses 49.9 MPa, the clear-wood compressive strength parallel to the grain at 12 % moisture content (USDA Wood Handbook). Graded design values are much lower. Keep that warning wherever timber results are shown, and never present the preset as a design value.

## 3. Results over combinations

A design check evaluates every required combination separately (each solved directly, see `analysis-math.md` §5) and reports the worst governing value: the lowest SF or the highest utilisation, together with the combination and the check that produce it.

Never add safety factors, utilisations or member classifications across load cases or combinations. They are not linear in the loads, and a sum has no physical meaning.

## 4. Section sizing (milestone 10)

- Use discrete candidate sections, organised by the existing section groups and sorted by linear mass m′ = ρA. Never brute-force combinations of sections across members.
- For each group, choose the lightest candidate that passes the strength and buckling checks in every required combination.
- Iterate. In an indeterminate structure the member forces depend on the stiffnesses, and with self-weight the loads depend on the areas, so re-analyse after each round of changes. Use:
  - a deterministic group update order;
  - a maximum iteration count;
  - detection of repeated section selections (cycles);
  - an explicit not-converged result, naming the groups and checks responsible.
- A determinate structure without self-weight reaches its force-based sizing in one pass, because its member forces do not depend on the sections (if the catalogue and the checks allow it).
- Meeting strength and buckling does not imply meeting a deflection limit. Deflection is not part of section selection (see §5).

## 5. Deflection

The existing horizontal-extent / maximum-total-displacement ratio is not approved as a general structural design acceptance criterion. Do not implement the design deflection check until a physically appropriate measure has been agreed upon and documented.

The reason: `summary.spanRatio` is (x_max − x_min) / max_i |u_i|. That is the horizontal extent of the model divided by the largest total movement of any node, so it:
- counts support sliding and imposed settlements as deflection;
- mixes horizontal and vertical movement;
- uses a "span" that is meaningless for cantilevers and towers.

It may keep appearing as an informational value. When the measure is redefined in milestone 10, make the allowable ratio configurable and never invent a universal limit.

## 6. Presenting results to learners

- Show the formula, then the substitution with the actual values from the result object, in the displayed units. Example: σ = N/A = 42 500 N / 500 mm² = 85 MPa.
- State the assumption next to the result: linear, small displacement, pin-ended K = 1, loads at nodes.
- Keep animations physically honest:
  - label the deformation scale factor;
  - never animate a load "travelling" through the truss, because static equilibrium is instantaneous and has no unique load path;
  - after milestone 3, animating λ from 0 to 1 is fine, because the response is linear.
- Say "unstable: no solution" for a mechanism, and show its mode shape instead of numbers.

## 7. Educational analysis and code-compliant design

TrussLab is an educational analysis tool. Code-compliant design also needs load combinations from a standard, resistance factors, imperfections, connection design and serviceability rules that the app does not implement. Keep that distinction visible in every design feature and in the README.
