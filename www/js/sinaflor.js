/* Exportação para o SINAFLOR (pedido de supressão — ASV/UAS, inventário amostral).
   O SINAFLOR não importa as árvores: os campos da aba "Inventário Florestal" são digitados
   e a planilha vai como anexo. Aqui saem (1) uma planilha com cada campo já calculado, na ordem
   das telas do sistema, e (2) o shapefile das parcelas (SIRGAS 2000) para a "Localização das Amostras". */
(function (root) {
  'use strict';
  const r = (v, d = 4) => (v == null || !isFinite(v)) ? null : Math.round(v * 10 ** d) / 10 ** d;
  const br = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

  // texto da(s) equação(ões) usadas
  function textoEquacao(proj, R) {
    const P = proj.params;
    if (proj.tipo === 'eucalipto') {
      const M = (root.App && App.METODOS) || {};
      if (P.metodo === 'simplificada') return `V = (CAP/628,32)² × 3,1416 × H × ${br(P.fatorForma, 2)} por fuste (CAP em cm; H medida ou estimada pela regressão ln H = b0 + b1/DAP)`;
      if (P.metodo === 'eqMedia' || P.metodo === 'eqFuste') return `V = ${P.eq.b0} × DAP^${P.eq.b1} × H^${P.eq.b2} × ${P.eq.fator} (DAP em cm; H em m) — ${M[P.metodo] || ''}`;
      return `${M[P.metodo] || P.metodo}: V = g × H × fator de forma ${br(P.fatorForma, 2)}`;
    }
    const usadas = [...new Set(R.porParcela.map(x => App.fisionomiaDe(proj, x.pc)))];
    return (usadas.length ? usadas : ['cerrado']).map(k => {
      const q = (P.eqs || {})[k] || Calc.EQUACOES[k];
      return `${Calc.EQUACOES[k].nome}: VTcc = ${String(q.b0).replace('.', ',')} × DAP^${String(q.b1).replace('.', ',')} × H^${String(q.b2).replace('.', ',')}`;
    }).join(' · ') + ' (DAP em cm; H em m)';
  }

  // valores para a tela do SINAFLOR
  function dados(proj, R) {
    const P = R.p, E = R.est, n = E.n, aP = P.areaParcela;
    const amostraHa = n * aP / 10000;
    const porParc = k => k == null ? null : k * aP / 10000;            // m³/ha → m³/parcela
    const porParc2 = k => k == null ? null : k * (aP / 10000) ** 2;     // variâncias
    const estr = !!R.estrat && !R.estrat.semErro;
    return {
      geral: [
        ['Equação do Volume', textoEquacao(proj, R)],
        ['Processo de Amostragem', estr ? 'Amostragem casual estratificada' : 'Amostragem casual simples'],
        ['Tipo de Inventário', 'Inventário florestal amostral'],
        ['Nível de Probabilidade', `${br(P.prob * 100, 0)}%`],
        ['Forma da Parcela', `Retangular (${br(P.comprimento, 0)} m × ${br(P.largura, 0)} m = ${br(aP, 0)} m²)`],
        ['Área Total do Projeto (ha)', r(R.areaHa, 4)],
        ['Área da Amostra (ha)', r(amostraHa, 4)],
        ['Número de parcelas', n],
        ['Intensidade amostral (%)', R.areaHa ? r(amostraHa / R.areaHa * 100, 3) : null],
        ['Erro admissível (%)', r(P.erroAdm * 100, 2)],
        ['Erro de amostragem obtido (%)', r(estr ? R.estrat.erroRel : E.erroRel, 2)]
      ],
      // [rótulo, por parcela, por hectare]
      resultado: [
        ['Volume total estimado (m³)', r(estr ? R.estrat.total : E.total, 4), null],
        ['Média', r(porParc(E.media), 6), r(E.media, 4)],
        ['Desvio padrão', r(porParc(E.desvio), 6), r(E.desvio, 4)],
        ['Variância', r(porParc2(E.variancia), 8), r(E.variancia, 4)],
        ['Variância da média', r(porParc2(E.sx ** 2), 8), r(E.sx ** 2, 6)],
        ['Erro padrão da média', r(porParc(E.sx), 6), r(E.sx, 4)],
        ['Coeficiente de variação (%)', r(E.cv, 4), r(E.cv, 4)],
        ['Variância da média relativa (%) = erro padrão ÷ média × 100', r(E.sx / E.media * 100, 4), r(E.sx / E.media * 100, 4)],
        ['Erro de amostragem absoluto', r(porParc(E.erroAbs), 6), r(E.erroAbs, 4)],
        ['Erro de amostragem relativo (%)', r(E.erroRel, 4), r(E.erroRel, 4)],
        ['Intervalo de confiança da média — mínimo', r(porParc(E.icMin), 6), r(E.icMin, 4)],
        ['Intervalo de confiança da média — máximo', r(porParc(E.icMax), 6), r(E.icMax, 4)],
        ['Intervalo de confiança do total (m³) — mínimo', r(E.totalMin, 4), null],
        ['Intervalo de confiança do total (m³) — máximo', r(E.totalMax, 4), null],
        ['t de Student', r(E.t, 4), null],
        ['Graus de liberdade', n - 1, null]
      ],
      estr
    };
  }

  // volume por espécie, extrapolado para a área total
  function porEspecie(proj, R) {
    const P = R.p, fat = P.fatorEmp ?? 1.5;
    const amostraHa = R.est.n * P.areaParcela / 10000;
    if (proj.tipo === 'eucalipto') {
      const total = R.estrat && !R.estrat.semErro ? R.estrat.total : R.est.total;
      return [['Madeira em tora / lenha', 'Eucalyptus sp.', 'eucalipto', R.porParcela.reduce((s, x) => s + x.r.nFustes, 0), null, r(total, 4), r(total * fat, 4), '', '']];
    }
    return (R.fito || []).map(s => {
      const am = App.ameaca(proj, s.nome);
      const v = amostraHa ? s.V / amostraHa * R.areaHa : null;
      return ['Lenha', App.cientifico(proj, s.nome).replace(/\s*\(conferir\)/, '') || '', s.nome, s.N, r(s.V, 4), r(v, 4), r(v * fat, 4),
        App.imune(s.nome) ? 'SIM' : '', am && !am.genero ? `${am.cat} — ${am.catNome}` : ''];
    }).sort((a, b) => (b[5] || 0) - (a[5] || 0));
  }

  function amostras(proj, R) {
    return R.porParcela.map(x => {
      const g = x.geo;
      return { numero: x.pc.numero, estrato: x.pc.estrato || '', lat: g?.c?.lat, lon: g?.c?.lon, E: g?.cu?.E, N: g?.cu?.N, zona: proj.zonaUTM || null,
        area: g?.area, vha: R.vha(x), poly: g && g.ord.length >= 3 ? g.ord.map(p => ({ lat: p.lat, lon: p.lon })) : null };
    });
  }

  function planilha(proj, R) {
    const D = dados(proj, R), wb = XLSX.utils.book_new();
    const add = (nome, linhas, larg) => { const ws = XLSX.utils.aoa_to_sheet(linhas); ws['!cols'] = larg.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, nome); };
    const z = proj.zonaUTM ? `${proj.zonaUTM}S` : '';
    add('Leia-me', [
      [`Inventário: ${proj.nome}`], [`Gerado em ${new Date().toLocaleString('pt-BR')} pelo app Inventário Florestal`], [],
      ['Como usar no SINAFLOR (pedido de ASV, aba "Inventário Florestal"):'],
      ['1. Informações Gerais → copie os valores da aba Informacoes_Gerais desta planilha.'],
      ['2. Localização das Amostras → importe o shapefile (arquivo .zip exportado junto: centros e polígonos das parcelas, SIRGAS 2000, coordenadas geográficas).'],
      ['3. Volume Total Estimado → um lançamento por espécie, com os valores da aba Volume_Especies (volume já extrapolado para a área total).'],
      ['4. Resultado do IF → aba Resultado_IF. Use a coluna "por parcela" ou "por hectare" conforme a unidade pedida na tela.'],
      ['5. Anexe esta planilha e a planilha completa do inventário (.xlsx) no campo de anexos.'], [],
      ['Confira o produto florestal (lenha, tora, mourão…) e as unidades exigidas na tela antes de enviar.'],
      ['Espécies ameaçadas: Lista Nacional Oficial — Portaria GM/MMA nº 1.783/2026 (recorte dos gêneros arbóreos mais comuns do cerrado; confira no anexo oficial).']
    ], [110]);
    add('Informacoes_Gerais', [['Campo do SINAFLOR', 'Valor'], ...D.geral], [34, 90]);
    add('Resultado_IF', [['Parâmetro', 'Por parcela (m³/parcela)', 'Por hectare (m³/ha)'], ...D.resultado,
      ...(R.estrat && !R.estrat.semErro ? [[], ['Amostragem estratificada'], ['Média estratificada (m³/ha)', null, r(R.estrat.media, 4)], ['Erro estratificado (%)', null, r(R.estrat.erroRel, 4)],
        ['Total estratificado (m³)', r(R.estrat.total, 4), null], ['Graus de liberdade efetivos', r(R.estrat.gl, 2), null]] : [])], [58, 24, 22]);
    const esp = porEspecie(proj, R);
    const tot = esp.reduce((s, l) => s + (l[5] || 0), 0);
    add('Volume_Especies', [['Produto Florestal', 'Nome científico', 'Nome popular', 'Indivíduos amostrados', 'Volume na amostra (m³)', 'Volume estimado na área (m³)', 'Volume estimado (st)', 'Imune de corte (MG)', 'Ameaçada (Portaria GM/MMA 1.783/2026)'],
      ...esp, ['TOTAL', '', '', esp.reduce((s, l) => s + (l[3] || 0), 0), r(esp.reduce((s, l) => s + (l[4] || 0), 0), 4), r(tot, 4), r(tot * (R.p.fatorEmp ?? 1.5), 4), '', '']], [18, 30, 24, 12, 14, 16, 14, 12, 28]);
    add('Localizacao_Amostras', [['Parcela', 'Estrato', 'Latitude (SIRGAS 2000)', 'Longitude (SIRGAS 2000)', `E UTM ${z}`, `N UTM ${z}`, 'Área medida (m²)', 'Volume (m³/ha)'],
      ...amostras(proj, R).map(a => [a.numero, a.estrato, r(a.lat, 7), r(a.lon, 7), r(a.E, 2), r(a.N, 2), r(a.area, 1), r(a.vha, 4)])], [10, 22, 18, 18, 14, 14, 14, 14]);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- shapefile ----------
  const PRJ = 'GEOGCS["SIRGAS 2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
  function shp(tipo, geoms) {
    // geoms: [[x,y]] para pontos; [[[x,y]...]] (anel fechado) para polígonos
    const conteudo = geoms.map(g => tipo === 1 ? 20 : 44 + 4 + 16 * g.length);
    const len = 100 + conteudo.reduce((s, c) => s + 8 + c, 0);
    const b = new DataView(new ArrayBuffer(len)), x = new DataView(new ArrayBuffer(100 + 8 * geoms.length));
    const todos = tipo === 1 ? geoms : geoms.flat();
    const bb = todos.length ? [Math.min(...todos.map(p => p[0])), Math.min(...todos.map(p => p[1])), Math.max(...todos.map(p => p[0])), Math.max(...todos.map(p => p[1]))] : [0, 0, 0, 0];
    const cab = (v, tam) => { v.setInt32(0, 9994); v.setInt32(24, tam / 2); v.setInt32(28, 1000, true); v.setInt32(32, tipo, true); bb.forEach((c, i) => v.setFloat64(36 + 8 * i, c, true)); };
    cab(b, len); cab(x, 100 + 8 * geoms.length);
    let o = 100;
    geoms.forEach((g, i) => {
      x.setInt32(100 + 8 * i, o / 2); x.setInt32(104 + 8 * i, conteudo[i] / 2);
      b.setInt32(o, i + 1); b.setInt32(o + 4, conteudo[i] / 2); o += 8;
      b.setInt32(o, tipo, true);
      if (tipo === 1) { b.setFloat64(o + 4, g[0], true); b.setFloat64(o + 12, g[1], true); o += 20; return; }
      const xs = g.map(p => p[0]), ys = g.map(p => p[1]);
      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((c, k) => b.setFloat64(o + 4 + 8 * k, c, true));
      b.setInt32(o + 36, 1, true); b.setInt32(o + 40, g.length, true); b.setInt32(o + 44, 0, true);
      g.forEach((p, k) => { b.setFloat64(o + 48 + 16 * k, p[0], true); b.setFloat64(o + 56 + 16 * k, p[1], true); });
      o += 48 + 16 * g.length;
    });
    return { shp: new Uint8Array(b.buffer), shx: new Uint8Array(x.buffer) };
  }
  function dbf(campos, linhas) {
    // campos: [nome, 'C'|'N', tamanho, decimais]
    const recLen = 1 + campos.reduce((s, c) => s + c[2], 0), hdr = 32 + 32 * campos.length + 1;
    const u = new Uint8Array(hdr + recLen * linhas.length + 1), v = new DataView(u.buffer), d = new Date();
    u[0] = 3; u[1] = d.getFullYear() - 1900; u[2] = d.getMonth() + 1; u[3] = d.getDate();
    v.setUint32(4, linhas.length, true); v.setUint16(8, hdr, true); v.setUint16(10, recLen, true);
    campos.forEach((c, i) => {
      const o = 32 + 32 * i; for (let k = 0; k < c[0].length && k < 10; k++) u[o + k] = c[0].charCodeAt(k);
      u[o + 11] = c[1].charCodeAt(0); u[o + 16] = c[2]; u[o + 17] = c[3] || 0;
    });
    u[hdr - 1] = 0x0d;
    linhas.forEach((l, i) => {
      let o = hdr + recLen * i; u[o++] = 0x20;
      campos.forEach((c, k) => {
        let t = l[k] == null || (c[1] === 'N' && !isFinite(l[k])) ? '' : c[1] === 'N' ? (+l[k]).toFixed(c[3] || 0) : semAcento(l[k]).replace(/[^\x20-\x7e]/g, '?');
        t = c[1] === 'N' ? t.slice(-c[2]).padStart(c[2]) : t.slice(0, c[2]).padEnd(c[2]);
        for (let j = 0; j < c[2]; j++) u[o + j] = t.charCodeAt(j);
        o += c[2];
      });
    });
    u[u.length - 1] = 0x1a;
    return u;
  }
  // anel no sentido horário (exigência do formato para o contorno externo), fechado
  function anel(poly) {
    const p = poly.map(q => [q.lon, q.lat]);
    let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
    if (a > 0) p.reverse();
    p.push([...p[0]]); return p;
  }
  function shapefile(proj, R) {
    const A = amostras(proj, R).filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon));
    if (!A.length) throw new Error('nenhuma parcela tem vértices marcados no GPS');
    const base = Exportar.semVirgula(semAcento(proj.nome)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'inventario';
    const campos = [['PARCELA', 'C', 10], ['ESTRATO', 'C', 40], ['LAT', 'N', 13, 7], ['LON', 'N', 13, 7], ['AREA_M2', 'N', 10, 1], ['VOL_HA', 'N', 12, 4]];
    const lin = a => [a.numero, a.estrato, a.lat, a.lon, a.area, a.vha];
    const z = XLSX.CFB.utils.cfb_new();
    const por = (nome, s, d) => {
      XLSX.CFB.utils.cfb_add(z, `/${nome}.shp`, s.shp); XLSX.CFB.utils.cfb_add(z, `/${nome}.shx`, s.shx); XLSX.CFB.utils.cfb_add(z, `/${nome}.dbf`, d);
      XLSX.CFB.utils.cfb_add(z, `/${nome}.prj`, new TextEncoder().encode(PRJ)); XLSX.CFB.utils.cfb_add(z, `/${nome}.cpg`, new TextEncoder().encode('ISO-8859-1'));
    };
    por(`${base}_amostras_pontos`, shp(1, A.map(a => [a.lon, a.lat])), dbf(campos, A.map(lin)));
    const P = A.filter(a => a.poly);
    if (P.length) por(`${base}_parcelas_poligonos`, shp(5, P.map(a => anel(a.poly))), dbf(campos, P.map(lin)));
    const out = XLSX.CFB.write(z, { fileType: 'zip', type: 'array', compression: true });
    return new Blob([out], { type: 'application/zip' });
  }

  root.Sinaflor = { planilha, shapefile, dados, porEspecie, textoEquacao, amostras };
})(window);
