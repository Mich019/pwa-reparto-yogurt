import type { Config } from './config.js'
import { correoResumen, enviarCorreos, type CifrasResumen } from './correo.js'
import type { Db } from './db.js'

// Resumen diario por correo (usuarios.resumen_correo, migración 030; Configuración → Preferencias): cada administrador
// que lo pidió recibe en la mañana lo de ayer de su empresa en un solo correo (ventas, cobro, fiado, cortes por
// confirmar, urgentes que se quedaron sin atender), en vez de enterarse por un push de cada corte.
// Lo llama el cron diario (plataforma.ts, GET /cron/avisos) con la conexión del dueño: cruza empresas. «Ayer» sale de la
// zona de cada empresa. Cada cuenta se reclama con `resumen_enviado_dia` antes de mandarle nada: aunque el cron corra
// dos veces, no le llega dos veces.

export async function mandarResumenes(db: Db, config: Config, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }): Promise<number> {
  const { rows: cuentas } = await db.query(
    `UPDATE usuarios u SET resumen_enviado_dia = (now() AT TIME ZONE e.zona_horaria)::date
       FROM empresas e
      WHERE e.id_empresa = u.id_empresa AND e.activa AND NOT e.interna
        AND u.rol = 'administrador' AND u.activo AND u.resumen_correo
        AND u.resumen_enviado_dia IS DISTINCT FROM (now() AT TIME ZONE e.zona_horaria)::date
      RETURNING u.id_usuario, u.nombre, u.correo, u.id_empresa, e.nombre AS empresa`,
  )
  if (!cuentas.length) return 0
  const cifras = new Map<string, CifrasResumen>()
  for (const id of new Set(cuentas.map((c) => c.id_empresa as string))) cifras.set(id, await cifrasDeAyer(db, id))
  const msjs = cuentas.map((c) => ({ para: c.correo as string, ...correoResumen(c.nombre, c.empresa, cifras.get(c.id_empresa)!, `${config.urlApp}/admin`) }))
  return enviarCorreos(config, msjs, log)
}

export async function cifrasDeAyer(db: Db, idEmpresa: string): Promise<CifrasResumen> {
  const { rows: [r] } = await db.query(
    `WITH d AS (SELECT (now() AT TIME ZONE zona_horaria)::date - 1 AS ayer, zona_horaria AS zona FROM empresas WHERE id_empresa = $1),
     v AS (
       SELECT p.total, p.metodo_pago FROM pedidos p, d
        WHERE p.id_empresa = $1 AND p.estado = 'entregado' AND (p.fecha_entregado_real AT TIME ZONE d.zona)::date = d.ayer
     )
     SELECT to_char(d.ayer, 'YYYY-MM-DD') AS ayer,
            (SELECT count(*)::int FROM v) AS entregados,
            (SELECT coalesce(sum(total), 0)::float8 FROM v) AS vendido,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE metodo_pago = 'efectivo') AS efectivo,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE metodo_pago = 'transferencia') AS transferencia,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE metodo_pago = 'credito') AS fiado,
            (SELECT coalesce(sum(monto), 0)::float8 FROM abonos a WHERE a.id_empresa = $1 AND a.fecha = d.ayer AND a.anulado_en IS NULL) AS abonos,
            (SELECT count(*)::int FROM pedidos p WHERE p.id_empresa = $1 AND p.fecha = d.ayer AND p.estado = 'pendiente') AS sin_atender,
            (SELECT count(*)::int FROM cortes_dia c WHERE c.id_empresa = $1 AND c.estado = 'pendiente' AND c.fecha <= d.ayer) AS cortes_por_confirmar,
            (SELECT count(DISTINCT coalesce(n.datos->>'pedidoId', n.datos->'pedidoIds'->>0))::int FROM notificaciones n
              WHERE n.id_empresa = $1 AND n.tipo = 'urgente_sin_atender' AND (n.creado_en AT TIME ZONE d.zona)::date = d.ayer) AS urgentes
       FROM d`,
    [idEmpresa],
  )
  return {
    dia: r.ayer as string,
    entregados: r.entregados, vendido: r.vendido, efectivo: r.efectivo, transferencia: r.transferencia, fiado: r.fiado,
    abonos: r.abonos, sinAtender: r.sin_atender, cortesPorConfirmar: r.cortes_por_confirmar, urgentes: r.urgentes,
  }
}
