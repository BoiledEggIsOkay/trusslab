/*
 * Headless tests for lessons.js (global TrussLessons), milestone 11: the lesson format, worked examples that
 * use the solver's numbers (closed forms where they exist), objective challenge criteria, the understanding
 * checks, and lesson progress in storage (failures simulated). Run from the project folder:
 *
 *   node test/lessons.test.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/lessons.test.js
 *
 * The process exits with a non-zero code if any check fails.
 */
'use strict';

const NODE = typeof require === 'function';
const FEA = NODE ? require('../fea-core.js') : (load('fea-core.js'), globalThis.FEA);
const TM = NODE ? require('../model.js') : (load('model.js'), globalThis.TrussModel);
const TE = NODE ? require('../education.js') : (load('education.js'), globalThis.TrussEducation);
const TD = NODE ? require('../design.js') : (load('design.js'), globalThis.TrussDesign);
const TL = NODE ? require('../lessons.js') : (load('lessons.js'), globalThis.TrussLessons);
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
  try { fn(); } catch (err) { failures.push(`${title}: threw ${err}`); out(`FAIL  ${title}: threw ${err}`); }
}
const analyse = (m) => FEA.analyze(TM.toAnalysisInput(m, { loadFactor: 1, targetSF: 1.5 }));
/** A storage stand-in whose methods can be made to fail or to corrupt what is written. */
function fakeStorage(init) {
  const data = new Map(Object.entries(init || {}));
  const s = { data, failGet: false, failSet: false, corrupt: false,
    getItem(k) { if (s.failGet) throw new Error('read refused'); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { if (s.failSet) throw new Error('quota'); data.set(k, s.corrupt ? v.slice(0, 5) : String(v)); },
    removeItem(k) { data.delete(k); } };
  return s;
}

testCase('Loading and API', () => {
  check('TrussLessons is a frozen object, and loads with no DOM', typeof TL === 'object' && Object.isFrozen(TL) && typeof document === 'undefined');
});

testCase('Every lesson has every part of the lesson format', () => {
  check('six lessons, numbered 1 to 6, with the five required topics first', TL.LESSONS.length === 6 && TL.LESSONS.every((l, i) => l.number === i + 1) &&
    TL.LESSONS.slice(0, 5).map((l) => l.id).join() === 'trusses,axial,supports,stress,stability');
  for (const l of TL.LESSONS) {
    const parts = { title: typeof l.title === 'string', objectives: l.objectives.length >= 2, prerequisites: l.prerequisites.length >= 1, intro: l.intro.length > 40,
      explanation: l.explanation.length >= 3, equations: l.equations.length >= 1, variables: l.variables.length >= 1, worked: typeof l.worked === 'function',
      interactive: !!(l.interactive && l.interactive.activity), practice: typeof l.practice === 'string', check: l.check.length >= 2, summary: l.summary.length > 40, misconceptions: l.misconceptions.length >= 1 };
    const missing = Object.keys(parts).filter((k) => !parts[k]);
    check(`lesson ${l.number} (${l.title}): all thirteen parts`, missing.length === 0, missing.join(', '));
    check(`lesson ${l.number}: every check question has a valid answer and an explanation`, l.check.every((x) => x.answer >= 0 && x.answer < x.options.length && x.why.length > 10));
    check(`lesson ${l.number}: its model is an existing example`, TM.EXAMPLES.some(([k]) => k === l.model));
  }
});

testCase('Worked examples use the solver\'s numbers (closed forms where they exist)', () => {
  for (const l of TL.LESSONS) {
    const m = TM.buildExample(l.model), r = analyse(m), w = l.worked(m, r);
    check(`lesson ${l.number}: the worked example is built from the real model`, Array.isArray(w) && w.length >= 3 && w.every((x) => typeof x.text === 'string' && (!x.q || Number.isFinite(x.q.value))));
  }
  const L = (id) => TL.lesson(id);
  const wf = L('trusses').worked(TM.buildExample('warren'), analyse(TM.buildExample('warren')));
  check('lesson 1: the Warren truss is determinate, m + r − 2j = 0', wf.find((x) => x.q && x.q.sym === 'm + r − 2j').q.value === 0);
  const af = TM.buildExample('aframe'), ra = analyse(af);
  const w3 = L('supports').worked(af, ra);
  near('lesson 3: each pin carries R_y = +50 kN (closed form, by symmetry)', w3.find((x) => x.q && x.q.sym === 'R_y (N1)').q.value, 50000, 1e-12);
  check('lesson 3: the reactions balance the load to round-off', Math.abs(w3.find((x) => x.q && x.q.sym === 'ΣF_y total').q.value) < 1e-9 * 100000);
  const w4 = L('stress').worked(af, ra);
  near('lesson 4: the bar force is the closed form −62.5 kN', w4[1].q.value, -62500, 1e-12);
  check('lesson 4: δ, N, σ and ε are the solver\'s own values', w4[0].q.value === ra.members[0].elong && w4[2].q.value === ra.members[0].stress && w4[3].q.value === ra.members[0].strain);
  const w6 = L('dsm').worked(af, ra);
  near('lesson 6: K[3x, 3x] = 2·(E·A/L)·c² = 28 800 kN/m (closed form)', w6[1].q.value, 2 * (200e9 * 1000e-6 / 5) * 0.36, 1e-14);
  near('lesson 6: u3y = −1.953125 mm (closed form in the example\'s title)', w6[2].q.value, -1.953125e-3, 1e-12);
  const ho = TM.buildExample('howe'), rh = analyse(ho), w5 = L('stability').worked(ho, rh);
  const k = rh.members.findIndex((x) => x.Pcr === w5[0].q.value);
  near('lesson 5: P_cr = π²EI/L² of the member named', w5[0].q.value, Math.PI * Math.PI * rh.members[k].E * rh.members[k].I / (rh.members[k].L ** 2), 1e-14);
  // for an unstable model no worked example may show a solver result: at most counts (m, r, j), which exist for any model
  check('a worked example shows no solver result for an unstable model (only counts, which every model has)', TL.LESSONS.every((l) => { const w = l.worked(TM.buildExample('mechanism'), analyse(TM.buildExample('mechanism'))); return w === null || w.every((it) => !it.q || it.q.kind === 'count'); }));
});

testCase('Challenges are judged on objective criteria from the model and the solver', () => {
  const L = (id) => TL.lesson(id);
  // lesson 5: the unstable panel fails until one diagonal is added in its open panel
  const mech = TM.buildExample('mechanism');
  check('lesson 5: the unstable panel does not pass as it is', !TL.evaluateChallenge(L('stability'), mech, analyse(mech)).passed);
  const n = (x, y) => mech.nodes.find((p) => p.x === x && p.y === y);
  mech.members.push(TM.makeMember(n(3, 0), n(6, 3), mech.groups[0]));
  const ev5 = TL.evaluateChallenge(L('stability'), mech, analyse(mech));
  check('... one diagonal makes it stable, and the challenge passes', ev5.passed && ev5.criteria.every((c) => c.pass));
  // lesson 3: two pins (4 restraints); a roller instead of one pin makes the two-bar frame a mechanism (2 + 3 − 6 = −1)
  const af = TM.buildExample('aframe');
  check('lesson 3: two pins (4 restraints) do not meet "exactly 3"', !TL.evaluateChallenge(L('supports'), af, analyse(af)).passed);
  const feet = af.nodes.filter((p) => p.y === 0);
  TM.setSupport(feet.find((p) => p.x === 6), 'rollerX');
  check('... a pin and a roller alone: the bars spread, a mechanism, so it does not pass', !analyse(af).ok && !TL.evaluateChallenge(L('supports'), af, analyse(af)).passed);
  af.members.push(TM.makeMember(feet[0], feet[1], af.groups[0]));
  const ev3 = TL.evaluateChallenge(L('supports'), af, analyse(af));
  check('... adding the tie between the feet makes it stable with 3 restraints: it passes', ev3.passed && analyse(af).ok);
  near('... and the tie carries the closed-form +37.5 kN (62.5 kN × 0.6)', analyse(af).members[2].force, 37500, 1e-12);
  // lesson 4: |σ| = 62.5 kN / 1000 mm² = 62.5 MPa > 50; with A = 1300 mm², 48.1 MPa
  const a4 = TM.buildExample('aframe');
  check('lesson 4: 62.5 MPa in the bars does not meet "at most 50 MPa"', !TL.evaluateChallenge(L('stress'), a4, analyse(a4)).passed);
  a4.groups.forEach((g) => { g.A = 1300e-6; g.shape = { type: 'custom' }; });
  check('... with A = 1300 mm² (48.1 MPa) it passes', TL.evaluateChallenge(L('stress'), a4, analyse(a4)).passed);
  // lesson 1 and 2
  check('lesson 1: an empty model does not pass; the Warren truss does', !TL.evaluateChallenge(L('trusses'), TM.emptyModel(), null).passed && TL.evaluateChallenge(L('trusses'), TM.buildExample('warren'), analyse(TM.buildExample('warren'))).passed);
  const p = TL.emptyProgress();
  check('lesson 2: passes only once the Pratt prediction was all correct', !TL.evaluateChallenge(L('axial'), af, null, p).passed && TL.evaluateChallenge(L('axial'), af, null, Object.assign(p, { exercises: { 'predict:pratt': true } })).passed);
  check('lesson 6 has no challenge', TL.evaluateChallenge(L('dsm'), af, null) === null);
  const q = TL.checkAnswer(L('stress'), 0, 2);
  check('the understanding check marks an answer and explains it', q.correct && /equilibrium/.test(q.why) && !TL.checkAnswer(L('stress'), 0, 0).correct);
});

testCase('Lesson progress in storage: safe under failures', () => {
  const key = TL.PROGRESS_KEYS.user;
  let s = fakeStorage();
  let r = TL.loadProgress(s, key);
  check('no stored progress: an empty record', r.ok && r.progress.completed.length === 0 && r.progress.current === null);
  const p = Object.assign(TL.emptyProgress(), { current: 'axial', completed: ['trusses', 'trusses', 'nope'], exercises: { 'quiz:axial:0': true, bad: 'x' } });
  check('saving writes a normalised record (duplicates and unknown lessons dropped) and reads it back', TL.saveProgress(s, key, p, {}).saved && JSON.parse(s.data.get(key)).completed.join() === 'trusses' && !('bad' in JSON.parse(s.data.get(key)).exercises));
  r = TL.loadProgress(s, key);
  check('reading it back gives the same progress', r.ok && r.progress.current === 'axial' && r.progress.exercises['quiz:axial:0'] === true);
  s = fakeStorage({ [key]: '{not json' });
  r = TL.loadProgress(s, key);
  check('unreadable stored text: empty progress, and the text is kept for a backup', r.ok && r.unreadable === '{not json' && r.progress.completed.length === 0);
  const st = { unreadable: r.unreadable };
  check('the first save copies the unreadable text to KEY.unreadable before replacing it', TL.saveProgress(s, key, TL.emptyProgress(), st).saved && s.data.get(`${key}.unreadable`) === '{not json');
  s.data.set(`${key}.unreadable`, 'older backup');
  TL.saveProgress(s, key, TL.emptyProgress(), { unreadable: 'newer junk' });
  check('an existing backup is never overwritten', s.data.get(`${key}.unreadable`) === 'older backup');
  s = fakeStorage({ [key]: JSON.stringify({ version: 1, completed: ['trusses'] }) });
  s.failGet = true;
  r = TL.loadProgress(s, key);
  check('a read that fails is not taken for "no progress"', !r.ok);
  s.failGet = false;
  check('... and nothing is written after it', !TL.saveProgress(s, key, TL.emptyProgress(), { readFailed: true }).saved && JSON.parse(s.data.get(key)).completed.join() === 'trusses');
  s.failSet = true;
  check('a write the browser refuses is reported as not saved', !TL.saveProgress(s, key, TL.emptyProgress(), {}).saved);
  s.failSet = false; s.corrupt = true;
  check('a write that does not read back is reported as not saved', !TL.saveProgress(s, key, TL.emptyProgress(), {}).saved);
  check('smoke mode has its own key, never the user\'s', TL.PROGRESS_KEYS.smoke !== TL.PROGRESS_KEYS.user && /smoke-test/.test(TL.PROGRESS_KEYS.smoke));
});

out('');
out(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => out(`  - ${f}`));
  if (typeof process !== 'undefined') process.exitCode = 1;
  else throw new Error(`${failures.length} check(s) failed`);
}
