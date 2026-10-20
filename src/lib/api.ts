// Conexión con el servidor. En Vercel o con proxy local apunta a /api por defecto.
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '/api').replace(/\/+$/, '')
export const MODO_SERVIDOR = import.meta.env.VITE_OFFLINE_SOLO === 'true' ? false : true

export class ErrorApi extends Error {
  status: number
  codigo?: string
  datos?: any
  constructor(status: number, mensaje: string, codigo?: string, datos?: any) {
    super(mensaje)
    this.status = status
    this.codigo = codigo
    this.datos = datos
  }
}

// No se pudo llegar al servidor (sin señal, servidor caído): se reintenta más tarde.
export class ErrorRed extends Error {}

export async function api<T>(ruta: string, opciones: { metodo?: 'GET' | 'POST' | 'PATCH'; cuerpo?: unknown; token?: string } = {}): Promise<T> {
  let r: Response
  try {
    r = await fetch(API_URL + ruta, {
      method: opciones.metodo ?? (opciones.cuerpo ? 'POST' : 'GET'),
      headers: {
        ...(opciones.cuerpo ? { 'content-type': 'application/json' } : {}),
        ...(opciones.token ? { authorization: `Bearer ${opciones.token}` } : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new ErrorRed('Sin conexión con el servidor')
  }
  if (r.status === 204) return undefined as T
  const datos = await r.json().catch(() => null)
  if (!r.ok) throw new ErrorApi(r.status, datos?.error ?? `Error ${r.status}`, datos?.codigo, datos)
  return datos as T
}

// Un archivo que genera el servidor (Excel, CSV). Los errores llegan como JSON, igual que en `api`.
export async function apiArchivo(ruta: string, token: string): Promise<Blob> {
  let r: Response
  try {
    r = await fetch(API_URL + ruta, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) })
  } catch {
    throw new ErrorRed('Sin conexión con el servidor')
  }
  if (!r.ok) {
    const datos = await r.json().catch(() => null)
    throw new ErrorApi(r.status, datos?.error ?? `Error ${r.status}`, datos?.codigo, datos)
  }
  return r.blob()
}
