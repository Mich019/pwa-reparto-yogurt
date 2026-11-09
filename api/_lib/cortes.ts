import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { rachaDesde } from './resumen.js'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { comoFalla, Falla, redondear, saldos } from './cobranza.js'
import { saldosEnvases } from './envases.js'
import { tx, type Cx, type Db } from './db.js'
import { aXlsx, type Tabla, type Valor } from './exportar.js'
import { hoyEn, zonaDeEmpresa } from './fechas.js'
import type { Despachador } from './notificaciones.js'

// Corte del día, cierre de mes e informe mensual.
//  · Corte del día: cada vendedor dice cuánto efectivo entrega; el sistema sabe cuánto debía (lo cobrado en efectivo,
//    ventas y abonos) y el administrador lo confirma. La diferencia queda a la vista.
//  · Cierre de mes: guarda una foto de las cifras del mes y bloquea sus correcciones (trigger fn_*_mes_cerrado). Se
//    puede reabrir anotando el motivo; todo queda en el historial.
//  · Informe mensual: ventas y utilidad, cobranza y comisión por vendedor, y las diferencias de los cortes.
// Estas cifras llevan costos y utilidad: las rutas del mes son del administrador. El vendedor sólo ve su propio corte y su meta.

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>
type Consulta = Pick<Db, 'query'> | Cx

const fechaIso = z.iso.date()
const mesTexto = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El mes va como AAAA-MM')
const dinero = z.number().finite().min(0).max(99_999_999)
const idParam = z.object({ id: z.uuid() })
const num = (x: unknown) => (x === null || x === undefined ? 0 : Number(x))

// ------------------------------------------------------------------ corte del día

// «6 nov.» para los avisos.
export const diaCorto = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export interface CifrasDia { esperado: number; efectivoVentas: number; efectivoAbonos: number; transferencias: number; credito: number }

// Lo que un vendedor cobró ese día. El efectivo esperado = ventas pagadas en efectivo + abonos recibidos en efectivo.
// `idVendedor` null = todos los vendedores de una vez (dos consultas en total, no dos por vendedor).
async function cifrasPorVendedor(q: Consulta, fecha: string, idVendedor: string | null): Promise<Map<string, CifrasDia>> {
  const { rows: ventas } = await q.query(
    `SELECT id_vendedor, coalesce(sum(total) FILTER (WHERE metodo_pago = 'efectivo'), 0)::float8 AS efectivo,
            coalesce(sum(total) FILTER (WHERE metodo_pago = 'transferencia'), 0)::float8 AS transferencia,
            coalesce(sum(total) FILTER (WHERE metodo_pago = 'credito'), 0)::float8 AS credito
       FROM pedidos WHERE estado = 'entregado' AND fecha = $1 AND ($2::uuid IS NULL OR id_vendedor = $2) GROUP BY id_vendedor`,
    [fecha, idVendedor],
  )
  const { rows: abonos } = await q.query(
    `SELECT id_vendedor, coalesce(sum(monto) FILTER (WHERE metodo = 'efectivo'), 0)::float8 AS efectivo,
            coalesce(sum(monto) FILTER (WHERE metodo = 'transferencia'), 0)::float8 AS transferencia
       FROM abonos WHERE anulado_en IS NULL AND fecha = $1 AND ($2::uuid IS NULL OR id_vendedor = $2) GROUP BY id_vendedor`,
    [fecha, idVendedor],
  )
  const porAbono = new Map(abonos.map((a) => [a.id_vendedor as string, a]))
  const ids = new Set([...ventas.map((v) => v.id_vendedor as string), ...porAbono.keys()])
  const porVenta = new Map(ventas.map((v) => [v.id_vendedor as string, v]))
  const r = new Map<string, CifrasDia>()
  for (const id of ids) {
    const v = porVenta.get(id) ?? { efectivo: 0, transferencia: 0, credito: 0 }
    const a = porAbono.get(id) ?? { efectivo: 0, transferencia: 0 }
    r.set(id, {
      esperado: redondear(v.efectivo + a.efectivo), efectivoVentas: redondear(v.efectivo), efectivoAbonos: redondear(a.efectivo),
      transferencias: redondear(v.transferencia + a.transferencia), credito: redondear(v.credito),
    })
  }
  return r
}

const SIN_MOVIMIENTO: CifrasDia = { esperado: 0, efectivoVentas: 0, efectivoAbonos: 0, transferencias: 0, credito: 0 }

export async function cifrasDelDia(q: Consulta, fecha: string, idVendedor: string): Promise<CifrasDia> {
  return (await cifrasPorVendedor(q, fecha, idVendedor)).get(idVendedor) ?? SIN_MOVIMIENTO
}

interface FilaCorte {
  id: string; fecha: string; vendedorId: string; vendedor: string
  esperado: number; transferencias: number; credito: number
  entregado: number | null; diferencia: number | null; nota: string | null
  estado: 'sin_corte' | 'pendiente' | 'confirmado'
  confirmadoPor: string | null; confirmadoEn: string | null; notaAdmin: string | null
  reabierto: { motivo: string; en: string } | null // la última vez que el administrador lo reabrió, mientras siga pendiente
  // Confirmado, pero el efectivo de ese día cambió después (una venta que sincronizó tarde, un abono anulado): cuánto
  // más (o menos, negativo) se debería entregar hoy contra lo que se confirmó. Es la señal para reabrirlo.
  cambioDespues: number | null
}

const ultimaReapertura = (h: { accion: string; en: string; motivo?: string }[] | null) => {
  const r = (h ?? []).findLast((e) => e.accion === 'reabierto')
  return r ? { motivo: r.motivo ?? '', en: r.en } : null
}

const bodyCorte = z.object({ fecha: fechaIso.optional(), efectivoEntregado: dinero, nota: z.string().trim().max(300).optional(), vendedorId: z.uuid().optional() })
const bodyConfirmar = z.object({ nota: z.string().trim().max(300).optional() })

// ------------------------------------------------------------------ cifras del mes

export interface CifrasMes {
  mes: string
  desde: string
  hasta: string
  ventas: { ingreso: number; costo: number; utilidad: number; margenPct: number | null; pedidos: number; clientes: number; porUnidad: Record<string, number> }
  cobro: { efectivo: number; transferencia: number; credito: number }
  abonos: { efectivo: number; transferencia: number; total: number }
  porCobrar: { saldo: number; clientes: number }
  envases: { prestados: number; clientes: number }
  vendedores: {
    id: string; nombre: string; activo: boolean; ventas: number; utilidad: number; pedidos: number
    efectivo: number; transferencia: number; credito: number; abonos: number
    comisionPct: number; comision: number; meta: number | null; cumplimientoPct: number | null
  }[]
  cortes: {
    dias: number; confirmados: number; pendientes: number; sinCorte: number; diferencia: number
    detalle: { fecha: string; vendedor: string; esperado: number; entregado: number; diferencia: number; estado: string }[]
  }
}

const primerDia = (mes: string) => `${mes}-01`
const ultimoDia = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10)
}

export async function cifrasDelMes(q: Consulta, mes: string): Promise<CifrasMes> {
  const desde = primerDia(mes)
  const hasta = ultimoDia(mes)
  const [{ rows: [t] }, { rows: unidades }, { rows: porVend }, { rows: abonosVend }, { rows: gente }, { rows: cortes }] = await Promise.all([
    q.query(
      `SELECT coalesce(sum(d.subtotal), 0)::float8 AS ingreso, coalesce(sum(d.cantidad * d.costo_unitario), 0)::float8 AS costo,
              count(DISTINCT pe.id_pedido)::int AS pedidos, count(DISTINCT pe.id_cliente)::int AS clientes,
              coalesce(sum(d.subtotal) FILTER (WHERE pe.metodo_pago = 'efectivo'), 0)::float8 AS efectivo,
              coalesce(sum(d.subtotal) FILTER (WHERE pe.metodo_pago = 'transferencia'), 0)::float8 AS transferencia,
              coalesce(sum(d.subtotal) FILTER (WHERE pe.metodo_pago = 'credito'), 0)::float8 AS credito
         FROM pedidos pe JOIN detalle_pedido d USING (id_pedido)
        WHERE pe.estado = 'entregado' AND pe.fecha BETWEEN $1 AND $2`,
      [desde, hasta],
    ),
    q.query(
      `SELECT pr.unidad, sum(d.cantidad * pr.presentacion_litros)::float8 AS n
         FROM pedidos pe JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)
        WHERE pe.estado = 'entregado' AND pe.fecha BETWEEN $1 AND $2 GROUP BY pr.unidad ORDER BY pr.unidad`,
      [desde, hasta],
    ),
    q.query(
      `SELECT pe.id_vendedor, sum(d.subtotal)::float8 AS ventas, sum(d.cantidad * d.costo_unitario)::float8 AS costo, count(DISTINCT pe.id_pedido)::int AS pedidos,
              coalesce(sum(d.subtotal) FILTER (WHERE pe.metodo_pago = 'efectivo'), 0)::float8 AS efectivo,
              coalesce(sum(d.subtotal) FILTER (WHERE pe.metodo_pago = 'transferencia'), 0)::float8 AS transferencia,
              coalesce(sum(d.subtotal) FILTER (WHERE pe.metodo_pago = 'credito'), 0)::float8 AS credito
         FROM pedidos pe JOIN detalle_pedido d USING (id_pedido)
        WHERE pe.estado = 'entregado' AND pe.fecha BETWEEN $1 AND $2 GROUP BY pe.id_vendedor`,
      [desde, hasta],
    ),
    q.query(
      `SELECT id_vendedor, metodo, sum(monto)::float8 AS n FROM abonos WHERE anulado_en IS NULL AND fecha BETWEEN $1 AND $2 GROUP BY 1, 2`,
      [desde, hasta],
    ),
    q.query(`SELECT id_usuario, nombre, activo, comision_pct::float8 AS pct, meta_mensual::float8 AS meta FROM usuarios WHERE rol = 'vendedor'`),
    q.query(
      `SELECT c.fecha::text, u.nombre, c.efectivo_esperado::float8 AS esperado, c.efectivo_entregado::float8 AS entregado, c.diferencia::float8 AS diferencia, c.estado
         FROM cortes_dia c JOIN usuarios u ON u.id_usuario = c.id_vendedor WHERE c.fecha BETWEEN $1 AND $2 ORDER BY c.fecha, lower(u.nombre)`,
      [desde, hasta],
    ),
  ])
  const deuda = await saldos(q as Db, { hasta })
  const prestados = (await saldosEnvases(q as Db, { hasta })).filter((e) => e.prestados > 0)
  const ab = new Map<string, { efectivo: number; transferencia: number }>()
  for (const a of abonosVend) {
    const k = (a.id_vendedor ?? '') as string
    const x = ab.get(k) ?? ab.set(k, { efectivo: 0, transferencia: 0 }).get(k)!
    x[a.metodo as 'efectivo' | 'transferencia'] += a.n
  }
  const abonosTotales = { efectivo: 0, transferencia: 0 }
  for (const x of ab.values()) { abonosTotales.efectivo += x.efectivo; abonosTotales.transferencia += x.transferencia }

  const vend = new Map(porVend.map((r) => [r.id_vendedor as string | null, r]))
  const vendedores = gente
    .filter((g) => g.activo || vend.has(g.id_usuario) || ab.has(g.id_usuario))
    .map((g) => {
      const v = vend.get(g.id_usuario)
      const a = ab.get(g.id_usuario) ?? { efectivo: 0, transferencia: 0 }
      const ventas = num(v?.ventas)
      return {
        id: g.id_usuario as string, nombre: g.nombre as string, activo: g.activo as boolean,
        ventas: redondear(ventas), utilidad: redondear(ventas - num(v?.costo)), pedidos: num(v?.pedidos),
        efectivo: redondear(num(v?.efectivo)), transferencia: redondear(num(v?.transferencia)), credito: redondear(num(v?.credito)),
        abonos: redondear(a.efectivo + a.transferencia),
        comisionPct: g.pct as number, comision: redondear((ventas * g.pct) / 100),
        meta: g.meta as number | null, cumplimientoPct: g.meta ? redondear((ventas / g.meta) * 100) : null,
      }
    })
    .sort((x, y) => y.ventas - x.ventas || x.nombre.localeCompare(y.nombre))

  const diasCorte = cortes.map((c) => ({ fecha: c.fecha as string, vendedor: c.nombre as string, esperado: redondear(c.esperado), entregado: redondear(c.entregado), diferencia: redondear(c.diferencia), estado: c.estado as string }))
  // Días con efectivo por entregar que nadie cortó: vendedor y día con ventas en efectivo o abonos en efectivo sin corte.
  const { rows: [{ n: sinCorte }] } = await q.query(
    `SELECT count(*)::int AS n FROM (
       SELECT id_vendedor, fecha FROM pedidos WHERE estado = 'entregado' AND metodo_pago = 'efectivo' AND fecha BETWEEN $1 AND $2 AND id_vendedor IS NOT NULL
       UNION
       SELECT id_vendedor, fecha FROM abonos WHERE anulado_en IS NULL AND metodo = 'efectivo' AND fecha BETWEEN $1 AND $2 AND id_vendedor IS NOT NULL
     ) x WHERE NOT EXISTS (SELECT 1 FROM cortes_dia c WHERE c.fecha = x.fecha AND c.id_vendedor = x.id_vendedor)`,
    [desde, hasta],
  )
  const ingreso = redondear(t.ingreso)
  const utilidad = redondear(t.ingreso - t.costo)
  return {
    mes, desde, hasta,
    ventas: { ingreso, costo: redondear(t.costo), utilidad, margenPct: ingreso > 0 ? redondear((utilidad / ingreso) * 100) : null, pedidos: t.pedidos, clientes: t.clientes, porUnidad: Object.fromEntries(unidades.map((u) => [u.unidad, redondear(u.n)])) },
    cobro: { efectivo: redondear(t.efectivo), transferencia: redondear(t.transferencia), credito: redondear(t.credito) },
    abonos: { efectivo: redondear(abonosTotales.efectivo), transferencia: redondear(abonosTotales.transferencia), total: redondear(abonosTotales.efectivo + abonosTotales.transferencia) },
    porCobrar: { saldo: redondear(deuda.reduce((s, d) => s + d.saldo, 0)), clientes: deuda.length },
    envases: { prestados: prestados.reduce((s, e) => s + e.prestados, 0), clientes: new Set(prestados.map((e) => e.clienteId)).size },
    vendedores,
    cortes: {
      dias: diasCorte.length,
      confirmados: diasCorte.filter((c) => c.estado === 'confirmado').length,
      pendientes: diasCorte.filter((c) => c.estado === 'pendiente').length,
      sinCorte,
      diferencia: redondear(diasCorte.reduce((s, c) => s + c.diferencia, 0)),
      detalle: diasCorte,
    },
  }
}

// El Excel del informe: una hoja con las cifras del mes, otra por vendedor y otra con los cortes.
const pesos = (v: number | null) => ({ v, t: 'dinero' as const })
// El Excel del informe mensual: el de GET /cierres/:mes/informe y el que va adjunto al correo del cierre (resumen.ts).
export const xlsxDelMes = (cifras: CifrasMes, mes: string, subtitulo: string, logros?: LogrosMes) =>
  aXlsx([...hojas(cifras), ...(logros && (logros.medallas.length || logros.fama.length) ? [hojaMedallas(logros)] : [])], { titulo: `Informe mensual ${mes}`, subtitulo })

function hojaMedallas(l: LogrosMes): Tabla {
  const textoMedalla = (n: number) => (n === 12 ? '1 año' : `${n} meses`)
  return {
    nombre: 'Medallas',
    columnas: [
      { titulo: 'Lugar', tipo: 'texto', ancho: 12 }, { titulo: 'Vendedor', tipo: 'texto', ancho: 26 }, { titulo: 'Mejor racha (meses)', tipo: 'entero' },
      { titulo: 'Medalla', tipo: 'texto', ancho: 14 }, { titulo: 'Metas cumplidas', tipo: 'entero' }, { titulo: 'Racha actual', tipo: 'entero' },
    ],
    filas: [
      ...l.medallas.map((m) => ['Ganó este mes', m.nombre, m.medalla, textoMedalla(m.medalla), null, null] as Valor[]),
      ...l.fama.map((f, k) => [`${k + 1}.º de todos`, f.nombre, f.mejorRacha, f.mejorRacha >= 3 ? textoMedalla([12, 6, 3].find((n) => f.mejorRacha >= n)!) : '', f.cumplidos, f.racha] as Valor[]),
    ],
  }
}

function hojas(x: CifrasMes): Tabla[] {
  const resumen: Tabla = {
    nombre: 'Resumen',
    columnas: [{ titulo: 'Concepto', tipo: 'texto', ancho: 34 }, { titulo: 'Cifra', tipo: 'dinero', ancho: 18 }],
    filas: [
      ['Ventas', pesos(x.ventas.ingreso)], ['Costo de producción', pesos(x.ventas.costo)], ['Utilidad', pesos(x.ventas.utilidad)],
      ['Margen', { v: x.ventas.margenPct, t: 'porcentaje' }], ['Pedidos entregados', { v: x.ventas.pedidos, t: 'entero' }], ['Clientes atendidos', { v: x.ventas.clientes, t: 'entero' }],
      ['Vendido en efectivo', pesos(x.cobro.efectivo)], ['Vendido por transferencia', pesos(x.cobro.transferencia)], ['Vendido a crédito (fiado)', pesos(x.cobro.credito)],
      ['Abonos recibidos', pesos(x.abonos.total)], ['Por cobrar al cierre', pesos(x.porCobrar.saldo)],
      ['Envases prestados al cierre', { v: x.envases.prestados, t: 'entero' }],
      ['Diferencia total de los cortes', pesos(x.cortes.diferencia)],
    ],
  }
  const vendedores: Tabla = {
    nombre: 'Vendedores',
    columnas: [
      { titulo: 'Vendedor', tipo: 'texto', ancho: 26 }, { titulo: 'Pedidos', tipo: 'entero' }, { titulo: 'Ventas', tipo: 'dinero' }, { titulo: 'Utilidad', tipo: 'dinero' },
      { titulo: 'Efectivo', tipo: 'dinero' }, { titulo: 'Transferencia', tipo: 'dinero' }, { titulo: 'Fiado', tipo: 'dinero' }, { titulo: 'Abonos', tipo: 'dinero' },
      { titulo: 'Meta', tipo: 'dinero' }, { titulo: 'Cumplimiento', tipo: 'porcentaje' }, { titulo: '% comisión', tipo: 'porcentaje' }, { titulo: 'Comisión', tipo: 'dinero' },
    ],
    filas: x.vendedores.map((v) => [v.nombre + (v.activo ? '' : ' (baja)'), v.pedidos, v.ventas, v.utilidad, v.efectivo, v.transferencia, v.credito, v.abonos, v.meta, v.cumplimientoPct, v.comisionPct, v.comision]),
    total: ['Total', x.vendedores.reduce((s, v) => s + v.pedidos, 0), ...(['ventas', 'utilidad', 'efectivo', 'transferencia', 'credito', 'abonos'] as const).map((k) => redondear(x.vendedores.reduce((s, v) => s + v[k], 0))), null, null, null, redondear(x.vendedores.reduce((s, v) => s + v.comision, 0))],
  }
  const cortes: Tabla = {
    nombre: 'Cortes',
    columnas: [{ titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Vendedor', tipo: 'texto', ancho: 26 }, { titulo: 'Esperado', tipo: 'dinero' }, { titulo: 'Entregado', tipo: 'dinero' }, { titulo: 'Diferencia', tipo: 'dinero' }, { titulo: 'Estado', tipo: 'texto' }],
    filas: x.cortes.detalle.map((c) => [c.fecha, c.vendedor, c.esperado, c.entregado, c.diferencia, c.estado === 'confirmado' ? 'Confirmado' : 'Pendiente']),
  }
  return [resumen, vendedores, cortes]
}

type Historial = { accion: 'cerrado' | 'reabierto'; por: string; en: string; motivo?: string }[]

// ---- metas: rachas, medallas y salón de la fama (de las fotos de los cierres de mes)

const mesAnterior = (hoy: string) => {
  let [a, m] = hoy.slice(0, 7).split('-').map(Number)
  if (--m === 0) { m = 12; a-- }
  return `${a}-${String(m).padStart(2, '0')}`
}
// Los meses cerrados en que cada vendedor llegó a su meta (`id` = uno; null = todos), el más nuevo primero.
async function mesesCumplidosDe(db: Consulta, id: string | null) {
  const { rows } = await db.query(
    `SELECT v->>'id' AS id, v->>'nombre' AS nombre, to_char(c.mes, 'YYYY-MM') AS mes, (v->>'ventas')::float8 AS ventas, (v->>'meta')::float8 AS meta
       FROM cierres_mes c, jsonb_array_elements(c.cifras->'vendedores') v
      WHERE c.estado = 'cerrado' AND ($1::text IS NULL OR v->>'id' = $1) AND (v->>'meta')::float8 > 0 AND (v->>'cumplimientoPct')::float8 >= 100
      ORDER BY c.mes DESC`,
    [id],
  )
  return rows as { id: string; nombre: string; mes: string; ventas: number; meta: number }[]
}
// La mejor racha que ha tenido: las medallas de 3, 6 y 12 meses seguidos se quedan aunque después se corte.
const mejorDe = (meses: string[]) => Math.max(0, ...meses.map((x) => rachaDesde(meses, x)))
// Racha (hasta `pasado`, el mes pasado) y mejor racha de cada vendedor con al menos un mes cumplido, en qué mes ganó
// cada medalla (el primero en que su racha llegó a 3, 6 o 12) y cuántos meses ha cumplido en total (`cumplidos`, para el
// salón de la fama). Incluye a los que ya se fueron: el nombre viene de la foto de cada cierre.
async function rachasDe(db: Consulta, pasado: string) {
  const porVendedor = new Map<string, { nombre: string; meses: string[] }>()
  for (const r of await mesesCumplidosDe(db, null)) {
    const v = porVendedor.get(r.id) ?? { nombre: r.nombre, meses: [] }
    v.meses.push(r.mes)
    porVendedor.set(r.id, v)
  }
  return Object.fromEntries([...porVendedor].map(([id, { nombre, meses }]) => {
    const subiendo = [...meses].sort()
    const medallas = [3, 6, 12].flatMap((n) => {
      const mes = subiendo.find((x) => rachaDesde(meses, x) >= n)
      return mes ? [{ medalla: n, mes }] : []
    })
    return [id, { nombre, racha: rachaDesde(meses, pasado), mejorRacha: mejorDe(meses), medallas, cumplidos: meses.length }]
  }))
}
const ordenFama = (a: { mejorRacha: number; cumplidos: number; nombre: string }, b: { mejorRacha: number; cumplidos: number; nombre: string }) =>
  b.mejorRacha - a.mejorRacha || b.cumplidos - a.cumplidos || a.nombre.localeCompare(b.nombre)

// Para la hoja «Medallas» del Excel del informe: las ganadas con `mes` y las 5 mejores rachas (a la fecha).
export interface LogrosMes { medallas: { nombre: string; medalla: number }[]; fama: { nombre: string; mejorRacha: number; cumplidos: number; racha: number }[] }
export async function logrosDelMes(db: Consulta, zonaRespaldo: string, mes: string): Promise<LogrosMes> {
  const todos = Object.values(await rachasDe(db, mesAnterior(hoyEn(await zonaDeEmpresa(db, zonaRespaldo)))))
  return {
    medallas: todos.flatMap((v) => v.medallas.filter((m) => m.mes === mes).map((m) => ({ nombre: v.nombre, medalla: m.medalla }))),
    fama: [...todos].sort(ordenFama).slice(0, 5).map(({ nombre, mejorRacha, cumplidos, racha }) => ({ nombre, mejorRacha, cumplidos, racha })),
  }
}

export async function rutasCortes(app: FastifyInstance, { db, config }: Contexto, { requiereSesion, requiereAdmin }: { requiereSesion: Guardia; requiereAdmin: Guardia }, despachador?: Despachador) {
  const hoyDe = async () => hoyEn(await zonaDeEmpresa(db, config.zonaHoraria))
  const responder = (rep: FastifyReply, e: unknown) => {
    const f = comoFalla(e)
    if (f instanceof Falla) return rep.code(f.status).send({ error: f.message })
    throw f
  }

  // ---- corte del día
  // El administrador ve a todos los vendedores con movimiento ese día (y los activos); el vendedor, el suyo.
  app.get('/cortes', { preHandler: requiereSesion }, async (req, rep) => {
    const q = z.object({ fecha: fechaIso.optional() }).safeParse(req.query)
    if (!q.success) return rep.code(400).send({ error: 'Fecha inválida (AAAA-MM-DD)' })
    const fecha = q.data.fecha ?? (await hoyDe())
    const esAdmin = req.usuario.rol === 'administrador'
    const { rows: vend } = await db.query(
      `SELECT u.id_usuario, u.nombre FROM usuarios u
        WHERE u.rol = 'vendedor' AND ($2::uuid IS NULL OR u.id_usuario = $2)
          AND (u.activo OR EXISTS (SELECT 1 FROM cortes_dia c WHERE c.id_vendedor = u.id_usuario AND c.fecha = $1)
               OR EXISTS (SELECT 1 FROM pedidos p WHERE p.id_vendedor = u.id_usuario AND p.fecha = $1 AND p.estado = 'entregado'))
        ORDER BY lower(u.nombre)`,
      [fecha, esAdmin ? null : req.usuario.id],
    )
    const { rows: cortes } = await db.query(
      `SELECT c.*, c.efectivo_esperado::float8 AS esp, c.efectivo_entregado::float8 AS ent, c.diferencia::float8 AS dif, c.transferencias::float8 AS tr, c.credito::float8 AS cr,
              c.confirmado_en::text AS conf_en, uc.nombre AS conf_por
         FROM cortes_dia c LEFT JOIN usuarios uc ON uc.id_usuario = c.confirmado_por WHERE c.fecha = $1`,
      [fecha],
    )
    const porVendedor = new Map(cortes.map((c) => [c.id_vendedor as string, c]))
    const cifras = await cifrasPorVendedor(db, fecha, esAdmin ? null : req.usuario.id)
    const filas: FilaCorte[] = []
    for (const v of vend) {
      const c = porVendedor.get(v.id_usuario)
      const hoy = cifras.get(v.id_usuario) ?? SIN_MOVIMIENTO
      filas.push({
        id: c?.id_corte ?? '', fecha, vendedorId: v.id_usuario, vendedor: v.nombre,
        esperado: c?.estado === 'confirmado' ? c.esp : hoy.esperado, transferencias: c?.estado === 'confirmado' ? c.tr : hoy.transferencias, credito: c?.estado === 'confirmado' ? c.cr : hoy.credito,
        entregado: c ? c.ent : null, diferencia: c ? redondear(c.ent - (c.estado === 'confirmado' ? c.esp : hoy.esperado)) : null, nota: c?.nota ?? null,
        estado: c ? c.estado : 'sin_corte', confirmadoPor: c?.conf_por ?? null, confirmadoEn: c?.conf_en ?? null, notaAdmin: c?.nota_admin ?? null,
        reabierto: c?.estado === 'pendiente' ? ultimaReapertura(c.historial) : null,
        cambioDespues: c?.estado === 'confirmado' && Math.abs(hoy.esperado - c.esp) >= 0.01 ? redondear(hoy.esperado - c.esp) : null,
      })
    }
    return { fecha, filas }
  })

  // Cortes confirmados de los últimos 90 días cuyo efectivo cambió después (ventas que sincronizaron tarde, abonos
  // anulados…): para que el administrador sepa cuáles reabrir sin revisar día por día. Una sola consulta.
  app.get('/cortes/descuadres', { preHandler: requiereAdmin }, async () => {
    const desde = await hoyDe() // menos 90 días, en SQL
    const { rows } = await db.query(
      `WITH v AS (SELECT fecha, id_vendedor, sum(total) FILTER (WHERE metodo_pago = 'efectivo') AS e FROM pedidos
                   WHERE estado = 'entregado' AND fecha >= $1::date - 90 GROUP BY 1, 2),
            a AS (SELECT fecha, id_vendedor, sum(monto) FILTER (WHERE metodo = 'efectivo') AS e FROM abonos
                   WHERE anulado_en IS NULL AND fecha >= $1::date - 90 GROUP BY 1, 2)
       SELECT c.id_corte, c.fecha::text, c.id_vendedor, u.nombre, c.efectivo_esperado::float8 AS esp,
              (coalesce(v.e, 0) + coalesce(a.e, 0))::float8 AS ahora
         FROM cortes_dia c JOIN usuarios u ON u.id_usuario = c.id_vendedor
         LEFT JOIN v ON v.fecha = c.fecha AND v.id_vendedor = c.id_vendedor
         LEFT JOIN a ON a.fecha = c.fecha AND a.id_vendedor = c.id_vendedor
        WHERE c.estado = 'confirmado' AND c.fecha >= $1::date - 90 AND abs(coalesce(v.e, 0) + coalesce(a.e, 0) - c.efectivo_esperado) >= 0.01
        ORDER BY c.fecha DESC, lower(u.nombre) LIMIT 50`,
      [desde],
    )
    return {
      cortes: rows.map((r) => ({ id: r.id_corte as string, fecha: r.fecha as string, vendedorId: r.id_vendedor as string, vendedor: r.nombre as string, confirmado: r.esp as number, ahora: redondear(r.ahora), cambio: redondear(r.ahora - r.esp) })),
    }
  })

  // El vendedor entrega su corte (puede corregirlo mientras el administrador no lo confirme). El administrador también
  // puede capturarlo por un vendedor (`vendedorId`).
  app.post('/cortes', { preHandler: requiereSesion, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyCorte.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Indica cuánto efectivo entregas' })
    const esAdmin = req.usuario.rol === 'administrador'
    if (b.data.vendedorId && !esAdmin) return rep.code(403).send({ error: 'Sólo el administrador captura el corte de otro vendedor', codigo: 'SIN_PERMISO' })
    const vendedor = b.data.vendedorId ?? req.usuario.id
    try {
      const hoy = await hoyDe()
      const fecha = b.data.fecha ?? hoy
      if (fecha > hoy) throw new Falla(400, 'No puedes hacer el corte de un día que no ha pasado')
      const r = await tx(db, req.usuario.id, async (c) => {
        const { rows: [u] } = await c.query(`SELECT 1 AS ok FROM usuarios WHERE id_usuario = $1 AND rol = 'vendedor'`, [vendedor])
        if (!u) throw new Falla(404, 'Ese vendedor no existe')
        const x = await cifrasDelDia(c, fecha, vendedor)
        const { rows: [ex] } = await c.query(`SELECT id_corte, estado FROM cortes_dia WHERE fecha = $1 AND id_vendedor = $2 FOR UPDATE`, [fecha, vendedor])
        if (ex?.estado === 'confirmado') throw new Falla(409, 'Ese corte ya está confirmado')
        const { rows: [corte] } = ex
          ? await c.query(
              `UPDATE cortes_dia SET efectivo_esperado = $2, transferencias = $3, credito = $4, efectivo_entregado = $5, nota = $6, actualizado_en = now()
                WHERE id_corte = $1 RETURNING id_corte, diferencia::float8 AS dif`,
              [ex.id_corte, x.esperado, x.transferencias, x.credito, b.data.efectivoEntregado, b.data.nota || null],
            )
          : await c.query(
              `INSERT INTO cortes_dia (fecha, id_vendedor, efectivo_esperado, transferencias, credito, efectivo_entregado, nota)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_corte, diferencia::float8 AS dif`,
              [fecha, vendedor, x.esperado, x.transferencias, x.credito, b.data.efectivoEntregado, b.data.nota || null],
            )
        return { id: corte.id_corte as string, esperado: x.esperado, entregado: b.data.efectivoEntregado, diferencia: redondear(corte.dif) }
      })
      // El vendedor entregó (o corrigió) su corte: los administradores se enteran para confirmarlo. Si lo capturó un
      // administrador, no hace falta.
      if (!esAdmin && despachador) {
        const { rows: [yo] } = await db.query(`SELECT nombre FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
        const { rows: admins } = await db.query(`SELECT id_usuario FROM usuarios WHERE rol = 'administrador' AND activo`)
        const cuadre = r.diferencia === 0 ? 'cuadra' : `${r.diferencia < 0 ? 'faltan' : 'sobran'} $${Math.abs(r.diferencia).toFixed(2)}`
        const dia = fecha === hoy ? 'de hoy' : `del ${diaCorto(fecha)}`
        await despachador.despachar(admins.map((a) => ({
          para: a.id_usuario as string, tipo: 'corte_entregado' as const, titulo: 'Corte por confirmar',
          cuerpo: `${yo?.nombre ?? 'Un vendedor'} entregó su corte ${dia}: $${r.entregado.toFixed(2)} (${cuadre})`, datos: { url: '/admin?ir=cortes' },
        })))
      }
      return rep.code(201).send(r)
    } catch (e) {
      return responder(rep, e)
    }
  })

  // El administrador lo confirma: congela lo esperado con lo que hubo en ese momento.
  app.post('/cortes/:id/confirmar', { preHandler: requiereAdmin }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    const b = bodyConfirmar.safeParse(req.body ?? {})
    if (!p.success || !b.success) return rep.code(400).send({ error: 'Corte no válido' })
    try {
      const r = await tx(db, req.usuario.id, async (c) => {
        const { rows: [k] } = await c.query(`SELECT fecha::text, id_vendedor, estado FROM cortes_dia WHERE id_corte = $1 FOR UPDATE`, [p.data.id])
        if (!k) throw new Falla(404, 'Ese corte no existe')
        if (k.estado === 'confirmado') throw new Falla(409, 'Ese corte ya está confirmado')
        const x = await cifrasDelDia(c, k.fecha, k.id_vendedor)
        const { rows: [corte] } = await c.query(
          `UPDATE cortes_dia SET efectivo_esperado = $2, transferencias = $3, credito = $4, estado = 'confirmado', confirmado_por = $5, confirmado_en = now(), nota_admin = $6, actualizado_en = now(),
                  historial = historial || $7::jsonb
            WHERE id_corte = $1 RETURNING diferencia::float8 AS dif`,
          [p.data.id, x.esperado, x.transferencias, x.credito, req.usuario.id, b.data.nota || null,
            JSON.stringify([{ accion: 'confirmado', por: req.usuario.id, en: new Date().toISOString(), esperado: x.esperado }])],
        )
        return { ok: true, esperado: x.esperado, diferencia: redondear(corte.dif) }
      })
      return r
    } catch (e) {
      return responder(rep, e)
    }
  })

  // Reabrir uno confirmado (con motivo): vuelve a pendiente, lo esperado se recalcula con lo que haya ese día y el
  // vendedor puede corregir lo que entregó. Un mes cerrado no lo permite (trigger cortes_mes_cerrado).
  app.post('/cortes/:id/reabrir', { preHandler: requiereAdmin, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    const b = z.object({ motivo: z.string().trim().min(5, 'Escribe el motivo (al menos 5 letras)').max(300) }).safeParse(req.body)
    if (!p.success) return rep.code(400).send({ error: 'Corte no válido' })
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Escribe el motivo' })
    try {
      await tx(db, req.usuario.id, async (c) => {
        const { rows: [k] } = await c.query(`SELECT estado FROM cortes_dia WHERE id_corte = $1 FOR UPDATE`, [p.data.id])
        if (!k) throw new Falla(404, 'Ese corte no existe')
        if (k.estado !== 'confirmado') throw new Falla(409, 'Ese corte no está confirmado')
        const evento = { accion: 'reabierto', por: req.usuario.id, en: new Date().toISOString(), motivo: b.data.motivo }
        await c.query(
          `UPDATE cortes_dia SET estado = 'pendiente', confirmado_por = NULL, confirmado_en = NULL, actualizado_en = now(), historial = historial || $2::jsonb
            WHERE id_corte = $1`,
          [p.data.id, JSON.stringify([evento])],
        )
      })
      return { ok: true }
    } catch (e) {
      return responder(rep, e)
    }
  })

  // ---- meta y comisión del propio vendedor (lo que él vende este mes; nunca costos ni utilidad)
  app.get('/mi-meta', { preHandler: requiereSesion }, async (req) => {
    const hoy = await hoyDe()
    const mes = hoy.slice(0, 7)
    const { rows: [r] } = await db.query(
      `SELECT coalesce((SELECT sum(d.subtotal) FROM pedidos pe JOIN detalle_pedido d USING (id_pedido)
                         WHERE pe.estado = 'entregado' AND pe.id_vendedor = u.id_usuario AND pe.fecha BETWEEN $2 AND $3), 0)::float8 AS ventas,
              u.meta_mensual::float8 AS meta, u.comision_pct::float8 AS pct
         FROM usuarios u WHERE u.id_usuario = $1`,
      [req.usuario.id, primerDia(mes), ultimoDia(mes)],
    )
    // Su lugar entre los vendedores activos de la empresa por lo vendido en el mes: sólo el número, nunca lo de los demás.
    const { rows: [l] } = await db.query(
      `WITH v AS (
         SELECT u.id_usuario, coalesce(sum(d.subtotal), 0) AS ventas
           FROM usuarios u
           LEFT JOIN pedidos pe ON pe.id_vendedor = u.id_usuario AND pe.estado = 'entregado' AND pe.fecha BETWEEN $2 AND $3
           LEFT JOIN detalle_pedido d ON d.id_pedido = pe.id_pedido
          WHERE u.rol = 'vendedor' AND u.activo
          GROUP BY u.id_usuario
       )
       SELECT (SELECT count(*)::int FROM v) AS de,
              CASE WHEN EXISTS (SELECT 1 FROM v WHERE id_usuario = $1)
                   THEN (SELECT count(*)::int FROM v WHERE ventas > (SELECT ventas FROM v WHERE id_usuario = $1)) + 1 END AS lugar`,
      [req.usuario.id, primerDia(mes), ultimoDia(mes)],
    )
    return {
      mes, ventas: redondear(r.ventas), meta: r.meta, cumplimientoPct: r.meta ? redondear((r.ventas / r.meta) * 100) : null, comisionPct: r.pct, comision: redondear((r.ventas * r.pct) / 100),
      lugar: (l.lugar as number | null) ?? null, de: l.de as number,
    }
  })

  // Los meses cerrados en que un vendedor llegó a su meta (sus trofeos), de la foto de cada cierre, y su racha: cuántos
  // meses seguidos la alcanzó, contando hacia atrás desde el mes pasado (un mes sin cerrar o sin meta la corta), y la mejor.
  const mesesCumplidos = (id: string | null) => mesesCumplidosDe(db, id)
  const mesPasado = async () => mesAnterior(await hoyDe())
  const rachas = async () => rachasDe(db, await mesPasado())
  async function trofeos(id: string) {
    const filas = (await mesesCumplidos(id)).slice(0, 36)
    const meses = filas.map((r) => r.mes)
    // Historial: los últimos 12 meses cerrados en que aparece, con la meta que tenía y lo que vendió (cumpliera o no).
    const { rows: historial } = await db.query(
      `SELECT to_char(c.mes, 'YYYY-MM') AS mes, (v->>'ventas')::float8 AS ventas, (v->>'meta')::float8 AS meta,
              (v->>'cumplimientoPct')::float8 AS "cumplimientoPct"
         FROM cierres_mes c, jsonb_array_elements(c.cifras->'vendedores') v
        WHERE c.estado = 'cerrado' AND v->>'id' = $1
        ORDER BY c.mes DESC LIMIT 12`,
      [id],
    )
    return {
      meses: filas.map(({ mes, ventas, meta }) => ({ mes, ventas, meta })), racha: rachaDesde(meses, await mesPasado()), mejorRacha: mejorDe(meses),
      historial: historial as { mes: string; ventas: number; meta: number | null; cumplimientoPct: number | null }[],
    }
  }
  // Su lugar en el salón de la fama (mismo orden que SalonDeLaFama en Equipo.tsx): sólo el número, nunca lo de los demás.
  async function lugarEnFama(id: string) {
    const orden = Object.entries(await rachas()).sort(([, a], [, b]) => ordenFama(a, b))
    const i = orden.findIndex(([x]) => x === id)
    return i < 0 ? null : { lugar: i + 1, de: orden.length }
  }
  app.get('/usuarios/rachas', { preHandler: requiereAdmin }, async () => rachas())
  // Los del vendedor, en su ficha de Vendedores (administrador)…
  app.get('/usuarios/:id/metas', { preHandler: requiereAdmin }, async (req, rep) => {
    const p = z.object({ id: z.uuid() }).safeParse(req.params)
    if (!p.success) return rep.code(400).send({ error: 'Cuenta no válida' })
    return trofeos(p.data.id)
  })
  // …y los propios, en su app (Cuenta).
  app.get('/mi-meta/trofeos', { preHandler: requiereSesion }, async (req) => ({ ...(await trofeos(req.usuario.id)), fama: await lugarEnFama(req.usuario.id) }))

  // Resumen del año (panel, diciembre y enero): con los meses cerrados de `anio`, lo vendido mes a mes, el mes más
  // vendido, el vendedor del año (el que más vendió sumando sus meses) y la mejor racha dentro del año.
  app.get('/cierres/anio/:anio', { preHandler: requiereAdmin }, async (req, rep) => {
    const p = z.object({ anio: z.coerce.number().int().min(2020).max(2100) }).safeParse(req.params)
    if (!p.success) return rep.code(400).send({ error: 'El año no es válido' })
    const { rows } = await db.query(
      `SELECT to_char(mes, 'YYYY-MM') AS mes, (cifras->'ventas'->>'ingreso')::float8 AS ventas, cifras->'vendedores' AS vendedores
         FROM cierres_mes WHERE estado = 'cerrado' AND extract(year FROM mes) = $1 ORDER BY mes`,
      [p.data.anio],
    )
    const meses = rows.map((r) => ({ mes: r.mes as string, ventas: redondear(r.ventas ?? 0) }))
    const porVendedor = new Map<string, { nombre: string; ventas: number; cumplidos: string[] }>()
    for (const r of rows) {
      for (const v of (r.vendedores ?? []) as { id: string; nombre: string; ventas: number; meta: number | null; cumplimientoPct: number | null }[]) {
        const x = porVendedor.get(v.id) ?? { nombre: v.nombre, ventas: 0, cumplidos: [] }
        x.ventas += v.ventas
        if (v.meta && (v.cumplimientoPct ?? 0) >= 100) x.cumplidos.push(r.mes)
        porVendedor.set(v.id, x)
      }
    }
    const vendedores = [...porVendedor].map(([id, v]) => ({ id, nombre: v.nombre, ventas: redondear(v.ventas), mejorRacha: mejorDe(v.cumplidos), cumplidos: v.cumplidos.length }))
    const delAnio = [...vendedores].sort((a, b) => b.ventas - a.ventas)[0]
    const racha = [...vendedores].sort(ordenFama)[0]
    const tope = [...meses].sort((a, b) => b.ventas - a.ventas)[0]
    return {
      anio: p.data.anio, meses, total: redondear(meses.reduce((s, m) => s + m.ventas, 0)),
      mesMasVendido: tope && tope.ventas > 0 ? tope : null,
      vendedorDelAnio: delAnio && delAnio.ventas > 0 ? { id: delAnio.id, nombre: delAnio.nombre, ventas: delAnio.ventas } : null,
      mejorRacha: racha && racha.mejorRacha > 0 ? { id: racha.id, nombre: racha.nombre, meses: racha.mejorRacha } : null,
    }
  })

  // ---- cierre de mes
  const mesDeRuta = (req: FastifyRequest) => mesTexto.safeParse((req.params as { mes?: string }).mes)

  // Los últimos meses con su estado (abierto, cerrado o reabierto), del más nuevo al más viejo.
  app.get('/cierres', { preHandler: requiereAdmin }, async () => {
    const hoy = await hoyDe()
    const { rows: [p] } = await db.query(`SELECT to_char(min(fecha), 'YYYY-MM') AS primero FROM pedidos`)
    const { rows } = await db.query(`SELECT to_char(mes, 'YYYY-MM') AS mes, estado, cerrado_en::text FROM cierres_mes`)
    const cierres = new Map(rows.map((r) => [r.mes as string, r]))
    const meses: { mes: string; estado: 'abierto' | 'cerrado' | 'reabierto'; actual: boolean; cerradoEn: string | null }[] = []
    let [a, m] = hoy.slice(0, 7).split('-').map(Number)
    const primero = (p?.primero as string | null) ?? hoy.slice(0, 7)
    for (let i = 0; i < 24; i++) {
      const mes = `${a}-${String(m).padStart(2, '0')}`
      if (mes < primero) break
      const c = cierres.get(mes)
      meses.push({ mes, estado: c ? c.estado : 'abierto', actual: mes === hoy.slice(0, 7), cerradoEn: c?.cerrado_en ?? null })
      if (--m === 0) { m = 12; a-- }
    }
    return { meses }
  })

  // Las cifras de un mes: la foto guardada si está cerrado; si no, las de ahora.
  async function leerMes(mes: string) {
    const { rows: [c] } = await db.query(`SELECT estado, cifras, cerrado_en::text AS en, historial FROM cierres_mes WHERE mes = $1`, [primerDia(mes)])
    const cerrado = c?.estado === 'cerrado'
    return {
      mes, estado: (c ? c.estado : 'abierto') as 'abierto' | 'cerrado' | 'reabierto', cerradoEn: (c?.en as string | undefined) ?? null, historial: ((c?.historial as Historial | undefined) ?? []),
      cifras: cerrado ? (c.cifras as CifrasMes) : await cifrasDelMes(db, mes),
    }
  }

  app.get('/cierres/:mes', { preHandler: requiereAdmin }, async (req, rep) => {
    const m = mesDeRuta(req)
    if (!m.success) return rep.code(400).send({ error: 'El mes va como AAAA-MM' })
    return leerMes(m.data)
  })

  app.post('/cierres/:mes/cerrar', { preHandler: requiereAdmin, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, rep) => {
    const m = mesDeRuta(req)
    if (!m.success) return rep.code(400).send({ error: 'El mes va como AAAA-MM' })
    try {
      const hoy = await hoyDe()
      if (m.data >= hoy.slice(0, 7)) throw new Falla(409, 'Ese mes todavía no termina')
      const antes = await rachas()
      const r = await tx(db, req.usuario.id, async (c) => {
        await c.query(`SELECT pg_advisory_xact_lock(hashtext('cierre_mes'))`)
        const { rows: [ex] } = await c.query(`SELECT estado FROM cierres_mes WHERE mes = $1 FOR UPDATE`, [primerDia(m.data)])
        if (ex?.estado === 'cerrado') throw new Falla(409, 'Ese mes ya está cerrado')
        const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM pedidos WHERE fecha BETWEEN $1 AND $2 AND estado IN ('pendiente', 'en_camino')`, [primerDia(m.data), ultimoDia(m.data)])
        if (n > 0) throw new Falla(409, `Hay ${n} ${n === 1 ? 'pedido' : 'pedidos'} sin cerrar en ese mes: entrégalos, omítelos o cámbialos de día`)
        const cifras = await cifrasDelMes(c, m.data)
        const evento = { accion: 'cerrado', por: req.usuario.id, en: new Date().toISOString() }
        await c.query(
          `INSERT INTO cierres_mes (mes, estado, cifras, cerrado_por, cerrado_en, historial) VALUES ($1, 'cerrado', $2, $3, now(), $4::jsonb)
           ON CONFLICT (id_empresa, mes) DO UPDATE SET estado = 'cerrado', cifras = EXCLUDED.cifras, cerrado_por = EXCLUDED.cerrado_por, cerrado_en = now(),
                                                      historial = cierres_mes.historial || EXCLUDED.historial`,
          [primerDia(m.data), JSON.stringify(cifras), req.usuario.id, JSON.stringify([evento])],
        )
        return cifras
      })
      await avisarLogros(antes, r).catch((e) => req.log.error(e, 'No se pudieron avisar las medallas'))
      // Cuántos administradores quieren el informe por correo: el panel arma el PDF sólo si alguien lo quiere (resumen.ts).
      const { rows: [{ n: porCorreo }] } = await db.query(`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'administrador' AND activo AND resumen_mensual`)
      return { ok: true, cifras: r, porCorreo }
    } catch (e) {
      return responder(rep, e)
    }
  })

  // Con el mes recién cerrado, el vendedor cuya mejor racha llegó a 3, 6 o 12 meses ganó una medalla: los
  // administradores se enteran para felicitarlo, y él también. Una vez por vendedor y medalla (reabrir y volver a cerrar
  // no repite).
  // Y si superó su mejor racha sin ganar medalla (de 2 meses en adelante), al vendedor le llega `record_personal`, una vez
  // por récord.
  async function avisarLogros(antes: Awaited<ReturnType<typeof rachas>>, cifras: CifrasMes) {
    if (!despachador) return
    const medalla = (n: number) => [12, 6, 3].find((x) => n >= x) ?? 0
    const despues = await rachas()
    const cambios = Object.entries(despues).map(([id, r]) => ({ id, mejor: r.mejorRacha, antesMejor: antes[id]?.mejorRacha ?? 0, medalla: medalla(r.mejorRacha), antes: medalla(antes[id]?.mejorRacha ?? 0) }))
    const nuevas = cambios.filter((x) => x.medalla > x.antes)
    const records = cambios.filter((x) => x.medalla === x.antes && x.antesMejor >= 1 && x.mejor > x.antesMejor && x.mejor >= 2)
    if (!nuevas.length && !records.length) return
    const { rows: ya } = await db.query(
      `SELECT DISTINCT tipo, datos->'vendedorIds'->>0 AS id, (datos->>'medalla')::int AS medalla, (datos->>'racha')::int AS racha
         FROM notificaciones WHERE tipo IN ('medalla_ganada', 'record_personal')`)
    const pendientes = nuevas.filter((x) => !ya.some((y) => y.tipo === 'medalla_ganada' && y.id === x.id && y.medalla === x.medalla))
    const recordsPendientes = records.filter((x) => !ya.some((y) => y.tipo === 'record_personal' && y.id === x.id && y.racha === x.mejor))
    if (recordsPendientes.length) {
      await despachador.despachar(recordsPendientes.map((x) => ({
        para: x.id, tipo: 'record_personal' as const, titulo: '¡Nuevo récord personal!',
        cuerpo: `${x.mejor} meses seguidos llegando a tu meta: tu mejor racha (antes ${x.antesMejor} ${x.antesMejor === 1 ? 'mes' : 'meses'}). ${x.mejor < 3 ? 'Uno más y ganas la medalla de 3 meses.' : x.mejor < 6 ? `Te faltan ${6 - x.mejor} para la de 6 meses.` : x.mejor < 12 ? `Te faltan ${12 - x.mejor} para la de un año.` : '¡Sigue así!'}`,
        datos: { pestana: 'cuenta' as const, vendedorIds: [x.id], racha: x.mejor },
      })))
    }
    if (!pendientes.length) return
    const { rows: admins } = await db.query(`SELECT id_usuario FROM usuarios WHERE rol = 'administrador' AND activo`)
    const nombre = (id: string) => cifras.vendedores.find((v) => v.id === id)?.nombre ?? 'Un vendedor'
    const texto = (n: number) => (n === 12 ? 'un año' : `${n} meses`)
    await despachador.despachar(pendientes.flatMap((x) => [
      {
        para: x.id, tipo: 'medalla_ganada' as const, titulo: `¡Ganaste la medalla de ${texto(x.medalla)}!`,
        cuerpo: `Llevas ${x.medalla} meses seguidos llegando a tu meta. ¡Felicidades!`,
        datos: { pestana: 'cuenta' as const, vendedorIds: [x.id], medalla: x.medalla },
      },
      ...admins.map((a) => ({
        para: a.id_usuario as string, tipo: 'medalla_ganada' as const, titulo: `Medalla de ${texto(x.medalla)}`,
        cuerpo: `${nombre(x.id)} lleva ${x.medalla} meses seguidos llegando a su meta. ¡Mándale una felicitación!`,
        datos: { url: `/admin?ir=equipo&persona=${x.id}`, vendedorIds: [x.id], medalla: x.medalla },
      })),
    ]))
  }

  // Reabrir exige el motivo; las correcciones vuelven a ser posibles hasta cerrarlo otra vez.
  app.post('/cierres/:mes/reabrir', { preHandler: requiereAdmin, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, rep) => {
    const m = mesDeRuta(req)
    const b = z.object({ motivo: z.string().trim().min(5, 'Escribe el motivo (al menos 5 letras)').max(300) }).safeParse(req.body)
    if (!m.success) return rep.code(400).send({ error: 'El mes va como AAAA-MM' })
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Escribe el motivo' })
    try {
      await tx(db, req.usuario.id, async (c) => {
        const { rows: [ex] } = await c.query(`SELECT estado FROM cierres_mes WHERE mes = $1 FOR UPDATE`, [primerDia(m.data)])
        if (ex?.estado !== 'cerrado') throw new Falla(409, 'Ese mes no está cerrado')
        const evento = { accion: 'reabierto', por: req.usuario.id, en: new Date().toISOString(), motivo: b.data.motivo }
        await c.query(`UPDATE cierres_mes SET estado = 'reabierto', historial = historial || $2::jsonb WHERE mes = $1`, [primerDia(m.data), JSON.stringify([evento])])
      })
      return { ok: true }
    } catch (e) {
      return responder(rep, e)
    }
  })

  // El informe mensual: JSON (la app arma el PDF con él) o Excel.
  app.get('/cierres/:mes/informe', { preHandler: requiereAdmin, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const m = mesDeRuta(req)
    const f = z.object({ formato: z.enum(['json', 'xlsx']).default('json') }).safeParse(req.query)
    if (!m.success || !f.success) return rep.code(400).send({ error: 'El mes va como AAAA-MM y el formato json o xlsx' })
    const mes = await leerMes(m.data)
    if (f.data.formato === 'json') return mes
    const generado = new Date().toLocaleString('es-MX', { timeZone: await zonaDeEmpresa(db, config.zonaHoraria), day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const estado = mes.estado === 'cerrado' ? 'Mes cerrado' : mes.estado === 'reabierto' ? 'Mes reabierto (cifras al momento de generarlo)' : 'Mes abierto (cifras al momento de generarlo)'
    const logros = await logrosDelMes(db, config.zonaHoraria, m.data).catch(() => undefined)
    const datos = xlsxDelMes(mes.cifras, m.data, `${estado} · Generado el ${generado}`, logros)
    return rep
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="informe-mensual-${m.data}.xlsx"`)
      .header('cache-control', 'no-store')
      .send(datos)
  })
}
