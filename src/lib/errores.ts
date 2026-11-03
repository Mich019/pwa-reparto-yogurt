// Monitoreo de errores de la app con Sentry (o uno compatible), sin dependencias. Sólo se activa si el build trae
// VITE_SENTRY_DSN. Se manda el tipo, el mensaje y el rastro del error con la dirección SIN consulta ni fragmento (la
// invitación y los enlaces de recuperación viajan ahí) y nunca datos de la persona ni de la empresa. Los fallos de red
// no se mandan: sin señal son lo normal en una app que trabaja sin conexión.

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim() ?? ''
const MAX_POR_SESION = 10

function destino() {
  try {
    const u = new URL(DSN)
    const proyecto = u.pathname.replace(/^\/+|\/+$/g, '')
    if (!u.username || !proyecto) return null
    return `${u.protocol}//${u.host}/api/${proyecto}/envelope/?sentry_version=7&sentry_key=${u.username}&sentry_client=delisy-web%2F1`
  } catch {
    return null
  }
}

const ruido = (mensaje: string) =>
  /failed to fetch|networkerror|load failed|network request failed|the user aborted|resizeobserver loop/i.test(mensaje)

function marcos(rastro: string | undefined) {
  const salida: { function?: string; filename: string; lineno: number; colno: number }[] = []
  for (const linea of (rastro ?? '').split('\n')) {
    // Chrome: «at fn (url:1:2)»; Firefox/Safari: «fn@url:1:2».
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(linea) ?? /^(.*?)@(.+?):(\d+):(\d+)$/.exec(linea)
    if (m) salida.push({ function: m[1] || undefined, filename: m[2].split(/[?#]/)[0], lineno: Number(m[3]), colno: Number(m[4]) })
  }
  return salida.reverse()
}

const vistos = new Set<string>()

export function reportarError(causa: unknown) {
  const url = destino()
  if (!url || vistos.size >= MAX_POR_SESION) return
  const e = causa instanceof Error ? causa : new Error(typeof causa === 'string' ? causa : 'Error desconocido')
  const mensaje = e.message.split('\n')[0].slice(0, 500)
  const clave = `${e.name}|${mensaje}`
  if (ruido(mensaje) || vistos.has(clave)) return
  vistos.add(clave)
  const id = crypto.randomUUID().replaceAll('-', '')
  const evento = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: import.meta.env.MODE,
    exception: { values: [{ type: e.name, value: mensaje, stacktrace: { frames: marcos(e.stack) } }] },
    request: { url: `${location.origin}${location.pathname}` },
  }
  const cuerpo = [JSON.stringify({ event_id: id, sent_at: new Date().toISOString(), dsn: DSN }), JSON.stringify({ type: 'event' }), JSON.stringify(evento)].join('\n')
  // text/plain evita la consulta previa (preflight) del navegador.
  void fetch(url, { method: 'POST', body: cuerpo, headers: { 'content-type': 'text/plain;charset=UTF-8' }, keepalive: true }).catch(() => {})
}

export function iniciarMonitoreo() {
  if (!destino()) return
  window.addEventListener('error', (ev) => reportarError(ev.error ?? ev.message))
  window.addEventListener('unhandledrejection', (ev) => reportarError(ev.reason))
}
