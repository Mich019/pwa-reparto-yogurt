import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import type { Config } from './config.js'
import type { Db } from './db.js'
import { rutasAuth } from './auth.js'
import { rutasCartera } from './cartera.js'
import { rutasReportes } from './reportes.js'
import { rutasUsuarios } from './usuarios.js'
import { rutasSync } from './sync/rutas.js'
import { rutasRecuperacion } from './recuperacion.js'

export type Rol = 'administrador' | 'vendedor'
export interface Usuario {
  id: string
  rol: Rol
  sid: string
  debeCambiarPassword: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario: Usuario
  }
}

export interface Contexto {
  db: Db
  config: Config
}

export async function construirApp(ctx: Contexto): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 5 * 1024 * 1024,
    // En Vercel todo llega como /api/...; en local y en las pruebas, sin prefijo. Ambas formas valen.
    rewriteUrl: (req) => (req.url ?? '/').replace(/^\/api(?=\/|\?|$)/, '') || '/',
  })

  // Los detalles de un error interno van al registro del servidor, no a quien llamó.
  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, req, rep) => {
    if (error.statusCode && error.statusCode < 500) return rep.send(error)
    req.log.error(error)
    return rep.code(500).send({ error: 'Error interno del servidor' })
  })

  await app.register(cors, { origin: ctx.config.corsOrigins, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] })
  await app.register(rateLimit, { global: false, allowList: () => ctx.config.sinLimiteDePeticiones })
  await app.register(jwt, { secret: ctx.config.jwtSecret, sign: { expiresIn: `${ctx.config.accesoMinutos}m` } })

  // RF-005 / RF-006: el token trae la sesión; si se revocó (cerrar sesión) o el usuario se
  // desactivó o cambió de rol, la base lo dice en cada petición.
  async function autenticar(req: FastifyRequest, rep: FastifyReply, permitirPasswordPendiente = false) {
    let payload: { sub: string; sid: string }
    try {
      payload = await req.jwtVerify()
    } catch {
      return rep.code(401).send({ error: 'Sesión inválida o vencida', codigo: 'SESION_INVALIDA' })
    }
    const { rows } = await ctx.db.query(
      `SELECT u.id_usuario, u.rol, u.debe_cambiar_password
         FROM sesiones s JOIN usuarios u USING (id_usuario)
        WHERE s.id_sesion = $1 AND s.id_usuario = $2 AND s.revocado_en IS NULL AND s.expira_en > now() AND u.activo`,
      [payload.sid, payload.sub],
    )
    if (!rows[0]) return rep.code(401).send({ error: 'Sesión inválida o vencida', codigo: 'SESION_INVALIDA' })
    req.usuario = { id: rows[0].id_usuario, rol: rows[0].rol, sid: payload.sid, debeCambiarPassword: rows[0].debe_cambiar_password }
    if (rows[0].debe_cambiar_password && !permitirPasswordPendiente) {
      return rep.code(403).send({ error: 'Debes cambiar tu contraseña antes de continuar', codigo: 'CAMBIAR_PASSWORD' })
    }
  }

  const requiereSesion = (req: FastifyRequest, rep: FastifyReply) => autenticar(req, rep)
  const requiereSesionAunConPasswordPendiente = (req: FastifyRequest, rep: FastifyReply) => autenticar(req, rep, true)
  const requiereAdmin = async (req: FastifyRequest, rep: FastifyReply) => {
    await autenticar(req, rep)
    if (!rep.sent && req.usuario.rol !== 'administrador') return rep.code(403).send({ error: 'Sólo el administrador puede hacer esto', codigo: 'SIN_PERMISO' })
  }

  app.get('/health', async () => ({ ok: true }))

  await rutasAuth(app, ctx, { requiereSesionAunConPasswordPendiente })
  await rutasRecuperacion(app, ctx)
  await rutasSync(app, ctx, { requiereSesion, requiereAdmin })
  await rutasUsuarios(app, ctx, { requiereAdmin })
  await rutasCartera(app, ctx, { requiereAdmin })
  await rutasReportes(app, ctx, { requiereAdmin })

  return app
}
