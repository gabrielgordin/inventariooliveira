/* Inventário Florestal — aplicativo de campo (PWA, funciona sem internet). */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const fmt = (v, d = 2) => (v == null || isNaN(v) || !isFinite(v)) ? '—' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const vIn = v => (v == null ? '' : String(v).replace('.', ','));
  const numIn = v => { if (v == null) return null; const s = String(v).trim().replace(',', '.'); if (s === '') return null; const n = +s; return isNaN(n) ? null : n; };
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const chaveEsp = s => semAcento(s).replace(/[\s-]/g, '');
  const agora = () => new Date().toLocaleString('sv-SE').slice(0, 19);

  const METODOS = {
    padrao: 'Padrão (árvore média, H medida)', arvMediaReg: 'Árvore média, H da regressão',
    vol2: 'Volume II (por fuste, H da regressão)', eqMedia: 'Equação, árvore média', eqFuste: 'Equação, por fuste'
  };
  const PRESETS = {
    eucalipto: { comprimento: 20, largura: 15, capMin: 0, fatorForma: 0.5, eq: { b0: 0.000066, b1: 2.475293, b2: 0.300022, fator: 0.981 },
      prob: 0.9, erroAdm: 0.1, fatorEmp: 1.5, desvio: 'amostral', fpc: true, metodo: 'padrao', usarHMedida: false, espacamento: '3 x 2', segundosGPS: 10 },
    cerrado: { comprimento: 20, largura: 10, capMin: 15.7, fatorForma: 0.5, eq: { b0: 6.5661e-05, b1: 2.475293, b2: 0.300022, fator: 1 },
      prob: 0.9, erroAdm: 0.1, fatorEmp: 1.5, desvio: 'amostral', fpc: true, metodo: 'padrao', usarHMedida: false, espacamento: '', segundosGPS: 10 }
  };

  const S = { view: 'home', aba: 'parcelas', projeto: null, parcelas: [], pontos: [], parcelaId: null, editando: null, extras: [], equipe: '', mapa: null };

  // ---------------- utilidades de domínio ----------------
  const imune = nome => { const n = semAcento(nome); return n ? (IMUNES.find(i => n.startsWith(i.chave)) || null) : null; };
  function cientifico(proj, nome) {
    const n = chaveEsp(nome); if (!n) return '';
    const l = (proj?.especies || []).find(e => chaveEsp(e[0]) === n && e[1]) || ESPECIES_BASE.find(e => chaveEsp(e[0]) === n);
    return l ? l[1] : '';
  }
  const params = proj => ({ ...proj.params, areaParcela: proj.params.comprimento * proj.params.largura });
  const areaTotal = proj => (proj.estratos?.length ? proj.estratos.reduce((s, e) => s + (+e.areaHa || 0), 0) : (+proj.areaHa || 0));
  const zona = (proj, ref) => proj.zonaUTM || (ref ? Geo.zonaDe(ref.lon) : 23);
  const ordNum = (a, b) => (parseInt(a.numero) || 0) - (parseInt(b.numero) || 0) || String(a.numero).localeCompare(String(b.numero));

  function estratosUTM(proj) {
    const z = zona(proj);
    return (proj.estratos || []).filter(e => e.coords?.length >= 3).map(e => ({ nome: e.nome, poly: e.coords.map(c => Geo.paraUTM(c.lat, c.lon, z)) }));
  }
  function localizar(proj, pu) {
    const L = estratosUTM(proj); if (!L.length) return null;
    const dentro = L.filter(e => Geo.dentro(pu, e.poly));
    if (dentro.length) return { dentro: true, nome: dentro[0].nome };
    let m = null; L.forEach(e => { const d = Geo.distBorda(pu, e.poly); if (!m || d < m.d) m = { nome: e.nome, d }; });
    return { dentro: false, nome: m.nome, d: m.d };
  }
  function geoParcela(proj, pc) {
    const v = (pc.vertices || []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)); if (!v.length) return null;
    const z = zona(proj, v[0]);
    const u = v.map(p => ({ ...p, ...Geo.paraUTM(p.lat, p.lon, z) }));
    const ord = u.length >= 3 ? Geo.ordenarVertices(u) : u;
    const area = u.length >= 3 ? Geo.areaPoligono(ord) : null;
    const lados = u.length >= 2 ? ord.map((p, i) => (u.length === 2 && i === 1) ? null : Geo.dist(p, ord[(i + 1) % ord.length])).filter(x => x != null) : [];
    const cu = Geo.centro(u), c = Geo.deUTM(cu.E, cu.N, z, v[0].lat < 0);
    return { ord, area, lados, cu, c, local: localizar(proj, cu) };
  }
  const verticesOrdenados = (proj, pc) => { const g = geoParcela(proj, pc); return g ? g.ord : []; };

  function calcular(proj, parcelas) {
    const p = params(proj), euc = proj.tipo === 'eucalipto';
    const usadas = parcelas.filter(x => !x.excluir).sort(ordNum);
    const porParcela = usadas.map(pc => ({ pc, r: euc ? Calc.parcelaEucalipto(pc.arvores, p) : Calc.parcelaCerrado(pc.arvores, p), geo: geoParcela(proj, pc) }));
    const vha = x => euc ? x.r.ha[p.metodo] : x.r.ha.v;
    const areaHa = areaTotal(proj);
    const o = { prob: p.prob, areaHa, areaParcela: p.areaParcela, desvio: p.desvio, fpc: p.fpc, erroAdm: p.erroAdm, fatorEmp: p.fatorEmp };
    const R = { porParcela, areaHa, p };
    R.est = Calc.estatistica(porParcela.map(vha), o);
    R.antigo = Calc.estatistica(porParcela.map(vha), { ...o, desvio: 'populacional', fpc: false });
    if (euc) {
      R.metodos = {};
      Object.keys(METODOS).forEach(k => { R.metodos[k] = Calc.estatistica(porParcela.map(x => x.r.ha[k]), o); });
      R.classes = Calc.classesDap(porParcela.flatMap(x => x.r.fustes.map(f => ({ dap: f.CAP / Math.PI, v: Calc.gDeCap(f.CAP) * f.hEst * p.fatorForma }))), 5);
    } else {
      R.fito = Calc.fitossociologia(porParcela.map(x => ({ id: x.pc.id, arvores: x.r.arvores })), p.areaParcela);
      R.classes = Calc.classesDap(porParcela.flatMap(x => x.r.arvores.filter(a => a.c.incluida).map(a => ({ dap: a.c.dap, v: a.c.v }))), 5);
    }
    if ((proj.estratos || []).length > 1) {
      R.estrat = Calc.estratificada(proj.estratos.map(e => ({ nome: e.nome, areaHa: +e.areaHa || 0, valores: porParcela.filter(x => x.pc.estrato === e.nome).map(vha) })), o);
    }
    R.vha = vha;
    return R;
  }

  // ---------------- toast e modais ----------------
  function toast(msg, tipo = '') {
    const cx = $('#toasts'); while (cx.children.length > 1) cx.firstChild.remove();
    const t = document.createElement('div'); t.className = `toast ${tipo}`; t.innerHTML = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.classList.add('sai'), tipo === 'aviso' ? 5000 : 2600); setTimeout(() => t.remove(), tipo === 'aviso' ? 5600 : 3200);
  }
  function modal(html) {
    const m = document.createElement('div'); m.className = 'modal-fundo';
    m.innerHTML = `<div class="modal">${html}</div>`; document.body.appendChild(m); return m;
  }

  // ---------------- GPS ----------------
  const GPS = {
    pos: null, erro: null, watchId: null, leituras: [],
    iniciar() {
      if (this.watchId != null) return;
      this.watchId = 1;
      Plataforma.iniciarGPS(p => {
        this.pos = p; this.erro = null; this.leituras.push(p); if (this.leituras.length > 900) this.leituras.shift(); chipGPS();
        if (S.view === 'projeto' && S.aba === 'mapa') Mapa.posicao();
      }, msg => { this.erro = msg; chipGPS(); });
    },
    capturar(segundos, titulo) {
      this.iniciar();
      return new Promise(resolve => {
        const t0 = Date.now();
        const m = modal(`<h3>${esc(titulo || 'Marcando ponto')}</h3>
          <p class="grande" id="gps-cont">Aguardando sinal…</p><p id="gps-det" class="mudo"></p>
          <p class="mudo">Fique parado no ponto. O app faz a média das leituras de ${segundos} s.</p>
          <div class="botoes"><button class="sec" data-m="cancelar">Cancelar</button><button data-m="usar">Usar agora</button></div>`);
        const fim = usar => {
          clearInterval(iv); m.remove();
          if (!usar) return resolve(null);
          const L = this.leituras.filter(p => p.timestamp >= t0 - 1500);
          if (!L.length) { if (this.pos) L.push(this.pos); else { toast('Sem sinal de GPS', 'erro'); return resolve(null); } }
          const melhor = Math.min(...L.map(p => p.coords.accuracy));
          const boas = L.filter(p => p.coords.accuracy <= Math.max(melhor * 2, 5));
          let sw = 0, la = 0, lo = 0, al = 0, na = 0;
          boas.forEach(p => { const w = 1 / Math.max(p.coords.accuracy, 1) ** 2; sw += w; la += p.coords.latitude * w; lo += p.coords.longitude * w;
            if (p.coords.altitude != null) { al += p.coords.altitude; na++; } });
          const accs = boas.map(p => p.coords.accuracy).sort((a, b) => a - b);
          resolve({ lat: la / sw, lon: lo / sw, acc: accs[Math.floor(accs.length / 2)], alt: na ? al / na : null, n: boas.length, hora: agora() });
        };
        m.addEventListener('click', e => { const a = e.target.dataset.m; if (a) fim(a === 'usar'); });
        const iv = setInterval(() => {
          const L = this.leituras.filter(p => p.timestamp >= t0 - 1500), dec = (Date.now() - t0) / 1000;
          const ac = this.pos ? this.pos.coords.accuracy : null;
          $('#gps-cont', m).textContent = L.length ? `${L.length} leituras · ${Math.max(0, Math.ceil(segundos - dec))} s` : (this.erro || 'Aguardando sinal…');
          $('#gps-det', m).textContent = ac != null ? `precisão atual ±${fmt(ac, 1)} m` : '';
          if (dec >= segundos && L.length) fim(true);
        }, 300);
      });
    }
  };
  function chipGPS() {
    const c = $('#chip-gps'); if (!c) return;
    if (GPS.erro && !GPS.pos) { c.textContent = 'GPS: ' + GPS.erro; c.className = 'chip ruim'; return; }
    if (!GPS.pos) { c.textContent = 'GPS…'; c.className = 'chip'; return; }
    const a = GPS.pos.coords.accuracy;
    c.textContent = `GPS ±${fmt(a, a < 10 ? 1 : 0)} m`; c.className = 'chip ' + (a <= 5 ? 'bom' : a <= 15 ? 'medio' : 'ruim');
  }

  // ---------------- tela mantida acesa ----------------
  let wake = null;
  async function manterTela(on) {
    if (await Plataforma.manterTela(on)) return;
    try {
      if (on && !wake && 'wakeLock' in navigator) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) { /* sem suporte */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.view === 'parcela') manterTela(true); });

  // ---------------- carga e gravação ----------------
  async function abrirProjeto(id) {
    S.projeto = await DB.pegar('projetos', id);
    S.parcelas = (await DB.porProjeto('parcelas', id)).sort(ordNum);
    S.pontos = await DB.porProjeto('pontos', id);
    S.view = 'projeto'; S.aba = S.aba || 'parcelas';
    await DB.config('ultimoProjeto', id);
    render();
  }
  const salvarProjeto = () => DB.salvar('projetos', S.projeto);
  async function salvarParcela(pc) { pc.autor = pc.autor || S.equipe; await DB.salvar('parcelas', pc); const i = S.parcelas.findIndex(x => x.id === pc.id); if (i < 0) S.parcelas.push(pc); S.parcelas.sort(ordNum); }
  async function salvarPonto(pt) { pt.autor = pt.autor || S.equipe; await DB.salvar('pontos', pt); if (!S.pontos.find(x => x.id === pt.id)) S.pontos.push(pt); }
  const parcelaAtual = () => S.parcelas.find(x => x.id === S.parcelaId);

  // ---------------- render ----------------
  function render() {
    const app = $('#app');
    const titulo = S.view === 'home' ? 'Inventário Florestal' : S.view === 'novo' ? 'Novo inventário' : S.view === 'parcela' ? `Parcela ${esc(parcelaAtual()?.numero)}` : esc(S.projeto?.nome || 'Projeto');
    const voltar = S.view !== 'home' ? `<button class="voltar" data-a="voltar" aria-label="Voltar">‹</button>` : '';
    let corpo = '';
    if (S.view === 'home') corpo = telaHome();
    else if (S.view === 'novo') corpo = telaConfig(true);
    else if (S.view === 'projeto') corpo = telaProjeto();
    else if (S.view === 'parcela') corpo = telaParcela();
    const ajustes = S.view === 'parcela' ? `<button class="engrenagem" data-a="ir-ajustes" aria-label="Ajustes do inventário" title="Ajustes do inventário (KML, estratos, parâmetros)">⚙</button>` : '';
    app.innerHTML = `<header>${voltar}<h1>${titulo}</h1><span id="chip-gps" class="chip">GPS…</span>${ajustes}</header><main>${corpo}</main>`;
    chipGPS();
    if (S.view === 'parcela') { manterTela(true); focarEntrada(); } else manterTela(false);
    if (S.view === 'projeto' && S.aba === 'mapa') Mapa.montar();
  }

  // ----- home -----
  function telaHome() {
    return `<section><div class="linha-botoes"><button data-a="novo">+ Novo inventário</button>
      <label class="botao sec">Importar backup<input type="file" accept=".json,application/json" data-a="importar-backup" hidden></label></div>
      <div id="lista-projetos" class="lista"><p class="mudo">Carregando…</p></div>
      <details class="cartao"><summary>Equipe e aparelho</summary>
        <label>Nome de quem coleta neste aparelho<input id="equipe" value="${esc(S.equipe)}" placeholder="ex.: Gabriel"></label>
        <p class="mudo">Vai junto em cada parcela, para juntar os dados de dois aparelhos depois.</p>
        <button class="sec" data-a="salvar-equipe">Salvar</button>
        <p class="mudo" id="armazenamento"></p></details>
      <p class="mudo rodape">Os dados ficam só neste aparelho. Exporte o backup ao fim de cada dia de campo.</p></section>`;
  }
  async function preencherHome() {
    const L = (await DB.todos('projetos')).sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
    const todas = await DB.todos('parcelas');
    const el = $('#lista-projetos'); if (!el) return;
    el.innerHTML = L.length ? L.map(p => {
      const n = todas.filter(x => x.projetoId === p.id).length;
      return `<button class="item" data-a="abrir" data-id="${p.id}"><b>${esc(p.nome)}</b>
        <span class="mudo">${p.tipo === 'eucalipto' ? 'Reflorestamento' : 'Cerrado'} · ${n} parcela${n === 1 ? '' : 's'} · ${new Date(p.atualizado || p.criado).toLocaleDateString('pt-BR')}</span></button>`;
    }).join('') : '<p class="mudo">Nenhum inventário ainda. Toque em "Novo inventário".</p>';
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate(); const pers = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      const a = $('#armazenamento'); if (a) a.textContent = `Armazenamento: ${fmt(e.usage / 1048576, 1)} MB usados · ${Plataforma.nativo ? 'dados guardados dentro do app' : pers ? 'protegido contra limpeza automática' : 'não protegido (instale o app na tela inicial)'}`;
    }
  }

  // ----- configuração do projeto -----
  function telaConfig(novo) {
    const pr = novo ? { nome: S.novoRasc?.nome || '', tipo: S.novoTipo || 'cerrado', params: S.novoRasc?.params || PRESETS[S.novoTipo || 'cerrado'], estratos: S.novoEstratos || [], areaHa: S.novoRasc?.areaHa } : S.projeto;
    const P = pr.params, euc = pr.tipo === 'eucalipto';
    const estr = (pr.estratos || []).map((e, i) => `<div class="estrato"><input data-estr="${i}" data-c="nome" value="${esc(e.nome)}">
      <input data-estr="${i}" data-c="areaHa" inputmode="decimal" value="${esc(String(e.areaHa).replace('.', ','))}"><span class="mudo">ha${e.coords ? ' · KML' : ''}</span>
      <button class="mini sec" data-a="del-estrato" data-i="${i}">✕</button></div>`).join('');
    return `<section class="form" id="form-config">
      ${novo ? `<div class="seletor-tipo"><button class="${!euc ? 'ativo' : 'sec'}" data-a="tipo" data-t="cerrado">Cerrado nativo</button><button class="${euc ? 'ativo' : 'sec'}" data-a="tipo" data-t="eucalipto">Reflorestamento (eucalipto)</button></div>` : ''}
      <label>Nome do inventário<input id="c-nome" value="${esc(pr.nome)}" placeholder="ex.: Faz. Bons Olhos"></label>
      <div class="grade2"><label>Parcela: comprimento (m)<input id="c-comp" inputmode="decimal" value="${vIn(P.comprimento)}"></label>
      <label>largura (m)<input id="c-larg" inputmode="decimal" value="${vIn(P.largura)}"></label></div>
      ${euc ? `<div class="grade2"><label>Fator de forma<input id="c-ff" inputmode="decimal" value="${vIn(P.fatorForma)}"></label>
        <label>Espaçamento<input id="c-esp" value="${esc(P.espacamento)}"></label></div>
        <label>Método principal (o que aparece em destaque)<select id="c-met">${Object.entries(METODOS).map(([k, v]) => `<option value="${k}" ${P.metodo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" id="c-hmed" ${P.usarHMedida ? 'checked' : ''}> Usar a altura medida quando houver (desmarcado = altura da regressão em todos os fustes, como na planilha)</label>`
        : `<label>CAP mínimo de inclusão (cm)<input id="c-capmin" inputmode="decimal" value="${vIn(P.capMin)}"></label>`}
      <fieldset><legend>Equação de volume: V = b0 · DAP^b1 · H^b2 · fator</legend>
        <div class="grade2"><label>b0<input id="c-b0" inputmode="decimal" value="${vIn(P.eq.b0)}"></label><label>b1<input id="c-b1" inputmode="decimal" value="${vIn(P.eq.b1)}"></label>
        <label>b2<input id="c-b2" inputmode="decimal" value="${vIn(P.eq.b2)}"></label><label>fator<input id="c-fat" inputmode="decimal" value="${vIn(P.eq.fator)}"></label></div></fieldset>
      <fieldset><legend>Estatística</legend>
        <div class="grade2"><label>Probabilidade (%)<input id="c-prob" inputmode="decimal" value="${vIn(P.prob * 100)}"></label>
        <label>Erro admissível (%)<input id="c-erro" inputmode="decimal" value="${vIn(P.erroAdm * 100)}"></label>
        <label>Estéreo por m³<input id="c-emp" inputmode="decimal" value="${vIn(P.fatorEmp)}"></label>
        <label>GPS: segundos de média<input id="c-seg" inputmode="numeric" value="${P.segundosGPS ?? 10}"></label></div>
        <label>Desvio padrão<select id="c-desv"><option value="amostral" ${P.desvio !== 'populacional' ? 'selected' : ''}>Amostral (n−1)</option><option value="populacional" ${P.desvio === 'populacional' ? 'selected' : ''}>Populacional (como na planilha antiga de eucalipto)</option></select></label>
        <label class="check"><input type="checkbox" id="c-fpc" ${P.fpc ? 'checked' : ''}> Correção de população finita</label></fieldset>
      <fieldset><legend>Estratos / áreas</legend>
        <p class="mudo">Importe o KML das áreas: cada polígono vira um estrato, com a área calculada, e o app passa a saber em que área cada parcela está.</p>
        <div id="estratos">${estr || '<p class="mudo">Sem estratos.</p>'}</div>
        <div class="linha-botoes"><button class="sec" data-a="add-estrato">+ Estrato</button>
        <label class="botao sec">Importar KML<input type="file" accept=".kml,application/vnd.google-earth.kml+xml" data-a="importar-kml" hidden></label></div>
        ${!(pr.estratos || []).length ? `<label>Área total (ha), se não houver estratos<input id="c-area" inputmode="decimal" value="${esc(String(pr.areaHa ?? '').replace('.', ','))}"></label>` : ''}
      </fieldset>
      <button data-a="${novo ? 'criar' : 'salvar-config'}">${novo ? 'Criar inventário' : 'Salvar configuração'}</button>
      ${novo ? '' : `<button class="perigo" data-a="apagar-projeto">Apagar este inventário</button>`}
    </section>`;
  }
  function lerConfig(base) {
    const g = id => $('#' + id), n = id => numIn(g(id)?.value);
    const P = { ...base.params, eq: { ...base.params.eq } };
    P.comprimento = n('c-comp') || P.comprimento; P.largura = n('c-larg') || P.largura;
    if (g('c-ff')) { P.fatorForma = n('c-ff') ?? P.fatorForma; P.espacamento = g('c-esp').value; P.metodo = g('c-met').value; P.usarHMedida = g('c-hmed').checked; }
    if (g('c-capmin')) P.capMin = n('c-capmin') ?? 0;
    P.eq = { b0: n('c-b0'), b1: n('c-b1'), b2: n('c-b2'), fator: n('c-fat') ?? 1 };
    P.prob = (n('c-prob') ?? 90) / 100; P.erroAdm = (n('c-erro') ?? 10) / 100; P.fatorEmp = n('c-emp') ?? 1.5; P.segundosGPS = n('c-seg') ?? 10;
    P.desvio = g('c-desv').value; P.fpc = g('c-fpc').checked;
    document.querySelectorAll('[data-estr]').forEach(inp => {
      const e = base.estratos[+inp.dataset.estr]; if (!e) return;
      if (inp.dataset.c === 'nome') e.nome = inp.value.trim(); else e.areaHa = numIn(inp.value) ?? 0;
    });
    return { nome: g('c-nome').value.trim(), params: P, areaHa: g('c-area') ? numIn(g('c-area').value) : base.areaHa };
  }

  // ----- projeto -----
  function telaProjeto() {
    const abas = [['parcelas', 'Parcelas'], ['resultados', 'Resultados'], ['pontos', 'Pontos'], ['mapa', 'Mapa'], ['exportar', 'Exportar'], ['config', '⚙ Ajustes']];
    const nav = `<nav class="abas">${abas.map(([k, v]) => `<button class="${S.aba === k ? 'ativa' : ''}" data-a="aba" data-k="${k}">${v}</button>`).join('')}</nav>`;
    let c = '';
    if (S.aba === 'parcelas') c = abaParcelas();
    else if (S.aba === 'resultados') c = abaResultados();
    else if (S.aba === 'pontos') c = abaPontos();
    else if (S.aba === 'mapa') c = `<div id="mapa"></div><div id="mapa-info" class="mudo"></div>`;
    else if (S.aba === 'exportar') c = abaExportar();
    else if (S.aba === 'config') c = telaConfig(false);
    return nav + `<section>${c}</section>`;
  }

  function resumoErro(R) {
    const E = R.est, P = R.p;
    if (E.n < 2) return `<div class="placar neutro"><b>${E.n} parcela${E.n === 1 ? '' : 's'}</b><span>São precisas pelo menos 2 para calcular o erro.</span></div>`;
    return `<div class="placar ${E.atende ? 'ok' : 'nao'}"><div><span class="mudo">Erro de amostragem</span><b>${fmt(E.erroRel, 1)}%</b><span class="mudo">meta ${fmt(P.erroAdm * 100, 0)}% a ${fmt(P.prob * 100, 0)}%</span></div>
      <div><span class="mudo">Média</span><b>${fmt(E.media, 1)}</b><span class="mudo">m³/ha</span></div>
      <div><span class="mudo">${E.atende ? 'Atende' : 'Faltam ~'}</span><b>${E.atende ? '✓' : E.faltam}</b><span class="mudo">${E.atende ? `${E.n} parcelas` : `parcelas (de ${E.parcelasNecessarias})`}</span></div></div>`;
  }

  function abaParcelas() {
    const R = calcular(S.projeto, S.parcelas);
    const euc = S.projeto.tipo === 'eucalipto';
    const linhas = S.parcelas.map(pc => {
      const x = R.porParcela.find(y => y.pc.id === pc.id), g = x?.geo || geoParcela(S.projeto, pc);
      const v = x ? R.vha(x) : null, n = euc ? x?.r.nFustes : x?.r.nIncluidas;
      const loc = g?.local ? (g.local.dentro ? '' : ` <span class="tag ruim">fora · ${fmt(g.local.d, 0)} m de ${esc(g.local.nome)}</span>`) : '';
      return `<button class="item parcela ${pc.excluir ? 'excluida' : ''}" data-a="parcela" data-id="${pc.id}">
        <b>${esc(pc.numero)}</b><span>${esc(pc.estrato || 'sem estrato')}${loc}${pc.excluir ? ' <span class="tag">fora do cálculo</span>' : ''}</span>
        <span class="num">${n ?? 0} ${euc ? 'fustes' : 'árv.'} · ${fmt(v, 1)} m³/ha ${pc.fechada ? '✓' : '<span class="tag">aberta</span>'}</span></button>`;
    }).join('');
    return `${resumoErro(R)}<button class="largo" data-a="nova-parcela">+ Nova parcela</button>
      <div class="lista">${linhas || '<p class="mudo">Nenhuma parcela lançada.</p>'}</div>`;
  }

  // ----- parcela -----
  function telaParcela() {
    const pc = parcelaAtual(); if (!pc) return '';
    const proj = S.projeto, P = params(proj), euc = proj.tipo === 'eucalipto';
    const r = euc ? Calc.parcelaEucalipto(pc.arvores, P) : Calc.parcelaCerrado(pc.arvores, P);
    const g = geoParcela(proj, pc);
    const nomEsp = [P.comprimento, P.largura];
    const ladosTxt = g?.lados?.length ? g.lados.map(l => fmt(l, 1)).join(' · ') : '';
    const areaOk = g?.area ? Math.abs(g.area / P.areaParcela - 1) <= 0.15 : null;
    const loc = g?.local ? (g.local.dentro ? `<span class="tag bom">dentro de ${esc(g.local.nome)}</span>` : `<span class="tag ruim">FORA dos polígonos — ${fmt(g.local.d, 0)} m de ${esc(g.local.nome)}</span>`) : '';
    const estrOpts = (proj.estratos || []).map(e => `<option ${pc.estrato === e.nome ? 'selected' : ''}>${esc(e.nome)}</option>`).join('');

    const vert = `<details class="cartao" ${pc.vertices.length < 4 && !pc.arvores.length ? 'open' : ''}><summary>Vértices GPS (${pc.vertices.length}) ${g?.area ? `· ${fmt(g.area, 0)} m²` : ''} ${loc}</summary>
      ${pc.vertices.map((v, i) => `<div class="vert"><span>V${i + 1}${v.gerado ? ' (gerado)' : ''}</span><span class="mudo">±${fmt(v.acc, 1)} m · ${v.n || 1} leit.</span><button class="mini sec" data-a="del-vertice" data-i="${i}">✕</button></div>`).join('')}
      ${ladosTxt ? `<p>Lados: ${ladosTxt} m${g.area ? ` · área ${fmt(g.area, 0)} m² <span class="tag ${areaOk ? 'bom' : 'ruim'}">${areaOk ? 'confere' : 'difere'} de ${P.areaParcela} m²</span>` : ''}</p>` : ''}
      <div class="linha-botoes"><button data-a="marcar-vertice">Marcar vértice ${pc.vertices.length + 1}</button>
      ${pc.vertices.length === 2 ? `<button class="sec" data-a="completar">Completar ${nomEsp[0]}×${nomEsp[1]}</button>` : ''}</div></details>`;

    const cab = `<div class="cartao cab-parcela"><div class="grade2"><label>Nº<input id="p-num" value="${esc(pc.numero)}"></label>
      <label>Estrato<select id="p-estr"><option value="">—</option>${estrOpts}</select></label></div>
      <label>Observação<input id="p-obs" value="${esc(pc.obs || '')}" placeholder="ex.: ponto d'água a 20 m"></label></div>`;

    const resumo = euc
      ? `<div class="resumo"><span><b>${r.nArvores}</b> árv.</span><span><b>${r.nFustes}</b> fustes</span><span><b>${r.nFalhas}</b> falhas</span><span><b>${r.nComH}</b> c/ H</span><span><b>${fmt(r.ha[P.metodo], 1)}</b> m³/ha</span></div>
        ${r.nFustes >= 5 && r.nComH < 5 ? `<p class="aviso">Só ${r.nComH} alturas medidas: a regressão precisa de pelo menos 5 (de preferência 10 ou mais) bem distribuídas nos diâmetros.</p>` : ''}
        ${r.regressao ? `<p class="mudo">ln(H) = ${fmt(r.regressao.b0, 4)} ${r.regressao.b1 < 0 ? '−' : '+'} ${fmt(Math.abs(r.regressao.b1), 4)}/DAP · R² ${fmt(r.regressao.r2, 3)}</p>` : ''}`
      : `<div class="resumo"><span><b>${r.nIncluidas}</b> árv.</span><span><b>${r.nExcluidas}</b> &lt; CAP mín.</span><span><b>${fmt(r.ha.arvores, 0)}</b> N/ha</span><span><b>${fmt(r.ha.g, 2)}</b> m²/ha</span><span><b>${fmt(r.ha.v, 1)}</b> m³/ha</span></div>
        ${r.semAltura ? `<p class="aviso">${r.semAltura} árvore(s) incluída(s) sem altura: volume zero até lançar H.</p>` : ''}`;

    const ed = S.editando, edA = ed ? pc.arvores.find(a => a.id === ed) : null;
    const form = euc ? `<div class="entrada cartao" id="entrada">
        <div class="grade2"><label>CAP (cm)<input id="e-cap" inputmode="decimal" enterkeyhint="next" value="${esc(edA?.CAP ?? '')}"></label>
        <label>H (m)<input id="e-h" inputmode="decimal" enterkeyhint="done" placeholder="opcional" value="${esc(edA?.H ?? '')}"></label></div>
        ${edA ? `<div class="linha-botoes"><button data-a="salvar-edicao">Salvar alteração</button><button class="sec" data-a="cancelar-edicao">Cancelar</button><button class="perigo" data-a="del-arvore">Excluir</button></div>`
        : `<div class="linha-botoes tres"><button data-a="add-euc" data-m="nova">Árvore</button><button class="sec" data-a="add-euc" data-m="fuste">+ Fuste</button><button class="sec" data-a="add-euc" data-m="falha">Falha</button></div>`}
      </div>`
      : `<div class="entrada cartao" id="entrada">
        <label>Espécie (nome popular)<input id="e-nome" list="dl-esp" autocomplete="off" enterkeyhint="next" value="${esc(edA?.nome ?? '')}"></label>
        <datalist id="dl-esp">${listaEspecies().map(e => `<option value="${esc(e)}">`).join('')}</datalist>
        <div class="grade2"><label>H (m)<input id="e-h" inputmode="decimal" enterkeyhint="next" value="${esc(edA?.H ?? '')}"></label>
        <label>CAP (cm)<input id="e-cap" inputmode="decimal" enterkeyhint="done" value="${esc(edA?.CAP ?? '')}"></label></div>
        <div id="extras">${S.extras.map((v, i) => `<label class="extra">CAP fuste ${i + 2}<input data-extra="${i}" inputmode="decimal" value="${esc(v ?? '')}"></label>`).join('')}</div>
        <div class="linha-botoes">${edA ? `<button data-a="salvar-edicao">Salvar alteração</button><button class="sec" data-a="cancelar-edicao">Cancelar</button><button class="perigo" data-a="del-arvore">Excluir</button>`
        : `<button data-a="add-cerrado">Gravar árvore</button>`}<button class="sec" data-a="add-extra">+ Fuste</button></div></div>`;

    const lista = euc ? listaEuc(pc, r) : listaCerrado(pc, r, P);
    return `${cab}${vert}${resumo}${form}<div class="lista arvores">${lista}</div>
      <div class="linha-botoes fim"><button class="${pc.fechada ? 'sec' : ''}" data-a="fechar-parcela">${pc.fechada ? 'Reabrir parcela' : 'Fechar parcela'}</button>
      <button class="sec" data-a="excluir-calculo">${pc.excluir ? 'Voltar ao cálculo' : 'Tirar do cálculo'}</button>
      <button class="perigo" data-a="apagar-parcela">Apagar parcela</button></div>`;
  }
  function listaEspecies() {
    const m = new Map(); const add = n => { if (n && !m.has(chaveEsp(n))) m.set(chaveEsp(n), n); };
    ESPECIES_BASE.forEach(e => add(e[0])); (S.projeto.especies || []).forEach(e => add(e[0]));
    S.parcelas.forEach(p => p.arvores.forEach(a => add(a.nome)));
    return [...m.values()].sort((a, b) => a.localeCompare(b, 'pt'));
  }
  function alertasHTML(al) { return al.length ? `<span class="alertas">${al.map(a => `<span class="tag ${a.nivel === 'info' ? '' : 'ruim'}" title="${esc(a.msg)}">${esc(a.msg)}</span>`).join('')}</span>` : ''; }
  function listaCerrado(pc, r, P) {
    return [...pc.arvores].map((a, i) => ({ a, i })).reverse().map(({ a, i }) => {
      const c = r.arvores[i].c, al = Calc.alertasArvore(a, pc.arvores[i - 1], P, 'cerrado'), im = imune(a.nome);
      return `<button class="item arv ${c.incluida ? '' : 'excluida'} ${S.editando === a.id ? 'sel' : ''}" data-a="editar" data-id="${a.id}">
        <span class="n">${i + 1}</span><span><b>${esc(a.nome || '(sem nome)')}</b>${im ? ' <span class="tag ruim">imune</span>' : ''}${alertasHTML(al.filter(x => x.nivel !== 'info'))}</span>
        <span class="num">H ${fmt(a.H, 1)} · CAP ${fmt(a.CAP, 0)}${(a.fustesExtras || []).length ? ` +${a.fustesExtras.length}` : ''}</span></button>`;
    }).join('');
  }
  function listaEuc(pc, r) {
    const P = params(S.projeto);
    const cont = {};
    const L = pc.arvores.map((a, i) => { cont[a.arvore] = (cont[a.arvore] || 0) + 1; return { a, i, f: cont[a.arvore] }; });
    // árvore mais recente no topo, com os fustes logo abaixo dela
    const grupos = []; L.forEach(x => { if (x.f === 1 || !grupos.length) grupos.push([x]); else grupos[grupos.length - 1].push(x); });
    return grupos.reverse().flat().map(({ a, i, f }) => {
      const al = Calc.alertasArvore(a, pc.arvores[i - 1], P, 'eucalipto').filter(x => x.nivel !== 'info');
      return `<button class="item arv ${a.falha ? 'excluida' : ''} ${f > 1 ? 'fuste' : ''} ${S.editando === a.id ? 'sel' : ''}" data-a="editar" data-id="${a.id}">
        <span class="n">${f > 1 ? '↳' : a.arvore}</span><span>${a.falha ? '<b>Falha</b>' : f > 1 ? `fuste ${f}` : ''}${alertasHTML(al)}</span>
        <span class="num">${a.falha ? '' : `CAP ${fmt(a.CAP, 0)}${a.H != null ? ` · H ${fmt(a.H, 1)}` : ''}`}</span></button>`;
    }).join('');
  }
  function focarEntrada() {
    const el = S.projeto?.tipo === 'eucalipto' ? $('#e-cap') : $('#e-nome');
    // não abre o teclado sozinho na primeira entrada da parcela
    if (el && S.focar) { el.focus(); el.select?.(); }
    S.focar = false;
  }

  // ----- resultados -----
  function abaResultados() {
    const R = calcular(S.projeto, S.parcelas), E = R.est, A = R.antigo, P = R.p, euc = S.projeto.tipo === 'eucalipto';
    if (!R.porParcela.length) return '<p class="mudo">Lance parcelas para ver os resultados.</p>';
    const linha = (k, v, w = '') => `<tr><td>${k}</td><td>${v}</td>${w !== null ? `<td class="mudo">${w}</td>` : ''}</tr>`;
    let h = resumoErro(R);
    h += `<div class="cartao"><h3>${euc ? esc(METODOS[P.metodo]) : 'Volume (VTcc)'}</h3><table class="tab">
      <tr><th></th><th>Este critério</th><th>Planilha antiga</th></tr>
      ${linha('Parcelas (n)', E.n, A.n)}${linha('Área (ha)', fmt(R.areaHa, 2), '')}${linha('Média (m³/ha)', fmt(E.media, 2), fmt(A.media, 2))}
      ${linha('Desvio padrão', fmt(E.desvio, 2), fmt(A.desvio, 2))}${linha('CV (%)', fmt(E.cv, 1), fmt(A.cv, 1))}${linha('Erro padrão', fmt(E.sx, 3), fmt(A.sx, 3))}
      ${linha('t', fmt(E.t, 3), fmt(A.t, 3))}${linha('Erro (%)', `<b>${fmt(E.erroRel, 2)}</b>`, fmt(A.erroRel, 2))}
      ${linha('IC (m³/ha)', `${fmt(E.icMin, 1)} a ${fmt(E.icMax, 1)}`, `${fmt(A.icMin, 1)} a ${fmt(A.icMax, 1)}`)}
      ${linha('Total (m³)', `<b>${fmt(E.total, 1)}</b>`, fmt(A.total, 1))}${linha('IC total (m³)', `${fmt(E.totalMin, 0)} a ${fmt(E.totalMax, 0)}`, `${fmt(A.totalMin, 0)} a ${fmt(A.totalMax, 0)}`)}
      ${linha('Total (st)', fmt(E.totalSt, 1), fmt(A.totalSt, 1))}${linha('Parcelas necessárias', E.parcelasNecessarias ?? '—', A.parcelasNecessarias ?? '—')}</table>
      <p class="mudo">"Este critério": desvio ${P.desvio === 'populacional' ? 'populacional' : 'amostral'}${P.fpc ? ', com correção de população finita' : ''}. "Planilha antiga": desvio populacional, sem correção — para comparar com relatórios já entregues.</p></div>`;
    if (euc) h += `<div class="cartao"><h3>Comparação dos métodos</h3><table class="tab"><tr><th>Método</th><th>m³/ha</th><th>Total m³</th><th>Erro</th></tr>
      ${Object.entries(R.metodos).map(([k, s]) => `<tr class="${k === P.metodo ? 'destaque' : ''}"><td>${METODOS[k]}</td><td>${fmt(s.media, 1)}</td><td>${fmt(s.total, 0)}</td><td>${fmt(s.erroRel, 1)}%</td></tr>`).join('')}</table></div>`;
    if (R.estrat) {
      const T = R.estrat;
      h += `<div class="cartao"><h3>Por estrato</h3><table class="tab"><tr><th>Estrato</th><th>ha</th><th>n</th><th>m³/ha</th><th>Total m³</th></tr>
        ${T.estratos.map(l => `<tr><td>${esc(l.nome)}</td><td>${fmt(l.areaHa, 2)}</td><td>${l.n}</td><td>${l.n ? fmt(l.media, 1) : '<span class="mudo">sem parcela</span>'}</td><td>${l.n ? fmt(l.total, 0) : fmt(T.media * l.areaHa, 0) + '*'}</td></tr>`).join('')}
        <tr class="destaque"><td>Estratificado</td><td>${fmt(T.areaTotal, 2)}</td><td>${R.porParcela.length}</td><td>${fmt(T.media, 1)}</td><td>${fmt(T.total, 0)}</td></tr></table>
        <p>${T.semErro ? `<span class="aviso">${esc(T.semErro)}</span>` : `Erro estratificado: <b>${fmt(T.erroRel, 2)}%</b> (GL efetivos ${fmt(T.gl, 1)}, t ${fmt(T.t, 3)})`}</p>
        ${T.estratos.some(l => !l.n) ? '<p class="mudo">* Estrato sem parcela recebe a média estratificada.</p>' : ''}</div>`;
    }
    const prc = R.porParcela.map(x => `<tr><td>${esc(x.pc.numero)}</td><td>${esc(x.pc.estrato || '')}</td><td>${euc ? x.r.nFustes : x.r.nIncluidas}</td><td>${fmt(x.r.ha.g, 2)}</td><td>${fmt(R.vha(x), 1)}</td></tr>`).join('');
    h += `<div class="cartao"><h3>Parcelas</h3><table class="tab"><tr><th>Nº</th><th>Estrato</th><th>${euc ? 'Fustes' : 'Árv.'}</th><th>G m²/ha</th><th>m³/ha</th></tr>${prc}</table></div>`;
    if (R.fito) h += `<div class="cartao"><h3>Fitossociologia</h3><div class="rolagem"><table class="tab"><tr><th>Espécie</th><th>N</th><th>DA</th><th>DR%</th><th>FR%</th><th>DoR%</th><th>VI%</th><th>m³</th></tr>
      ${R.fito.map(s => `<tr><td>${esc(s.nome)}${imune(s.nome) ? ' <span class="tag ruim">imune</span>' : ''}</td><td>${s.N}</td><td>${fmt(s.DA, 0)}</td><td>${fmt(s.DR, 1)}</td><td>${fmt(s.FR, 1)}</td><td>${fmt(s.DoR, 1)}</td><td>${fmt(s.VI, 1)}</td><td>${fmt(s.V, 3)}</td></tr>`).join('')}</table></div></div>`;
    if (R.classes?.length) h += `<div class="cartao"><h3>Classes de DAP</h3><table class="tab"><tr><th>DAP (cm)</th><th>Nº</th><th>% nº</th><th>% volume</th></tr>
      ${R.classes.map(c => `<tr><td>${c.min}–${c.max}</td><td>${c.n}</td><td>${fmt(c.pn, 1)}</td><td>${fmt(c.pv, 1)}</td></tr>`).join('')}</table></div>`;
    return h;
  }

  // ----- pontos -----
  function abaPontos() {
    const L = [...S.pontos].sort((a, b) => String(b.hora).localeCompare(String(a.hora)));
    const tipos = { arvore: 'Árvore', planejado: 'Ponto planejado', outro: 'Outro' };
    return `<div class="cartao"><label>Espécie ou descrição<input id="pt-nome" list="dl-esp2" placeholder="ex.: pequi, nascente, divisa"></label>
      <datalist id="dl-esp2">${listaEspecies().map(e => `<option value="${esc(e)}">`).join('')}</datalist>
      <div class="grade2"><label>Tipo<select id="pt-tipo"><option value="arvore">Árvore</option><option value="outro">Outro (água, divisa…)</option><option value="planejado">Ponto planejado</option></select></label>
      <label>Observação<input id="pt-obs"></label></div>
      <div class="linha-botoes"><button data-a="marcar-ponto">Marcar ponto GPS</button>
      <label class="botao sec">Importar GPX<input type="file" accept=".gpx,application/gpx+xml" data-a="importar-gpx" hidden></label></div></div>
      <div class="lista">${L.map(p => `<div class="item ponto"><span><b>${esc(p.especie || p.nome || '—')}</b> <span class="mudo">${tipos[p.tipo] || p.tipo}</span>
        ${p.situacao ? `<span class="tag ruim">${esc(p.situacao)}</span>` : ''}</span><span class="mudo">${p.hora ? esc(p.hora.slice(5, 16)) : ''} · ±${fmt(p.acc, 1)} m${p.obs ? ' · ' + esc(p.obs) : ''}</span>
        <button class="mini sec" data-a="del-ponto" data-id="${p.id}">✕</button></div>`).join('') || '<p class="mudo">Nenhum ponto.</p>'}</div>`;
  }

  // ----- exportar -----
  function abaExportar() {
    return `<div class="cartao"><h3>Resultados</h3>
      <button class="largo" data-a="exp" data-f="xlsx">Planilha completa (.xlsx)</button>
      <p class="mudo">Dados, parcelas, estatística, ${S.projeto.tipo === 'cerrado' ? 'fitossociologia, ' : ''}vértices e pontos, com as coordenadas em UTM.</p>
      <button class="largo sec" data-a="exp" data-f="csv">Dados de campo (.csv)</button>
      <button class="largo sec" data-a="exp" data-f="kml">Mapa: parcelas e pontos (.kml)</button>
      <button class="largo sec" data-a="exp" data-f="geojson">Mapa para o Guru Maps (.geojson)</button></div>
      <div class="cartao"><h3>Backup e outro aparelho</h3>
      <button class="largo" data-a="exp" data-f="backup">Exportar backup (.json)</button>
      <p class="mudo">Importe o backup de outro aparelho na tela inicial: as parcelas se juntam às deste. Quando a mesma parcela existe nos dois, fica a versão alterada por último.</p></div>`;
  }

  // ---------------- mapa (SVG, sem internet) ----------------
  const Mapa = {
    vb: null, el: null,
    montar() {
      const el = $('#mapa'); if (!el) return; this.el = el;
      const proj = S.projeto, z = zona(proj, S.parcelas[0]?.vertices[0] || S.pontos[0] || GPS.pos && { lon: GPS.pos.coords.longitude });
      const U = (lat, lon) => Geo.paraUTM(lat, lon, z);
      const pts = [];
      const estr = (proj.estratos || []).filter(e => e.coords).map(e => { const p = e.coords.map(c => U(c.lat, c.lon)); pts.push(...p); return { nome: e.nome, p }; });
      const parc = S.parcelas.map(pc => { const v = verticesOrdenados(proj, pc).map(c => U(c.lat, c.lon)); pts.push(...v); return { pc, v }; });
      const pon = S.pontos.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => { const u = U(p.lat, p.lon); pts.push(u); return { p, u }; });
      if (GPS.pos) pts.push(U(GPS.pos.coords.latitude, GPS.pos.coords.longitude));
      if (!pts.length) { el.innerHTML = '<p class="mudo">Nada para mostrar ainda: importe o KML das áreas ou marque parcelas e pontos.</p>'; return; }
      let minE = Math.min(...pts.map(p => p.E)), maxE = Math.max(...pts.map(p => p.E)), minN = Math.min(...pts.map(p => p.N)), maxN = Math.max(...pts.map(p => p.N));
      const pad = Math.max(maxE - minE, maxN - minN, 60) * 0.08;
      this.z = z; this.org = { E: minE - pad, N: maxN + pad };
      const W = maxE - minE + 2 * pad, H = maxN - minN + 2 * pad;
      this.vb = this.vb || { x: 0, y: 0, w: Math.max(W, 60), h: Math.max(H, 60) };
      const X = u => u.E - this.org.E, Y = u => this.org.N - u.N, k = this.vb.w / 100;
      const poly = (p, cls) => `<polygon class="${cls}" points="${p.map(u => `${X(u)},${Y(u)}`).join(' ')}"/>`;
      const cores = { arvore: '#c62828', planejado: '#1565c0', outro: '#f9a825' };
      el.innerHTML = `<svg id="svg-mapa" viewBox="${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}" preserveAspectRatio="xMidYMid meet">
        ${estr.map(e => poly(e.p, 'm-estr')).join('')}
        ${estr.map(e => { const c = Geo.centro(e.p); return `<text class="m-rot" x="${X(c)}" y="${Y(c)}" font-size="${k * 3.2}">${esc(e.nome)}</text>`; }).join('')}
        ${parc.map(({ pc, v }) => v.length >= 3 ? poly(v, 'm-parc') + `<text class="m-rot2" x="${X(Geo.centro(v))}" y="${Y(Geo.centro(v)) - k * 1.5}" font-size="${k * 2.6}">${esc(pc.numero)}</text>`
          : v.map(u => `<circle cx="${X(u)}" cy="${Y(u)}" r="${k * 0.9}" class="m-vert"/>`).join('')).join('')}
        ${pon.map(({ p, u }) => `<circle cx="${X(u)}" cy="${Y(u)}" r="${k * 0.8}" fill="${cores[p.tipo] || '#555'}" stroke="#fff" stroke-width="${k * 0.2}"/>`).join('')}
        <g id="m-eu"></g></svg>
        <div class="mapa-botoes"><button class="mini" data-a="zoom" data-z="0.6">+</button><button class="mini" data-a="zoom" data-z="1.6">−</button><button class="mini sec" data-a="zoom" data-z="0">⌂</button><button class="mini sec" data-a="zoom" data-z="eu">◎</button></div>
        <p class="mudo legenda"><span style="color:#2e7d32">■</span> estratos <span style="color:#ef6c00">■</span> parcelas <span style="color:#c62828">●</span> árvores <span style="color:#1565c0">●</span> planejados <span style="color:#0d47a1">◉</span> você</p>`;
      this.eventos(); this.posicao();
    },
    posicao() {
      const g = $('#m-eu'); if (!g || !GPS.pos || !this.org) return;
      const u = Geo.paraUTM(GPS.pos.coords.latitude, GPS.pos.coords.longitude, this.z), x = u.E - this.org.E, y = this.org.N - u.N, k = this.vb.w / 100;
      g.innerHTML = `<circle cx="${x}" cy="${y}" r="${Math.max(GPS.pos.coords.accuracy, k)}" class="m-acc"/><circle cx="${x}" cy="${y}" r="${k * 1.1}" class="m-eu"/>`;
      // ponto planejado mais próximo
      const plan = S.pontos.filter(p => p.tipo === 'planejado').map(p => { const q = Geo.paraUTM(p.lat, p.lon, this.z); return { p, d: Geo.dist(u, q), az: Geo.azimute(u, q) }; }).sort((a, b) => a.d - b.d)[0];
      const info = $('#mapa-info'); if (info) info.innerHTML = `Você: ${u.zona}${Geo.banda(GPS.pos.coords.latitude)} E ${fmt(u.E, 0)} N ${fmt(u.N, 0)}` +
        (plan ? ` · Planejado mais perto: <b>${esc(plan.p.nome || plan.p.especie)}</b> a ${fmt(plan.d, 0)} m, rumo ${fmt(plan.az, 0)}°` : '');
    },
    aplicar() { const s = $('#svg-mapa'); if (s) s.setAttribute('viewBox', `${this.vb.x} ${this.vb.y} ${this.vb.w} ${this.vb.h}`); },
    zoom(f) {
      if (f === '0') { this.vb = null; this.montar(); return; }
      if (f === 'eu') { if (!GPS.pos) return toast('Sem posição'); const u = Geo.paraUTM(GPS.pos.coords.latitude, GPS.pos.coords.longitude, this.z);
        this.vb.x = u.E - this.org.E - this.vb.w / 2; this.vb.y = this.org.N - u.N - this.vb.h / 2; return this.aplicar(); }
      const cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2; this.vb.w *= +f; this.vb.h *= +f; this.vb.x = cx - this.vb.w / 2; this.vb.y = cy - this.vb.h / 2; this.aplicar();
    },
    eventos() {
      const svg = $('#svg-mapa'); const ptrs = new Map(); let ult = null;
      const escala = () => this.vb.w / svg.clientWidth;
      svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); ult = null; });
      svg.addEventListener('pointermove', e => {
        if (!ptrs.has(e.pointerId)) return; const ant = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 1) { const s = escala(); this.vb.x -= (e.clientX - ant.x) * s; this.vb.y -= (e.clientY - ant.y) * s; this.aplicar(); }
        else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (ult) this.zoom(String(ult / d)); ult = d; }
      });
      const fim = e => { ptrs.delete(e.pointerId); ult = null; };
      svg.addEventListener('pointerup', fim); svg.addEventListener('pointercancel', fim);
      svg.addEventListener('wheel', e => { e.preventDefault(); this.zoom(e.deltaY > 0 ? '1.2' : '0.83'); }, { passive: false });
    }
  };

  // ---------------- ações ----------------
  async function acao(a, el) {
    const proj = S.projeto, pc = parcelaAtual();
    switch (a) {
      case 'voltar':
        if (S.view === 'parcela') { await gravarCabecalho(); S.view = 'projeto'; S.editando = null; S.extras = []; }
        else if (S.view === 'novo' || S.view === 'projeto') { S.view = 'home'; S.projeto = null; S.aba = 'parcelas'; Mapa.vb = null; }
        render(); if (S.view === 'home') preencherHome(); break;
      case 'novo': S.view = 'novo'; S.novoTipo = 'cerrado'; S.novoEstratos = []; S.novoRasc = null; S.novoZona = null; render(); break;
      case 'tipo': S.novoTipo = el.dataset.t; S.novoRasc = { nome: $('#c-nome').value }; render(); break;
      case 'criar': {
        const base = { params: PRESETS[S.novoTipo], estratos: S.novoEstratos || [] };
        const c = lerConfig(base); if (!c.nome) return toast('Dê um nome ao inventário', 'erro');
        const p = { id: uid(), tipo: S.novoTipo, criado: Date.now(), especies: [], ...base, ...c, estratos: base.estratos, zonaUTM: S.novoZona || null };
        await DB.salvar('projetos', p); S.aba = 'parcelas'; await abrirProjeto(p.id); break;
      }
      case 'abrir': S.aba = 'parcelas'; Mapa.vb = null; await abrirProjeto(el.dataset.id); break;
      case 'aba': S.aba = el.dataset.k; render(); window.scrollTo(0, 0); break;
      case 'ir-ajustes':
        await gravarCabecalho(); S.view = 'projeto'; S.aba = 'config'; S.editando = null; S.extras = [];
        render(); window.scrollTo(0, 0); break;
      case 'salvar-config': {
        const c = lerConfig(proj); Object.assign(proj, c); await salvarProjeto(); toast('Configuração salva', 'ok'); render(); break;
      }
      case 'add-estrato': {
        guardarForm();
        const alvo = S.view === 'novo' ? (S.novoEstratos = S.novoEstratos || []) : proj.estratos;
        alvo.push({ nome: `Área ${String(alvo.length + 1).padStart(2, '0')}`, areaHa: 0 }); render(); break;
      }
      case 'del-estrato': {
        guardarForm();
        const alvo = S.view === 'novo' ? S.novoEstratos : proj.estratos;
        if (confirm(`Remover o estrato ${alvo[+el.dataset.i].nome}?`)) { alvo.splice(+el.dataset.i, 1); render(); } break;
      }
      case 'apagar-projeto':
        if (prompt(`Para apagar "${proj.nome}" e todas as parcelas, digite APAGAR`) === 'APAGAR') {
          for (const p of S.parcelas) await DB.apagar('parcelas', p.id);
          for (const p of S.pontos) await DB.apagar('pontos', p.id);
          await DB.apagar('projetos', proj.id); S.view = 'home'; S.projeto = null; render(); preencherHome();
        } break;
      case 'salvar-equipe': S.equipe = $('#equipe').value.trim(); await DB.config('equipe', S.equipe); toast('Salvo', 'ok'); break;
      case 'nova-parcela': {
        const nums = S.parcelas.map(p => parseInt(p.numero) || 0), prox = (nums.length ? Math.max(...nums) : 0) + 1;
        const pcN = { id: uid(), projetoId: proj.id, numero: String(prox).padStart(proj.tipo === 'eucalipto' ? 2 : 3, '0'), estrato: '', vertices: [], arvores: [], obs: '', criado: Date.now(), fechada: false, excluir: false };
        await salvarParcela(pcN); S.parcelaId = pcN.id; S.view = 'parcela'; S.editando = null; S.extras = []; render(); break;
      }
      case 'parcela': S.parcelaId = el.dataset.id; S.view = 'parcela'; S.editando = null; S.extras = []; render(); break;
      case 'marcar-vertice': {
        await gravarCabecalho();
        const v = await GPS.capturar(proj.params.segundosGPS ?? 10, `Vértice ${pc.vertices.length + 1} da parcela ${pc.numero}`); if (!v) return;
        if (!proj.zonaUTM) { proj.zonaUTM = Geo.zonaDe(v.lon); await salvarProjeto(); }
        pc.vertices.push(v); autoEstrato(pc); await salvarParcela(pc);
        if (v.acc > 15) toast(`Precisão fraca (±${fmt(v.acc, 0)} m). Se puder, espere o sinal melhorar e marque de novo.`, 'aviso');
        render(); break;
      }
      case 'del-vertice': if (confirm('Apagar este vértice?')) { pc.vertices.splice(+el.dataset.i, 1); await salvarParcela(pc); render(); } break;
      case 'completar': {
        const P = params(proj);
        const prof = numIn(prompt(`Os 2 vértices marcados formam o lado de ${P.comprimento} m. Profundidade da parcela (m):`, P.largura)); if (!prof) return;
        const lado = confirm('A parcela fica à DIREITA de quem anda do vértice 1 para o vértice 2?\n\nOK = direita · Cancelar = esquerda') ? -1 : 1;
        const z = zona(proj, pc.vertices[0]);
        const [a1, b1] = pc.vertices.map(v => Geo.paraUTM(v.lat, v.lon, z));
        const ret = Geo.completarRetangulo(a1, b1, prof, lado);
        [ret[2], ret[3]].forEach((u, i) => { const ll = Geo.deUTM(u.E, u.N, z, pc.vertices[0].lat < 0); pc.vertices.push({ ...ll, acc: null, n: 0, hora: agora(), gerado: true, nome: `V${3 + i} gerado` }); });
        const d = Geo.dist(a1, b1); if (Math.abs(d - P.comprimento) > 3) toast(`Atenção: os 2 vértices estão a ${fmt(d, 1)} m, e não a ${P.comprimento} m.`, 'aviso');
        autoEstrato(pc); await salvarParcela(pc); render(); break;
      }
      case 'add-euc': {
        const cap = numIn($('#e-cap').value), h = numIn($('#e-h').value), m = el.dataset.m;
        if (m !== 'falha' && !cap) { toast('Informe o CAP', 'erro'); $('#e-cap').focus(); return; }
        const ult = pc.arvores.length ? Math.max(...pc.arvores.map(x => x.arvore)) : 0;
        if (m === 'fuste' && !ult) { toast('Lance a árvore antes do fuste', 'erro'); return; }
        const reg = { id: uid(), arvore: m === 'fuste' ? ult : ult + 1, falha: m === 'falha', CAP: m === 'falha' ? null : cap, H: m === 'falha' ? null : h };
        const al = Calc.alertasArvore(reg, pc.arvores[pc.arvores.length - 1], params(proj), 'eucalipto').filter(x => x.nivel !== 'info');
        pc.arvores.push(reg); await salvarParcela(pc);
        if (al.length) toast(al.map(x => '⚠ ' + esc(x.msg)).join('<br>'), 'aviso');
        S.focar = true; render(); break;
      }
      case 'add-extra': S.extras = lerExtras(); S.extras.push(null); guardarRascunho(); render(); restaurarRascunho(); $(`[data-extra="${S.extras.length - 1}"]`)?.focus(); break;
      case 'add-cerrado': {
        const reg = lerCerrado(); if (!reg) return;
        reg.id = uid();
        const al = Calc.alertasArvore(reg, pc.arvores[pc.arvores.length - 1], params(proj), 'cerrado');
        pc.arvores.push(reg); S.extras = []; aprenderEspecie(reg.nome); await salvarParcela(pc);
        if (al.length) toast(al.map(x => (x.nivel === 'info' ? 'ℹ ' : '⚠ ') + esc(x.msg)).join('<br>'), 'aviso');
        S.focar = true; render();
        const im = imune(reg.nome);
        if (im && confirm(`${im.motivo}.\n\nMarcar agora o ponto GPS desta árvore?`)) await marcarPontoImune(reg, pc, im);
        break;
      }
      case 'editar': {
        await gravarCabecalho();
        S.editando = el.dataset.id; const a2 = pc.arvores.find(x => x.id === S.editando); S.extras = [...(a2.fustesExtras || [])]; render();
        $('#entrada')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
      }
      case 'cancelar-edicao': S.editando = null; S.extras = []; render(); break;
      case 'salvar-edicao': {
        const a2 = pc.arvores.find(x => x.id === S.editando);
        if (proj.tipo === 'eucalipto') { a2.CAP = numIn($('#e-cap').value); a2.H = numIn($('#e-h').value); if (a2.CAP) a2.falha = false; }
        else { const r = lerCerrado(); if (!r) return; Object.assign(a2, r); aprenderEspecie(r.nome); }
        S.editando = null; S.extras = []; await salvarParcela(pc); toast('Alterado', 'ok'); render(); break;
      }
      case 'del-arvore': if (confirm('Excluir este registro?')) { pc.arvores = pc.arvores.filter(x => x.id !== S.editando); S.editando = null; S.extras = []; await salvarParcela(pc); render(); } break;
      case 'fechar-parcela': {
        await gravarCabecalho(); pc.fechada = !pc.fechada; await salvarParcela(pc);
        if (pc.fechada) {
          if (pc.vertices.length < 3) toast('Parcela fechada sem os vértices completos no GPS.', 'aviso');
          const R = calcular(proj, S.parcelas);
          S.view = 'projeto'; S.aba = 'parcelas'; render();
          if (R.est.n >= 2) toast(`Parcela ${esc(pc.numero)} fechada. Erro agora: <b>${fmt(R.est.erroRel, 1)}%</b>${R.est.atende ? ' ✓' : ` — faltam ~${R.est.faltam} parcelas`}`, R.est.atende ? 'ok' : 'aviso');
        } else render();
        break;
      }
      case 'excluir-calculo': pc.excluir = !pc.excluir; await salvarParcela(pc); render(); break;
      case 'apagar-parcela': if (confirm(`Apagar a parcela ${pc.numero} com ${pc.arvores.length} registros?`)) {
        await DB.apagar('parcelas', pc.id); S.parcelas = S.parcelas.filter(x => x.id !== pc.id); S.view = 'projeto'; render(); } break;
      case 'marcar-ponto': {
        const nome = $('#pt-nome').value.trim(), tipo = $('#pt-tipo').value, obs = $('#pt-obs').value.trim();
        const v = await GPS.capturar(proj.params.segundosGPS ?? 10, `Ponto: ${nome || tipo}`); if (!v) return;
        if (!proj.zonaUTM) { proj.zonaUTM = Geo.zonaDe(v.lon); await salvarProjeto(); }
        const im = tipo === 'arvore' ? imune(nome) : null;
        await salvarPonto({ id: uid(), projetoId: proj.id, tipo, especie: tipo === 'arvore' ? nome : '', nome: tipo !== 'arvore' ? nome : '', obs, situacao: im ? 'Imune de corte (Lei MG 20.308/2012)' : '', ...v });
        if (tipo === 'arvore') aprenderEspecie(nome);
        toast('Ponto marcado', 'ok'); render(); break;
      }
      case 'del-ponto': if (confirm('Apagar este ponto?')) { await DB.apagar('pontos', el.dataset.id); S.pontos = S.pontos.filter(p => p.id !== el.dataset.id); render(); } break;
      case 'zoom': Mapa.zoom(el.dataset.z); break;
      case 'exp': await exportar(el.dataset.f); break;
    }
  }

  function guardarForm() {
    if (!$('#c-nome')) return;
    if (S.view === 'novo') S.novoRasc = lerConfig({ params: S.novoRasc?.params || PRESETS[S.novoTipo], estratos: S.novoEstratos || [], areaHa: S.novoRasc?.areaHa });
    else Object.assign(S.projeto, lerConfig(S.projeto));
  }
  function lerExtras() { return [...document.querySelectorAll('[data-extra]')].map(i => numIn(i.value)); }
  let rascunho = null;
  function guardarRascunho() { rascunho = { nome: $('#e-nome')?.value, h: $('#e-h')?.value, cap: $('#e-cap')?.value }; }
  function restaurarRascunho() { if (!rascunho) return; if ($('#e-nome')) $('#e-nome').value = rascunho.nome ?? ''; if ($('#e-h')) $('#e-h').value = rascunho.h ?? ''; if ($('#e-cap')) $('#e-cap').value = rascunho.cap ?? ''; rascunho = null; }
  function lerCerrado() {
    const nome = $('#e-nome').value.trim(), H = numIn($('#e-h').value), CAP = numIn($('#e-cap').value);
    if (!nome) { toast('Informe a espécie', 'erro'); $('#e-nome').focus(); return null; }
    if (!CAP) { toast('Informe o CAP', 'erro'); $('#e-cap').focus(); return null; }
    return { nome, H, CAP, fustesExtras: lerExtras().filter(v => v > 0) };
  }
  function aprenderEspecie(nome) {
    if (!nome) return; const n = chaveEsp(nome);
    if (ESPECIES_BASE.some(e => chaveEsp(e[0]) === n) || (S.projeto.especies || []).some(e => chaveEsp(e[0]) === n)) return;
    (S.projeto.especies = S.projeto.especies || []).push([nome, '']); salvarProjeto();
  }
  async function marcarPontoImune(reg, pc, im) {
    const v = await GPS.capturar(S.projeto.params.segundosGPS ?? 10, `${reg.nome} (parcela ${pc.numero})`); if (!v) return;
    await salvarPonto({ id: uid(), projetoId: S.projeto.id, tipo: 'arvore', especie: reg.nome, situacao: 'Imune de corte (Lei MG 20.308/2012) — dentro da parcela', parcela: pc.numero, arvoreId: reg.id, obs: `CAP ${reg.CAP} · H ${reg.H ?? '—'}`, ...v });
    toast('Ponto da árvore marcado', 'ok');
  }
  function autoEstrato(pc) {
    const g = geoParcela(S.projeto, pc);
    if (g?.local && (!pc.estrato || pc.estratoAuto)) { pc.estrato = g.local.nome; pc.estratoAuto = true; }
  }
  async function gravarCabecalho() {
    const pc = parcelaAtual(); if (!pc || !$('#p-num')) return;
    const num = $('#p-num').value.trim(), est = $('#p-estr').value, obs = $('#p-obs').value;
    if (num !== pc.numero || est !== (pc.estrato || '') || obs !== (pc.obs || '')) {
      if (num !== pc.numero && S.parcelas.some(x => x.id !== pc.id && x.numero === num)) toast(`Já existe a parcela ${esc(num)}`, 'aviso');
      if (est !== (pc.estrato || '')) pc.estratoAuto = false;
      pc.numero = num || pc.numero; pc.estrato = est; pc.obs = obs; await salvarParcela(pc);
    }
  }

  async function exportar(f) {
    const proj = S.projeto, R = calcular(proj, S.parcelas);
    try {
      let blob, nome;
      if (f === 'xlsx') { blob = Exportar.planilhaXLSX(proj, S.parcelas, S.pontos, R); nome = Exportar.nomeArquivo(proj, 'inventario', 'xlsx'); }
      if (f === 'csv') { blob = Exportar.csv(proj, [...S.parcelas].sort(ordNum)); nome = Exportar.nomeArquivo(proj, 'dados', 'csv'); }
      if (f === 'kml') { blob = Exportar.kml(proj, S.parcelas, S.pontos); nome = Exportar.nomeArquivo(proj, 'mapa', 'kml'); }
      if (f === 'geojson') { blob = Exportar.geojson(proj, S.parcelas, S.pontos); nome = Exportar.nomeArquivo(proj, 'mapa', 'geojson'); }
      if (f === 'backup') { blob = Exportar.backup(proj, S.parcelas, S.pontos); nome = Exportar.nomeArquivo(proj, 'backup', 'json'); await DB.config('ultimoBackup', Date.now()); }
      await Exportar.entregar(blob, nome);
    } catch (e) { console.error(e); toast('Erro ao exportar: ' + esc(e.message), 'erro'); }
  }

  // ---------------- importações ----------------
  async function importar(tipo, file) {
    const txt = await file.text();
    if (tipo === 'importar-kml') {
      const k = Geo.lerKML(txt);
      if (!k.poligonos.length && !k.pontos.length) return toast('Nenhum polígono ou ponto no KML', 'erro');
      const z = Geo.zonaDe((k.poligonos[0]?.coords[0] || k.pontos[0]).lon);
      const novo = S.view === 'novo';
      guardarForm();
      const alvo = novo ? (S.novoEstratos = S.novoEstratos || []) : S.projeto.estratos;
      const sel = k.poligonos.length > 1 ? prompt(`O KML tem ${k.poligonos.length} polígonos:\n${k.poligonos.map((p, i) => `${i + 1}. ${p.nome} (${fmt(areaKml(p, z), 2)} ha)`).join('\n')}\n\nQuais viram estratos? (ex.: 2,3,4 — vazio = todos)`, '') : '';
      if (sel === null) return;
      const idx = sel.trim() ? sel.split(/[,; ]+/).map(n => +n - 1).filter(i => k.poligonos[i]) : k.poligonos.map((_, i) => i);
      idx.forEach(i => { const p = k.poligonos[i]; alvo.push({ nome: p.nome, areaHa: Math.round(areaKml(p, z) * 100) / 100, coords: p.coords }); });
      if (novo) S.novoZona = z; else if (!S.projeto.zonaUTM) S.projeto.zonaUTM = z;
      if (k.pontos.length && !novo && confirm(`O KML também tem ${k.pontos.length} ponto(s). Importar como pontos planejados?`)) {
        for (const p of k.pontos) await salvarPonto({ id: uid(), projetoId: S.projeto.id, tipo: 'planejado', nome: p.nome, lat: p.lat, lon: p.lon, acc: null, hora: '' });
      }
      if (!novo) await salvarProjeto();
      toast(`${idx.length} estrato(s) importado(s). Confira as áreas.`, 'ok'); render();
    }
    if (tipo === 'importar-gpx') {
      const w = Geo.lerGPX(txt); if (!w.length) return toast('Nenhum waypoint no GPX', 'erro');
      const comoPlan = confirm(`${w.length} waypoints. Importar como PONTOS PLANEJADOS?\n\nOK = planejados · Cancelar = pontos marcados em campo (tipo "outro")`);
      for (const p of w) await salvarPonto({ id: uid(), projetoId: S.projeto.id, tipo: comoPlan ? 'planejado' : 'outro', nome: p.nome, obs: p.desc, lat: p.lat, lon: p.lon, acc: null, hora: p.hora ? p.hora.replace('T', ' ').slice(0, 19) : '' });
      toast(`${w.length} pontos importados`, 'ok'); render();
    }
    if (tipo === 'importar-backup') {
      let d; try { d = JSON.parse(txt); } catch { return toast('Arquivo inválido', 'erro'); }
      if (d.formato !== 'inventario-florestal') return toast('Não é um backup deste app', 'erro');
      const ex = await DB.pegar('projetos', d.projeto.id);
      let novas = 0, atual = 0, mantidas = 0;
      if (!ex || (d.projeto.atualizado || 0) > (ex.atualizado || 0)) await DB.salvarCru('projetos', ex ? { ...d.projeto, especies: mesclarEsp(ex.especies, d.projeto.especies) } : d.projeto);
      for (const [store, L] of [['parcelas', d.parcelas], ['pontos', d.pontos]]) for (const r of L) {
        const e = await DB.pegar(store, r.id);
        if (!e) { await DB.salvarCru(store, r); novas++; } else if ((r.atualizado || 0) > (e.atualizado || 0)) { await DB.salvarCru(store, r); atual++; } else mantidas++;
      }
      const todas = await DB.porProjeto('parcelas', d.projeto.id), nums = {}; todas.forEach(p => { nums[p.numero] = (nums[p.numero] || 0) + 1; });
      const dup = Object.keys(nums).filter(n => nums[n] > 1);
      toast(`${ex ? 'Juntado' : 'Importado'}: ${novas} novos, ${atual} atualizados, ${mantidas} já em dia.${dup.length ? `<br>⚠ Números repetidos: ${dup.join(', ')} — renumere uma delas.` : ''}`, dup.length ? 'aviso' : 'ok');
      preencherHome();
    }
  }
  const mesclarEsp = (a = [], b = []) => { const m = new Map(); [...a, ...b].forEach(e => m.set(chaveEsp(e[0]), e)); return [...m.values()]; };
  function areaKml(p, z) {
    const u = p.coords.map(c => Geo.paraUTM(c.lat, c.lon, z));
    const furos = (p.furos || []).reduce((s, f) => s + Geo.areaPoligono(f.map(c => Geo.paraUTM(c.lat, c.lon, z))), 0);
    return (Geo.areaPoligono(u) - furos) / 10000;
  }

  // ---------------- eventos globais ----------------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]'); if (!el || el.tagName === 'INPUT') return;
    e.preventDefault(); acao(el.dataset.a, el).catch(err => { console.error(err); toast('Erro: ' + esc(err.message), 'erro'); });
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.type === 'file' && el.dataset.a && el.files[0]) { importar(el.dataset.a, el.files[0]).catch(err => toast('Erro: ' + esc(err.message), 'erro')); el.value = ''; }
    if (el.id === 'p-estr' || el.id === 'p-num' || el.id === 'p-obs') gravarCabecalho().then(() => { if (el.id === 'p-estr') render(); });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || S.view !== 'parcela') return;
    const id = e.target.id;
    if (S.projeto.tipo === 'eucalipto') {
      if (id === 'e-cap') { e.preventDefault(); $('#e-h').focus(); }
      else if (id === 'e-h') { e.preventDefault(); acao(S.editando ? 'salvar-edicao' : 'add-euc', { dataset: { m: 'nova' } }); }
    } else {
      if (id === 'e-nome') { e.preventDefault(); $('#e-h').focus(); }
      else if (id === 'e-h') { e.preventDefault(); $('#e-cap').focus(); }
      else if (id === 'e-cap' || e.target.dataset.extra != null) { e.preventDefault(); acao(S.editando ? 'salvar-edicao' : 'add-cerrado', e.target); }
    }
  });
  window.addEventListener('popstate', () => { if (!Plataforma.nativo && S.view !== 'home') { history.pushState(null, ''); acao('voltar'); } });

  // ---------------- início ----------------
  window.App = { METODOS, cientifico, imune: n => !!imune(n), verticesOrdenados, modal, toast };
  (async function iniciar() {
    if (!Plataforma.nativo && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    S.equipe = (await DB.config('equipe')) || '';
    if (!Plataforma.aoVoltar(() => {
      const m = document.querySelector('.modal-fundo'); if (m) { m.querySelector('[data-m=cancelar],[data-m=ok]')?.click(); return; }
      if (S.view === 'home') return 'sair';
      acao('voltar');
    })) history.pushState(null, '');
    GPS.iniciar();
    render(); preencherHome();
  })();
})();
