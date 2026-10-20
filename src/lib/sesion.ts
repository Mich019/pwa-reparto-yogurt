import { useSyncExternalStore } from 'react'
import { api, ErrorApi, ErrorRed, MODO_SERVIDOR } from './api'
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

// Un teléfono guarda los datos de una sola cuenta de vendedor. Cambiar de cuenta con cambios sin enviar los perdería.
// Para administradores (que gestionan vía web central), no se bloquea por la cola local del repartidor.
async function adoptarUsuario(u: UsuarioSesion) {
  const previo = (await db.meta.get('usuarioId'))?.valor as string | undefined
  if (previo && previo !== u.id) {
    if (u.rol !== 'administrador' && (await db.cola.count()) > 0) {
      throw new Error('Este teléfono tiene cambios sin enviar de otra cuenta. Entra con esa cuenta para sincronizarlos primero.')
    }
    await db.transaction('rw', [db.clientes, db.productos, db.pedidos, db.recordatorios, db.cola, db.meta, db.problemas], async () => {
      await Promise.all([db.clientes.clear(), db.productos.clear(), db.pedidos.clear(), db.recordatorios.clear(), db.cola.clear(), db.meta.clear(), db.problemas.clear()])
    })
  }
  await db.meta.put({ clave: 'usuarioId', valor: u.id })
}

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
  ultimoPasswordSesion = p
  fijar({ accessToken: r.accessToken, expiraEn: r.expiraEn, refreshToken: r.refreshToken, usuario: r.usuario })
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
export async function llamarAutenticado<T>(ruta: string, opciones: { metodo?: 'GET' | 'POST' | 'PATCH'; cuerpo?: unknown } = {}): Promise<T> {
  for (let intento = 0; ; intento++) {
    const token = await tokenValido()
    if (!token) throw new ErrorRed(actual ? 'Sin conexión' : 'Sin sesión')
    try {
      return await api<T>(ruta, { ...opciones, token })
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

// Los datos del teléfono se conservan: si quedaron cambios sin enviar, se mandan al volver a entrar.
export async function cerrarSesion() {
  limpiarUltimoPassword()
  const s = actual
  if (s) await api('/auth/logout', { cuerpo: { refreshToken: s.refreshToken } }).catch(() => {})
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
    cuerpo: { correo: correo.trim(), codigo: codigo.trim(), nueva },
  })
}

