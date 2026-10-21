import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { hashPassword, revisarPassword } from './contrasenas.js'
import { correoCodigo, enviarCorreo } from './correo.js'
import { tx } from './db.js'
import { ipCliente } from './seguridad.js'

// RF-002: recuperación de contraseña con un código de 6 dígitos enviado por correo.
// - /auth/recuperar responde siempre lo mismo y tarda siempre lo mismo: no revela si el correo existe, ni si se mandó.
// - Como mucho 3 códigos por cuenta cada hora y 6 al día, y 10 por conexión cada hora; pasado el tope no se manda otro,
//   sin decirlo. Así, adivinar un código (5 intentos por código) queda en 30 intentos al día por cuenta.
// - Sólo se guarda un HMAC del código (con AUTH_PEPPER_SECRET, que no vive en la base): un respaldo filtrado de la base
//   no basta para usarlo.
// - Vence en 15 min; tras 5 códigos incorrectos se invalida. Pedir uno nuevo invalida el anterior.
// - Al restablecer: contraseña nueva (Argon2id con pepper), cuenta desbloqueada y todas sus sesiones cerradas.

const bodyRecuperar = z.object({ correo: z.string().trim().min(3).max(150) })
const bodyRestablecer = z.object({
  correo: z.string().trim().min(3).max(150),
  codigo: z.string().trim().regex(/^\d{6}$/),
  nueva: z.string().max(1000),
})

const MENSAJE_CODIGO = 'El código es incorrecto o ya venció. Pide uno nuevo.'
const esperarHasta = (t: number) => new Promise((r) => setTimeout(r, Math.max(0, t - Date.now())))

export async function rutasRecuperacion(app: FastifyInstance, { db, config }: Contexto) {
  const hmac = (codigo: string) => createHmac('sha256', config.pimienta).update(`recuperacion:${codigo}`).digest('hex')
  const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

  // Manda un código a la cuenta activa con ese correo, si la hay y no pasó del tope.
  async function mandarCodigo(correo: string, ip: string, log: FastifyBaseLogger) {
    const { rows } = await db.query(`SELECT id_usuario, nombre, correo FROM usuarios WHERE lower(correo) = lower($1) AND activo`, [correo])
    const u = rows[0]
    if (!u) return
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const nuevo = await tx(db, null, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('recuperar:' || $1))`, [u.id_usuario])
      const { rows: [n] } = await c.query(
        `SELECT count(*) FILTER (WHERE id_usuario = $1 AND creado_en > now() - interval '1 hour')::int AS cuenta,
                count(*) FILTER (WHERE id_usuario = $1)::int AS cuenta_dia,
                count(*) FILTER (WHERE ip = $2 AND creado_en > now() - interval '1 hour')::int AS ip
           FROM recuperaciones_password WHERE creado_en > now() - interval '1 day' AND (id_usuario = $1 OR ip = $2)`,
        [u.id_usuario, ip],
      )
      if (n.cuenta >= config.recuperacionPorHoraCuenta || n.cuenta_dia >= config.recuperacionPorDiaCuenta || n.ip >= config.recuperacionPorHoraIp) return false
      await c.query(`UPDATE recuperaciones_password SET usado_en = now() WHERE id_usuario = $1 AND usado_en IS NULL`, [u.id_usuario])
      await c.query(
        `INSERT INTO recuperaciones_password (id_usuario, codigo_hash, expira_en, ip) VALUES ($1, $2, now() + make_interval(mins => $3), $4)`,
        [u.id_usuario, hmac(codigo), config.recuperacionMinutos, ip],
      )
      return true
    })
    if (!nuevo) return log.warn({ ip }, 'recuperación: tope de códigos alcanzado, no se manda otro')
    await enviarCorreo(config, { para: u.correo, ...correoCodigo(u.nombre, codigo, config.recuperacionMinutos) }, log)
  }

  app.post('/auth/recuperar', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const body = bodyRecuperar.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe tu correo' })
    const listo = Date.now() + config.recuperacionPisoMs
    try {
      await mandarCodigo(body.data.correo, ipCliente(req, config), req.log)
    } catch (e) {
      // Un error tampoco cambia la respuesta: decir «no se pudo enviar» revelaría que la cuenta existe.
      req.log.error(e, 'no se pudo preparar o enviar el correo de recuperación')
    }
    await esperarHasta(listo)
    return { ok: true, minutos: config.recuperacionMinutos }
  })

  app.post('/auth/restablecer', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (req, rep) => {
    const body = bodyRestablecer.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe el código de 6 dígitos y tu contraseña nueva' })
    const { correo, codigo, nueva } = body.data
    const regla = revisarPassword(nueva, correo)
    if (regla) return rep.code(400).send({ error: regla })

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

    const hash = await hashPassword(config, nueva)
    const aplicado = await tx(db, r.id_usuario, async (c) => {
      // Marca el código como usado sólo si nadie lo usó mientras tanto (dos envíos a la vez).
      const usado = await c.query(`UPDATE recuperaciones_password SET usado_en = now() WHERE id_recuperacion = $1 AND usado_en IS NULL`, [r.id_recuperacion])
      if (usado.rowCount !== 1) return false
      // password_cambiado_en también deja sin efecto los intentos fallidos de antes (RF-003).
      await c.query(`UPDATE usuarios SET password_hash = $2, debe_cambiar_password = false, password_cambiado_en = now() WHERE id_usuario = $1`, [r.id_usuario, hash])
      await c.query(`UPDATE sesiones SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL`, [r.id_usuario])
      // Los avisos (con nombres de clientes) dejan de llegar a los navegadores que tenían la cuenta abierta.
      await c.query(`DELETE FROM suscripciones_push WHERE id_usuario = $1`, [r.id_usuario])
      return true
    })
    if (!aplicado) return rep.code(400).send({ error: MENSAJE_CODIGO, codigo: 'CODIGO_INVALIDO' })
    return rep.code(204).send()
  })
}
