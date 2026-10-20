import { hash, verify } from '@node-rs/argon2'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { sha256, tokenAleatorio } from './seguridad.js'

// Argon2id (RF-004). Parámetros OWASP: 64 MiB, 3 pasadas.
const PARAMS = { memoryCost: 65536, timeCost: 3, parallelism: 4 }
export const hashPassword = (p: string) => hash(p, PARAMS)

// Hash de relleno: verificar contra algo cuando el correo no existe, para que la respuesta tarde igual.
const HASH_RELLENO = await hashPassword('relleno-' + tokenAleatorio())

const bodyLogin = z.object({
  correo: z.string().trim().min(3).max(150),
  password: z.string().min(1).max(200),
  dispositivo: z.string().max(200).optional(),
})
const bodyRefresh = z.object({ refreshToken: z.string().min(20).max(200) })
const bodyCambio = z.object({ actual: z.string().min(1).max(200), nueva: z.string().min(8).max(200) })

const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos'

export function passwordValida(p: string) {
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p)
}

async function verificar(hashGuardado: string, password: string) {
  try {
    return await verify(hashGuardado, password)
  } catch {
    return false
  }
}

export async function rutasAuth(
  app: FastifyInstance,
  { db, config }: Contexto,
  { requiereSesionAunConPasswordPendiente }: { requiereSesionAunConPasswordPendiente: (req: FastifyRequest, rep: FastifyReply) => Promise<unknown> },
) {
  function respuestaSesion(u: { id_usuario: string; nombre: string; correo: string; rol: string; debe_cambiar_password: boolean }, sid: string, refreshToken: string) {
    const accessToken = app.jwt.sign({ sub: u.id_usuario, sid })
    return {
      accessToken,
      expiraEn: Date.now() + config.accesoMinutos * 60_000,
      refreshToken,
      usuario: { id: u.id_usuario, nombre: u.nombre, correo: u.correo, rol: u.rol, debeCambiarPassword: u.debe_cambiar_password },
    }
  }

  // RF-001 / RF-003 / RF-004
  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyLogin.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Faltan el correo o la contraseña' })
    const { correo, password, dispositivo } = body.data

    const { rows } = await db.query(
      `SELECT id_usuario, nombre, correo, rol, password_hash, activo, debe_cambiar_password, bloqueado_hasta
         FROM usuarios WHERE lower(correo) = lower($1)`,
      [correo],
    )
    const u = rows[0]
    const registrar = (exitoso: boolean) =>
      db.query(`INSERT INTO intentos_login (correo, id_usuario, exitoso, ip) VALUES ($1, $2, $3, $4)`, [correo.slice(0, 150), u?.id_usuario ?? null, exitoso, req.ip])

    if (!u) {
      await verificar(HASH_RELLENO, password)
      await registrar(false)
      return rep.code(401).send({ error: MENSAJE_CREDENCIALES })
    }
    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      await registrar(false)
      return rep.code(423).send({ error: 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.', codigo: 'BLOQUEADA', hasta: u.bloqueado_hasta })
    }

    const claveCorrecta = await verificar(u.password_hash, password) // se verifica siempre, para que la respuesta tarde igual
    // RF-040: con la contraseña correcta se le dice por qué no entra (sin contarlo como intento fallido).
    if (claveCorrecta && !u.activo) {
      await registrar(false)
      return rep.code(403).send({ error: 'Tu cuenta está dada de baja. Habla con el administrador.', codigo: 'CUENTA_SUSPENDIDA' })
    }
    const ok = u.activo && claveCorrecta
    if (!ok) {
      await registrar(false)
      // Atómico: cuenta el intento y bloquea al llegar al límite.
      await db.query(
        `UPDATE usuarios
            SET intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0 ELSE intentos_fallidos + 1 END,
                bloqueado_hasta   = CASE WHEN intentos_fallidos + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE bloqueado_hasta END
          WHERE id_usuario = $1`,
        [u.id_usuario, config.maxIntentos, config.bloqueoMinutos],
      )
      return rep.code(401).send({ error: MENSAJE_CREDENCIALES })
    }

    await registrar(true)
    await db.query(`UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id_usuario = $1`, [u.id_usuario])
    const refresh = tokenAleatorio()
    const { rows: s } = await db.query(
      `INSERT INTO sesiones (id_usuario, refresh_token_hash, dispositivo, ip, expira_en)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id_sesion`,
      [u.id_usuario, sha256(refresh), dispositivo ?? null, req.ip, config.sesionDias],
    )
    return respuestaSesion(u, s[0].id_sesion, refresh)
  })

  // Renueva el token de acceso. El refresh token no rota: en zonas sin señal una respuesta perdida
  // dejaría al repartidor fuera; se revoca al cerrar sesión o al cambiar la contraseña.
  app.post('/auth/refresh', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyRefresh.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Falta el token de sesión' })
    const refresh = body.data.refreshToken
    const { rows } = await db.query(
      `SELECT s.id_sesion, u.id_usuario, u.nombre, u.correo, u.rol, u.debe_cambiar_password
         FROM sesiones s JOIN usuarios u USING (id_usuario)
        WHERE s.refresh_token_hash = $1 AND s.revocado_en IS NULL AND s.expira_en > now() AND u.activo`,
      [sha256(refresh)],
    )
    if (!rows[0]) return rep.code(401).send({ error: 'Sesión vencida, inicia sesión de nuevo', codigo: 'SESION_INVALIDA' })
    return respuestaSesion(rows[0], rows[0].id_sesion, refresh)
  })

  // RF-006: revoca la sesión de este dispositivo. Siempre 204, para poder reintentar.
  app.post('/auth/logout', async (req, rep) => {
    const body = bodyRefresh.safeParse(req.body)
    if (body.success) {
      await db.query(`UPDATE sesiones SET revocado_en = now() WHERE refresh_token_hash = $1 AND revocado_en IS NULL`, [sha256(body.data.refreshToken)])
    }
    return rep.code(204).send()
  })

  app.get('/me', { preHandler: requiereSesionAunConPasswordPendiente }, async (req) => {
    const { rows } = await db.query(`SELECT id_usuario, nombre, correo, rol, debe_cambiar_password FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
    const u = rows[0]
    return { id: u.id_usuario, nombre: u.nombre, correo: u.correo, rol: u.rol, debeCambiarPassword: u.debe_cambiar_password }
  })

  // RF-039: quita la marca de "debe cambiar la contraseña". Cierra las demás sesiones.
  app.post('/auth/cambiar-password', { preHandler: requiereSesionAunConPasswordPendiente, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyCambio.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'La contraseña nueva debe tener al menos 8 caracteres' })
    const { actual, nueva } = body.data
    if (!passwordValida(nueva)) return rep.code(400).send({ error: 'La contraseña nueva debe tener letras y números' })
    if (actual === nueva) return rep.code(400).send({ error: 'La contraseña nueva debe ser distinta a la actual' })
    const { rows } = await db.query(`SELECT password_hash FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
    if (!(await verificar(rows[0].password_hash, actual))) return rep.code(401).send({ error: 'La contraseña actual no es correcta' })
    await db.query(`UPDATE usuarios SET password_hash = $2, debe_cambiar_password = false WHERE id_usuario = $1`, [req.usuario.id, await hashPassword(nueva)])
    await db.query(`UPDATE sesiones SET revocado_en = now() WHERE id_usuario = $1 AND id_sesion <> $2 AND revocado_en IS NULL`, [req.usuario.id, req.usuario.sid])
    return rep.code(204).send()
  })
}
