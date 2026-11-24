/* Geometria: UTM SIRGAS 2000 (elipsoide GRS80), áreas, ponto em polígono, KML/GPX. */
(function (root) {
  'use strict';
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

  function zonaDe(lon) { return Math.floor((lon + 180) / 6) + 1; }

  function paraUTM(lat, lon, zona) {
    zona = zona || zonaDe(lon);
    const lon0 = rad((zona - 1) * 6 - 180 + 3);
    const phi = rad(lat), lam = rad(lon);
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lon0);
    const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
    const E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
    let Nn = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
    if (lat < 0) Nn += 10000000;
    return { E, N: Nn, zona, sul: lat < 0 };
  }

  function deUTM(E, N, zona, sul = true) {
    const x = E - 500000, y = sul ? N - 10000000 : N;
    const lon0 = rad((zona - 1) * 6 - 180 + 3);
    const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
    const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2), T1 = Math.tan(phi1) ** 2, C1 = ep2 * Math.cos(phi1) ** 2;
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) ** 2, 1.5), D = x / (N1 * k0);
    const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
    const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(phi1);
    return { lat: deg(lat), lon: deg(lon) };
  }

  // Letra da zona (banda de latitude), como o GPS mostra: 22K, 23K...
  function banda(lat) { return 'CDEFGHJKLMNPQRSTUVWXX'[Math.floor((lat + 80) / 8)] || ''; }

  function areaPoligono(pts) { // pts: [{E,N}] — m²
    let s = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.E * q.N - q.E * p.N; }
    return Math.abs(s) / 2;
  }
  function dist(p, q) { return Math.hypot(p.E - q.E, p.N - q.N); }
  function azimute(p, q) { return (deg(Math.atan2(q.E - p.E, q.N - p.N)) + 360) % 360; }
  function dentro(pt, poly) { // pt {E,N}, poly [{E,N}]
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i], pj = poly[j];
      if ((pi.N > pt.N) !== (pj.N > pt.N) && pt.E < (pj.E - pi.E) * (pt.N - pi.N) / (pj.N - pi.N) + pi.E) c = !c;
    }
    return c;
  }
  function distSegmento(p, a1, b1) {
    const dx = b1.E - a1.E, dy = b1.N - a1.N, L = dx * dx + dy * dy;
    let t = L ? ((p.E - a1.E) * dx + (p.N - a1.N) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.E - (a1.E + t * dx), p.N - (a1.N + t * dy));
  }
  function distBorda(pt, poly) {
    let m = Infinity;
    for (let i = 0; i < poly.length; i++) m = Math.min(m, distSegmento(pt, poly[i], poly[(i + 1) % poly.length]));
    return m;
  }
  function centro(pts) { return { E: pts.reduce((s, p) => s + p.E, 0) / pts.length, N: pts.reduce((s, p) => s + p.N, 0) / pts.length }; }

  /* Ordena os vértices em volta do centro, para formar o polígono certo
     mesmo se forem marcados fora de ordem. */
  function ordenarVertices(pts) {
    const c = centro(pts);
    return [...pts].sort((p, q) => Math.atan2(p.N - c.N, p.E - c.E) - Math.atan2(q.N - c.N, q.E - c.E));
  }

  /* Completa um retângulo a partir de 2 vértices de um lado (p1, p2), com profundidade d (m),
     para a esquerda (lado = 1) ou direita (lado = -1) do sentido p1→p2. */
  function completarRetangulo(p1, p2, d, lado) {
    const L = dist(p1, p2), ux = (p2.E - p1.E) / L, uy = (p2.N - p1.N) / L;
    const nx = -uy * lado, ny = ux * lado;
    return [p1, p2, { E: p2.E + nx * d, N: p2.N + ny * d }, { E: p1.E + nx * d, N: p1.N + ny * d }];
  }

  // ----- leitura de KML e GPX (precisa de DOMParser) -----
  function lerCoords(txt) {
    return txt.trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(c => c.length >= 2 && !isNaN(c[0]))
      .map(c => ({ lon: c[0], lat: c[1] }));
  }
  function lerKML(texto) {
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    const res = { poligonos: [], pontos: [] };
    doc.querySelectorAll('Placemark').forEach((pm, i) => {
      const nome = (pm.querySelector('name')?.textContent || `Item ${i + 1}`).trim();
      pm.querySelectorAll('Polygon').forEach((pg, k) => {
        const outer = pg.querySelector('outerBoundaryIs coordinates') || pg.querySelector('coordinates');
        if (!outer) return;
        const furos = [...pg.querySelectorAll('innerBoundaryIs coordinates')].map(c => lerCoords(c.textContent));
        res.poligonos.push({ nome: k ? `${nome} (${k + 1})` : nome, coords: lerCoords(outer.textContent), furos });
      });
      const pt = pm.querySelector('Point coordinates');
      if (pt) { const c = lerCoords(pt.textContent)[0]; if (c) res.pontos.push({ nome, ...c }); }
    });
    return res;
  }
  function lerGPX(texto) {
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    return [...doc.querySelectorAll('wpt')].map(w => ({
      nome: w.querySelector('name')?.textContent?.trim() || '',
      lat: +w.getAttribute('lat'), lon: +w.getAttribute('lon'),
      alt: w.querySelector('ele') ? +w.querySelector('ele').textContent : null,
      hora: w.querySelector('time')?.textContent || null,
      desc: w.querySelector('desc')?.textContent || w.querySelector('cmt')?.textContent || ''
    }));
  }

  const api = { zonaDe, paraUTM, deUTM, banda, areaPoligono, dist, azimute, dentro, distBorda, centro,
    ordenarVertices, completarRetangulo, lerKML, lerGPX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Geo = api;
})(typeof window !== 'undefined' ? window : globalThis);
