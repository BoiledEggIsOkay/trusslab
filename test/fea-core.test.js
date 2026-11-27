/*
 * Regression tests for fea-core.js: the reference cases of the README table
 * "Accuracy checks performed". Run from the project folder:
 *
 *   node test/fea-core.test.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/fea-core.test.js
 *
 * The second line uses the JavaScript engine built into macOS, so Node is not required.
 * The process exits with a non-zero code if any check fails.
 */
'use strict';

const FEA = typeof require === 'function' ? require('../fea-core.js') : (load('fea-core.js'), globalThis.FEA);
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
/** Runs one group of checks; an exception counts as a failure instead of stopping the suite. */
function testCase(title, fn) {
  try { fn(); } catch (err) { failures.push(`${title}: threw ${err}`); out(`FAIL  ${title}: threw ${err}`); }
}

const STEEL = { E: 200e9, A: 1e-3, I: 1e-6, fy: 250e6 };
const EA = STEEL.E * STEEL.A; // 2e8 N
const bar = (i, j) => Object.assign({ i, j }, STEEL);
const node = (x, y, extra) => Object.assign({ x, y }, extra);
const pin = (x, y) => node(x, y, { fixX: true, fixY: true });

testCase('A-frame', () => {
  // 3-4-5 geometry: members at slope 4/3, so F = -P / (2 * 0.8) and uy = F * L / (EA * 0.8)
  const r = FEA.analyze({
    nodes: [pin(0, 0), pin(6, 0), node(3, 4, { fy: -100e3 })],
    members: [bar(0, 2), bar(1, 2)],
  });
  check('A-frame: solved', r.ok);
  near('A-frame: member 1 force = -62.5 kN', r.members[0].force, -62.5e3, 1e-14);
  near('A-frame: member 2 force = -62.5 kN', r.members[1].force, -62.5e3, 1e-14);
  near('A-frame: apex uy = -1.953125 mm', r.nodes[2].uy, -1.953125e-3, 1e-14);
  check('A-frame: apex ux = 0 by symmetry', Math.abs(r.nodes[2].ux) <= 1e-12 * Math.abs(r.nodes[2].uy));
  near('A-frame: each support carries Ry = 50 kN', r.nodes[0].ry, 50e3, 1e-14);
  check('A-frame: Maxwell count 0 (determinate)', r.determinacy.degree === 0);
});

testCase('Three-bar truss', () => {
  // Load P hangs from three bars; side bars at theta = 45 deg from the centre bar.
  // Compatibility + equilibrium: N1 = P / (1 + 2 cos^3 theta), N2 = N1 cos^2 theta.
  const P = 100e3, c = Math.SQRT1_2;
  const N1 = P / (1 + 2 * c ** 3), N2 = N1 * c * c;
  const r = FEA.analyze({
    nodes: [pin(-3, 3), pin(0, 3), pin(3, 3), node(0, 0, { fy: -P })],
    members: [bar(0, 3), bar(1, 3), bar(2, 3)],
  });
  check('Three-bar: solved', r.ok);
  near('Three-bar: centre bar N1 = P/(1 + 2cos^3)', r.members[1].force, N1, 1e-14);
  near('Three-bar: left bar N2 = N1 cos^2', r.members[0].force, N2, 1e-14);
  near('Three-bar: right bar N2 = N1 cos^2', r.members[2].force, N2, 1e-14);
  near('Three-bar: uy = -N1 L / EA', r.nodes[3].uy, -N1 * 3 / EA, 1e-14);
  check('Three-bar: Maxwell count 1 (indeterminate)', r.determinacy.degree === 1);
});

testCase('Inclined roller', () => {
  // Roller at B on a 30 deg surface: its reaction RB acts along the normal (-sin30, cos30).
  // Moments about A: 6 cos30 RB = 3 * 50 kN + 3 * 20 kN  ->  RB cos30 = 35 kN.
  const cos30 = Math.sqrt(3) / 2, RB = 35e3 / cos30;
  const r = FEA.analyze({
    nodes: [pin(0, 0), node(6, 0, { fixY: true, angle: 30 }), node(3, 3, { fx: 20e3, fy: -50e3 })],
    members: [bar(0, 1), bar(0, 2), bar(1, 2)],
  });
  check('Inclined roller: solved', r.ok);
  near('Inclined roller: normal reaction at B', r.nodes[1].rLocal[1], RB, 1e-13);
  near('Inclined roller: Ry at A = 15 kN', r.nodes[0].ry, 15e3, 1e-13);
  near('Inclined roller: Rx at A = RB/2 - 20 kN (small, cancellation)', r.nodes[0].rx, RB / 2 - 20e3, 1e-12);
  check('Inclined roller: no movement normal to the surface', r.nodes[1].uLocal[1] === 0);
});

testCase('Prescribed displacement', () => {
  // One bar, L = 2 m, far end pulled by 1 mm: F = EA * delta / L = 100 kN.
  const r = FEA.analyze({
    nodes: [pin(0, 0), node(2, 0, { fixX: true, fixY: true, dx: 1e-3 })],
    members: [bar(0, 1)],
  });
  check('Prescribed displacement: solved with no free DOFs', r.ok && r.nf === 0);
  near('Prescribed displacement: F = EA delta / L = 100 kN', r.members[0].force, 100e3, 1e-15);
  near('Prescribed displacement: reaction at the moved end', r.nodes[1].rx, 100e3, 1e-15);
});

testCase('Determinate settlement', () => {
  // A statically determinate truss moves as a rigid body when a support settles: no forces change.
  const model = (dy, load) => ({
    nodes: [pin(0, 0), node(4, 0, { fixY: true, dy }), node(2, 2, { fy: load })],
    members: [bar(0, 1), bar(0, 2), bar(1, 2)],
  });
  const ref = FEA.analyze(model(0, -30e3)), r = FEA.analyze(model(-10e-3, -30e3));
  check('Determinate settlement: solved', r.ok && ref.ok);
  check('Determinate settlement: support moved by exactly -10 mm', r.nodes[1].uy === -10e-3);
  for (let k = 0; k < 3; k++) near(`Determinate settlement: member ${k + 1} force unchanged`, r.members[k].force, ref.members[k].force, 1e-12);
  const unloaded = FEA.analyze(model(-10e-3, 0));
  check('Determinate settlement, no loads: all members zero-force', unloaded.ok && unloaded.members.every((m) => m.state === 'zero'));
});

testCase('Mechanisms', () => {
  const square = FEA.analyze({
    nodes: [pin(0, 0), node(3, 0, { fixY: true }), node(3, 3), node(0, 3)],
    members: [bar(0, 1), bar(1, 2), bar(2, 3), bar(3, 0)],
  });
  check('Square without diagonal: rejected as unstable', !square.ok && !!square.mechanism);
  check('Square without diagonal: one internal mechanism', square.mechanism.nullity === 1 && square.mechanism.modes[0].kind === 'internal');

  const floating = FEA.analyze({
    nodes: [node(0, 0), node(4, 0), node(2, 3)],
    members: [bar(0, 1), bar(1, 2), bar(2, 0)],
  });
  check('Unsupported triangle: rejected as unstable', !floating.ok && !!floating.mechanism);
  check('Unsupported triangle: three rigid-body modes', floating.mechanism.nullity === 3 && floating.mechanism.modes.every((m) => m.kind === 'rigid'));

  const collinear = FEA.analyze({
    nodes: [pin(0, 0), node(2, 0, { fy: -10e3 }), pin(4, 0)],
    members: [bar(0, 1), bar(1, 2)],
  });
  check('Collinear joint: rejected as unstable', !collinear.ok && !!collinear.mechanism);
  check('Collinear joint: no vertical stiffness at node 2', collinear.mechanism.nullity === 1 &&
    collinear.mechanism.modes[0].kind === 'zero-stiffness' && collinear.mechanism.zeroDofs[0] === 3);
});

testCase('Large Warren truss', () => {
  // 150 equilateral panels: 301 nodes, 599 members, 599 free DOFs.
  const panels = 150, h = Math.sqrt(3), nodes = [], members = [];
  for (let k = 0; k <= panels; k++) nodes.push(node(2 * k, 0, k > 0 && k < panels ? { fy: -10e3 } : {}));
  for (let k = 0; k < panels; k++) nodes.push(node(2 * k + 1, h));
  const B = (k) => k, T = (k) => panels + 1 + k;
  for (let k = 0; k < panels; k++) members.push(bar(B(k), B(k + 1)), bar(B(k), T(k)), bar(T(k), B(k + 1)));
  for (let k = 0; k + 1 < panels; k++) members.push(bar(T(k), T(k + 1)));
  Object.assign(nodes[0], { fixX: true, fixY: true });
  nodes[panels].fixY = true;
  const t0 = Date.now();
  const r = FEA.analyze({ nodes, members });
  const ms = Date.now() - t0, D = r.diagnostics;
  check(`Warren truss: solved, ${nodes.length} nodes, ${r.nf} free DOFs`, r.ok && nodes.length === 301 && r.nf === 599);
  check('Warren truss: backward error <= 1e-15', r.ok && D.backwardError <= 1e-15);
  check('Warren truss: global equilibrium (relative <= 1e-12)', r.ok && Math.max(D.equilibrium.relF, D.equilibrium.relM) <= 1e-12);
  check('Warren truss: nodal equilibrium from member forces (relative <= 1e-12)', r.ok && D.nodalResidualRel <= 1e-12);
  near('Warren truss: reactions carry the total load', r.nodes[0].ry + r.nodes[panels].ry, (panels - 1) * 10e3, 1e-12);
  out(`      (analysis took ${ms} ms; backward error ${r.ok ? D.backwardError.toExponential(2) : 'n/a'})`);
});

testCase('cosSinDeg', () => {
  const cs = FEA.util.cosSinDeg;
  check('cosSinDeg: exact at 90 deg', cs(90)[0] === 0 && cs(90)[1] === 1);
  check('cosSinDeg: exact at 30 and 60 deg', cs(30)[1] === 0.5 && cs(60)[0] === 0.5);
  check('cosSinDeg: exact at -90 deg', cs(-90)[0] === 0 && cs(-90)[1] === -1);
});

out('');
out(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => out(`  - ${f}`));
  if (typeof process !== 'undefined') process.exitCode = 1;
  else throw new Error(`${failures.length} check(s) failed`);
}
