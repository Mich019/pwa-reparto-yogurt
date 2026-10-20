import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.ts'
import { tx } from './db.ts'

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

// Pasa clientes (RF-041): `clienteIds` para algunos, o `desde` para toda la cartera de un vendedor
// (null = los que no tienen vendedor). `hacia: null` los deja sin vendedor.
const bodyReasignar = z
  .object({
    hacia: z.uuid().nullable(),
    clienteIds: z.array(z.uuid()).min(1).max(2000).optional(),
    desde: z.uuid().nullable().optional(),
  })
  .refine((b) => (b.clienteIds !== undefined) !== (b.desde !== undefined), 'Indica clienteIds o desde, no los dos')

type Falla = { status: number; error: string }
type Exito = { clientes: number; pedidos: number; recordatorios: number }

export async function rutasCartera(app: FastifyInstance, { db }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }) {
  // Con los clientes viajan sus pedidos agendados y recordatorios pendientes. El historial entregado se queda con
  // quien lo vendió (sus ventas no cambian de dueño); sólo se "toca" para que el vendedor nuevo lo descargue.
  // El teléfono del vendedor anterior quita su copia al sincronizar (tabla retiros_vendedor).
  app.post('/clientes/reasignar', { preHandler: requiereAdmin }, async (req, rep) => {
    const b = bodyReasignar.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Indica a qué vendedor pasan los clientes y cuáles' })
    const { hacia, clienteIds, desde } = b.data

    const r = await tx<Falla | Exito>(db, req.usuario.id, async (c) => {
      if (hacia) {
        const { rows } = await c.query(`SELECT activo FROM usuarios WHERE id_usuario = $1`, [hacia])
        if (!rows[0]) return { status: 404, error: 'El vendedor de destino no existe' }
        if (!rows[0].activo) return { status: 409, error: 'El vendedor de destino está dado de baja' }
      }
      if (desde) {
        const { rows } = await c.query(`SELECT 1 FROM usuarios WHERE id_usuario = $1`, [desde])
        if (!rows[0]) return { status: 404, error: 'El vendedor de origen no existe' }
      }
      if (clienteIds) {
        const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM clientes WHERE id_cliente = ANY($1::uuid[])`, [[...new Set(clienteIds)]])
        if (n !== new Set(clienteIds).size) return { status: 404, error: 'Alguno de los clientes no existe' }
      }

      const { rows: mover } = clienteIds
        ? await c.query(`SELECT id_cliente, id_vendedor FROM clientes WHERE id_cliente = ANY($1::uuid[]) AND id_vendedor IS DISTINCT FROM $2::uuid FOR UPDATE`, [clienteIds, hacia])
        : await c.query(`SELECT id_cliente, id_vendedor FROM clientes WHERE id_vendedor IS NOT DISTINCT FROM $1::uuid AND id_vendedor IS DISTINCT FROM $2::uuid FOR UPDATE`, [desde, hacia])
      if (!mover.length) return { clientes: 0, pedidos: 0, recordatorios: 0 }
      const ids: string[] = mover.map((m) => m.id_cliente)

      const { rows: peds } = await c.query(`SELECT id_pedido, id_vendedor FROM pedidos WHERE id_cliente = ANY($1::uuid[]) AND estado IN ('pendiente', 'en_camino') FOR UPDATE`, [ids])
      const { rows: recs } = await c.query(`SELECT id_recordatorio, id_vendedor FROM recordatorios WHERE id_cliente = ANY($1::uuid[]) AND estado = 'pendiente' FOR UPDATE`, [ids])

      // Qué le quita cada vendedor anterior a su teléfono.
      const retiros: { vendedor: string; tabla: string; id: string }[] = [
        ...mover.map((m) => ({ vendedor: m.id_vendedor, tabla: 'clientes', id: m.id_cliente })),
        ...peds.map((p) => ({ vendedor: p.id_vendedor, tabla: 'pedidos', id: p.id_pedido })),
        ...recs.map((x) => ({ vendedor: x.id_vendedor, tabla: 'recordatorios', id: x.id_recordatorio })),
      ].filter((x) => x.vendedor && x.vendedor !== hacia)
      if (retiros.length) {
        await c.query(
          `INSERT INTO retiros_vendedor (id_vendedor, tabla, id_registro)
           SELECT v, t, i FROM unnest($1::uuid[], $2::text[], $3::uuid[]) AS x(v, t, i)
           ON CONFLICT (id_vendedor, tabla, id_registro) DO UPDATE SET retirado_en = now()`,
          [retiros.map((x) => x.vendedor), retiros.map((x) => x.tabla), retiros.map((x) => x.id)],
        )
      }
      // Si vuelven a un vendedor que antes los tuvo, ya no se le piden quitar.
      if (hacia) {
        await c.query(`DELETE FROM retiros_vendedor WHERE id_vendedor = $1 AND id_registro = ANY($2::uuid[])`, [hacia, [...ids, ...peds.map((p) => p.id_pedido), ...recs.map((x) => x.id_recordatorio)]])
      }

      await c.query(`UPDATE clientes SET id_vendedor = $2 WHERE id_cliente = ANY($1::uuid[])`, [ids, hacia])
      if (peds.length) await c.query(`UPDATE pedidos SET id_vendedor = $2 WHERE id_pedido = ANY($1::uuid[])`, [peds.map((p) => p.id_pedido), hacia])
      if (recs.length) await c.query(`UPDATE recordatorios SET id_vendedor = $2 WHERE id_recordatorio = ANY($1::uuid[])`, [recs.map((x) => x.id_recordatorio), hacia])
      await c.query(`UPDATE pedidos SET id_cliente = id_cliente WHERE id_cliente = ANY($1::uuid[]) AND estado NOT IN ('pendiente', 'en_camino')`, [ids])
      return { clientes: ids.length, pedidos: peds.length, recordatorios: recs.length }
    })
    if ('status' in r) return rep.code(r.status).send({ error: r.error })
    return r
  })
}
