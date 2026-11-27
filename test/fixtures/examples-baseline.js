/*
 * Results of the nine example structures as TrussLab computed them before milestone 2, captured from
 * commit 1a0b122 (before model.js existed) through the app's own path: buildExample, then the app's
 * solver input at load factor 1 and target safety factor 1.5, then FEA.analyze.
 *
 * Numbers are rounded to 12 significant figures (forces and reactions in N, displacements in m);
 * test/model.test.js compares with a relative tolerance. Node numbers in `supports` and `reactions`,
 * and the member number in `minSF`, are 1-based.
 *
 * This is a regression baseline. Never regenerate it to make a test pass. A deliberate change to an
 * example or to the analysis must update it in the same commit, with the reason in that commit.
 */
(function (root) {
  'use strict';
  const BASELINE = {
    pratt: {
      title: "Pratt truss: 6 panels × 3 m, h = 3 m, 60 kN panel loads",
      counts: { nodes: 12, members: 21, sections: 2, materials: 3 },
      supports: { 1: "pin", 7: "rollerX" },
      ok: true, maxwell: 0,
      force: [150000.0, 150000.0, 240000.0, 240000.0, 150000.0, 150000.0, -240000.0, -270000.0, -270000.0, -240000.0, -212132.034356, -212132.034356, 60000.0, -30000.0, 0.0, -30000.0, 60000.0, 127279.220614, 42426.4068712, 42426.4068712, 127279.220614],
      status: ["safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe"],
      ux: [0.0, 0.000852189671728, 0.00170437934346, 0.00306788281822, 0.00443138629298, 0.00528357596471, 0.00613576563644, 0.0059653277021, 0.00460182422733, 0.00306788281822, 0.00153394140911, 0.000170437934346],
      uy: [0.0, -0.00905858968114, -0.0155339555112, -0.0183751240742, -0.0155339555112, -0.00905858968114, 0.0, -0.00837568408504, -0.0158754083092, -0.0183751240742, -0.0158754083092, -0.00837568408504],
      reactions: { 1: [-1.28768854219e-10, 150000.0], 7: [0.0, 150000.0] },
      minSF: { value: 2.44468268327, member: 8, governs: "yield" },
    },
    howe: {
      title: "Howe truss: 6 panels × 3 m, h = 3 m, 50 kN panel loads",
      counts: { nodes: 12, members: 21, sections: 2, materials: 3 },
      supports: { 1: "pin", 7: "rollerX" },
      ok: true, maxwell: 0,
      force: [125000.0, 200000.0, 225000.0, 225000.0, 200000.0, 125000.0, -125000.0, -200000.0, -200000.0, -125000.0, -176776.695297, -176776.695297, 125000.0, 75000.0, 50000.0, 75000.0, 125000.0, -106066.017178, -35355.3390593, -35355.3390593, -106066.017178],
      status: ["safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe"],
      ux: [0.0, 0.000710158059773, 0.00184641095541, 0.003124695463, 0.00440297997059, 0.00553923286623, 0.006249390926, 0.00497110641841, 0.00426094835864, 0.003124695463, 0.00198844256737, 0.00127828450759],
      uy: [0.0, -0.00840245672941, -0.015221314913, -0.0178734993805, -0.015221314913, -0.00840245672941, 0.0, -0.00697973673753, -0.0143676829179, -0.0173044113838, -0.0143676829179, -0.00697973673753],
      reactions: { 1: [-3.61945543418e-10, 125000.0], 7: [0.0, 125000.0] },
      minSF: { value: 1.20319613109, member: 21, governs: "buckling" },
    },
    warren: {
      title: "Warren truss: equilateral, 5 × 4 m, 6061-T6 aluminum",
      counts: { nodes: 11, members: 19, sections: 2, materials: 3 },
      supports: { 1: "pin", 6: "rollerX" },
      ok: true, maxwell: 0,
      force: [46188.0215352, 115470.053838, 138564.064606, 115470.053838, 46188.0215352, -92376.0430703, -138564.064606, -138564.064606, -92376.0430703, -92376.0430703, 92376.0430703, -46188.0215352, 46188.0215352, -3.42846930562e-11, -1.82324595184e-11, 46188.0215352, -46188.0215352, 92376.0430703, -92376.0430703],
      status: ["safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe"],
      ux: [0.0, 0.000751349367215, 0.00262972278525, 0.0048837708869, 0.00676214430493, 0.00751349367215, 0.00751349367215, 0.00601079493772, 0.00375674683607, 0.00150269873443, -8.96186159218e-18],
      uy: [0.0, -0.0140056392032, -0.0218760423236, -0.0218760423236, -0.0140056392032, 0.0, -0.00721971548129, -0.0184830804626, -0.0225267299627, -0.0184830804626, -0.00721971548129],
      reactions: { 1: [2.75002221915e-10, 80000.0], 6: [0.0, 80000.0] },
      minSF: { value: 1.61052209766, member: 10, governs: "buckling" },
    },
    aframe: {
      title: "A-frame (3-4-5): exact F = −62.5 kN, uy = −1.953125 mm",
      counts: { nodes: 3, members: 2, sections: 1, materials: 3 },
      supports: { 1: "pin", 2: "pin" },
      ok: true, maxwell: 0,
      force: [-62500.0, -62500.0],
      status: ["safe", "safe"],
      ux: [0.0, 0.0, 0.0],
      uy: [0.0, 0.0, -0.001953125],
      reactions: { 1: [37500.0, 50000.0], 2: [-37500.0, 50000.0] },
      minSF: { value: 1.26330936334, member: 1, governs: "buckling" },
    },
    cantilever: {
      title: "Cantilever truss: 8 m reach, 40 kN tip load",
      counts: { nodes: 9, members: 14, sections: 2, materials: 3 },
      supports: { 1: "pin", 6: "pin" },
      ok: true, maxwell: 0,
      force: [-120000.0, -80000.0, -40000.0, -40000.0, 160000.0, 120000.0, 80000.0, 56568.5424949, 40000.0, 40000.0, 0.0, -56568.5424949, -56568.5424949, -56568.5424949],
      status: ["safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe"],
      ux: [0.0, -0.000631578947368, -0.00105263157895, -0.00126315789474, -0.00147368421053, 0.0, 0.000842105263158, 0.00147368421053, 0.00189473684211],
      uy: [0.0, -0.00255122451528, -0.00636560692529, -0.010575666027, -0.0145395454217, 0.0, -0.00210479594385, -0.00591917835386, -0.010575666027],
      reactions: { 1: [160000.0, 40000.0], 6: [-160000.0, 0.0] },
      minSF: { value: 2.05308879601, member: 14, governs: "buckling" },
    },
    fink: {
      title: "Fink roof truss: 12 m span, 3 m rise, Douglas fir 75×200",
      counts: { nodes: 7, members: 11, sections: 1, materials: 3 },
      supports: { 1: "pin", 4: "rollerX" },
      ok: true, maxwell: 0,
      force: [-33541.0196625, -27950.8497187, -27950.8497187, -33541.0196625, 30000.0, 20000.0, 30000.0, -9013.87818866, 9013.87818866, 9013.87818866, -9013.87818866],
      status: ["safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe"],
      ux: [0.0, 0.000727272727273, 0.00121212121212, 0.00193939393939, 0.00145807935102, 0.000969696969697, 0.000481314588371],
      uy: [0.0, -0.0048095908637, -0.0048095908637, 0.0, -0.00444075050489, -0.00473447891127, -0.00444075050489],
      reactions: { 1: [2.97113333678e-12, 15000.0], 4: [0.0, 15000.0] },
      minSF: { value: 2.02300141559, member: 1, governs: "buckling" },
    },
    inclined: {
      title: "Inclined roller at 30°: R_B acts normal to the surface",
      counts: { nodes: 3, members: 3, sections: 1, materials: 3 },
      supports: { 1: "pin", 2: "inclined" },
      ok: true, maxwell: 0,
      force: [14792.7405784, -21213.2034356, -49497.4746831],
      status: ["safe", "safe", "safe"],
      ux: [0.0, 0.000336734844089, 0.000393085230881],
      uy: [0.0, 0.00019441395288, -0.000875972408796],
      reactions: { 1: [207.259421637, 15000.0], 2: [-20207.2594216, 35000.0] },
      minSF: { value: 2.57827742376, member: 3, governs: "buckling" },
    },
    settlement: {
      title: "Two-span truss: middle support settles 10 mm (indeterminate)",
      counts: { nodes: 18, members: 33, sections: 2, materials: 3 },
      supports: { 1: "pin", 5: "custom", 9: "rollerX" },
      ok: true, maxwell: 1,
      force: [-1.51668971457e-10, -48472.6475151, 48472.6475151, -76945.2950303, 85417.9425454, -76945.2950303, 73890.5900605, -85417.9425454, 73890.5900605, -85417.9425454, 85417.9425454, -76945.2950303, 48472.6475151, -76945.2950303, 0.0, -48472.6475151, -48472.6475151, -28472.6475151, 0.0, 8472.64751513, -23054.7049697, 8472.64751513, 0.0, -28472.6475151, -48472.6475151, 68550.67552, 40266.4042726, -11982.1330251, 16302.1382224, 16302.1382224, -11982.1330251, 40266.4042726, 68550.67552],
      status: ["safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe", "safe"],
      ux: [0.0, -9.28703698098e-19, 0.000296809074207, 0.000819842614713, 0.00127229154731, 0.00172474047991, 0.00224777402042, 0.00254458309462, 0.00254458309462, 0.00303444133744, 0.00273763226324, 0.00226647867553, 0.00179532508782, 0.00127229154731, 0.000749258006806, 0.000278104419097, -0.000193049168612, -0.000489858242819],
      uy: [0.0, -0.0047945735889, -0.00826929172167, -0.0100754653713, -0.01, -0.0100754653713, -0.00826929172167, -0.0047945735889, 0.0, -0.000459753364528, -0.00506463095451, -0.00826929172167, -0.00999510400462, -0.0102186692644, -0.00999510400462, -0.00826929172167, -0.00506463095451, -0.000459753364528],
      reactions: { 1: [1.51668971457e-10, 48472.6475151], 5: [0.0, 23054.7049697], 9: [0.0, 48472.6475151] },
      minSF: { value: 4.80629150692, member: 26, governs: "yield" },
    },
    mechanism: {
      title: "Unstable: the middle panel has no diagonal",
      counts: { nodes: 8, members: 12, sections: 1, materials: 3 },
      supports: { 1: "pin", 4: "rollerX" },
      ok: false, maxwell: -1,
      mechanism: { nullity: 1, kinds: ["internal"] },
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = BASELINE;
  if (root) root.TrussLabExampleBaseline = BASELINE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
