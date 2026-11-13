import type { FastifyBaseLogger } from 'fastify'

// El registro del servidor (el pino de Fastify: `req.log`, o `app.log` fuera de una petición). Todas las llamadas siguen
// la misma forma, para que se puedan filtrar y leer igual en Vercel:
//   log.<nivel>({ err, ...contexto }, 'área: qué pasó')
// - El error siempre va como `err` (pino lo serializa con su pila); el contexto, con ids, nunca correos, teléfonos,
//   códigos, contraseñas ni el texto de un correo.
// - El mensaje en minúsculas, sin punto final, con el área delante: api, correo, push, avisos, cron, en vivo, sync,
//   cortes, plataforma, privacidad, suscripción, registro, recuperación.
// - error = algo falló y alguien debería verlo; warn = falló algo de fuera (Resend, Mercado Pago) o llegó algo raro;
//   info = cambios que conviene poder rastrear (plataforma, bajas, correos enviados).
export type Bitacora = Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>

// Para las pruebas y los scripts: no escribe nada.
export const callado: Bitacora = { info() {}, warn() {}, error() {} }
