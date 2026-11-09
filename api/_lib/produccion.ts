import type { Db } from './db.js'
import type { AvisoPendiente, Despachador } from './notificaciones.js'

// Producción pendiente: desde las 6 de la tarde (en la zona de cada empresa), si mañana hay pedidos agendados de un
// sabor y en Stock del día no se ha anotado producción que los cubra, se avisa a los administradores activos. Una vez
// por empresa y día (`datos.fecha`); cada administrador puede apagarlo (AVISOS_ELEGIBLES). Sólo cuenta lo ya pedido: lo
// estimado por historial se calcula en el teléfono. Lo despiertan los mismos que a los urgentes (urgentes.ts). Cruza
// empresas: corre con la conexión del dueño de la base, con un candado para que dos instancias no avisen a la vez.

// `horaDesde`, `idEmpresa` y `esperar` sólo para pruebas.
export async function avisarProduccionPendiente(db: Db, despachador: Despachador, { horaDesde = 18, idEmpresa = null as string | null, esperar = false } = {}): Promise<number> {
  const c = await db.connect()
  try {
    await c.query('BEGIN')
    const { rows: [{ libre }] } = await c.query(esperar
      ? `SELECT pg_advisory_xact_lock(hashtext('delisy:produccion')) IS NOT NULL AS libre`
      : `SELECT pg_try_advisory_xact_lock(hashtext('delisy:produccion')) AS libre`)
    if (!libre) { await c.query('ROLLBACK'); return 0 }
    const { rows } = await c.query(
      `WITH emp AS (
         SELECT id_empresa, (now() AT TIME ZONE zona_horaria)::date + 1 AS manana
           FROM empresas
          WHERE activa AND NOT interna AND extract(hour FROM now() AT TIME ZONE zona_horaria) >= $1
            AND ($2::uuid IS NULL OR id_empresa = $2)
       ), pedido AS (
         SELECT e.id_empresa, e.manana, d.id_producto, sum(d.cantidad * pr.presentacion_litros) AS pedido
           FROM emp e
           JOIN pedidos p ON p.id_empresa = e.id_empresa AND p.fecha = e.manana AND p.estado = 'pendiente'
           JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
           JOIN productos pr ON pr.id_producto = d.id_producto
          GROUP BY 1, 2, 3
       )
       SELECT x.id_empresa, to_char(x.manana, 'YYYY-MM-DD') AS manana, pr.sabor, pr.unidad,
              (x.pedido - coalesce(pd.litros, 0))::float8 AS falta
         FROM pedido x
         JOIN productos pr ON pr.id_producto = x.id_producto
         LEFT JOIN produccion_diaria pd ON pd.id_empresa = x.id_empresa AND pd.fecha = x.manana AND pd.id_producto = x.id_producto
        WHERE x.pedido - coalesce(pd.litros, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM notificaciones n WHERE n.id_empresa = x.id_empresa AND n.tipo = 'produccion_pendiente'
                           AND n.datos->>'fecha' = to_char(x.manana, 'YYYY-MM-DD'))
        ORDER BY x.id_empresa, falta DESC, pr.sabor`,
      [horaDesde, idEmpresa],
    )
    if (!rows.length) { await c.query('COMMIT'); return 0 }
    const porEmpresa = new Map<string, { manana: string; sabores: string[] }>()
    for (const r of rows) {
      const e = porEmpresa.get(r.id_empresa) ?? porEmpresa.set(r.id_empresa, { manana: r.manana, sabores: [] }).get(r.id_empresa)!
      e.sabores.push(`${r.sabor} ${Math.round(r.falta * 100) / 100} ${r.unidad || 'L'}`)
    }
    const { rows: admins } = await c.query(
      `SELECT id_usuario, id_empresa FROM usuarios WHERE rol = 'administrador' AND activo AND id_empresa = ANY($1::uuid[])`,
      [[...porEmpresa.keys()]],
    )
    const avisos: AvisoPendiente[] = []
    for (const [id, e] of porEmpresa) {
      const lista = e.sabores.length > 3 ? `${e.sabores.slice(0, 3).join(', ')} y ${e.sabores.length - 3} más` : e.sabores.join(', ').replace(/, ([^,]*)$/, ' y $1')
      for (const a of admins.filter((x) => x.id_empresa === id)) {
        avisos.push({ para: a.id_usuario, tipo: 'produccion_pendiente', titulo: 'Falta producir para mañana', cuerpo: `Hay pedidos sin producir: ${lista}.`, datos: { fecha: e.manana, url: '/admin?ir=produccion' } })
      }
    }
    await despachador.despachar(avisos)
    await c.query('COMMIT')
    return porEmpresa.size
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}
