/*!
 * education.js - DOM-free teaching logic of TrussLab (global TrussEducation).
 *
 * Everything here reads the model (model.js) and the result object of FEA.analyze() (fea-core.js) and
 * interprets it for a learner. Nothing here solves the structure again: every number it returns comes
 * from the solver's own result, so what a learner is shown is what the solver computed.
 * It runs in browsers (global TrussEducation), in Node.js (require('./education.js')) and in
 * JavaScriptCore (load('education.js')), after fea-core.js and model.js.
 */
(function (root, factory) {
  'use strict';
  const FEA = root.FEA || (typeof require === 'function' ? require('./fea-core.js') : undefined);
  const TM = root.TrussModel || (typeof require === 'function' ? require('./model.js') : undefined);
  if (!FEA || !TM) throw new Error('education.js needs fea-core.js and model.js: load them first.');
  const api = factory(FEA, TM);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrussEducation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FEA, TM) {
  'use strict';

  /* =====================================================================
   * 1. The guided first truss (milestone 6)
   *    A step is done when the model (and, for the last steps, the solver's result) shows it is done.
   * ===================================================================== */
  const BUILD_STEPS = [
    { id: 'nodes', title: 'Place three nodes', how: 'Press N (or choose the node tool) and click three points that are not on one line, for example (0, 0), (4, 0) and (2, 3).',
      why: 'Nodes are the joints of the truss: the only places where members meet and where loads and supports act.' },
    { id: 'members', title: 'Connect them into a triangle', how: 'Press M and click node to node: 1 to 2, 2 to 3, 3 to 1. Press Esc to end the chain.',
      why: 'A triangle is the simplest shape that cannot change shape without a member changing length: that is why trusses are made of triangles.' },
    { id: 'supports', title: 'Support it: a pin and a roller', how: 'Press S, choose Pin and click the left node; choose Roller (uy = 0) and click the right node.',
      why: 'The pin stops movement in x and y, the roller only in y. Together they give three restraints: enough to stop the truss sliding or rotating, without over-constraining it.' },
    { id: 'load', title: 'Load the top node', how: 'Press L, set Fx = 0 and Fy = −10 (kN, downward), and click the top node.',
      why: 'Loads act at nodes. A negative Fy points down, like gravity.' },
    { id: 'solved', title: 'Read the result', how: 'With Live on, the truss is solved at once. Select a member to see its axial force, and why it is in tension or compression.',
      why: 'Blue members (+) are in tension, orange members (−) in compression. The reactions at the supports balance the load.' },
  ];
  /**
   * Progress of the guided first truss on the current model. `result` is the solver result for it (or null).
   * Returns { steps: [{ id, title, how, why, done }], next: index of the first step not done (or -1), stable }.
   */
  function buildProgress(model, result) {
    const nodes = model.nodes.length, members = model.members.length;
    let restraints = 0;
    for (const n of model.nodes) { const r = TM.supportRestraint(n.support); restraints += (r.fixX ? 1 : 0) + (r.fixY ? 1 : 0); }
    const loaded = model.nodes.some((n) => { const L = TM.nodeLoad(model, n); return L.fx !== 0 || L.fy !== 0; });
    const solved = !!(result && result.ok);
    const done = { nodes: nodes >= 3, members: members >= 3, supports: restraints >= 3, load: loaded, solved: solved && loaded };
    const steps = BUILD_STEPS.map((s) => Object.assign({}, s, { done: !!done[s.id] }));
    // steps are done in order: a later step counts only once the earlier ones are done
    let next = -1;
    for (let i = 0; i < steps.length; i++) {
      if (next >= 0) steps[i].done = false;
      else if (!steps[i].done) next = i;
    }
    return { steps, next, stable: solved, mechanism: !!(result && result.mechanism) };
  }

  /** What a beginner could do next with the model in front of them (one sentence), or '' when nothing is missing. */
  function nextStepHint(model, result) {
    if (!model.nodes.length) return 'Start by placing nodes (N), or open an example from the File menu.';
    if (!model.members.length) return 'Connect the nodes with members (M).';
    let restraints = 0;
    for (const n of model.nodes) { const r = TM.supportRestraint(n.support); restraints += (r.fixX ? 1 : 0) + (r.fixY ? 1 : 0); }
    if (restraints < 3) return 'Add supports (S): a 2D truss needs at least three restraints, for example a pin and a roller.';
    if (result && result.mechanism) return 'The truss can move without resistance: add a member or a support where the animated mode shape moves.';
    const loaded = model.nodes.some((n) => { const L = TM.nodeLoad(model, n); return L.fx !== 0 || L.fy !== 0; }) || model.nodes.some((n) => { const s = TM.nodeSettlement(model, n); return s.dx !== 0 || s.dy !== 0; });
    if (!loaded) return 'Apply a load (L) to a node: without actions every force is zero.';
    if (result && result.ok) return 'Select a member to see its force and the calculation behind it.';
    return '';
  }

  /* =====================================================================
   * 2. Worked calculations (milestone 7)
   *    A step is { id, title, equation, terms, subst, result, note }. `terms` and `result` are quantities
   *    { sym, name, value, kind } in SI base units, read from the solver's result object: the page formats
   *    them (one unit system per substitution, never mixed) and never recomputes them. `subst` is the
   *    substitution as a list of text pieces and term symbols, so the page can write it with the values.
   *    Kinds: length, disp, force, stress, modulus, area, inertia, stiffness, ratio, strain, angle.
   * ===================================================================== */
  const q = (sym, name, value, kind) => ({ sym, name, value, kind });
  /** π²: the same constant the solver uses (fea-core.js: PI2 = Math.PI * Math.PI). */
  const PI2 = Math.PI * Math.PI;

  /**
   * The worked calculation of member k: geometry, axial deformation, axial force, stress, strain, and the
   * yield and Euler buckling checks. Every result value is the solver's own (result.members[k]); the
   * substituted inputs are the solver's too (its nodal displacements, its E, A, I, fy, L, c, s).
   */
  function memberCalc(model, result, k) {
    if (!result || !result.ok || !result.members[k]) return null;
    const r = result.members[k], ni = result.nodes[r.i], nj = result.nodes[r.j];
    const a = model.nodes[r.i], b = model.nodes[r.j];
    const dx = b.x - a.x, dy = b.y - a.y;
    const steps = [];
    steps.push({ id: 'geometry', title: 'Length and direction',
      equation: 'L = √(Δx² + Δy²),  c = Δx/L,  s = Δy/L',
      terms: [q('Δx', 'x_j − x_i, along global x', dx, 'length'), q('Δy', 'y_j − y_i, along global y', dy, 'length')],
      subst: ['L = √((', 'Δx', ')² + (', 'Δy', ')²)'],
      result: q('L', 'length of the member', r.L, 'length'),
      extra: [q('c', 'cos θ = Δx/L', r.c, 'ratio'), q('s', 'sin θ = Δy/L', r.s, 'ratio'), q('θ', 'angle from +x, anticlockwise', r.angle, 'angle')],
      note: 'c and s point from the start node to the end node; the solver uses them, rather than cos(atan2(…)), to avoid round-off.' });
    steps.push({ id: 'deformation', title: 'Axial deformation δ (change of length)',
      equation: 'δ = c·(u_xj − u_xi) + s·(u_yj − u_yi)',
      terms: [q('c', 'direction cosine', r.c, 'ratio'), q('s', 'direction sine', r.s, 'ratio'),
        q('u_xi', `x-displacement of node ${r.i + 1}`, ni.ux, 'disp'), q('u_xj', `x-displacement of node ${r.j + 1}`, nj.ux, 'disp'),
        q('u_yi', `y-displacement of node ${r.i + 1}`, ni.uy, 'disp'), q('u_yj', `y-displacement of node ${r.j + 1}`, nj.uy, 'disp')],
      subst: ['δ = ', 'c', ' × (', 'u_xj', ' − ', 'u_xi', ') + ', 's', ' × (', 'u_yj', ' − ', 'u_yi', ')'],
      result: q('δ', 'change of length (+ longer, − shorter)', r.elong, 'disp'),
      note: 'Only the part of the relative movement of the two ends that lies along the member changes its length. The solver evaluates this sum in double-word arithmetic, so its δ can differ from a hand calculation in the last digits.' });
    steps.push({ id: 'force', title: 'Axial force N',
      equation: 'N = (E·A/L)·δ',
      terms: [q('E', "Young's modulus", r.E, 'modulus'), q('A', 'cross-sectional area', r.A, 'area'), q('L', 'length', r.L, 'length'), q('δ', 'change of length', r.elong, 'disp')],
      subst: ['N = (', 'E', ' × ', 'A', ' / ', 'L', ') × ', 'δ'],
      result: q('N', 'axial force (+ tension, − compression)', r.force, 'force'),
      extra: [q('k', 'axial stiffness E·A/L', r.k, 'stiffness')] });
    steps.push({ id: 'stress', title: 'Axial stress σ',
      equation: 'σ = N/A',
      terms: [q('N', 'axial force', r.force, 'force'), q('A', 'area', r.A, 'area')],
      subst: ['σ = ', 'N', ' / ', 'A'],
      result: q('σ', 'axial stress (+ tension)', r.stress, 'stress'),
      note: 'The solver computes σ = E·ε, which is the same number: N/A = (E·A·δ/L)/A = E·δ/L = E·ε.' });
    steps.push({ id: 'strain', title: 'Axial strain ε',
      equation: 'ε = δ/L',
      terms: [q('δ', 'change of length', r.elong, 'disp'), q('L', 'length', r.L, 'length')],
      subst: ['ε = ', 'δ', ' / ', 'L'],
      result: q('ε', 'strain, dimensionless', r.strain, 'strain') });
    const checks = [];
    checks.push({ id: 'yield', title: 'Yield check',
      equation: 'SF_yield = σ_y / |σ|',
      terms: [q('σ_y', 'yield (limit) stress of the material', r.fy, 'stress'), q('σ', 'axial stress', r.stress, 'stress')],
      subst: r.state === 'zero' ? ['no force, so no yield risk: SF_yield = ∞'] : ['SF_yield = ', 'σ_y', ' / |', 'σ', '|'],
      result: q('SF_yield', 'safety factor against yielding', r.sfYield, 'ratio') });
    checks.push({ id: 'euler', title: 'Euler buckling load (pin-ended, K = 1)',
      equation: 'P_cr = π²·E·I / (K·L)²,  K = 1',
      terms: [q('E', "Young's modulus", r.E, 'modulus'), q('I', 'second moment of area, weak axis', r.I, 'inertia'), q('L', 'length', r.L, 'length')],
      subst: ['P_cr = π² × ', 'E', ' × ', 'I', ' / (1 × ', 'L', ')²'],
      result: q('P_cr', 'Euler critical load', r.Pcr, 'force'),
      extra: [q('σ_cr', 'critical stress P_cr/A', r.sigmaCr, 'stress'), q('L/r', 'slenderness, r = √(I/A)', r.slenderness, 'ratio')],
      note: r.eulerValid ? 'Ideal straight member with pinned ends. Real columns buckle earlier (imperfections, inelastic buckling), which design codes cover and TrussLab does not.'
        : 'σ_cr exceeds σ_y: this member is too stocky for elastic (Euler) buckling, so yielding governs. Inelastic buckling is not modelled.' });
    if (r.state === 'compression') {
      checks.push({ id: 'buckling', title: 'Buckling check',
        equation: 'SF_buckling = P_cr / |N|',
        terms: [q('P_cr', 'Euler critical load', r.Pcr, 'force'), q('N', 'axial force', r.force, 'force')],
        subst: ['SF_buckling = ', 'P_cr', ' / |', 'N', '|'],
        result: q('SF_buckling', 'safety factor against buckling', r.sfBuckling, 'ratio') });
    }
    checks.push({ id: 'governing', title: 'Governing safety factor',
      equation: 'SF = min(SF_yield, SF_buckling),  utilisation = 1/SF',
      terms: [q('SF_yield', 'yield', r.sfYield, 'ratio'), q('SF_buckling', r.state === 'compression' ? 'buckling' : 'buckling (tension and zero-force members cannot buckle: ∞)', r.sfBuckling, 'ratio')],
      subst: ['SF = min(', 'SF_yield', ', ', 'SF_buckling', ')'],
      result: q('SF', `governing safety factor (${r.governs})`, r.sf, 'ratio'),
      extra: [q('utilisation', '1/SF', r.utilization, 'ratio')] });
    return { member: k, i: r.i, j: r.j, state: r.state, status: r.status, governs: r.governs, lowSF: r.lowSF, steps, checks };
  }

  /**
   * The forces acting on node i as an isolated joint (milestones 7 and 8), from the solver's result:
   * the applied load F (as analysed, λ included), the force of every connected member on the node, and
   * the support reaction. A member in tension pulls the node toward its other end: force N·(e_x, e_y),
   * with (e_x, e_y) the unit vector from this node to the other end; compression (N < 0) pushes it away.
   * Equilibrium: F + R + Σ member forces = 0; `residual` is what the solver's numbers leave over.
   */
  function jointForces(model, result, i) {
    if (!result || !result.ok || !result.nodes[i]) return null;
    const nr = result.nodes[i], n = model.nodes[i];
    const members = [];
    result.members.forEach((mr, k) => {
      if (mr.i !== i && mr.j !== i) return;
      const other = mr.i === i ? mr.j : mr.i;
      const ex = mr.i === i ? mr.c : -mr.c, ey = mr.i === i ? mr.s : -mr.s; // unit vector from this node to the other end
      members.push({ member: k, other, ex, ey, N: mr.force, state: mr.state, fx: mr.force * ex, fy: mr.force * ey,
        angle: Math.atan2(ey, ex) * 180 / Math.PI });
    });
    const F = { fx: result.F ? result.F[2 * i] : 0, fy: result.F ? result.F[2 * i + 1] : 0 };
    const supported = nr.restrained[0] || nr.restrained[1];
    const R = { rx: nr.rx, ry: nr.ry, supported, rotated: nr.rotated, local: nr.rLocal.slice(), restrained: nr.restrained.slice(), frame: nr.frame.slice() };
    let sx = F.fx + (supported ? R.rx : 0), sy = F.fy + (supported ? R.ry : 0);
    for (const m of members) { sx += m.fx; sy += m.fy; }
    const scale = Math.max(Math.hypot(F.fx, F.fy), Math.hypot(R.rx, R.ry), ...members.map((m) => Math.abs(m.N)), 0);
    return { node: i, x: n.x, y: n.y, F, R, members, residual: { fx: sx, fy: sy }, scale, Fref: result.summary ? result.summary.Fref : scale };
  }

  /** Worked calculation for node i: displacements and, at a support, the reaction from joint equilibrium. */
  function nodeCalc(model, result, i) {
    const j = jointForces(model, result, i);
    if (!j) return null;
    const nr = result.nodes[i], steps = [];
    steps.push({ id: 'displacement', title: 'Total displacement',
      equation: '|u| = √(u_x² + u_y²)',
      terms: [q('u_x', 'displacement along global x', nr.ux, 'disp'), q('u_y', 'displacement along global y', nr.uy, 'disp')],
      subst: ['|u| = √((', 'u_x', ')² + (', 'u_y', ')²)'],
      result: q('|u|', 'total displacement', nr.u, 'disp'),
      note: 'Displacements come from solving K_ff·u_f = F_f − K_fs·u_s; at a support they are the prescribed values (0, or a settlement).' });
    if (j.R.supported) {
      const sumMx = j.members.reduce((t, m) => t + m.fx, 0), sumMy = j.members.reduce((t, m) => t + m.fy, 0);
      steps.push({ id: 'reaction', title: 'Support reaction from joint equilibrium',
        equation: 'R = −(F + Σ member forces on the node)',
        terms: [q('F_x', 'applied load, x (λ included)', j.F.fx, 'force'), q('F_y', 'applied load, y (λ included)', j.F.fy, 'force'),
          q('ΣN·e_x', 'members on the node, x', sumMx, 'force'), q('ΣN·e_y', 'members on the node, y', sumMy, 'force')],
        subst: ['R_x = −(', 'F_x', ' + ', 'ΣN·e_x', '),  R_y = −(', 'F_y', ' + ', 'ΣN·e_y', ')'],
        result: q('R', 'reaction, global components (solver: R = K·u − F)', Math.hypot(j.R.rx, j.R.ry), 'force'),
        extra: [q('R_x', 'reaction along x', j.R.rx, 'force'), q('R_y', 'reaction along y', j.R.ry, 'force')],
        note: 'The solver computes the reaction as R = K·u − F at the restrained degrees of freedom. The same value follows from the equilibrium of the isolated joint, which is how you check it by hand.' });
    }
    return { node: i, joint: j, steps };
  }

  /* =====================================================================
   * 3. Prediction: tension, compression or zero force (milestone 7)
   *    The answer is the solver's own classification (result.members[k].state, with its zero-force
   *    tolerance). The explanation uses the solver's δ and N, and, for zero-force members, the joint
   *    equilibrium rules where they apply exactly.
   * ===================================================================== */
  const STATES = ['tension', 'compression', 'zero'];
  /**
   * A zero-force rule that explains member k, or null. At an unloaded joint with no support:
   * 'two-members': only two members meet and they are not collinear, so both carry nothing;
   * 'collinear-pair': three members meet, two of them collinear, so the third carries nothing.
   */
  function zeroForceRule(model, result, k) {
    const mr = result.members[k];
    for (const node of [mr.i, mr.j]) {
      const nr = result.nodes[node];
      if (nr.restrained[0] || nr.restrained[1]) continue;
      const Fx = result.F ? result.F[2 * node] : 0, Fy = result.F ? result.F[2 * node + 1] : 0;
      if (Fx !== 0 || Fy !== 0) continue;
      const at = [];
      result.members.forEach((m, kk) => {
        if (m.i === node || m.j === node) at.push({ k: kk, ex: m.i === node ? m.c : -m.c, ey: m.i === node ? m.s : -m.s });
      });
      const cross = (p, r) => p.ex * r.ey - p.ey * r.ex;
      if (at.length === 2) {
        if (Math.abs(cross(at[0], at[1])) > 1e-9) return { type: 'two-members', node, others: at.filter((x) => x.k !== k).map((x) => x.k) };
      } else if (at.length === 3) {
        const others = at.filter((x) => x.k !== k);
        const me = at.find((x) => x.k === k);
        // the other two collinear (opposite directions) and this one not along their line
        if (Math.abs(cross(others[0], others[1])) <= 1e-9 && others[0].ex * others[1].ex + others[0].ey * others[1].ey < 0 && Math.abs(cross(me, others[0])) > 1e-9) {
          return { type: 'collinear-pair', node, others: others.map((x) => x.k) };
        }
      }
    }
    return null;
  }
  /** Why member k is in the state the solver found: its δ and N, and a zero-force rule when one applies. */
  function predictionReason(model, result, k) {
    const mr = result.members[k];
    return { member: k, state: mr.state, elong: mr.elong, force: mr.force, rule: mr.state === 'zero' ? zeroForceRule(model, result, k) : null };
  }
  /**
   * Compares predictions with the solver. `predictions` is an array (one entry per member) of 'tension',
   * 'compression', 'zero' or null. Returns { items, answered, correct, total, complete }.
   */
  function checkPredictions(model, result, predictions) {
    if (!result || !result.ok) return null;
    const items = result.members.map((mr, k) => {
      const p = predictions[k] || null;
      return { member: k, predicted: p, actual: mr.state, correct: p !== null && p === mr.state, reason: predictionReason(model, result, k) };
    });
    const answered = items.filter((x) => x.predicted !== null).length;
    return { items, answered, correct: items.filter((x) => x.correct).length, total: items.length, complete: answered === items.length };
  }
  /** Exercises for the prediction activity: examples with non-obvious members (zero-force members included). */
  const PREDICTION_EXERCISES = [
    { example: 'aframe', title: 'Two-bar A-frame', note: 'A warm-up: one load, two members.' },
    { example: 'pratt', title: 'Pratt bridge truss', note: 'Diagonals lean towards mid-span. One member carries no force at all: which?' },
    { example: 'cantilever', title: 'Wall-mounted cantilever', note: 'Which chord is stretched, which is squeezed? One member is a zero-force member.' },
    { example: 'warren', title: 'Warren truss', note: 'The diagonals alternate. Two members carry nothing under these loads.' },
  ];

  /* =====================================================================
   * 4. Free-body diagram of a joint (milestone 8)
   *    The isolated joint with every force on it, resolved into x and y components, and the two
   *    equilibrium equations ΣFx = 0 and ΣFy = 0 with the solver's numbers. The residual is what the
   *    solver's rounding leaves; it is compared with the zero-force tolerance of the solver.
   * ===================================================================== */
  function fbd(model, result, i) {
    const j = jointForces(model, result, i);
    if (!j) return null;
    const forces = j.members.map((m) => ({ kind: 'member', member: m.member, other: m.other, N: m.N, state: m.state, ex: m.ex, ey: m.ey, fx: m.fx, fy: m.fy, angle: m.angle }));
    if (j.F.fx !== 0 || j.F.fy !== 0) forces.push({ kind: 'load', fx: j.F.fx, fy: j.F.fy, angle: Math.atan2(j.F.fy, j.F.fx) * 180 / Math.PI });
    if (j.R.supported) forces.push({ kind: 'reaction', fx: j.R.rx, fy: j.R.ry, angle: Math.atan2(j.R.ry, j.R.rx) * 180 / Math.PI, restrained: j.R.restrained, rotated: j.R.rotated, frame: j.R.frame, local: j.R.local });
    const sumFx = forces.reduce((t, f) => t + f.fx, 0), sumFy = forces.reduce((t, f) => t + f.fy, 0);
    const scale = Math.max(...forces.map((f) => Math.hypot(f.fx, f.fy)), 0);
    const tol = FEA.DEFAULTS.zeroForceTol * (j.Fref || scale || 1);
    return { node: i, x: j.x, y: j.y, forces, sumFx, sumFy, scale, tol, balanced: Math.abs(sumFx) <= tol && Math.abs(sumFy) <= tol };
  }

  /* =====================================================================
   * 5. The method of joints, as a manual exercise (milestone 8)
   *    The learner solves one joint at a time: the applied loads and the reactions are known (the
   *    reactions follow from the equilibrium of the whole truss), members already solved are known, and at
   *    most two member forces may be unknown. Each unknown is assumed in tension (N > 0); a negative answer
   *    means compression. Answers are checked against the solver's N. The 2 × 2 solution of the joint is
   *    returned too, so the method can be shown to give the solver's numbers; it is not used to analyse
   *    the truss.
   * ===================================================================== */
  /** The exercise at joint i, given the set of members already known: knowns, unknowns and the equations. */
  function jointExercise(model, result, i, known) {
    const j = jointForces(model, result, i);
    if (!j) return null;
    const isKnown = (k) => known.has(k);
    const unknowns = j.members.filter((m) => !isKnown(m.member));
    const knowns = j.members.filter((m) => isKnown(m.member));
    // the right-hand side: −(F + R + Σ known N·e)
    let bx = -(j.F.fx + (j.R.supported ? j.R.rx : 0)), by = -(j.F.fy + (j.R.supported ? j.R.ry : 0));
    for (const m of knowns) { bx -= m.N * m.ex; by -= m.N * m.ey; }
    const ex = { node: i, joint: j, knowns, unknowns, rhs: { x: bx, y: by }, solvable: false, reason: '', solution: null };
    if (!unknowns.length) { ex.reason = 'done'; return ex; }
    if (unknowns.length > 2) { ex.reason = 'too-many'; return ex; }
    if (unknowns.length === 1) {
      const u = unknowns[0];
      // one unknown: use the equation along the member (both equations hold; this one is best conditioned)
      ex.solution = [{ member: u.member, N: bx * u.ex + by * u.ey }];
      ex.solvable = true;
      return ex;
    }
    const [a, b] = unknowns, det = a.ex * b.ey - a.ey * b.ex;
    if (Math.abs(det) < 1e-9) { ex.reason = 'collinear'; return ex; }
    // Cramer's rule for N_a·e_a + N_b·e_b = rhs
    ex.solution = [{ member: a.member, N: (bx * b.ey - by * b.ex) / det }, { member: b.member, N: (a.ex * by - a.ey * bx) / det }];
    ex.solvable = true;
    return ex;
  }
  /** A joint the learner can solve next (at most two unknowns, not collinear), preferring supports first; or -1. */
  function nextJoint(model, result, known) {
    let best = -1, bestScore = Infinity;
    model.nodes.forEach((n, i) => {
      if (!result.nodes[i] || !result.nodes[i].active) return;
      const ex = jointExercise(model, result, i, known);
      if (!ex || !ex.solvable) return;
      const score = ex.unknowns.length * 10 + (ex.joint.R.supported ? 0 : 1) + i * 1e-3;
      if (score < bestScore) { bestScore = score; best = i; }
    });
    return best;
  }
  /**
   * Checks the learner's answers (in N, tension positive) at a joint against the solver's member forces.
   * A value is right within 1 % of |N| or 0.1 % of the largest force in the truss (rounded hand
   * calculations); the sign is judged separately, so "right size, wrong direction" can be explained.
   */
  function checkJointAnswers(result, exercise, answers) {
    const Fref = result.summary.Fref;
    return exercise.unknowns.map((u) => {
      const N = result.members[u.member].force, a = answers[u.member];
      if (typeof a !== 'number' || !Number.isFinite(a)) return { member: u.member, N, answer: null, correct: false, signOk: false, sizeOk: false };
      const tol = Math.max(0.01 * Math.abs(N), 1e-3 * Fref);
      const sizeOk = Math.abs(Math.abs(a) - Math.abs(N)) <= tol;
      const zero = Math.abs(N) <= tol;
      const signOk = zero ? Math.abs(a) <= tol : Math.sign(a) === Math.sign(N);
      return { member: u.member, N, answer: a, correct: sizeOk && signOk, signOk, sizeOk };
    });
  }

  /* =====================================================================
   * 6. Solver Explorer (milestone 9)
   *    How the model becomes K_ff·u_f = b_f, stage by stage, with the solver's own arrays (no second
   *    solver: everything is read from the result of FEA.analyze). The only arithmetic here verifies what
   *    the solver did (the residual K_ff·u_f − b_f, the transformation Tᵀ·k·T, the sum of element
   *    contributions), so a learner can see that the pieces fit.
   * ===================================================================== */
  const EXPLORER_STAGES = [
    { id: 'model', title: 'The structural model', what: 'Nodes, members, supports and loads: the data the solver starts from.' },
    { id: 'numbering', title: 'Node and member numbering', what: 'Each node and member gets a number; each member runs from a start node i to an end node j.' },
    { id: 'dofs', title: 'Degrees of freedom', what: 'Each node can move in x and in y: two degrees of freedom (DOFs) per node, numbered 2i − 1 and 2i.' },
    { id: 'element', title: 'Member stiffness', what: 'Along its axis a member behaves like a spring of stiffness k = E·A/L.' },
    { id: 'transformation', title: 'Coordinate transformation', what: 'The member\'s axial spring, written in global x and y: kᵉ = Tᵀ·k·T.' },
    { id: 'assembly', title: 'Global stiffness assembly', what: 'Each member adds its 4 × 4 kᵉ into the rows and columns of its two nodes\' DOFs.' },
    { id: 'boundary', title: 'Boundary conditions', what: 'Supports fix some DOFs (u = 0, or a prescribed settlement); the others are free.' },
    { id: 'partition', title: 'Matrix partitioning', what: 'Order the DOFs as free (f) and restrained (s): K splits into four blocks.' },
    { id: 'reduced', title: 'The reduced stiffness matrix K_ff', what: 'Only the free DOFs are unknown: K_ff links them to the forces at those DOFs.' },
    { id: 'loads', title: 'The load vector', what: 'Loads at the free DOFs, minus the effect of any prescribed settlement: b_f = F_f − K_fs·u_s.' },
    { id: 'displacements', title: 'Displacements', what: 'Solve K_ff·u_f = b_f for the free displacements.' },
    { id: 'forces', title: 'Member forces', what: 'From the displacements of its two ends, each member\'s change of length δ and axial force N = (E·A/L)·δ.' },
    { id: 'reactions', title: 'Support reactions', what: 'R = K·u − F at the restrained DOFs: what the supports must supply.' },
    { id: 'equilibrium', title: 'Equilibrium check', what: 'The loads and reactions together balance: ΣF_x = 0, ΣF_y = 0, ΣM = 0.' },
  ];
  /** Size guidance: matrices are shown as tables up to this many DOFs. */
  const EXPLORER_MAX_DOFS = 24;

  /** The local-to-global transformation of member k: T (2 × 4), k_local (2 × 2), and Tᵀ·k_local·T (4 × 4). */
  function memberTransformation(result, k) {
    const mr = result.members[k];
    const T = [[mr.c, mr.s, 0, 0], [0, 0, mr.c, mr.s]];
    const kl = [[mr.k, -mr.k], [-mr.k, mr.k]];
    const ke = [];
    for (let a = 0; a < 4; a++) {
      ke.push([]);
      for (let b = 0; b < 4; b++) {
        let v = 0;
        for (let p = 0; p < 2; p++) for (let q2 = 0; q2 < 2; q2++) v += T[p][a] * kl[p][q2] * T[q2][b];
        ke[a].push(v);
      }
    }
    return { T, kl, ke, solverKe: Array.from({ length: 4 }, (_, a) => Array.from(mr.ke.subarray(4 * a, 4 * a + 4))), dofs: mr.dofs.slice() };
  }
  /** Where member k adds to the global K: [{ row, col, value }] (its 16 entries of kᵉ at its DOFs). */
  function assemblyContribution(result, k) {
    const mr = result.members[k], out = [];
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) out.push({ row: mr.dofs[a], col: mr.dofs[b], value: mr.ke[4 * a + b] });
    return out;
  }
  /** Every member's contribution to the entry K[row, col]: the sum that assembly computes. */
  function entryContributions(result, row, col) {
    const out = [];
    result.members.forEach((mr, k) => {
      const a = mr.dofs.indexOf(row), b = mr.dofs.indexOf(col);
      if (a >= 0 && b >= 0) out.push({ member: k, value: mr.ke[4 * a + b] });
    });
    return out;
  }
  /**
   * The stages with what each needs, all from `result` (FEA.analyze of the model). Matrices are referenced,
   * not copied. Stages after the reduced matrix are unavailable for an unstable model (no solution exists).
   */
  function explorer(model, result) {
    if (!result || !result.K) return null;
    const ndof = result.ndof, free = Array.from(result.free || []), fixed = Array.from(result.fixed || []);
    const solved = !!result.ok;
    let residual = null;
    if (solved && result.nf > 0) { // verification only: how well the solver's u_f satisfies K_ff·u_f = b_f
      const nf = result.nf;
      let rmax = 0, bmax = 0;
      for (let a = 0; a < nf; a++) {
        let s = 0;
        for (let b = 0; b < nf; b++) s += result.Kff[a * nf + b] * result.ut[free[b]];
        rmax = Math.max(rmax, Math.abs(s - result.bf[a]));
        bmax = Math.max(bmax, Math.abs(result.bf[a]));
      }
      residual = { max: rmax, rel: bmax > 0 ? rmax / bmax : 0 };
    }
    const stages = EXPLORER_STAGES.map((s, idx) => Object.assign({ index: idx }, s, {
      available: idx <= 9 || solved,
    }));
    return {
      stages, ndof, nf: result.nf, ns: fixed.length, free, fixed, labels: result.dofLabels.slice(), rotated: (result.rotated || []).slice(),
      tooLarge: ndof > EXPLORER_MAX_DOFS, solved, mechanism: result.mechanism || null, residual, diagnostics: result.diagnostics,
      determinacy: result.determinacy,
    };
  }

  return Object.freeze({
    BUILD_STEPS, buildProgress, nextStepHint,
    EXPLORER_STAGES, EXPLORER_MAX_DOFS, explorer, memberTransformation, assemblyContribution, entryContributions,
    fbd, jointExercise, nextJoint, checkJointAnswers,
    PI2, memberCalc, jointForces, nodeCalc,
    STATES, zeroForceRule, predictionReason, checkPredictions, PREDICTION_EXERCISES,
  });
});
