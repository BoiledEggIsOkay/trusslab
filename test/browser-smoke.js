/*
 * test/browser-smoke.js - browser smoke test for TrussLab.
 *
 * Run it by opening index.html?smoke (open index.html, then add ?smoke to the address).
 * index.html?smoke=selftest also runs one deliberately failing scenario, to show that the
 * clean-up still restores everything when a test fails. Keep the tab in the foreground:
 * the app solves and draws on animation frames, which browsers pause in background tabs.
 *
 * What it does
 *   Drives the real application through its real event handlers (synthetic pointer,
 *   keyboard, click and change events) and observes the outcome through
 *   window.TrussLabTest, a small adapter that script.js installs only in smoke mode.
 *   It does not use window.TrussLab, the older hook that exposes internal state.
 *
 * Isolation
 *   - In smoke mode the app reads and writes its own storage keys, so the user's sessions
 *     (trusslab.session.v2, trusslab.session.v1 and backups of unreadable sessions) are never
 *     loaded or written. The test checks at the end that every one is byte-for-byte unchanged.
 *   - The whole application state is captured before the first scenario and restored in a
 *     finally block, whatever happened; pending autosaves are cancelled.
 *   - Each scenario runs in its own try/catch, so one failure does not stop the run.
 *
 * What synthetic events cannot verify
 *   - canvas.setPointerCapture() is replaced by a no-op during the run, because browsers
 *     reject pointer capture for synthetic pointers. Native pointer capture is not tested.
 *   - Synthetic events have no default actions: a synthetic Enter does not press a button
 *     and a synthetic arrow key does not move a slider. The test checks that the app leaves
 *     those keys alone (no preventDefault, no app action), not what the browser does next.
 *   - Only one branch of the side-panel button runs, chosen by the window width (920 px).
 */
(function () {
  'use strict';

  const T = window.TrussLabTest;
  const SELFTEST = /[?&]smoke=selftest(?:&|$)/.test(location.search);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const canvas = $('#canvas');

  /* ------------------------------------------------------------------ report panel */
  const COLORS = { pass: '#34d399', fail: '#f87171', skip: '#fbbf24', head: '#38bdf8' };
  const panel = document.createElement('div');
  panel.setAttribute('role', 'log');
  panel.style.cssText = 'position:fixed;top:54px;right:12px;z-index:300;width:min(480px,calc(100vw - 24px));' +
    'max-height:calc(100vh - 80px);overflow:auto;padding:10px 12px;background:#0d141d;color:#d5dde8;' +
    'border:1px solid #2e3c51;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.6);' +
    'font:12px/1.45 ui-monospace,Menlo,Consolas,monospace';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:600';
  const title = document.createElement('span');
  title.textContent = `TrussLab smoke test${SELFTEST ? ' (self-test mode)' : ''}: running. Please don't touch the page.`;
  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.textContent = 'Hide';
  hideBtn.style.cssText = 'font:inherit;color:inherit;background:#1b2533;border:1px solid #2e3c51;border-radius:4px;padding:1px 8px;cursor:pointer';
  hideBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.hidden = true; });
  const list = document.createElement('div');
  head.append(title, hideBtn);
  panel.append(head, list);
  document.body.appendChild(panel);

  const records = [];
  let scenarioName = '';
  function line(text, color, bold) {
    const d = document.createElement('div');
    d.textContent = text;
    if (color) d.style.color = color;
    if (bold) { d.style.fontWeight = '600'; d.style.marginTop = '8px'; }
    list.appendChild(d);
    panel.scrollTop = panel.scrollHeight;
  }
  function heading(name) {
    scenarioName = name;
    line(name, COLORS.head, true);
    console.log(`[smoke] ${name}`);
  }
  function record(status, name, detail) {
    records.push({ scenario: scenarioName, name, status, detail: detail || '' });
    const text = `${status.toUpperCase().padEnd(4)}  ${name}${detail ? ` (${detail})` : ''}`;
    line(text, COLORS[status]);
    (status === 'fail' ? console.error : console.log)(`[smoke] ${scenarioName} > ${text}`);
  }
  function check(name, ok, detail) { record(ok ? 'pass' : 'fail', name, ok ? '' : detail); return !!ok; }
  /** Like check(), but stops the scenario: later steps depend on this one. */
  function must(name, ok, detail) { if (!check(name, ok, detail)) throw new Error(`"${name}" failed, so the rest of this scenario was skipped`); }
  function near(name, got, want, tol) {
    const err = want === 0 ? Math.abs(got) : Math.abs(got / want - 1);
    return check(name, err <= tol, `got ${got}, expected ${want}`);
  }
  function skip(name, why) { record('skip', name, why); }

  /* ------------------------------------------------------------------ waiting */
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Two animation frames: enough for a queued solve (one frame) and the redraw after it. */
  async function settle() { await frame(); await frame(); }
  async function waitFor(what, predicate, ms) {
    const t0 = performance.now();
    while (!predicate()) {
      if (performance.now() - t0 > (ms || 3000)) throw new Error(`timed out waiting for ${what}`);
      await sleep(25);
    }
  }

  /* ------------------------------------------------------------------ input */
  function el(sel) {
    const e = typeof sel === 'string' ? $(sel) : sel;
    if (!e) throw new Error(`element not found: ${sel}`);
    return e;
  }
  /** Dispatches a pointer event on the canvas at model coordinates (x, y), in metres. */
  function pointer(type, x, y) {
    const p = T.worldToClient(x, y);
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: p.x, clientY: p.y,
      button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1,
    }));
  }
  async function click(x, y) { pointer('pointerdown', x, y); pointer('pointerup', x, y); await settle(); }
  async function drag(x0, y0, x1, y1) {
    pointer('pointerdown', x0, y0);
    pointer('pointermove', (x0 + x1) / 2, (y0 + y1) / 2);
    pointer('pointermove', x1, y1);
    pointer('pointerup', x1, y1);
    await settle();
  }
  function blurAll() {
    const a = document.activeElement;
    if (a && a !== document.body && typeof a.blur === 'function') a.blur();
  }
  /** keydown on `target` (focused first), or on the page with nothing focused. Returns the
   *  event: ev.defaultPrevented shows whether the app handled the key. */
  function key(k, target, mods) {
    if (target) target.focus(); else blurAll();
    const ev = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, mods));
    (target || document.body).dispatchEvent(ev);
    return ev;
  }
  function keyUp(k, target) {
    (target || document.body).dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));
  }
  const ctrl = (k, shift) => key(k, null, { ctrlKey: true, shiftKey: !!shift });
  function setValue(sel, value) { const e = el(sel); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); }
  function setChecked(sel, on) {
    const e = el(sel);
    if (e.checked !== on) { e.checked = on; e.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  const press = (sel) => el(sel).click();

  /* ------------------------------------------------------------------ model helpers */
  const model = () => T.model();
  const text = (sel) => el(sel).textContent || '';
  /** How often the health report lists the import note about the pin settlement in V1_SETTLED_FIXTURE. */
  const importNoteCount = () => (text('#health').match(/was not applied/g) || []).length;
  const pairs = () => model().members.map((m) => `${Math.min(m.n1, m.n2)}-${Math.max(m.n1, m.n2)}`);
  function memberForce(pair) {
    const i = pairs().indexOf(pair), r = T.results();
    return i >= 0 && r && r.ok ? r.members[i].force : NaN;
  }
  const FORCE_UNIT = { N: 1, kN: 1e3, MN: 1e6 };
  /** Load { fx, fy } on node index i (0-based) in the active load case, read from the saved format (version 2). */
  function loadOf(i) {
    const m = model(), lc = m.loadCases[m.activeLoadCase - 1], e = lc.loads.find((x) => x.node === i + 1);
    return e ? { fx: e.fx, fy: e.fy } : { fx: 0, fy: 0 };
  }
  /** Every user storage key with its value, to prove that the test never touches them. */
  const userKeysSnapshot = () => JSON.stringify(T.userStorageKeys.map((k) => [k, readStorage(k)]));
  function readStorage(k) {
    try { return localStorage.getItem(k); } catch (e) { return `(storage unavailable: ${e.message})`; }
  }
  /** Settings in the session saved under the smoke-test key, or null. */
  function savedSettings() {
    const raw = readStorage(T.storageKey);
    try { return raw ? JSON.parse(raw).settings : null; } catch (e) { return null; }
  }
  /** Waits until no autosave is queued, so the next one can be traced to a single action. */
  async function noAutosavePending() { await waitFor('earlier autosaves to finish', () => !T.autosavePending(), 2000); }
  async function loadExample(key) {
    const tok = T.resultsToken();
    setValue('#selExample', key);
    await waitFor(`example "${key}" to load`, () => T.resultsToken() !== tok);
    await settle();
  }
  /** Opens `text` through the real Open… file input. Returns false if the browser cannot do that. */
  async function openFile(content, name) {
    const input = el('#fileInput');
    try {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: 'application/json' }));
      input.files = dt.files;
    } catch (e) { return false; }
    const tok = T.resultsToken();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(`${name} to open`, () => T.resultsToken() !== tok);
    await settle();
    return true;
  }

  /** A model file in format version 1, written out by hand: the 3-4-5 A-frame. */
  const V1_FIXTURE = {
    format: 'trusslab-model', version: 1,
    units: { length: 'm', force: 'N', stress: 'Pa', area: 'm^2', inertia: 'm^4', angle: 'deg' },
    title: 'Smoke fixture: format version 1',
    materials: [{ id: 1, name: 'Structural Steel', preset: 'steel', E: 200e9, fy: 250e6, color: '#94a3b8' }],
    sections: [{ id: 1, name: 'Bar', material: 1, A: 1e-3, I: 1e-6, shape: { type: 'custom' }, color: '#38bdf8' }],
    nodes: [
      { id: 1, x: 0, y: 0, support: { type: 'pin', angle: 0, fixX: true, fixY: true, dx: 0, dy: 0 }, load: { fx: 0, fy: 0 } },
      { id: 2, x: 6, y: 0, support: { type: 'pin', angle: 0, fixX: true, fixY: true, dx: 0, dy: 0 }, load: { fx: 0, fy: 0 } },
      { id: 3, x: 3, y: 4, support: { type: 'none', angle: 0, fixX: false, fixY: false, dx: 0, dy: 0 }, load: { fx: 0, fy: -100000 } },
    ],
    members: [{ id: 1, n1: 1, n2: 3, section: 1 }, { id: 2, n1: 2, n2: 3, section: 1 }],
  };
  /** The same in version 1, with node 2 a custom support fixed along y′ that settles 10 mm, a tie 1-2, and a 5 mm
   *  settlement on the pin at node 1, which version 1 ignored: it is not applied, and an import note says so. */
  const V1_SETTLED_FIXTURE = Object.assign(JSON.parse(JSON.stringify(V1_FIXTURE)), { title: 'Smoke fixture: format version 1 with a settlement' });
  V1_SETTLED_FIXTURE.nodes[0].support = { type: 'pin', angle: 0, fixX: true, fixY: true, dx: 0, dy: -0.005 };
  V1_SETTLED_FIXTURE.nodes[1].support = { type: 'custom', angle: 0, fixX: false, fixY: true, dx: 0, dy: -0.01 };
  V1_SETTLED_FIXTURE.members.push({ id: 3, n1: 1, n2: 2, section: 1 });

  /* ------------------------------------------------------------------ scenarios */
  const scenarios = [];
  const scenario = (name, fn) => scenarios.push({ name, fn });
  let userKeysBefore = null; // every user storage key and its value, read before the first scenario
  let savedSession = null;      // written by the autosave scenario, opened by the Open… scenario

  scenario('Start-up', async () => {
    check('smoke mode stores its sessions under its own keys, never a user key',
      Object.values(T.storageKeys).every((k) => !T.userStorageKeys.includes(k)) && T.storageKey === T.storageKeys.v2, T.storageKey);
    must('the default example (Pratt truss) is loaded', /^Pratt truss/.test(model().title), `title "${model().title}"`);
    const r = T.results();
    must('the default example is solved', r && r.ok, r ? r.errors[0] : 'no results');
    check('the Select tool is active', T.tool() === 'select' && el('.tool[data-tool="select"]').classList.contains('on'), T.tool());
    check('the status bar counts the nodes', text('#sbCounts').startsWith(`${model().nodes.length} nodes`), text('#sbCounts'));
    check('the status pill reports a solved model', !/UNSTABLE|Cannot/.test(text('#statusPill')), text('#statusPill'));
  });

  scenario('Examples menu', async () => {
    await loadExample('aframe');
    const m = model();
    must('the A-frame example is loaded', /A-frame/.test(m.title) && m.nodes.length === 3 && m.members.length === 2, m.title);
    const r = T.results();
    must('it solves', r.ok, r.errors[0]);
    near('member 1 carries -62.5 kN (closed form)', r.members[0].force, -62.5e3, 1e-12);
    near('member 2 carries -62.5 kN (closed form)', r.members[1].force, -62.5e3, 1e-12);
  });

  scenario('Tool shortcuts and toolbar buttons', async () => {
    for (const [k, tool] of [['n', 'node'], ['m', 'member'], ['s', 'support'], ['l', 'load'], ['h', 'pan'], ['v', 'select']]) {
      key(k);
      check(`key ${k.toUpperCase()} selects the ${tool} tool`, T.tool() === tool && el(`.tool[data-tool="${tool}"]`).classList.contains('on'), `tool is ${T.tool()}`);
    }
    press('.tool[data-tool="node"]');
    check('the Node toolbar button selects the node tool and shows its X/Y fields', T.tool() === 'node' && !!$('#toolOptions #toX'));
    key('v');
  });

  // The next six scenarios edit the A-frame step by step, like a user would.
  scenario('Node tool: a click adds a node, snapped to the grid', async () => {
    must('starting from the A-frame example', /A-frame/.test(model().title) && model().nodes.length === 3);
    key('n');
    await click(3.1, 0.12);
    const ns = model().nodes;
    must('a fourth node was added', ns.length === 4, `${ns.length} nodes`);
    check('it snapped to the grid point (3, 0) exactly', ns[3].x === 3 && ns[3].y === 0, `(${ns[3].x}, ${ns[3].y})`);
    check('the new node is selected', T.selection().nodes.join() === '3', T.selection().nodes.join());
    check('the status bar shows 4 nodes', text('#sbCounts').startsWith('4 nodes'), text('#sbCounts'));
    const r = T.results();
    check('the model was re-solved (an unconnected node is only a warning)', r.ok && !r.stale);
  });

  scenario('Member tool: chained clicks connect nodes, Esc ends the chain', async () => {
    must('starting from the A-frame plus a free node 4', model().nodes.length === 4 && model().members.length === 2);
    key('m');
    await click(0, 0);
    await click(3, 0);
    await click(3, 4);
    must('two members were added', model().members.length === 4, `${model().members.length} members`);
    check('they connect nodes 1-4 and 3-4', pairs().includes('1-4') && pairs().includes('3-4'), pairs().join(', '));
    const r = T.results();
    check('the structure solves and both new members are zero-force (node 4 is unloaded)',
      r.ok && r.members[pairs().indexOf('1-4')].state === 'zero' && r.members[pairs().indexOf('3-4')].state === 'zero');
    key('Escape');
    await click(5, 2.5);
    check('after Esc, the next click starts a new chain instead of adding a member', model().members.length === 4);
    key('Escape');
  });

  scenario('Load tool: the typed load is applied to the clicked node', async () => {
    must('starting from the A-frame with hanger members', model().members.length === 4);
    key('l');
    setValue('#toFx', '0');
    setValue('#toFy', '-20');
    setValue('#toLoadMode', 'set');
    await click(3, 0);
    const n4 = loadOf(3), unit = FORCE_UNIT[T.settings().forceUnit];
    check('node 4 now carries Fy = -20 kN in the active load case', n4.fx === 0 && n4.fy === -20 * unit, `(${n4.fx}, ${n4.fy}) N`);
    near('the hanger 3-4 carries +20 kN tension (statics)', memberForce('3-4'), 20e3, 1e-12);
    near('each rafter now carries -75 kN (the 120 kN total is shared)', memberForce('1-3'), -75e3, 1e-12);
    near('member 1-4 stays at zero force', memberForce('1-4'), 0, 1e-6);
  });

  scenario('Support tool: a misplaced roller is reported as unstable, then fixed', async () => {
    must('starting from the loaded hanger model', model().nodes.length === 4 && loadOf(3).fy < 0);
    key('s');
    setValue('#toSupType', 'rollerX');
    await click(6, 0);
    check('node 2 is now a roller', model().nodes[1].support.type === 'rollerX', model().nodes[1].support.type);
    let r = T.results();
    check('the analysis refuses to solve and reports a mechanism', !r.ok && !!r.mechanism && r.mechanism.nullity >= 1);
    check('the status pill says UNSTABLE', /UNSTABLE/.test(text('#statusPill')), text('#statusPill'));
    check('the warning banner is shown', !el('#banner').hidden);
    check('the health report says UNSTABLE', /UNSTABLE/.test(text('#health')));
    check('the inspector shows no results for the selected node', /unstable/i.test(text('#insResults')), text('#insResults'));
    setValue('#toSupType', 'pin');
    await click(6, 0);
    r = T.results();
    check('node 2 is a pin again and the structure solves', model().nodes[1].support.type === 'pin' && r.ok);
    check('the warning banner is gone', el('#banner').hidden);
  });

  scenario('Undo and redo: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z and the toolbar buttons', async () => {
    const type = () => model().nodes[1].support.type;
    must('starting with node 2 pinned', type() === 'pin', type());
    ctrl('z'); await settle();
    check('Ctrl+Z restores the roller and the unstable result', type() === 'rollerX' && !T.results().ok, type());
    press('#btnRedo'); await settle();
    check('the Redo button brings the pin back', type() === 'pin' && T.results().ok, type());
    press('#btnUndo'); await settle();
    check('the Undo button restores the roller', type() === 'rollerX', type());
    ctrl('y'); await settle();
    check('Ctrl+Y redoes', type() === 'pin', type());
    ctrl('z'); await settle();
    ctrl('Z', true); await settle();
    check('Ctrl+Shift+Z redoes', type() === 'pin', type());
    check('the Redo button is disabled with nothing left to redo', el('#btnRedo').disabled && T.history().redo === 0);
  });

  scenario('Select tool: click, drag with snapping, Delete and box selection', async () => {
    must('starting from the hanger model with node 2 pinned', model().nodes.length === 4 && model().nodes[1].support.type === 'pin');
    key('v');
    await click(3, 0);
    check('clicking node 4 selects it', T.selection().nodes.join() === '3' && T.selection().members.length === 0);
    check('the inspector shows node N4', /Node N4/.test(text('#inspector')));
    await drag(3, 0, 3.4, -0.9);
    let n = model().nodes[3];
    check('dragging moves it to the nearest grid point (3.5, -1)', n.x === 3.5 && n.y === -1, `(${n.x}, ${n.y})`);
    ctrl('z'); await settle();
    n = model().nodes[3];
    must('Ctrl+Z puts it back at (3, 0)', n.x === 3 && n.y === 0, `(${n.x}, ${n.y})`);
    await click(3, 0);
    key('Delete'); await settle();
    check('Delete removes the node and its two members', model().nodes.length === 3 && model().members.length === 2);
    ctrl('z'); await settle();
    must('Ctrl+Z brings them back', model().nodes.length === 4 && model().members.length === 4);
    await drag(-1, 5, 7, -1.5);
    const s = T.selection();
    check('dragging a box on empty space selects everything inside it', s.nodes.length === 4 && s.members.length === 4, `${s.nodes.length} nodes, ${s.members.length} members`);
    key('Escape');
    check('Esc clears the selection', T.selection().nodes.length === 0 && T.selection().members.length === 0);
  });

  scenario('Arrow keys: nudge the selection, but leave focused sliders and radios alone', async () => {
    key('v');
    await click(3, 0);
    must('node 4 is selected at x = 3', T.selection().nodes.join() === '3' && model().nodes[3].x === 3);
    let ev = key('ArrowRight'); await settle();
    check('ArrowRight on the page nudges the node one grid step', ev.defaultPrevented && model().nodes[3].x === 3.5, `x = ${model().nodes[3].x}`);
    ctrl('z'); await settle();
    await click(3, 0);
    must('node 4 is back at x = 3 and selected', model().nodes[3].x === 3 && T.selection().nodes.join() === '3');
    ev = key('ArrowRight', el('#rngLoadFactor')); await settle();
    check('ArrowRight on a focused slider is left to the slider', !ev.defaultPrevented && model().nodes[3].x === 3);
    ev = key('ArrowDown', el('#groupsList input[type=radio]')); await settle();
    check('ArrowDown on a focused radio button is left to the radio group', !ev.defaultPrevented && model().nodes[3].x === 3);
    blurAll();
  });

  scenario('Enter and Space: shortcuts on the page, native behaviour on focused controls', async () => {
    let tok = T.resultsToken();
    let ev = key('Enter');
    check('Enter on the page runs Solve', ev.defaultPrevented && T.resultsToken() !== tok);
    tok = T.resultsToken();
    ev = key('Enter', el('#btnFit')); await settle();
    check('Enter on a focused button is left to the button (no Solve)', !ev.defaultPrevented && T.resultsToken() === tok);
    ev = key('Enter', el('#leftPanel summary'));
    check('Enter on a focused panel heading is left to the heading', !ev.defaultPrevented);
    ev = key(' '); keyUp(' ');
    check('Space on the page is taken for space-drag panning', ev.defaultPrevented);
    const snapBefore = T.settings().snap;
    ev = key(' ', el('#chkSnap')); keyUp(' ', el('#chkSnap'));
    check('Space on a focused checkbox is left to the checkbox', !ev.defaultPrevented && T.settings().snap === snapBefore);
    ev = key(' ', el('#btnFit')); keyUp(' ', el('#btnFit'));
    check('Space on a focused button is left to the button', !ev.defaultPrevented);
    blurAll();
  });

  // Regression checks: D used to leave the colour legend unchanged, and neither D nor G autosaved.
  scenario('Display and snapping shortcuts: D and G', async () => {
    must('starting from a solved model', T.results().ok);
    for (const press of ['first', 'second']) {
      await noAutosavePending();
      const before = T.settings().showDeformed;
      key('d');
      const after = T.settings().showDeformed;
      check(`D (${press} press) toggles the deformed shape and its checkbox`, after === !before && el('[data-show="showDeformed"]').checked === after);
      check(`D (${press} press) shows or hides the colour legend with it`, el('#legend').hidden === !after,
        `legend ${el('#legend').hidden ? 'hidden' : 'shown'}, deformed shape ${after ? 'shown' : 'hidden'}`);
      check(`D (${press} press) schedules an autosave`, T.autosavePending());
      await sleep(500);
      const saved = savedSettings();
      check(`D (${press} press) is recorded in the saved session`, !!saved && saved.showDeformed === after, saved ? `saved ${saved.showDeformed}` : 'nothing saved');
    }
    for (const press of ['first', 'second']) {
      await noAutosavePending();
      const before = T.settings().snap;
      key('g');
      const after = T.settings().snap;
      check(`G (${press} press) toggles grid snapping, its checkbox and the status bar`,
        after === !before && el('#chkSnap').checked === after && text('#sbSnap') === (after ? `snap ${T.settings().grid} m` : 'snap off'), text('#sbSnap'));
      check(`G (${press} press) schedules an autosave`, T.autosavePending());
      await sleep(500);
      const saved = savedSettings();
      check(`G (${press} press) is recorded in the saved session`, !!saved && saved.snap === after, saved ? `saved ${saved.snap}` : 'nothing saved');
    }
  });

  scenario('Section-group radios set the group used for new members', async () => {
    await loadExample('pratt');
    key('m');
    const radios = $$('#groupsList input[type=radio]');
    must('the Pratt example has two section groups', radios.length >= 2, `${radios.length} groups`);
    radios[1].checked = true;
    radios[1].dispatchEvent(new Event('change', { bubbles: true }));
    check("choosing group 2 updates the Member tool's Section list", el('#toGroup').value === '1', `value ${el('#toGroup').value}`);
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change', { bubbles: true }));
    check('choosing group 1 switches it back', el('#toGroup').value === '0', `value ${el('#toGroup').value}`);
    key('v');
  });

  scenario('Help dialog: ? opens it, Esc closes it', async () => {
    key('?');
    check('? opens the help dialog', !el('#helpModal').hidden);
    key('Escape');
    check('Esc closes it', el('#helpModal').hidden);
  });

  scenario('Bottom panel: tables, matrix inspector and solver log', async () => {
    press('.tab[data-tab="members"]');
    const rows = $$('#tab-members tbody tr').length;
    check('the Members table has one row per member', rows === model().members.length, `${rows} rows`);
    press('.tab[data-tab="nodes"]');
    check('the Nodes table is shown with a row per node', !el('#tab-nodes').hidden && $$('#tab-nodes tbody tr').length >= model().nodes.length);
    press('.tab[data-tab="matrix"]');
    check('the matrix tab shows a matrix', !el('#tab-matrix').hidden && !!$('#mtxView table.mtx, #mtxView canvas'));
    press('#segMatrix button[data-mtx="reduced"]');
    check('the Reduced [Kff] button becomes the active view',
      el('#segMatrix button[data-mtx="reduced"]').classList.contains('on') && !el('#segMatrix button[data-mtx="global"]').classList.contains('on') && /Reduced/.test(text('#mtxView')));
    press('#segMtxMode button[data-mode="heatmap"]');
    check('Heatmap mode draws a canvas', !!$('#mtxView canvas') && el('#segMtxMode button[data-mode="heatmap"]').classList.contains('on'));
    press('#segMtxMode button[data-mode="table"]');
    check('Table mode draws a table', !!$('#mtxView table.mtx'));
    press('#segMatrix button[data-mtx="global"]');
    press('.tab[data-tab="log"]');
    check('the solver log shows the last analysis', /Analysis completed/.test(text('#logText')));
  });

  scenario('Export menu opens and closes (nothing is downloaded)', async () => {
    press('#btnExport');
    check('the Export button opens the menu', !el('#exportMenu').hidden);
    document.body.click();
    check('clicking elsewhere closes it', el('#exportMenu').hidden);
  });

  scenario('Side-panel button', async () => {
    const w = window.innerWidth, app = el('#app');
    const shown = (sel) => getComputedStyle(el(sel)).display !== 'none';
    if (w > 920) {
      press('#btnPanels');
      check(`wide window (${w} px): a click hides both side panels`, app.classList.contains('no-panels') && !shown('#leftPanel') && !shown('#rightPanel'));
      press('#btnPanels');
      check('a second click shows them again', !app.classList.contains('no-panels') && shown('#leftPanel') && shown('#rightPanel'));
      skip('narrow-window cycle (left, right, none)', `needs a window 920 px wide or less; this one is ${w} px`);
    } else {
      press('#btnPanels');
      check(`narrow window (${w} px): the first click shows only the left panel`, shown('#leftPanel') && !shown('#rightPanel'));
      press('#btnPanels');
      check('the second click shows only the right panel', !shown('#leftPanel') && shown('#rightPanel'));
      press('#btnPanels');
      check('the third click hides both', !shown('#leftPanel') && !shown('#rightPanel'));
      skip('wide-window toggle', `needs a window wider than 920 px; this one is ${w} px`);
    }
  });

  scenario('Load cases: add, rename, switch and delete; undo keeps the case you are looking at', async () => {
    await loadExample('aframe');
    const cases = () => model().loadCases, active = () => model().activeLoadCase;
    must('one load case to start with, and Delete is disabled', cases().length === 1 && el('#btnDeleteCase').disabled);
    press('#btnAddCase'); await settle();
    check('+ New adds "Load case 2" and makes it active', cases().length === 2 && cases()[1].name === 'Load case 2' && active() === 2 && el('#selLoadCase').value === '1');
    check('the new case is empty: every member is zero-force', T.results().ok && T.results().members.every((m) => m.state === 'zero'));
    key('l');
    setValue('#toFx', '0'); setValue('#toFy', '-10'); setValue('#toLoadMode', 'set');
    await click(3, 4);
    check('the Load tool writes into the active case only', JSON.stringify(cases()[1].loads) === JSON.stringify([{ node: 3, fx: 0, fy: -10000 }]) && cases()[0].loads[0].fy === -100000);
    setValue('#txtCaseName', 'Wind'); await settle();
    check('the name field renames the active case, in the list too', cases()[1].name === 'Wind' && /<option value="1"[^>]*>Wind<\/option>/.test(el('#selLoadCase').innerHTML));
    const undoBefore = T.history().undo;
    setValue('#selLoadCase', '0'); await settle();
    check('switching to case 1 adds no undo step', active() === 1 && T.history().undo === undoBefore);
    near('case 1 is analysed: -62.5 kN in each rafter', T.results().members[0].force, -62.5e3, 1e-12);
    ctrl('z'); await settle();
    check('Ctrl+Z undoes the rename and keeps case 1 active', cases()[1].name === 'Load case 2' && active() === 1, `active ${active()}, name ${cases()[1].name}`);
    setValue('#selLoadCase', '1'); await settle();
    ctrl('z'); await settle();
    check('Ctrl+Z undoes the load in case 2 and keeps case 2 active', active() === 2 && cases()[1].loads.length === 0, `active ${active()}`);
    ctrl('z'); await settle();
    check('Ctrl+Z undoes adding case 2: it is gone, so a valid case (case 1) is active', cases().length === 1 && active() === 1);
    press('#btnAddCase'); await settle();
    press('#btnDeleteCase'); await settle();
    check('Delete removes the active case; with one case left Delete is disabled again', cases().length === 1 && el('#btnDeleteCase').disabled);
    key('v');
  });

  scenario('λ scales loads and settlements alike; λ = 0 is the zero-action state of a stable structure', async () => {
    await loadExample('settlement');
    setValue('#numLoadFactor', '2'); await settle();
    const r2 = T.results();
    check('λ = 2: the settled support moves 2 × 10 mm', r2.ok && r2.nodes[4].uy === 2 * -0.01, `uy = ${r2.nodes[4].uy}`);
    setValue('#numLoadFactor', '0'); await settle();
    const r0 = T.results();
    check('λ = 0: no displacements, member forces or reactions', r0.ok && r0.nodes.every((n) => n.ux === 0 && n.uy === 0 && n.rx === 0 && n.ry === 0) && r0.members.every((m) => m.force === 0));
    await loadExample('mechanism');
    check('λ = 0 does not make a mechanism stable', !T.results().ok && !!T.results().mechanism && /UNSTABLE/.test(text('#statusPill')));
    setValue('#numLoadFactor', '1'); await settle();
  });

  scenario('A custom support that restrains nothing is kept, and warned about', async () => {
    await loadExample('aframe');
    key('v');
    await click(6, 0);
    must('node 2 is selected', T.selection().nodes.join() === '1');
    setValue('#inspector [data-f="stype"]', 'custom'); await settle();
    const s0 = model().nodes[1].support;
    check('choosing Custom fixes both axes (existing behaviour)', s0.type === 'custom' && s0.fixX && s0.fixY);
    setChecked('#inspector [data-f="sfixx"]', false); await settle();
    setChecked('#inspector [data-f="sfixy"]', false); await settle();
    const s = model().nodes[1].support;
    check('with both axes cleared the support stays custom and restrains nothing', s.type === 'custom' && s.fixX === false && s.fixY === false);
    check('the health report warns that it provides no restraint', /provides no restraint/.test(text('#health')));
    check('the Inspector warns about it too', /provides no restraint/.test(text('#inspector')));
  });

  scenario('Switching a support to Custom keeps its frame angle, 0° included, and its settlement direction', async () => {
    must('displacements are entered in mm', T.settings().dispUnit === 'mm');
    const settlements = () => JSON.stringify(model().loadCases[model().activeLoadCase - 1].settlements);
    await loadExample('aframe');
    key('v');
    await click(0, 0);
    must('node 1, a pin (α = 0°), is selected', T.selection().nodes.join() === '0' && model().nodes[0].support.type === 'pin');
    setValue('#inspector [data-f="sdy"]', '-10'); await settle();
    must('a 10 mm settlement along y′ is entered', settlements() === JSON.stringify([{ node: 1, dx: 0, dy: -10 * 1e-3 }]), settlements());
    let before = T.results();
    setValue('#inspector [data-f="stype"]', 'custom'); await settle();
    let s = model().nodes[0].support, after = T.results();
    check('pin → Custom: the frame stays at α = 0° (not 30°), with both axes fixed', s.type === 'custom' && s.angle === 0 && s.fixX && s.fixY, `α = ${s.angle}°`);
    check('... the settlement still acts straight down, u = (0, −10 mm), and every result is unchanged',
      settlements() === JSON.stringify([{ node: 1, dx: 0, dy: -10 * 1e-3 }]) && after.ok && after.nodes[0].ux === 0 && after.nodes[0].uy === -10 * 1e-3 && sameResults(before, after));
    await loadExample('inclined');
    await click(6, 0);
    must('node 2, the roller on the 30° surface, is selected', T.selection().nodes.join() === '1' && model().nodes[1].support.angle === 30);
    setValue('#inspector [data-f="sdy"]', '-5'); await settle();
    before = T.results();
    setValue('#inspector [data-f="stype"]', 'custom'); await settle();
    s = model().nodes[1].support; after = T.results();
    check('inclined roller at 30° → Custom: keeps α = 30° and the same fixed axis (y′ only)', s.type === 'custom' && s.angle === 30 && !s.fixX && s.fixY, JSON.stringify(s));
    check('... the 5 mm settlement along the surface normal is unchanged, and so is every result',
      settlements() === JSON.stringify([{ node: 2, dx: 0, dy: -5 * 1e-3 }]) && before.ok && sameResults(before, after));
    setValue('#inspector [data-f="stype"]', 'inclined'); await settle();
    check('Custom → inclined roller: keeps α = 30°', model().nodes[1].support.type === 'inclined' && model().nodes[1].support.angle === 30);
    setValue('#inspector [data-f="sangle"]', '0'); await settle();
    before = T.results();
    setValue('#inspector [data-f="stype"]', 'custom'); await settle();
    s = model().nodes[1].support; after = T.results();
    check('inclined roller at α = 0° → Custom: stays at 0° (not 30°)', s.type === 'custom' && s.angle === 0 && !s.fixX && s.fixY, `α = ${s.angle}°`);
    check('... the settlement still acts straight down, uy = −5 mm, and every result is unchanged',
      after.ok && after.nodes[1].uy === -5 * 1e-3 && sameResults(before, after));
  });

  scenario('Self-weight: a generated load case, W = ρ·A·L·g with half at each end node, recalculated after every change', async () => {
    await loadExample('aframe'); // two 5 m steel bars, A = 1000 mm²: each weighs 7850 · 0.001 · 5 · 9.80665 = 384.9110125 N
    const g = 9.80665, cases = () => model().loadCases, active = () => model().activeLoadCase;
    const sumRy = (r) => r.nodes.reduce((t, n) => t + n.ry, 0);
    const total = () => { // Σ ρ·A·L·g from the model on screen
      const f = model();
      return f.members.reduce((t, e) => {
        const a = f.nodes[e.n1 - 1], b = f.nodes[e.n2 - 1], sec = f.sections[e.section - 1];
        return t + f.materials[sec.material - 1].density * sec.A * Math.hypot(b.x - a.x, b.y - a.y) * g;
      }, 0);
    };
    must('one load case, no self-weight case yet, and "+ Self-weight case" is enabled', cases().length === 1 && !el('#btnAddSelfWeight').disabled && el('#selfWeightNote').hidden);
    const mi = model().sections[model().members[0].section - 1].material - 1, densitySel = `#materialsList .mat-card[data-mi="${mi}"] [data-mf="density"]`;
    must('the material card shows the steel density, 7850 kg/m³', !!el(densitySel) && el(densitySel).value === '7850');
    const before = T.results();
    press('#btnAddSelfWeight'); await settle();
    check('the button adds a generated case named "Self-weight" and makes it active; the button is then disabled',
      cases().length === 2 && cases()[1].generated === 'self-weight' && cases()[1].name === 'Self-weight' && active() === 2 && el('#btnAddSelfWeight').disabled);
    check('the case list marks it as generated, and a note explains it', /Self-weight \(generated\)/.test(el('#selLoadCase').innerHTML) && !el('#selfWeightNote').hidden);
    check('no loads are stored with it: they are computed from the members', cases()[1].loads.length === 0 && cases()[1].settlements.length === 0);
    near('the reactions carry the whole weight: ΣR_y = 2 × 384.9110125 N', sumRy(T.results()), 2 * 384.9110125, 1e-12);
    near('... and each rafter carries −W / (2 sin θ) = −240.569382813 N from the apex load W', T.results().members[0].force, -384.9110125 / 1.6, 1e-12);
    check('the health report says where the loads come from', /Self-weight \(generated\)/.test(text('#health')) && /ρ·A·L·g/.test(text('#health')));
    key('l'); setValue('#toFx', '0'); setValue('#toFy', '-10'); setValue('#toLoadMode', 'set');
    const stored = JSON.stringify(cases());
    await click(3, 4);
    check('the Load tool puts nothing into the generated case', JSON.stringify(cases()) === stored && cases()[1].loads.length === 0);
    key('v');
    await click(3, 4);
    check('the Inspector shows the apex load read-only, with where it comes from, and no load fields',
      /Self-weight load in/.test(text('#inspector')) && /Half the weight of each member/.test(text('#inspector')) && !/data-f="(fx|fy|fmag|fang|sdx|sdy)"/.test(el('#inspector').innerHTML));
    must('the apex Y field is shown', !!el('#inspector [data-f="y"]'));
    setValue('#inspector [data-f="y"]', '8'); await settle(); // geometry: both bars become √73 m long
    near('moving the apex recalculates the weight: ΣR_y = Σρ·A·L·g with the new lengths', sumRy(T.results()), total(), 1e-12);
    near('... which is 2 · 7850 · 0.001 · √73 · g', total(), 2 * 7850 * 0.001 * Math.sqrt(73) * g, 1e-12);
    ctrl('z'); await settle();
    near('Ctrl+Z moves it back, and the weight with it', sumRy(T.results()), 2 * 384.9110125, 1e-12);
    setValue(densitySel, '15700'); await settle();
    near('doubling the steel density doubles the self-weight (recalculated at once)', sumRy(T.results()), 4 * 384.9110125, 1e-12);
    ctrl('z'); await settle();
    check('Ctrl+Z restores the density', el(densitySel).value === '7850' && Math.abs(sumRy(T.results()) / (2 * 384.9110125) - 1) < 1e-12);
    setValue(densitySel, ''); await settle(); // no density: the case must say it is incomplete, never pass for the whole weight
    check('clearing the steel density leaves the members weightless: ΣR_y = 0', el(densitySel).value === '' && sumRy(T.results()) === 0);
    check('... and the case is marked incomplete in the health report, naming the members, and on the canvas',
      /Incomplete self-weight: members M1, M2/.test(text('#health')) && /from 0 of 2 members only/.test(text('#health')) && /Self-weight incomplete/.test(text('#hud')), text('#hud'));
    await click(3, 4);
    check('... and in the Inspector for the apex node', /Incomplete: M1, M2 have no density/.test(text('#inspector')));
    ctrl('z'); await settle();
    check('Ctrl+Z restores the density, and the case is no longer marked incomplete',
      el(densitySel).value === '7850' && !/Incomplete/.test(text('#health')) && !/incomplete/.test(text('#hud')) && Math.abs(sumRy(T.results()) / (2 * 384.9110125) - 1) < 1e-12);
    setValue('#numLoadFactor', '2'); await settle();
    near('λ = 2 doubles the self-weight reactions', sumRy(T.results()), 4 * 384.9110125, 1e-12);
    setValue('#numLoadFactor', '1'); await settle();
    await click(1.5, 2);
    check('selecting a member shows its weight with the numbers: W = ρ·A·L·g = 7850 kg/m³ × 1000 mm² × 5 m × 9.80665 m/s²',
      /W = ρ·A·L·g/.test(text('#inspector')) && /7850 kg\/m³/.test(text('#inspector')) && /9\.80665 m\/s²/.test(text('#inspector')));
    setValue('#selLoadCase', '0'); await settle();
    check('"Load case 1" is unchanged: the same 100 kN apex load and exactly the same results as before',
      active() === 1 && cases()[0].loads[0].fy === -100000 && T.results().members.every((m, i) => m.force === before.members[i].force) && el('#selfWeightNote').hidden);
    T.saveNow();
    const rr = T.reloadStoredSession(); await settle();
    check('after saving and reloading the session the case is still generated, and nothing was stored with it',
      rr.restored && cases().length === 2 && cases()[1].generated === 'self-weight' && cases()[1].loads.length === 0);
    setValue('#selLoadCase', '1'); await settle();
    near('... and it gives the same self-weight results', sumRy(T.results()), 2 * 384.9110125, 1e-12);
    press('#btnDeleteCase'); await settle();
    check('deleting it leaves "Load case 1", and the button is enabled again', cases().length === 1 && active() === 1 && !el('#btnAddSelfWeight').disabled);
  });

  scenario('Opening version 1 files: the λ notice appears only with a settlement, and stays dismissed', async () => {
    if (typeof DataTransfer !== 'function') { skip('opening files', 'this browser cannot build a file list (no DataTransfer)'); return; }
    must('the notice is hidden to start with', el('#updateNotice').hidden);
    if (!(await openFile(JSON.stringify(V1_FIXTURE), 'smoke-no-settlement-v1.truss.json'))) { skip('opening files', 'this browser cannot set files on a file input'); return; }
    check('a version 1 file without a settlement: no notice', el('#updateNotice').hidden);
    await openFile(JSON.stringify({ meta: { loadFactor: 1 }, model: V1_SETTLED_FIXTURE, status: 'solved' }), 'smoke-settlement-v1-report.json');
    check('a version 1 report file (model nested under "model") opens, its settlement in Load case 1',
      model().title === V1_SETTLED_FIXTURE.title && JSON.stringify(model().loadCases[0].settlements) === JSON.stringify([{ node: 2, dx: 0, dy: -0.01 }]));
    check('... and the λ notice appears', !el('#updateNotice').hidden && /scales nodal loads and prescribed support settlements alike/.test(text('#updateNotice')));
    check('the settlement on the pin, which version 1 ignored, is listed once under "Import notes" in the health report',
      /Import notes/.test(text('#health')) && importNoteCount() === 1, text('#health').slice(0, 200));
    if (!T.saveNow().saved) skip('import notes after a restart', 'this browser did not store the session');
    else {
      T.reloadStoredSession(); await settle(); // as at the next start: the saved session is read back
      check('after the session is saved and read back, the import note is still listed, once', /Import notes/.test(text('#health')) && importNoteCount() === 1);
    }
    ctrl('z'); await settle();
    check('Ctrl+Z goes back to the model opened before, with its own import notes (none)', model().title === V1_FIXTURE.title && !/Import notes/.test(text('#health')));
    ctrl('y'); await settle();
    check('Ctrl+Y brings the report\'s model back, with its import note', model().title === V1_SETTLED_FIXTURE.title && importNoteCount() === 1);
    press('#btnDismissNotice'); await settle();
    check('"Got it" hides the notice and remembers it', el('#updateNotice').hidden && T.settings().lambdaNoticeDismissed === true);
    await openFile(JSON.stringify(V1_SETTLED_FIXTURE), 'smoke-settlement-v1.truss.json');
    check('once dismissed it does not come back', el('#updateNotice').hidden);
    await loadExample('pratt');
    check('loading another model clears the import notes', !/Import notes/.test(text('#health')) && importNoteCount() === 0);
  });

  scenario('Saved sessions in this browser: migration and failure notes (smoke-test keys only)', async () => {
    if (typeof Storage !== 'function' || !Storage.prototype) { skip('storage scenarios', 'this browser does not expose Storage'); return; }
    const K = T.storageKeys, realGet = Storage.prototype.getItem, realSet = Storage.prototype.setItem, realRemove = Storage.prototype.removeItem;
    try {
      localStorage.removeItem(K.v2);
      localStorage.setItem(K.v1, JSON.stringify({ model: V1_SETTLED_FIXTURE, settings: { grid: 1, forceUnit: 'MN' }, view: { cx: 2, cy: 1, zoom: 44 } }));
      const res = T.reloadStoredSession(); await settle();
      check('a version 1 session is loaded and migrated', res.restored && res.source === 'v1' && model().title === V1_SETTLED_FIXTURE.title);
      const v2 = readStorage(K.v2);
      check('it is written under the version 2 key, verified, and then the version 1 key is removed', v2 !== null && readStorage(K.v1) === null && JSON.parse(v2).model.version === 2);
      check('its settings and view are kept', T.settings().grid === 1 && T.settings().forceUnit === 'MN' && JSON.parse(v2).view.zoom === 44);
      check('its import note (the pin settlement version 1 ignored) is listed once', importNoteCount() === 1);
      T.reloadStoredSession(); await settle();
      check('at the next start, now from version 2, the import note is still listed, once', /Import notes/.test(text('#health')) && importNoteCount() === 1);
      Storage.prototype.setItem = function (k, v) { if (k === K.v2) throw new Error('QuotaExceededError (simulated)'); return realSet.call(this, k, v); };
      T.saveNow();
      check('a failed save shows a persistent note in the status bar: "Changes not saved — browser storage unavailable"',
        !el('#sbSave').hidden && text('#sbSave') === 'Changes not saved — browser storage unavailable', text('#sbSave'));
      Storage.prototype.setItem = realSet;
      T.saveNow();
      check('the next successful save clears it', el('#sbSave').hidden);
      localStorage.removeItem(K.v2);
      localStorage.setItem(K.v1, JSON.stringify({ model: V1_FIXTURE, settings: {}, view: {} }));
      Storage.prototype.removeItem = function (k) { if (k === K.v1) throw new Error('removal failed (simulated)'); return realRemove.call(this, k); };
      T.reloadStoredSession(); await settle();
      check('if only removing the old version 1 key fails, a different note says so, and the key is kept',
        !el('#sbSave').hidden && /^Saved\. The old version 1 session could not be removed yet/.test(text('#sbSave')) && readStorage(K.v1) !== null, text('#sbSave'));
      Storage.prototype.removeItem = realRemove;
      T.saveNow();
      check('the next save removes it and clears the note', readStorage(K.v1) === null && el('#sbSave').hidden);
      // a read that fails must not be taken for a missing session
      // the version 1 session holds a different model, so a migration over version 2 would show
      const v1Text = JSON.stringify({ model: V1_SETTLED_FIXTURE, settings: {}, view: {} }), v2Text = readStorage(K.v2), title = model().title;
      localStorage.setItem(K.v1, v1Text);
      Storage.prototype.getItem = function (k) { if (k === K.v2) throw new Error('read failed (simulated)'); return realGet.call(this, k); };
      const rf = T.reloadStoredSession(); await settle();
      check('if the version 2 key cannot be read, nothing is loaded in its place: the version 1 session is not migrated over it',
        !rf.restored && rf.source === 'none' && model().title === title, JSON.stringify(rf));
      check('... the status bar says "Changes not saved — browser storage unavailable"', !el('#sbSave').hidden && text('#sbSave') === 'Changes not saved — browser storage unavailable', text('#sbSave'));
      const rs = T.saveNow();
      Storage.prototype.getItem = realGet;
      check('... and saving writes nothing: both stored sessions are unchanged', !rs.saved && readStorage(K.v2) === v2Text && readStorage(K.v1) === v1Text);
      localStorage.removeItem(K.v1);
      T.reloadStoredSession(); await settle(); // reads work again, as after reloading the page
      const rr = T.saveNow();
      check('once the keys can be read again, saving resumes and the note clears', rr.saved && el('#sbSave').hidden, JSON.stringify(rr));
    } finally {
      Storage.prototype.getItem = realGet;
      Storage.prototype.setItem = realSet;
      Storage.prototype.removeItem = realRemove;
      await applyTestSettings(); // the stored sessions above carried other settings (1 m grid, MN)
    }
  });

  scenario('Autosave writes the current model (under the smoke-test key)', async () => {
    await loadExample('fink');
    check('an autosave is scheduled after the change', T.autosavePending());
    await sleep(700);
    check('the autosave has run', !T.autosavePending());
    savedSession = readStorage(T.storageKey);
    must('a session was saved under the smoke-test key', typeof savedSession === 'string' && savedSession.length > 0);
    check('the saved model matches the model on screen', JSON.stringify(JSON.parse(savedSession).model) === JSON.stringify(model()));
    // the page keeps names to the file reader's limits, so the saved session restores exactly the model on screen
    must('the model title field is shown when nothing is selected', !!el('#inspector [data-f="title"]'));
    setValue('#inspector [data-f="title"]', 'T'.repeat(130));
    check('a 130-character title is cut to the 120 characters a file keeps', model().title === 'T'.repeat(120), `${model().title.length} characters`);
    await sleep(700);
    check('... and the session still saves and verifies: no "not saved" note, and the stored title is the same',
      el('#sbSave').hidden && JSON.parse(readStorage(T.storageKey)).model.title === 'T'.repeat(120));
    check('no user storage key was written', userKeysSnapshot() === userKeysBefore);
  });

  scenario('Open…: a saved session and a format-version-1 model file', async () => {
    if (typeof DataTransfer !== 'function') { skip('opening files', 'this browser cannot build a file list (no DataTransfer)'); return; }
    must('the autosave scenario provided a saved session', !!savedSession);
    await loadExample('aframe');
    if (!(await openFile(savedSession, 'smoke-session.json'))) { skip('opening files', 'this browser cannot set files on a file input'); return; }
    check('opening the saved session restores its model', JSON.stringify(model()) === JSON.stringify(JSON.parse(savedSession).model), model().title);
    await openFile(JSON.stringify(V1_FIXTURE), 'smoke-fixture-v1.truss.json');
    const m = model(), r = T.results();
    check('the version 1 file opens with its title, nodes and members', m.title === V1_FIXTURE.title && m.nodes.length === 3 && m.members.length === 2, m.title);
    must('and it solves', r && r.ok, r ? r.errors[0] : 'no results');
    near('member 1 carries -62.5 kN', r.members[0].force, -62.5e3, 1e-12);
    near('member 2 carries -62.5 kN', r.members[1].force, -62.5e3, 1e-12);
  });

  if (SELFTEST) {
    scenario('Deliberately failing scenario (self-test mode only)', async () => {
      await loadExample('mechanism');
      key('n');
      await click(1.5, 1.5);
      check('(self-test) the model was changed before the failure', model().nodes.length === 9, `${model().nodes.length} nodes`);
      throw new Error('deliberate failure: the clean-up must still restore everything');
    });
  }

  /* ------------------------------------------------------------------ runner */
  function sameResults(a, b) {
    if (!a || !b || a.ok !== b.ok || a.members.length !== b.members.length || a.nodes.length !== b.nodes.length) return false;
    return a.members.every((m, i) => Object.is(m.force, b.members[i].force) && m.status === b.members[i].status) &&
      a.nodes.every((n, i) => Object.is(n.ux, b.nodes[i].ux) && Object.is(n.uy, b.nodes[i].uy));
  }

  /** The settings every scenario assumes. Also re-applied after a scenario loads a stored session with other settings. */
  async function applyTestSettings() {
    press('#segGrid button[data-grid="0.5"]');
    setChecked('#chkSnap', true);
    setChecked('#chkSnapNodes', true);
    setChecked('#chkLive', true);
    setChecked('[data-show="showDeformed"]', false); // picking then uses the model positions only
    setValue('#selForceUnit', 'kN');
    setValue('#numLoadFactor', '1');
    await settle();
  }

  async function main() {
    if (!T || T.version !== 2) {
      title.textContent = 'TrussLab smoke test: window.TrussLabTest (version 2) is missing. Open index.html?smoke.';
      title.style.color = COLORS.fail;
      return;
    }
    const t0 = performance.now();
    userKeysBefore = userKeysSnapshot();
    const start = T.capture();
    const startResults = T.results();
    const ownCapture = Object.prototype.hasOwnProperty.call(canvas, 'setPointerCapture');
    const nativeCapture = canvas.setPointerCapture;
    canvas.setPointerCapture = function () { /* synthetic pointers cannot be captured (see the header) */ };
    try {
      await settle();
      heading('Setup');
      await applyTestSettings();
      const s = T.settings();
      check('test settings applied: 0.5 m grid, snapping and live solve on, kN, λ = 1, deformed shape hidden',
        s.grid === 0.5 && s.snap && s.snapNodes && s.liveSolve && s.forceUnit === 'kN' && s.loadFactor === 1 && !s.showDeformed);
      for (const sc of scenarios) {
        heading(sc.name);
        try { await sc.fn(); } catch (err) { record('fail', 'scenario stopped', err && err.message ? err.message : String(err)); }
        finally {
          // leave nothing half-done for the next scenario
          canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'mouse' }));
          keyUp(' ');
          if (!el('#helpModal').hidden) key('Escape');
          blurAll();
        }
      }
    } finally {
      heading('Clean-up and isolation');
      let restoreError = null;
      try { T.restore(start); await settle(); } catch (err) { restoreError = err; }
      if (ownCapture) canvas.setPointerCapture = nativeCapture; else delete canvas.setPointerCapture;
      const diffs = restoreError ? [`restore() threw: ${restoreError.message}`] : T.diff(start, T.capture());
      check('the app is back exactly as it was before the test (model, settings, view, tool, selection, undo history, panels)', diffs.length === 0, `differs: ${diffs.join(', ')}`);
      check('re-solving the restored model gives the same results as at the start', sameResults(startResults, T.results()));
      check('no autosave is pending after the clean-up', !T.autosavePending());
      check('your saved sessions are unchanged (every user storage key, versions 2 and 1 and the backups)',
        userKeysSnapshot() === userKeysBefore, 'one changed during the test; was TrussLab open in another tab?');
      check("canvas.setPointerCapture is the browser's own method again",
        canvas.setPointerCapture === nativeCapture && (ownCapture || !Object.prototype.hasOwnProperty.call(canvas, 'setPointerCapture')));
      const smokeKeys = Object.values(T.storageKeys).concat(Array.from({ length: 19 }, (_, i) => `${T.storageKeys.backup}.${i + 2}`));
      for (const k of smokeKeys) { try { localStorage.removeItem(k); } catch (e) { /* storage unavailable */ } }
      T.cancelAutosave();
      finish(performance.now() - t0);
    }
  }

  function finish(ms) {
    const failed = records.filter((r) => r.status === 'fail');
    const passed = records.filter((r) => r.status === 'pass').length;
    const skipped = records.filter((r) => r.status === 'skip').length;
    const isolationOk = records.filter((r) => r.scenario === 'Clean-up and isolation').every((r) => r.status === 'pass');
    let verdict;
    if (SELFTEST) {
      const expected = failed.filter((r) => r.scenario.startsWith('Deliberately failing') && r.name === 'scenario stopped');
      verdict = expected.length === 1 && failed.length === 1 && isolationOk ? 'PASS' : 'FAIL';
    } else {
      verdict = failed.length === 0 ? 'PASS' : 'FAIL';
    }
    title.textContent = `TrussLab smoke test${SELFTEST ? ' (self-test mode)' : ''}: ${verdict}`;
    title.style.color = verdict === 'PASS' ? COLORS.pass : COLORS.fail;
    line(`${passed} passed, ${failed.length} failed${SELFTEST ? ' (exactly 1 deliberate failure expected)' : ''}, ${skipped} skipped, ${(ms / 1000).toFixed(1)} s`, null, true);
    window.TrussLabSmokeResult = Object.freeze({ mode: SELFTEST ? 'selftest' : 'normal', verdict, passed, failed: failed.length, skipped, records: records.slice() });
    console.log(`[smoke] ${verdict}: ${passed} passed, ${failed.length} failed, ${skipped} skipped`);
  }

  main().catch((err) => {
    title.textContent = `TrussLab smoke test crashed: ${err && err.message ? err.message : err}`;
    title.style.color = COLORS.fail;
    console.error(err);
  });
})();
