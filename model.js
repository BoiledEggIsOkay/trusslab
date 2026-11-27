/*!
 * model.js - DOM-free model layer of TrussLab (2D Truss FEA & Load Simulator).
 *
 * Units and the expression parser for numeric inputs, material presets, section shapes, the model
 * constructors, supports, file format version 1 (serialize / deserialize), the example structures,
 * and the step that turns a model into input for FEA.analyze(). Everything here is free of the DOM
 * and of UI state: it runs in browsers (global `TrussModel`), in Node.js (`require('./model.js')`)
 * and in JavaScriptCore (`load('model.js')`), always after fea-core.js.
 *
 * The code was moved out of script.js (sections 1 to 3 and buildInput) in milestone 2 without
 * changing its behaviour. Units: SI base units (m, N, Pa, m^2, m^4), angles in degrees.
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
  const MATERIAL_PRESETS = {
    steel: { name: 'Structural Steel', E: 200e9, fy: 250e6, color: '#94a3b8' },
    aluminum: { name: '6061-T6 Aluminum', E: 68.9e9, fy: 276e6, color: '#cbd5e1' },
    fir: { name: 'Douglas Fir Timber', E: 11e9, fy: 49.9e6, color: '#d6a86b' },
    custom: { name: 'Custom material', E: 100e9, fy: 200e6, color: '#a78bfa' },
  };
  const FIR_NOTE = 'Timber has no yield point: the limit is the clear-wood compressive strength ∥ grain, 12% MC (USDA Wood Handbook, coast Douglas-fir). Graded-lumber design values are much lower.';
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
    return Object.assign({ uid: newUid(), preset: MATERIAL_PRESETS[key] ? key : 'custom', name: p.name, E: p.E, fy: p.fy, color: p.color }, over || {});
  }
  function makeGroup(name, material, shape, color, A, I) {
    const g = { uid: newUid(), name, material, shape: Object.assign({ type: 'custom' }, shape || {}), color: color || GROUP_COLORS[0], A: A || 0, I: I || 0 };
    const sp = sectionProps(g.shape);
    if (sp) { g.A = sp.A; g.I = sp.I; } else g.shape = { type: 'custom' };
    return g;
  }
  function makeNode(x, y) {
    return { uid: newUid(), x, y, support: { type: 'none', angle: 0, fixX: false, fixY: false, dx: 0, dy: 0 }, load: { fx: 0, fy: 0 } };
  }
  const makeMember = (n1, n2, group) => ({ uid: newUid(), n1, n2, group });
  function emptyModel(title) {
    const steel = makeMaterial('steel'), alu = makeMaterial('aluminum'), fir = makeMaterial('fir');
    const g = makeGroup('Default: A 2000 mm²', steel, { type: 'custom' }, GROUP_COLORS[0], 2000 * MM2, 2.0e6 * MM4);
    return { title: title || 'Untitled truss', nodes: [], members: [], materials: [steel, alu, fir], groups: [g] };
  }

  const SUPPORT_TYPES = [
    ['none', 'None (free joint)'],
    ['pin', 'Pin (ux = uy = 0)'],
    ['rollerX', 'Roller (uy = 0)'],
    ['rollerY', 'Roller (ux = 0)'],
    ['inclined', 'Inclined roller (un = 0)'],
    ['custom', 'Custom / prescribed δ'],
  ];
  const SUPPORT_SHORT = { none: 'Free', pin: 'Pin', rollerX: 'Roller uy=0', rollerY: 'Roller ux=0', inclined: 'Incl. roller', custom: 'Custom' };
  function setSupport(node, type, angle) {
    const s = node.support;
    s.type = type;
    const reset = (fx, fy, a) => { s.fixX = fx; s.fixY = fy; s.angle = a; s.dx = 0; s.dy = 0; };
    switch (type) {
      case 'pin': reset(true, true, 0); break;
      case 'rollerX': reset(false, true, 0); break;
      case 'rollerY': reset(true, false, 0); break;
      case 'inclined': reset(false, true, Number.isFinite(angle) ? angle : (s.angle || 30)); break;
      case 'custom':
        if (!s.fixX && !s.fixY) { s.fixX = true; s.fixY = true; }
        if (Number.isFinite(angle)) s.angle = angle;
        s.dx = s.dx || 0; s.dy = s.dy || 0;
        break;
      default: s.type = 'none'; reset(false, false, 0);
    }
  }
  const supportDOF = (s) => ({ fixX: !!s.fixX, fixY: !!s.fixY, angle: s.angle || 0, dx: s.fixX ? s.dx || 0 : 0, dy: s.fixY ? s.dy || 0 : 0 });

  /* ---------- (de)serialisation: SI units, 1-based ids ---------- */
  function serialize(model) {
    const mi = new Map(model.materials.map((m, i) => [m, i + 1]));
    const gi = new Map(model.groups.map((g, i) => [g, i + 1]));
    const ni = new Map(model.nodes.map((n, i) => [n, i + 1]));
    return {
      format: 'trusslab-model', version: 1,
      units: { length: 'm', force: 'N', stress: 'Pa', area: 'm^2', inertia: 'm^4', angle: 'deg' },
      title: model.title,
      materials: model.materials.map((m, i) => ({ id: i + 1, name: m.name, preset: m.preset, E: m.E, fy: m.fy, color: m.color })),
      sections: model.groups.map((g, i) => ({ id: i + 1, name: g.name, material: mi.get(g.material), A: g.A, I: g.I, shape: Object.assign({}, g.shape), color: g.color })),
      nodes: model.nodes.map((n, i) => ({ id: i + 1, x: n.x, y: n.y, support: Object.assign({}, n.support), load: Object.assign({}, n.load) })),
      members: model.members.map((e, i) => ({ id: i + 1, n1: ni.get(e.n1), n2: ni.get(e.n2), section: gi.get(e.group) })),
    };
  }
  function deserialize(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('the file is not a JSON object');
    if (obj.model && Array.isArray(obj.model.nodes)) obj = obj.model; // calculation report files
    if (!Array.isArray(obj.nodes) || !Array.isArray(obj.members)) throw new Error('missing "nodes" or "members" arrays');
    const fin = (v, d) => (v !== null && v !== '' && Number.isFinite(+v) ? +v : d);
    const matsIn = Array.isArray(obj.materials) && obj.materials.length ? obj.materials : [{ preset: 'steel' }];
    const materials = matsIn.map((m) => {
      const key = MATERIAL_PRESETS[m.preset] ? m.preset : 'custom', p = MATERIAL_PRESETS[key];
      const E = fin(m.E, p.E), fy = fin(m.fy, p.fy);
      return makeMaterial(key, { name: String(m.name || p.name).slice(0, 80), E: E > 0 ? E : p.E, fy: fy > 0 ? fy : p.fy, color: /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : p.color });
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
      if (type === 'custom') Object.assign(nd.support, { type, fixX: !!s.fixX, fixY: !!s.fixY, angle: fin(s.angle, 0), dx: fin(s.dx, 0), dy: fin(s.dy, 0) });
      else setSupport(nd, type, fin(s.angle, 30));
      nd.load.fx = fin(n.load && n.load.fx, 0);
      nd.load.fy = fin(n.load && n.load.fy, 0);
      return nd;
    });
    const members = obj.members.map((e, k) => {
      const a = nodes[fin(e.n1, 0) - 1], b = nodes[fin(e.n2, 0) - 1];
      if (!a || !b || a === b) throw new Error(`member ${k + 1} references invalid nodes`);
      return makeMember(a, b, groups[fin(e.section !== undefined ? e.section : e.group, 1) - 1] || groups[0]);
    });
    return { title: String(obj.title || 'Imported truss').slice(0, 120), nodes, members, materials, groups };
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
    const load = (n, fx, fy) => { n.load.fx = fx; n.load.fy = fy; };
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
        Object.assign(B[4].support, { type: 'custom', fixX: false, fixY: true, angle: 0, dx: 0, dy: -10 * MM });
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
  /**
   * Builds the input for FEA.analyze() from a model. It never changes the model: every object it
   * returns is new. opts.loadFactor (λ, default 1) multiplies the nodal loads; opts.targetSF is passed
   * to the solver when given. TEMPORARY until milestone 3: prescribed settlements (support dx, dy) are
   * passed unscaled, so λ does not scale them. Milestone 3 makes λ scale loads and settlements alike.
   */
  function toAnalysisInput(model, opts) {
    const o = opts || {};
    const lf = o.loadFactor === undefined ? 1 : o.loadFactor;
    const idx = new Map(model.nodes.map((n, i) => [n, i]));
    const options = {};
    if (o.targetSF !== undefined) options.targetSF = o.targetSF;
    return {
      nodes: model.nodes.map((n) => Object.assign({ x: n.x, y: n.y, fx: n.load.fx * lf, fy: n.load.fy * lf }, supportDOF(n.support))),
      members: model.members.map((e) => ({ i: idx.get(e.n1), j: idx.get(e.n2), E: e.group.material.E, A: e.group.A, I: e.group.I, fy: e.group.material.fy })),
      options,
    };
  }

  return Object.freeze({
    // units (SI) and the expression parser
    GPA, MPA, MM, MM2, MM4, D2R, parseExpr, evalNum,
    // materials, sections, model objects, supports
    MATERIAL_PRESETS, FIR_NOTE, GROUP_COLORS, SHAPES, sectionProps,
    makeMaterial, makeGroup, makeNode, makeMember, emptyModel,
    SUPPORT_TYPES, SUPPORT_SHORT, setSupport, supportDOF,
    // file format version 1
    serialize, deserialize,
    // example structures
    EXAMPLES, buildExample,
    // solver input
    toAnalysisInput,
  });
});
