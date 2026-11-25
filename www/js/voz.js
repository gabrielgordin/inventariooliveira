/* Lançamento por voz: ouve uma frase ("pau terra, altura seis, CAP quarenta") e separa
   espécie, altura, CAP e fustes. Não grava sozinho, a não ser que a frase termine com "gravar".
   Android: plugin nativo de reconhecimento de fala (Google). Navegador: Web Speech API, quando houver. */
(function (root) {
  'use strict';
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // ---------- ouvir ----------
  const Cap = root.Capacitor;
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const SR = nativo ? Cap.Plugins.SpeechRecognition : null;
  const WebSR = root.SpeechRecognition || root.webkitSpeechRecognition;

  function disponivel() { return nativo ? !!SR : !!WebSR; }

  // devolve as alternativas reconhecidas (a primeira é a mais provável), ou [] se cancelar
  async function ouvir(prompt) {
    if (nativo) {
      if (!SR) throw new Error('reconhecimento de voz indisponível nesta versão do app');
      const { available } = await SR.available();
      if (!available) throw new Error('o aparelho não tem o reconhecimento de voz do Google');
      let st = await SR.checkPermissions();
      if (st.speechRecognition !== 'granted') st = await SR.requestPermissions();
      if (st.speechRecognition !== 'granted') throw new Error('permissão do microfone negada');
      try {
        const r = await SR.start({ language: 'pt-BR', maxResults: 5, prompt, partialResults: false, popup: true });
        return (r && r.matches) || [];
      } catch (e) { if (/^-?\d+$/.test(String(e.message || e))) return []; throw e; }   // fechou a janela sem falar
    }
    if (!WebSR) throw new Error('este navegador não reconhece voz');
    return new Promise((res, rej) => {
      const r = new WebSR(); r.lang = 'pt-BR'; r.maxAlternatives = 5; r.interimResults = false; r.continuous = false;
      let ok = false;
      r.onresult = e => { ok = true; res([...e.results[0]].map(a => a.transcript)); };
      r.onerror = e => { ok = true; e.error === 'no-speech' || e.error === 'aborted' ? res([]) : rej(new Error(e.error === 'not-allowed' ? 'permissão do microfone negada' : e.error)); };
      r.onend = () => { if (!ok) res([]); };
      r.start();
    });
  }

  // ---------- números falados ----------
  const UNID = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
    quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
    cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500 };
  const ehNumPal = w => w in UNID;
  const classe = v => v >= 100 ? 'c' : v >= 20 ? 'd' : 'u';
  const ehDig = w => /^\d+([.,]\d+)?$/.test(w);

  // transforma a frase em lista de palavras e números
  function tokens(texto) {
    const t = semAcento(texto).replace(/(\d)\s*[,.]\s*(\d)/g, '$1,$2').replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
      .replace(/[;:!?()"]/g, ' ').replace(/,(?!\d)/g, ' , ').replace(/\.(?!\d)/g, ' ');
    const w = t.split(/\s+/).filter(Boolean), out = [];
    for (let i = 0; i < w.length; i++) {
      if (ehDig(w[i])) { out.push({ n: +w[i].replace(',', '.') }); continue; }
      if (ehNumPal(w[i])) {
        // junta "quarenta e dois", "cento e vinte e cinco"
        let v = UNID[w[i]], j = i + 1, cls = classe(v);
        // "cento e vinte e cinco": centena → dezena → unidade; depois da unidade começa outro número
        while (j < w.length) {
          const k = w[j] === 'e' ? j + 1 : j; if (!ehNumPal(w[k])) break;
          const u = UNID[w[k]], c = classe(u);
          if (!((cls === 'c' && c !== 'c') || (cls === 'd' && c === 'u' && u > 0 && u < 10))) break;
          v += u; cls = c; j = k + 1;
        }
        // decimais: "seis virgula cinco", "seis e meio"
        if (w[j] === 'virgula' || w[j] === 'ponto') {
          let k = j + 1, dig = '';
          while (k < w.length && (ehNumPal(w[k]) || ehDig(w[k]) || w[k] === 'e')) {
            if (w[k] === 'e') { k++; continue; }
            if (ehDig(w[k])) { dig += w[k]; k++; break; }
            let d = 0; while (k < w.length && (ehNumPal(w[k]) || (w[k] === 'e' && k + 1 < w.length && ehNumPal(w[k + 1])))) { if (w[k] !== 'e') d += UNID[w[k]]; k++; }
            dig += String(d); break;
          }
          if (dig) { v = +(v + '.' + dig); j = k; }
        } else if (w[j] === 'e' && (w[j + 1] === 'meio' || w[j + 1] === 'meia')) { v += 0.5; j += 2; }
        out.push({ n: v }); i = j - 1; continue;
      }
      out.push({ w: w[i] });
    }
    return out;
  }

  // ---------- espécie ----------
  const chave = s => semAcento(s).replace(/[\s-]/g, '');
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[n];
  }
  function acharEspecie(frase, lista) {
    const q = chave(frase); if (!q) return null;
    let melhor = null;
    for (const n of lista) {
      const k = chave(n); if (k === q) return { nome: n, exato: true };
      const d = lev(q, k), lim = Math.max(1, Math.floor(k.length * 0.25));
      if (d <= lim && (!melhor || d < melhor.d)) melhor = { nome: n, d };
    }
    return melhor ? { nome: melhor.nome, exato: false } : null;
  }

  // ---------- interpretação ----------
  const K_H = ['altura', 'alt', 'h', 'aga', 'aja', 'raga'], K_CAP = ['cap', 'capi', 'cape', 'kap', 'cep', 'kepi', 'circunferencia', 'circ', 'rodo', 'roda'],
    K_FUSTE = ['fuste', 'fustes', 'perfilho', 'galho', 'mais'], K_FALHA = ['falha', 'morta', 'morto', 'cova'],
    U_H = ['metro', 'metros', 'm'], U_CAP = ['centimetro', 'centimetros', 'cm', 'centimetro'],
    GRAVAR = ['gravar', 'grava', 'pronto', 'salvar', 'salva', 'ok', 'confirma'], RUIDO = ['especie', 'nome', 'arvore', 'e', 'de', 'o', 'a', ','];

  /* tipo: 'cerrado' | 'eucalipto'; lista: nomes populares conhecidos.
     Devolve { nome, nomeOuvido, exato, H, CAP, extras[], falha, fuste, gravar, texto } */
  function interpretar(texto, tipo, lista = []) {
    const T = tokens(texto), r = { H: null, CAP: null, extras: [], falha: false, fuste: false, gravar: false, nome: '', texto };
    let i = 0;
    // nome: palavras antes do primeiro número ou palavra-chave
    const chaves = new Set([...K_H, ...K_CAP, ...K_FUSTE, ...K_FALHA, ...GRAVAR]);
    const pal = [];
    while (i < T.length && T[i].w != null && !chaves.has(T[i].w)) { pal.push(T[i].w); i++; }
    const nomeOuvido = pal.filter(w => !RUIDO.includes(w) || pal.length === 1).join(' ').trim();
    if (tipo !== 'eucalipto' && nomeOuvido) {
      const e = acharEspecie(nomeOuvido, lista);
      r.nome = e ? e.nome : nomeOuvido; r.exato = e ? e.exato : false; r.nomeOuvido = nomeOuvido;
    }
    let campo = null; const soltos = [];
    for (; i < T.length; i++) {
      const t = T[i];
      if (t.w != null) {
        if (K_H.includes(t.w)) campo = 'H';
        else if (K_CAP.includes(t.w)) campo = 'CAP';
        else if (K_FUSTE.includes(t.w)) { campo = 'fuste'; r.fuste = true; }
        else if (K_FALHA.includes(t.w)) r.falha = true;
        else if (GRAVAR.includes(t.w) && i >= T.length - 2) r.gravar = true;
        continue;
      }
      const prox = T[i + 1]?.w;
      let destino = campo;
      if (U_H.includes(prox)) destino = 'H'; else if (U_CAP.includes(prox)) destino = 'CAP';
      if (destino === 'H' && r.H == null) r.H = t.n;
      else if (destino === 'CAP' && r.CAP == null) r.CAP = t.n;
      else if ((destino === 'fuste' || destino === 'CAP') && r.CAP != null) r.extras.push(t.n);
      else if (destino === 'fuste' && tipo === 'eucalipto') r.CAP = t.n;
      else soltos.push(t.n);
      campo = destino === 'fuste' ? 'fuste' : null;
    }
    // números sem rótulo: na ficha do cerrado vem H e depois CAP; no eucalipto, CAP e depois H
    const ordem = tipo === 'eucalipto' ? ['CAP', 'H'] : ['H', 'CAP'];
    for (const n of soltos) {
      const k = ordem.find(c => r[c] == null);
      if (k) r[k] = n; else if (tipo !== 'eucalipto') r.extras.push(n);
    }
    if (tipo === 'eucalipto' && r.fuste && r.extras.length && r.CAP == null) r.CAP = r.extras.shift();
    return r;
  }
  // escolhe a alternativa que mais preencheu campos
  function melhor(alternativas, tipo, lista) {
    let best = null;
    alternativas.forEach((a, idx) => {
      const r = interpretar(a, tipo, lista);
      const nota = (r.H != null) + (r.CAP != null) * 2 + (r.exato ? 2 : r.nome ? 1 : 0) + (r.falha ? 3 : 0) - idx * 0.1;
      if (!best || nota > best.nota) best = { ...r, nota };
    });
    return best;
  }

  root.Voz = { disponivel, ouvir, interpretar, melhor, tokens };
  if (typeof module !== 'undefined') module.exports = root.Voz;
})(typeof window !== 'undefined' ? window : globalThis);
