import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import type { Config } from './config.js'
import { hashPassword, revisarPassword } from './contrasenas.js'
import { tx, type Cx } from './db.js'
import { passwordTemporal } from './seguridad.js'

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

// Los cambios que podrían dejar al sistema sin administrador activo se hacen de uno en uno.
const CERRADURA_ADMINS = 7001

const idUsuario = z.object({ id: z.uuid() })
const correo = z.string().trim().max(150).pipe(z.email())
const telefono = z.string().trim().max(20)
const rol = z.enum(['vendedor', 'administrador'])

const bodyCrear = z.object({
  nombre: z.string().trim().min(2).max(100),
  correo,
  telefono: telefono.optional(),
  rol: rol.default('vendedor'),
  password: z.string().max(1000).optional(), // si falta, el servidor genera una temporal
})
const bodyEditar = z
  .object({ nombre: z.string().trim().min(2).max(100), correo, telefono, rol })
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nada que cambiar')
const bodyPassword = z.object({ password: z.string().max(1000).optional() })

const revisa = (e: z.ZodError) => 'Revisa estos datos: ' + [...new Set(e.issues.map((i) => String(i.path[0] ?? 'datos')))].join(', ')

// RF-003: hasta cuándo está bloqueada la cuenta desde alguna conexión (la misma cuenta que hace auth.ts al entrar):
// los fallidos de cada IP después de su último acceso bueno y del último cambio de contraseña, dentro de la ventana.
const bloqueo = (config: Config) => {
  const max = Math.trunc(config.maxIntentos)
  const ventana = `make_interval(mins => ${Math.trunc(config.bloqueoMinutos)})`
  return `(SELECT max(b.hasta) FROM (
      SELECT (array_agg(i.creado_en ORDER BY i.creado_en DESC))[${max}] + ${ventana} AS hasta
        FROM intentos_login i
       WHERE lower(i.correo) = lower(u.correo) AND NOT i.exitoso AND i.creado_en > greatest(now() - ${ventana}, u.password_cambiado_en)
         AND NOT EXISTS (SELECT 1 FROM intentos_login e WHERE e.exitoso AND lower(e.correo) = lower(u.correo)
                           AND e.ip IS NOT DISTINCT FROM i.ip AND e.creado_en > i.creado_en)
       GROUP BY i.ip HAVING count(*) >= ${max}) b) AS bloqueado_hasta`
}
const columnas = (config: Config) => `u.id_usuario, u.nombre, u.correo, u.telefono, u.rol, u.activo, u.debe_cambiar_password, u.ultimo_acceso, u.creado_en,
  ${bloqueo(config)},
  (SELECT count(*)::int FROM clientes c WHERE c.id_vendedor = u.id_usuario) AS clientes,
  (SELECT count(*)::int FROM clientes c WHERE c.id_vendedor = u.id_usuario AND c.activo) AS clientes_activos`

function wire(r: any) {
  const bloqueada = r.bloqueado_hasta && new Date(r.bloqueado_hasta) > new Date()
  return {
    id: r.id_usuario as string, nombre: r.nombre as string, correo: r.correo as string, telefono: (r.telefono ?? '') as string,
    rol: r.rol as 'administrador' | 'vendedor', activo: r.activo as boolean, debeCambiarPassword: r.debe_cambiar_password as boolean,
    bloqueadoHasta: bloqueada ? new Date(r.bloqueado_hasta).toISOString() : null,
    ultimoAcceso: r.ultimo_acceso ? new Date(r.ultimo_acceso).toISOString() : null,
    creadoEn: new Date(r.creado_en).toISOString(),
    clientes: r.clientes as number, clientesActivos: r.clientes_activos as number,
  }
}
const otroAdminActivo = async (c: Cx, excepto: string) =>
  (await c.query(`SELECT 1 FROM usuarios WHERE rol = 'administrador' AND activo AND id_usuario <> $1 LIMIT 1`, [excepto])).rows.length > 0
// Sin sesiones tampoco quedan teléfonos suscritos a sus avisos (RF-054): un teléfono que ya no es suyo no debe seguir recibiéndolos.
async function cerrarSesiones(c: Cx, id: string) {
  await c.query(`UPDATE sesiones SET revocado_en = now() WHERE id_usuario = $1 AND revocado_en IS NULL`, [id])
  await c.query(`DELETE FROM suscripciones_push WHERE id_usuario = $1`, [id])
}

type Falla = { status: number; error: string; codigo?: string }
const falla = (status: number, error: string, codigo?: string): Falla => ({ status, error, codigo })
const esFalla = (r: unknown): r is Falla => !!r && typeof r === 'object' && 'status' in r

// RF-038 a RF-040: altas, cambios y bajas de cuentas. Sólo el administrador.
export async function rutasUsuarios(app: FastifyInstance, { db, config }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }) {
  const pre = { preHandler: requiereAdmin }
  const COLUMNAS = columnas(config)
  const leer = async (c: Cx, id: string) => (await c.query(`SELECT ${COLUMNAS} FROM usuarios u WHERE u.id_usuario = $1`, [id])).rows[0]

  app.get('/usuarios', pre, async () => {
    const { rows } = await db.query(`SELECT ${COLUMNAS} FROM usuarios u ORDER BY u.activo DESC, (u.rol = 'administrador') DESC, lower(u.nombre)`)
    const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM clientes WHERE id_vendedor IS NULL`)
    return { usuarios: rows.map(wire), clientesSinAsignar: n as number }
  })

  // RF-038: alta con contraseña temporal; la persona la cambia al entrar.
  app.post('/usuarios', pre, async (req, rep) => {
    const b = bodyCrear.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: revisa(b.error) })
    const regla = b.data.password === undefined ? null : revisarPassword(b.data.password, b.data.correo)
    if (regla) return rep.code(400).send({ error: regla })
    const temporal = b.data.password ?? passwordTemporal()
    const hash = await hashPassword(config, temporal)
    try {
      const u = await tx(db, req.usuario.id, async (c) => {
        const { rows } = await c.query(
          `INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol, debe_cambiar_password) VALUES ($1, $2, $3, $4, $5, true) RETURNING id_usuario`,
          [b.data.nombre, b.data.correo, b.data.telefono || null, hash, b.data.rol],
        )
        return leer(c, rows[0].id_usuario)
      })
      return rep.code(201).send({ usuario: wire(u), ...(b.data.password ? {} : { passwordTemporal: temporal }) })
    } catch (e: any) {
      if (e.code === '23505') return rep.code(409).send({ error: 'Ya hay una cuenta con ese correo', codigo: 'CORREO_REPETIDO' })
      throw e
    }
  })

  // RF-039: datos de contacto y rol.
  app.patch('/usuarios/:id', pre, async (req, rep) => {
    const p = idUsuario.safeParse(req.params)
    const b = bodyEditar.safeParse(req.body)
    if (!p.success) return rep.code(404).send({ error: 'Esa cuenta no existe' })
    if (!b.success) return rep.code(400).send({ error: revisa(b.error) })
    try {
      const r = await tx(db, req.usuario.id, async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock($1)`, [CERRADURA_ADMINS])
        const { rows: [u] } = await c.query(`SELECT id_usuario, rol, activo FROM usuarios WHERE id_usuario = $1 FOR UPDATE`, [p.data.id])
        if (!u) return falla(404, 'Esa cuenta no existe')
        if (b.data.rol && b.data.rol !== u.rol) {
          if (u.id_usuario === req.usuario.id) return falla(400, 'No puedes cambiar tu propio rol')
          if (u.rol === 'administrador' && u.activo && !(await otroAdminActivo(c, u.id_usuario))) return falla(409, 'Debe quedar al menos un administrador activo', 'ULTIMO_ADMIN')
        }
        await c.query(
          `UPDATE usuarios SET nombre = COALESCE($2, nombre), correo = COALESCE($3, correo),
                  telefono = CASE WHEN $4::boolean THEN NULLIF($5, '') ELSE telefono END, rol = COALESCE($6::rol_usuario, rol)
            WHERE id_usuario = $1`,
          [p.data.id, b.data.nombre ?? null, b.data.correo ?? null, b.data.telefono !== undefined, b.data.telefono ?? null, b.data.rol ?? null],
        )
        return { usuario: wire(await leer(c, p.data.id)) }
      })
      if (esFalla(r)) return rep.code(r.status).send({ error: r.error, codigo: r.codigo })
      return r
    } catch (e: any) {
      if (e.code === '23505') return rep.code(409).send({ error: 'Ya hay una cuenta con ese correo', codigo: 'CORREO_REPETIDO' })
      throw e
    }
  })

  // RF-039: restablecimiento manual. Cierra todas sus sesiones y le exige elegir contraseña propia al entrar.
  app.post('/usuarios/:id/password', pre, async (req, rep) => {
    const p = idUsuario.safeParse(req.params)
    const b = bodyPassword.safeParse(req.body ?? {})
    if (!p.success) return rep.code(404).send({ error: 'Esa cuenta no existe' })
    if (!b.success) return rep.code(400).send({ error: revisa(b.error) })
    if (p.data.id === req.usuario.id) return rep.code(400).send({ error: 'Tu propia contraseña se cambia en Cuenta' })
    if (b.data.password !== undefined) {
      const { rows: [u] } = await db.query(`SELECT correo FROM usuarios WHERE id_usuario = $1`, [p.data.id])
      if (!u) return rep.code(404).send({ error: 'Esa cuenta no existe' })
      const regla = revisarPassword(b.data.password, u.correo)
      if (regla) return rep.code(400).send({ error: regla })
    }
    const temporal = b.data.password ?? passwordTemporal()
    const hash = await hashPassword(config, temporal)
    const r = await tx(db, req.usuario.id, async (c) => {
      // password_cambiado_en también la desbloquea: los intentos fallidos de antes dejan de contar (RF-003).
      const { rowCount } = await c.query(
        `UPDATE usuarios SET password_hash = $2, debe_cambiar_password = true, password_cambiado_en = now() WHERE id_usuario = $1`,
        [p.data.id, hash],
      )
      if (!rowCount) return falla(404, 'Esa cuenta no existe')
      await cerrarSesiones(c, p.data.id)
      return { ok: true }
    })
    if (esFalla(r)) return rep.code(r.status).send({ error: r.error })
    return b.data.password ? { ok: true } : { passwordTemporal: temporal }
  })

  // RF-040: la baja corta el acceso al instante: el token se valida contra la base en cada petición.
  async function cambiarActivo(req: FastifyRequest, rep: FastifyReply, activo: boolean) {
    const p = idUsuario.safeParse(req.params)
    if (!p.success) return rep.code(404).send({ error: 'Esa cuenta no existe' })
    if (!activo && p.data.id === req.usuario.id) return rep.code(400).send({ error: 'No puedes dar de baja tu propia cuenta' })
    const r = await tx(db, req.usuario.id, async (c) => {
      await c.query(`SELECT pg_advisory_xact_lock($1)`, [CERRADURA_ADMINS])
      const { rows: [u] } = await c.query(`SELECT id_usuario, rol, activo FROM usuarios WHERE id_usuario = $1 FOR UPDATE`, [p.data.id])
      if (!u) return falla(404, 'Esa cuenta no existe')
      if (!activo && u.activo && u.rol === 'administrador' && !(await otroAdminActivo(c, u.id_usuario))) return falla(409, 'Debe quedar al menos un administrador activo', 'ULTIMO_ADMIN')
      await c.query(`UPDATE usuarios SET activo = $2 WHERE id_usuario = $1`, [p.data.id, activo])
      if (!activo) await cerrarSesiones(c, p.data.id)
      return { usuario: wire(await leer(c, p.data.id)) }
    })
    if (esFalla(r)) return rep.code(r.status).send({ error: r.error, codigo: r.codigo })
    return r
  }
  app.post('/usuarios/:id/baja', pre, (req, rep) => cambiarActivo(req, rep, false))
  app.post('/usuarios/:id/reactivar', pre, (req, rep) => cambiarActivo(req, rep, true))
}
