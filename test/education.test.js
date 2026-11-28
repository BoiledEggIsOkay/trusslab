/*
 * Headless tests for education.js (global TrussEducation): the guided first truss (milestone 6), worked
 * calculations and predictions (milestone 7), free-body diagrams and the method of joints (milestone 8),
 * and the Solver Explorer (milestone 9). Every value is compared with a closed-form or hand-statics
 * reference, or with the solver's own result object. Run from the project folder:
 *
 *   node test/education.test.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/education.test.js
 *
 * The process exits with a non-zero code if any check fails.
 */
'use strict';

const NODE = typeof require === 'function';
const FEA = NODE ? require('../fea-core.js') : (load('fea-core.js'), globalThis.FEA);
const TM = NODE ? require('../model.js') : (load('model.js'), globalThis.TrussModel);
const ED = NODE ? require('../education.js') : (load('education.js'), globalThis.TrussEducation);
const out = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;

let passed = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) passed++;
  else failures.push(detail ? `${name}: ${detail}` : name);
  out(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
/** Relative-error check. With want = 0, |got| is compared with tol instead. */
function near(name, got, want, tol) {
  const err = want === 0 ? Math.abs(got) : Math.abs(got / want - 1);
  check(name, err <= tol, `got ${got}, expected ${want}, error ${err.toExponential(2)} > ${tol}`);
}
function same(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  check(name, a === b, `got ${a}, expected ${b}`);
}
/** Runs one group of checks; an exception counts as a failure instead of stopping the suite. */
function testCase(title, fn) {
  try { fn(); } catch (err) { failures.push(`${title}: threw ${err}`); out(`FAIL  ${title}: threw ${err}`); }
}
const analyse = (m, opts) => FEA.analyze(TM.toAnalysisInput(m, opts || { loadFactor: 1, targetSF: 1.5 }));
/** A model built step by step with the model API, as a learner builds it on the page. */
function triangle(upTo) {
  const m = TM.emptyModel('Triangle');
  const A = TM.makeNode(0, 0), B = TM.makeNode(4, 0), C = TM.makeNode(2, 3);
  if (upTo >= 1) m.nodes.push(A, B, C);
  if (upTo >= 2) m.members.push(TM.makeMember(A, B, m.groups[0]), TM.makeMember(B, C, m.groups[0]), TM.makeMember(C, A, m.groups[0]));
  if (upTo >= 3) { TM.setSupport(A, 'pin'); TM.setSupport(B, 'rollerX'); }
  if (upTo >= 4) TM.setNodeLoad(m, C, 0, -10e3);
  return { m, A, B, C };
}

testCase('Loading and API', () => {
  check('TrussEducation is a frozen object', typeof ED === 'object' && Object.isFrozen(ED));
  check('education.js loaded and works with no DOM present', typeof document === 'undefined' && typeof ED.buildProgress === 'function');
});

/* ---------- milestone 6: the guided first truss ---------- */
testCase('The guided first truss: each step is checked from the model and the solver result', () => {
  const ids = ED.BUILD_STEPS.map((s) => s.id);
  same('five steps in order', ids, ['nodes', 'members', 'supports', 'load', 'solved']);
  for (let k = 0; k <= 4; k++) {
    const { m } = triangle(k), r = m.members.length ? analyse(m) : null;
    const p = ED.buildProgress(m, r);
    const want = k === 4 ? -1 : k; // after k steps, step k (0-based) is next; all done after the load is solved
    check(`after ${k} step(s) the next step is ${want === -1 ? 'none (all done)' : ids[want]}`, p.next === want, `next ${p.next}`);
    check(`... and exactly the first ${k === 4 ? 5 : k} step(s) are done`, p.steps.filter((s) => s.done).length === (k === 4 ? 5 : k));
  }
  const { m: full } = triangle(4), r = analyse(full);
  check('the finished triangle is solved by the real solver', r.ok && ED.buildProgress(full, r).stable);
  // closed form: R_A = R_B = 5 kN; joint A: N_AC·3/√13 = −5 kN, N_AB = −N_AC·2/√13 = +10/3 kN
  near('the bar to the apex carries −5√13/3 kN (joint A)', r.members[2].force, -5000 * Math.sqrt(13) / 3, 1e-12);
  near('the tie carries +10/3 kN (joint A)', r.members[0].force, 10000 / 3, 1e-12);
});

testCase('The guided first truss: steps count only in order, and a mechanism is reported', () => {
  const { m, C } = triangle(2);
  TM.setNodeLoad(m, C, 0, -10e3); // a load before the supports
  const p = ED.buildProgress(m, analyse(m));
  check('a load applied before the supports does not complete the load step', p.next === 2 && !p.steps[3].done);
  check('... and the unsupported triangle is reported as a mechanism', p.mechanism && !p.stable);
  const { m: m2, B } = triangle(4);
  TM.setSupport(B, 'none');
  const r2 = analyse(m2), p2 = ED.buildProgress(m2, r2);
  check('removing the roller leaves too few restraints: the supports step is open again', p2.next === 2);
});

testCase('Next-step hints follow the model', () => {
  check('empty model: place nodes', /placing nodes/.test(ED.nextStepHint(TM.emptyModel(), null)));
  check('nodes only: connect them', /Connect the nodes/.test(ED.nextStepHint(triangle(1).m, null)));
  const t2 = triangle(2).m;
  check('no supports: add at least three restraints', /three restraints/.test(ED.nextStepHint(t2, analyse(t2))));
  const t3 = triangle(3).m;
  check('supported but unloaded: apply a load', /Apply a load/.test(ED.nextStepHint(t3, analyse(t3))));
  const t4 = triangle(4).m;
  check('solved: select a member', /Select a member/.test(ED.nextStepHint(t4, analyse(t4))));
  const mech = TM.buildExample('mechanism');
  check('a mechanism: the hint says how to fix it', /move without resistance/.test(ED.nextStepHint(mech, analyse(mech))));
});

/* ---------- milestone 7: worked calculations ---------- */
testCase('Worked calculation of a member: every value is the solver\'s, and the A-frame closed form holds', () => {
  // A-frame (model.js example): pins at (0, 0) and (6, 0), apex (3, 4), 100 kN down at the apex; sin θ = 0.8
  const m = TM.buildExample('aframe'), before = JSON.stringify(TM.serialize(m)), r = analyse(m);
  const k = 0, mr = r.members[k], calc = ED.memberCalc(m, r, k);
  const step = (id) => calc.steps.concat(calc.checks).find((s) => s.id === id);
  check('the calculation has geometry, deformation, force, stress and strain steps, then the checks',
    calc.steps.map((s) => s.id).join() === 'geometry,deformation,force,stress,strain' && calc.checks.map((s) => s.id).join() === 'yield,euler,buckling,governing');
  near('closed form: N = −P/(2 sin θ) = −62.5 kN', step('force').result.value, -62500, 1e-12);
  check('every result is the solver\'s value, not a recomputation', step('deformation').result.value === mr.elong && step('force').result.value === mr.force &&
    step('stress').result.value === mr.stress && step('strain').result.value === mr.strain && step('euler').result.value === mr.Pcr && step('governing').result.value === mr.sf);
  const t = Object.fromEntries(step('deformation').terms.map((x) => [x.sym, x.value]));
  near('δ substituted by hand, c(u_xj − u_xi) + s(u_yj − u_yi), agrees with the solver\'s δ', t.c * (t.u_xj - t.u_xi) + t.s * (t.u_yj - t.u_yi), mr.elong, 1e-12);
  const f = Object.fromEntries(step('force').terms.map((x) => [x.sym, x.value]));
  near('N = (E·A/L)·δ by hand agrees with the solver\'s N', f.E * f.A / f.L * f['δ'], mr.force, 1e-14);
  near('σ = N/A agrees with the solver\'s σ = E·ε', mr.force / mr.A, mr.stress, 1e-14);
  near('ε = δ/L', mr.elong / mr.L, mr.strain, 1e-15);
  near('P_cr = π²EI/L² (K = 1) is the solver\'s P_cr', ED.PI2 * mr.E * mr.I / (mr.L * mr.L), mr.Pcr, 1e-15);
  near('SF_yield = σ_y/|σ|', mr.fy / Math.abs(mr.stress), mr.sfYield, 1e-15);
  near('SF_buckling = P_cr/|N|', mr.Pcr / Math.abs(mr.force), mr.sfBuckling, 1e-15);
  check('the governing SF is the smaller of the two', step('governing').result.value === Math.min(mr.sfYield, mr.sfBuckling));
  const g = Object.fromEntries(step('geometry').terms.map((x) => [x.sym, x.value]));
  near('L = √(Δx² + Δy²) = 5 m', Math.hypot(g['Δx'], g['Δy']), 5, 1e-15);
  check('the model is not changed by the calculation', JSON.stringify(TM.serialize(m)) === before);
});

testCase('Worked calculation: a tension member has no buckling check; unstable results give none', () => {
  const m = TM.buildExample('pratt'), r = analyse(m);
  const k = r.members.findIndex((x) => x.state === 'tension'), calc = ED.memberCalc(m, r, k);
  check('a tension member: yield, Euler load and governing SF, but no buckling check', calc.checks.map((s) => s.id).join() === 'yield,euler,governing');
  check('its governing SF is the yield SF', calc.checks.find((s) => s.id === 'governing').result.value === r.members[k].sfYield);
  const mech = TM.buildExample('mechanism');
  check('an unstable model gives no calculation (never numbers for a mechanism)', ED.memberCalc(mech, analyse(mech), 0) === null && ED.nodeCalc(mech, analyse(mech), 0) === null);
});

testCase('Joint equilibrium from the solver\'s forces closes at every node of every stable example', () => {
  for (const [key] of TM.EXAMPLES) {
    if (key === 'mechanism') continue;
    const m = TM.buildExample(key), r = analyse(m);
    let worst = 0, reactOk = true;
    m.nodes.forEach((n, i) => {
      const j = ED.jointForces(m, r, i);
      worst = Math.max(worst, Math.hypot(j.residual.fx, j.residual.fy) / r.summary.Fref);
      if (j.R.supported) {
        const sx = j.members.reduce((t, x) => t + x.fx, 0), sy = j.members.reduce((t, x) => t + x.fy, 0);
        if (Math.abs(-(j.F.fx + sx) - j.R.rx) > 1e-9 * r.summary.Fref || Math.abs(-(j.F.fy + sy) - j.R.ry) > 1e-9 * r.summary.Fref) reactOk = false;
      }
    });
    check(`${key}: ΣF = F + R + Σ N·e = 0 at every node (worst ${worst.toExponential(1)} of F_ref)`, worst < 1e-9);
    check(`${key}: at every support, R = −(F + Σ N·e) agrees with the solver's R = K·u − F`, reactOk);
  }
  // direction: a tension member pulls the node toward its other end
  const m = TM.buildExample('pratt'), r = analyse(m), kT = r.members.findIndex((x) => x.state === 'tension');
  const j = ED.jointForces(m, r, r.members[kT].i), f = j.members.find((x) => x.member === kT);
  const b = m.nodes[r.members[kT].j], a = m.nodes[r.members[kT].i];
  check('a tension member pulls its node toward the other end', f.fx * (b.x - a.x) + f.fy * (b.y - a.y) > 0);
});

testCase('Worked calculation of a node: |u| and the reaction', () => {
  const m = TM.buildExample('aframe'), r = analyse(m);
  const apex = m.nodes.findIndex((n) => n.x === 3 && n.y === 4), pin = m.nodes.findIndex((n) => n.x === 0 && n.y === 0);
  const ca = ED.nodeCalc(m, r, apex), cp = ED.nodeCalc(m, r, pin);
  near('|u| at the apex is the solver\'s', ca.steps[0].result.value, r.nodes[apex].u, 0);
  check('a free node has no reaction step; a support has one', ca.steps.length === 1 && cp.steps.length === 2 && cp.steps[1].id === 'reaction');
  near('closed form: the left pin carries R_y = +50 kN', cp.joint.R.ry, 50000, 1e-12);
  near('... and R_x = +37.5 kN (the bar pushes the pin outward: 62.5 × 0.6)', cp.joint.R.rx, 37500, 1e-12);
});

/* ---------- milestone 7: predictions ---------- */
testCase('Predictions are checked against the solver\'s own tension, compression and zero', () => {
  const m = TM.buildExample('aframe'), r = analyse(m);
  const res = ED.checkPredictions(m, r, ['compression', 'tension']);
  check('two answers, one right (both bars are in compression)', res.answered === 2 && res.correct === 1 && res.complete && res.items[0].correct && !res.items[1].correct);
  check('the answer is the solver\'s classification', res.items.every((x, k) => x.actual === r.members[k].state));
  const part = ED.checkPredictions(m, r, ['compression', null]);
  check('an unanswered member is neither right nor complete', part.answered === 1 && !part.complete && !part.items[1].correct);
  check('no check for a mechanism', ED.checkPredictions(TM.buildExample('mechanism'), analyse(TM.buildExample('mechanism')), []) === null);
});

testCase('Zero-force rules: each one found is confirmed by the solver', () => {
  const found = {};
  for (const [key] of TM.EXAMPLES) {
    if (key === 'mechanism') continue;
    const m = TM.buildExample(key), r = analyse(m);
    r.members.forEach((mr, k) => {
      const rule = ED.zeroForceRule(m, r, k);
      if (rule) { found[key] = (found[key] || []).concat(`M${k + 1}`); check(`${key} M${k + 1}: the ${rule.type} rule at N${rule.node + 1} agrees with the solver (zero force)`, mr.state === 'zero'); }
    });
  }
  check('the Pratt truss has a zero-force member that a joint rule explains', !!found.pratt && found.pratt.length >= 1, JSON.stringify(found));
  const m = TM.buildExample('cantilever'), r = analyse(m), z = r.members.findIndex((x) => x.state === 'zero');
  const why = ED.predictionReason(m, r, z);
  check('the reason for a zero-force member carries the solver\'s δ and N and the rule', why.state === 'zero' && why.force === r.members[z].force && (why.rule === null || typeof why.rule.type === 'string'));
  check('the prediction exercises are existing examples', ED.PREDICTION_EXERCISES.every((x) => TM.EXAMPLES.some(([k]) => k === x.example)));
});

/* ---------- milestone 8: free-body diagrams and the method of joints ---------- */
testCase('Free-body diagram: the forces on an isolated joint balance (ΣFx = ΣFy = 0)', () => {
  const m = TM.buildExample('aframe'), r = analyse(m);
  const apex = m.nodes.findIndex((n) => n.x === 3 && n.y === 4), d = ED.fbd(m, r, apex);
  same('at the apex: two members and the load, no reaction', d.forces.map((f) => f.kind), ['member', 'member', 'load']);
  check('both bars are in compression, so they push on the apex: the force points from the bar\'s far end toward the joint',
    d.forces.filter((f) => f.kind === 'member').every((f) => f.N < 0 && f.fx * f.ex + f.fy * f.ey < 0));
  // closed form: each bar −62.5 kN; vertical components 2 × 62.5 × 0.8 = 100 kN up, balancing the 100 kN load
  near('ΣFy of the two bars is +100 kN (closed form 2 × 62.5 × 0.8)', d.forces.filter((f) => f.kind === 'member').reduce((t, f) => t + f.fy, 0), 100000, 1e-12);
  check('ΣFx and ΣFy are zero within the solver\'s tolerance', d.balanced && Math.abs(d.sumFx) <= d.tol && Math.abs(d.sumFy) <= d.tol);
  const pin = m.nodes.findIndex((n) => n.x === 0 && n.y === 0), dp = ED.fbd(m, r, pin);
  check('at the pin: the bar and the reaction', dp.forces.map((f) => f.kind).join() === 'member,reaction' && dp.balanced);
  for (const [key] of TM.EXAMPLES) {
    if (key === 'mechanism') continue;
    const mm = TM.buildExample(key), rr = analyse(mm);
    check(`${key}: every joint's free-body diagram balances`, mm.nodes.every((n, i) => !rr.nodes[i].active || ED.fbd(mm, rr, i).balanced));
  }
  check('no free-body diagram for a mechanism', ED.fbd(TM.buildExample('mechanism'), analyse(TM.buildExample('mechanism')), 0) === null);
});

testCase('Method of joints: solving joint by joint reproduces the solver\'s forces', () => {
  const m = TM.buildExample('aframe'), r = analyse(m);
  const apex = m.nodes.findIndex((n) => n.x === 3 && n.y === 4);
  const ex = ED.jointExercise(m, r, apex, new Set());
  check('the apex has two unknowns and can be solved', ex.solvable && ex.unknowns.length === 2);
  check('the joint\'s 2 × 2 solution is the solver\'s N = −62.5 kN for both bars', ex.solution.every((s) => Math.abs(s.N / -62500 - 1) < 1e-12));
  for (const [key] of TM.EXAMPLES) {
    if (key === 'mechanism') continue;
    const mm = TM.buildExample(key), rr = analyse(mm), known = new Set();
    let ok = true, guard = 0, j;
    while ((j = ED.nextJoint(mm, rr, known)) >= 0 && guard++ < 200) {
      const e = ED.jointExercise(mm, rr, j, known);
      for (const s of e.solution) { if (Math.abs(s.N - rr.members[s.member].force) > 1e-9 * rr.summary.Fref) ok = false; known.add(s.member); }
    }
    const dg = rr.determinacy.degree;
    check(`${key}: every joint solution equals the solver's N${dg === 0 ? ', and every member is reached (determinate)' : ` (degree of indeterminacy ${dg}: ${known.size} of ${mm.members.length} reached)`}`,
      ok && (dg !== 0 || known.size === mm.members.length), `${known.size} of ${mm.members.length}`);
  }
});

testCase('Method of joints: too many unknowns and collinear unknowns are recognised', () => {
  const m = TM.buildExample('pratt'), r = analyse(m);
  const counts = m.nodes.map((n, i) => ED.jointExercise(m, r, i, new Set()).unknowns.length);
  const busy = counts.findIndex((c) => c > 2);
  check('a joint with more than two unknown members cannot be solved yet', busy >= 0 && ED.jointExercise(m, r, busy, new Set()).reason === 'too-many');
  // a bottom-chord joint whose third member is known leaves two collinear chord members: not solvable from that joint
  const n2 = m.nodes.findIndex((n) => n.x === 3 && n.y === 0);
  const at = r.members.map((x, k) => k).filter((k) => r.members[k].i === n2 || r.members[k].j === n2);
  const notChord = at.filter((k) => Math.abs(r.members[k].s) > 1e-9);
  const ex = ED.jointExercise(m, r, n2, new Set(notChord));
  check('two unknown members in one line at a joint: reported as collinear', at.length === 3 && notChord.length === 1 && ex.reason === 'collinear' && !ex.solvable, `members ${at}, reason ${ex.reason}`);
});

testCase('Method of joints: answers are judged on size and sign', () => {
  const m = TM.buildExample('aframe'), r = analyse(m), apex = m.nodes.findIndex((n) => n.x === 3 && n.y === 4);
  const ex = ED.jointExercise(m, r, apex, new Set()), [a, b] = ex.unknowns.map((u) => u.member);
  const res = ED.checkJointAnswers(r, ex, { [a]: -62.4e3, [b]: 62.5e3 });
  check('−62.4 kN for −62.5 kN is right (rounded hand calculation, within 1 %)', res[0].correct);
  check('+62.5 kN for −62.5 kN: the size is right, the sign (direction) is wrong', !res[1].correct && res[1].sizeOk && !res[1].signOk);
  const none = ED.checkJointAnswers(r, ex, {});
  check('no answer is not right', none.every((x) => !x.correct && x.answer === null));
  const far = ED.checkJointAnswers(r, ex, { [a]: -70e3, [b]: -62.5e3 });
  check('−70 kN is wrong; −62.5 kN is right', !far[0].correct && far[1].correct);
});

/* ---------- milestone 9: Solver Explorer ---------- */
testCase('Solver Explorer: the stages read the solver\'s own matrices, and every relation holds', () => {
  for (const key of ['aframe', 'inclined', 'pratt', 'settlement']) {
    const m = TM.buildExample(key), before = JSON.stringify(TM.serialize(m)), r = analyse(m), ex = ED.explorer(m, r);
    const n = r.ndof;
    check(`${key}: fourteen stages, all available for a stable model`, ex.stages.length === 14 && ex.stages.every((s) => s.available));
    check(`${key}: DOFs are ordered node by node, x then y (labels "ix", "iy", primed in a rotated frame)`, m.nodes.every((nd, i) => ex.labels[2 * i].startsWith(`${i + 1}x`) && ex.labels[2 * i + 1].startsWith(`${i + 1}y`)));
    let kmax = 0;
    for (let a = 0; a < n * n; a++) kmax = Math.max(kmax, Math.abs(r.K[a]));
    // assembly: K is the sum of every member's kᵉ at its DOFs (plain summation here; the solver compensates its sums)
    const Ksum = new Float64Array(n * n);
    r.members.forEach((mr, k) => ED.assemblyContribution(r, k).forEach((c) => { Ksum[c.row * n + c.col] += c.value; }));
    let dmax = 0, asym = 0;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) { dmax = Math.max(dmax, Math.abs(Ksum[a * n + b] - r.K[a * n + b])); asym = Math.max(asym, Math.abs(r.K[a * n + b] - r.K[b * n + a])); }
    check(`${key}: K equals the sum of the element contributions (within ${(dmax / kmax).toExponential(1)} of max|K|)`, dmax <= 1e-12 * kmax);
    check(`${key}: K is exactly symmetric`, asym === 0);
    let tmax = 0;
    r.members.forEach((mr, k) => { const t = ED.memberTransformation(r, k); for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) tmax = Math.max(tmax, Math.abs(t.ke[a][b] - t.solverKe[a][b]) / mr.k); });
    check(`${key}: Tᵀ·k·T reproduces each solver kᵉ (within ${tmax.toExponential(1)} of E·A/L)`, tmax <= 1e-15);
    check(`${key}: the free and restrained DOFs partition all active DOFs`, ex.free.length + ex.fixed.length === r.nodes.filter((x) => x.active).length * 2 && ex.free.every((d) => !ex.fixed.includes(d)));
    let kffOk = true;
    for (let a = 0; a < r.nf; a++) for (let b = 0; b < r.nf; b++) if (r.Kff[a * r.nf + b] !== r.Kt[ex.free[a] * n + ex.free[b]]) kffOk = false;
    check(`${key}: K_ff is K′ restricted to the free DOFs, entry for entry`, kffOk);
    check(`${key}: the solver's u_f satisfies K_ff·u_f = b_f (relative residual ${ex.residual ? ex.residual.rel.toExponential(1) : 'n/a'})`, !ex.residual || ex.residual.rel < 1e-12);
    // member forces from the displacements, and reactions R = K·u − F
    let nOk = true;
    r.members.forEach((mr) => { const d = mr.c * (r.u[2 * mr.j] - r.u[2 * mr.i]) + mr.s * (r.u[2 * mr.j + 1] - r.u[2 * mr.i + 1]); if (Math.abs(mr.k * d - mr.force) > 1e-9 * r.summary.Fref) nOk = false; });
    check(`${key}: N = (E·A/L)·[c, s]·(u_j − u_i) for every member`, nOk);
    let rOk = true;
    for (const d of ex.fixed) { let s = -r.F[d]; for (let b = 0; b < n; b++) s += r.K[d * n + b] * r.u[b]; if (Math.abs(s - r.R[d]) > 1e-9 * r.summary.Fref && !ex.rotated.length) rOk = false; }
    check(`${key}: R = K·u − F at the restrained DOFs${ex.rotated.length ? ' (rotated frames: checked through equilibrium instead)' : ''}`, rOk);
    check(`${key}: the model is not changed`, JSON.stringify(TM.serialize(m)) === before);
    const r2 = analyse(m);
    check(`${key}: a second analysis gives identical matrices (deterministic)`, r2.K.every((v, a) => v === r.K[a]) && r2.Kff.every((v, a) => v === r.Kff[a]));
  }
});

testCase('Solver Explorer: entry contributions, size guidance and an unstable model', () => {
  const m = TM.buildExample('aframe'), r = analyse(m), ex = ED.explorer(m, r);
  const apexX = 4; // apex is node 3: DOFs 4 (x) and 5 (y)
  const c = ED.entryContributions(r, apexX, apexX);
  check('K[3x, 3x] at the apex collects one term from each bar', c.length === 2);
  near('... and their sum is the assembled entry', c.reduce((t, x) => t + x.value, 0), r.K[apexX * r.ndof + apexX], 1e-15);
  near('closed form: K[3x, 3x] = 2·(E·A/L)·c² = 2 × (200 GPa × 1000 mm² / 5 m) × 0.36', r.K[apexX * r.ndof + apexX], 2 * (200e9 * 1000e-6 / 5) * 0.36, 1e-14);
  check('the A-frame has 6 DOFs: within the table size guidance', ex.ndof === 6 && !ex.tooLarge && ex.nf === 2);
  check('the settlement truss (36 DOFs) is beyond it', ED.explorer(TM.buildExample('settlement'), analyse(TM.buildExample('settlement'))).tooLarge);
  const mech = TM.buildExample('mechanism'), rm = analyse(mech), em = ED.explorer(mech, rm);
  check('an unstable model: K and K_ff are shown, but no stage after the reduced matrix', em && em.stages.slice(0, 10).every((s) => s.available) && em.stages.slice(10).every((s) => !s.available) && !em.solved && !!em.mechanism);
});

/* ---------- report ---------- */
out('');
out(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => out(`  - ${f}`));
  if (typeof process !== 'undefined') process.exitCode = 1;
  else throw new Error(`${failures.length} check(s) failed`);
}
