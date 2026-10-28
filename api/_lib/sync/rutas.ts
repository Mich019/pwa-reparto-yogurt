import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from '../app.js'
import { tx } from '../db.js'
import { hoyEn } from '../fechas.js'
import { claveUsuario } from '../seguridad.js'
import type { Despachador } from '../notificaciones.js'
import { ADAPTADORES } from './adaptadores.js'
import { conCostos, procesarOperacion, type Efectos, type Resultado } from './aplicar.js'
import { bodyPush, TABLAS } from './esquemas.js'

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

const queryPull = z.object({ desde: z.coerce.number().int().min(0).default(0) })
const SOLAPE_MS = 5000 // el siguiente pull repite los últimos segundos, por si una transacción confirmó tarde
const DIAS_DE_STOCK = 3 // el teléfono guarda el stock de hoy y de unos días atrás (el reloj del servidor es UTC, el del negocio no)
const MAX_AVISOS = 100
const MAX_OPS_POR_HORA = 5000

export async function rutasSync(
  app: FastifyInstance,
  { db, config }: Contexto,
  { requiereSesion, requiereAdmin }: { requiereSesion: Guardia; requiereAdmin: Guardia },
  despachador: Despachador,
) {
  // RF-052: el teléfono envía su cola de cambios. Cada operación es independiente.
  // La sesión se revisa en onRequest, antes de leer el cuerpo (hasta 5 MB): sin sesión, no se procesa nada.
  app.post('/sync/push', {
    onRequest: requiereSesion,
    bodyLimit: 5 * 1024 * 1024,
    config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => claveUsuario(req, config) } },
  }, async (req, rep) => {
    const body = bodyPush.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Datos de sincronización inválidos', detalles: body.error.issues.slice(0, 5) })
    // Tope por cuenta: un día normal son unos cientos de operaciones. Más de MAX_OPS_POR_HORA en una hora es un abuso
    // (o un error del teléfono) y llenaría la base; el teléfono conserva su cola y reintenta más tarde.
    const { rows: [{ n }] } = await db.query(
      `SELECT count(*)::int AS n FROM operaciones_sync WHERE id_usuario = $1 AND recibido_en > now() - interval '1 hour'`,
      [req.usuario.id],
    )
    if (n + body.data.operaciones.length > MAX_OPS_POR_HORA) {
      return rep.code(429).send({ error: 'Demasiados cambios en poco tiempo. Se volverán a enviar más tarde.', codigo: 'LIMITE_SYNC' })
    }
    const ahoraMs = Date.now()
    const reloj = { dispositivo: body.data.dispositivo, skewMs: ahoraMs - body.data.ahoraCliente, ahoraMs }
    const resultados: Resultado[] = []
    const efectos: Efectos = { hoy: hoyEn(config.zonaHoraria), avisos: [] }
    try {
      for (const op of body.data.operaciones) resultados.push(await procesarOperacion(db, req.usuario, op, reloj, efectos))
    } finally {
      // Lo ya confirmado se avisa aunque una operación posterior haya fallado.
      await despachador.despachar(efectos.avisos)
    }
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

      // RF-037: el vendedor recibe su stock de los últimos días; el administrador lo maneja por /stock.
      const { rows: filasStock } = vendedor
        ? await c.query(
            `SELECT id_stock, fecha, id_producto, cantidad_asignada::float8 AS asignada, cantidad_devuelta::float8 AS devuelta, version
               FROM stock_diario
              WHERE id_vendedor = $1 AND fecha >= (now() AT TIME ZONE 'UTC')::date - $2::int
                AND ($3::bigint IS NULL OR actualizado_en > to_timestamp(($3::bigint) / 1000.0))
              ORDER BY fecha, id_producto`,
            [vendedor, DIAS_DE_STOCK, desde ?? null],
          )
        : { rows: [] }
      const stock = filasStock.map((r) => ({ id: r.id_stock, fecha: r.fecha, productoId: r.id_producto, asignada: r.asignada, devuelta: r.devuelta, version: r.version }))

      // RF-054: sus avisos nuevos. En la primera descarga, los de los últimos días.
      const { rows: filasAvisos } = await c.query(
        `SELECT id_notificacion, tipo, titulo, cuerpo, datos, (extract(epoch from creado_en) * 1000)::float8 AS creado_ms
           FROM notificaciones
          WHERE id_usuario = $1 AND creado_en > coalesce(to_timestamp(($2::bigint) / 1000.0), now() - interval '3 days')
          ORDER BY creado_en DESC LIMIT $3`,
        [u.id, desde ?? null, MAX_AVISOS],
      )
      const avisos = filasAvisos.reverse().map((r) => ({ id: r.id_notificacion, tipo: r.tipo, titulo: r.titulo, cuerpo: r.cuerpo ?? '', datos: r.datos ?? {}, creado: r.creado_ms }))

      return { ahora, cursor: Math.max(0, Math.floor(ahora) - SOLAPE_MS), ...datos, stock, avisos, eliminados }
    }, { fotoFija: true })
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
