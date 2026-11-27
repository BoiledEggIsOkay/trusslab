/*
 * Headless tests for model.js (global TrussModel): the expression parser, section properties, the
 * model constructors, supports, file format version 1 (serialize / deserialize, including autosaved
 * sessions and report files), the solver input, and the nine example structures. Run from the
 * project folder:
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
    'supportDOF', 'serialize', 'deserialize', 'EXAMPLES', 'buildExample', 'toAnalysisInput'];
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
  same('makeNode: coordinates, a free support and no load',
    { x: n.x, y: n.y, support: n.support, load: n.load },
    { x: 1.5, y: -2, support: { type: 'none', angle: 0, fixX: false, fixY: false, dx: 0, dy: 0 }, load: { fx: 0, fy: 0 } });
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
});

testCase('Supports', () => {
  const sup = (type, angle) => { const n = TM.makeNode(0, 0); TM.setSupport(n, type, angle); const s = n.support; return [s.type, s.fixX, s.fixY, s.angle]; };
  same('pin restrains x and y', sup('pin'), ['pin', true, true, 0]);
  same('rollerX restrains y only', sup('rollerX'), ['rollerX', false, true, 0]);
  same('rollerY restrains x only', sup('rollerY'), ['rollerY', true, false, 0]);
  same('inclined restrains y′ at the given angle', sup('inclined', 40), ['inclined', false, true, 40]);
  same('inclined defaults to 30°', sup('inclined'), ['inclined', false, true, 30]);
  same('custom with nothing fixed fixes both axes', sup('custom'), ['custom', true, true, 0]);
  same('an unknown type becomes none', sup('magnet'), ['none', false, false, 0]);
  const n = TM.makeNode(0, 0);
  Object.assign(n.support, { type: 'custom', fixX: false, fixY: true, angle: 15, dx: 0.005, dy: -0.01 });
  TM.setSupport(n, 'custom');
  check('custom keeps its fixed axes and prescribed displacements', n.support.fixX === false && n.support.fixY === true && n.support.dx === 0.005 && n.support.dy === -0.01);
  TM.setSupport(n, 'pin');
  check('switching to another type clears prescribed displacements', n.support.dx === 0 && n.support.dy === 0);
  same('supportDOF passes a displacement only on a fixed axis',
    TM.supportDOF({ fixX: false, fixY: true, angle: 15, dx: 0.005, dy: -0.01 }), { fixX: false, fixY: true, angle: 15, dx: 0, dy: -0.01 });
});

testCase('Serialisation (file format version 1)', () => {
  const m = TM.buildExample('inclined'), f = TM.serialize(m);
  same('header: format, version and units', [f.format, f.version, f.units],
    ['trusslab-model', 1, { length: 'm', force: 'N', stress: 'Pa', area: 'm^2', inertia: 'm^4', angle: 'deg' }]);
  same('top-level fields', Object.keys(f), ['format', 'version', 'units', 'title', 'materials', 'sections', 'nodes', 'members']);
  check('ids are 1-based and sequential', [f.materials, f.sections, f.nodes, f.members].every((list) => list.every((x, i) => x.id === i + 1)));
  check('references are by id', f.members.every((e) => e.n1 >= 1 && e.n1 <= f.nodes.length && e.n2 >= 1 && e.n2 <= f.nodes.length && e.section >= 1 && e.section <= f.sections.length) &&
    f.sections.every((s) => s.material >= 1 && s.material <= f.materials.length));
  same('a node stores its support and load', f.nodes[1], { id: 2, x: 6, y: 0, support: { type: 'inclined', angle: 30, fixX: false, fixY: true, dx: 0, dy: 0 }, load: { fx: 0, fy: 0 } });
  check('serialize does not keep live references (a copy of support and load)', f.nodes[1].support !== m.nodes[1].support && f.nodes[1].load !== m.nodes[1].load);
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

testCase('Importing model files, autosaved sessions and report files', () => {
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

testCase('Importing: normalisation of imperfect files', () => {
  const m = TM.serialize(TM.deserialize({
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
    ],
    members: [{ n1: 1, n2: 3, section: 1 }, { n1: 2, n2: 3, group: 2 }, { n1: 3, n2: 4 }, { n1: 4, n2: 5, section: 7 }],
  }));
  check('the title is cut to 120 characters and names to 80', m.title.length === 120 && m.materials[0].name.length === 80);
  same('an unknown preset becomes custom, with the preset E and σy replacing invalid values, and its colour',
    [m.materials[0].preset, m.materials[0].E, m.materials[0].fy, m.materials[0].color], ['custom', 100e9, 200e6, '#a78bfa']);
  same('empty or missing E and σy fall back to the preset values', [m.materials[1].E, m.materials[1].fy, m.materials[1].name], [68.9e9, 276e6, '6061-T6 Aluminum']);
  const chs = TM.sectionProps({ type: 'chs', D: 0.1, t: 0.005 });
  check('a shaped section recomputes A and I from its dimensions, ignoring the stored values', m.sections[0].A === chs.A && m.sections[0].I === chs.I);
  check('an invalid section colour falls back to the palette', m.sections[0].color === TM.GROUP_COLORS[0] && m.sections[1].color === TM.GROUP_COLORS[1]);
  same('an unknown shape becomes custom; non-positive A and I become 1000 mm² and 10⁶ mm⁴; a missing material becomes material 1',
    [m.sections[1].shape, m.sections[1].A, m.sections[1].I, m.sections[1].material, m.sections[1].name], [{ type: 'custom' }, 1000 * TM.MM2, 1e6 * TM.MM4, 1, 'Section 2']);
  check('numeric strings are read as numbers (x, angle, load)', m.nodes[1].x === 4 && m.nodes[2].support.angle === 15 && m.nodes[2].load.fx === 1000);
  check('a settlement survives only on a custom support', m.nodes[0].support.dx === 0 && m.nodes[1].support.dy === 0 && m.nodes[2].support.dy === -0.003);
  check('an unknown support type becomes none, and a missing load becomes zero', m.nodes[3].support.type === 'none' && m.nodes[3].load.fx === 0 && m.nodes[3].load.fy === 0);
  check('inclined keeps its angle, or defaults to 30°', m.nodes[4].support.angle === 40 && m.nodes[5].support.angle === 30);
  check('a custom support in a file keeps exactly its fixed axes, even none (existing behaviour)', m.nodes[6].support.type === 'custom' && !m.nodes[6].support.fixX && !m.nodes[6].support.fixY);
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

// TEMPORARY characterisation test, to be replaced in milestone 3. It records the current behaviour:
// λ scales nodal loads but not prescribed settlements. Milestone 3 makes λ scale both, and must
// replace these checks with tests that u(λ) = λ·u(1), including exactly zero at λ = 0.
testCase('TEMPORARY characterisation (milestone 3 replaces it): λ scales loads but not settlements', () => {
  const m = TM.buildExample('settlement');
  const settled = m.nodes.findIndex((n) => n.support.dy !== 0);
  check('(temporary) the settlement example has one settled support, dy = -10 mm', settled === 4 && m.nodes[settled].support.dy === -0.01);
  const inp = TM.toAnalysisInput(m, { loadFactor: 2.5, targetSF: 1.5 });
  check('(temporary) at λ = 2.5 the settlement stays -10 mm while a 20 kN load becomes 50 kN', inp.nodes[settled].dy === -0.01 && inp.nodes[1].fy === -50e3);
  const r0 = analyse(m, { loadFactor: 0, targetSF: 1.5 });
  check('(temporary) at λ = 0 the support still settles by 10 mm', r0.ok && r0.nodes[settled].uy === -0.01);
  check('(temporary) at λ = 0 the settlement alone still produces member forces (indeterminate truss)', r0.members.some((x) => x.state !== 'zero'));
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

out('');
out(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => out(`  - ${f}`));
  if (typeof process !== 'undefined') process.exitCode = 1;
  else throw new Error(`${failures.length} check(s) failed`);
}
