/* Relatório técnico do inventário em Word (.docx), gerado no próprio aparelho, sem internet.
   O arquivo é montado direto no formato do Word (OOXML) e compactado com o zip da SheetJS.
   Onde falta informação que o app não tem (relevo, solo, fonte das equações…), o texto sai
   entre colchetes e marcado em amarelo, para o responsável técnico completar. */
(function (root) {
  'use strict';
  const X = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const br = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const dataBR = t => new Date(t).toLocaleDateString('pt-BR');
  const CM = 360000;                       // EMU por centímetro
  const LARG = 9071;                       // largura útil em twips (A4, margens 3 cm e 2 cm)

  // ---------- peças do documento ----------
  // texto com trechos [entre colchetes] destacados em amarelo
  function runs(texto, o = {}) {
    const partes = String(texto ?? '').split(/(\[[^\]]+\])/);
    return partes.filter(p => p !== '').map(p => run(p, { ...o, marca: /^\[.*\]$/.test(p) || o.marca })).join('');
  }
  function run(t, o = {}) {
    const pr = [o.b && '<w:b/>', o.i && '<w:i/>', o.sz && `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>`, o.cor && `<w:color w:val="${o.cor}"/>`,
      o.marca && '<w:highlight w:val="yellow"/>', o.sup && '<w:vertAlign w:val="superscript"/>'].filter(Boolean).join('');
    return String(t).split('\n').map((l, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${X(l)}</w:t></w:r>`).join('');
  }
  function par(conteudo, o = {}) {
    const pr = [o.estilo && `<w:pStyle w:val="${o.estilo}"/>`, o.manter && '<w:keepNext/>', o.quebra && '<w:pageBreakBefore/>',
      (o.antes != null || o.depois != null) && `<w:spacing w:before="${o.antes ?? 0}" w:after="${o.depois ?? 120}"/>`,
      o.recuo && `<w:ind w:left="${o.recuo}"/>`, o.jc && `<w:jc w:val="${o.jc}"/>`].filter(Boolean).join('');
    const c = Array.isArray(conteudo) ? conteudo.join('') : (conteudo.startsWith('<w:r') ? conteudo : runs(conteudo, o));
    return `<w:p>${pr ? `<w:pPr>${pr}</w:pPr>` : ''}${c}</w:p>`;
  }
  const P = (t, o) => par(t, { jc: 'both', ...o });
  const H1 = t => par(run(t), { estilo: 'Titulo1', manter: true });
  const H2 = t => par(run(t), { estilo: 'Titulo2', manter: true });
  const legenda = t => par(run(t, { i: true, sz: 18 }), { jc: 'center', antes: 60, depois: 200 });
  const marcador = t => par(runs(t), { estilo: 'Lista', jc: 'both', depois: 60 });

  // tabela: cab = [títulos]; linhas = [[...]]; larg = proporções das colunas; al = 'l'|'r'|'c' por coluna
  function tabela(cab, linhas, larg, o = {}) {
    const soma = larg.reduce((s, x) => s + x, 0), W = larg.map(x => Math.round(x / soma * LARG));
    const sz = o.sz || 18, al = o.al || [];
    const cel = (v, i, cabec, destaque) => {
      const jc = cabec ? 'center' : ({ r: 'right', c: 'center' }[al[i]] || 'left');
      const sh = cabec ? '<w:shd w:val="clear" w:color="auto" w:fill="DDE8D5"/>' : destaque ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${W[i]}" w:type="dxa"/>${sh}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="20" w:after="20"/><w:jc w:val="${jc}"/></w:pPr>${runs(v ?? '', { sz, b: cabec || destaque })}</w:p></w:tc>`;
    };
    const lin = (l, cabec, destaque) => `<w:tr>${cabec ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${l.map((v, i) => cel(v, i, cabec, destaque)).join('')}</w:tr>`;
    const borda = k => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="8C8C8C"/>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="${LARG}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borda).join('')}</w:tblBorders>
      <w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>
      <w:tblGrid>${W.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${lin(cab, true)}${linhas.map((l, i) => lin(l, false, o.totalUltima && i === linhas.length - 1)).join('')}</w:tbl>${par('', { depois: 120 })}`;
  }

  // ---------- imagens ----------
  const midias = [];
  function dimensoes(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => rej(new Error('imagem inválida')); im.src = src; });
  }
  const b64bytes = b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function imagem(dados, ext, larguraCm, alturaMaxCm) {
    const url = typeof dados === 'string' ? dados : URL.createObjectURL(dados);
    const d = await dimensoes(url);
    const bytes = typeof dados === 'string' ? b64bytes(dados.split(',')[1]) : new Uint8Array(await dados.arrayBuffer());
    if (typeof dados !== 'string') URL.revokeObjectURL(url);
    const id = midias.length + 1, rid = `rIdImg${id}`, nome = `imagem${id}.${ext}`;
    midias.push({ rid, nome, bytes });
    let cx = larguraCm * CM, cy = cx * d.h / d.w;
    if (alturaMaxCm && cy > alturaMaxCm * CM) { cy = alturaMaxCm * CM; cx = cy * d.w / d.h; }
    cx = Math.round(cx); cy = Math.round(cy);
    return par(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${nome}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${nome}"/><pic:cNvPicPr/></pic:nvPicPr>
      <pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
      <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { jc: 'center', manter: true, antes: 120, depois: 0 });
  }

  // ---------- partes fixas do pacote ----------
  const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Titulo"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/><w:color w:val="1B5E20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titulo1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="1B5E20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titulo2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="2E7D32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Lista"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:ind w:left="567" w:hanging="283"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Rodape"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="16"/><w:color w:val="666666"/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TabelaNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
  const NUMERACAO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="567" w:hanging="283"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const rodape = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Rodape"/></w:pPr>
<w:r><w:t xml:space="preserve">Página </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>
<w:r><w:t xml:space="preserve"> de </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const cabecalho = t => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Rodape"/><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">${X(t)}</w:t></w:r></w:p></w:hdr>`;

  // ---------- texto do relatório ----------
  const FINALIDADE = {
    cerrado: 'subsidiar o pedido de autorização para supressão de vegetação nativa junto ao órgão ambiental',
    eucalipto: 'estimar o volume de madeira do povoamento para fins de colheita, comercialização e controle'
  };

  async function gerar(proj, parcelas, pontos, fotos, R) {
    midias.length = 0;
    const rel = proj.relatorio || {}, Pm = R.p, E = R.est, euc = proj.tipo === 'eucalipto';
    const f = (v, ph) => (v && String(v).trim()) ? String(v).trim() : `[${ph}]`;
    const usadas = R.porParcela, n = E.n, aP = Pm.areaParcela, amostraHa = n * aP / 10000;
    const estr = R.estrat && !R.estrat.semErro ? R.estrat : null;
    const fis = euc ? [] : [...new Set(usadas.map(x => App.fisionomiaDe(proj, x.pc)))];
    const nomeFis = k => (Calc.EQUACOES[k] || {}).nome || k;
    const datas = parcelas.map(p => p.criado).filter(Boolean).sort((a, b) => a - b);
    const periodo = datas.length ? (dataBR(datas[0]) === dataBR(datas[datas.length - 1]) ? dataBR(datas[0]) : `${dataBR(datas[0])} a ${dataBR(datas[datas.length - 1])}`) : '[informar]';
    const equipe = [...new Set(parcelas.map(p => p.autor).filter(Boolean))].join(', ');
    const cent = (() => {
      const L = usadas.map(x => x.geo?.c).filter(c => c && Number.isFinite(c.lat));
      if (!L.length) { const e = (proj.estratos || []).flatMap(s => s.coords || []); if (!e.length) return null; L.push(...e); }
      const lat = L.reduce((s, c) => s + c.lat, 0) / L.length, lon = L.reduce((s, c) => s + c.lon, 0) / L.length;
      const u = Geo.paraUTM(lat, lon, proj.zonaUTM || Geo.zonaDe(lon));
      return { lat, lon, u };
    })();
    const finalidade = f(rel.finalidade || FINALIDADE[euc ? 'eucalipto' : 'cerrado'], 'informar a finalidade');
    let fig = 0, tab = 0;
    const T = t => par(run(`Tabela ${++tab} – ${t}`, { i: true, sz: 18 }), { jc: 'center', antes: 120, depois: 60, manter: true });
    const b = [];

    // capa / identificação
    b.push(par(run('RELATÓRIO TÉCNICO DE INVENTÁRIO FLORESTAL'), { estilo: 'Titulo' }));
    b.push(par(run(euc ? 'Povoamento de eucalipto' : `Vegetação nativa — ${fis.map(nomeFis).join(' e ') || 'Cerrado'}`, { b: true, sz: 24 }), { jc: 'center', depois: 60 }));
    b.push(par(runs(`${f(rel.propriedade, 'nome do imóvel')} — ${f(rel.municipio, 'município/UF')}`, { sz: 22 }), { jc: 'center', depois: 360 }));

    b.push(H1('1. Identificação'));
    const ident = [
      ['Imóvel', f(rel.propriedade, 'informar')], ['Município / UF', f(rel.municipio, 'informar')], ['Requerente / proprietário', f(rel.requerente, 'informar')],
      ...(rel.documento ? [['CPF / CNPJ', rel.documento]] : []), ['Inventário (nome no app)', proj.nome],
      ['Área inventariada', `${br(R.areaHa, 4)} ha`], ['Tipologia', euc ? `Povoamento de eucalipto${Pm.espacamento ? ` (espaçamento ${Pm.espacamento} m)` : ''}` : fis.map(nomeFis).join(' e ') || 'Cerrado'],
      ['Coordenada de referência (SIRGAS 2000)', cent ? `${br(cent.lat, 6)}°, ${br(cent.lon, 6)}° — UTM ${cent.u.zona}S E ${br(cent.u.E, 0)} N ${br(cent.u.N, 0)}` : '[informar]'],
      ['Período do levantamento de campo', periodo], ['Equipe de campo', equipe || '[informar]'],
      ['Responsável técnico', f(rel.responsavel, 'nome')], ['Formação / registro profissional', `${f(rel.formacao, 'formação')} — ${f(rel.registro, 'nº do registro no conselho')}`],
      ['ART', f(rel.art, 'nº da ART')]
    ];
    b.push(tabela(['Item', 'Descrição'], ident, [36, 64]));

    b.push(H1('2. Objetivo'));
    b.push(P(euc
      ? `Este relatório apresenta os resultados do inventário florestal realizado em ${br(R.areaHa, 2)} ha de povoamento de eucalipto no imóvel ${f(rel.propriedade, 'nome do imóvel')}, município de ${f(rel.municipio, 'município/UF')}, com a finalidade de ${finalidade}. O levantamento estimou o número de árvores e de fustes, a área basal e o volume de madeira, em metros cúbicos e em estéreos, com a precisão estatística correspondente.`
      : `Este relatório apresenta os resultados do inventário florestal realizado em ${br(R.areaHa, 2)} ha de vegetação nativa (${fis.map(nomeFis).join(' e ') || 'Cerrado'}) no imóvel ${f(rel.propriedade, 'nome do imóvel')}, município de ${f(rel.municipio, 'município/UF')}, com a finalidade de ${finalidade}. O levantamento estimou a densidade, a área basal e o volume de madeira, descreveu a composição florística e a estrutura horizontal da vegetação e identificou as espécies imunes de corte e as ameaçadas de extinção.`));

    b.push(H1('3. Caracterização da área'));
    b.push(P('[Descrever a localização e o acesso, o relevo, os solos, a hidrografia, o uso atual do solo e o entorno da área inventariada.]'));
    if ((proj.estratos || []).length) {
      b.push(T('Estratos (áreas) inventariados'));
      const lin = proj.estratos.map(e => [e.nome, euc ? 'Eucalipto' : nomeFis(e.fisionomia || Pm.fisionomia || 'cerrado'), br(+e.areaHa || 0, 4), String(usadas.filter(x => x.pc.estrato === e.nome).length)]);
      lin.push(['Total', '', br(R.areaHa, 4), String(n)]);
      b.push(tabela(['Estrato', euc ? 'Tipologia' : 'Fisionomia', 'Área (ha)', 'Parcelas'], lin, [38, 26, 18, 18], { al: ['l', 'l', 'r', 'r'], totalUltima: true }));
    }

    b.push(H1('4. Metodologia'));
    b.push(H2('4.1 Processo de amostragem'));
    b.push(P(`Adotou-se a amostragem casual ${estr ? 'estratificada, tendo como estratos as áreas da Tabela 1' : 'simples'}, com parcelas retangulares de ${br(Pm.comprimento, 0)} m × ${br(Pm.largura, 0)} m (${br(aP, 0)} m²). Foram medidas ${n} parcelas, que somam ${br(amostraHa, 4)} ha amostrados, o que corresponde a uma intensidade amostral de ${br(R.areaHa ? amostraHa / R.areaHa * 100 : null, 2)}% da área. Os vértices das parcelas foram georreferenciados com receptor GPS de navegação (média de várias leituras por vértice, datum SIRGAS 2000); as coordenadas estão no Anexo II.`));
    b.push(H2('4.2 Coleta de dados'));
    b.push(P(euc
      ? `Em cada parcela foi medida a circunferência à altura do peito (CAP, a 1,30 m do solo) de todos os fustes, com registro das falhas de plantio, e a altura total de parte das árvores. As alturas não medidas foram estimadas pela relação hipsométrica ln(H) = b0 + b1 · (1/DAP), ajustada para cada parcela.`
      : `Em cada parcela foram medidos todos os indivíduos arbóreos com CAP (circunferência a 1,30 m do solo) igual ou superior a ${br(Pm.capMin, 1)} cm, o que corresponde a DAP de ${br(Pm.capMin / Math.PI, 1)} cm. Registraram-se o nome popular, a circunferência de cada fuste e a altura total. Para os indivíduos com mais de um fuste, a inclusão foi decidida pela circunferência equivalente, CAPeq = √(Σ CAP²), e o volume é a soma dos volumes dos fustes. O nome científico foi atribuído a partir do nome popular, pela lista de espécies do levantamento.`));
    b.push(H2('4.3 Estimativa do volume'));
    b.push(P(`O diâmetro foi obtido por DAP = CAP / π. O volume foi estimado por: ${Sinaflor.textoEquacao(proj, R)}. A conversão para estéreo usou o fator de empilhamento de ${br(Pm.fatorEmp ?? 1.5, 2)} st/m³.`));
    b.push(P(`Fonte da(s) equação(ões): ${f(rel.fonteEquacoes, 'informar a fonte das equações de volume')}.`));
    b.push(H2('4.4 Análise estatística'));
    b.push(P(`Os volumes por parcela foram convertidos para m³/ha e analisados com ${Pm.prob ? br(Pm.prob * 100, 0) : 90}% de probabilidade e erro admissível de ${br(Pm.erroAdm * 100, 0)}% da média. Foram calculados:`));
    [`média: ȳ = Σ yᵢ / n;`, `variância: s² = Σ (yᵢ − ȳ)² / (n − ${Pm.desvio === 'populacional' ? '0' : '1'}); desvio padrão: s = √s²; coeficiente de variação: CV = s / ȳ × 100;`,
      `erro padrão da média: sȳ = (s / √n)${Pm.fpc ? ' · √(1 − n/N), com N = número de parcelas que cabem na área (correção para população finita)' : ''};`,
      `erro de amostragem absoluto: E = t · sȳ, com t de Student para n − 1 graus de liberdade; relativo: E% = E / ȳ × 100;`,
      `intervalo de confiança: ȳ ± E (por hectare) e (ȳ ± E) × A (total, sendo A a área);`,
      `número de parcelas necessárias: n = t² · CV² / (E%² + t² · CV² / N).`].forEach(t => b.push(marcador(t)));
    if (estr) b.push(P('Na amostragem estratificada, a média é ponderada pela área de cada estrato, e os graus de liberdade efetivos foram obtidos pela fórmula de Satterthwaite.'));
    if (!euc) {
      b.push(H2('4.5 Fitossociologia'));
      b.push(P('A estrutura horizontal foi descrita pelos parâmetros: densidade absoluta (DA = nᵢ / área amostrada, ind/ha) e relativa (DR); frequência absoluta (FA = % das parcelas com a espécie) e relativa (FR); dominância absoluta (DoA = área basal por hectare) e relativa (DoR); valor de cobertura, VC = (DR + DoR) / 2; e valor de importância, VI = (DR + FR + DoR) / 3. As espécies foram agrupadas em famílias segundo o APG IV, pelo gênero do nome científico.'));
      b.push(H2('4.6 Diversidade e suficiência amostral'));
      b.push(P('A diversidade foi descrita pelos índices abaixo, calculados com os indivíduos incluídos (árvores mortas e sem nome ficam de fora), sendo nᵢ o número de indivíduos da espécie i, N o total de indivíduos e S o número de espécies:'));
      ["Shannon: H' = −Σ pᵢ · ln pᵢ, com pᵢ = nᵢ / N;", "equabilidade de Pielou: J = H' / ln S;", 'Simpson: C = 1 − Σ nᵢ(nᵢ − 1) / [N(N − 1)];',
        'riqueza estimada por Jackknife de 1ª ordem: S + Q1 · (n − 1) / n, sendo Q1 o número de espécies presentes em uma só parcela e n o número de parcelas.'].forEach(t => b.push(marcador(t)));
      b.push(P('A suficiência amostral foi avaliada pela curva espécie × área: o número acumulado de espécies em função da área amostrada, como média de 200 ordens aleatórias das parcelas, para que o resultado não dependa da ordem em que foram medidas. A amostragem é considerada suficiente quando a curva tende à estabilização, isto é, quando o acréscimo de área passa a acrescentar poucas espécies novas.'));
    }
    if (!euc) b.push(H2('4.7 Espécies protegidas'));
    if (!euc) b.push(P('Os nomes científicos foram conferidos com a Lista Nacional Oficial de Espécies da Flora Ameaçadas de Extinção (Portaria GM/MMA nº 1.783, de 26 de outubro de 2026) e com as espécies declaradas imunes de corte em Minas Gerais pela Lei Estadual nº 20.308/2012 (pequizeiro, Caryocar brasiliense, e ipê-amarelo).'));

    // ----- resultados -----
    b.push(H1('5. Resultados'));
    b.push(H2('5.1 Estatística do inventário'));
    if (n < 2) b.push(P('[Há menos de duas parcelas no cálculo: sem estatística.]'));
    else {
      const linhas = [
        ['Número de parcelas (n)', String(n)], ['Área amostrada (ha)', br(amostraHa, 4)], ['Média (m³/ha)', br(E.media, 4)], ['Desvio padrão (m³/ha)', br(E.desvio, 4)],
        ['Coeficiente de variação (%)', br(E.cv, 2)], ['Erro padrão da média (m³/ha)', br(E.sx, 4)], ['t de Student', br(E.t, 4)],
        ['Erro de amostragem absoluto (m³/ha)', br(E.erroAbs, 4)], ['Erro de amostragem relativo (%)', br(E.erroRel, 2)],
        ['Intervalo de confiança (m³/ha)', `${br(E.icMin, 2)} a ${br(E.icMax, 2)}`], ['Volume total estimado (m³)', br(E.total, 2)],
        ['Intervalo de confiança do total (m³)', `${br(E.totalMin, 2)} a ${br(E.totalMax, 2)}`], ['Volume total estimado (st)', br(E.totalSt, 2)],
        ['Parcelas necessárias para o erro admissível', String(E.parcelasNecessarias ?? '—')]];
      b.push(T(`Estatística do inventário (amostragem casual simples, ${br(Pm.prob * 100, 0)}% de probabilidade)`));
      b.push(tabela(['Parâmetro', 'Valor'], linhas, [62, 38], { al: ['l', 'r'] }));
    }
    if (R.estrat) {
      b.push(H2('5.2 Resultados por estrato'));
      const L = R.estrat.estratos.map(l => [l.nome, br(l.areaHa, 4), String(l.n), l.n ? br(l.media, 2) : '—', l.n ? br(l.total, 2) : `${br(R.estrat.media * l.areaHa, 2)}*`]);
      L.push(['Estratificado', br(R.estrat.areaTotal, 4), String(n), br(R.estrat.media, 2), br(R.estrat.total, 2)]);
      b.push(T('Volume por estrato'));
      b.push(tabela(['Estrato', 'Área (ha)', 'Parcelas', 'Média (m³/ha)', 'Total (m³)'], L, [34, 16, 14, 18, 18], { al: ['l', 'r', 'r', 'r', 'r'], totalUltima: true }));
      b.push(P(R.estrat.semErro ? `[${R.estrat.semErro}]` : `Erro de amostragem estratificado: ${br(R.estrat.erroRel, 2)}% (graus de liberdade efetivos ${br(R.estrat.gl, 1)}; t = ${br(R.estrat.t, 3)}).${R.estrat.estratos.some(l => !l.n) ? ' * Estrato sem parcela: recebeu a média estratificada.' : ''}`));
    }
    let sec = R.estrat ? 3 : 2;
    b.push(H2(`5.${sec++} Resultados por parcela`));
    b.push(T('Resultados por parcela'));
    b.push(tabela(['Parcela', 'Estrato', euc ? 'Fustes' : 'Indivíduos', 'G (m²/ha)', 'V (m³/ha)'],
      usadas.map(x => [x.pc.numero, x.pc.estrato || '—', String(euc ? x.r.nFustes : x.r.nIncluidas), br(x.r.ha.g, 3), br(R.vha(x), 3)]), [14, 36, 16, 17, 17], { al: ['c', 'l', 'r', 'r', 'r'], sz: 17 }));

    const protegidas = [];
    if (!euc && R.fito) {
      b.push(H2(`5.${sec++} Composição florística e fitossociologia`));
      const nInd = R.fito.reduce((s, x) => s + x.N, 0);
      b.push(P(`Foram amostrados ${nInd} indivíduos de ${R.fito.length} espécies (nomes populares), em ${n} parcelas. A Tabela ${tab + 1} traz os parâmetros fitossociológicos, em ordem decrescente de valor de importância.`));
      b.push(T('Parâmetros fitossociológicos'));
      b.push(tabela(['Nome popular', 'Nome científico', 'N', 'DA', 'DR%', 'FR%', 'DoR%', 'VI%', 'V (m³)'],
        R.fito.map(s => [s.nome, App.cientifico(proj, s.nome).replace(/\s*\(conferir\)/, '') || '—', String(s.N), br(s.DA, 1), br(s.DR, 2), br(s.FR, 2), br(s.DoR, 2), br(s.VI, 2), br(s.V, 4)]),
        [19, 23, 6, 8, 8, 8, 8, 8, 12], { al: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'], sz: 15 }));
      b.push(H2(`5.${sec++} Volume por espécie`));
      const esp = Sinaflor.porEspecie(proj, R), tot = esp.reduce((s, l) => s + (l[5] || 0), 0);
      b.push(T('Volume estimado por espécie para a área total'));
      b.push(tabela(['Nome popular', 'Nome científico', 'V amostra (m³)', 'V na área (m³)', 'V na área (st)'],
        [...esp.map(l => [l[2], l[1] || '—', br(l[4], 4), br(l[5], 2), br(l[6], 2)]), ['Total', '', br(esp.reduce((s, l) => s + (l[4] || 0), 0), 4), br(tot, 2), br(tot * (Pm.fatorEmp ?? 1.5), 2)]],
        [24, 30, 15, 15, 16], { al: ['l', 'l', 'r', 'r', 'r'], sz: 16, totalUltima: true }));
      if (estr) b.push(P('O volume por espécie foi extrapolado pela razão entre a área total e a área amostrada; por isso a soma pode diferir ligeiramente do total da amostragem estratificada.'));
      if (R.familias) {
        const det = R.familias.filter(x => x.familia !== 'Indeterminada');
        b.push(H2(`5.${sec++} Composição por família`));
        b.push(P(`As ${R.fito.length} espécies distribuem-se em ${det.length} famílias botânicas.${det.length ? ` As de maior número de indivíduos são ${det.slice(0, 3).map(x => `${x.familia} (${x.N} indivíduos, ${x.especies} espécie${x.especies > 1 ? 's' : ''})`).join(', ')}.` : ''}${det.length < R.familias.length ? ' Indeterminada = espécie sem nome científico ou de gênero não classificado [completar].' : ''}`));
        b.push(T('Composição florística por família'));
        b.push(tabela(['Família', 'Espécies', '% espécies', 'Indivíduos', '% indivíduos', '% área basal'],
          R.familias.map(x => [x.familia, String(x.especies), br(x.pS, 1), String(x.N), br(x.pN, 1), br(x.pG, 1)]), [30, 13, 14, 14, 15, 14], { al: ['l', 'r', 'r', 'r', 'r', 'r'], sz: 17 }));
      }
      if (R.div) {
        const D = R.div;
        b.push(H2(`5.${sec++} Diversidade e suficiência amostral`));
        b.push(T('Índices de diversidade'));
        b.push(tabela(['Índice', 'Valor'], [['Riqueza observada (S)', String(D.S)], ['Indivíduos (N)', String(D.N)], ["Shannon (H')", br(D.H, 3)], ["H' máximo (ln S)", br(D.Hmax, 3)],
          ['Equabilidade de Pielou (J)', D.J != null ? br(D.J, 3) : '—'], ['Simpson (C)', D.C != null ? br(D.C, 3) : '—'], ['Riqueza estimada (Jackknife 1ª ordem)', br(D.jack1, 1)]], [70, 30], { al: ['l', 'r'] }));
        b.push(P(`Foram registradas ${D.S} espécies, para uma riqueza estimada de ${br(D.jack1, 0)} espécies pelo Jackknife de 1ª ordem (${D.Q1} espécie${D.Q1 === 1 ? ' ocorreu' : 's ocorreram'} em uma só parcela). O índice de Shannon foi de ${br(D.H, 2)} nats/indivíduo, e a equabilidade de Pielou, de ${D.J != null ? br(D.J, 2) : '—'}. [Comparar com outros levantamentos da mesma fisionomia na região.]`));
        if (D.n >= 3) {
          try { b.push(await imagem(await curvaPNG(D), 'png', 14, 9)); b.push(legenda(`Figura ${++fig} – Curva espécie × área: média de 200 ordens aleatórias das parcelas (linha cheia) e ordem de medição (tracejada).`)); }
          catch (e) { /* sem canvas: fica só o texto */ }
          b.push(P(`Os últimos ${br(D.areaFinal, 0)}% da área amostrada acrescentaram ${br(D.acrescimo10, 1)}% ao número de espécies da curva média, e as ${D.S} espécies observadas correspondem a ${br(D.pctEstimado, 0)}% da riqueza estimada. ${D.estabilizando ? 'A curva tende à estabilização, o que indica que a amostragem representou bem a riqueza da vegetação.' : 'A curva ainda não se estabilizou: novas parcelas tenderiam a acrescentar espécies. [Avaliar a suficiência amostral e a necessidade de complementar a amostragem.]'}`));
        } else b.push(P('[Com menos de três parcelas não há curva espécie × área.]'));
      }
      R.fito.forEach(s => {
        const im = App.imune(s.nome), am = App.ameaca(proj, s.nome);
        if (im || (am && !am.genero)) protegidas.push({ s, im, am: am && !am.genero ? am : null });
      });
    }
    if (R.classes?.length) {
      b.push(H2(`5.${sec++} Distribuição diamétrica`));
      b.push(T('Distribuição em classes de DAP'));
      b.push(tabela(['Classe de DAP (cm)', euc ? 'Nº de fustes' : 'Nº de indivíduos', '% do número', '% do volume'],
        R.classes.map(c => [`${c.min} a ${c.max}`, String(c.n), br(c.pn, 1), br(c.pv, 1)]), [34, 22, 22, 22], { al: ['c', 'r', 'r', 'r'] }));
    }
    if (!euc) {
      b.push(H2(`5.${sec++} Espécies imunes de corte e ameaçadas de extinção`));
      const pts = pontos.filter(p => p.tipo === 'arvore' && p.situacao && Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (!protegidas.length && !pts.length) b.push(P('Não foram registradas, nas parcelas, espécies imunes de corte (Lei MG nº 20.308/2012) nem espécies da Lista Nacional Oficial de Espécies da Flora Ameaçadas de Extinção (Portaria GM/MMA nº 1.783/2026), dentro do recorte de espécies conferido pelo app. [Confirmar com a lista completa.]'));
      else {
        if (protegidas.length) {
          b.push(T('Espécies protegidas registradas nas parcelas'));
          b.push(tabela(['Espécie', 'Situação', 'N amostra', 'Estimativa na área (ind.)'],
            protegidas.map(({ s, im, am }) => [`${s.nome} (${App.cientifico(proj, s.nome).replace(/\s*\(conferir\)/, '') || '—'})`, [im && 'Imune de corte (Lei MG 20.308/2012)', am && `Ameaçada — ${am.catNome} (${am.cat})`].filter(Boolean).join('; '), String(s.N), br(s.DA * R.areaHa, 0)]),
            [34, 36, 12, 18], { al: ['l', 'l', 'r', 'r'], sz: 17 }));
        }
        if (pts.length) {
          b.push(P(`Foram marcados ${pts.length} ponto(s) GPS de indivíduos protegidos, listados a seguir.`));
          const z = proj.zonaUTM || Geo.zonaDe(pts[0].lon);
          b.push(tabela(['Espécie', 'Situação', 'Parcela', 'E UTM', 'N UTM'],
            pts.map(p => { const u = Geo.paraUTM(p.lat, p.lon, z); return [p.especie || p.nome || '—', p.situacao, p.parcela || '—', br(u.E, 0), br(u.N, 0)]; }),
            [22, 40, 10, 14, 14], { al: ['l', 'l', 'c', 'r', 'r'], sz: 16 }));
        }
        b.push(P('[Descrever as medidas previstas para os indivíduos protegidos (preservação no local, compensação ou outra exigida pelo órgão ambiental).]'));
      }
    }

    // mapa
    b.push(H1('6. Mapa'));
    try {
      const png = await MapaPNG.gerar(proj, [...parcelas].sort((a, c) => (parseInt(a.numero) || 0) - (parseInt(c.numero) || 0)), pontos, fotos);
      b.push(await imagem(png, 'png', 16, 20));
      b.push(legenda(`Figura ${++fig} – Áreas inventariadas, parcelas e pontos (coordenadas UTM, SIRGAS 2000).`));
    } catch (e) { b.push(P(`[Mapa não gerado: ${e.message}]`)); }

    // fotos
    if (fotos.length) {
      b.push(H1('7. Registro fotográfico'));
      const L = [...fotos].sort((a, c) => String(a.hora).localeCompare(String(c.hora)));
      const z = proj.zonaUTM;
      for (const ft of L) {
        const pc = parcelas.find(p => p.id === ft.parcelaId), pt = pontos.find(p => p.id === ft.pontoId);
        const i = pc && ft.arvoreId ? pc.arvores.findIndex(a => a.id === ft.arvoreId) : -1, a = i >= 0 ? pc.arvores[i] : null;
        const quem = a ? `${a.nome ? a.nome + ', ' : ''}árvore ${euc ? a.arvore : i + 1} da parcela ${pc.numero}` : pc ? `Parcela ${pc.numero}` : pt ? (pt.especie || pt.nome || 'Ponto') : 'Foto';
        const u = Number.isFinite(ft.lat) && z ? Geo.paraUTM(ft.lat, ft.lon, z) : null;
        try { b.push(await imagem(ft.data, 'jpeg', 12, 11)); } catch (e) { continue; }
        b.push(legenda(`Figura ${++fig} – ${ft.legenda ? ft.legenda + ' — ' : ''}${quem}. ${ft.hora ? ft.hora.slice(0, 16).replace('T', ' ') : ''}${u ? ` · UTM ${u.zona}S E ${br(u.E, 0)} N ${br(u.N, 0)}` : ''}`));
      }
    }

    // conclusão
    b.push(H1(`${fotos.length ? 8 : 7}. Considerações finais`));
    if (n >= 2) {
      const er = estr ? estr.erroRel : E.erroRel, atende = er <= Pm.erroAdm * 100;
      const tot = estr ? estr.total : E.total, tMin = estr ? tot * (1 - er / 100) : E.totalMin, tMax = estr ? tot * (1 + er / 100) : E.totalMax;
      b.push(P(`Com ${n} parcelas, o inventário apresentou erro de amostragem de ${br(er, 2)}% a ${br(Pm.prob * 100, 0)}% de probabilidade, ${atende ? 'dentro do' : 'acima do'} limite de ${br(Pm.erroAdm * 100, 0)}% adotado${atende ? '' : ` [justificar ou complementar a amostragem: seriam necessárias cerca de ${E.parcelasNecessarias} parcelas]`}. O volume de madeira estimado para os ${br(R.areaHa, 2)} ha é de ${br(estr ? estr.total : E.total, 2)} m³ (${br((estr ? estr.total : E.total) * (Pm.fatorEmp ?? 1.5), 2)} st), com média de ${br(estr ? estr.media : E.media, 2)} m³/ha e intervalo de confiança de ${br(tMin, 2)} a ${br(tMax, 2)} m³ para o total${estr ? ' (amostragem estratificada)' : ''}.`));
    } else b.push(P('[Completar após a medição de pelo menos duas parcelas.]'));
    if (!euc && protegidas.length) b.push(P(`Foram registradas espécies protegidas (${protegidas.map(x => x.s.nome).join(', ')}), que exigem as medidas descritas no item 5.`));
    b.push(P('[Acrescentar as conclusões e recomendações do responsável técnico.]'));

    // assinatura
    b.push(par(runs(`${f(rel.local, 'cidade')}, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.`), { jc: 'right', antes: 480, depois: 720 }));
    b.push(par(run('_______________________________________________'), { jc: 'center', depois: 0 }));
    b.push(par(runs(f(rel.responsavel, 'nome do responsável técnico'), { b: true }), { jc: 'center', depois: 0 }));
    b.push(par(runs(`${f(rel.formacao, 'formação')} — ${f(rel.registro, 'registro')}`), { jc: 'center', depois: 0 }));
    b.push(par(runs(`ART nº ${f(rel.art, 'número')}`), { jc: 'center' }));

    // anexos
    b.push(par(run('ANEXO I – DADOS DE CAMPO'), { estilo: 'Titulo1', quebra: true }));
    if (euc) {
      const L = []; usadas.forEach(({ pc, r: rp }) => { const c = {}; pc.arvores.forEach(s => { c[s.arvore] = (c[s.arvore] || 0) + 1; const fu = rp.fustes.find(x => x.id === s.id);
        L.push([pc.numero, String(s.arvore), s.falha ? 'falha' : String(c[s.arvore]), s.CAP != null ? br(s.CAP, 1) : '—', s.CAP ? br(s.CAP / Math.PI, 1) : '—', s.H != null ? br(s.H, 1) : '—', fu ? br(fu.hSimpl ?? fu.hEst, 1) : '—']); }); });
      b.push(tabela(['Parcela', 'Árvore', 'Fuste', 'CAP (cm)', 'DAP (cm)', 'H medida (m)', 'H usada (m)'], L, [12, 12, 12, 16, 16, 16, 16], { al: ['c', 'c', 'c', 'r', 'r', 'r', 'r'], sz: 15 }));
    } else {
      const L = []; usadas.forEach(({ pc, r: rp }) => rp.arvores.forEach(({ t, c }, i) => L.push([pc.numero, String(i + 1), t.nome || '—', App.cientifico(proj, t.nome).replace(/\s*\(conferir\)/, '') || '—',
        [t.CAP, ...(t.fustesExtras || [])].filter(v => v != null).map(v => br(v, 1)).join(' + '), br(c.dap, 1), t.H != null ? br(t.H, 1) : '—', c.incluida ? br(c.v, 4) : 'não incluída'])));
      b.push(tabela(['Parc.', 'Nº', 'Nome popular', 'Nome científico', 'CAP (cm)', 'DAP (cm)', 'H (m)', 'V (m³)'], L, [7, 6, 18, 23, 14, 10, 8, 14], { al: ['c', 'c', 'l', 'l', 'r', 'r', 'r', 'r'], sz: 14 }));
    }
    b.push(par(run('ANEXO II – COORDENADAS DOS VÉRTICES DAS PARCELAS'), { estilo: 'Titulo1', quebra: true }));
    const V = []; parcelas.slice().sort((a, c) => (parseInt(a.numero) || 0) - (parseInt(c.numero) || 0)).forEach(pc => {
      App.verticesOrdenados(proj, pc).forEach((v, i) => V.push([pc.numero, `V${i + 1}${v.gerado ? ' (gerado)' : ''}`, br(v.lat, 7), br(v.lon, 7), br(v.E, 2), br(v.N, 2), v.acc != null ? br(v.acc, 1) : '—']));
    });
    b.push(P(`Datum SIRGAS 2000; projeção UTM, zona ${proj.zonaUTM || '—'}S.`));
    b.push(V.length ? tabela(['Parcela', 'Vértice', 'Latitude', 'Longitude', 'E (m)', 'N (m)', 'Precisão (m)'], V, [11, 15, 16, 16, 14, 16, 12], { al: ['c', 'l', 'r', 'r', 'r', 'r', 'r'], sz: 15 }) : P('[Sem vértices marcados no GPS.]'));

    // ----- pacote -----
    const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdCab"/><w:footerReference w:type="default" r:id="rIdRod"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="567" w:gutter="0"/></w:sectPr>`;
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${b.join('\n')}${sect}</w:body></w:document>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdEst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
<Relationship Id="rIdCab" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdRod" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
${midias.map(m => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.nome}"/>`).join('\n')}
</Relationships>`;
    const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
    const raiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
    const agoraISO = new Date().toISOString().slice(0, 19) + 'Z';
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${X('Relatório de inventário florestal — ' + proj.nome)}</dc:title><dc:creator>${X(rel.responsavel || 'Inventário Florestal')}</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${agoraISO}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${agoraISO}</dcterms:modified></cp:coreProperties>`;
    const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Inventario Florestal</Application></Properties>`;
    const enc = s => new TextEncoder().encode(s);
    const C = XLSX.CFB, z = C.utils.cfb_new();
    [['[Content_Types].xml', tipos], ['_rels/.rels', raiz], ['docProps/core.xml', core], ['docProps/app.xml', app], ['word/document.xml', doc], ['word/_rels/document.xml.rels', rels],
      ['word/styles.xml', ESTILOS], ['word/numbering.xml', NUMERACAO], ['word/header1.xml', cabecalho(`Inventário florestal — ${proj.nome}`)], ['word/footer1.xml', rodape()]]
      .forEach(([nome, txt]) => C.utils.cfb_add(z, '/' + nome, enc(txt)));
    midias.forEach(m => C.utils.cfb_add(z, '/word/media/' + m.nome, m.bytes));
    const out = C.write(z, { fileType: 'zip', type: 'array', compression: true });
    return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  // curva espécie × área em PNG para o Word
  function curvaPNG(D) {
    const W = 1400, H = 860, m = { l: 150, r: 50, t: 60, b: 130 }, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), xs = D.curva.map(c => c.areaHa), xm = xs[xs.length - 1];
    const ymax = Math.max(1, Math.ceil(Math.max(...D.curva.map(c => Math.max(c.media, c.observada))) / 5) * 5);
    const X = v => m.l + v / xm * (W - m.l - m.r), Y = v => H - m.b - v / ymax * (H - m.t - m.b);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.font = '30px Arial'; g.fillStyle = '#333'; g.strokeStyle = '#ddd'; g.lineWidth = 2;
    for (let k = 0; k <= 5; k++) {
      const v = ymax * k / 5; g.beginPath(); g.moveTo(m.l, Y(v)); g.lineTo(W - m.r, Y(v)); g.stroke();
      g.textAlign = 'right'; g.fillText(String(Math.round(v)), m.l - 14, Y(v) + 10);
      const a = xm * k / 5; g.textAlign = 'center'; g.fillText(a.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), X(a), H - m.b + 42);
    }
    g.strokeStyle = '#555'; g.beginPath(); g.moveTo(m.l, m.t); g.lineTo(m.l, H - m.b); g.lineTo(W - m.r, H - m.b); g.stroke();
    g.textAlign = 'center'; g.fillText('Área amostrada acumulada (ha)', (m.l + W - m.r) / 2, H - 30);
    g.save(); g.translate(48, (m.t + H - m.b) / 2); g.rotate(-Math.PI / 2); g.fillText('Número de espécies', 0, 0); g.restore();
    const linha = (k, cor, larg, tracos) => { g.strokeStyle = cor; g.lineWidth = larg; g.setLineDash(tracos); g.beginPath(); D.curva.forEach((c, i) => i ? g.lineTo(X(c.areaHa), Y(c[k])) : g.moveTo(X(c.areaHa), Y(c[k]))); g.stroke(); g.setLineDash([]); };
    linha('observada', '#9e9e9e', 4, [14, 10]); linha('media', '#2e7d32', 7, []);
    g.fillStyle = '#2e7d32'; D.curva.forEach(c => { g.beginPath(); g.arc(X(c.areaHa), Y(c.media), 8, 0, 7); g.fill(); });
    g.textAlign = 'left'; g.fillStyle = '#2e7d32'; g.fillText('— média de 200 ordens aleatórias', m.l + 30, m.t + 30);
    g.fillStyle = '#777'; g.fillText('- - ordem de medição', m.l + 30, m.t + 72);
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }

  root.Relatorio = { gerar };
})(window);
