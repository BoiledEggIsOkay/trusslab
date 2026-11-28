/*
 * Headless tests for model.js (global TrussModel): the expression parser, section properties, the
 * model constructors, supports, load cases, file format version 2 and the import of version 1 (model
 * files, autosaved sessions and report files), model warnings, saved-session storage, the solver input,
 * and the nine example structures. Run from the project folder:
 *
 *   node test/model.test.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/model.test.js
 *
 * The process exits with a non-zero code if any check fails.
 */
'use strict';

const NODE = typeof require === 'function';
const FEA = NODE ? require('../fea-core.js') : (load('fea-core.js'), globalThis.FEA);
const TM = NODE ? require('../model.js') : (load('model.js'), globalThis.TrussModel);
const BASELINE = NODE ? require('./fixtures/examples-baseline.js') : (load('test/fixtures/examples-baseline.js'), globalThis.TrussLabExampleBaseline);
const readText = (p) => (NODE ? require('fs').readFileSync(require('path').join(__dirname, '..', p), 'utf8') : readFile(p));
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
function throws(name, fn, pattern) {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  check(name, msg !== null && pattern.test(msg), msg === null ? 'did not throw' : `threw "${msg}"`);
}
/** Every element within tol × (largest |want|) of the reference: robust for near-zero entries. */
function closeArray(name, got, want, tol) {
  if (!Array.isArray(got) || got.length !== want.length) { check(name, false, `length ${got && got.length}, expected ${want.length}`); return; }
  const scale = Math.max(...want.map(Math.abs)) || 1;
  const bad = got.findIndex((g, i) => !(Math.abs(g - want[i]) <= tol * scale));
  check(name, bad < 0, bad < 0 ? '' : `entry ${bad + 1}: got ${got[bad]}, expected ${want[bad]}`);
}
/** Runs one group of checks; an exception counts as a failure instead of stopping the suite. */
function testCase(title, fn) {
  try { fn(); } catch (err) { failures.push(`${title}: threw ${err}`); out(`FAIL  ${title}: threw ${err}`); }
}
const analyse = (m, opts) => FEA.analyze(TM.toAnalysisInput(m, opts || { loadFactor: 1, targetSF: 1.5 }));

testCase('Loading and API', () => {
  check('TrussModel is an object and is frozen', typeof TM === 'object' && Object.isFrozen(TM));
  const want = ['GPA', 'MPA', 'MM', 'MM2', 'MM4', 'D2R', 'parseExpr', 'evalNum', 'MATERIAL_PRESETS', 'FIR_NOTE', 'GROUP_COLORS', 'SHAPES',
    'sectionProps', 'makeMaterial', 'makeGroup', 'makeNode', 'makeMember', 'emptyModel', 'SUPPORT_TYPES', 'SUPPORT_SHORT', 'setSupport',
    'supportRestraint', 'makeLoadCase', 'addLoadCase', 'removeLoadCase', 'setActiveLoadCase', 'removeNodeActions', 'nodeLoad', 'setNodeLoad',
    'nodeSettlement', 'setNodeSettlement', 'modelHasSettlement', 'FORMAT_VERSION', 'serialize', 'readModel', 'deserialize', 'validateModel',
    'EXAMPLES', 'buildExample', 'toAnalysisInput', 'SESSION_KEYS', 'SMOKE_SESSION_KEYS', 'loadStoredSession', 'saveStoredSession', 'backupUnreadable',
    'caseLoads', 'GRAVITY', 'SELF_WEIGHT', 'validDensity', 'isGeneratedCase', 'memberSelfWeight', 'selfWeightLoads', 'selfWeightCase', 'addSelfWeightCase',
    'selfWeightSummary', 'isCombination', 'makeCombination', 'addCombination', 'removeCombination', 'setActiveCombination', 'combinationFactor',
    'setCombinationFactor', 'combinationLoads', 'combinationSettlements', 'caseSettlements', 'activeTarget', 'analyzeCombination', 'analyzeCombinations',
    'combinationEnvelope'];
  const missing = want.filter((k) => !(k in TM));
  check('TrussModel exports the whole model API', missing.length === 0, `missing ${missing.join(', ')}`);
  check('model.js loaded and works with no DOM present', typeof document === 'undefined' && typeof TM.buildExample('aframe') === 'object');
  const code = readText('model.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  const dom = code.match(/\b(document|window|localStorage|sessionStorage|location|navigator|requestAnimationFrame|alert|confirm)\b/g);
  check('model.js source uses no browser objects', !dom, dom && [...new Set(dom)].join(', '));
  check('model.js has no ES module syntax', !/^\s*(import|export)\b/m.test(code));
});

testCase('Units (SI base units)', () => {
  check('GPa, MPa, mm, mm² and mm⁴ conversion factors', TM.GPA === 1e9 && TM.MPA === 1e6 && TM.MM === 1e-3 && TM.MM2 === 1e-6 && TM.MM4 === 1e-12);
  check('degrees to radians', TM.D2R === Math.PI / 180);
});

testCase('Expression parser', () => {
  const p = TM.parseExpr;
  check('precedence: 1+2*3 = 7, (1+2)*3 = 9', p('1+2*3') === 7 && p('(1+2)*3') === 9);
  check('power is right-associative and binds tighter than unary minus: 2^3^2 = 512, -2^2 = -4', p('2^3^2') === 512 && p('-2^2') === -4);
  check('unary signs: 2*-3 = -6, --4 = 4, +5 = 5', p('2*-3') === -6 && p('--4') === 4 && p('+5') === 5);
  check('number forms: 1e3, 2.5E-3, .5, 5.', p('1e3') === 1000 && p('2.5E-3') === 0.0025 && p('.5') === 0.5 && p('5.') === 5);
  check('typed symbols: decimal comma, − minus, × times, π', p('2,5') === 2.5 && p('3−1') === 2 && p('2×4') === 8 && p('π') === Math.PI);
  check('constants pi and e, names are case-insensitive', p('pi*2') === 2 * Math.PI && p('e') === Math.E && p('PI') === Math.PI && p('SQRT(4)') === 2);
  check('sqrt, abs, exp, ln, log (base 10)', p('sqrt(16)') === 4 && p('abs(-3)') === 3 && p('exp(1)') === Math.E && p('ln(e)') === 1 && p('log(1000)') === 3);
  check('trigonometry in degrees, exact at 30°, 45°, 60°, 90°', p('sin(30)') === 0.5 && p('cos(60)') === 0.5 && p('tan(45)') === 1 && p('cos(90)') === 0 && p('sin(-90)') === -1);
  near('asin(0.5) = 30° (degrees)', p('asin(0.5)'), 30, 1e-15);
  near('acos(0.5) = 60° (degrees)', p('acos(0.5)'), 60, 1e-15);
  check('atan(1) = 45°', p('atan(1)') === 45);
  check('worked inputs: 10*cos(30), 2*sqrt(3), 12/7, surrounding spaces',
    p('10*cos(30)') === 10 * Math.sqrt(3) / 2 && p('2*sqrt(3)') === 2 * Math.sqrt(3) && p('12/7') === 12 / 7 && p(' 7 ') === 7);
  throws('empty input is rejected', () => p('   '), /empty/);
  throws('a trailing operator is rejected', () => p('2+'), /unexpected end/);
  throws('a missing ) is rejected', () => p('(1'), /missing \)/);
  throws('an extra ) is rejected', () => p('1)'), /unexpected \)/);
  throws('an unknown function name is rejected', () => p('foo(2)'), /unknown name foo/);
  throws('a function without parentheses is rejected', () => p('sqrt 4'), /\( expected/);
  throws('two numbers without an operator are rejected', () => p('2 3'), /unexpected 3/);
  check('evalNum returns NaN for invalid or non-finite input', [TM.evalNum('2+'), TM.evalNum('1/0'), TM.evalNum('0/0'), TM.evalNum('')].every(Number.isNaN));
  check('evalNum returns the value for valid input', TM.evalNum('2*sqrt(3)') === 2 * Math.sqrt(3));
});

testCase('Section properties (weak-axis I, sharp corners)', () => {
  const sp = TM.sectionProps, P = Math.PI;
  const rod = sp({ type: 'rod', d: 0.02 });
  near('solid round: A = πd²/4', rod.A, P * 0.02 ** 2 / 4, 1e-15);
  near('solid round: I = πd⁴/64', rod.I, P * 0.02 ** 4 / 64, 1e-15);
  const chs = sp({ type: 'chs', D: 0.1397, t: 0.0063 }), di = 0.1397 - 2 * 0.0063;
  near('CHS 139.7×6.3: A = π(D² − d²)/4', chs.A, P / 4 * (0.1397 ** 2 - di ** 2), 1e-14);
  near('CHS 139.7×6.3: I = π(D⁴ − d⁴)/64', chs.I, P / 64 * (0.1397 ** 4 - di ** 4), 1e-14);
  const r1 = sp({ type: 'rect', b: 0.075, h: 0.2 }), r2 = sp({ type: 'rect', b: 0.2, h: 0.075 });
  near('rectangle 75×200: A = bh', r1.A, 0.015, 1e-15);
  near('rectangle 75×200: I about the weak axis = h·b³/12', r1.I, 0.2 * 0.075 ** 3 / 12, 1e-14);
  check('rectangle: the weak axis is used whichever way round b and h are given', r1.I === r2.I);
  const rhs = sp({ type: 'rhs', b: 0.1, h: 0.06, t: 0.004 });
  near('RHS 100×60×4: A = bh − (b−2t)(h−2t)', rhs.A, 0.1 * 0.06 - 0.092 * 0.052, 1e-14);
  near('RHS 100×60×4: weak-axis I', rhs.I, Math.min(0.1 * 0.06 ** 3 - 0.092 * 0.052 ** 3, 0.06 * 0.1 ** 3 - 0.052 * 0.092 ** 3) / 12, 1e-14);
  check('invalid dimensions give null (zero size, wall too thick)',
    sp({ type: 'rod', d: 0 }) === null && sp({ type: 'chs', D: 0.01, t: 0.006 }) === null && sp({ type: 'rect', b: 0, h: 1 }) === null && sp({ type: 'rhs', b: 0.1, h: 0.1, t: 0.05 }) === null);
  check('CHS with 2t = D (a solid bar) is accepted', sp({ type: 'chs', D: 0.01, t: 0.005 }) !== null);
  check('custom, unknown and missing shapes give null', sp({ type: 'custom' }) === null && sp({ type: 'nope' }) === null && sp(null) === null && sp(undefined) === null);
});

testCase('Model constructors', () => {
  const n = TM.makeNode(1.5, -2);
  same('makeNode: coordinates and a free support (loads and settlements live in load cases)',
    { x: n.x, y: n.y, support: n.support, load: n.load }, { x: 1.5, y: -2, support: { type: 'none', angle: 0, fixX: false, fixY: false } });
  const steel = TM.makeMaterial('steel'), fir = TM.makeMaterial('fir'), odd = TM.makeMaterial('unobtainium');
  check('makeMaterial: steel preset E 200 GPa, σy 250 MPa', steel.preset === 'steel' && steel.E === 200e9 && steel.fy === 250e6);
  check('makeMaterial: Douglas fir limit stress 49.9 MPa', fir.E === 11e9 && fir.fy === 49.9e6);
  check('makeMaterial: an unknown preset becomes custom', odd.preset === 'custom' && odd.E === 100e9 && odd.fy === 200e6);
  const g = TM.makeGroup('CHS', steel, { type: 'chs', D: 0.1, t: 0.005 }, '#123456');
  check('makeGroup: A and I come from the shape', g.A === TM.sectionProps(g.shape).A && g.I === TM.sectionProps(g.shape).I && g.material === steel);
  const bad = TM.makeGroup('bad', steel, { type: 'chs', D: 0.01, t: 0.02 }, null, 2e-3, 3e-6);
  check('makeGroup: an invalid shape becomes custom and keeps the given A and I', bad.shape.type === 'custom' && bad.A === 2e-3 && bad.I === 3e-6 && bad.color === TM.GROUP_COLORS[0]);
  const a = TM.makeNode(0, 0), b = TM.makeNode(1, 0), e = TM.makeMember(a, b, g);
  check('makeMember links two nodes and a section group', e.n1 === a && e.n2 === b && e.group === g);
  const uids = [a.uid, b.uid, e.uid, g.uid, steel.uid];
  check('every object gets a new uid', new Set(uids).size === uids.length);
  const m = TM.emptyModel();
  check('emptyModel: untitled, no nodes or members, 3 materials (steel, aluminium, fir)',
    m.title === 'Untitled truss' && m.nodes.length === 0 && m.members.length === 0 && m.materials.map((x) => x.preset).join() === 'steel,aluminum,fir');
  check('emptyModel: one default section, A 2000 mm², I 2×10⁶ mm⁴, steel', m.groups.length === 1 && m.groups[0].A === 2000 * TM.MM2 && m.groups[0].I === 2e6 * TM.MM4 && m.groups[0].material === m.materials[0]);
  check('emptyModel: one empty load case, "Load case 1", which is active',
    m.loadCases.length === 1 && m.loadCases[0].name === 'Load case 1' && m.activeCase === m.loadCases[0] && m.loadCases[0].loads.size === 0 && m.loadCases[0].settlements.size === 0);
});

testCase('Supports', () => {
  const sup = (type, angle) => { const n = TM.makeNode(0, 0); TM.setSupport(n, type, angle); const s = n.support; return [s.type, s.fixX, s.fixY, s.angle]; };
  same('pin restrains x and y', sup('pin'), ['pin', true, true, 0]);
  same('rollerX restrains y only', sup('rollerX'), ['rollerX', false, true, 0]);
  same('rollerY restrains x only', sup('rollerY'), ['rollerY', true, false, 0]);
  same('inclined restrains y′ at the given angle', sup('inclined', 40), ['inclined', false, true, 40]);
  same('inclined with no angle given keeps the current frame angle, 0° included (a new node has α = 0°)', sup('inclined'), ['inclined', false, true, 0]);
  same('custom with nothing fixed fixes both axes', sup('custom'), ['custom', true, true, 0]);
  same('an unknown type becomes none', sup('magnet'), ['none', false, false, 0]);
  const m = TM.emptyModel(), n = TM.makeNode(0, 0);
  m.nodes.push(n);
  Object.assign(n.support, { type: 'custom', fixX: false, fixY: true, angle: 15 });
  TM.setNodeSettlement(m, n, 0.005, -0.01);
  TM.setSupport(n, 'custom');
  check('custom keeps its fixed axes', n.support.fixX === false && n.support.fixY === true && n.support.angle === 15);
  TM.setSupport(n, 'pin');
  same('changing the support type leaves the settlement in the load case untouched', TM.nodeSettlement(m, n), { dx: 0.005, dy: -0.01 });
  same('a support stores restraint geometry only', Object.keys(n.support), ['type', 'angle', 'fixX', 'fixY']);
  same('supportRestraint gives the fixed axes and the frame angle', TM.supportRestraint({ type: 'custom', fixY: true, angle: 15 }), { fixX: false, fixY: true, angle: 15 });
});

testCase('Changing the support type keeps the frame angle, 0° included', () => {
  /** setSupport(node, to) with no angle given, as the Inspector's type list calls it, from a support `from`. */
  const after = (from, to, angle) => { const n = TM.makeNode(0, 0); Object.assign(n.support, from); TM.setSupport(n, to, angle); return n.support; };
  const pick = (s) => [s.type, s.fixX, s.fixY, s.angle];
  // 1. α = 0° is a valid angle, not a missing one
  for (const t of ['none', 'pin', 'rollerX', 'rollerY']) {
    const n = TM.makeNode(0, 0); TM.setSupport(n, t); TM.setSupport(n, 'custom');
    same(`${t} (α = 0°) → custom: the frame stays at 0°`, pick(n.support), ['custom', t === 'none' || t === 'pin' || t === 'rollerY', t !== 'rollerY', 0]);
  }
  same('custom at α = 0°, fixed along y′ → inclined: stays at 0°', pick(after({ type: 'custom', fixX: false, fixY: true, angle: 0 }, 'inclined')), ['inclined', false, true, 0]);
  same('inclined at α = 0° → custom: stays at 0°, still fixed along y′ only', pick(after({ type: 'inclined', fixX: false, fixY: true, angle: 0 }, 'custom')), ['custom', false, true, 0]);
  // 2. a non-zero angle is kept, and an angle that is given explicitly still wins
  same('inclined at 45° → custom: keeps 45°, fixed along y′ only (the same restraint)', pick(after({ type: 'inclined', fixX: false, fixY: true, angle: 45 }, 'custom')), ['custom', false, true, 45]);
  same('custom at −20° → inclined: keeps −20°', pick(after({ type: 'custom', fixX: true, fixY: true, angle: -20 }, 'inclined')), ['inclined', false, true, -20]);
  same('an explicit angle is used: custom at 60°', pick(after({ type: 'pin', fixX: true, fixY: true, angle: 0 }, 'custom', 60)), ['custom', true, true, 60]);
  same('an explicit angle is used: inclined at 0°', pick(after({ type: 'inclined', fixX: false, fixY: true, angle: 45 }, 'inclined', 0)), ['inclined', false, true, 0]);
  same('pin, rollers and free joints always use α = 0°', ['pin', 'rollerX', 'rollerY', 'none'].map((t) => after({ type: 'inclined', fixX: false, fixY: true, angle: 45 }, t).angle), [0, 0, 0, 0]);
  // 3. a missing or invalid current angle gets the default: 30° for an inclined roller, 0° (the global axes) for a custom frame
  for (const bad of [undefined, null, NaN, Infinity]) {
    const label = String(bad);
    check(`current angle ${label} → inclined: 30°`, after({ type: 'none', fixX: false, fixY: false, angle: bad }, 'inclined').angle === 30);
    check(`current angle ${label} → custom: 0°`, after({ type: 'pin', fixX: true, fixY: true, angle: bad }, 'custom').angle === 0);
  }
  // 4. a settlement keeps its direction: it is stored along x′, y′, and the frame does not turn
  const frameInput = (m) => JSON.stringify(TM.toAnalysisInput(m));
  const a = TM.buildExample('aframe'), pin = a.nodes[0];
  TM.setNodeSettlement(a, pin, 0, -0.01); // 10 mm down, along y′ of the pin's frame (α = 0°: global y)
  const inA = frameInput(a), rA = analyse(a);
  TM.setSupport(pin, 'custom'); // as the Inspector's type list does
  check('pin with a settlement → custom: the solver input is unchanged', frameInput(a) === inA, frameInput(a));
  const rA2 = analyse(a);
  check('... so the node still settles straight down: u = (0, −10 mm) exactly', rA2.ok && rA2.nodes[0].ux === 0 && rA2.nodes[0].uy === -0.01 && rA.nodes[0].uy === -0.01);
  same('... and the settlement entry is untouched', TM.nodeSettlement(a, pin), { dx: 0, dy: -0.01 });
  const b = TM.buildExample('aframe'), n2 = b.nodes[1];
  b.members.push(TM.makeMember(b.nodes[0], n2, b.groups[0])); // a tie 1-2 keeps the truss stable with one pin
  TM.setSupport(n2, 'inclined', 45); // the second pin becomes a roller on a 45° surface
  TM.setNodeSettlement(b, n2, 0, -0.005); // 5 mm along y′, the normal of the 45° surface
  const inB = frameInput(b), rB = analyse(b);
  TM.setSupport(n2, 'custom');
  check('inclined roller at 45° with a settlement → custom: same frame, same restraint, same solver input', frameInput(b) === inB);
  const rB2 = analyse(b), [c45, s45] = FEA.util.cosSinDeg(45);
  check('... and the same results, exactly', rB.ok && rB2.ok && rB2.nodes.every((nd, i) => Object.is(nd.ux, rB.nodes[i].ux) && Object.is(nd.uy, rB.nodes[i].uy)) &&
    rB2.members.every((e, i) => Object.is(e.force, rB.members[i].force)));
  near('... the node moves −5 mm along the surface normal y′ = (−sin 45°, cos 45°)', -s45 * rB2.nodes[1].ux + c45 * rB2.nodes[1].uy, -0.005, 1e-12);
});

testCase('Serialisation (file format version 2)', () => {
  const m = TM.buildExample('inclined'), f = TM.serialize(m);
  same('header: format, version 2 and units', [f.format, f.version, f.units, TM.FORMAT_VERSION],
    ['trusslab-model', 2, { length: 'm', force: 'N', stress: 'Pa', area: 'm^2', inertia: 'm^4', angle: 'deg' }, 2]);
  same('top-level fields (milestone 5 added the optional combinations and activeCombination)', Object.keys(f),
    ['format', 'version', 'units', 'title', 'materials', 'sections', 'nodes', 'members', 'loadCases', 'activeLoadCase', 'combinations', 'activeCombination']);
  same('a model without combinations writes an empty list and no active combination', [f.combinations, f.activeCombination], [[], null]);
  check('ids are 1-based and sequential', [f.materials, f.sections, f.nodes, f.members, f.loadCases].every((list) => list.every((x, i) => x.id === i + 1)));
  same('the load case holds the nodal load, as a sparse entry', f.loadCases, [{ id: 1, name: 'Load case 1', loads: [{ node: 3, fx: 20e3, fy: -50e3 }], settlements: [] }]);
  check('the active load case is named by id', f.activeLoadCase === 1);
  const st = TM.serialize(TM.buildExample('settlement'));
  same('the settlement example: one load case with six loads and the 10 mm settlement along y′ of node 5',
    [st.loadCases.length, st.loadCases[0].loads.length, st.loadCases[0].settlements], [1, 6, [{ node: 5, dx: 0, dy: -0.01 }]]);
  check('load entries are in node order', st.loadCases[0].loads.every((e, i, a) => i === 0 || a[i - 1].node < e.node));
  {
    // deterministic: the same actions entered in another order are written identically, in node order
    const a = TM.buildExample('pratt'), b = TM.buildExample('pratt'), lcA = TM.addLoadCase(a, 'X'), lcB = TM.addLoadCase(b, 'X'), order = [6, 3, 9, 2, 7];
    for (const i of order) { TM.setNodeLoad(a, a.nodes[i], i, -i, lcA); TM.setNodeSettlement(a, a.nodes[i], 0, -i / 1000, lcA); }
    for (const i of order.slice().reverse()) { TM.setNodeLoad(b, b.nodes[i], i, -i, lcB); TM.setNodeSettlement(b, b.nodes[i], 0, -i / 1000, lcB); }
    const fa = TM.serialize(a);
    check('entries are written in node order whatever order they were entered in, so the output is the same',
      JSON.stringify(fa) === JSON.stringify(TM.serialize(b)) && fa.loadCases[1].loads.map((e) => e.node).join() === '3,4,7,8,10' && fa.loadCases[1].settlements.map((e) => e.node).join() === '3,4,7,8,10');
  }
  const z = TM.buildExample('aframe');
  TM.setNodeLoad(z, z.nodes[0], 0, 0);
  TM.setNodeSettlement(z, z.nodes[1], 0, 0);
  check('zero loads and settlements are not written', TM.serialize(z).loadCases[0].loads.length === 1 && TM.serialize(z).loadCases[0].settlements.length === 0);
  check('references are by id', f.members.every((e) => e.n1 >= 1 && e.n1 <= f.nodes.length && e.n2 >= 1 && e.n2 <= f.nodes.length && e.section >= 1 && e.section <= f.sections.length) &&
    f.sections.every((s) => s.material >= 1 && s.material <= f.materials.length));
  same('a node stores its position and support restraint only', f.nodes[1], { id: 2, x: 6, y: 0, support: { type: 'inclined', angle: 30, fixX: false, fixY: true } });
  check('serialize does not keep live references (a copy of the support)', f.nodes[1].support !== m.nodes[1].support);
  check('no session-only uids are saved', !JSON.stringify(f).includes('"uid"'));
  for (const [key] of TM.EXAMPLES) {
    const a = JSON.stringify(TM.serialize(TM.buildExample(key)));
    const b = JSON.stringify(TM.serialize(TM.deserialize(JSON.parse(a))));
    check(`round trip is exact: ${key}`, a === b);
  }
});

const V1_FILE = {
  format: 'trusslab-model', version: 1, units: { length: 'm', force: 'N', stress: 'Pa', area: 'm^2', inertia: 'm^4', angle: 'deg' },
  title: 'Test: format version 1',
  materials: [{ id: 1, name: 'Structural Steel', preset: 'steel', E: 200e9, fy: 250e6, color: '#94a3b8' }],
  sections: [{ id: 1, name: 'Bar', material: 1, A: 1e-3, I: 1e-6, shape: { type: 'custom' }, color: '#38bdf8' }],
  nodes: [
    { id: 1, x: 0, y: 0, support: { type: 'pin', angle: 0, fixX: true, fixY: true, dx: 0, dy: 0 }, load: { fx: 0, fy: 0 } },
    { id: 2, x: 6, y: 0, support: { type: 'pin', angle: 0, fixX: true, fixY: true, dx: 0, dy: 0 }, load: { fx: 0, fy: 0 } },
    { id: 3, x: 3, y: 4, support: { type: 'none', angle: 0, fixX: false, fixY: false, dx: 0, dy: 0 }, load: { fx: 0, fy: -100000 } },
  ],
  members: [{ id: 1, n1: 1, n2: 3, section: 1 }, { id: 2, n1: 2, n2: 3, section: 1 }],
};
const copy = (x) => JSON.parse(JSON.stringify(x));
/** V1_FILE with node 2 as a custom support in a frame at 30°, fixed along y′ and settling 10 mm along it. Its dx
 *  lies along x′, which is not fixed: kept, but without effect. A tie 1-2 keeps the truss stable. */
const V1_SETTLED = (() => {
  const f = copy(V1_FILE);
  f.title = 'Test: format version 1 with a settlement';
  f.nodes[1].support = { type: 'custom', angle: 30, fixX: false, fixY: true, dx: 0.002, dy: -0.01 };
  f.members.push({ id: 3, n1: 1, n2: 2, section: 1 });
  return f;
})();

testCase('Importing version 1: model files, autosaved sessions and report files', () => {
  const r1 = TM.readModel(copy(V1_FILE));
  check('version 1 is detected and converted, with no notes', r1.fromVersion === 1 && r1.notes.length === 0);
  same('its nodal load moves into "Load case 1", the active case', [r1.model.loadCases.length, r1.model.activeCase.name, TM.nodeLoad(r1.model, r1.model.nodes[2])],
    [1, 'Load case 1', { fx: 0, fy: -100000 }]);
  const settled = copy(V1_SETTLED);
  const wrappers = [['a model file', settled], ['a report file (model nested under "model")', { meta: { loadFactor: 1 }, model: settled, status: 'solved' }],
    ['an autosaved session', { model: settled, settings: { grid: 1 }, view: { cx: 1, cy: 2, zoom: 30 } }]];
  for (const [what, file] of wrappers) {
    const rr = TM.readModel(copy(file)), nd = rr.model.nodes[1];
    check(`${what}: the custom-support settlement moves into Load case 1 unchanged, along the support frame axes (α = 30°)`,
      rr.fromVersion === 1 && JSON.stringify(TM.nodeSettlement(rr.model, nd)) === JSON.stringify({ dx: 0.002, dy: -0.01 }) && nd.support.angle === 30 && nd.support.fixY && !nd.support.fixX);
  }
  const sm = TM.readModel(copy(settled)).model, sNode = sm.nodes[1];
  const sIn = TM.toAnalysisInput(sm, { loadFactor: 1, targetSF: 1.5 }).nodes[1];
  same('the solver receives the settlement in the support frame: dy along y′ at 30°, dx dropped because x′ is free',
    [sIn.angle, sIn.fixX, sIn.fixY, sIn.dx, sIn.dy], [30, false, true, 0, -0.01]);
  const sRes = analyse(sm);
  check('and the node moves exactly -10 mm along y′ (support-local), as in version 1', sRes.ok && sRes.nodes[1].uLocal[1] === -0.01);
  check('at λ = 2 it moves exactly -20 mm along y′', analyse(sm, { loadFactor: 2, targetSF: 1.5 }).nodes[1].uLocal[1] === -0.02);
  check('the frame angle is kept on the support', sNode.support.angle === 30);
  const plain = TM.deserialize(copy(V1_FILE));
  check('a version 1 file opens with its title, nodes and members', plain.title === V1_FILE.title && plain.nodes.length === 3 && plain.members.length === 2);
  const r = analyse(plain);
  near('and solves: member 1 carries -62.5 kN (closed form)', r.members[0].force, -62.5e3, 1e-14);
  const ref = JSON.stringify(TM.serialize(plain));
  const session = { model: copy(V1_FILE), settings: { grid: 1, forceUnit: 'kN' }, view: { cx: 0, cy: 0, zoom: 10 } };
  check('an autosaved session { model, settings, view } opens the same model', JSON.stringify(TM.serialize(TM.deserialize(session))) === ref);
  const report = { meta: { app: 'TrussLab' }, model: copy(V1_FILE), status: 'solved', errors: [], warnings: [], determinacy: null, diagnostics: {}, log: [], summary: {}, nodes: [], members: [] };
  check('an exported report file with the model nested under "model" opens the same model', JSON.stringify(TM.serialize(TM.deserialize(report))) === ref);
  const legacy = copy(V1_FILE);
  legacy.groups = legacy.sections; delete legacy.sections;
  legacy.members = legacy.members.map((e) => ({ n1: e.n1, n2: e.n2, group: e.section }));
  check('older files with "groups" and member "group" open the same model', JSON.stringify(TM.serialize(TM.deserialize(legacy))) === ref);
  const outer = { model: { nodes: 'not a list' }, nodes: copy(V1_FILE.nodes), members: copy(V1_FILE.members) };
  check('a "model" field without a node list is ignored, and the outer model is read', TM.deserialize(outer).nodes.length === 3);
  const before = JSON.stringify(report);
  TM.deserialize(report);
  check('deserialize does not modify its input', JSON.stringify(report) === before);
});

testCase('Importing version 1: normalisation of imperfect files', () => {
  const rm = TM.readModel({
    title: 'x'.repeat(200),
    materials: [{ name: 'm'.repeat(100), preset: 'nope', E: -5, fy: 'abc', color: 'red' }, { preset: 'aluminum', E: '', fy: null }],
    sections: [{ name: 's', material: 2, shape: { type: 'chs', D: 0.1, t: 0.005 }, A: 1, I: 1, color: '#12345' }, { material: 9, shape: { type: 'weird' }, A: 0, I: -1 }],
    nodes: [
      { x: 0, y: 0, support: { type: 'pin', dx: 0.01 } },
      { x: '4', y: 0, support: { type: 'rollerX', dy: 0.02 } },
      { x: 2, y: 2, support: { type: 'custom', fixY: true, angle: '15', dy: -0.003 }, load: { fx: '1e3' } },
      { x: 2, y: 5, support: { type: 'magnet' }, load: null },
      { x: 3, y: 1, support: { type: 'inclined', angle: 40 } },
      { x: 3, y: 2, support: { type: 'inclined' } },
      { x: 3, y: 3, support: { type: 'custom' } },
      { x: 4, y: 4, support: { type: 'custom', fixX: false, fixY: false } },
    ],
    members: [{ n1: 1, n2: 3, section: 1 }, { n1: 2, n2: 3, group: 2 }, { n1: 3, n2: 4 }, { n1: 4, n2: 5, section: 7 }],
  });
  const m = TM.serialize(rm.model), nodeAt = (i) => rm.model.nodes[i];
  check('the title is cut to 120 characters and names to 80', m.title.length === 120 && m.materials[0].name.length === 80);
  same('an unknown preset becomes custom, with the preset E and σy replacing invalid values, and its colour',
    [m.materials[0].preset, m.materials[0].E, m.materials[0].fy, m.materials[0].color], ['custom', 100e9, 200e6, '#a78bfa']);
  same('empty or missing E and σy fall back to the preset values', [m.materials[1].E, m.materials[1].fy, m.materials[1].name], [68.9e9, 276e6, '6061-T6 Aluminum']);
  const chs = TM.sectionProps({ type: 'chs', D: 0.1, t: 0.005 });
  check('a shaped section recomputes A and I from its dimensions, ignoring the stored values', m.sections[0].A === chs.A && m.sections[0].I === chs.I);
  check('an invalid section colour falls back to the palette', m.sections[0].color === TM.GROUP_COLORS[0] && m.sections[1].color === TM.GROUP_COLORS[1]);
  same('an unknown shape becomes custom; non-positive A and I become 1000 mm² and 10⁶ mm⁴; a missing material becomes material 1',
    [m.sections[1].shape, m.sections[1].A, m.sections[1].I, m.sections[1].material, m.sections[1].name], [{ type: 'custom' }, 1000 * TM.MM2, 1e6 * TM.MM4, 1, 'Section 2']);
  check('numeric strings are read as numbers (x, angle, load)', m.nodes[1].x === 4 && m.nodes[2].support.angle === 15 && TM.nodeLoad(rm.model, nodeAt(2)).fx === 1000);
  same('a custom-support settlement moves into Load case 1', TM.nodeSettlement(rm.model, nodeAt(2)), { dx: 0, dy: -0.003 });
  check('settlements on a pin and a roller (which version 1 ignored) are not applied', TM.nodeSettlement(rm.model, nodeAt(0)).dx === 0 && TM.nodeSettlement(rm.model, nodeAt(1)).dy === 0);
  same('... and each is reported in a visible import note naming its node', rm.notes.map((n) => [n.ref && n.ref.index, /was not applied/.test(n.msg)]), [[0, true], [1, true]]);
  check('an unknown support type becomes none, and a missing load becomes zero', m.nodes[3].support.type === 'none' && TM.nodeLoad(rm.model, nodeAt(3)).fx === 0 && TM.nodeLoad(rm.model, nodeAt(3)).fy === 0);
  check('inclined keeps its angle, or defaults to 30°', m.nodes[4].support.angle === 40 && m.nodes[5].support.angle === 30);
  check('a custom support with missing fixX/fixY keeps restraining nothing (existing behaviour)', m.nodes[6].support.type === 'custom' && m.nodes[6].support.fixX === false && m.nodes[6].support.fixY === false);
  check('a custom support with fixX/fixY explicitly false keeps restraining nothing', m.nodes[7].support.type === 'custom' && m.nodes[7].support.fixX === false && m.nodes[7].support.fixY === false);
  const again = TM.serialize(TM.readModel(JSON.parse(JSON.stringify(m))).model);
  check('both survive saving and reading again as version 2', JSON.stringify(again.nodes.slice(6)) === JSON.stringify(m.nodes.slice(6)));
  same('a missing or unknown section reference becomes section 1', m.members.map((e) => e.section), [1, 2, 1, 1]);
  const bare = TM.serialize(TM.deserialize({ nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }], members: [{ n1: 1, n2: 2 }] }));
  check('with no materials and no sections, steel and a default section are created',
    bare.materials.length === 1 && bare.materials[0].preset === 'steel' && bare.sections.length === 1 && bare.sections[0].A === 2000 * TM.MM2 && bare.title === 'Imported truss');
});

testCase('Importing: errors', () => {
  const d = (x) => () => TM.deserialize(x);
  throws('null is rejected', d(null), /not a JSON object/);
  throws('a number is rejected', d(42), /not a JSON object/);
  throws('missing node and member lists are rejected', d({}), /missing "nodes" or "members"/);
  throws('a missing member list is rejected', d({ nodes: [] }), /missing "nodes" or "members"/);
  throws('a node with invalid coordinates is rejected', d({ nodes: [{ x: 'a', y: 0 }], members: [] }), /node 1 has invalid coordinates/);
  throws('a member referring to a missing node is rejected', d({ nodes: [{ x: 0, y: 0 }], members: [{ n1: 1, n2: 2 }] }), /member 1 references invalid nodes/);
  throws('a member connecting a node to itself is rejected', d({ nodes: [{ x: 0, y: 0 }], members: [{ n1: 1, n2: 1 }] }), /member 1 references invalid nodes/);
});

testCase('Solver input (toAnalysisInput)', () => {
  const m = TM.buildExample('aframe'), before = JSON.stringify(TM.serialize(m));
  const inp = TM.toAnalysisInput(m, { loadFactor: 1, targetSF: 1.5 });
  same('nodes carry coordinates, loads and support DOFs', inp.nodes[2], { x: 3, y: 4, fx: 0, fy: -100e3, fixX: false, fixY: false, angle: 0, dx: 0, dy: 0 });
  same('members carry 0-based node indices and E, A, I, σy from their section and material', inp.members[1], { i: 1, j: 2, E: 200e9, A: 1e-3, I: 1e-6, fy: 250e6 });
  same('options carry the target safety factor', inp.options, { targetSF: 1.5 });
  const scaled = TM.toAnalysisInput(m, { loadFactor: 2.5, targetSF: 2 });
  check('the load factor multiplies the nodal loads', scaled.nodes[2].fy === -250e3 && scaled.nodes[0].fy === 0);
  const dflt = TM.toAnalysisInput(m);
  check('defaults: load factor 1, and no target safety factor (the solver default applies)', dflt.nodes[2].fy === -100e3 && Object.keys(dflt.options).length === 0);
  check('the model is unchanged afterwards', JSON.stringify(TM.serialize(m)) === before);
  check('the input shares no objects with the model', inp.nodes.every((n, i) => n !== m.nodes[i] && n !== m.nodes[i].support && n !== m.nodes[i].load));
  inp.nodes[2].fy = 1; inp.nodes[0].fixX = false; inp.members[0].A = 99;
  check('changing the input does not change the model', JSON.stringify(TM.serialize(m)) === before);
});

// λ multiplies every action of the load case, nodal loads and settlements alike (milestone 3; this replaces the
// temporary characterisation test of milestone 2). The model is linear: K_ff u_f = F_f − K_fs u_s, so scaling
// F and u_s by λ scales u, N = (EA/L)·Δu·e and R = K u − F by λ. λ = 0 is the zero-action state of a stable structure.
testCase('Load factor λ scales nodal loads and settlements alike', () => {
  const settlementOnly = TM.buildExample('settlement');
  settlementOnly.activeCase.loads.clear();
  const models = [['loads only (Pratt)', TM.buildExample('pratt')], ['settlement only (two-span truss, loads removed)', settlementOnly],
    ['loads and settlement (two-span truss)', TM.buildExample('settlement')]];
  for (const [what, m] of models) {
    const base = analyse(m), in1 = TM.toAnalysisInput(m, { loadFactor: 1 });
    for (const lf of [0.5, 2.5]) {
      const inp = TM.toAnalysisInput(m, { loadFactor: lf }), r = analyse(m, { loadFactor: lf, targetSF: 1.5 });
      check(`${what}, λ = ${lf}: the solver input is exactly λ × every load and settlement`,
        inp.nodes.every((n, i) => n.fx === lf * in1.nodes[i].fx && n.fy === lf * in1.nodes[i].fy && n.dx === lf * in1.nodes[i].dx && n.dy === lf * in1.nodes[i].dy));
      closeArray(`${what}, λ = ${lf}: member forces N(λ) = λ·N(1)`, r.members.map((x) => x.force), base.members.map((x) => lf * x.force), 1e-12);
      closeArray(`${what}, λ = ${lf}: displacements u(λ) = λ·u(1)`, r.nodes.flatMap((n) => [n.ux, n.uy]), base.nodes.flatMap((n) => [lf * n.ux, lf * n.uy]), 1e-12);
      closeArray(`${what}, λ = ${lf}: reactions R(λ) = λ·R(1)`, r.nodes.flatMap((n) => [n.rx, n.ry]), base.nodes.flatMap((n) => [lf * n.rx, lf * n.ry]), 1e-12);
    }
    const z = analyse(m, { loadFactor: 0, targetSF: 1.5 });
    check(`${what}, λ = 0: zero-action state of a stable structure (u, N, R exactly zero; every member zero-force, SF ∞)`,
      z.ok && z.nodes.every((n) => n.ux === 0 && n.uy === 0 && n.rx === 0 && n.ry === 0) && z.members.every((x) => x.force === 0 && x.state === 'zero' && x.sf === Infinity));
  }
  const pratt = TM.buildExample('pratt');
  near('safety factors scale as 1/λ: SF(2.5) = SF(1)/2.5 (Pratt)', analyse(pratt, { loadFactor: 2.5, targetSF: 1.5 }).summary.minSF.value, analyse(pratt).summary.minSF.value / 2.5, 1e-12);
  check('settlement example at λ = 2: the support settles exactly 2 × 10 mm', analyse(TM.buildExample('settlement'), { loadFactor: 2, targetSF: 1.5 }).nodes[4].uy === 2 * -0.01);
  const mech = analyse(TM.buildExample('mechanism'), { loadFactor: 0, targetSF: 1.5 });
  check('λ = 0 does not make a mechanism stable: it is still rejected with its mechanism mode', !mech.ok && !!mech.mechanism && mech.mechanism.nullity === 1);
});

testCase('Format version 2: reading, malformed content and newer versions', () => {
  const good = TM.serialize(TM.buildExample('settlement'));
  const rd = TM.readModel(copy(good));
  check('a version 2 file reads back identically, with no notes', rd.fromVersion === 2 && rd.notes.length === 0 && JSON.stringify(TM.serialize(rd.model)) === JSON.stringify(good));
  check('a version 2 report file (model nested under "model") reads the same model', JSON.stringify(TM.serialize(TM.deserialize({ meta: {}, model: copy(good), status: 'solved' }))) === JSON.stringify(good));
  const two = copy(good);
  two.loadCases.push({ id: 7, name: 'Wind', loads: [{ node: 1, fx: 5e3, fy: 0 }], settlements: [] });
  two.activeLoadCase = 7;
  const rt = TM.readModel(two).model;
  check('several load cases and the active one are read', rt.loadCases.length === 2 && rt.activeCase.name === 'Wind' &&
    TM.nodeLoad(rt, rt.nodes[0]).fx === 5e3 && TM.nodeLoad(rt, rt.nodes[0], rt.loadCases[0]).fx === 0);
  const fwd = copy(good);
  fwd.futureField = { x: 1 }; fwd.loadCases[0].kind = 'user'; fwd.nodes[0].colour = 'red'; fwd.loadCases[0].loads[0].comment = 'x';
  const rf = TM.readModel(fwd);
  check('unknown fields are ignored, without notes (forward compatibility)', JSON.stringify(TM.serialize(rf.model)) === JSON.stringify(good) && rf.notes.length === 0);
  const bad = copy(good);
  bad.loadCases[0].loads = [
    { node: 2, fx: 0, fy: -1000 },      // the first valid entry for node 2: kept
    { node: 2, fx: 0, fy: -9999 },      // a duplicate: skipped and reported
    { node: 99, fx: 0, fy: -1000 },     // a missing node: skipped and reported
    { node: 3, fx: 'abc', fy: -1000 },  // non-finite: skipped and reported
    { node: 4, fx: null, fy: -1000 },   // null is not a number: skipped and reported
    { node: 3, fy: -500 },              // a missing component counts as 0: the first valid entry for node 3
    'not an entry',                     // not an object: skipped and reported
  ];
  bad.loadCases[0].settlements = [{ node: 5, dx: 0, dy: Infinity }]; // non-finite: skipped and reported
  const rb = TM.readModel(bad), at = (i) => rb.model.nodes[i];
  same('malformed loads: the first valid entry for each node is kept', [TM.nodeLoad(rb.model, at(1)), TM.nodeLoad(rb.model, at(2)), TM.nodeLoad(rb.model, at(3))],
    [{ fx: 0, fy: -1000 }, { fx: 0, fy: -500 }, { fx: 0, fy: 0 }]);
  same('a non-finite settlement is skipped', TM.nodeSettlement(rb.model, at(4)), { dx: 0, dy: 0 });
  const kinds = [/already has an entry/, /node 99 does not exist/, /not a finite number/, /not a finite number/, /not an object/, /not a finite number/];
  check('each skipped entry is reported in its own note, in order', rb.notes.length === 6 && rb.notes.every((n, i) => kinds[i].test(n.msg)), rb.notes.map((n) => n.msg).join(' | '));
  const withCases = (list) => () => TM.readModel(Object.assign(copy(good), { loadCases: list }));
  throws('duplicate load-case ids reject the file', withCases([{ id: 1, name: 'A' }, { id: 1, name: 'B' }]), /two load cases have the id 1/);
  throws('a non-integer load-case id rejects the file', withCases([{ id: 1.5, name: 'A' }]), /load case 1 has an invalid id \(1.5\)/);
  throws('a missing load-case id rejects the file', withCases([{ name: 'A' }]), /load case 1 has an invalid id/);
  throws('a zero load-case id rejects the file', withCases([{ id: 0 }]), /invalid id \(0\)/);
  throws('a load case that is not an object rejects the file', withCases([null]), /load case 1 is not an object/);
  throws('"loadCases" that is not a list rejects the file', withCases({ id: 1 }), /"loadCases" must be a list/);
  const none = copy(good); delete none.loadCases;
  const rn = TM.readModel(none);
  check('no load cases: one empty "Load case 1", with a note', rn.model.loadCases.length === 1 && rn.model.loadCases[0].loads.size === 0 && /no load cases/.test(rn.notes[0].msg));
  const ra = TM.readModel(Object.assign(copy(two), { activeLoadCase: 9 }));
  check('an active load case that does not exist: the first case is active, with a note', ra.model.activeCase === ra.model.loadCases[0] && /does not exist/.test(ra.notes[0].msg));
  throws('a newer format version is rejected with a clear message', () => TM.readModel(Object.assign(copy(good), { version: 3 })),
    /written by a newer version of TrussLab \(file format version 3\)/);
  throws('... also inside a report file', () => TM.readModel({ meta: {}, model: Object.assign(copy(good), { version: 3 }) }), /newer version of TrussLab/);
});

testCase('A newer format version is refused before its layout is checked', () => {
  const good = TM.serialize(TM.buildExample('aframe'));
  const NEWER = /^it was written by a newer version of TrussLab \(file format version 3\), which this version cannot read$/;
  // a future layout need not have the version 2 lists; the version alone decides
  const v3bare = { format: 'trusslab-model', version: 3, title: 'From a later TrussLab', parts: [{ id: 1 }] };
  throws('a version 3 model file is refused as newer', () => TM.readModel(Object.assign(copy(good), { version: 3 })), NEWER);
  throws('a version 3 model file without "nodes" and "members" is refused as newer, not as malformed', () => TM.readModel(copy(v3bare)), NEWER);
  throws('a version 3 model inside a report is refused as newer', () => TM.readModel({ meta: { loadFactor: 1 }, model: copy(v3bare), status: 'solved' }), NEWER);
  throws('a version 3 model inside an autosaved session is refused as newer', () => TM.readModel({ model: copy(v3bare), settings: {}, view: {} }), NEWER);
  throws('... also when the nested model states only its version', () => TM.readModel({ model: { version: 3 }, settings: {}, view: {} }), NEWER);
  check('a valid version 1 model file still reads', TM.readModel(copy(V1_FILE)).fromVersion === 1);
  check('a valid version 2 model file still reads', TM.readModel(copy(good)).fromVersion === 2);
  check('a version on the wrapper is not taken for the model\'s version', TM.readModel({ version: 3, meta: {}, model: copy(good) }).fromVersion === 2);
  throws('an object that is neither a model nor a wrapper still gets the layout error', () => TM.readModel({ meta: {}, status: 'solved' }), /missing "nodes" or "members" arrays/);
  check('a "model" field that holds no model is still not unwrapped', TM.readModel({ model: { nodes: 'no' }, nodes: [{ x: 0, y: 0 }], members: [] }).model.nodes.length === 1);
});

testCase('Load cases', () => {
  const m = TM.buildExample('aframe'), lc1 = m.activeCase, apex = m.nodes[2];
  const lc2 = TM.addLoadCase(m);
  check('a new case gets the next free name, is empty, and does not become active', lc2.name === 'Load case 2' && lc2.loads.size === 0 && m.activeCase === lc1);
  TM.setActiveLoadCase(m, lc2);
  TM.setNodeLoad(m, apex, 10e3, 0);
  same('loads belong to their case', [TM.nodeLoad(m, apex), TM.nodeLoad(m, apex, lc1)], [{ fx: 10e3, fy: 0 }, { fx: 0, fy: -100e3 }]);
  near('analysing a chosen case: case 1 still gives -62.5 kN', analyse(m, { loadFactor: 1, loadCase: lc1 }).members[0].force, -62.5e3, 1e-14);
  check('the analysis uses the active case by default', analyse(m).members[0].force !== -62.5e3);
  const before = JSON.stringify(TM.serialize(m));
  TM.toAnalysisInput(m, { loadCase: lc1 });
  check('choosing a case for the input changes neither the model nor the active case', JSON.stringify(TM.serialize(m)) === before && m.activeCase === lc2);
  const lc3 = TM.addLoadCase(m, 'Wind');
  check('a case can be named, and new names skip taken ones', lc3.name === 'Wind' && TM.addLoadCase(m).name === 'Load case 4');
  check('removing the active case activates a neighbour', TM.removeLoadCase(m, lc2) && m.activeCase === lc3 && m.loadCases.length === 3);
  TM.removeLoadCase(m, lc3); TM.removeLoadCase(m, m.loadCases[1]);
  check('the last load case cannot be removed', m.loadCases.length === 1 && !TM.removeLoadCase(m, lc1) && m.loadCases.length === 1);
  TM.setNodeSettlement(m, m.nodes[1], 0, -0.005);
  TM.removeNodeActions(m, [apex, m.nodes[1]]);
  check('deleting nodes removes their loads and settlements from every case', lc1.loads.size === 0 && lc1.settlements.size === 0);
  TM.setNodeLoad(m, apex, 1, 0); TM.setNodeLoad(m, apex, 0, 0); TM.setNodeSettlement(m, apex, 0.1, 0); TM.setNodeSettlement(m, apex, 0, 0);
  check('setting a zero load or settlement removes the entry', lc1.loads.size === 0 && lc1.settlements.size === 0);
  check('modelHasSettlement finds a settlement in any case', TM.modelHasSettlement(TM.buildExample('settlement')) && !TM.modelHasSettlement(TM.buildExample('pratt')));
});

testCase('Validation warnings', () => {
  for (const [key] of TM.EXAMPLES) check(`${key}: no warnings`, TM.validateModel(TM.buildExample(key)).length === 0);
  const m = TM.buildExample('aframe');
  Object.assign(m.nodes[1].support, { type: 'custom', fixX: false, fixY: false });
  let w = TM.validateModel(m);
  check('a custom support with no fixed axis is reported as providing no restraint, linked to its node',
    w.length === 1 && /^Node 2: the custom support has neither x′ nor y′ fixed, so it provides no restraint\.$/.test(w[0].msg) && w[0].ref.index === 1, w.map((x) => x.msg).join(' | '));
  check('... and it is not converted into another support type', m.nodes[1].support.type === 'custom' && !m.nodes[1].support.fixX && !m.nodes[1].support.fixY);
  const s = TM.buildExample('settlement'), n5 = s.nodes[4];
  TM.setSupport(n5, 'rollerY'); // fixes x′ only, while the settlement is along y′
  w = TM.validateModel(s);
  check('a settlement along an axis that is not fixed is reported, naming the axis and the case',
    w.length === 1 && /^Node 5: the settlement along y′ in "Load case 1" has no effect, because y′ is not fixed\.$/.test(w[0].msg), w.map((x) => x.msg).join(' | '));
  check('... it is kept, not deleted', TM.nodeSettlement(s, n5).dy === -0.01);
  check('... and the solver does not receive it', TM.toAnalysisInput(s).nodes[4].dy === 0);
  const loose = TM.buildExample('aframe'), free = TM.makeNode(9, 9);
  loose.nodes.push(free); TM.setSupport(free, 'pin'); TM.setNodeSettlement(loose, free, 0, -0.01);
  w = TM.validateModel(loose);
  check('a settlement on a node with no members is reported', w.length === 1 && /^Node 4 is not connected to any member, so its settlement in "Load case 1" has no effect\.$/.test(w[0].msg));
  const migrated = TM.readModel(copy(V1_SETTLED)).model;
  check('a migrated version 1 settlement along a free axis is reported, not dropped', TM.validateModel(migrated).some((x) => /settlement along x′/.test(x.msg)) && TM.nodeSettlement(migrated, migrated.nodes[1]).dx === 0.002);
});

/** A stand-in for browser storage that can fail on purpose, and records every call. */
function fakeStorage(init) {
  const data = new Map(Object.entries(init || {}));
  const log = [], fail = { get: false, getKeys: null, set: false, setKeys: null, remove: false, corrupt: false, rewrite: null };
  return {
    data, log, fail,
    getItem(k) { log.push(`get ${k}`); if (fail.get && (!fail.getKeys || fail.getKeys.includes(k))) throw new Error('storage is disabled'); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      log.push(`set ${k}`);
      if (fail.set && (!fail.setKeys || fail.setKeys.includes(k))) throw new Error('QuotaExceededError');
      data.set(k, fail.corrupt ? String(v).slice(0, -3) : fail.rewrite ? fail.rewrite(String(v)) : String(v));
    },
    removeItem(k) { log.push(`remove ${k}`); if (fail.remove) throw new Error('removal failed'); data.delete(k); },
  };
}

testCase('Saved sessions: migration from version 1 and recovery (storage failure simulated)', () => {
  const K = TM.SESSION_KEYS, settings = { grid: 1, snap: false, forceUnit: 'MN', loadFactor: 2, sig: 6 }, view = { cx: 3, cy: 1, zoom: 55 };
  const v1Raw = JSON.stringify({ model: copy(V1_SETTLED), settings, view });
  const v2Raw = JSON.stringify({ model: TM.serialize(TM.buildExample('pratt')), settings: { grid: 2 }, view: { cx: 0, cy: 0, zoom: 10 } });
  const writes = (st) => st.log.filter((l) => !l.startsWith('get'));
  const save = (st, loaded, status) => TM.saveStoredSession(st, K, { model: loaded.model, settings: loaded.settings, view: loaded.view }, status);
  const statusOf = (loaded) => ({ migrationPending: loaded.migrationPending, corruptV2: loaded.corruptV2 });

  check('the user keys are version 2, version 1 and the backup; the smoke-test keys are all different',
    K.v2 === 'trusslab.session.v2' && K.v1 === 'trusslab.session.v1' && K.backup === 'trusslab.session.v2.unreadable' &&
    Object.values(TM.SMOKE_SESSION_KEYS).every((k) => !Object.values(K).includes(k)));

  let st = fakeStorage({ [K.v2]: v2Raw });
  let L = TM.loadStoredSession(st, K);
  check('a valid version 2 session is used, and loading writes nothing', L.source === 'v2' && /^Pratt/.test(L.model.title) && writes(st).length === 0);

  st = fakeStorage({ [K.v2]: v2Raw, [K.v1]: v1Raw });
  L = TM.loadStoredSession(st, K);
  const r10 = save(st, L, statusOf(L));
  check('with a valid version 2 session, a stale version 1 session is left untouched, even by saves', L.source === 'v2' && r10.saved && r10.legacy === 'not-needed' && st.data.get(K.v1) === v1Raw);

  st = fakeStorage({ [K.v1]: v1Raw });
  L = TM.loadStoredSession(st, K);
  check('a version 1 session is migrated in memory; loading writes and deletes nothing', L.source === 'v1' && L.migrationPending && writes(st).length === 0 && st.data.get(K.v1) === v1Raw);
  same('its settings and view are kept exactly', [L.settings, L.view], [settings, view]);
  same('its settlement moves into Load case 1, in the support frame', TM.nodeSettlement(L.model, L.model.nodes[1]), { dx: 0.002, dy: -0.01 });
  let status = statusOf(L), r = save(st, L, status);
  const order = writes(st);
  check('the migrated session is saved under the version 2 key and verified, then version 1 is removed', r.saved && r.legacy === 'removed' && !st.data.has(K.v1) && !status.migrationPending &&
    order.join() === `set ${K.v2},remove ${K.v1}` && st.log.indexOf(`get ${K.v2}`) < st.log.indexOf(`remove ${K.v1}`), st.log.join(', '));
  const stored = JSON.parse(st.data.get(K.v2));
  check('the version 2 session holds the same model, settings and view', JSON.stringify(stored.model) === JSON.stringify(TM.serialize(L.model)) &&
    JSON.stringify(stored.settings) === JSON.stringify(settings) && JSON.stringify(stored.view) === JSON.stringify(view) && stored.model.version === 2);

  st = fakeStorage({ [K.v1]: v1Raw }); L = TM.loadStoredSession(st, K); status = statusOf(L);
  st.fail.set = true;
  r = save(st, L, status);
  check('a failed version 2 write keeps version 1 and the migration pending', !r.saved && r.stage === 'write' && st.data.get(K.v1) === v1Raw && status.migrationPending);
  st.fail.set = false;
  r = save(st, L, status);
  check('the next successful save completes the migration', r.saved && r.legacy === 'removed' && !st.data.has(K.v1));

  st = fakeStorage({ [K.v1]: v1Raw }); L = TM.loadStoredSession(st, K); status = statusOf(L);
  st.fail.corrupt = true;
  r = save(st, L, status);
  check('a version 2 write that does not read back unchanged keeps version 1', !r.saved && r.stage === 'verify' && st.data.get(K.v1) === v1Raw && status.migrationPending);
  st.fail.corrupt = false;
  L = TM.loadStoredSession(st, K);
  check('at the next start the unreadable version 2 is backed up and version 1 is migrated again',
    L.source === 'v1' && L.backup.ok && L.backup.key === K.backup && st.data.get(K.backup) !== null && st.data.has(K.v1));

  st = fakeStorage({ [K.v1]: v1Raw }); L = TM.loadStoredSession(st, K); status = statusOf(L);
  st.fail.remove = true;
  r = save(st, L, status);
  check('a failed removal of version 1 after a verified save is reported separately, and retried', r.saved && r.legacy === 'failed' && st.data.has(K.v1) && status.migrationPending);
  st.fail.remove = false;
  r = save(st, L, status);
  check('... and the retry removes it', r.saved && r.legacy === 'removed' && !st.data.has(K.v1));

  st = fakeStorage({ [K.v1]: v1Raw });
  st.fail.get = true;
  L = TM.loadStoredSession(st, K);
  check('disabled storage: no session, nothing written or deleted', L.source === 'none' && writes(st).length === 0);
  st.fail.get = false; L = TM.loadStoredSession(st, K); status = statusOf(L); st.fail.get = true;
  r = save(st, L, status);
  check('a save that cannot be read back never removes version 1', !r.saved && r.stage === 'verify' && st.data.get(K.v1) === v1Raw);

  st = fakeStorage({ [K.v1]: '{"model": broken' });
  L = TM.loadStoredSession(st, K);
  check('an unreadable version 1 session (and no version 2): default start, and version 1 is left untouched', L.source === 'none' && writes(st).length === 0 && st.data.get(K.v1) === '{"model": broken');

  const corrupt = '{"model": {"nodes": [';
  st = fakeStorage({ [K.v2]: corrupt, [K.v1]: v1Raw });
  L = TM.loadStoredSession(st, K);
  check('an unreadable version 2 session is backed up, verified, before anything else', L.backup.ok && st.data.get(K.backup) === corrupt && L.source === 'v1' && L.corruptV2 === null);
  r = save(st, L, statusOf(L));
  check('... after which the save replaces it and removes version 1, keeping the backup', r.saved && r.legacy === 'removed' && st.data.get(K.backup) === corrupt && !st.data.has(K.v1));

  st = fakeStorage({ [K.v2]: corrupt, [K.backup]: 'an older, different backup' });
  L = TM.loadStoredSession(st, K);
  check('an existing backup with different data is never overwritten: a numbered backup is used',
    L.backup.ok && L.backup.key === `${K.backup}.2` && st.data.get(K.backup) === 'an older, different backup' && st.data.get(`${K.backup}.2`) === corrupt);
  st = fakeStorage({ [K.v2]: corrupt, [K.backup]: corrupt });
  L = TM.loadStoredSession(st, K);
  check('an existing identical backup is reused', L.backup.ok && L.backup.key === K.backup && writes(st).length === 0);

  st = fakeStorage({ [K.v2]: corrupt });
  st.fail.set = true; st.fail.setKeys = [K.backup];
  L = TM.loadStoredSession(st, K);
  status = statusOf(L);
  const session = { model: TM.buildExample('pratt'), settings: {}, view: {} };
  r = TM.saveStoredSession(st, K, session, status);
  check('if the backup cannot be written, the unreadable version 2 session is not overwritten', !L.backup.ok && !r.saved && r.stage === 'backup' && st.data.get(K.v2) === corrupt);
  st.fail.set = false;
  r = TM.saveStoredSession(st, K, session, status);
  check('... once the backup succeeds, saving resumes', r.saved && st.data.get(K.backup) === corrupt && JSON.parse(st.data.get(K.v2)).model.version === 2);

  check('with no storage at all: no session, and saving reports a write failure',
    TM.loadStoredSession(null, K).source === 'none' && TM.saveStoredSession(null, K, session, { migrationPending: false, corruptV2: null }).stage === 'write');
});

testCase('Saved sessions: a read that fails is never taken for a missing session', () => {
  const K = TM.SESSION_KEYS;
  const v1Raw = JSON.stringify({ model: copy(V1_SETTLED), settings: { grid: 1 }, view: { cx: 0, cy: 0, zoom: 40 } });
  const v2Raw = JSON.stringify({ model: TM.serialize(TM.buildExample('pratt')), settings: { grid: 2 }, view: { cx: 0, cy: 0, zoom: 10 } });
  const corrupt = '{"model": {"nodes": [';
  const statusOf = (L) => ({ migrationPending: L.migrationPending, corruptV2: L.corruptV2, readFailed: L.readFailed });
  const session = { model: TM.buildExample('fink'), settings: {}, view: {} };
  const contents = (st) => JSON.stringify([...st.data.entries()].sort());
  const changes = (st) => st.log.filter((l) => !l.startsWith('get'));
  /** Storage whose getItem throws for the given keys (all keys when null). */
  const failingReads = (init, keys) => { const st = fakeStorage(init); st.fail.get = true; st.fail.getKeys = keys; return st; };
  /** Loads, then saves twice: while the reads still fail, and after they work again. Nothing stored may change. */
  function blocked(name, st, wantFailed) {
    const before = contents(st), L = TM.loadStoredSession(st, K), status = statusOf(L);
    check(`${name}: no session is loaded, and the failed read is reported`, L.source === 'none' && !L.model && JSON.stringify(L.readFailed) === JSON.stringify(wantFailed), JSON.stringify([L.source, L.readFailed]));
    const r1 = TM.saveStoredSession(st, K, session, status);
    st.fail.get = false;
    const r2 = TM.saveStoredSession(st, K, session, status);
    check(`${name}: saving is refused, and says why`, !r1.saved && !r2.saved && r1.stage === 'read' && r2.stage === 'read' && /could not be read/.test(r1.error), JSON.stringify([r1, r2]));
    check(`${name}: nothing stored is written, overwritten or deleted`, contents(st) === before && changes(st).length === 0, changes(st).join(', '));
  }

  blocked('the version 2 read fails (both sessions stored)', failingReads({ [K.v2]: v2Raw, [K.v1]: v1Raw }, [K.v2]), [K.v2]);
  blocked('the version 1 read fails (no version 2 session)', failingReads({ [K.v1]: v1Raw }, [K.v1]), [K.v1]);
  blocked('both reads fail', failingReads({ [K.v2]: v2Raw, [K.v1]: v1Raw }, null), [K.v2]);

  let st = failingReads({ [K.v2]: corrupt, [K.v1]: v1Raw }, [K.v1]);
  let L = TM.loadStoredSession(st, K);
  check('an unreadable version 2 session, then a failed version 1 read: version 2 is backed up (verified), and only that is written',
    L.source === 'none' && L.backup.ok && st.data.get(K.backup) === corrupt && JSON.stringify(L.readFailed) === JSON.stringify([K.v1]) && changes(st).join() === `set ${K.backup}`);
  let r = TM.saveStoredSession(st, K, session, statusOf(L));
  check('... saving is refused, so neither the unreadable version 2 session nor version 1 is touched',
    !r.saved && r.stage === 'read' && st.data.get(K.v2) === corrupt && st.data.get(K.v1) === v1Raw && changes(st).join() === `set ${K.backup}`);

  st = failingReads({ [K.v2]: v2Raw, [K.v1]: v1Raw }, [K.v1]);
  L = TM.loadStoredSession(st, K);
  r = TM.saveStoredSession(st, K, session, statusOf(L));
  check('a readable version 2 session is used even when the version 1 read would fail; version 1 is never needed',
    L.source === 'v2' && L.readFailed.length === 0 && !st.log.includes(`get ${K.v1}`));
  check('... and saving works, leaving version 1 untouched', r.saved && r.legacy === 'not-needed' && st.data.get(K.v1) === v1Raw);

  st = fakeStorage({ [K.v1]: v1Raw });
  L = TM.loadStoredSession(st, K);
  check('a missing version 2 session (read successfully) with a readable version 1: the migration goes ahead', L.source === 'v1' && L.migrationPending && L.readFailed.length === 0);
  r = TM.saveStoredSession(st, K, { model: L.model, settings: L.settings, view: L.view }, statusOf(L));
  check('... and completes: version 2 written and verified, then version 1 removed', r.saved && r.legacy === 'removed' && !st.data.has(K.v1) && JSON.parse(st.data.get(K.v2)).model.version === 2);

  st = fakeStorage({ [K.v1]: v1Raw });
  L = TM.loadStoredSession(st, K);
  const status = statusOf(L);
  st.fail.get = true; st.fail.getKeys = [K.v2];
  r = TM.saveStoredSession(st, K, { model: L.model, settings: L.settings, view: L.view }, status);
  check('a read-back that throws: not reported as saved, and version 1 is kept', !r.saved && r.stage === 'verify' && /could not be read back/.test(r.error) && st.data.get(K.v1) === v1Raw && status.migrationPending, JSON.stringify(r));
});

testCase('Saved sessions: version 1 is removed only when the saved model reads back as the same model', () => {
  // A write is verified twice: the stored text must read back exactly as written, and must rebuild the same model
  // (serialised again and compared). Text can come back unchanged and still not restore what is in memory: the reader
  // normalises some values, for example a section area that is not positive is read as 1000 mm².
  const K = TM.SESSION_KEYS, settings = { grid: 1 }, view = { cx: 0, cy: 0, zoom: 20 };
  const v1Raw = JSON.stringify({ model: copy(V1_SETTLED), settings, view });
  const migrate = (change) => {
    const st = fakeStorage({ [K.v1]: v1Raw });
    const L = TM.loadStoredSession(st, K);
    const status = { migrationPending: L.migrationPending, corruptV2: L.corruptV2 };
    if (change) change(L.model);
    const r = TM.saveStoredSession(st, K, { model: L.model, settings: L.settings, view: L.view }, status);
    return { st, r, status };
  };
  let t = migrate();
  check('an ordinary migration passes both comparisons and removes version 1', t.r.saved && t.r.legacy === 'removed' && !t.st.data.has(K.v1));
  t = migrate((m) => { m.groups[0].A = 0; });
  check('a model that reads back differently (section area 0, read as 1000 mm²): its text is stored and reads back unchanged ...',
    t.st.data.has(K.v2) && JSON.parse(t.st.data.get(K.v2)).model.sections[0].A === 0);
  check('... but the write is not verified: not saved, stage "verify", and the reason says the model differs',
    !t.r.saved && t.r.stage === 'verify' && /same model/.test(t.r.error || ''), JSON.stringify(t.r));
  check('... so version 1 is kept unchanged, and the migration stays pending', t.st.data.get(K.v1) === v1Raw && t.status.migrationPending === true);
  // the other comparison: valid text, the same model, but something else changed on the way (here the settings)
  {
    const st = fakeStorage({ [K.v1]: v1Raw });
    const L = TM.loadStoredSession(st, K), status = { migrationPending: L.migrationPending, corruptV2: L.corruptV2 };
    st.fail.rewrite = (txt) => txt.replace('"grid":1', '"grid":2');
    const r = TM.saveStoredSession(st, K, { model: L.model, settings, view }, status);
    check('a session that reads back as valid text with the same model, but not as written (settings changed): not saved, version 1 kept',
      /"grid":2/.test(st.data.get(K.v2)) && !r.saved && r.stage === 'verify' && /unchanged/.test(r.error || '') && st.data.get(K.v1) === v1Raw && status.migrationPending === true, JSON.stringify(r));
  }
  t = migrate((m) => { m.nodes[0].x = NaN; });
  check('a model that cannot be read back at all (a coordinate that is not a number): not saved, version 1 kept',
    !t.r.saved && t.r.stage === 'verify' && t.st.data.get(K.v1) === v1Raw && t.status.migrationPending === true);
  // no false alarms: every example verifies, also with a second load case, a settlement and import notes
  const failed = [];
  for (const [key] of TM.EXAMPLES) {
    const m = TM.buildExample(key);
    const lc = TM.addLoadCase(m, 'Wind');
    TM.setNodeLoad(m, m.nodes[m.nodes.length - 1], 1500, -250, lc);
    TM.setNodeSettlement(m, m.nodes[0], 0, -0.002, lc);
    const st = fakeStorage({ [K.v1]: v1Raw });
    const r = TM.saveStoredSession(st, K, { model: m, settings, view, importNotes: [{ msg: 'a note', ref: { type: 'node', index: 0 } }] }, { migrationPending: true, corruptV2: null });
    if (!(r.saved && r.legacy === 'removed' && !st.data.has(K.v1))) failed.push(`${key}: ${JSON.stringify(r)}`);
  }
  check('all nine examples, each with a second load case, verify on saving (no false alarms), and version 1 is then removed', failed.length === 0, failed.join('; '));
});

testCase('Import notes are kept with the saved session', () => {
  const K = TM.SESSION_KEYS;
  const statusOf = (L) => ({ migrationPending: L.migrationPending, corruptV2: L.corruptV2, readFailed: L.readFailed });
  const NONE = { migrationPending: false, corruptV2: null, readFailed: [] };
  /** V1_SETTLED with a 5 mm settlement on the pin at node 1: version 1 ignored it, so it is not applied, with a note. */
  const V1_NOTED = copy(V1_SETTLED);
  V1_NOTED.nodes[0].support = { type: 'pin', angle: 0, fixX: true, fixY: true, dx: 0, dy: -0.005 };
  for (const [what, input] of [['a version 1 model file', V1_NOTED], ['a version 1 report file', { meta: { loadFactor: 1 }, model: V1_NOTED, status: 'solved' }]]) {
    const r = TM.readModel(copy(input));
    check(`${what}: reading it gives one import note, linked to node 1`, r.notes.length === 1 && /was not applied/.test(r.notes[0].msg) && r.notes[0].ref.index === 0);
    const st = fakeStorage();
    const s1 = TM.saveStoredSession(st, K, { model: r.model, settings: {}, view: {}, importNotes: r.notes }, Object.assign({}, NONE));
    const saved = JSON.parse(st.data.get(K.v2));
    check(`${what}: the notes are saved beside the model, as session data, not inside the model`,
      s1.saved && JSON.stringify(saved.importNotes) === JSON.stringify(r.notes) && !JSON.stringify(saved.model).includes('was not applied'));
    const L = TM.loadStoredSession(st, K);
    same(`${what}: after a restart the same notes are back, with their node links`, L.notes, r.notes);
    TM.saveStoredSession(st, K, { model: L.model, settings: {}, view: {}, importNotes: L.notes }, statusOf(L));
    same(`${what}: saving and restarting again does not duplicate them`, TM.loadStoredSession(st, K).notes, r.notes);
  }
  const st = fakeStorage({ [K.v1]: JSON.stringify({ model: copy(V1_NOTED), settings: {}, view: {} }) });
  let L = TM.loadStoredSession(st, K);
  check('a migrated version 1 session: its import note is loaded', L.source === 'v1' && L.notes.length === 1 && /was not applied/.test(L.notes[0].msg));
  const migrated = L.notes;
  TM.saveStoredSession(st, K, { model: L.model, settings: L.settings, view: L.view, importNotes: L.notes }, statusOf(L));
  L = TM.loadStoredSession(st, K);
  same('... after the migration and a restart (now from version 2) the note is still there, once', [L.source, L.notes], ['v2', migrated]);
  TM.saveStoredSession(st, K, { model: TM.buildExample('pratt'), settings: {}, view: {}, importNotes: [] }, statusOf(L));
  check('a new model with no notes: none are stored, and none come back', !('importNotes' in JSON.parse(st.data.get(K.v2))) && TM.loadStoredSession(st, K).notes.length === 0);
  const plain = fakeStorage({ [K.v2]: JSON.stringify({ model: TM.serialize(TM.buildExample('pratt')), settings: { grid: 2 }, view: { cx: 0, cy: 0, zoom: 9 } }) });
  L = TM.loadStoredSession(plain, K);
  check('an existing version 2 session without notes loads as before, with no notes', L.source === 'v2' && L.notes.length === 0 && L.settings.grid === 2 && L.view.zoom === 9);
  const aframe = TM.serialize(TM.buildExample('aframe'));
  const messy = fakeStorage({ [K.v2]: JSON.stringify({ model: aframe, settings: {}, view: {}, importNotes: [
    { msg: 'kept', ref: { type: 'node', index: 1 } }, { msg: 'kept', ref: { type: 'node', index: 1 } },
    { msg: 'link removed', ref: { type: 'node', index: 99 } }, { msg: 42 }, null, 'text', { msg: '' }] }) });
  same('stored notes are cleaned when read: duplicates and malformed entries dropped, a link to a missing node removed',
    TM.loadStoredSession(messy, K).notes, [{ msg: 'kept', ref: { type: 'node', index: 1 } }, { msg: 'link removed' }]);
  const notList = fakeStorage({ [K.v2]: JSON.stringify({ model: aframe, settings: {}, view: {}, importNotes: 'not a list' }) });
  L = TM.loadStoredSession(notList, K);
  check('notes that are not a list are ignored; the session still loads', L.source === 'v2' && L.notes.length === 0);
});

/* ---------- milestone 4: material density and the generated self-weight case ---------- */
// Hand references below use g = 9.80665 m/s² (standard gravity), W = ρ·A·L·g, and W/2 downward at each end node.
const G = 9.80665;
// A statically determinate test truss: A (0, 0) pin, B (6, 0) roller (uy = 0), apex C (3, 4); AC and BC are 5 m long, AB 6 m.
// AC: steel 7850 kg/m³, 2000 mm²: W = 7850 · 0.002 · 5 · g = 78.5 g = 769.822025 N
// BC: aluminium 2700 kg/m³, 1000 mm²: W = 2700 · 0.001 · 5 · g = 13.5 g = 132.389775 N
// AB: Douglas fir 540 kg/m³, 10000 mm²: W = 540 · 0.01 · 6 · g = 32.4 g = 317.73546 N
const W_AC = 769.822025, W_BC = 132.389775, W_AB = 317.73546;
function swTruss() {
  const m = TM.emptyModel('Self-weight test');
  const [steel, alu, fir] = m.materials;
  const gS = TM.makeGroup('Steel 2000 mm²', steel, { type: 'custom' }, null, 2000 * TM.MM2, 2e6 * TM.MM4);
  const gA = TM.makeGroup('Aluminium 1000 mm²', alu, { type: 'custom' }, null, 1000 * TM.MM2, 1e6 * TM.MM4);
  const gF = TM.makeGroup('Fir 10000 mm²', fir, { type: 'custom' }, null, 10000 * TM.MM2, 8e6 * TM.MM4);
  m.groups = [gS, gA, gF];
  const A = TM.makeNode(0, 0), B = TM.makeNode(6, 0), C = TM.makeNode(3, 4);
  TM.setSupport(A, 'pin'); TM.setSupport(B, 'rollerX');
  m.nodes.push(A, B, C);
  m.members.push(TM.makeMember(A, C, gS), TM.makeMember(B, C, gA), TM.makeMember(A, B, gF));
  return { m, A, B, C, gS, gA, gF, steel, alu, fir };
}
const fyOf = (m, n, lc) => TM.nodeLoad(m, n, lc).fy;
// the code adds the half weights at a node one member at a time, so compare with the hand sums to a relative 1e-14
const nearly = (x, want) => Math.abs(x / want - 1) < 1e-14;
const loadsJSON = (m, lc) => JSON.stringify(m.nodes.map((n) => TM.nodeLoad(m, n, lc)));

testCase('Material density (kg/m³)', () => {
  same('preset densities: steel 7850, aluminium 2700, Douglas fir 540; a custom material has none',
    ['steel', 'aluminum', 'fir', 'custom'].map((k) => TM.MATERIAL_PRESETS[k].density), [7850, 2700, 540, null]);
  same('makeMaterial takes the preset density; a custom or unknown material starts with no density, not an invented one',
    [TM.makeMaterial('steel').density, TM.makeMaterial('fir').density, TM.makeMaterial('custom').density, TM.makeMaterial('unobtainium').density], [7850, 540, null, null]);
  // Douglas fir: an approximate representative value at 12 % moisture content (maintainer decision, milestone 4). Coast
  // Douglas-fir has a specific gravity of 0.48 at 12 % MC (USDA Forest Products Laboratory, Wood Handbook 2021, Table 5–3b),
  // so its density at 12 % MC is 1000 kg/m³ · 0.48 · 1.12 = 537.6 kg/m³, rounded to 540.
  check('Douglas fir: 1000 · 0.48 · 1.12 = 537.6 kg/m³, rounded to the nearest 10, is the preset\'s 540 kg/m³',
    Math.abs(1000 * 0.48 * 1.12 - 537.6) < 1e-12 && Math.round(1000 * 0.48 * 1.12 / 10) * 10 === TM.MATERIAL_PRESETS.fir.density);
  check('the fir note calls it an approximate representative value at 12% moisture content', /density, 540 kg\/m³, is an approximate representative value at 12% MC/.test(TM.FIR_NOTE), TM.FIR_NOTE);
  same('a usable density is a finite number, 0 or more', [7850, 0, -1, NaN, Infinity, '7850', null, undefined].map(TM.validDensity), [true, true, false, false, false, false, false, false]);
  const f = TM.serialize(TM.emptyModel());
  same('it is written with each material, in kg/m³', f.materials.map((x) => x.density), [7850, 2700, 540]);
  same('material fields in a file', Object.keys(f.materials[0]), ['id', 'name', 'preset', 'E', 'fy', 'density', 'color']);
  const withCustom = TM.emptyModel(); withCustom.materials.push(TM.makeMaterial('custom'));
  check('a material without density is written as null', TM.serialize(withCustom).materials[3].density === null);
  const read = (density) => { const g = copy(f); g.materials[0].density = density; if (density === undefined) delete g.materials[0].density; return TM.readModel(g); };
  const r0 = read(undefined);
  check('a file without densities (version 2 before milestone 4) reads as "not set", even for a steel preset, and without a note',
    r0.model.materials[0].density === null && r0.notes.length === 0);
  check('... and so does every version 1 file', TM.readModel(copy(V1_FILE)).model.materials.every((x) => x.density === null));
  same('a density of 0 is kept (a weightless material), and a number written as text is read', [read(0).model.materials[0].density, read('7850').model.materials[0].density], [0, 7850]);
  for (const bad of [-1, 'abc', true, {}, '1e999']) {
    const r = read(bad);
    check(`an invalid density (${JSON.stringify(bad)}) is not set, and a note says so`, r.model.materials[0].density === null && r.notes.length === 1 && /density .* is not a number of kg\/m³/.test(r.notes[0].msg), JSON.stringify(r.notes));
  }
});

testCase('Self-weight of one member: W = ρ·A·L·g, half to each end node (closed form)', () => {
  check('g is standard gravity, 9.80665 m/s²', TM.GRAVITY === 9.80665 && TM.SELF_WEIGHT === 'self-weight');
  const m = TM.emptyModel(), steel = m.materials[0], g = m.groups[0]; // steel, A = 2000 mm²
  const a = TM.makeNode(0, 0), b = TM.makeNode(4, 0);
  m.nodes.push(a, b); m.members.push(TM.makeMember(a, b, g));
  const w = TM.memberSelfWeight(m.members[0]);
  same('the member: ρ 7850 kg/m³, A 2000 mm² = 0.002 m², L 4 m, g 9.80665 m/s²', [w.density, w.A, w.L, w.g], [7850, 2000 * TM.MM2, 4, 9.80665]);
  near('W = 7850 · 0.002 · 4 · 9.80665 = 615.85762 N', w.W, 615.85762, 1e-14);
  const sw = TM.addSelfWeightCase(m), L = TM.selfWeightLoads(m);
  near('end 1 carries W/2 = 307.92881 N downward', L.get(a).fy, -307.92881, 1e-14);
  check('end 2 carries exactly the same', L.get(b).fy === L.get(a).fy);
  check('and nothing horizontal: the load is along −y (gravity)', L.get(a).fx === 0 && L.get(b).fx === 0);
  same('nodeLoad reads the same values in the self-weight case', [TM.nodeLoad(m, a, sw), TM.nodeLoad(m, b, sw)], [L.get(a), L.get(b)]);
  // a sloped member: 3-4-5 triangle, aluminium 1000 mm²: W = 2700 · 0.001 · 5 · g = 132.389775 N, still purely vertical
  const alu = m.materials[1], gA = TM.makeGroup('a', alu, { type: 'custom' }, null, 1000 * TM.MM2, 1e6 * TM.MM4);
  const c = TM.makeNode(10, 0), d = TM.makeNode(13, 4);
  m.groups.push(gA); m.nodes.push(c, d); m.members.push(TM.makeMember(c, d, gA));
  near('a sloped member: L = hypot(3, 4) = 5 m', TM.memberSelfWeight(m.members[1]).L, 5, 1e-15);
  near('W = 2700 · 0.001 · 5 · 9.80665 = 132.389775 N', TM.memberSelfWeight(m.members[1]).W, 132.389775, 1e-14);
  check('... and its end loads are still vertical, W/2 each', TM.nodeLoad(m, c, sw).fx === 0 && Math.abs(TM.nodeLoad(m, d, sw).fy / -66.1948875 - 1) < 1e-14 && TM.nodeLoad(m, c, sw).fy === TM.nodeLoad(m, d, sw).fy);
  // units: kg/m³ · m² · m · m/s² = kg·m/s² = N. One cubic metre of steel: 7850 · 9.80665 = 76982.2025 N (unit weight 76.98 kN/m³)
  const u = TM.emptyModel(), p = TM.makeNode(0, 0), q = TM.makeNode(0, 1), cube = TM.makeGroup('1 m²', u.materials[0], { type: 'custom' }, null, 1, 1);
  u.groups = [cube]; u.nodes.push(p, q); u.members.push(TM.makeMember(p, q, cube));
  near('units: 1 m of a 1 m² steel bar weighs 76982.2025 N, steel\'s unit weight of 76.98 kN/m³', TM.memberSelfWeight(u.members[0]).W, 76982.2025, 1e-14);
  near('... and a section entered in mm² gives the same weight per m² (2000 mm² = 0.002 m²)', TM.memberSelfWeight(m.members[0]).W / (2000 * TM.MM2 * 4), 76982.2025, 1e-14);
});

testCase('Self-weight of members with different lengths, areas and densities sharing nodes (closed form)', () => {
  const { m, A, B, C } = swTruss();
  const sw = TM.addSelfWeightCase(m);
  near('member AC (steel, 2000 mm², 5 m): 769.822025 N', TM.memberSelfWeight(m.members[0]).W, W_AC, 1e-14);
  near('member BC (aluminium, 1000 mm², 5 m): 132.389775 N', TM.memberSelfWeight(m.members[1]).W, W_BC, 1e-14);
  near('member AB (fir, 10000 mm², 6 m): 317.73546 N', TM.memberSelfWeight(m.members[2]).W, W_AB, 1e-14);
  near('node A gets half of AC and half of AB: −543.7787425 N', fyOf(m, A, sw), -(W_AC + W_AB) / 2, 1e-14);
  near('node B gets half of BC and half of AB: −225.0626175 N', fyOf(m, B, sw), -(W_BC + W_AB) / 2, 1e-14);
  near('node C gets half of AC and half of BC: −451.1059 N', fyOf(m, C, sw), -(W_AC + W_BC) / 2, 1e-14);
  near('the end loads add up to the total weight, 1219.94726 N', -(fyOf(m, A, sw) + fyOf(m, B, sw) + fyOf(m, C, sw)), W_AC + W_BC + W_AB, 1e-14);
  // statics: only the apex load P = 451.1059 N loads the members (A and B are supports); sin θ = 4/5, cos θ = 3/5
  const P = (W_AC + W_BC) / 2, r = analyse(m, { loadFactor: 1, loadCase: sw });
  check('the self-weight case solves', r.ok);
  near('AC carries −P / (2 sin θ) = −281.9411875 N (compression)', r.members[0].force, -P / 1.6, 1e-12);
  near('BC carries the same', r.members[1].force, -P / 1.6, 1e-12);
  near('the tie AB carries P / (2 tan θ) = 169.1647125 N (tension)', r.members[2].force, P * 3 / 8, 1e-12);
  near('reaction at A: 543.7787425 + P/2 = 769.3316925 N', r.nodes[0].ry, (W_AC + W_AB) / 2 + P / 2, 1e-12);
  near('reaction at B: 225.0626175 + P/2 = 450.6155675 N', r.nodes[1].ry, (W_BC + W_AB) / 2 + P / 2, 1e-12);
  check('no horizontal reaction (gravity only)', Math.abs(r.nodes[0].rx) < 1e-9 * (W_AC + W_BC + W_AB), `${r.nodes[0].rx}`);
});

testCase('Self-weight with zero, missing and invalid densities', () => {
  const { m, A, B, C, fir, steel } = swTruss();
  const sw = TM.addSelfWeightCase(m);
  const full = TM.selfWeightSummary(m);
  check('every member has a density: the case is complete, and its total is the sum of the three weights',
    full.complete && full.members === 3 && full.counted === 3 && full.missing.length === 0 && full.materials.length === 0 && nearly(full.total, W_AC + W_BC + W_AB));
  fir.density = 0;
  check('density 0 counts as set: the case is still complete, and the tie adds nothing to the total',
    TM.selfWeightSummary(m).complete && nearly(TM.selfWeightSummary(m).total, W_AC + W_BC));
  check('density 0: the fir tie AB weighs nothing, and the other members are unchanged',
    TM.memberSelfWeight(m.members[2]).W === 0 && Math.abs(fyOf(m, A, sw) / (-W_AC / 2) - 1) < 1e-14 && Math.abs(fyOf(m, B, sw) / (-W_BC / 2) - 1) < 1e-14);
  check('... and no warning: 0 is a value the user chose', !TM.validateModel(m).some((w) => /density/.test(w.msg)));
  fir.density = null;
  const w0 = TM.memberSelfWeight(m.members[2]);
  check('no density (null): density reported as null, W = 0, the tie adds nothing', w0.density === null && w0.W === 0 && Math.abs(fyOf(m, A, sw) / (-W_AC / 2) - 1) < 1e-14);
  same('... and a warning names the material', TM.validateModel(m).map((w) => w.msg), ['Material "Douglas Fir Timber" has no density, so its member carries no weight in "Self-weight".']);
  const before = JSON.stringify(TM.serialize(m)), part = TM.selfWeightSummary(m);
  same('the summary marks the case incomplete, naming member 3 (AB) and its material, and its total leaves AB out',
    [part.complete, part.counted, part.members, part.missing, part.materials.map((x) => x.name)], [false, 2, 3, [2], ['Douglas Fir Timber']]);
  check('... total W_AC + W_BC, the members that have a density', nearly(part.total, W_AC + W_BC));
  check('... and reading the summary changes nothing in the model', JSON.stringify(TM.serialize(m)) === before);
  for (const bad of [NaN, -5, Infinity, '7850']) {
    steel.density = bad;
    check(`an invalid density in memory (${String(bad)}) counts as none: AC adds nothing`, TM.memberSelfWeight(m.members[0]).W === 0 && nearly(fyOf(m, C, sw), -W_BC / 2));
  }
  steel.density = null;
  check('with neither steel nor fir weighing anything, only the aluminium member loads its ends', TM.selfWeightLoads(m).size === 2 && !TM.selfWeightLoads(m).has(A));
  same('two materials without density, two warnings (members counted)', TM.validateModel(m).map((w) => w.msg),
    ['Material "Structural Steel" has no density, so its member carries no weight in "Self-weight".', 'Material "Douglas Fir Timber" has no density, so its member carries no weight in "Self-weight".']);
  same('the summary lists both members and both materials, in material order', [TM.selfWeightSummary(m).missing, TM.selfWeightSummary(m).materials.map((x) => x.name)],
    [[0, 2], ['Structural Steel', 'Douglas Fir Timber']]);
  TM.removeLoadCase(m, sw);
  check('without a self-weight case, a missing density is not a warning', TM.validateModel(m).length === 0);
  const empty = TM.emptyModel(); TM.addSelfWeightCase(empty);
  check('a model without members has no self-weight loads', TM.selfWeightLoads(empty).size === 0);
  const es = TM.selfWeightSummary(empty);
  check('... and nothing is missing from it: complete, with a total of 0', es.complete && es.members === 0 && es.total === 0);
});

testCase('Missing densities are never filled in from a preset, even when E and σy still equal the preset', () => {
  // maintainer decision, milestone 4: existing files load with density not set; a self-weight case then warns and is incomplete
  const P = TM.MATERIAL_PRESETS, f = TM.serialize(TM.emptyModel()); // steel, aluminium and fir with their presets' E and fy
  check('precondition: the three materials have exactly their presets\' E and fy', f.materials.every((x) => x.E === P[x.preset].E && x.fy === P[x.preset].fy));
  const without = copy(f); without.materials.forEach((x) => { delete x.density; });
  same('version 2 without densities: steel, aluminium and fir all read as not set', TM.readModel(without).model.materials.map((x) => x.density), [null, null, null]);
  const nulls = copy(f); nulls.materials.forEach((x) => { x.density = null; });
  same('... and the same with density: null', TM.readModel(nulls).model.materials.map((x) => x.density), [null, null, null]);
  const v1 = copy(V1_FILE);
  v1.materials = ['steel', 'aluminum', 'fir'].map((k, i) => ({ id: i + 1, name: P[k].name, preset: k, E: P[k].E, fy: P[k].fy, color: P[k].color }));
  same('a version 1 file with the three presets\' exact E and fy: no density for any', TM.readModel(copy(v1)).model.materials.map((x) => x.density), [null, null, null]);
  const K = TM.SESSION_KEYS;
  const st1 = fakeStorage({ [K.v1]: JSON.stringify({ model: v1, settings: {}, view: {} }) }), L1 = TM.loadStoredSession(st1, K);
  check('a version 1 session reads without densities', L1.source === 'v1' && L1.model.materials.every((x) => x.density === null));
  const sv = TM.saveStoredSession(st1, K, { model: L1.model, settings: L1.settings, view: L1.view }, { migrationPending: L1.migrationPending, corruptV2: L1.corruptV2 });
  check('... and its migration writes them as null, not as the preset values', sv.saved && JSON.parse(st1.data.get(K.v2)).model.materials.every((x) => x.density === null));
  const st2 = fakeStorage({ [K.v2]: JSON.stringify({ model: without, settings: {}, view: {} }) }), L2 = TM.loadStoredSession(st2, K);
  check('a version 2 session from before milestone 4 reads without densities', L2.source === 'v2' && L2.model.materials.every((x) => x.density === null));
  const mv = TM.readModel(copy(v1)).model;
  TM.addSelfWeightCase(mv);
  same('with a self-weight case, the model warns that steel has no density', TM.validateModel(mv).map((w) => w.msg),
    ['Material "Structural Steel" has no density, so its 2 members carry no weight in "Self-weight".']);
  const s = TM.selfWeightSummary(mv);
  check('... and the case is incomplete, with no weight at all, rather than presented as a complete self-weight of 0',
    !s.complete && s.total === 0 && s.missing.join() === '0,1' && TM.selfWeightLoads(mv).size === 0);
  mv.materials[0].density = 7850;
  check('entering the density completes it, and the warning goes', TM.selfWeightSummary(mv).complete && TM.validateModel(mv).length === 0);
});

testCase('Self-weight is recalculated after every change and never adds up', () => {
  const { m, A, B, C, gS, gF, steel } = swTruss();
  const sw = TM.addSelfWeightCase(m), first = loadsJSON(m, sw);
  C.y = 8; // geometry: AC and BC become √73 m long
  near('after moving the apex to (3, 8): C carries (7850 · 0.002 + 2700 · 0.001) · √73 · g / 2', fyOf(m, C, sw), -(7850 * 0.002 + 2700 * 0.001) * Math.sqrt(73) * G / 2, 1e-14);
  C.y = 4;
  gS.A = 4000 * TM.MM2; // section: AC twice as heavy
  near('after doubling the area of AC: A carries (2 · 769.822025 + 317.73546) / 2', fyOf(m, A, sw), -(2 * W_AC + W_AB) / 2, 1e-14);
  gS.A = 2000 * TM.MM2;
  steel.density = 2 * 7850; // material
  near('after doubling the density of steel: C carries (2 · 769.822025 + 132.389775) / 2', fyOf(m, C, sw), -(2 * W_AC + W_BC) / 2, 1e-14);
  steel.density = 7850;
  m.members[2].group = gS; // the tie AB is now steel 2000 mm²: 7850 · 0.002 · 6 · g = 94.2 g = 923.78643 N
  near('after giving AB another section: B carries (132.389775 + 923.78643) / 2', fyOf(m, B, sw), -(W_BC + 923.78643) / 2, 1e-14);
  m.members[2].group = gF;
  const bc = m.members.splice(1, 1)[0]; // deleting BC
  near('after deleting BC: C carries only half of AC', fyOf(m, C, sw), -W_AC / 2, 1e-14);
  m.members.splice(1, 0, bc);
  check('after undoing every change, the loads are exactly the first ones again', loadsJSON(m, sw) === first);
  const runs = [1, 2, 3, 4, 5].map(() => JSON.stringify([...TM.selfWeightLoads(m)].map(([n, v]) => [m.nodes.indexOf(n), v])));
  check('computing them five times gives five identical results', runs.every((x) => x === runs[0]));
  const inputs = [1, 2, 3].map(() => JSON.stringify(TM.toAnalysisInput(m, { loadFactor: 1, loadCase: sw })));
  check('building the solver input three times gives identical input', inputs.every((x) => x === inputs[0]));
  check('nothing is stored in the case: its Maps stay empty', sw.loads.size === 0 && sw.settlements.size === 0);
  let text = JSON.stringify(TM.serialize(m));
  for (let k = 0; k < 3; k++) {
    const back = TM.readModel(JSON.parse(text)).model, again = JSON.stringify(TM.serialize(back));
    check(`save and read cycle ${k + 1}: identical file, the same loads, nothing added`, again === text && loadsJSON(back, back.loadCases[1]) === first);
    text = again;
  }
});

testCase('The self-weight case is separate from the load cases the user fills', () => {
  const { m, A, C } = swTruss();
  const lc1 = m.loadCases[0];
  TM.setNodeLoad(m, C, 1000, -10000);
  const before = analyse(m), loads1 = loadsJSON(m, lc1);
  const sw = TM.addSelfWeightCase(m);
  check('adding it appends one case, named "Self-weight", marked generated, and does not make it active',
    m.loadCases.length === 2 && m.loadCases[1] === sw && sw.name === 'Self-weight' && TM.isGeneratedCase(sw) && !TM.isGeneratedCase(lc1) && m.activeCase === lc1 && TM.selfWeightCase(m) === sw);
  check('adding it again returns the same case: a model has at most one', TM.addSelfWeightCase(m) === sw && m.loadCases.length === 2);
  const after = analyse(m);
  check('"Load case 1" keeps its loads and its results exactly', loadsJSON(m, lc1) === loads1 &&
    after.members.every((x, i) => Object.is(x.force, before.members[i].force)) && after.nodes.every((n, i) => Object.is(n.uy, before.nodes[i].uy)));
  check('a load cannot be put into the self-weight case (setNodeLoad refuses and changes nothing)', TM.setNodeLoad(m, C, 5, 5, sw) === false && sw.loads.size === 0 && nearly(fyOf(m, C, sw), -(W_AC + W_BC) / 2));
  check('nor a settlement', TM.setNodeSettlement(m, A, 0, -0.01, sw) === false && sw.settlements.size === 0);
  check('setNodeLoad still works, and says so, in an ordinary case', TM.setNodeLoad(m, A, 0, -1, lc1) === true && TM.nodeLoad(m, A, lc1).fy === -1);
  TM.setNodeLoad(m, A, 0, 0, lc1);
  check('the active case reads its own loads; the self-weight case reads the generated ones',
    JSON.stringify(TM.nodeLoad(m, C)) === '{"fx":1000,"fy":-10000}' && TM.nodeLoad(m, C, sw).fx === 0 && nearly(TM.nodeLoad(m, C, sw).fy, -(W_AC + W_BC) / 2));
  const in1 = TM.toAnalysisInput(m, { loadFactor: 1 }), inS = TM.toAnalysisInput(m, { loadFactor: 1, loadCase: sw });
  check('the solver input of each case holds only its own loads', in1.nodes[2].fy === -10000 && in1.nodes[0].fy === 0 && inS.nodes[2].fx === 0 && nearly(inS.nodes[0].fy, -(W_AC + W_AB) / 2));
  TM.setNodeLoad(m, C, 0, -20000);
  check('editing "Load case 1" does not change the self-weight loads', nearly(fyOf(m, C, sw), -(W_AC + W_BC) / 2));
  TM.setActiveLoadCase(m, sw);
  check('the self-weight case can be the active case, and nodeLoad then reads it', m.activeCase === sw && nearly(fyOf(m, C), -(W_AC + W_BC) / 2));
  check('deleting it leaves "Load case 1" active, with its loads', TM.removeLoadCase(m, sw) && m.activeCase === lc1 && m.loadCases.length === 1 && TM.nodeLoad(m, C).fy === -20000);
});

testCase('The self-weight case is saved, read and restored', () => {
  const { m, C } = swTruss();
  const sw = TM.addSelfWeightCase(m);
  TM.setNodeLoad(m, C, 0, -10000);
  const f = TM.serialize(m);
  same('it is written as generated, by name, without loads or settlements (they are computed again when read)',
    f.loadCases[1], { id: 2, name: 'Self-weight', generated: 'self-weight', loads: [], settlements: [] });
  check('an ordinary case has no "generated" field', !('generated' in f.loadCases[0]));
  const r = TM.readModel(copy(f));
  check('reading it back: the case is generated again, with no notes', TM.isGeneratedCase(r.model.loadCases[1]) && !TM.isGeneratedCase(r.model.loadCases[0]) && r.notes.length === 0);
  check('... its loads are the same as before saving', loadsJSON(r.model, r.model.loadCases[1]) === loadsJSON(m, sw));
  check('... and the round trip is exact', JSON.stringify(TM.serialize(r.model)) === JSON.stringify(f));
  TM.setActiveLoadCase(m, sw);
  const ra = TM.readModel(TM.serialize(m)).model;
  check('when it is the active case, it is active again after reading', ra.activeCase === ra.loadCases[1] && TM.isGeneratedCase(ra.activeCase));
  const edited = copy(f); edited.loadCases[1].loads = [{ node: 3, fx: 0, fy: -1 }];
  const re = TM.readModel(edited);
  check('loads stored with the generated case (an edited file) are not applied, the generated ones are used, and a note says so',
    re.notes.length === 1 && /generated self-weight case/.test(re.notes[0].msg) && nearly(fyOf(re.model, re.model.nodes[2], re.model.loadCases[1]), -(W_AC + W_BC) / 2));
  const unknown = copy(f); unknown.loadCases[0].generated = 'wind';
  const ru = TM.readModel(unknown);
  check('a case marked generated by a kind this version does not know is read as an ordinary case, with its loads, and a note',
    !TM.isGeneratedCase(ru.model.loadCases[0]) && TM.nodeLoad(ru.model, ru.model.nodes[2], ru.model.loadCases[0]).fy === -10000 && ru.notes.length === 1 && /cannot generate/.test(ru.notes[0].msg));
  const K = TM.SESSION_KEYS, st = fakeStorage();
  const sv = TM.saveStoredSession(st, K, { model: m, settings: { grid: 1 }, view: { zoom: 3 } }, { migrationPending: false, corruptV2: null });
  const L = TM.loadStoredSession(st, K);
  check('an autosaved session keeps it: saved and verified, then restored as the active generated case with the same loads',
    sv.saved && L.source === 'v2' && TM.isGeneratedCase(L.model.activeCase) && loadsJSON(L.model, L.model.activeCase) === loadsJSON(m, sw) && L.notes.length === 0);
  check('... with the material densities', JSON.stringify(L.model.materials.map((x) => x.density)) === JSON.stringify(m.materials.map((x) => x.density)));
  const undoText = JSON.stringify({ model: TM.serialize(m) }), undone = TM.deserialize(JSON.parse(undoText).model);
  check('an undo snapshot (the serialised model) restores it too', TM.isGeneratedCase(undone.loadCases[1]) && loadsJSON(undone, undone.loadCases[1]) === loadsJSON(m, sw));
});

testCase('Self-weight and the load factor λ', () => {
  const { m, C } = swTruss();
  const sw = TM.addSelfWeightCase(m);
  const in1 = TM.toAnalysisInput(m, { loadFactor: 1, loadCase: sw }), in2 = TM.toAnalysisInput(m, { loadFactor: 2, loadCase: sw });
  check('λ = 2 doubles every generated load', in2.nodes.every((n, i) => n.fy === 2 * in1.nodes[i].fy && n.fx === 0));
  const r1 = analyse(m, { loadFactor: 1, loadCase: sw }), r2 = analyse(m, { loadFactor: 2, loadCase: sw }), r0 = analyse(m, { loadFactor: 0, loadCase: sw });
  closeArray('λ = 2: member forces N(2) = 2·N(1)', r2.members.map((x) => x.force), r1.members.map((x) => 2 * x.force), 1e-12);
  closeArray('λ = 2: reactions R(2) = 2·R(1)', r2.nodes.map((n) => n.ry), r1.nodes.map((n) => 2 * n.ry), 1e-12);
  check('λ = 0: no loads, no member forces, no reactions', r0.ok && r0.members.every((x) => x.force === 0) && r0.nodes.every((n) => n.rx === 0 && n.ry === 0));
  check('λ does not change the stored model: the generated loads at λ = 1 are unchanged afterwards', nearly(fyOf(m, C, sw), -(W_AC + W_BC) / 2));
});

testCase('Self-weight on the nine examples', () => {
  for (const [key] of TM.EXAMPLES) {
    const m = TM.buildExample(key), before = analyse(m);
    const sw = TM.addSelfWeightCase(m), after = analyse(m);
    check(`${key}: adding the self-weight case leaves "Load case 1" and its results exactly as they were`, m.activeCase === m.loadCases[0] && before.ok === after.ok &&
      (!before.ok || (after.members.every((x, i) => Object.is(x.force, before.members[i].force)) && after.nodes.every((n, i) => Object.is(n.ry, before.nodes[i].ry)))));
    const total = m.members.reduce((t, e) => t + TM.memberSelfWeight(e).W, 0), gen = [...TM.selfWeightLoads(m).values()];
    check(`${key}: every member has a density, so the total weight is positive, and every generated load is vertical and downward`,
      total > 0 && m.members.every((e) => TM.memberSelfWeight(e).density > 0) && gen.every((v) => v.fx === 0 && v.fy < 0));
    near(`${key}: the generated loads add up to the total weight`, -gen.reduce((t, v) => t + v.fy, 0), total, 1e-13);
    const r = analyse(m, { loadFactor: 1, loadCase: sw });
    if (key === 'mechanism') { check('mechanism: still unstable under its own weight, so no results', !r.ok); continue; }
    check(`${key}: the self-weight case solves`, r.ok);
    near(`${key}: the vertical reactions carry the total weight (ΣR_y = ΣW)`, r.nodes.reduce((t, n) => t + n.ry, 0), total, 1e-10);
    check(`${key}: no net horizontal reaction`, Math.abs(r.nodes.reduce((t, n) => t + n.rx, 0)) < 1e-9 * total);
    const f = JSON.stringify(TM.serialize(m));
    check(`${key}: with the self-weight case, the round trip is exact`, JSON.stringify(TM.serialize(TM.readModel(JSON.parse(f)).model)) === f);
  }
});

testCase('The nine example structures', () => {
  same('nine examples, in menu order', TM.EXAMPLES.map((e) => e[0]), ['pratt', 'howe', 'warren', 'aframe', 'cantilever', 'fink', 'inclined', 'settlement', 'mechanism']);
  const empty = TM.buildExample('not-an-example');
  check('an unknown key gives an empty model, which the solver refuses', empty.nodes.length === 0 && !analyse(empty).ok);
  const tol = 1e-9; // results are rounded to 12 significant figures in the baseline
  for (const [key] of TM.EXAMPLES) {
    const want = BASELINE[key], m = TM.buildExample(key), f = TM.serialize(m), r = analyse(m);
    const sup = {};
    f.nodes.forEach((n) => { if (n.support.type !== 'none') sup[n.id] = n.support.type; });
    check(`${key}: title, counts and supports as before`, f.title === want.title &&
      JSON.stringify({ nodes: f.nodes.length, members: f.members.length, sections: f.sections.length, materials: f.materials.length }) === JSON.stringify(want.counts) &&
      JSON.stringify(sup) === JSON.stringify(want.supports), f.title);
    check(`${key}: stability and Maxwell count as before`, r.ok === want.ok && r.determinacy.degree === want.maxwell, `ok ${r.ok}, Maxwell ${r.determinacy && r.determinacy.degree}`);
    if (!want.ok) {
      check(`${key}: same mechanism as before`, !!r.mechanism && r.mechanism.nullity === want.mechanism.nullity && JSON.stringify(r.mechanism.modes.map((x) => x.kind)) === JSON.stringify(want.mechanism.kinds));
      continue;
    }
    closeArray(`${key}: member forces as before`, r.members.map((x) => x.force), want.force, tol);
    same(`${key}: member status as before`, r.members.map((x) => x.status), want.status);
    closeArray(`${key}: displacements ux as before`, r.nodes.map((n) => n.ux), want.ux, tol);
    closeArray(`${key}: displacements uy as before`, r.nodes.map((n) => n.uy), want.uy, tol);
    const ids = Object.keys(want.reactions).map(Number);
    closeArray(`${key}: support reactions as before`, ids.flatMap((id) => [r.nodes[id - 1].rx, r.nodes[id - 1].ry]), ids.flatMap((id) => want.reactions[id]), tol);
    check(`${key}: governing safety factor as before`, Math.abs(r.summary.minSF.value / want.minSF.value - 1) <= tol &&
      r.summary.minSF.member + 1 === want.minSF.member && r.summary.minSF.governs === want.minSF.governs, `SF ${r.summary.minSF.value} at M${r.summary.minSF.member + 1}`);
  }
});

testCase('The examples against hand statics', () => {
  const R = (key) => { const r = analyse(TM.buildExample(key)); return (id) => [r.nodes[id - 1].rx, r.nodes[id - 1].ry, r.nodes[id - 1]]; };
  const pairs = [['pratt', 150e3], ['howe', 125e3], ['warren', 80e3], ['fink', 15e3]];
  for (const [key, each] of pairs) {
    const b = BASELINE[key], ids = Object.keys(b.supports).map(Number), at = R(key);
    near(`${key}: symmetric span, each support carries half the total load (${each / 1e3} kN)`, at(ids[0])[1], each, 1e-12);
    near(`${key}: the other support carries the same`, at(ids[1])[1], each, 1e-12);
  }
  const af = analyse(TM.buildExample('aframe'));
  near('aframe: each rafter carries -62.5 kN (3-4-5 geometry)', af.members[0].force, -62.5e3, 1e-14);
  near('aframe: apex deflection -1.953125 mm', af.nodes[2].uy, -1.953125e-3, 1e-14);
  near('aframe: horizontal thrust 37.5 kN at each pin', af.nodes[0].rx, 37.5e3, 1e-14);
  const cl = R('cantilever');
  near('cantilever: 40 kN × 8 m resisted by a ±160 kN couple over the 2 m wall height (bottom pin)', cl(1)[0], 160e3, 1e-12);
  near('cantilever: top pin pulls back with -160 kN', cl(6)[0], -160e3, 1e-12);
  near('cantilever: the bottom pin carries the whole 40 kN vertically', cl(1)[1], 40e3, 1e-12);
  near('cantilever: the top pin, joined only by a horizontal chord, carries no vertical force', cl(6)[1], 0, 1e-6);
  const inc = R('inclined'), cos30 = Math.sqrt(3) / 2, RB = 35e3 / cos30;
  near('inclined: the roller reaction acts along the surface normal, R = 35 kN / cos 30°', inc(2)[2].rLocal[1], RB, 1e-12);
  near('inclined: vertical reaction at the pin 15 kN', inc(1)[1], 15e3, 1e-12);
  near('inclined: horizontal reaction at the pin R/2 - 20 kN (small, cancellation)', inc(1)[0], RB / 2 - 20e3, 1e-11);
  const st = analyse(TM.buildExample('settlement'));
  near('settlement: support reactions sum to the 120 kN of load (a settlement adds no net force)', st.nodes[0].ry + st.nodes[4].ry + st.nodes[8].ry, 120e3, 1e-12);
  near('settlement: the end reactions are equal by symmetry', st.nodes[0].ry, st.nodes[8].ry, 1e-12);
  check('settlement: the middle support moves by exactly -10 mm', st.nodes[4].uy === -0.01);
  const mech = analyse(TM.buildExample('mechanism'));
  check('mechanism: rejected as unstable with one internal mechanism', !mech.ok && mech.mechanism.nullity === 1 && mech.mechanism.modes[0].kind === 'internal');
});

/* ---------- milestone 5: load combinations, each solved directly as one complete action state ---------- */
// Hand references use the determinate test truss swTruss(): A (0, 0) pin, B (6, 0) roller (uy = 0), apex C (3, 4).
// A horizontal load H at C (+x): N_AC = +5H/6, N_BC = −5H/6, N_AB = +H/2 (joints B and A, R_By = 2H/3).
// A vertical load P down at C: N_AC = N_BC = −P/1.6, N_AB = +3P/8 (sin θ = 0.8, cos θ = 0.6).
const H = 100e3, P = 100e3;
function comboTruss() {
  const t = swTruss(), m = t.m;
  const hor = m.loadCases[0]; hor.name = 'Horizontal';
  TM.setNodeLoad(m, t.C, H, 0, hor);
  const ver = TM.addLoadCase(m, 'Vertical');
  TM.setNodeLoad(m, t.C, 0, -P, ver);
  return Object.assign(t, { hor, ver });
}
const forces = (r) => r.members.map((x) => x.force);

testCase('Combinations: creating, editing, renaming and deleting', () => {
  const { m, hor, ver, C } = comboTruss();
  check('a new model has no combinations and none active', m.combinations.length === 0 && m.activeCombination === null && TM.emptyModel().combinations.length === 0);
  const c1 = TM.addCombination(m), c2 = TM.addCombination(m);
  same('new combinations are named "Combination 1", "Combination 2" and are not active', [c1.name, c2.name, m.activeCombination], ['Combination 1', 'Combination 2', null]);
  check('isCombination tells combinations from load cases', TM.isCombination(c1) && !TM.isCombination(hor) && !TM.isCombination(null));
  check('factors are set for load cases of the model', TM.setCombinationFactor(m, c1, ver, 1.5) && TM.setCombinationFactor(m, c1, hor, 1.35));
  same('... and kept in load-case order, whatever order they were entered in', c1.terms.map((t) => [t.loadCase.name, t.factor]), [['Horizontal', 1.35], ['Vertical', 1.5]]);
  check('setting a factor again replaces it', TM.setCombinationFactor(m, c1, ver, -0.5) && TM.combinationFactor(c1, ver) === -0.5 && c1.terms.length === 2);
  check('0 is a valid factor: the case stays listed', TM.setCombinationFactor(m, c1, ver, 0) && TM.combinationFactor(c1, ver) === 0 && c1.terms.length === 2);
  for (const bad of [NaN, Infinity, -Infinity, '1.5', true, {}]) {
    check(`an invalid factor (${String(bad)}) is refused and changes nothing`, !TM.setCombinationFactor(m, c1, ver, bad) && TM.combinationFactor(c1, ver) === 0);
  }
  const other = TM.emptyModel();
  check('a load case of another model is refused', !TM.setCombinationFactor(m, c1, other.loadCases[0], 1) && c1.terms.length === 2);
  check('... and so is a combination that is not in the model', !TM.setCombinationFactor(m, TM.makeCombination('x'), hor, 1));
  check('null removes a case from the combination', TM.setCombinationFactor(m, c1, ver, null) && TM.combinationFactor(c1, ver) === null && c1.terms.length === 1);
  c1.name = 'ULS 1';
  check('a combination is renamed through its name, which is saved', TM.serialize(m).combinations[0].name === 'ULS 1');
  TM.setActiveCombination(m, c1);
  check('setActiveCombination makes it the analysed state; the active load case is kept', m.activeCombination === c1 && m.activeCase === hor && TM.activeTarget(m) === c1);
  const before = JSON.stringify(TM.serialize(m));
  check('loads cannot be entered in a combination: setNodeLoad refuses (default and explicit) and changes nothing',
    !TM.setNodeLoad(m, C, 1, 2) && !TM.setNodeLoad(m, C, 1, 2, c1) && JSON.stringify(TM.serialize(m)) === before);
  check('... and neither can settlements', !TM.setNodeSettlement(m, C, 0.01, 0) && !TM.setNodeSettlement(m, C, 0.01, 0, c1) && JSON.stringify(TM.serialize(m)) === before);
  check('setNodeLoad still enters into a load case named explicitly', TM.setNodeLoad(m, C, 0, -P, ver));
  TM.setActiveLoadCase(m, ver);
  check('choosing a load case leaves the combination: the case is analysed again', m.activeCombination === null && TM.activeTarget(m) === ver);
  TM.setActiveCombination(m, c2);
  check('setActiveCombination(null) also goes back to the active case', TM.setActiveCombination(m, null) === null && TM.activeTarget(m) === ver);
  TM.setActiveCombination(m, c1);
  TM.setCombinationFactor(m, c2, hor, 2); TM.setCombinationFactor(m, c2, ver, 3);
  check('deleting a load case removes its factor from every combination', TM.removeLoadCase(m, hor) && c1.terms.length === 0 && c2.terms.map((t) => t.loadCase).join() === [ver].join() && TM.combinationFactor(c2, ver) === 3);
  check('deleting the active combination shows the active load case again', TM.removeCombination(m, c1) && m.activeCombination === null && m.combinations.length === 1 && TM.activeTarget(m) === m.activeCase);
  check('deleting a combination that is not in the model does nothing', !TM.removeCombination(m, c1) && m.combinations.length === 1);
  const c3 = TM.addCombination(m);
  check('a new combination takes the next free number ("Combination 2" is still taken)', c3.name === 'Combination 3');
});

testCase('Combination actions: F = Σ γᵢ·Fᵢ and u_s = Σ γᵢ·u_s,ᵢ, then λ once (closed form)', () => {
  const { m, hor, ver, A, B, C } = comboTruss();
  const one = TM.addCombination(m, 'one'); TM.setCombinationFactor(m, one, ver, 1);
  const inV = TM.toAnalysisInput(m, { loadCase: ver }), inOne = TM.toAnalysisInput(m, { combination: one });
  same('a single case with γ = 1: exactly the solver input of the case itself', inOne, inV);
  const rV = analyse(m, { loadCase: ver }), rOne = TM.analyzeCombination(m, one, {});
  check('... and exactly its results', rOne.ok && rOne.members.every((x, k) => Object.is(x.force, rV.members[k].force)) && rOne.nodes.every((n, i) => Object.is(n.ry, rV.nodes[i].ry)));
  const two = TM.addCombination(m, 'two'); TM.setCombinationFactor(m, two, hor, 1.35); TM.setCombinationFactor(m, two, ver, 1.5);
  const in2 = TM.toAnalysisInput(m, { combination: two });
  check('two cases: F_C = 1.35·(H, 0) + 1.5·(0, −P) exactly', in2.nodes[2].fx === 1.35 * H && in2.nodes[2].fy === 1.5 * -P && in2.nodes[0].fx === 0 && in2.nodes[1].fy === 0);
  const r2 = TM.analyzeCombination(m, two, {});
  closeArray('two cases: member forces 1.35·(5H/6, −5H/6, H/2) + 1.5·(−P/1.6, −P/1.6, 3P/8) (closed form)', forces(r2),
    [1.35 * 5 * H / 6 - 1.5 * P / 1.6, -1.35 * 5 * H / 6 - 1.5 * P / 1.6, 1.35 * H / 2 + 1.5 * 3 * P / 8], 1e-12);
  // three cases, the generated self-weight case among them
  const sw = TM.addSelfWeightCase(m), three = TM.addCombination(m, 'three');
  TM.setCombinationFactor(m, three, sw, 1.35); TM.setCombinationFactor(m, three, ver, 1.5); TM.setCombinationFactor(m, three, hor, 0.9);
  const in3 = TM.toAnalysisInput(m, { combination: three }), r3 = TM.analyzeCombination(m, three, {});
  check('three cases with self-weight: every node gets 0.9·F_hor + 1.5·F_ver + 1.35·F_sw, in load-case order', m.nodes.every((n, i) =>
    in3.nodes[i].fx === 0 + 0.9 * TM.nodeLoad(m, n, hor).fx + 1.5 * TM.nodeLoad(m, n, ver).fx + 1.35 * TM.nodeLoad(m, n, sw).fx &&
    in3.nodes[i].fy === 0 + 0.9 * TM.nodeLoad(m, n, hor).fy + 1.5 * TM.nodeLoad(m, n, ver).fy + 1.35 * TM.nodeLoad(m, n, sw).fy));
  near('... and the vertical reactions carry 1.5·P + 1.35·ΣW (ΣW = W_AC + W_BC + W_AB)', r3.nodes[0].ry + r3.nodes[1].ry, 1.5 * P + 1.35 * (W_AC + W_BC + W_AB), 1e-12);
  near('... and the horizontal reaction carries −0.9·H', r3.nodes[0].rx, -0.9 * H, 1e-12);
  // negative and zero factors, and cancellation
  const neg = TM.addCombination(m, 'neg'); TM.setCombinationFactor(m, neg, ver, -1);
  closeArray('a negative factor reverses the case: −1 × Vertical gives the opposite forces', forces(TM.analyzeCombination(m, neg, {})), forces(rV).map((x) => -x), 1e-12);
  const zero = TM.addCombination(m, 'zero'); TM.setCombinationFactor(m, zero, hor, 1.35); TM.setCombinationFactor(m, zero, ver, 0);
  const hOnly = TM.addCombination(m, 'h'); TM.setCombinationFactor(m, hOnly, hor, 1.35);
  same('a zero factor contributes nothing: the same input as without the case', TM.toAnalysisInput(m, { combination: zero }), TM.toAnalysisInput(m, { combination: hOnly }));
  const up = TM.addLoadCase(m, 'Up'); TM.setNodeLoad(m, C, 0, P, up);
  const cancel = TM.addCombination(m, 'cancel'); TM.setCombinationFactor(m, cancel, ver, 1); TM.setCombinationFactor(m, cancel, up, 1);
  const rc = TM.analyzeCombination(m, cancel, {});
  check('opposite loads cancel exactly: no member forces, no reactions, SF ∞ everywhere', rc.ok && rc.members.every((x) => x.force === 0 && x.sf === Infinity) && rc.nodes.every((n) => n.rx === 0 && n.ry === 0));
  // λ multiplies the complete combined state once
  const in2l = TM.toAnalysisInput(m, { combination: two, loadFactor: 2 });
  check('λ = 2 multiplies the combined loads once: 2·(1.35·H) and 2·(1.5·(−P)), not λ² or λ·γ²', in2l.nodes[2].fx === 2 * (1.35 * H) && in2l.nodes[2].fy === 2 * (1.5 * -P));
  closeArray('λ = 2: member forces twice those at λ = 1', forces(TM.analyzeCombination(m, two, { loadFactor: 2 })), forces(r2).map((x) => 2 * x), 1e-12);
  const r0 = TM.analyzeCombination(m, two, { loadFactor: 0 });
  check('λ = 0: the zero-action state, no member forces or reactions', r0.ok && r0.members.every((x) => x.force === 0) && r0.nodes.every((n) => n.rx === 0 && n.ry === 0));
  const snap = JSON.stringify(TM.serialize(m));
  TM.toAnalysisInput(m, { combination: three }); TM.analyzeCombinations(m, { loadFactor: 1.7 });
  check('building and solving combinations changes nothing in the model', JSON.stringify(TM.serialize(m)) === snap);
  check('the combination reads the self-weight case as it is now: moving the apex changes its loads at once',
    (C.y = 8, TM.nodeLoad(m, C, three).fy !== in3.nodes[2].fy) && (C.y = 4, TM.nodeLoad(m, C, three).fy === in3.nodes[2].fy));
  void A; void B;
});

testCase('Combinations of prescribed settlements: u_s = Σ γᵢ·u_s,ᵢ along each support frame', () => {
  const m = TM.buildExample('settlement'); // three supports; the middle one, node 5, settles −10 mm in Load case 1
  const lc1 = m.loadCases[0], mid = m.nodes[4];
  const settle = TM.addLoadCase(m, 'Settlement only'); TM.setNodeSettlement(m, mid, 0, -0.01, settle);
  const lift = TM.addLoadCase(m, 'Lift'); TM.setNodeSettlement(m, mid, 0, 0.004, lift);
  const c = TM.addCombination(m, 'S'); TM.setCombinationFactor(m, c, settle, 1); TM.setCombinationFactor(m, c, lift, 2);
  const inp = TM.toAnalysisInput(m, { combination: c });
  check('the combined settlement is 1·(−10 mm) + 2·(+4 mm), passed on the fixed axis', inp.nodes[4].dy === 0 + 1 * -0.01 + 2 * 0.004 && inp.nodes[4].dx === 0);
  same('nodeSettlement reads the same combined value', TM.nodeSettlement(m, mid, c), { dx: 0, dy: 0 + 1 * -0.01 + 2 * 0.004 });
  const r = TM.analyzeCombination(m, c, {});
  check('the solver moves the support by exactly that amount', r.ok && r.nodes[4].uy === inp.nodes[4].dy);
  const rs = analyse(m, { loadCase: settle }), rl = analyse(m, { loadCase: lift });
  closeArray('this indeterminate truss: the forces equal 1·N(settlement) + 2·N(lift) (a superposition check of the direct solve)', forces(r), forces(rs).map((x, k) => x + 2 * forces(rl)[k]), 1e-9);
  const both = TM.addCombination(m, 'loads and settlement'); TM.setCombinationFactor(m, both, lc1, 1.5); TM.setCombinationFactor(m, both, settle, 1);
  const ib = TM.toAnalysisInput(m, { combination: both });
  check('a case with loads and settlements, plus a settlement case: both kinds of action combine with their factors',
    ib.nodes[4].dy === 0 + 1.5 * -0.01 + 1 * -0.01 && m.nodes.every((n, i) => ib.nodes[i].fy === 0 + 1.5 * TM.nodeLoad(m, n, lc1).fy));
  near('λ = 2 scales the combined settlement once', TM.toAnalysisInput(m, { combination: c, loadFactor: 2 }).nodes[4].dy, 2 * (0 + 1 * -0.01 + 2 * 0.004), 1e-15);
  // a rotated support frame: the combined settlement stays along x′, y′, and only a fixed axis passes it on
  const t = swTruss(), B = t.B;
  B.support = { type: 'custom', angle: 30, fixX: false, fixY: true };
  const s1 = t.m.loadCases[0]; TM.setNodeSettlement(t.m, B, 0.002, -0.01, s1);
  const s2 = TM.addLoadCase(t.m, 'b'); TM.setNodeSettlement(t.m, B, 0.001, 0.003, s2);
  const cr = TM.addCombination(t.m, 'rot'); TM.setCombinationFactor(t.m, cr, s1, 2); TM.setCombinationFactor(t.m, cr, s2, -1);
  const ir = TM.toAnalysisInput(t.m, { combination: cr });
  check('rotated frame: dy′ = 2·(−10 mm) − 1·(3 mm) on the fixed y′ axis; the free x′ axis passes nothing', ir.nodes[1].dy === 0 + 2 * -0.01 + -1 * 0.003 && ir.nodes[1].dx === 0 && ir.nodes[1].angle === 30);
});

testCase('Each combination is solved from its complete action state, never from the cases\' safety factors', () => {
  // Member AC (steel, 2000 mm², fy 250 MPa: N_y = 500 kN; I = 2·10⁶ mm⁴, L = 5 m: P_cr = π²·200 GPa·I/L² = 157.9 kN)
  // "Horizontal" (H = 100 kN): N_AC = +5H/6 = +83.3 kN, SF = 500/83.3 = 6.0 (yield).
  // "Vertical" (P = 100 kN):   N_AC = −P/1.6 = −62.5 kN, SF = 157.9/62.5 = 2.53 (buckling).
  // 1 × Horizontal + 1 × Vertical: N_AC = 5H/6 − P/1.6 = +20.8 kN in tension, SF = 500/20.8 = 24.0 (yield).
  const { m, hor, ver } = comboTruss();
  const c = TM.addCombination(m, 'H + V'); TM.setCombinationFactor(m, c, hor, 1); TM.setCombinationFactor(m, c, ver, 1);
  const rh = analyse(m, { loadCase: hor }), rv = analyse(m, { loadCase: ver }), rc = TM.analyzeCombination(m, c, {});
  const AC = (r) => r.members[0];
  near('Horizontal alone: AC in tension, SF 6.0 (yield)', AC(rh).sf, 6, 1e-12);
  check('... governed by yield', AC(rh).governs === 'yield' && AC(rh).force > 0);
  near('Vertical alone: AC in compression, SF π²·16000/62500 = 2.53 (buckling)', AC(rv).sf, Math.PI * Math.PI * 16000 / 62500, 1e-12);
  check('... governed by buckling', AC(rv).governs === 'buckling' && AC(rv).force < 0);
  near('the combination solved directly: AC carries 5H/6 − P/1.6 = +20.83 kN (closed form)', AC(rc).force, 5 * H / 6 - P / 1.6, 1e-12);
  near('... so its SF is 500 kN / 20.83 kN = 24.0, governed by yield in tension', AC(rc).sf, 24, 1e-12);
  check('... and that is the result of the solver for the combined actions', AC(rc).governs === 'yield' && AC(rc).state === 'tension');
  const sumOfUtilisations = 1 / (1 / AC(rh).sf + 1 / AC(rv).sf), worstOfCases = Math.min(AC(rh).sf, AC(rv).sf);
  check('adding the cases\' utilisations would give SF 1.78, and taking the worse case 2.53: neither is the combination\'s 24.0',
    Math.abs(sumOfUtilisations - 1.778) < 0.001 && Math.abs(worstOfCases - 2.527) < 0.001 && AC(rc).sf > 9 * worstOfCases);
  const hand = { nodes: TM.toAnalysisInput(m, { loadCase: hor }).nodes.map((n, i) => Object.assign({}, n, { fx: 0 + 1 * n.fx + 1 * TM.toAnalysisInput(m, { loadCase: ver }).nodes[i].fx, fy: 0 + 1 * n.fy + 1 * TM.toAnalysisInput(m, { loadCase: ver }).nodes[i].fy })),
    members: TM.toAnalysisInput(m).members, options: {} };
  const rHand = FEA.analyze(hand);
  check('analyzeCombination gives exactly FEA.analyze() of the hand-combined loads', rc.members.every((x, k) => Object.is(x.force, rHand.members[k].force) && Object.is(x.sf, rHand.members[k].sf)));
  near('BC, in compression in both cases, buckles under the combination: SF = P_cr,BC / (5H/6 + P/1.6)', rc.members[1].sf, Math.PI * Math.PI * 68.9e9 * 1e-6 / 25 / (5 * H / 6 + P / 1.6), 1e-12);
  check('... a failure the solver reports for the combined state', rc.members[1].status === 'buckled' && rc.summary.minSF.member === 1);
});

testCase('Non-active combinations, independent results and the worst case over combinations', () => {
  const { m, hor, ver } = comboTruss();
  const a = TM.addCombination(m, 'A'); TM.setCombinationFactor(m, a, hor, 1); TM.setCombinationFactor(m, a, ver, 1);
  const b = TM.addCombination(m, 'B'); TM.setCombinationFactor(m, b, ver, 1.5);
  const c = TM.addCombination(m, 'C'); TM.setCombinationFactor(m, c, hor, -1); TM.setCombinationFactor(m, c, ver, 0.5);
  const quiet = analyse(m), snap = JSON.stringify(TM.serialize(m));
  const rb = TM.analyzeCombination(m, b, {});
  check('a combination that is not active is solved on request, and nothing in the model changes', m.activeCombination === null && JSON.stringify(TM.serialize(m)) === snap);
  TM.setActiveCombination(m, b);
  const rbActive = analyse(m, { loadFactor: 1 });
  check('... with exactly the results it has when it is the active state', rbActive.members.every((x, k) => Object.is(x.force, rb.members[k].force)));
  TM.setActiveLoadCase(m, hor);
  check('the load case results are unaffected by the combinations', analyse(m).members.every((x, k) => Object.is(x.force, quiet.members[k].force)));
  const runs = TM.analyzeCombinations(m, { loadFactor: 1 });
  check('analyzeCombinations solves every combination, each with its own complete result', runs.length === 3 && runs.map((x) => x.combination).join() === [a, b, c].join() &&
    new Set(runs.map((x) => x.result)).size === 3 && runs.every((x) => x.result.ok && x.result.members.length === 3 && x.result.nodes.length === 3));
  check('... equal to solving each one alone', runs.every((x) => x.result.members.every((mm, k) => Object.is(mm.force, TM.analyzeCombination(m, x.combination, {}).members[k].force))));
  const keepB = runs[1].result.members[0].force;
  runs[0].result.members[0].force = 12345;
  check('the results are independent: changing one result object leaves the others as they were', runs[1].result.members[0].force === keepB && runs[2].result.members[0].force !== 12345);
  const env = TM.combinationEnvelope(m, TM.analyzeCombinations(m, {}));
  const fresh = TM.analyzeCombinations(m, {});
  const lowest = fresh.reduce((w, x) => (!w || x.result.summary.minSF.value < w.result.summary.minSF.value ? x : w), null);
  check('the governing value is the lowest SF of any member in any combination, with that combination and member',
    env.governing.value === lowest.result.summary.minSF.value && env.governing.combination === lowest.combination && env.governing.member === lowest.result.summary.minSF.member && env.complete);
  // BC: A gives −5H/6 − P/1.6 = −145.8 kN, B gives −1.5·P/1.6 = −93.75 kN, C gives +5H/6 − 0.5·P/1.6 (tension)
  check('... A (1 × Horizontal + 1 × Vertical) governs: BC buckles under 145.8 kN compression, more than B\'s 93.75 kN', env.governing.combination === a && env.governing.member === 1 && env.governing.governs === 'buckling');
  check('per member, the lowest SF is taken from one combination\'s own result, never a sum', env.members.every((x, k) => fresh.some((f) => f.combination === x.minSF.combination && f.result.members[k].sf === x.minSF.value) &&
    fresh.every((f) => f.result.members[k].sf >= x.minSF.value)));
  check('largest tension and compression of AC come from the combination that produces them (C reverses H: compression)',
    env.members[0].maxTension.combination === a && env.members[0].maxCompression.combination === c &&
    env.members[0].maxCompression.value === fresh[2].result.members[0].force);
  const mech = TM.buildExample('mechanism'), mc = TM.addCombination(mech, 'M'); TM.setCombinationFactor(mech, mc, mech.loadCases[0], 1.5);
  const menv = TM.combinationEnvelope(mech, TM.analyzeCombinations(mech, {}));
  check('a mechanism stays unstable in every combination: no governing value, and the envelope is not complete',
    !TM.analyzeCombination(mech, mc, {}).ok && menv.governing === null && menv.unsolved.length === 1 && !menv.complete);
  const none = TM.combinationEnvelope(m, []);
  check('no combinations: no governing value, and nothing is claimed as complete', none.governing === null && !none.complete);
});

testCase('Combination warnings', () => {
  const { m, hor, ver } = comboTruss();
  const empty = TM.addCombination(m, 'Empty');
  same('a combination without load cases has no actions, and a warning says so', TM.validateModel(m).map((w) => w.msg), ['Combination "Empty" has no load cases, so it has no actions.']);
  TM.setCombinationFactor(m, empty, hor, 0); TM.setCombinationFactor(m, empty, ver, 0);
  same('every factor 0: no actions either', TM.validateModel(m).map((w) => w.msg), ['Combination "Empty": every factor is 0, so it has no actions.']);
  TM.setCombinationFactor(m, empty, ver, 1.2);
  check('one non-zero factor is enough: no warning', TM.validateModel(m).length === 0);
});

testCase('Combinations are saved, read and restored, and malformed ones are reported', () => {
  const { m, hor, ver } = comboTruss();
  const sw = TM.addSelfWeightCase(m);
  const c1 = TM.addCombination(m, 'ULS 1'); TM.setCombinationFactor(m, c1, sw, 1.35); TM.setCombinationFactor(m, c1, ver, 1.5);
  const c2 = TM.addCombination(m, 'Uplift'); TM.setCombinationFactor(m, c2, sw, 1); TM.setCombinationFactor(m, c2, hor, -0.75); TM.setCombinationFactor(m, c2, ver, 0);
  TM.setActiveCombination(m, c2);
  const f = TM.serialize(m);
  same('combinations are written with ids, and their terms name load cases by id, in load-case order', f.combinations, [
    { id: 1, name: 'ULS 1', terms: [{ loadCase: 2, factor: 1.5 }, { loadCase: 3, factor: 1.35 }] },
    { id: 2, name: 'Uplift', terms: [{ loadCase: 1, factor: -0.75 }, { loadCase: 2, factor: 0 }, { loadCase: 3, factor: 1 }] }]);
  check('the analysed combination is named by id, and the active load case is kept', f.activeCombination === 2 && f.activeLoadCase === 1);
  const r = TM.readModel(copy(f));
  check('read back: the same file, without notes', JSON.stringify(TM.serialize(r.model)) === JSON.stringify(f) && r.notes.length === 0);
  check('... with the terms linked to the model\'s own load cases, the generated case included', r.model.combinations[0].terms[1].loadCase === r.model.loadCases[2] && TM.isGeneratedCase(r.model.combinations[0].terms[1].loadCase));
  check('... and the same combination analysed', r.model.activeCombination === r.model.combinations[1] && r.model.activeCase === r.model.loadCases[0]);
  const rr = analyse(r.model), rm = analyse(m);
  check('... giving exactly the same results', rr.members.every((x, k) => Object.is(x.force, rm.members[k].force)));
  const rep = TM.readModel({ meta: { loadFactor: 1 }, model: copy(f), status: 'solved' });
  check('a report file keeps its combinations', rep.model.combinations.length === 2 && rep.model.activeCombination === rep.model.combinations[1]);
  const K = TM.SESSION_KEYS, st = fakeStorage();
  const sv = TM.saveStoredSession(st, K, { model: m, settings: { grid: 1 }, view: { zoom: 3 } }, { migrationPending: false, corruptV2: null });
  const L = TM.loadStoredSession(st, K);
  check('an autosaved session keeps them: saved and verified, then restored with the same analysed combination',
    sv.saved && L.source === 'v2' && L.model.combinations.length === 2 && L.model.activeCombination === L.model.combinations[1] && JSON.stringify(TM.serialize(L.model)) === JSON.stringify(f));
  const undone = TM.deserialize(JSON.parse(JSON.stringify({ model: f })).model);
  check('an undo snapshot (the serialised model) restores them too', undone.combinations.length === 2 && JSON.stringify(TM.serialize(undone)) === JSON.stringify(f));
  const older = copy(f); delete older.combinations; delete older.activeCombination;
  const ro = TM.readModel(older);
  check('a file from before milestone 5 reads with no combinations and no note', ro.model.combinations.length === 0 && ro.model.activeCombination === null && ro.notes.length === 0);
  check('... and so does every version 1 file', TM.readModel(copy(V1_FILE)).model.combinations.length === 0);
  const read = (edit) => { const g = copy(f); edit(g); return TM.readModel(g); };
  for (const [what, edit, pattern] of [
    ['combinations that are not a list', (g) => { g.combinations = {}; }, /"combinations" must be a list/],
    ['a combination that is not an object', (g) => { g.combinations[0] = 3; }, /combination 1 is not an object/],
    ['an id that is not a positive integer', (g) => { g.combinations[1].id = 0; }, /combination 2 has an invalid id/],
    ['a text id', (g) => { g.combinations[0].id = '1'; }, /combination 1 has an invalid id/],
    ['two combinations with the same id', (g) => { g.combinations[1].id = 1; }, /two combinations have the id 1/]]) {
    throws(`${what}: the file is refused with a clear message`, () => read(edit), pattern);
  }
  const miss = read((g) => { g.combinations[0].terms[0].loadCase = 9; });
  check('a term naming a load case the file does not have is skipped, and a note says so',
    miss.model.combinations[0].terms.length === 1 && miss.notes.length === 1 && /Combination "ULS 1", term 1: load case 9 does not exist/.test(miss.notes[0].msg), JSON.stringify(miss.notes));
  for (const bad of [null, 'abc', true, [], '1e999', undefined, {}]) {
    const rb = read((g) => { if (bad === undefined) delete g.combinations[1].terms[0].factor; else g.combinations[1].terms[0].factor = bad; });
    check(`an invalid factor (${JSON.stringify(bad)}) skips the term, with a note`, rb.model.combinations[1].terms.length === 2 && rb.notes.length === 1 && /is not a finite number, so the term was skipped/.test(rb.notes[0].msg), JSON.stringify(rb.notes));
  }
  const text = read((g) => { g.combinations[1].terms[0].factor = ' -0.75 '; });
  check('a factor written as text is read as the number', text.model.combinations[1].terms[0].factor === -0.75 && text.notes.length === 0);
  const dup = read((g) => { g.combinations[0].terms.push({ loadCase: 2, factor: 9 }); });
  check('a load case listed twice in one combination: the first factor is kept, the second skipped with a note',
    TM.combinationFactor(dup.model.combinations[0], dup.model.loadCases[1]) === 1.5 && dup.notes.length === 1 && /already has a factor in this combination/.test(dup.notes[0].msg));
  const order = read((g) => { g.combinations[0].terms.reverse(); });
  check('terms in another order are read into load-case order', order.model.combinations[0].terms.map((t) => order.model.loadCases.indexOf(t.loadCase)).join() === '1,2' && order.notes.length === 0);
  const notList = read((g) => { g.combinations[0].terms = 'x'; });
  check('terms that are not a list: the combination is kept, empty, with a note', notList.model.combinations[0].terms.length === 0 && notList.notes.length === 1);
  const badTerm = read((g) => { g.combinations[0].terms[0] = 7; });
  check('a term that is not an object is skipped, with a note', badTerm.model.combinations[0].terms.length === 1 && /term 1: not an object/.test(badTerm.notes[0].msg));
  const act = read((g) => { g.activeCombination = 5; });
  check('an active combination that does not exist: the active load case is shown, with a note', act.model.activeCombination === null && act.notes.length === 1 && /combination 5 as active, which does not exist/.test(act.notes[0].msg));
  const actNone = read((g) => { delete g.combinations; });
  check('an active combination in a file without combinations: a note', actNone.model.activeCombination === null && actNone.notes.length === 1 && /has no combinations/.test(actNone.notes[0].msg));
  const names = read((g) => { g.combinations[0].name = '  '; g.combinations[1].name = '  ' + 'x'.repeat(100); });
  same('names are trimmed and cut to 80 characters; an empty name becomes "Combination N"', names.model.combinations.map((c) => c.name), ['Combination 1', 'x'.repeat(80)]);
  const noCases = read((g) => { delete g.loadCases; });
  check('with the load cases missing, every term is reported, none silently dropped', noCases.model.combinations.every((c) => c.terms.length === 0) && noCases.notes.filter((n) => /does not exist, so the term was skipped/.test(n.msg)).length === 5);
});

testCase('Combinations on the nine examples', () => {
  for (const [key] of TM.EXAMPLES) {
    const m = TM.buildExample(key), lc1 = m.loadCases[0], base = analyse(m);
    const unit = TM.addCombination(m, '1 × Load case 1'); TM.setCombinationFactor(m, unit, lc1, 1);
    const ru = TM.analyzeCombination(m, unit, { loadFactor: 1, targetSF: 1.5 });
    check(`${key}: 1 × "Load case 1" gives exactly the results of the case`, ru.ok === base.ok &&
      (!base.ok || (ru.members.every((x, k) => Object.is(x.force, base.members[k].force) && Object.is(x.sf, base.members[k].sf)) && ru.nodes.every((n, i) => Object.is(n.ry, base.nodes[i].ry)))));
    const sw = TM.addSelfWeightCase(m), uls = TM.addCombination(m, 'ULS'); TM.setCombinationFactor(m, uls, sw, 1.35); TM.setCombinationFactor(m, uls, lc1, 1.5);
    const inp = TM.toAnalysisInput(m, { combination: uls }), r = TM.analyzeCombination(m, uls, {});
    check(`${key}: 1.5 × Load case 1 + 1.35 × self-weight: the input is the factored sum at every node`, m.nodes.every((n, i) =>
      inp.nodes[i].fy === 0 + 1.5 * TM.nodeLoad(m, n, lc1).fy + 1.35 * TM.nodeLoad(m, n, sw).fy && inp.nodes[i].fx === 0 + 1.5 * TM.nodeLoad(m, n, lc1).fx + 1.35 * TM.nodeLoad(m, n, sw).fx &&
      inp.nodes[i].dy === (n.support.fixY || TM.supportRestraint(n.support).fixY ? 0 + 1.5 * TM.nodeSettlement(m, n, lc1).dy : 0)));
    if (key === 'mechanism') { check('mechanism: every combination is still unstable, so no results', !r.ok && !ru.ok); continue; }
    const Fx = inp.nodes.reduce((t, n) => t + n.fx, 0), Fy = inp.nodes.reduce((t, n) => t + n.fy, 0);
    const scale = Math.max(...inp.nodes.map((n) => Math.hypot(n.fx, n.fy)));
    check(`${key}: the combination solves, and the reactions balance the combined loads (ΣR + ΣF = 0)`,
      r.ok && Math.abs(r.nodes.reduce((t, n) => t + n.rx, 0) + Fx) < 1e-9 * scale && Math.abs(r.nodes.reduce((t, n) => t + n.ry, 0) + Fy) < 1e-9 * scale);
    check(`${key}: "Load case 1" is unchanged by the combinations`, analyse(m).members.every((x, k) => Object.is(x.force, base.members[k].force)));
  }
});

testCase('Design data (milestone 10): the deflection criterion is saved, read and checked', () => {
  const m = TM.buildExample('aframe'), [A, B, P] = [m.nodes[0], m.nodes[1], m.nodes[2]];
  check('a new model, and the examples, have no criterion', m.design && m.design.deflection === null && TM.emptyModel().design.deflection === null);
  check('without a criterion nothing is written (the file is exactly as before milestone 10)', !('design' in TM.serialize(m)));
  check('setting a valid criterion', TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [P, P], limit: { type: 'ratio', value: 300 } }) && m.design.deflection.nodes.length === 1);
  same('it is written with node ids', TM.serialize(m).design, { deflection: { chordA: 1, chordB: 2, nodes: [3], limit: { type: 'ratio', value: 300 } } });
  const back = TM.readModel(JSON.parse(JSON.stringify(TM.serialize(m)))).model;
  check('reading it back restores the same nodes and limit', back.design.deflection.a === back.nodes[0] && back.design.deflection.b === back.nodes[1] && back.design.deflection.nodes[0] === back.nodes[2] && back.design.deflection.limit.value === 300);
  check('invalid criteria are refused: one node twice, a limit of 0, an unknown limit type, a node of another model',
    !TM.setDeflectionCriterion(m, { a: A, b: A, nodes: [], limit: { type: 'ratio', value: 300 } }) && !TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [], limit: { type: 'ratio', value: 0 } }) &&
    !TM.setDeflectionCriterion(m, { a: A, b: B, nodes: [], limit: { type: 'percent', value: 2 } }) && !TM.setDeflectionCriterion(m, { a: A, b: TM.makeNode(9, 9), nodes: [], limit: { type: 'ratio', value: 300 } }));
  const base = TM.serialize(m);
  const read = (design) => TM.readModel(Object.assign(JSON.parse(JSON.stringify(base)), { design }));
  const bad = [
    ['not an object', 'x', /design data is not an object/],
    ['chord nodes that do not exist', { deflection: { chordA: 1, chordB: 9, nodes: [3], limit: { type: 'ratio', value: 300 } } }, /not two different nodes/],
    ['the same node twice', { deflection: { chordA: 2, chordB: 2, nodes: [3], limit: { type: 'ratio', value: 300 } } }, /not two different nodes/],
    ['a negative limit', { deflection: { chordA: 1, chordB: 2, nodes: [3], limit: { type: 'ratio', value: -1 } } }, /not a positive ratio or length/],
  ];
  for (const [what, design, pattern] of bad) {
    const r = read(design);
    check(`a malformed criterion (${what}) is left out with a note, and the model still reads`, r.model.design.deflection === null && r.notes.some((n) => pattern.test(n.msg)) && r.model.members.length === 2);
  }
  const skip = read({ deflection: { chordA: 1, chordB: 2, nodes: [3, 7, 'x'], limit: { type: 'absolute', value: '0.01' } } });
  check('unknown evaluation nodes are skipped with a note each; a numeric string limit is read', skip.model.design.deflection.nodes.length === 1 && skip.notes.filter((n) => /does not exist/.test(n.msg)).length === 2 && skip.model.design.deflection.limit.value === 0.01);
  check('a file without design data reads with no criterion and no note', read(undefined).model.design.deflection === null && read(undefined).notes.length === 0);
  check('version 1 files have no criterion', TM.readModel({ format: 'trusslab-model', version: 1, nodes: [{ id: 1, x: 0, y: 0 }], members: [] }).model.design.deflection === null);
  // deleting nodes prunes the criterion
  m.nodes.splice(2, 1);
  check('deleting an evaluation node removes it from the criterion', TM.pruneDesign(m) === 'nodes' && m.design.deflection.nodes.length === 0);
  m.nodes.splice(1, 1);
  check('deleting a reference node removes the criterion', TM.pruneDesign(m) === 'criterion' && m.design.deflection === null);
});

out('');
out(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => out(`  - ${f}`));
  if (typeof process !== 'undefined') process.exitCode = 1;
  else throw new Error(`${failures.length} check(s) failed`);
}
