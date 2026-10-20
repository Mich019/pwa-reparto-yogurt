// Service worker: la app abre sin internet (RF-049) y guarda mosaicos del mapa ya vistos.
const APP = 'app-__VERSION__'
const MAPA = 'mapa-v1'
const MAX_MOSAICOS = 3000

self.addEventListener('install', (e) => {
  // Guarda toda la app (lista generada al compilar) para abrir sin red desde la primera visita.
  const archivos = self.__ARCHIVOS__
  e.waitUntil(caches.open(APP).then((c) => c.addAll([...new Set(['./', './index.html', ...archivos, './manifest.webmanifest', './icon.svg'])])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== MAPA).map((k) => caches.delete(k)))))
  self.clients.claim()
})

async function recortar() {
  const c = await caches.open(MAPA)
  const ks = await c.keys()
  for (let i = 0; i < ks.length - MAX_MOSAICOS; i++) await c.delete(ks[i])
}

// RF-052: al volver la conexión el navegador despierta este evento y se lo pasa a la app para que sincronice.
// La cola vive en IndexedDB y el token en la sesión de la app, así que la sincronización la hace la propia
// app; si no hay ninguna ventana abierta, sincroniza al abrirse (o al recuperar el foco).
self.addEventListener('sync', (e) => {
  if (e.tag !== 'sync-cola') return
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      if (!ventanas.length) throw new Error('Sin ventanas abiertas: reintentar luego')
      ventanas.forEach((v) => v.postMessage({ tipo: 'sincronizar' }))
    }),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Ruteo: siempre en vivo; la app tiene respaldo propio sin conexión.
  if (url.hostname.includes('osrm')) return

  // Mapa (estilo, mosaicos, fuentes): primero caché, luego red.
  if (url.hostname.includes('openfreemap')) {
    e.respondWith(
      caches.open(MAPA).then(async (c) => {
        const hit = await c.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) { c.put(req, res.clone()); recortar() }
        return res
      }),
    )
    return
  }

  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/sync/')) return

  // Navegación: red primero, si no hay conexión la copia guardada.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copia = res.clone(); caches.open(APP).then((c) => c.put('./index.html', copia)); return res })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  // Archivos de la app (con hash): caché primero.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(APP).then((c) => c.put(req, copia)) }
      return res
    })),
  )
})
