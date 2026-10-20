// Conexión con el servidor (server/). Sin VITE_API_URL la app funciona sólo en este teléfono,
// sin inicio de sesión ni sincronización, como antes.
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')
export const MODO_SERVIDOR = API_URL !== ''

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

export async function api<T>(ruta: string, opciones: { metodo?: 'GET' | 'POST'; cuerpo?: unknown; token?: string } = {}): Promise<T> {
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
