/* Camada de plataforma: o mesmo código roda como PWA (navegador) e como app Android (Capacitor).
   No Android usa os recursos nativos: GPS, gravação de arquivos, tela acesa e botão voltar. */
(function (root) {
  'use strict';
  const Cap = root.Capacitor;
  const nativo = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  const P = nativo ? Cap.Plugins : {};

  // ---------- GPS ----------
  // Liga o GPS em alta precisão; devolve uma função que o desliga (para poupar bateria)
  async function iniciarGPS(aoLer, aoErro) {
    if (!nativo) {
      if (!navigator.geolocation) { aoErro('GPS indisponível neste navegador'); return () => {}; }
      const id = navigator.geolocation.watchPosition(aoLer, e => aoErro(e.code === 1 ? 'Permissão de localização negada' : e.message),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
      return () => navigator.geolocation.clearWatch(id);
    }
    try {
      const st = await P.Geolocation.checkPermissions();
      if (st.location !== 'granted') {
        const r = await P.Geolocation.requestPermissions({ permissions: ['location'] });
        if (r.location !== 'granted') { aoErro('Permissão de localização negada'); return () => {}; }
      }
      const id = await P.Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 60000, minimumUpdateInterval: 1000 }, (pos, err) => {
        if (err) { aoErro(err.message || String(err)); return; }
        if (pos) aoLer({ coords: pos.coords, timestamp: pos.timestamp || Date.now() });
      });
      return () => { try { P.Geolocation.clearWatch({ id }); } catch (e) { /* já parado */ } };
    } catch (e) { aoErro(e.message || String(e)); return () => {}; }
  }

  // app indo para segundo plano / voltando (Android); no navegador usa a visibilidade da página
  function aoMudarEstado(fn) {
    if (nativo && P.App) P.App.addListener('appStateChange', st => fn(!!st.isActive));
    else document.addEventListener('visibilitychange', () => fn(document.visibilityState === 'visible'));
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

  // ---------- câmera ----------
  // Devolve a foto como dataURL JPEG (lado maior até 1600 px), ou null se cancelar
  function reduzir(dataURL, max = 1600, q = 0.72) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); res(cv.toDataURL('image/jpeg', q));
      };
      img.onerror = () => rej(new Error('Imagem inválida')); img.src = dataURL;
    });
  }
  async function tirarFoto() {
    if (nativo) {
      try {
        const f = await P.Camera.getPhoto({ quality: 72, width: 1600, height: 1600, resultType: 'base64', source: 'CAMERA', correctOrientation: true, saveToGallery: false, allowEditing: false });
        return reduzir(`data:image/${f.format || 'jpeg'};base64,${f.base64String}`);
      } catch (e) { if (/cancel/i.test(e.message || '')) return null; throw e; }
    }
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return res(null);
        const fr = new FileReader(); fr.onload = () => reduzir(fr.result).then(res, () => res(null)); fr.readAsDataURL(f);
      };
      inp.click();
    });
  }
  // grava um arquivo base64 numa subpasta de Documentos/Inventario, sem perguntar nada
  async function salvarSilencioso(dataB64, caminho) {
    if (!nativo) return null;
    const r = await P.Filesystem.writeFile({ path: `Inventario/${caminho}`, data: dataB64, directory: 'DOCUMENTS', recursive: true });
    return r.uri;
  }

  // ---------- localização gravada dentro da foto (EXIF GPS) ----------
  function comExif(dataURL, f) {
    if (!root.piexif || !/^data:image\/jpeg/.test(dataURL)) return dataURL;
    try {
      const dms = v => { v = Math.abs(v); const d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60 * 10000); return [[d, 1], [m, 1], [s, 10000]]; };
      const h = (f.hora || '').replace('T', ' ');
      const dt = h ? h.slice(0, 19).replace(/-/g, ':') : null;
      const exif = { '0th': { [piexif.ImageIFD.Software]: 'Inventario Florestal' }, Exif: {}, GPS: {} };
      if (dt) { exif.Exif[piexif.ExifIFD.DateTimeOriginal] = dt; exif['0th'][piexif.ImageIFD.DateTime] = dt; }
      if (f.lat != null && f.lon != null) {
        exif.GPS[piexif.GPSIFD.GPSVersionID] = [2, 3, 0, 0];
        exif.GPS[piexif.GPSIFD.GPSLatitudeRef] = f.lat < 0 ? 'S' : 'N';
        exif.GPS[piexif.GPSIFD.GPSLatitude] = dms(f.lat);
        exif.GPS[piexif.GPSIFD.GPSLongitudeRef] = f.lon < 0 ? 'W' : 'E';
        exif.GPS[piexif.GPSIFD.GPSLongitude] = dms(f.lon);
        if (f.alt != null) { exif.GPS[piexif.GPSIFD.GPSAltitudeRef] = f.alt < 0 ? 1 : 0; exif.GPS[piexif.GPSIFD.GPSAltitude] = [Math.round(Math.abs(f.alt) * 100), 100]; }
        if (f.acc != null) exif.GPS[piexif.GPSIFD.GPSHPositioningError] = [Math.round(f.acc * 100), 100];
        exif.GPS[piexif.GPSIFD.GPSMapDatum] = 'WGS-84';
      }
      const limpo = piexif.remove(dataURL);
      return piexif.insert(piexif.dump(exif), limpo);
    } catch (e) { console.error('EXIF', e); return dataURL; }
  }

  // ---------- vibração curta ao tocar nas teclas ----------
  function vibrar() { try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* sem suporte */ } }

  // ---------- botão voltar do Android ----------
  function aoVoltar(fn) {
    if (!nativo) return false;
    P.App.addListener('backButton', () => { if (fn() === 'sair') P.App.exitApp(); });
    return true;
  }

  root.Plataforma = { nativo, iniciarGPS, aoMudarEstado, comExif, manterTela, salvarArquivo, salvarSilencioso, compartilhar, aoVoltar, tirarFoto, vibrar, paraBase64 };
})(window);
