/* Planejamento das parcelas dentro dos polígonos do KML (sistemático ou aleatório),
   com alocação proporcional à área de cada estrato e ordem de caminhamento. */
(function (root) {
  'use strict';
  const G = root.Geo || (typeof require !== 'undefined' ? require('./geo.js') : null);

  // gerador pseudoaleatório com semente, para o mesmo plano poder ser refeito
  function rng(semente) {
    let a = semente >>> 0 || 1;
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  // Divide n parcelas entre os estratos, proporcional à área (maiores restos), mínimo de 2 por estrato quando der
  function alocar(estratos, n) {
    const A = estratos.reduce((s, e) => s + e.areaHa, 0);
    const minimo = n >= 2 * estratos.length ? 2 : n >= estratos.length ? 1 : 0;
    const base = estratos.map(e => Math.max(minimo, Math.floor(n * e.areaHa / A)));
    let falta = n - base.reduce((s, v) => s + v, 0);
    const restos = estratos.map((e, i) => ({ i, r: n * e.areaHa / A - Math.floor(n * e.areaHa / A) })).sort((a, b) => b.r - a.r);
    for (let k = 0; falta > 0; k = (k + 1) % restos.length, falta--) base[restos[k].i]++;
    while (falta < 0) { const i = base.indexOf(Math.max(...base)); base[i]--; falta++; }
    return base;
  }

  function caixa(poly) {
    return { minE: Math.min(...poly.map(p => p.E)), maxE: Math.max(...poly.map(p => p.E)), minN: Math.min(...poly.map(p => p.N)), maxN: Math.max(...poly.map(p => p.N)) };
  }
  const valido = (pt, poly, borda) => G.dentro(pt, poly) && G.distBorda(pt, poly) >= borda;

  function grade(poly, s, ox, oy, borda) {
    const b = caixa(poly), out = [];
    for (let e = b.minE + ox; e <= b.maxE; e += s)
      for (let n = b.minN + oy; n <= b.maxN; n += s) { const p = { E: e, N: n }; if (valido(p, poly, borda)) out.push(p); }
    return out;
  }

  // Grade sistemática com espaçamento ajustado para dar exatamente k pontos (ou o mais próximo possível)
  function sistematico(poly, areaM2, k, borda, R) {
    if (k <= 0) return { pts: [], espacamento: null };
    const ox = R(), oy = R();
    let lo = Math.sqrt(areaM2 / k) * 0.3, hi = Math.sqrt(areaM2 / k) * 2.5, melhor = null;
    for (let i = 0; i < 40; i++) {
      const s = (lo + hi) / 2, pts = grade(poly, s, ox * s, oy * s, borda);
      if (pts.length >= k) { melhor = { pts, s }; lo = s; } else hi = s;
    }
    if (!melhor) { const s = lo; melhor = { pts: grade(poly, s, ox * s, oy * s, borda), s }; }
    let pts = melhor.pts;
    while (pts.length > k) pts.splice(Math.floor(R() * pts.length), 1); // tira os excedentes ao acaso
    return { pts, espacamento: melhor.s };
  }

  // Aleatório com distância mínima entre parcelas (metade do espaçamento médio)
  function aleatorio(poly, areaM2, k, borda, R) {
    const b = caixa(poly), dmin = 0.5 * Math.sqrt(areaM2 / Math.max(k, 1)), pts = [];
    for (let t = 0; t < 20000 && pts.length < k; t++) {
      const p = { E: b.minE + R() * (b.maxE - b.minE), N: b.minN + R() * (b.maxN - b.minN) };
      if (valido(p, poly, borda) && pts.every(q => G.dist(p, q) >= dmin)) pts.push(p);
    }
    return { pts, espacamento: null };
  }

  // Ordem de caminhamento: começa no ponto mais a noroeste e segue sempre para o mais próximo
  function ordenar(pts) {
    if (!pts.length) return pts;
    const rest = [...pts], out = [];
    let i0 = 0; rest.forEach((p, i) => { if (p.N - p.E > rest[i0].N - rest[i0].E) i0 = i; });
    let cur = rest.splice(i0, 1)[0]; out.push(cur);
    while (rest.length) { let j = 0; rest.forEach((p, i) => { if (G.dist(cur, p) < G.dist(cur, rest[j])) j = i; }); cur = rest.splice(j, 1)[0]; out.push(cur); }
    return out;
  }

  /* estratos: [{nome, areaHa, poly:[{E,N}]}]; o: {n, metodo:'sistematico'|'aleatorio', borda, semente}
     → {pontos:[{E,N,estrato}], porEstrato:[{nome, pedidas, geradas, espacamento}]} */
  function distribuir(estratos, o) {
    const R = rng(o.semente || Date.now());
    const k = alocar(estratos, o.n);
    const porEstrato = [], todos = [];
    estratos.forEach((e, i) => {
      const areaM2 = G.areaPoligono(e.poly);
      const r = (o.metodo === 'aleatorio' ? aleatorio : sistematico)(e.poly, areaM2, k[i], o.borda || 0, R);
      porEstrato.push({ nome: e.nome, pedidas: k[i], geradas: r.pts.length, espacamento: r.espacamento });
      r.pts.forEach(p => todos.push({ ...p, estrato: e.nome }));
    });
    return { pontos: ordenar(todos), porEstrato };
  }

  const api = { distribuir, alocar, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Plano = api;
})(typeof window !== 'undefined' ? window : globalThis);
