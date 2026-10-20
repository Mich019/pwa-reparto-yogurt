import { useCallback, useEffect, useState } from 'react'
import { llamarAutenticado } from './sesion'

// Notificaciones push (RF-054): el servidor despierta el service worker del teléfono aunque la app esté cerrada.
// Hace falta el permiso de la persona (siempre con un toque suyo) y que el servidor tenga sus claves VAPID.
// El mismo permiso sirve para los avisos locales de stock y de ventas sin enviar (RF-055).

export interface EstadoPush {
  soportado: boolean
  motivo?: string // por qué este teléfono o navegador no puede
  permiso: NotificationPermission
  suscrito: boolean // este teléfono recibe push de esta cuenta
  servidor: boolean | null // el servidor tiene push (null = no se pudo preguntar)
}

const esIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

// null si se puede; si no, la razón en palabras de la persona.
export function sinSoporte(): string | null {
  if (!('serviceWorker' in navigator)) return 'Este navegador no admite notificaciones.'
  if (!('Notification' in window) || !('PushManager' in window)) {
    return esIphone() ? 'En iPhone, instala la app: Compartir → «Agregar a inicio», y ábrela desde ahí.' : 'Este navegador no admite notificaciones.'
  }
  if (!import.meta.env.PROD) return 'Las notificaciones sólo funcionan en la app compilada (no en modo desarrollo).'
  return null
}

const registro = () => navigator.serviceWorker.getRegistration()

export async function leerEstadoPush(): Promise<EstadoPush> {
  const motivo = sinSoporte()
  const permiso: NotificationPermission = 'Notification' in window ? Notification.permission : 'denied'
  if (motivo) return { soportado: false, motivo, permiso, suscrito: false, servidor: null }
  const sub = await (await registro())?.pushManager.getSubscription()
  const servidor = await llamarAutenticado<{ push: boolean }>('/notificaciones/config').then((c) => c.push, () => null)
  return { soportado: true, permiso, suscrito: !!sub, servidor }
}

export function useEstadoPush() {
  const [estado, setEstado] = useState<EstadoPush | null>(null)
  const refrescar = useCallback(() => leerEstadoPush().then(setEstado, () => {}), [])
  useEffect(() => { void refrescar() }, [refrescar])
  return { estado, refrescar }
}

function aBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
const iguales = (a: ArrayBuffer | null, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i])

async function enviarSuscripcion(sub: PushSubscription) {
  const { endpoint, keys } = sub.toJSON()
  await llamarAutenticado('/notificaciones/suscripcion', { cuerpo: { endpoint, keys } })
}

export type ResultadoActivar = 'push' | 'solo-local'

// Pide permiso y suscribe este teléfono. Debe llamarse directo desde un toque (iPhone no deja pedir permiso de otra forma).
// Si el servidor no tiene push, el permiso igual queda para los avisos locales.
export async function activarPush(): Promise<ResultadoActivar> {
  const motivo = sinSoporte()
  if (motivo) throw new Error(motivo)
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') {
    throw new Error(permiso === 'denied' ? 'Los avisos están bloqueados. Actívalos en los ajustes del navegador para este sitio.' : 'No diste permiso para los avisos.')
  }
  const config = await llamarAutenticado<{ push: boolean; clavePublica: string | null }>('/notificaciones/config')
  if (!config.push || !config.clavePublica) return 'solo-local'

  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, no) => setTimeout(() => no(new Error('La app aún se está preparando. Ciérrala, vuelve a abrirla e inténtalo de nuevo.')), 8000)),
  ])
  const clave = aBytes(config.clavePublica)
  let sub = await reg.pushManager.getSubscription()
  // Si el servidor cambió de claves, la suscripción vieja ya no sirve.
  if (sub && !iguales(sub.options.applicationServerKey, clave)) {
    await sub.unsubscribe()
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave })
  await enviarSuscripcion(sub)
  return 'push'
}

export async function desactivarPush() {
  const sub = await (await registro())?.pushManager.getSubscription()
  if (!sub) return
  await llamarAutenticado('/notificaciones/suscripcion/baja', { cuerpo: { endpoint: sub.endpoint } }).catch(() => {})
  await sub.unsubscribe()
}

// Al abrir la app con una cuenta: el teléfono vuelve a decirle al servidor de quién es (por si cambió de cuenta o de dirección).
export async function renovarSuscripcion() {
  if (sinSoporte() || Notification.permission !== 'granted') return
  const sub = await (await registro())?.pushManager.getSubscription()
  if (sub) await enviarSuscripcion(sub)
}

// Al cerrar sesión: este teléfono deja de recibir los avisos de la cuenta (el siguiente que entre se suscribe por su cuenta).
export async function quitarEsteTelefono() {
  if (sinSoporte()) return
  const sub = await (await registro())?.pushManager.getSubscription()
  if (sub) await llamarAutenticado('/notificaciones/suscripcion/baja', { cuerpo: { endpoint: sub.endpoint } })
}

// «Enviar prueba»: el servidor manda un aviso a todos los teléfonos suscritos de esta cuenta.
export const enviarPrueba = () => llamarAutenticado<{ dispositivos: number; enviados: number }>('/notificaciones/prueba', { metodo: 'POST', cuerpo: {} })

// Marca avisos como leídos también en el servidor (mejor esfuerzo: la marca que vale es la del teléfono).
export const marcarLeidosEnServidor = (ids: string[]) =>
  ids.length ? llamarAutenticado('/notificaciones/leidas', { cuerpo: { ids } }).catch(() => {}) : Promise.resolve()
