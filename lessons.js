/*!
 * lessons.js - the TrussLab curriculum (global TrussLessons), milestone 11. DOM-free.
 *
 * Every lesson has the same parts: title, objectives, prerequisites, introduction, explanation,
 * equations, variables, a worked example, an interactive model or activity, practice, an understanding
 * check, a summary and common misconceptions; most end with a challenge. Worked examples are functions
 * of the real model and the solver's result (never fabricated numbers): they return quantities in SI
 * units that the page formats. Challenges are judged on objective criteria from the model and the
 * solver (stability, strength, buckling, restraints, mass, deflection); written reasoning is never graded.
 *
 * Lesson progress is stored apart from the model, under its own key, with the storage object passed in.
 * It runs in browsers (global TrussLessons), Node.js and JavaScriptCore, after fea-core.js, model.js,
 * education.js and design.js.
 */
(function (root, factory) {
  'use strict';
  const req = (name, file) => root[name] || (typeof require === 'function' ? require(file) : undefined);
  const FEA = req('FEA', './fea-core.js'), TM = req('TrussModel', './model.js'), TE = req('TrussEducation', './education.js'), TD = req('TrussDesign', './design.js');
  if (!FEA || !TM || !TE || !TD) throw new Error('lessons.js needs fea-core.js, model.js, education.js and design.js: load them first.');
  const api = factory(FEA, TM, TE, TD);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrussLessons = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FEA, TM, TE, TD) {
  'use strict';
  const q = (sym, name, value, kind) => ({ sym, name, value, kind });
  const restraintCount = (m) => m.nodes.reduce((t, n) => { const r = TM.supportRestraint(n.support); return t + (r.fixX ? 1 : 0) + (r.fixY ? 1 : 0); }, 0);
  const node = (m, x, y) => m.nodes.findIndex((n) => Math.abs(n.x - x) < 1e-9 && Math.abs(n.y - y) < 1e-9);

  /* =====================================================================
   * The lessons
   * ===================================================================== */
  const LESSONS = [
    {
      id: 'trusses', number: 1, title: 'Understanding trusses',
      objectives: ['Name the parts of a truss: nodes (joints), members, supports and loads.', 'Explain why trusses are built from triangles.', 'State the assumptions of an ideal pin-jointed truss, and use the count m + r − 2j.'],
      prerequisites: ['None: this is the starting point.'],
      intro: 'A truss is a frame of straight members joined at their ends. Bridges, roofs, cranes and towers use trusses because they carry large loads with little material.',
      explanation: [
        'The joints are called nodes. In an ideal truss every joint is a frictionless pin, so a member cannot pass a bending moment from one joint to the next. Loads are applied only at the nodes.',
        'With pins at both ends and loads only at the nodes, a member can only be pulled or pushed along its own line. That force is its axial force. It is the only force a truss member carries.',
        'A triangle of three members cannot change shape unless one of its members changes length. A rectangle of four members can fold into a parallelogram without any member stretching. That is why trusses are made of triangles.',
        'Counting helps: with m members, r restraints from the supports and j joints, m + r − 2j < 0 means too few members or restraints (the truss can move), 0 means just enough if they are well placed, and > 0 means more than needed (statically indeterminate). The count is necessary, not sufficient: badly placed members can still leave a mechanism.',
      ],
      equations: [{ eq: 'm + r − 2j', meaning: 'the Maxwell count: each joint gives two equilibrium equations (x and y); members and restraints are the unknown forces' }],
      variables: [['m', 'number of members', ''], ['r', 'number of restraints (a pin gives 2, a roller 1)', ''], ['j', 'number of joints', '']],
      model: 'warren',
      worked(m, r) {
        if (!r || !r.determinacy) return null;
        const d = r.determinacy;
        return [
          { text: 'The Warren truss has m members', q: q('m', 'members', d.m, 'count') },
          { text: 'its supports give r restraints (a pin and a roller)', q: q('r', 'restraints', d.r, 'count') },
          { text: 'and it has j joints', q: q('j', 'joints', d.j, 'count') },
          { text: `so m + r − 2j = ${d.m} + ${d.r} − 2 × ${d.j}`, q: q('m + r − 2j', 'count', d.degree, 'count') },
          { text: d.degree === 0 && r.ok ? 'Zero, and the solver confirms the truss is stable: it is statically determinate.' : r.ok ? 'The solver confirms the truss is stable.' : 'The solver finds a mechanism.' },
        ];
      },
      interactive: { activity: 'build', text: 'Build a triangle yourself, step by step, in the guided activity.' },
      practice: 'Open the Warren truss, select a member, and read its axial force in the Inspector. Is it the only force the member carries?',
      check: [
        { q: 'Why are trusses made of triangles?', options: ['Triangles look stronger', 'A triangle cannot change shape unless a member changes length', 'Triangles use the most material'], answer: 1, why: 'A triangle of pin-jointed members is rigid; a square can fold into a parallelogram with no member changing length.' },
        { q: 'In an ideal truss, where do loads act?', options: ['Anywhere along a member', 'Only at the nodes', 'Only at the supports'], answer: 1, why: 'Loads act at the nodes. Then each member, pinned at both ends, carries only an axial force.' },
        { q: 'A truss has m = 5, r = 3 and j = 4. What is m + r − 2j?', options: ['0', '1', '−1'], answer: 0, why: '5 + 3 − 2 × 4 = 0: just enough members and restraints, if they are well placed.' },
      ],
      summary: 'A truss is a triangulated frame of pin-jointed members loaded at its nodes, so each member carries one axial force. m + r − 2j is a first check of whether there are enough members and restraints.',
      misconceptions: [
        ['A truss member bends like a beam.', 'In the ideal pin-jointed truss no member bends: it is only pulled or pushed along its axis.'],
        ['m + r − 2j = 0 guarantees a stable truss.', 'It is necessary but not sufficient: members can be arranged so that a part still moves. The solver checks the real stiffness matrix.'],
      ],
      challenge: { id: 'stable-truss', text: 'Build your own stable, loaded truss with at least 3 members (for example with the guided activity), then check it here.',
        criteria: [{ id: 'members', label: 'at least 3 members', test: (m) => m.members.length >= 3 }, { id: 'stable', label: 'stable (the solver finds no mechanism)', test: (m, r) => !!(r && r.ok) }, { id: 'loaded', label: 'loaded at a node', test: (m) => m.nodes.some((n) => { const L = TM.nodeLoad(m, n); return L.fx !== 0 || L.fy !== 0; }) }] },
    },
    {
      id: 'axial', number: 2, title: 'Tension and compression',
      objectives: ['Tell tension from compression, and give their sign convention.', 'Recognise zero-force members, and explain them by joint equilibrium.', 'Predict member forces before reading the solver.'],
      prerequisites: ['Lesson 1: Understanding trusses.'],
      intro: 'Every member of a loaded truss is pulled, pushed, or not loaded at all. Knowing which is the first step in reading any truss.',
      explanation: [
        'A member in tension is stretched: it gets longer and pulls on the joints at its ends. A member in compression is squeezed: it gets shorter and pushes on its joints.',
        'TrussLab, like most engineering software, gives tension a positive axial force (N > 0) and compression a negative one (N < 0). On the canvas tension is blue with a plus sign and compression orange with a minus sign; a member carrying nothing is dashed.',
        'Some members carry no force under a given load: zero-force members. At a joint with no load and no support where only two members meet at an angle, both must be zero: neither could be balanced by the other. Where three members meet and two are in line, the third must be zero. Zero-force members still matter: they brace the truss and carry force under other loads.',
        'In a bridge truss under gravity loads, the top chord is usually squeezed and the bottom chord stretched, like the top and bottom of a bent ruler. The diagonals depend on which way they lean.',
      ],
      equations: [{ eq: 'N > 0: tension,  N < 0: compression,  N = 0: zero force', meaning: 'the sign convention of the axial force' }],
      variables: [['N', 'axial force of a member', 'kN']],
      model: 'pratt',
      worked(m, r) {
        if (!r || !r.ok) return null;
        const c = r.summary.counts, z = r.members.findIndex((x) => x.state === 'zero');
        const top = r.members.findIndex((x) => x.state === 'compression'), bot = r.members.findIndex((x) => x.state === 'tension');
        const rule = z >= 0 ? TE.zeroForceRule(m, r, z) : null;
        const out = [
          { text: `In the Pratt truss, ${c.tension} members are in tension, ${c.compression} in compression and ${c.zero} carry no force.` },
          { text: `For example M${bot + 1} is stretched`, q: q(`N (M${bot + 1})`, 'axial force', r.members[bot].force, 'force') },
          { text: `and M${top + 1} is squeezed`, q: q(`N (M${top + 1})`, 'axial force', r.members[top].force, 'force') },
        ];
        if (z >= 0) out.push({ text: `M${z + 1} carries no force${rule ? `: at N${rule.node + 1} three members meet, two of them in line, and nothing else acts there` : ''}.` });
        return out;
      },
      interactive: { activity: 'predict', text: 'Predict every member of the Pratt truss, then check your answers against the solver.' },
      practice: 'Before you check, find the member that carries nothing. Then check which members you got wrong, and read why.',
      check: [
        { q: 'The solver gives N = −45 kN for a member. What is it doing?', options: ['It is stretched (tension)', 'It is squeezed (compression)', 'It carries nothing'], answer: 1, why: 'A negative axial force is compression: the member shortens and pushes on its joints.' },
        { q: 'At an unloaded, unsupported joint, two members meet at 90°. What are their forces?', options: ['Equal and opposite', 'Both zero', 'Impossible to know'], answer: 1, why: 'Each member can only push or pull along its own line; at 90° neither can balance the other, so both are zero.' },
        { q: 'Is a zero-force member useless?', options: ['Yes, it can be removed', 'No: it braces the truss and carries force under other loads'], answer: 1, why: 'Removing it can make the truss a mechanism, or overload it under another load case.' },
      ],
      summary: 'Tension (N > 0) stretches a member and pulls on its joints; compression (N < 0) squeezes it and pushes. Zero-force members follow from joint equilibrium and still brace the truss.',
      misconceptions: [
        ['Force flows through the truss from member to member, one after another.', 'Equilibrium is simultaneous: every joint is balanced at once. There is no sequence, and in an indeterminate truss no single path.'],
        ['A zero-force member can always be removed.', 'It may brace a compression member against buckling, keep the truss stable, or carry load in another case.'],
      ],
      challenge: { id: 'predict-all', text: 'In the prediction activity, get every member of the Pratt truss right (you may try again as often as you like).',
        criteria: [{ id: 'predicted', label: 'all Pratt members predicted correctly', test: (m, r, p) => !!(p && p.exercises && p.exercises['predict:pratt']) }] },
    },
    {
      id: 'supports', number: 3, title: 'Supports and reactions',
      objectives: ['Describe pins, rollers and custom restraints by the degrees of freedom they fix.', 'Explain what a reaction is and why it occurs.', 'Check the reactions with the equilibrium of the whole truss.'],
      prerequisites: ['Lesson 1: Understanding trusses.'],
      intro: 'A truss rests on supports. The supports stop it from moving, and to do so they push or pull on it: those forces are the reactions.',
      explanation: [
        'In 2D a joint can move in two directions, x and y: two degrees of freedom. A pin fixes both. A roller fixes only the direction across its rolling surface, so it can only push across that surface. A custom support fixes x′ and/or y′ of a frame turned by an angle α.',
        'A reaction appears in each fixed direction. It is exactly the force needed to keep that degree of freedom where it is. In the solver, R = K·u − F at the restrained degrees of freedom.',
        'The whole truss is in equilibrium: ΣF_x = 0, ΣF_y = 0 and ΣM = 0 about any point. These three equations give the reactions of a determinate truss by hand, before any member force is known.',
        'Three well-placed restraints are enough to hold a 2D truss: a pin and a roller is the classic choice. Fewer, or three that all point through one point or are all parallel, leave it free to move.',
      ],
      equations: [{ eq: 'ΣF_x = 0,  ΣF_y = 0,  ΣM = 0', meaning: 'equilibrium of the whole truss: the reactions balance the loads' }, { eq: 'R = K·u − F', meaning: 'how the solver computes the reactions at the restrained degrees of freedom' }],
      variables: [['R_x, R_y', 'reaction components at a support', 'kN'], ['F', 'applied loads', 'kN']],
      model: 'aframe',
      worked(m, r) {
        if (!r || !r.ok) return null;
        const a = node(m, 0, 0), b = node(m, 6, 0);
        const sumRy = r.nodes.reduce((t, n) => t + n.ry, 0), sumFy = Array.from({ length: m.nodes.length }, (_, i) => r.F[2 * i + 1]).reduce((t, v) => t + v, 0);
        return [
          { text: 'The A-frame carries a load at its apex. The total applied load in y is', q: q('ΣF_y', 'applied loads', sumFy, 'force') },
          { text: 'The left pin pushes up with', q: q('R_y (N1)', 'reaction', r.nodes[a].ry, 'force') },
          { text: 'and the right pin with', q: q('R_y (N2)', 'reaction', r.nodes[b].ry, 'force') },
          { text: 'Together they balance the load: ΣR_y + ΣF_y =', q: q('ΣF_y total', 'residual', sumRy + sumFy, 'force') },
          { text: 'The pins also push inward and outward along x: the left pin', q: q('R_x (N1)', 'reaction', r.nodes[a].rx, 'force') },
        ];
      },
      interactive: { activity: 'fbd', text: 'Open the free-body diagram of a support node: see the reaction balance the member forces.' },
      practice: 'Change the right pin of the A-frame to a roller (Analyze, support tool S, Roller u_y = 0). The solver now reports a mechanism. Why? (Hint: what stops the two bars from spreading apart?)',
      check: [
        { q: 'How many restraints does a roller give?', options: ['0', '1', '2'], answer: 1, why: 'A roller fixes one direction: across its rolling surface.' },
        { q: 'Why does a reaction occur?', options: ['Supports are always loaded', 'To keep a fixed degree of freedom from moving, the support must push or pull', 'Because of gravity only'], answer: 1, why: 'The reaction is the force the support needs to apply so that the restrained direction does not move.' },
        { q: 'A truss has only two rollers, both rolling horizontally. Is it stable?', options: ['Yes', 'No: nothing stops it sliding along x'], answer: 1, why: 'Both rollers only resist vertical movement, so the whole truss can slide horizontally: a mechanism.' },
      ],
      summary: 'Each support fixes one or two degrees of freedom, and supplies a reaction in each. The reactions balance the loads: ΣF_x = ΣF_y = ΣM = 0 for the whole truss.',
      misconceptions: [
        ['More supports always make a truss safer.', 'Extra restraints make it indeterminate: forces then depend on stiffness, and settlements or temperature can load it.'],
        ['A roller can pull as well as push across its surface.', 'In TrussLab, as in most analysis, a restraint works both ways. A real roller may lift off if pulled: check the sign of the reaction.'],
      ],
      challenge: { id: 'three-restraints', text: 'Put a roller under the right foot of the A-frame instead of the pin: on its own it is a mechanism, because nothing stops the bars spreading apart. Add one member so that the frame is stable with exactly three restraints.',
        criteria: [{ id: 'three', label: 'exactly 3 restraints (a pin and a roller)', test: (m) => restraintCount(m) === 3 }, { id: 'members', label: 'the A-frame with one added member (3 members, 3 nodes)', test: (m) => m.members.length === 3 && m.nodes.length === 3 }, { id: 'stable', label: 'stable', test: (m, r) => !!(r && r.ok) }] },
    },
    {
      id: 'stress', number: 4, title: 'Stress, strain and deformation',
      objectives: ['Compute a member\'s change of length from its end displacements.', 'Use Hooke\'s law: N = (E·A/L)·δ, σ = N/A, ε = δ/L.', 'Explain how E, A and L make a member stiff or soft.'],
      prerequisites: ['Lesson 2: Tension and compression.'],
      intro: 'Forces change the length of members a little. How much depends on the material, the size of the section and the length: that is what links forces to displacements.',
      explanation: [
        'Stress σ is force per area: σ = N/A, in pascals (N/m²), usually given in MPa. It tells how hard the material works, whatever the size of the member.',
        'Strain ε is the change of length per length: ε = δ/L. It has no unit. A strain of 0.001 means a 1 m member got 1 mm longer.',
        'For an elastic material, stress and strain are proportional: σ = E·ε (Hooke\'s law). E is Young\'s modulus: about 200 GPa for steel, 69 GPa for aluminium, about 11 GPa for timber along the grain.',
        'Putting these together: N = (E·A/L)·δ. A member behaves like a spring of stiffness k = E·A/L. A larger area or a stiffer material makes it stiffer; a longer member is softer.',
        'The change of length comes from the displacements of the two ends: only the part of their relative movement along the member counts, δ = c·(u_xj − u_xi) + s·(u_yj − u_yi).',
      ],
      equations: [{ eq: 'σ = N/A', meaning: 'stress' }, { eq: 'ε = δ/L', meaning: 'strain' }, { eq: 'σ = E·ε', meaning: 'Hooke\'s law' }, { eq: 'N = (E·A/L)·δ', meaning: 'the member as a spring' }],
      variables: [['σ', 'axial stress', 'MPa'], ['ε', 'axial strain', '—'], ['E', "Young's modulus", 'GPa'], ['A', 'cross-sectional area', 'mm²'], ['L', 'length', 'm'], ['δ', 'change of length', 'mm']],
      model: 'aframe',
      worked(m, r) {
        if (!r || !r.ok) return null;
        const c = TE.memberCalc(m, r, 0), s = (id) => c.steps.find((x) => x.id === id).result;
        return [
          { text: 'M1 of the A-frame changes length by', q: s('deformation') },
          { text: 'With E·A/L of the bar, its axial force is', q: s('force') },
          { text: 'Dividing by its area gives the stress', q: s('stress') },
          { text: 'and dividing δ by its length, the strain', q: s('strain') },
          { text: 'Check Hooke\'s law: E·ε equals σ (the solver computes σ this way).' },
        ];
      },
      interactive: { activity: 'inspector', text: 'In Analyze, select a member: the Inspector shows this calculation step by step for it.' },
      practice: 'Double the area of the A-frame bars (Design, Sections). Predict first: what happens to N, σ and δ?',
      check: [
        { q: 'You double the area A of every member of a determinate truss. What happens to the member forces N?', options: ['They double', 'They halve', 'They stay the same'], answer: 2, why: 'In a determinate truss the forces follow from equilibrium alone. The stresses halve, and so do the changes of length.' },
        { q: 'A 2 m steel bar (E = 200 GPa) is stretched by 1 mm. What is its strain?', options: ['0.0005', '0.002', '0.5'], answer: 0, why: 'ε = δ/L = 0.001 m / 2 m = 0.0005.' },
        { q: 'What is the stress in that bar?', options: ['100 MPa', '200 MPa', '400 MPa'], answer: 0, why: 'σ = E·ε = 200 000 MPa × 0.0005 = 100 MPa.' },
      ],
      summary: 'σ = N/A, ε = δ/L, σ = E·ε, so N = (E·A/L)·δ: each member is an axial spring. The change of length comes from the end displacements along the member.',
      misconceptions: [
        ['A bigger section always lowers the forces.', 'In a determinate truss forces depend only on geometry and loads; a bigger section lowers the stress, not the force. In an indeterminate truss stiffer members attract more force.'],
        ['Stress and force are the same thing.', 'Stress is force per area. Two members with the same force can have very different stresses.'],
      ],
      challenge: { id: 'stress-limit', text: 'Change the section of the A-frame bars (Design, Sections) so that the stress in every bar is at most 50 MPa, keeping the 100 kN load.',
        criteria: [{ id: 'aframe', label: 'the A-frame (3 nodes, 2 members)', test: (m) => m.nodes.length === 3 && m.members.length === 2 }, { id: 'stable', label: 'stable', test: (m, r) => !!(r && r.ok) },
          { id: 'sigma', label: 'every |σ| ≤ 50 MPa', test: (m, r) => !!(r && r.ok && r.members.every((x) => Math.abs(x.stress) <= 50e6 * (1 + 1e-12))) },
          { id: 'load', label: 'still loaded with 100 kN', test: (m) => Math.abs(m.nodes.reduce((t, n) => t + Math.hypot(TM.nodeLoad(m, n).fx, TM.nodeLoad(m, n).fy), 0) - 100e3) < 1e-6 }] },
    },
    {
      id: 'stability', number: 5, title: 'Stability and buckling',
      objectives: ['Recognise a mechanism, and explain why it has no solution.', 'Compute the Euler buckling load of a pin-ended member: P_cr = π²EI/L².', 'Explain what slenderness means, and the limits of the ideal Euler model.'],
      prerequisites: ['Lesson 3: Supports and reactions.', 'Lesson 4: Stress, strain and deformation.'],
      intro: 'A truss can fail in two ways that have nothing to do with the strength of its material: it can be a mechanism, or a slender member can buckle.',
      explanation: [
        'A mechanism is a truss that can move without any member changing length, like the square that folds into a parallelogram. Its stiffness matrix is singular: K_ff·u_f = b_f has no unique solution. The solver detects this before solving (a rank test) and shows the mode shape instead of numbers.',
        'A compression member can buckle: bow sideways and lose its load capacity, at a force far below what would crush the material. For an ideal straight member with pinned ends, Euler found P_cr = π²·E·I/(K·L)² with K = 1.',
        'I is the second moment of area of the section, about its weak axis: it measures how the material is spread away from the centre. Buckling depends on I and on L², so a long member buckles much more easily: doubling L divides P_cr by four.',
        'Slenderness L/r, with r = √(I/A), compares length with section size. Stocky members (low L/r) yield before they buckle; slender ones buckle first. TrussLab checks both, and the smaller safety factor governs.',
        'Real members are never perfectly straight or perfectly pinned. Design codes reduce the buckling capacity well below Euler\'s value. TrussLab\'s check is the ideal value: an educational check, not a design-code one.',
      ],
      equations: [{ eq: 'P_cr = π²·E·I / (K·L)²,  K = 1', meaning: 'Euler buckling load of an ideal pin-ended member' }, { eq: 'SF_buckling = P_cr / |N|', meaning: 'safety against buckling, compression members only' }, { eq: 'L/r,  r = √(I/A)', meaning: 'slenderness' }],
      variables: [['P_cr', 'Euler critical load', 'kN'], ['E', "Young's modulus", 'GPa'], ['I', 'second moment of area, weak axis', 'mm⁴'], ['L', 'length', 'm'], ['K', 'effective-length factor: 1 for pinned ends', '—']],
      model: 'howe',
      worked(m, r) {
        if (!r || !r.ok) return null;
        let k = -1;
        r.members.forEach((x, i) => { if (x.state === 'compression' && (k < 0 || x.sfBuckling < r.members[k].sfBuckling)) k = i; });
        if (k < 0) return null;
        const c = TE.memberCalc(m, r, k), eu = c.checks.find((x) => x.id === 'euler'), bu = c.checks.find((x) => x.id === 'buckling');
        return [
          { text: `In the Howe truss the compression member closest to buckling is M${k + 1}. Its Euler load is`, q: eu.result },
          { text: 'It carries', q: q('N', 'axial force', r.members[k].force, 'force') },
          { text: 'so its safety factor against buckling is', q: bu.result },
          { text: 'Its slenderness is', q: q('L/r', 'slenderness', r.members[k].slenderness, 'ratio') },
        ];
      },
      interactive: { activity: 'explorer', text: 'Open the unstable panel (File, examples: "Unstable: panel without diagonal") in the Solver Explorer: at stage 9 the reduced matrix is singular.' },
      practice: 'Open the unstable panel. Watch its mode shape, then add one diagonal member so that it becomes stable.',
      check: [
        { q: 'A member\'s length doubles, everything else the same. Its Euler load…', options: ['halves', 'is divided by four', 'doubles'], answer: 1, why: 'P_cr is proportional to 1/L²: twice the length gives a quarter of the load.' },
        { q: 'Why does the solver show no numbers for a mechanism?', options: ['It is too slow', 'K_ff is singular: there is no unique solution', 'The loads are too large'], answer: 1, why: 'A mechanism can move without resistance, so the equations have no unique solution. Any number would be invented.' },
        { q: 'Which section resists buckling better, for the same area?', options: ['A solid rod', 'A tube of the same area', 'They are the same'], answer: 1, why: 'The tube spreads its material away from the centre, so its I is larger for the same A.' },
      ],
      summary: 'A mechanism moves without resistance: no solution exists. A slender compression member buckles at P_cr = π²EI/L² (ideal, pinned, K = 1), far below its crushing load. Real buckling capacity is lower than the ideal value.',
      misconceptions: [
        ['If the material is strong enough, a compression member is safe.', 'Slender members buckle long before the material yields: check both.'],
        ['Euler\'s load is the design capacity.', 'It is the ideal, upper value. Codes reduce it for imperfections and inelastic behaviour.'],
      ],
      challenge: { id: 'fix-mechanism', text: 'Open the example "Unstable: panel without diagonal" and make it stable by adding exactly one member.',
        criteria: [{ id: 'members', label: '13 members (the 12 of the example, plus one)', test: (m) => m.members.length === 13 }, { id: 'nodes', label: 'the 8 nodes of the example', test: (m) => m.nodes.length === 8 }, { id: 'stable', label: 'stable', test: (m, r) => !!(r && r.ok) }] },
    },
    {
      id: 'dsm', number: 6, title: 'The Direct Stiffness Method',
      objectives: ['Describe how the stiffness of every member is assembled into K.', 'Explain how supports reduce K to K_ff.', 'Follow the solver from K_ff·u_f = b_f back to member forces and reactions.'],
      prerequisites: ['Lesson 4: Stress, strain and deformation.'],
      intro: 'TrussLab solves every truss the same way, determinate or not: by the Direct Stiffness Method. This lesson follows it with real matrices.',
      explanation: [
        'Each member is a spring k = E·A/L along its axis. Written in global x and y with its direction cosines, it becomes a 4 × 4 element matrix kᵉ that links the forces at its two nodes to their displacements.',
        'The global stiffness matrix K has two rows and columns per node. Each member adds its kᵉ into the rows and columns of its nodes: this is assembly. Where members share a node, their contributions add up.',
        'Supports fix some displacements. Splitting the degrees of freedom into free (f) and restrained (s) leaves K_ff·u_f = F_f − K_fs·u_s: as many equations as unknown displacements.',
        'Solving gives the free displacements. From them, every member\'s change of length gives its force, and the rows of the restrained degrees of freedom give the reactions.',
      ],
      equations: [{ eq: 'kᵉ = (E·A/L)·[c² cs −c² −cs; cs s² −cs −s²; …]', meaning: 'element matrix in global axes' }, { eq: 'K_ff·u_f = F_f − K_fs·u_s', meaning: 'the reduced system' }],
      variables: [['K', 'global stiffness matrix', 'kN/m'], ['K_ff', 'free-free block', 'kN/m'], ['u_f', 'free displacements', 'mm'], ['F_f', 'loads at the free DOFs', 'kN']],
      model: 'aframe',
      worked(m, r) {
        if (!r || !r.ok) return null;
        const n = r.ndof, d = 2 * node(m, 3, 4);
        return [
          { text: 'The A-frame has 3 nodes, so K is 6 × 6. The apex is free; the two pins are fixed, so K_ff is 2 × 2.' },
          { text: 'Each bar adds (E·A/L)·c² to K at the apex x-x position; the two bars together give', q: q('K[3x, 3x]', 'assembled entry', r.K[d * n + d], 'stiffness') },
          { text: 'Solving K_ff·u_f = F_f gives the apex displacement', q: q('u_3y', 'vertical displacement', r.u[d + 1], 'disp') },
          { text: 'From it, each bar\'s change of length and force follow', q: q('N (M1)', 'axial force', r.members[0].force, 'force') },
        ];
      },
      interactive: { activity: 'explorer', text: 'Walk through all fourteen stages in the Solver Explorer with the A-frame.' },
      practice: 'In the Explorer, select an entry of K and see which members contribute to it.',
      check: [
        { q: 'Why can K not be solved before the supports are applied?', options: ['It is too large', 'It is singular: the truss could move as a rigid body', 'It is not symmetric'], answer: 1, why: 'Without supports nothing stops rigid-body motion, so K has no inverse.' },
        { q: 'Two members meet at a node. How do they enter K?', options: ['Only the stiffer one counts', 'Their contributions add up', 'They multiply'], answer: 1, why: 'Assembly adds each member\'s kᵉ into the rows and columns of its nodes.' },
      ],
      summary: 'Element matrices, assembled into K; supports partition it; K_ff·u_f = b_f gives the displacements; forces and reactions follow. The same method solves every truss.',
      misconceptions: [['The solver uses the method of joints.', 'It uses the Direct Stiffness Method, which also solves indeterminate trusses. The method of joints is a hand check that agrees with it.']],
      challenge: null,
    },
  ];

  /* =====================================================================
   * Challenges and quiz answers
   * ===================================================================== */
  /** Judges a challenge on the current model and its solver result: { passed, criteria: [{ id, label, pass }] }. */
  function evaluateChallenge(lesson, model, result, progress) {
    const ch = lesson.challenge;
    if (!ch) return null;
    const criteria = ch.criteria.map((c) => {
      let pass = false;
      try { pass = !!c.test(model, result, progress); } catch (e) { pass = false; }
      return { id: c.id, label: c.label, pass };
    });
    return { id: ch.id, passed: criteria.every((c) => c.pass), criteria };
  }
  /** Checks an answer to question k of a lesson's understanding check. */
  function checkAnswer(lesson, k, option) {
    const item = lesson.check[k];
    return item ? { correct: option === item.answer, why: item.why, answer: item.answer } : null;
  }

  /* =====================================================================
   * Lesson progress in browser storage (its own key, never the model's)
   *    A read that fails is never taken for "no progress": nothing is written until a later read succeeds.
   *    Unreadable stored text is copied to KEY.unreadable once, before it is replaced.
   * ===================================================================== */
  const PROGRESS_KEYS = Object.freeze({ user: 'trusslab.learn.v1', smoke: 'trusslab.smoke-test.learn.v1' });
  const emptyProgress = () => ({ version: 1, current: null, completed: [], exercises: {}, challenges: {} });
  function normalise(p) {
    const out = emptyProgress();
    if (!p || typeof p !== 'object') return out;
    const ids = new Set(LESSONS.map((l) => l.id));
    if (typeof p.current === 'string' && ids.has(p.current)) out.current = p.current;
    if (Array.isArray(p.completed)) out.completed = p.completed.filter((x, i, a) => ids.has(x) && a.indexOf(x) === i);
    if (p.exercises && typeof p.exercises === 'object') for (const [k, v] of Object.entries(p.exercises)) if (typeof k === 'string' && k.length <= 80 && v === true) out.exercises[k] = true;
    if (p.challenges && typeof p.challenges === 'object') for (const [k, v] of Object.entries(p.challenges)) if (typeof k === 'string' && k.length <= 80 && v === true) out.challenges[k] = true;
    return out;
  }
  /** Reads progress: { ok, progress, unreadable (text that is not valid progress), error }. */
  function loadProgress(storage, key) {
    if (!storage) return { ok: false, progress: emptyProgress(), error: 'no storage' };
    let raw;
    try { raw = storage.getItem(key); } catch (e) { return { ok: false, progress: emptyProgress(), error: e.message || String(e) }; }
    if (raw === null || raw === undefined) return { ok: true, progress: emptyProgress() };
    try {
      const p = JSON.parse(raw);
      if (!p || p.version !== 1) throw new Error('not lesson progress, version 1');
      return { ok: true, progress: normalise(p) };
    } catch (e) {
      return { ok: true, progress: emptyProgress(), unreadable: raw };
    }
  }
  /**
   * Writes progress. Refuses after a failed read (state.readFailed). Unreadable text found at start-up is
   * first copied to KEY.unreadable (unless that backup already exists). Returns { saved, error }.
   */
  function saveProgress(storage, key, progress, status) {
    const st = status || {};
    if (!storage) return { saved: false, error: 'no storage' };
    if (st.readFailed) return { saved: false, error: 'the stored progress could not be read' };
    try {
      if (st.unreadable !== undefined && st.unreadable !== null) {
        const bk = `${key}.unreadable`;
        if (storage.getItem(bk) === null) storage.setItem(bk, st.unreadable);
        st.unreadable = null;
      }
      const text = JSON.stringify(normalise(progress));
      storage.setItem(key, text);
      if (storage.getItem(key) !== text) return { saved: false, error: 'the stored progress did not read back' };
      return { saved: true };
    } catch (e) {
      return { saved: false, error: e.message || String(e) };
    }
  }

  return Object.freeze({
    LESSONS, lesson: (id) => LESSONS.find((l) => l.id === id) || null,
    evaluateChallenge, checkAnswer,
    PROGRESS_KEYS, emptyProgress, normaliseProgress: normalise, loadProgress, saveProgress,
  });
});
