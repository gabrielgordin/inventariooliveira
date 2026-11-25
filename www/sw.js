/* Guarda o app no aparelho para funcionar sem internet. Ao publicar versão nova, mude VERSAO. */
const VERSAO = 'inventario-v11';
const ARQUIVOS = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/calc.js', 'js/geo.js', 'js/plano.js', 'js/db.js',
  'js/especies.js', 'js/ameacadas.js', 'js/voz.js', 'js/sinaflor.js', 'js/relatorio.js', 'js/plataforma.js', 'js/exportar.js', 'js/mapa-png.js', 'js/app.js', 'vendor/xlsx.full.min.js', 'vendor/piexif.js', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
    if (resp.ok && new URL(e.request.url).origin === location.origin) { const cp = resp.clone(); caches.open(VERSAO).then(c => c.put(e.request, cp)); }
    return resp;
  }).catch(() => caches.match('index.html'))));
});
