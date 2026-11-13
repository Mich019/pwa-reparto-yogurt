import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { clienteVisible, comoFalla, Falla } from './cobranza.js'
import { tx, type Db } from './db.js'
import { hoyEn, zonaDeEmpresa } from './fechas.js'
import type { Despachador } from './notificaciones.js'

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

// Desde cuándo tiene cada cliente envases prestados: la entrega más vieja que lo devuelto todavía no cubre (lo que
// regresa cubre primero lo más viejo, como los abonos del fiado). `clienteIds` null = todos los que se vean.
export async function desdeEnvases(q: Consulta, clienteIds: string[] | null): Promise<Map<string, string>> {
  const { rows } = await q.query(
    `WITH ent AS (
       SELECT pe.id_cliente, d.id_producto, pe.fecha, sum(d.cantidad) AS n
         FROM pedidos pe JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)
        WHERE pe.estado = 'entregado' AND pr.retornable AND ($1::uuid[] IS NULL OR pe.id_cliente = ANY($1::uuid[])) GROUP BY 1, 2, 3
     ), acum AS (SELECT *, sum(n) OVER (PARTITION BY id_cliente, id_producto ORDER BY fecha) AS hasta FROM ent),
     rec AS (SELECT id_cliente, id_producto, sum(cantidad) AS n FROM envases_recogidos
              WHERE anulado_en IS NULL AND ($1::uuid[] IS NULL OR id_cliente = ANY($1::uuid[])) GROUP BY 1, 2)
     SELECT a.id_cliente, min(a.fecha)::text AS desde FROM acum a
       LEFT JOIN rec r ON r.id_cliente = a.id_cliente AND r.id_producto = a.id_producto
      WHERE a.hasta > coalesce(r.n, 0) GROUP BY 1`,
    [clienteIds],
  )
  return new Map(rows.map((r) => [r.id_cliente as string, r.desde as string]))
}

// Cron diario: al vendedor de cada cliente con envases prestados desde hace más de `dias` días le llega
// `envases_atrasados` (se puede apagar) con los suyos, que abre Clientes. Sólo empresas que llevan la cuenta de envases.
// Cada cliente vuelve a avisarse a los `dias` días si sigue igual (`datos.clienteIds`). Cruza empresas: conexión del
// dueño. shortcut: calcula todas las empresas en una consulta; si llegan a ser muchas, recorrerlas una por una.
export async function avisarEnvasesAtrasados(db: Db, despachador: Despachador, dias = 30): Promise<number> {
  const limite = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10)
  const viejos = [...(await desdeEnvases(db, null))].filter(([, desde]) => desde < limite)
  if (!viejos.length) return 0
  const desde = new Map(viejos)
  const { rows } = await db.query(
    `SELECT c.id_cliente, c.nombre, c.id_vendedor FROM clientes c JOIN empresas e USING (id_empresa)
       JOIN usuarios u ON u.id_usuario = c.id_vendedor AND u.activo AND u.rol = 'vendedor'
      WHERE c.id_cliente = ANY($1::uuid[]) AND c.activo AND e.activa AND NOT e.interna AND e.control_retornables
        AND NOT EXISTS (SELECT 1 FROM notificaciones n
                         WHERE n.id_empresa = c.id_empresa AND n.tipo = 'envases_atrasados' AND n.creado_en > now() - make_interval(days => $2)
                           AND coalesce(n.datos->'clienteIds', '[]') ? c.id_cliente::text)
      ORDER BY lower(c.nombre)`,
    [viejos.map(([id]) => id), dias],
  )
  if (!rows.length) return 0
  const porVendedor = new Map<string, { id: string; nombre: string }[]>()
  for (const r of rows) porVendedor.set(r.id_vendedor, [...(porVendedor.get(r.id_vendedor) ?? []), { id: r.id_cliente, nombre: r.nombre }])
  const fecha = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
  await despachador.despachar([...porVendedor].map(([vendedor, cs]) => ({
    para: vendedor, tipo: 'envases_atrasados' as const,
    titulo: cs.length === 1 ? 'Envases prestados de más de un mes' : `${cs.length} clientes tienen envases desde hace más de un mes`,
    cuerpo: cs.length === 1
      ? `${cs[0].nombre} tiene envases prestados desde el ${fecha(desde.get(cs[0].id)!)}: recógelos en su próxima visita`
      : `${cs.slice(0, 3).map((c) => c.nombre).join(', ')}${cs.length > 3 ? ` y ${cs.length - 3} más` : ''}: recógelos en su próxima visita`,
    datos: { pestana: 'clientes' as const, clienteIds: cs.map((c) => c.id) },
  })))
  return rows.length
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
    const desde = clientes.size ? await desdeEnvases(db, [...clientes.keys()]) : new Map<string, string>()
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

  // Un «Recoger» equivocado se deshace (sólo el administrador, desde la hoja de envases del cliente). Si el corte de ese
  // día ya se confirmó, sus envases quedaron congelados: primero hay que reabrirlo, igual que con un abono en efectivo.
  app.post('/envases/recogidas/:id/anular', { preHandler: requiereAdmin }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    if (!p.success) return rep.code(400).send({ error: 'Registro no válido' })
    try {
      await tx(db, req.usuario.id, async (c) => {
        const { rows: [r] } = await c.query(`SELECT fecha::text, id_vendedor, anulado_en FROM envases_recogidos WHERE id_recogida = $1 FOR UPDATE`, [p.data.id])
        if (!r || r.anulado_en) throw new Falla(404, 'Ese registro no existe o ya está anulado')
        const { rows: [k] } = await c.query(`SELECT 1 FROM cortes_dia WHERE fecha = $1 AND id_vendedor = $2 AND estado = 'confirmado' FOR SHARE`, [r.fecha, r.id_vendedor])
        if (k) throw new Falla(409, 'El corte de ese día ya está confirmado: reábrelo primero en Finanzas → Cortes del día')
        await c.query(`UPDATE envases_recogidos SET anulado_en = now() WHERE id_recogida = $1`, [p.data.id])
      })
      return { ok: true }
    } catch (e) {
      return responder(rep, e)
    }
  })
}
