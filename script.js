/*!
 * script.js - user interface, rendering and interaction of TrussLab
 * (2D Truss FEA & Load Simulator). All numerical work is delegated to fea-core.js (global FEA).
 *
 * Internal units are SI base units (m, N, Pa, m^2, m^4). Display/input units are converted
 * only at the UI boundary.
 */
(() => {
  'use strict';

  if (typeof FEA === 'undefined' || typeof TrussModel === 'undefined') {
    const missing = [typeof FEA === 'undefined' ? 'fea-core.js' : '', typeof TrussModel === 'undefined' ? 'model.js' : ''].filter(Boolean).join(' and ');
    document.body.innerHTML = `<p style="color:#fff;font:14px sans-serif;padding:2em">${missing} failed to load. Keep index.html, script.js, style.css, fea-core.js and model.js in the same folder.</p>`;
    return;
  }

  /* =====================================================================
   * 1. Small helpers, units and number formatting
   * ===================================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MINUS = '\u2212';
  // The bundled IBM Plex faces (fonts/, SIL OFL 1.1), with system fallbacks: the canvas uses the same faces as the page.
  const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const SANS = '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const dpr = () => window.devicePixelRatio || 1;
  const cosSinDeg = FEA.util.cosSinDeg;
  /** prefers-reduced-motion: the solve animation is skipped and a mechanism mode is drawn static at full amplitude. */
  const REDUCED_MOTION = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  // The model layer lives in model.js (global TrussModel, no DOM): units, the expression parser, materials,
  // sections, model objects, supports, load cases, the file format, model checks, the examples, the solver
  // input and saved sessions.
  const {
    GPA, MPA, MM, MM2, MM4, D2R, parseExpr, evalNum,
    FIR_NOTE, GROUP_COLORS, SHAPES, sectionProps, makeMaterial, makeGroup, makeNode, makeMember, emptyModel,
    SUPPORT_TYPES, SUPPORT_SHORT, setSupport, supportRestraint, serialize, readModel, deserialize, validateModel,
    EXAMPLES, buildExample, toAnalysisInput,
    addLoadCase, removeLoadCase, setActiveLoadCase, removeNodeActions, nodeLoad, setNodeLoad, nodeSettlement, setNodeSettlement, modelHasSettlement,
    GRAVITY, validDensity, isGeneratedCase, memberSelfWeight, selfWeightCase, addSelfWeightCase, selfWeightSummary,
    addCombination, removeCombination, setActiveCombination, combinationFactor, setCombinationFactor, analyzeCombination, combinationEnvelope,
    setDeflectionCriterion, pruneDesign,
    SESSION_KEYS, SMOKE_SESSION_KEYS, loadStoredSession, saveStoredSession,
  } = TrussModel;

  const FORCE_UNITS = { N: 1, kN: 1e3, MN: 1e6 };
  const DISP_UNITS = { 'µm': 1e-6, mm: 1e-3, m: 1 };
  const STIFF_UNITS = { 'N/m': 1, 'kN/m': 1e3, 'MN/m': 1e6 };
  const fU = () => FORCE_UNITS[S().forceUnit] || 1e3;
  const dU = () => DISP_UNITS[S().dispUnit] || 1e-3;

  /** Engineering number formatting with `sig` significant digits (display only). */
  function fmt(x, sig) {
    sig = sig || S().sig;
    if (x === Infinity) return '\u221E';
    if (x === -Infinity) return MINUS + '\u221E';
    if (typeof x !== 'number' || Number.isNaN(x)) return '\u2014';
    if (x === 0) return '0';
    const ax = Math.abs(x);
    let s;
    if (ax >= 1e-3 && ax < 1e6) {
      const mag = Math.floor(Math.log10(ax));
      s = x.toFixed(clamp(sig - 1 - mag, 0, 12));
    } else {
      s = x.toExponential(Math.max(0, sig - 1));
    }
    return s.replace('e+', 'e').replace('e-', 'e' + MINUS).replace(/^-/, MINUS);
  }
  /** Values at round-off level relative to `ref` are shown as 0 (exports keep raw values). */
  const chop = (x, ref) => (ref > 0 && Math.abs(x) <= 1e-12 * ref ? 0 : x);
  const fF = (N, ref) => fmt(chop(N, ref) / fU());
  const fD = (m, ref) => fmt(chop(m, ref) / dU());
  const fS = (Pa, ref) => fmt(chop(Pa, ref) / MPA);
  /** Value shown inside an input field: 12 significant digits, no trailing zeros. */
  const inVal = (x) => (Number.isFinite(x) ? String(parseFloat(x.toPrecision(12))) : '');
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /* =====================================================================
   * 2. Materials, sections, model objects
   * ===================================================================== */
  // Material presets, section shapes, model constructors, supports, load cases and the file format are in
  // model.js. supportText stays here because it formats numbers for display.
  /** Short support label. `st` is the node's settlement in the active load case: δ marks a fixed axis that settles. */
  function supportText(s, st) {
    const d = st || { dx: 0, dy: 0 };
    const settles = (s.fixX && d.dx !== 0) || (s.fixY && d.dy !== 0);
    if (s.type === 'inclined') return `Incl. roller ${fmt(s.angle, 4)}°${settles ? ' δ' : ''}`;
    if (s.type === 'custom') {
      if (!s.fixX && !s.fixY) return 'Custom, restrains nothing';
      const parts = [];
      if (s.fixX) parts.push(`x′${d.dx ? ' δ' : ''}`);
      if (s.fixY) parts.push(`y′${d.dy ? ' δ' : ''}`);
      return `Custom ${parts.join(',')}${s.angle ? ` @${fmt(s.angle, 3)}°` : ''}`;
    }
    return `${SUPPORT_SHORT[s.type] || 'Free'}${settles ? ' δ' : ''}`;
  }
  const nodeSupportText = (n) => supportText(n.support, nodeSettlement(state.model, n));
  /** Model-check warnings (validateModel) that concern one node. */
  const nodeWarnings = (n) => { const i = state.model.nodes.indexOf(n); return validateModel(state.model).filter((w) => w.ref && w.ref.index === i); };

  /* =====================================================================
   * 3. Example structures
   * ===================================================================== */
  // The example structures are in model.js (TrussModel.EXAMPLES and TrussModel.buildExample).

  /* =====================================================================
   * 4. Application state, settings, history, persistence
   * ===================================================================== */
  const DEFAULT_SETTINGS = {
    grid: 0.5, snap: true, snapNodes: true, showGrid: true,
    forceUnit: 'kN', dispUnit: 'mm', sig: 4,
    loadFactor: 1, targetSF: 1.5,
    scale: 100, autoScale: true, colorBy: 'force',
    showUndeformed: true, showDeformed: true, showLoads: true, showReactions: true, showSupports: true,
    showNodeLabels: true, showMemberLabels: false, showForceLabels: false, animate: true,
    liveSolve: true, chain: true,
    bottomTab: 'members', bottomCollapsed: true, bottomHeight: 240,
    mtxView: 'global', mtxUnit: 'kN/m', mtxMode: 'table', mtxDimZeros: true,
    lambdaNoticeDismissed: false,
    // milestone 6: presentation only; none of these changes the model or the analysis
    workspace: 'analyze', uiMode: 'guided', rightTab: 'inspector',
  };
  const WORKSPACES = ['learn', 'analyze', 'design'];
  const state = {
    model: null,
    s: Object.assign({}, DEFAULT_SETTINGS),
    view: { cx: 9, cy: 1.5, zoom: 40 },
    tool: 'select',
    sel: { nodes: new Set(), members: new Set() },
    hover: null, tableHover: null,
    pointer: { sx: 0, sy: 0, inside: false },
    drag: null, memberStart: null, spaceDown: false,
    res: null, stale: true,
    activeGroup: null, editGroup: null,
    anim: { start: 0, dur: 750, p: 1 },
    mechMode: 0, mechT0: 0,
    supTool: { type: 'pin', angle: 30 },
    loadTool: { fx: 0, fy: -10e3, mode: 'set' },
    sort: { members: { key: 'id', dir: 1 }, nodes: { key: 'id', dir: 1 } },
    importNotes: [], // notes from reading the current model (readModel), shown in the health report
    lastP: null, W: 0, H: 0,
    viewOnly: false,     // phones (≤ 640 px): view and inspect only, every editing entry point refuses
    viewOnlyTest: null,  // smoke mode only: forces the view-only state on (true) or off (false)
    learn: { view: 'home' }, // what the Learn workspace shows (section 18)
    touches: new Map(),  // active touch pointers, for pinch zoom
  };
  function S() { return state.s; }

  const history = { undo: [], redo: [], max: 200 };
  // An undo snapshot is the model in file format version 2, the session ids of its load cases, and its import notes.
  // The ids let undo and redo keep the load case or combination you are looking at: switching is not an edit and is
  // never undone. The notes describe the file the model came from, so undoing an Open… brings back the earlier model's notes.
  const snapshot = () => JSON.stringify({ model: serialize(state.model), caseUids: state.model.loadCases.map((c) => c.uid),
    comboUids: state.model.combinations.map((c) => c.uid), importNotes: state.importNotes });
  function pushUndo(snap) {
    history.undo.push(snap || snapshot());
    if (history.undo.length > history.max) history.undo.shift();
    history.redo.length = 0;
    updateUndoButtons();
  }
  function restoreSnapshot(str) {
    const gi = state.model.groups.indexOf(state.activeGroup);
    const ei = state.model.groups.indexOf(state.editGroup);
    const activeUid = state.model.activeCase.uid, comboUid = state.model.activeCombination ? state.model.activeCombination.uid : null;
    const obj = JSON.parse(str);
    const model = readModel(obj).model;
    if (Array.isArray(obj.caseUids) && obj.caseUids.length === model.loadCases.length) model.loadCases.forEach((c, i) => { c.uid = obj.caseUids[i]; });
    if (Array.isArray(obj.comboUids) && obj.comboUids.length === model.combinations.length) model.combinations.forEach((c, i) => { c.uid = obj.comboUids[i]; });
    // keep the active case if it still exists; otherwise the snapshot's active case, which always does
    const keep = model.loadCases.find((c) => c.uid === activeUid);
    if (keep) model.activeCase = keep;
    // keep the combination on screen if it still exists; with a load case on screen, stay on the load case
    model.activeCombination = comboUid === null ? null : model.combinations.find((c) => c.uid === comboUid) || null;
    state.model = model;
    state.importNotes = Array.isArray(obj.importNotes) ? obj.importNotes : [];
    state.activeGroup = state.model.groups[gi] || state.model.groups[0];
    state.editGroup = ei >= 0 ? state.model.groups[ei] || null : null;
    state.memberStart = null;
    clearSelection(false);
    modelChanged({ groups: true, materials: true });
  }
  function undo() {
    if (!history.undo.length) { toast('Nothing to undo'); return; }
    history.redo.push(snapshot());
    restoreSnapshot(history.undo.pop());
    updateUndoButtons();
  }
  function redo() {
    if (!history.redo.length) { toast('Nothing to redo'); return; }
    history.undo.push(snapshot());
    restoreSnapshot(history.redo.pop());
    updateUndoButtons();
  }
  function updateUndoButtons() {
    $('#btnUndo').disabled = !history.undo.length;
    $('#btnRedo').disabled = !history.redo.length;
  }

  /** index.html?smoke runs the browser smoke test (test/browser-smoke.js). Smoke mode keeps its sessions
   *  under separate keys, so the user's saved sessions are never read or written. */
  const SMOKE = /^\?(?:.*&)?smoke(?:[=&]|$)/.test(location.search);
  const KEYS = SMOKE ? SMOKE_SESSION_KEYS : SESSION_KEYS;
  /** Browser storage, or null where the browser refuses access to it (some file:// and private-window setups). */
  const STORE = (() => { try { const s = window.localStorage; s.getItem(KEYS.v2); return s; } catch (e) { return null; } })();
  /** migrationPending: a version 1 session was loaded and its key is removed after the first verified save.
   *  corruptV2: an unreadable version 2 session that could not be backed up yet, so it must not be overwritten.
   *  readFailed: keys whose read threw at start-up; until a reload nothing is written, since a session may be there. */
  const storageStatus = { migrationPending: false, corruptV2: null, readFailed: [] };
  let saveTimer = 0; // 0 = no autosave pending
  function sessionToSave() {
    const keep = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) keep[k] = state.s[k];
    return { model: state.model, settings: keep, view: state.view, importNotes: state.importNotes };
  }
  /** Saves the session now (verified; see saveStoredSession) and shows or clears the status-bar note. */
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    let res;
    try { res = saveStoredSession(STORE, KEYS, sessionToSave(), storageStatus); }
    catch (e) { res = { saved: false, stage: 'write', error: e.message || String(e) }; }
    showSaveStatus(res);
    return res;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  /** Status bar: a persistent note while the session cannot be saved, and a different, informational one when the
   *  session was saved but only the cleanup of the old version 1 session failed. Cleared by the next save that
   *  succeeds completely. The tooltip gives the reason. */
  const SAVE_FAILED = {
    read: 'The saved session could not be read when TrussLab started, so nothing is written until you reload the page.',
    backup: 'An unreadable earlier session must be backed up before it can be replaced.',
    write: 'The browser did not store this session.',
    verify: 'The saved session could not be verified: it must read back unchanged and restore the same model.',
  };
  function showSaveStatus(res) {
    const el = $('#sbSave');
    let text = '', cls = '', detail = '';
    if (!res.saved) {
      cls = 'bad';
      text = 'Changes not saved — browser storage unavailable';
      detail = SAVE_FAILED[res.stage] || SAVE_FAILED.write;
    } else if (res.legacy === 'failed') {
      cls = 'info';
      text = detail = 'Saved. The old version 1 session could not be removed yet; it will be retried';
    }
    el.hidden = !text;
    el.textContent = text;
    el.className = `save-status ${cls}`;
    el.title = text ? `${detail}${res.error ? ` (${res.error})` : ''}` : '';
  }
  /** Reads the saved session, migrating version 1 in memory, and applies its settings, view and import notes.
   *  Returns { restored, source: 'v2' | 'v1' | 'none', hasSettlement, backup, readFailed }. */
  function loadSession() {
    const res = loadStoredSession(STORE, KEYS);
    storageStatus.migrationPending = res.migrationPending;
    storageStatus.corruptV2 = res.corruptV2;
    storageStatus.readFailed = res.readFailed || [];
    const readFailed = storageStatus.readFailed.length > 0;
    if (!res.model) return { restored: false, source: res.source, backup: res.backup, readFailed };
    if (res.settings) for (const k of Object.keys(DEFAULT_SETTINGS)) if (res.settings[k] !== undefined && typeof res.settings[k] === typeof DEFAULT_SETTINGS[k]) state.s[k] = res.settings[k];
    if (!FORCE_UNITS[state.s.forceUnit]) state.s.forceUnit = 'kN';
    if (!DISP_UNITS[state.s.dispUnit]) state.s.dispUnit = 'mm';
    if (res.view && Number.isFinite(res.view.zoom) && res.view.zoom > 0) state.view = { cx: +res.view.cx || 0, cy: +res.view.cy || 0, zoom: res.view.zoom };
    state.model = res.model;
    state.importNotes = res.notes || [];
    return { restored: true, source: res.source, hasSettlement: modelHasSettlement(res.model), backup: res.backup, readFailed };
  }
  /** After a session is loaded: a migrated version 1 session is saved at once (verified, and only then is the old
   *  key removed), and the λ notice appears if it holds a settlement. Returns a short message for the toast. */
  function afterSessionLoaded(session) {
    if (session.source === 'v1') saveNow();
    if (session.source === 'v1' && session.hasSettlement) showLambdaNotice();
    if (session.readFailed) saveNow(); // refused at once, so the status bar says so from the start
    const parts = [];
    if (session.restored) parts.push(session.source === 'v1' ? 'Previous session restored and converted to file format version 2' : 'Previous session restored. Start over from the File menu');
    if (session.backup && session.backup.ok) parts.push('an unreadable saved session was kept as a backup in browser storage');
    if (session.readFailed) parts.push('your saved session could not be read from browser storage, so changes are not saved until you reload the page');
    return parts.join('; ');
  }
  /** The update notice about λ: shown once, until dismissed. */
  function showLambdaNotice() { if (!state.s.lambdaNoticeDismissed) $('#updateNotice').hidden = false; }

  /* =====================================================================
   * 5. Analysis driver
   * ===================================================================== */
  function buildInput() {
    return toAnalysisInput(state.model, { loadFactor: state.s.loadFactor, targetSF: state.s.targetSF });
  }

  let solveQueued = false;
  function requestSolve() {
    state.stale = true;
    if (!state.s.liveSolve) { refreshStatus(); return; }
    if (solveQueued) return;
    solveQueued = true;
    requestAnimationFrame(() => { solveQueued = false; solve(false); });
  }
  function solve(animate) {
    let r;
    const t0 = performance.now();
    try { r = FEA.analyze(buildInput()); }
    catch (err) {
      console.error(err);
      r = { ok: false, stage: 'error', errors: [{ msg: 'Internal solver error: ' + err.message }], warnings: [], log: [], members: [], nodes: [], diagnostics: {} };
    }
    r.wall = performance.now() - t0;
    r.nodeObjs = state.model.nodes.slice();
    r.memberObjs = state.model.members.slice();
    r.nodeIndex = new Map(r.nodeObjs.map((n, i) => [n, i]));
    r.memberIndex = new Map(r.memberObjs.map((e, i) => [e, i]));
    r.loadFactor = state.s.loadFactor;
    state.res = r;
    state.comboRuns = combinationRuns(r);
    state.stale = false;
    if (r.ok && state.s.autoScale) autoScale();
    if (r.mechanism) { state.mechMode = clamp(state.mechMode, 0, r.mechanism.modes.length - 1); if (!state.mechT0) state.mechT0 = performance.now(); }
    else state.mechT0 = 0;
    if (animate && r.ok && state.s.animate && !REDUCED_MOTION.matches) { state.anim.start = performance.now(); state.anim.p = 0; }
    refreshResults();
    requestRender();
  }
  /**
   * With a combination on screen: every combination of the model, each solved directly on its own complete action
   * state (the one on screen reuses its result), for the worst case over combinations. Otherwise null.
   */
  function combinationRuns(r) {
    const M = state.model, ac = M.activeCombination;
    if (!ac) return null;
    const opts = { loadFactor: state.s.loadFactor, targetSF: state.s.targetSF };
    return M.combinations.map((c) => {
      if (c === ac) return { combination: c, result: r };
      try { return { combination: c, result: analyzeCombination(M, c, opts) }; }
      catch (err) { return { combination: c, result: { ok: false, errors: [{ msg: 'Internal solver error: ' + err.message }], warnings: [], members: [], nodes: [] } }; }
    });
  }
  /** "1.35 × Self-weight + 1.5 × Load case 1": a combination's factors, as text (a negative factor is subtracted). */
  function combinationText(c) {
    if (!c.terms.length) return 'no load cases';
    return c.terms.map((t, i) => `${i ? (t.factor < 0 ? ' \u2212 ' : ' + ') : t.factor < 0 ? MINUS : ''}${inVal(Math.abs(t.factor))} × ${t.loadCase.name}`).join('');
  }
  /** A factor γ as entered (1.5, not 1.50000), with a true minus sign. */
  const fmtFactor = (f) => (f < 0 ? MINUS : '') + inVal(Math.abs(f));
  /** The generated self-weight case is part of what is analysed: it is the active case, or has a non-zero factor in the combination. */
  function selfWeightAnalysed() {
    const M = state.model, c = M.activeCombination;
    return c ? c.terms.some((t) => isGeneratedCase(t.loadCase) && t.factor !== 0) : isGeneratedCase(M.activeCase);
  }
  /** Results that belong to the current model (or are being refreshed live). */
  function R() {
    const r = state.res;
    if (!r) return null;
    if (state.stale && !state.s.liveSolve) return null;
    if (resultsHidden()) return null; // a prediction activity hides every result until the learner checks
    return r;
  }
  const nodeRes = (r, n) => { const i = r && r.ok ? r.nodeIndex.get(n) : undefined; return i === undefined ? null : r.nodes[i]; };
  const memberRes = (r, e) => { const i = r && r.ok ? r.memberIndex.get(e) : undefined; return i === undefined ? null : r.members[i]; };
  const nodeNo = (n) => state.model.nodes.indexOf(n) + 1;
  const memberNo = (e) => state.model.members.indexOf(e) + 1;

  function autoScale() {
    const r = state.res;
    if (!r || !r.ok) return;
    const umax = r.summary.maxDisp.value, ext = modelExtent();
    if (!(umax > 0) || !(ext > 0)) return;
    let s = clamp(0.08 * ext / umax, 1, 1000);
    const p = Math.pow(10, Math.floor(Math.log10(s)) - 1);
    s = Math.max(1, Math.round(s / p) * p);
    state.s.scale = parseFloat(s.toPrecision(2));
    syncScaleUI();
  }

  /* =====================================================================
   * 6. View transform, snapping, picking
   * ===================================================================== */
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const viewport = $('#viewport');

  const w2s = (x, y) => [(x - state.view.cx) * state.view.zoom + state.W / 2, state.H / 2 - (y - state.view.cy) * state.view.zoom];
  const s2w = (sx, sy) => [(sx - state.W / 2) / state.view.zoom + state.view.cx, state.view.cy - (sy - state.H / 2) / state.view.zoom];

  function modelBounds() {
    const ns = state.model.nodes;
    if (!ns.length) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
    return { x0, x1, y0, y1 };
  }
  function modelExtent() { const b = modelBounds(); return b ? Math.max(b.x1 - b.x0, b.y1 - b.y0) : 0; }
  function fitView() {
    const b = modelBounds();
    if (!b || !state.W) { state.view = { cx: 5, cy: 2, zoom: 40 }; requestRender(); updateZoomLabel(); return; }
    const w = Math.max(b.x1 - b.x0, 1), h = Math.max(b.y1 - b.y0, 1);
    // margins leave room for support glyphs, reaction labels, the HUD and the legend
    const padX = Math.min(175, state.W * 0.2), padTop = Math.min(105, state.H * 0.2), padBot = Math.min(150, state.H * 0.28);
    const zx = (state.W - 2 * padX) / w, zy = (state.H - padTop - padBot) / h;
    state.view.zoom = clamp(Math.min(zx, zy), 2, 5000);
    state.view.cx = (b.x0 + b.x1) / 2;
    state.view.cy = (b.y0 + b.y1) / 2 - ((padBot - padTop) / 2) / state.view.zoom;
    updateZoomLabel();
    requestRender();
    scheduleSave();
  }
  function zoomAt(factor, sx, sy) {
    const [wx, wy] = s2w(sx, sy);
    state.view.zoom = clamp(state.view.zoom * factor, 1, 20000);
    state.view.cx = wx - (sx - state.W / 2) / state.view.zoom;
    state.view.cy = wy + (sy - state.H / 2) / state.view.zoom;
    updateZoomLabel();
    requestRender();
    scheduleSave();
  }
  function updateZoomLabel() { $('#zoomLabel').textContent = `${fmt(state.view.zoom, 3)} px/m`; }

  /** Grid step as an exact rational num/den so snapped coordinates are the doubles nearest to k*step. */
  function gridFrac() {
    const g = state.s.grid;
    for (const den of [1, 2, 4, 5, 10, 20, 100]) { const num = Math.round(g * den); if (Math.abs(num / den - g) < 1e-12) return [num, den]; }
    return [g, 1];
  }
  function snapCoord(v) { const [num, den] = gridFrac(); return (Math.round(v * den / num) * num) / den; }
  function onGrid(v) { return Math.abs(v - snapCoord(v)) < 1e-9; }
  /** Resolve a screen position to a model point: existing node, grid point or free point. */
  function resolvePoint(sx, sy, exclude) {
    if (state.s.snapNodes) {
      const hit = pickNode(sx, sy, 10, exclude, true);
      if (hit) return { node: hit, x: hit.x, y: hit.y };
    }
    let [x, y] = s2w(sx, sy);
    if (state.s.snap) { x = snapCoord(x); y = snapCoord(y); }
    const tol = 1e-9 * Math.max(1, modelExtent());
    for (const n of state.model.nodes) if (n !== exclude && Math.abs(n.x - x) <= tol && Math.abs(n.y - y) <= tol) return { node: n, x: n.x, y: n.y };
    return { node: null, x, y };
  }

  /** World position at which a node is drawn (deformed shape, mechanism animation or model). */
  function displayInfo(now) {
    const r = R();
    const info = { mode: 'model', factor: 0, r };
    if (r && r.ok && state.s.showDeformed) { info.mode = 'deformed'; info.factor = state.s.scale * state.anim.p; }
    else if (r && !r.ok && r.mechanism && r.mechanism.modes.length) {
      const amp = 0.06 * Math.max(modelExtent(), 1);
      info.mode = 'mechanism';
      info.factor = REDUCED_MOTION.matches ? amp : amp * Math.sin(((now || performance.now()) - state.mechT0) / 1000 * 2.6);
      info.modeVec = r.mechanism.modes[state.mechMode].u;
    }
    return info;
  }
  function dispPos(n, info) {
    if (info.mode === 'deformed') {
      const nr = nodeRes(info.r, n);
      if (nr) return [n.x + nr.ux * info.factor, n.y + nr.uy * info.factor];
    } else if (info.mode === 'mechanism') {
      const i = info.r.nodeIndex.get(n);
      if (i !== undefined) return [n.x + info.modeVec[2 * i] * info.factor, n.y + info.modeVec[2 * i + 1] * info.factor];
    }
    return [n.x, n.y];
  }
  function pickNode(sx, sy, rad, exclude, modelOnly) {
    const info = displayInfo();
    let best = null, bd = rad * rad;
    for (const n of state.model.nodes) {
      if (n === exclude) continue;
      const cands = [[n.x, n.y]];
      if (!modelOnly && info.mode !== 'model') cands.push(dispPos(n, info));
      for (const [x, y] of cands) {
        const [px, py] = w2s(x, y);
        const d = (px - sx) ** 2 + (py - sy) ** 2;
        if (d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }
  function segDist2(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
    t = clamp(t, 0, 1);
    return (px - ax - t * vx) ** 2 + (py - ay - t * vy) ** 2;
  }
  function pickMember(sx, sy, tol) {
    const info = displayInfo();
    let best = null, bd = tol * tol;
    for (const e of state.model.members) {
      const sets = [[[e.n1.x, e.n1.y], [e.n2.x, e.n2.y]]];
      if (info.mode !== 'model') sets.push([dispPos(e.n1, info), dispPos(e.n2, info)]);
      for (const [a, b] of sets) {
        const [ax, ay] = w2s(a[0], a[1]), [bx, by] = w2s(b[0], b[1]);
        const d = segDist2(sx, sy, ax, ay, bx, by);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }
  function pick(sx, sy) {
    const n = pickNode(sx, sy, 9);
    if (n) return { kind: 'node', obj: n };
    const e = pickMember(sx, sy, 6);
    if (e) return { kind: 'member', obj: e };
    return null;
  }

  /* =====================================================================
   * 7. Rendering
   * ===================================================================== */
  /** The canvas palette: read once from the CSS tokens in style.css (:root), so every colour has one source. */
  function hexToRgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
    if (!m) return [128, 128, 128];
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  /** A token colour with an alpha, for halos and plates. */
  const alpha = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const tok = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    const P = {
      bg: tok('--bg-workspace', '#151F2C'), gridMinor: tok('--grid-minor', '#19232F'), gridMajor: tok('--grid-major', '#223042'),
      axis: tok('--axis', '#33465E'), gridText: tok('--grid-label', '#909FB4'),
      member: tok('--member', '#C3CEDB'), ghost: tok('--ghost', '#6B7E95'), node: tok('--node', '#E6EDF5'),
      sel: tok('--selection', '#B9A1FF'), hover: tok('--selection', '#B9A1FF'), support: tok('--support', '#9BAABD'),
      custom: tok('--settlement', '#5FB8AB'), load: tok('--load', '#E6EDF5'), reaction: tok('--reaction', '#4FD1B5'),
      tensionHex: tok('--tension', '#6E9CFF'), compressionHex: tok('--compression', '#FF9466'), zeroHex: tok('--zero', '#8C99AB'),
      fail: tok('--failure', '#F47AD6'), plate: tok('--label-plate', 'rgba(16,23,34,0.86)'),
      text1: tok('--text-1', '#E6EDF5'), text2: tok('--text-2', '#9BAABD'), text3: tok('--text-3', '#909FB4'),
      accent: tok('--accent', '#58C7E8'), accent2: tok('--accent-2', '#5FB8AB'), warn: tok('--warn', '#E8B04B'),
    };
    P.nodeStroke = P.bg;
    P.mech = P.fail;
    P.tension = hexToRgb(P.tensionHex); P.compression = hexToRgb(P.compressionHex); P.zero = hexToRgb(P.zeroHex);
    P.selRgb = hexToRgb(P.sel); P.failRgb = hexToRgb(P.fail); P.supportRgb = hexToRgb(P.support); P.accentRgb = hexToRgb(P.accent);
    return P;
  }
  const COL = readPalette();
  const ZERO_XY = Object.freeze({ fx: 0, fy: 0 });
  const ZERO_COLOR = COL.zeroHex;
  let renderQueued = false;
  function requestRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(frame); } }
  function frame(now) {
    renderQueued = false;
    if (state.anim.p < 1) {
      const t = clamp((now - state.anim.start) / state.anim.dur, 0, 1);
      state.anim.p = 1 - Math.pow(1 - t, 3);
      if (t >= 1) state.anim.p = 1;
    }
    draw(now);
    const r = R();
    // the mechanism mode animates, unless the user prefers reduced motion (then it is drawn static at full amplitude)
    if (state.anim.p < 1 || (r && !r.ok && r.mechanism && !REDUCED_MOTION.matches)) requestRender();
  }
  function resizeCanvas() {
    const rect = viewport.getBoundingClientRect();
    state.W = Math.max(1, Math.floor(rect.width));
    state.H = Math.max(1, Math.floor(rect.height));
    const k = dpr();
    canvas.width = Math.round(state.W * k);
    canvas.height = Math.round(state.H * k);
    requestRender();
  }

  function mix(c0, c1, t) { return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * t)},${Math.round(c0[1] + (c1[1] - c0[1]) * t)},${Math.round(c0[2] + (c1[2] - c0[2]) * t)})`; }
  /** Member colour: tension blue, compression orange, zero-force grey (dashed); intensity ∝ |value| / max. */
  function memberColor(mr, scaleMax) {
    if (!mr || mr.state === 'zero') return ZERO_COLOR;
    const v = colorValue(mr);
    const t = scaleMax > 0 ? clamp(Math.abs(v) / scaleMax, 0, 1) : 1;
    return mix(COL.zero, mr.force > 0 ? COL.tension : COL.compression, 0.4 + 0.6 * Math.sqrt(t));
  }
  function colorValue(mr) {
    switch (state.s.colorBy) {
      case 'stress': return mr.stress;
      case 'util': return Math.sign(mr.force) * mr.utilization;
      default: return mr.force;
    }
  }
  function colorScaleMax(r) {
    if (state.s.colorBy === 'util') return 1;
    let m = 0;
    for (const mr of r.members) if (mr.state !== 'zero') m = Math.max(m, Math.abs(colorValue(mr)));
    return m;
  }

  function draw(now) {
    const k = dpr();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, state.W, state.H);
    if (state.s.showGrid) drawGrid();
    drawAxisTriad();

    const info = displayInfo(now);
    const r = info.r;
    const M = state.model;
    const hide = resultsHidden();
    const showRes = info.mode === 'deformed' && !hide;
    const P = new Map();
    for (const n of M.nodes) P.set(n, w2s(...(hide ? [n.x, n.y] : dispPos(n, info))));
    const O = new Map();
    for (const n of M.nodes) O.set(n, w2s(n.x, n.y));
    const hoverObj = (state.hover && state.hover.obj) || state.tableHover;

    // undeformed ghost
    if (info.mode !== 'model' && !hide && state.s.showUndeformed) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = COL.ghost;
      ctx.beginPath();
      for (const e of M.members) { const a = O.get(e.n1), b = O.get(e.n2); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke();
      ctx.restore();
    }

    const scaleMax = showRes ? colorScaleMax(r) : 0;
    const mechNodes = info.mode === 'mechanism' ? new Set(r.mechanism.modes[state.mechMode].nodes.map((i) => r.nodeObjs[i])) : null;

    // selection underlay (solid) and hover (lighter)
    for (const e of M.members) {
      const sel = state.sel.members.has(e), hov = hoverObj === e;
      if (!sel && !hov) continue;
      const a = P.get(e.n1), b = P.get(e.n2);
      ctx.strokeStyle = alpha(COL.selRgb, sel ? 0.5 : 0.26);
      ctx.lineWidth = sel ? 10 : 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    // members
    ctx.lineCap = 'round';
    const failed = [];
    for (const e of M.members) {
      const a = P.get(e.n1), b = P.get(e.n2);
      const mr = showRes ? memberRes(r, e) : null;
      let color = COL.member, width = 2.6;
      if (showRes && mr) { color = memberColor(mr, scaleMax); width = mr.state === 'compression' ? 3.8 : 3.2; } // compression a little heavier: not colour alone
      else if (info.mode === 'mechanism') { color = mechNodes.has(e.n1) || mechNodes.has(e.n2) ? COL.mech : COL.ghost; }
      if (mr && mr.status !== 'safe') {
        ctx.strokeStyle = alpha(COL.failRgb, 0.32); ctx.lineWidth = 12;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        failed.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      }
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.setLineDash(mr && mr.state === 'zero' ? [6, 4] : info.mode === 'mechanism' && mechNodes.has(e.n1) && mechNodes.has(e.n2) ? [7, 4] : []);
      ctx.beginPath();
      if (mr && mr.status === 'buckled') { // bowed shape for buckled members
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const bow = Math.min(10, L * 0.08);
        ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(mx - dy / L * bow * 2, my + dx / L * bow * 2, b[0], b[1]);
      } else { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawPredictionMarks(P);

    if (state.s.showSupports) for (const n of M.nodes) if (n.support.type !== 'none') drawSupport(n, O.get(n));
    if (showRes && state.s.showReactions) drawReactions(r, P);
    if (state.s.showLoads) drawLoads(P);

    // nodes
    for (const n of M.nodes) {
      const [x, y] = P.get(n);
      const sel = state.sel.nodes.has(n), hov = hoverObj === n, start = state.memberStart && state.memberStart.node === n;
      if (sel || hov || start) {
        ctx.beginPath(); ctx.arc(x, y, 8.5, 0, Math.PI * 2);
        ctx.strokeStyle = start ? COL.accent : COL.sel; ctx.lineWidth = sel || start ? 2.2 : 1.4;
        ctx.setLineDash(hov && !sel && !start ? [3, 2] : []); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(x, y, 4.4, 0, Math.PI * 2);
      ctx.fillStyle = mechNodes && mechNodes.has(n) ? COL.mech : COL.node;
      ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = COL.nodeStroke; ctx.stroke();
      if (info.mode !== 'model' && !hide && state.s.showUndeformed) {
        const [ox, oy] = O.get(n);
        if (Math.hypot(ox - x, oy - y) > 3) { ctx.beginPath(); ctx.arc(ox, oy, 2.6, 0, Math.PI * 2); ctx.strokeStyle = COL.ghost; ctx.lineWidth = 1.2; ctx.stroke(); }
      }
    }
    // failed members carry a ✕ badge, so failure is never shown by colour alone
    for (const [x, y] of failed) {
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = COL.bg; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = COL.fail; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 3.4, y - 3.4); ctx.lineTo(x + 3.4, y + 3.4); ctx.moveTo(x + 3.4, y - 3.4); ctx.lineTo(x - 3.4, y + 3.4); ctx.stroke();
    }
    drawLabels(P, r, showRes);
    drawFbdHighlight(P);
    drawToolOverlay(info);
    updateHud(info);
  }

  function drawGrid() {
    const z = state.view.zoom;
    let minor = state.s.grid;
    const mults = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    for (const f of mults) { if (state.s.grid * f * z >= 9) { minor = state.s.grid * f; break; } }
    let major = minor * 5;
    for (const c of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) { if (c >= minor * 4 - 1e-12) { major = c; break; } }
    const [x0, y1] = s2w(0, 0), [x1, y0] = s2w(state.W, state.H);
    const lines = (step, color) => {
      ctx.beginPath();
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      for (let i = Math.ceil(x0 / step); i * step <= x1; i++) { const sx = Math.round(w2s(i * step, 0)[0]) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, state.H); }
      for (let j = Math.ceil(y0 / step); j * step <= y1; j++) { const sy = Math.round(w2s(0, j * step)[1]) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(state.W, sy); }
      ctx.stroke();
    };
    lines(minor, COL.gridMinor);
    lines(major, COL.gridMajor);
    const [ax, ay] = w2s(0, 0);
    ctx.beginPath(); ctx.strokeStyle = COL.axis; ctx.lineWidth = 1;
    ctx.moveTo(Math.round(ax) + 0.5, 0); ctx.lineTo(Math.round(ax) + 0.5, state.H);
    ctx.moveTo(0, Math.round(ay) + 0.5); ctx.lineTo(state.W, Math.round(ay) + 0.5);
    ctx.stroke();
    ctx.fillStyle = COL.gridText; ctx.font = `12px ${MONO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const lab = (v) => String(parseFloat(v.toPrecision(10))).replace('-', MINUS);
    for (let i = Math.ceil(x0 / major); i * major <= x1; i++) { const sx = w2s(i * major, 0)[0]; if (sx > 34) ctx.fillText(lab(i * major), sx, state.H - 4); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (let j = Math.ceil(y0 / major); j * major <= y1; j++) { const sy = w2s(0, j * major)[1]; if (sy < state.H - 22) ctx.fillText(lab(j * major), 4, sy); }
  }
  function drawAxisTriad() {
    const x = state.W - 58, y = state.H - 64;
    ctx.save();
    ctx.lineWidth = 1.5; ctx.font = `12px ${SANS}`; ctx.textBaseline = 'middle';
    ctx.strokeStyle = COL.text2; ctx.fillStyle = COL.text2;
    arrow(x, y, x + 26, y, 6); ctx.fillText('x', x + 31, y);
    arrow(x, y, x, y - 26, 6); ctx.textAlign = 'center'; ctx.fillText('y', x, y - 34);
    ctx.restore();
  }
  function arrow(x0, y0, x1, y1, head, open) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1 - head * Math.cos(a - 0.42), y1 - head * Math.sin(a - 0.42));
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(a + 0.42), y1 - head * Math.sin(a + 0.42));
    if (open) ctx.stroke(); else { ctx.closePath(); ctx.fill(); }
  }
  /** Support glyph drawn in a frame rotated by `deg` (world CCW), apex at the node. */
  function drawSupport(n, at) {
    const s = n.support;
    let deg = 0, kind = 'pin';
    switch (s.type) {
      case 'pin': kind = 'pin'; break;
      case 'rollerX': kind = 'roller'; break;
      case 'rollerY': kind = 'roller'; deg = -90; break;
      case 'inclined': kind = 'roller'; deg = s.angle; break;
      case 'custom':
        if (s.fixX && s.fixY) { kind = 'pin'; deg = s.angle; }
        else if (s.fixY) { kind = 'roller'; deg = s.angle; }
        else if (s.fixX) { kind = 'roller'; deg = s.angle - 90; }
        else return;
        break;
      default: return;
    }
    const [c, sn] = cosSinDeg(deg);
    const T = (lx, ly) => [at[0] + lx * c - ly * sn, at[1] - (lx * sn + ly * c)];
    const color = s.type === 'custom' ? COL.custom : COL.support;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = alpha(COL.supportRgb, 0.12); ctx.lineWidth = 1.5;
    const h = 13, w = 9;
    ctx.beginPath();
    let p = T(0, -4); ctx.moveTo(p[0], p[1]);
    p = T(-w, -h); ctx.lineTo(p[0], p[1]);
    p = T(w, -h); ctx.lineTo(p[0], p[1]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    let base = -h;
    if (kind === 'roller') {
      for (const lx of [-5, 5]) { const q = T(lx, -h - 3.2); ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, Math.PI * 2); ctx.stroke(); }
      base = -h - 6.6;
    }
    ctx.beginPath();
    p = T(-w - 5, base); ctx.moveTo(p[0], p[1]); p = T(w + 5, base); ctx.lineTo(p[0], p[1]);
    for (let lx = -w - 3; lx <= w + 5; lx += 4.5) { const a = T(lx, base), b = T(lx - 4, base - 5); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    const st = nodeSettlement(state.model, n); // the active load case's settlement, on a fixed axis
    if ((s.fixX && st.dx !== 0) || (s.fixY && st.dy !== 0)) {
      ctx.fillStyle = COL.custom; ctx.font = `600 13px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const q = T(w + 8, -h / 2);
      ctx.fillText('δ', q[0], q[1]);
    }
    ctx.restore();
  }
  function drawLoads(P) {
    const lf = state.s.loadFactor, M = state.model;
    let fmax = 0;
    for (const n of M.nodes) { const L = nodeLoad(M, n); fmax = Math.max(fmax, Math.hypot(L.fx, L.fy)); }
    if (!(fmax > 0)) return;
    ctx.save();
    ctx.strokeStyle = COL.load; ctx.fillStyle = COL.load; ctx.lineWidth = 2.2;
    ctx.font = `12px ${MONO}`;
    for (const n of M.nodes) {
      const L = nodeLoad(M, n), fx = L.fx * lf, fy = L.fy * lf, F = Math.hypot(fx, fy);
      if (!(F > 0)) continue;
      const len = 26 + 34 * Math.hypot(L.fx, L.fy) / fmax;
      const ux = fx / F, uy = -fy / F;
      const [x, y] = P.get(n);
      const hx = x - ux * 7, hy = y - uy * 7, tx = hx - ux * len, ty = hy - uy * len;
      ctx.strokeStyle = COL.load; ctx.fillStyle = COL.load;
      arrow(tx, ty, hx, hy, 9);
      const label = fx !== 0 && fy !== 0 ? `${fmt(F / fU(), 3)} ${state.s.forceUnit} ∠${fmt(Math.atan2(fy, fx) / D2R, 3)}°` : `${fmt(F / fU(), 3)} ${state.s.forceUnit}`;
      // beside the shaft, near its tail: the side to the right of a vertical arrow, above a horizontal one
      let px = -uy, py = ux;
      if (px < 0 || (Math.abs(px) < 1e-9 && py > 0)) { px = -px; py = -py; }
      const lx = tx + (hx - tx) * 0.3 + px * 7, ly = ty + (hy - ty) * 0.3 + py * 7;
      tag(label, lx, ly, Math.abs(px) > 0.3 ? 'left' : 'center', Math.abs(px) > 0.3 ? 'middle' : 'bottom', COL.load);
    }
    ctx.restore();
  }
  /** Text label on a plate, for legibility over members and grid. */
  function tag(text, x, y, align, baseline, color) {
    ctx.textAlign = align; ctx.textBaseline = baseline;
    const w = ctx.measureText(text).width;
    const bx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const by = baseline === 'bottom' ? y - 15 : baseline === 'top' ? y - 2 : y - 9;
    ctx.fillStyle = COL.plate;
    ctx.fillRect(bx - 4, by, w + 8, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
  function drawReactions(r, P) {
    ctx.save();
    ctx.strokeStyle = COL.reaction; ctx.fillStyle = COL.reaction; ctx.lineWidth = 2;
    ctx.font = `12px ${MONO}`;
    const ref = r.summary.Fref;
    for (const n of state.model.nodes) {
      const nr = nodeRes(r, n);
      if (!nr || !(nr.restrained[0] || nr.restrained[1])) continue;
      const [c, s] = nr.frame;
      const axes = [[c, s, nr.rLocal[0], nr.restrained[0], 0], [-s, c, nr.rLocal[1], nr.restrained[1], 1]];
      const [x, y] = P.get(n);
      for (const [ex, ey, val, fixed, ax] of axes) {
        if (!fixed || Math.abs(val) <= 1e-9 * ref) continue;
        const sg = Math.sign(val), ux = ex * sg, uy = -ey * sg;
        const hx = x - ux * 8, hy = y - uy * 8, len = 40, tx = hx - ux * len, ty = hy - uy * len;
        ctx.strokeStyle = COL.reaction; ctx.fillStyle = COL.reaction;
        arrow(tx, ty, hx, hy, 9, true); // open arrowhead: a reaction, not an applied load
        const name = nr.rotated ? (n.support.type === 'inclined' ? 'Rn' : ax ? 'Ry′' : 'Rx′') : ax ? 'Ry' : 'Rx';
        const label = `${name} = ${fF(val, ref)} ${state.s.forceUnit}`;
        // horizontal arrows: label below the shaft so it does not hide the arrow
        tag(label, tx - ux * 4, ty - uy * 4 + (Math.abs(ux) > 0.9 ? 12 : 0),
          ux > 0.3 ? 'right' : ux < -0.3 ? 'left' : 'center', uy > 0.3 ? 'bottom' : uy < -0.3 ? 'top' : 'middle', COL.reaction);
      }
    }
    ctx.restore();
  }
  function drawLabels(P, r, showRes) {
    const M = state.model;
    ctx.save();
    ctx.font = `12px ${MONO}`;
    if (state.s.showNodeLabels) {
      ctx.fillStyle = COL.text2; ctx.textAlign = 'left';
      M.nodes.forEach((n, i) => {
        const [x, y] = P.get(n), L = state.s.showLoads ? nodeLoad(M, n) : ZERO_XY;
        const below = L.fy * state.s.loadFactor < 0; // a downward load arrow arrives from above: put the label below
        ctx.textBaseline = below ? 'top' : 'bottom';
        ctx.fillText(`N${i + 1}`, x + 7, below ? y + 6 : y - 6);
      });
    }
    if (state.s.showMemberLabels || (state.s.showForceLabels && showRes)) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      M.members.forEach((e, k) => {
        const a = P.get(e.n1), b = P.get(e.n2);
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const parts = [];
        if (state.s.showMemberLabels) parts.push(`M${k + 1}`);
        const mr = showRes ? memberRes(r, e) : null;
        if (state.s.showForceLabels && mr) parts.push(mr.state === 'zero' ? '0' : `${mr.force > 0 ? '+' : ''}${fF(mr.force, r.summary.Fref)}`);
        if (!parts.length) return;
        const t = parts.join('  ');
        const w = ctx.measureText(t).width + 10;
        ctx.fillStyle = COL.plate;
        ctx.fillRect(mx - w / 2, my - 9, w, 18);
        ctx.fillStyle = mr ? (mr.state === 'zero' ? COL.zeroHex : mr.force > 0 ? COL.tensionHex : COL.compressionHex) : COL.text2;
        ctx.fillText(t, mx, my);
      });
    }
    ctx.restore();
  }
  function drawToolOverlay(info) {
    const p = state.pointer;
    if (state.drag && state.drag.type === 'box') {
      const d = state.drag;
      ctx.save();
      ctx.fillStyle = alpha(COL.selRgb, 0.08); ctx.strokeStyle = alpha(COL.selRgb, 0.8); ctx.setLineDash([4, 3]);
      ctx.fillRect(d.x0, d.y0, p.sx - d.x0, p.sy - d.y0); ctx.strokeRect(d.x0 + 0.5, d.y0 + 0.5, p.sx - d.x0, p.sy - d.y0);
      ctx.restore();
    }
    if (!p.inside || isViewOnly()) return;
    if (state.tool === 'node' || state.tool === 'member') {
      const pt = resolvePoint(p.sx, p.sy);
      const [x, y] = w2s(pt.x, pt.y);
      ctx.save();
      ctx.strokeStyle = pt.node ? COL.accent : COL.text2; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke();
      if (pt.node) { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); }
      if (state.tool === 'member' && state.memberStart) {
        const st = state.memberStart;
        const [sx, sy] = st.node ? w2s(st.node.x, st.node.y) : w2s(st.x, st.y);
        ctx.setLineDash([6, 4]); ctx.strokeStyle = COL.accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x, y); ctx.stroke();
        if (!st.node) { ctx.setLineDash([]); ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.stroke(); }
        const x0 = st.node ? st.node.x : st.x, y0 = st.node ? st.node.y : st.y;
        const L = Math.hypot(pt.x - x0, pt.y - y0), ang = Math.atan2(pt.y - y0, pt.x - x0) / D2R;
        ctx.setLineDash([]);
        ctx.font = `12px ${MONO}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        tag(`L = ${fmt(L, 5)} m  θ = ${fmt(ang, 4)}°`, x + 14, y + 12, 'left', 'top', COL.text1);
      } else {
        ctx.font = `12px ${MONO}`;
        tag(`(${fmt(pt.x, 6)}, ${fmt(pt.y, 6)})`, x + 14, y + 12, 'left', 'top', COL.text2);
      }
      ctx.restore();
    }
    if (state.drag && state.drag.type === 'move' && state.drag.moved && state.drag.anchor) {
      const n = state.drag.anchor, [x, y] = w2s(n.x, n.y);
      ctx.save(); ctx.font = `12px ${MONO}`;
      tag(`(${fmt(n.x, 6)}, ${fmt(n.y, 6)}) m`, x + 14, y + 12, 'left', 'top', COL.text1); ctx.restore();
    }
  }
  function updateHud(info) {
    const r = info.r;
    const lines = [];
    if (info.mode === 'deformed' && !resultsHidden()) lines.push(`<b>Deflection ×${fmt(state.s.scale, 4)}</b>, dashed: undeformed`);
    const ac = state.model.activeCombination;
    if (ac) lines.push(`Combination: <b>${esc(ac.name)}</b> = ${esc(combinationText(ac))}`);
    else if (state.model.loadCases.length > 1) lines.push(`Load case: <b>${esc(state.model.activeCase.name)}</b>${isGeneratedCase(state.model.activeCase) ? ' (generated)' : ''}`);
    if (selfWeightAnalysed()) {
      const sw = selfWeightSummary(state.model);
      if (!sw.complete) lines.push(`<b>Self-weight incomplete:</b> ${plural(sw.missing.length, 'member')} without density`);
    }
    if (state.s.loadFactor !== 1) lines.push(`<b>Load factor λ = ${fmt(state.s.loadFactor, 4)}</b>`);
    if (r && r.ok && !resultsHidden()) lines.push(`δ<sub>max</sub> ${fD(r.summary.maxDisp.value)} ${state.s.dispUnit}, SF<sub>min</sub> ${fmt(r.summary.minSF.value, 3)}`);
    if (resultsHidden()) lines.push(`<b>Results hidden</b> until ${state.learn.view === 'joints' ? 'every member force is found' : 'you check your predictions'}`);
    const html = lines.join('<br>');
    const hud = $('#hud');
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }

  /* =====================================================================
   * 8. Editing operations
   * ===================================================================== */
  function modelChanged(o) {
    o = o || {};
    state.res && (state.stale = true);
    if (o.groups || o.materials) renderLeftLists();
    if (!o.keepInspector) renderInspector();
    scheduleSave();
    requestSolve();
    requestRender();
    refreshCounts();
    if (!state.s.liveSolve) refreshResults();
  }
  function clearSelection(render = true) {
    state.sel.nodes.clear(); state.sel.members.clear();
    if (render) { renderInspector(); renderTablesIfVisible(); requestRender(); onSelectionChanged(); }
  }
  function selectOnly(kind, obj) {
    state.sel.nodes.clear(); state.sel.members.clear();
    if (obj) (kind === 'node' ? state.sel.nodes : state.sel.members).add(obj);
    if (obj && state.s.rightTab !== 'inspector') setRightTab('inspector'); // the selection is what the user wants to see
    renderInspector(); renderTablesIfVisible(); requestRender(); onSelectionChanged();
  }
  function toggleSel(kind, obj) {
    const set = kind === 'node' ? state.sel.nodes : state.sel.members;
    set.has(obj) ? set.delete(obj) : set.add(obj);
    renderInspector(); renderTablesIfVisible(); requestRender(); onSelectionChanged();
  }
  function selectAll() {
    state.model.nodes.forEach((n) => state.sel.nodes.add(n));
    state.model.members.forEach((e) => state.sel.members.add(e));
    renderInspector(); renderTablesIfVisible(); requestRender(); onSelectionChanged();
  }
  function findMember(a, b) { return state.model.members.find((e) => (e.n1 === a && e.n2 === b) || (e.n1 === b && e.n2 === a)); }
  function addNodeAt(x, y, undoable = true) {
    const tol = 1e-9 * Math.max(1, modelExtent());
    const ex = state.model.nodes.find((n) => Math.abs(n.x - x) <= tol && Math.abs(n.y - y) <= tol);
    if (ex) return { node: ex, created: false };
    if (undoable) pushUndo();
    const n = makeNode(x, y);
    state.model.nodes.push(n);
    return { node: n, created: true };
  }
  function ensureActiveGroup() {
    if (!state.activeGroup || !state.model.groups.includes(state.activeGroup)) state.activeGroup = state.model.groups[0];
    if (!state.activeGroup) {
      const g = makeGroup('Default: A 2000 mm²', state.model.materials[0] || makeMaterial('steel'), { type: 'custom' }, GROUP_COLORS[0], 2000 * MM2, 2e6 * MM4);
      if (!state.model.materials.length) state.model.materials.push(g.material);
      state.model.groups.push(g);
      state.activeGroup = g;
      renderLeftLists();
    }
    return state.activeGroup;
  }
  function addMemberBetween(a, b) {
    if (a === b) return null;
    if (findMember(a, b)) { toast(`Nodes ${nodeNo(a)} and ${nodeNo(b)} are already connected`, 'warn'); return null; }
    const e = makeMember(a, b, ensureActiveGroup());
    state.model.members.push(e);
    return e;
  }
  function deleteSelection() {
    const ns = state.sel.nodes, ms = state.sel.members;
    if (!ns.size && !ms.size) return;
    pushUndo();
    const nCount = ns.size;
    const before = state.model.members.length;
    removeNodeActions(state.model, [...ns]); // their loads and settlements, in every load case
    state.model.members = state.model.members.filter((e) => !ms.has(e) && !ns.has(e.n1) && !ns.has(e.n2));
    state.model.nodes = state.model.nodes.filter((n) => !ns.has(n));
    if (state.memberStart && state.memberStart.node && ns.has(state.memberStart.node)) state.memberStart = null;
    const mCount = before - state.model.members.length;
    const pruned = pruneDesign(state.model); // the deflection criterion keeps only nodes that still exist
    if (pruned && state.design) state.design.edit = null;
    clearSelection(false);
    toast(`Deleted ${plural(nCount, 'node')} and ${plural(mCount, 'member')}${pruned === 'criterion' ? '; the deflection criterion lost a reference node and was removed' : pruned === 'nodes' ? '; the deleted nodes were removed from the deflection criterion' : ''}`);
    modelChanged();
  }
  function nudge(dx, dy) {
    const nodes = new Set(state.sel.nodes);
    state.sel.members.forEach((e) => { nodes.add(e.n1); nodes.add(e.n2); });
    if (!nodes.size) return;
    pushUndo();
    for (const n of nodes) {
      n.x = onGrid(n.x) ? snapCoord(n.x + dx) : n.x + dx;
      n.y = onGrid(n.y) ? snapCoord(n.y + dy) : n.y + dy;
    }
    modelChanged({ keepInspector: true });
    syncInspectorInputs();
  }

  /* =====================================================================
   * 9. Pointer, wheel and keyboard interaction
   * ===================================================================== */
  function localPos(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function setTool(t) {
    if (isViewOnly() && t !== 'select' && t !== 'pan') { refuseViewOnly(); t = 'select'; }
    state.tool = t;
    if (t !== 'member') state.memberStart = null;
    $$('#tools .tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    canvas.className = `tool-${t}`;
    renderToolOptions();
    refreshHint();
    requestRender();
  }
  const HINTS = {
    select: 'Click to select, Shift+click to add. Drag nodes to move them, drag on empty space to box-select. Del deletes.',
    node: 'Click to place a node (it snaps to the grid and to nodes), or type exact X and Y.',
    member: 'Click the start node, then the end node; empty space creates a node. Esc or right-click ends the chain.',
    support: 'Choose a support type, then click nodes. Clicking a node that already has that support removes it.',
    load: 'Set Fx and Fy, then click nodes. Positive is +x to the right and +y up.',
    pan: 'Drag to pan; the wheel zooms at the pointer.',
  };
  function refreshHint() { $('#sbHint').textContent = HINTS[state.tool] || ''; }

  canvas.addEventListener('pointerdown', (e) => {
    const [sx, sy] = localPos(e);
    state.pointer.sx = sx; state.pointer.sy = sy;
    hideTooltip();
    closeMenus();
    if (e.pointerType === 'touch') {
      state.touches.set(e.pointerId, [sx, sy]);
      if (state.touches.size === 2) { if (state.drag && state.drag.snap && state.drag.moved) restoreSnapshot(state.drag.snap); pinchStart(); return; }
      if (state.touches.size > 2) return;
    }
    if (e.button === 2 && state.tool === 'member' && state.memberStart) { state.memberStart = null; requestRender(); return; }
    if (isViewOnly() && e.button === 0 && state.tool !== 'pan' && !state.spaceDown) {
      // view-only: a tap selects (to inspect), a drag pans; nothing is edited
      const hit = pick(sx, sy);
      if (hit) { selectOnly(hit.kind, hit.obj); return; }
      state.drag = { type: 'pan', sx, sy, cx: state.view.cx, cy: state.view.cy, moved: false, tap: true };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 1 || e.button === 2 || state.tool === 'pan' || state.spaceDown) {
      state.drag = { type: 'pan', sx, sy, cx: state.view.cx, cy: state.view.cy, moved: false };
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('panning');
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    switch (state.tool) {
      case 'select': downSelect(e, sx, sy); break;
      case 'node': downNode(sx, sy); break;
      case 'member': downMember(sx, sy); break;
      case 'support': downSupport(sx, sy); break;
      case 'load': downLoad(sx, sy); break;
      default: break;
    }
  });
  function downSelect(e, sx, sy) {
    const hit = pick(sx, sy);
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (hit) {
      if (add) { toggleSel(hit.kind, hit.obj); return; }
      const set = hit.kind === 'node' ? state.sel.nodes : state.sel.members;
      if (!set.has(hit.obj)) selectOnly(hit.kind, hit.obj);
      const nodes = new Set(state.sel.nodes);
      state.sel.members.forEach((m) => { nodes.add(m.n1); nodes.add(m.n2); });
      const [wx, wy] = s2w(sx, sy);
      const anchor = hit.kind === 'node' ? hit.obj : null;
      state.drag = {
        type: 'move', nodes: [...nodes], start: new Map([...nodes].map((n) => [n, [n.x, n.y]])),
        w0: [wx, wy], anchor, a0: anchor ? [anchor.x, anchor.y] : null, sx, sy, moved: false, snap: snapshot(),
      };
    } else {
      state.drag = { type: 'box', x0: sx, y0: sy, add, moved: false };
    }
  }
  function downNode(sx, sy) {
    const pt = resolvePoint(sx, sy);
    if (pt.node) { selectOnly('node', pt.node); return; }
    const { node } = addNodeAt(pt.x, pt.y);
    selectOnly('node', node);
    modelChanged();
  }
  function downMember(sx, sy) {
    const pt = resolvePoint(sx, sy);
    if (!state.memberStart) { state.memberStart = pt.node ? { node: pt.node } : { node: null, x: pt.x, y: pt.y }; requestRender(); return; }
    const st = state.memberStart;
    if (pt.node && pt.node === st.node) return;
    if (!st.node && !pt.node && Math.abs(st.x - pt.x) < 1e-12 && Math.abs(st.y - pt.y) < 1e-12) return;
    if (st.node && pt.node && findMember(st.node, pt.node)) { toast(`Nodes ${nodeNo(st.node)} and ${nodeNo(pt.node)} are already connected`, 'warn'); state.memberStart = { node: pt.node }; requestRender(); return; }
    pushUndo();
    const a = st.node || addNodeAt(st.x, st.y, false).node;
    const b = pt.node || addNodeAt(pt.x, pt.y, false).node;
    const e = addMemberBetween(a, b);
    state.memberStart = state.s.chain ? { node: b } : null;
    if (e) selectOnly('member', e);
    modelChanged();
  }
  function downSupport(sx, sy) {
    const n = pickNode(sx, sy, 10);
    if (!n) return;
    pushUndo();
    const t = state.supTool;
    const same = n.support.type === t.type && (t.type !== 'inclined' || n.support.angle === t.angle);
    if (same && t.type !== 'custom') setSupport(n, 'none');
    else setSupport(n, t.type, t.type === 'inclined' ? t.angle : undefined);
    selectOnly('node', n);
    modelChanged();
  }
  /**
   * True, after a message, when loads and settlements cannot be entered in what is on screen: a combination (its
   * actions are the factored sum of its load cases) or the generated self-weight case.
   */
  function refuseEntry() {
    const c = state.model.activeCombination;
    if (c) {
      toast(`“${c.name}” is a combination: its actions are the factored sum of its load cases. Choose a load case to enter loads or settlements`, 'warn');
      return true;
    }
    const lc = state.model.activeCase;
    if (!isGeneratedCase(lc)) return false;
    toast(`“${lc.name}” is generated from the members’ weight, so loads and settlements cannot be entered in it. Choose another load case`, 'warn');
    return true;
  }
  function downLoad(sx, sy) {
    const n = pickNode(sx, sy, 10);
    if (!n || refuseEntry()) return;
    pushUndo();
    const t = state.loadTool, cur = nodeLoad(state.model, n); // the active load case
    if (t.mode === 'clear') setNodeLoad(state.model, n, 0, 0);
    else if (t.mode === 'add') setNodeLoad(state.model, n, cur.fx + t.fx, cur.fy + t.fy);
    else setNodeLoad(state.model, n, t.fx, t.fy);
    selectOnly('node', n);
    modelChanged();
  }

  window.addEventListener('pointermove', (e) => {
    const [sx, sy] = localPos(e);
    const inside = sx >= 0 && sy >= 0 && sx <= state.W && sy <= state.H && e.target === canvas;
    state.pointer.sx = sx; state.pointer.sy = sy; state.pointer.inside = inside || !!state.drag;
    const d = state.drag;
    if (e.pointerType === 'touch' && state.touches.has(e.pointerId)) state.touches.set(e.pointerId, [sx, sy]);
    if (d && d.type === 'pinch') { pinchMove(); return; }
    if (d) {
      if (d.type === 'pan') {
        state.view.cx = d.cx - (sx - d.sx) / state.view.zoom;
        state.view.cy = d.cy + (sy - d.sy) / state.view.zoom;
        d.moved = true;
        requestRender();
      } else if (d.type === 'move') {
        if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
        if (!d.moved) { d.moved = true; pushUndo(d.snap); canvas.classList.add('dragging'); }
        const [wx, wy] = s2w(sx, sy);
        let ddx = wx - d.w0[0], ddy = wy - d.w0[1];
        if (d.anchor && state.s.snap) { ddx = snapCoord(d.a0[0] + ddx) - d.a0[0]; ddy = snapCoord(d.a0[1] + ddy) - d.a0[1]; }
        else if (state.s.snap) { ddx = snapCoord(ddx); ddy = snapCoord(ddy); }
        for (const n of d.nodes) {
          const [x0, y0] = d.start.get(n);
          n.x = state.s.snap && onGrid(x0) ? snapCoord(x0 + ddx) : x0 + ddx;
          n.y = state.s.snap && onGrid(y0) ? snapCoord(y0 + ddy) : y0 + ddy;
        }
        state.stale = true;
        requestSolve();
        requestRender();
        syncInspectorInputs();
      } else if (d.type === 'box') {
        d.moved = d.moved || Math.hypot(sx - d.x0, sy - d.y0) > 3;
        requestRender();
      }
      updateCoords(sx, sy);
      return;
    }
    if (!inside) return;
    updateCoords(sx, sy);
    const hit = state.tool === 'pan' ? null : pick(sx, sy);
    const prev = state.hover && state.hover.obj;
    state.hover = hit;
    canvas.classList.toggle('hovering', !!hit && state.tool !== 'node');
    if ((hit && hit.obj) !== prev || state.tool === 'node' || state.tool === 'member') requestRender();
    if (hit) showTooltip(hit, sx, sy); else hideTooltip();
  });
  const endTouch = (e) => {
    if (e.pointerType !== 'touch') return false;
    state.touches.delete(e.pointerId);
    if (state.drag && state.drag.type === 'pinch') { if (state.touches.size < 2) { state.drag = null; scheduleSave(); } return true; }
    return false;
  };
  window.addEventListener('pointercancel', (e) => { endTouch(e); if (state.drag && state.drag.type !== 'move') state.drag = null; canvas.classList.remove('panning', 'dragging'); });
  window.addEventListener('pointerup', (e) => {
    if (endTouch(e)) return;
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    canvas.classList.remove('panning', 'dragging');
    if (d.type === 'pan') { if (d.tap && !d.moved) clearSelection(); scheduleSave(); return; }
    if (d.type === 'move') {
      if (d.moved) { modelChanged({ keepInspector: true }); syncInspectorInputs(); renderInspectorResults(); }
      return;
    }
    if (d.type === 'box') {
      const [sx, sy] = localPos(e);
      if (!d.moved) { if (!d.add) clearSelection(); return; }
      const x0 = Math.min(d.x0, sx), x1 = Math.max(d.x0, sx), y0 = Math.min(d.y0, sy), y1 = Math.max(d.y0, sy);
      if (!d.add) { state.sel.nodes.clear(); state.sel.members.clear(); }
      const inBox = (n) => { const [px, py] = w2s(n.x, n.y); return px >= x0 && px <= x1 && py >= y0 && py <= y1; };
      state.model.nodes.forEach((n) => { if (inBox(n)) state.sel.nodes.add(n); });
      state.model.members.forEach((m) => { if (inBox(m.n1) && inBox(m.n2)) state.sel.members.add(m); });
      renderInspector(); renderTablesIfVisible(); requestRender(); onSelectionChanged();
    }
  });
  canvas.addEventListener('pointerleave', () => { if (!state.drag) { state.pointer.inside = false; state.hover = null; hideTooltip(); requestRender(); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = localPos(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    zoomAt(Math.exp(-e.deltaY * unit * 0.0016), sx, sy);
  }, { passive: false });

  function updateCoords(sx, sy) {
    let [x, y] = s2w(sx, sy);
    if (state.s.snap && (state.tool === 'node' || state.tool === 'member')) { x = snapCoord(x); y = snapCoord(y); }
    $('#sbCoords').textContent = `x ${fmt(x, 5)} m, y ${fmt(y, 5)} m`;
  }

  const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'range';
  const isToggle = (el) => el && el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
  /** Keys the focused control handles natively: Enter/Space press buttons, Space toggles checkboxes, arrows move sliders and radio groups. */
  function nativeKey(el, key) {
    if (!el) return false;
    if (key === 'Enter') return el.tagName === 'BUTTON' || el.tagName === 'SUMMARY';
    if (key === ' ') return el.tagName === 'BUTTON' || el.tagName === 'SUMMARY' || isToggle(el);
    if (key.startsWith('Arrow')) return el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'radio');
    return false;
  }
  window.addEventListener('keydown', (e) => {
    if (!$('#helpModal').hidden) { if (e.key === 'Escape') toggleHelp(false); return; }
    if (e.key === 'Escape' && anyMenuOpen()) { closeMenus(); return; }
    if (isTyping(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (nativeKey(e.target, e.key)) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    // view-only (phones): shortcuts that would edit the model are refused; viewing shortcuts still work
    if (isViewOnly() && ((mod && (k === 'z' || k === 'y')) || (!mod && !e.altKey && ['n', 'm', 's', 'l', 'delete', 'backspace', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)))) {
      e.preventDefault(); refuseViewOnly(); return;
    }
    if (mod) {
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); exportModel(); }
      else if (k === 'o') { e.preventDefault(); $('#fileInput').click(); }
      else if (k === 'a') { e.preventDefault(); selectAll(); }
      return;
    }
    if (e.altKey) return;
    const step = state.s.grid * (e.shiftKey ? 10 : 1);
    switch (k) {
      case 'v': setTool('select'); break;
      case 'n': setTool('node'); break;
      case 'm': setTool('member'); break;
      case 's': setTool('support'); break;
      case 'l': setTool('load'); break;
      case 'h': setTool('pan'); break;
      case 'f': fitView(); break;
      // G and D do what the "Snap to grid" and "Deformed" checkboxes do, including the autosave (and, for D, the legend)
      case 'g': state.s.snap = !state.s.snap; syncSettingsUI(); scheduleSave(); toast(`Grid snap ${state.s.snap ? 'on' : 'off'}`); break;
      case 'd': state.s.showDeformed = !state.s.showDeformed; syncSettingsUI(); scheduleSave(); renderLegend(); requestRender(); break;
      case 'enter': e.preventDefault(); solve(true); break;
      case 'delete': case 'backspace': e.preventDefault(); deleteSelection(); break;
      case 'escape':
        if (state.memberStart) state.memberStart = null;
        else clearSelection();
        requestRender();
        break;
      case '?': toggleHelp(true); break;
      case 'arrowleft': e.preventDefault(); nudge(-step, 0); break;
      case 'arrowright': e.preventDefault(); nudge(step, 0); break;
      case 'arrowup': e.preventDefault(); nudge(0, step); break;
      case 'arrowdown': e.preventDefault(); nudge(0, -step); break;
      case ' ': state.spaceDown = true; e.preventDefault(); break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') state.spaceDown = false; });

  /* ---------- tool option bar ---------- */
  function renderToolOptions() {
    const box = $('#toolOptions');
    const fu = state.s.forceUnit;
    let h = '';
    switch (state.tool) {
      case 'node':
        h = `<span class="tool-name">Node</span>
             <label>X <input class="num w6" id="toX" placeholder="0" title="Exact x (m). Expressions allowed"></label>
             <label>Y <input class="num w6" id="toY" placeholder="0" title="Exact y (m). Expressions allowed"></label><span class="u">m</span>
             <button class="btn sm" id="toAddNode">Add node</button>`;
        break;
      case 'member':
        h = `<span class="tool-name">Member</span><label>Section <select class="select" id="toGroup">${state.model.groups.map((g, i) => `<option value="${i}" ${g === state.activeGroup ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
             <span class="sep"></span>
             <label>From N <input class="num w4" id="toFrom" aria-label="Start node number"></label><label>to N <input class="num w4" id="toTo" aria-label="End node number"></label>
             <button class="btn sm" id="toConnect">Connect</button>
             <label class="chk" title="Continue drawing from the end node"><input type="checkbox" id="toChain" ${state.s.chain ? 'checked' : ''}> Chain</label>`;
        break;
      case 'support':
        h = `<span class="tool-name">Support</span><label>Type <select class="select" id="toSupType">${SUPPORT_TYPES.filter(([k]) => k !== 'none').map(([k, l]) => `<option value="${k}" ${k === state.supTool.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
             <label id="toAngleWrap" ${state.supTool.type === 'inclined' ? '' : 'hidden'}>Surface α <input class="num w5" id="toAngle" value="${inVal(state.supTool.angle)}"> °</label>`;
        break;
      case 'load':
        h = `<span class="tool-name">Load</span><label>F<sub>x</sub> <input class="num w6" id="toFx" value="${inVal(state.loadTool.fx / fU())}"></label>
             <label>F<sub>y</sub> <input class="num w6" id="toFy" value="${inVal(state.loadTool.fy / fU())}"></label><span class="u">${fu}</span>
             <label>Mode <select class="select" id="toLoadMode"><option value="set">Set</option><option value="add">Add</option><option value="clear">Clear</option></select></label>
             <span class="hint">in “${esc((state.model.activeCombination || state.model.activeCase).name)}”</span>`;
        break;
      default: h = ''; // select and pan have no options; their hint is in the status bar
    }
    if (isViewOnly()) h = '';
    box.innerHTML = h;
    const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    const addNode = () => {
      const x = evalNum($('#toX').value || '0'), y = evalNum($('#toY').value || '0');
      if (!Number.isFinite(x) || !Number.isFinite(y)) { toast('Enter valid X and Y values', 'bad'); return; }
      const r = addNodeAt(x, y);
      if (!r.created) toast(`Node ${nodeNo(r.node)} already exists at that position`, 'warn');
      selectOnly('node', r.node);
      modelChanged();
    };
    on('toAddNode', 'click', addNode);
    ['toX', 'toY'].forEach((id) => on(id, 'keydown', (e) => { if (e.key === 'Enter') addNode(); }));
    on('toGroup', 'change', (e) => { state.activeGroup = state.model.groups[+e.target.value]; renderLeftLists(); });
    const connect = () => {
      const a = state.model.nodes[Math.round(evalNum($('#toFrom').value)) - 1], b = state.model.nodes[Math.round(evalNum($('#toTo').value)) - 1];
      if (!a || !b || a === b) { toast('Enter two different existing node numbers', 'bad'); return; }
      if (findMember(a, b)) { toast('Those nodes are already connected', 'warn'); return; }
      pushUndo();
      const e = addMemberBetween(a, b);
      selectOnly('member', e);
      modelChanged();
    };
    on('toConnect', 'click', connect);
    ['toFrom', 'toTo'].forEach((id) => on(id, 'keydown', (e) => { if (e.key === 'Enter') connect(); }));
    on('toChain', 'change', (e) => { state.s.chain = e.target.checked; scheduleSave(); });
    on('toSupType', 'change', (e) => { state.supTool.type = e.target.value; $('#toAngleWrap').hidden = e.target.value !== 'inclined'; });
    on('toAngle', 'change', (e) => { const v = evalNum(e.target.value); if (Number.isFinite(v)) state.supTool.angle = v; else e.target.value = inVal(state.supTool.angle); });
    on('toFx', 'change', (e) => { const v = evalNum(e.target.value); if (Number.isFinite(v)) state.loadTool.fx = v * fU(); else e.target.value = inVal(state.loadTool.fx / fU()); });
    on('toFy', 'change', (e) => { const v = evalNum(e.target.value); if (Number.isFinite(v)) state.loadTool.fy = v * fU(); else e.target.value = inVal(state.loadTool.fy / fU()); });
    const lm = $('#toLoadMode');
    if (lm) { lm.value = state.loadTool.mode; lm.addEventListener('change', (e) => { state.loadTool.mode = e.target.value; }); }
  }

  /* ---------- hover tooltips ---------- */
  const tooltip = $('#tooltip');
  function hideTooltip() { tooltip.hidden = true; }
  function showTooltip(hit, sx, sy) {
    const r = R();
    const fu = state.s.forceUnit, du = state.s.dispUnit;
    const row = (k, v, cls) => `<tr${cls ? ` class="${cls}"` : ''}><td>${k}</td><td>${v}</td></tr>`;
    let h = '';
    if (hit.kind === 'node') {
      const n = hit.obj, nr = r && r.ok ? nodeRes(r, n) : null;
      h = `<div class="tt-h">Node ${nodeNo(n)}<small>(${fmt(n.x, 6)}, ${fmt(n.y, 6)}) m</small></div><table>`;
      h += row('Support', esc(nodeSupportText(n)));
      const L = nodeLoad(state.model, n), st = nodeSettlement(state.model, n), lf = state.s.loadFactor;
      if (L.fx || L.fy) h += row('Load (×λ)', `${fF(L.fx * lf)}, ${fF(L.fy * lf)} ${fu}`);
      if (st.dx || st.dy) h += row('Settlement (×λ)', `${fD(st.dx * lf)}, ${fD(st.dy * lf)} ${du} along x′, y′`);
      if (nr) {
        const ref = r.summary.maxDisp.value;
        h += row('u<sub>x</sub>', `${fD(nr.ux, ref)} ${du}`, 'sep') + row('u<sub>y</sub>', `${fD(nr.uy, ref)} ${du}`) + row('|u|', `${fD(nr.u, ref)} ${du}`);
        if (nr.restrained[0] || nr.restrained[1]) {
          const ref2 = r.summary.Fref;
          h += row('R<sub>x</sub>', `${fF(nr.rx, ref2)} ${fu}`, 'sep') + row('R<sub>y</sub>', `${fF(nr.ry, ref2)} ${fu}`);
          if (nr.rotated) h += row(n.support.type === 'inclined' ? 'R<sub>n</sub> (normal)' : 'R<sub>x′</sub>, R<sub>y′</sub>', n.support.type === 'inclined' ? `${fF(nr.rLocal[1], ref2)} ${fu}` : `${fF(nr.rLocal[0], ref2)}, ${fF(nr.rLocal[1], ref2)} ${fu}`);
        }
      }
      h += '</table>';
    } else {
      const e = hit.obj, mr = r && r.ok ? memberRes(r, e) : null;
      const L = Math.hypot(e.n2.x - e.n1.x, e.n2.y - e.n1.y), th = Math.atan2(e.n2.y - e.n1.y, e.n2.x - e.n1.x) / D2R;
      h = `<div class="tt-h">Member ${memberNo(e)}<small>N${nodeNo(e.n1)} → N${nodeNo(e.n2)}</small></div><table>`;
      h += row('Section', esc(e.group.name)) + row('Material', esc(e.group.material.name));
      h += row('L, θ', `${fmt(L, 6)} m, ${fmt(th, 5)}°`);
      if (mr) {
        const ref = r.summary.Fref, kind = mr.state === 'zero' ? 'zero-force' : mr.state;
        h += row('Axial force F', `${mr.state === 'zero' ? '0' : fF(mr.force, ref)} ${fu} <span class="dim">${kind}</span>`, 'sep');
        h += row('Stress σ', `${mr.state === 'zero' ? '0' : fS(mr.stress, ref / mr.A)} MPa`);
        h += row('Strain ε', mr.state === 'zero' ? '0' : fmt(mr.strain));
        h += row('ΔL', `${mr.state === 'zero' ? '0' : fD(mr.elong)} ${du}`);
        h += row('P<sub>cr</sub> (Euler)', `${fF(mr.Pcr)} ${fu}`, 'sep');
        h += row('Slenderness L/r', fmt(mr.slenderness, 4));
        h += row('SF yield / buckling', `${fmt(mr.sfYield, 3)} / ${fmt(mr.sfBuckling, 3)}`);
        h += row('Safety factor', `<b>${fmt(mr.sf, 3)}</b>${mr.governs !== 'none' ? ` <span class="dim">${mr.governs}</span>` : ''}`);
        h += row('Status', statusBadge(mr));
      }
      h += '</table>';
    }
    tooltip.innerHTML = h;
    tooltip.hidden = false;
    const tw = tooltip.offsetWidth, th2 = tooltip.offsetHeight;
    let x = sx + 16, y = sy + 16;
    if (x + tw > state.W - 6) x = sx - tw - 14;
    if (y + th2 > state.H - 6) y = Math.max(6, sy - th2 - 12);
    tooltip.style.left = `${Math.max(6, x)}px`;
    tooltip.style.top = `${y}px`;
  }
  function statusBadge(mr) {
    if (mr.status === 'yielded') return '<span class="badge yielded">Yielded</span>';
    if (mr.status === 'buckled') return '<span class="badge buckled">Buckled</span>';
    if (mr.state === 'zero') return '<span class="badge zero">Safe, zero force</span>';
    if (mr.lowSF) return '<span class="badge low">Safe, below target</span>';
    return '<span class="badge safe">Safe</span>';
  }

  /* =====================================================================
   * 10. Left panel: materials, section groups, settings
   * ===================================================================== */
  function renderLeftLists() { renderMaterials(); renderGroups(); renderGroupEditor(); renderLoadCases(); if (state.tool === 'member') renderToolOptions(); }

  /**
   * Load-case controls (Analysis section): what is on screen (a load case, or a combination listed under
   * "Combinations"), its name, adding or deleting cases and combinations, and a combination's factors.
   */
  function renderLoadCases() {
    const m = state.model, sel = $('#selLoadCase'), name = $('#txtCaseName'), ac = m.activeCombination;
    sel.innerHTML = m.loadCases.map((c, i) => `<option value="${i}">${esc(c.name)}${isGeneratedCase(c) ? ' (generated)' : ''}</option>`).join('') +
      (m.combinations.length ? `<optgroup label="Combinations">${m.combinations.map((c, i) => `<option value="c${i}">${esc(c.name)} (combination)</option>`).join('')}</optgroup>` : '');
    sel.value = ac ? `c${m.combinations.indexOf(ac)}` : String(m.loadCases.indexOf(m.activeCase));
    if (document.activeElement !== name) name.value = (ac || m.activeCase).name;
    const del = $('#btnDeleteCase');
    del.disabled = !ac && m.loadCases.length <= 1;
    del.title = ac ? 'Delete this combination (Ctrl+Z undoes it)' : 'Delete the active load case (Ctrl+Z undoes it)';
    const sw = $('#btnAddSelfWeight'), has = !!selfWeightCase(m);
    sw.disabled = has;
    sw.title = has ? 'This model already has its self-weight case' : 'Add the generated self-weight case: each member’s weight W = ρ·A·L·g, half at each end node';
    $('#selfWeightNote').hidden = !!ac || !isGeneratedCase(m.activeCase);
    renderCombinationEditor();
  }
  /** The factors γ of the combination on screen: one field per load case, empty when the case is not in it. */
  function renderCombinationEditor() {
    const box = $('#comboEditor'), c = state.model.activeCombination;
    box.hidden = !c;
    if (!c) { box.innerHTML = ''; return; }
    if (box.contains(document.activeElement)) return; // do not rebuild a field while it is being typed in
    box.innerHTML = `<p class="note">Factors γ of “${esc(c.name)}”. Its actions F = Σ γᵢ·Fᵢ and u<sub>s</sub> = Σ γᵢ·u<sub>s,i</sub> are built first and analysed as one complete state, solved directly, then multiplied by λ. Leave a factor empty to leave the case out; 0 and negative factors are allowed.</p>
      <div class="form-grid">${state.model.loadCases.map((lc, i) => {
        const f = combinationFactor(c, lc);
        return `<label for="cf${i}">${esc(lc.name)}${isGeneratedCase(lc) ? ' (generated)' : ''}</label><div class="inline"><input class="num" id="cf${i}" data-cf="${i}" value="${f === null ? '' : inVal(f)}" placeholder="not included" title="Factor γ on “${esc(lc.name)}”; empty leaves it out"><span class="u">γ</span></div>`;
      }).join('')}</div>`;
  }
  function bindLoadCases() {
    $('#selLoadCase').addEventListener('change', (e) => {
      const v = e.target.value, M = state.model;
      // choosing what to look at is not an edit: no undo step
      if (v[0] === 'c') {
        const c = M.combinations[+v.slice(1)];
        if (!c || c === M.activeCombination) return;
        setActiveCombination(M, c);
      } else {
        const lc = M.loadCases[+v];
        if (!lc || (lc === M.activeCase && !M.activeCombination)) return;
        setActiveLoadCase(M, lc);
      }
      renderLoadCases();
      modelChanged();
    });
    $('#btnAddCombination').addEventListener('click', () => {
      pushUndo();
      const M = state.model, c = addCombination(M);
      setCombinationFactor(M, c, M.activeCase, 1);
      setActiveCombination(M, c);
      renderLoadCases();
      modelChanged();
      toast(`Added “${c.name}” = 1 × ${M.activeCase.name}. Set a factor for each load case; the combination is solved as one complete state`, 'ok');
    });
    $('#comboEditor').addEventListener('change', (e) => {
      const i = e.target.dataset.cf, M = state.model, c = M.activeCombination;
      if (i === undefined || !c) return;
      const lc = M.loadCases[+i], raw = e.target.value.trim();
      const v = raw === '' ? null : evalNum(raw);
      e.target.blur();
      if (v !== null && !Number.isFinite(v)) { toast('A factor must be a number (0 and negative factors are allowed), or empty to leave the case out', 'warn'); renderCombinationEditor(); return; }
      if (v === combinationFactor(c, lc)) { renderCombinationEditor(); return; }
      pushUndo();
      setCombinationFactor(M, c, lc, v);
      renderLoadCases();
      modelChanged();
    });
    $('#btnAddCase').addEventListener('click', () => {
      pushUndo();
      setActiveLoadCase(state.model, addLoadCase(state.model));
      renderLoadCases();
      modelChanged();
      toast(`Added “${state.model.activeCase.name}”. Loads and settlements you apply now go into it`, 'ok');
    });
    $('#btnAddSelfWeight').addEventListener('click', () => {
      if (selfWeightCase(state.model)) return;
      pushUndo();
      setActiveLoadCase(state.model, addSelfWeightCase(state.model));
      renderLoadCases();
      modelChanged();
      toast(`Added “${state.model.activeCase.name}”, generated from the members: W = ρ·A·L·g each, half at each end node`, 'ok');
    });
    const name = $('#txtCaseName');
    name.addEventListener('change', () => {
      const target = state.model.activeCombination || state.model.activeCase; // renames what is on screen
      const v = name.value.trim().slice(0, 80);
      if (!v || v === target.name) { name.value = target.name; return; }
      pushUndo();
      target.name = v;
      renderLoadCases();
      modelChanged();
    });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    $('#btnDeleteCase').addEventListener('click', () => {
      const M = state.model, c = M.activeCombination;
      if (c) {
        pushUndo();
        removeCombination(M, c);
        renderLoadCases();
        modelChanged();
        toast(`Deleted “${c.name}” (Ctrl+Z undoes it)`);
        return;
      }
      if (M.loadCases.length <= 1) return;
      pushUndo();
      const gone = M.activeCase.name, used = M.combinations.filter((x) => combinationFactor(x, M.activeCase) !== null).map((x) => `“${x.name}”`);
      removeLoadCase(M, M.activeCase);
      renderLoadCases();
      modelChanged();
      toast(`Deleted “${gone}”${used.length ? `, and its factor in ${used.join(', ')}` : ''} (Ctrl+Z undoes it)`);
    });
  }

  function renderMaterials() {
    const box = $('#materialsList');
    const used = new Map();
    state.model.groups.forEach((g) => used.set(g.material, (used.get(g.material) || 0) + 1));
    box.innerHTML = state.model.materials.map((m, i) => `
      <div class="mat-card" data-mi="${i}">
        <div class="mat-top">
          <input type="color" data-mf="color" value="${esc(m.color)}" title="Display colour">
          <input class="txt" data-mf="name" value="${esc(m.name)}" title="Material name" maxlength="80">
          <button class="icon-btn" data-mf="del" title="${used.get(m) ? 'Used by section groups' : 'Delete material'}">&#10005;</button>
        </div>
        <div class="mat-props">
          <label><span class="sym">E</span> <input class="num" data-mf="E" value="${inVal(m.E / GPA)}" title="Young's modulus, GPa" aria-label="Young's modulus E of ${esc(m.name)}, GPa"><span class="u">GPa</span></label>
          <label><span class="sym">σ<sub>y</sub></span> <input class="num" data-mf="fy" value="${inVal(m.fy / MPA)}" title="Yield or limit stress, MPa" aria-label="Yield stress of ${esc(m.name)}, MPa"><span class="u">MPa</span></label>
          <label><span class="sym">ρ</span> <input class="num" data-mf="density" aria-label="Density of ${esc(m.name)}, kg/m³" value="${validDensity(m.density) ? inVal(m.density) : ''}" placeholder="not set" title="Density for self-weight, kg/m³ (steel 7850, aluminium 2700, Douglas fir about 540 at 12 % moisture content). Empty means not set: members of this material then carry no self-weight."><span class="u">kg/m³</span></label>
        </div>
        ${m.preset === 'fir' ? `<div class="mat-note">${esc(FIR_NOTE)}</div>` : ''}
      </div>`).join('');
    box.querySelectorAll('.mat-card').forEach((card) => {
      const m = state.model.materials[+card.dataset.mi];
      card.querySelectorAll('[data-mf]').forEach((el) => {
        const f = el.dataset.mf;
        if (f === 'del') {
          el.addEventListener('click', () => {
            if (used.get(m)) { toast(`“${m.name}” is used by ${plural(used.get(m), 'section group')}`, 'warn'); return; }
            if (state.model.materials.length <= 1) { toast('At least one material is required', 'warn'); return; }
            pushUndo();
            state.model.materials.splice(state.model.materials.indexOf(m), 1);
            modelChanged({ materials: true });
          });
          return;
        }
        el.addEventListener('change', () => {
          if (f === 'name') { pushUndo(); m.name = el.value.trim().slice(0, 80) || 'Material'; modelChanged({ materials: true, groups: true }); return; }
          if (f === 'color') { m.color = el.value; scheduleSave(); return; }
          if (f === 'density') { // kg/m³; empty means not set (no self-weight), never an invented value
            const t = el.value.trim(), d = t === '' ? null : evalNum(t);
            if (d !== null && !validDensity(d)) { el.classList.add('invalid'); toast('Density must be a number of kg/m³, 0 or more, or empty for not set', 'bad'); return; }
            el.classList.remove('invalid');
            el.value = d === null ? '' : inVal(d);
            if (d === (validDensity(m.density) ? m.density : null)) return;
            pushUndo();
            m.density = d;
            modelChanged({ groups: true });
            return;
          }
          const v = evalNum(el.value);
          if (!(v > 0)) { el.classList.add('invalid'); toast(`${f === 'E' ? 'E' : 'σy'} must be a positive number`, 'bad'); return; }
          el.classList.remove('invalid');
          pushUndo();
          if (f === 'E') m.E = v * GPA; else m.fy = v * MPA;
          el.value = inVal(v);
          modelChanged({ groups: true });
        });
      });
    });
  }

  function renderGroups() {
    const box = $('#groupsList');
    const count = new Map();
    state.model.members.forEach((e) => count.set(e.group, (count.get(e.group) || 0) + 1));
    if (!state.model.groups.includes(state.activeGroup)) state.activeGroup = state.model.groups[0] || null;
    box.innerHTML = state.model.groups.map((g, i) => `
      <div class="grp-row ${g === state.editGroup ? 'editing' : ''}" data-gi="${i}" title="Click to edit this section group">
        <input type="radio" name="activeGroup" ${g === state.activeGroup ? 'checked' : ''} title="Use for new members">
        <span class="swatch" style="background:${esc(g.color)}"></span>
        <span class="grp-name">${esc(g.name)}</span>
        <span class="grp-count" title="Members using this group">${count.get(g) || 0}</span>
        <span class="grp-meta">${esc(g.material.name)}, A ${fmt(g.A / MM2, 4)} mm², I ${fmt(g.I / MM4, 3)} mm⁴</span>
      </div>`).join('');
    box.querySelectorAll('.grp-row').forEach((row) => {
      const g = state.model.groups[+row.dataset.gi];
      const radio = row.querySelector('input[type=radio]');
      radio.addEventListener('click', (e) => e.stopPropagation()); // do not open the group editor
      radio.addEventListener('change', () => { state.activeGroup = g; if (state.tool === 'member') renderToolOptions(); }); // mouse or arrow keys
      row.addEventListener('click', () => { state.editGroup = state.editGroup === g ? null : g; renderGroups(); renderGroupEditor(); });
    });
  }

  function renderGroupEditor() {
    const box = $('#groupEditor');
    const g = state.editGroup;
    if (!g || !state.model.groups.includes(g)) { state.editGroup = null; box.innerHTML = ''; return; }
    const sh = SHAPES[g.shape.type] ? g.shape.type : 'custom';
    const dims = SHAPES[sh].dims.map(([k, label]) => `<label>${label}</label><div class="inline"><input class="num" data-gf="dim" data-k="${k}" value="${inVal((g.shape[k] || 0) / MM)}"><span class="u">mm</span></div>`).join('');
    const custom = sh === 'custom';
    const r = Math.sqrt(g.I / g.A);
    box.innerHTML = `
      <div class="grp-editor">
        <div class="form-grid">
          <label>Name</label><div class="inline"><input class="txt" data-gf="name" value="${esc(g.name)}" maxlength="80"><input type="color" data-gf="color" value="${esc(g.color)}"></div>
          <label>Material</label><select class="select" data-gf="material">${state.model.materials.map((m, i) => `<option value="${i}" ${m === g.material ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
          <label>Shape</label><select class="select" data-gf="shape">${Object.entries(SHAPES).map(([k, s]) => `<option value="${k}" ${k === sh ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
          ${dims}
          <label>Area A</label><div class="inline"><input class="num" data-gf="A" value="${inVal(g.A / MM2)}" ${custom ? '' : 'disabled'}><span class="u">mm²</span></div>
          <label>I (weak axis)</label><div class="inline"><input class="num" data-gf="I" value="${inVal(g.I / MM4)}" ${custom ? '' : 'disabled'}><span class="u">mm⁴</span></div>
        </div>
        <div class="derived">r = √(I/A) = ${fmt(r / MM, 4)} mm, EA = ${fmt(g.material.E * g.A / 1e6, 4)} MN<br>
          σy·A = ${fmt(g.material.fy * g.A / fU(), 4)} ${state.s.forceUnit}, λc = π√(E/σy) = ${fmt(Math.PI * Math.sqrt(g.material.E / g.material.fy), 4)}</div>
        <div class="btn-row">
          <button class="btn sm" data-gf="assign" title="Assign this section to the selected members">Assign to selected</button>
          <button class="btn sm" data-gf="select" title="Select all members of this group">Select members</button>
          <button class="btn sm danger" data-gf="del">Delete</button>
        </div>
      </div>`;
    box.querySelectorAll('[data-gf]').forEach((el) => {
      const f = el.dataset.gf;
      if (el.tagName === 'BUTTON') {
        el.addEventListener('click', () => {
          if (f === 'assign') {
            if (!state.sel.members.size) { toast('Select members first (V, then click or box-select)', 'warn'); return; }
            pushUndo(); state.sel.members.forEach((e) => { e.group = g; });
            toast(`Assigned “${g.name}” to ${plural(state.sel.members.size, 'member')}`, 'ok');
            modelChanged({ groups: true });
          } else if (f === 'select') {
            state.sel.nodes.clear(); state.sel.members.clear();
            state.model.members.forEach((e) => { if (e.group === g) state.sel.members.add(e); });
            renderInspector(); renderTablesIfVisible(); requestRender();
          } else if (f === 'del') {
            const n = state.model.members.filter((e) => e.group === g).length;
            if (n) { toast(`“${g.name}” is used by ${plural(n, 'member')}; reassign them first`, 'warn'); return; }
            if (state.model.groups.length <= 1) { toast('At least one section group is required', 'warn'); return; }
            pushUndo();
            state.model.groups.splice(state.model.groups.indexOf(g), 1);
            state.editGroup = null;
            modelChanged({ groups: true });
          }
        });
        return;
      }
      el.addEventListener('change', () => {
        if (f === 'name') { pushUndo(); g.name = el.value.trim().slice(0, 80) || 'Section'; modelChanged({ groups: true }); return; }
        if (f === 'color') { g.color = el.value; renderGroups(); scheduleSave(); return; }
        if (f === 'material') { pushUndo(); g.material = state.model.materials[+el.value]; modelChanged({ groups: true }); return; }
        if (f === 'shape') {
          pushUndo();
          const type = el.value, shape = { type };
          if (type === 'rod') shape.d = Math.sqrt(4 * g.A / Math.PI);
          if (type === 'chs') { shape.D = 100 * MM; shape.t = 5 * MM; }
          if (type === 'rect') { shape.b = 50 * MM; shape.h = 100 * MM; }
          if (type === 'rhs') { shape.b = 100 * MM; shape.h = 100 * MM; shape.t = 5 * MM; }
          g.shape = shape;
          const sp = sectionProps(shape);
          if (sp) { g.A = sp.A; g.I = sp.I; }
          modelChanged({ groups: true });
          return;
        }
        const v = evalNum(el.value);
        if (!(v > 0)) { el.classList.add('invalid'); toast('Enter a positive number', 'bad'); return; }
        if (f === 'dim') {
          const trial = Object.assign({}, g.shape, { [el.dataset.k]: v * MM });
          const sp = sectionProps(trial);
          if (!sp) { el.classList.add('invalid'); toast('Invalid dimensions (wall too thick?)', 'bad'); return; }
          pushUndo(); g.shape = trial; g.A = sp.A; g.I = sp.I;
        } else {
          pushUndo();
          if (f === 'A') g.A = v * MM2; else g.I = v * MM4;
        }
        modelChanged({ groups: true });
      });
    });
  }

  function syncScaleUI() {
    const s = state.s.scale;
    $('#rngScale').value = String(clamp(Math.log10(Math.max(s, 1)), 0, 3));
    if (document.activeElement !== $('#numScale')) $('#numScale').value = inVal(s);
    $('#btnAutoScale').classList.toggle('on', state.s.autoScale);
  }
  function syncSettingsUI() {
    const s = state.s;
    $$('#segGrid button').forEach((b) => b.classList.toggle('on', +b.dataset.grid === s.grid));
    $$('#segColor button').forEach((b) => b.classList.toggle('on', b.dataset.color === s.colorBy));
    $('#chkSnap').checked = s.snap; $('#chkSnapNodes').checked = s.snapNodes; $('#chkGrid').checked = s.showGrid;
    $('#chkLive').checked = s.liveSolve;
    $$('[data-show]').forEach((el) => { el.checked = !!s[el.dataset.show]; });
    $('#selForceUnit').value = s.forceUnit; $('#selDispUnit').value = s.dispUnit; $('#selDigits').value = String(s.sig);
    $('#rngLoadFactor').value = String(clamp(s.loadFactor, 0, 3));
    if (document.activeElement !== $('#numLoadFactor')) $('#numLoadFactor').value = inVal(s.loadFactor);
    $('#lfEcho').textContent = `λ = ${fmt(s.loadFactor, 4)}`;
    if (document.activeElement !== $('#numTargetSF')) $('#numTargetSF').value = inVal(s.targetSF);
    syncMatrixUI();
    $('#sbSnap').textContent = `snap ${s.snap ? s.grid + ' m' : 'off'}`;
    syncScaleUI();
  }
  function syncMatrixUI() {
    const s = state.s;
    $$('#segMatrix button').forEach((b) => b.classList.toggle('on', b.dataset.mtx === s.mtxView));
    $$('#segMtxMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mtxMode));
    $('#selMtxUnit').value = s.mtxUnit; $('#chkHideZeros').checked = s.mtxDimZeros;
  }

  function bindLeftPanel() {
    $('#btnAddMaterial').addEventListener('click', () => {
      pushUndo();
      const m = makeMaterial($('#selAddMaterial').value);
      state.model.materials.push(m);
      modelChanged({ materials: true });
      toast(`Added material “${m.name}”`, 'ok');
    });
    $('#btnAddGroup').addEventListener('click', () => {
      pushUndo();
      const i = state.model.groups.length;
      const base = state.editGroup || state.activeGroup;
      const g = makeGroup(`Section ${i + 1}`, base ? base.material : state.model.materials[0], base ? Object.assign({}, base.shape) : { type: 'custom' }, GROUP_COLORS[i % GROUP_COLORS.length], base ? base.A : 2000 * MM2, base ? base.I : 2e6 * MM4);
      state.model.groups.push(g);
      state.editGroup = g;
      modelChanged({ groups: true });
    });
    bindLoadCases();
    $('#btnDismissNotice').addEventListener('click', () => { state.s.lambdaNoticeDismissed = true; $('#updateNotice').hidden = true; scheduleSave(); });
    $$('#segGrid button').forEach((b) => b.addEventListener('click', () => { state.s.grid = +b.dataset.grid; syncSettingsUI(); scheduleSave(); requestRender(); }));
    $('#chkSnap').addEventListener('change', (e) => { state.s.snap = e.target.checked; syncSettingsUI(); scheduleSave(); });
    $('#chkSnapNodes').addEventListener('change', (e) => { state.s.snapNodes = e.target.checked; scheduleSave(); });
    $('#chkGrid').addEventListener('change', (e) => { state.s.showGrid = e.target.checked; scheduleSave(); requestRender(); });
    const setLF = (v) => { state.s.loadFactor = v; syncSettingsUI(); scheduleSave(); requestSolve(); requestRender(); };
    $('#rngLoadFactor').addEventListener('input', (e) => setLF(+e.target.value));
    $('#numLoadFactor').addEventListener('change', (e) => { const v = evalNum(e.target.value); if (Number.isFinite(v) && v >= 0) setLF(v); else { toast('λ must be ≥ 0', 'bad'); syncSettingsUI(); } });
    $('#numTargetSF').addEventListener('change', (e) => {
      const v = evalNum(e.target.value);
      if (Number.isFinite(v) && v >= 1) { state.s.targetSF = v; scheduleSave(); requestSolve(); } else { toast('Target SF must be ≥ 1', 'bad'); }
      syncSettingsUI();
    });
    $('#rngScale').addEventListener('input', (e) => { state.s.scale = parseFloat(Math.pow(10, +e.target.value).toPrecision(3)); state.s.autoScale = false; syncScaleUI(); scheduleSave(); requestRender(); });
    $('#numScale').addEventListener('change', (e) => {
      const v = evalNum(e.target.value);
      if (Number.isFinite(v) && v > 0 && v <= 1e6) { state.s.scale = v; state.s.autoScale = false; } else toast('Scale must be between 0 and 10⁶', 'bad');
      syncScaleUI(); scheduleSave(); requestRender();
    });
    $('#btnAutoScale').addEventListener('click', () => { state.s.autoScale = !state.s.autoScale; if (state.s.autoScale) autoScale(); syncScaleUI(); scheduleSave(); requestRender(); });
    $$('#segColor button').forEach((b) => b.addEventListener('click', () => { state.s.colorBy = b.dataset.color; syncSettingsUI(); renderLegend(); scheduleSave(); requestRender(); }));
    $$('[data-show]').forEach((el) => el.addEventListener('change', () => {
      state.s[el.dataset.show] = el.checked; scheduleSave(); renderLegend(); requestRender();
    }));
    const unitsChanged = () => { renderAllPanels(); renderToolOptions(); requestRender(); scheduleSave(); };
    $('#selForceUnit').addEventListener('change', (e) => { state.s.forceUnit = e.target.value; unitsChanged(); });
    $('#selDispUnit').addEventListener('change', (e) => { state.s.dispUnit = e.target.value; unitsChanged(); });
    $('#selDigits').addEventListener('change', (e) => { state.s.sig = +e.target.value; unitsChanged(); });
  }

  /* =====================================================================
   * 11. Inspector (right panel)
   * ===================================================================== */
  const numIn = (f, v, extra) => `<input class="num" data-f="${f}" value="${inVal(v)}" ${extra || ''}>`;
  function renderInspector() {
    const box = $('#inspector');
    const ns = [...state.sel.nodes].filter((n) => state.model.nodes.includes(n));
    const ms = [...state.sel.members].filter((e) => state.model.members.includes(e));
    state.sel.nodes = new Set(ns); state.sel.members = new Set(ms);
    let h;
    if (ns.length === 1 && !ms.length) h = nodeForm(ns[0]);
    else if (ms.length === 1 && !ns.length) h = memberForm(ms[0]);
    else if (ns.length + ms.length > 1) h = multiForm(ns, ms);
    else h = summaryView();
    // view-only (phones): the same forms, disabled, so values can be read but not changed
    box.innerHTML = isViewOnly() ? `<fieldset class="edit" disabled>${h}</fieldset>` : h;
    $('#inspectorSub').textContent = ns.length + ms.length > 1 ? `${ns.length + ms.length} selected` : '';
    bindInspector(box, ns, ms);
    renderInspectorResults();
  }
  function nodeForm(n) {
    const s = n.support, fu = state.s.forceUnit, du = state.s.dispUnit;
    const ac = state.model.activeCombination; // with a combination on screen, nodeLoad and nodeSettlement give its combined actions
    const L = nodeLoad(state.model, n), st = nodeSettlement(state.model, n), caseName = esc((ac || state.model.activeCase).name);
    const F = Math.hypot(L.fx, L.fy), ang = F > 0 ? Math.atan2(L.fy, L.fx) / D2R : 0;
    let sup = `<label>Type</label><select class="select" data-f="stype">${SUPPORT_TYPES.map(([k, l]) => `<option value="${k}" ${k === s.type ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    if (s.type === 'inclined') sup += `<label>Surface α</label><div class="inline">${numIn('sangle', s.angle, 'title="Angle of the rolling surface from +x, degrees CCW"')}<span class="u">°</span></div>`;
    if (s.type === 'custom') {
      sup += `<label>Frame α</label><div class="inline">${numIn('sangle', s.angle, 'title="Rotation of the x′, y′ support frame from global x, degrees CCW"')}<span class="u">°</span></div>
        <label class="chk"><input type="checkbox" data-f="sfixx" ${s.fixX ? 'checked' : ''}> Fix x′</label><span></span>
        <label class="chk"><input type="checkbox" data-f="sfixy" ${s.fixY ? 'checked' : ''}> Fix y′</label><span></span>`;
    }
    // A settlement field for every fixed axis, and for a free axis that still holds a settlement (it has no effect,
    // and the field lets you clear it). Settlements belong to the active load case and are scaled by λ.
    const axes = [['sdx', 'x′', s.fixX, st.dx], ['sdy', 'y′', s.fixY, st.dy]].filter(([, , fixed, v]) => fixed || v !== 0);
    const settle = axes.length ? `<div class="sub-h">Settlement in “${caseName}” (before λ)</div><div class="form-grid">${axes.map(([f, ax, fixed, v]) =>
      `<label>δ along ${ax}</label><div class="inline">${numIn(f, v / dU(), fixed ? 'title="Prescribed displacement along this support axis"' : 'title="This axis is not fixed, so this settlement has no effect"')}<span class="u">${du}</span></div>`).join('')}</div>` : '';
    const warn = nodeWarnings(n).map((w) => `<p class="note warn-note">${esc(w.msg)}</p>`).join('');
    const gen = !ac && isGeneratedCase(state.model.activeCase);
    const loadPart = ac ? combinationNodeText(n, L, st, ac) : gen ? selfWeightNodeText(n, L, caseName) : `
      <div class="sub-h">Nodal load in “${caseName}” (before λ)</div>
      <div class="form-grid">
        <label>F<sub>x</sub></label><div class="inline">${numIn('fx', L.fx / fU())}<span class="u">${fu}</span></div>
        <label>F<sub>y</sub></label><div class="inline">${numIn('fy', L.fy / fU())}<span class="u">${fu}</span></div>
        <label>|F|</label><div class="inline">${numIn('fmag', F / fU())}<span class="u">${fu}</span></div>
        <label>Direction</label><div class="inline">${numIn('fang', ang, 'title="Degrees CCW from +x (−90 = downward)"')}<span class="u">°</span></div>
      </div>`;
    return `
      <div class="ins-title"><h4>Node N${nodeNo(n)}<small>${esc(nodeSupportText(n))}</small></h4><button class="btn sm danger" data-act="del">Delete</button></div>
      <div class="sub-h">Position</div>
      <div class="form-grid">
        <label>X</label><div class="inline">${numIn('x', n.x, 'title="Expressions allowed, e.g. 2.5*sqrt(3)"')}<span class="u">m</span></div>
        <label>Y</label><div class="inline">${numIn('y', n.y, 'title="Expressions allowed, e.g. 2.5*sqrt(3)"')}<span class="u">m</span></div>
      </div>
      <div class="sub-h">Support</div>
      <div class="form-grid">${sup}</div>${warn}${gen || ac ? '' : settle}${loadPart}
      <div class="sub-h">Results</div><div id="insResults"></div>`;
  }
  /** The node's load in the generated self-weight case, read-only, with where it comes from. */
  function selfWeightNodeText(n, L, caseName) {
    const fu = state.s.forceUnit;
    const at = state.model.members.filter((e) => e.n1 === n || e.n2 === n);
    const parts = at.map((e) => { const w = memberSelfWeight(e); return w.density === null ? `M${memberNo(e)} none (no density)` : `M${memberNo(e)} ${fF(w.W / 2)}`; });
    const without = at.filter((e) => memberSelfWeight(e).density === null).map((e) => `M${memberNo(e)}`);
    return `<div class="sub-h">Self-weight load in “${caseName}” (generated, before λ)</div>
      <div class="form-grid"><label>F<sub>y</sub></label><div class="inline"><span>${fF(L.fy)}</span><span class="u">${fu}</span></div></div>
      ${without.length ? `<p class="note warn-note">Incomplete: ${without.join(', ')} ${without.length > 1 ? 'have' : 'has'} no density, so ${without.length > 1 ? 'their' : 'its'} weight is not included in this load. Enter the density ρ under Materials.</p>` : ''}
      <p class="note">${parts.length ? `Half the weight of each member at this node, acting downward: ${parts.join(', ')} ${fu}.` : 'No member is connected to this node, so it carries no self-weight.'} Recalculated whenever the geometry, a section or a material changes. Loads cannot be entered in this case.</p>`;
  }
  /** The node's combined actions in a combination, read-only, with the factored load of each case. */
  function combinationNodeText(n, L, st, c) {
    const fu = state.s.forceUnit, du = state.s.dispUnit;
    const parts = c.terms.map((t) => {
      const v = nodeLoad(state.model, n, t.loadCase);
      return v.fx || v.fy ? `${fmtFactor(t.factor)} × ${esc(t.loadCase.name)} (${fF(v.fx)}, ${fF(v.fy)})` : null;
    }).filter(Boolean);
    const settled = st.dx !== 0 || st.dy !== 0;
    return `<div class="sub-h">Combined actions in “${esc(c.name)}” (before λ)</div>
      <div class="form-grid"><label>F<sub>x</sub></label><div class="inline"><span>${fF(L.fx)}</span><span class="u">${fu}</span></div>
        <label>F<sub>y</sub></label><div class="inline"><span>${fF(L.fy)}</span><span class="u">${fu}</span></div>
        ${settled ? `<label>δ along x′</label><div class="inline"><span>${fD(st.dx)}</span><span class="u">${du}</span></div><label>δ along y′</label><div class="inline"><span>${fD(st.dy)}</span><span class="u">${du}</span></div>` : ''}</div>
      <p class="note">${parts.length ? `F = Σ γᵢ·Fᵢ from ${parts.join(', ')} ${fu}.` : 'No load case in this combination loads this node.'}${settled ? ' The settlement is Σ γᵢ·δᵢ along the support axes.' : ''} Loads and settlements are entered in the load cases, not in a combination.</p>`;
  }
  function memberForm(e) {
    return `
      <div class="ins-title"><h4>Member M${memberNo(e)}<small>N${nodeNo(e.n1)} → N${nodeNo(e.n2)}</small></h4>
        <div class="btn-row" style="margin:0"><button class="btn sm" data-act="flip" title="Reverse the member direction (results are unchanged)">⇄</button><button class="btn sm danger" data-act="del">Delete</button></div></div>
      <div class="form-grid">
        <label>Start node</label><div class="inline"><input class="num" data-f="n1" value="${nodeNo(e.n1)}"></div>
        <label>End node</label><div class="inline"><input class="num" data-f="n2" value="${nodeNo(e.n2)}"></div>
        <label>Section</label><select class="select" data-f="grp">${state.model.groups.map((g, i) => `<option value="${i}" ${g === e.group ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
      </div>${selfWeightCase(state.model) ? memberSelfWeightText(e) : ''}
      <div id="insResults"></div>`;
  }
  /** A member's weight with the numbers it comes from (shown when the model has a self-weight case). */
  function memberSelfWeightText(e) {
    const w = memberSelfWeight(e), fu = state.s.forceUnit, mat = e.group.material;
    if (w.density === null) return `<div class="sub-h">Self-weight</div><p class="note warn-note">“${esc(mat.name)}” has no density, so this member carries no self-weight. Enter its density ρ under Materials.</p>`;
    return `<div class="sub-h">Self-weight</div>
      <p class="note">W = ρ·A·L·g = ${fmt(w.density)} kg/m³ × ${fmt(w.A / MM2)} mm² × ${fmt(w.L)} m × ${GRAVITY} m/s² = ${fF(w.W)} ${fu}.
      Half of it, ${fF(w.W / 2)} ${fu}, acts downward at each end node (N${nodeNo(e.n1)} and N${nodeNo(e.n2)}): for a pin-ended member these are the end reactions of its own uniform weight, so the truss carries it as nodal loads (the member's own bending is not modelled).</p>`;
  }
  function multiForm(ns, ms) {
    const fu = state.s.forceUnit;
    let h = `<div class="ins-title"><h4>Multiple selection<small>${plural(ns.length, 'node')}, ${plural(ms.length, 'member')}</small></h4><button class="btn sm danger" data-act="del">Delete all</button></div>`;
    if (ns.length) {
      h += `<div class="sub-h">Apply to ${plural(ns.length, 'node')}</div>
        <div class="form-grid">
          <label>Support</label><div class="inline"><select class="select" data-m="stype">${SUPPORT_TYPES.filter(([k]) => k !== 'custom').map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <label>Angle α</label><div class="inline"><input class="num" data-m="sangle" value="30"><span class="u">°</span><button class="btn sm" data-act="mm-support">Apply</button></div>
          <label>${state.model.activeCombination ? 'Combination' : 'Load case'}</label><div class="inline"><span class="dim">${state.model.activeCombination ? `${esc(state.model.activeCombination.name)} (no loads can be entered)` : `${esc(state.model.activeCase.name)}${isGeneratedCase(state.model.activeCase) ? ' (generated: no loads can be entered)' : ''}`}</span></div>
          ${state.model.activeCombination || isGeneratedCase(state.model.activeCase) ? '' : `<label>F<sub>x</sub></label><div class="inline"><input class="num" data-m="fx" value="0"><span class="u">${fu}</span></div>
          <label>F<sub>y</sub></label><div class="inline"><input class="num" data-m="fy" value="${inVal(-10e3 / fU())}"><span class="u">${fu}</span><button class="btn sm" data-act="mm-load">Apply</button></div>`}
        </div>`;
    }
    if (ms.length) {
      h += `<div class="sub-h">Apply to ${plural(ms.length, 'member')}</div>
        <div class="form-grid"><label>Section</label><div class="inline"><select class="select" data-m="grp">${state.model.groups.map((g, i) => `<option value="${i}">${esc(g.name)}</option>`).join('')}</select><button class="btn sm" data-act="mm-group">Apply</button></div></div>`;
    }
    return h + '<div id="insResults"></div>';
  }
  function summaryView() {
    const M = state.model, r = R();
    const nSup = M.nodes.filter((n) => n.support.type !== 'none').length;
    const nLoad = M.nodes.filter((n) => { const L = nodeLoad(M, n); return L.fx || L.fy; }).length;
    let det = '';
    if (r && r.determinacy) {
      const d = r.determinacy;
      det = `<dt>Maxwell m + r − 2j</dt><dd>${d.m} + ${d.r} − 2·${d.j} = ${d.degree}</dd>`;
    }
    return `
      <div class="form-grid" style="grid-template-columns:auto 1fr;margin-bottom:8px"><label>Title</label><input class="txt" data-f="title" value="${esc(M.title)}" maxlength="120"></div>
      <dl class="kv">
        <dt>Nodes / joints</dt><dd>${M.nodes.length}</dd>
        <dt>Members</dt><dd>${M.members.length}</dd>
        <dt>Global DOFs</dt><dd>${2 * M.nodes.length}</dd>
        <dt>Supported nodes</dt><dd>${nSup}</dd>
        <dt>Load cases</dt><dd>${M.loadCases.length}, active: ${esc(M.activeCase.name)}</dd>
        ${M.combinations.length ? `<dt>Combinations</dt><dd>${M.combinations.length}${M.activeCombination ? `, analysed: ${esc(M.activeCombination.name)}` : ''}</dd>` : ''}
        <dt>Loaded nodes</dt><dd>${nLoad} <small>in the ${M.activeCombination ? 'combination' : 'active case'}</small></dd>
        ${det}
      </dl>
      <div class="tip"><ul>
        <li>Click a node or member to inspect and edit it exactly.</li>
        <li><kbd>N</kbd> nodes, <kbd>M</kbd> members, <kbd>S</kbd> supports, <kbd>L</kbd> loads, <kbd>?</kbd> help.</li>
        <li>Box-select several items to assign supports, loads or sections in one go.</li>
      </ul></div>`;
  }
  function bindInspector(box, ns, ms) {
    box.querySelectorAll('[data-f]').forEach((el) => {
      el.addEventListener('change', () => onInspectorField(el, ns, ms));
      if (el.tagName === 'INPUT' && el.type !== 'checkbox') el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') el.blur(); });
    });
    box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onInspectorAction(b.dataset.act, ns, ms, box)));
  }
  function readNum(el, positive) {
    const v = evalNum(el.value);
    if (!Number.isFinite(v) || (positive && !(v > 0))) { el.classList.add('invalid'); toast(`“${el.value}” is not a valid ${positive ? 'positive ' : ''}number`, 'bad'); return null; }
    el.classList.remove('invalid');
    return v;
  }
  function onInspectorField(el, ns, ms) {
    if (refuseViewOnly()) { renderInspector(); return; }
    const f = el.dataset.f, n = ns[0], e = ms[0];
    if (f === 'title') { pushUndo(); state.model.title = el.value.trim().slice(0, 120) || 'Untitled truss'; scheduleSave(); return; } // the file reader's limits
    if (f === 'stype') { pushUndo(); setSupport(n, el.value); modelChanged(); return; } // keeps the frame angle, 0° included
    if (f === 'sfixx' || f === 'sfixy') { pushUndo(); n.support[f === 'sfixx' ? 'fixX' : 'fixY'] = el.checked; modelChanged(); return; }
    if (f === 'grp') { pushUndo(); e.group = state.model.groups[+el.value]; modelChanged({ groups: true }); return; }
    const v = readNum(el);
    if (v === null) return;
    if (f === 'n1' || f === 'n2') {
      const nn = state.model.nodes[Math.round(v) - 1];
      const other = f === 'n1' ? e.n2 : e.n1;
      if (!nn || nn === other) { el.classList.add('invalid'); toast('Enter an existing node number different from the other end', 'bad'); return; }
      const dup = findMember(nn, other);
      if (dup && dup !== e) { el.classList.add('invalid'); toast('Those nodes are already connected', 'warn'); return; }
      pushUndo(); e[f] = nn; modelChanged(); return;
    }
    if (['fx', 'fy', 'fmag', 'fang', 'sdx', 'sdy'].includes(f) && refuseEntry()) return;
    pushUndo();
    switch (f) {
      case 'x': n.x = v; break;
      case 'y': n.y = v; break;
      case 'sangle': n.support.angle = v; break;
      case 'sdx': case 'sdy': {
        // settlements belong to the active load case; the form is rebuilt below, since δ marks and warnings may change
        const st = nodeSettlement(state.model, n);
        if (f === 'sdx') setNodeSettlement(state.model, n, v * dU(), st.dy); else setNodeSettlement(state.model, n, st.dx, v * dU());
        modelChanged();
        return;
      }
      case 'fx': case 'fy': {
        const L = nodeLoad(state.model, n);
        if (f === 'fx') setNodeLoad(state.model, n, v * fU(), L.fy); else setNodeLoad(state.model, n, L.fx, v * fU());
        break;
      }
      case 'fmag': case 'fang': {
        const L = nodeLoad(state.model, n);
        const F = Math.hypot(L.fx, L.fy), a0 = F > 0 ? Math.atan2(L.fy, L.fx) / D2R : -90;
        const mag = f === 'fmag' ? v * fU() : F, ang = f === 'fang' ? v : a0;
        const [c, s] = cosSinDeg(ang);
        setNodeLoad(state.model, n, mag * c, mag * s);
        break;
      }
      default: return;
    }
    modelChanged({ keepInspector: true });
    syncInspectorInputs();
  }
  function onInspectorAction(act, ns, ms, box) {
    if (refuseViewOnly()) return;
    if (act === 'del') { deleteSelection(); return; }
    if (act === 'flip') { pushUndo(); const e = ms[0]; [e.n1, e.n2] = [e.n2, e.n1]; modelChanged(); return; }
    const q = (k) => box.querySelector(`[data-m="${k}"]`);
    if (act === 'mm-support') {
      const ang = readNum(q('sangle')); if (ang === null) return;
      pushUndo(); ns.forEach((n) => setSupport(n, q('stype').value, ang));
      toast(`Support applied to ${plural(ns.length, 'node')}`, 'ok'); modelChanged();
    } else if (act === 'mm-load') {
      if (refuseEntry()) return;
      const fx = readNum(q('fx')), fy = readNum(q('fy')); if (fx === null || fy === null) return;
      pushUndo(); ns.forEach((n) => setNodeLoad(state.model, n, fx * fU(), fy * fU()));
      toast(`Load applied to ${plural(ns.length, 'node')}`, 'ok'); modelChanged();
    } else if (act === 'mm-group') {
      pushUndo(); const g = state.model.groups[+q('grp').value]; ms.forEach((e) => { e.group = g; });
      toast(`Section applied to ${plural(ms.length, 'member')}`, 'ok'); modelChanged({ groups: true });
    }
  }
  /** Refresh input values after canvas edits without rebuilding the form (keeps focus). */
  function syncInspectorInputs() {
    const box = $('#inspector');
    const n = state.sel.nodes.size === 1 && !state.sel.members.size ? [...state.sel.nodes][0] : null;
    if (!n) return;
    const L = nodeLoad(state.model, n), st = nodeSettlement(state.model, n), F = Math.hypot(L.fx, L.fy);
    const vals = { x: n.x, y: n.y, fx: L.fx / fU(), fy: L.fy / fU(), fmag: F / fU(), fang: F > 0 ? Math.atan2(L.fy, L.fx) / D2R : 0, sdx: st.dx / dU(), sdy: st.dy / dU() };
    for (const [k, v] of Object.entries(vals)) { const el = box.querySelector(`[data-f="${k}"]`); if (el && el !== document.activeElement) { el.value = inVal(v); el.classList.remove('invalid'); } }
  }
  /* ---------- worked calculations (milestone 7): formatting of the quantities from education.js ---------- */
  const SI_UNIT = { length: 'm', disp: 'm', force: 'N', stress: 'Pa', modulus: 'Pa', area: 'm²', inertia: 'm⁴', stiffness: 'N/m', ratio: '', strain: '', angle: '°' };
  const SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  /** A number in scientific notation with a real times sign: 2.000 × 10¹¹ (display only; the value is unchanged). */
  function sci(x, sig) {
    if (x === Infinity) return '∞';
    if (x === -Infinity) return MINUS + '∞';
    if (typeof x !== 'number' || Number.isNaN(x)) return '—';
    if (x === 0) return '0';
    const ax = Math.abs(x);
    if (ax >= 1e-2 && ax < 1e5) return fmt(x, sig);
    const [m, e] = x.toExponential(Math.max(0, (sig || state.s.sig) - 1)).split('e');
    return `${m.replace(/^-/, MINUS)} × 10${String(+e).split('').map((c) => SUP[c] || c).join('')}`;
  }
  /** Typesets plain-text math from education.js: K_ff → K<sub>ff</sub>, SF_yield → SF<sub>yield</sub> (escaped first). */
  const mathHtml = (t) => esc(t).replace(/([A-Za-zσεδθλγρΣκ|])_([A-Za-z0-9′]+)/g, '$1<sub>$2</sub>');
  /** A quantity in SI base units, as substituted in an equation. */
  const qSI = (x) => `${sci(x.value)}${SI_UNIT[x.kind] ? ` ${SI_UNIT[x.kind]}` : ''}`;
  /** The same quantity in the units chosen under View (force, displacement) and the usual input units. */
  function qShow(x) {
    const v = x.value;
    switch (x.kind) {
      case 'force': return `${fF(v)} ${state.s.forceUnit}`;
      case 'disp': return `${fD(v)} ${state.s.dispUnit}`;
      case 'stress': return `${fS(v)} MPa`;
      case 'modulus': return `${fmt(v / GPA)} GPa`;
      case 'area': return `${fmt(v / MM2)} mm²`;
      case 'inertia': return `${fmt(v / MM4)} mm⁴`;
      case 'stiffness': return `${fmt(v / (STIFF_UNITS[state.s.mtxUnit] || 1e3))} ${state.s.mtxUnit}`;
      case 'length': return `${fmt(v)} m`;
      case 'angle': return `${fmt(v)}°`;
      default: return fmt(v);
    }
  }
  /** One worked step: the equation, the substitution with the solver's values (SI), the result, and what it means. */
  function calcStep(step, meaning) {
    const byS = new Map(step.terms.map((t) => [t.sym, t]));
    // a negative value right after an operator is put in brackets: "− (−0.0159 m)", never "− −0.0159 m"
    const sub = step.subst.map((p, i) => {
      if (!byS.has(p)) return mathHtml(p);
      const t = byS.get(p), v = `<span class="v">${esc(qSI(t))}</span>`, prev = i > 0 ? String(step.subst[i - 1]).trimEnd() : '';
      return t.value < 0 && /[−+×/]$/.test(prev) ? `(${v})` : v;
    }).join('');
    const res = step.result;
    const extra = (step.extra || []).map((x) => `${mathHtml(x.sym)} = ${esc(qShow(x))}`).join(',  ');
    const showUnit = res.kind !== 'ratio' && res.kind !== 'strain' && res.kind !== 'angle' && SI_UNIT[res.kind] !== '';
    return `<li><div class="step-label">${esc(step.title)}</div>
      <div class="equation">${mathHtml(step.equation)}</div>
      <div class="step-math">${sub}</div>
      <div class="step-math">${mathHtml(res.sym)} = <span class="v">${esc(qSI(res))}</span>${showUnit ? ` <span class="dim">(${esc(qShow(res))})</span>` : ''}</div>
      ${extra ? `<div class="step-math dim">${extra}</div>` : ''}
      ${meaning ? `<p class="meaning">${meaning}</p>` : ''}
      ${step.note ? `<p class="meaning">${esc(step.note)}</p>` : ''}
      <details class="vars-more"><summary>Symbols</summary><table class="vars">${step.terms.concat([res]).map((t) => `<tr><td>${mathHtml(t.sym)}</td><td>${esc(t.name)}</td><td>${esc(qShow(t))}</td></tr>`).join('')}</table></details></li>`;
  }
  /** What each member step means, in words, from the solver's values. */
  function memberMeaning(id, mr) {
    const z = mr.state === 'zero';
    switch (id) {
      case 'deformation': return z ? 'Its length does not change (within the solver\'s tolerance).' : `The member gets ${fD(Math.abs(mr.elong))} ${state.s.dispUnit} ${mr.elong > 0 ? 'longer' : 'shorter'}.`;
      case 'force': return z ? 'N is zero within the solver\'s tolerance: a <b>zero-force member</b>. It still braces the joints it connects.'
        : mr.force > 0 ? 'Positive N: <b class="t-sign">tension (+)</b>. The member is stretched, so it pulls on the joints at its ends.'
          : 'Negative N: <b class="c-sign">compression (−)</b>. The member is squeezed, so it pushes on the joints at its ends.';
      case 'stress': return z ? '' : `|σ| is ${fmt(100 * Math.abs(mr.stress) / mr.fy, 3)} % of the yield stress σ<sub>y</sub> = ${fS(mr.fy)} MPa.`;
      case 'buckling': return `The compressive force is ${fmt(100 * Math.abs(mr.force) / mr.Pcr, 3)} % of the load at which an ideal pin-ended member would buckle.`;
      case 'governing': return mr.status !== 'safe' ? `SF below 1: the member ${mr.status === 'buckled' ? 'buckles' : 'yields'} in this idealised check.`
        : mr.lowSF ? `Safe (SF ≥ 1), but below the target safety factor ${fmt(state.s.targetSF, 3)}.` : `Safe, and at or above the target safety factor ${fmt(state.s.targetSF, 3)}.`;
      default: return '';
    }
  }
  function memberCalcHtml(e, r, mr) {
    const k = r.memberIndex.get(e), calc = EDU ? EDU.memberCalc(state.model, r, k) : null;
    if (!calc) return '';
    const z = mr.state === 'zero', open = openIfGuided();
    const head = `<div class="headline"><span class="hl-label">Axial force N</span>
      <span class="hl-value ${z ? '' : mr.force > 0 ? 't-sign' : 'c-sign'}">${z ? '0' : `${mr.force > 0 ? '+' : ''}${fF(mr.force, r.summary.Fref)}`} <small>${state.s.forceUnit}</small></span>
      <span class="hl-state">${z ? 'zero force' : mr.force > 0 ? 'tension' : 'compression'}</span> ${statusBadge(mr)}</div>`;
    return `${head}
      <details class="explain" ${open}><summary>How N is calculated</summary><div class="calc"><ol>${calc.steps.map((s) => calcStep(s, memberMeaning(s.id, mr))).join('')}</ol></div></details>
      <details class="explain" ${open}><summary>Strength and buckling checks</summary><div class="calc"><ol>${calc.checks.map((s) => calcStep(s, memberMeaning(s.id, mr))).join('')}</ol></div>
        <p class="assume">Assumptions: pin-jointed, linear elastic, small displacements, loads at nodes only; Euler buckling of an ideal pin-ended member (K = 1) about the weak-axis I. An educational check, not a design-code check.</p></details>`;
  }
  function nodeCalcHtml(n, r) {
    const i = r.nodeIndex.get(n), calc = EDU ? EDU.nodeCalc(state.model, r, i) : null;
    if (!calc) return '';
    const j = calc.joint, open = openIfGuided();
    let meaningR = '';
    if (j.R.supported) {
      const parts = j.members.map((m) => `M${m.member + 1} ${m.state === 'zero' ? 'carries nothing' : m.N > 0 ? 'pulls the node toward' : 'pushes the node away from'}${m.state === 'zero' ? '' : ` N${m.other + 1}`}`);
      meaningR = `The support supplies whatever force keeps this joint in equilibrium: ${parts.join(', ')}${j.F.fx || j.F.fy ? ', and the applied load acts on it too' : ''}. The reaction balances them.`;
    }
    return `<details class="explain" ${open}><summary>How these values are found</summary><div class="calc"><ol>${calc.steps.map((s) => calcStep(s, s.id === 'reaction' ? meaningR : '')).join('')}</ol></div>
      ${typeof openFbdFor === 'function' ? `<div class="btn-row"><button class="btn sm" data-act="fbd">Open the free-body diagram of N${i + 1}</button></div>` : ''}</details>`;
  }

  function renderInspectorResults() {
    const box = $('#insResults');
    if (!box) return;
    const r = R();
    const ns = [...state.sel.nodes], ms = [...state.sel.members];
    const fu = state.s.forceUnit, du = state.s.dispUnit;
    if (!r || !r.ok) {
      const why = resultsHidden() ? (state.learn.view === 'joints' ? 'Hidden until you have found every member force in the Learn panel.' : 'Hidden until you check your predictions in the Learn panel.') : !r ? 'No results yet.' : r.mechanism ? 'Not available: the structure is unstable, so it has no unique solution.' : 'Not available: the model cannot be analysed (see Results).';
      box.innerHTML = `<p class="note">${why}</p>`;
      if (ms.length === 1 && !ns.length) box.innerHTML = memberGeometry(ms[0]) + box.innerHTML;
      return;
    }
    if (ns.length === 1 && !ms.length) {
      const n = ns[0], nr = nodeRes(r, n);
      if (!nr) { box.innerHTML = '<p class="note">Node not yet analysed.</p>'; return; }
      const ref = r.summary.maxDisp.value, fref = r.summary.Fref;
      let h = `<dl class="kv">
        <dt>u<sub>x</sub></dt><dd>${fD(nr.ux, ref)} ${du}</dd>
        <dt>u<sub>y</sub></dt><dd>${fD(nr.uy, ref)} ${du}</dd>
        <dt>|u|</dt><dd>${fD(nr.u, ref)} ${du}</dd>`;
      if (nr.rotated) h += `<dt>u<sub>x′</sub>, u<sub>y′</sub></dt><dd>${fD(nr.uLocal[0], ref)}, ${fD(nr.uLocal[1], ref)} ${du}</dd>`;
      if (!nr.active) h += '<dt>Note</dt><dd class="warn">not connected: left out</dd>';
      if (nr.restrained[0] || nr.restrained[1]) {
        h += `<dt>R<sub>x</sub></dt><dd>${fF(nr.rx, fref)} ${fu}</dd><dt>R<sub>y</sub></dt><dd>${fF(nr.ry, fref)} ${fu}</dd>
              <dt>|R|</dt><dd>${fF(Math.hypot(nr.rx, nr.ry), fref)} ${fu}</dd>`;
        if (nr.rotated) h += `<dt>R<sub>x′</sub>, R<sub>y′</sub></dt><dd>${fF(nr.rLocal[0], fref)}, ${fF(nr.rLocal[1], fref)} ${fu}</dd>`;
      }
      box.innerHTML = h + '</dl>' + (nr.active ? nodeCalcHtml(n, r) : '');
      const fb = box.querySelector('[data-act="fbd"]');
      if (fb) fb.addEventListener('click', () => openFbdFor(n));
      return;
    }
    if (ms.length === 1 && !ns.length) {
      const e = ms[0], mr = memberRes(r, e);
      if (!mr) { box.innerHTML = memberGeometry(e) + '<p class="note">Member not yet analysed.</p>'; return; }
      const ref = r.summary.Fref, z = mr.state === 'zero';
      const labels = mr.dofs.map((d) => r.dofLabels[d]);
      const ku = STIFF_UNITS[state.s.mtxUnit] || 1e3;
      let ke = `<table class="ke-table"><tr><th></th>${labels.map((l) => `<th>${l}</th>`).join('')}</tr>`;
      for (let a = 0; a < 4; a++) ke += `<tr><th>${labels[a]}</th>${[0, 1, 2, 3].map((b) => `<td class="${a === b ? 'diag' : ''}">${fmt(chop(mr.ke[a * 4 + b], mr.k) / ku, 4)}</td>`).join('')}</tr>`;
      ke += '</table>';
      const tech = isTechnical() ? 'open' : '';
      box.innerHTML = memberGeometry(e) + `<div class="sub-h">Results</div>${memberCalcHtml(e, r, mr)}
        <details class="more" ${tech}><summary>All values</summary>
        <dl class="kv">
          <dt>Axial force N</dt><dd>${z ? '0' : fF(mr.force, ref)} ${fu} <small>${z ? 'zero force' : mr.state}</small></dd>
          <dt>Stress σ = N/A</dt><dd>${z ? '0' : fS(mr.stress)} MPa</dd>
          <dt>Strain ε = δ/L</dt><dd>${z ? '0' : fmt(mr.strain)}</dd>
          <dt>Change of length δ</dt><dd>${z ? '0' : fD(mr.elong)} ${du}</dd>
          <dt>Euler P<sub>cr</sub> = π²EI/L²</dt><dd>${fF(mr.Pcr)} ${fu}</dd>
          <dt>σ<sub>cr</sub>, σ<sub>y</sub></dt><dd>${fmt(mr.sigmaCr / MPA)}, ${fmt(mr.fy / MPA)} MPa</dd>
          <dt>Slenderness L/r</dt><dd>${fmt(mr.slenderness, 4)}${mr.eulerValid ? '' : ' <small>yield governs</small>'}</dd>
          <dt>SF yield</dt><dd>${fmt(mr.sfYield, 4)}</dd>
          <dt>SF buckling</dt><dd>${fmt(mr.sfBuckling, 4)}</dd>
          <dt>Governing SF</dt><dd class="${mr.status !== 'safe' ? 'bad' : mr.lowSF ? 'warn' : 'ok'}">${fmt(mr.sf, 4)} <small>${mr.governs}</small></dd>
          <dt>Status</dt><dd>${statusBadge(mr)}</dd>
        </dl></details>
        <details class="more" ${tech}><summary>Element stiffness [kᵉ] (${state.s.mtxUnit})</summary>${ke}
        <p class="note">E·A/L = ${fmt(mr.k / ku, 6)} ${state.s.mtxUnit}, c = cos θ = ${fmt(mr.c, 6)}, s = sin θ = ${fmt(mr.s, 6)}</p></details>`;
      return;
    }
    if (ns.length + ms.length > 1 && ms.length) {
      let fmax = 0, sfmin = Infinity;
      ms.forEach((e) => { const mr = memberRes(r, e); if (mr) { fmax = Math.max(fmax, Math.abs(mr.force)); sfmin = Math.min(sfmin, mr.sf); } });
      box.innerHTML = `<div class="sub-h">Selected members</div><dl class="kv"><dt>Largest |N|</dt><dd>${fF(fmax)} ${fu}</dd><dt>Lowest SF</dt><dd>${fmt(sfmin, 4)}</dd></dl>`;
      return;
    }
    box.innerHTML = '';
  }
  function memberGeometry(e) {
    const dx = e.n2.x - e.n1.x, dy = e.n2.y - e.n1.y, L = Math.hypot(dx, dy);
    const g = e.group;
    return `<div class="sub-h">Geometry and section</div><dl class="kv">
      <dt>Length L</dt><dd>${fmt(L, 7)} m</dd>
      <dt>Angle θ</dt><dd>${fmt(Math.atan2(dy, dx) / D2R, 6)}°</dd>
      <dt>Material</dt><dd>${esc(g.material.name)}</dd>
      <dt>E, σ<sub>y</sub></dt><dd>${fmt(g.material.E / GPA)} GPa, ${fmt(g.material.fy / MPA)} MPa</dd>
      <dt>A, I</dt><dd>${fmt(g.A / MM2)} mm², ${fmt(g.I / MM4)} mm⁴</dd>
    </dl>`;
  }

  /* =====================================================================
   * 12. Status pill, banner, legend, health report
   * ===================================================================== */
  function refreshResults() {
    refreshStatus();
    renderHealth();
    // with nothing selected the Inspector shows the model summary, whose Maxwell count comes from the result:
    // redraw it after each solve (it was drawn before the solve when a model is opened), unless it is being typed in
    const insp = $('#inspector');
    if (!state.sel.nodes.size && !state.sel.members.size && !(insp && insp.contains(document.activeElement))) renderInspector();
    renderInspectorResults();
    renderLegend();
    renderTablesIfVisible();
    refreshCounts();
    renderModelSub();
    refreshLearnLive();
    if (state.s.workspace === 'design') refreshDesignLive();
  }
  function refreshCounts() {
    const M = state.model;
    $('#sbCounts').textContent = `${plural(M.nodes.length, 'node')}, ${plural(M.members.length, 'member')}, ${2 * M.nodes.length} DOFs`;
  }
  function firstMsg(r) { return r.errors && r.errors.length ? r.errors[0].msg : ''; }
  function refreshStatus() {
    const pill = $('#statusPill'), banner = $('#banner');
    const r = state.res, live = state.s.liveSolve;
    let cls = '', text = 'Ready', bcls = '', btext = '';
    if (!state.model.members.length) {
      text = 'Empty model';
      bcls = 'info'; btext = isViewOnly() ? 'This model is empty. Open an example from the <b>File</b> menu.'
        : 'Start drawing: press <kbd>N</kbd> to place nodes and <kbd>M</kbd> to connect them, open an example from <b>File</b>, or follow the guided activity in <b>Learn</b>.';
    } else if (resultsHidden()) {
      const joints = state.learn.view === 'joints';
      cls = ''; text = joints ? 'Method of joints: results are hidden' : 'Predict first: results are hidden';
      bcls = 'predict'; btext = joints ? '<span><b>Method of joints</b>: find each member force by hand in the Learn panel. The solver\'s results stay hidden until every member is found.</span>'
        : '<span><b>Prediction</b>: choose tension, compression or zero force for each member in the Learn panel, then check your answers. The results stay hidden until then.</span>';
    } else if (state.stale && !live) {
      cls = 'warn'; text = 'Results out of date: press Solve';
    } else if (!r) {
      text = 'Not analysed';
    } else if (!r.ok) {
      if (r.mechanism) {
        cls = 'bad'; text = `UNSTABLE: ${plural(r.mechanism.nullity, 'mechanism mode')}`;
        const mode = r.mechanism.modes[state.mechMode];
        bcls = 'bad';
        btext = `<span><b>✕ Unstable structure</b>: mode ${state.mechMode + 1} of ${r.mechanism.modes.length} ${REDUCED_MOTION.matches ? 'shown' : 'animated'}. ${esc(mode ? mode.description : '')}</span>` +
          (r.mechanism.modes.length > 1 ? '<button class="btn sm" id="btnNextMode">Next mode</button>' : '');
      } else {
        cls = 'warn'; text = 'Cannot analyse the model';
        bcls = 'warn'; btext = `<span><b>! Cannot analyse</b>: ${esc(firstMsg(r))}</span>`;
      }
    } else {
      const sm = r.summary;
      if (sm.failures.length) { cls = 'bad'; text = `${plural(sm.failures.length, 'member')} failed, SF min ${fmt(sm.minSF.value, 3)}`; }
      else if (sm.counts.low) { cls = 'warn'; text = `Solved: SF min ${fmt(sm.minSF.value, 3)} is below the target ${fmt(state.s.targetSF, 3)}`; }
      else { cls = 'ok'; text = `Solved: all members within limits, SF min ${fmt(sm.minSF.value, 3)}`; }
    }
    pill.className = `pill ${cls}`;
    pill.textContent = text;
    pill.title = text;
    $('#resultsTabStatus').textContent = cls === 'ok' ? ' ✓' : cls === 'warn' ? ' !' : cls === 'bad' ? ' ✕' : '';
    $('#resultsTabStatus').className = `tab-status ${cls}`;
    banner.hidden = !btext;
    banner.className = `banner ${bcls}`;
    banner.innerHTML = btext;
    const nb = $('#btnNextMode');
    if (nb) nb.addEventListener('click', () => { state.mechMode = (state.mechMode + 1) % r.mechanism.modes.length; refreshStatus(); requestRender(); });
    $('#sbTime').textContent = r && !state.stale ? `solve ${fmt(r.wall, 3)} ms` : '';
  }
  function renderLegend() {
    const lg = $('#legend');
    const r = R();
    if (!r || !r.ok || !state.s.showDeformed || resultsHidden()) { lg.hidden = true; return; }
    const by = state.s.colorBy;
    const mx = colorScaleMax(r);
    let title, lo, hi;
    if (by === 'util') { title = 'Utilisation 1/SF'; lo = 'C 100 %'; hi = 'T 100 %'; }
    else if (by === 'stress') { title = 'Axial stress σ'; lo = `${fmt(-mx / MPA, 3)} MPa`; hi = `+${fmt(mx / MPA, 3)} MPa`; }
    else { title = 'Axial force N'; lo = `${fmt(-mx / fU(), 3)} ${state.s.forceUnit}`; hi = `+${fmt(mx / fU(), 3)} ${state.s.forceUnit}`; }
    // the bar runs compression (−) through zero to tension (+), in the same colours as the members
    const bar = `linear-gradient(90deg, ${mix(COL.zero, COL.compression, 1)}, ${mix(COL.zero, COL.compression, 0.4)}, ${COL.zeroHex}, ${mix(COL.zero, COL.tension, 0.4)}, ${mix(COL.zero, COL.tension, 1)})`;
    lg.innerHTML = `<div class="lg-title"><span>${title}</span><span>deflection ×${fmt(state.s.scale, 3)}</span></div>
      <div class="lg-bar" style="background:${bar}"></div><div class="lg-scale"><span>${lo}</span><span>0</span><span>${hi}</span></div>
      <div class="lg-keys"><span><i style="background:${COL.compressionHex};height:4px"></i>− compression</span><span><i style="background:${COL.tensionHex}"></i>+ tension</span><span><i class="dash"></i>0 zero force</span></div>`;
    lg.hidden = false;
  }
  /**
   * The health report's explanation of the generated self-weight case: where its loads come from, when they change,
   * and, when a member's material has no density, that the case is incomplete (never shown as the whole weight).
   */
  function selfWeightBlock() {
    const sw = selfWeightSummary(state.model), fu = state.s.forceUnit, k = sw.missing.length;
    const names = sw.missing.slice(0, 8).map((i) => `M${i + 1}`).join(', ') + (k > 8 ? ` and ${k - 8} more` : '');
    const missing = sw.complete ? '' : `<p class="note warn-note">Incomplete self-weight: ${k > 1 ? 'members' : 'member'} ${names} (${sw.materials.map((m) => `“${esc(m.name)}”`).join(', ')}) ${k > 1 ? 'have' : 'has'} no density, so ${k > 1 ? 'their' : 'its'} weight is not included. Enter the density ρ under Materials.</p>`;
    const total = sw.complete ? `Total ${fF(sw.total)} ${fu} from ${sw.members === 1 ? 'the member' : `all ${sw.members} members`}, before λ.`
      : `Total ${fF(sw.total)} ${fu} from ${sw.counted} of ${sw.members} members only, before λ.`;
    return `<div class="sub-h">Self-weight (generated)</div>${missing}<p class="note">Each member weighs W = ρ·A·L·g: its material's density, its section area, its length, and g = ${GRAVITY} m/s². Half of W acts downward at each end node. ${total} Recalculated whenever the geometry, a section or a material changes.</p>`;
  }
  /**
   * The health report's account of the combination on screen: what it adds up, that it is solved as one complete
   * action state, and the worst case over every combination, each one's own result (never summed across cases).
   */
  function combinationBlock() {
    const M = state.model, c = M.activeCombination, runs = state.comboRuns || [];
    let h = `<div class="sub-h">Combination “${esc(c.name)}”</div><p class="note">${esc(combinationText(c))}. The factored loads F = λ·Σ γᵢ·Fᵢ and settlements u<sub>s</sub> = λ·Σ γᵢ·u<sub>s,i</sub> are added up first and solved directly as one action state, so every result shown is the solver's for the combined actions. Safety factors are never added across load cases.</p>`;
    if (selfWeightAnalysed() && !selfWeightSummary(M).complete) h += `<p class="note warn-note">Incomplete self-weight: some members have no density, so their weight is not in this combination. Enter the density ρ under Materials.</p>`;
    if (!runs.length) return h;
    const env = combinationEnvelope(M, runs), sfCls = (v) => (v < 1 ? 'bad' : v < state.s.targetSF ? 'warn' : 'ok');
    h += `<div class="sub-h">All combinations, each solved on its own (λ = ${fmt(state.s.loadFactor, 4)})</div><ul class="risk-list">${runs.map(({ combination: x, result: r }, i) => {
      const sm = r.ok && r.summary, mf = sm ? sm.minSF : null;
      return `<li data-combo="${i}" title="Show this combination"><span>${esc(x.name)}${x === c ? ' (shown)' : ''}</span><span class="${mf ? sfCls(mf.value) : 'bad'}">${mf ? `SF ${fmt(mf.value, 3)}${mf.member >= 0 ? ` at M${mf.member + 1} (${mf.governs})` : ''}` : r.mechanism ? 'unstable' : 'not solved'}</span></li>`;
    }).join('')}</ul>`;
    if (env.governing) h += `<p class="note">Governing: SF ${fmt(env.governing.value, 3)} at M${env.governing.member + 1} (${env.governing.governs}) in “${esc(env.governing.combination.name)}”, the lowest of the combinations' own results.</p>`;
    if (env.unsolved.length) h += `<p class="note warn-note">${plural(env.unsolved.length, 'combination')} could not be solved, so no result covers every combination.</p>`;
    return h;
  }
  function renderHealth() {
    const box = $('#health');
    const r = state.res, fu = state.s.forceUnit, du = state.s.dispUnit;
    const msgs = (list, cls) => list.map((m) => `<li class="${cls}${m.ref ? ' link' : ''}" ${m.ref ? `data-ref="${m.ref.type}:${m.ref.index}"` : ''}>${esc(m.msg)}</li>`).join('');
    if (resultsHidden()) {
      box.innerHTML = `<div class="health-status idle"><span class="ic">○</span><div>Results hidden<small>${state.learn.view === 'joints' ? 'Find every member force in the Learn panel: the results appear here.' : 'Make your predictions in the Learn panel, then check them: the results appear here.'}</small></div></div>`;
      return;
    }
    if (!r || (state.stale && !state.s.liveSolve)) {
      box.innerHTML = `<div class="health-status idle"><span class="ic">○</span><div>${!r ? 'No analysis yet' : 'Results out of date'}<small>Press Solve (Enter) or turn on Live.</small></div></div>`;
      return;
    }
    let h = '';
    if (!r.ok) {
      if (r.mechanism) {
        h += `<div class="health-status bad"><span class="ic">✕</span><div>UNSTABLE: kinematic mechanism<small>The reduced stiffness matrix is singular; no unique solution exists.</small></div></div>`;
        h += `<div class="sub-h">Mechanism modes</div><ul class="msg-list">${r.mechanism.modes.map((m, i) => `<li class="e link" data-mode="${i}">Mode ${i + 1} (${m.kind}): ${esc(m.description)}</li>`).join('')}</ul>`;
      } else {
        h += `<div class="health-status warn"><span class="ic">!</span><div>Model cannot be analysed<small>Fix the issues below.</small></div></div>`;
      }
      if (state.model.activeCombination) h += combinationBlock();
      h += stabilityBlock(r);
      if (r.errors.length) h += `<div class="sub-h">Errors</div><ul class="msg-list">${msgs(r.errors.filter((m) => !r.mechanism || !/kinematically unstable/.test(m.msg)), 'e')}</ul>`;
      { // model checks (validateModel) first, then the solver's warnings, then notes from reading the current file
        const warns = validateModel(state.model).concat(r.warnings);
        if (warns.length) h += `<div class="sub-h">Warnings</div><ul class="msg-list">${msgs(warns, 'w')}</ul>`;
        if (state.importNotes.length) h += `<div class="sub-h">Import notes</div><ul class="msg-list">${msgs(state.importNotes, 'w')}</ul>`;
      }
      box.innerHTML = h;
      bindHealth(box);
      return;
    }
    const sm = r.summary, c = sm.counts, fref = sm.Fref;
    const mNo = (k) => `M${k + 1}`;
    if (sm.failures.length) h += `<div class="health-status bad"><span class="ic">✕</span><div>${plural(sm.failures.length, 'member')} exceed capacity<small>${c.yielded} yielded, ${c.buckled} buckled</small></div></div>`;
    else if (c.low) h += `<div class="health-status warn"><span class="ic">!</span><div>Safe, but ${plural(c.low, 'member')} below target SF ${fmt(state.s.targetSF, 3)}<small>Governing SF ${fmt(sm.minSF.value, 3)} (${sm.minSF.governs})</small></div></div>`;
    else h += `<div class="health-status ok"><span class="ic">✓</span><div>Stable: all members within limits<small>Governing SF ${fmt(sm.minSF.value, 3)}${sm.minSF.member >= 0 ? ` at ${mNo(sm.minSF.member)} (${sm.minSF.governs})` : ''}</small></div></div>`;
    const sfCls = sm.minSF.value < 1 ? 'bad' : sm.minSF.value < state.s.targetSF ? 'warn' : 'ok';
    const pk = sm.peakStress;
    h += `<dl class="kv">
      <dt>Max deflection</dt><dd>${fD(sm.maxDisp.value)} ${du} <small>at N${sm.maxDisp.node + 1}</small></dd>
      <dt>Max |u<sub>x</sub>|, |u<sub>y</sub>|</dt><dd>${fD(Math.abs(sm.maxUx.value))}, ${fD(Math.abs(sm.maxUy.value))} ${du}</dd>
      <dt>Peak stress</dt><dd>${pk.member >= 0 ? `${fS(pk.value)} MPa <small>${mNo(pk.member)} ${pk.value > 0 ? 'T' : 'C'}</small>` : '0'}</dd>
      <dt>Peak tension</dt><dd>${sm.maxTension.member >= 0 ? `${fF(sm.maxTension.value)} ${fu} <small>${mNo(sm.maxTension.member)}</small>` : '\u2014'}</dd>
      <dt>Peak compression</dt><dd>${sm.maxCompression.member >= 0 ? `${fF(sm.maxCompression.value)} ${fu} <small>${mNo(sm.maxCompression.member)}</small>` : '\u2014'}</dd>
      <dt>Critical SF</dt><dd class="${sfCls}">${fmt(sm.minSF.value, 4)}${sm.minSF.member >= 0 ? ` <small>${mNo(sm.minSF.member)}, ${sm.minSF.governs}</small>` : ''}</dd>
      <dt>Members</dt><dd>${c.tension} T, ${c.compression} C, ${c.zero} zero</dd>
      <dt>Status</dt><dd>${c.safe} safe, <span class="${c.yielded ? 'check-bad' : ''}">${c.yielded} yielded</span>, <span class="${c.buckled ? 'check-bad' : ''}">${c.buckled} buckled</span></dd>
    </dl>`;
    if (state.model.activeCombination) h += combinationBlock();
    else if (isGeneratedCase(state.model.activeCase)) h += selfWeightBlock();
    h += `<div class="sub-h">Buckling risk <small>P<sub>cr</sub>/|N| below ${fmt(Math.max(state.s.targetSF, 1), 3)}</small></div>`;
    if (sm.bucklingRisk.length) {
      h += `<ul class="risk-list">${sm.bucklingRisk.slice(0, 12).map((b) => {
        const mr = r.members[b.member];
        return `<li data-ref="member:${b.member}" title="Select member"><span>${mNo(b.member)}: |N| ${fF(-mr.force, fref)} of P<sub>cr</sub> ${fF(mr.Pcr)} ${fu}</span><span class="${b.sf < 1 ? 'bad' : 'warn'}">SF ${fmt(b.sf, 3)}</span></li>`;
      }).join('')}</ul>${sm.bucklingRisk.length > 12 ? `<p class="note">… and ${sm.bucklingRisk.length - 12} more</p>` : ''}`;
    } else h += '<p class="note">No compression member is close to its Euler load.</p>';
    if (sm.failures.length) {
      h += `<div class="sub-h">Failed members</div><ul class="risk-list">${sm.failures.slice(0, 12).map((k) => {
        const mr = r.members[k];
        return `<li data-ref="member:${k}"><span>${mNo(k)}: ${mr.status}, σ ${fS(mr.stress)} MPa</span><span class="bad">SF ${fmt(mr.sf, 3)}</span></li>`;
      }).join('')}</ul>`;
    }
    h += stabilityBlock(r);
    { // model checks (validateModel) first, then the solver's warnings, then notes from reading the current file
      const warns = validateModel(state.model).concat(r.warnings);
      if (warns.length) h += `<div class="sub-h">Warnings</div><ul class="msg-list">${msgs(warns, 'w')}</ul>`;
      if (state.importNotes.length) h += `<div class="sub-h">Import notes</div><ul class="msg-list">${msgs(state.importNotes, 'w')}</ul>`;
    }
    box.innerHTML = h;
    bindHealth(box);
  }
  function stabilityBlock(r) {
    const D = r.diagnostics || {};
    let h = `<details class="more" ${isTechnical() ? 'open' : ''}><summary>Stability and numerical verification</summary><dl class="kv small">`;
    if (r.determinacy) {
      const d = r.determinacy;
      const cls = d.degree < 0 ? 'unstable' : d.degree === 0 ? 'determinate' : `indeterminate (${d.degree}°)`;
      h += `<dt>Maxwell m + r − 2j</dt><dd>${d.m} + ${d.r} − ${2 * d.j} = ${d.degree} <small>${cls}</small></dd>`;
    }
    if (D.rank !== undefined) h += `<dt>Rank [K<sub>ff</sub>]</dt><dd class="${D.nullity ? 'bad' : 'ok'}">${D.rank} / ${D.nf} ${D.nullity ? '✕' : '✓'}</dd>`;
    if (Number.isFinite(D.minPivot)) h += `<dt>Min. scaled pivot</dt><dd>${fmt(D.minPivot, 3)} <small>tol ${fmt(D.pivotTol, 2)}</small></dd>`;
    if (D.detRaw && r.ok && D.nf > 0) {
      h += `<dt>det [K<sub>ff</sub>]</dt><dd>${fmt(D.detRaw.mantissa, 5)}e${D.detRaw.exponent} <small>(N/m)<sup>${D.nf}</sup></small></dd>`;
      h += `<dt>det [K̃] (scaled)</dt><dd>${fmt(D.detScaled.mantissa, 5)}e${D.detScaled.exponent} <small>∈ (0, 1]</small></dd>`;
      h += `<dt>LU vs Cholesky det</dt><dd>${fmt(D.detAgreement, 2)} <small>rel. diff.</small></dd>`;
    } else if (D.detRaw && r.mechanism) h += '<dt>det [K<sub>ff</sub>]</dt><dd class="bad">0 (singular)</dd>';
    if (r.ok && D.nf > 0) {
      h += `<dt>κ₁(K̃) ${D.condMethod === 'estimate' ? 'est.' : 'exact'}</dt><dd class="${D.cond1Scaled > 1e10 ? 'warn' : ''}">${fmt(D.cond1Scaled, 3)} <small>κ₁(K<sub>ff</sub>) ${fmt(D.cond1Raw, 3)}</small></dd>`;
      h += `<dt>Backward error</dt><dd>${fmt(D.backwardError, 2)} <small>${plural(D.refineIterations, 'refinement')}</small></dd>`;
    }
    if (r.ok && D.equilibrium) {
      // round-off in assembled stiffness entries scales with model size, so 1e-8 relative is "exact" here
      const e = D.equilibrium, okEq = Math.max(e.relF, e.relM) < 1e-8;
      h += `<dt>ΣF<sub>x</sub>, ΣF<sub>y</sub></dt><dd>${fmt(e.sumFx, 2)}, ${fmt(e.sumFy, 2)} N</dd>`;
      h += `<dt>ΣM (centroid)</dt><dd>${fmt(e.sumM, 2)} N·m</dd>`;
      h += `<dt>Equilibrium</dt><dd class="${okEq ? 'ok' : 'bad'}">${okEq ? '✓' : '✕'} rel. ${fmt(Math.max(e.relF, e.relM), 2)}</dd>`;
      h += `<dt>Nodal equilibrium</dt><dd class="${D.nodalResidualRel < 1e-8 ? 'ok' : 'bad'}">${D.nodalResidualRel < 1e-8 ? '✓' : '✕'} rel. ${fmt(D.nodalResidualRel, 2)}</dd>`;
    }
    return h + '</dl></details>';
  }
  function bindHealth(box) {
    box.querySelectorAll('[data-ref]').forEach((el) => el.addEventListener('click', () => {
      const [type, idx] = el.dataset.ref.split(':');
      const obj = type === 'node' ? state.model.nodes[+idx] : state.model.members[+idx];
      if (obj) selectOnly(type, obj);
    }));
    box.querySelectorAll('[data-mode]').forEach((el) => el.addEventListener('click', () => { state.mechMode = +el.dataset.mode; refreshStatus(); requestRender(); }));
    box.querySelectorAll('[data-combo]').forEach((el) => el.addEventListener('click', () => {
      const c = state.model.combinations[+el.dataset.combo];
      if (!c || c === state.model.activeCombination) return;
      setActiveCombination(state.model, c); // choosing what to look at: no undo step
      renderLoadCases();
      modelChanged();
    }));
  }

  /* =====================================================================
   * 13. Bottom panel: tables, stiffness matrix inspector, solver log
   * ===================================================================== */
  function renderTablesIfVisible() {
    if (state.s.bottomCollapsed) return;
    const t = state.s.bottomTab;
    if (t === 'members') renderMembersTable();
    else if (t === 'nodes') renderNodesTable();
    else if (t === 'matrix') renderMatrix();
    else if (t === 'log') renderLog();
  }
  function renderAllPanels() { renderLeftLists(); renderInspector(); refreshResults(); }

  function sortRows(rows, sort, keyFn) {
    const k = sort.key, d = sort.dir;
    if (k === 'id') return d > 0 ? rows : rows.slice().reverse();
    return rows.slice().sort((a, b) => {
      const va = keyFn(a, k), vb = keyFn(b, k);
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * d;
      const x = Number.isFinite(va) ? va : (va > 0 ? 1e308 : -1e308), y = Number.isFinite(vb) ? vb : (vb > 0 ? 1e308 : -1e308);
      return (x - y) * d;
    });
  }
  function header(cols, sort) {
    return `<thead><tr>${cols.map(([k, label, cls]) => `<th data-sort="${k}" class="${cls || ''} ${sort.key === k ? 'sorted' + (sort.dir > 0 ? ' asc' : '') : ''}">${label}</th>`).join('')}</tr></thead>`;
  }
  function bindTable(box, which, kind) {
    box.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const s = state.sort[which];
      if (s.key === th.dataset.sort) s.dir = -s.dir; else { s.key = th.dataset.sort; s.dir = 1; }
      renderTablesIfVisible();
    }));
    box.querySelectorAll('tbody tr').forEach((tr) => {
      const obj = (kind === 'node' ? state.model.nodes : state.model.members)[+tr.dataset.i];
      tr.addEventListener('click', (e) => { if (e.shiftKey) toggleSel(kind, obj); else selectOnly(kind, obj); });
      tr.addEventListener('mouseenter', () => { state.tableHover = obj; requestRender(); });
      tr.addEventListener('mouseleave', () => { state.tableHover = null; requestRender(); });
    });
  }
  function renderMembersTable() {
    const box = $('#tab-members');
    const M = state.model, r = R();
    const ok = r && r.ok, fu = state.s.forceUnit, du = state.s.dispUnit;
    if (!M.members.length) { box.innerHTML = '<div class="empty">No members yet. Press M and click two nodes.</div>'; $('#tabInfo').textContent = ''; return; }
    const rows = M.members.map((e, i) => ({ e, i, mr: ok ? memberRes(r, e) : null }));
    const key = (row, k) => {
      const mr = row.mr, e = row.e;
      switch (k) {
        case 'L': return Math.hypot(e.n2.x - e.n1.x, e.n2.y - e.n1.y);
        case 'th': return Math.atan2(e.n2.y - e.n1.y, e.n2.x - e.n1.x);
        case 'grp': return e.group.name;
        case 'F': return mr ? mr.force : 0;
        case 'sig': return mr ? mr.stress : 0;
        case 'eps': return mr ? mr.strain : 0;
        case 'dl': return mr ? mr.elong : 0;
        case 'pcr': return mr ? mr.Pcr : 0;
        case 'sf': return mr ? mr.sf : Infinity;
        case 'st': return mr ? ({ buckled: 0, yielded: 1, safe: 2 }[mr.status] + (mr.lowSF ? 0.5 : 0)) : 3;
        default: return row.i;
      }
    };
    const sorted = sortRows(rows, state.sort.members, key);
    const ref = ok ? r.summary.Fref : 0;
    const cols = [['id', '#', 'l'], ['nodes', 'Nodes', 'l'], ['grp', 'Section', 'l'], ['L', 'L [m]'], ['th', 'θ [°]'], ['F', `F [${fu}]`], ['sig', 'σ [MPa]'], ['eps', 'ε [–]'], ['dl', `ΔL [${du}]`], ['pcr', `P<sub>cr</sub> [${fu}]`], ['sf', 'SF'], ['st', 'Status', 'l']];
    let h = `<table class="data">${header(cols, state.sort.members)}<tbody>`;
    for (const { e, i, mr } of sorted) {
      const L = Math.hypot(e.n2.x - e.n1.x, e.n2.y - e.n1.y), th = Math.atan2(e.n2.y - e.n1.y, e.n2.x - e.n1.x) / D2R;
      const cls = mr ? (mr.state === 'zero' ? 'z' : mr.force > 0 ? 't' : 'c') : '';
      const z = mr && mr.state === 'zero';
      h += `<tr data-i="${i}" class="${state.sel.members.has(e) ? 'sel' : ''}">
        <td class="l">M${i + 1}</td><td class="l">N${nodeNo(e.n1)}–N${nodeNo(e.n2)}</td>
        <td class="l"><span class="swatch" style="display:inline-block;vertical-align:-1px;background:${esc(e.group.color)}"></span> ${esc(e.group.name)}</td>
        <td>${fmt(L, 6)}</td><td>${fmt(th, 5)}</td>
        <td class="${cls}">${mr ? (z ? '0' : fF(mr.force, ref)) : '—'}</td>
        <td class="${cls}">${mr ? (z ? '0' : fS(mr.stress)) : '—'}</td>
        <td class="${cls}">${mr ? (z ? '0' : fmt(mr.strain)) : '—'}</td>
        <td class="${cls}">${mr ? (z ? '0' : fD(mr.elong)) : '—'}</td>
        <td>${mr ? fF(mr.Pcr) : '—'}</td>
        <td>${mr ? fmt(mr.sf, 4) : '—'}</td>
        <td class="l">${mr ? statusBadge(mr) : r && r.mechanism ? '<span class="badge unstable">Unstable</span>' : '—'}</td></tr>`;
    }
    box.innerHTML = h + '</tbody></table>';
    bindTable(box, 'members', 'member');
    $('#tabInfo').textContent = ok ? `Tension +, compression −; SF = min(σy/|σ|, Pcr/|N|); λ = ${fmt(state.s.loadFactor, 4)}` : '';
  }
  function renderNodesTable() {
    const box = $('#tab-nodes');
    const M = state.model, r = R(), ok = r && r.ok;
    const fu = state.s.forceUnit, du = state.s.dispUnit;
    if (!M.nodes.length) { box.innerHTML = '<div class="empty">No nodes yet. Press N and click on the canvas.</div>'; return; }
    const rows = M.nodes.map((n, i) => ({ n, i, nr: ok ? nodeRes(r, n) : null }));
    const key = (row, k) => {
      const n = row.n, nr = row.nr;
      switch (k) {
        case 'x': return n.x; case 'y': return n.y; case 'sup': return nodeSupportText(n);
        case 'fx': return nodeLoad(M, n).fx; case 'fy': return nodeLoad(M, n).fy;
        case 'ux': return nr ? nr.ux : 0; case 'uy': return nr ? nr.uy : 0; case 'u': return nr ? nr.u : 0;
        case 'rx': return nr ? nr.rx : 0; case 'ry': return nr ? nr.ry : 0;
        default: return row.i;
      }
    };
    const sorted = sortRows(rows, state.sort.nodes, key);
    const dref = ok ? r.summary.maxDisp.value : 0, fref = ok ? r.summary.Fref : 0, lf = state.s.loadFactor;
    const cols = [['id', '#', 'l'], ['x', 'x [m]'], ['y', 'y [m]'], ['sup', 'Support', 'l'], ['fx', `F<sub>x</sub>·λ [${fu}]`], ['fy', `F<sub>y</sub>·λ [${fu}]`], ['ux', `u<sub>x</sub> [${du}]`], ['uy', `u<sub>y</sub> [${du}]`], ['u', `|u| [${du}]`], ['rx', `R<sub>x</sub> [${fu}]`], ['ry', `R<sub>y</sub> [${fu}]`]];
    let h = `<table class="data">${header(cols, state.sort.nodes)}<tbody>`;
    for (const { n, i, nr } of sorted) {
      const sup = nr && (nr.restrained[0] || nr.restrained[1]), L = nodeLoad(M, n);
      h += `<tr data-i="${i}" class="${state.sel.nodes.has(n) ? 'sel' : ''}">
        <td class="l">N${i + 1}</td><td>${fmt(n.x, 6)}</td><td>${fmt(n.y, 6)}</td><td class="l">${esc(nodeSupportText(n))}</td>
        <td>${L.fx ? fF(L.fx * lf) : '<span class="dim">0</span>'}</td><td>${L.fy ? fF(L.fy * lf) : '<span class="dim">0</span>'}</td>
        <td>${nr ? fD(nr.ux, dref) : '—'}</td><td>${nr ? fD(nr.uy, dref) : '—'}</td><td>${nr ? fD(nr.u, dref) : '—'}</td>
        <td>${sup ? fF(nr.rx, fref) : '<span class="dim">—</span>'}</td><td>${sup ? fF(nr.ry, fref) : '<span class="dim">—</span>'}</td></tr>`;
    }
    if (ok) {
      let sx = 0, sy = 0;
      for (const nr of r.nodes) { sx += nr.rx; sy += nr.ry; }
      h += `<tr class="dim"><td class="l" colspan="9">Σ reactions (should balance Σ loads)</td><td>${fF(sx, fref)}</td><td>${fF(sy, fref)}</td></tr>`;
    }
    box.innerHTML = h + '</tbody></table>';
    bindTable(box, 'nodes', 'node');
    $('#tabInfo').textContent = ok ? 'Displacements and reactions in global axes. Positive = +x right, +y up' : '';
  }

  /* ---------- stiffness matrix inspector ---------- */
  function matrixData() {
    if (resultsHidden()) return { msg: 'Hidden during the Learn exercise: the displacements in these matrices would give the answers away.' };
    const r = state.res;
    if (!r || !r.K) return { msg: r ? `Matrices are not available: ${firstMsg(r) || 'fix the validation errors first.'}` : 'Run an analysis first.' };
    const v = state.s.mtxView;
    const ndof = r.ndof;
    const fixedSet = new Set(r.fixed ? Array.from(r.fixed) : []);
    if (v === 'global' || v === 'transformed') {
      const M = v === 'transformed' ? r.Kt : r.K;
      return {
        M, n: ndof, labels: r.dofLabels, fixed: (i) => fixedSet.has(i),
        title: v === 'transformed' ? (r.rotated.length ? 'Rotated global matrix [K′] = Λ[K]Λᵀ (inclined support frames)' : 'No inclined supports: [K′] = [K]') : 'Assembled global stiffness matrix [K] (global x, y axes)',
        legend: 'Amber headers = restrained DOFs. Highlighted cells = diagonal.',
      };
    }
    if (v === 'reduced') {
      const nf = r.nf, lab = Array.from(r.free || [], (d) => r.dofLabels[d]);
      const vec = [];
      if (r.bf) vec.push({ name: `F<sub>eff</sub> [${state.s.forceUnit}]`, vals: r.bf, unit: fU() });
      if (r.ok && r.ut) vec.push({ name: `u<sub>f</sub> [${state.s.dispUnit}]`, vals: Array.from(r.free, (d) => r.ut[d]), unit: dU() });
      return { M: r.Kff, n: nf, labels: lab, fixed: () => false, vec, title: `Reduced stiffness matrix [K<sub>ff</sub>] (free DOFs): [K<sub>ff</sub>]{u<sub>f</sub>} = λ{F<sub>f</sub>} − [K<sub>fs</sub>](λ{u<sub>s</sub>})`, legend: 'F<sub>eff</sub> = λF<sub>f</sub> − K<sub>fs</sub>(λu<sub>s</sub>) includes the effect of prescribed displacements. DOFs marked ′ are in a rotated support frame.' };
    }
    const e = [...state.sel.members][0];
    const i = e && r.memberIndex ? r.memberIndex.get(e) : undefined;
    if (i === undefined || !r.members[i]) return { msg: 'Select one member (V, then click it) to see its element stiffness matrix.' };
    const mr = r.members[i];
    return { M: mr.ke, n: 4, labels: mr.dofs.map((d) => r.dofLabels[d]), fixed: () => false, title: `Element stiffness matrix [kᵉ] of M${i + 1} (global axes): EA/L = ${fmt(mr.k / (STIFF_UNITS[state.s.mtxUnit] || 1), 6)} ${state.s.mtxUnit}, c = ${fmt(mr.c, 6)}, s = ${fmt(mr.s, 6)}`, legend: '' };
  }
  function renderMatrix() {
    syncMatrixUI();
    const view = $('#mtxView'), info = $('#mtxInfo');
    const d = matrixData();
    $('#segMatrix button[data-mtx="transformed"]').disabled = !(state.res && state.res.rotated && state.res.rotated.length);
    if (d.msg) { view.innerHTML = `<div class="empty">${esc(d.msg)}</div>`; info.textContent = ''; $('#tabInfo').textContent = ''; return; }
    const unit = STIFF_UNITS[state.s.mtxUnit] || 1;
    let nnz = 0, sym = true;
    for (let a = 0; a < d.n; a++) for (let b = 0; b < d.n; b++) { if (d.M[a * d.n + b] !== 0) nnz++; if (b > a && d.M[a * d.n + b] !== d.M[b * d.n + a]) sym = false; }
    info.innerHTML = `${d.n} × ${d.n}, ${nnz} non-zeros, ${sym ? 'exactly symmetric' : 'not symmetric'}`;
    $('#tabInfo').textContent = `values in ${state.s.mtxUnit}`;
    const mode = d.n > 120 ? 'heatmap' : state.s.mtxMode;
    let maxAbsV = 0;
    for (let k = 0; k < d.n * d.n; k++) maxAbsV = Math.max(maxAbsV, Math.abs(d.M[k]));
    if (mode === 'table') {
      const dim = state.s.mtxDimZeros;
      let h = `<div class="mtx-legend"><b>${d.title}</b><br>${d.legend || ''}</div><table class="mtx"><thead><tr><th class="corner rh"></th>`;
      d.labels.forEach((l, j) => { h += `<th class="${d.fixed(j) ? 'fix' : ''}">${l}</th>`; });
      if (d.vec) d.vec.forEach((v) => { h += `<th class="vec">${v.name}</th>`; });
      h += '</tr></thead><tbody>';
      for (let a = 0; a < d.n; a++) {
        h += `<tr><th class="rh ${d.fixed(a) ? 'fix' : ''}">${d.labels[a]}</th>`;
        for (let b = 0; b < d.n; b++) {
          const v = chop(d.M[a * d.n + b], maxAbsV);
          const cls = [a === b ? 'diag' : '', v === 0 && dim ? 'zero' : '', v < 0 ? 'neg' : '', d.fixed(a) || d.fixed(b) ? 'fixcell' : ''].join(' ');
          h += `<td class="${cls}">${v === 0 ? (dim ? '·' : '0') : fmt(v / unit)}</td>`;
        }
        if (d.vec) d.vec.forEach((v) => { h += `<td class="vec">${fmt(v.vals[a] / v.unit)}</td>`; });
        h += '</tr>';
      }
      view.innerHTML = h + '</tbody></table>';
    } else renderHeatmap(view, d, unit, maxAbsV);
  }
  function renderHeatmap(view, d, unit, maxAbsV) {
    const avail = Math.max(200, Math.min(view.clientWidth - 320, 900));
    const cell = clamp(Math.floor(avail / d.n), 2, 26);
    const size = cell * d.n;
    view.innerHTML = `<div class="mtx-legend"><b>${d.title}</b><br>Colour shows the sign (orange −, blue +), brightness log₁₀|k| over 8 decades. ${d.n > 120 ? 'Table view is limited to 120 DOFs.' : ''}</div>
      <div class="heat-wrap"><canvas width="${size}" height="${size}" style="width:${size}px;height:${size}px"></canvas><div class="heat-readout">Hover a cell to read K[i, j].</div></div>`;
    const cv = view.querySelector('canvas'), c2 = cv.getContext('2d'), ro = view.querySelector('.heat-readout');
    c2.fillStyle = COL.bg; c2.fillRect(0, 0, size, size);
    const lmax = Math.log10(maxAbsV || 1);
    for (let a = 0; a < d.n; a++) for (let b = 0; b < d.n; b++) {
      const v = d.M[a * d.n + b];
      if (v === 0 || Math.abs(v) <= 1e-12 * maxAbsV) continue;
      const t = clamp((Math.log10(Math.abs(v)) - lmax + 8) / 8, 0.08, 1);
      c2.fillStyle = alpha(v > 0 ? COL.tension : COL.compression, t);
      if (a === b) c2.fillStyle = alpha(COL.accentRgb, Math.max(t, 0.5));
      c2.fillRect(b * cell, a * cell, cell, cell);
    }
    cv.addEventListener('mousemove', (ev) => {
      const rc = cv.getBoundingClientRect();
      const b = Math.floor((ev.clientX - rc.left) / cell), a = Math.floor((ev.clientY - rc.top) / cell);
      if (a < 0 || b < 0 || a >= d.n || b >= d.n) return;
      const v = d.M[a * d.n + b];
      ro.innerHTML = `K[${d.labels[a]}, ${d.labels[b]}]<br><b>${fmt(v / unit, 8)}</b> ${state.s.mtxUnit}<br><span class="dim">row ${a + 1}, column ${b + 1}</span>`;
    });
  }
  function renderLog() {
    const r = state.res;
    const pre = $('#logText');
    if (resultsHidden()) { pre.textContent = 'Hidden during the Learn exercise.'; return; }
    if (!r) { pre.textContent = 'No analysis has been run yet.'; return; }
    const lines = [`<span class="s">TrussLab solver ${esc(FEA.VERSION)}, ${new Date().toLocaleString()}, load factor λ = ${r.loadFactor}, wall time ${fmt(r.wall, 3)} ms</span>`, ''];
    r.log.forEach((l, i) => lines.push(`<span class="s">[${String(i + 1).padStart(2, '0')}]</span> ${esc(l)}`));
    if (r.warnings.length) { lines.push(''); r.warnings.forEach((w) => lines.push(`<span class="w">WARNING  ${esc(w.msg)}</span>`)); }
    if (r.errors.length) { lines.push(''); r.errors.forEach((e) => lines.push(`<span class="e">ERROR    ${esc(e.msg)}</span>`)); }
    if (r.ok && r.diagnostics.backwardErrorHistory) {
      lines.push('', `<span class="s">Refinement history (normwise backward error): ${r.diagnostics.backwardErrorHistory.map((x) => x.toExponential(2)).join(' → ')}</span>`);
    }
    pre.innerHTML = lines.join('\n');
    $('#tabInfo').textContent = '';
  }

  /* =====================================================================
   * 14. Export
   * ===================================================================== */
  function download(name, mime, content) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const baseName = () => (state.model.title || 'truss').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').slice(0, 40) || 'truss';
  const cnum = (v) => (v === Infinity ? 'inf' : v === -Infinity ? '-inf' : typeof v === 'number' ? (Number.isNaN(v) ? '' : String(v)) : v);
  const csvCell = (v) => { const s = String(cnum(v)); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csvRow = (arr) => arr.map(csvCell).join(',');
  const jnum = (v) => (Number.isFinite(v) ? v : v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : null);
  function requireResults(needOk) {
    const r = state.res;
    if (!r || (state.stale && !state.s.liveSolve)) { solve(false); }
    const r2 = state.res;
    if (!r2) { toast('No analysis results available', 'bad'); return null; }
    if (needOk && !r2.ok) toast('Exporting an incomplete report: ' + (r2.mechanism ? 'the structure is unstable.' : 'the model has errors.'), 'warn');
    return r2;
  }
  /** How the report describes the generated self-weight case, including whether it is complete. */
  function selfWeightMeta(M) {
    const sw = selfWeightSummary(M);
    return { generated: 'self-weight', selfWeight: 'W = rho*A*L*g per member, W/2 downward at each end node', g: GRAVITY,
      complete: sw.complete, totalBeforeLoadFactor_N: sw.total, membersWithoutDensity: sw.missing.map((k) => k + 1) };
  }
  /** How a report names the combination it analyses: its factors, the rule, and its self-weight when it has one. */
  function combinationMeta(M, c) {
    const meta = { id: M.combinations.indexOf(c) + 1, name: c.name,
      terms: c.terms.map((t) => ({ loadCase: M.loadCases.indexOf(t.loadCase) + 1, name: t.loadCase.name, factor: t.factor })),
      rule: 'F = loadFactor * sum(gamma_i * F_i) and u_s = loadFactor * sum(gamma_i * u_s,i), solved directly as one action state' };
    if (c.terms.some((t) => isGeneratedCase(t.loadCase) && t.factor !== 0)) meta.selfWeight = selfWeightMeta(M);
    return meta;
  }
  /** Every combination solved on its own, with each one's results and the worst case over them (nothing is summed). */
  function combinationResultsObject(M, loadFactor) {
    const runs = M.combinations.map((c) => ({ combination: c, result: analyzeCombination(M, c, { loadFactor, targetSF: state.s.targetSF }) }));
    const env = combinationEnvelope(M, runs), id = (c) => (c ? M.combinations.indexOf(c) + 1 : null);
    return {
      rule: "each combination is solved directly from its complete action state; the governing value is the lowest safety factor among the combinations' own results; safety factors are never added",
      loadFactor,
      combinations: runs.map(({ combination: c, result: r }) => ({
        id: id(c), name: c.name, terms: combinationMeta(M, c).terms, status: r.ok ? 'solved' : r.mechanism ? 'unstable' : 'invalid',
        criticalSF: r.ok ? jnum(r.summary.minSF.value) : null, criticalMember: r.ok && r.summary.minSF.member >= 0 ? r.summary.minSF.member + 1 : null, criticalMode: r.ok ? r.summary.minSF.governs : null,
        members: r.ok ? r.members.map((m, k) => ({ id: k + 1, force: m.force, sf: jnum(m.sf), governs: m.governs, status: m.status })) : [],
        reactions: r.ok ? r.nodes.map((n, i) => ({ node: i + 1, Rx: n.rx, Ry: n.ry, restrained: n.restrained[0] || n.restrained[1] })).filter((n) => n.restrained).map(({ node, Rx, Ry }) => ({ node, Rx, Ry })) : [],
      })),
      members: env.members.map((x, k) => ({
        id: k + 1, minSF: x.minSF ? jnum(x.minSF.value) : null, minSFMode: x.minSF ? x.minSF.governs : null, minSFCombination: id(x.minSF && x.minSF.combination),
        maxTension_N: x.maxTension ? x.maxTension.value : null, maxTensionCombination: id(x.maxTension && x.maxTension.combination),
        maxCompression_N: x.maxCompression ? x.maxCompression.value : null, maxCompressionCombination: id(x.maxCompression && x.maxCompression.combination),
      })),
      governing: env.governing ? { criticalSF: jnum(env.governing.value), member: env.governing.member + 1, mode: env.governing.governs, combination: id(env.governing.combination), name: env.governing.combination.name } : null,
      complete: env.complete,
    };
  }
  function reportObject(r) {
    const M = state.model;
    const D = r.diagnostics || {};
    // the actions exactly as analysed: the active load case, every load and settlement multiplied by λ
    const inp = toAnalysisInput(M, { loadFactor: r.loadFactor });
    const obj = {
      meta: { app: 'TrussLab 2D Truss FEA & Load Simulator', solver: FEA.VERSION, generated: new Date().toISOString(), units: 'SI base units: m, N, Pa, m^2, m^4; angles in degrees',
        loadCase: M.activeCombination ? null : Object.assign({ id: M.loadCases.indexOf(M.activeCase) + 1, name: M.activeCase.name }, isGeneratedCase(M.activeCase) ? selfWeightMeta(M) : {}),
        combination: M.activeCombination ? combinationMeta(M, M.activeCombination) : null, loadFactor: r.loadFactor, loadFactorScales: 'nodal loads and prescribed settlements', targetSF: state.s.targetSF },
      model: serialize(M),
      status: r.ok ? 'solved' : r.mechanism ? 'unstable' : 'invalid',
      errors: r.errors.map((e) => e.msg), warnings: validateModel(M).map((w) => w.msg).concat(r.warnings.map((w) => w.msg)),
      determinacy: r.determinacy || null,
      diagnostics: {
        freeDOFs: D.nf, restrainedDOFs: D.ns, rank: D.rank, nullity: D.nullity, minScaledPivot: jnum(D.minPivot),
        determinantKff: D.detRaw ? { log10: jnum(D.detRaw.log10), mantissa: jnum(D.detRaw.mantissa), exponent: D.detRaw.exponent } : null,
        determinantScaled: D.detScaled ? { log10: jnum(D.detScaled.log10), mantissa: jnum(D.detScaled.mantissa), exponent: D.detScaled.exponent } : null,
        cond1Scaled: jnum(D.cond1Scaled), cond1Kff: jnum(D.cond1Raw), condMethod: D.condMethod,
        refinementSteps: D.refineIterations, backwardError: jnum(D.backwardError), equilibrium: D.equilibrium || null,
        nodalEquilibriumResidual_N: jnum(D.nodalResidual),
      },
      log: r.log,
    };
    if (r.ok) {
      const sm = r.summary;
      obj.summary = {
        maxDisplacement_m: sm.maxDisp.value, maxDisplacementNode: sm.maxDisp.node + 1, spanOverDeflection: jnum(sm.spanRatio),
        peakStress_Pa: sm.peakStress.value, peakStressMember: sm.peakStress.member + 1,
        maxTension_N: sm.maxTension.value, maxTensionMember: sm.maxTension.member + 1,
        maxCompression_N: sm.maxCompression.value, maxCompressionMember: sm.maxCompression.member + 1,
        criticalSF: jnum(sm.minSF.value), criticalMember: sm.minSF.member + 1, criticalMode: sm.minSF.governs,
        counts: sm.counts, bucklingRisk: sm.bucklingRisk.map((b) => ({ member: b.member + 1, sfBuckling: b.sf })),
      };
      obj.nodes = M.nodes.map((n, i) => {
        const nr = r.nodes[i];
        const a = inp.nodes[i];
        return { id: i + 1, x: n.x, y: n.y, support: nodeSupportText(n), Fx: a.fx, Fy: a.fy, prescribedDx: a.dx, prescribedDy: a.dy, ux: nr.ux, uy: nr.uy, u: nr.u, Rx: nr.rx, Ry: nr.ry };
      });
      obj.members = M.members.map((e, k) => {
        const mr = r.members[k];
        return {
          id: k + 1, nodeI: mr.i + 1, nodeJ: mr.j + 1, section: e.group.name, material: e.group.material.name,
          E: mr.E, A: mr.A, I: mr.I, fy: mr.fy, L: mr.L, angle_deg: mr.angle, EA_L: mr.k,
          elongation: mr.elong, strain: mr.strain, force: mr.force, stress: mr.stress, Pcr: mr.Pcr, slenderness: mr.slenderness,
          sfYield: jnum(mr.sfYield), sfBuckling: jnum(mr.sfBuckling), sf: jnum(mr.sf), governs: mr.governs, state: mr.state, status: mr.status,
        };
      });
    } else if (r.mechanism) {
      obj.mechanismModes = r.mechanism.modes.map((m, i) => ({ mode: i + 1, kind: m.kind, description: m.description, nodes: m.nodes.map((k) => k + 1), shape: Array.from(m.u) }));
    }
    if (M.combinations.length) obj.combinationResults = combinationResultsObject(M, r.loadFactor);
    return obj;
  }
  function exportReportJSON() { const r = requireResults(true); if (!r) return; download(`${baseName()}-report-${stamp()}.json`, 'application/json', JSON.stringify(reportObject(r), null, 2)); }
  function exportReportCSV() {
    const r = requireResults(true); if (!r) return;
    const o = reportObject(r);
    const L = [];
    L.push(csvRow(['# TrussLab 2D Truss FEA calculation report']));
    L.push(csvRow(['# generated', o.meta.generated]));
    L.push(csvRow(['# units', o.meta.units]));
    L.push(csvRow(['title', state.model.title]));
    L.push(csvRow(['status', o.status]));
    const cm = o.meta.combination, lcm = cm ? cm.selfWeight || null : o.meta.loadCase;
    if (cm) L.push(csvRow(['combination', cm.name, combinationText(state.model.activeCombination), 'solved directly as one action state']));
    else L.push(csvRow(['load case', lcm.name].concat(lcm.generated ? [`generated self-weight: ${lcm.selfWeight}, g = ${lcm.g} m/s^2`] : [])));
    if (lcm && lcm.generated) L.push(csvRow([cm ? 'self-weight case before factors [N]' : 'self-weight before load factor [N]', lcm.totalBeforeLoadFactor_N,
      lcm.complete ? 'complete: every member has a density' : `incomplete: no density for members ${lcm.membersWithoutDensity.map((k) => `M${k}`).join(' ')}`]));
    L.push(csvRow(['load factor', r.loadFactor, 'scales nodal loads and prescribed settlements']));
    L.push(csvRow(['target SF', state.s.targetSF]));
    o.errors.forEach((e) => L.push(csvRow(['error', e])));
    o.warnings.forEach((w) => L.push(csvRow(['warning', w])));
    L.push('');
    L.push('MATERIALS'); L.push(csvRow(['id', 'name', 'E_Pa', 'fy_Pa', 'density_kg_m3']));
    state.model.materials.forEach((m, i) => L.push(csvRow([i + 1, m.name, m.E, m.fy, validDensity(m.density) ? m.density : ''])));
    L.push(''); L.push('SECTIONS'); L.push(csvRow(['id', 'name', 'material', 'shape', 'A_m2', 'I_m4']));
    state.model.groups.forEach((g, i) => L.push(csvRow([i + 1, g.name, g.material.name, g.shape.type, g.A, g.I])));
    L.push(''); L.push('NODES');
    L.push(csvRow(['id', 'x_m', 'y_m', 'support', 'fix_x', 'fix_y', 'frame_angle_deg', 'prescribed_dx_m', 'prescribed_dy_m', 'Fx_N', 'Fy_N', 'ux_m', 'uy_m', 'u_m', 'Rx_N', 'Ry_N']));
    const inp = toAnalysisInput(state.model, { loadFactor: r.loadFactor }); // the actions as analysed (×λ)
    state.model.nodes.forEach((n, i) => {
      const s = supportRestraint(n.support), a = inp.nodes[i], nr = r.ok ? r.nodes[i] : null;
      L.push(csvRow([i + 1, n.x, n.y, nodeSupportText(n), s.fixX ? 1 : 0, s.fixY ? 1 : 0, s.angle, a.dx, a.dy, a.fx, a.fy,
        nr ? nr.ux : '', nr ? nr.uy : '', nr ? nr.u : '', nr ? nr.rx : '', nr ? nr.ry : '']));
    });
    L.push(''); L.push('MEMBERS');
    L.push(csvRow(['id', 'node_i', 'node_j', 'section', 'material', 'E_Pa', 'A_m2', 'I_m4', 'fy_Pa', 'L_m', 'theta_deg', 'EA_over_L_N_per_m', 'elongation_m', 'strain', 'force_N', 'stress_Pa', 'Pcr_N', 'slenderness', 'SF_yield', 'SF_buckling', 'SF', 'governs', 'state', 'status']));
    state.model.members.forEach((e, k) => {
      const mr = r.ok ? r.members[k] : null;
      const L0 = Math.hypot(e.n2.x - e.n1.x, e.n2.y - e.n1.y);
      L.push(csvRow([k + 1, nodeNo(e.n1), nodeNo(e.n2), e.group.name, e.group.material.name, e.group.material.E, e.group.A, e.group.I, e.group.material.fy,
        mr ? mr.L : L0, mr ? mr.angle : Math.atan2(e.n2.y - e.n1.y, e.n2.x - e.n1.x) / D2R, mr ? mr.k : '', mr ? mr.elong : '', mr ? mr.strain : '', mr ? mr.force : '', mr ? mr.stress : '',
        mr ? mr.Pcr : '', mr ? mr.slenderness : '', mr ? mr.sfYield : '', mr ? mr.sfBuckling : '', mr ? mr.sf : '', mr ? mr.governs : '', mr ? mr.state : '', mr ? mr.status : (r.mechanism ? 'unstable' : '')]));
    });
    if (o.summary) {
      L.push(''); L.push('SUMMARY'); L.push(csvRow(['quantity', 'value', 'location']));
      const s = o.summary;
      L.push(csvRow(['max displacement [m]', s.maxDisplacement_m, `N${s.maxDisplacementNode}`]));
      L.push(csvRow(['span / max displacement', s.spanOverDeflection, '']));
      L.push(csvRow(['peak stress [Pa]', s.peakStress_Pa, `M${s.peakStressMember}`]));
      L.push(csvRow(['max tension [N]', s.maxTension_N, s.maxTensionMember > 0 ? `M${s.maxTensionMember}` : '']));
      L.push(csvRow(['max compression [N]', s.maxCompression_N, s.maxCompressionMember > 0 ? `M${s.maxCompressionMember}` : '']));
      L.push(csvRow(['critical safety factor', s.criticalSF, s.criticalMember > 0 ? `M${s.criticalMember} (${s.criticalMode})` : '']));
      L.push(csvRow(['members yielded', s.counts.yielded, ''])); L.push(csvRow(['members buckled', s.counts.buckled, ''])); L.push(csvRow(['zero-force members', s.counts.zero, '']));
    }
    if (o.mechanismModes) {
      L.push(''); L.push('MECHANISM MODES'); L.push(csvRow(['mode', 'kind', 'description', 'nodes']));
      o.mechanismModes.forEach((m) => L.push(csvRow([m.mode, m.kind, m.description, m.nodes.join(' ')])));
    }
    if (o.combinationResults) {
      const cr = o.combinationResults;
      L.push(''); L.push('COMBINATIONS'); L.push(csvRow([`# ${cr.rule}`]));
      L.push(csvRow(['id', 'name', 'factors', 'status', 'critical_SF', 'critical_member', 'mode']));
      cr.combinations.forEach((c, i) => L.push(csvRow([c.id, c.name, combinationText(state.model.combinations[i]), c.status, c.criticalSF === null ? '' : c.criticalSF, c.criticalMember ? `M${c.criticalMember}` : '', c.criticalMode || ''])));
      if (cr.governing) L.push(csvRow(['governing', cr.governing.name, '', '', cr.governing.criticalSF, `M${cr.governing.member}`, cr.governing.mode]));
    }
    L.push(''); L.push('DIAGNOSTICS'); L.push(csvRow(['quantity', 'value']));
    const d = o.diagnostics;
    if (o.determinacy) L.push(csvRow(['Maxwell m + r - 2j', o.determinacy.degree]));
    [['free DOFs', d.freeDOFs], ['restrained DOFs', d.restrainedDOFs], ['rank Kff', d.rank], ['nullity', d.nullity], ['min scaled pivot', d.minScaledPivot],
      ['log10 det Kff', d.determinantKff && d.determinantKff.log10], ['log10 det scaled', d.determinantScaled && d.determinantScaled.log10],
      ['kappa1 scaled', d.cond1Scaled], ['kappa1 Kff', d.cond1Kff], ['condition method', d.condMethod], ['refinement steps', d.refinementSteps], ['backward error', d.backwardError],
      ['sum Fx [N]', d.equilibrium && d.equilibrium.sumFx], ['sum Fy [N]', d.equilibrium && d.equilibrium.sumFy], ['sum M [N m]', d.equilibrium && d.equilibrium.sumM],
      ['nodal equilibrium residual [N]', d.nodalEquilibriumResidual_N]].forEach(([k, v]) => L.push(csvRow([k, v === undefined || v === null ? '' : v])));
    download(`${baseName()}-report-${stamp()}.csv`, 'text/csv', L.join('\r\n'));
  }
  function matrixToRows(M, n) { const rows = []; for (let a = 0; a < n; a++) rows.push(Array.from(M.subarray(a * n, a * n + n))); return rows; }
  function exportMatricesJSON() {
    const r = requireResults(false); if (!r) return;
    if (!r.K) { toast('Matrices are not available: ' + firstMsg(r), 'bad'); return; }
    const freeL = Array.from(r.free, (d) => r.dofLabels[d]);
    const o = {
      meta: Object.assign({ generated: new Date().toISOString(), units: 'K in N/m, F and R in N, u in m', loadCase: state.model.activeCombination ? null : state.model.activeCase.name, loadFactor: r.loadFactor, note: 'DOF labels: node number + axis; a prime marks a rotated support frame' },
        state.model.activeCombination ? { combination: combinationMeta(state.model, state.model.activeCombination) } : {},
        selfWeightAnalysed() ? { selfWeight: selfWeightMeta(state.model) } : {}),
      dofLabels: r.dofLabels, K: matrixToRows(r.K, r.ndof),
      Krotated: r.rotated.length ? matrixToRows(r.Kt, r.ndof) : null,
      freeDOFs: freeL, restrainedDOFs: Array.from(r.fixed, (d) => r.dofLabels[d]),
      Kff: matrixToRows(r.Kff, r.nf), Feff: Array.from(r.bf || []),
      F: Array.from(r.F), u: r.ok ? Array.from(r.u) : null, R: r.ok ? Array.from(r.R) : null,
      elements: r.ok ? r.members.map((mr, k) => ({ id: k + 1, dofs: mr.dofs.map((d) => r.dofLabels[d]), ke: matrixToRows(mr.ke, 4) })) : null,
    };
    download(`${baseName()}-matrices-${stamp()}.json`, 'application/json', JSON.stringify(o));
  }
  function exportMatricesCSV() {
    const r = requireResults(false); if (!r) return;
    if (!r.K) { toast('Matrices are not available: ' + firstMsg(r), 'bad'); return; }
    const L = [];
    const block = (title, M, n, labels) => {
      L.push(csvRow([title])); L.push(csvRow(['DOF', ...labels]));
      for (let a = 0; a < n; a++) L.push(csvRow([labels[a], ...Array.from(M.subarray(a * n, a * n + n))]));
      L.push('');
    };
    L.push(csvRow(['# TrussLab system matrices', new Date().toISOString(), 'K in N/m; F, R in N; u in m', state.model.activeCombination ? `combination ${state.model.activeCombination.name} = ${combinationText(state.model.activeCombination)}` : `load case ${state.model.activeCase.name}`, `load factor ${r.loadFactor}`]));
    L.push('');
    block('GLOBAL STIFFNESS MATRIX K [N/m]', r.K, r.ndof, r.dofLabels);
    if (r.rotated.length) block("ROTATED GLOBAL MATRIX K' = L K L^T [N/m]", r.Kt, r.ndof, r.dofLabels);
    const fl = Array.from(r.free, (d) => r.dofLabels[d]);
    block('REDUCED STIFFNESS MATRIX Kff [N/m]', r.Kff, r.nf, fl);
    L.push('VECTORS'); L.push(csvRow(['DOF', 'status', 'F_N', 'u_m', 'R_N']));
    const fixed = new Set(Array.from(r.fixed));
    for (let d = 0; d < r.ndof; d++) L.push(csvRow([r.dofLabels[d], r.active && !r.active[d >> 1] ? 'inactive' : fixed.has(d) ? 'restrained' : 'free', r.F[d], r.ok ? r.u[d] : '', r.ok ? r.R[d] : '']));
    download(`${baseName()}-matrices-${stamp()}.csv`, 'text/csv', L.join('\r\n'));
  }
  function exportPNG() {
    draw(performance.now());
    canvas.toBlob((b) => { if (b) download(`${baseName()}-${stamp()}.png`, 'image/png', b); else toast('Could not create the image', 'bad'); });
  }
  function exportModel() { download(`${baseName()}.truss.json`, 'application/json', JSON.stringify(serialize(state.model), null, 2)); toast('Model saved as JSON', 'ok'); }

  /* =====================================================================
   * 15. Misc UI: toast, help, bottom panel, file open, top bar
   * ===================================================================== */
  let toastTimer = 0;
  function toast(msg, kind) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast ${kind || ''}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }
  function toggleHelp(show) { $('#helpModal').hidden = !show; }

  function setBottomTab(tab) {
    state.s.bottomTab = tab;
    $$('.tabs .tab').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    ['members', 'nodes', 'matrix', 'log'].forEach((t) => { $(`#tab-${t}`).hidden = t !== tab; });
    if (state.s.bottomCollapsed) setBottomCollapsed(false);
    renderTablesIfVisible();
    scheduleSave();
  }
  function setBottomCollapsed(c) {
    state.s.bottomCollapsed = c;
    $('#bottom').classList.toggle('collapsed', c);
    $('#btnCollapseBottom').innerHTML = c ? '&#9652;' : '&#9662;';
    $('#splitter').hidden = c;
    resizeCanvas();
    if (!c) renderTablesIfVisible();
    scheduleSave();
  }
  function bindBottom() {
    $$('.tabs .tab').forEach((b) => b.addEventListener('click', () => setBottomTab(b.dataset.tab)));
    $('#btnCollapseBottom').addEventListener('click', () => setBottomCollapsed(!state.s.bottomCollapsed));
    const sp = $('#splitter');
    sp.addEventListener('pointerdown', (e) => {
      sp.setPointerCapture(e.pointerId); sp.classList.add('active');
      const y0 = e.clientY, h0 = $('#bottom').offsetHeight;
      const move = (ev) => {
        const h = clamp(h0 - (ev.clientY - y0), 60, window.innerHeight - 260);
        state.s.bottomHeight = h;
        document.documentElement.style.setProperty('--bottom-h', `${h}px`);
        resizeCanvas();
      };
      const up = () => { sp.classList.remove('active'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); scheduleSave(); };
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
    });
    $$('#segMatrix button').forEach((b) => b.addEventListener('click', () => { state.s.mtxView = b.dataset.mtx; renderMatrix(); scheduleSave(); }));
    $$('#segMtxMode button').forEach((b) => b.addEventListener('click', () => { state.s.mtxMode = b.dataset.mode; renderMatrix(); scheduleSave(); }));
    $('#selMtxUnit').addEventListener('change', (e) => { state.s.mtxUnit = e.target.value; renderMatrix(); renderInspectorResults(); scheduleSave(); });
    $('#chkHideZeros').addEventListener('change', (e) => { state.s.mtxDimZeros = e.target.checked; renderMatrix(); scheduleSave(); });
  }
  function loadModel(model, msg, notes) {
    state.model = model;
    if (state.design) { state.design.edit = null; state.design.report = null; state.design.families = {}; }
    state.importNotes = notes || [];
    state.activeGroup = model.groups[0] || null;
    state.editGroup = null;
    state.memberStart = null;
    state.mechMode = 0;
    clearSelection(false);
    renderLeftLists();
    renderInspector();
    fitView();
    solve(true);
    if (msg) toast(msg, 'ok');
  }
  function bindTopBar() {
    const sel = $('#selExample');
    EXAMPLES.forEach(([k, label]) => { const o = document.createElement('option'); o.value = k; o.textContent = label; sel.appendChild(o); });
    sel.addEventListener('change', () => {
      const k = sel.value;
      sel.value = '';
      if (!k) return;
      pushUndo();
      loadModel(buildExample(k), `Loaded example: ${EXAMPLES.find((e) => e[0] === k)[1]}`);
    });
    $('#btnNew').addEventListener('click', () => {
      if (refuseViewOnly()) return;
      if (state.model.nodes.length && !confirm('Start a new empty model? (You can undo this.)')) return;
      pushUndo();
      loadModel(emptyModel(), 'New model');
      state.view = { cx: 6, cy: 3, zoom: 50 };
      setTool('node');
    });
    $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const res = readModel(JSON.parse(String(rd.result)));
          pushUndo();
          const how = res.fromVersion === 1 ? ', converted from file format version 1' : '';
          const notes = res.notes.length ? `. ${plural(res.notes.length, 'import note')} in the health report` : '';
          loadModel(res.model, `Opened “${f.name}”${how}${notes}`, res.notes);
          // a version 1 model with a settlement behaves differently now that λ scales settlements
          if (res.fromVersion === 1 && modelHasSettlement(res.model)) showLambdaNotice();
        } catch (err) { toast(`Could not open ${f.name}: ${err.message}`, 'bad'); }
      };
      rd.readAsText(f);
    });
    $('#btnSave').addEventListener('click', exportModel);
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);
    $('#btnSolve').addEventListener('click', () => solve(true));
    $('#chkLive').addEventListener('change', (e) => { state.s.liveSolve = e.target.checked; scheduleSave(); if (state.s.liveSolve) solve(false); else refreshResults(); });
    const menu = $('#exportMenu');
    menu.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => {
      closeMenus();
      ({ 'report-csv': exportReportCSV, 'report-json': exportReportJSON, 'matrices-csv': exportMatricesCSV, 'matrices-json': exportMatricesJSON, png: exportPNG, model: exportModel })[b.dataset.export]();
    }));
    $('#btnHelp').addEventListener('click', () => toggleHelp(true));
    $('#btnCloseHelp').addEventListener('click', () => toggleHelp(false));
    $('#helpModal').addEventListener('click', (e) => { if (e.target.id === 'helpModal') toggleHelp(false); });
    $('#btnPanels').addEventListener('click', () => {
      const app = $('#app');
      if (layoutName() !== 'wide') { // room for one side panel at a time: none -> left -> right -> none
        if (app.classList.contains('show-left')) app.classList.replace('show-left', 'show-right');
        else if (app.classList.contains('show-right')) app.classList.remove('show-right');
        else app.classList.add('show-left');
      } else app.classList.toggle('no-panels');
      setTimeout(resizeCanvas, 0);
    });
    $$('#tools .tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('#btnFit').addEventListener('click', fitView);
    $('#btnZoomIn').addEventListener('click', () => zoomAt(1.25, state.W / 2, state.H / 2));
    $('#btnZoomOut').addEventListener('click', () => zoomAt(0.8, state.W / 2, state.H / 2));
  }

  /* =====================================================================
   * 16. Start-up
   * ===================================================================== */
  /** Smoke mode starts every run from the default example: remove the smoke-test keys (never the user's). */
  function clearSmokeKeys() {
    if (!STORE) return;
    const keys = [KEYS.v2, KEYS.v1, 'trusslab.smoke-test.session']; // the last is milestone 1's key
    for (let n = 1; n <= 20; n++) keys.push(n === 1 ? KEYS.backup : `${KEYS.backup}.${n}`);
    for (const k of keys) { try { STORE.removeItem(k); } catch (e) { /* storage unavailable */ } }
  }
  function init() {
    if (SMOKE) clearSmokeKeys();
    const session = loadSession(), restored = session.restored;
    if (!restored) state.model = buildExample('pratt');
    // a first visit (no saved session) opens Learn; a returning user gets the workspace they left
    if (!restored && !SMOKE && !session.readFailed) state.s.workspace = 'learn';
    state.activeGroup = state.model.groups[0] || null;
    bindTopBar();
    bindLeftPanel();
    bindBottom();
    bindShell();
    applyUiMode();
    applyRightTab();
    state.learnProgress = loadLearnProgress(); // lesson progress: its own key, read once
    document.documentElement.style.setProperty('--bottom-h', `${clamp(state.s.bottomHeight, 60, 900)}px`);
    syncSettingsUI();
    renderLeftLists();
    setTool('select');
    updateUndoButtons();
    new ResizeObserver(resizeCanvas).observe(viewport);
    resizeCanvas();
    const collapsed = state.s.bottomCollapsed;
    setBottomTab(state.s.bottomTab);
    setBottomCollapsed(collapsed);
    if (!restored) fitView(); else updateZoomLabel();
    renderInspector();
    applyWorkspaceUI();
    applyViewOnly();
    solve(true);
    refreshHint();
    const message = afterSessionLoaded(session);
    if (message) toast(message);
    window.addEventListener('blur', () => { state.spaceDown = false; });
  }

  /* =====================================================================
   * 17. Testing adapter for the browser smoke test (installed only with ?smoke)
   *
   * A small, versioned interface. Queries return plain copies, never live
   * objects, so tests cannot reach into internal state. Tests drive the app
   * through real DOM events; this adapter only lets them observe the result,
   * convert model coordinates to screen positions, and capture / restore the
   * whole application state so a test run leaves no trace.
   * ===================================================================== */
  function createTestAdapter() {
    const sortKeys = (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v);
    const canon = (v) => JSON.stringify(v, sortKeys);
    const tokens = new WeakMap();
    let tokenSeq = 0;
    const tokenOf = (r) => { if (!tokens.has(r)) tokens.set(r, ++tokenSeq); return tokens.get(r); };
    const selection = () => ({
      nodes: [...state.sel.nodes].map((n) => state.model.nodes.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b),
      members: [...state.sel.members].map((e) => state.model.members.indexOf(e)).filter((i) => i >= 0).sort((a, b) => a - b),
    });
    function results() {
      const r = state.res;
      if (!r) return null;
      return {
        token: tokenOf(r), ok: !!r.ok, stale: !!state.stale,
        errors: r.errors.map((e) => e.msg), warnings: r.warnings.map((w) => w.msg),
        mechanism: r.mechanism ? { nullity: r.mechanism.nullity, kinds: r.mechanism.modes.map((m) => m.kind) } : null,
        members: r.ok ? r.members.map((m) => ({ force: m.force, state: m.state, status: m.status })) : [],
        nodes: r.ok ? r.nodes.map((n) => ({ ux: n.ux, uy: n.uy, rx: n.rx, ry: n.ry })) : [],
      };
    }
    /** Everything a test run can change, as plain data. */
    function capture() {
      return Object.freeze({
        model: JSON.stringify(serialize(state.model)),
        settings: canon(state.s),
        view: canon(state.view),
        tool: state.tool,
        selection: canon(selection()),
        activeGroup: state.model.groups.indexOf(state.activeGroup),
        editGroup: state.model.groups.indexOf(state.editGroup),
        mechMode: state.mechMode,
        toolOptions: canon({ supTool: state.supTool, loadTool: state.loadTool, sort: state.sort }),
        undo: canon(history.undo),
        redo: canon(history.redo),
        appClass: $('#app').className,
        helpHidden: $('#helpModal').hidden,
        exportMenuHidden: $('#exportMenu').hidden,
        bottomHeight: document.documentElement.style.getPropertyValue('--bottom-h'),
        noticeHidden: $('#updateNotice').hidden,
        saveStatus: canon({ hidden: $('#sbSave').hidden, text: $('#sbSave').textContent, className: $('#sbSave').className, title: $('#sbSave').title }),
        importNotes: canon(state.importNotes),
        storageStatus: canon(storageStatus),
        learnProgress: canon(state.learnProgress),
      });
    }
    function cancelAutosave() { clearTimeout(saveTimer); saveTimer = 0; }
    function restore(snap) {
      cancelAutosave();
      Object.assign(state, { drag: null, memberStart: null, spaceDown: false, hover: null, tableHover: null });
      hideTooltip();
      state.model = deserialize(JSON.parse(snap.model));
      const settings = JSON.parse(snap.settings);
      state.s = Object.assign({}, DEFAULT_SETTINGS, settings);
      state.view = JSON.parse(snap.view);
      const groups = state.model.groups;
      state.activeGroup = groups[snap.activeGroup] || groups[0] || null;
      state.editGroup = snap.editGroup >= 0 ? groups[snap.editGroup] || null : null;
      state.mechMode = snap.mechMode;
      Object.assign(state, JSON.parse(snap.toolOptions));
      history.undo = JSON.parse(snap.undo);
      history.redo = JSON.parse(snap.redo);
      const sel = JSON.parse(snap.selection);
      state.sel.nodes = new Set(sel.nodes.map((i) => state.model.nodes[i]).filter(Boolean));
      state.sel.members = new Set(sel.members.map((i) => state.model.members[i]).filter(Boolean));
      $('#app').className = snap.appClass;
      $('#helpModal').hidden = snap.helpHidden;
      $('#exportMenu').hidden = snap.exportMenuHidden;
      if (snap.bottomHeight) document.documentElement.style.setProperty('--bottom-h', snap.bottomHeight);
      $('#updateNotice').hidden = snap.noticeHidden;
      const sv = JSON.parse(snap.saveStatus);
      Object.assign($('#sbSave'), { hidden: sv.hidden, textContent: sv.text, className: sv.className, title: sv.title });
      state.importNotes = JSON.parse(snap.importNotes);
      Object.assign(storageStatus, JSON.parse(snap.storageStatus));
      if (snap.learnProgress) { state.learnProgress = JSON.parse(snap.learnProgress); saveLearnProgress(); }
      state.viewOnlyTest = null;
      state.learn = { view: 'home' };
      applyViewOnly();
      setTool(snap.tool);
      renderLeftLists();
      setBottomTab(settings.bottomTab);
      setBottomCollapsed(!!settings.bottomCollapsed);
      solve(false);
      Object.assign(state.s, settings); // solve() may have auto-rescaled the deflection: keep the captured value
      syncSettingsUI();
      updateUndoButtons();
      updateZoomLabel();
      renderInspector();
      refreshResults();
      applyUiMode();
      applyRightTab();
      applyWorkspaceUI();
      resizeCanvas();
      cancelAutosave(); // the calls above schedule autosaves; the restored state must not be re-saved
    }
    return Object.freeze({
      // version 2: model() returns file format version 2; storage keys are listed per version
      version: 2,
      storageKey: KEYS.v2,
      storageKeys: KEYS,
      userStorageKey: SESSION_KEYS.v2,
      /** Every key under which TrussLab may keep a user's session: the test checks they stay unchanged. */
      userStorageKeys: [SESSION_KEYS.v2, SESSION_KEYS.v1, SESSION_KEYS.backup].concat(Array.from({ length: 19 }, (_, i) => `${SESSION_KEYS.backup}.${i + 2}`))
        .concat(window.TrussLessons ? [TrussLessons.PROGRESS_KEYS.user, `${TrussLessons.PROGRESS_KEYS.user}.unreadable`] : []), // milestone 11: lesson progress
      /** Runs start-up's session handling again, on the smoke-test keys only (this adapter exists only in smoke mode). */
      reloadStoredSession() {
        const session = loadSession();
        if (session.restored) {
          Object.assign(state, { activeGroup: state.model.groups[0] || null, editGroup: null, memberStart: null, mechMode: 0 });
          clearSelection(false);
          syncSettingsUI(); renderLeftLists(); updateZoomLabel(); renderInspector();
          solve(true);
        }
        afterSessionLoaded(session);
        return { restored: session.restored, source: session.source, hasSettlement: !!session.hasSettlement };
      },
      saveNow: () => saveNow(),
      model: () => serialize(state.model),
      results,
      resultsToken: () => (state.res ? tokenOf(state.res) : 0),
      settings: () => JSON.parse(JSON.stringify(state.s)),
      tool: () => state.tool,
      selection,
      history: () => ({ undo: history.undo.length, redo: history.redo.length }),
      worldToClient(x, y) { const [sx, sy] = w2s(x, y), rc = canvas.getBoundingClientRect(); return { x: rc.left + sx, y: rc.top + sy }; },
      autosavePending: () => saveTimer !== 0,
      cancelAutosave,
      capture,
      restore,
      /** Names of the captured fields that differ between two captures. */
      diff: (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]),
      // milestone 6 (additive): the layout ('wide', 'narrow' or 'phone'), and the view-only state forced on or off
      // for a scenario (a synthetic test cannot resize the window); restore() clears the override
      layout: () => layoutName(),
      viewOnly: () => isViewOnly(),
      setViewOnlyForTest(on) { state.viewOnlyTest = on === null ? null : !!on; applyViewOnly(); },
    });
  }

  /* =====================================================================
   * 18. Workspaces, presentation modes, menus, layout and the phone view-only mode (milestone 6)
   *
   * Learn, Analyze and Design are three views of the same model and the same solver: switching changes the
   * workspace panel and the actions offered, never the model. Guided and Technical change how much is
   * explained and how much is shown, never the data or the analysis. Phones (≤ 640 px) are view-only.
   * ===================================================================== */
  const PHONE_MQ = window.matchMedia ? window.matchMedia('(max-width: 640px)') : { matches: false, addEventListener() {} };
  const NARROW_MQ = window.matchMedia ? window.matchMedia('(max-width: 1100px)') : { matches: false, addEventListener() {} };
  /** 'wide' (both side panels), 'narrow' (one side panel at a time, ≤ 1100 px) or 'phone' (view-only, ≤ 640 px). */
  function layoutName() { return PHONE_MQ.matches ? 'phone' : NARROW_MQ.matches ? 'narrow' : 'wide'; }
  function isViewOnly() { return state.viewOnlyTest !== null ? state.viewOnlyTest : PHONE_MQ.matches; }
  const isTechnical = () => state.s.uiMode === 'technical';
  /** Explanations are open in Guided mode and closed (one click away) in Technical mode. */
  const openIfGuided = () => (isTechnical() ? '' : 'open');
  /** Refuses an edit, with a message, in the view-only layout. Returns true when the edit is refused. */
  function refuseViewOnly() {
    if (!isViewOnly()) return false;
    toast('View only on phones: open TrussLab on a tablet or a computer to edit the model.', 'warn');
    return true;
  }
  /** Applies the view-only state: editing forms are disabled, drawing tools are off, the canvas only selects and pans. */
  function applyViewOnly() {
    const vo = isViewOnly();
    state.viewOnly = vo;
    $('#app').classList.toggle('view-only', vo);
    $$('fieldset.edit').forEach((f) => { f.disabled = vo; });
    $$('#tools .tool').forEach((b) => { b.disabled = vo && b.dataset.tool !== 'select' && b.dataset.tool !== 'pan'; });
    $('#phoneNote').hidden = !vo;
    if (vo && state.tool !== 'select' && state.tool !== 'pan') setTool('select'); else renderToolOptions();
    renderInspector();
    refreshStatus();
    requestRender();
  }

  /** Switches the workspace (a presentation setting, saved with the session). */
  function setWorkspace(ws) {
    if (!WORKSPACES.includes(ws)) return;
    if (state.s.workspace === ws) { applyWorkspaceUI(); return; }
    state.s.workspace = ws;
    applyWorkspaceUI();
    refreshResults(); renderInspector(); // the prediction activity hides results only while it is open
    scheduleSave();
  }
  function applyWorkspaceUI() {
    const ws = WORKSPACES.includes(state.s.workspace) ? state.s.workspace : 'analyze';
    const app = $('#app');
    WORKSPACES.forEach((w) => app.classList.toggle(`ws-${w}`, w === ws));
    $$('.ws-nav [data-ws]').forEach((b) => { const on = b.dataset.ws === ws; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $$('#leftPanel [data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== ws; });
    if (ws === 'learn') renderLearn();
    if (ws === 'design') renderDesignTools();
    renderModelSub();
    requestRender();
  }
  /** Guided or Technical: re-renders the panels so that explanations open or close; the model is untouched. */
  function setUiMode(mode) {
    if (mode !== 'guided' && mode !== 'technical') return;
    const was = state.s.uiMode;
    state.s.uiMode = mode;
    applyUiMode();
    if (was !== mode && mode === 'technical' && state.s.bottomCollapsed) setBottomCollapsed(false); // tables are the technical default
    renderInspector();
    renderHealth();
    if (state.s.workspace === 'learn') renderLearn();
    if (state.s.workspace === 'design') renderDesignTools();
    scheduleSave();
  }
  function applyUiMode() {
    const mode = state.s.uiMode === 'technical' ? 'technical' : 'guided';
    $('#app').classList.toggle('mode-guided', mode === 'guided');
    $('#app').classList.toggle('mode-technical', mode === 'technical');
    $$('.mode-toggle [data-uimode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.uimode === mode)));
  }
  /** The right panel: Inspector (the selection) or Results (the verdict and the report). */
  function setRightTab(tab) {
    if (tab !== 'inspector' && tab !== 'results') return;
    if (state.s.rightTab !== tab) { state.s.rightTab = tab; scheduleSave(); }
    applyRightTab();
  }
  function applyRightTab() {
    const tab = state.s.rightTab === 'results' ? 'results' : 'inspector';
    $$('.right-tabs [data-rtab]').forEach((b) => { const on = b.dataset.rtab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $('#paneInspector').hidden = tab !== 'inspector';
    $('#paneResults').hidden = tab !== 'results';
  }
  /** One line under the panel heading: what the model is. */
  function renderModelSub() {
    const M = state.model;
    const t = `${esc(M.title)}: ${plural(M.nodes.length, 'node')}, ${plural(M.members.length, 'member')}`;
    $('#modelSub').innerHTML = t;
    const ds = $('#designSub');
    if (ds) ds.innerHTML = t;
  }

  /* ---------- menus and popovers: one behaviour for File, Export and View ---------- */
  const MENUS = [['#btnFile', '#fileMenu'], ['#btnExport', '#exportMenu'], ['#btnView', '#viewMenu']];
  function closeMenus(except) {
    for (const [b, m] of MENUS) {
      if (m === except) continue;
      $(m).hidden = true;
      $(b).setAttribute('aria-expanded', 'false');
    }
  }
  function bindMenus() {
    for (const [b, m] of MENUS) {
      const btn = $(b), menu = $(m);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menu.hidden;
        closeMenus(m);
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
        if (open) { const first = menu.querySelector('button, select, input'); if (first && e.detail === 0) first.focus(); } // keyboard: focus the first item
      });
    }
    // clicks inside a popover (the View settings) keep it open; anywhere else closes every menu
    document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.menu')) closeMenus(); });
    $('#fileMenu').addEventListener('click', (e) => { if (e.target.closest('button')) closeMenus(); });
  }
  const anyMenuOpen = () => MENUS.some(([, m]) => !$(m).hidden);

  /** Arrow keys move between tabs in a tab list (WAI-ARIA tabs pattern), and activate the new tab. */
  function tabKeys(list, selector, activate) {
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      const tabs = $$(selector, list).filter((t) => !t.hidden);
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault(); e.stopPropagation();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      tabs[j].focus();
      activate(tabs[j]);
    });
  }
  function bindShell() {
    $$('.ws-nav [data-ws]').forEach((b) => b.addEventListener('click', () => setWorkspace(b.dataset.ws)));
    tabKeys($('.ws-nav'), '[data-ws]', (b) => setWorkspace(b.dataset.ws));
    $$('.mode-toggle [data-uimode]').forEach((b) => b.addEventListener('click', () => setUiMode(b.dataset.uimode)));
    $$('.right-tabs [data-rtab]').forEach((b) => b.addEventListener('click', () => setRightTab(b.dataset.rtab)));
    tabKeys($('.right-tabs'), '[data-rtab]', (b) => setRightTab(b.dataset.rtab));
    tabKeys($('#bottom .tabs'), '.tab', (b) => setBottomTab(b.dataset.tab));
    bindMenus();
    const relayout = () => { applyViewOnly(); setTimeout(resizeCanvas, 0); };
    if (PHONE_MQ.addEventListener) PHONE_MQ.addEventListener('change', relayout);
    if (NARROW_MQ.addEventListener) NARROW_MQ.addEventListener('change', () => { $('#app').classList.remove('show-left', 'show-right'); setTimeout(resizeCanvas, 0); });
    // the web fonts load after the first frame; redraw the canvas labels once they are ready
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestRender());
  }

  /* ---------- touch: pinch to zoom, two-finger pan ---------- */
  function pinchStart() {
    const pts = [...state.touches.values()];
    const [a, b] = pts;
    state.drag = { type: 'pinch', d0: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view: Object.assign({}, state.view) };
    state.memberStart = null;
  }
  function pinchMove() {
    const d = state.drag, pts = [...state.touches.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const zoom = clamp(d.view.zoom * dist / d.d0, 1, 20000);
    // keep the model point under the first midpoint under the current midpoint
    const wx = (d.m0[0] - state.W / 2) / d.view.zoom + d.view.cx, wy = d.view.cy - (d.m0[1] - state.H / 2) / d.view.zoom;
    state.view.zoom = zoom;
    state.view.cx = wx - (mid[0] - state.W / 2) / zoom;
    state.view.cy = wy + (mid[1] - state.H / 2) / zoom;
    updateZoomLabel();
    requestRender();
  }

  /* =====================================================================
   * 19. Learn workspace (milestones 6–11): activities driven by the real model and the real solver
   * ===================================================================== */
  const EDU = window.TrussEducation || null;
  const ICON = {
    build: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 16 L10 4 L17 16 Z M3 16 H17"/><circle cx="10" cy="4" r="1.6"/></svg>',
    example: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 15 L6 7 L10 15 L14 7 L18 15 Z M2 15 H18 M6 7 H14"/></svg>',
    cont: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4 L14 10 L7 16"/></svg>',
  };
  function learnHead(title, sub) {
    return `<div class="act-head"><button class="btn sm quiet" data-learn="home" aria-label="Back to Learn">&#8592; Learn</button></div>
      <div class="panel-head"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>`;
  }
  /** The Learn home: continue, the guided activity, the activities and lessons added by later milestones, and examples. */
  function learnHome() {
    const M = state.model, items = [];
    if (M.members.length) items.push(['analyze', ICON.cont, `Continue with “${esc(M.title)}”`, `${plural(M.nodes.length, 'node')} and ${plural(M.members.length, 'member')}: analyse it, or use it in the activities below.`, '']);
    items.push(['build', ICON.build, 'Build your first truss', 'Five steps, each checked from your model: nodes, members, supports, a load, and the result.', guidedBuildMeta()]);
    for (const a of learnActivities()) items.push(a);
    const examples = EXAMPLES.filter(([k]) => ['aframe', 'pratt', 'warren', 'mechanism'].includes(k)).map(([k, label]) =>
      `<li><button data-example="${k}"><span class="a-icon">${ICON.example}</span><span><span class="a-title">${esc(label)}</span></span><span class="a-meta">Open</span></button></li>`).join('');
    return `<div class="panel-head"><h2>Learn</h2><p>Every number here is the solver's own.</p></div>
      <p class="panel-intro">Learn structural mechanics on a real model: build it, predict how it behaves, and see the equations behind each result.</p>
      <ul class="activity-list">${items.map(([k, ic, t, d, meta]) => `<li class="${meta === 'Done' ? 'done' : ''}"><button data-learn="${k}"><span class="a-icon">${ic}</span><span><span class="a-title">${t}</span><span class="a-desc">${d}</span></span><span class="a-meta">${meta}</span></button></li>`).join('')}</ul>
      ${lessonsHomeHtml()}
      <div class="sub-h" style="margin:var(--sp-5) var(--sp-4) var(--sp-2)">Examples to explore</div>
      <ul class="activity-list">${examples}</ul>`;
  }
  function guidedBuildMeta() {
    if (!EDU || !state.learn.buildStarted) return `${EDU ? EDU.BUILD_STEPS.length : 5} steps`;
    const p = EDU.buildProgress(state.model, R());
    return p.next < 0 ? 'Done' : `step ${p.next + 1} of ${p.steps.length}`;
  }
  /** Activities that later milestones register (prediction, free body, joints, Solver Explorer, lessons). */
  function learnActivities() { return LEARN_ACTIVITIES.map((a) => a.item()).filter(Boolean); }
  const LEARN_ACTIVITIES = [];
  const LEARN_VIEWS = {}; // view name -> { render(), bind(box), live() }

  /** The guided first truss: a checklist that follows the model. */
  function learnBuildView() {
    if (!EDU) return learnHead('Build your first truss') + '<p class="panel-intro">education.js did not load.</p>';
    const p = EDU.buildProgress(state.model, R());
    const empty = !state.model.nodes.length, tracking = empty || state.learn.buildStarted;
    if (empty) state.learn.buildStarted = true;
    if (!tracking) {
      let h = learnHead('Build your first truss', `${p.steps.length} steps`) + '<div class="act-body">';
      h += `<p>Build a small truss yourself, one step at a time. Each step is checked from your model as you go.</p>
        <p class="note">This starts from an empty model. Your current model stays in the undo history, so Ctrl+Z brings it back.</p>
        <div class="btn-row"><button class="btn primary" data-learn-act="empty">Start from an empty model</button></div><div class="calc"><ol>`;
      p.steps.forEach((s) => { h += `<li><b>${esc(s.title)}</b></li>`; });
      return h + '</ol></div></div>';
    }
    let h = learnHead('Build your first truss', p.next < 0 ? 'All five steps done' : `Step ${p.next + 1} of ${p.steps.length}`) + '<div class="act-body"><div class="calc"><ol>';
    p.steps.forEach((s, i) => {
      const cur = i === p.next;
      h += `<li${cur ? ' aria-current="step"' : ''}><div><b>${s.done ? '<span class="ok" aria-label="done">✓</span> ' : ''}${esc(s.title)}</b></div>
        ${cur || (p.next < 0 && i === p.steps.length - 1) ? `<p class="meaning">${esc(s.how)}</p><details class="explain" ${openIfGuided()}><summary>Why</summary><p>${esc(s.why)}</p></details>` : ''}</li>`;
    });
    h += '</ol></div>';
    if (p.mechanism) h += '<p class="note bad-note">The truss can move without resistance (a mechanism). The canvas shows how it moves: add a member or a support to stop that movement.</p>';
    if (p.next < 0) h += `<div class="summary-box">Your truss is stable and solved. Select a member: the Inspector shows its axial force N, its stress, and the calculation behind them.</div>`;
    return h + '</div>';
  }
  LEARN_VIEWS.build = { render: learnBuildView, live: true };


  /* ---------- prediction: tension, compression or zero force (milestone 7) ---------- */
  ICON.predict = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10 H17 M13 6 L17 10 L13 14"/><circle cx="5" cy="10" r="1.5"/></svg>';
  const CHOICE = { tension: ['T', 'Tension'], compression: ['C', 'Compression'], zero: ['0', 'Zero force'] };
  /** What the predictions were made for: the model, what is analysed and whether λ = 0. A change resets them. */
  // cached per solver result: resultsHidden() runs on every frame, and serialising a model each time would be wasteful
  let predictKeyCache = { res: undefined, lf: undefined, key: '' };
  function predictKey() {
    if (predictKeyCache.res !== state.res || predictKeyCache.lf !== state.s.loadFactor) {
      predictKeyCache = { res: state.res, lf: state.s.loadFactor, key: JSON.stringify(serialize(state.model)) + (state.s.loadFactor === 0 ? '|0' : '') };
    }
    return predictKeyCache.key;
  }
  function predictState() {
    let p = state.learn.predict;
    if (!p || p.key !== predictKey()) {
      const changed = !!p;
      p = state.learn.predict = { key: predictKey(), choices: [], revealed: false, attempts: 0, changed };
    }
    return p;
  }
  /** True while the prediction activity is open and not yet checked: every result is hidden. */
  function resultsHidden() {
    if (state.s.workspace !== 'learn') return false;
    // opening an activity hides the results at once, before its panel is drawn
    if (state.learn.view === 'predict') return !predictState().revealed;
    if (state.learn.view === 'joints') return !jointsState().complete;
    return false;
  }
  function refreshAfterPredictChange() { refreshResults(); renderInspector(); requestRender(); }
  LEARN_ACTIVITIES.push({ item: () => ['predict', ICON.predict, 'Predict: tension or compression?', 'Decide for each member, then compare with the solver and see why each member is stretched, squeezed or unloaded.', ''] });

  function predictReasonText(it, M) {
    const why = it.reason, mNo = `M${it.member + 1}`;
    if (why.state === 'tension') return `The solver finds δ = +${fD(why.elong)} ${state.s.dispUnit}: ${mNo} gets longer, so it is stretched and pulls on its joints (N = +${fF(why.force)} ${state.s.forceUnit}).`;
    if (why.state === 'compression') return `The solver finds δ = ${fD(why.elong)} ${state.s.dispUnit}: ${mNo} gets shorter, so it is squeezed and pushes on its joints (N = ${fF(why.force)} ${state.s.forceUnit}).`;
    const rule = why.rule;
    if (rule && rule.type === 'two-members') return `At N${rule.node + 1} only two members meet, they are not in line, and no load or support acts there. Equilibrium in two directions is only possible if both carry nothing.`;
    if (rule && rule.type === 'collinear-pair') return `At N${rule.node + 1} three members meet and two of them (${rule.others.map((k) => `M${k + 1}`).join(' and ')}) are in line. Across their line only ${mNo} could push or pull, and nothing else acts there, so it carries nothing.`;
    return `N is zero within the solver's tolerance: for these loads, the equilibrium of the joints leaves ${mNo} unloaded. It still braces the truss; another load could load it.`;
  }
  function predictHint(it) {
    if (it.correct || !it.predicted) return '';
    if (it.actual === 'zero') return 'Look at the joints at its ends: is anything there that the member would have to balance?';
    return 'Tip: imagine removing the member. Would its joints move apart (it was holding them together: tension) or closer (it was holding them apart: compression)?';
  }
  function learnPredictView() {
    const M = state.model, r = state.res;
    let h = learnHead('Predict: tension or compression?', 'Results stay hidden until you check');
    h += '<div class="act-body">';
    const ex = EDU ? EDU.PREDICTION_EXERCISES : [];
    h += `<p>For each member, decide whether it is <b class="t-sign">stretched (tension, +)</b>, <b class="c-sign">squeezed (compression, −)</b> or <b>carries nothing (zero force, 0)</b>. Think about how the loads reach the supports. Then check: the answers come from the solver.</p>
      <details class="explain" ${openIfGuided()}><summary>Choose a structure</summary><div class="btn-row">${ex.map((x) => `<button class="btn sm" data-predict-ex="${x.example}" title="${esc(x.note)}">${esc(x.title)}</button>`).join('')}</div><p>Or use the model on the canvas.</p></details>`;
    if (!M.members.length || !r || !r.ok) {
      h += `<p class="note warn-note">${!M.members.length ? 'The model has no members yet.' : r && r.mechanism ? 'This structure is unstable: it has no unique forces to predict. Choose a structure above.' : 'The model cannot be analysed yet.'}</p>`;
      return h + '</div>';
    }
    const p = predictState();
    const hasLoad = M.nodes.some((n) => { const L = nodeLoad(M, n), s = nodeSettlement(M, n); return L.fx || L.fy || s.dx || s.dy; });
    if (!hasLoad || state.s.loadFactor === 0) h += '<p class="note warn-note">Nothing loads this structure, so every member carries zero force. Choose a structure above, or add a load.</p>';
    if (p.changed) { h += '<p class="note">The model changed, so the predictions started again.</p>'; p.changed = false; }
    const res = EDU.checkPredictions(M, r, p.choices);
    const selK = state.sel.members.size === 1 ? M.members.indexOf([...state.sel.members][0]) : -1;
    if (p.revealed) h += `<div class="score"><span>${res.correct} of ${res.total} right</span><span class="dim">attempt ${p.attempts}</span></div>`;
    else h += `<div class="score"><span>${res.answered} of ${res.total} answered</span></div>`;
    h += '<div class="predict-list">';
    res.items.forEach((it) => {
      const k = it.member, e = M.members[k];
      const mark = p.revealed ? (it.correct ? '<span class="verdict-ok" aria-label="right">✓</span>' : '<span class="verdict-bad" aria-label="wrong">✕</span>') : '';
      h += `<div class="predict-row${k === selK ? ' current' : ''}" data-pk="${k}">
        <button class="btn quiet sm mid" data-pselect="${k}" title="Show M${k + 1} on the canvas">M${k + 1}</button>
        <span class="dim">N${nodeNo(e.n1)}–N${nodeNo(e.n2)} ${mark}${p.revealed ? ` <b class="${it.actual === 'tension' ? 't-sign' : it.actual === 'compression' ? 'c-sign' : ''}">${CHOICE[it.actual][1]}</b>` : ''}</span>
        <span class="choice" role="group" aria-label="Prediction for M${k + 1}">${EDU.STATES.map((st) => `<button data-pchoice="${st}" data-k="${k}" aria-pressed="${p.choices[k] === st}" aria-label="${CHOICE[st][1]}" title="${CHOICE[st][1]}" ${p.revealed ? 'disabled' : ''}>${CHOICE[st][0]}</button>`).join('')}</span></div>`;
      if (p.revealed && (!it.correct || k === selK)) h += `<p class="feedback">${predictReasonText(it, M)} ${esc(predictHint(it))}</p>`;
    });
    h += '</div>';
    if (!p.revealed) h += `<div class="step-nav"><span class="dim">${res.complete ? 'All answered.' : `${res.total - res.answered} to go.`}</span><button class="btn primary" data-pact="check" ${res.complete ? '' : 'disabled'}>Check my predictions</button></div>`;
    else h += `<div class="step-nav"><button class="btn" data-pact="again" ${res.correct === res.total ? 'disabled' : ''}>Try the wrong ones again</button><button class="btn quiet" data-pact="reset">Start again</button></div>
      ${res.correct === res.total ? '<div class="summary-box">All right. Select any member to see the calculation behind its force in the Inspector.</div>' : ''}`;
    return h + '</div>';
  }
  function bindPredict(box) {
    box.querySelectorAll('[data-predict-ex]').forEach((b) => b.addEventListener('click', () => {
      pushUndo();
      loadModel(buildExample(b.dataset.predictEx), `Prediction exercise: ${EXAMPLES.find((x) => x[0] === b.dataset.predictEx)[1]}`);
      state.learn.predict = null;
      refreshAfterPredictChange(); renderLearn();
    }));
    box.querySelectorAll('[data-pselect]').forEach((b) => b.addEventListener('click', () => { const e = state.model.members[+b.dataset.pselect]; if (e) selectOnly('member', e); }));
    box.querySelectorAll('[data-pchoice]').forEach((b) => b.addEventListener('click', () => {
      const p = predictState(), k = +b.dataset.k;
      if (p.revealed) return;
      p.choices[k] = p.choices[k] === b.dataset.pchoice ? null : b.dataset.pchoice;
      renderLearn(); requestRender();
      const again = $(`#paneLearn [data-pchoice="${b.dataset.pchoice}"][data-k="${k}"]`); if (again) again.focus();
    }));
    box.querySelectorAll('[data-pact]').forEach((b) => b.addEventListener('click', () => {
      const p = predictState(), act = b.dataset.pact;
      if (act === 'check') {
        p.revealed = true; p.attempts++;
        const res = EDU.checkPredictions(state.model, state.res, p.choices), ek = exampleKeyOf(state.model);
        if (res && res.correct === res.total && ek) recordExercise(`predict:${ek}`); // lesson 2's challenge
      }
      else if (act === 'again') {
        const res = EDU.checkPredictions(state.model, state.res, p.choices);
        res.items.forEach((it) => { if (!it.correct) p.choices[it.member] = null; });
        p.revealed = false;
      } else if (act === 'reset') { p.choices = []; p.revealed = false; p.attempts = 0; }
      refreshAfterPredictChange(); renderLearn();
    }));
  }
  LEARN_VIEWS.predict = {
    render: learnPredictView, bind: bindPredict, live: true,
    enter() { predictState(); refreshAfterPredictChange(); },
    leave() { setTimeout(refreshAfterPredictChange, 0); },
    onSelect() { renderLearn(); const row = $('#paneLearn .predict-row.current'); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' }); },
  };
  /** The learner's predictions on the canvas: a letter at each member's middle, with ✓ or ✕ once checked. */
  function drawPredictionOverlay(P) {
    const p = state.learn.predict;
    if (!p || state.s.workspace !== 'learn' || state.learn.view !== 'predict' || p.key !== predictKey()) return;
    const r = state.res, M = state.model;
    ctx.save();
    ctx.font = `600 12px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    M.members.forEach((e, k) => {
      const ch = p.choices[k];
      const a = P.get(e.n1), b = P.get(e.n2), x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
      const letter = ch ? CHOICE[ch][0] : '?';
      let mark = '';
      if (p.revealed && ch && r && r.ok) { if (r.members[k].state === ch) return; mark = ' ✕'; } // after the check, mark only the wrong answers
      const t = letter + mark, w = ctx.measureText(t).width + 12;
      ctx.fillStyle = COL.bg; ctx.strokeStyle = ch ? COL.accent2 : COL.text3; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.rect(x - w / 2, y - 10, w, 20); ctx.fill(); ctx.stroke();
      ctx.fillStyle = mark === ' ✕' ? COL.fail : ch ? COL.text1 : COL.text3;
      ctx.fillText(t, x, y + 0.5);
    });
    ctx.restore();
  }


  /* ---------- free-body diagram of a joint and the method of joints (milestone 8) ---------- */
  ICON.fbd = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.2"/><path d="M10 10 L3 4 M10 10 L17 4 M10 10 V18 M5 5.5 L3 4 L5.2 3.6"/></svg>';
  ICON.joints = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5" stroke-dasharray="2.5 2"/><circle cx="10" cy="10" r="1.8"/><path d="M10 10 L16.5 6"/></svg>';
  LEARN_ACTIVITIES.push({ item: () => ['fbd', ICON.fbd, 'Free-body diagram of a joint', 'Isolate a node: see every force on it, split into x and y, and check ΣFx = 0 and ΣFy = 0 with the solver\'s numbers.', ''] });
  LEARN_ACTIVITIES.push({ item: () => ['joints', ICON.joints, 'Method of joints', 'Find the member forces by hand, one joint at a time, and check each answer against the solver.', jointsMeta()] });

  /** The node the free-body and joints views show: the selected node, if one is selected. */
  const selectedNode = () => (state.sel.nodes.size === 1 && !state.sel.members.size ? [...state.sel.nodes][0] : null);
  function openFbdFor(n) {
    setWorkspace('learn');
    openLearnView('fbd');
    if (n) selectOnly('node', n);
  }
  const fnum = (v) => fF(v, state.res && state.res.summary ? state.res.summary.Fref : 0);
  /**
   * The joint as an SVG drawing. Member forces lie along their members: tension arrows point away from the
   * joint (the member pulls), compression arrows point at it (the member pushes). The load arrives at the
   * joint; the reaction has an open arrowhead. Unknowns (method of joints) are drawn as assumed tension.
   */
  function fbdSvg(forces, opts) {
    const W = 400, H = 280, cx = W / 2, cy = H / 2, gap = 12;
    const scale = Math.max(...forces.map((f) => (f.unknown ? 0 : Math.hypot(f.fx, f.fy))), 1e-300);
    let body = '';
    const len = (f) => (f.unknown ? 62 : 30 + 40 * Math.min(1, Math.hypot(f.fx, f.fy) / scale));
    const arrowHead = (x, y, ux, uy, open, color) => {
      const a = Math.atan2(uy, ux), h = 10;
      const p1 = [x - h * Math.cos(a - 0.42), y - h * Math.sin(a - 0.42)], p2 = [x - h * Math.cos(a + 0.42), y - h * Math.sin(a + 0.42)];
      return open ? `<path d="M${p1} L${x},${y} L${p2}" fill="none" stroke="${color}" stroke-width="2"/>` : `<path d="M${p1} L${x},${y} L${p2} Z" fill="${color}"/>`;
    };
    for (const f of forces) {
      let ux, uy, color, label, open = false, headAtJoint;
      if (f.kind === 'member') {
        ux = f.ex; uy = -f.ey; // SVG y points down
        color = f.unknown ? COL.warn : f.state === 'zero' ? COL.zeroHex : f.N > 0 ? COL.tensionHex : COL.compressionHex;
        body += `<line x1="${cx}" y1="${cy}" x2="${cx + ux * 96}" y2="${cy + uy * 96}" stroke="${color}" stroke-opacity="0.3" stroke-width="5" stroke-linecap="round"/>`;
        label = f.unknown ? `M${f.member + 1}: N = ?` : `M${f.member + 1}: ${f.state === 'zero' ? '0' : `${f.N > 0 ? '+' : ''}${fnum(f.N)}`}`;
        if (f.state === 'zero' && !f.unknown) { body += svgLabel(cx + ux * 82, cy + uy * 82, label, COL.text2); continue; }
        headAtJoint = !f.unknown && f.N < 0; // compression pushes on the joint
      } else {
        const m = Math.hypot(f.fx, f.fy) || 1;
        ux = f.fx / m; uy = -f.fy / m;
        color = f.kind === 'load' ? COL.load : COL.reaction;
        open = f.kind === 'reaction';
        headAtJoint = true;
        label = `${f.kind === 'load' ? 'F' : 'R'} = ${fnum(m)}`;
        ux = -ux; uy = -uy; // drawn from outside, arriving at the joint
      }
      const L = len(f);
      const x0 = cx + ux * gap, y0 = cy + uy * gap, x1 = cx + ux * (gap + L), y1 = cy + uy * (gap + L);
      if (headAtJoint) {
        body += `<line x1="${x1}" y1="${y1}" x2="${x0}" y2="${y0}" stroke="${color}" stroke-width="2.4"/>` + arrowHead(x0, y0, -ux, -uy, open, color);
      } else {
        body += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" stroke-width="2.4" ${f.unknown ? 'stroke-dasharray="5 3"' : ''}/>` + arrowHead(x1, y1, ux, uy, false, color);
      }
      body += svgLabel(cx + ux * (gap + L + 18), cy + uy * (gap + L + 18), label, color);
    }
    body += `<circle cx="${cx}" cy="${cy}" r="24" fill="none" stroke="${COL.accent2}" stroke-dasharray="4 3"/><circle cx="${cx}" cy="${cy}" r="5" fill="${COL.node}"/>`;
    body += `<text x="${cx + 8}" y="${cy - 9}" class="lbl-dim">${esc(opts.title)}</text>`;
    // axes key
    body += `<g transform="translate(18 ${H - 18})" stroke="${COL.text3}" fill="${COL.text3}"><line x1="0" y1="0" x2="22" y2="0"/><line x1="0" y1="0" x2="0" y2="-22"/><text x="26" y="4" class="lbl-dim">x</text><text x="-4" y="-27" class="lbl-dim">y</text></g>`;
    return `<div class="fbd"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria)}">${body}</svg></div>`;
  }
  function svgLabel(x, y, text, color) {
    const anchor = Math.abs(x - 200) < 30 ? 'middle' : x > 200 ? 'start' : 'end';
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" fill="${color}" style="fill:${color}">${esc(text)}</text>`;
  }
  /** Components table and the two equilibrium equations, with the solver's numbers in the chosen force unit. */
  function fbdTable(d) {
    const fu = state.s.forceUnit;
    const name = (f) => (f.kind === 'member' ? `M${f.member + 1} (${f.state === 'zero' ? 'zero' : f.N > 0 ? 'tension' : 'compression'})` : f.kind === 'load' ? 'Load F (λ included)' : 'Reaction R');
    let h = `<table class="comp-table"><thead><tr><th>Force</th><th>F<sub>x</sub> [${fu}]</th><th>F<sub>y</sub> [${fu}]</th></tr></thead><tbody>`;
    for (const f of d.forces) h += `<tr><td>${name(f)}</td><td>${fnum(f.fx)}</td><td>${fnum(f.fy)}</td></tr>`;
    // sums at round-off level (below 1e-9 of the largest force) show as 0; the note below states the true residual
    h += `</tbody><tfoot><tr><td>Σ</td><td>${fmt(chop(d.sumFx, d.scale * 1e3) / fU(), 3)}</td><td>${fmt(chop(d.sumFy, d.scale * 1e3) / fU(), 3)}</td></tr></tfoot></table>`;
    const term = (v) => (v < 0 ? ` − ${fnum(-v)}` : ` + ${fnum(v)}`);
    const eq = (comp) => `ΣF<sub>${comp}</sub> =${d.forces.map((f) => term(comp === 'x' ? f.fx : f.fy)).join('').replace(/^ \+ /, ' ')} = ${fmt(chop(comp === 'x' ? d.sumFx : d.sumFy, d.scale * 1e3) / fU(), 3)} ${fu}`;
    h += `<div class="equation">${eq('x')}</div><div class="equation">${eq('y')}</div>`;
    h += `<p class="note ${d.balanced ? 'ok-note' : 'bad-note'}">${d.balanced ? '✓ Both sums are zero: the joint is in equilibrium.' : '✕ The sums are not zero.'} What remains is round-off, ${fmt(Math.max(Math.abs(d.sumFx), Math.abs(d.sumFy)), 2)} N, far below the solver's zero-force tolerance of ${fmt(d.tol, 2)} N.</p>`;
    return h;
  }
  function learnFbdView() {
    const n = selectedNode(), r = R();
    let h = learnHead('Free-body diagram of a joint', n ? `Node N${nodeNo(n)}` : 'Select a node on the canvas');
    h += `<div class="act-body"><p>Cut a joint free from the truss. Every cut member acts on the joint with its axial force along its own line: <b class="t-sign">tension pulls the joint toward the member</b> (arrow away from the joint), <b class="c-sign">compression pushes on it</b> (arrow into the joint). Loads and support reactions act there too. A joint at rest has ΣF<sub>x</sub> = 0 and ΣF<sub>y</sub> = 0.</p>`;
    if (!r || !r.ok) return h + `<p class="note warn-note">${r && r.mechanism ? 'The structure is unstable, so its joints have no equilibrium forces to draw.' : 'Analyse a stable, loaded model first (for example the Pratt bridge from File).'}</p></div>`;
    h += `<div class="node-chips" role="group" aria-label="Choose a node">${state.model.nodes.map((x, i) => `<button class="btn sm ${x === n ? 'toggle on' : ''}" data-fbd-node="${i}">N${i + 1}</button>`).join('')}</div>`;
    if (!n) return h + '<p class="note">Choose a node above, or select one on the canvas.</p></div>';
    const i = state.model.nodes.indexOf(n), d = EDU.fbd(state.model, r, i);
    if (!d) return h + '<p class="note">This node is not part of the analysis.</p></div>';
    h += fbdSvg(d.forces, { title: `N${i + 1}`, aria: `Free-body diagram of node N${i + 1}` });
    h += `<h3>Components</h3><p class="note">Each force splits into x and y parts: for a member, F<sub>x</sub> = N·c and F<sub>y</sub> = N·s, with c, s the direction from this joint to the member's other end.</p>${fbdTable(d)}`;
    h += `<details class="explain" ${openIfGuided()}><summary>Why the arrows point the way they do</summary><p>The solver reports a positive N for tension. A stretched member wants to shorten, so it pulls the joints at its ends toward each other: on this joint the pull points along the member, away from the joint. A squeezed member (N negative) wants to lengthen and pushes the joint away. Writing every member force as N times the unit vector from the joint to the other end gives both cases with one formula, because the sign of N flips the arrow.</p></details>`;
    return h + '</div>';
  }
  function bindFbd(box) {
    box.querySelectorAll('[data-fbd-node]').forEach((b) => b.addEventListener('click', () => selectOnly('node', state.model.nodes[+b.dataset.fbdNode])));
  }
  LEARN_VIEWS.fbd = { render: learnFbdView, bind: bindFbd, live: true, onSelect() { renderLearn(); requestRender(); }, leave() { requestRender(); } };

  /* method of joints: state per model (keyed like the predictions) */
  function jointsState() {
    let s = state.learn.joints;
    if (!s || s.key !== predictKey()) {
      s = state.learn.joints = { key: predictKey(), known: new Set(), answers: {}, feedback: null, revealed: new Set(), log: [] };
    }
    const r = state.res;
    s.complete = !!(r && r.ok && s.known.size === state.model.members.length);
    return s;
  }
  function jointsMeta() {
    const s = state.learn.joints;
    if (!s || !state.model.members.length || s.key !== predictKey()) return '';
    return `${s.known.size} of ${state.model.members.length} found`;
  }
  function learnJointsView() {
    const M = state.model, r = state.res, fu = state.s.forceUnit;
    let h = learnHead('Method of joints', 'Find the member forces by hand');
    h += '<div class="act-body">';
    if (!M.members.length || !r || !r.ok) return h + `<p class="note warn-note">${r && r.mechanism ? 'The structure is unstable, so its member forces are not determined.' : 'Open a stable, loaded truss first: for example the Pratt bridge or the cantilever from File.'}</p></div>`;
    const s = jointsState(), n = selectedNode(), i = n ? M.nodes.indexOf(n) : -1;
    h += `<p>Take one joint at a time. At each joint two equations hold, ΣF<sub>x</sub> = 0 and ΣF<sub>y</sub> = 0, so you can find at most <b>two</b> unknown member forces there. Assume every unknown is in <b>tension</b> (N > 0); a negative answer then means compression. The results stay hidden until every member is found.</p>`;
    // reactions: from the equilibrium of the whole truss; given here
    const sup = M.nodes.map((x, k) => [x, k, r.nodes[k]]).filter(([, , nr]) => nr && (nr.restrained[0] || nr.restrained[1]));
    const reactHtml = `<details class="explain"><summary>The support reactions (given)</summary><p>First, the reactions follow from the equilibrium of the whole truss: ΣF<sub>x</sub> = 0, ΣF<sub>y</sub> = 0 and ΣM = 0 about any point. Here they are given, from the solver:</p>
      <table class="comp-table"><thead><tr><th>Support</th><th>R<sub>x</sub> [${fu}]</th><th>R<sub>y</sub> [${fu}]</th></tr></thead><tbody>${sup.map(([, k, nr]) => `<tr><td>N${k + 1}</td><td>${fnum(nr.rx)}</td><td>${fnum(nr.ry)}</td></tr>`).join('')}</tbody></table></details>`;
    h += `<div class="score"><span>${s.known.size} of ${M.members.length} member forces found</span></div>`;
    if (s.complete) {
      h += '<div class="summary-box">Every member force is found. The results are shown again: compare your forces with the solver in the Inspector or the Members table. They agree because the solver also satisfies ΣF = 0 at every joint.</div>';
      h += '<div class="btn-row"><button class="btn" data-jact="restart">Start again</button></div>';
    }
    const next = EDU.nextJoint(M, r, s.known);
    if (!s.complete) h += `<p class="note">${next >= 0 ? `A joint you can solve now: <button class="btn sm" data-jnode="${next}">N${next + 1}</button>` : 'No joint has two or fewer unknowns: this truss needs another method (or more equations) at this point.'}</p>`;
    const chipsHtml = `<details class="more" open><summary>All joints (unknowns shown with ?)</summary><div class="node-chips" role="group" aria-label="Choose a joint">${M.nodes.map((x, k) => {
      const ex = EDU.jointExercise(M, r, k, s.known);
      const u = ex ? ex.unknowns.length : 0;
      return `<button class="btn sm ${k === i ? 'toggle on' : ''}" data-jnode="${k}" title="${u} unknown member force${u === 1 ? '' : 's'}">N${k + 1}${u ? ` <span class="dim">${u}?</span>` : ' ✓'}</button>`;
    }).join('')}</div></details>`;
    const tail = chipsHtml + reactHtml + '</div>';
    if (i < 0 || s.complete) return h + (s.complete ? '' : '<p class="note">Choose a joint below, or select a node on the canvas.</p>') + tail;
    const ex = EDU.jointExercise(M, r, i, s.known);
    if (!ex) return h + '<p class="note">This node is not part of the analysis.</p>' + tail;
    const forces = ex.knowns.map((m) => ({ kind: 'member', member: m.member, N: m.N, state: m.state, ex: m.ex, ey: m.ey, fx: m.fx, fy: m.fy }))
      .concat(ex.unknowns.map((m) => ({ kind: 'member', member: m.member, unknown: true, ex: m.ex, ey: m.ey, fx: 0, fy: 0, N: 1 })));
    if (ex.joint.F.fx || ex.joint.F.fy) forces.push({ kind: 'load', fx: ex.joint.F.fx, fy: ex.joint.F.fy });
    if (ex.joint.R.supported) forces.push({ kind: 'reaction', fx: ex.joint.R.rx, fy: ex.joint.R.ry });
    h += `<h3>Joint N${i + 1}</h3>` + fbdSvg(forces, { title: `N${i + 1}`, aria: `Joint N${i + 1}: knowns and unknowns` });
    if (ex.reason === 'done') return h + '<p class="note ok-note">✓ Every member at this joint is already known.</p>' + tail;
    if (ex.reason === 'too-many') return h + `<p class="note warn-note">${ex.unknowns.length} unknown member forces, but only two equations: solve a neighbouring joint first.</p>` + tail;
    if (ex.reason === 'collinear') return h + '<p class="note warn-note">The two unknown members lie on one line: ΣF across that line cannot separate them. Solve another joint first.</p>' + tail;
    // the two equations with the knowns as numbers and the unknowns as symbols (coefficients are the direction cosines)
    const term = (c, sym) => `${c < 0 ? ' − ' : ' + '}${fmt(Math.abs(c), 4)}·${sym}`;
    const eqn = (comp) => {
      const known = (comp === 'x' ? ex.joint.F.fx + (ex.joint.R.supported ? ex.joint.R.rx : 0) + ex.knowns.reduce((t, m) => t + m.fx, 0) : ex.joint.F.fy + (ex.joint.R.supported ? ex.joint.R.ry : 0) + ex.knowns.reduce((t, m) => t + m.fy, 0));
      return `ΣF<sub>${comp}</sub>:${ex.unknowns.map((u) => term(comp === 'x' ? u.ex : u.ey, `N<sub>M${u.member + 1}</sub>`)).join('').replace(/^ \+ /, ' ')}${known < 0 ? ' − ' : ' + '}${fnum(Math.abs(known))} ${fu} = 0`;
    };
    h += `<p class="note">Known forces are numbers (loads, reactions, members already found); unknowns are N times their direction cosines c, s from N${i + 1} toward the member's other end.</p>
      <div class="equation">${eqn('x')}</div><div class="equation">${eqn('y')}</div>`;
    const fb = s.feedback && s.feedback.node === i ? s.feedback : null;
    h += ex.unknowns.map((u) => {
      const f = fb ? fb.items.find((x) => x.member === u.member) : null;
      const msg = !f ? '' : f.correct ? '<span class="verdict-ok">✓ right</span>' : f.answer === null ? '<span class="verdict-bad">enter a number</span>'
        : f.sizeOk && !f.signOk ? '<span class="verdict-bad">✕ right size, wrong sign: check the direction you assumed</span>' : '<span class="verdict-bad">✕ not yet</span>';
      return `<div class="answer-row"><label for="jans${u.member}">N<sub>M${u.member + 1}</sub></label><input class="num w6" id="jans${u.member}" data-jans="${u.member}" value="${s.answers[u.member] !== undefined ? esc(s.answers[u.member]) : ''}" placeholder="+ tension"><span class="u">${fu}</span> ${msg}</div>`;
    }).join('');
    h += `<div class="btn-row"><button class="btn primary sm" data-jact="check">Check</button><button class="btn sm quiet" data-jact="show">Show the solution</button></div>`;
    if (s.revealed.has(i)) {
      h += `<div class="summary-box">From the two equations: ${ex.solution.map((x) => `N<sub>M${x.member + 1}</sub> = ${x.N > 0 ? '+' : ''}${fnum(x.N)} ${fu} (${Math.abs(x.N) <= 1e-9 * r.summary.Fref ? 'zero' : x.N > 0 ? 'tension' : 'compression'})`).join(', ')}. ${ex.unknowns.length === 2 ? 'Two equations, two unknowns: solved by elimination (Cramer\'s rule).' : 'One unknown: the equation along the member gives it.'} These are the solver's values too.</div>`;
    }
    if (s.log.length) h += `<details class="more"><summary>Found so far</summary><p class="note">${s.log.map((x) => `M${x.member + 1} = ${x.N > 0 ? '+' : ''}${fnum(x.N)} ${fu}`).join(', ')}</p></details>`;
    return h + tail;
  }
  function bindJoints(box) {
    box.querySelectorAll('[data-jnode]').forEach((b) => b.addEventListener('click', () => selectOnly('node', state.model.nodes[+b.dataset.jnode])));
    box.querySelectorAll('[data-jans]').forEach((el) => {
      el.addEventListener('change', () => { jointsState().answers[el.dataset.jans] = el.value; });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { jointsState().answers[el.dataset.jans] = el.value; jointsCheck(); } });
    });
    box.querySelectorAll('[data-jact]').forEach((b) => b.addEventListener('click', () => {
      const s = jointsState();
      box.querySelectorAll('[data-jans]').forEach((el) => { s.answers[el.dataset.jans] = el.value; });
      if (b.dataset.jact === 'check') jointsCheck();
      else if (b.dataset.jact === 'show') { const n = selectedNode(); if (n) s.revealed.add(state.model.nodes.indexOf(n)); renderLearn(); }
      else if (b.dataset.jact === 'restart') { state.learn.joints = null; refreshAfterPredictChange(); renderLearn(); }
    }));
  }
  function jointsCheck() {
    const s = jointsState(), n = selectedNode();
    if (!n) return;
    const i = state.model.nodes.indexOf(n), ex = EDU.jointExercise(state.model, state.res, i, s.known);
    if (!ex || !ex.solvable) return;
    const answers = {};
    for (const u of ex.unknowns) { const v = evalNum(String(s.answers[u.member] || '').trim() || 'x'); answers[u.member] = Number.isFinite(v) ? v * fU() : null; }
    const items = EDU.checkJointAnswers(state.res, ex, answers);
    s.feedback = { node: i, items };
    if (items.every((x) => x.correct)) {
      for (const x of items) { s.known.add(x.member); s.log.push({ member: x.member, N: x.N }); }
      s.feedback = null;
      const wasComplete = s.complete;
      jointsState();
      if (s.complete && !wasComplete) { refreshAfterPredictChange(); toast('Every member force found by the method of joints', 'ok'); }
      else toast(`Joint N${i + 1} solved`, 'ok');
      const next = EDU.nextJoint(state.model, state.res, s.known);
      if (next >= 0 && !s.complete) { selectOnly('node', state.model.nodes[next]); return; }
    }
    renderLearn(); requestRender();
  }
  LEARN_VIEWS.joints = {
    render: learnJointsView, bind: bindJoints, live: true,
    enter() {
      const s = jointsState();
      const sel = selectedNode(), at = sel ? EDU.jointExercise(state.model, state.res, state.model.nodes.indexOf(sel), s.known) : null;
      if ((!at || !at.solvable) && state.res && state.res.ok) { // start at a joint that can be solved
        const nx = EDU.nextJoint(state.model, state.res, s.known);
        if (nx >= 0) { state.sel.members.clear(); state.sel.nodes = new Set([state.model.nodes[nx]]); }
      }
      refreshAfterPredictChange();
    },
    leave() { setTimeout(refreshAfterPredictChange, 0); },
    onSelect() { renderLearn(); requestRender(); },
  };
  /** The isolated joint on the canvas: a dashed circle where the members are cut, and the members known so far. */
  function drawFbdOverlay(P) {
    if (state.s.workspace !== 'learn' || (state.learn.view !== 'fbd' && state.learn.view !== 'joints')) return;
    const n = selectedNode();
    ctx.save();
    if (state.learn.view === 'joints' && state.learn.joints && state.res && state.res.ok) {
      ctx.font = `12px ${MONO}`;
      for (const k of state.learn.joints.known) {
        const e = state.model.members[k], mr = state.res.members[k];
        if (!e || !mr) continue;
        const a = P.get(e.n1), b = P.get(e.n2);
        tag(`${mr.state === 'zero' ? '0' : `${mr.force > 0 ? '+' : ''}${fF(mr.force, state.res.summary.Fref)}`}`, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 'center', 'middle', mr.state === 'zero' ? COL.zeroHex : mr.force > 0 ? COL.tensionHex : COL.compressionHex);
      }
    }
    if (n && P.has(n)) {
      const [x, y] = P.get(n);
      ctx.setLineDash([5, 4]); ctx.strokeStyle = COL.accent2; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }


  /* ---------- Solver Explorer (milestone 9) ---------- */
  ICON.explorer = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 8 H17 M8 3 V17"/></svg>';
  LEARN_ACTIVITIES.push({ item: () => ['explorer', ICON.explorer, 'Solver Explorer', 'Follow your model through the Direct Stiffness Method: DOFs, element matrices, assembly, the reduced system, and back to forces.', ''] });
  function explorerState() {
    if (!state.learn.explorer) state.learn.explorer = { stage: 0, member: 0, cell: null };
    return state.learn.explorer;
  }
  const kUnit = () => STIFF_UNITS[state.s.mtxUnit] || 1e3;
  /**
   * A matrix as a table: rows and columns labelled with DOF names, values in the chosen stiffness unit.
   * cls(a, b) adds classes (partition, contribution, selection); clickable cells carry data-r and data-c.
   */
  function mtxTable(M, nr, nc, rowLab, colLab, opts) {
    const o = opts || {}, unit = o.unit || 1;
    let mx = 0;
    for (let a = 0; a < nr * nc; a++) mx = Math.max(mx, Math.abs(M[a]));
    let h = `<div class="mtx-scroll"><table class="mtx"><thead><tr><th class="corner rh"></th>${colLab.map((l, b) => `<th class="${o.colCls ? o.colCls(b) : ''}">${esc(l)}</th>`).join('')}</tr></thead><tbody>`;
    for (let a = 0; a < nr; a++) {
      h += `<tr><th class="rh ${o.rowCls ? o.rowCls(a) : ''}">${esc(rowLab[a])}</th>`;
      for (let b = 0; b < nc; b++) {
        const v = chop(M[a * nc + b], mx);
        const cls = [nr === nc && a === b ? 'diag' : '', v === 0 ? 'zero' : '', v < 0 ? 'neg' : '', o.cls ? o.cls(a, b) : ''].join(' ');
        h += `<td class="${cls}" ${o.click ? `data-r="${a}" data-c="${b}" tabindex="0"` : ''}>${v === 0 ? '·' : fmt(v / unit)}</td>`;
      }
      h += '</tr>';
    }
    return h + '</tbody></table></div>';
  }
  const vecTable = (vals, labels, unitFn, head) => `<table class="comp-table"><thead><tr><th>DOF</th><th>${head}</th></tr></thead><tbody>${vals.map((v, a) => `<tr><td>${esc(labels[a])}</td><td>${unitFn(v)}</td></tr>`).join('')}</tbody></table>`;
  function explorerStageHtml(ex, st, r) {
    const M = state.model, S = explorerState(), fu = state.s.forceUnit, du = state.s.dispUnit, ku = state.s.mtxUnit;
    const memberChips = () => `<div class="node-chips" role="group" aria-label="Choose a member">${M.members.map((e, k) => `<button class="btn sm ${k === S.member ? 'toggle on' : ''}" data-xmember="${k}">M${k + 1}</button>`).join('')}</div>`;
    const mr = r.members[S.member] || r.members[0];
    const big = ex.tooLarge ? `<p class="note warn-note">This model has ${ex.ndof} DOFs, so its matrices have ${ex.ndof * ex.ndof} entries. The Explorer shows matrices as tables up to ${EDU.EXPLORER_MAX_DOFS} × ${EDU.EXPLORER_MAX_DOFS}: try the A-frame (6 DOFs) or the inclined-roller truss (6 DOFs), or see the heatmap in the Matrices tab.</p>` : '';
    switch (st.id) {
      case 'model': {
        const loads = M.nodes.map((n, i) => [i, nodeLoad(M, n)]).filter(([, L]) => L.fx || L.fy);
        return `<p>${plural(M.nodes.length, 'node')}, ${plural(M.members.length, 'member')}, ${plural(M.nodes.filter((n) => n.support.type !== 'none').length, 'support')}, ${plural(loads.length, 'loaded node')}. The solver receives coordinates, member properties (E, A, I, σ<sub>y</sub>), restraints and the actions of what is analysed, multiplied by λ.</p>
          <table class="comp-table"><thead><tr><th>Member</th><th>E [GPa]</th><th>A [mm²]</th><th>L [m]</th></tr></thead><tbody>${r.members.map((x, k) => `<tr><td>M${k + 1}</td><td>${fmt(x.E / GPA)}</td><td>${fmt(x.A / MM2)}</td><td>${fmt(x.L)}</td></tr>`).join('')}</tbody></table>`;
      }
      case 'numbering':
        return `<p>The numbers are the order of the nodes and members in the model. A member's direction (start i → end j) only fixes the sign of c and s; the results do not depend on it.</p>
          <table class="comp-table"><thead><tr><th>Member</th><th>start i</th><th>end j</th></tr></thead><tbody>${r.members.map((x, k) => `<tr><td>M${k + 1}</td><td>N${x.i + 1}</td><td>N${x.j + 1}</td></tr>`).join('')}</tbody></table>`;
      case 'dofs':
        return `<p>${ex.ndof} DOFs in all (2 × ${M.nodes.length} nodes). Node i has DOF ${'2i − 1'} along x and DOF 2i along y; they are labelled "ix" and "iy" (with ′ in a rotated support frame). The canvas shows them as arrows: <span class="known">teal: free</span>, <span class="unknown">amber: restrained</span>.</p>
          <table class="comp-table"><thead><tr><th>Node</th><th>x DOF</th><th>y DOF</th><th>state</th></tr></thead><tbody>${M.nodes.map((n, i) => `<tr><td>N${i + 1}</td><td>${esc(ex.labels[2 * i])}</td><td>${esc(ex.labels[2 * i + 1])}</td><td>${r.nodes[i] && !r.nodes[i].active ? 'not connected' : [0, 1].map((a) => (ex.fixed.includes(2 * i + a) ? 'fixed' : 'free')).join(', ')}</td></tr>`).join('')}</tbody></table>`;
      case 'element':
        return `${memberChips()}<p>M${S.member + 1} acts as an axial spring: pull its ends apart by δ and it resists with N = k·δ.</p>
          <div class="equation">k = E·A/L = ${sci(mr.E)} Pa × ${sci(mr.A)} m² / ${sci(mr.L)} m = ${sci(mr.k)} N/m</div>
          <p>In the member's own axis (one DOF at each end, along the member), the two end forces and the two end displacements are related by the 2 × 2 matrix</p>
          ${mtxTable([mr.k, -mr.k, -mr.k, mr.k], 2, 2, ['i', 'j'], ['i', 'j'], { unit: kUnit() })}<p class="note">Values in ${ku}. Pushing one end while holding the other: the forces are equal and opposite, so each row sums to zero.</p>`;
      case 'transformation': {
        const t = EDU.memberTransformation(r, S.member), lab = mr.dofs.map((d) => ex.labels[d]);
        return `${memberChips()}<p>c = cos θ = ${fmt(mr.c, 6)} and s = sin θ = ${fmt(mr.s, 6)}. The axial displacement of an end is c·u<sub>x</sub> + s·u<sub>y</sub>, which is T times the global displacements:</p>
          ${mtxTable(t.T.flat(), 2, 4, ['i', 'j'], lab, {})}
          <p>so the member's stiffness in global axes is kᵉ = Tᵀ·k·T = (E·A/L)·[c² cs −c² −cs; cs s² −cs −s²; …]:</p>
          ${mtxTable(t.ke.flat(), 4, 4, lab, lab, { unit: kUnit() })}<p class="note">Values in ${ku}. This is exactly the solver's kᵉ for M${S.member + 1}.</p>`;
      }
      case 'assembly': {
        if (ex.tooLarge) return big;
        const contrib = new Set(EDU.assemblyContribution(r, S.member).map((c) => c.row * ex.ndof + c.col));
        let cell = '';
        if (S.cell) {
          const parts = EDU.entryContributions(r, S.cell.r, S.cell.c);
          cell = `<div class="equation">K[${esc(ex.labels[S.cell.r])}, ${esc(ex.labels[S.cell.c])}] = ${parts.length ? parts.map((p) => `${fmt(p.value / kUnit())} (M${p.member + 1})`).join(' + ') : '0 (no member joins these DOFs)'} = ${fmt(r.K[S.cell.r * ex.ndof + S.cell.c] / kUnit())} ${ku}</div>`;
        }
        return `${memberChips()}<p>Each member adds its kᵉ into the rows and columns of its four DOFs; where members share a node their terms add up. Highlighted: the 16 entries M${S.member + 1} adds. Select any entry to see the sum behind it.</p>${cell}
          ${mtxTable(r.K, ex.ndof, ex.ndof, ex.labels, ex.labels, { unit: kUnit(), click: true, cls: (a, b) => `${contrib.has(a * ex.ndof + b) ? 'contrib' : ''} ${S.cell && S.cell.r === a && S.cell.c === b ? 'hl' : ''}` })}
          <p class="note">Global K in ${ku}, ${ex.ndof} × ${ex.ndof}, exactly symmetric. On its own K is singular: nothing yet stops the truss from moving as a rigid body.</p>`;
      }
      case 'boundary':
        return `<p>${ex.ns} of the ${ex.ndof} DOFs are restrained by supports, ${ex.nf} are free.${ex.rotated.length ? ` Nodes ${ex.rotated.map((i) => `N${i + 1}`).join(', ')} have a rotated support frame: their DOFs are turned to the support's x′, y′ axes (K′ = Λ·K·Λᵀ), so a roller on a slope restrains exactly the direction normal to it.` : ''}</p>
          <table class="comp-table"><thead><tr><th>Restrained DOF</th><th>prescribed u [${du}]</th></tr></thead><tbody>${ex.fixed.map((d) => `<tr><td>${esc(ex.labels[d])}</td><td>${fD(r.prescribed[d])}</td></tr>`).join('')}</tbody></table>
          <p class="note">A prescribed value other than 0 is a support settlement (λ included).</p>`;
      case 'partition': {
        if (ex.tooLarge) return big;
        const isF = new Set(ex.free);
        return `<p>With the free DOFs (f) first and the restrained ones (s) second, K′·u = F splits into blocks: K<sub>ff</sub>·u<sub>f</sub> + K<sub>fs</sub>·u<sub>s</sub> = F<sub>f</sub>, and the rows of the restrained DOFs give the reactions. Amber marks the restrained rows and columns.</p>
          ${mtxTable(r.Kt, ex.ndof, ex.ndof, ex.labels, ex.labels, { unit: kUnit(), rowCls: (a) => (isF.has(a) ? '' : 'fix'), colCls: (b) => (isF.has(b) ? '' : 'fix'), cls: (a, b) => (isF.has(a) && isF.has(b) ? '' : 'fixcell') })}`;
      }
      case 'reduced': {
        const D = ex.diagnostics || {}, lab = ex.free.map((d) => ex.labels[d]);
        let h = ex.nf > EDU.EXPLORER_MAX_DOFS ? big : mtxTable(r.Kff, ex.nf, ex.nf, lab, lab, { unit: kUnit() });
        h += `<p class="note">K<sub>ff</sub> in ${ku}, ${ex.nf} × ${ex.nf}.</p>`;
        if (ex.mechanism) h += `<p class="note bad-note">Rank ${D.rank} of ${ex.nf}: K<sub>ff</sub> is singular, so K<sub>ff</sub>·u<sub>f</sub> = b<sub>f</sub> has no unique solution. ${plural(ex.mechanism.nullity, 'mechanism mode')}: ${esc(ex.mechanism.modes[0] ? ex.mechanism.modes[0].description : '')} The later stages need a stable structure.</p>`;
        else if (ex.nf) h += `<details class="explain" ${openIfGuided()}><summary>Is the system well posed?</summary><p>Before solving, the solver checks that K<sub>ff</sub> is positive definite (rank ${D.rank} of ${ex.nf}, by a pivoted Cholesky factorisation of the scaled matrix). Its 1-norm condition number κ₁ = ${fmt(D.cond1Scaled, 3)} (scaled) says how much the data's rounding can be amplified: about ${Math.floor(D.digits || 0)} of the 16 significant digits are reliable before refinement. det K<sub>ff</sub> = ${fmt(D.detRaw ? D.detRaw.mantissa : NaN, 4)} × 10${String(D.detRaw ? D.detRaw.exponent : 0).split('').map((c) => SUP[c] || c).join('')} (N/m)${String(ex.nf).split('').map((c) => SUP[c] || c).join('')}.</p></details>`;
        return h;
      }
      case 'loads': {
        const lab = ex.free.map((d) => ex.labels[d]);
        const Ff = ex.free.map((d) => (r.Ft || r.F)[d]);
        return `<p>F holds the nodal loads (λ included), in the support frames where a frame is rotated. At the free DOFs the right-hand side is b<sub>f</sub> = F<sub>f</sub> − K<sub>fs</sub>·u<sub>s</sub>; the second term is the effect of prescribed settlements (zero when none).</p>
          <div class="calc"><div class="step-label">F<sub>f</sub> and b<sub>f</sub></div></div>
          <table class="comp-table"><thead><tr><th>DOF</th><th>F<sub>f</sub> [${fu}]</th><th>b<sub>f</sub> [${fu}]</th></tr></thead><tbody>${lab.map((l, a) => `<tr><td>${esc(l)}</td><td>${fF(Ff[a])}</td><td>${fF(r.bf[a])}</td></tr>`).join('')}</tbody></table>`;
      }
      case 'displacements': {
        const lab = ex.free.map((d) => ex.labels[d]), D = ex.diagnostics || {};
        return `<p>The solver factorises K<sub>ff</sub> (LU with partial pivoting) and solves for u<sub>f</sub>, then refines the solution ${plural(D.refineIterations || 0, 'time')} with residuals computed in about twice double precision.</p>
          ${vecTable(ex.free.map((d) => r.ut[d]), lab, (v) => `${fD(v)}`, `u<sub>f</sub> [${du}]`)}
          <p class="note ok-note">Check: max |K<sub>ff</sub>·u<sub>f</sub> − b<sub>f</sub>| = ${fmt(ex.residual ? ex.residual.max : 0, 2)} N, ${fmt(ex.residual ? ex.residual.rel : 0, 2)} of the largest load term: the equations are satisfied to round-off.</p>`;
      }
      case 'forces':
        return `<p>For each member, the displacements of its two ends give its change of length δ = c·(u<sub>xj</sub> − u<sub>xi</sub>) + s·(u<sub>yj</sub> − u<sub>yi</sub>) and its force N = (E·A/L)·δ. Select a member to see the full calculation in the Inspector.</p>
          <table class="comp-table"><thead><tr><th>Member</th><th>δ [${du}]</th><th>N [${fu}]</th></tr></thead><tbody>${r.members.map((x, k) => `<tr><td>M${k + 1}</td><td>${fD(x.elong)}</td><td class="${x.state === 'tension' ? 't-sign' : x.state === 'compression' ? 'c-sign' : ''}">${x.state === 'zero' ? '0' : fF(x.force, r.summary.Fref)}</td></tr>`).join('')}</tbody></table>`;
      case 'reactions':
        return `<p>At a restrained DOF the row of K·u = F + R gives the reaction: R = K·u − F. It is the force the support applies to keep that DOF where it is.</p>
          <table class="comp-table"><thead><tr><th>DOF</th><th>R [${fu}]</th></tr></thead><tbody>${ex.fixed.map((d) => `<tr><td>${esc(ex.labels[d])}</td><td>${fF(r.Rt ? r.Rt[d] : r.R[d], r.summary.Fref)}</td></tr>`).join('')}</tbody></table>`;
      case 'equilibrium': {
        const e = (ex.diagnostics || {}).equilibrium || {};
        return `<p>Every load and reaction together must balance, as for any body at rest:</p>
          <div class="equation">ΣF<sub>x</sub> = ${fmt(e.sumFx, 3)} N,  ΣF<sub>y</sub> = ${fmt(e.sumFy, 3)} N,  ΣM = ${fmt(e.sumM, 3)} N·m</div>
          <p class="note ok-note">Relative to the forces involved: ${fmt(Math.max(e.relF || 0, e.relM || 0), 2)}. The equilibrium of every joint, rebuilt from the member forces, leaves ${fmt((ex.diagnostics || {}).nodalResidualRel, 2)}. Both are round-off: the solution is exact to the precision of the arithmetic.</p>`;
      }
      default: return '';
    }
  }
  function learnExplorerView() {
    const r = state.res, M = state.model;
    let h = learnHead('Solver Explorer', 'The Direct Stiffness Method, with your model');
    h += '<div class="act-body">';
    const small = `<div class="btn-row"><button class="btn sm" data-xexample="aframe">A-frame (6 DOFs)</button><button class="btn sm" data-xexample="inclined">Inclined roller (6 DOFs)</button><button class="btn sm" data-xexample="warren">Warren truss (22 DOFs)</button></div>`;
    if (!M.members.length || !r || !r.K) return h + `<p class="note warn-note">${!M.members.length ? 'The model has no members yet.' : 'The model cannot be analysed yet (see Results).'} Start with a small worked example:</p>${small}</div>`;
    const ex = EDU.explorer(M, r), S = explorerState();
    S.stage = clamp(S.stage, 0, ex.stages.length - 1);
    if (S.member >= M.members.length) S.member = 0;
    const st = ex.stages[S.stage];
    h += `<div class="stage-list" role="group" aria-label="Stages">${ex.stages.map((s, i) => `<button data-xstage="${i}" ${i === S.stage ? 'aria-current="step"' : ''} ${s.available ? '' : 'disabled'} title="${esc(s.title)}">${i + 1}</button>`).join('')}</div>`;
    h += `<h3>${S.stage + 1}. ${mathHtml(st.title)}</h3><p><b>${mathHtml(st.what)}</b></p>`;
    h += st.available ? explorerStageHtml(ex, st, r) : '<p class="note bad-note">This stage needs a stable structure: the reduced stiffness matrix of this model is singular, so there is no solution to follow.</p>';
    if (S.stage === 0) h += `<details class="explain" ${openIfGuided()}><summary>Worked examples</summary><p>A small model keeps every matrix readable:</p>${small}</details>`;
    h += '</div>';
    h += `<div class="step-nav"><button class="btn sm" data-xnav="-1" ${S.stage === 0 ? 'disabled' : ''}>&#8592; Previous</button><span class="dim">Stage ${S.stage + 1} of ${ex.stages.length}</span><button class="btn sm primary" data-xnav="1" ${S.stage === ex.stages.length - 1 || !ex.stages[S.stage + 1].available ? 'disabled' : ''}>Next &#8594;</button></div>`;
    return h;
  }
  function bindExplorer(box) {
    const S = explorerState();
    box.querySelectorAll('[data-xstage]').forEach((b) => b.addEventListener('click', () => { S.stage = +b.dataset.xstage; S.cell = null; renderLearn(); requestRender(); }));
    box.querySelectorAll('[data-xnav]').forEach((b) => b.addEventListener('click', () => { S.stage += +b.dataset.xnav; S.cell = null; renderLearn(); requestRender(); box.scrollTop = 0; }));
    box.querySelectorAll('[data-xmember]').forEach((b) => b.addEventListener('click', () => { S.member = +b.dataset.xmember; S.cell = null; selectOnly('member', state.model.members[S.member]); }));
    box.querySelectorAll('[data-xexample]').forEach((b) => b.addEventListener('click', () => {
      pushUndo();
      loadModel(buildExample(b.dataset.xexample), `Solver Explorer: ${EXAMPLES.find((x) => x[0] === b.dataset.xexample)[1]}`);
      S.stage = 0; S.member = 0; S.cell = null; renderLearn();
    }));
    const pickCell = (td) => { S.cell = { r: +td.dataset.r, c: +td.dataset.c }; renderLearn(); const again = $(`#paneLearn td[data-r="${S.cell.r}"][data-c="${S.cell.c}"]`); if (again) again.focus(); };
    box.querySelectorAll('td[data-r]').forEach((td) => {
      td.addEventListener('click', () => pickCell(td));
      td.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickCell(td); } });
    });
  }
  LEARN_VIEWS.explorer = {
    render: learnExplorerView, bind: bindExplorer, live: true,
    onSelect() { const S = explorerState(); if (state.sel.members.size === 1) { S.member = state.model.members.indexOf([...state.sel.members][0]); renderLearn(); } requestRender(); },
    leave() { requestRender(); },
  };
  /** The Explorer on the canvas: DOF arrows (free teal, restrained amber) and the member being looked at. */
  function drawExplorerOverlay(P) {
    if (state.s.workspace !== 'learn' || state.learn.view !== 'explorer') return;
    const r = state.res, S = explorerState(), id = EDU.EXPLORER_STAGES[S.stage] ? EDU.EXPLORER_STAGES[S.stage].id : '';
    if (!r || !r.K) return;
    ctx.save();
    if (['element', 'transformation', 'assembly'].includes(id)) {
      const e = state.model.members[S.member];
      if (e && P.has(e.n1)) { const a = P.get(e.n1), b = P.get(e.n2); ctx.strokeStyle = COL.accent; ctx.lineWidth = 6; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.globalAlpha = 1; }
    }
    if (['dofs', 'boundary', 'partition', 'reduced', 'loads', 'displacements'].includes(id)) {
      const fixed = new Set(Array.from(r.fixed || []));
      ctx.font = `12px ${MONO}`; ctx.lineWidth = 1.6;
      state.model.nodes.forEach((n, i) => {
        if (!P.has(n) || !r.nodes[i] || !r.nodes[i].active) return;
        const [x, y] = P.get(n), fr = r.nodes[i].frame || [1, 0];
        [[fr[0], -fr[1], 2 * i], [-fr[1], -fr[0], 2 * i + 1]].forEach(([ux, uy, d]) => {
          const col = fixed.has(d) ? COL.warn : COL.accent2;
          ctx.strokeStyle = col; ctx.fillStyle = col;
          arrow(x + ux * 6, y + uy * 6, x + ux * 30, y + uy * 30, 6);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(r.dofLabels[d], x + ux * 42, y + uy * 42);
        });
      });
    }
    ctx.restore();
  }


  /* ---------- lessons (milestone 11) ---------- */
  const TLS = window.TrussLessons || null;
  ICON.lesson = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5 C6 3.5 8 3.5 10 5 C12 3.5 14 3.5 17 4.5 V16 C14 15 12 15 10 16.5 C8 15 6 15 3 16 Z M10 5 V16.5"/></svg>';
  const PROGRESS_KEY = TLS ? (SMOKE ? TLS.PROGRESS_KEYS.smoke : TLS.PROGRESS_KEYS.user) : null;
  const progressStatus = { readFailed: false, unreadable: null, lastSave: null };
  /** Lesson progress, read once at start-up (kept apart from the model and the session). */
  function loadLearnProgress() {
    if (!TLS) return null;
    if (SMOKE && STORE) { try { STORE.removeItem(PROGRESS_KEY); STORE.removeItem(`${PROGRESS_KEY}.unreadable`); } catch (e) { /* storage unavailable */ } }
    const r = TLS.loadProgress(STORE, PROGRESS_KEY);
    progressStatus.readFailed = !r.ok && !!STORE;
    progressStatus.unreadable = r.unreadable === undefined ? null : r.unreadable;
    return r.progress;
  }
  function saveLearnProgress() {
    if (!TLS || !state.learnProgress) return;
    progressStatus.lastSave = TLS.saveProgress(STORE, PROGRESS_KEY, state.learnProgress, progressStatus);
  }
  const progressNote = () => (progressStatus.readFailed ? '<p class="note warn-note">Your lesson progress could not be read from browser storage, so it is not saved in this session. Reload the page to try again.</p>'
    : progressStatus.lastSave && !progressStatus.lastSave.saved ? '<p class="note warn-note">Lesson progress not saved: browser storage is unavailable.</p>' : '');
  /** Which example the model on screen is (unchanged), or ''. Used to show worked examples and to record exercises. */
  let exampleSerials = null;
  function exampleKeyOf(model) {
    if (!exampleSerials) exampleSerials = new Map(EXAMPLES.map(([k]) => [JSON.stringify(serialize(buildExample(k))), k]));
    return exampleSerials.get(JSON.stringify(serialize(model))) || '';
  }
  function recordExercise(id) {
    if (!state.learnProgress || state.learnProgress.exercises[id]) return;
    state.learnProgress.exercises[id] = true;
    saveLearnProgress();
  }
  /** Lessons on the Learn home: progress, and a "continue" entry. */
  function lessonsHomeHtml() {
    if (!TLS) return '';
    const p = state.learnProgress || TLS.emptyProgress();
    const cur = p.current ? TLS.lesson(p.current) : null;
    let h = `<div class="sub-h" style="margin:var(--sp-5) var(--sp-4) var(--sp-2)">Lessons <small>${p.completed.length} of ${TLS.LESSONS.length} complete</small></div><ul class="activity-list">`;
    if (cur && !p.completed.includes(cur.id)) h += `<li><button data-lesson="${cur.id}"><span class="a-icon">${ICON.cont}</span><span><span class="a-title">Continue: lesson ${cur.number}</span><span class="a-desc">${esc(cur.title)}</span></span><span class="a-meta">Open</span></button></li>`;
    h += TLS.LESSONS.map((l) => {
      const done = p.completed.includes(l.id);
      return `<li class="${done ? 'done' : ''}"><button data-lesson="${l.id}"><span class="a-icon">${ICON.lesson}</span><span><span class="a-title">${l.number}. ${esc(l.title)}</span><span class="a-desc">${esc(l.objectives[0])}</span></span><span class="a-meta">${done ? '✓ done' : ''}</span></button></li>`;
    }).join('');
    return h + '</ul>' + progressNote();
  }
  function lessonView() {
    const l = TLS && TLS.lesson(state.learn.lesson);
    if (!l) return learnHead('Lesson') + '<p class="panel-intro">This lesson is not available.</p>';
    const p = state.learnProgress || TLS.emptyProgress(), r = R(), onModel = exampleKeyOf(state.model) === l.model;
    const exLabel = (EXAMPLES.find((x) => x[0] === l.model) || ['', l.model])[1];
    const done = p.completed.includes(l.id);
    let h = learnHead(`Lesson ${l.number}: ${esc(l.title)}`, `${done ? '✓ Complete. ' : ''}Lesson ${l.number} of ${TLS.LESSONS.length}`) + '<div class="act-body">';
    h += `<div class="progress-dots" aria-label="Lessons">${TLS.LESSONS.map((x) => `<i class="${p.completed.includes(x.id) ? 'on' : ''}" title="Lesson ${x.number}${p.completed.includes(x.id) ? ': complete' : ''}"></i>`).join('')}</div>`;
    h += `<h3>You will learn to</h3><ul class="objectives">${l.objectives.map((o) => `<li>${mathHtml(o)}</li>`).join('')}</ul>`;
    h += `<p class="lesson-meta">Before this: ${l.prerequisites.map(esc).join(' ')}</p>`;
    h += `<p><b>${mathHtml(l.intro)}</b></p>`;
    h += `<h3>Explanation</h3>${l.explanation.map((t) => `<p>${mathHtml(t)}</p>`).join('')}`;
    h += `<h3>Equations</h3>${l.equations.map((e) => `<div class="equation">${mathHtml(e.eq)}</div><p class="note">${mathHtml(e.meaning)}</p>`).join('')}
      <table class="vars">${l.variables.map(([s, m, u]) => `<tr><td>${mathHtml(s)}</td><td>${mathHtml(m)}</td><td>${esc(u)}</td></tr>`).join('')}</table>`;
    h += '<h3>Worked example</h3>';
    if (!onModel) h += `<p>The worked example uses the example “${esc(exLabel)}”, so every number is the solver's own.</p><div class="btn-row"><button class="btn sm primary" data-lact="model">Open “${esc(exLabel)}”</button></div><p class="note">Your current model stays in the undo history (Ctrl+Z).</p>`;
    else {
      const w = l.worked(state.model, r);
      h += !w ? '<p class="note">No results to work with yet.</p>' : `<div class="calc"><ol>${w.map((it) => `<li><div class="step-math">${mathHtml(it.text)}${it.q ? `: <span class="v">${esc(it.q.kind === 'count' ? String(it.q.value) : qShow(it.q))}</span>` : ''}</div></li>`).join('')}</ol></div>`;
    }
    const act = l.interactive.activity;
    h += `<h3>Try it</h3><p>${mathHtml(l.interactive.text)}</p><div class="btn-row"><button class="btn sm" data-lact="activity">${act === 'inspector' ? 'Select M1 in Analyze' : act === 'build' ? 'Open the guided activity' : act === 'predict' ? 'Open the prediction activity' : act === 'fbd' ? 'Open the free-body diagram' : act === 'joints' ? 'Open the method of joints' : 'Open the Solver Explorer'}</button></div>`;
    h += `<h3>Practice</h3><p>${mathHtml(l.practice)}</p>`;
    h += '<h3>Check your understanding</h3>';
    l.check.forEach((item, k) => {
      const ans = state.learn.answers && state.learn.answers[`${l.id}:${k}`];
      h += `<div class="quiz"><div class="q">${k + 1}. ${mathHtml(item.q)}</div><div class="opts" role="group">${item.options.map((o, j) => `<button data-quiz="${k}" data-opt="${j}" class="${ans !== undefined && j === ans ? (j === item.answer ? 'right' : 'wrong') : ans !== undefined && j === item.answer && ans === item.answer ? 'right' : ''}" aria-pressed="${ans === j}">${mathHtml(o)}</button>`).join('')}</div>
        ${ans !== undefined ? `<p class="why">${ans === item.answer ? '<span class="verdict-ok">✓ Right.</span>' : '<span class="verdict-bad">✕ Not quite.</span>'} ${mathHtml(item.why)}</p>` : ''}</div>`;
    });
    h += `<h3>Summary</h3><div class="summary-box">${mathHtml(l.summary)}</div>`;
    h += `<h3>Common misconceptions</h3>${l.misconceptions.map(([wrong, right]) => `<div class="misconception"><b>Not quite:</b> ${mathHtml(wrong)}<br>${mathHtml(right)}</div>`).join('')}`;
    if (l.challenge) {
      const ev = state.learn.challengeResult && state.learn.challengeResult.id === l.challenge.id ? state.learn.challengeResult : null;
      h += `<h3>Challenge</h3><p>${mathHtml(l.challenge.text)}</p><div class="btn-row"><button class="btn sm primary" data-lact="challenge">Check my model</button>${p.challenges[l.challenge.id] ? '<span class="verdict-ok">✓ done before</span>' : ''}</div>`;
      if (ev) h += `<ul class="msg-list">${ev.criteria.map((c) => `<li class="${c.pass ? '' : 'e'}" style="list-style:none">${c.pass ? '✓' : '✕'} ${mathHtml(c.label)}</li>`).join('')}</ul>${ev.passed ? '<div class="summary-box">Challenge met: every criterion holds on your model.</div>' : ''}`;
      h += '<p class="note">Challenges are checked on objective criteria from your model and the solver. Written reasoning is not graded.</p>';
    }
    const next = TLS.LESSONS.find((x) => x.number === l.number + 1);
    h += `</div><div class="step-nav"><button class="btn sm ${done ? '' : 'primary'}" data-lact="complete" ${done ? 'disabled' : ''}>${done ? '✓ Complete' : 'Mark as complete'}</button>${next ? `<button class="btn sm" data-lesson="${next.id}">Lesson ${next.number} &#8594;</button>` : ''}</div>`;
    return h + progressNote();
  }
  function bindLesson(box) {
    const l = TLS && TLS.lesson(state.learn.lesson);
    if (!l) return;
    box.querySelectorAll('[data-quiz]').forEach((b) => b.addEventListener('click', () => {
      const k = +b.dataset.quiz, j = +b.dataset.opt;
      state.learn.answers = state.learn.answers || {};
      state.learn.answers[`${l.id}:${k}`] = j;
      if (TLS.checkAnswer(l, k, j).correct) recordExercise(`quiz:${l.id}:${k}`);
      renderLearn();
    }));
    box.querySelectorAll('[data-lact]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.lact;
      if (a === 'model') { pushUndo(); loadModel(buildExample(l.model), `Lesson ${l.number}: ${EXAMPLES.find((x) => x[0] === l.model)[1]}`); renderLearn(); }
      else if (a === 'activity') {
        const act = l.interactive.activity;
        if (act === 'inspector') { setWorkspace('analyze'); if (state.model.members[0]) selectOnly('member', state.model.members[0]); }
        else openLearnView(act);
      } else if (a === 'challenge') {
        const ev = TLS.evaluateChallenge(l, state.model, R(), state.learnProgress);
        state.learn.challengeResult = ev;
        if (ev && ev.passed && state.learnProgress && !state.learnProgress.challenges[ev.id]) { state.learnProgress.challenges[ev.id] = true; saveLearnProgress(); }
        renderLearn();
      } else if (a === 'complete') {
        const p = state.learnProgress;
        if (!p) return;
        if (!p.completed.includes(l.id)) p.completed.push(l.id);
        const next = TLS.LESSONS.find((x) => x.number === l.number + 1);
        p.current = next ? next.id : l.id;
        saveLearnProgress();
        toast(`Lesson ${l.number} complete`, 'ok');
        renderLearn();
      }
    }));
  }
  function openLesson(id) {
    state.learn.lesson = id;
    state.learn.challengeResult = null;
    if (state.learnProgress && state.learnProgress.current !== id) { state.learnProgress.current = id; saveLearnProgress(); }
    openLearnView('lesson');
  }
  LEARN_VIEWS.lesson = { render: lessonView, bind: bindLesson, live: true };

  function renderLearn() {
    const box = $('#paneLearn');
    if (!box) return;
    const v = LEARN_VIEWS[state.learn.view] ? state.learn.view : 'home';
    if (v !== state.learn.view) state.learn.view = v;
    box.innerHTML = v === 'home' ? learnHome() : LEARN_VIEWS[v].render();
    bindLearn(box);
    if (LEARN_VIEWS[v] && LEARN_VIEWS[v].bind) LEARN_VIEWS[v].bind(box);
  }
  /** After an edit or a solve: refresh the Learn panel if it follows the model, unless the learner is typing in it. */
  function refreshLearnLive() {
    if (state.s.workspace !== 'learn') return;
    const box = $('#paneLearn'), a = document.activeElement;
    if (box && a && box.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) return;
    const v = state.learn.view;
    if (v === 'home' || (LEARN_VIEWS[v] && LEARN_VIEWS[v].live)) renderLearn();
  }
  function openLearnView(v) {
    if (v === 'analyze') { setWorkspace('analyze'); return; }
    const leaving = LEARN_VIEWS[state.learn.view];
    if (leaving && leaving.leave && state.learn.view !== v) leaving.leave();
    state.learn.view = v;
    const entering = LEARN_VIEWS[v];
    if (entering && entering.enter) entering.enter();
    renderLearn();
    const box = $('#paneLearn');
    if (box) box.scrollTop = 0;
    requestRender();
  }
  function bindLearn(box) {
    box.querySelectorAll('[data-learn]').forEach((b) => b.addEventListener('click', () => openLearnView(b.dataset.learn)));
    box.querySelectorAll('[data-lesson]').forEach((b) => b.addEventListener('click', () => openLesson(b.dataset.lesson)));
    box.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => {
      if (refuseViewOnlyExample()) return;
      pushUndo();
      loadModel(buildExample(b.dataset.example), `Opened the example: ${EXAMPLES.find((e) => e[0] === b.dataset.example)[1]}`);
      setWorkspace('analyze');
    }));
    box.querySelectorAll('[data-learn-act="empty"]').forEach((b) => b.addEventListener('click', () => {
      if (refuseViewOnly()) return;
      pushUndo();
      state.learn.buildStarted = true;
      loadModel(emptyModel(), 'New empty model: place three nodes');
      state.view = { cx: 2, cy: 1.5, zoom: 60 };
      updateZoomLabel();
      setTool('node');
      renderLearn();
    }));
  }
  /** Opening an example replaces the model, which phones may do (opening is viewing); it stays undoable. */
  const refuseViewOnlyExample = () => false;
  /** Canvas hooks that later milestones fill (prediction marks, the free-body joint). */
  function drawPredictionMarks(P) { if (typeof drawPredictionOverlay === 'function') drawPredictionOverlay(P); }
  function drawFbdHighlight(P) {
    if (typeof drawFbdOverlay === 'function') drawFbdOverlay(P);
    if (typeof drawExplorerOverlay === 'function') drawExplorerOverlay(P);
    if (typeof drawDesignOverlay === 'function') drawDesignOverlay(P);
  }
  /** Called whenever the selection changes, so a Learn activity can follow it. */
  function onSelectionChanged() {
    if (state.s.workspace === 'learn') {
      const v = LEARN_VIEWS[state.learn.view];
      if (v && v.onSelect) v.onSelect();
    }
  }

  /* =====================================================================
   * 20. Design workspace (milestones 6 and 10)
   * ===================================================================== */
  /** Structural mass Σ ρ·A·L from the materials' densities; a missing density is reported, never assumed. */
  function massSummary() {
    let mass = 0, missing = 0;
    const byGroup = new Map();
    for (const e of state.model.members) {
      const w = memberSelfWeight(e);
      if (w.density === null) { missing++; continue; }
      const m = w.density * w.A * w.L;
      mass += m;
      byGroup.set(e.group, (byGroup.get(e.group) || 0) + m);
    }
    return { mass, missing, byGroup };
  }

  /* ---------- milestone 10: checks over every state, the deflection criterion, section sizing ---------- */
  const TDS = window.TrussDesign || null;
  if (!state.design) state.design = { families: {}, which: 'auto', report: null, reportKey: '', maxIterations: 20 };
  const designWhich = () => (state.design.which === 'auto' ? undefined : state.design.which);
  const stateName = (st) => (st ? `${st.kind === 'combination' ? 'combination' : 'load case'} “${esc(st.name)}”` : '—');
  function renderDesignMilestone10() {
    if (!TDS) return '<p class="note warn-note">design.js did not load, so the design tools are unavailable.</p>';
    const M = state.model, target = state.s.targetSF;
    if (!M.members.length) return '<p class="panel-intro">Add members to check and size them.</p>';
    const states = TDS.designStates(M, designWhich());
    const which = state.design.which;
    let h = '';
    // 1. checks over every state
    const chk = TDS.checkDesign(M, { which: designWhich(), targetSF: target });
    const fails = chk.members.filter((x) => !x.pass).length;
    const statusCls = !chk.complete ? 'bad' : chk.pass ? 'ok' : 'bad';
    const statusTxt = !chk.complete ? `✕ ${chk.unsolved.length} of ${states.length} states cannot be solved (${chk.unsolved.map(stateName).join(', ')}): nothing can be said about every state.`
      : chk.pass ? `✓ Every member has SF ≥ ${fmt(target, 3)} in every state. Lowest: SF ${fmt(chk.governing.minSF, 3)} at M${chk.governing.member + 1} (${chk.governing.mode}), ${stateName(chk.governing.state)}.`
        : `✕ ${plural(fails, 'member')} below SF ${fmt(target, 3)}. Lowest: SF ${fmt(chk.governing.minSF, 3)} at M${chk.governing.member + 1} (${chk.governing.mode}), ${stateName(chk.governing.state)}.`;
    const low = chk.members.slice().sort((a, b) => a.minSF - b.minSF).slice(0, 8);
    h += `<details class="sec" open><summary>Strength and buckling<span class="sum-meta">${chk.complete ? (chk.pass ? '✓ all pass' : `✕ ${fails} below target`) : '✕ incomplete'}</span></summary><div class="sec-body">
      <div class="row"><label class="grow" for="dsWhich">Check against</label><select class="select" id="dsWhich">
        <option value="auto" ${which === 'auto' ? 'selected' : ''}>${M.combinations.length ? 'every combination' : 'every load case'} (default)</option>
        <option value="combinations" ${which === 'combinations' ? 'selected' : ''} ${M.combinations.length ? '' : 'disabled'}>every combination</option>
        <option value="cases" ${which === 'cases' ? 'selected' : ''}>every load case</option>
        <option value="active" ${which === 'active' ? 'selected' : ''}>only what is analysed</option></select></div>
      <p class="note">${plural(states.length, 'state')}, each solved directly with λ = 1 (factors belong in the combinations); the worst value per member is taken, never a sum. Target SF ${fmt(target, 3)} (Analyze, Analysis).</p>
      <div class="status-line ${statusCls}">${statusTxt}</div>
      ${chk.complete ? `<table class="size-table"><thead><tr><th class="l">Member</th><th>lowest SF</th><th class="l">mode</th><th class="l">in</th></tr></thead><tbody>${low.map((x) => `<tr><td class="l"><button class="btn quiet sm" data-dsel="${x.member}">M${x.member + 1}</button></td><td class="${x.pass ? '' : 'bad'}">${fmt(x.minSF, 3)}</td><td class="l">${x.mode}</td><td class="l">${esc(x.state ? x.state.name : '')}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="assume">Yield: SF = σ<sub>y</sub>/|σ|. Buckling: Euler, pin-ended (K = 1), weak-axis I: SF = P<sub>cr</sub>/|N|. An educational check: no resistance factors, imperfections or code rules.</p>
      </div></details>`;
    // 2. deflection
    const crit = TDS.criterion(M), dfl = TDS.checkDeflection(M, { which: designWhich() });
    const nodeOpts = (sel) => M.nodes.map((n, i) => `<option value="${i}" ${n === sel ? 'selected' : ''}>N${i + 1}</option>`).join('');
    // the draft holds node objects: after undo, redo or an open, the model has new ones, so rebuild it from the model
    const stale = (d) => !M.nodes.includes(d.a) || !M.nodes.includes(d.b) || d.nodes.some((n) => !M.nodes.includes(n));
    if (state.design.edit && stale(state.design.edit)) state.design.edit = null;
    const ed = state.design.edit || (state.design.edit = { a: crit ? crit.a : M.nodes[0], b: crit ? crit.b : M.nodes[M.nodes.length > 1 ? 1 : 0], nodes: crit ? crit.nodes.slice() : [], type: crit ? crit.limit.type : 'ratio', value: crit ? crit.limit.value : 300 });
    let dStatus;
    if (dfl.status === 'unconfigured') dStatus = '<div class="status-line idle">○ Not configured: no deflection limit is checked. TrussLab does not assume one.</div>';
    else if (dfl.status === 'invalid') dStatus = `<div class="status-line bad">✕ ${esc(dfl.reason)}</div>`;
    else if (dfl.status === 'incomplete') dStatus = `<div class="status-line bad">✕ ${dfl.unsolved.length} state(s) cannot be solved, so the deflection is not known in every state.</div>`;
    else dStatus = `<div class="status-line ${dfl.status === 'pass' ? 'ok' : 'bad'}">${dfl.status === 'pass' ? '✓' : '✕'} Largest δ = ${fD(dfl.governing.delta)} ${state.s.dispUnit} at N${dfl.governing.node + 1}, ${stateName(dfl.governing.state)}; allowed ${fD(dfl.allow)} ${state.s.dispUnit}${crit.limit.type === 'ratio' ? ` (span ${fmt(dfl.span, 4)} m / ${fmt(crit.limit.value, 4)})` : ''}.</div>`;
    h += `<details class="sec" ${crit ? 'open' : ''}><summary>Deflection<span class="sum-meta">${dfl.status === 'unconfigured' ? 'not set' : dfl.status === 'pass' ? '✓ pass' : '✕'}</span></summary><div class="sec-body">
      <p class="note">Deflection is measured against a <b>reference chord</b>: the line between two nodes you choose (for example the two supports). For each evaluation node, δ is its displacement across that line, relative to the line's own movement, so a support settlement that only moves or tilts the truss as a whole is not counted.</p>
      <fieldset class="edit"><div class="form-grid">
        <label for="dfA">Chord from</label><select class="select" id="dfA">${nodeOpts(ed.a)}</select>
        <label for="dfB">to</label><select class="select" id="dfB">${nodeOpts(ed.b)}</select>
        <label>Check nodes</label><div class="node-chips" role="group" aria-label="Evaluation nodes">${M.nodes.map((n, i) => `<button class="btn sm ${ed.nodes.includes(n) ? 'toggle on' : ''}" aria-pressed="${ed.nodes.includes(n)}" data-dfnode="${i}">N${i + 1}</button>`).join('')}</div>
        <label for="dfType">Limit</label><select class="select" id="dfType"><option value="ratio" ${ed.type === 'ratio' ? 'selected' : ''}>span / ratio</option><option value="absolute" ${ed.type === 'absolute' ? 'selected' : ''}>absolute (${state.s.dispUnit})</option></select>
        <label for="dfValue">${ed.type === 'ratio' ? 'Ratio' : 'Value'}</label><div class="inline"><input class="num" id="dfValue" value="${inVal(ed.type === 'ratio' ? ed.value : ed.value / dU())}"><span class="u">${ed.type === 'ratio' ? 'span/…' : state.s.dispUnit}</span></div>
      </div>
      <div class="btn-row"><button class="btn sm primary" id="dfSave">${crit ? 'Update the criterion' : 'Set the criterion'}</button>${crit ? '<button class="btn sm danger" id="dfClear">Remove</button>' : ''}</div></fieldset>
      <p class="note">The limit is yours to choose (for example span/300 for a roof member, or a value from your design code): TrussLab never imposes a universal limit.</p>
      ${dStatus}
      ${dfl.per ? `<details class="more"><summary>Every state</summary><table class="size-table"><thead><tr><th class="l">State</th><th class="l">node</th><th>δ [${state.s.dispUnit}]</th><th>total |u| [${state.s.dispUnit}]</th></tr></thead><tbody>${dfl.per.filter((x) => x.d).flatMap((x) => x.d.nodes.map((nd) => `<tr><td class="l">${esc(x.state.name)}</td><td class="l">N${nd.node + 1}</td><td class="${nd.pass ? '' : 'bad'}">${fD(nd.delta)}</td><td>${fD(nd.total)}</td></tr>`)).join('')}</tbody></table><p class="note">The total displacement includes rigid-body movement; δ does not.</p></details>` : ''}
      </div></details>`;
    // 3. section sizing
    const R0 = state.design.report && state.design.reportKey === predictKey() ? state.design.report : null;
    if (state.design.report && !R0) { state.design.report = null; }
    h += `<details class="sec" open><summary>Section sizing</summary><div class="sec-body">
      <p class="note">Fully stressed design: each sized group gets the lightest section of its family that passes yield and buckling (target SF ${fmt(target, 3)}) in every state; then the truss is analysed again, because self-weight and, in an indeterminate truss, the forces change with the sections. It stops when the choice repeats (converged), cycles, or reaches the iteration limit. ${crit ? 'If the deflection limit then fails, the group that contributes most to it per kilogram is stepped up, and strength is checked again.' : ''}</p>
      <table class="size-table"><thead><tr><th class="l">Group</th><th class="l">current</th><th class="l">family</th></tr></thead><tbody>${M.groups.map((g, i) => {
        const fam = state.design.families[i] !== undefined ? state.design.families[i] : TDS.defaultFamily(g);
        return `<tr><td class="l"><span class="swatch" style="background:${esc(g.color)}"></span>${esc(g.name)}</td><td class="l">${fmt(g.A / MM2, 4)} mm²</td><td class="l"><select class="select" data-dfam="${i}" aria-label="Family for ${esc(g.name)}"><option value="keep" ${fam === 'keep' ? 'selected' : ''}>keep</option>${TDS.FAMILIES.map((f) => `<option value="${f}" ${fam === f ? 'selected' : ''}>${esc(TDS.FAMILY_DEFS[f].label.split(' (')[0])}</option>`).join('')}</select></td></tr>`;
      }).join('')}</tbody></table>
      <div class="btn-row"><button class="btn primary sm" id="dsRun">Propose sections</button></div>
      ${R0 ? sizingReportHtml(R0) : ''}
      </div></details>`;
    return h;
  }
  function sizingReportHtml(r) {
    const fu = state.s.forceUnit;
    const st = {
      converged: ['ok', '✓ Converged: every sized group is stable from one iteration to the next, and the final analysis passes.'],
      cycle: ['bad', '✕ Not converged: the choice of sections came back to an earlier one (a cycle). No proposal is offered.'],
      'max-iterations': ['bad', `✕ Not converged within ${state.design.maxIterations} iterations. No proposal is offered.`],
      'no-candidate': ['bad', '✕ No candidate in the chosen family is large enough for at least one group.'],
      'deflection-not-met': ['bad', '✕ Strength and buckling can be met, but the deflection limit cannot: no proposal is acceptable.'],
      unstable: ['bad', '✕ The structure is unstable in at least one state: it cannot be sized.'],
      invalid: ['bad', '✕ The model cannot be analysed in at least one state.'],
      'nothing-to-size': ['idle', '○ Choose a family for at least one group.'],
      'no-states': ['idle', '○ There is nothing to check: add a load case.'],
    }[r.status] || ['bad', r.status];
    let h = `<div class="status-line ${r.acceptable ? 'ok' : st[0]}">${r.acceptable ? '✓ ' + st[1].slice(2) : st[1]}</div>`;
    if (!r.groups.length) return h;
    h += `<table class="size-table"><thead><tr><th class="l">Group</th><th class="l">proposed</th><th class="l">governed by</th></tr></thead><tbody>${r.groups.map((g) => `<tr><td class="l">${esc(g.name)}</td><td class="l"><b>${esc(g.to.label)}</b><br><span class="dim">A ${fmt(g.to.A / MM2, 4)} mm², I ${fmt(g.to.I / MM4, 3)} mm⁴</span></td><td class="l">${g.governs ? `M${g.governs.member + 1}, ${g.governs.mode}, ${esc(g.governs.state.name)} (N = ${fF(g.governs.N)} ${fu})` : '—'}</td></tr>`).join('')}</tbody></table>`;
    h += `<details class="explain" ${openIfGuided()}><summary>Why these sections</summary>${r.groups.map((g) => {
      const l = g.lighter;
      const why = !l ? 'It is the lightest section of the family.' : l.check === 'yield' ? `${esc(l.candidate)}, the next lighter one, fails yield at M${l.member + 1} in ${esc(l.state.name)}: it needs A ≥ ${fmt(l.required / MM2, 4)} mm² and has ${fmt(l.have / MM2, 4)} mm².`
        : l.check === 'buckling' ? `${esc(l.candidate)}, the next lighter one, would buckle at M${l.member + 1} in ${esc(l.state.name)}: it needs I ≥ ${fmt(l.required / MM4, 4)} mm⁴ (from P<sub>cr</sub> = π²EI/L², K = 1) and has ${fmt(l.have / MM4, 4)} mm⁴.`
          : l.check === 'no-inertia' ? `${esc(l.candidate)} has no second moment of area, so its buckling cannot be checked: it is not used for compression members.`
            : `${esc(l.candidate)} passes the strength checks, but it was stepped up to meet the deflection limit.`;
      return `<p><b>${esc(g.name)}: ${esc(g.to.label)}.</b> ${why}</p>`;
    }).join('')}</details>`;
    const mb = r.mass.before, ma = r.mass.after;
    h += `<dl class="kv"><dt>Mass now</dt><dd>${fmt(mb.mass, 5)} kg${mb.complete ? '' : ' <small>incomplete</small>'}</dd><dt>Mass proposed</dt><dd>${fmt(ma.mass, 5)} kg${ma.complete ? '' : ' <small>incomplete</small>'}</dd>
      <dt>Lowest SF</dt><dd>${r.check && r.check.governing ? `${fmt(r.check.governing.minSF, 3)} <small>M${r.check.governing.member + 1}, ${r.check.governing.mode}</small>` : '—'}</dd>
      <dt>Deflection</dt><dd>${r.deflection.status === 'unconfigured' ? '<small>not configured</small>' : r.deflection.governing ? `${fD(r.deflection.governing.delta)} ${state.s.dispUnit} <small>${r.deflection.status}</small>` : r.deflection.status}</dd></dl>`;
    if (!mb.complete || !ma.complete) h += '<p class="note warn-note">Some materials have no density: their members are left out of the mass, and candidates are ranked by area.</p>';
    h += `<details class="more"><summary>Iterations (${r.iterations.length})</summary><div class="iter-log">${r.iterations.map((it) => `${it.iteration}: ${it.selection.join(', ')} → ${it.next.join(', ')} (${fmt(it.mass, 4)} kg)`).join('<br>')}${r.notes.length ? '<br>' + r.notes.map(esc).join('<br>') : ''}</div></details>`;
    h += `<div class="btn-row"><button class="btn primary sm" id="dsApply" ${r.acceptable ? '' : 'disabled'} title="${r.acceptable ? 'Replace the sections of the sized groups (Ctrl+Z undoes it)' : 'Only an acceptable, converged proposal can be applied'}">Apply the proposal</button><button class="btn sm quiet" id="dsDiscard">Discard</button></div>`;
    return h;
  }
  function bindDesignMilestone10(box) {
    if (!TDS) return;
    const M = state.model;
    const on = (id, ev, fn) => { const el = box.querySelector('#' + id); if (el) el.addEventListener(ev, fn); };
    on('dsWhich', 'change', (e) => { state.design.which = e.target.value; state.design.report = null; renderDesignTools(); });
    box.querySelectorAll('[data-dsel]').forEach((b) => b.addEventListener('click', () => selectOnly('member', M.members[+b.dataset.dsel])));
    const ed = state.design.edit;
    on('dfA', 'change', (e) => { ed.a = M.nodes[+e.target.value]; });
    on('dfB', 'change', (e) => { ed.b = M.nodes[+e.target.value]; });
    on('dfType', 'change', (e) => { ed.type = e.target.value; ed.value = ed.type === 'ratio' ? 300 : 0.01; renderDesignTools(); });
    on('dfValue', 'change', (e) => { const v = evalNum(e.target.value); if (Number.isFinite(v) && v > 0) ed.value = ed.type === 'ratio' ? v : v * dU(); else { e.target.classList.add('invalid'); toast('The limit must be a positive number', 'bad'); } });
    box.querySelectorAll('[data-dfnode]').forEach((b) => b.addEventListener('click', () => {
      const n = M.nodes[+b.dataset.dfnode], i = ed.nodes.indexOf(n);
      if (i >= 0) ed.nodes.splice(i, 1); else ed.nodes.push(n);
      renderDesignTools(); requestRender();
    }));
    on('dfSave', 'click', () => {
      if (refuseViewOnly()) return;
      if (!ed.nodes.length) { toast('Choose at least one node to check', 'warn'); return; }
      pushUndo();
      if (!setDeflectionCriterion(M, { a: ed.a, b: ed.b, nodes: ed.nodes, limit: { type: ed.type, value: ed.value } })) {
        history.undo.pop(); updateUndoButtons();
        toast('The chord needs two different nodes, and the limit a positive value', 'bad'); return;
      }
      modelChanged({ keepInspector: true }); toast('Deflection criterion set (Ctrl+Z undoes it)', 'ok');
    });
    on('dfClear', 'click', () => { if (refuseViewOnly()) return; pushUndo(); setDeflectionCriterion(M, null); state.design.edit = null; modelChanged({ keepInspector: true }); toast('Deflection criterion removed (Ctrl+Z undoes it)'); });
    box.querySelectorAll('[data-dfam]').forEach((s) => s.addEventListener('change', () => { state.design.families[+s.dataset.dfam] = s.value; state.design.report = null; renderDesignTools(); }));
    on('dsRun', 'click', () => {
      const fams = {};
      M.groups.forEach((g, i) => { fams[i] = state.design.families[i] !== undefined ? state.design.families[i] : TDS.defaultFamily(g); });
      state.design.report = TDS.sizeSections(M, { families: fams, targetSF: state.s.targetSF, which: designWhich(), maxIterations: state.design.maxIterations });
      state.design.reportKey = predictKey();
      renderDesignTools(); requestRender();
    });
    on('dsDiscard', 'click', () => { state.design.report = null; renderDesignTools(); requestRender(); });
    on('dsApply', 'click', () => {
      const r = state.design.report;
      if (refuseViewOnly() || !r || !r.acceptable) return;
      pushUndo();
      for (const g of r.groups) {
        const grp = M.groups[g.group];
        TDS.applyCandidate(grp, g.to);
        grp.name = `${grp.name.includes(':') ? grp.name.split(':')[0] : grp.name}: ${g.to.label}`.slice(0, 80);
      }
      state.design.report = null;
      modelChanged({ groups: true });
      toast(`Applied the proposed sections to ${plural(r.groups.length, 'group')} (Ctrl+Z undoes it)`, 'ok');
    });
  }
  /** The deflection criterion on the canvas (Design workspace): the reference chord dashed, the checked nodes boxed. */
  function drawDesignOverlay(P) {
    if (state.s.workspace !== 'design' || !TDS) return;
    const c = TDS.criterion(state.model), ed = state.design.edit;
    if (!c && !(ed && ed.nodes.length)) return; // nothing set, and no draft being chosen
    const a = c ? c.a : ed.a, b = c ? c.b : ed.b, nodes = ed ? ed.nodes : c.nodes;
    if (!a || !b || !P.has(a) || !P.has(b)) return;
    const pa = P.get(a), pb = P.get(b);
    ctx.save();
    ctx.setLineDash([8, 5]); ctx.strokeStyle = COL.accent2; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `12px ${SANS}`; tag('reference chord', (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2 + 16, 'center', 'top', COL.accent2);
    for (const n of nodes) { if (!P.has(n)) continue; const [x, y] = P.get(n); ctx.strokeStyle = COL.accent2; ctx.lineWidth = 1.6; ctx.strokeRect(x - 9, y - 9, 18, 18); }
    ctx.restore();
  }

  /** After an edit or a solve: refresh the Design panel unless the user is typing in it. */
  function refreshDesignLive() {
    const box = $('#designTools'), a = document.activeElement;
    if (box && a && box.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
    renderDesignTools();
  }
  function renderDesignTools() {
    const box = $('#designTools');
    if (!box) return;
    const ms = massSummary();
    let h = `<details class="sec" open><summary>Structure<span class="sum-meta">${fmt(ms.mass, 4)} kg</span></summary><div class="sec-body">
      <dl class="kv"><dt>Mass Σ ρ·A·L</dt><dd>${fmt(ms.mass, 5)} kg</dd>
      ${state.model.groups.map((g) => `<dt><span class="swatch" style="background:${esc(g.color)}"></span>${esc(g.name)}</dt><dd>${fmt(ms.byGroup.get(g) || 0, 4)} kg</dd>`).join('')}</dl>
      ${ms.missing ? `<p class="note warn-note">${plural(ms.missing, 'member')} ${ms.missing > 1 ? 'have' : 'has'} a material without density, so ${ms.missing > 1 ? 'they are' : 'it is'} not in this mass. Enter the density ρ under Materials.</p>` : ''}
      </div></details>`;
    if (typeof renderDesignMilestone10 === 'function') h += renderDesignMilestone10();
    box.innerHTML = h;
    box.querySelectorAll('fieldset.edit').forEach((f) => { f.disabled = isViewOnly(); });
    if (typeof bindDesignMilestone10 === 'function') bindDesignMilestone10(box);
  }

  init();

  // Older test hook, kept unchanged for compatibility. It exposes live internal state;
  // new tests use window.TrussLabTest (section 17) instead.
  window.TrussLab = { state, solve, buildExample, loadModel, serialize, deserialize, parseExpr, sectionProps };

  if (SMOKE) {
    window.TrussLabTest = createTestAdapter();
    const s = document.createElement('script');
    s.src = 'test/browser-smoke.js';
    s.onerror = () => toast('Smoke test: test/browser-smoke.js could not be loaded', 'bad');
    document.body.appendChild(s);
  }
})();
