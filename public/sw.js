// Service worker: la app abre sin internet (RF-049) y guarda mosaicos del mapa ya vistos.
const APP = 'app-__VERSION__'
const MAPA = 'mapa-v1'
const MAX_MOSAICOS = 3000

// Los archivos de la app (lista generada al compilar). Sólo éstos se guardan en el teléfono: lo demás del mismo
// dominio (la API, con datos de la cuenta) va siempre a la red y nunca queda en la caché.
const ARCHIVOS = [...new Set(['./', './index.html', ...self.__ARCHIVOS__, './manifest.webmanifest', './icon.svg'])]
const PROPIOS = new Set(ARCHIVOS.map((f) => new URL(f, self.location.href).pathname))

self.addEventListener('install', (e) => {
  // Guarda toda la app para abrir sin red desde la primera visita.
  e.waitUntil(caches.open(APP).then((c) => c.addAll(ARCHIVOS)))
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

// RF-052: al volver la conexión el navegador despierta este evento, también con la app cerrada (Chrome y Edge en
// Android y escritorio; Safari no lo ofrece y ahí se envía al abrir la app). Si la app está a la vista, ella sincroniza;
// si no, el service worker envía la cola con el mismo código de la app (sw-envio.js) y la sesión que ella le dejó.
try {
  importScripts('./sw-envio.js')
} catch {
  /* sin el envío en segundo plano la app sigue funcionando: envía al abrirse */
}

self.addEventListener('sync', (e) => {
  if (e.tag !== 'sync-cola') return
  e.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      ventanas.forEach((v) => v.postMessage({ tipo: 'sincronizar' }))
      if (ventanas.some((v) => v.visibilityState === 'visible')) return
      if (!self.envioYogurt) throw new Error('Sin envío en segundo plano: reintentar luego')
      await self.envioYogurt.enviarEnSegundoPlano() // si falla (sin señal), el navegador lo reintenta más tarde
    })(),
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

  // Navegación: red primero, si no hay conexión la copia guardada. Sólo una página de la app reemplaza esa copia
  // (abrir a mano una dirección de la API no debe guardar sus datos ni romper la app sin conexión).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copia = res.clone()
            caches.open(APP).then((c) => c.put('./index.html', copia))
          }
          return res
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  if (!PROPIOS.has(url.pathname)) return

  // Archivos de la app (con hash): caché primero. Hay servidores que responden `Vary: Origin` y entonces los módulos
  // (que viajan con Origin) no encontrarían la copia guardada al instalar: aquí el nombre con hash basta.
  e.respondWith(
    caches.match(req, { ignoreVary: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(APP).then((c) => c.put(req, copia)) }
      return res
    })),
  )
})
