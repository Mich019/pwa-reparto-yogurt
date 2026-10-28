import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Config } from './config.js'

// Suscripciones de Mercado Pago sin plan asociado (API /preapproval), con un fetch: sin dependencias, igual en local y
// en Vercel. https://www.mercadopago.com.mx/developers/es/docs/subscriptions
// Las pruebas inyectan un cliente falso (Contexto.mercadoPago).

export type EstadoMp = 'pending' | 'authorized' | 'paused' | 'cancelled'

export interface ClienteMp {
  // Crea la suscripción pendiente y devuelve el enlace donde la persona pone su tarjeta.
  crear(d: { empresa: string; correo: string; motivo: string; monto: number; moneda: string; inicio: Date | null; volverA: string }): Promise<{ id: string; url: string }>
  consultar(id: string): Promise<{ id: string; estado: EstadoMp; empresa: string | null }>
  cancelar(id: string): Promise<void>
}

const API = 'https://api.mercadopago.com'

export function crearClienteMp(config: Config): ClienteMp | null {
  const { accessToken } = config.mercadoPago
  if (!accessToken) return null
  async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
    const r = await fetch(API + ruta, {
      method: metodo,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const datos = await r.json().catch(() => null)
    if (!r.ok) throw new Error(`Mercado Pago respondió ${r.status}: ${datos?.message ?? ''}`)
    return datos as T
  }
  return {
    async crear(d) {
      const r = await llamar<{ id: string; init_point: string }>('POST', '/preapproval', {
        reason: d.motivo,
        external_reference: d.empresa,
        payer_email: d.correo,
        back_url: d.volverA,
        status: 'pending',
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: d.monto,
          currency_id: d.moneda,
          // Si todavía le quedan días de prueba, el primer cobro llega cuando terminan.
          ...(d.inicio ? { start_date: d.inicio.toISOString() } : {}),
        },
      })
      return { id: r.id, url: r.init_point }
    },
    async consultar(id) {
      const r = await llamar<{ id: string; status: EstadoMp; external_reference?: string }>('GET', `/preapproval/${encodeURIComponent(id)}`)
      return { id: r.id, estado: r.status, empresa: r.external_reference ?? null }
    },
    async cancelar(id) {
      await llamar('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' })
    },
  }
}

// Firma de los avisos (webhooks): x-signature = «ts=…,v1=…», HMAC-SHA256 con la clave secreta de la aplicación sobre
// «id:<data.id>;request-id:<x-request-id>;ts:<ts>;». Aun con firma válida, el estado se vuelve a pedir a la API: el
// aviso sólo dice «algo cambió en esta suscripción».
export function firmaValida(secreto: string, d: { firma?: string; idPeticion?: string; idDato: string }) {
  const partes = Object.fromEntries((d.firma ?? '').split(',').map((p) => p.trim().split('=') as [string, string]))
  if (!partes.ts || !partes.v1) return false
  const manifiesto = `id:${d.idDato.toLowerCase()};${d.idPeticion ? `request-id:${d.idPeticion};` : ''}ts:${partes.ts};`
  const esperada = createHmac('sha256', secreto).update(manifiesto).digest('hex')
  return esperada.length === partes.v1.length && timingSafeEqual(Buffer.from(esperada), Buffer.from(partes.v1))
}
