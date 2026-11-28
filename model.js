/*!
 * model.js - DOM-free model layer of TrussLab (2D Truss FEA & Load Simulator).
 *
 * Units and the expression parser for numeric inputs, material presets, section shapes, the model
 * constructors, supports, load cases (nodal loads and prescribed settlements), file format version 2
 * (serialize / readModel, which also reads and migrates version 1), model checks, the example
 * structures, the step that turns a model into input for FEA.analyze(), and saved sessions in browser
 * storage. Everything here is free of the DOM and of UI state: it runs in browsers (global
 * `TrussModel`), in Node.js (`require('./model.js')`) and in JavaScriptCore (`load('model.js')`),
 * always after fea-core.js.
 *
 * Moved out of script.js in milestone 2 without changing behaviour; load cases, format version 2, the
 * λ scaling of settlements and session migration were added in milestone 3. Units: SI base units
 * (m, N, Pa, m^2, m^4), angles in degrees.
 */
(function (root, factory) {
  'use strict';
  const FEA = root.FEA || (typeof require === 'function' ? require('./fea-core.js') : undefined);
  if (!FEA) throw new Error('model.js needs fea-core.js: load fea-core.js first.');
  const api = factory(FEA);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrussModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FEA) {
  'use strict';

  const cosSinDeg = FEA.util.cosSinDeg;

  /* =====================================================================
   * 1. Units and the expression parser
   * ===================================================================== */
  const GPA = 1e9, MPA = 1e6, MM = 1e-3, MM2 = 1e-6, MM4 = 1e-12;

  /* ---------- safe arithmetic expression parser for numeric inputs ---------- */
  const D2R = Math.PI / 180;
  const FUNCS = {
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10,
    sin: (d) => cosSinDeg(d)[1], cos: (d) => cosSinDeg(d)[0],
    tan: (d) => { const cs = cosSinDeg(d); return cs[1] / cs[0]; },
    asin: (v) => Math.asin(v) / D2R, acos: (v) => Math.acos(v) / D2R, atan: (v) => Math.atan(v) / D2R,
  };
  function parseExpr(src) {
    const s = String(src).trim().replace(/[\u2212\u2013]/g, '-').replace(/\u00D7/g, '*').replace(/\u03C0/g, 'pi').replace(/,/g, '.');
    if (!s) throw new Error('empty');
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const expr = () => {
      let v = term();
      for (;;) { ws(); if (s[i] === '+') { i++; v += term(); } else if (s[i] === '-') { i++; v -= term(); } else return v; }
    };
    const term = () => {
      let v = unary();
      for (;;) { ws(); if (s[i] === '*') { i++; v *= unary(); } else if (s[i] === '/') { i++; v /= unary(); } else return v; }
    };
    const unary = () => { ws(); if (s[i] === '-') { i++; return -unary(); } if (s[i] === '+') { i++; return unary(); } return power(); };
    const power = () => { const b = primary(); ws(); if (s[i] === '^') { i++; return Math.pow(b, unary()); } return b; };
    const primary = () => {
      ws();
      if (s[i] === '(') { i++; const v = expr(); ws(); if (s[i] !== ')') throw new Error('missing )'); i++; return v; }
      const rest = s.slice(i);
      const mn = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest);
      if (mn) { i += mn[0].length; return parseFloat(mn[0]); }
      const mi = /^[a-z_][a-z0-9_]*/i.exec(rest);
      if (mi) {
        const id = mi[0].toLowerCase();
        i += mi[0].length;
        if (id === 'pi') return Math.PI;
        if (id === 'e') return Math.E;
        const f = FUNCS[id];
        if (!f) throw new Error('unknown name ' + id);
        ws(); if (s[i] !== '(') throw new Error('( expected');
        i++; const v = expr(); ws(); if (s[i] !== ')') throw new Error('missing )'); i++;
        return f(v);
      }
      throw new Error('unexpected ' + (s[i] || 'end'));
    };
    const v = expr(); ws();
    if (i < s.length) throw new Error('unexpected ' + s[i]);
    return v;
  }
  function evalNum(str) { try { const v = parseExpr(str); return Number.isFinite(v) ? v : NaN; } catch (e) { return NaN; } }

  /* =====================================================================
   * 2. Materials, sections, model objects
   * ===================================================================== */
  /**
   * Densities ρ in kg/m³ (self-weight, milestone 4): structural steel 7850 and 6061-T6 aluminium 2700, the usual
   * values. Douglas fir 540 is an approximate representative value at 12 % moisture content: coast Douglas-fir has a
   * specific gravity of 0.48 at 12 % moisture content (USDA Forest Products Laboratory, Wood Handbook, 2021,
   * Table 5–3b), and 1000 kg/m³ × 0.48 × 1.12 (the water held at 12 %) = 537.6 kg/m³, rounded to 540. A custom
   * material has no density until the user enters one: an invented value would give a wrong self-weight without any
   * warning. A missing density is never filled in from a preset either (see readDensity).
   */
  const MATERIAL_PRESETS = {
    steel: { name: 'Structural Steel', E: 200e9, fy: 250e6, density: 7850, color: '#94a3b8' },
    aluminum: { name: '6061-T6 Aluminum', E: 68.9e9, fy: 276e6, density: 2700, color: '#cbd5e1' },
    fir: { name: 'Douglas Fir Timber', E: 11e9, fy: 49.9e6, density: 540, color: '#d6a86b' },
    custom: { name: 'Custom material', E: 100e9, fy: 200e6, density: null, color: '#a78bfa' },
  };
  const FIR_NOTE = 'Timber has no yield point: the limit is the clear-wood compressive strength ∥ grain, 12% MC (USDA Wood Handbook, coast Douglas-fir). Graded-lumber design values are much lower. The preset density, 540 kg/m³, is an approximate representative value at 12% MC (USDA Wood Handbook 2021, Table 5–3b).';
  const GROUP_COLORS = ['#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#c084fc', '#2dd4bf', '#facc15', '#f87171', '#60a5fa', '#e879f9'];

  const SHAPES = {
    custom: { label: 'Custom A and I', dims: [] },
    rod: { label: 'Solid round', dims: [['d', 'Diameter d']] },
    chs: { label: 'Circular hollow (CHS)', dims: [['D', 'Outer Ø D'], ['t', 'Wall t']] },
    rect: { label: 'Solid rectangle', dims: [['b', 'Width b'], ['h', 'Depth h']] },
    rhs: { label: 'Rectangular hollow (RHS/SHS)', dims: [['b', 'Width b'], ['h', 'Depth h'], ['t', 'Wall t']] },
  };
  /** Area and minimum (weak-axis) second moment of area of standard shapes (sharp corners). */
  function sectionProps(sh) {
    const P = Math.PI;
    switch (sh && sh.type) {
      case 'rod': return sh.d > 0 ? { A: P * sh.d * sh.d / 4, I: P * sh.d ** 4 / 64 } : null;
      case 'chs': {
        const D = sh.D, t = sh.t;
        if (!(D > 0 && t > 0 && 2 * t <= D)) return null;
        const di = D - 2 * t;
        return { A: P / 4 * (D * D - di * di), I: P / 64 * (D ** 4 - di ** 4) };
      }
      case 'rect': {
        const b = sh.b, h = sh.h;
        if (!(b > 0 && h > 0)) return null;
        return { A: b * h, I: Math.min(b * h ** 3, h * b ** 3) / 12 };
      }
      case 'rhs': {
        const b = sh.b, h = sh.h, t = sh.t;
        if (!(b > 0 && h > 0 && t > 0 && 2 * t < Math.min(b, h))) return null;
        const bi = b - 2 * t, hi = h - 2 * t;
        return { A: b * h - bi * hi, I: Math.min(b * h ** 3 - bi * hi ** 3, h * b ** 3 - hi * bi ** 3) / 12 };
      }
      default: return null;
    }
  }

  let uidSeq = 1;
  const newUid = () => uidSeq++;
  function makeMaterial(key, over) {
    const p = MATERIAL_PRESETS[key] || MATERIAL_PRESETS.custom;
    return Object.assign({ uid: newUid(), preset: MATERIAL_PRESETS[key] ? key : 'custom', name: p.name, E: p.E, fy: p.fy, density: p.density, color: p.color }, over || {});
  }
  function makeGroup(name, material, shape, color, A, I) {
    const g = { uid: newUid(), name, material, shape: Object.assign({ type: 'custom' }, shape || {}), color: color || GROUP_COLORS[0], A: A || 0, I: I || 0 };
    const sp = sectionProps(g.shape);
    if (sp) { g.A = sp.A; g.I = sp.I; } else g.shape = { type: 'custom' };
    return g;
  }
  function makeNode(x, y) {
    return { uid: newUid(), x, y, support: { type: 'none', angle: 0, fixX: false, fixY: false } };
  }
  const makeMember = (n1, n2, group) => ({ uid: newUid(), n1, n2, group });
  /**
   * A load case: nodal loads { fx, fy } (N) and prescribed settlements { dx, dy } (m), keyed by node. `generated` is
   * null for a case the user fills, or SELF_WEIGHT for the generated self-weight case, whose Maps stay empty.
   */
  function makeLoadCase(name) {
    return { uid: newUid(), name: name || 'Load case 1', generated: null, loads: new Map(), settlements: new Map() };
  }
  function emptyModel(title) {
    const steel = makeMaterial('steel'), alu = makeMaterial('aluminum'), fir = makeMaterial('fir');
    const g = makeGroup('Default: A 2000 mm²', steel, { type: 'custom' }, GROUP_COLORS[0], 2000 * MM2, 2.0e6 * MM4);
    const lc = makeLoadCase('Load case 1');
    return { title: title || 'Untitled truss', nodes: [], members: [], materials: [steel, alu, fir], groups: [g], loadCases: [lc], activeCase: lc,
      combinations: [], activeCombination: null, design: { deflection: null } };
  }

  const SUPPORT_TYPES = [
    ['none', 'None (free joint)'],
    ['pin', 'Pin (ux = uy = 0)'],
    ['rollerX', 'Roller (uy = 0)'],
    ['rollerY', 'Roller (ux = 0)'],
    ['inclined', 'Inclined roller (un = 0)'],
    ['custom', 'Custom (choose the fixed axes)'],
  ];
  const SUPPORT_SHORT = { none: 'Free', pin: 'Pin', rollerX: 'Roller uy=0', rollerY: 'Roller ux=0', inclined: 'Incl. roller', custom: 'Custom' };
  /** A finite number, or `fallback`. A frame angle of 0° is a real angle, not a missing one. */
  const finiteOr = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  /**
   * Sets a support's restraint geometry. Settlements live in the load cases and are not touched. An inclined roller
   * or a custom frame takes the angle given; with none given, the support's current frame angle, 0° included, so the
   * frame does not turn and a settlement keeps its direction; and only if that is missing or invalid, the default:
   * 30° for an inclined roller, 0° (the global axes) for a custom frame.
   */
  function setSupport(node, type, angle) {
    const s = node.support;
    const frame = (fallback) => finiteOr(angle, finiteOr(s.angle, fallback));
    s.type = type;
    const reset = (fx, fy, a) => { s.fixX = fx; s.fixY = fy; s.angle = a; };
    switch (type) {
      case 'pin': reset(true, true, 0); break;
      case 'rollerX': reset(false, true, 0); break;
      case 'rollerY': reset(true, false, 0); break;
      case 'inclined': reset(false, true, frame(30)); break;
      case 'custom':
        if (!s.fixX && !s.fixY) { s.fixX = true; s.fixY = true; }
        s.angle = frame(0);
        break;
      default: s.type = 'none'; reset(false, false, 0);
    }
  }
  /** The restraint a support provides: the fixed axes of its frame x′, y′ and the frame angle (degrees). */
  const supportRestraint = (s) => ({ fixX: !!s.fixX, fixY: !!s.fixY, angle: s.angle || 0 });

  /* ---------- load cases: nodal loads and prescribed settlements ---------- */
  // The action state that reading defaults to: the active combination when one is chosen, otherwise the active case.
  const caseOf = (model, lc) => lc || model.activeCombination || model.activeCase;

  /* ---------- self-weight (milestone 4): a generated dead-load case ---------- */
  /** Standard gravity in m/s² (the conventional value, exact by definition), used in W = ρ·A·L·g. */
  const GRAVITY = 9.80665;
  /** The `generated` value of the self-weight load case. */
  const SELF_WEIGHT = 'self-weight';
  /** A density that can be used: a finite number of kg/m³, 0 or more. Anything else means "not set". */
  const validDensity = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const isGeneratedCase = (lc) => !!lc && lc.generated === SELF_WEIGHT;
  /**
   * The weight of one member and what it is made of: W = ρ·A·L·g in N, with ρ the density of its section's material
   * (kg/m³), A the section area (m²), L = hypot(Δx, Δy) its length (m) and g = GRAVITY (m/s²). When the material has
   * no density, `density` is null and W is 0.
   */
  function memberSelfWeight(member) {
    const d = member.group.material.density, density = validDensity(d) ? d : null;
    const A = member.group.A, L = Math.hypot(member.n2.x - member.n1.x, member.n2.y - member.n1.y);
    return { density, A, L, g: GRAVITY, W: density === null ? 0 : density * A * L * GRAVITY };
  }
  /**
   * The nodal loads of the self-weight case, computed now from the current geometry, sections and materials. They
   * are never stored, so they cannot go stale or add up when recomputed. Each member's weight W acts downward (−y),
   * half at each end node: the statically equivalent end loads of a pin-ended member's uniform weight. Members whose
   * material has no density add nothing. Returns Map(node → { fx: 0, fy }) with non-zero entries only.
   */
  function selfWeightLoads(model) {
    const out = new Map();
    for (const e of model.members) {
      const half = memberSelfWeight(e).W / 2;
      if (!(half > 0)) continue;
      for (const n of [e.n1, e.n2]) {
        const v = out.get(n);
        out.set(n, { fx: 0, fy: (v ? v.fy : 0) - half });
      }
    }
    return out;
  }
  /**
   * The nodal loads of a load case or combination (default: the active state): a case's own entries, for the
   * self-weight case those computed now, and for a combination Σ γᵢ·Fᵢ computed now from its cases.
   */
  function caseLoads(model, lc) {
    const c = caseOf(model, lc);
    return isCombination(c) ? combinationLoads(model, c) : isGeneratedCase(c) ? selfWeightLoads(model) : c.loads;
  }
  /** The prescribed settlements of a load case or combination (default: the active state); Σ γᵢ·u_s,ᵢ for a combination. */
  function caseSettlements(model, lc) {
    const c = caseOf(model, lc);
    return isCombination(c) ? combinationSettlements(model, c) : c.settlements;
  }
  const selfWeightCase = (model) => model.loadCases.find(isGeneratedCase) || null;
  /** Adds the generated self-weight case, which does not become active. A model has at most one: if it already has it, that one is returned. */
  function addSelfWeightCase(model, name) {
    const have = selfWeightCase(model);
    if (have) return have;
    const lc = makeLoadCase(name || 'Self-weight');
    lc.generated = SELF_WEIGHT;
    model.loadCases.push(lc);
    return lc;
  }
  /**
   * The self-weight case as a whole, for every place that presents it: `total` (N, before λ) of the members whose
   * material has a density, `missing` the indices of the members whose material has none (they add no weight), and
   * `materials` those materials, in material order. `complete` is false when any member is missing: an incomplete
   * self-weight must always be shown as incomplete, never as the structure's whole weight.
   */
  function selfWeightSummary(model) {
    let total = 0;
    const missing = [], without = new Set();
    model.members.forEach((e, k) => {
      const w = memberSelfWeight(e);
      if (w.density === null) { missing.push(k); without.add(e.group.material); } else total += w.W;
    });
    return { total, members: model.members.length, counted: model.members.length - missing.length, missing,
      materials: model.materials.filter((m) => without.has(m)), complete: missing.length === 0 };
  }

  /* ---------- load combinations (milestone 5) ---------- */
  /**
   * A load combination: factors γ on load cases, `terms: [{ loadCase, factor }]` kept in load-case order. Its actions
   * are F = Σ γᵢ·Fᵢ and u_s = Σ γᵢ·u_s,ᵢ (the self-weight case included like any case), built whenever they are read,
   * and analysed as one complete action state (toAnalysisInput, analyzeCombination): results are never added up.
   * A factor is any finite number: a negative one reverses a case, and 0 keeps the case listed without effect.
   */
  const isCombination = (x) => !!x && Array.isArray(x.terms);
  const validFactor = (v) => typeof v === 'number' && Number.isFinite(v);
  function makeCombination(name) {
    return { uid: newUid(), name: name || 'Combination 1', terms: [] };
  }
  function nextCombinationName(model) {
    const names = new Set(model.combinations.map((c) => c.name));
    let k = model.combinations.length + 1;
    while (names.has(`Combination ${k}`)) k++;
    return `Combination ${k}`;
  }
  /** Adds an empty combination ("Combination N") and returns it; it does not become active. */
  function addCombination(model, name) {
    const c = makeCombination(name || nextCombinationName(model));
    model.combinations.push(c);
    return c;
  }
  /** Removes a combination. If it was active, the active load case is shown again. */
  function removeCombination(model, comb) {
    const i = model.combinations.indexOf(comb);
    if (i < 0) return false;
    model.combinations.splice(i, 1);
    if (model.activeCombination === comb) model.activeCombination = null;
    return true;
  }
  /** Makes a combination the analysed state, or with null goes back to the active load case. */
  function setActiveCombination(model, comb) {
    model.activeCombination = comb && model.combinations.includes(comb) ? comb : null;
    return model.activeCombination;
  }
  /** The factor γ of a load case in a combination, or null when the case is not in it. */
  function combinationFactor(comb, lc) {
    const t = comb.terms.find((x) => x.loadCase === lc);
    return t ? t.factor : null;
  }
  const sortTerms = (model, comb) => comb.terms.sort((a, b) => model.loadCases.indexOf(a.loadCase) - model.loadCases.indexOf(b.loadCase));
  /**
   * Sets the factor of a load case in a combination (null or undefined removes the case from it). Returns false,
   * changing nothing, for a factor that is not a finite number or a case or combination that is not in the model.
   */
  function setCombinationFactor(model, comb, lc, factor) {
    if (!model.combinations.includes(comb) || !model.loadCases.includes(lc)) return false;
    const i = comb.terms.findIndex((x) => x.loadCase === lc);
    if (factor === null || factor === undefined) { if (i >= 0) comb.terms.splice(i, 1); return true; }
    if (!validFactor(factor)) return false;
    if (i >= 0) comb.terms[i].factor = factor;
    else { comb.terms.push({ loadCase: lc, factor }); sortTerms(model, comb); }
    return true;
  }
  /** F = Σ γᵢ·Fᵢ: the combination's nodal loads, summed in load-case order, as Map(node → { fx, fy }). */
  function combinationLoads(model, comb) {
    const out = new Map();
    for (const t of comb.terms) {
      for (const [n, v] of caseLoads(model, t.loadCase)) {
        const p = out.get(n);
        out.set(n, { fx: (p ? p.fx : 0) + t.factor * v.fx, fy: (p ? p.fy : 0) + t.factor * v.fy });
      }
    }
    return out;
  }
  /** u_s = Σ γᵢ·u_s,ᵢ: the combination's settlements along each support's x′, y′, as Map(node → { dx, dy }). */
  function combinationSettlements(model, comb) {
    const out = new Map();
    for (const t of comb.terms) {
      for (const [n, v] of t.loadCase.settlements) {
        const p = out.get(n);
        out.set(n, { dx: (p ? p.dx : 0) + t.factor * v.dx, dy: (p ? p.dy : 0) + t.factor * v.dy });
      }
    }
    return out;
  }
  /** What is analysed and shown: the active combination when one is chosen, otherwise the active load case. */
  const activeTarget = (model) => caseOf(model);

  /** Nodal load { fx, fy } in N on `node` in load case `lc` (default: the active case); generated in the self-weight case. */
  function nodeLoad(model, node, lc) {
    const v = caseLoads(model, lc).get(node);
    return v ? { fx: v.fx, fy: v.fy } : { fx: 0, fy: 0 };
  }
  /**
   * Sets a nodal load; a zero load removes the entry. Returns false, changing nothing, in the generated self-weight
   * case and in a combination (including the active one, the default): their loads are never entered by hand.
   */
  function setNodeLoad(model, node, fx, fy, lc) {
    const c = caseOf(model, lc);
    if (isGeneratedCase(c) || isCombination(c)) return false;
    if (fx === 0 && fy === 0) c.loads.delete(node); else c.loads.set(node, { fx, fy });
    return true;
  }
  /** Prescribed settlement { dx, dy } in m along the support frame axes x′, y′ (rotated by the support angle). */
  function nodeSettlement(model, node, lc) {
    const v = caseSettlements(model, lc).get(node);
    return v ? { dx: v.dx, dy: v.dy } : { dx: 0, dy: 0 };
  }
  /**
   * Sets a prescribed settlement; zero removes the entry. A value on an axis that is not fixed is kept but has no
   * effect. Returns false, changing nothing, in the generated self-weight case (it holds no settlements) and in a
   * combination.
   */
  function setNodeSettlement(model, node, dx, dy, lc) {
    const c = caseOf(model, lc);
    if (isGeneratedCase(c) || isCombination(c)) return false;
    if (dx === 0 && dy === 0) c.settlements.delete(node); else c.settlements.set(node, { dx, dy });
    return true;
  }
  function nextCaseName(model) {
    const names = new Set(model.loadCases.map((c) => c.name));
    let k = model.loadCases.length + 1;
    while (names.has(`Load case ${k}`)) k++;
    return `Load case ${k}`;
  }
  /** Adds an empty load case and returns it (it does not become active). */
  function addLoadCase(model, name) {
    const lc = makeLoadCase(name || nextCaseName(model));
    model.loadCases.push(lc);
    return lc;
  }
  /**
   * Removes a load case, never the last one. If it was active, a neighbouring case becomes active. Its factors are
   * removed from every combination, which then combine the remaining cases.
   */
  function removeLoadCase(model, lc) {
    const i = model.loadCases.indexOf(lc);
    if (i < 0 || model.loadCases.length <= 1) return false;
    model.loadCases.splice(i, 1);
    for (const c of model.combinations || []) c.terms = c.terms.filter((t) => t.loadCase !== lc);
    if (model.activeCase === lc) model.activeCase = model.loadCases[Math.min(i, model.loadCases.length - 1)];
    return true;
  }
  /** Makes a load case active: the one loads are entered in and, with no combination chosen, the one analysed. */
  function setActiveLoadCase(model, lc) {
    if (model.loadCases.includes(lc)) { model.activeCase = lc; model.activeCombination = null; }
    return model.activeCase;
  }
  /** Deletes the loads and settlements of the given nodes from every load case (used when nodes are deleted). */
  function removeNodeActions(model, nodes) {
    for (const lc of model.loadCases) for (const n of nodes) { lc.loads.delete(n); lc.settlements.delete(n); }
  }
  const caseHasSettlement = (lc) => [...lc.settlements.values()].some((v) => v.dx !== 0 || v.dy !== 0);
  const modelHasSettlement = (model) => model.loadCases.some(caseHasSettlement);

  /* ---------- (de)serialisation: file format version 2, SI units, 1-based ids ---------- */
  const FORMAT_VERSION = 2;
  const fin = (v, d) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
  function serialize(model) {
    const mi = new Map(model.materials.map((m, i) => [m, i + 1]));
    const gi = new Map(model.groups.map((g, i) => [g, i + 1]));
    const ni = new Map(model.nodes.map((n, i) => [n, i + 1]));
    // sparse lists in node order: only non-zero entries are written
    const entries = (map, a, b) => model.nodes.filter((n) => map.has(n))
      .map((n) => { const v = map.get(n); return { node: ni.get(n), [a]: v[a], [b]: v[b] }; })
      .filter((e) => e[a] !== 0 || e[b] !== 0);
    const out = {
      format: 'trusslab-model', version: FORMAT_VERSION,
      units: { length: 'm', force: 'N', stress: 'Pa', area: 'm^2', inertia: 'm^4', angle: 'deg' },
      title: model.title,
      materials: model.materials.map((m, i) => ({ id: i + 1, name: m.name, preset: m.preset, E: m.E, fy: m.fy, density: validDensity(m.density) ? m.density : null, color: m.color })),
      sections: model.groups.map((g, i) => ({ id: i + 1, name: g.name, material: mi.get(g.material), A: g.A, I: g.I, shape: Object.assign({}, g.shape), color: g.color })),
      nodes: model.nodes.map((n, i) => ({ id: i + 1, x: n.x, y: n.y, support: { type: n.support.type, angle: n.support.angle, fixX: n.support.fixX, fixY: n.support.fixY } })),
      members: model.members.map((e, i) => ({ id: i + 1, n1: ni.get(e.n1), n2: ni.get(e.n2), section: gi.get(e.group) })),
      // the self-weight case is written as generated, without loads: they are computed again from the members when read
      loadCases: model.loadCases.map((lc, i) => (isGeneratedCase(lc)
        ? { id: i + 1, name: lc.name, generated: SELF_WEIGHT, loads: [], settlements: [] }
        : { id: i + 1, name: lc.name, loads: entries(lc.loads, 'fx', 'fy'), settlements: entries(lc.settlements, 'dx', 'dy') })),
      activeLoadCase: model.loadCases.indexOf(model.activeCase) + 1,
      // milestone 5: combinations refer to load cases by id; null when no combination is the analysed state
      combinations: (model.combinations || []).map((c, i) => ({ id: i + 1, name: c.name,
        terms: c.terms.filter((t) => model.loadCases.includes(t.loadCase)).map((t) => ({ loadCase: model.loadCases.indexOf(t.loadCase) + 1, factor: t.factor })) })),
      activeCombination: model.activeCombination && (model.combinations || []).includes(model.activeCombination) ? model.combinations.indexOf(model.activeCombination) + 1 : null,
    };
    // milestone 10: the reference-chord deflection criterion, written only when one is set (optional field)
    const d = designDeflectionOut(model);
    if (d) out.design = { deflection: d };
    return out;
  }
  /** The deflection criterion in file form (node ids), or null when none is set or its chord nodes are gone. */
  function designDeflectionOut(model) {
    const c = model.design && model.design.deflection;
    if (!c) return null;
    const id = (n) => model.nodes.indexOf(n) + 1;
    if (!id(c.a) || !id(c.b) || c.a === c.b) return null;
    return { chordA: id(c.a), chordB: id(c.b), nodes: c.nodes.map(id).filter((k) => k > 0), limit: { type: c.limit.type, value: c.limit.value } };
  }
  const LIMIT_TYPES = ['ratio', 'absolute'];
  /** A valid deflection limit: a span/δ ratio above 0, or an absolute value in metres above 0. */
  const validLimit = (l) => !!l && LIMIT_TYPES.includes(l.type) && typeof l.value === 'number' && Number.isFinite(l.value) && l.value > 0;

  /**
   * Reads a model file (format version 1 or 2), an autosaved session { model, settings, view } or an
   * exported report { meta, model, ... }. A version 1 model is migrated in memory: its nodal loads and the
   * settlements of its custom supports move into "Load case 1". Returns { model, fromVersion, notes }.
   * The notes ({ msg, ref? }) list everything that was skipped or not applied, so nothing is lost silently.
   */
  function readModel(input) {
    if (!input || typeof input !== 'object') throw new Error('the file is not a JSON object');
    const obj = nestedModel(input);
    // the version decides first: a newer model may be laid out differently, so it is refused as newer, not as malformed
    if (Number(obj.version) > FORMAT_VERSION) {
      throw new Error(`it was written by a newer version of TrussLab (file format version ${obj.version}), which this version cannot read`);
    }
    if (!Array.isArray(obj.nodes) || !Array.isArray(obj.members)) throw new Error('missing "nodes" or "members" arrays');
    const fromVersion = Number(obj.version) === 2 ? 2 : 1;
    const notes = [];
    const model = readStructure(obj, notes);
    if (fromVersion === 2) { readLoadCasesV2(obj, model, notes); readCombinationsV2(obj, model, notes); readDesignV2(obj, model, notes); } else migrateV1(obj, model, notes);
    return { model, fromVersion, notes };
  }
  /** readModel without the notes (the interface script.js and window.TrussLab have always used). */
  function deserialize(obj) { return readModel(obj).model; }
  /**
   * The model inside an autosaved session { model, settings, view } or a calculation report { meta, model, ... };
   * otherwise the input itself. The nested object counts as a model if it has a "nodes" list or says it is one
   * (format "trusslab-model", or a version), so a newer model with another layout is still found and its own
   * version checked. A version on the wrapper itself is never read.
   */
  function nestedModel(input) {
    const m = input.model;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return input;
    return Array.isArray(m.nodes) || m.format === 'trusslab-model' || (m.version !== undefined && m.version !== null) ? m : input;
  }

  /** Materials, sections, nodes (geometry and support restraints), members and title: the same in both versions. */
  function readStructure(obj, notes) {
    const matsIn = Array.isArray(obj.materials) && obj.materials.length ? obj.materials : [{ preset: 'steel' }];
    const materials = matsIn.map((m, i) => {
      const key = MATERIAL_PRESETS[m.preset] ? m.preset : 'custom', p = MATERIAL_PRESETS[key];
      const E = fin(m.E, p.E), fy = fin(m.fy, p.fy), name = String(m.name || p.name).slice(0, 80);
      return makeMaterial(key, { name, E: E > 0 ? E : p.E, fy: fy > 0 ? fy : p.fy, density: readDensity(m.density, i, name, notes), color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : p.color });
    });
    const secIn = Array.isArray(obj.sections) ? obj.sections : Array.isArray(obj.groups) ? obj.groups : [];
    const groups = secIn.map((g, i) => {
      const mat = materials[fin(g.material, 1) - 1] || materials[0];
      const shIn = g.shape && SHAPES[g.shape.type] ? g.shape : { type: 'custom' };
      const shape = { type: shIn.type };
      for (const [k] of SHAPES[shIn.type].dims) shape[k] = fin(shIn[k], 0);
      const A = fin(g.A, 0), I = fin(g.I, 0);
      const grp = makeGroup(String(g.name || `Section ${i + 1}`).slice(0, 80), mat, shape, /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : GROUP_COLORS[i % GROUP_COLORS.length], A, I);
      if (!(grp.A > 0)) grp.A = 1000 * MM2;
      if (!(grp.I > 0)) grp.I = 1e6 * MM4;
      return grp;
    });
    if (!groups.length) groups.push(makeGroup('Default: A 2000 mm²', materials[0], { type: 'custom' }, GROUP_COLORS[0], 2000 * MM2, 2.0e6 * MM4));
    const nodes = obj.nodes.map((n, i) => {
      const x = fin(n.x, NaN), y = fin(n.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`node ${i + 1} has invalid coordinates`);
      const nd = makeNode(x, y);
      const s = n.support || {};
      const type = SUPPORT_TYPES.some(([k]) => k === s.type) ? s.type : 'none';
      // a custom support keeps exactly its fixed axes, even none (missing flags count as false)
      if (type === 'custom') Object.assign(nd.support, { type, fixX: !!s.fixX, fixY: !!s.fixY, angle: fin(s.angle, 0) });
      else setSupport(nd, type, fin(s.angle, 30));
      return nd;
    });
    const members = obj.members.map((e, k) => {
      const a = nodes[fin(e.n1, 0) - 1], b = nodes[fin(e.n2, 0) - 1];
      if (!a || !b || a === b) throw new Error(`member ${k + 1} references invalid nodes`);
      return makeMember(a, b, groups[fin(e.section !== undefined ? e.section : e.group, 1) - 1] || groups[0]);
    });
    const lc = makeLoadCase('Load case 1');
    return { title: String(obj.title || 'Imported truss').slice(0, 120), nodes, members, materials, groups, loadCases: [lc], activeCase: lc,
      combinations: [], activeCombination: null, design: { deflection: null } };
  }

  /**
   * A material's density from a file. Missing or null means not set: files written before milestone 4 have none,
   * and the preset is never used to fill it in, even when E and fy still equal the preset's, because the material
   * may have been changed since and a guessed density would give a self-weight nobody entered (maintainer decision,
   * milestone 4). A number of kg/m³, 0 or more (or a string holding one), is kept; anything else is not set either,
   * and a note says so.
   */
  function readDensity(v, i, name, notes) {
    if (v === undefined || v === null) return null;
    const d = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? +v : NaN;
    if (validDensity(d)) return d;
    notes.push({ msg: `Material ${i + 1} ("${name}"): the density ${JSON.stringify(v).slice(0, 40)} is not a number of kg/m³ (0 or more), so it is not set, and its members carry no self-weight until one is entered.` });
    return null;
  }

  /**
   * Version 1 -> version 2: node.load becomes a load in "Load case 1"; a custom support's dx, dy becomes a
   * settlement there, in the same support frame x′, y′ (kept even on an axis that is not fixed, where it has
   * no effect and validateModel warns). Version 1 ignored dx, dy on every other support type, so they are not
   * applied; a note says so.
   */
  function migrateV1(obj, model, notes) {
    const lc = model.loadCases[0];
    obj.nodes.forEach((n, i) => {
      const nd = model.nodes[i];
      const fx = fin(n.load && n.load.fx, 0), fy = fin(n.load && n.load.fy, 0);
      if (fx !== 0 || fy !== 0) lc.loads.set(nd, { fx, fy });
      const s = n.support || {};
      const dx = fin(s.dx, 0), dy = fin(s.dy, 0);
      if (dx === 0 && dy === 0) return;
      if (nd.support.type === 'custom') lc.settlements.set(nd, { dx, dy });
      else notes.push({ msg: `Node ${i + 1}: the file prescribes a displacement (dx = ${dx} m, dy = ${dy} m) on a "${nd.support.type}" support. File format version 1 ignored it on this support type, so it was not applied.`, ref: { type: 'node', index: i } });
    });
  }

  /**
   * Version 2 load cases. Malformed content is handled deterministically: an entry for a missing node or with
   * a non-finite value is skipped and reported; a second entry for the same node in the same list is skipped
   * and reported (the first valid entry wins); invalid or duplicate load-case ids reject the file; unknown
   * fields are ignored, for forward compatibility.
   */
  function readLoadCasesV2(obj, model, notes) {
    const list = obj.loadCases;
    if (list === undefined) { notes.push({ msg: 'The file has no load cases, so an empty "Load case 1" was created.' }); return; }
    if (!Array.isArray(list)) throw new Error('"loadCases" must be a list');
    if (!list.length) { notes.push({ msg: 'The file has an empty list of load cases, so an empty "Load case 1" was created.' }); return; }
    const ids = new Set();
    list.forEach((c, k) => {
      if (!c || typeof c !== 'object') throw new Error(`load case ${k + 1} is not an object`);
      if (!Number.isInteger(c.id) || c.id < 1) throw new Error(`load case ${k + 1} has an invalid id (${JSON.stringify(c.id)})`);
      if (ids.has(c.id)) throw new Error(`two load cases have the id ${c.id}`);
      ids.add(c.id);
    });
    model.loadCases = list.map((c, k) => {
      const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 80) : `Load case ${k + 1}`;
      const lc = makeLoadCase(name);
      if (c.generated === SELF_WEIGHT) {
        // generated: the loads are computed from the members, so anything stored with the case is not used
        lc.generated = SELF_WEIGHT;
        const stored = [c.loads, c.settlements].some((x) => x !== undefined && !(Array.isArray(x) && x.length === 0));
        if (stored) notes.push({ msg: `"${name}" is the generated self-weight case: its loads are computed from the members, so the loads or settlements stored with it were not applied.` });
        return lc;
      }
      if (c.generated !== undefined && c.generated !== null) {
        notes.push({ msg: `"${name}" says it is generated (${JSON.stringify(c.generated).slice(0, 40)}), which this version of TrussLab cannot generate, so it was read as an ordinary load case.` });
      }
      readEntries(c.loads, 'fx', 'fy', lc.loads, model, notes, `"${name}", loads`);
      readEntries(c.settlements, 'dx', 'dy', lc.settlements, model, notes, `"${name}", settlements`);
      return lc;
    });
    const a = list.findIndex((c) => c.id === obj.activeLoadCase);
    model.activeCase = model.loadCases[a >= 0 ? a : 0];
    if (a < 0) notes.push({ msg: `The file names load case ${JSON.stringify(obj.activeLoadCase)} as active, which does not exist, so "${model.activeCase.name}" is active.` });
  }
  /**
   * Combinations (milestone 5, optional in version 2). Structural faults reject the file, as for load cases: a list
   * that is not a list, a combination that is not an object, an invalid or repeated id. A term is skipped, with a
   * note, when it is not an object, names a load case the file does not have, has a factor that is not a finite
   * number, or repeats a case already in the combination (the first wins). Nothing is dropped without a note.
   */
  function readCombinationsV2(obj, model, notes) {
    const list = obj.combinations, active = obj.activeCombination;
    if (list === undefined || list === null) {
      if (active !== undefined && active !== null) notes.push({ msg: `The file names combination ${JSON.stringify(active).slice(0, 40)} as active but has no combinations, so "${model.activeCase.name}" is shown.` });
      return;
    }
    if (!Array.isArray(list)) throw new Error('"combinations" must be a list');
    const ids = new Set();
    list.forEach((c, k) => {
      if (!c || typeof c !== 'object') throw new Error(`combination ${k + 1} is not an object`);
      if (!Number.isInteger(c.id) || c.id < 1) throw new Error(`combination ${k + 1} has an invalid id (${JSON.stringify(c.id)})`);
      if (ids.has(c.id)) throw new Error(`two combinations have the id ${c.id}`);
      ids.add(c.id);
    });
    // the load cases as the file numbered them (their ids were checked by readLoadCasesV2)
    const caseById = new Map();
    if (Array.isArray(obj.loadCases) && obj.loadCases.length === model.loadCases.length) obj.loadCases.forEach((c, k) => caseById.set(c.id, model.loadCases[k]));
    model.combinations = list.map((c, k) => {
      const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 80) : `Combination ${k + 1}`;
      const comb = makeCombination(name);
      if (c.terms === undefined) return comb;
      if (!Array.isArray(c.terms)) { notes.push({ msg: `Combination "${name}": its load cases are not a list, so it has none.` }); return comb; }
      c.terms.forEach((t, j) => {
        const at = `Combination "${name}", term ${j + 1}`;
        if (!t || typeof t !== 'object') { notes.push({ msg: `${at}: not an object, so it was skipped.` }); return; }
        const lc = Number.isInteger(t.loadCase) ? caseById.get(t.loadCase) : undefined;
        if (!lc) { notes.push({ msg: `${at}: load case ${JSON.stringify(t.loadCase)} does not exist, so the term was skipped.` }); return; }
        const f = typeof t.factor === 'number' ? t.factor : typeof t.factor === 'string' && t.factor.trim() !== '' ? +t.factor : NaN;
        if (!validFactor(f)) { notes.push({ msg: `${at} ("${lc.name}"): the factor ${JSON.stringify(t.factor === undefined ? null : t.factor).slice(0, 40)} is not a finite number, so the term was skipped.` }); return; }
        if (comb.terms.some((x) => x.loadCase === lc)) { notes.push({ msg: `${at}: "${lc.name}" already has a factor in this combination, so this one was skipped.` }); return; }
        comb.terms.push({ loadCase: lc, factor: f });
      });
      sortTerms(model, comb);
      return comb;
    });
    if (active === undefined || active === null) return;
    const a = list.findIndex((c) => c.id === active);
    if (a >= 0) model.activeCombination = model.combinations[a];
    else notes.push({ msg: `The file names combination ${JSON.stringify(active).slice(0, 40)} as active, which does not exist, so "${model.activeCase.name}" is shown.` });
  }
  /**
   * The design data (milestone 10, optional in version 2): the reference-chord deflection criterion. It is
   * design input, not structure, so a malformed criterion never rejects the file: it is left out with a note.
   */
  function readDesignV2(obj, model, notes) {
    model.design = { deflection: null };
    const d = obj.design;
    if (d === undefined || d === null) return;
    if (typeof d !== 'object' || Array.isArray(d)) { notes.push({ msg: 'The design data is not an object, so it was not read.' }); return; }
    const c = d.deflection;
    if (c === undefined || c === null) return;
    const node = (v) => (Number.isInteger(v) && v >= 1 && v <= model.nodes.length ? model.nodes[v - 1] : null);
    if (typeof c !== 'object') { notes.push({ msg: 'The deflection criterion is not an object, so it was not applied.' }); return; }
    const a = node(c.chordA), b = node(c.chordB);
    if (!a || !b || a === b) { notes.push({ msg: `The deflection criterion names reference nodes ${JSON.stringify(c.chordA)} and ${JSON.stringify(c.chordB)}, which are not two different nodes of this model, so it was not applied.` }); return; }
    const limit = c.limit && typeof c.limit === 'object' ? { type: c.limit.type, value: typeof c.limit.value === 'string' && c.limit.value.trim() !== '' ? +c.limit.value : c.limit.value } : null;
    if (!validLimit(limit)) { notes.push({ msg: `The deflection limit ${JSON.stringify(c.limit).slice(0, 60)} is not a positive ratio or length, so the criterion was not applied.` }); return; }
    const nodes = [];
    for (const v of Array.isArray(c.nodes) ? c.nodes : []) {
      const n = node(v);
      if (!n) notes.push({ msg: `The deflection criterion names node ${JSON.stringify(v).slice(0, 20)}, which does not exist, so it was skipped.` });
      else if (!nodes.includes(n)) nodes.push(n);
    }
    if (!Array.isArray(c.nodes)) notes.push({ msg: 'The deflection criterion has no list of nodes to check.' });
    model.design.deflection = { a, b, nodes, limit };
  }
  /** Sets (or with null clears) the deflection criterion. Returns false, changing nothing, for invalid input. */
  function setDeflectionCriterion(model, crit) {
    if (!model.design) model.design = { deflection: null };
    if (crit === null) { model.design.deflection = null; return true; }
    if (!crit || !model.nodes.includes(crit.a) || !model.nodes.includes(crit.b) || crit.a === crit.b || !validLimit(crit.limit)) return false;
    const nodes = (crit.nodes || []).filter((n, i, arr) => model.nodes.includes(n) && arr.indexOf(n) === i);
    model.design.deflection = { a: crit.a, b: crit.b, nodes, limit: { type: crit.limit.type, value: crit.limit.value } };
    return true;
  }
  /** After nodes are deleted: drops them from the criterion; returns what changed ('', 'nodes' or 'criterion'). */
  function pruneDesign(model) {
    const c = model.design && model.design.deflection;
    if (!c) return '';
    if (!model.nodes.includes(c.a) || !model.nodes.includes(c.b)) { model.design.deflection = null; return 'criterion'; }
    const keep = c.nodes.filter((n) => model.nodes.includes(n));
    if (keep.length === c.nodes.length) return '';
    c.nodes = keep;
    return 'nodes';
  }
  const entryNum = (v) => (v === undefined ? 0 : v === null || v === '' ? NaN : +v);
  function readEntries(list, a, b, into, model, notes, where) {
    if (list === undefined) return;
    if (!Array.isArray(list)) { notes.push({ msg: `${where}: not a list, so it was skipped.` }); return; }
    const seen = new Set();
    list.forEach((e, k) => {
      const at = `${where}, entry ${k + 1}`;
      if (!e || typeof e !== 'object') { notes.push({ msg: `${at}: not an object, so it was skipped.` }); return; }
      const node = Number.isInteger(e.node) ? model.nodes[e.node - 1] : undefined;
      if (!node) { notes.push({ msg: `${at}: node ${JSON.stringify(e.node)} does not exist, so the entry was skipped.` }); return; }
      const ref = { type: 'node', index: e.node - 1 };
      const va = entryNum(e[a]), vb = entryNum(e[b]);
      if (!Number.isFinite(va) || !Number.isFinite(vb)) { notes.push({ msg: `${at} (node ${e.node}): ${a} or ${b} is not a finite number, so the entry was skipped.`, ref }); return; }
      if (seen.has(node)) { notes.push({ msg: `${at}: node ${e.node} already has an entry in this list, so this one was skipped.`, ref }); return; }
      seen.add(node);
      if (va !== 0 || vb !== 0) into.set(node, { [a]: va, [b]: vb });
    });
  }

  /**
   * Model checks that the solver does not make. Returns warnings { msg, ref } for: a custom support with no
   * fixed axis (it provides no restraint), a settlement on an axis that is not fixed, a settlement on a
   * node that no member connects (both have no effect), when there is a self-weight case, a material
   * without density used by members (they carry no weight), and a combination without any action (no load
   * cases, or every factor 0).
   */
  function validateModel(model) {
    const warnings = [];
    const connected = new Set();
    model.members.forEach((e) => { connected.add(e.n1); connected.add(e.n2); });
    model.nodes.forEach((n, i) => {
      if (n.support.type === 'custom' && !n.support.fixX && !n.support.fixY) {
        warnings.push({ msg: `Node ${i + 1}: the custom support has neither x′ nor y′ fixed, so it provides no restraint.`, ref: { type: 'node', index: i } });
      }
    });
    model.loadCases.forEach((lc) => {
      model.nodes.forEach((n, i) => {
        const v = lc.settlements.get(n);
        if (!v || (v.dx === 0 && v.dy === 0)) return;
        const ref = { type: 'node', index: i };
        if (!connected.has(n)) { warnings.push({ msg: `Node ${i + 1} is not connected to any member, so its settlement in "${lc.name}" has no effect.`, ref }); return; }
        const free = [];
        if (v.dx !== 0 && !n.support.fixX) free.push('x′');
        if (v.dy !== 0 && !n.support.fixY) free.push('y′');
        if (free.length) warnings.push({ msg: `Node ${i + 1}: the settlement along ${free.join(' and ')} in "${lc.name}" has no effect, because ${free.join(' and ')} ${free.length > 1 ? 'are' : 'is'} not fixed.`, ref });
      });
    });
    const sw = selfWeightCase(model);
    if (sw) {
      const without = new Map();
      model.members.forEach((e) => { const mat = e.group.material; if (!validDensity(mat.density)) without.set(mat, (without.get(mat) || 0) + 1); });
      model.materials.forEach((mat) => {
        const k = without.get(mat);
        if (k) warnings.push({ msg: `Material "${mat.name}" has no density, so ${k > 1 ? `its ${k} members carry` : 'its member carries'} no weight in "${sw.name}".` });
      });
    }
    (model.combinations || []).forEach((c) => {
      if (!c.terms.length) warnings.push({ msg: `Combination "${c.name}" has no load cases, so it has no actions.` });
      else if (c.terms.every((t) => t.factor === 0)) warnings.push({ msg: `Combination "${c.name}": every factor is 0, so it has no actions.` });
    });
    return warnings;
  }

  /* =====================================================================
   * 3. Example structures
   * ===================================================================== */
  const EXAMPLES = [
    ['pratt', 'Pratt bridge truss, 18 m span (steel)'],
    ['howe', 'Howe bridge truss, 18 m span (buckling check)'],
    ['warren', 'Warren truss, equilateral (6061-T6 aluminum)'],
    ['aframe', 'Two-bar A-frame: closed-form check'],
    ['cantilever', 'Wall-mounted cantilever truss'],
    ['fink', 'Fink roof truss (Douglas fir)'],
    ['inclined', 'Inclined roller support at 30°'],
    ['settlement', 'Two-span truss with 10 mm support settlement'],
    ['mechanism', 'Unstable: panel without diagonal'],
  ];
  function buildExample(key) {
    const M = emptyModel();
    const [steel, alu, fir] = M.materials;
    M.groups = [];
    const N = (x, y) => { const n = makeNode(x, y); M.nodes.push(n); return n; };
    const E = (a, b, g) => { M.members.push(makeMember(a, b, g)); };
    const G = (name, mat, shape, color, A, I) => { const g = makeGroup(name, mat, shape, color, A, I); M.groups.push(g); return g; };
    const load = (n, fx, fy) => setNodeLoad(M, n, fx, fy); // into "Load case 1", the only case of every example
    const C = GROUP_COLORS;
    switch (key) {
      case 'howe':
      case 'pratt': {
        const howe = key === 'howe';
        M.title = howe ? 'Howe truss: 6 panels × 3 m, h = 3 m, 50 kN panel loads' : 'Pratt truss: 6 panels × 3 m, h = 3 m, 60 kN panel loads';
        const ch = G('Chords: CHS 139.7×6.3', steel, { type: 'chs', D: 139.7 * MM, t: 6.3 * MM }, C[0]);
        const wb = G('Web: CHS 88.9×5.0', steel, { type: 'chs', D: 88.9 * MM, t: 5.0 * MM }, C[1]);
        const B = [], T = [];
        for (let k = 0; k <= 6; k++) B.push(N(3 * k, 0));
        for (let k = 1; k <= 5; k++) T[k] = N(3 * k, 3);
        for (let k = 0; k < 6; k++) E(B[k], B[k + 1], ch);
        for (let k = 1; k < 5; k++) E(T[k], T[k + 1], ch);
        E(B[0], T[1], ch); E(T[5], B[6], ch);
        for (let k = 1; k <= 5; k++) E(B[k], T[k], wb);
        if (howe) { E(B[1], T[2], wb); E(B[2], T[3], wb); E(T[3], B[4], wb); E(T[4], B[5], wb); }
        else { E(T[1], B[2], wb); E(T[2], B[3], wb); E(T[4], B[3], wb); E(T[5], B[4], wb); }
        setSupport(B[0], 'pin'); setSupport(B[6], 'rollerX');
        for (let k = 1; k <= 5; k++) load(B[k], 0, howe ? -50e3 : -60e3);
        break;
      }
      case 'warren': {
        M.title = 'Warren truss: equilateral, 5 × 4 m, 6061-T6 aluminum';
        const ch = G('Chords: CHS 150×8 (Al)', alu, { type: 'chs', D: 150 * MM, t: 8 * MM }, C[0]);
        const wb = G('Diagonals: CHS 120×6 (Al)', alu, { type: 'chs', D: 120 * MM, t: 6 * MM }, C[2]);
        const h = 2 * Math.sqrt(3);
        const B = [], T = [];
        for (let k = 0; k <= 5; k++) B.push(N(4 * k, 0));
        for (let k = 0; k < 5; k++) T.push(N(4 * k + 2, h));
        for (let k = 0; k < 5; k++) E(B[k], B[k + 1], ch);
        for (let k = 0; k < 4; k++) E(T[k], T[k + 1], ch);
        for (let k = 0; k < 5; k++) { E(B[k], T[k], wb); E(T[k], B[k + 1], wb); }
        setSupport(B[0], 'pin'); setSupport(B[5], 'rollerX');
        for (let k = 1; k <= 4; k++) load(B[k], 0, -40e3);
        break;
      }
      case 'aframe': {
        M.title = 'A-frame (3-4-5): exact F = −62.5 kN, uy = −1.953125 mm';
        const g = G('Bar: A 1000 mm², I 1.0e6 mm⁴', steel, { type: 'custom' }, C[0], 1000 * MM2, 1e6 * MM4);
        const a = N(0, 0), b = N(6, 0), c = N(3, 4);
        E(a, c, g); E(b, c, g);
        setSupport(a, 'pin'); setSupport(b, 'pin');
        load(c, 0, -100e3);
        break;
      }
      case 'cantilever': {
        M.title = 'Cantilever truss: 8 m reach, 40 kN tip load';
        const ch = G('Chords: SHS 100×100×5', steel, { type: 'rhs', b: 100 * MM, h: 100 * MM, t: 5 * MM }, C[0]);
        const wb = G('Web: SHS 60×60×4', steel, { type: 'rhs', b: 60 * MM, h: 60 * MM, t: 4 * MM }, C[3]);
        const B = [0, 2, 4, 6, 8].map((x) => N(x, 0));
        const T = [0, 2, 4, 6].map((x) => N(x, 2));
        for (let k = 0; k < 4; k++) E(B[k], B[k + 1], ch);
        for (let k = 0; k < 3; k++) E(T[k], T[k + 1], ch);
        E(T[3], B[4], ch);
        for (let k = 1; k <= 3; k++) E(B[k], T[k], wb);
        for (let k = 0; k < 3; k++) E(B[k], T[k + 1], wb);
        setSupport(B[0], 'pin'); setSupport(T[0], 'pin');
        load(B[4], 0, -40e3);
        break;
      }
      case 'fink': {
        M.title = 'Fink roof truss: 12 m span, 3 m rise, Douglas fir 75×200';
        const g = G('Timber 75×200 (DF)', fir, { type: 'rect', b: 75 * MM, h: 200 * MM }, C[3]);
        const A = N(0, 0), B = N(4, 0), Cc = N(8, 0), D = N(12, 0), Ee = N(3, 1.5), F = N(6, 3), Gg = N(9, 1.5);
        E(A, Ee, g); E(Ee, F, g); E(F, Gg, g); E(Gg, D, g);
        E(A, B, g); E(B, Cc, g); E(Cc, D, g);
        E(Ee, B, g); E(B, F, g); E(F, Cc, g); E(Cc, Gg, g);
        setSupport(A, 'pin'); setSupport(D, 'rollerX');
        load(Ee, 0, -10e3); load(F, 0, -10e3); load(Gg, 0, -10e3);
        break;
      }
      case 'inclined': {
        M.title = 'Inclined roller at 30°: R_B acts normal to the surface';
        const g = G('CHS 88.9×5.0', steel, { type: 'chs', D: 88.9 * MM, t: 5 * MM }, C[0]);
        const a = N(0, 0), b = N(6, 0), c = N(3, 3);
        E(a, b, g); E(a, c, g); E(b, c, g);
        setSupport(a, 'pin'); setSupport(b, 'inclined', 30);
        load(c, 20e3, -50e3);
        break;
      }
      case 'settlement': {
        M.title = 'Two-span truss: middle support settles 10 mm (indeterminate)';
        const ch = G('Chords: CHS 114.3×6.0', steel, { type: 'chs', D: 114.3 * MM, t: 6 * MM }, C[0]);
        const wb = G('Web: CHS 88.9×5.0', steel, { type: 'chs', D: 88.9 * MM, t: 5 * MM }, C[1]);
        const B = [], T = [];
        for (let k = 0; k <= 8; k++) B.push(N(2.5 * k, 0));
        for (let k = 0; k <= 8; k++) T.push(N(2.5 * k, 2.5));
        for (let k = 0; k < 8; k++) { E(B[k], B[k + 1], ch); E(T[k], T[k + 1], ch); }
        for (let k = 0; k <= 8; k++) E(B[k], T[k], wb);
        for (let k = 0; k < 8; k++) { if (k % 4 < 2) E(T[k], B[k + 1], wb); else E(B[k], T[k + 1], wb); }
        setSupport(B[0], 'pin'); setSupport(B[8], 'rollerX');
        Object.assign(B[4].support, { type: 'custom', fixX: false, fixY: true, angle: 0 });
        setNodeSettlement(M, B[4], 0, -10 * MM); // same load case as the loads, so the results are unchanged
        for (const k of [1, 2, 3, 5, 6, 7]) load(B[k], 0, -20e3);
        break;
      }
      case 'mechanism': {
        M.title = 'Unstable: the middle panel has no diagonal';
        const g = G('CHS 88.9×5.0', steel, { type: 'chs', D: 88.9 * MM, t: 5 * MM }, C[0]);
        const B = [0, 3, 6, 9].map((x) => N(x, 0)), T = [0, 3, 6, 9].map((x) => N(x, 3));
        for (let k = 0; k < 3; k++) { E(B[k], B[k + 1], g); E(T[k], T[k + 1], g); }
        for (let k = 0; k < 4; k++) E(B[k], T[k], g);
        E(B[0], T[1], g); E(B[2], T[3], g);
        setSupport(B[0], 'pin'); setSupport(B[3], 'rollerX');
        load(B[1], 0, -20e3); load(B[2], 0, -20e3);
        break;
      }
      default: return emptyModel();
    }
    return M;
  }

  /* =====================================================================
   * 4. Solver input
   * ===================================================================== */
  const ZERO_LOAD = Object.freeze({ fx: 0, fy: 0 }), ZERO_SETTLEMENT = Object.freeze({ dx: 0, dy: 0 });
  /**
   * Builds the input for FEA.analyze() from a model. It never changes the model: every object it returns
   * is new. It analyses one action state: opts.combination, else opts.loadCase, else the active state (the
   * active combination, or the active case). A combination's actions are F = Σ γᵢ·Fᵢ and u_s = Σ γᵢ·u_s,ᵢ.
   * The load factor λ (opts.loadFactor, default 1) then multiplies every action of that state once: nodal
   * loads and prescribed settlements alike, so a combination gives λ·Σ γᵢ·Fᵢ. A settlement is passed along the
   * support frame axes x′, y′, and only on a fixed axis. The model is linear, so u(λ) = λ·u(1); λ = 0 is the
   * zero-action state. opts.targetSF is passed to the solver when given.
   */
  function toAnalysisInput(model, opts) {
    const o = opts || {};
    const lf = o.loadFactor === undefined ? 1 : o.loadFactor;
    const lc = o.combination || o.loadCase || caseOf(model);
    const loads = caseLoads(model, lc); // the self-weight case and combinations: computed now
    const settlements = caseSettlements(model, lc);
    const idx = new Map(model.nodes.map((n, i) => [n, i]));
    const options = {};
    if (o.targetSF !== undefined) options.targetSF = o.targetSF;
    return {
      nodes: model.nodes.map((n) => {
        const L = loads.get(n) || ZERO_LOAD, S = settlements.get(n) || ZERO_SETTLEMENT, r = supportRestraint(n.support);
        return { x: n.x, y: n.y, fx: L.fx * lf, fy: L.fy * lf, fixX: r.fixX, fixY: r.fixY, angle: r.angle, dx: r.fixX ? S.dx * lf : 0, dy: r.fixY ? S.dy * lf : 0 };
      }),
      members: model.members.map((e) => ({ i: idx.get(e.n1), j: idx.get(e.n2), E: e.group.material.E, A: e.group.A, I: e.group.I, fy: e.group.material.fy })),
      options,
    };
  }

  /**
   * Solves one combination directly: FEA.analyze() on its complete action state λ·Σ γᵢ·Fᵢ, λ·Σ γᵢ·u_s,ᵢ. It works
   * for any combination, active or not, and changes nothing in the model. opts: { loadFactor, targetSF }.
   */
  function analyzeCombination(model, comb, opts) {
    return FEA.analyze(toAnalysisInput(model, Object.assign({}, opts, { combination: comb, loadCase: undefined })));
  }
  /** Every combination, each solved on its own: [{ combination, result }], with one complete result per combination. */
  function analyzeCombinations(model, opts) {
    return model.combinations.map((c) => ({ combination: c, result: analyzeCombination(model, c, opts) }));
  }
  /**
   * The worst governing values over the combinations' results (design-conventions §3): for every member its lowest
   * SF, its largest tension and its largest compression, each with the combination that produces it, and the lowest
   * SF of all. Every value is read from one combination's own result; nothing is added, averaged or otherwise combined
   * across combinations. A combination that could not be solved (unstable or invalid) is listed in `unsolved`: then no
   * statement covers every combination, and `complete` is false.
   */
  function combinationEnvelope(model, runs) {
    const solved = runs.filter((x) => x.result && x.result.ok);
    const members = model.members.map((e, k) => {
      let minSF = null, maxTension = null, maxCompression = null;
      for (const { combination, result } of solved) {
        const m = result.members[k];
        if (!minSF || m.sf < minSF.value) minSF = { value: m.sf, governs: m.governs, combination };
        if (m.force > 0 && (!maxTension || m.force > maxTension.value)) maxTension = { value: m.force, combination };
        if (m.force < 0 && (!maxCompression || m.force < maxCompression.value)) maxCompression = { value: m.force, combination };
      }
      return { minSF, maxTension, maxCompression };
    });
    let governing = null;
    members.forEach((x, k) => {
      if (x.minSF && (!governing || x.minSF.value < governing.value)) governing = { value: x.minSF.value, member: k, governs: x.minSF.governs, combination: x.minSF.combination };
    });
    const unsolved = runs.filter((x) => !(x.result && x.result.ok)).map((x) => x.combination);
    return { members, governing, solved: solved.map((x) => x.combination), unsolved, complete: solved.length > 0 && unsolved.length === 0 };
  }

  /* =====================================================================
   * 5. Saved sessions in browser storage
   *    The storage object ({ getItem, setItem, removeItem }) is passed in, so this stays free of the DOM
   *    and can be tested with a stand-in that fails on purpose.
   * ===================================================================== */
  const SESSION_KEYS = Object.freeze({ v2: 'trusslab.session.v2', v1: 'trusslab.session.v1', backup: 'trusslab.session.v2.unreadable' });
  const SMOKE_SESSION_KEYS = Object.freeze({ v2: 'trusslab.smoke-test.session.v2', v1: 'trusslab.smoke-test.session.v1', backup: 'trusslab.smoke-test.session.v2.unreadable' });
  const MAX_BACKUPS = 20;
  const backupKey = (keys, n) => (n === 1 ? keys.backup : `${keys.backup}.${n}`);
  const errText = (e) => (e && e.message ? e.message : String(e));
  /** Reads a key: { ok: true, value } (value null when the key does not exist) or { ok: false, error } when the read
   *  itself failed. The two must never be confused: a session that could not be read may still exist. */
  function readKey(storage, key) {
    try { return { ok: true, value: storage.getItem(key) }; } catch (e) { return { ok: false, error: errText(e) }; }
  }
  const present = (v) => v !== null && v !== undefined;

  /**
   * Import notes ({ msg, ref? }) as kept with a saved session: plain copies, without duplicates or malformed entries,
   * at most 200. A link to a node or member the model does not have is removed (the note itself is kept).
   */
  function cleanNotes(list, model) {
    const out = [], seen = new Set();
    if (!Array.isArray(list)) return out;
    for (const n of list) {
      if (!n || typeof n !== 'object' || typeof n.msg !== 'string' || !n.msg) continue;
      const note = { msg: n.msg.slice(0, 500) };
      const r = n.ref, items = r && (r.type === 'node' ? model.nodes : r.type === 'member' ? model.members : null);
      if (items && Number.isInteger(r.index) && r.index >= 0 && r.index < items.length) note.ref = { type: r.type, index: r.index };
      const key = JSON.stringify(note);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(note);
      if (out.length >= 200) break;
    }
    return out;
  }

  /** A stored session as { model, settings, view, fromVersion, notes }, or null when it cannot be read. Its notes are
   *  the import notes saved with it, followed by any from reading the stored model itself. */
  function parseSession(raw) {
    if (typeof raw !== 'string') return null;
    try {
      const obj = JSON.parse(raw);
      const r = readModel(obj);
      const part = (v) => (v && typeof v === 'object' ? v : null);
      const kept = Array.isArray(obj.importNotes) ? obj.importNotes : [];
      return { model: r.model, settings: part(obj.settings), view: part(obj.view), fromVersion: r.fromVersion, notes: cleanNotes(kept.concat(r.notes), r.model) };
    } catch (e) { return null; }
  }

  /**
   * Copies an unreadable stored session to keys.backup, or to keys.backup + '.2', '.3', … when an earlier
   * backup holds different data, then reads the copy back. An existing backup is never overwritten.
   * Returns { ok, key } or { ok: false, error }.
   */
  function backupUnreadable(storage, keys, raw) {
    for (let n = 1; n <= MAX_BACKUPS; n++) {
      const key = backupKey(keys, n);
      const existing = readKey(storage, key);
      if (!existing.ok) return { ok: false, error: `the backup could not be checked (${existing.error})` };
      if (existing.value === raw) return { ok: true, key };
      if (present(existing.value)) continue;
      try { storage.setItem(key, raw); } catch (e) { return { ok: false, error: `the backup could not be written (${errText(e)})` }; }
      const back = readKey(storage, key);
      if (!back.ok) return { ok: false, error: `the backup could not be read back (${back.error})` };
      return back.value === raw ? { ok: true, key } : { ok: false, error: 'the backup did not read back unchanged' };
    }
    return { ok: false, error: `there are already ${MAX_BACKUPS} backups of unreadable sessions` };
  }

  /**
   * Start-up. Prefers a readable version 2 session (a stale version 1 session is then left alone and not even read).
   * Otherwise reads a version 1 session and migrates it in memory, keeping its settings and view. Deletes nothing.
   * An unreadable version 2 session is backed up first; if the backup fails, `corruptV2` holds it and
   * saveStoredSession will not overwrite it until a backup succeeds.
   * A read that throws is not a missing session: the key goes into `readFailed`, nothing more is loaded (if the
   * version 2 read failed, a version 1 session must not be migrated over a version 2 session that may exist), and
   * saveStoredSession then writes nothing until the next start.
   * Returns { source: 'v2' | 'v1' | 'none', model, settings, view, notes, migrationPending, corruptV2, backup, readFailed }.
   */
  function loadStoredSession(storage, keys) {
    const out = { source: 'none', model: null, settings: null, view: null, notes: [], migrationPending: false, corruptV2: null, backup: null, readFailed: [] };
    if (!storage) return out;
    const r2 = readKey(storage, keys.v2);
    if (!r2.ok) { out.readFailed.push(keys.v2); return out; }
    if (present(r2.value)) {
      const s = parseSession(r2.value);
      if (s) return Object.assign(out, { source: 'v2', model: s.model, settings: s.settings, view: s.view, notes: s.notes });
      out.backup = backupUnreadable(storage, keys, r2.value);
      if (!out.backup.ok) out.corruptV2 = r2.value;
    }
    const r1 = readKey(storage, keys.v1);
    if (!r1.ok) { out.readFailed.push(keys.v1); return out; }
    if (present(r1.value)) {
      const s = parseSession(r1.value);
      if (s) return Object.assign(out, { source: 'v1', model: s.model, settings: s.settings, view: s.view, notes: s.notes, migrationPending: true });
    }
    return out;
  }

  /**
   * Writes the session { model, settings, view, importNotes } under keys.v2, then reads it back. The write is verified
   * only if the text reads back exactly as written and rebuilds the same model (read with readModel, serialised again,
   * compared). Only after a verified write, and only while a version 1 migration is pending, is keys.v1 removed, so the
   * only recoverable copy is never deleted. Import notes are stored beside the model (as `importNotes`, only when there are any), not inside it.
   * `status` ({ migrationPending, corruptV2, readFailed }) is updated in place. Returns { saved: false, stage, error }
   * with stage 'read' (a stored session could not be read at start-up, so nothing is written), 'backup', 'write' or
   * 'verify', or { saved: true, legacy } with legacy 'removed', 'failed' (the old key could not be removed; retried on
   * the next save) or 'not-needed'.
   */
  function saveStoredSession(storage, keys, session, status) {
    if (!storage) return { saved: false, stage: 'write', error: 'browser storage is not available' };
    if (status.readFailed && status.readFailed.length) {
      return { saved: false, stage: 'read', error: 'a saved session could not be read when TrussLab started, so nothing is written until the page is reloaded' };
    }
    if (present(status.corruptV2)) {
      const b = backupUnreadable(storage, keys, status.corruptV2);
      if (!b.ok) return { saved: false, stage: 'backup', error: b.error };
      status.corruptV2 = null;
    }
    const data = { model: serialize(session.model), settings: session.settings, view: session.view };
    const notes = cleanNotes(session.importNotes, session.model);
    if (notes.length) data.importNotes = notes;
    const text = JSON.stringify(data);
    try { storage.setItem(keys.v2, text); } catch (e) { return { saved: false, stage: 'write', error: errText(e) }; }
    const back = readKey(storage, keys.v2);
    if (!back.ok) return { saved: false, stage: 'verify', error: `the saved session could not be read back (${back.error})` };
    if (back.value !== text) return { saved: false, stage: 'verify', error: 'the saved session did not read back unchanged' };
    // the text came back unchanged; it must also rebuild the same model, since the reader normalises some values
    const restored = parseSession(back.value);
    if (!restored) return { saved: false, stage: 'verify', error: 'the saved session could not be read back as a model' };
    if (JSON.stringify(serialize(restored.model)) !== JSON.stringify(data.model)) {
      return { saved: false, stage: 'verify', error: 'the saved session does not read back as the same model' };
    }
    if (!status.migrationPending) return { saved: true, legacy: 'not-needed' };
    try { storage.removeItem(keys.v1); } catch (e) { return { saved: true, legacy: 'failed', error: errText(e) }; }
    status.migrationPending = false;
    return { saved: true, legacy: 'removed' };
  }

  return Object.freeze({
    // units (SI) and the expression parser
    GPA, MPA, MM, MM2, MM4, D2R, parseExpr, evalNum,
    // materials, sections, model objects, supports
    MATERIAL_PRESETS, FIR_NOTE, GROUP_COLORS, SHAPES, sectionProps,
    makeMaterial, makeGroup, makeNode, makeMember, emptyModel,
    SUPPORT_TYPES, SUPPORT_SHORT, setSupport, supportRestraint,
    // load cases: nodal loads and prescribed settlements
    makeLoadCase, addLoadCase, removeLoadCase, setActiveLoadCase, removeNodeActions,
    nodeLoad, setNodeLoad, nodeSettlement, setNodeSettlement, modelHasSettlement, caseLoads,
    // self-weight: material density and the generated dead-load case
    GRAVITY, SELF_WEIGHT, validDensity, isGeneratedCase, memberSelfWeight, selfWeightLoads, selfWeightCase, addSelfWeightCase,
    selfWeightSummary,
    // load combinations (milestone 5): F = Σ γᵢ·Fᵢ, u_s = Σ γᵢ·u_s,ᵢ, each combination solved directly
    isCombination, makeCombination, addCombination, removeCombination, setActiveCombination, combinationFactor, setCombinationFactor,
    combinationLoads, combinationSettlements, caseSettlements, activeTarget, analyzeCombination, analyzeCombinations, combinationEnvelope,
    // design data (milestone 10): the reference-chord deflection criterion, optional in file format version 2
    setDeflectionCriterion, pruneDesign,
    // file format version 2 (reads version 1 too) and model checks
    FORMAT_VERSION, serialize, readModel, deserialize, validateModel,
    // example structures
    EXAMPLES, buildExample,
    // solver input
    toAnalysisInput,
    // saved sessions in browser storage
    SESSION_KEYS, SMOKE_SESSION_KEYS, loadStoredSession, saveStoredSession, backupUnreadable,
  });
});
