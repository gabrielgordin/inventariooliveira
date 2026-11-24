/* Camada de plataforma: o mesmo código roda como PWA (navegador) e como app Android (Capacitor).
   No Android usa os recursos nativos: GPS, gravação de arquivos, tela acesa e botão voltar. */
(function (root) {
  'use strict';
  const Cap = root.Capacitor;
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = nativo ? Cap.Plugins : {};

  // ---------- GPS ----------
  async function iniciarGPS(aoLer, aoErro) {
    if (!nativo) {
      if (!navigator.geolocation) { aoErro('GPS indisponível neste navegador'); return; }
      navigator.geolocation.watchPosition(aoLer, e => aoErro(e.code === 1 ? 'Permissão de localização negada' : e.message),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
      return;
    }
    try {
      const st = await P.Geolocation.checkPermissions();
      if (st.location !== 'granted') {
        const r = await P.Geolocation.requestPermissions({ permissions: ['location'] });
        if (r.location !== 'granted') { aoErro('Permissão de localização negada'); return; }
      }
      await P.Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 60000, minimumUpdateInterval: 500 }, (pos, err) => {
        if (err) { aoErro(err.message || String(err)); return; }
        if (pos) aoLer({ coords: pos.coords, timestamp: pos.timestamp || Date.now() });
      });
    } catch (e) { aoErro(e.message || String(e)); }
  }

  // ---------- tela acesa ----------
  async function manterTela(on) {
    if (!nativo) return false;
    try { on ? await P.KeepAwake.keepAwake() : await P.KeepAwake.allowSleep(); } catch (e) { /* sem suporte */ }
    return true;
  }

  // ---------- arquivos ----------
  const paraBase64 = blob => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
  });
  /* Grava em Documentos/Inventario e devolve {uri, local}. Se a pasta pública não aceitar,
     grava na área do app (o arquivo ainda pode ser compartilhado). */
  async function salvarArquivo(blob, nome) {
    const data = await paraBase64(blob);
    try {
      const r = await P.Filesystem.writeFile({ path: `Inventario/${nome}`, data, directory: 'DOCUMENTS', recursive: true });
      return { uri: r.uri, local: `Documentos/Inventario/${nome}` };
    } catch (e) {
      const r = await P.Filesystem.writeFile({ path: `exportacoes/${nome}`, data, directory: 'DATA', recursive: true });
      return { uri: r.uri, local: null };
    }
  }
  async function compartilhar(uri, nome) {
    try { await P.Share.share({ title: nome, files: [uri], dialogTitle: 'Enviar arquivo' }); }
    catch (e) { if (!/cancel/i.test(e.message || '')) throw e; }
  }

  // ---------- botão voltar do Android ----------
  function aoVoltar(fn) {
    if (!nativo) return false;
    P.App.addListener('backButton', () => { if (fn() === 'sair') P.App.exitApp(); });
    return true;
  }

  root.Plataforma = { nativo, iniciarGPS, manterTela, salvarArquivo, compartilhar, aoVoltar };
})(window);
