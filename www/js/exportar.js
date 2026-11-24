/* Exportação: XLSX, CSV, KML, GeoJSON e backup (JSON). */
(function (root) {
  'use strict';
  const semVirgula = s => String(s).replace(/,/g, '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '_');
  const hoje = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const nomeArquivo = (proj, sufixo, ext) => `${semVirgula(proj.nome)}_${sufixo}_${hoje()}.${ext}`;
  const r = (v, d = 4) => (v == null || isNaN(v)) ? null : Math.round(v * 10 ** d) / 10 ** d;

  async function entregar(blob, nome) {
    if (Plataforma.nativo) {
      const r = await Plataforma.salvarArquivo(blob, nome);
      const m = App.modal(`<h3>Arquivo salvo</h3><p>${r.local ? `Em <b>${r.local}</b>` : 'Na pasta do app'}</p><p class="mudo">${nome}</p>
        <div class="botoes"><button class="sec" data-m="ok">OK</button><button data-m="enviar">Enviar…</button></div>`);
      m.addEventListener('click', async e => {
        const a = e.target.dataset.m; if (!a) return; m.remove();
        if (a === 'enviar') { try { await Plataforma.compartilhar(r.uri, nome); } catch (err) { App.toast('Não deu para enviar: ' + err.message, 'erro'); } }
      });
      return;
    }
    const file = new File([blob], nome, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: nome }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function utm(lat, lon, zona) { const u = Geo.paraUTM(lat, lon, zona); return [r(u.E, 2), r(u.N, 2)]; }

  // ---------- XLSX ----------
  function planilhaXLSX(proj, parcelas, pontos, R) {
    const wb = XLSX.utils.book_new();
    const add = (nome, linhas) => {
      const ws = XLSX.utils.aoa_to_sheet(linhas);
      ws['!cols'] = (linhas[0] || []).map((_, i) => ({ wch: Math.min(40, Math.max(10, ...linhas.slice(0, 60).map(l => String(l[i] ?? '').length + 2))) }));
      XLSX.utils.book_append_sheet(wb, ws, nome);
    };
    const P = proj.params, euc = proj.tipo === 'eucalipto', z = proj.zonaUTM;

    add('Parametros', [
      ['Parâmetro', 'Valor'],
      ['Projeto', proj.nome], ['Tipo', euc ? 'Reflorestamento (eucalipto)' : 'Cerrado nativo'],
      ['Parcela (m)', `${P.comprimento} x ${P.largura}`], ['Área da parcela (m²)', P.comprimento * P.largura],
      ...(euc ? [['Fator de forma', P.fatorForma], ['Método principal', App.METODOS[P.metodo]], ['Espaçamento', P.espacamento || '']] : [['CAP mínimo (cm)', P.capMin]]),
      ['Equação: V = b0·DAP^b1·H^b2·fator', ''], ['b0', P.eq.b0], ['b1', P.eq.b1], ['b2', P.eq.b2], ['fator', P.eq.fator],
      ['Probabilidade', P.prob], ['Erro admissível', P.erroAdm], ['Fator de empilhamento (st/m³)', P.fatorEmp],
      ['Desvio padrão', P.desvio === 'populacional' ? 'populacional' : 'amostral'], ['Correção de população finita', P.fpc ? 'sim' : 'não'],
      ['Zona UTM', `${z || ''} S — SIRGAS 2000`], ['Exportado em', new Date().toLocaleString('pt-BR')]
    ]);

    // Dados (uma linha por árvore ou fuste)
    const dados = [];
    if (euc) {
      dados.push(['Parcela', 'Estrato', 'Árvore', 'Fuste', 'Falha', 'CAP (cm)', 'DAP (cm)', 'H medida (m)', 'H estimada (m)', 'g (m²)', 'Volume II (m³)', 'Equação (m³)']);
      R.porParcela.forEach(({ pc, r: rp }) => {
        const cont = {};
        pc.arvores.forEach(s => {
          cont[s.arvore] = (cont[s.arvore] || 0) + 1;
          const f = rp.fustes.find(x => x.id === s.id);
          dados.push([pc.numero, pc.estrato || '', s.arvore, s.falha ? '' : cont[s.arvore], s.falha ? 'F' : '', s.CAP ?? '',
            s.CAP ? r(s.CAP / Math.PI, 2) : '', s.H ?? '', f ? r(f.hEst, 2) : '', s.CAP ? r(Calc.gDeCap(s.CAP), 6) : '',
            f ? r(Calc.gDeCap(f.CAP) * f.hEst * P.fatorForma, 6) : '', f ? r(Calc.volEquacao(f.CAP / Math.PI, f.hEst, P.eq), 6) : '']);
        });
      });
    } else {
      dados.push(['Parcela', 'Estrato', 'Árvore nº', 'Nome popular', 'Nome científico', 'H (m)', 'CAP (cm)', 'CAPs extras (fustes)', 'CAP equivalente (cm)', 'DAP (cm)', 'g (m²)', 'Incluída?', 'VTcc (m³)', 'Imune de corte', 'Observação']);
      R.porParcela.forEach(({ pc, r: rp }) => rp.arvores.forEach(({ t, c }, i) => dados.push([
        pc.numero, pc.estrato || '', i + 1, t.nome || '', App.cientifico(proj, t.nome), t.H ?? '', t.CAP ?? '', (t.fustesExtras || []).join(' + '),
        r(c.capEq, 2), r(c.dap, 2), r(c.g, 6), c.incluida ? 'sim' : 'não', r(c.v, 6), App.imune(t.nome) ? 'SIM' : '', t.obs || ''])));
    }
    add('Dados', dados);

    // Parcelas
    const cab = ['Parcela', 'Estrato', 'Situação', 'Nº vértices', 'Área GPS (m²)', 'Latitude centro', 'Longitude centro', 'E centro (m)', 'N centro (m)'];
    const parc = [euc ? [...cab, 'Árvores/ha', 'Fustes/ha', 'Falhas', 'CAP médio', 'H média', 'H estimada média', 'R² regressão', 'G (m²/ha)',
      'Padrão (m³/ha)', 'Árv. média H reg. (m³/ha)', 'Volume II (m³/ha)', 'Equação árv. média (m³/ha)', 'Equação por fuste (m³/ha)', 'Observação']
      : [...cab, 'Nº árvores', 'Excluídas (CAP < mín.)', 'N/ha', 'G (m²/ha)', 'V (m³/ha)', 'Observação']];
    R.porParcela.forEach(({ pc, r: rp, geo }) => {
      const base = [pc.numero, pc.estrato || '', pc.fechada ? 'fechada' : 'aberta', pc.vertices.length, geo?.area ? r(geo.area, 1) : '',
        geo?.c ? r(geo.c.lat, 7) : '', geo?.c ? r(geo.c.lon, 7) : '', geo?.c ? r(geo.cu.E, 1) : '', geo?.c ? r(geo.cu.N, 1) : ''];
      parc.push(euc ? [...base, r(rp.ha.arvores, 1), r(rp.ha.fustes, 1), rp.nFalhas, r(rp.capMed, 2), r(rp.hMed, 2), r(rp.hEstMed, 2),
        rp.regressao ? r(rp.regressao.r2, 4) : '', r(rp.ha.g, 4), r(rp.ha.padrao, 3), r(rp.ha.arvMediaReg, 3), r(rp.ha.vol2, 3), r(rp.ha.eqMedia, 3), r(rp.ha.eqFuste, 3), pc.obs || '']
        : [...base, rp.nIncluidas, rp.nExcluidas, r(rp.ha.arvores, 1), r(rp.ha.g, 4), r(rp.ha.v, 4), pc.obs || '']);
    });
    add('Parcelas', parc);

    // Estatística
    const E = R.est, A = R.antigo;
    const est = [['Estatística', 'Valor', 'Critério das planilhas antigas (desvio populacional, sem correção finita)'],
      ['Variável', euc ? `V/ha — ${App.METODOS[P.metodo]}` : 'VTcc (m³/ha)', ''],
      ['Nº de parcelas (n)', E.n, A.n], ['Área total (ha)', R.areaHa, R.areaHa], ['Média (m³/ha)', r(E.media), r(A.media)],
      ['Variância', r(E.variancia), r(A.variancia)], ['Desvio padrão', r(E.desvio), r(A.desvio)], ['CV (%)', r(E.cv, 2), r(A.cv, 2)],
      ['Erro padrão da média', r(E.sx), r(A.sx)], ['t de Student', r(E.t), r(A.t)], ['Erro de amostragem (m³/ha)', r(E.erroAbs), r(A.erroAbs)],
      ['Erro de amostragem (%)', r(E.erroRel, 2), r(A.erroRel, 2)], ['Atende ao erro admissível?', E.atende ? 'SIM' : 'NÃO', A.atende ? 'SIM' : 'NÃO'],
      ['IC (m³/ha)', `${r(E.icMin, 2)} a ${r(E.icMax, 2)}`, `${r(A.icMin, 2)} a ${r(A.icMax, 2)}`],
      ['Volume total (m³)', r(E.total, 2), r(A.total, 2)], ['IC total (m³)', `${r(E.totalMin, 1)} a ${r(E.totalMax, 1)}`, `${r(A.totalMin, 1)} a ${r(A.totalMax, 1)}`],
      ['Volume total (st)', r(E.totalSt, 1), r(A.totalSt, 1)], ['Parcelas necessárias', E.parcelasNecessarias, A.parcelasNecessarias]];
    if (R.metodos) {
      est.push([], ['Comparação dos métodos', 'm³/ha', 'Total (m³)', 'Total (st)', 'Erro (%)']);
      Object.entries(R.metodos).forEach(([k, s]) => est.push([App.METODOS[k], r(s.media, 3), r(s.total, 1), r(s.totalSt, 1), r(s.erroRel, 2)]));
    }
    if (R.estrat) {
      const S = R.estrat;
      est.push([], ['Amostragem estratificada', 'Área (ha)', 'n', 'Média (m³/ha)', 'Variância']);
      S.estratos.forEach(l => est.push([l.nome, l.areaHa, l.n, r(l.media, 3), r(l.variancia, 3)]));
      est.push(['Média estratificada (m³/ha)', r(S.media, 3)], ['Erro padrão', r(S.sx, 4)], ['GL efetivos', r(S.gl, 2)], ['t', r(S.t, 4)],
        ['Erro (%)', S.semErro || r(S.erroRel, 2)], ['Total (m³)', r(S.total, 1)], ['Total (st)', r(S.totalSt, 1)]);
    }
    add('Estatistica', est);

    if (R.fito) add('Fitossociologia', [['Nome popular', 'Nome científico', 'N', 'Parcelas', 'G (m²)', 'DA (ind/ha)', 'DR (%)', 'FA (%)', 'FR (%)', 'DoA (m²/ha)', 'DoR (%)', 'VC (%)', 'VI (%)', 'V (m³)', 'V/ha (m³/ha)', 'Imune de corte'],
      ...R.fito.map(s => [s.nome, App.cientifico(proj, s.nome), s.N, s.nParcelas, r(s.G, 5), r(s.DA, 2), r(s.DR, 2), r(s.FA, 2), r(s.FR, 2), r(s.DoA, 4), r(s.DoR, 2), r(s.VC, 2), r(s.VI, 2), r(s.V, 4), r(s.Vha, 4), App.imune(s.nome) ? 'SIM' : ''])]);
    if (R.classes) add('Classes_DAP', [['DAP (cm)', 'Nº', '% nº', '% volume'], ...R.classes.map(c => [`${c.min} a ${c.max}`, c.n, r(c.pn, 2), r(c.pv, 2)])]);

    const vert = [['Parcela', 'Vértice', 'Nome', 'Latitude', 'Longitude', 'E (m)', 'N (m)', 'Precisão (m)', 'Leituras', 'Data/hora', 'Gerado (não marcado)']];
    parcelas.forEach(pc => pc.vertices.forEach((v, i) => vert.push([pc.numero, i + 1, v.nome || '', r(v.lat, 7), r(v.lon, 7), ...utm(v.lat, v.lon, z), r(v.acc, 1), v.n || '', v.hora || '', v.gerado ? 'sim' : ''])));
    add('Vertices', vert);
    add('Pontos', [['Tipo', 'Nome / espécie', 'Situação', 'Latitude', 'Longitude', 'E (m)', 'N (m)', 'Precisão (m)', 'Data/hora', 'Parcela', 'Observação'],
      ...pontos.map(p => [p.tipo, p.especie || p.nome || '', p.situacao || '', r(p.lat, 7), r(p.lon, 7), ...utm(p.lat, p.lon, z), r(p.acc, 1), p.hora || '', p.parcela || '', p.obs || ''])]);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- CSV (uma linha por árvore/fuste) ----------
  function csv(proj, parcelas) {
    const linhas = [proj.tipo === 'eucalipto' ? ['parcela', 'estrato', 'arvore', 'falha', 'cap_cm', 'h_m'] : ['parcela', 'estrato', 'nome', 'h_m', 'cap_cm', 'caps_extras', 'obs']];
    parcelas.forEach(pc => pc.arvores.forEach(a => linhas.push(proj.tipo === 'eucalipto'
      ? [pc.numero, pc.estrato || '', a.arvore, a.falha ? 'F' : '', a.CAP ?? '', a.H ?? '']
      : [pc.numero, pc.estrato || '', a.nome || '', a.H ?? '', a.CAP ?? '', (a.fustesExtras || []).join('+'), a.obs || ''])));
    const txt = linhas.map(l => l.map(v => { const s = String(v).replace('.', ','); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n');
    return new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' });
  }

  // ---------- GeoJSON / KML ----------
  function feicoes(proj, parcelas, pontos) {
    const F = [];
    (proj.estratos || []).forEach(e => e.coords && F.push({ type: 'Feature', properties: { tipo: 'estrato', nome: e.nome, area_ha: e.areaHa },
      geometry: { type: 'Polygon', coordinates: [e.coords.map(c => [c.lon, c.lat]).concat([[e.coords[0].lon, e.coords[0].lat]])] } }));
    parcelas.forEach(pc => {
      const v = App.verticesOrdenados(proj, pc);
      if (v.length >= 3) F.push({ type: 'Feature', properties: { tipo: 'parcela', nome: `Parcela ${pc.numero}`, estrato: pc.estrato || '' },
        geometry: { type: 'Polygon', coordinates: [v.map(c => [c.lon, c.lat]).concat([[v[0].lon, v[0].lat]])] } });
      else v.forEach((c, i) => F.push({ type: 'Feature', properties: { tipo: 'vertice', nome: `P${pc.numero} V${i + 1}` }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } }));
    });
    pontos.forEach(p => F.push({ type: 'Feature', properties: { tipo: p.tipo, nome: p.especie || p.nome || '', situacao: p.situacao || '', obs: p.obs || '' },
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
    return F;
  }
  function geojson(proj, parcelas, pontos) {
    return new Blob([JSON.stringify({ type: 'FeatureCollection', features: feicoes(proj, parcelas, pontos) }, null, 1)], { type: 'application/geo+json' });
  }
  function kml(proj, parcelas, pontos) {
    const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cor = { estrato: '7d2e7d32', parcela: '7d00a5ff', arvore: 'ff0000ff', planejado: 'ffff0000', outro: 'ff00ffff', vertice: 'ff00a5ff' };
    const estilos = Object.entries(cor).map(([k, c]) => `<Style id="${k}"><LineStyle><color>${c.replace(/^7d/, 'ff')}</color><width>2</width></LineStyle><PolyStyle><color>${c}</color></PolyStyle><IconStyle><color>${c.replace(/^7d/, 'ff')}</color></IconStyle></Style>`).join('');
    const pm = feicoes(proj, parcelas, pontos).map(f => {
      const g = f.geometry, d = Object.entries(f.properties).filter(([k, v]) => v !== '' && k !== 'nome').map(([k, v]) => `${k}: ${v}`).join('\n');
      const geom = g.type === 'Point' ? `<Point><coordinates>${g.coordinates.join(',')}</coordinates></Point>`
        : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${g.coordinates[0].map(c => c.join(',')).join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      return `<Placemark><name>${x(f.properties.nome)}</name><description>${x(d)}</description><styleUrl>#${f.properties.tipo}</styleUrl>${geom}</Placemark>`;
    }).join('\n');
    return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(proj.nome)}</name>${estilos}\n${pm}\n</Document></kml>`], { type: 'application/vnd.google-earth.kml+xml' });
  }
  function backup(proj, parcelas, pontos) {
    return new Blob([JSON.stringify({ formato: 'inventario-florestal', versao: 1, exportado: new Date().toISOString(), projeto: proj, parcelas, pontos })], { type: 'application/json' });
  }

  root.Exportar = { entregar, nomeArquivo, planilhaXLSX, csv, geojson, kml, backup };
})(window);
