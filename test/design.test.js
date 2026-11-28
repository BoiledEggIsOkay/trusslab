/*
 * Headless tests for design.js (global TrussDesign), milestone 10: the section catalogue, design checks over
 * every action state, fully stressed sizing (convergence, cycles, the iteration cap, self-weight, indeterminate
 * trusses, missing data) and the reference-chord deflection. References are closed forms written next to the
 * checks. Run from the project folder:
 *
 *   node test/design.test.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/design.test.js
 *
 * The process exits with a non-zero code if any check fails.
 */
'use strict';

const NODE = typeof require === 'function';
const FEA = NODE ? require('../fea-core.js') : (load('fea-core.js'), globalThis.FEA);
const TM = NODE ? require('../model.js') : (load('model.js'), globalThis.TrussModel);
const TD = NODE ? require('../design.js') : (load('design.js'), globalThis.TrussDesign);
const out = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) passed++;
  else failures.push(detail ? `${name}: ${detail}` : name);
  out(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
function near(name, got, want, tol) {
  const err = want === 0 ? Math.abs(got) : Math.abs(got / want - 1);
  check(name, err <= tol, `got ${got}, expected ${want}, error ${err.toExponential(2)} > ${tol}`);
}
function testCase(title, fn) {
  try { fn(); } catch (err) { failures.push(`${title}: threw ${err}`); out(`FAIL  ${title}: threw ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`); }
}
const PI2 = Math.PI * Math.PI;
const ser = (m) => JSON.stringify(TM.serialize(m));
/** One steel bar from a pin at (0, 0) to a roller (u_y = 0) at (L, 0), loaded along its axis at the roller. */
function bar(cases, L) {
  const m = TM.emptyModel('Bar');
  const A = TM.makeNode(0, 0), B = TM.makeNode(L || 2, 0);
  m.nodes.push(A, B);
  m.members.push(TM.makeMember(A, B, m.groups[0]));
  TM.setSupport(A, 'pin'); TM.setSupport(B, 'rollerX');
  cases.forEach((Fx, i) => { const lc = i === 0 ? m.loadCases[0] : TM.addLoadCase(m); TM.setNodeLoad(m, B, Fx, 0, lc); });
  return { m, A, B };
}
const steel = TM.makeMaterial('steel'); // E 200 GPa, σy 250 MPa, ρ 7850 kg/m³

testCase('Loading and API', () => {
  check('TrussDesign is a frozen object, and loads with no DOM', typeof TD === 'object' && Object.isFrozen(TD) && typeof document === 'undefined');
});

testCase('The catalogue: A and I come from the shapes, sorted by area', () => {
  for (const id of TD.FAMILIES) {
    const f = TD.family(id);
    check(`${id}: every candidate has A and I from its own dimensions`, f.candidates.length > 5 && f.candidates.every((c) => {
      const p = TM.sectionProps(c.shape);
      return p && c.A === p.A && c.I === p.I;
    }));
    check(`${id}: sorted by area (the linear mass ρA within one material)`, f.candidates.every((c, k) => k === 0 || c.A >= f.candidates[k - 1].A));
  }
  const rod = TD.family('rod').candidates.find((c) => c.label === 'Rod ⌀30');
  near('closed form: a ⌀30 rod has A = π·30²/4 = 706.86 mm²', rod.A, Math.PI * 0.03 * 0.03 / 4, 1e-15);
  near('... and I = π·30⁴/64', rod.I, Math.PI * 0.03 ** 4 / 64, 1e-15);
  const tim = TD.family('timber').candidates.find((c) => c.label === 'Timber 45×195');
  near('timber 45×195: the weak-axis I = 195·45³/12, never inferred from A', tim.I, 0.195 * 0.045 ** 3 / 12, 1e-15);
});

testCase('Candidate checks: yield needs A ≥ SF·|N|/σy, buckling needs I ≥ SF·|N|·L²/(π²E)', () => {
  const rods = TD.family('rod').candidates, byLabel = (l) => rods.find((c) => c.label === l);
  // N = +100 kN, SF 1.5: A ≥ 1.5 × 100 kN / 250 MPa = 600 mm²
  check('tension 100 kN: ⌀25 (491 mm²) fails yield', TD.candidateFailure(byLabel('Rod ⌀25'), 100e3, 2, steel, 1.5).check === 'yield');
  check('... ⌀30 (707 mm²) passes', TD.candidateFailure(byLabel('Rod ⌀30'), 100e3, 2, steel, 1.5) === null);
  // N = −100 kN, L = 2 m: I ≥ 1.5 × 100 kN × 4 m² / (π² × 200 GPa) = 303 960 mm⁴
  const f40 = TD.candidateFailure(byLabel('Rod ⌀40'), -100e3, 2, steel, 1.5);
  check('compression 100 kN over 2 m: ⌀40 (I = 125 664 mm⁴) fails buckling', f40.check === 'buckling');
  near('... the required I is 1.5·N·L²/(π²E)', f40.required, 1.5 * 100e3 * 4 / (PI2 * 200e9), 1e-14);
  check('... ⌀50 (I = 306 796 mm⁴) passes', TD.candidateFailure(byLabel('Rod ⌀50'), -100e3, 2, steel, 1.5) === null);
  check('a candidate without I cannot pass in compression: reported, never assumed', TD.candidateFailure({ A: 1, I: null }, -1e3, 1, steel, 1.5).check === 'no-inertia');
  check('... while in tension I is not needed', TD.candidateFailure({ A: 1, I: null }, 1e3, 1, steel, 1.5) === null);
});

testCase('Sizing a single bar: tension-controlled, then compression-controlled', () => {
  const t = bar([100e3]), before = ser(t.m);
  const r = TD.sizeSections(t.m, { families: { 0: 'rod' }, targetSF: 1.5 });
  check('tension: converged to ⌀30, the lightest rod with A ≥ 600 mm²', r.status === 'converged' && r.acceptable && r.groups[0].to.label === 'Rod ⌀30', `${r.status} ${r.groups[0] && r.groups[0].to.label}`);
  check('... and the next lighter rod, ⌀25, is reported as failing yield', r.groups[0].lighter && r.groups[0].lighter.candidate === 'Rod ⌀25' && r.groups[0].lighter.check === 'yield');
  check('... a determinate truss without self-weight settles in two iterations (size, then confirm)', r.iterations.length <= 2, `${r.iterations.length}`);
  near('... mass Σ ρ·A·L = 7850 × π·0.03²/4 × 2 = 11.098 kg', r.mass.after.mass, 7850 * Math.PI * 0.03 * 0.03 / 4 * 2, 1e-12);
  check('the model itself is never changed by sizing', ser(t.m) === before);
  const c = bar([-100e3]), rc = TD.sizeSections(c.m, { families: { 0: 'rod' }, targetSF: 1.5 });
  check('compression: converged to ⌀50, governed by buckling', rc.acceptable && rc.groups[0].to.label === 'Rod ⌀50' && rc.groups[0].governs.mode === 'buckling');
  check('... ⌀40 is reported as failing buckling', rc.groups[0].lighter.candidate === 'Rod ⌀40' && rc.groups[0].lighter.check === 'buckling');
  check('... and the final check analyses the proposal: SF ≥ 1.5 in every state', rc.check.pass && rc.check.members.every((x) => x.minSF >= 1.5));
});

testCase('Every state counts: a member in tension in one case and compression in another', () => {
  const t = bar([100e3, -60e3]); // ⌀30 is enough for +100 kN; −60 kN over 2 m needs I ≥ 182 376 mm⁴: ⌀50
  const r = TD.sizeSections(t.m, { families: { 0: 'rod' }, targetSF: 1.5, which: 'cases' });
  check('both load cases are checked, and the compression case governs (⌀50, buckling, "Load case 2")',
    r.acceptable && r.groups[0].to.label === 'Rod ⌀50' && r.groups[0].governs.mode === 'buckling' && r.groups[0].governs.state.name === 'Load case 2');
  const d = TD.checkDesign(t.m, { which: 'cases', targetSF: 1.5 });
  check('checkDesign takes the lowest SF of each member over the cases (never a sum)', d.members[0].minSF === Math.min(...d.runs.map((x) => x.result.members[0].sf)));
  const comb = TM.addCombination(t.m, 'C1'); TM.setCombinationFactor(t.m, comb, t.m.loadCases[0], 1); TM.setCombinationFactor(t.m, comb, t.m.loadCases[1], 1);
  check('with combinations, the default states are the combinations', TD.designStates(t.m).map((s) => s.kind).join() === 'combination');
});

testCase('Fully stressed design of a truss with several groups, self-weight and combinations', () => {
  const m = TM.buildExample('pratt');
  const sw = TM.addSelfWeightCase(m), uls = TM.addCombination(m, 'ULS');
  TM.setCombinationFactor(m, uls, sw, 1.35); TM.setCombinationFactor(m, uls, m.loadCases[0], 1.5);
  const before = ser(m);
  const r = TD.sizeSections(m, { families: { 0: 'chs', 1: 'chs' }, targetSF: 1.5 });
  check(`converged (${r.status}, ${r.iterations.length} iterations) with every member at SF ≥ 1.5 in the combination`, r.status === 'converged' && r.acceptable && r.check.pass);
  // independent verification: put the proposal into a copy and check it again from scratch
  const copy = TM.readModel(JSON.parse(ser(m))).model;
  r.groups.forEach((g) => TD.applyCandidate(copy.groups[g.group], g.to));
  const again = TD.checkDesign(copy, { targetSF: 1.5 });
  check('the proposal, applied to a fresh copy, passes the same check with the same governing SF', again.pass && again.governing.minSF === r.check.governing.minSF);
  // the self-weight of the analysed proposal is Σ ρ·A·L·g with the proposed areas (it is recomputed, never stored)
  const want = copy.members.reduce((t, e) => t + e.group.material.density * e.group.A * Math.hypot(e.n2.x - e.n1.x, e.n2.y - e.n1.y) * TM.GRAVITY, 0);
  near('the self-weight in the final check is Σ ρ·A·L·g of the proposed sections', TM.selfWeightSummary(copy).total, want, 1e-12);
  check('the iteration started from the lightest sizes and re-analysed with the heavier self-weight before converging',
    r.history.length >= 2 && r.history[0].every((l) => l === 'CHS 33.7×3.2') && r.iterations.length >= 2);
  check('the original model is unchanged', ser(m) === before);
  check('each group explains its choice: the governing member, state and mode', r.groups.every((g) => g.governs && typeof g.governs.member === 'number' && g.governs.state.name === 'ULS'));
});

testCase('Indeterminate truss: forces change with the sections, so the sizing iterates', () => {
  const m = TM.buildExample('settlement'); // two spans, indeterminate to degree 1, with a support settlement case
  const r = TD.sizeSections(m, { families: { 0: 'chs' }, targetSF: 1.5, which: 'cases' });
  check(`a status is always reported (${r.status})`, ['converged', 'cycle', 'max-iterations', 'no-candidate'].includes(r.status));
  if (r.status === 'converged') check('converged: the final analysis passes in every load case', r.check.pass && r.acceptable);
  else check('not converged: no proposal is offered as acceptable', !r.acceptable);
});

testCase('Stopping rules: converged, cycle, iteration cap, and a failed analysis', () => {
  const c = TD.iterateSelections([0], (sel) => [Math.min(sel[0] + 1, 3)], 20);
  check('a selection that stops changing has converged', c.status === 'converged' && c.selection.join() === '3');
  const cyc = TD.iterateSelections([0, 0], (sel) => (sel[0] === 0 ? [1, 0] : [0, 0]), 20);
  check('a selection that comes back to an earlier one is a cycle (and is not accepted)', cyc.status === 'cycle' && cyc.cycleFrom === 0 && cyc.selection === null);
  const cap = TD.iterateSelections([0], (sel) => [sel[0] + 1], 5);
  check('a selection that keeps changing stops at the cap: max-iterations', cap.status === 'max-iterations' && cap.iterations === 5 && cap.selection === null);
  const m = TM.buildExample('pratt'), r = TD.sizeSections(m, { families: { 0: 'chs', 1: 'chs' }, maxIterations: 1 });
  check('sizing with a cap of one iteration: max-iterations, and not acceptable', r.status === 'max-iterations' && !r.acceptable);
  const mech = TM.buildExample('mechanism'), rm = TD.sizeSections(mech, { families: { 0: 'chs' } });
  check('an unstable model is reported, never sized', rm.status === 'unstable' && !rm.acceptable);
});

testCase('Missing data: a candidate without I, and materials without density', () => {
  const t = bar([-100e3]);
  const custom = { custom: { candidates: [{ id: 'x0', label: 'no I', shape: { type: 'custom' }, A: 0.01, I: null }].concat(TD.family('rod').candidates) } };
  const r = TD.sizeSections(t.m, { families: { 0: 'custom' }, catalogue: custom, targetSF: 1.5 });
  check('a candidate without I is never chosen for a compression member, however large its area', r.acceptable && r.groups[0].to.label === 'Rod ⌀50');
  const u = bar([100e3]);
  u.m.groups[0].material = TM.makeMaterial('custom'); // no density
  u.m.materials.push(u.m.groups[0].material);
  const ru = TD.sizeSections(u.m, { families: { 0: 'rod' }, targetSF: 1.5 });
  const fy = u.m.groups[0].material.fy, need = 1.5 * 100e3 / fy;
  const want = TD.family('rod').candidates.find((c) => c.A >= need);
  check('without density, candidates are ranked by area and the mass is marked incomplete', ru.acceptable && ru.groups[0].to.label === want.label && !ru.mass.after.complete);
});

/* ---------- reference-chord deflection ---------- */
function frame() {
  const m = TM.buildExample('aframe'); // pins N1 (0, 0) and N2 (6, 0), apex N3 (3, 4); 100 kN down: u3y = −1.953125 mm
  const [A, B] = [m.nodes.find((n) => n.x === 0 && n.y === 0), m.nodes.find((n) => n.x === 6 && n.y === 0)];
  const P = m.nodes.find((n) => n.x === 3 && n.y === 4);
  return { m, A, B, P };
}
testCase('Reference-chord deflection: the closed form, and the limit', () => {
  const { m, A, B, P } = frame();
  check('no criterion: serviceability is reported as unconfigured', TD.checkDeflection(m, {}).status === 'unconfigured');
  check('an invalid criterion is refused (same node twice, or a limit ≤ 0)', !TM.setDeflectionCriterion(m, { a: A, b: A, nodes: [P], limit: { type: 'ratio', value: 300 } }) && !TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [P], limit: { type: 'ratio', value: 0 } }));
  check('a valid criterion is set: chord N1–N2, node N3, span/300', TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [P], limit: { type: 'ratio', value: 300 } }));
  const d = TD.checkDeflection(m, { which: 'cases' });
  near('δ at the apex, relative to the chord, is |u3y| = 1.953125 mm (closed form)', d.governing.delta, 1.953125e-3, 1e-12);
  near('the allowable value is span/300 = 6 m / 300 = 20 mm', d.allow, 0.02, 1e-15);
  check('... so it passes', d.status === 'pass');
  TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [P], limit: { type: 'absolute', value: 0.001 } });
  check('an absolute limit of 1 mm fails, and names N3 and the load case', TD.checkDeflection(m, { which: 'cases' }).status === 'fail' && TD.checkDeflection(m, { which: 'cases' }).governing.node === m.nodes.indexOf(P));
});

testCase('Reference-chord deflection: settlements that move the truss rigidly are not deflection', () => {
  const { m, A, B, P } = frame();
  TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [P], limit: { type: 'ratio', value: 300 } });
  TM.setNodeLoad(m, P, 0, 0);
  TM.setNodeSettlement(m, A, 0, -0.01); TM.setNodeSettlement(m, B, 0, -0.01); // both pins settle 10 mm
  let r = FEA.analyze(TM.toAnalysisInput(m, { loadFactor: 1 }));
  let d = TD.chordDeflection(m, r, TM.criterion ? TM.criterion(m) : m.design.deflection);
  near('equal settlement: the apex moves 10 mm in total', r.nodes[m.nodes.indexOf(P)].u, 0.01, 1e-12);
  check('... but its deflection relative to the chord is 0', d.nodes[0].delta <= 1e-15);
  TM.setNodeSettlement(m, A, 0, 0); // only N2 settles: the determinate frame rotates as a rigid body
  r = FEA.analyze(TM.toAnalysisInput(m, { loadFactor: 1 }));
  d = TD.chordDeflection(m, r, m.design.deflection);
  check('differential settlement of a determinate frame: the apex moves, with no member force', r.nodes[m.nodes.indexOf(P)].u > 1e-3 && r.members.every((x) => x.state === 'zero'));
  check('... and the chord deflection is 0 (rigid rotation is not deformation)', d.nodes[0].delta <= 1e-12 * 0.01, `${d.nodes[0].delta}`);
});

testCase('Sizing with a deflection limit: strength first, then the stiffest step per mass', () => {
  const m = TM.buildExample('pratt');
  const A = m.nodes.find((n) => n.x === 0 && n.y === 0), B = m.nodes.find((n) => n.x === 18 && n.y === 0), mid = m.nodes.find((n) => n.x === 9 && n.y === 0);
  const strength = TD.sizeSections(m, { families: { 0: 'chs', 1: 'chs' }, targetSF: 1.5 });
  const d0 = TD.checkDeflection(Object.assign({}, m), {});
  check('no criterion: the sizing reports serviceability as unconfigured', strength.deflection.status === 'unconfigured' && d0.status === 'unconfigured');
  // span/1200 = 15 mm, smaller than the strength-sized deflection: the sizing must stiffen
  TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [mid], limit: { type: 'ratio', value: 1200 } });
  const r = TD.sizeSections(m, { families: { 0: 'chs', 1: 'chs' }, targetSF: 1.5 });
  check(`span/1200: converged and acceptable, with the deflection within the limit (${r.status}, ${(r.deflection.governing.delta * 1e3).toFixed(2)} mm ≤ 15 mm)`,
    r.status === 'converged' && r.acceptable && r.deflection.status === 'pass' && r.deflection.governing.delta <= 0.015 && r.check.pass);
  check('... stiffening costs mass: heavier than the strength-only design', r.mass.after.mass > strength.mass.after.mass);
  check('... and the strength-only design would not have met it', TD.checkDeflection((() => { const c = TM.readModel(JSON.parse(ser(m))).model; strength.groups.forEach((g) => TD.applyCandidate(c.groups[g.group], g.to)); return c; })(), {}).status === 'fail');
  TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [mid], limit: { type: 'ratio', value: 20000 } }); // 0.9 mm: beyond the largest CHS
  const imp = TD.sizeSections(m, { families: { 0: 'chs', 1: 'chs' }, targetSF: 1.5 });
  check(`an impossible limit (span/20000) is reported as not met, with no acceptable proposal (${imp.status})`, imp.status === 'deflection-not-met' && !imp.acceptable);
});

out('');
out(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => out(`  - ${f}`));
  if (typeof process !== 'undefined') process.exitCode = 1;
  else throw new Error(`${failures.length} check(s) failed`);
}
