import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from '../app.js'
import { tx } from '../db.js'
import { ADAPTADORES } from './adaptadores.js'
import { conCostos, procesarOperacion, type Resultado } from './aplicar.js'
import { bodyPush, TABLAS } from './esquemas.js'

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

const queryPull = z.object({ desde: z.coerce.number().int().min(0).default(0) })
const SOLAPE_MS = 5000 // el siguiente pull repite los últimos segundos, por si una transacción confirmó tarde

export async function rutasSync(app: FastifyInstance, { db }: Contexto, { requiereSesion, requiereAdmin }: { requiereSesion: Guardia; requiereAdmin: Guardia }) {
  // RF-052: el teléfono envía su cola de cambios. Cada operación es independiente.
  app.post('/sync/push', { preHandler: requiereSesion, config: { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.headers.authorization ?? req.ip } } }, async (req, rep) => {
    const body = bodyPush.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Datos de sincronización inválidos', detalles: body.error.issues.slice(0, 5) })
    const ahoraMs = Date.now()
    const reloj = { dispositivo: body.data.dispositivo, skewMs: ahoraMs - body.data.ahoraCliente, ahoraMs }
    const resultados: Resultado[] = []
    for (const op of body.data.operaciones) resultados.push(await procesarOperacion(db, req.usuario, op, reloj))
    return { ahora: ahoraMs, resultados }
  })

  // El teléfono pide lo que cambió desde su último pull. El vendedor sólo recibe su cartera.
  app.get('/sync/pull', { preHandler: requiereSesion }, async (req, rep) => {
    const q = queryPull.safeParse(req.query)
    if (!q.success) return rep.code(400).send({ error: 'Parámetro desde inválido' })
    const u = req.usuario
    const vendedor = u.rol === 'vendedor' ? u.id : undefined
    const desde = q.data.desde || undefined
    return tx(db, null, async (c) => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const { rows: [{ ahora }] } = await c.query(`SELECT (extract(epoch from clock_timestamp()) * 1000)::float8 AS ahora`)
      const datos: Record<string, unknown[]> = {}
      for (const t of TABLAS) {
        const filas = await ADAPTADORES[t].listar(c, { desde, vendedor: t === 'productos' ? undefined : vendedor })
        datos[t] = filas.map((f) => conCostos(t, u, f.wire))
      }
      const { rows: elim } = await c.query(
        `SELECT tabla, id_registro FROM eliminaciones WHERE tabla = ANY($1::text[]) AND ($2::bigint IS NULL OR eliminado_en > to_timestamp(($2::bigint) / 1000.0))`,
        [TABLAS, desde ?? null],
      )
      const eliminados = elim.map((e) => ({ tabla: e.tabla as string, id: e.id_registro as string }))
      if (vendedor) {
        // Lo que le pasaron a otro vendedor (RF-041) no es un borrado, pero su teléfono debe quitar la copia.
        const { rows: retiros } = await c.query(
          `SELECT tabla, id_registro FROM retiros_vendedor WHERE id_vendedor = $1 AND tabla = ANY($2::text[]) AND ($3::bigint IS NULL OR retirado_en > to_timestamp(($3::bigint) / 1000.0))`,
          [vendedor, TABLAS, desde ?? null],
        )
        for (const r of retiros) eliminados.push({ tabla: r.tabla, id: r.id_registro })
      }
      return { ahora, cursor: Math.max(0, Math.floor(ahora) - SOLAPE_MS), ...datos, eliminados }
    })
  })

  // El administrador revisa lo que no se aplicó.
  app.get('/sync/conflictos', { preHandler: requiereAdmin }, async () => {
    const { rows } = await db.query(
      `SELECT o.id_operacion, o.tabla, o.id_registro, o.operacion, o.estado, o.detalle_error, o.datos, o.recibido_en, o.dispositivo, u.nombre AS usuario
         FROM operaciones_sync o JOIN usuarios u USING (id_usuario)
        WHERE o.estado IN ('conflicto', 'rechazada') ORDER BY o.recibido_en DESC LIMIT 100`,
    )
    return { conflictos: rows }
  })
}
