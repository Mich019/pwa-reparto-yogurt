import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Config } from './config.js'
import { hashPassword } from './contrasenas.js'
import type { Db } from './db.js'
import { passwordTemporal } from './seguridad.js'
import { CON_ACCESO } from './suscripcion.js'

// Panel de la plataforma (Fase 7): quienes administran el servicio ven todas las empresas, su estado de pago y su uso,
// y pueden suspenderlas o reactivarlas. Entra sólo una cuenta marcada en la base (es_plataforma) que viva en la empresa
// interna «Plataforma» y tenga activa la verificación en dos pasos. El correo nunca da el permiso: un administrador de
// empresa puede poner a una cuenta el correo que quiera. Y en la empresa interna nadie de un negocio la ve ni la toca
// (reglas por empresa). La primera cuenta se da de alta por consola: npm run db:plataforma. Estas rutas cruzan empresas: usan la conexión del dueño de la base (`db` sin
// envolver, ver app.ts), no la de la empresa de quien llama.

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

// Administra la plataforma: marcada en la base y en la empresa interna (las dos cosas, para que una marca puesta por
// error en una cuenta de un negocio no dé el permiso).
export const esPlataforma = (u: { es_plataforma?: boolean; interna?: boolean }) => !!u.es_plataforma && !!u.interna
const idEmpresa = z.object({ id: z.uuid() })
const bodyActiva = z.object({ activa: z.boolean() })
const bodyCuenta = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre').max(100),
  correo: z.string().trim().toLowerCase().max(150).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Escribe un correo válido'),
})

export async function rutasPlataforma(app: FastifyInstance, { db, config }: { db: Db; config: Config }, { requiereSesionSinCobro }: { requiereSesionSinCobro: Guardia }) {
  async function requierePlataforma(req: FastifyRequest, rep: FastifyReply) {
    await requiereSesionSinCobro(req, rep)
    if (rep.sent) return
    const { rows: [u] } = await db.query(
      `SELECT u.es_plataforma, e.interna, d.activado_en IS NOT NULL AS dos_pasos
         FROM usuarios u JOIN empresas e USING (id_empresa) LEFT JOIN dos_pasos d USING (id_usuario) WHERE u.id_usuario = $1`,
      [req.usuario.id],
    )
    if (!u || !esPlataforma(u)) return rep.code(403).send({ error: 'Sólo para quienes administran la plataforma', codigo: 'SIN_PERMISO' })
    if (!u.dos_pasos) {
      return rep.code(403).send({ error: 'Activa la verificación en dos pasos (Configuración → Seguridad) para entrar al panel de la plataforma.', codigo: 'DOS_PASOS_REQUERIDOS' })
    }
  }

  app.get('/plataforma/empresas', { preHandler: requierePlataforma }, async () => {
    const { rows } = await db.query(
      `SELECT e.id_empresa, e.nombre, e.creado_en, e.activa, e.exenta, e.prueba_hasta, e.suscripcion_estado, ${CON_ACCESO} AS con_acceso,
              (SELECT u.correo FROM usuarios u WHERE u.id_empresa = e.id_empresa AND u.rol = 'administrador' AND u.activo ORDER BY u.creado_en LIMIT 1) AS contacto,
              (SELECT count(*) FROM usuarios u WHERE u.id_empresa = e.id_empresa AND u.activo)::int AS usuarios,
              (SELECT count(*) FROM clientes c WHERE c.id_empresa = e.id_empresa AND c.activo)::int AS clientes,
              (SELECT count(*) FROM pedidos p WHERE p.id_empresa = e.id_empresa AND p.estado = 'entregado' AND p.fecha >= current_date - 30)::int AS pedidos_30,
              (SELECT max(p.fecha) FROM pedidos p WHERE p.id_empresa = e.id_empresa AND p.estado = 'entregado') AS ultimo_pedido
         FROM empresas e WHERE NOT e.interna ORDER BY e.creado_en DESC`,
    )
    const empresas = rows.map((e) => ({
      id: e.id_empresa as string,
      nombre: e.nombre as string,
      alta: e.creado_en as Date,
      contacto: (e.contacto as string | null) ?? null,
      // Lo que la empresa vive hoy: suspendida por ustedes, exenta, pagando, en prueba o sin acceso (vencida/cancelada).
      estado: !e.activa ? 'suspendida' : e.exenta ? 'exenta' : e.suscripcion_estado === 'authorized' ? 'activa' : e.con_acceso ? 'prueba'
        : e.suscripcion_estado === 'cancelled' ? 'cancelada' : 'vencida',
      pruebaHasta: e.prueba_hasta as Date,
      suscripcion: (e.suscripcion_estado as string | null) ?? null,
      usuarios: e.usuarios as number,
      clientes: e.clientes as number,
      pedidos30: e.pedidos_30 as number,
      ultimoPedido: (e.ultimo_pedido as string | null) ?? null,
    }))
    const cuenta = (estado: string) => empresas.filter((e) => e.estado === estado).length
    // Quienes administran la plataforma.
    const { rows: gente } = await db.query(
      `SELECT u.nombre, u.correo, u.activo, d.activado_en IS NOT NULL AS dos_pasos
         FROM usuarios u JOIN empresas e USING (id_empresa) LEFT JOIN dos_pasos d USING (id_usuario)
        WHERE u.es_plataforma AND e.interna ORDER BY u.creado_en`,
    )
    return {
      cuentas: gente.map((g) => ({ nombre: g.nombre as string, correo: g.correo as string, activo: g.activo as boolean, dosPasos: g.dos_pasos as boolean })),
      resumen: {
        total: empresas.length,
        prueba: cuenta('prueba'),
        activas: cuenta('activa'),
        vencidas: cuenta('vencida'),
        canceladas: cuenta('cancelada'),
        exentas: cuenta('exenta'),
        suspendidas: cuenta('suspendida'),
        ingresoMensual: cuenta('activa') * config.mercadoPago.precioMensual,
        moneda: config.mercadoPago.moneda,
      },
      empresas,
    }
  })

  // Suspender corta el acceso de todos en esa empresa en su siguiente petición (app.ts revisa empresas.activa); no se
  // borra nada. La propia empresa no se suspende: dejaría fuera a quien la administra.
  app.post('/plataforma/empresas/:id/activa', { preHandler: requierePlataforma }, async (req, rep) => {
    const p = idEmpresa.safeParse(req.params)
    const b = bodyActiva.safeParse(req.body)
    if (!p.success) return rep.code(404).send({ error: 'Esa empresa no existe' })
    if (!b.success) return rep.code(400).send({ error: 'Indica si la empresa queda activa' })
    if (p.data.id === req.usuario.empresa && !b.data.activa) return rep.code(409).send({ error: 'No puedes suspender tu propia empresa', codigo: 'PROPIA_EMPRESA' })
    const r = await db.query(`UPDATE empresas SET activa = $2, actualizado_en = now() WHERE id_empresa = $1`, [p.data.id, b.data.activa])
    if (!r.rowCount) return rep.code(404).send({ error: 'Esa empresa no existe' })
    req.log.info({ empresa: p.data.id, activa: b.data.activa, por: req.usuario.id }, 'plataforma: cambio de estado de una empresa')
    return { ok: true, activa: b.data.activa }
  })

  // Una cuenta nueva de super admin. Vive en la empresa interna «Plataforma» (se crea la primera vez): así no administra
  // ningún negocio ni ve sus datos. Entra con contraseña temporal y, para el panel, activa la verificación en dos pasos.
  app.post('/plataforma/cuentas', { preHandler: requierePlataforma, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyCuenta.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const temporal = passwordTemporal()
    const hash = await hashPassword(config, temporal)
    const c = await db.connect()
    try {
      await c.query('BEGIN')
      // Dos altas a la vez no crean dos empresas internas.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('empresa-interna'))`)
      let { rows: [e] } = await c.query(`SELECT id_empresa FROM empresas WHERE interna ORDER BY creado_en LIMIT 1`)
      if (!e) e = (await c.query(`INSERT INTO empresas (nombre, interna, exenta) VALUES ('Plataforma', true, true) RETURNING id_empresa`)).rows[0]
      const { rows: [u] } = await c.query(
        `INSERT INTO usuarios (id_empresa, nombre, correo, password_hash, rol, debe_cambiar_password, es_plataforma)
         VALUES ($1, $2, $3, $4, 'administrador', true, true) ON CONFLICT (lower(correo)) DO NOTHING RETURNING id_usuario`,
        [e.id_empresa, b.data.nombre, b.data.correo, hash],
      )
      if (!u) {
        await c.query('ROLLBACK')
        return rep.code(409).send({ error: 'Ya hay una cuenta con ese correo', codigo: 'CORREO_REPETIDO' })
      }
      await c.query('COMMIT')
      req.log.info({ correo: b.data.correo, por: req.usuario.id }, 'plataforma: cuenta nueva de super admin')
      return rep.code(201).send({ nombre: b.data.nombre, correo: b.data.correo, passwordTemporal: temporal })
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      c.release()
    }
  })
}
