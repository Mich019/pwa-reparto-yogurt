import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { hashPassword, passwordValida } from './auth.js'
import { correoCodigo, enviarCorreo } from './correo.js'
import { tx } from './db.js'

// RF-002: recuperación de contraseña con un código de 6 dígitos enviado por correo.
// - La respuesta de /auth/recuperar es siempre la misma: no revela si el correo existe.
// - Sólo se guarda un HMAC del código (con JWT_SECRET): un respaldo filtrado de la base no basta para usarlo.
// - Vence en 15 min; tras 5 códigos incorrectos se invalida. Pedir uno nuevo invalida el anterior.
// - Al restablecer: contraseña nueva (Argon2id), quita bloqueo e intentos y cierra todas las sesiones.

const bodyRecuperar = z.object({ correo: z.string().trim().min(3).max(150) })
const bodyRestablecer = z.object({
  correo: z.string().trim().min(3).max(150),
  codigo: z.string().trim().regex(/^\d{6}$/),
  nueva: z.string().min(8).max(200),
})

const MENSAJE_CODIGO = 'El código es incorrecto o ya venció. Pide uno nuevo.'

export async function rutasRecuperacion(app: FastifyInstance, { db, config }: Contexto) {
  const hmac = (codigo: string) => createHmac('sha256', config.jwtSecret).update(`recuperacion:${codigo}`).digest('hex')
  const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

  app.post('/auth/recuperar', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const body = bodyRecuperar.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe tu correo' })
    const respuesta = { ok: true, minutos: config.recuperacionMinutos }

    const { rows } = await db.query(`SELECT id_usuario, nombre, correo FROM usuarios WHERE lower(correo) = lower($1) AND activo`, [body.data.correo])
    const u = rows[0]
    if (!u) return respuesta

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await tx(db, null, async (c) => {
      await c.query(`UPDATE recuperaciones_password SET usado_en = now() WHERE id_usuario = $1 AND usado_en IS NULL`, [u.id_usuario])
      await c.query(
        `INSERT INTO recuperaciones_password (id_usuario, codigo_hash, expira_en) VALUES ($1, $2, now() + make_interval(mins => $3))`,
        [u.id_usuario, hmac(codigo), config.recuperacionMinutos],
      )
    })
    try {
      await enviarCorreo(config, { para: u.correo, ...correoCodigo(u.nombre, codigo, config.recuperacionMinutos) }, req.log)
    } catch (e) {
      req.log.error(e, 'no se pudo enviar el correo de recuperación')
      return rep.code(502).send({ error: 'No pudimos enviar el correo. Intenta de nuevo en unos minutos.' })
    }
    return respuesta
  })

  app.post('/auth/restablecer', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const body = bodyRestablecer.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe el código de 6 dígitos y una contraseña de al menos 8 caracteres' })
    const { correo, codigo, nueva } = body.data
    if (!passwordValida(nueva)) return rep.code(400).send({ error: 'La contraseña debe tener letras y números' })

    const { rows } = await db.query(
      `SELECT r.id_recuperacion, r.codigo_hash, r.intentos, u.id_usuario
         FROM recuperaciones_password r JOIN usuarios u USING (id_usuario)
        WHERE lower(u.correo) = lower($1) AND u.activo AND r.usado_en IS NULL AND r.expira_en > now()
        ORDER BY r.creado_en DESC LIMIT 1`,
      [correo],
    )
    const r = rows[0]
    if (!r) return rep.code(400).send({ error: MENSAJE_CODIGO, codigo: 'CODIGO_INVALIDO' })

    if (!iguales(r.codigo_hash, hmac(codigo))) {
      await db.query(
        `UPDATE recuperaciones_password
            SET intentos = intentos + 1,
                usado_en = CASE WHEN intentos + 1 >= $2 THEN now() ELSE usado_en END
          WHERE id_recuperacion = $1`,
        [r.id_recuperacion, config.recuperacionMaxIntentos],
      )
      return rep.code(400).send({ error: MENSAJE_CODIGO, codigo: 'CODIGO_INVALIDO' })
    }

    const hash = await hashPassword(nueva)
    const aplicado = await tx(db, r.id_usuario, async (c) => {
      // Marca el código como usado sólo si nadie lo usó mientras tanto (dos envíos a la vez).
      const usado = await c.query(`UPDATE recuperaciones_password SET usado_en = now() WHERE id_recuperacion = $1 AND usado_en IS NULL`, [r.id_recuperacion])
      if (usado.rowCount !== 1) return false
      await c.query(
        `UPDATE usuarios SET password_hash = $2, debe_cambiar_password = false, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id_usuario = $1`,
        [r.id_usuario, hash],
      )
      await c.query(`UPDATE sesiones SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL`, [r.id_usuario])
      return true
    })
    if (!aplicado) return rep.code(400).send({ error: MENSAJE_CODIGO, codigo: 'CODIGO_INVALIDO' })
    return rep.code(204).send()
  })
}
