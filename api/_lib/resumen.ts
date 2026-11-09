import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import type { Config } from './config.js'
import { correoAnual, correoMensual, correoResumen, correoVendedor, enviarCorreos, type CifrasResumen, type CifrasVendedor } from './correo.js'
import { logrosDelMes, resumenDelAnio, xlsxDelMes } from './cortes.js'
import type { Despachador } from './notificaciones.js'
import type { Db } from './db.js'

// Resumen por correo para el administrador (Configuración → Preferencias): cada administrador que lo pidió recibe lo
// de su empresa en un solo correo (ventas, cobro, fiado, cortes por confirmar, urgentes que se quedaron sin atender),
// en vez de enterarse por un push de cada corte. Dos, cada uno con su interruptor:
//   · diario (usuarios.resumen_correo, migración 030): cada mañana, lo de ayer;
//   · semanal (usuarios.resumen_semanal, migración 031): el día que elija (`resumen_semanal_dia`, 032; lunes de
//     fábrica), los siete días anteriores comparados con los siete de antes («vendiste 12% más»), el mejor día, lo que
//     más se vendió y cada vendedor contra su meta del mes. Los vendedores también lo pueden pedir (PWA Cuenta →
//     Preferencias): a ellos les llega sólo lo suyo, sin costos (`correoVendedor`);
//   · mensual (usuarios.resumen_mensual, migración 033): al cerrar un mes, con el PDF del informe adjunto. El PDF lo
//     dibuja el navegador que cerró el mes (reportePdf.ts) y lo manda a POST /cierres/:mes/correo; el Excel lo arma el
//     servidor y va adjunto también.
// Y el aviso de meta atrasada (`avisarMetasAtrasadas`) y el de racha en riesgo (`avisarRachasEnRiesgo`), también del cron diario.
// Lo llama el cron diario (plataforma.ts, GET /cron/avisos) con la conexión del dueño: cruza empresas. «Ayer» y «lunes»
// salen de la zona de cada empresa. Cada cuenta se reclama (`resumen_enviado_dia`, `resumen_semanal_enviado`) antes de
// mandarle nada: aunque el cron corra dos veces, no le llega dos veces.

type Log = { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }
const RESUMENES = [
  { activo: 'resumen_correo', enviado: 'resumen_enviado_dia', dias: 1 },
  { activo: 'resumen_semanal', enviado: 'resumen_semanal_enviado', dias: 7 },
] as const

export async function mandarResumenes(db: Db, config: Config, log: Log): Promise<number> {
  let mandados = 0
  for (const r of RESUMENES) {
    const semanal = r.dias > 1
    const { rows: cuentas } = await db.query(
      `UPDATE usuarios u SET ${r.enviado} = (now() AT TIME ZONE e.zona_horaria)::date
         FROM empresas e
        WHERE e.id_empresa = u.id_empresa AND e.activa AND NOT e.interna
          AND (u.rol = 'administrador'${semanal ? " OR u.rol = 'vendedor'" : ''}) AND u.activo AND u.${r.activo}
          AND u.${r.enviado} IS DISTINCT FROM (now() AT TIME ZONE e.zona_horaria)::date
          ${semanal ? 'AND extract(isodow FROM now() AT TIME ZONE e.zona_horaria) = u.resumen_semanal_dia' : ''}
        RETURNING u.id_usuario, u.nombre, u.correo, u.rol, u.id_empresa, e.nombre AS empresa`,
    )
    if (!cuentas.length) continue
    const cifras = new Map<string, CifrasResumen>()
    const msjs = []
    for (const c of cuentas) {
      if (c.rol === 'vendedor') {
        msjs.push({ para: c.correo as string, ...correoVendedor(c.nombre, c.empresa, await cifrasVendedor(db, c.id_empresa, c.id_usuario), `${config.urlApp}/`) })
        continue
      }
      if (!cifras.has(c.id_empresa)) cifras.set(c.id_empresa, await cifrasDe(db, c.id_empresa, r.dias))
      msjs.push({ para: c.correo as string, ...correoResumen(c.nombre, c.empresa, cifras.get(c.id_empresa)!, `${config.urlApp}/admin`) })
    }
    mandados += await enviarCorreos(config, msjs, log)
  }
  return mandados
}

export const cifrasDeAyer = (db: Db, idEmpresa: string) => cifrasDe(db, idEmpresa, 1)
export const cifrasDeLaSemana = (db: Db, idEmpresa: string) => cifrasDe(db, idEmpresa, 7)

// Los `dias` que terminan ayer, en la zona de la empresa.
export async function cifrasDe(db: Db, idEmpresa: string, dias: number): Promise<CifrasResumen> {
  const { rows: [r] } = await db.query(
    `WITH d AS (SELECT (now() AT TIME ZONE zona_horaria)::date - 1 AS hasta, (now() AT TIME ZONE zona_horaria)::date - $2::int AS desde,
                       zona_horaria AS zona FROM empresas WHERE id_empresa = $1),
     v AS (
       SELECT p.total, p.metodo_pago FROM pedidos p, d
        WHERE p.id_empresa = $1 AND p.estado = 'entregado' AND (p.fecha_entregado_real AT TIME ZONE d.zona)::date BETWEEN d.desde AND d.hasta
     )
     SELECT to_char(d.desde, 'YYYY-MM-DD') AS desde, to_char(d.hasta, 'YYYY-MM-DD') AS hasta,
            -- Lo vendido en los mismos días justo antes, para comparar (sólo lo usa el semanal).
            (SELECT coalesce(sum(p.total), 0)::float8 FROM pedidos p WHERE p.id_empresa = $1 AND p.estado = 'entregado'
              AND (p.fecha_entregado_real AT TIME ZONE d.zona)::date BETWEEN d.desde - $2::int AND d.hasta - $2::int) AS vendido_antes,
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
    desde: r.desde as string, dia: r.hasta as string, vendidoAntes: dias > 1 ? r.vendido_antes : null,
    semana: dias > 1 ? await detalleDeLaSemana(db, idEmpresa, r.desde, r.hasta) : null,
    entregados: r.entregados, vendido: r.vendido, efectivo: r.efectivo, transferencia: r.transferencia, fiado: r.fiado,
    abonos: r.abonos, sinAtender: r.sin_atender, cortesPorConfirmar: r.cortes_por_confirmar, urgentes: r.urgentes,
  }
}

// El semanal de un vendedor: los siete días que terminan ayer, los siete de antes y lo que va del mes.
export async function cifrasVendedor(db: Db, idEmpresa: string, idVendedor: string): Promise<CifrasVendedor> {
  const { rows: [r] } = await db.query(
    `WITH d AS (SELECT (now() AT TIME ZONE zona_horaria)::date - 1 AS hasta, (now() AT TIME ZONE zona_horaria)::date - 7 AS desde, zona_horaria AS zona
                  FROM empresas WHERE id_empresa = $1),
     v AS (SELECT p.total, (p.fecha_entregado_real AT TIME ZONE d.zona)::date AS dia FROM pedidos p, d
            WHERE p.id_empresa = $1 AND p.id_vendedor = $2 AND p.estado = 'entregado'
              AND (p.fecha_entregado_real AT TIME ZONE d.zona)::date BETWEEN least(d.desde - 7, date_trunc('month', d.hasta)::date) AND d.hasta)
     SELECT to_char(d.desde, 'YYYY-MM-DD') AS desde, to_char(d.hasta, 'YYYY-MM-DD') AS hasta,
            (SELECT count(*)::int FROM v WHERE v.dia BETWEEN d.desde AND d.hasta) AS pedidos,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE v.dia BETWEEN d.desde AND d.hasta) AS vendido,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE v.dia BETWEEN d.desde - 7 AND d.hasta - 7) AS antes,
            (SELECT coalesce(sum(total), 0)::float8 FROM v WHERE v.dia >= date_trunc('month', d.hasta)::date) AS mes,
            (SELECT meta_mensual::float8 FROM usuarios WHERE id_usuario = $2) AS meta,
            round(100.0 * extract(day FROM d.hasta) / extract(day FROM date_trunc('month', d.hasta) + interval '1 month - 1 day'))::int AS avance
       FROM d`,
    [idEmpresa, idVendedor],
  )
  return { desde: r.desde, dia: r.hasta, pedidos: r.pedidos, vendido: r.vendido, vendidoAntes: r.antes, mes: r.mes, meta: r.meta, avanceMesPct: r.avance }
}

// Cron diario, a mitad de mes (días 15 a 20 en la zona de cada empresa): si un vendedor con meta lleva menos del
// `empresas.ritmo_meta_pct` (70% de fábrica, migración 034) de lo que debería a estas alturas, se avisa a los administradores. Una vez al mes por vendedor (`datos.vendedorIds`).
// Cruza empresas: la conexión del dueño. `dias` sólo lo cambian las pruebas.
export async function avisarMetasAtrasadas(db: Db, despachador: Despachador, dias: [number, number] = [15, 20]): Promise<number> {
  const { rows } = await db.query(
    `WITH f AS (
       SELECT id_empresa, zona_horaria AS z, (now() AT TIME ZONE zona_horaria)::date AS hoy,
              date_trunc('month', (now() AT TIME ZONE zona_horaria)::date)::date AS ini, ritmo_meta_pct / 100.0 AS ritmo
         FROM empresas WHERE activa AND NOT interna
     )
     SELECT u.id_usuario, u.id_empresa, u.nombre, u.meta_mensual::float8 AS meta,
            coalesce((SELECT sum(p.total) FROM pedidos p
                       WHERE p.id_empresa = u.id_empresa AND p.id_vendedor = u.id_usuario AND p.estado = 'entregado'
                         AND (p.fecha_entregado_real AT TIME ZONE f.z)::date >= f.ini AND (p.fecha_entregado_real AT TIME ZONE f.z)::date < f.hoy), 0)::float8 AS vendido,
            (extract(day FROM f.hoy) - 1) / extract(day FROM f.ini + interval '1 month - 1 day') AS avance, f.ritmo
       FROM f JOIN usuarios u ON u.id_empresa = f.id_empresa AND u.rol = 'vendedor' AND u.activo AND u.meta_mensual > 0
      WHERE extract(day FROM f.hoy) BETWEEN $1 AND $2
        AND NOT EXISTS (SELECT 1 FROM notificaciones n
                         WHERE n.id_empresa = u.id_empresa AND n.tipo = 'meta_atrasada' AND n.creado_en >= (f.ini::timestamp AT TIME ZONE f.z)
                           AND coalesce(n.datos->'vendedorIds', '[]') ? u.id_usuario::text)`,
    dias,
  )
  const atrasados = rows.filter((r) => r.vendido < r.meta * Number(r.avance) * Number(r.ritmo))
  if (!atrasados.length) return 0
  const { rows: admins } = await db.query(
    `SELECT id_usuario, id_empresa FROM usuarios WHERE rol = 'administrador' AND activo AND id_empresa = ANY($1::uuid[])`,
    [[...new Set(atrasados.map((r) => r.id_empresa))]],
  )
  const pesos = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
  await despachador.despachar(atrasados.flatMap((r) => admins.filter((a) => a.id_empresa === r.id_empresa).map((a) => ({
    para: a.id_usuario as string, tipo: 'meta_atrasada' as const, titulo: 'Vendedor atrasado con su meta',
    cuerpo: `${r.nombre} lleva ${pesos(r.vendido)} de ${pesos(r.meta)} (${Math.round((r.vendido / r.meta) * 100)}%) y el mes va en ${Math.round(Number(r.avance) * 100)}%`,
    datos: { url: `/admin?ir=equipo&persona=${r.id_usuario}`, vendedorIds: [r.id_usuario as string] },
  }))))
  return atrasados.length
}

// Cron diario, el 1 de enero en la zona de cada empresa: el año que terminó en números. A cada administrador activo le
// llega el aviso `resumen_anual` (abre el panel) y, si pidió el informe de cada mes, también por correo. Una vez por año
// y empresa: el aviso guardado cuenta (no se puede apagar, para que sirva de marca). Sin meses cerrados no sale nada.
// `cualquierDia` sólo para pruebas.
export async function mandarResumenAnual(db: Db, config: Config, despachador: Despachador | null, log: Log, cualquierDia = false): Promise<number> {
  const { rows: empresas } = await db.query(
    `SELECT e.id_empresa, e.nombre, extract(year FROM now() AT TIME ZONE e.zona_horaria)::int - 1 AS anio
       FROM empresas e
      WHERE e.activa AND NOT e.interna
        AND ($1 OR to_char(now() AT TIME ZONE e.zona_horaria, 'MM-DD') = '01-01')
        AND NOT EXISTS (SELECT 1 FROM notificaciones n WHERE n.id_empresa = e.id_empresa AND n.tipo = 'resumen_anual'
                         AND n.creado_en >= date_trunc('year', now() AT TIME ZONE e.zona_horaria) AT TIME ZONE e.zona_horaria)`,
    [cualquierDia],
  )
  let mandados = 0
  for (const e of empresas) {
    const r = await resumenDelAnio(db, e.anio, e.id_empresa)
    if (!r.meses.length) continue
    const { rows: admins } = await db.query(
      `SELECT id_usuario, nombre, correo, resumen_mensual FROM usuarios WHERE id_empresa = $1 AND rol = 'administrador' AND activo`, [e.id_empresa])
    if (!admins.length) continue
    const pesos = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
    await despachador?.despachar(admins.map((a) => ({
      para: a.id_usuario as string, tipo: 'resumen_anual' as const, titulo: `Tu ${r.anio} en números`,
      cuerpo: `Vendiste ${pesos(r.total)} en ${r.anio}${r.vendedorDelAnio ? `; vendedor del año: ${r.vendedorDelAnio.nombre}` : ''}. ¡Feliz año nuevo!`,
      datos: { url: '/admin' },
    })))
    const correos = admins.filter((a) => a.resumen_mensual && a.correo)
      .map((a) => ({ para: a.correo as string, ...correoAnual(a.nombre, e.nombre, r, `${config.urlApp}/admin`) }))
    if (correos.length) mandados += await enviarCorreos(config, correos, log)
  }
  return mandados
}

// Cron diario, al final del mes (del 25 en adelante en la zona de cada empresa): al vendedor que llegó a su meta el mes
// pasado (cierre guardado) y este mes todavía no, se le avisa cuánto le falta para no cortar su racha. Una vez al mes.
// Las ventas se cuentan como en GET /mi-meta. Cruza empresas: la conexión del dueño. `dias` sólo lo cambian las pruebas.
export async function avisarRachasEnRiesgo(db: Db, despachador: Despachador, dias: [number, number] = [25, 31]): Promise<number> {
  const { rows } = await db.query(
    `WITH f AS (
       SELECT id_empresa, zona_horaria AS z, (now() AT TIME ZONE zona_horaria)::date AS hoy,
              date_trunc('month', (now() AT TIME ZONE zona_horaria)::date)::date AS ini
         FROM empresas WHERE activa AND NOT interna
     )
     SELECT u.id_usuario, u.meta_mensual::float8 AS meta,
            coalesce((SELECT sum(d.subtotal) FROM pedidos p JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
                       WHERE p.id_empresa = u.id_empresa AND p.id_vendedor = u.id_usuario AND p.estado = 'entregado'
                         AND p.fecha >= f.ini AND p.fecha < (f.ini + interval '1 month')::date), 0)::float8 AS vendido,
            ARRAY(SELECT c.mes::text FROM cierres_mes c, jsonb_array_elements(c.cifras->'vendedores') v
                   WHERE c.id_empresa = u.id_empresa AND c.estado = 'cerrado' AND c.mes < f.ini AND v->>'id' = u.id_usuario::text
                     AND (v->>'meta')::float8 > 0 AND (v->>'cumplimientoPct')::float8 >= 100
                   ORDER BY c.mes DESC) AS cumplidos,
            (f.ini - interval '1 month')::date::text AS pasado
       FROM f JOIN usuarios u ON u.id_empresa = f.id_empresa AND u.rol = 'vendedor' AND u.activo AND u.meta_mensual > 0
      WHERE extract(day FROM f.hoy) BETWEEN $1 AND $2
        AND NOT EXISTS (SELECT 1 FROM notificaciones n
                         WHERE n.id_empresa = u.id_empresa AND n.id_usuario = u.id_usuario AND n.tipo = 'racha_en_riesgo'
                           AND n.creado_en >= (f.ini::timestamp AT TIME ZONE f.z))`,
    dias,
  )
  const pesos = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
  const avisos = rows.flatMap((r) => {
    if (r.vendido >= r.meta) return []
    const racha = rachaDesde(r.cumplidos as string[], r.pasado as string)
    if (!racha) return []
    return [{
      para: r.id_usuario as string, tipo: 'racha_en_riesgo' as const, titulo: '¡Que no se corte tu racha!',
      cuerpo: `Llevas ${racha === 1 ? 'un mes' : `${racha} meses seguidos`} llegando a tu meta. Te faltan ${pesos(r.meta - r.vendido)} este mes.`,
      datos: { pestana: 'cuenta' as const },
    }]
  })
  if (avisos.length) await despachador.despachar(avisos)
  return avisos.length
}

// Cuántos meses seguidos hay en `meses` ('YYYY-MM…') contando hacia atrás desde `desde` (incluido).
export function rachaDesde(meses: string[], desde: string): number {
  const hay = new Set(meses.map((m) => m.slice(0, 7)))
  let [a, m] = desde.slice(0, 7).split('-').map(Number)
  let n = 0
  while (hay.has(`${a}-${String(m).padStart(2, '0')}`)) {
    n++
    if (--m === 0) { m = 12; a-- }
  }
  return n
}

// Al sincronizar ventas del vendedor (sync/rutas.ts): si con ellas llegó a su meta del mes, se le felicita y se avisa a
// los administradores (`vendedor_en_meta`). Una vez al mes: cualquiera de los dos avisos guardado cuenta. Las ventas se
// cuentan como en GET /mi-meta (pedidos entregados con fecha del mes), para que cuadre con su barra de avance.
export async function felicitarMeta(db: Db, despachador: Despachador, idVendedor: string): Promise<boolean> {
  const { rows: [r] } = await db.query(
    `SELECT u.nombre, u.id_empresa, u.meta_mensual::float8 AS meta,
            (SELECT coalesce(sum(d.subtotal), 0)::float8 FROM pedidos p JOIN detalle_pedido d ON d.id_pedido = p.id_pedido
              WHERE p.id_empresa = u.id_empresa AND p.id_vendedor = u.id_usuario AND p.estado = 'entregado'
                AND p.fecha >= date_trunc('month', now() AT TIME ZONE e.zona_horaria)::date
                AND p.fecha < (date_trunc('month', now() AT TIME ZONE e.zona_horaria) + interval '1 month')::date) AS vendido
       FROM usuarios u JOIN empresas e ON e.id_empresa = u.id_empresa
      WHERE u.id_usuario = $1 AND u.rol = 'vendedor' AND u.activo AND u.meta_mensual > 0
        AND NOT EXISTS (SELECT 1 FROM notificaciones n
                         WHERE n.id_empresa = u.id_empresa AND n.tipo IN ('meta_alcanzada', 'vendedor_en_meta')
                           AND (n.id_usuario = u.id_usuario OR coalesce(n.datos->'vendedorIds', '[]') ? u.id_usuario::text)
                           AND n.creado_en >= date_trunc('month', now() AT TIME ZONE e.zona_horaria) AT TIME ZONE e.zona_horaria)`,
    [idVendedor],
  )
  if (!r || r.vendido < r.meta) return false
  const pesos = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
  const { rows: admins } = await db.query(`SELECT id_usuario FROM usuarios WHERE id_empresa = $1 AND rol = 'administrador' AND activo`, [r.id_empresa])
  await despachador.despachar([
    { para: idVendedor, tipo: 'meta_alcanzada', titulo: '¡Llegaste a tu meta del mes!', cuerpo: `Llevas ${pesos(r.vendido)} de ${pesos(r.meta)}. ¡Muy bien!`, datos: { pestana: 'cuenta' } },
    ...admins.map((a) => ({
      para: a.id_usuario as string, tipo: 'vendedor_en_meta' as const, titulo: 'Un vendedor llegó a su meta',
      cuerpo: `${r.nombre} lleva ${pesos(r.vendido)} de ${pesos(r.meta)}`,
      datos: { url: `/admin?ir=equipo&persona=${idVendedor}`, vendedorIds: [idVendedor] },
    })),
  ])
  return true
}

// Lo que sólo trae el semanal. El mes de cada vendedor va del día 1 del mes de `hasta` hasta `hasta`.
async function detalleDeLaSemana(db: Db, idEmpresa: string, desde: string, hasta: string): Promise<NonNullable<CifrasResumen['semana']>> {
  const entregados = `SELECT p.id_pedido, p.total, p.id_vendedor, (p.fecha_entregado_real AT TIME ZONE e.zona_horaria)::date AS dia
                        FROM pedidos p JOIN empresas e ON e.id_empresa = p.id_empresa
                       WHERE p.id_empresa = $1 AND p.estado = 'entregado'`
  const [dia, sabor, vendedores, cobro] = await Promise.all([
    db.query(`SELECT to_char(dia, 'YYYY-MM-DD') AS dia, sum(total)::float8 AS vendido FROM (${entregados}) v
               WHERE dia BETWEEN $2::date AND $3::date GROUP BY dia ORDER BY 2 DESC, 1 LIMIT 1`, [idEmpresa, desde, hasta]),
    db.query(`SELECT pr.sabor AS nombre, sum(dp.subtotal)::float8 AS vendido FROM (${entregados}) v
                JOIN detalle_pedido dp ON dp.id_pedido = v.id_pedido JOIN productos pr ON pr.id_producto = dp.id_producto
               WHERE v.dia BETWEEN $2::date AND $3::date GROUP BY pr.sabor ORDER BY 2 DESC, 1 LIMIT 1`, [idEmpresa, desde, hasta]),
    db.query(`SELECT u.nombre, u.meta_mensual::float8 AS meta,
                     coalesce(sum(v.total) FILTER (WHERE v.dia BETWEEN $2::date AND $3::date), 0)::float8 AS semana,
                     coalesce(sum(v.total) FILTER (WHERE v.dia BETWEEN date_trunc('month', $3::date)::date AND $3::date), 0)::float8 AS mes
                FROM usuarios u LEFT JOIN (${entregados}) v ON v.id_vendedor = u.id_usuario
               WHERE u.id_empresa = $1 AND u.rol = 'vendedor' AND u.activo
               GROUP BY u.id_usuario, u.nombre, u.meta_mensual
              HAVING coalesce(sum(v.total) FILTER (WHERE v.dia BETWEEN $2::date AND $3::date), 0) > 0 OR u.meta_mensual IS NOT NULL
               ORDER BY 3 DESC, 1`, [idEmpresa, desde, hasta]),
    // Lo fiado (hasta el último día) menos los abonos no anulados: los abonos nunca pasan del saldo de cada cliente.
    db.query(`SELECT (SELECT coalesce(sum(total), 0) FROM pedidos WHERE id_empresa = $1 AND estado = 'entregado' AND metodo_pago = 'credito' AND fecha <= $2::date)
                   - (SELECT coalesce(sum(monto), 0) FROM abonos WHERE id_empresa = $1 AND anulado_en IS NULL AND fecha <= $2::date) AS saldo`, [idEmpresa, hasta]),
  ])
  return {
    mejorDia: dia.rows[0] ? { dia: dia.rows[0].dia, vendido: dia.rows[0].vendido } : null,
    sabor: sabor.rows[0] ? { nombre: sabor.rows[0].nombre, vendido: sabor.rows[0].vendido } : null,
    vendedores: vendedores.rows.map((v) => ({ nombre: v.nombre, semana: v.semana, mes: v.mes, meta: v.meta })),
    porCobrar: Math.max(0, Math.round(Number(cobro.rows[0].saldo) * 100) / 100),
  }
}

// «Mandar uno ahora» (Preferencias): el administrador ve cómo le llega, sin esperar al cron. No cuenta como el del día:
// el del cron sale igual.
type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>
const bodyAhora = z.object({ tipo: z.enum(['diario', 'semanal']) }).strict()
export async function rutasResumen(app: FastifyInstance, { db, config }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }) {
  app.post('/me/resumen/ahora', { preHandler: requiereAdmin, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyAhora.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Indica cuál resumen: diario o semanal' })
    if (!config.resendApiKey && config.produccion) return rep.code(409).send({ error: 'Este servidor todavía no tiene configurado el correo', codigo: 'CORREO_NO_CONFIGURADO' })
    const { rows: [u] } = await db.query(
      `SELECT u.nombre, u.correo, e.nombre AS empresa FROM usuarios u JOIN empresas e ON e.id_empresa = u.id_empresa WHERE u.id_usuario = $1`,
      [req.usuario.id],
    )
    const cifras = await cifrasDe(db, req.usuario.empresa, b.data.tipo === 'semanal' ? 7 : 1)
    await enviarCorreos(config, [{ para: u.correo, ...correoResumen(u.nombre, u.empresa, cifras, `${config.urlApp}/admin`) }], req.log)
    return { para: u.correo as string }
  })

  // El informe del mes cerrado, a los administradores que lo pidieron, con el PDF que armó el navegador que lo cerró.
  // Vercel no deja pasar más de 4.5 MB por petición: el PDF va en base64 y hasta unos 3 MB.
  const bodyCorreoMes = z.object({ pdf: z.string().min(8).max(4_300_000).regex(/^[A-Za-z0-9+/]+=*$/, 'El PDF no es válido') }).strict()
  app.post('/cierres/:mes/correo', { preHandler: requiereAdmin, bodyLimit: 4_400_000, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, rep) => {
    const m = z.object({ mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse(req.params)
    const b = bodyCorreoMes.safeParse(req.body)
    if (!m.success) return rep.code(400).send({ error: 'El mes va como AAAA-MM' })
    if (!b.success || !Buffer.from(b.data.pdf.slice(0, 12), 'base64').toString('latin1').startsWith('%PDF-')) return rep.code(400).send({ error: 'El informe no es un PDF' })
    const { rows: [c] } = await db.query(`SELECT estado, cifras FROM cierres_mes WHERE mes = $1::date`, [`${m.data.mes}-01`])
    if (c?.estado !== 'cerrado') return rep.code(409).send({ error: 'Ese mes no está cerrado' })
    const { rows: para } = await db.query(
      `SELECT u.nombre, u.correo, e.nombre AS empresa FROM usuarios u JOIN empresas e ON e.id_empresa = u.id_empresa
        WHERE u.id_empresa = $1 AND u.rol = 'administrador' AND u.activo AND u.resumen_mensual`,
      [req.usuario.empresa],
    )
    if (!para.length) return { enviados: 0 }
    const f = c.cifras
    const cifras = {
      ingreso: f.ventas.ingreso, utilidad: f.ventas.utilidad, pedidos: f.ventas.pedidos, porCobrar: f.porCobrar.saldo,
      vendedores: (f.vendedores as { nombre: string; ventas: number; meta: number | null; cumplimientoPct: number | null }[])
        .map((v) => ({ nombre: v.nombre, ventas: v.ventas, meta: v.meta, cumplimientoPct: v.cumplimientoPct })),
    }
    const adjuntos = [
      { nombre: `informe-mensual-${m.data.mes}.pdf`, base64: b.data.pdf },
      { nombre: `informe-mensual-${m.data.mes}.xlsx`, base64: xlsxDelMes(f, m.data.mes, 'Mes cerrado', await logrosDelMes(db, config.zonaHoraria, m.data.mes).catch(() => undefined)).toString('base64') },
    ]
    const enviados = await enviarCorreos(config, para.map((u) => ({ para: u.correo as string, ...correoMensual(u.nombre, u.empresa, m.data.mes, cifras, `${config.urlApp}/admin`), adjuntos })), req.log)
    return { enviados }
  })
}
