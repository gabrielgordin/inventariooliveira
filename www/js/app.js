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
  // iPhone/iPad: o sensor de movimento só liga depois de pedir permissão num toque (o Chrome novo também tem a função, mas não precisa dela)
  const ehIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pedirSensor = async () => {
    if (!ehIOS || typeof DeviceOrientationEvent === 'undefined' || typeof DeviceOrientationEvent.requestPermission !== 'function') return true;
    try { return (await Promise.race([DeviceOrientationEvent.requestPermission(), new Promise(r => setTimeout(() => r('tempo'), 15000))])) === 'granted'; } catch (e) { return false; }
  };
  const agora = () => new Date().toLocaleString('sv-SE').slice(0, 19);

  const METODOS = {
    simplificada: 'Simplificada da planilha (por árvore: g × H × 0,50)',
    padrao: 'Padrão (árvore média, H medida)', arvMediaReg: 'Árvore média, H da regressão',
    vol2: 'Volume II (por fuste, H da regressão)', eqMedia: 'Equação, árvore média', eqFuste: 'Equação, por fuste'
  };
  const PRESETS = {
    eucalipto: { comprimento: 20, largura: 15, capMin: 0, fatorForma: 0.5, eq: { b0: 0.000066, b1: 2.475293, b2: 0.300022, fator: 0.981 },
      prob: 0.9, erroAdm: 0.1, fatorEmp: 1.5, desvio: 'amostral', fpc: true, metodo: 'simplificada', usarHMedida: false, espacamento: '3 x 2', segundosGPS: 10, versaoEq: 2 },
    cerrado: { comprimento: 20, largura: 10, capMin: 15.7, fatorForma: 0.5, eq: { ...Calc.EQUACOES.cerrado },
      eqs: { cerrado: { ...Calc.EQUACOES.cerrado }, cerradao: { ...Calc.EQUACOES.cerradao } }, fisionomia: 'cerrado',
      prob: 0.9, erroAdm: 0.1, fatorEmp: 1.5, desvio: 'amostral', fpc: true, metodo: 'padrao', usarHMedida: false, espacamento: '', segundosGPS: 10, versaoEq: 2 }
  };

  const S = { view: 'home', aba: 'parcelas', projeto: null, parcelas: [], pontos: [], fotos: [], parcelaId: null, editando: null, extras: [], equipe: '', mapa: null,
    sol: false, teclado: true, campo: null, sujo: false, alvoId: null };

  // ---------------- utilidades de domínio ----------------
  const imune = nome => { const n = semAcento(nome); return n ? (IMUNES.find(i => n.startsWith(i.chave)) || null) : null; };
  // espécie ameaçada (Portaria GM/MMA 1.783/2026), pelo nome científico do cadastro
  const ameaca = (nome, proj = S.projeto) => window.AMEACADAS ? AMEACADAS.buscar(cientifico(proj, nome)) : null;
  const tagAmeaca = nome => { const a = ameaca(nome); return a && !a.genero ? ` <span class="tag ruim" title="${esc(a.catNome)} — Portaria GM/MMA 1.783/2026">ameaçada ${a.cat}</span>` : ''; };
  function cientifico(proj, nome) {
    const n = chaveEsp(nome); if (!n) return '';
    const l = (proj?.especies || []).find(e => chaveEsp(e[0]) === n && e[1]) || ESPECIES_BASE.find(e => chaveEsp(e[0]) === n);
    return l ? l[1] : '';
  }
  const params = proj => ({ ...proj.params, areaParcela: proj.params.comprimento * proj.params.largura });
  // Nativa: a equação vem da fisionomia do estrato da parcela (ou a padrão do inventário)
  function fisionomiaDe(proj, pc) {
    const e = (proj.estratos || []).find(x => x.nome === pc?.estrato);
    return (e && e.fisionomia) || proj.params.fisionomia || 'cerrado';
  }
  function paramsParcela(proj, pc) {
    const p = params(proj);
    if (proj.tipo !== 'eucalipto' && p.eqs) p.eq = p.eqs[fisionomiaDe(proj, pc)] || p.eq;
    return p;
  }
  // Atualiza inventários criados antes das equações de 25/11/2026
  function migrarEquacoes(proj) {
    const P = proj.params; if (!P || P.versaoEq >= 2) return false;
    if (proj.tipo === 'eucalipto') { if (P.metodo === 'padrao') P.metodo = 'simplificada'; }
    else { P.eqs = { cerrado: { ...Calc.EQUACOES.cerrado }, cerradao: { ...Calc.EQUACOES.cerradao } }; P.fisionomia = P.fisionomia || 'cerrado'; P.eq = { ...P.eqs.cerrado }; }
    P.versaoEq = 2; return true;
  }
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
    const porParcela = usadas.map(pc => ({ pc, r: euc ? Calc.parcelaEucalipto(pc.arvores, p) : Calc.parcelaCerrado(pc.arvores, paramsParcela(proj, pc)), geo: geoParcela(proj, pc) }));
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
      const famDe = nome => Familias.de(cientifico(proj, nome));
      R.fito.forEach(s => { s.familia = famDe(s.nome); });
      R.familias = Calc.porFamilia(R.fito, famDe);
      R.div = Calc.diversidade(porParcela.map(x => ({ id: x.pc.id, arvores: x.r.arvores })), p.areaParcela);
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
  /* GPS: fica ligado só nas telas que usam (economia de bateria) e desliga com o app em segundo plano.
     A marcação de ponto espera a precisão desejada, descarta leituras ruins e faz a média ponderada. */
  const GPS = {
    pos: null, erro: null, parar: null, ligando: false, leituras: [], temporario: 0, ativo: true,
    async iniciar() {
      if (this.parar || this.ligando) return;
      this.ligando = true;
      this.parar = await Plataforma.iniciarGPS(p => {
        this.pos = p; this.erro = null; this.leituras.push(p); if (this.leituras.length > 900) this.leituras.shift(); chipGPS();
        if (S.view === 'projeto' && S.aba === 'mapa') Mapa.posicao();
        if (S.view === 'navegar') atualizarNav();
      }, msg => { this.erro = msg; chipGPS(); });
      this.ligando = false; chipGPS();
    },
    desligar() { if (this.parar) { this.parar(); this.parar = null; } chipGPS(); },
    ligado() { return !!this.parar || this.ligando; },
    // liga por um tempo (foto, toque no selo do GPS) mesmo fora das telas que usam GPS
    ligarPor(ms) { this.temporario = Math.max(this.temporario, Date.now() + ms); ajustarGPS(); setTimeout(ajustarGPS, ms + 500); },
    fresca(maxIdadeMs = 20000, maxAcc = 50) {
      const p = this.pos; return p && Date.now() - p.timestamp < maxIdadeMs && p.coords.accuracy <= maxAcc ? p : null;
    },
    // espera uma posição boa (para a foto), até `ms`
    async posicaoAte(ms) {
      this.ligarPor(ms + 30000);
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { const p = this.fresca(); if (p) return p; await new Promise(r => setTimeout(r, 400)); }
      return this.fresca(60000, 200);
    },
    capturar(segundos, titulo) {
      this.capturando = true; ajustarGPS();
      const alvo = S.projeto?.params?.precisaoAlvo ?? 5, maxSeg = Math.max(segundos, S.projeto?.params?.esperaMaxGPS ?? 60);
      return new Promise(resolve => {
        const t0 = Date.now();
        const m = modal(`<h3>${esc(titulo || 'Marcando ponto')}</h3>
          <p class="grande" id="gps-cont">Aguardando sinal…</p><p id="gps-det"></p><p id="gps-med" class="mudo"></p>
          <p class="mudo">Fique parado no ponto, com o celular na altura do peito e longe do corpo. O app junta leituras por ${segundos} s e, se a precisão não chegar a ±${fmt(alvo, 0)} m, continua esperando até ${maxSeg} s.</p>
          <div class="botoes"><button class="sec" data-m="cancelar">Cancelar</button><button data-m="usar">Usar agora</button></div>`);
        const media = () => {
          let L = this.leituras.filter(p => p.timestamp >= t0 - 1500);
          if (!L.length) return null;
          const melhor = Math.min(...L.map(p => p.coords.accuracy));
          L = L.filter(p => p.coords.accuracy <= Math.max(melhor * 2, alvo * 1.5, 4));       // descarta leituras muito piores que a melhor
          const z = Geo.zonaDe(L[0].coords.longitude);
          const U = L.map(p => ({ p, u: Geo.paraUTM(p.coords.latitude, p.coords.longitude, z), w: 1 / Math.max(p.coords.accuracy, 1) ** 2 }));
          const centro = q => { const sw = q.reduce((s, x) => s + x.w, 0); return { E: q.reduce((s, x) => s + x.u.E * x.w, 0) / sw, N: q.reduce((s, x) => s + x.u.N * x.w, 0) / sw }; };
          let c = centro(U);
          const dists = U.map(x => Geo.dist(x.u, c)).sort((a, b) => a - b), med = dists[Math.floor(dists.length / 2)];
          const bons = U.filter(x => Geo.dist(x.u, c) <= Math.max(2.5 * med, 1.5));                // descarta pontos que "pularam"
          c = centro(bons);
          const disp = Math.sqrt(bons.reduce((s, x) => s + Geo.dist(x.u, c) ** 2, 0) / bons.length);
          const accs = bons.map(x => x.p.coords.accuracy).sort((a, b) => a - b), accMed = accs[Math.floor(accs.length / 2)];
          const alts = bons.map(x => x.p.coords.altitude).filter(v => v != null);
          const ll = Geo.deUTM(c.E, c.N, z, bons[0].p.coords.latitude < 0);
          return { lat: ll.lat, lon: ll.lon, acc: accMed, disp, alt: alts.length ? alts.reduce((a, b) => a + b, 0) / alts.length : null, n: bons.length, descartadas: L.length - bons.length };
        };
        const fim = usar => {
          clearInterval(iv); m.remove(); this.capturando = false; ajustarGPS();
          if (!usar) return resolve(null);
          const r = media() || (this.pos ? { lat: this.pos.coords.latitude, lon: this.pos.coords.longitude, acc: this.pos.coords.accuracy, n: 1 } : null);
          if (!r) { toast('Sem sinal de GPS', 'erro'); return resolve(null); }
          resolve({ ...r, hora: agora() });
        };
        m.addEventListener('click', e => { const a = e.target.dataset.m; if (a) fim(a === 'usar'); });
        const iv = setInterval(() => {
          const dec = (Date.now() - t0) / 1000, r = media(), ac = this.pos ? this.pos.coords.accuracy : null;
          $('#gps-cont', m).textContent = r ? `${r.n} leituras boas · ${Math.floor(dec)} s` : (this.erro || 'Aguardando sinal…');
          $('#gps-det', m).innerHTML = ac != null ? `Precisão agora: <b class="${ac <= alvo ? 'ok-txt' : 'ruim-txt'}">±${fmt(ac, 1)} m</b> (alvo ±${fmt(alvo, 0)} m)` : '';
          $('#gps-med', m).textContent = r ? `Média: precisão ±${fmt(r.acc, 1)} m · dispersão das leituras ${fmt(r.disp, 1)} m${r.descartadas ? ` · ${r.descartadas} descartada(s)` : ''}` : '';
          if (r && r.n >= 3 && dec >= segundos && (r.acc <= alvo || dec >= maxSeg)) fim(true);
        }, 400);
      });
    }
  };
  // Liga o GPS só onde ele é usado; desliga no resto e com o app em segundo plano
  function gpsNecessario() {
    if (!GPS.ativo) return false;
    if (GPS.capturando || Date.now() < GPS.temporario) return true;
    if (S.view === 'navegar') return true;
    if (S.view === 'projeto' && (S.aba === 'mapa' || S.aba === 'pontos')) return true;
    if (S.view === 'parcela') { const pc = parcelaAtual(); return !pc || pc.vertices.length < 4 || S.gpsParcela; }
    return false;
  }
  function ajustarGPS() { if (gpsNecessario()) GPS.iniciar(); else GPS.desligar(); }
  function chipGPS() {
    const c = $('#chip-gps'); if (!c) return;
    c.dataset.a = 'gps-chip';
    if (!GPS.ligado()) { c.textContent = 'GPS em pausa'; c.className = 'chip pausa'; c.title = 'Desligado para poupar bateria. Toque para ligar.'; return; }
    if (GPS.erro && !GPS.pos) { c.textContent = 'GPS: ' + GPS.erro; c.className = 'chip ruim'; return; }
    if (!GPS.pos) { c.textContent = 'GPS…'; c.className = 'chip'; return; }
    const a = GPS.pos.coords.accuracy;
    c.textContent = `GPS ±${fmt(a, a < 10 ? 1 : 0)} m`; c.className = 'chip ' + (a <= 5 ? 'bom' : a <= 15 ? 'medio' : 'ruim');
  }

  // ---------------- tela mantida acesa ----------------
  let wake = null;
  async function manterTela(on) {
    if (on && S.view === 'parcela' && !S.telaAcesa) on = false;   // preferência: manter a tela acesa na parcela
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
    if (migrarEquacoes(S.projeto)) await DB.salvar('projetos', S.projeto);
    S.parcelas = (await DB.porProjeto('parcelas', id)).sort(ordNum);
    S.pontos = await DB.porProjeto('pontos', id);
    S.fotos = await DB.porProjeto('fotos', id);
    S.view = 'projeto'; S.aba = S.aba || 'parcelas';
    await DB.config('ultimoProjeto', id);
    render();
  }
  const salvarProjeto = () => DB.salvar('projetos', S.projeto);
  async function salvarParcela(pc) { pc.autor = pc.autor || S.equipe; S.sujo = true; await DB.salvar('parcelas', pc); const i = S.parcelas.findIndex(x => x.id === pc.id); if (i < 0) S.parcelas.push(pc); S.parcelas.sort(ordNum); }
  async function salvarPonto(pt) { pt.autor = pt.autor || S.equipe; S.sujo = true; await DB.salvar('pontos', pt); if (!S.pontos.find(x => x.id === pt.id)) S.pontos.push(pt); }
  const parcelaAtual = () => S.parcelas.find(x => x.id === S.parcelaId);

  // ---------------- render ----------------
  function render() {
    const app = $('#app');
    const titulo = S.view === 'home' ? 'Inventário Florestal' : S.view === 'novo' ? 'Novo inventário' : S.view === 'parcela' ? `Parcela ${esc(parcelaAtual()?.numero)}` : S.view === 'navegar' ? 'Ir até a parcela' : esc(S.projeto?.nome || 'Projeto');
    const voltar = S.view !== 'home' ? `<button class="voltar" data-a="voltar" aria-label="Voltar">‹</button>` : '';
    let corpo = '';
    if (S.view === 'home') corpo = telaHome();
    else if (S.view === 'novo') corpo = telaConfig(true);
    else if (S.view === 'projeto') corpo = telaProjeto();
    else if (S.view === 'parcela') corpo = telaParcela();
    else if (S.view === 'navegar') corpo = telaNavegar();
    const ajustes = S.view === 'parcela' ? `<button class="engrenagem" data-a="ir-ajustes" aria-label="Ajustes do inventário" title="Ajustes do inventário (KML, estratos, parâmetros)">⚙</button>` : '';
    const sol = `<button class="sol-btn ${S.sol ? 'on' : ''}" data-a="sol" aria-label="Modo sol forte" title="Modo sol forte (alto contraste)">☀</button>`;
    app.innerHTML = `<header>${voltar}<h1>${titulo}</h1><span id="chip-gps" class="chip">GPS…</span>${sol}${ajustes}</header><main>${corpo}</main>`;
    ajustarGPS(); chipGPS();
    document.body.classList.toggle('com-teclado', usaTeclado() && !S.tecladoPausa);
    if (S.view !== 'parcela') S.tecladoPausa = false;
    if (S.view === 'parcela') {
      manterTela(true);
      if (usaTeclado() && !S.tecladoPausa) marcarCampo(S.campo && $('#' + S.campo) ? S.campo : camposOrdem()[0]); else focarEntrada();
    } else manterTela(S.view === 'navegar');
    if (S.view === 'navegar') { Bussola.ligar(); atualizarNav(); } else Bussola.desligar();
    if (S.view === 'projeto' && S.aba === 'mapa') Mapa.montar();
  }

  // ----- home -----
  function telaHome() {
    return `<section><div class="linha-botoes"><button data-a="novo">+ Novo inventário</button>
      <label class="botao sec">📥 Receber dados<input type="file" accept=".json,application/json" data-a="importar-backup" hidden></label></div>
      <div id="lista-projetos" class="lista"><p class="mudo">Carregando…</p></div>
      <details class="cartao"><summary>Equipe e aparelho</summary>
        <label>Nome de quem coleta neste aparelho<input id="equipe" value="${esc(S.equipe)}" placeholder="ex.: Gabriel"></label>
        <p class="mudo">Vai junto em cada parcela, para juntar os dados de dois aparelhos depois.</p>
        <label>Numerar as parcelas novas deste aparelho a partir de<input id="inicio-num" inputmode="numeric" value="${S.inicioNum}"></label>
        <p class="mudo">Para dois aparelhos no mesmo inventário não criarem a mesma parcela: por exemplo, 1 num celular e 31 no outro. Parcelas abertas pelo plano (🧭) mantêm o número do plano.</p>
        <button class="sec" data-a="salvar-equipe">Salvar</button>
        <label class="check"><input type="checkbox" id="pref-teclado" ${S.teclado ? 'checked' : ''}> Usar o teclado numérico do app (teclas grandes) no lançamento das árvores</label>
        <label class="check"><input type="checkbox" id="pref-tela" ${S.telaAcesa ? 'checked' : ''}> Manter a tela acesa durante o lançamento da parcela (desligar economiza bateria; na navegação a tela fica sempre acesa)</label>
        <label class="check"><input type="checkbox" id="pref-sol" ${S.sol ? 'checked' : ''}> Modo sol forte (alto contraste e letra maior) — também no botão ☀ do topo</label>
        <p class="mudo" id="armazenamento"></p></details>
      <p class="mudo rodape">Os dados ficam só neste aparelho. Toque em 📤 para mandar o inventário a outro aparelho (ou guardar no Drive) ao fim de cada dia de campo. Quem recebe toca em 📥 Receber dados${Plataforma.nativo ? ', ou abre o arquivo com este app' : ''}.</p></section>`;
  }
  async function preencherHome() {
    const L = (await DB.todos('projetos')).sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
    const todas = await DB.todos('parcelas'), todosPts = await DB.todos('pontos');
    const el = $('#lista-projetos'); if (!el) return;
    el.innerHTML = L.length ? L.map(p => {
      const ps = todas.filter(x => x.projetoId === p.id), n = ps.length;
      const alterado = Math.max(0, ...ps.map(x => x.atualizado || 0), ...todosPts.filter(x => x.projetoId === p.id).map(x => x.atualizado || 0));
      const env = p.ultimoBackupEnviado || 0;
      const bk = !alterado ? '' : env >= alterado ? `<span class="tag bom">backup enviado ${tempoAtras(env)}</span>`
        : `<span class="tag ruim">${env ? `backup enviado ${tempoAtras(env)} · há dados novos` : 'backup ainda não enviado'}</span>`;
      return `<div class="item-proj"><button class="item" data-a="abrir" data-id="${p.id}"><b>${esc(p.nome)}</b>
        <span class="mudo">${p.tipo === 'eucalipto' ? 'Reflorestamento' : 'Cerrado'} · ${n} parcela${n === 1 ? '' : 's'} · ${new Date(p.atualizado || p.criado).toLocaleDateString('pt-BR')}</span>${bk}</button>
        <button class="btn-lista" data-a="enviar-da-lista" data-id="${p.id}" aria-label="Enviar ${esc(p.nome)}" title="Enviar para outro aparelho">📤</button>
        <button class="lixeira" data-a="apagar-da-lista" data-id="${p.id}" aria-label="Apagar ${esc(p.nome)}" title="Apagar inventário">🗑</button></div>`;
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
      <button class="mini sec" data-a="del-estrato" data-i="${i}">✕</button>
      ${euc ? '' : `<select class="estr-fis" data-estr="${i}" data-c="fisionomia"><option value="">Fisionomia: a padrão</option>
        <option value="cerrado" ${e.fisionomia === 'cerrado' ? 'selected' : ''}>Cerrado</option><option value="cerradao" ${e.fisionomia === 'cerradao' ? 'selected' : ''}>Cerradão</option></select>`}</div>`).join('');
    return `<section class="form" id="form-config">
      ${novo ? `<div class="seletor-tipo"><button class="${!euc ? 'ativo' : 'sec'}" data-a="tipo" data-t="cerrado">Nativa (cerrado / cerradão)</button><button class="${euc ? 'ativo' : 'sec'}" data-a="tipo" data-t="eucalipto">Reflorestamento (eucalipto)</button></div>` : ''}
      <label>Nome do inventário<input id="c-nome" value="${esc(pr.nome)}" placeholder="ex.: Faz. Bons Olhos"></label>
      <div class="grade2"><label>Parcela: comprimento (m)<input id="c-comp" inputmode="decimal" value="${vIn(P.comprimento)}"></label>
      <label>largura (m)<input id="c-larg" inputmode="decimal" value="${vIn(P.largura)}"></label></div>
      ${euc ? `<div class="grade2"><label>Fator de forma<input id="c-ff" inputmode="decimal" value="${vIn(P.fatorForma)}"></label>
        <label>Espaçamento<input id="c-esp" value="${esc(P.espacamento)}"></label></div>
        <label>Método principal (o que aparece em destaque)<select id="c-met">${Object.entries(METODOS).map(([k, v]) => `<option value="${k}" ${P.metodo === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" id="c-hmed" ${P.usarHMedida ? 'checked' : ''}> Usar a altura medida quando houver (desmarcado = altura da regressão em todos os fustes, como na planilha)</label>`
        : `<label>CAP mínimo de inclusão (cm)<input id="c-capmin" inputmode="decimal" value="${vIn(P.capMin)}"></label>`}
      ${euc ? `<fieldset><legend>Equação para os métodos "Equação" (comparação): V = b0 · DAP^b1 · H^b2 · fator</legend>
        <p class="mudo">O método principal (simplificado) não usa esta equação.</p>
        <div class="grade2"><label>b0<input id="c-b0" inputmode="decimal" value="${vIn(P.eq.b0)}"></label><label>b1<input id="c-b1" inputmode="decimal" value="${vIn(P.eq.b1)}"></label>
        <label>b2<input id="c-b2" inputmode="decimal" value="${vIn(P.eq.b2)}"></label><label>fator<input id="c-fat" inputmode="decimal" value="${vIn(P.eq.fator)}"></label></div></fieldset>`
      : `<fieldset><legend>Equações de volume: V = b0 · DAP^b1 · H^b2 (DAP em cm, H em m)</legend>
        <label>Fisionomia padrão do inventário<select id="c-fis"><option value="cerrado" ${P.fisionomia !== 'cerradao' ? 'selected' : ''}>Cerrado</option><option value="cerradao" ${P.fisionomia === 'cerradao' ? 'selected' : ''}>Cerradão</option></select></label>
        <p class="mudo">Cada estrato pode ter a sua fisionomia (lista Estratos, abaixo). A parcela usa a equação do estrato dela.</p>
        ${['cerrado', 'cerradao'].map(k => { const q = (P.eqs || {})[k] || Calc.EQUACOES[k]; return `<p><b>${Calc.EQUACOES[k].nome}</b></p><div class="grade3">
          <label>b0<input id="c-${k}-b0" inputmode="decimal" value="${vIn(q.b0)}"></label><label>b1<input id="c-${k}-b1" inputmode="decimal" value="${vIn(q.b1)}"></label><label>b2<input id="c-${k}-b2" inputmode="decimal" value="${vIn(q.b2)}"></label></div>`; }).join('')}
        <button class="sec mini" data-a="eq-padrao">Voltar às equações da planilha</button></fieldset>`}
      <fieldset><legend>Estatística</legend>
        <div class="grade2"><label>Probabilidade (%)<input id="c-prob" inputmode="decimal" value="${vIn(P.prob * 100)}"></label>
        <label>Erro admissível (%)<input id="c-erro" inputmode="decimal" value="${vIn(P.erroAdm * 100)}"></label>
        <label>Estéreo por m³<input id="c-emp" inputmode="decimal" value="${vIn(P.fatorEmp)}"></label>
        <label>GPS: segundos de média<input id="c-seg" inputmode="numeric" value="${P.segundosGPS ?? 10}"></label>
        <label>GPS: precisão desejada (m)<input id="c-alvo" inputmode="decimal" value="${vIn(P.precisaoAlvo ?? 5)}"></label>
        <label>GPS: espera máxima (s)<input id="c-espera" inputmode="numeric" value="${P.esperaMaxGPS ?? 60}"></label></div>
        <label>Desvio padrão<select id="c-desv"><option value="amostral" ${P.desvio !== 'populacional' ? 'selected' : ''}>Amostral (n−1)</option><option value="populacional" ${P.desvio === 'populacional' ? 'selected' : ''}>Populacional (como na planilha antiga de eucalipto)</option></select></label>
        <label class="check"><input type="checkbox" id="c-fpc" ${P.fpc ? 'checked' : ''}> Correção de população finita</label></fieldset>
      <fieldset><legend>Estratos / áreas</legend>
        <p class="mudo">Importe o KML das áreas: cada polígono vira um estrato, com a área calculada, e o app passa a saber em que área cada parcela está.</p>
        <div id="estratos">${estr || '<p class="mudo">Sem estratos.</p>'}</div>
        <div class="linha-botoes"><button class="sec" data-a="add-estrato">+ Estrato</button>
        <label class="botao sec">Importar KML<input type="file" accept=".kml,application/vnd.google-earth.kml+xml" data-a="importar-kml" hidden></label></div>
        ${!(pr.estratos || []).length ? `<label>Área total (ha), se não houver estratos<input id="c-area" inputmode="decimal" value="${esc(String(pr.areaHa ?? '').replace('.', ','))}"></label>` : ''}
      </fieldset>
      ${novo ? '' : relatorioCampos(pr)}
      <button data-a="${novo ? 'criar' : 'salvar-config'}">${novo ? 'Criar inventário' : 'Salvar configuração'}</button>
      ${novo ? '' : `<button class="perigo" data-a="apagar-projeto">Apagar este inventário</button>`}
    </section>`;
  }
  // dados que só o relatório em Word usa
  const CAMPOS_REL = [['propriedade', 'Imóvel (fazenda, sítio)'], ['municipio', 'Município / UF'], ['requerente', 'Requerente ou proprietário'], ['documento', 'CPF / CNPJ (opcional)'],
    ['responsavel', 'Responsável técnico'], ['formacao', 'Formação (ex.: Engenheiro Florestal)'], ['registro', 'Registro no conselho (ex.: CREA-MG 00000/D)'], ['art', 'Nº da ART'],
    ['local', 'Cidade da assinatura'], ['finalidade', 'Finalidade do inventário'], ['fonteEquacoes', 'Fonte das equações de volume (referência bibliográfica)']];
  function relatorioCampos(pr) {
    const R = pr.relatorio || {};
    const ph = { finalidade: pr.tipo === 'eucalipto' ? 'estimar o volume de madeira do povoamento…' : 'subsidiar o pedido de autorização para supressão…', fonteEquacoes: 'deixe em branco para completar no Word' };
    return `<details class="cartao"><summary>Dados do relatório (Word)</summary>
      <p class="mudo">Vão para a identificação e a assinatura do relatório técnico. O que ficar em branco sai marcado em amarelo no Word, para completar.</p>
      ${CAMPOS_REL.map(([k, t]) => `<label>${t}<input id="r-${k}" value="${esc(R[k] || '')}" placeholder="${esc(ph[k] || '')}"></label>`).join('')}</details>`;
  }
  function lerConfig(base) {
    const g = id => $('#' + id), n = id => numIn(g(id)?.value);
    const P = { ...base.params, eq: { ...base.params.eq } };
    P.comprimento = n('c-comp') || P.comprimento; P.largura = n('c-larg') || P.largura;
    if (g('c-ff')) { P.fatorForma = n('c-ff') ?? P.fatorForma; P.espacamento = g('c-esp').value; P.metodo = g('c-met').value; P.usarHMedida = g('c-hmed').checked; }
    if (g('c-capmin')) P.capMin = n('c-capmin') ?? 0;
    if (g('c-b0')) P.eq = { b0: n('c-b0'), b1: n('c-b1'), b2: n('c-b2'), fator: n('c-fat') ?? 1 };
    if (g('c-fis')) {
      P.fisionomia = g('c-fis').value;
      P.eqs = {}; ['cerrado', 'cerradao'].forEach(k => { P.eqs[k] = { nome: Calc.EQUACOES[k].nome, b0: n(`c-${k}-b0`), b1: n(`c-${k}-b1`), b2: n(`c-${k}-b2`), fator: 1 }; });
      P.eq = { ...P.eqs[P.fisionomia] };
    }
    P.prob = (n('c-prob') ?? 90) / 100; P.erroAdm = (n('c-erro') ?? 10) / 100; P.fatorEmp = n('c-emp') ?? 1.5; P.segundosGPS = n('c-seg') ?? 10; P.precisaoAlvo = n('c-alvo') ?? 5; P.esperaMaxGPS = n('c-espera') ?? 60;
    P.desvio = g('c-desv').value; P.fpc = g('c-fpc').checked;
    document.querySelectorAll('[data-estr]').forEach(inp => {
      const e = base.estratos[+inp.dataset.estr]; if (!e) return;
      if (inp.dataset.c === 'nome') e.nome = inp.value.trim(); else if (inp.dataset.c === 'fisionomia') e.fisionomia = inp.value; else e.areaHa = numIn(inp.value) ?? 0;
    });
    const out = { nome: g('c-nome').value.trim(), params: P, areaHa: g('c-area') ? numIn(g('c-area').value) : base.areaHa };
    if (g('r-propriedade')) { out.relatorio = { ...(base.relatorio || {}) }; CAMPOS_REL.forEach(([k]) => { out.relatorio[k] = g('r-' + k).value.trim(); }); }
    return out;
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
    const plan = S.pontos.filter(p => p.tipo === 'planejado' && p.plano), feitas = plan.filter(p => p.feito).length;
    const temPoly = (S.projeto.estratos || []).some(e => e.coords?.length >= 3);
    const botoesPlano = (temPoly || plan.length) ? `<div class="linha-botoes">
        ${temPoly ? `<button class="sec" data-a="planejar">🗺 Planejar parcelas</button>` : ''}
        ${plan.length > feitas ? `<button data-a="navegar">🧭 Ir até a próxima (${plan.length - feitas} faltam)</button>` : ''}</div>
        ${plan.length ? `<p class="mudo">Plano: ${plan.length} parcelas planejadas · ${feitas} feitas.</p>` : ''}` : '';
    return `${resumoErro(R)}${botoesPlano}<button class="largo" data-a="nova-parcela">+ Nova parcela${S.inicioNum > 1 ? ` <small>(nº ${padNum(proximoNumero())})</small>` : ''}</button>
      <div class="lista">${linhas || '<p class="mudo">Nenhuma parcela lançada.</p>'}</div>`;
  }

  // ----- parcela -----
  function telaParcela() {
    const pc = parcelaAtual(); if (!pc) return '';
    const proj = S.projeto, P = params(proj), euc = proj.tipo === 'eucalipto';
    const r = euc ? Calc.parcelaEucalipto(pc.arvores, P) : Calc.parcelaCerrado(pc.arvores, paramsParcela(proj, pc));
    const g = geoParcela(proj, pc);
    const nomEsp = [P.comprimento, P.largura];
    const ladosTxt = g?.lados?.length ? g.lados.map(l => fmt(l, 1)).join(' · ') : '';
    const areaOk = g?.area ? Math.abs(g.area / P.areaParcela - 1) <= 0.15 : null;
    const loc = g?.local ? (g.local.dentro ? `<span class="tag bom">dentro de ${esc(g.local.nome)}</span>` : `<span class="tag ruim">FORA dos polígonos — ${fmt(g.local.d, 0)} m de ${esc(g.local.nome)}</span>`) : '';
    const estrOpts = (proj.estratos || []).map(e => `<option ${pc.estrato === e.nome ? 'selected' : ''}>${esc(e.nome)}</option>`).join('');

    const vert = `<details class="cartao" ${pc.vertices.length < 4 && !pc.arvores.length ? 'open' : ''}><summary>Vértices GPS (${pc.vertices.length}) ${g?.area ? `· ${fmt(g.area, 0)} m²` : ''} ${loc}</summary>
      ${pc.vertices.map((v, i) => `<div class="vert"><span>V${i + 1}${v.gerado ? ' (gerado)' : ''}</span><span class="mudo">±${fmt(v.acc, 1)} m${v.disp != null ? ` · disp. ${fmt(v.disp, 1)} m` : ''} · ${v.n || 1} leit.</span><button class="mini sec" data-a="del-vertice" data-i="${i}">✕</button></div>`).join('')}
      ${ladosTxt ? `<p>Lados: ${ladosTxt} m${g.area ? ` · área ${fmt(g.area, 0)} m² <span class="tag ${areaOk ? 'bom' : 'ruim'}">${areaOk ? 'confere' : 'difere'} de ${P.areaParcela} m²</span>` : ''}</p>` : ''}
      <div class="linha-botoes"><button data-a="marcar-vertice">Marcar vértice ${pc.vertices.length + 1}</button>
      ${pc.vertices.length === 2 ? `<button class="sec" data-a="completar">Completar ${nomEsp[0]}×${nomEsp[1]}</button>` : ''}</div></details>`;

    const cab = `<div class="cartao cab-parcela"><div class="grade2"><label>Nº<input id="p-num" value="${esc(pc.numero)}"></label>
      <label>Estrato<select id="p-estr"><option value="">—</option>${estrOpts}</select></label></div>
      <label>Observação<input id="p-obs" value="${esc(pc.obs || '')}" placeholder="ex.: ponto d'água a 20 m"></label>
      <div class="linha-fotos"><button class="sec mini" data-a="foto" data-tipo="parcela">📷 Foto da parcela</button>${miniaturas(S.fotos.filter(f => f.parcelaId === pc.id && !f.arvoreId))}</div></div>`;

    const resumo = euc
      ? `<div class="resumo"><span><b>${r.nArvores}</b> árv.</span><span><b>${r.nFustes}</b> fustes</span><span><b>${r.nFalhas}</b> falhas</span><span><b>${r.nComH}</b> c/ H</span><span><b>${fmt(r.ha[P.metodo], 1)}</b> m³/ha</span></div>
        ${r.nFustes >= 5 && r.nComH < 5 ? `<p class="aviso">Só ${r.nComH} alturas medidas: a regressão precisa de pelo menos 5 (de preferência 10 ou mais) bem distribuídas nos diâmetros.</p>` : ''}
        ${r.regressao ? `<p class="mudo">ln(H) = ${fmt(r.regressao.b0, 4)} ${r.regressao.b1 < 0 ? '−' : '+'} ${fmt(Math.abs(r.regressao.b1), 4)}/DAP · R² ${fmt(r.regressao.r2, 3)}</p>` : ''}`
      : `<div class="resumo"><span><b>${r.nIncluidas}</b> árv.</span><span><b>${r.nExcluidas}</b> &lt; CAP mín.</span><span><b>${fmt(r.ha.arvores, 0)}</b> N/ha</span><span><b>${fmt(r.ha.g, 2)}</b> m²/ha</span><span><b>${fmt(r.ha.v, 1)}</b> m³/ha</span></div>
        ${r.semAltura ? `<p class="aviso">${r.semAltura} árvore(s) incluída(s) sem altura: volume zero até lançar H.</p>` : ''}`;

    const ed = S.editando, edA = ed ? pc.arvores.find(a => a.id === ed) : null;
    const form = euc ? `<div class="entrada cartao" id="entrada">
        <div class="grade2"><label>CAP (cm)<input id="e-cap"${usaTeclado() ? ' readonly inputmode="none" data-tecl' : ' inputmode="decimal"'} enterkeyhint="next" value="${esc(edA?.CAP ?? '')}"></label>
        <label><span class="rot-h">H (m)<button type="button" class="ico" data-a="hipsometro" title="Medir a altura com o celular">📐</button></span><input id="e-h"${usaTeclado() ? ' readonly inputmode="none" data-tecl' : ' inputmode="decimal"'} enterkeyhint="done" placeholder="opcional" value="${esc(edA?.H ?? '')}"></label></div>
        ${edA ? `<div class="linha-botoes"><button data-a="salvar-edicao">Salvar alteração</button><button class="sec" data-a="cancelar-edicao">Cancelar</button><button class="perigo" data-a="del-arvore">Excluir</button></div>${fotosArvoreHTML(edA)}`
        : `<div class="linha-botoes tres acoes-form"><button data-a="add-euc" data-m="nova">Árvore</button><button class="sec" data-a="add-euc" data-m="fuste">+ Fuste</button><button class="sec" data-a="add-euc" data-m="falha">Falha</button></div>${extrasForm(pc)}`}
      </div>`
      : `<div class="entrada cartao" id="entrada">
        <label>Espécie (nome popular)<input id="e-nome" data-sug="sug-nome" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="next" value="${esc(edA?.nome ?? '')}"></label>
        <div class="sugestoes" id="sug-nome" hidden></div>
        <div class="grade2"><label><span class="rot-h">H (m)<button type="button" class="ico" data-a="hipsometro" title="Medir a altura com o celular">📐</button></span><input id="e-h"${usaTeclado() ? ' readonly inputmode="none" data-tecl' : ' inputmode="decimal"'} enterkeyhint="next" value="${esc(edA?.H ?? '')}"></label>
        <label>CAP (cm)<input id="e-cap"${usaTeclado() ? ' readonly inputmode="none" data-tecl' : ' inputmode="decimal"'} enterkeyhint="done" value="${esc(edA?.CAP ?? '')}"></label></div>
        <div id="extras">${S.extras.map((v, i) => `<label class="extra">CAP fuste ${i + 2}<input id="e-x${i}" data-extra="${i}"${usaTeclado() ? ' readonly inputmode="none" data-tecl' : ' inputmode="decimal"'} value="${esc(v ?? '')}"></label>`).join('')}</div>
        <div class="linha-botoes ${edA ? '' : 'acoes-form'}">${edA ? `<button data-a="salvar-edicao">Salvar alteração</button><button class="sec" data-a="cancelar-edicao">Cancelar</button><button class="perigo" data-a="del-arvore">Excluir</button>`
        : `<button data-a="add-cerrado">Gravar árvore</button>`}<button class="sec" data-a="add-extra">+ Fuste</button></div>${edA ? fotosArvoreHTML(edA) : extrasForm(pc)}</div>`;

    const lista = euc ? listaEuc(pc, r) : listaCerrado(pc, r, P);
    return `${cab}${vert}${resumo}${form}<div class="lista arvores">${lista}</div>
      <div class="linha-botoes fim"><button class="${pc.fechada ? 'sec' : ''}" data-a="fechar-parcela">${pc.fechada ? 'Reabrir parcela' : 'Fechar parcela'}</button>
      <button class="sec" data-a="excluir-calculo">${pc.excluir ? 'Voltar ao cálculo' : 'Tirar do cálculo'}</button>
      <button class="perigo" data-a="apagar-parcela">Apagar parcela</button></div>${usaTeclado() ? tecladoHTML(euc, !!edA, pc) : ''}`;
  }
  // voz e desfazer (fora do teclado do app)
  const extrasForm = pc => `<div class="linha-botoes acoes-form extras-form"><button class="sec" data-a="voz">🎤 Falar</button>${pc.arvores.length ? `<button class="sec" data-a="desfazer">↶ Desfazer último</button>` : ''}</div>`;
  // ----- teclado numérico do app -----
  const usaTeclado = () => S.teclado && !S.tecladoPausa && S.view === 'parcela';
  function tecladoHTML(euc, edit, pc) {
    const k = (t, v, cls = '') => `<button class="tk ${cls}" data-tk="${v}">${t}</button>`;
    const acoes = edit ? `<button data-a="salvar-edicao" class="tk-acao">Salvar alteração</button><button data-a="cancelar-edicao" class="tk-acao sec">Cancelar</button>`
      : euc ? `<button data-a="add-euc" data-m="nova" class="tk-acao">Árvore</button><button data-a="add-euc" data-m="fuste" class="tk-acao sec">+ Fuste</button><button data-a="add-euc" data-m="falha" class="tk-acao sec">Falha</button>`
        : `<button data-a="add-cerrado" class="tk-acao">Gravar árvore</button><button data-a="add-extra" class="tk-acao sec">+ Fuste</button>`;
    const extra = edit ? '' : `<button data-a="voz" class="tk-acao sec tk-ico" title="Lançar falando">🎤</button>${pc?.arvores.length ? `<button data-a="desfazer" class="tk-acao sec tk-ico" title="Desfazer o último lançamento">↶</button>` : ''}`;
    return `<div class="teclado" id="teclado"><div class="tk-grade">
      ${k('7', '7')}${k('8', '8')}${k('9', '9')}${k('⌫', 'del', 'fn')}
      ${k('4', '4')}${k('5', '5')}${k('6', '6')}${k(',', ',', 'fn')}
      ${k('1', '1')}${k('2', '2')}${k('3', '3')}${k('Próx. ›', 'prox', 'fn')}
      ${k('0', '0', 'zero')}${k('Limpar', 'limpar', 'fn')}${k('⌨', 'android', 'fn')}
      </div><div class="tk-acoes">${acoes}${extra}</div></div>`;
  }
  function camposOrdem() {
    const ex = [...document.querySelectorAll('[data-extra]')].map(i => i.id);
    return S.projeto.tipo === 'eucalipto' ? ['e-cap', 'e-h'] : ['e-h', 'e-cap', ...ex];
  }
  function marcarCampo(id) {
    document.querySelectorAll('.campo-ativo').forEach(e => e.classList.remove('campo-ativo'));
    const el = $('#' + id); if (!el) return;
    S.campo = id; el.classList.add('campo-ativo');
  }
  function teclar(v) {
    Plataforma.vibrar();
    const id = S.campo && $('#' + S.campo) ? S.campo : camposOrdem()[0], el = $('#' + id);
    if (!el) return;
    if (v === 'prox') { const o = camposOrdem(); marcarCampo(o[(o.indexOf(id) + 1) % o.length]); return; }
    if (v === 'android') { // volta ao teclado do Android só nesta tela, até sair dela
      S.tecladoPausa = true; render(); $('#' + (S.campo || 'e-cap'))?.focus(); return;
    }
    let t = el.value;
    if (v === 'del') t = t.slice(0, -1);
    else if (v === 'limpar') t = '';
    else if (v === ',') { if (!t.includes(',') && !t.includes('.')) t = (t || '0') + ','; }
    else if (t.replace(/[^0-9]/g, '').length < 6) t += v;
    el.value = t;
    if (el.dataset.extra != null) S.extras[+el.dataset.extra] = numIn(t);
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
        <span class="n">${i + 1}</span><span><b>${esc(a.nome || '(sem nome)')}</b>${im ? ' <span class="tag ruim">imune</span>' : ''}${tagAmeaca(a.nome)}${iconeFoto(a.id)}${alertasHTML(al.filter(x => x.nivel !== 'info'))}</span>
        <span class="num">H ${fmt(a.H, 1)} · CAP ${fmt(a.CAP, 0)}${(a.fustesExtras || []).length ? ` +${a.fustesExtras.length}` : ''}</span></button>`;
    }).join('');
  }
  function listaEuc(pc, r) {
    const P = params(S.projeto);
    const cont = {};
    const L = pc.arvores.map((a, i) => { cont[a.arvore] = (cont[a.arvore] || 0) + 1; return { a, i, f: cont[a.arvore] }; });
    // árvore mais recente no topo, com os fustes logo abaixo dela
    const porArv = new Map(); L.forEach(x => { const k = x.a.falha ? 'f' + x.a.id : x.a.arvore; if (!porArv.has(k)) porArv.set(k, []); porArv.get(k).push(x); });
    const grupos = [...porArv.values()];
    return grupos.reverse().flat().map(({ a, i, f }) => {
      const al = Calc.alertasArvore(a, pc.arvores[i - 1], P, 'eucalipto').filter(x => x.nivel !== 'info');
      return `<button class="item arv ${a.falha ? 'excluida' : ''} ${f > 1 ? 'fuste' : ''} ${S.editando === a.id ? 'sel' : ''}" data-a="editar" data-id="${a.id}">
        <span class="n">${f > 1 ? '↳' : a.arvore}</span><span>${a.falha ? '<b>Falha</b>' : f > 1 ? `fuste ${f}` : ''}${iconeFoto(a.id)}${alertasHTML(al)}</span>
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
    const fisUsadas = euc ? [] : [...new Set(R.porParcela.map(x => fisionomiaDe(S.projeto, x.pc)))].map(k => Calc.EQUACOES[k]?.nome || k);
    h += `<div class="cartao"><h3>${euc ? esc(METODOS[P.metodo]) : `Volume (VTcc) — equação de ${fisUsadas.join(' e ') || 'Cerrado'}`}</h3><table class="tab">
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
    if (R.div) {
      const D = R.div, ok = D.estabilizando;
      h += `<div class="cartao"><h3>Diversidade e suficiência amostral</h3>
        <div class="grade-res"><div><small>Espécies (S)</small><b>${D.S}</b></div><div><small>Famílias</small><b>${R.familias.filter(f => f.familia !== 'Indeterminada').length}</b></div>
        <div><small>Shannon H'</small><b>${fmt(D.H, 2)}</b></div><div><small>Pielou J</small><b>${D.J != null ? fmt(D.J, 2) : '—'}</b></div>
        <div><small>Simpson C</small><b>${D.C != null ? fmt(D.C, 2) : '—'}</b></div><div><small>Jackknife 1ª ordem</small><b>${fmt(D.jack1, 1)}</b></div></div>
        ${curvaSVG(D)}
        <p class="mudo">${D.n < 3 ? 'Com menos de 3 parcelas a curva ainda não diz nada.' : `Os últimos ${fmt(D.areaFinal, 0)}% da área amostrada acrescentaram <b>${fmt(D.acrescimo10, 1)}%</b> de espécies, e as ${D.S} espécies encontradas são <b>${fmt(D.pctEstimado, 0)}%</b> das ${fmt(D.jack1, 0)} estimadas. ${ok ? 'A curva está se estabilizando.' : 'A curva ainda sobe: mais parcelas devem acrescentar espécies.'}`}${D.S < R.fito.length ? ` Ficaram fora dos índices: ${R.fito.length - D.S} nome(s) que não são espécie (ex.: morta).` : ''}</p></div>`;
      h += `<div class="cartao"><h3>Famílias</h3><div class="rolagem"><table class="tab"><tr><th>Família</th><th>Espécies</th><th>N</th><th>N%</th><th>G%</th></tr>
        ${R.familias.map(f => `<tr><td>${esc(f.familia)}</td><td>${f.especies}</td><td>${f.N}</td><td>${fmt(f.pN, 1)}</td><td>${fmt(f.pG, 1)}</td></tr>`).join('')}</table></div>
        ${R.familias.some(f => f.familia === 'Indeterminada') ? '<p class="mudo">"Indeterminada": espécie sem nome científico no cadastro ou de gênero que o app não conhece.</p>' : ''}</div>`;
    }
    if (R.fito) h += `<div class="cartao"><h3>Fitossociologia</h3><div class="rolagem"><table class="tab"><tr><th>Espécie</th><th>N</th><th>DA</th><th>DR%</th><th>FR%</th><th>DoR%</th><th>VI%</th><th>m³</th></tr>
      ${R.fito.map(s => `<tr><td>${esc(s.nome)}${imune(s.nome) ? ' <span class="tag ruim">imune</span>' : ''}${tagAmeaca(s.nome)}${s.familia ? `<br><small class="mudo">${esc(s.familia)}</small>` : ''}</td><td>${s.N}</td><td>${fmt(s.DA, 0)}</td><td>${fmt(s.DR, 1)}</td><td>${fmt(s.FR, 1)}</td><td>${fmt(s.DoR, 1)}</td><td>${fmt(s.VI, 1)}</td><td>${fmt(s.V, 3)}</td></tr>`).join('')}</table></div></div>`;
    if (R.classes?.length) h += `<div class="cartao"><h3>Classes de DAP</h3><table class="tab"><tr><th>DAP (cm)</th><th>Nº</th><th>% nº</th><th>% volume</th></tr>
      ${R.classes.map(c => `<tr><td>${c.min}–${c.max}</td><td>${c.n}</td><td>${fmt(c.pn, 1)}</td><td>${fmt(c.pv, 1)}</td></tr>`).join('')}</table></div>`;
    return h;
  }

  // ----- pontos -----
  function abaPontos() {
    const L = [...S.pontos].sort((a, b) => String(b.hora).localeCompare(String(a.hora)));
    const tipos = { arvore: 'Árvore', planejado: 'Ponto planejado', outro: 'Outro' };
    return `<div class="cartao"><label>Espécie ou descrição<input id="pt-nome" data-sug="sug-pt" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" placeholder="ex.: pequi, nascente, divisa"></label>
      <div class="sugestoes" id="sug-pt" hidden></div>
      <div class="grade2"><label>Tipo<select id="pt-tipo"><option value="arvore">Árvore</option><option value="outro">Outro (água, divisa…)</option><option value="planejado">Ponto planejado</option></select></label>
      <label>Observação<input id="pt-obs"></label></div>
      <div class="linha-botoes"><button data-a="marcar-ponto">Marcar ponto GPS</button>
      <label class="botao sec">Importar GPX<input type="file" accept=".gpx,application/gpx+xml" data-a="importar-gpx" hidden></label></div></div>
      <div class="lista">${L.map(p => `<div class="item ponto"><span><b>${esc(p.especie || p.nome || '—')}</b> <span class="mudo">${tipos[p.tipo] || p.tipo}</span>
        ${p.situacao ? `<span class="tag ruim">${esc(p.situacao)}</span>` : ''}${p.tipo === 'planejado' ? (p.feito ? ' <span class="tag bom">feita</span>' : ' <span class="tag">a fazer</span>') : ''}</span><span class="mudo">${p.hora ? esc(p.hora.slice(5, 16)) : ''} · ±${fmt(p.acc, 1)} m${p.obs ? ' · ' + esc(p.obs) : ''}</span>
        <span class="botoes-ponto">${p.tipo === 'planejado' && !p.feito ? `<button class="mini" data-a="navegar" data-id="${p.id}" title="Ir até este ponto">🧭</button>` : ''}<button class="mini sec" data-a="foto" data-tipo="ponto" data-id="${p.id}" title="Foto do ponto">📷</button><button class="mini sec" data-a="del-ponto" data-id="${p.id}">✕</button></span>
        ${miniaturas(S.fotos.filter(f => f.pontoId === p.id && !f.arvoreId))}</div>`).join('') || '<p class="mudo">Nenhum ponto.</p>'}</div>`;
  }

  // ----- exportar -----
  function abaExportar() {
    const nat = S.projeto.tipo !== 'eucalipto';
    return `<div class="cartao"><h3>Relatório técnico</h3>
      <button class="largo" data-a="exp" data-f="docx">Relatório em Word (.docx)</button>
      <p class="mudo">Identificação, metodologia, equações, estatística${nat ? ', fitossociologia, volume por espécie, espécies imunes e ameaçadas' : ''}, mapa, fotos com legenda e coordenadas, dados de campo e vértices. Preencha antes os "Dados do relatório" em ⚙ Ajustes; o que faltar sai marcado em amarelo.</p></div>
      <div class="cartao"><h3>SINAFLOR</h3>
      <button class="largo sec" data-a="exp" data-f="sinaflor">Campos do SINAFLOR (.xlsx)</button>
      <button class="largo sec" data-a="exp" data-f="shp">Localização das amostras: shapefile (.zip)</button>
      <p class="mudo">O SINAFLOR não importa as árvores: a planilha traz cada campo da aba "Inventário Florestal" já calculado (informações gerais, volume por espécie, resultado do inventário) para copiar, e serve de anexo. O shapefile (SIRGAS 2000) leva os centros e os contornos das parcelas.</p></div>
      <div class="cartao"><h3>Resultados</h3>
      <button class="largo" data-a="exp" data-f="xlsx">Planilha completa (.xlsx)</button>
      <p class="mudo">Dados, parcelas, estatística, ${S.projeto.tipo === 'cerrado' ? 'fitossociologia, ' : ''}vértices e pontos, com as coordenadas em UTM.</p>
      <button class="largo sec" data-a="exp" data-f="csv">Dados de campo (.csv)</button>
      <button class="largo sec" data-a="exp" data-f="kml">Mapa: parcelas e pontos (.kml)</button>
      <button class="largo sec" data-a="exp" data-f="geojson">Mapa para o Guru Maps (.geojson)</button>
      <button class="largo sec" data-a="exp" data-f="png">Mapa em imagem (.png)</button>
      <button class="largo sec" data-a="exp" data-f="fotos">Fotos (${S.fotos.length}) para a pasta</button>
      <p class="mudo">Desenho das áreas do KML com as parcelas numeradas, legenda, escala e coordenadas UTM.</p></div>
      <div class="cartao"><h3>Backup e outro aparelho</h3>
      ${Plataforma.nativo ? `<p class="mudo">Backup automático: ${S.projeto.ultimoAutoBackup ? `último ${tempoAtras(S.projeto.ultimoAutoBackup)}` : 'ainda nenhum'}, em Documentos/Inventario/backup-automatico. Ele é gravado ao fechar cada parcela e ao sair dela. Fica só no aparelho: mande o backup para fora daqui de vez em quando.</p>` : ''}
      <p class="mudo">Último backup enviado: ${S.projeto.ultimoBackupEnviado ? tempoAtras(S.projeto.ultimoBackupEnviado) : 'nenhum'}.${Plataforma.nativo ? '' : ' Nesta versão o backup não é gravado sozinho: exporte ao fim de cada parcela ou de cada dia (no iPhone, escolha "Salvar em Arquivos" ou mande pelo WhatsApp).'}</p>
      <button class="largo" data-a="enviar">📤 Enviar para outro aparelho</button>
      <button class="largo sec" data-a="exp" data-f="backup">Salvar o backup (.json)</button>
      <p class="mudo">No outro aparelho, toque em 📥 Receber dados na tela inicial${Plataforma.nativo ? ' (ou abra o arquivo recebido com este app)' : ''}. Antes de juntar, o app mostra o que vai entrar. Quando a mesma parcela existe nos dois, fica a versão alterada por último.</p></div>`;
  }

  // ---------------- mapa (SVG, sem internet) ----------------
  // fotos com posição (a da própria foto ou, sem ela, a do ponto a que pertence)
  function fotosNoMapa() {
    const z = Mapa.z || zona(S.projeto);
    return S.fotos.map(f => {
      let lat = f.lat, lon = f.lon;
      if (lat == null && f.pontoId) { const p = S.pontos.find(x => x.id === f.pontoId); if (p) { lat = p.lat; lon = p.lon; } }
      return Number.isFinite(lat) && Number.isFinite(lon) ? { f: { ...f, lat, lon }, u: Geo.paraUTM(lat, lon, z) } : null;
    }).filter(Boolean);
  }
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
      fotosNoMapa().forEach(({ f }) => pts.push(U(f.lat, f.lon)));
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
        ${pon.map(({ p, u }) => p.tipo === 'planejado'
          ? `<polygon points="${X(u)},${Y(u) - k * 1.3} ${X(u) + k * 1.1},${Y(u) + k * 0.8} ${X(u) - k * 1.1},${Y(u) + k * 0.8}" fill="${p.feito ? '#2e7d32' : cores.planejado}" stroke="#fff" stroke-width="${k * 0.2}"/>
             <text class="m-rot3" x="${X(u)}" y="${Y(u) - k * 1.8}" font-size="${k * 2.2}">${esc(p.nome || '')}</text>`
          : `<circle cx="${X(u)}" cy="${Y(u)}" r="${k * 0.8}" fill="${cores[p.tipo] || '#555'}" stroke="#fff" stroke-width="${k * 0.2}"/>`).join('')}
        ${fotosNoMapa().map(({ f, u }) => `<g class="m-foto" data-a="ver-foto" data-id="${f.id}" transform="translate(${X(u)},${Y(u)})">
            <rect x="${-k * 1.1}" y="${-k * 0.8}" width="${k * 2.2}" height="${k * 1.6}" rx="${k * 0.3}"/><circle r="${k * 0.45}"/></g>`).join('')}
        <g id="m-eu"></g></svg>
        <div class="mapa-botoes"><button class="mini" data-a="zoom" data-z="0.6">+</button><button class="mini" data-a="zoom" data-z="1.6">−</button><button class="mini sec" data-a="zoom" data-z="0">⌂</button><button class="mini sec" data-a="zoom" data-z="eu">◎</button><button class="mini sec" data-a="exp" data-f="png" title="Salvar o mapa em imagem">⤓</button></div>
        <p class="mudo legenda"><span style="color:#2e7d32">■</span> estratos <span style="color:#ef6c00">■</span> parcelas <span style="color:#c62828">●</span> árvores <span style="color:#1565c0">▲</span> a fazer <span style="color:#2e7d32">▲</span> feitas <span style="color:#6a1b9a">■</span> fotos (toque para abrir) <span style="color:#0d47a1">◉</span> você</p>`;
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
      const ini = new Map();
      svg.addEventListener('pointerdown', e => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); ini.set(e.pointerId, { x: e.clientX, y: e.clientY }); ult = null; });
      svg.addEventListener('pointermove', e => {
        if (!ptrs.has(e.pointerId)) return;
        const o = ini.get(e.pointerId);
        if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) < 5 && ptrs.size === 1) return;   // ainda é um toque, não um arrasto
        if (o) { svg.setPointerCapture(e.pointerId); ini.delete(e.pointerId); }
        const ant = ptrs.get(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size === 1) { const s = escala(); this.vb.x -= (e.clientX - ant.x) * s; this.vb.y -= (e.clientY - ant.y) * s; this.aplicar(); }
        else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (ult) this.zoom(String(ult / d)); ult = d; }
      });
      const fim = e => { ptrs.delete(e.pointerId); ini.delete(e.pointerId); ult = null; };
      svg.addEventListener('pointerup', fim); svg.addEventListener('pointercancel', fim);
      svg.addEventListener('wheel', e => { e.preventDefault(); this.zoom(e.deltaY > 0 ? '1.2' : '0.83'); }, { passive: false });
    }
  };

  // ---------------- ações ----------------
  async function acao(a, el) {
    const proj = S.projeto, pc = parcelaAtual();
    switch (a) {
      case 'voltar':
        if (S.view === 'parcela') { await gravarCabecalho(); S.view = 'projeto'; S.editando = null; S.extras = []; if (S.sujo) backupAutomatico(); }
        else if (S.view === 'navegar') { S.view = 'projeto'; S.aba = 'parcelas'; }
        else if (S.view === 'novo' || S.view === 'projeto') {
          if (S.view === 'projeto' && S.sujo) await backupAutomatico(); S.view = 'home'; S.projeto = null; S.aba = 'parcelas'; Mapa.vb = null; }
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
        if (await apagarInventario(proj.id)) { S.view = 'home'; S.projeto = null; render(); preencherHome(); }
        break;
      case 'apagar-da-lista':
        if (await apagarInventario(el.dataset.id)) preencherHome();
        break;
      case 'enviar-da-lista': await enviarInventario(el.dataset.id); preencherHome(); break;
      case 'enviar': await enviarInventario(proj.id); render(); break;
      case 'salvar-equipe': {
        S.equipe = $('#equipe').value.trim(); await DB.config('equipe', S.equipe);
        const ini = parseInt($('#inicio-num').value, 10);
        S.inicioNum = ini > 0 && ini < 10000 ? ini : 1; $('#inicio-num').value = S.inicioNum; await DB.config('inicioNum', S.inicioNum);
        toast(`Salvo. Parcelas novas deste aparelho começam em ${padNum(S.inicioNum)}.`, 'ok'); break;
      }
      case 'nova-parcela': {
        const prox = proximoNumero();
        const pcN = { id: uid(), projetoId: proj.id, numero: padNum(prox), estrato: '', vertices: [], arvores: [], obs: '', criado: Date.now(), fechada: false, excluir: false };
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
        // o fuste vai para a última árvore viva (nunca para uma falha)
        const vivas = pc.arvores.filter(x => !x.falha), ultViva = vivas.length ? vivas[vivas.length - 1].arvore : 0;
        if (m === 'fuste' && !ultViva) { toast('Lance a árvore antes do fuste', 'erro'); return; }
        const reg = { id: uid(), arvore: m === 'fuste' ? ultViva : ult + 1, falha: m === 'falha', CAP: m === 'falha' ? null : cap, H: m === 'falha' ? null : h };
        if (!(await conferirMedia(reg, pc.arvores, 'eucalipto'))) return;
        const al = Calc.alertasArvore(reg, pc.arvores[pc.arvores.length - 1], params(proj), 'eucalipto').filter(x => x.nivel !== 'info');
        pc.arvores.push(reg); await salvarParcela(pc);
        if (al.length) toast(al.map(x => '⚠ ' + esc(x.msg)).join('<br>'), 'aviso');
        S.focar = true; S.campo = null; render(); break;
      }
      case 'desfazer': {
        if (!pc.arvores.length) return toast('Nada para desfazer', 'aviso');
        const a = pc.arvores[pc.arvores.length - 1], euc = proj.tipo === 'eucalipto';
        const nf = S.fotos.filter(f => f.arvoreId === a.id).length;
        const nFuste = euc ? pc.arvores.filter(x => x.arvore === a.arvore && !x.falha).length : 0;
        const desc = euc ? (a.falha ? `Falha (árvore ${a.arvore})` : `Árvore ${a.arvore}${nFuste > 1 ? `, fuste ${nFuste}` : ''} — CAP ${fmt(a.CAP, 1)}${a.H != null ? ` · H ${fmt(a.H, 1)}` : ''}`)
          : `${esc(a.nome)} — H ${fmt(a.H, 1)} · CAP ${fmt(a.CAP, 1)}${(a.fustesExtras || []).length ? ` + ${a.fustesExtras.length} fuste(s)` : ''}`;
        if (!(await simNao('Desfazer o último lançamento?', `<p><b>${desc}</b></p><p class="mudo">Os valores voltam para os campos, para corrigir e gravar de novo.${nf ? ` A(s) ${nf} foto(s) desta árvore serão apagadas.` : ''}</p>`, { sim: 'DESFAZER', nao: 'NÃO', perigo: false }))) return;
        pc.arvores.pop(); await apagarFotos(f => f.arvoreId === a.id); await salvarParcela(pc);
        S.editando = null; S.extras = euc ? [] : [...(a.fustesExtras || [])]; S.campo = null; render();
        if ($('#e-cap')) $('#e-cap').value = a.CAP != null ? vIn(a.CAP) : '';
        if ($('#e-h')) $('#e-h').value = a.H != null ? vIn(a.H) : '';
        if ($('#e-nome')) $('#e-nome').value = a.nome || '';
        toast('Último lançamento desfeito', 'ok'); break;
      }
      case 'add-extra': {
        S.extras = lerExtras(); S.extras.push(null); guardarRascunho(); render(); restaurarRascunho();
        const id = `e-x${S.extras.length - 1}`; if (usaTeclado()) marcarCampo(id); else $('#' + id)?.focus(); break;
      }
      case 'add-cerrado': {
        const reg = lerCerrado(); if (!reg) return;
        reg.id = uid();
        if (!(await conferirMedia(reg, pc.arvores, 'cerrado'))) return;
        const al = Calc.alertasArvore(reg, pc.arvores[pc.arvores.length - 1], params(proj), 'cerrado');
        pc.arvores.push(reg); S.extras = []; aprenderEspecie(reg.nome); await salvarParcela(pc);
        if (al.length) toast(al.map(x => (x.nivel === 'info' ? 'ℹ ' : '⚠ ') + esc(x.msg)).join('<br>'), 'aviso');
        S.focar = true; S.campo = null; render();
        await avisoEspecial(reg, pc);
        break;
      }
      case 'editar': {
        await gravarCabecalho();
        S.editando = el.dataset.id; const a2 = pc.arvores.find(x => x.id === S.editando); S.extras = [...(a2.fustesExtras || [])]; render();
        $('#entrada')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
      }
      case 'cancelar-edicao': S.editando = null; S.extras = []; S.campo = null; render(); break;
      case 'salvar-edicao': {
        const a2 = pc.arvores.find(x => x.id === S.editando);
        const outros = pc.arvores.filter(x => x.id !== a2.id);
        if (proj.tipo === 'eucalipto') {
          const novo = { CAP: numIn($('#e-cap').value), H: numIn($('#e-h').value) };
          if (!(await conferirMedia(novo, outros, 'eucalipto'))) return;
          a2.CAP = novo.CAP; a2.H = novo.H; if (a2.CAP) a2.falha = false;
        } else {
          const r = lerCerrado(); if (!r) return;
          if (!(await conferirMedia(r, outros, 'cerrado'))) return;
          Object.assign(a2, r); aprenderEspecie(r.nome);
        }
        S.editando = null; S.extras = []; await salvarParcela(pc); toast('Alterado', 'ok'); render(); break;
      }
      case 'del-arvore': if (confirm('Excluir este registro?')) { await apagarFotos(f => f.arvoreId === S.editando); pc.arvores = pc.arvores.filter(x => x.id !== S.editando); S.editando = null; S.extras = []; await salvarParcela(pc); render(); } break;
      case 'fechar-parcela': {
        await gravarCabecalho(); pc.fechada = !pc.fechada; await salvarParcela(pc);
        if (pc.fechada) {
          await backupAutomatico();
          if (pc.vertices.length < 3) toast('Parcela fechada sem os vértices completos no GPS.', 'aviso');
          const R = calcular(proj, S.parcelas);
          S.view = 'projeto'; S.aba = 'parcelas'; render();
          if (R.est.n >= 2) toast(`Parcela ${esc(pc.numero)} fechada. Erro agora: <b>${fmt(R.est.erroRel, 1)}%</b>${R.est.atende ? ' ✓' : ` — faltam ~${R.est.faltam} parcelas`}`, R.est.atende ? 'ok' : 'aviso');
        } else render();
        break;
      }
      case 'excluir-calculo': pc.excluir = !pc.excluir; await salvarParcela(pc); render(); break;
      case 'apagar-parcela': if (confirm(`Apagar a parcela ${pc.numero} com ${pc.arvores.length} registros?`)) {
        await apagarFotos(f => f.parcelaId === pc.id); await DB.apagar('parcelas', pc.id); S.parcelas = S.parcelas.filter(x => x.id !== pc.id); S.view = 'projeto'; render(); } break;
      case 'marcar-ponto': {
        const nome = $('#pt-nome').value.trim(), tipo = $('#pt-tipo').value, obs = $('#pt-obs').value.trim();
        const v = await GPS.capturar(proj.params.segundosGPS ?? 10, `Ponto: ${nome || tipo}`); if (!v) return;
        if (!proj.zonaUTM) { proj.zonaUTM = Geo.zonaDe(v.lon); await salvarProjeto(); }
        await salvarPonto({ id: uid(), projetoId: proj.id, tipo, especie: tipo === 'arvore' ? nome : '', nome: tipo !== 'arvore' ? nome : '', obs, situacao: tipo === 'arvore' ? situacaoEspecie(nome) : '', ...v });
        if (tipo === 'arvore') aprenderEspecie(nome);
        toast('Ponto marcado', 'ok'); render(); break;
      }
      case 'del-ponto': if (confirm('Apagar este ponto?')) { await apagarFotos(f => f.pontoId === el.dataset.id); await DB.apagar('pontos', el.dataset.id); S.pontos = S.pontos.filter(p => p.id !== el.dataset.id); render(); } break;
      case 'zoom': Mapa.zoom(el.dataset.z); break;
      case 'sol': await definirSol(!S.sol); break;
      case 'gps-chip':
        if (GPS.ligado() && !gpsNecessario()) { GPS.temporario = 0; GPS.desligar(); toast('GPS em pausa', 'ok'); }
        else if (!GPS.ligado()) { GPS.ligarPor(5 * 60 * 1000); toast('GPS ligado por 5 minutos', 'ok'); }
        else toast(GPS.pos ? `Precisão ±${fmt(GPS.pos.coords.accuracy, 1)} m` : 'Procurando sinal…');
        break;
      case 'eq-padrao': ['cerrado', 'cerradao'].forEach(k => ['b0', 'b1', 'b2'].forEach(c => { const el = $(`#c-${k}-${c}`); if (el) el.value = vIn(Calc.EQUACOES[k][c]); })); toast('Equações da planilha restauradas. Toque em Salvar.', 'ok'); break;
      case 'foto': {
        const t = el.dataset.tipo;
        if (t === 'parcela') { await gravarCabecalho(); await novaFoto({ tipo: 'parcela', parcelaId: pc.id }); }
        else if (t === 'arvore') await novaFoto({ tipo: 'arvore', parcelaId: pc.id, arvoreId: S.editando });
        else if (t === 'ponto') { const pt = S.pontos.find(x => x.id === el.dataset.id); await novaFoto({ tipo: 'ponto', pontoId: pt.id, parcelaId: pt.parcelaId || null, arvoreId: null }); }
        break;
      }
      case 'ver-foto': verFoto(el.dataset.id); break;
      case 'voz': await lancarPorVoz(pc); break;
      case 'hipsometro': await Hipso.abrir(); break;
      case 'planejar': await planejarParcelas(); break;
      case 'navegar': {
        const alvo = el.dataset.id || proximoPlanejado()?.id;
        if (!alvo) return toast('Nenhuma parcela planejada a fazer', 'aviso');
        S.alvoId = alvo; S.view = 'navegar'; render(); window.scrollTo(0, 0); break;
      }
      case 'nav-proxima': { const p = proximoPlanejado(S.alvoId); if (p) { S.alvoId = p.id; render(); } else toast('Não há outra parcela a fazer', 'aviso'); break; }
      case 'nav-abrir': await abrirParcelaPlanejada(); break;
      case 'bussola-ios': {
        Bussola.permitido = await pedirSensor();
        if (!Bussola.permitido) toast('Sem permissão da bússola: a seta vai mostrar o rumo a partir do Norte.', 'aviso');
        Bussola.desligar(); render(); break;
      }
      case 'exp': await exportar(el.dataset.f); break;
    }
  }

  // Pergunta antes de gravar um valor muito fora da média da parcela. true = pode gravar
  async function conferirMedia(reg, outros, tipo) {
    const msgs = Calc.foraDaMedia(reg, outros, tipo);
    if (!msgs.length) return true;
    const ok = await simNao('Conferir o valor', `<p>${msgs.map(m => esc(m.msg)).join('<br>')}</p><p class="mudo">Pode ser erro de digitação.</p>`,
      { nao: 'CORRIGIR', sim: 'GRAVAR ASSIM', perigo: false });
    if (!ok) { S.campo = msgs[0].campo; const el = $('#' + msgs[0].campo); if (el) { marcarCampo(msgs[0].campo); if (!usaTeclado()) { el.focus(); el.select?.(); } } }
    return ok;
  }

  // ----- backup automático (no app Android grava sozinho em Documentos/Inventario/backup-automatico) -----
  async function backupAutomatico() {
    if (!Plataforma.nativo || !S.projeto) return;
    try {
      const blob = Exportar.backup(S.projeto, S.parcelas, S.pontos, S.fotos);
      const nome = Exportar.nomeArquivo(S.projeto, 'backup_automatico', 'json');
      await Plataforma.salvarSilencioso(await Plataforma.paraBase64(blob), `backup-automatico/${nome}`);
      S.projeto.ultimoAutoBackup = Date.now(); await DB.salvarCru('projetos', S.projeto); S.sujo = false;
    } catch (e) { console.error(e); toast('Não consegui gravar o backup automático: ' + esc(e.message), 'aviso'); }
  }
  const tempoAtras = t => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 2 ? 'agora há pouco' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : `há ${Math.round(m / 1440)} dia(s)`;
  };

  // curva espécie × área (média de 200 ordens aleatórias das parcelas, e a observada)
  function curvaSVG(D) {
    if (D.n < 2) return '';
    const W = 320, H = 170, m = { l: 34, r: 8, t: 10, b: 28 }, xs = D.curva.map(c => c.areaHa), ymax = Math.max(...D.curva.map(c => Math.max(c.media, c.observada)));
    const X = v => m.l + v / xs[xs.length - 1] * (W - m.l - m.r), Y = v => H - m.b - v / ymax * (H - m.t - m.b);
    const linha = k => D.curva.map((c, i) => `${i ? 'L' : 'M'}${X(c.areaHa).toFixed(1)},${Y(c[k]).toFixed(1)}`).join('');
    return `<svg class="curva" viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva espécie por área">
      <line x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}" class="eixo"/><line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${H - m.b}" class="eixo"/>
      <path d="${linha('observada')}" class="obs"/><path d="${linha('media')}" class="med"/>
      <text x="${m.l - 4}" y="${Y(ymax) + 4}" text-anchor="end">${Math.round(ymax)}</text><text x="${m.l - 4}" y="${H - m.b}" text-anchor="end">0</text>
      <text x="${W - m.r}" y="${H - 8}" text-anchor="end">${fmt(xs[xs.length - 1], 2)} ha</text><text x="${m.l}" y="${H - 8}">área amostrada</text>
      <text x="${m.l + 6}" y="${m.t + 10}" class="leg-med">— média</text><text x="${m.l + 64}" y="${m.t + 10}" class="leg-obs">— ordem de medição</text></svg>`;
  }

  // ----- lançamento por voz -----
  async function lancarPorVoz(pc) {
    const euc = S.projeto.tipo === 'eucalipto';
    if (!Voz.disponivel()) return toast('Lançamento por voz indisponível neste aparelho ou navegador.', 'aviso');
    let alts;
    try { alts = await Voz.ouvir(euc ? 'Fale: CAP 45, altura 18 (ou "falha")' : 'Fale: espécie, altura, CAP'); }
    catch (e) { return toast('Voz: ' + esc(e.message), 'erro'); }
    if (!alts || !alts.length) return;
    const r = Voz.melhor(alts, S.projeto.tipo, listaEspecies());
    if (euc && r.falha) {
      if (await simNao('Lançar falha?', `<p>Ouvi: “${esc(alts[0])}”</p>`, { sim: 'LANÇAR FALHA', nao: 'NÃO', perigo: false })) await acao('add-euc', { dataset: { m: 'falha' } });
      return;
    }
    if (!euc && r.nome && $('#e-nome')) $('#e-nome').value = r.nome;
    if (r.H != null && $('#e-h')) $('#e-h').value = vIn(r.H);
    if (r.CAP != null && $('#e-cap')) $('#e-cap').value = vIn(r.CAP);
    if (!euc && r.extras.length) { guardarRascunho(); S.extras = [...r.extras]; render(); restaurarRascunho(); }
    const faltou = (euc ? [r.CAP == null && 'CAP'] : [!r.nome && 'espécie', r.CAP == null && 'CAP']).filter(Boolean).join(' e ');
    if (r.gravar && !faltou) { await acao(euc ? 'add-euc' : 'add-cerrado', { dataset: { m: r.fuste ? 'fuste' : 'nova' } }); return; }
    const partes = [!euc && r.nome ? `<b>${esc(r.nome)}</b>` : '', r.H != null ? `H ${fmt(r.H, 1)}` : '', r.CAP != null ? `CAP ${fmt(r.CAP, 1)}` : '', r.extras.length ? `fustes ${r.extras.map(x => fmt(x, 0)).join(' + ')}` : ''].filter(Boolean).join(' · ');
    toast(`🎤 “${esc(alts[0])}”<br>${partes || 'Não entendi os valores.'}${faltou ? `<br>Faltou: ${faltou}` : ''}${!euc && r.nome && !r.exato ? '<br>Nome aproximado: confira.' : ''}${euc && r.fuste ? '<br>Toque em + Fuste para gravar.' : '<br>Confira e grave.'}`, faltou || (!euc && r.nome && !r.exato) ? 'aviso' : 'ok');
  }

  // ----- hipsômetro: o celular mede o ângulo da base e do topo; H = d · (tan α topo − tan α base) -----
  const Hipso = {
    leit: [], m: null, stream: null, base: null, topo: null,
    // ângulo do eixo da câmera de trás acima do horizonte (graus), pelos ângulos beta e gama do aparelho
    angulo(e) { if (e.beta == null) return null; const r = Math.PI / 180; return Math.asin(Math.max(-1, Math.min(1, -Math.cos(e.beta * r) * Math.cos((e.gamma || 0) * r)))) / r; },
    ev(e) {
      const a = Hipso.angulo(e); if (a == null) return;
      Hipso.leit.push({ a, t: Date.now() }); if (Hipso.leit.length > 60) Hipso.leit.shift();
      const el = $('#hp-ang'); if (el) el.textContent = `${fmt(Hipso.media(300), 1)}°`;
    },
    // média das leituras do último meio segundo que estão perto da última (descarta o movimento de mirar)
    media(ms = 500) {
      const t = Date.now(), u = this.leit[this.leit.length - 1]; if (!u || t - u.t > 2000) return null;
      const L = this.leit.filter(x => t - x.t <= ms && Math.abs(x.a - u.a) <= 1.5);
      return L.length ? L.reduce((s, x) => s + x.a, 0) / L.length : u.a;
    },
    async abrir() {
      if (!(await pedirSensor())) return toast('Sem permissão do sensor de movimento.', 'erro');
      this.leit = []; this.base = null; this.topo = null;
      const d0 = S.projeto.params.distHipso || 15;
      const m = this.m = modal(`<div class="hipso"><div class="hipso-video"><video id="hp-video" playsinline muted autoplay></video><div class="mira"></div><div class="hipso-ang" id="hp-ang">—</div></div>
        <label>Distância horizontal até a árvore (m)<input id="hp-d" inputmode="decimal" value="${vIn(d0)}"></label>
        <div class="hipso-leit"><span>Base <b id="hp-b">—</b></span><span>Topo <b id="hp-t">—</b></span><span>Altura <b id="hp-h">—</b></span></div>
        <p class="mudo" id="hp-dica">Mire a <b>base</b> do tronco com a cruz e toque em Base. Depois mire o <b>topo</b> e toque em Topo.</p>
        <div class="botoes"><button data-m="base">Base</button><button data-m="topo">Topo</button></div>
        <div class="botoes"><button class="sec" data-m="cancelar">Cancelar</button><button data-m="usar" id="hp-usar" disabled>Usar a altura</button></div></div>`);
      m.classList.add('hipso-fundo');
      window.addEventListener('deviceorientation', this.ev);
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        const v = $('#hp-video', m); if (v) v.srcObject = this.stream; else this.parar();
      } catch (e) { const b = $('.hipso-video', m); if (b) b.classList.add('sem-camera'); $('#hp-dica', m).innerHTML = 'Câmera indisponível: aponte a traseira do celular para o alvo, como para fotografar. ' + $('#hp-dica', m).innerHTML; }
      setTimeout(() => { if (this.m === m && !this.leit.length) $('#hp-ang', m).textContent = 'sem sensor'; }, 1500);
      return new Promise(res => m.addEventListener('click', async e => {
        const a = e.target.closest('[data-m]')?.dataset.m; if (!a) return;
        if (a === 'base' || a === 'topo') {
          const v = this.media(); if (v == null) return toast('O sensor de inclinação não respondeu.', 'erro');
          this[a] = v; Plataforma.vibrar();
          $(`#hp-${a[0]}`, m).textContent = `${fmt(v, 1)}°`;
          const H = this.altura(numIn($('#hp-d', m).value));
          $('#hp-h', m).textContent = H != null ? `${fmt(H, 1)} m` : '—';
          $('#hp-usar', m).disabled = !(H > 0);
          if (a === 'base' && this.topo == null) $('#hp-dica', m).innerHTML = 'Agora mire o <b>topo</b> da copa e toque em Topo.';
          else if (a === 'topo' && this.base == null) $('#hp-dica', m).innerHTML = 'Agora mire a <b>base</b> do tronco e toque em Base.';
          else if (H > 0) $('#hp-dica', m).innerHTML = 'Confira e toque em <b>Usar a altura</b>. Para refazer, mire de novo e toque em Base ou Topo.';
          if (H != null && H <= 0) $('#hp-dica', m).textContent = 'O topo ficou abaixo da base: refaça as miradas.';
          return;
        }
        const d = numIn($('#hp-d', m).value), H = this.altura(d);
        this.fechar();
        if (a === 'usar' && H > 0) {
          if (d !== S.projeto.params.distHipso) { S.projeto.params.distHipso = d; salvarProjeto(); }
          const el = $('#e-h'); if (el) { el.value = vIn(Math.round(H * 10) / 10); if (usaTeclado()) marcarCampo('e-cap'); }
          toast(`Altura ${fmt(H, 1)} m (distância ${fmt(d, 1)} m)`, 'ok');
        }
        res(a === 'usar' ? H : null);
      }));
    },
    altura(d) { if (this.base == null || this.topo == null || !(d > 0)) return null; const r = Math.PI / 180; return d * (Math.tan(this.topo * r) - Math.tan(this.base * r)); },
    parar() { if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } },
    fechar() { window.removeEventListener('deviceorientation', this.ev); this.parar(); if (this.m) { this.m.remove(); this.m = null; } }
  };

  // ----- fotos -----
  const miniaturas = L => L.length ? `<div class="fotos">${L.map(f => `<img src="${f.data}" alt="foto" loading="lazy" data-a="ver-foto" data-id="${f.id}">`).join('')}</div>` : '';
  const iconeFoto = arvoreId => { const n = S.fotos.filter(f => f.arvoreId === arvoreId).length; return n ? ` <span class="tag">📷${n > 1 ? n : ''}</span>` : ''; };
  const fotosArvoreHTML = a => `<div class="linha-fotos"><button class="sec mini" data-a="foto" data-tipo="arvore">📷 Foto desta árvore</button>${miniaturas(S.fotos.filter(f => f.arvoreId === a.id))}</div>`;
  async function novaFoto(vinc) {
    GPS.ligarPor(90000);                       // o GPS já vai achando a posição enquanto a câmera está aberta
    let data;
    try { data = await Plataforma.tirarFoto(); } catch (e) { toast('Câmera: ' + esc(e.message), 'erro'); return; }
    if (!data) return;
    let pos = GPS.fresca();
    if (!pos) { toast('Obtendo a localização da foto…'); pos = await GPS.posicaoAte(12000); }
    const c = pos?.coords;
    const f = { id: uid(), projetoId: S.projeto.id, ...vinc, hora: agora(), lat: c?.latitude ?? null, lon: c?.longitude ?? null, acc: c?.accuracy ?? null, alt: c?.altitude ?? null, autor: S.equipe };
    f.data = Plataforma.comExif(data, f);      // a localização vai dentro do próprio arquivo JPEG
    if (!c) toast('Foto sem localização: o GPS não respondeu a tempo.', 'aviso');
    await DB.salvar('fotos', f); S.fotos.push(f); S.sujo = true;
    if (c) toast(`Foto guardada com localização (±${fmt(c.accuracy, 0)} m)`, 'ok'); render();
  }
  function verFoto(id) {
    const f = S.fotos.find(x => x.id === id); if (!f) return;
    const m = modal(`<img class="foto-grande" src="${f.data}" alt="foto"><p class="mudo">${esc(f.hora || '')} · ${f.lat != null ? `📍 ${fmt(f.lat, 6)}, ${fmt(f.lon, 6)}${f.acc != null ? ` (±${fmt(f.acc, 0)} m)` : ''}` : 'sem localização'}</p>
      <label>Legenda<input id="foto-leg" value="${esc(f.legenda || '')}" placeholder="opcional"></label>
      <div class="botoes"><button class="perigo" data-m="apagar">Apagar foto</button><button data-m="ok">Fechar</button></div>`);
    m.addEventListener('click', async e => {
      const a = e.target.dataset.m; if (!a) return;
      const leg = $('#foto-leg', m).value.trim();
      m.remove();
      if (a === 'apagar') { if (await simNao('Apagar a foto?', '<p>Não dá para desfazer.</p>')) { await apagarFotos(x => x.id === id); render(); } return; }
      if (leg !== (f.legenda || '')) { f.legenda = leg; await DB.salvar('fotos', f); }
    });
  }
  async function apagarFotos(filtro) {
    const L = S.fotos.filter(filtro);
    for (const f of L) await DB.apagar('fotos', f.id);
    S.fotos = S.fotos.filter(f => !L.includes(f));
  }
  async function exportarFotos() {
    if (!S.fotos.length) return toast('Nenhuma foto neste inventário', 'aviso');
    const nomes = Exportar.nomesFotos(S.projeto, S.parcelas, S.pontos, S.fotos);
    const pasta = Exportar.semVirgula(S.projeto.nome);
    if (Plataforma.nativo) {
      for (const f of S.fotos) await Plataforma.salvarSilencioso(Plataforma.comExif(f.data, f).split(',')[1], `fotos/${pasta}/${nomes.get(f.id)}`);
      toast(`${S.fotos.length} foto(s) salvas em Documentos/Inventario/fotos/${esc(pasta)}`, 'ok');
    } else {
      for (const f of S.fotos) { const a = document.createElement('a'); a.href = Plataforma.comExif(f.data, f); a.download = nomes.get(f.id); document.body.appendChild(a); a.click(); a.remove(); await new Promise(r => setTimeout(r, 300)); }
    }
  }

  // ----- planejamento das parcelas -----
  const padNum = n => String(n).padStart(S.projeto?.tipo === 'cerrado' ? 3 : 2, '0');
  /* próximo número livre para uma parcela nova feita neste aparelho: o primeiro número, a partir do início
     configurado em Equipe e aparelho, que nenhuma parcela nem ponto planejado usa */
  function proximoNumero() {
    const ini = S.inicioNum || 1, num = x => parseInt(String(x).replace(/\D/g, ''), 10) || 0;
    const usados = new Set([...S.parcelas.map(p => num(p.numero)), ...S.pontos.filter(p => p.tipo === 'planejado').map(p => num(p.nome))]);
    let n = ini;
    while (usados.has(n)) n++;
    return n;
  }
  async function planejarParcelas() {
    const proj = S.projeto, P = params(proj);
    const est = estratosUTM(proj).map(e => ({ ...e, areaHa: +(proj.estratos.find(x => x.nome === e.nome)?.areaHa) || Geo.areaPoligono(e.poly) / 10000 }));
    if (!est.length) return toast('Importe o KML das áreas em Ajustes primeiro', 'aviso');
    const R = calcular(proj, S.parcelas), sug = Math.max(R.est.parcelasNecessarias || 0, est.length * 2, 10);
    const m = modal(`<h3>Planejar parcelas</h3>
      <p class="mudo">${est.length} estrato(s) com polígono · ${fmt(est.reduce((s, e) => s + e.areaHa, 0), 2)} ha. As parcelas são divididas entre os estratos pela área (no mínimo 2 em cada).</p>
      <label>Quantas parcelas?<input id="pl-n" inputmode="numeric" value="${sug}"></label>
      <label>Como distribuir<select id="pl-m"><option value="sistematico">Sistemática (grade regular)</option><option value="aleatorio">Aleatória (sorteio)</option></select></label>
      <label>Distância mínima da borda (m)<input id="pl-b" inputmode="decimal" value="${Math.max(P.comprimento, P.largura)}"></label>
      <div class="botoes"><button class="sec" data-m="cancelar">Cancelar</button><button data-m="gerar">Gerar</button></div>`);
    const r = await new Promise(res => m.addEventListener('click', e => {
      const a = e.target.dataset.m; if (!a) return;
      const o = { n: parseInt($('#pl-n', m).value) || 0, metodo: $('#pl-m', m).value, borda: numIn($('#pl-b', m).value) ?? 0 };
      m.remove(); res(a === 'gerar' ? o : null);
    }));
    if (!r || r.n < 1) return;
    const antigos = S.pontos.filter(p => p.tipo === 'planejado' && p.plano && !p.feito);
    if (antigos.length && !(await simNao('Substituir o plano?', `<p>Já existem ${antigos.length} parcela(s) planejada(s) ainda não feitas. Elas serão trocadas pelo plano novo. As já feitas continuam.</p>`, { sim: 'SUBSTITUIR', nao: 'CANCELAR', perigo: false }))) return;
    for (const p of antigos) await DB.apagar('pontos', p.id);
    S.pontos = S.pontos.filter(p => !antigos.includes(p));
    const out = Plano.distribuir(est, { ...r, semente: Date.now() });
    const z = zona(proj), sul = (proj.estratos.find(e => e.coords?.length)?.coords[0].lat ?? -1) < 0;
    const usados = new Set([...S.parcelas.map(p => parseInt(p.numero) || 0), ...S.pontos.filter(p => p.tipo === 'planejado').map(p => parseInt(String(p.nome).replace(/\D/g, '')) || 0)]);
    let num = 1; const plano = uid();
    for (const pt of out.pontos) {
      while (usados.has(num)) num++;
      usados.add(num);
      const ll = Geo.deUTM(pt.E, pt.N, z, sul);
      await salvarPonto({ id: uid(), projetoId: proj.id, tipo: 'planejado', plano, nome: 'P' + padNum(num), estrato: pt.estrato, lat: ll.lat, lon: ll.lon, acc: null, hora: '', feito: false });
    }
    const falt = out.porEstrato.filter(e => e.geradas < e.pedidas);
    toast(`${out.pontos.length} parcelas planejadas.${falt.length ? `<br>⚠ ${falt.map(e => `${esc(e.nome)}: ${e.geradas} de ${e.pedidas}`).join('; ')} — área pequena para a borda pedida.` : ''}`, falt.length ? 'aviso' : 'ok');
    S.aba = 'mapa'; Mapa.vb = null; render();
  }
  function proximoPlanejado(excetoId) {
    const L = S.pontos.filter(p => p.tipo === 'planejado' && !p.feito && p.id !== excetoId);
    if (!L.length) return null;
    if (!GPS.pos) return L.sort((a, b) => String(a.nome).localeCompare(String(b.nome)))[0];
    const z = zona(S.projeto), eu = Geo.paraUTM(GPS.pos.coords.latitude, GPS.pos.coords.longitude, z);
    return L.map(p => ({ p, d: Geo.dist(eu, Geo.paraUTM(p.lat, p.lon, z)) })).sort((a, b) => a.d - b.d)[0].p;
  }
  async function abrirParcelaPlanejada() {
    const pt = S.pontos.find(p => p.id === S.alvoId); if (!pt) return;
    const numero = padNum(parseInt(String(pt.nome).replace(/\D/g, '')) || 0);
    let pc = S.parcelas.find(p => p.id === pt.parcelaId) || S.parcelas.find(p => p.numero === numero);
    if (!pc) {
      pc = { id: uid(), projetoId: S.projeto.id, numero, estrato: pt.estrato || '', vertices: [], arvores: [], obs: '', criado: Date.now(), fechada: false, excluir: false, planejadoId: pt.id };
      await salvarParcela(pc);
    }
    pt.feito = true; pt.parcelaId = pc.id; await salvarPonto(pt);
    S.parcelaId = pc.id; S.view = 'parcela'; S.editando = null; S.extras = []; S.campo = null; render(); window.scrollTo(0, 0);
    toast(`Parcela ${esc(pc.numero)} aberta. Comece marcando os vértices.`, 'ok');
  }

  // ----- tela de navegação -----
  const cardeal = a => ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(a / 45) % 8];
  function telaNavegar() {
    const pt = S.pontos.find(p => p.id === S.alvoId);
    if (!pt) return '<p class="mudo">Ponto não encontrado.</p>';
    const pend = S.pontos.filter(p => p.tipo === 'planejado' && !p.feito).length;
    return `<section class="navegar">
      <div class="nav-alvo">Indo para <b>${esc(pt.nome || pt.especie)}</b>${pt.estrato ? ` · ${esc(pt.estrato)}` : ''}</div>
      <div class="nav-dist" id="nav-dist">— m</div>
      <svg id="nav-seta" viewBox="-110 -110 220 220" aria-hidden="true">
        <circle r="104" class="nav-aro"/><g id="nav-norte"><text y="-82" class="nav-n">N</text></g>
        <g id="nav-g"><polygon points="0,-88 46,40 0,18 -46,40" class="nav-ponta"/></g></svg>
      <div id="nav-info" class="nav-info">Aguardando GPS…</div>
      <div id="nav-chegou" class="nav-chegou" hidden>Você chegou ao ponto.</div>
      ${Bussola.precisaPermissao() ? `<button class="sec" data-a="bussola-ios">🧭 Ativar a bússola</button>` : ''}
      <button class="largo" data-a="nav-abrir">Abrir a parcela ${esc(pt.nome)} aqui</button>
      <div class="linha-botoes"><button class="sec" data-a="nav-proxima" ${pend > 1 ? '' : 'disabled'}>Outra mais perto ›</button></div>
      <p class="mudo">Segure o celular deitado, com o topo para a frente. Faltam ${pend} parcela(s) do plano.</p></section>`;
  }
  function atualizarNav() {
    const pt = S.pontos.find(p => p.id === S.alvoId), d = $('#nav-dist'); if (!pt || !d) return;
    if (!GPS.pos) { $('#nav-info').textContent = GPS.erro || 'Aguardando GPS…'; return; }
    const z = zona(S.projeto), c = GPS.pos.coords, eu = Geo.paraUTM(c.latitude, c.longitude, z), alvo = Geo.paraUTM(pt.lat, pt.lon, z);
    const dist = Geo.dist(eu, alvo), az = Geo.azimute(eu, alvo);
    d.textContent = dist >= 1000 ? `${fmt(dist / 1000, 2)} km` : `${fmt(dist, 0)} m`;
    let rumo = Bussola.rumo(), fonte = 'bússola';
    if (rumo == null && c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 0.7) { rumo = c.heading; fonte = 'direção do caminhar'; }
    const rot = rumo == null ? az : az - rumo;
    $('#nav-g').setAttribute('transform', `rotate(${rot})`);
    $('#nav-norte').setAttribute('transform', `rotate(${rumo == null ? 0 : -rumo})`);
    $('#nav-info').innerHTML = `Rumo <b>${fmt(az, 0)}° ${cardeal(az)}</b> · GPS ±${fmt(c.accuracy, 0)} m<br><span class="mudo">${rumo == null
      ? 'Sem bússola: a seta mostra o rumo a partir do Norte (N no topo).' : `A seta aponta para o ponto (${fonte}).`}</span>`;
    const chegou = dist <= Math.max(8, c.accuracy || 0);
    $('#nav-chegou').hidden = !chegou; d.classList.toggle('perto', chegou);
    if (chegou && !S.avisouChegada) { S.avisouChegada = pt.id; Plataforma.vibrar(); }
  }
  // bússola pelo sensor do aparelho (quando houver), com suavização
  const Bussola = {
    valor: null, t: 0, ligado: false,
    ev(e) {
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) h = 360 - e.alpha;
      if (h == null) return;
      h = (h + (screen.orientation?.angle || 0) + 360) % 360;
      if (Bussola.valor == null) Bussola.valor = h;
      else { const d = ((h - Bussola.valor + 540) % 360) - 180; Bussola.valor = (Bussola.valor + d * 0.25 + 360) % 360; }
      Bussola.t = Date.now();
      if (S.view === 'navegar') atualizarNav();
    },
    ligar() { if (this.ligado) return; this.ligado = true; window.addEventListener('deviceorientationabsolute', this.ev); window.addEventListener('deviceorientation', this.ev); },
    desligar() { if (!this.ligado) return; this.ligado = false; window.removeEventListener('deviceorientationabsolute', this.ev); window.removeEventListener('deviceorientation', this.ev); },
    rumo() { return Date.now() - this.t < 2000 ? this.valor : null; },
    permitido: false,
    // iPhone (iOS 13+): a bússola só liga depois de pedir permissão num toque
    precisaPermissao() { return ehIOS && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function' && !this.permitido; }
  };

  async function definirSol(on) {
    S.sol = on; document.body.classList.toggle('sol', on); await DB.config('sol', on);
    document.querySelectorAll('.sol-btn').forEach(b => b.classList.toggle('on', on));
    const c = $('#pref-sol'); if (c) c.checked = on;
  }
  function guardarForm() {
    if (!$('#c-nome')) return;
    if (S.view === 'novo') S.novoRasc = lerConfig({ params: S.novoRasc?.params || PRESETS[S.novoTipo], estratos: S.novoEstratos || [], areaHa: S.novoRasc?.areaHa });
    else Object.assign(S.projeto, lerConfig(S.projeto));
  }
  // Janela simples de confirmação com SIM e NÃO
  function simNao(titulo, html, o = {}) {
    return new Promise(res => {
      const m = modal(`<h3>${titulo}</h3>${html}<div class="botoes"><button class="sec" data-m="cancelar">${o.nao || 'NÃO'}</button><button class="${o.perigo === false ? '' : 'perigo-cheio'}" data-m="sim">${o.sim || 'SIM'}</button></div>`);
      m.addEventListener('click', e => { const a = e.target.dataset.m; if (!a) return; m.remove(); res(a === 'sim'); });
    });
  }
  // Apaga um inventário com suas parcelas e pontos, depois de confirmar
  async function apagarInventario(id) {
    const p = await DB.pegar('projetos', id); if (!p) return false;
    const parc = await DB.porProjeto('parcelas', id), pts = await DB.porProjeto('pontos', id);
    const arv = parc.reduce((s, x) => s + x.arvores.length, 0);
    const ok = await simNao(`Apagar "${esc(p.nome)}"?`,
      `<p>Serão apagadas <b>${parc.length}</b> parcela(s), <b>${arv}</b> árvore(s) e <b>${pts.length}</b> ponto(s). Não dá para desfazer.</p>`);
    if (!ok) return false;
    for (const x of parc) await DB.apagar('parcelas', x.id);
    for (const x of pts) await DB.apagar('pontos', x.id);
    for (const x of await DB.porProjeto('fotos', id)) await DB.apagar('fotos', x.id);
    await DB.apagar('projetos', id);
    toast(`Inventário "${esc(p.nome)}" apagado.`, 'ok');
    return true;
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
  // situação legal da espécie: imune de corte (MG) e/ou ameaçada (lista nacional)
  function situacaoEspecie(nome) {
    const im = imune(nome), am = ameaca(nome), L = [];
    if (im) L.push('Imune de corte (Lei MG 20.308/2012)');
    if (am && !am.genero) L.push(`Ameaçada ${am.cat} (Portaria GM/MMA 1.783/2026)`);
    return L.join(' · ');
  }
  // depois de gravar uma árvore de espécie imune ou ameaçada: avisa e oferece marcar o ponto GPS
  async function avisoEspecial(reg, pc) {
    const im = imune(reg.nome), am = ameaca(reg.nome);
    if (am?.genero && !im) { toast(`ℹ ${esc(am.nome)}: o gênero tem espécies ameaçadas. Se der, identifique a espécie.`, 'aviso'); return; }
    if (!im && !am) return;
    const txt = [im ? esc(im.motivo) : '', am && !am.genero ? `<b>${esc(am.especie)}</b> está na lista nacional de espécies ameaçadas: <b>${esc(am.catNome)} (${am.cat})</b> — Portaria GM/MMA nº 1.783/2026.` : ''].filter(Boolean).join('<br><br>');
    if (await simNao('Espécie protegida', `<p>${txt}</p><p>Marcar agora o ponto GPS desta árvore?</p>`, { sim: 'MARCAR PONTO', nao: 'AGORA NÃO', perigo: false })) await marcarPontoImune(reg, pc);
  }
  async function marcarPontoImune(reg, pc) {
    const v = await GPS.capturar(S.projeto.params.segundosGPS ?? 10, `${reg.nome} (parcela ${pc.numero})`); if (!v) return;
    await salvarPonto({ id: uid(), projetoId: S.projeto.id, tipo: 'arvore', especie: reg.nome, situacao: `${situacaoEspecie(reg.nome)} — dentro da parcela`, parcela: pc.numero, arvoreId: reg.id, obs: `CAP ${reg.CAP} · H ${reg.H ?? '—'}`, ...v });
    toast('Ponto da árvore marcado', 'ok');
    if (await simNao('Foto da árvore?', `<p>Tirar agora uma foto de ${esc(reg.nome)}? Ela fica ligada à árvore e ao ponto.</p>`, { sim: 'TIRAR FOTO', nao: 'AGORA NÃO', perigo: false })) {
      const pt = S.pontos[S.pontos.length - 1];
      await novaFoto({ tipo: 'arvore', parcelaId: pc.id, arvoreId: reg.id, pontoId: pt?.id || null });
    }
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
      if (f === 'fotos') { await exportarFotos(); return; }
      if (f === 'docx') {
        if (!R.porParcela.length) return toast('Lance parcelas antes de gerar o relatório', 'aviso');
        toast('Montando o relatório…'); blob = await Relatorio.gerar(proj, [...S.parcelas].sort(ordNum), S.pontos, S.fotos, R); nome = Exportar.nomeArquivo(proj, 'relatorio', 'docx');
      }
      if (f === 'sinaflor') { if (R.est.n < 2) return toast('São precisas pelo menos 2 parcelas', 'aviso'); blob = Sinaflor.planilha(proj, R); nome = Exportar.nomeArquivo(proj, 'sinaflor', 'xlsx'); }
      if (f === 'shp') { blob = Sinaflor.shapefile(proj, R); nome = Exportar.nomeArquivo(proj, 'sinaflor_shapefile', 'zip'); }
      if (f === 'xlsx') { blob = Exportar.planilhaXLSX(proj, S.parcelas, S.pontos, R, S.fotos); nome = Exportar.nomeArquivo(proj, 'inventario', 'xlsx'); }
      if (f === 'csv') { blob = Exportar.csv(proj, [...S.parcelas].sort(ordNum)); nome = Exportar.nomeArquivo(proj, 'dados', 'csv'); }
      if (f === 'kml') { blob = Exportar.kml(proj, S.parcelas, S.pontos); nome = Exportar.nomeArquivo(proj, 'mapa', 'kml'); }
      if (f === 'geojson') { blob = Exportar.geojson(proj, S.parcelas, S.pontos); nome = Exportar.nomeArquivo(proj, 'mapa', 'geojson'); }
      if (f === 'png') { blob = await MapaPNG.gerar(proj, [...S.parcelas].sort(ordNum), S.pontos, S.fotos); nome = Exportar.nomeArquivo(proj, 'mapa', 'png'); }
      if (f === 'backup') {
        blob = Exportar.backup(proj, S.parcelas, S.pontos, S.fotos); nome = Exportar.nomeArquivo(proj, 'backup', 'json');
        proj.ultimoBackupEnviado = Date.now(); await DB.salvarCru('projetos', proj);
      }
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
    if (tipo === 'importar-backup') await receberDados(txt);
  }
  // ----- enviar e receber entre aparelhos -----
  async function enviarInventario(id) {
    const proj = S.projeto?.id === id ? S.projeto : await DB.pegar('projetos', id); if (!proj) return;
    const parc = S.projeto?.id === id ? S.parcelas : await DB.porProjeto('parcelas', id);
    const pts = S.projeto?.id === id ? S.pontos : await DB.porProjeto('pontos', id);
    const fts = S.projeto?.id === id ? S.fotos : await DB.porProjeto('fotos', id);
    try { await Exportar.enviar(Exportar.backup(proj, parc, pts, fts), Exportar.nomeArquivo(proj, 'backup', 'json')); }
    catch (e) { return toast('Não deu para enviar: ' + esc(e.message), 'erro'); }
    proj.ultimoBackupEnviado = Date.now(); await DB.salvarCru('projetos', proj);
  }
  // compara o arquivo recebido com o que há no aparelho, sem gravar nada
  async function previaRecebido(d) {
    const ex = await DB.pegar('projetos', d.projeto.id);
    const comparar = async (store, L) => {
      const loc = ex ? await DB.porProjeto(store, ex.id) : [], m = new Map(loc.map(x => [x.id, x]));
      const o = { novos: [], atual: [], iguais: [], antigos: [], loc };
      (L || []).forEach(r => { const e = m.get(r.id); if (!e) o.novos.push(r); else if ((r.atualizado || 0) > (e.atualizado || 0)) o.atual.push(r); else if ((r.atualizado || 0) === (e.atualizado || 0)) o.iguais.push(r); else o.antigos.push(r); });
      return o;
    };
    const pc = await comparar('parcelas', d.parcelas), pt = await comparar('pontos', d.pontos), ft = await comparar('fotos', d.fotos);
    const fim = new Map(pc.loc.map(p => [p.id, p])); [...pc.novos, ...pc.atual].forEach(p => fim.set(p.id, p));
    const nums = {}; [...fim.values()].forEach(p => { nums[p.numero] = (nums[p.numero] || 0) + 1; });
    return { ex, pc, pt, ft, dup: Object.keys(nums).filter(n => nums[n] > 1).sort() };
  }
  async function receberDados(txt) {
    let d; try { d = JSON.parse(txt); } catch { return toast('Arquivo inválido', 'erro'); }
    if (d.formato !== 'inventario-florestal') return toast('Não é um arquivo deste app', 'erro');
    const v = await previaRecebido(d);
    const listaNum = L => L.map(p => p.numero).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0)).join(', ');
    const lin = (n, txt2, L) => n ? `<li><b>${n}</b> ${txt2}${L ? ` <span class="mudo">(nº ${esc(listaNum(L))})</span>` : ''}</li>` : '';
    const nada = !v.pc.novos.length && !v.pc.atual.length && !v.pt.novos.length && !v.pt.atual.length && !v.ft.novos.length && !v.ft.atual.length;
    const html = `<p><b>${esc(d.projeto.nome)}</b> — ${v.ex ? 'já existe neste aparelho: os dados se juntam' : 'inventário novo neste aparelho'}.</p>
      ${d.enviadoPor || d.exportado ? `<p class="mudo">${d.enviadoPor ? `Enviado por ${esc(d.enviadoPor)}` : 'Gerado'}${d.exportado ? ` em ${new Date(d.exportado).toLocaleString('pt-BR').slice(0, 17)}` : ''}.</p>` : ''}
      <ul class="previa">${lin(v.pc.novos.length, 'parcela(s) nova(s)', v.pc.novos)}${lin(v.pc.atual.length, 'parcela(s) atualizada(s) — a recebida é mais nova', v.pc.atual)}
      ${lin(v.pc.antigos.length, 'parcela(s) mais antiga(s) que as daqui — ficam as daqui', v.pc.antigos)}${lin(v.pc.iguais.length, 'parcela(s) iguais às daqui')}
      ${lin(v.pt.novos.length + v.pt.atual.length, 'ponto(s) novo(s) ou atualizado(s)')}${lin(v.ft.novos.length + v.ft.atual.length, 'foto(s) nova(s) ou atualizada(s)')}</ul>
      ${v.dup.length ? `<p class="aviso">⚠ Depois de juntar ficarão números de parcela repetidos: ${esc(v.dup.join(', '))}. Renumere uma delas depois.</p>` : ''}
      ${nada ? '<p class="mudo">Nada novo: este aparelho já tem tudo o que veio no arquivo.</p>' : ''}`;
    if (!(await simNao(v.ex ? 'Juntar os dados recebidos?' : 'Receber o inventário?', html, { sim: v.ex ? 'JUNTAR' : 'RECEBER', nao: 'CANCELAR', perigo: false }))) return;
    if (nada && v.ex) return;
    const ex = v.ex;
      let novas = 0, atual = 0, mantidas = 0;
      if (!ex || (d.projeto.atualizado || 0) > (ex.atualizado || 0)) await DB.salvarCru('projetos', ex ? { ...d.projeto, especies: mesclarEsp(ex.especies, d.projeto.especies) } : d.projeto);
      for (const [store, L] of [['parcelas', d.parcelas], ['pontos', d.pontos], ['fotos', d.fotos || []]]) for (const r of L) {
        const e = await DB.pegar(store, r.id);
        if (!e) { await DB.salvarCru(store, r); novas++; } else if ((r.atualizado || 0) > (e.atualizado || 0)) { await DB.salvarCru(store, r); atual++; } else mantidas++;
      }
      const todas = await DB.porProjeto('parcelas', d.projeto.id), nums = {}; todas.forEach(p => { nums[p.numero] = (nums[p.numero] || 0) + 1; });
      const dup = Object.keys(nums).filter(n => nums[n] > 1);
      toast(`${ex ? 'Juntado' : 'Recebido'}: ${novas} novos, ${atual} atualizados, ${mantidas} já em dia.${dup.length ? `<br>⚠ Números repetidos: ${dup.join(', ')} — renumere uma delas.` : ''}`, dup.length ? 'aviso' : 'ok');
      if (S.projeto?.id === d.projeto.id) await abrirProjeto(d.projeto.id); else if (S.view === 'home') preencherHome();
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
  document.addEventListener('click', e => {
    const k = e.target.closest('[data-tk]'); if (k) { e.preventDefault(); teclar(k.dataset.tk); return; }
    const c = e.target.closest('[data-tecl]'); if (c) { $('#e-nome')?.blur(); marcarCampo(c.id); }
  });
  // no cerrado: escolheu a espécie → fecha o teclado do Android e vai para a altura
  // ----- sugestões de espécie enquanto digita (no lugar da lista do Android, que cobria o teclado) -----
  function sugestoes(texto) {
    const q = chaveEsp(texto), qp = semAcento(texto);
    const freq = new Map(); S.parcelas.forEach(p => p.arvores.forEach(a => { if (a.nome) { const k = chaveEsp(a.nome); freq.set(k, (freq.get(k) || 0) + 1); } }));
    const L = listaEspecies().map(n => ({ n, k: chaveEsp(n), p: semAcento(n), f: freq.get(chaveEsp(n)) || 0 }));
    if (!q) return L.filter(x => x.f).sort((a, b) => b.f - a.f).slice(0, 8);
    const nota = x => x.k.startsWith(q) ? 0 : x.p.split(/[\s-]+/).some(w => w.startsWith(qp)) ? 1 : x.k.includes(q) ? 2 : 9;
    return L.map(x => ({ ...x, s: nota(x) })).filter(x => x.s < 9 && x.k !== q).sort((a, b) => a.s - b.s || b.f - a.f || a.n.localeCompare(b.n, 'pt')).slice(0, 10);
  }
  function mostrarSugestoes(inp) {
    const box = $('#' + inp.dataset.sug); if (!box) return;
    const L = sugestoes(inp.value);
    box.hidden = !L.length;
    box.innerHTML = L.map(x => `<button type="button" class="sug" data-nome="${esc(x.n)}">${esc(x.n)}${cientifico(S.projeto, x.n) ? `<i>${esc(cientifico(S.projeto, x.n).replace(/ \(conferir\)/, ''))}</i>` : ''}</button>`).join('');
    box.scrollLeft = 0;
  }
  function escolherNome(inp, nome) {
    inp.value = nome; $('#' + inp.dataset.sug).hidden = true;
    if (inp.id === 'e-nome') { if (usaTeclado()) { inp.blur(); marcarCampo('e-h'); } else $('#e-h').focus(); }
    else inp.blur();
  }
  document.addEventListener('input', e => { if (e.target.dataset?.sug) mostrarSugestoes(e.target); });
  document.addEventListener('focusin', e => {
    if (e.target.dataset?.sug) { mostrarSugestoes(e.target); if (e.target.id === 'e-nome') document.body.classList.add('digitando-nome'); }
  });
  document.addEventListener('focusout', e => {
    if (!e.target.dataset?.sug) return;
    document.body.classList.remove('digitando-nome');
    const box = $('#' + e.target.dataset.sug); setTimeout(() => { if (box && document.activeElement !== e.target) box.hidden = true; }, 150);
  });
  // pointerdown + preventDefault: o toque na sugestão não tira o foco do campo antes da escolha
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest('.sug'); if (!b) return;
    e.preventDefault();
    const inp = document.querySelector(`[data-sug="${b.parentElement.id}"]`); if (inp) escolherNome(inp, b.dataset.nome);
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.type === 'file' && el.dataset.a && el.files[0]) { importar(el.dataset.a, el.files[0]).catch(err => toast('Erro: ' + esc(err.message), 'erro')); el.value = ''; }
    if (el.id === 'pref-sol') definirSol(el.checked);
    if (el.id === 'pref-tela') { S.telaAcesa = el.checked; DB.config('telaAcesa', S.telaAcesa); }
    if (el.id === 'pref-teclado') { S.teclado = el.checked; DB.config('teclado', S.teclado); }
    if (el.id === 'p-estr' || el.id === 'p-num' || el.id === 'p-obs') gravarCabecalho().then(() => { if (el.id === 'p-estr') render(); });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || S.view !== 'parcela') return;
    const id = e.target.id;
    if (S.projeto.tipo === 'eucalipto') {
      if (id === 'e-cap') { e.preventDefault(); $('#e-h').focus(); }
      else if (id === 'e-h') { e.preventDefault(); acao(S.editando ? 'salvar-edicao' : 'add-euc', { dataset: { m: 'nova' } }); }
    } else {
      if (id === 'e-nome') { e.preventDefault(); if (usaTeclado()) { e.target.blur(); marcarCampo('e-h'); } else $('#e-h').focus(); }
      else if (id === 'e-h') { e.preventDefault(); $('#e-cap').focus(); }
      else if (id === 'e-cap' || e.target.dataset.extra != null) { e.preventDefault(); acao(S.editando ? 'salvar-edicao' : 'add-cerrado', e.target); }
    }
  });
  window.addEventListener('popstate', () => { if (!Plataforma.nativo && S.view !== 'home') { history.pushState(null, ''); acao('voltar'); } });

  // ---------------- início ----------------
  window.App = { equipe: () => S.equipe, METODOS, cientifico, imune: n => !!imune(n), ameaca: (proj, n) => ameaca(n, proj), verticesOrdenados, modal, toast, fisionomiaDe, simNao };
  (async function iniciar() {
    if (!Plataforma.nativo && 'serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    S.equipe = (await DB.config('equipe')) || '';
    S.inicioNum = (await DB.config('inicioNum')) || 1;
    S.teclado = (await DB.config('teclado')) ?? true;
    S.telaAcesa = (await DB.config('telaAcesa')) ?? true;
    S.sol = (await DB.config('sol')) ?? false; document.body.classList.toggle('sol', S.sol);
    if (!Plataforma.aoVoltar(() => {
      const m = document.querySelector('.modal-fundo'); if (m) { m.querySelector('[data-m=cancelar],[data-m=ok]')?.click(); return; }
      if (S.view === 'home') return 'sair';
      acao('voltar');
    })) history.pushState(null, '');
    Plataforma.aoMudarEstado(async ativo => {
      GPS.ativo = ativo;
      if (!ativo) { await gravarCabecalho().catch(() => {}); if (S.sujo) await backupAutomatico(); manterTela(false); GPS.desligar(); }
      else { ajustarGPS(); if (S.view === 'parcela' || S.view === 'navegar') manterTela(true); }
    });
    setInterval(() => { if (S.sujo) backupAutomatico(); }, 60 * 60 * 1000);
    Plataforma.aoAbrirArquivo((txt, err) => { if (err || txt == null) toast('Não consegui ler o arquivo. Use 📥 Receber dados na tela inicial.', 'erro'); else receberDados(txt).catch(e => toast('Erro: ' + esc(e.message), 'erro')); });   // de hora em hora, se houver dado novo
    render(); preencherHome();
  })();
})();
