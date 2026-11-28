/*!
 * design.js - DOM-free design logic of TrussLab (global TrussDesign), milestone 10.
 *
 * - A catalogue of discrete sections whose A and I are computed from their nominal dimensions
 *   (TrussModel.sectionProps: idealised shapes with sharp corners, weak-axis I). I is never inferred from A.
 * - Design checks over every required action state (each load combination, or each load case when there
 *   are no combinations), each solved directly with FEA.analyze; the worst value is taken per member,
 *   never a sum of safety factors or utilisations.
 * - Fully stressed design: deterministic iteration with re-analysis (forces in an indeterminate truss and
 *   self-weight both depend on the sections), an iteration cap, cycle detection and explicit statuses.
 * - The reference-chord deflection: the relative transverse displacement of chosen nodes against the line
 *   joining two reference nodes, so rigid-body movement (support settlement included) is not counted.
 *
 * Nothing here touches the DOM, and nothing here changes the model it is given: sizing works on a copy.
 * It runs in browsers (global TrussDesign), in Node.js (require('./design.js')) and in JavaScriptCore
 * (load('design.js')), after fea-core.js and model.js.
 */
(function (root, factory) {
  'use strict';
  const FEA = root.FEA || (typeof require === 'function' ? require('./fea-core.js') : undefined);
  const TM = root.TrussModel || (typeof require === 'function' ? require('./model.js') : undefined);
  if (!FEA || !TM) throw new Error('design.js needs fea-core.js and model.js: load them first.');
  const api = factory(FEA, TM);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrussDesign = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FEA, TM) {
  'use strict';
  const MM = 1e-3;
  const PI2 = Math.PI * Math.PI;

  /* =====================================================================
   * 1. Section catalogue
   *    Nominal dimensions (mm) of common sizes. Properties are computed from the idealised shapes, so they
   *    differ slightly from a manufacturer's table (rounded corners, tolerances): an educational
   *    catalogue, not a product list.
   * ===================================================================== */
  const FAMILY_DEFS = {
    chs: { label: 'Circular hollow sections (CHS)', shape: 'chs',
      sizes: [[33.7, 3.2], [42.4, 3.2], [48.3, 3.2], [60.3, 3.2], [60.3, 4.0], [76.1, 3.2], [76.1, 4.0], [88.9, 3.2], [88.9, 5.0], [101.6, 5.0], [114.3, 5.0], [139.7, 5.0], [139.7, 6.3], [168.3, 6.3], [168.3, 8.0], [193.7, 8.0], [219.1, 8.0], [219.1, 10.0], [244.5, 10.0], [273.0, 10.0], [323.9, 10.0]],
      make: ([D, t]) => ({ shape: { type: 'chs', D: D * MM, t: t * MM }, label: `CHS ${D}×${t}` }) },
    shs: { label: 'Square hollow sections (SHS)', shape: 'rhs',
      sizes: [[40, 3], [50, 3], [60, 4], [70, 4], [80, 5], [90, 5], [100, 5], [100, 6], [120, 6], [140, 6], [150, 8], [160, 8], [180, 10], [200, 10], [250, 10]],
      make: ([b, t]) => ({ shape: { type: 'rhs', b: b * MM, h: b * MM, t: t * MM }, label: `SHS ${b}×${b}×${t}` }) },
    rod: { label: 'Solid round bars', shape: 'rod',
      sizes: [10, 12, 16, 20, 25, 30, 36, 40, 50, 60, 70, 80, 100],
      make: (d) => ({ shape: { type: 'rod', d: d * MM }, label: `Rod ⌀${d}` }) },
    timber: { label: 'Sawn timber, solid rectangles', shape: 'rect',
      sizes: [[38, 89], [38, 140], [45, 95], [45, 145], [45, 195], [63, 150], [75, 200], [100, 100], [100, 200], [150, 150], [150, 300], [200, 200]],
      make: ([b, h]) => ({ shape: { type: 'rect', b: b * MM, h: h * MM }, label: `Timber ${b}×${h}` }) },
  };
  /** The candidates of a family, with A and I from the shape, sorted by area (the linear mass ρA within one material). */
  function family(id) {
    const def = FAMILY_DEFS[id];
    if (!def) return null;
    const list = def.sizes.map((s, k) => {
      const c = def.make(s), p = TM.sectionProps(c.shape);
      return { id: `${id}-${k}`, family: id, label: c.label, shape: c.shape, A: p ? p.A : null, I: p ? p.I : null };
    }).filter((c) => c.A > 0);
    list.sort((a, b) => a.A - b.A || (b.I || 0) - (a.I || 0));
    return { id, label: def.label, candidates: list };
  }
  const FAMILIES = Object.keys(FAMILY_DEFS);
  /** A sensible family for a section group: the family of its current shape, steel hollow sections otherwise. */
  function defaultFamily(group) {
    const t = group.shape && group.shape.type;
    if (t === 'chs') return 'chs';
    if (t === 'rhs') return 'shs';
    if (t === 'rod') return 'rod';
    if (t === 'rect' || (group.material && group.material.preset === 'fir')) return 'timber';
    return 'chs';
  }

  /* =====================================================================
   * 2. Action states and design checks
   * ===================================================================== */
  /**
   * The states a design must satisfy: every combination when the model has any ('combinations'), every
   * load case otherwise ('cases'), or only what is analysed now ('active'). Each is { kind, index, name }.
   */
  function designStates(model, which) {
    const mode = which || (model.combinations.length ? 'combinations' : 'cases');
    if (mode === 'combinations') return model.combinations.map((c, index) => ({ kind: 'combination', index, name: c.name }));
    if (mode === 'cases') return model.loadCases.map((c, index) => ({ kind: 'case', index, name: c.name }));
    const ac = model.activeCombination;
    return ac ? [{ kind: 'combination', index: model.combinations.indexOf(ac), name: ac.name }] : [{ kind: 'case', index: model.loadCases.indexOf(model.activeCase), name: model.activeCase.name }];
  }
  /** Solves one state directly (FEA.analyze) on the model as it is now. */
  function solveState(model, st, opts) {
    const o = { loadFactor: opts && opts.loadFactor !== undefined ? opts.loadFactor : 1, targetSF: opts && opts.targetSF };
    if (st.kind === 'combination') o.combination = model.combinations[st.index];
    else o.loadCase = model.loadCases[st.index];
    return FEA.analyze(TM.toAnalysisInput(model, o));
  }
  /**
   * Checks every member in every state. Returns { runs: [{ state, result }], members: [{ member, minSF, mode,
   * state, worstN }], governing, unsolved, complete, pass }. Every value is one state's own result.
   */
  function checkDesign(model, opts) {
    const o = opts || {}, target = o.targetSF || 1.5;
    const states = o.states || designStates(model, o.which);
    const runs = states.map((st) => ({ state: st, result: solveState(model, st, o) }));
    const solved = runs.filter((x) => x.result.ok);
    const members = model.members.map((e, k) => {
      let minSF = Infinity, mode = 'none', state = null, worstN = 0;
      for (const { state: st, result } of solved) {
        const m = result.members[k];
        if (m.sf < minSF) { minSF = m.sf; mode = m.governs; state = st; }
        if (Math.abs(m.force) > Math.abs(worstN)) worstN = m.force;
      }
      return { member: k, minSF, mode, state, worstN, pass: minSF >= target };
    });
    let governing = null;
    for (const m of members) if (!governing || m.minSF < governing.minSF) governing = m;
    const unsolved = runs.filter((x) => !x.result.ok).map((x) => x.state);
    return { runs, members, governing, unsolved, complete: unsolved.length === 0 && runs.length > 0, pass: unsolved.length === 0 && runs.length > 0 && members.every((m) => m.pass), targetSF: target };
  }

  /* =====================================================================
   * 3. Reference-chord deflection (serviceability)
   *    For reference nodes A, B and an evaluation node P, with t the projection of P onto AB (original
   *    geometry): u_ref = (1 − t)·u_A + t·u_B, u_rel = u_P − u_ref, δ = |u_rel · n|, n the unit normal of AB.
   *    A rigid-body movement (translation or small rotation) moves P exactly like u_ref in the direction
   *    n, so δ measures deformation only: a settlement that moves the truss rigidly gives δ = 0.
   * ===================================================================== */
  /**
   * The criterion stored in the model (model.design.deflection), or null when none is set:
   * { a, b, nodes: [nodes], limit: { type: 'ratio' | 'absolute', value } }, value = L/δ ratio, or metres.
   */
  const criterion = (model) => (model.design && model.design.deflection) || null;
  function chordDeflection(model, result, crit) {
    const A = crit.a, B = crit.b;
    const ia = model.nodes.indexOf(A), ib = model.nodes.indexOf(B);
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    if (ia < 0 || ib < 0 || !(L > 0)) return { error: 'chord' };
    const nx = -dy / L, ny = dx / L;
    const allow = crit.limit.type === 'ratio' ? L / crit.limit.value : crit.limit.value;
    const uA = result.nodes[ia], uB = result.nodes[ib];
    const nodes = crit.nodes.map((P) => {
      const ip = model.nodes.indexOf(P);
      if (ip < 0) return null;
      const t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / (L * L);
      const uP = result.nodes[ip];
      const rx = uP.ux - ((1 - t) * uA.ux + t * uB.ux), ry = uP.uy - ((1 - t) * uA.uy + t * uB.uy);
      const delta = Math.abs(rx * nx + ry * ny);
      return { node: ip, t, delta, total: uP.u, allow, pass: delta <= allow, signed: rx * nx + ry * ny };
    }).filter(Boolean);
    return { span: L, normal: [nx, ny], allow, nodes };
  }
  /** The deflection check over every state: the governing node and state, or { status: 'unconfigured' }. */
  function checkDeflection(model, opts, runs) {
    const crit = criterion(model);
    if (!crit || !crit.nodes.length) return { status: 'unconfigured' };
    const states = runs || designStates(model, opts && opts.which).map((st) => ({ state: st, result: solveState(model, st, opts) }));
    let governing = null;
    const per = [];
    for (const { state: st, result } of states) {
      if (!result.ok) { per.push({ state: st, unsolved: true }); continue; }
      const d = chordDeflection(model, result, crit);
      if (d.error) return { status: 'invalid', reason: 'The two reference nodes coincide: the chord has no length.' };
      per.push({ state: st, d });
      for (const x of d.nodes) if (!governing || x.delta > governing.delta) governing = Object.assign({ state: st }, x);
    }
    const allow = per.find((x) => x.d) ? per.find((x) => x.d).d.allow : null;
    const unsolved = per.filter((x) => x.unsolved).map((x) => x.state);
    return { status: unsolved.length ? 'incomplete' : governing && governing.delta > allow ? 'fail' : 'pass', per, governing, allow, unsolved, span: per.find((x) => x.d) ? per.find((x) => x.d).d.span : null };
  }

  /* =====================================================================
   * 4. Fully stressed design
   * ===================================================================== */
  /**
   * Runs a deterministic iteration: next(selection, iteration) returns the next selection (an array of
   * candidate indices, one per sized group). Stops when the selection repeats the previous one
   * ('converged'), when it repeats an earlier one ('cycle', with the repeating configurations), or after
   * maxIterations ('max-iterations'). Exported so the stopping rules can be tested on their own.
   */
  function iterateSelections(start, next, maxIterations) {
    const seen = new Map([[start.join(','), 0]]);
    const history = [start.slice()];
    let cur = start.slice();
    for (let it = 1; it <= maxIterations; it++) {
      const nxt = next(cur, it);
      if (nxt === null) return { status: 'stopped', history, iterations: it };
      const sig = nxt.join(',');
      if (sig === cur.join(',')) return { status: 'converged', history, iterations: it, selection: cur };
      if (seen.has(sig)) return { status: 'cycle', history: history.concat([nxt.slice()]), iterations: it, cycleFrom: seen.get(sig), selection: null };
      seen.set(sig, history.length);
      history.push(nxt.slice());
      cur = nxt;
    }
    return { status: 'max-iterations', history, iterations: maxIterations, selection: null };
  }
  const copyModel = (model) => TM.readModel(JSON.parse(JSON.stringify(TM.serialize(model)))).model;
  /** Puts candidate c into group g (shape, A, I), as the page does when a proposal is applied. */
  function applyCandidate(group, c) { group.shape = JSON.parse(JSON.stringify(c.shape)); group.A = c.A; group.I = c.I; }
  /** Linear mass ρA of a candidate in a material (kg/m), or null when the material has no density. */
  const linearMass = (material, c) => (TM.validDensity(material.density) ? material.density * c.A : null);
  /** Structural mass Σ ρ·A·L (kg), and whether it is complete (every material has a density). */
  function structureMass(model) {
    let mass = 0, complete = true;
    for (const e of model.members) {
      const w = TM.memberSelfWeight(e);
      if (w.density === null) { complete = false; continue; }
      mass += w.density * w.A * w.L;
    }
    return { mass, complete };
  }
  /**
   * What candidate c must satisfy for member force N (one state) and length L, at target SF:
   * yield needs A ≥ SF·|N|/σ_y; Euler buckling of a pin-ended member (K = 1) needs I ≥ SF·|N|·L²/(π²E).
   * Returns null when c passes, or the first failed check with its required value.
   */
  function candidateFailure(c, N, L, material, target) {
    if (N === 0) return null;
    const Areq = target * Math.abs(N) / material.fy;
    if (!(c.A >= Areq)) return { check: 'yield', required: Areq, have: c.A };
    if (N < 0) {
      if (!(c.I > 0)) return { check: 'no-inertia', required: null, have: null };
      const Ireq = target * Math.abs(N) * L * L / (PI2 * material.E);
      if (!(c.I >= Ireq)) return { check: 'buckling', required: Ireq, have: c.I };
    }
    return null;
  }
  /**
   * Sizes the groups listed in opts.families ({ groupIndex: familyId }; other groups keep their section).
   * opts: { targetSF, which, loadFactor, maxIterations (20), catalogue (override for tests) }.
   * Never changes `model`. Returns a full report: status, iterations, proposal per group with the reasons,
   * masses, the final checks, and the deflection result.
   */
  function sizeSections(model, opts) {
    const o = Object.assign({ targetSF: 1.5, maxIterations: 20, loadFactor: 1 }, opts || {});
    const work = copyModel(model);
    const states = designStates(work, o.which);
    const report = { status: 'running', iterations: [], groups: [], states, targetSF: o.targetSF, notes: [] };
    if (!states.length) { report.status = 'no-states'; return report; }
    const sized = Object.keys(o.families || {}).map(Number).filter((g) => work.groups[g] && o.families[g] && o.families[g] !== 'keep');
    if (!sized.length) { report.status = 'nothing-to-size'; return report; }
    const cats = sized.map((g) => {
      const fam = (o.catalogue && o.catalogue[o.families[g]]) || family(o.families[g]);
      return fam ? fam.candidates : [];
    });
    if (cats.some((c) => !c.length)) { report.status = 'invalid'; report.notes.push('A chosen family has no candidates.'); return report; }
    // order by linear mass ρA in the group's material (by area when the material has no density)
    sized.forEach((g, gi) => { const mat = work.groups[g].material; cats[gi] = cats[gi].slice().sort((a, b) => (linearMass(mat, a) || a.A) - (linearMass(mat, b) || b.A)); });
    const membersOf = sized.map((g) => work.members.map((e, k) => (e.group === work.groups[g] ? k : -1)).filter((k) => k >= 0));
    const floor = sized.map(() => 0); // lower bounds raised by the serviceability step (never by strength)
    const applySel = (sel) => sized.forEach((g, gi) => applyCandidate(work.groups[g], cats[gi][sel[gi]]));
    const solveAll = () => states.map((st) => ({ state: st, result: solveState(work, st, o) }));
    let lastRuns = null, failure = null;
    /** One fully stressed step: re-analyse with `sel`, then pick the lightest passing candidate per group. */
    const step = (sel, it) => {
      applySel(sel);
      const runs = solveAll();
      lastRuns = runs;
      const bad = runs.find((x) => !x.result.ok);
      if (bad) { failure = { kind: bad.result.mechanism ? 'unstable' : 'invalid', state: bad.state, msg: bad.result.errors.length ? bad.result.errors[0].msg : '' }; return null; }
      const next = sized.map((g, gi) => {
        const mat = work.groups[g].material;
        let pick = -1;
        for (let ci = floor[gi]; ci < cats[gi].length && pick < 0; ci++) {
          const ok = membersOf[gi].every((k) => runs.every((x) => candidateFailure(cats[gi][ci], x.result.members[k].force, x.result.members[k].L, mat, o.targetSF) === null));
          if (ok) pick = ci;
        }
        return pick < 0 ? cats[gi].length - 1 : pick; // none passes: the largest, flagged below
      });
      const mass = structureMass(work);
      report.iterations.push({ iteration: it, selection: sel.map((ci, gi) => cats[gi][ci].label), next: next.map((ci, gi) => cats[gi][ci].label), mass: mass.mass, massComplete: mass.complete });
      return next;
    };
    let start = sized.map(() => 0); // deterministic start: the lightest candidate of every family
    let res = iterateSelections(start, step, o.maxIterations);
    let deflection = null, guard = 0;
    // serviceability: while the deflection limit fails, raise the floor of the group whose members contribute
    // most to the governing deflection per added mass (unit-load method), then size for strength again.
    // Each step raises one group by one size, so the number of steps is bounded by the sizes that exist.
    const maxSteps = cats.reduce((t, c) => t + c.length, 0);
    while (res.status === 'converged' && criterion(work) && guard++ < maxSteps) {
      applySel(res.selection);
      lastRuns = solveAll();
      deflection = checkDeflection(work, o, lastRuns);
      if (deflection.status !== 'fail') break;
      const g = deflection.governing, gi = stiffenChoice(work, sized, cats, res.selection, g, lastRuns, o);
      if (gi < 0) { report.status = 'deflection-not-met'; report.notes.push('The deflection limit cannot be met with these families: every sized group already has its largest section.'); break; }
      floor[gi] = res.selection[gi] + 1;
      report.notes.push(`Deflection at N${g.node + 1} (${g.state.name}) exceeded the limit: the smallest section of group ${work.groups[sized[gi]].name} was raised to ${cats[gi][floor[gi]].label}.`);
      res = iterateSelections(res.selection.map((ci, k) => Math.max(ci, floor[k])), step, o.maxIterations);
    }
    report.history = res.history.map((sel) => sel.map((ci, gi) => cats[gi][ci].label));
    if (failure) { report.status = failure.kind; report.failure = failure; return report; }
    if (report.status === 'running') report.status = res.status;
    report.cycleFrom = res.cycleFrom;
    const finalSel = res.status === 'converged' || report.status === 'no-candidate' ? res.selection || res.history[res.history.length - 1] : res.history[res.history.length - 1];
    // final verification: analyse the proposal itself in every state (this is what is reported)
    applySel(finalSel);
    const check = checkDesign(work, Object.assign({}, o, { states }));
    deflection = checkDeflection(work, o, check.runs);
    report.check = check;
    report.deflection = deflection;
    const noFit = [];
    report.groups = sized.map((g, gi) => {
      const grp = model.groups[g], mat = work.groups[g].material, cand = cats[gi][finalSel[gi]];
      // why this candidate: the governing member and state, and why the next lighter one fails
      let governs = null, lighter = null;
      for (const k of membersOf[gi]) for (const x of check.runs) {
        if (!x.result.ok) continue;
        const N = x.result.members[k].force, L = x.result.members[k].L;
        const util = Math.max(o.targetSF * Math.abs(N) / mat.fy / cand.A, N < 0 && cand.I > 0 ? o.targetSF * Math.abs(N) * L * L / (PI2 * mat.E) / cand.I : 0);
        if (!governs || util > governs.util) governs = { member: k, state: x.state, N, L, util, mode: N < 0 && o.targetSF * Math.abs(N) * L * L / (PI2 * mat.E) / cand.I > o.targetSF * Math.abs(N) / mat.fy / cand.A ? 'buckling' : 'yield' };
      }
      if (finalSel[gi] > 0) {
        const lc = cats[gi][finalSel[gi] - 1];
        for (const k of membersOf[gi]) for (const x of check.runs) {
          if (lighter || !x.result.ok) continue;
          const f = candidateFailure(lc, x.result.members[k].force, x.result.members[k].L, mat, o.targetSF);
          if (f) lighter = Object.assign({ candidate: lc.label, member: k, state: x.state }, f);
        }
        if (!lighter && floor[gi] >= finalSel[gi]) lighter = { candidate: lc.label, check: 'deflection' };
      }
      const fits = membersOf[gi].every((k) => check.runs.every((x) => !x.result.ok || candidateFailure(cand, x.result.members[k].force, x.result.members[k].L, mat, o.targetSF) === null));
      if (!fits) noFit.push(grp.name);
      return { group: g, name: grp.name, family: o.families[g], from: { A: grp.A, I: grp.I, shape: grp.shape }, to: cand, index: finalSel[gi], members: membersOf[gi], governs, lighter, fits };
    });
    if (noFit.length && report.status === 'converged') { report.status = 'no-candidate'; report.notes.push(`No candidate in the family is large enough for ${noFit.join(', ')}.`); }
    if (report.status === 'converged' && deflection.status === 'fail') {
      report.status = 'deflection-not-met';
      report.notes.push('The strength and buckling checks are met, but the deflection limit is not: no proposal is acceptable.');
    }
    report.mass = { before: structureMass(model), after: structureMass(work) };
    report.acceptable = report.status === 'converged' && check.pass && deflection.status !== 'fail' && deflection.status !== 'incomplete';
    return report;
  }
  /**
   * Unit-load method: the governing deflection δ = Σ N·n·L/(E·A) over the members, with N from the real
   * state and n from a virtual unit action along the chord normal (+1 at the node, −(1 − t) at A, −t at B).
   * Returns the index of the sized group with the largest contribution per added linear mass that can still
   * grow, or −1. A guide for which group to stiffen, not part of any check.
   */
  function stiffenChoice(work, sized, cats, sel, gov, runs, o) {
    const crit = criterion(work), A = crit.a, B = crit.b, ia = work.nodes.indexOf(A), ib = work.nodes.indexOf(B);
    const L = Math.hypot(B.x - A.x, B.y - A.y), nx = -(B.y - A.y) / L, ny = (B.x - A.x) / L;
    const real = runs.find((x) => x.state === gov.state).result;
    const inp = TM.toAnalysisInput(work, { loadFactor: 0 }); // geometry, sections and restraints, with no actions
    const add = (i, s) => { inp.nodes[i].fx += s * nx; inp.nodes[i].fy += s * ny; };
    add(gov.node, 1); add(ia, -(1 - gov.t)); add(ib, -gov.t);
    const virt = FEA.analyze(inp);
    if (!virt.ok) return -1;
    let best = -1, bestScore = -Infinity;
    sized.forEach((g, gi) => {
      if (sel[gi] >= cats[gi].length - 1) return;
      let contrib = 0;
      work.members.forEach((e, k) => { if (e.group === work.groups[g]) contrib += real.members[k].force * virt.members[k].force * real.members[k].L / (real.members[k].E * real.members[k].A); });
      const mat = work.groups[g].material, a = cats[gi][sel[gi]], b = cats[gi][sel[gi] + 1];
      const dm = (linearMass(mat, b) || b.A) - (linearMass(mat, a) || a.A);
      const score = Math.abs(contrib) / Math.max(dm, 1e-12);
      if (score > bestScore) { bestScore = score; best = gi; }
    });
    return best;
  }

  return Object.freeze({
    FAMILY_DEFS, FAMILIES, family, defaultFamily,
    designStates, solveState, checkDesign,
    criterion, chordDeflection, checkDeflection,
    iterateSelections, candidateFailure, structureMass, linearMass, applyCandidate, sizeSections,
  });
});
