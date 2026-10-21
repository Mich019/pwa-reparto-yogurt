import { useSyncExternalStore } from 'react'
import { api, apiArchivo, ErrorApi, ErrorRed, MODO_SERVIDOR } from './api'
import { db } from './db'

// Sesión del usuario en este teléfono. Se guarda en el teléfono para que la app abra sin internet:
// el acceso se renueva solo cuando hay conexión y se pierde sólo al cerrar sesión o si el servidor
// la revoca (RF-006).

export type Rol = 'administrador' | 'vendedor'
export interface UsuarioSesion {
  id: string
  nombre: string
  correo: string
  rol: Rol
  debeCambiarPassword: boolean
}
interface Sesion {
  accessToken: string
  expiraEn: number
  refreshToken: string
  usuario: UsuarioSesion
}

const CLAVE = 'sesion-yogurt'
const oyentes = new Set<() => void>()

function leer(): Sesion | null {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE) ?? 'null')
    return s?.refreshToken && s?.usuario ? s : null
  } catch {
    return null
  }
}
let actual: Sesion | null = MODO_SERVIDOR ? leer() : null

function fijar(s: Sesion | null) {
  actual = s
  try {
    if (s) localStorage.setItem(CLAVE, JSON.stringify(s))
    else localStorage.removeItem(CLAVE)
  } catch { /* almacenamiento lleno o bloqueado: la sesión vale mientras la app siga abierta */ }
  oyentes.forEach((f) => f())
}

export const sesionActual = () => actual
export function useSesion() {
  return useSyncExternalStore(
    (f) => { oyentes.add(f); return () => { oyentes.delete(f) } },
    () => actual,
  )
}

// Quién puede qué (RF-005). Sin servidor, la app trabaja como administrador, igual que antes.
export function useRol(): Rol {
  const s = useSesion()
  return MODO_SERVIDOR ? (s?.usuario.rol ?? 'vendedor') : 'administrador'
}

export const dispositivoId = () => {
  let id = localStorage.getItem('dispositivo-yogurt')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('dispositivo-yogurt', id)
  }
  return id
}

// Un teléfono guarda los datos de una sola cuenta. Cambiar de cuenta con cambios sin enviar los borraría (p. ej. las
// ventas del día de un vendedor si un administrador entra en su teléfono), así que se pide entrar antes con esa cuenta.
async function adoptarUsuario(u: UsuarioSesion) {
  const previo = (await db.meta.get('usuarioId'))?.valor as string | undefined
  if (previo && previo !== u.id) {
    if ((await db.cola.count()) > 0) {
      throw new Error('Este teléfono tiene cambios sin enviar de otra cuenta. Entra con esa cuenta para sincronizarlos primero.')
    }
    await db.transaction('rw', [db.clientes, db.productos, db.pedidos, db.recordatorios, db.cola, db.meta, db.problemas, db.stock, db.avisos], async () => {
      await Promise.all([db.clientes.clear(), db.productos.clear(), db.pedidos.clear(), db.recordatorios.clear(), db.cola.clear(), db.meta.clear(), db.problemas.clear(), db.stock.clear(), db.avisos.clear()])
    })
  }
  await db.meta.put({ clave: 'usuarioId', valor: u.id })
}

// Sólo con una contraseña temporal recién usada: el cambio obligatorio la trae escrita. Nunca en una sesión normal,
// donde pedir la actual protege a la cuenta si alguien toma el teléfono abierto (y el ojito la mostraría).
let ultimoPasswordSesion: string | null = null
export const obtenerUltimoPassword = () => ultimoPasswordSesion
export const limpiarUltimoPassword = () => { ultimoPasswordSesion = null }

export async function iniciarSesion(correo: string, password: string) {
  const c = correo.trim()
  const p = password.trim()
  const r = await api<Sesion>('/auth/login', { cuerpo: { correo: c, password: p, dispositivo: dispositivoId() } })
  try {
    await adoptarUsuario(r.usuario)
  } catch (e) {
    await api('/auth/logout', { cuerpo: { refreshToken: r.refreshToken } }).catch(() => {})
    throw e
  }
  ultimoPasswordSesion = r.usuario.debeCambiarPassword ? p : null
  fijar({ accessToken: r.accessToken, expiraEn: r.expiraEn, refreshToken: r.refreshToken, usuario: r.usuario })
}

// Mensaje para quien intenta entrar. Los del servidor ya están pensados para mostrarse (cuenta bloqueada o dada de baja);
// sin señal hay que decirlo, porque la primera vez en un teléfono no se puede entrar sin conexión.
export function mensajeErrorLogin(e: unknown): string {
  if (e instanceof ErrorRed) return 'Sin conexión con el servidor. Para entrar la primera vez necesitas internet.'
  if (e instanceof ErrorApi) return e.status >= 500 ? 'El servidor no respondió bien. Intenta de nuevo en un momento.' : e.message
  if (e instanceof Error) return e.message // p. ej. cambios sin enviar de otra cuenta en este teléfono
  return 'No se pudo entrar'
}

let renovando: Promise<string | null> | null = null

// Token de acceso vigente, renovándolo si hace falta. null = no se pudo (sin conexión o sesión revocada).
export async function tokenValido(): Promise<string | null> {
  const s = actual
  if (!s) return null
  if (s.expiraEn - Date.now() > 60_000) return s.accessToken
  renovando ??= (async () => {
    try {
      const r = await api<Sesion>('/auth/refresh', { cuerpo: { refreshToken: s.refreshToken } })
      fijar({ ...r, usuario: r.usuario })
      return r.accessToken
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) fijar(null) // el servidor revocó la sesión: hay que entrar de nuevo
      if (e instanceof ErrorRed || e instanceof ErrorApi) return null
      throw e
    } finally {
      renovando = null
    }
  })()
  return renovando
}

// El token de acceso ya no sirve (vencido o revocado): se pedirá uno nuevo con el refresh token.
export function expirarToken() {
  if (actual) fijar({ ...actual, expiraEn: 0 })
}

// El servidor dijo que esta sesión ya no sirve.
export const sesionRevocada = () => fijar(null)

// Llamada al servidor con la sesión de este teléfono: renueva el token si hace falta y, si el servidor lo
// rechaza, pide uno nuevo y reintenta una vez. Si la sesión se revocó, vuelve la pantalla de entrada.
async function conSesion<T>(llamada: (token: string) => Promise<T>): Promise<T> {
  for (let intento = 0; ; intento++) {
    const token = await tokenValido()
    if (!token) throw new ErrorRed(actual ? 'Sin conexión' : 'Sin sesión')
    try {
      return await llamada(token)
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401 && intento === 0) {
        expirarToken()
        continue
      }
      if (e instanceof ErrorApi && e.status === 403 && e.codigo === 'CAMBIAR_PASSWORD') marcarPasswordPendiente(true)
      throw e
    }
  }
}

export function llamarAutenticado<T>(ruta: string, opciones: { metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH'; cuerpo?: unknown } = {}): Promise<T> {
  return conSesion((token) => api<T>(ruta, { ...opciones, token }))
}

// Igual, para bajar un archivo (reportes en Excel o CSV).
export const descargarAutenticado = (ruta: string): Promise<Blob> => conSesion((token) => apiArchivo(ruta, token))

export function marcarPasswordPendiente(pendiente: boolean) {
  if (actual) fijar({ ...actual, usuario: { ...actual.usuario, debeCambiarPassword: pendiente } })
}

export async function cambiarPassword(actualPassword: string, nueva: string) {
  const token = await tokenValido()
  if (!token) throw new ErrorRed('Necesitas conexión para cambiar la contraseña')
  await api('/auth/cambiar-password', { token, cuerpo: { actual: actualPassword.trim(), nueva: nueva.trim() } })
  limpiarUltimoPassword()
  marcarPasswordPendiente(false)
}

// Lo que hay que hacer mientras la sesión sigue abierta, antes de cerrarla (p. ej. dejar de recibir los avisos de la cuenta).
const antesDeCerrar = new Set<() => Promise<unknown>>()
export function alCerrarSesion(tarea: () => Promise<unknown>) {
  antesDeCerrar.add(tarea)
  return () => { antesDeCerrar.delete(tarea) }
}

// Los datos del teléfono se conservan: si quedaron cambios sin enviar, se mandan al volver a entrar.
export async function cerrarSesion() {
  limpiarUltimoPassword()
  const s = actual
  if (s) {
    // Mejor esfuerzo y con tope de tiempo: sin señal, cerrar sesión no debe quedarse esperando.
    await Promise.race([Promise.allSettled([...antesDeCerrar].map((t) => t())), new Promise((r) => setTimeout(r, 4000))])
    await api('/auth/logout', { cuerpo: { refreshToken: s.refreshToken } }).catch(() => {})
  }
  fijar(null)
}

// RF-002: Solicita un código de 6 dígitos al correo registrado
export async function solicitarRecuperacion(correo: string): Promise<{ ok: boolean; minutos: number }> {
  return await api<{ ok: boolean; minutos: number }>('/auth/recuperar', {
    cuerpo: { correo: correo.trim() },
  })
}

// RF-002: Valida el código de 6 dígitos y define la nueva contraseña
export async function restablecerPassword(correo: string, codigo: string, nueva: string): Promise<void> {
  await api('/auth/restablecer', {
    cuerpo: { correo: correo.trim(), codigo: codigo.trim(), nueva: nueva.trim() }, // el inicio de sesión también recorta
  })
}

