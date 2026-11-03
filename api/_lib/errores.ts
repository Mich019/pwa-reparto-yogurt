import { randomBytes } from 'node:crypto'

// Monitoreo de errores del servidor con Sentry (o uno compatible, como GlitchTip), sin dependencias: se arma el
// «envelope» a mano y se manda con fetch. Sin SENTRY_DSN no hace nada. Sólo se reportan los errores internos (5xx),
// con el tipo, el mensaje y el rastro; nunca el cuerpo de la petición, la sesión ni el `detail` de la base de datos
// (puede traer datos de clientes).

export interface DestinoSentry { envelope: string; dsn: string }

// DSN: https://<llave>@<servidor>/<proyecto>. Inválido o vacío = sin monitoreo.
export function leerDsn(valor: string | undefined): DestinoSentry | null {
  if (!valor) return null
  try {
    const u = new URL(valor)
    const proyecto = u.pathname.replace(/^\/+|\/+$/g, '')
    if (!u.username || !proyecto || !/^https?:$/.test(u.protocol)) return null
    return { dsn: valor, envelope: `${u.protocol}//${u.host}/api/${proyecto}/envelope/?sentry_version=7&sentry_key=${u.username}&sentry_client=delisy-api%2F1` }
  } catch {
    return null
  }
}

// «at funcion (archivo:línea:col)» → marcos de Sentry (el más viejo primero).
export function marcosDe(rastro: string | undefined) {
  const marcos: { function?: string; filename: string; lineno: number; colno: number }[] = []
  for (const linea of (rastro ?? '').split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(linea)
    if (m) marcos.push({ function: m[1] || undefined, filename: m[2].replace(/^file:\/\//, ''), lineno: Number(m[3]), colno: Number(m[4]) })
  }
  return marcos.reverse()
}

export interface ContextoError { metodo?: string; ruta?: string; entorno?: string | null; version?: string | null }

export function armarEnvelope(destino: DestinoSentry, error: unknown, ctx: ContextoError = {}, ahora = new Date()): string {
  const e = error instanceof Error ? error : new Error(String(error))
  const id = randomBytes(16).toString('hex')
  const codigo = (e as { code?: unknown }).code
  const evento = {
    event_id: id,
    timestamp: ahora.getTime() / 1000,
    platform: 'node',
    level: 'error',
    environment: ctx.entorno || 'production',
    ...(ctx.version ? { release: ctx.version } : {}),
    exception: { values: [{ type: e.name, value: e.message.split('\n')[0].slice(0, 500), stacktrace: { frames: marcosDe(e.stack) } }] },
    // La ruta se manda con su forma (:id), sin la consulta ni valores: puede llevar correos o códigos.
    request: { method: ctx.metodo, url: ctx.ruta },
    tags: typeof codigo === 'string' ? { codigo } : undefined,
  }
  return [JSON.stringify({ event_id: id, sent_at: ahora.toISOString(), dsn: destino.dsn }), JSON.stringify({ type: 'event' }), JSON.stringify(evento)].join('\n')
}

// Se manda y se espera poco: en una función de Vercel lo que sigue pendiente al responder puede perderse.
export async function reportarError(dsn: string, error: unknown, ctx: ContextoError = {}): Promise<boolean> {
  const destino = leerDsn(dsn)
  if (!destino) return false
  try {
    const r = await fetch(destino.envelope, { method: 'POST', body: armarEnvelope(destino, error, ctx), headers: { 'content-type': 'text/plain;charset=UTF-8' }, signal: AbortSignal.timeout(2500) })
    return r.ok
  } catch {
    return false
  }
}
