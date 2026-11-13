import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Bitacora } from './bitacora.js'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { AvisoPendiente, Despachador } from './notificaciones.js'
import { avisarProduccionPendiente } from './produccion.js'

// Pedido urgente sin atender (RF-054). Si un pedido marcado urgente sigue pendiente los minutos de su empresa
// (`empresas.minutos_urgente`, 30 de fábrica; Configuración → Preferencias) después del aviso al
// vendedor, se le recuerda a él y se avisa a los administradores activos de la empresa. Una vez por cada vez que se
// marcó urgente (si lo vuelven a marcar, puede volver a avisar).
//
// No hay un reloj fino: el cron de Vercel Hobby es diario. Lo despiertan
//   · la conexión en vivo (envivo.ts): mientras alguien tiene la app o el panel abiertos, a lo más cada 2 minutos;
//   · GET /cron/urgentes con CRON_SECRET, para un despertador externo (.github/workflows/despertador.yml).
// Los mismos despiertan el aviso de producción pendiente de la tarde (produccion.ts).
// Cruza empresas: corre con la conexión del dueño de la base. Un candado de la base evita que dos instancias avisen
// lo mismo a la vez.

const CADA_MS = 2 * 60_000

// `minutos` y `esperar` sólo para pruebas: si no, cuenta lo que eligió cada empresa y, si otra instancia ya está
// revisando, no espera.
export async function avisarUrgentesSinAtender(db: Db, despachador: Despachador, minutos: number | null = null, esperar = false): Promise<number> {
  const c = await db.connect()
  try {
    await c.query('BEGIN')
    const { rows: [{ libre }] } = await c.query(esperar
      ? `SELECT pg_advisory_xact_lock(hashtext('delisy:urgentes')) IS NOT NULL AS libre`
      : `SELECT pg_try_advisory_xact_lock(hashtext('delisy:urgentes')) AS libre`)
    if (!libre) { await c.query('ROLLBACK'); return 0 }
    // El último aviso de urgente de cada pedido que sigue urgente y pendiente; sin recordatorio desde entonces.
    const { rows } = await c.query(
      `WITH ultimo AS (
         SELECT x.id::uuid AS id_pedido, max(n.creado_en) AS desde
           FROM notificaciones n
          CROSS JOIN LATERAL jsonb_array_elements_text(
                  coalesce(n.datos->'pedidoIds', CASE WHEN n.datos ? 'pedidoId' THEN jsonb_build_array(n.datos->'pedidoId') END, '[]')) AS x(id)
          WHERE n.tipo = 'pedido_urgente' AND n.creado_en > now() - interval '12 hours'
          GROUP BY 1
       )
       SELECT p.id_pedido, p.id_empresa, p.id_vendedor, cl.nombre AS cliente, v.nombre AS vendedor,
              floor(extract(epoch FROM now() - x.desde) / 60)::int AS minutos
         FROM ultimo x
         JOIN pedidos p ON p.id_pedido = x.id_pedido
         JOIN clientes cl ON cl.id_cliente = p.id_cliente
         JOIN empresas e ON e.id_empresa = p.id_empresa
         LEFT JOIN usuarios v ON v.id_usuario = p.id_vendedor
        WHERE p.urgente AND p.estado = 'pendiente' AND x.desde < now() - make_interval(mins => coalesce($1::int, e.minutos_urgente))
          AND NOT EXISTS (SELECT 1 FROM notificaciones m
                           WHERE m.tipo = 'urgente_sin_atender' AND m.creado_en > x.desde
                             AND coalesce(m.datos->'pedidoIds', jsonb_build_array(m.datos->'pedidoId')) ? p.id_pedido::text)`,
      [minutos],
    )
    if (!rows.length) { await c.query('COMMIT'); return 0 }
    const { rows: admins } = await c.query(
      `SELECT id_usuario, id_empresa FROM usuarios WHERE rol = 'administrador' AND activo AND id_empresa = ANY($1::uuid[])`,
      [[...new Set(rows.map((r) => r.id_empresa))]],
    )
    const avisos: AvisoPendiente[] = []
    for (const r of rows) {
      const datos = { pedidoId: r.id_pedido as string }
      if (r.id_vendedor) {
        avisos.push({ para: r.id_vendedor, tipo: 'urgente_sin_atender', titulo: 'Urgente pendiente', cuerpo: `${r.cliente} sigue esperando (hace ${r.minutos} min)`, datos: { ...datos, pestana: 'ruta' } })
      }
      for (const a of admins.filter((x) => x.id_empresa === r.id_empresa)) {
        avisos.push({ para: a.id_usuario, tipo: 'urgente_sin_atender', titulo: 'Pedido urgente sin atender', cuerpo: `${r.cliente} lleva ${r.minutos} min esperando${r.vendedor ? ` (${r.vendedor})` : ', sin vendedor'}`, datos: { ...datos, url: '/admin' } })
      }
    }
    // Si son varios para la misma persona, unir() los junta en uno y guarda todos sus pedidoIds: no se repiten.
    await despachador.despachar(avisos)
    await c.query('COMMIT')
    return rows.length
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

// Desde la conexión en vivo: a lo más cada 2 minutos por instancia, sin esperar ni tumbar nada.
let ultimaVez = 0
export function revisarDeVezEnCuando(db: Db, despachador: Despachador, log: Bitacora, horaProduccion: number | null) {
  if (Date.now() - ultimaVez < CADA_MS) return
  ultimaVez = Date.now()
  void avisarUrgentesSinAtender(db, despachador).catch((err) => log.error({ err }, 'cron: no se pudieron revisar los urgentes sin atender'))
  if (horaProduccion !== null) void avisarProduccionPendiente(db, despachador, { horaDesde: horaProduccion }).catch((err) => log.error({ err }, 'cron: no se pudo revisar la producción de mañana'))
}

// El secreto del cron (CRON_SECRET, al menos 24 caracteres) comparado sin dar pistas por el tiempo de respuesta.
// null = la ruta no existe (sin secreto configurado).
export function cronAutorizado(config: Config, req: FastifyRequest): boolean | null {
  const secreto = config.cronSecret
  if (secreto.length < 24) return null
  const dado = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /i, ''))
  const bueno = Buffer.from(secreto)
  return dado.length === bueno.length && timingSafeEqual(dado, bueno)
}

export async function rutasUrgentes(app: FastifyInstance, db: Db, config: Config, despachador: Despachador) {
  app.get('/cron/urgentes', async (req, rep) => {
    const ok = cronAutorizado(config, req)
    if (ok === null) return rep.code(404).send({ error: 'No encontrado' })
    if (!ok) return rep.code(401).send({ error: 'No autorizado' })
    return { ok: true, avisados: await avisarUrgentesSinAtender(db, despachador), produccion: config.horaAvisoProduccion === null ? 0 : await avisarProduccionPendiente(db, despachador, { horaDesde: config.horaAvisoProduccion }) }
  })
}
