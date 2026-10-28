import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import type { Config } from './config.js'
import { conAlcance, fijarEmpresa, porEmpresa, type Db } from './db.js'
import { rutasAuth } from './auth.js'
import { rutasCartera } from './cartera.js'
import { crearDespachador, rutasNotificaciones } from './notificaciones.js'
import { crearEnviador, type Enviador } from './push.js'
import { rutasReportes } from './reportes.js'
import { rutasLibreta } from './libreta.js'
import { rutasDosPasos } from './dosPasos.js'
import { CABECERA_APP, leerCookie } from './cookies.js'
import { rutasStock } from './stock.js'
import { rutasUsuarios } from './usuarios.js'
import { rutasAdmin } from './admin.js'
import { rutasSync } from './sync/rutas.js'
import { rutasRecuperacion } from './recuperacion.js'
import { ipCliente } from './seguridad.js'

export type Rol = 'administrador' | 'vendedor'
export interface Usuario {
  id: string
  rol: Rol
  sid: string
  debeCambiarPassword: boolean
  empresa: string // id_empresa: la base sólo le deja ver y escribir lo de esa empresa
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario: Usuario
  }
}

export interface Contexto {
  db: Db
  config: Config
  enviador?: Enviador | null // cómo mandar un push; por defecto el de las claves VAPID de config (null = sin push). Las pruebas ponen uno falso.
}

export async function construirApp(entrada: Contexto): Promise<FastifyInstance> {
  // Multiempresa: con sesión, cada consulta corre dentro de la empresa del usuario (db.ts, porEmpresa).
  const ctx: Contexto = { ...entrada, db: porEmpresa(entrada.db) }
  const saltos = ctx.config.trustProxy
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
    // Se le cree a X-Forwarded-For sólo lo que agregaron nuestros proxies (los primeros saltos); lo de antes lo pudo inventar quien llama.
    trustProxy: saltos ? (_ip: string, salto: number) => salto < saltos : false,
    bodyLimit: 1024 * 1024, // 1 MB; la sincronización (muchos cambios juntos) tiene su propio tope
    // En Vercel todo llega como /api/...; en local y en las pruebas, sin prefijo. Ambas formas valen.
    rewriteUrl: (req) => (req.url ?? '/').replace(/^\/api(?=\/|\?|$)/, '') || '/',
  })

  // Cada petición tiene su alcance: empieza sin empresa y autenticar() le pone la del usuario. Va primero, para que todo
  // lo que corre después (hooks, la ruta, los avisos que se mandan al terminar) quede dentro.
  app.addHook('onRequest', (_req, _rep, listo) => conAlcance(listo))

  // Los detalles de un error interno van al registro del servidor, no a quien llamó.
  app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, req, rep) => {
    if (error.statusCode && error.statusCode < 500) return rep.send(error)
    req.log.error(error)
    return rep.code(500).send({ error: 'Error interno del servidor' })
  })

  // Cabeceras de seguridad en todas las respuestas: nada queda en cachés ni en el Referer, el navegador no adivina
  // el tipo de contenido y ninguna respuesta se puede mostrar dentro de otra página.
  app.addHook('onRequest', async (_req, rep) => {
    rep.header('cache-control', 'no-store')
    rep.header('x-content-type-options', 'nosniff')
    rep.header('referrer-policy', 'no-referrer')
    rep.header('x-frame-options', 'DENY')
    rep.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
  })

  await app.register(cors, { origin: ctx.config.corsOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'] })
  await app.register(rateLimit, { global: false, allowList: () => ctx.config.sinLimiteDePeticiones, keyGenerator: (req) => ipCliente(req, ctx.config) })
  await app.register(jwt, {
    secret: ctx.config.jwtSecret,
    sign: { algorithm: 'HS256', expiresIn: `${ctx.config.accesoMinutos}m` },
    verify: { algorithms: ['HS256'] },
  })

  // RF-005 / RF-006: el token trae la sesión; si se revocó (cerrar sesión) o el usuario se
  // desactivó o cambió de rol, la base lo dice en cada petición.
  async function autenticar(req: FastifyRequest, rep: FastifyReply, permitirPasswordPendiente = false) {
    let payload: { sub: string; sid: string }
    // El token va en Authorization (app de reparto) o en la cookie HttpOnly del panel web (cookies.ts).
    const deCookie = req.headers.authorization ? undefined : leerCookie(req, ctx.config, 'acceso')
    try {
      payload = deCookie ? app.jwt.verify(deCookie) : await req.jwtVerify()
      // Sólo un token de sesión: el desafío del segundo paso del login (sin sesión) no abre nada más.
      if (typeof payload.sid !== 'string' || typeof payload.sub !== 'string') throw new Error('no es un token de sesión')
    } catch {
      return rep.code(401).send({ error: 'Sesión inválida o vencida', codigo: 'SESION_INVALIDA' })
    }
    // Con cookie el navegador pone la sesión solo: un cambio debe traer además la cabecera de la app (CSRF).
    if (deCookie && req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CABECERA_APP] !== 'app') {
      return rep.code(403).send({ error: 'Solicitud no permitida', codigo: 'SIN_CABECERA' })
    }
    // Todavía sin empresa en el alcance: esta consulta busca la sesión en todo el sistema.
    const { rows } = await ctx.db.query(
      `SELECT u.id_usuario, u.rol, u.debe_cambiar_password, u.id_empresa, e.activa AS empresa_activa
         FROM sesiones s JOIN usuarios u USING (id_usuario) JOIN empresas e USING (id_empresa)
        WHERE s.id_sesion = $1 AND s.id_usuario = $2 AND s.revocado_en IS NULL AND s.expira_en > now() AND u.activo`,
      [payload.sid, payload.sub],
    )
    if (!rows[0]) return rep.code(401).send({ error: 'Sesión inválida o vencida', codigo: 'SESION_INVALIDA' })
    if (!rows[0].empresa_activa) return rep.code(403).send({ error: 'La cuenta de tu empresa está suspendida.', codigo: 'EMPRESA_SUSPENDIDA' })
    fijarEmpresa(rows[0].id_empresa) // desde aquí, todo lo de esta petición corre dentro de su empresa
    req.usuario = { id: rows[0].id_usuario, rol: rows[0].rol, sid: payload.sid, debeCambiarPassword: rows[0].debe_cambiar_password, empresa: rows[0].id_empresa }
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

  // RF-054: los avisos para los vendedores (guardados y, con claves VAPID, por push).
  const enviador = ctx.enviador !== undefined ? ctx.enviador : crearEnviador(ctx.config)
  const despachador = crearDespachador(ctx.db, enviador, app.log)

  await rutasAuth(app, ctx, { requiereSesionAunConPasswordPendiente })
  await rutasDosPasos(app, ctx, { requiereSesion })
  await rutasRecuperacion(app, ctx)
  await rutasSync(app, ctx, { requiereSesion, requiereAdmin }, despachador)
  await rutasUsuarios(app, ctx, { requiereAdmin })
  await rutasCartera(app, ctx, { requiereAdmin }, despachador)
  await rutasAdmin(app, ctx, { requiereAdmin })
  await rutasReportes(app, ctx, { requiereAdmin })
  await rutasLibreta(app, ctx, { requiereAdmin })
  await rutasStock(app, ctx, { requiereAdmin }, despachador)
  await rutasNotificaciones(app, ctx, { requiereSesion }, despachador, enviador)

  return app
}
