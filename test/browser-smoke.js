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
 *   - In smoke mode the app reads and writes its own storage key, so the saved session
 *     (trusslab.session.v1) is never loaded or written. The test checks at the end that
 *     it is byte-for-byte unchanged.
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
  const pairs = () => model().members.map((m) => `${Math.min(m.n1, m.n2)}-${Math.max(m.n1, m.n2)}`);
  function memberForce(pair) {
    const i = pairs().indexOf(pair), r = T.results();
    return i >= 0 && r && r.ok ? r.members[i].force : NaN;
  }
  const FORCE_UNIT = { N: 1, kN: 1e3, MN: 1e6 };
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

  /* ------------------------------------------------------------------ scenarios */
  const scenarios = [];
  const scenario = (name, fn) => scenarios.push({ name, fn });
  let userSessionBefore = null; // the real saved session, read before the first scenario
  let savedSession = null;      // written by the autosave scenario, opened by the Open… scenario

  scenario('Start-up', async () => {
    check('smoke mode stores its session under its own key', T.storageKey !== T.userStorageKey, T.storageKey);
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
    const n4 = model().nodes[3], unit = FORCE_UNIT[T.settings().forceUnit];
    check('node 4 now carries Fy = -20 kN', n4.load.fx === 0 && n4.load.fy === -20 * unit, `(${n4.load.fx}, ${n4.load.fy}) N`);
    near('the hanger 3-4 carries +20 kN tension (statics)', memberForce('3-4'), 20e3, 1e-12);
    near('each rafter now carries -75 kN (the 120 kN total is shared)', memberForce('1-3'), -75e3, 1e-12);
    near('member 1-4 stays at zero force', memberForce('1-4'), 0, 1e-6);
  });

  scenario('Support tool: a misplaced roller is reported as unstable, then fixed', async () => {
    must('starting from the loaded hanger model', model().nodes.length === 4 && model().nodes[3].load.fy < 0);
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

  scenario('Autosave writes the current model (under the smoke-test key)', async () => {
    await loadExample('fink');
    check('an autosave is scheduled after the change', T.autosavePending());
    await sleep(700);
    check('the autosave has run', !T.autosavePending());
    savedSession = readStorage(T.storageKey);
    must('a session was saved under the smoke-test key', typeof savedSession === 'string' && savedSession.length > 0);
    check('the saved model matches the model on screen', JSON.stringify(JSON.parse(savedSession).model) === JSON.stringify(model()));
    check('the real saved session was not written', readStorage(T.userStorageKey) === userSessionBefore);
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

  async function main() {
    if (!T || T.version !== 1) {
      title.textContent = 'TrussLab smoke test: window.TrussLabTest (version 1) is missing. Open index.html?smoke.';
      title.style.color = COLORS.fail;
      return;
    }
    const t0 = performance.now();
    userSessionBefore = readStorage(T.userStorageKey);
    const start = T.capture();
    const startResults = T.results();
    const ownCapture = Object.prototype.hasOwnProperty.call(canvas, 'setPointerCapture');
    const nativeCapture = canvas.setPointerCapture;
    canvas.setPointerCapture = function () { /* synthetic pointers cannot be captured (see the header) */ };
    try {
      await settle();
      heading('Setup');
      press('#segGrid button[data-grid="0.5"]');
      setChecked('#chkSnap', true);
      setChecked('#chkSnapNodes', true);
      setChecked('#chkLive', true);
      setChecked('[data-show="showDeformed"]', false); // picking then uses the model positions only
      setValue('#selForceUnit', 'kN');
      setValue('#numLoadFactor', '1');
      await settle();
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
      check(`your saved session (${T.userStorageKey}) is unchanged${userSessionBefore === null ? ' (there was none)' : ''}`,
        readStorage(T.userStorageKey) === userSessionBefore, 'it changed during the test; was TrussLab open in another tab?');
      check("canvas.setPointerCapture is the browser's own method again",
        canvas.setPointerCapture === nativeCapture && (ownCapture || !Object.prototype.hasOwnProperty.call(canvas, 'setPointerCapture')));
      try { localStorage.removeItem(T.storageKey); } catch (e) { /* storage unavailable */ }
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
