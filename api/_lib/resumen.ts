import type { Config } from './config.js'
import { correoResumen, enviarCorreos, type CifrasResumen } from './correo.js'
import type { Db } from './db.js'

// Resumen por correo para el administrador (Configuración → Preferencias): cada administrador que lo pidió recibe lo
// de su empresa en un solo correo (ventas, cobro, fiado, cortes por confirmar, urgentes que se quedaron sin atender),
// en vez de enterarse por un push de cada corte. Dos, cada uno con su interruptor:
//   · diario (usuarios.resumen_correo, migración 030): cada mañana, lo de ayer;
//   · semanal (usuarios.resumen_semanal, migración 031): cada lunes, los siete días anteriores.
// Lo llama el cron diario (plataforma.ts, GET /cron/avisos) con la conexión del dueño: cruza empresas. «Ayer» y «lunes»
// salen de la zona de cada empresa. Cada cuenta se reclama (`resumen_enviado_dia`, `resumen_semanal_enviado`) antes de
// mandarle nada: aunque el cron corra dos veces, no le llega dos veces.

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }
const RESUMENES = [
  { activo: 'resumen_correo', enviado: 'resumen_enviado_dia', dias: 1 },
  { activo: 'resumen_semanal', enviado: 'resumen_semanal_enviado', dias: 7 },
] as const

// `diaSemanal`: el día (ISO, 1 = lunes) en que sale el semanal; sólo las pruebas lo cambian.
export async function mandarResumenes(db: Db, config: Config, log: Log, diaSemanal = 1): Promise<number> {
  let mandados = 0
  for (const r of RESUMENES) {
    const semanal = r.dias > 1
    const { rows: cuentas } = await db.query(
      `UPDATE usuarios u SET ${r.enviado} = (now() AT TIME ZONE e.zona_horaria)::date
         FROM empresas e
        WHERE e.id_empresa = u.id_empresa AND e.activa AND NOT e.interna
          AND u.rol = 'administrador' AND u.activo AND u.${r.activo}
          AND u.${r.enviado} IS DISTINCT FROM (now() AT TIME ZONE e.zona_horaria)::date
          ${semanal ? 'AND extract(isodow FROM now() AT TIME ZONE e.zona_horaria) = $1' : ''}
        RETURNING u.id_usuario, u.nombre, u.correo, u.id_empresa, e.nombre AS empresa`,
      semanal ? [diaSemanal] : [],
    )
    if (!cuentas.length) continue
    const cifras = new Map<string, CifrasResumen>()
    for (const id of new Set(cuentas.map((c) => c.id_empresa as string))) cifras.set(id, await cifrasDe(db, id, r.dias))
    const msjs = cuentas.map((c) => ({ para: c.correo as string, ...correoResumen(c.nombre, c.empresa, cifras.get(c.id_empresa)!, `${config.urlApp}/admin`) }))
    mandados += await enviarCorreos(config, msjs, log)
  }
  return mandados
}

export const cifrasDeAyer = (db: Db, idEmpresa: string) => cifrasDe(db, idEmpresa, 1)
export const cifrasDeLaSemana = (db: Db, idEmpresa: string) => cifrasDe(db, idEmpresa, 7)

// Los `dias` que terminan ayer, en la zona de la empresa.
async function cifrasDe(db: Db, idEmpresa: string, dias: number): Promise<CifrasResumen> {
  const { rows: [r] } = await db.query(
    `WITH d AS (SELECT (now() AT TIME ZONE zona_horaria)::date - 1 AS hasta, (now() AT TIME ZONE zona_horaria)::date - $2::int AS desde,
                       zona_horaria AS zona FROM empresas WHERE id_empresa = $1),
     v AS (
       SELECT p.total, p.metodo_pago FROM pedidos p, d
        WHERE p.id_empresa = $1 AND p.estado = 'entregado' AND (p.fecha_entregado_real AT TIME ZONE d.zona)::date BETWEEN d.desde AND d.hasta
     )
     SELECT to_char(d.desde, 'YYYY-MM-DD') AS desde, to_char(d.hasta, 'YYYY-MM-DD') AS hasta,
            (SELECT count(*)::int FROM v) AS entregados,
            (SELECT coalesce(sum(total), 0)::float8 FROM v) AS vendido,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE metodo_pago = 'efectivo') AS efectivo,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE metodo_pago = 'transferencia') AS transferencia,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE metodo_pago = 'credito') AS fiado,
            (SELECT coalesce(sum(monto), 0)::float8 FROM abonos a WHERE a.id_empresa = $1 AND a.fecha BETWEEN d.desde AND d.hasta AND a.anulado_en IS NULL) AS abonos,
            (SELECT count(*)::int FROM pedidos p WHERE p.id_empresa = $1 AND p.fecha BETWEEN d.desde AND d.hasta AND p.estado = 'pendiente') AS sin_atender,
            (SELECT count(*)::int FROM cortes_dia c WHERE c.id_empresa = $1 AND c.estado = 'pendiente' AND c.fecha <= d.hasta) AS cortes_por_confirmar,
            (SELECT count(DISTINCT coalesce(n.datos->>'pedidoId', n.datos->'pedidoIds'->>0))::int FROM notificaciones n
              WHERE n.id_empresa = $1 AND n.tipo = 'urgente_sin_atender' AND (n.creado_en AT TIME ZONE d.zona)::date BETWEEN d.desde AND d.hasta) AS urgentes
       FROM d`,
    [idEmpresa, dias],
  )
  return {
    desde: r.desde as string, dia: r.hasta as string,
    entregados: r.entregados, vendido: r.vendido, efectivo: r.efectivo, transferencia: r.transferencia, fiado: r.fiado,
    abonos: r.abonos, sinAtender: r.sin_atender, cortesPorConfirmar: r.cortes_por_confirmar, urgentes: r.urgentes,
  }
}
