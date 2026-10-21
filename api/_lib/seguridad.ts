import { createHash, randomBytes, randomInt } from 'node:crypto'
import { isIP } from 'node:net'
import type { FastifyRequest } from 'fastify'

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const tokenAleatorio = () => randomBytes(32).toString('base64url')

// Contraseña temporal legible por teléfono o WhatsApp (sin 0/O/1/l/I), en tres grupos: "kP7x-Ym3Q-aR9d".
// Siempre trae letras y números, para cumplir la regla de contraseñas.
const ALFABETO = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function passwordTemporal() {
  for (;;) {
    const p = Array.from({ length: 12 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
    if (/[A-Za-z]/.test(p) && /\d/.test(p)) return p.replace(/(.{4})(?=.)/g, '$1-')
  }
}

// IP de quien llama, para los límites de intentos. En Vercel, la que pone su red (quien llama no puede cambiarla);
// si no, la que Fastify toma de X-Forwarded-For según TRUST_PROXY, o la de la conexión.
export function ipCliente(req: FastifyRequest, config: { enVercel: boolean }): string {
  if (config.enVercel) {
    const v = req.headers['x-vercel-forwarded-for']
    const ip = (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim()
    if (ip && isIP(ip)) return ip
  }
  return req.ip
}
