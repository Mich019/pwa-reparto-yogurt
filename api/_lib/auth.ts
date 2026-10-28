import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import type { Config } from './config.js'
import { hashPassword, PASSWORD_MAX, revisarPassword, verificarPassword, verificarRelleno } from './contrasenas.js'
import { tx, type Db } from './db.js'
import { tieneDosPasos, usarCodigo } from './dosPasos.js'
import { borrarCookiesSesion, fijarCookiesSesion, leerCookie } from './cookies.js'
import { ipCliente, sha256, tokenAleatorio } from './seguridad.js'

// modo 'cookie': el panel web recibe la sesión en cookies HttpOnly en lugar de en la respuesta (ver cookies.ts).
const modo = z.enum(['token', 'cookie']).default('token')
const bodyLogin = z.object({
  correo: z.string().trim().min(3).max(150),
  password: z.string().min(1).max(PASSWORD_MAX),
  dispositivo: z.string().max(200).optional(),
  modo,
})
// Sin refreshToken, la sesión es la de la cookie.
const bodyRefresh = z.object({ refreshToken: z.string().min(20).max(200).optional() })
const bodyCodigoLogin = z.object({
  desafio: z.string().min(20).max(2000),
  codigo: z.string().trim().min(6).max(20),
  dispositivo: z.string().max(200).optional(),
  modo,
})
// Marca del token que entrega el login cuando falta el segundo paso: no sirve como sesión (ver autenticar en app.ts).
export const DESAFIO = 'dos-pasos'
const bodyCambio = z.object({ actual: z.string().min(1).max(PASSWORD_MAX), nueva: z.string().max(1000) })

const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos'
// Multiempresa: la empresa entera está suspendida (sólo se dice con la contraseña correcta, como la cuenta de baja).
const EMPRESA_SUSPENDIDA = { error: 'La cuenta de tu empresa está suspendida. Habla con el administrador de tu negocio.', codigo: 'EMPRESA_SUSPENDIDA' }

// RF-003: antes de probar una contraseña se revisa el límite de intentos y el intento queda registrado como fallido
// (si resulta correcta, se marca como bueno). Contar y registrar va bajo un candado por IP: los intentos simultáneos
// se forman y no se cuelan en paralelo. Se cuenta igual exista o no la cuenta, así el bloqueo no dice cuáles existen.
// Fallidos que cuentan: los de esa cuenta desde esa IP después de su último acceso bueno desde ahí o de su último
// cambio de contraseña, y todos los de esa IP, dentro de la ventana. null = bloqueado.
async function registrarIntento(db: Db, config: Config, intento: { correo: string; ip: string; idUsuario?: string; passwordCambiadoEn?: Date }) {
  return tx(db, null, async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('login:' || $1))`, [intento.ip])
    const { rows: [f] } = await c.query(
      `WITH recientes AS (
         SELECT lower(correo) = lower($2) AS misma, exitoso, creado_en
           FROM intentos_login WHERE ip = $1 AND creado_en > now() - make_interval(mins => $3))
       SELECT count(*) FILTER (WHERE NOT exitoso)::int AS de_la_ip,
              count(*) FILTER (WHERE misma AND NOT exitoso
                                 AND creado_en > COALESCE((SELECT max(creado_en) FROM recientes WHERE misma AND exitoso), '-infinity')
                                 AND creado_en > COALESCE($4::timestamptz, '-infinity'))::int AS de_la_cuenta
         FROM recientes`,
      [intento.ip, intento.correo, config.bloqueoMinutos, intento.passwordCambiadoEn ?? null],
    )
    if (f.de_la_cuenta >= config.maxIntentos || f.de_la_ip >= config.maxIntentosIp) return null
    const { rows: [r] } = await c.query(
      `INSERT INTO intentos_login (correo, id_usuario, exitoso, ip) VALUES ($1, $2, false, $3) RETURNING id_intento`,
      [intento.correo.slice(0, 150), intento.idUsuario ?? null, intento.ip],
    )
    return { bueno: () => db.query(`UPDATE intentos_login SET exitoso = true WHERE id_intento = $1`, [r.id_intento]) }
  })
}

function bloqueado(rep: FastifyReply, config: Config) {
  return rep.code(429).header('retry-after', String(config.bloqueoMinutos * 60)).send({
    error: `Demasiados intentos fallidos. Por seguridad espera ${config.bloqueoMinutos} minutos o restablece tu contraseña.`,
    codigo: 'BLOQUEADA',
  })
}

export async function rutasAuth(
  app: FastifyInstance,
  { db, config }: Contexto,
  { requiereSesionAunConPasswordPendiente }: { requiereSesionAunConPasswordPendiente: (req: FastifyRequest, rep: FastifyReply) => Promise<unknown> },
) {
  // Con cookie, los tokens viajan sólo en Set-Cookie (HttpOnly): la respuesta no los trae y la página no los ve.
  // `refreshToken` sólo al abrir la sesión: al renovar, la cookie de la sesión ya está puesta.
  function respuestaSesion(
    rep: FastifyReply,
    u: { id_usuario: string; nombre: string; correo: string; rol: string; debe_cambiar_password: boolean },
    sid: string,
    refreshToken: string,
    cookie: { nueva: boolean } | null,
  ) {
    const accessToken = app.jwt.sign({ sub: u.id_usuario, sid })
    const expiraEn = Date.now() + config.accesoMinutos * 60_000
    const usuario = { id: u.id_usuario, nombre: u.nombre, correo: u.correo, rol: u.rol, debeCambiarPassword: u.debe_cambiar_password }
    if (!cookie) return { accessToken, expiraEn, refreshToken, usuario }
    fijarCookiesSesion(rep, config, { acceso: accessToken, sesion: cookie.nueva ? refreshToken : undefined })
    return { cookie: true, expiraEn, usuario }
  }

  // RF-001 / RF-003 / RF-004
  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyLogin.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Faltan el correo o la contraseña' })
    const { correo, password, dispositivo, modo } = body.data
    const ip = ipCliente(req, config)

    const { rows } = await db.query(
      `SELECT u.id_usuario, u.nombre, u.correo, u.rol, u.password_hash, u.activo, u.debe_cambiar_password, u.password_cambiado_en,
              e.activa AS empresa_activa
         FROM usuarios u JOIN empresas e USING (id_empresa) WHERE lower(u.correo) = lower($1)`,
      [correo],
    )
    const u = rows[0]
    const intento = await registrarIntento(db, config, { correo, ip, idUsuario: u?.id_usuario, passwordCambiadoEn: u?.password_cambiado_en })
    if (!intento) return bloqueado(rep, config)

    if (!u) {
      await verificarRelleno(config, password) // tarda lo mismo que con una cuenta que sí existe
      return rep.code(401).send({ error: MENSAJE_CREDENCIALES })
    }
    const { ok, rehacer } = await verificarPassword(config, u.password_hash, password)
    if (!ok) return rep.code(401).send({ error: MENSAJE_CREDENCIALES })
    // RF-040: sólo con la contraseña correcta se le dice por qué no entra.
    if (!u.activo) return rep.code(403).send({ error: 'Tu cuenta está dada de baja. Habla con el administrador.', codigo: 'CUENTA_SUSPENDIDA' })
    if (!u.empresa_activa) return rep.code(403).send(EMPRESA_SUSPENDIDA)

    await intento.bueno()
    // Un hash del pepper anterior o con otros parámetros se rehace ahora que se tiene la contraseña.
    if (rehacer) await db.query(`UPDATE usuarios SET password_hash = $2 WHERE id_usuario = $1`, [u.id_usuario, await hashPassword(config, password)])
    // Con verificación en dos pasos la contraseña sola no abre sesión: se entrega un desafío de 5 minutos que sólo
    // sirve para /auth/login/codigo, junto con el código del autenticador.
    if (await tieneDosPasos(db, u.id_usuario)) {
      const desafio = app.jwt.sign({ sub: u.id_usuario, tipo: DESAFIO }, { expiresIn: '5m' })
      return { dosPasos: true, desafio }
    }
    return abrirSesion(rep, u, dispositivo, ip, modo)
  })

  async function abrirSesion(rep: FastifyReply, u: Parameters<typeof respuestaSesion>[1], dispositivo: string | undefined, ip: string, modo: 'token' | 'cookie') {
    await db.query(`UPDATE usuarios SET ultimo_acceso = now() WHERE id_usuario = $1`, [u.id_usuario])
    const refresh = tokenAleatorio()
    const { rows: s } = await db.query(
      `INSERT INTO sesiones (id_usuario, refresh_token_hash, dispositivo, ip, expira_en)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id_sesion`,
      [u.id_usuario, sha256(refresh), dispositivo ?? null, ip, config.sesionDias],
    )
    return respuestaSesion(rep, u, s[0].id_sesion, refresh, modo === 'cookie' ? { nueva: true } : null)
  }

  // Segundo paso del login: el código del autenticador o uno de respaldo. Un código equivocado cuenta como intento
  // fallido (RF-003), con los mismos límites que la contraseña: no se pueden probar los millones de combinaciones.
  app.post('/auth/login/codigo', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyCodigoLogin.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe el código de verificación' })
    let sub: string
    try {
      const p = app.jwt.verify<{ sub: string; tipo?: string }>(body.data.desafio)
      if (p.tipo !== DESAFIO) throw new Error('no es un desafío')
      sub = p.sub
    } catch {
      return rep.code(401).send({ error: 'Pasaron más de 5 minutos. Vuelve a escribir tu contraseña.', codigo: 'DESAFIO_VENCIDO' })
    }
    const ip = ipCliente(req, config)
    const { rows: [u] } = await db.query(
      `SELECT u.id_usuario, u.nombre, u.correo, u.rol, u.activo, u.debe_cambiar_password, u.password_cambiado_en, e.activa AS empresa_activa
         FROM usuarios u JOIN empresas e USING (id_empresa) WHERE u.id_usuario = $1`,
      [sub],
    )
    if (!u?.activo) return rep.code(401).send({ error: 'Vuelve a escribir tu contraseña.', codigo: 'DESAFIO_VENCIDO' })
    if (!u.empresa_activa) return rep.code(403).send(EMPRESA_SUSPENDIDA)
    const intento = await registrarIntento(db, config, { correo: u.correo, ip, idUsuario: u.id_usuario, passwordCambiadoEn: u.password_cambiado_en })
    if (!intento) return bloqueado(rep, config)
    if (!(await usarCodigo(db, config, u.id_usuario, body.data.codigo))) {
      return rep.code(401).send({ error: 'El código no es correcto o ya se usó. Escribe el que se ve ahora en tu app.' })
    }
    await intento.bueno()
    return abrirSesion(rep, u, body.data.dispositivo, ip, body.data.modo)
  })

  // Renueva el token de acceso. El refresh token no rota: en zonas sin señal una respuesta perdida
  // dejaría al repartidor fuera; se revoca al cerrar sesión o al cambiar la contraseña.
  app.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyRefresh.safeParse(req.body ?? {})
    if (!body.success) return rep.code(400).send({ error: 'Falta el token de sesión' })
    const deCookie = body.data.refreshToken ? undefined : leerCookie(req, config, 'sesion')
    const refresh = body.data.refreshToken ?? deCookie
    if (!refresh) return rep.code(401).send({ error: 'Sesión vencida, inicia sesión de nuevo', codigo: 'SESION_INVALIDA' })
    const { rows } = await db.query(
      `SELECT s.id_sesion, u.id_usuario, u.nombre, u.correo, u.rol, u.debe_cambiar_password, e.activa AS empresa_activa
         FROM sesiones s JOIN usuarios u USING (id_usuario) JOIN empresas e USING (id_empresa)
        WHERE s.refresh_token_hash = $1 AND s.revocado_en IS NULL AND s.expira_en > now() AND u.activo`,
      [sha256(refresh)],
    )
    if (!rows[0]) {
      if (deCookie) borrarCookiesSesion(rep, config)
      return rep.code(401).send({ error: 'Sesión vencida, inicia sesión de nuevo', codigo: 'SESION_INVALIDA' })
    }
    // 403 y no 401: la app no cierra la sesión, así lo que el repartidor no ha enviado se queda en el teléfono.
    if (!rows[0].empresa_activa) return rep.code(403).send(EMPRESA_SUSPENDIDA)
    return respuestaSesion(rep, rows[0], rows[0].id_sesion, refresh, deCookie ? { nueva: false } : null)
  })

  // RF-006: revoca la sesión de este dispositivo (la del cuerpo o la de la cookie). Siempre 204, para poder reintentar.
  app.post('/auth/logout', async (req, rep) => {
    const body = bodyRefresh.safeParse(req.body ?? {})
    const refresh = (body.success && body.data.refreshToken) || leerCookie(req, config, 'sesion')
    if (refresh) {
      await db.query(`UPDATE sesiones SET revocado_en = now() WHERE refresh_token_hash = $1 AND revocado_en IS NULL`, [sha256(refresh)])
    }
    if (!(body.success && body.data.refreshToken)) borrarCookiesSesion(rep, config)
    return rep.code(204).send()
  })

  app.get('/me', { preHandler: requiereSesionAunConPasswordPendiente }, async (req) => {
    const { rows } = await db.query(`SELECT id_usuario, nombre, correo, rol, debe_cambiar_password FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
    const u = rows[0]
    return { id: u.id_usuario, nombre: u.nombre, correo: u.correo, rol: u.rol, debeCambiarPassword: u.debe_cambiar_password }
  })

  // RF-039: quita la marca de "debe cambiar la contraseña". Cierra las demás sesiones. Probar la contraseña actual
  // cuenta como un intento más (RF-003): con un teléfono ajeno abierto no se puede adivinar a la larga.
  app.post('/auth/cambiar-password', { preHandler: requiereSesionAunConPasswordPendiente, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyCambio.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe tu contraseña actual y la nueva' })
    const { actual, nueva } = body.data
    const { rows: [u] } = await db.query(`SELECT correo, password_hash, password_cambiado_en FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
    const regla = revisarPassword(nueva, u.correo)
    if (regla) return rep.code(400).send({ error: regla })
    if (actual === nueva) return rep.code(400).send({ error: 'La contraseña nueva debe ser distinta a la actual' })
    const intento = await registrarIntento(db, config, { correo: u.correo, ip: ipCliente(req, config), idUsuario: req.usuario.id, passwordCambiadoEn: u.password_cambiado_en })
    if (!intento) return bloqueado(rep, config)
    if (!(await verificarPassword(config, u.password_hash, actual)).ok) return rep.code(401).send({ error: 'La contraseña actual no es correcta' })
    await intento.bueno()
    await db.query(`UPDATE usuarios SET password_hash = $2, debe_cambiar_password = false, password_cambiado_en = now() WHERE id_usuario = $1`, [
      req.usuario.id,
      await hashPassword(config, nueva),
    ])
    await db.query(`UPDATE sesiones SET revocado_en = now() WHERE id_usuario = $1 AND id_sesion <> $2 AND revocado_en IS NULL`, [req.usuario.id, req.usuario.sid])
    // Las otras sesiones ya no reciben avisos; este teléfono vuelve a suscribirse solo al abrir la app (src/lib/push.ts).
    await db.query(`DELETE FROM suscripciones_push WHERE id_usuario = $1`, [req.usuario.id])
    return rep.code(204).send()
  })
}
