import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { clienteVisible, comoFalla, Falla } from './cobranza.js'
import { tx, type Db } from './db.js'
import { hoyEn, zonaDeEmpresa } from './fechas.js'

// Saldo de envases retornables. Lo que un cliente tiene prestado de un producto retornable = los envases entregados
// (pedidos entregados) − los que ya devolvió (envases_recogidos, sin las anuladas). Cada producto se marca retornable
// al crearlo (registro) o desde el catálogo. El administrador ve a todos; el vendedor, a los de su cartera. Registrar lo
// que se recoge necesita conexión (no viaja por la cola de sincronización).

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>
type Consulta = Pick<Db, 'query'>

export interface SaldoEnvase { clienteId: string; cliente: string; vendedorId: string | null; productoId: string; sabor: string; envase: string | null; entregados: number; recogidos: number; prestados: number }

// Todos los saldos pendientes (> 0), por cliente y producto. `hasta` mira cómo estaban ese día (cierre de mes).
export async function saldosEnvases(q: Consulta, f: { clienteId?: string; vendedorId?: string; hasta?: string } = {}): Promise<SaldoEnvase[]> {
  const { rows } = await q.query(
    `WITH ent AS (
       SELECT pe.id_cliente, d.id_producto, sum(d.cantidad)::float8 AS n
         FROM pedidos pe JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)
        WHERE pe.estado = 'entregado' AND pr.retornable AND ($3::date IS NULL OR pe.fecha <= $3::date) GROUP BY 1, 2
     ), rec AS (
       SELECT id_cliente, id_producto, sum(cantidad)::float8 AS n FROM envases_recogidos
        WHERE anulado_en IS NULL AND ($3::date IS NULL OR fecha <= $3::date) GROUP BY 1, 2
     )
     SELECT cl.id_cliente, cl.nombre, cl.id_vendedor, pr.id_producto, pr.sabor, pr.envase, e.n AS entregados, coalesce(r.n, 0) AS recogidos
       FROM ent e JOIN clientes cl USING (id_cliente) JOIN productos pr USING (id_producto)
       LEFT JOIN rec r ON r.id_cliente = e.id_cliente AND r.id_producto = e.id_producto
      WHERE ($1::uuid IS NULL OR cl.id_cliente = $1) AND ($2::uuid IS NULL OR cl.id_vendedor = $2)
        AND (e.n - coalesce(r.n, 0) > 0 OR $1::uuid IS NOT NULL)
      ORDER BY lower(cl.nombre), lower(pr.sabor)`,
    [f.clienteId ?? null, f.vendedorId ?? null, f.hasta ?? null],
  )
  return rows.map((r) => ({
    clienteId: r.id_cliente, cliente: r.nombre, vendedorId: r.id_vendedor, productoId: r.id_producto, sabor: r.sabor, envase: r.envase,
    entregados: r.entregados, recogidos: r.recogidos, prestados: r.entregados - r.recogidos,
  }))
}

const bodyRecogida = z.object({
  clienteId: z.uuid(),
  productoId: z.uuid(),
  cantidad: z.number().int().positive().max(100000),
  fecha: z.iso.date().optional(),
  nota: z.string().trim().max(200).optional(),
})
const idParam = z.object({ id: z.uuid() })

export async function rutasEnvases(app: FastifyInstance, { db, config }: Contexto, { requiereSesion, requiereAdmin }: { requiereSesion: Guardia; requiereAdmin: Guardia }) {
  const responder = (rep: FastifyReply, e: unknown) => {
    const f = comoFalla(e)
    if (f instanceof Falla) return rep.code(f.status).send({ error: f.message })
    throw f
  }

  // Quién tiene envases prestados y cuántos (por cliente), más el total por producto.
  app.get('/envases', { preHandler: requiereSesion }, async (req) => {
    const filas = await saldosEnvases(db, { vendedorId: req.usuario.rol === 'administrador' ? undefined : req.usuario.id })
    const pendientes = filas.filter((f) => f.prestados > 0)
    const clientes = new Map<string, { id: string; nombre: string; vendedorId: string | null; total: number; envases: { productoId: string; sabor: string; envase: string | null; prestados: number }[] }>()
    const productos = new Map<string, { productoId: string; sabor: string; envase: string | null; prestados: number }>()
    for (const f of pendientes) {
      const c = clientes.get(f.clienteId) ?? clientes.set(f.clienteId, { id: f.clienteId, nombre: f.cliente, vendedorId: f.vendedorId, total: 0, envases: [] }).get(f.clienteId)!
      c.total += f.prestados
      c.envases.push({ productoId: f.productoId, sabor: f.sabor, envase: f.envase, prestados: f.prestados })
      const p = productos.get(f.productoId) ?? productos.set(f.productoId, { productoId: f.productoId, sabor: f.sabor, envase: f.envase, prestados: 0 }).get(f.productoId)!
      p.prestados += f.prestados
    }
    // Desde cuándo tiene cada cliente envases prestados: la entrega más vieja que lo devuelto todavía no cubre.
    const { rows: desdes } = clientes.size ? await db.query(
      `WITH ent AS (
         SELECT pe.id_cliente, d.id_producto, pe.fecha, sum(d.cantidad) AS n
           FROM pedidos pe JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)
          WHERE pe.estado = 'entregado' AND pr.retornable AND pe.id_cliente = ANY($1::uuid[]) GROUP BY 1, 2, 3
       ), acum AS (SELECT *, sum(n) OVER (PARTITION BY id_cliente, id_producto ORDER BY fecha) AS hasta FROM ent),
       rec AS (SELECT id_cliente, id_producto, sum(cantidad) AS n FROM envases_recogidos WHERE anulado_en IS NULL AND id_cliente = ANY($1::uuid[]) GROUP BY 1, 2)
       SELECT a.id_cliente, min(a.fecha)::text AS desde FROM acum a
         LEFT JOIN rec r ON r.id_cliente = a.id_cliente AND r.id_producto = a.id_producto
        WHERE a.hasta > coalesce(r.n, 0) GROUP BY 1`,
      [[...clientes.keys()]],
    ) : { rows: [] }
    const desde = new Map(desdes.map((r) => [r.id_cliente as string, r.desde as string]))
    return {
      total: pendientes.reduce((s, f) => s + f.prestados, 0),
      clientes: [...clientes.values()].map((c) => ({ ...c, desde: desde.get(c.id) ?? null })),
      productos: [...productos.values()],
    }
  })

  // La cuenta de envases de un cliente: lo que tiene de cada producto y cada devolución.
  app.get('/envases/clientes/:id', { preHandler: requiereSesion }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    if (!p.success) return rep.code(400).send({ error: 'Cliente no válido' })
    try {
      const c = await clienteVisible(db, req.usuario, p.data.id)
      const saldos = await saldosEnvases(db, { clienteId: p.data.id })
      const { rows } = await db.query(
        `SELECT r.id_recogida, r.fecha::text, r.cantidad, r.nota, r.anulado_en, pr.sabor, u.nombre AS recogio
           FROM envases_recogidos r JOIN productos pr USING (id_producto) LEFT JOIN usuarios u ON u.id_usuario = r.id_vendedor
          WHERE r.id_cliente = $1 ORDER BY r.fecha DESC, r.creado_en DESC LIMIT 100`,
        [p.data.id],
      )
      return {
        cliente: { id: c.id_cliente, nombre: c.nombre },
        total: saldos.reduce((s, x) => s + Math.max(0, x.prestados), 0),
        envases: saldos.map((s) => ({ productoId: s.productoId, sabor: s.sabor, envase: s.envase, entregados: s.entregados, recogidos: s.recogidos, prestados: s.prestados })),
        recogidas: rows.map((r) => ({ id: r.id_recogida, fecha: r.fecha, cantidad: r.cantidad, sabor: r.sabor, nota: r.nota, anulada: !!r.anulado_en, por: r.recogio })),
      }
    } catch (e) {
      return responder(rep, e)
    }
  })

  // Los envases que recogió quien pregunta hoy (día de la empresa), por producto, sin los anulados: «¡Ruta terminada!».
  app.get('/envases/recogidas/hoy', { preHandler: requiereSesion }, async (req) => {
    const fecha = hoyEn(await zonaDeEmpresa(db, config.zonaHoraria))
    const { rows } = await db.query(
      `SELECT pr.sabor, sum(r.cantidad)::int AS cantidad
         FROM envases_recogidos r JOIN productos pr USING (id_producto)
        WHERE r.id_vendedor = $1 AND r.fecha = $2 AND r.anulado_en IS NULL
        GROUP BY pr.sabor ORDER BY 2 DESC, 1`,
      [req.usuario.id, fecha],
    )
    return { fecha, total: rows.reduce((s, r) => s + r.cantidad, 0), productos: rows.map((r) => ({ sabor: r.sabor as string, cantidad: r.cantidad as number })) }
  })

  // Lo que el cliente devuelve. No puede devolver más de lo que tiene prestado.
  app.post('/envases/recogidas', { preHandler: requiereSesion, config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyRecogida.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Indica el cliente, el producto y cuántos envases devuelve' })
    try {
      const hoy = hoyEn(await zonaDeEmpresa(db, config.zonaHoraria))
      const r = await tx(db, req.usuario.id, async (c) => {
        await clienteVisible(c, req.usuario, b.data.clienteId)
        await c.query(`SELECT 1 FROM clientes WHERE id_cliente = $1 FOR UPDATE`, [b.data.clienteId])
        const [s] = (await saldosEnvases(c, { clienteId: b.data.clienteId })).filter((x) => x.productoId === b.data.productoId)
        const prestados = s?.prestados ?? 0
        if (b.data.cantidad > prestados) throw new Falla(409, prestados > 0 ? `Este cliente tiene ${prestados} prestados, no puede devolver ${b.data.cantidad}` : 'Este cliente no tiene envases de ese producto')
        const fecha = b.data.fecha ?? hoy
        if (fecha > hoy) throw new Falla(400, 'La fecha no puede ser futura')
        const { rows: [x] } = await c.query(
          `INSERT INTO envases_recogidos (id_cliente, id_producto, id_vendedor, fecha, cantidad, nota) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_recogida`,
          [b.data.clienteId, b.data.productoId, req.usuario.id, fecha, b.data.cantidad, b.data.nota || null],
        )
        return { id: x.id_recogida as string, prestados: prestados - b.data.cantidad }
      })
      return rep.code(201).send(r)
    } catch (e) {
      return responder(rep, e)
    }
  })

  app.post('/envases/recogidas/:id/anular', { preHandler: requiereAdmin }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    if (!p.success) return rep.code(400).send({ error: 'Registro no válido' })
    const { rowCount } = await db.query(`UPDATE envases_recogidos SET anulado_en = now() WHERE id_recogida = $1 AND anulado_en IS NULL`, [p.data.id])
    if (!rowCount) return rep.code(404).send({ error: 'Ese registro no existe o ya está anulado' })
    return { ok: true }
  })
}
