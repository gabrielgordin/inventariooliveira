/* Motor de cálculo do inventário florestal.
   Funções puras, sem acesso a tela nem a banco. Roda no navegador (window.Calc)
   e no node (module.exports), para os testes contra as planilhas. */
(function (root) {
  'use strict';
  const PI = Math.PI;

  // ---------- funções estatísticas ----------
  function lgamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
      -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, tmp = x + 5.5;
    tmp -= (x + 0.5) * Math.log(tmp);
    let ser = 1.000000000190015;
    for (let j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function betacf(a, b, x) {
    const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function ibeta(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  // P(|T| > t) com df graus de liberdade
  function tTwoTail(t, df) { return ibeta(df / 2, 0.5, df / (df + t * t)); }
  // Equivalente ao TINV do Excel: t bicaudal para probabilidade alfa
  function tinv(alpha, df) {
    if (!(df >= 1)) return NaN;
    let lo = 0, hi = 1e4;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tTwoTail(mid, df) > alpha) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const sum = a => a.reduce((s, v) => s + v, 0);
  const mean = a => a.length ? sum(a) / a.length : NaN;
  function variance(a, populacional) {
    const n = a.length; if (n < (populacional ? 1 : 2)) return NaN;
    const m = mean(a); const ss = sum(a.map(v => (v - m) ** 2));
    return ss / (populacional ? n : n - 1);
  }
  const num = v => (v === null || v === undefined || v === '' || isNaN(+v)) ? null : +v;

  // ---------- dendrometria ----------
  const dapDeCap = cap => cap / PI;                 // cm
  const gDeCap = cap => cap * cap / (40000 * PI);   // m²
  function volEquacao(dap, h, eq) {                // Schumacher-Hall: b0·DAP^b1·H^b2·fator
    if (!(dap > 0) || !(h > 0)) return 0;
    return eq.b0 * Math.pow(dap, eq.b1) * Math.pow(h, eq.b2) * (eq.fator ?? 1);
  }

  // Regressão linear simples de y em x (mínimos quadrados)
  function regressao(xs, ys) {
    const n = xs.length; if (n < 3) return null;
    const mx = mean(xs), my = mean(ys);
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
    if (sxx === 0) return null;
    const b1 = sxy / sxx, b0 = my - b1 * mx;
    const r2 = syy ? (sxy * sxy) / (sxx * syy) : 1;
    const sse = Math.max(syy - b1 * sxy, 0);
    return { b0, b1, r2, n, syx: Math.sqrt(sse / (n - 2)) };
  }

  // ---------- parcela de eucalipto ----------
  /* stems: [{arvore, H, CAP, falha}] — cada linha é um fuste; a falha é uma cova sem árvore.
     p: {areaParcela, fatorForma, eq:{b0,b1,b2,fator}, usarHMedida} */
  function parcelaEucalipto(stems, p) {
    const area = p.areaParcela, ha = 10000 / area, f = p.fatorForma ?? 0.5;
    const fustes = stems.filter(s => !s.falha && num(s.CAP) > 0).map(s => ({ ...s, CAP: +s.CAP, H: num(s.H) }));
    const falhas = stems.filter(s => s.falha).length;
    const arvoresIds = new Set(stems.filter(s => !s.falha).map(s => s.arvore));
    const nArv = arvoresIds.size, nF = fustes.length;
    const comH = fustes.filter(s => s.H > 0);
    const capMed = mean(fustes.map(s => s.CAP));
    const hMed = mean(comH.map(s => s.H));
    const g = sum(fustes.map(s => gDeCap(s.CAP)));

    // altura estimada: ln(H) = b0 + b1·(1/DAP)
    const reg = regressao(comH.map(s => 1 / dapDeCap(s.CAP)), comH.map(s => Math.log(s.H)));
    const hEst = s => {
      if (p.usarHMedida && s.H > 0) return s.H;
      if (reg) return Math.exp(reg.b0 + reg.b1 / dapDeCap(s.CAP));
      return s.H > 0 ? s.H : hMed;
    };
    fustes.forEach(s => { s.hEst = hEst(s); });
    const hEstMed = mean(fustes.map(s => s.hEst));

    /* Equação simplificada da planilha (por árvore/fuste): V = (CAP/628,32)² × 3,1416 × H × 0,50,
       com a altura medida quando houver e, sem ela, a altura estimada pela regressão da parcela. */
    const hSimpl = s => s.H > 0 ? s.H : (reg ? Math.exp(reg.b0 + reg.b1 / dapDeCap(s.CAP)) : hMed);
    fustes.forEach(s => { s.hSimpl = hSimpl(s); });
    const simplificada = sum(fustes.map(s => (s.CAP / 628.32) ** 2 * 3.1416 * s.hSimpl * f));
    const vPadrao = nF ? gDeCap(capMed) * nF * hMed * f : 0;           // árvore média, H medida
    const vArvMediaReg = nF ? gDeCap(capMed) * nF * hEstMed * f : 0;   // árvore média, H da regressão
    const vol2 = sum(fustes.map(s => gDeCap(s.CAP) * s.hEst * f));    // por fuste, H da regressão
    const eqMedia = nF ? volEquacao(capMed / PI, hEstMed, p.eq) * nF : 0;
    const eqFuste = sum(fustes.map(s => volEquacao(dapDeCap(s.CAP), s.hEst, p.eq)));

    return {
      nArvores: nArv, nFustes: nF, nFalhas: falhas, nComH: comH.length,
      capMed, hMed, hEstMed, g, regressao: reg, fustes,
      vol: { simplificada, padrao: vPadrao, arvMediaReg: vArvMediaReg, vol2, eqMedia, eqFuste },
      ha: {
        arvores: nArv * ha, fustes: nF * ha, g: g * ha,
        simplificada: simplificada * ha, padrao: vPadrao * ha, arvMediaReg: vArvMediaReg * ha, vol2: vol2 * ha, eqMedia: eqMedia * ha, eqFuste: eqFuste * ha
      }
    };
  }

  // ---------- parcela de cerrado ----------
  /* trees: [{nome, H, CAP, fustes:[CAP2, CAP3...]}]. Fustes extras: DAP equivalente (√ΣDAP²).
     p: {areaParcela, capMin, eq} */
  function arvoreCerrado(t, p) {
    const caps = [num(t.CAP), ...((t.fustesExtras || []).map(num))].filter(v => v > 0);
    const capEq = caps.length ? Math.sqrt(sum(caps.map(c => c * c))) : null;
    const H = num(t.H);
    const dap = capEq ? capEq / PI : null;
    const g = capEq ? sum(caps.map(gDeCap)) : 0;
    const incluida = capEq != null && capEq >= p.capMin;
    const v = incluida ? sum(caps.map(c => volEquacao(c / PI, H, p.eq))) : 0;
    return { capEq, dap, g, H, incluida, v, nFustes: caps.length };
  }
  function parcelaCerrado(trees, p) {
    const ha = 10000 / p.areaParcela;
    const calc = trees.map(t => ({ t, c: arvoreCerrado(t, p) }));
    const inc = calc.filter(x => x.c.incluida);
    const N = inc.length, G = sum(inc.map(x => x.c.g)), V = sum(inc.map(x => x.c.v));
    return {
      arvores: calc, nIncluidas: N, nExcluidas: calc.length - N, g: G, v: V,
      semAltura: inc.filter(x => !(x.c.H > 0)).length,
      ha: { arvores: N * ha, g: G * ha, v: V * ha }
    };
  }

  // ---------- amostragem casual simples ----------
  /* valores: V/ha por parcela. o: {prob, areaHa, areaParcela, desvio:'amostral'|'populacional',
     fpc:boolean, erroAdm (fração), fatorEmp} */
  function estatistica(valores, o) {
    const n = valores.length;
    const r = { n, media: mean(valores) };
    r.N = o.areaHa * 10000 / o.areaParcela;
    r.f = n / r.N;
    if (n < 2) return { ...r, insuficiente: true, total: r.media * o.areaHa };
    r.variancia = variance(valores, o.desvio === 'populacional');
    r.desvio = Math.sqrt(r.variancia);
    r.cv = r.desvio / r.media * 100;
    r.sx = r.desvio / Math.sqrt(n) * (o.fpc ? Math.sqrt(1 - r.f) : 1);
    r.t = tinv(1 - o.prob, n - 1);
    r.erroAbs = r.t * r.sx;
    r.erroRel = r.erroAbs / r.media * 100;
    r.atende = r.erroRel <= o.erroAdm * 100;
    r.icMin = r.media - r.erroAbs; r.icMax = r.media + r.erroAbs;
    r.total = r.media * o.areaHa;
    r.totalMin = r.icMin * o.areaHa; r.totalMax = r.icMax * o.areaHa;
    r.totalSt = r.total * (o.fatorEmp ?? 1.5);
    const E = o.erroAdm * 100, t2cv2 = r.t ** 2 * r.cv ** 2;
    r.parcelasNecessarias = Math.ceil(t2cv2 / (E * E + (o.fpc ? t2cv2 / r.N : 0)));
    r.faltam = Math.max(r.parcelasNecessarias - n, 0);
    return r;
  }

  // ---------- amostragem estratificada ----------
  /* estratos: [{nome, areaHa, valores:[V/ha]}]. Estratos sem parcela recebem a média estratificada
     (como na aba Estratos de Tapira). Variância amostral por estrato; GL de Satterthwaite. */
  function estratificada(estratos, o) {
    const comP = estratos.filter(e => e.valores.length > 0);
    const areaCom = sum(comP.map(e => e.areaHa));
    const areaTotal = sum(estratos.map(e => e.areaHa));
    const linhas = estratos.map(e => {
      const n = e.valores.length, W = n ? e.areaHa / areaCom : 0;
      const m = mean(e.valores), s2 = n >= 2 ? variance(e.valores, false) : null;
      return { nome: e.nome, areaHa: e.areaHa, n, W, media: n ? m : null, variancia: s2, total: n ? m * e.areaHa : null };
    });
    const r = { estratos: linhas, areaTotal, areaComParcelas: areaCom };
    const validos = linhas.filter(l => l.n > 0);
    r.media = sum(validos.map(l => l.W * l.media));
    r.total = r.media * areaTotal;
    r.totalSt = r.total * (o.fatorEmp ?? 1.5);
    if (validos.some(l => l.n < 2)) { r.semErro = 'Há estrato com só 1 parcela: sem variância nesse estrato.'; return r; }
    const termos = validos.map(l => l.W * l.W * l.variancia / l.n);
    const v = sum(termos);
    r.sx = Math.sqrt(v);
    r.gl = v * v / sum(validos.map((l, i) => termos[i] ** 2 / (l.n - 1)));
    r.t = tinv(1 - o.prob, Math.round(r.gl));
    r.erroRel = r.t * r.sx / r.media * 100;
    r.atende = r.erroRel <= o.erroAdm * 100;
    r.totalMin = r.total * (1 - r.erroRel / 100);
    r.totalMax = r.total * (1 + r.erroRel / 100);
    return r;
  }

  // ---------- fitossociologia (cerrado) ----------
  /* parcelas: [{id, arvores:[{nome, c:{incluida,g,v}}]}] */
  function fitossociologia(parcelas, areaParcela) {
    const np = parcelas.length, areaHa = np * areaParcela / 10000;
    const sp = new Map();
    parcelas.forEach(p => p.arvores.forEach(a => {
      if (!a.c.incluida) return;
      const nome = (a.t.nome || '(sem nome)').trim();
      if (!sp.has(nome)) sp.set(nome, { nome, N: 0, G: 0, V: 0, parcelas: new Set() });
      const s = sp.get(nome); s.N++; s.G += a.c.g; s.V += a.c.v; s.parcelas.add(p.id);
    }));
    const L = [...sp.values()];
    const totN = sum(L.map(s => s.N)), totG = sum(L.map(s => s.G));
    L.forEach(s => { s.FA = s.parcelas.size / np * 100; });
    const totFA = sum(L.map(s => s.FA));
    L.forEach(s => {
      s.nParcelas = s.parcelas.size; delete s.parcelas;
      s.DA = s.N / areaHa; s.DR = s.N / totN * 100;
      s.FR = s.FA / totFA * 100;
      s.DoA = s.G / areaHa; s.DoR = s.G / totG * 100;
      s.VC = (s.DR + s.DoR) / 2; s.VI = (s.DR + s.FR + s.DoR) / 3;
      s.Vha = s.V / areaHa;
    });
    return L.sort((a, b) => b.VI - a.VI);
  }

  // ---------- classes de DAP ----------
  function classesDap(itens, largura) { // itens: [{dap, v}]
    const m = new Map();
    itens.forEach(i => {
      const k = Math.max(0, Math.ceil(i.dap / largura) - 1);
      if (!m.has(k)) m.set(k, { min: k * largura, max: (k + 1) * largura, n: 0, v: 0 });
      const c = m.get(k); c.n++; c.v += i.v;
    });
    const L = [...m.values()].sort((a, b) => a.min - b.min);
    const tn = sum(L.map(c => c.n)), tv = sum(L.map(c => c.v));
    L.forEach(c => { c.pn = c.n / tn * 100; c.pv = tv ? c.v / tv * 100 : 0; });
    return L;
  }

  // ---------- alertas de lançamento ----------
  function alertasArvore(t, anterior, p, tipo) {
    const a = [];
    const cap = num(t.CAP), h = num(t.H);
    if (cap == null && !t.falha) a.push({ nivel: 'erro', msg: 'Sem CAP' });
    if (tipo === 'cerrado' && cap != null && cap < p.capMin) a.push({ nivel: 'info', msg: `CAP < ${p.capMin} cm: fora do critério de inclusão` });
    if (cap != null && cap > 400) a.push({ nivel: 'aviso', msg: 'CAP acima de 400 cm: conferir' });
    if (h != null && h > 45) a.push({ nivel: 'aviso', msg: 'Altura acima de 45 m: conferir' });
    if (h != null && cap != null && cap >= (p.capMin || 15) && h < 1.3) a.push({ nivel: 'aviso', msg: 'Altura menor que 1,30 m com CAP medido: conferir' });
    if (h != null && cap != null && h > 0) {
      const dap = cap / PI, razao = h / dap; // m de altura por cm de DAP
      if (razao > 3.5) a.push({ nivel: 'aviso', msg: 'Árvore muito alta para o diâmetro: conferir H e CAP' });
      if (razao < 0.12 && h < 3) a.push({ nivel: 'aviso', msg: 'Árvore muito baixa para o diâmetro: conferir H e CAP' });
    }
    if (anterior && !t.falha && !anterior.falha && num(anterior.CAP) === cap && num(anterior.H) === h &&
      (tipo !== 'cerrado' || (anterior.nome || '') === (t.nome || ''))) a.push({ nivel: 'aviso', msg: 'Igual à linha anterior: não é repetição?' });
    return a;
  }

  // ---------- valor muito diferente da média da parcela (erro de digitação) ----------
  /* reg: o registro a gravar; outros: os demais da parcela. Só avisa com 5+ valores de referência.
     Eucalipto (plantio uniforme): CAP > 2,2× ou < 0,4× a média; H > 1,7× ou < 0,5×.
     Cerrado (diâmetros muito variados): só CAP > 5× a média. */
  function foraDaMedia(reg, outros, tipo) {
    const msgs = [], cap = num(reg.CAP), h = num(reg.H);
    if (reg.falha) return msgs;
    const caps = outros.filter(o => !o.falha && num(o.CAP) > 0).map(o => +o.CAP);
    const hs = outros.filter(o => !o.falha && num(o.H) > 0).map(o => +o.H);
    if (cap > 0 && caps.length >= 5) {
      const m = mean(caps), r = cap / m;
      if (tipo === 'eucalipto' ? (r > 2.2 || r < 0.4) : r > 5)
        msgs.push({ campo: 'e-cap', msg: `CAP ${fmtBR(cap)} cm está ${r > 1 ? 'muito acima' : 'muito abaixo'} da média da parcela (${fmtBR(m)} cm).` });
    }
    if (tipo === 'eucalipto' && h > 0 && hs.length >= 5) {
      const m = mean(hs), r = h / m;
      if (r > 1.7 || r < 0.5) msgs.push({ campo: 'e-h', msg: `Altura ${fmtBR(h)} m está ${r > 1 ? 'muito acima' : 'muito abaixo'} da média da parcela (${fmtBR(m)} m).` });
    }
    return msgs;
  }
  const fmtBR = v => (Math.round(v * 10) / 10).toString().replace('.', ',');

  // Equações de volume (DAP em cm, H em m) da planilha de 25/11/2026
  const EQUACOES = {
    cerrado: { nome: 'Cerrado', b0: 0.000066, b1: 2.475293, b2: 0.300022, fator: 1 },
    cerradao: { nome: 'Cerradão', b0: 0.000094, b1: 1.830398, b2: 0.960913, fator: 1 }
  };

  const api = { EQUACOES,
    tinv, mean, variance, sum, dapDeCap, gDeCap, volEquacao, regressao,
    parcelaEucalipto, parcelaCerrado, arvoreCerrado, estatistica, estratificada,
    fitossociologia, classesDap, alertasArvore, foraDaMedia
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
