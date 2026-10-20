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

// RF-054 · Notificaciones push. El servidor manda { id, tipo, titulo, cuerpo, datos: { pestana } } cifrado; el navegador
// despierta este service worker aunque la app esté cerrada.
self.addEventListener('push', (e) => {
  let aviso = {}
  try {
    aviso = e.data ? e.data.json() : {}
  } catch {
    aviso = { titulo: 'Reparto Yogurt', cuerpo: e.data ? e.data.text() : '' }
  }
  e.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      ventanas.forEach((v) => v.postMessage({ tipo: 'sincronizar' })) // trae el pedido o el cambio ya, sin esperar el minuto
      // Con la app a la vista no hace falta la notificación del sistema: la propia app muestra el aviso al sincronizar.
      if (ventanas.some((v) => v.visibilityState === 'visible')) return
      await self.registration.showNotification(aviso.titulo || 'Reparto Yogurt', {
        body: aviso.cuerpo || '',
        tag: aviso.id || undefined,
        data: { pestana: aviso.datos && aviso.datos.pestana },
      })
    })(),
  )
})

// Tocar la notificación abre la app en la pestaña que corresponde (también las locales de stock y de ventas sin enviar).
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const pestana = e.notification.data && e.notification.data.pestana
  e.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const v = ventanas.find((x) => x.visibilityState === 'visible') || ventanas[0]
      if (v) {
        try { await v.focus() } catch { /* el navegador no siempre lo permite */ }
        if (pestana) v.postMessage({ tipo: 'abrir', pestana })
        v.postMessage({ tipo: 'sincronizar' })
        return
      }
      await self.clients.openWindow(pestana ? `./?abrir=${encodeURIComponent(pestana)}` : './')
    })(),
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
  // La API (en Vercel es /api/..., en local /auth, /sync…) siempre va en vivo: lo que responde cambia a cada rato.
  if (/^\/(api|auth|sync)\//.test(url.pathname)) return

  // Navegación: red primero, si no hay conexión la copia guardada.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copia = res.clone(); caches.open(APP).then((c) => c.put('./index.html', copia)); return res })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  // Archivos de la app (con hash): caché primero. Hay servidores que responden `Vary: Origin` y entonces los módulos
  // (que viajan con Origin) no encontrarían la copia guardada al instalar: aquí el nombre con hash basta.
  e.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(APP).then((c) => c.put(req, copia)) }
      return res
    })),
  )
})
