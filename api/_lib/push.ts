import webpush from 'web-push'
import type { Config } from './config.js'

// Web Push (RF-054): el servidor le habla al servicio de notificaciones del navegador (Google, Mozilla, Apple…)
// y éste despierta el service worker del teléfono, aunque la app esté cerrada.

export interface Suscripcion {
  endpoint: string
  p256dh: string
  auth: string
}

// El servicio de notificaciones respondió que esa suscripción ya no existe (404 o 410): hay que olvidarla.
export class SuscripcionCaducada extends Error {}

export type Enviador = (sub: Suscripcion, carga: string) => Promise<void>

// Sin claves VAPID no hay push: la app sigue mostrando los avisos al sincronizar.
export function crearEnviador(config: Config): Enviador | null {
  if (!config.vapidPublica || !config.vapidPrivada) return null
  webpush.setVapidDetails(config.vapidContacto, config.vapidPublica, config.vapidPrivada) // lanza si las claves no son válidas
  return async (sub, carga) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, carga, {
        TTL: 12 * 3600, // un pedido urgente de ayer ya no sirve
        urgency: 'high',
        timeout: 4000,
      })
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) throw new SuscripcionCaducada()
      throw e
    }
  }
}

// El servidor hace una petición POST a la dirección que trae la suscripción, y esa dirección la manda el cliente.
// Para que nadie use esto como puerta a la red interna (SSRF), sólo se acepta la de los servicios de push conocidos.
const SERVICIOS_PUSH = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge, Samsung Internet y demás Android
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, // Firefox
  /^([a-z0-9-]+\.)*push\.apple\.com$/, // Safari y PWA en iPhone
  /^([a-z0-9-]+\.)*notify\.windows\.com$/, // Edge en Windows
]

export function endpointPermitido(valor: string): boolean {
  let u: URL
  try {
    u = new URL(valor)
  } catch {
    return false
  }
  // Sólo la forma canónica (la que da el navegador): web-push usa otro analizador de direcciones y una forma rara como
  // «https:/fcm.googleapis.com/x» la entendería como otro destino (p. ej. el propio servidor).
  if (u.href !== valor) return false
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false
  return SERVICIOS_PUSH.some((r) => r.test(u.hostname))
}
