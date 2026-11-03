import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { tx } from './db.js'

// Precio especial por cliente (p. ej. mayoreo). Se fija por producto y por unidad (precioLitro = por L, kg o pieza,
// como el catálogo y la app) y gana al precio de lista en los pedidos nuevos de ese cliente (fn_detalle_precios). Va al
// teléfono del vendedor dentro del cliente (`precios`, adaptadores.ts) para que vea lo mismo que se cobrará. Sólo el
// administrador los cambia; el costo nunca viaja.

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

const idParam = z.object({ id: z.uuid() })
const body = z.object({
  precios: z.array(z.object({ productoId: z.uuid(), precioLitro: z.number().finite().positive().max(99999999).nullable() })).min(1).max(500),
})
const redondear = (n: number) => Math.round(n * 100) / 100

export async function rutasPrecios(app: FastifyInstance, { db }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }) {
  const leer = async (idCliente: string) => {
    const { rows } = await db.query(
      `SELECT pr.id_producto, pr.sabor, pr.unidad, pr.disponible, (pr.precio_unitario / pr.presentacion_litros)::float8 AS lista,
              (pc.precio_unitario / pr.presentacion_litros)::float8 AS especial
         FROM productos pr LEFT JOIN precios_cliente pc ON pc.id_producto = pr.id_producto AND pc.id_cliente = $1
        WHERE pr.disponible OR pc.id_producto IS NOT NULL ORDER BY lower(pr.sabor)`,
      [idCliente],
    )
    return rows.map((r) => ({ productoId: r.id_producto as string, sabor: r.sabor as string, unidad: r.unidad as string, lista: redondear(r.lista), precioLitro: r.especial === null ? null : redondear(r.especial) }))
  }

  app.get('/clientes/:id/precios', { preHandler: requiereAdmin }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    if (!p.success) return rep.code(400).send({ error: 'Cliente no válido' })
    const { rowCount } = await db.query(`SELECT 1 FROM clientes WHERE id_cliente = $1`, [p.data.id])
    if (!rowCount) return rep.code(404).send({ error: 'Ese cliente no existe' })
    return { precios: await leer(p.data.id) }
  })

  // `precioLitro: null` quita el precio especial de ese producto (vuelve al de lista).
  app.put('/clientes/:id/precios', { preHandler: requiereAdmin, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    const b = body.safeParse(req.body)
    if (!p.success || !b.success) return rep.code(400).send({ error: 'Indica los productos y sus precios' })
    const ids = [...new Set(b.data.precios.map((x) => x.productoId))]
    const ok = await tx(db, req.usuario.id, async (c) => {
      const { rows: [cl] } = await c.query(`SELECT 1 AS ok FROM clientes WHERE id_cliente = $1 FOR UPDATE`, [p.data.id])
      if (!cl) return 404
      const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM productos WHERE id_producto = ANY($1::uuid[])`, [ids])
      if (n !== ids.length) return 400
      for (const x of b.data.precios) {
        if (x.precioLitro === null) {
          await c.query(`DELETE FROM precios_cliente WHERE id_cliente = $1 AND id_producto = $2`, [p.data.id, x.productoId])
        } else {
          await c.query(
            `INSERT INTO precios_cliente (id_cliente, id_producto, precio_unitario)
             SELECT $1, id_producto, round($3::numeric * presentacion_litros, 2) FROM productos WHERE id_producto = $2
             ON CONFLICT (id_cliente, id_producto) DO UPDATE SET precio_unitario = EXCLUDED.precio_unitario, actualizado_en = now()`,
            [p.data.id, x.productoId, x.precioLitro],
          )
        }
      }
      await c.query(`UPDATE clientes SET actualizado_en = now() WHERE id_cliente = $1`, [p.data.id]) // el teléfono lo vuelve a bajar
      return 200
    })
    if (ok === 404) return rep.code(404).send({ error: 'Ese cliente no existe' })
    if (ok === 400) return rep.code(400).send({ error: 'Alguno de los productos no existe' })
    return { precios: await leer(p.data.id) }
  })
}
