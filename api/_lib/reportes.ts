import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import type { Db } from './db.js'
import { aCsv, aXlsx, type Tabla, type Tipo, type Valor } from './exportar.js'

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

// Reportes de ventas, rentabilidad, ranking y rendimiento por vendedor (RF-043 a RF-048). Sólo el administrador:
// traen costos y márgenes (RF-005). Cuentan los pedidos entregados, por su fecha de entrega, con el precio y el costo
// que tenían cuando se vendió (se congelan en cada renglón del pedido).

const MAX_DIAS = 1096 // tres años
const MAX_DIAS_POR_DIA = 366 // más allá, las barras diarias ya no se distinguen: se agrupa por semana o mes
const MAX_RENGLONES_HISTORIAL = 100_000

const UNIDAD = { dia: 'day', semana: 'week', mes: 'month' } as const // las semanas empiezan en lunes

const fecha = z.iso.date()
const consulta = z.object({
  desde: fecha,
  hasta: fecha,
  agrupar: z.enum(['dia', 'semana', 'mes']).default('dia'),
  // Con qué periodo comparar (por ejemplo, el mes anterior completo). Sin esto, el de la misma duración justo antes.
  compararDesde: fecha.optional(),
  compararHasta: fecha.optional(),
})
const consultaExportar = consulta.extend({
  formato: z.enum(['xlsx', 'csv']).default('xlsx'),
  tabla: z.enum(['ventas', 'periodos', 'sabores', 'vendedores']).default('ventas'),
})
type Consulta = z.infer<typeof consulta>

// ------------------------------------------------------------------ fechas ("YYYY-MM-DD", sin zona horaria)

const aMs = (s: string) => Date.parse(`${s}T00:00:00Z`)
const aIso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const sumarDias = (s: string, n: number) => aIso(aMs(s) + n * 86_400_000)
const diasEntre = (desde: string, hasta: string) => Math.round((aMs(hasta) - aMs(desde)) / 86_400_000) + 1

// ------------------------------------------------------------------ resultados

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (x: unknown) => r2(Number(x ?? 0))
const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 1000) / 10 : null)

export interface Resumen {
  ingreso: number
  costo: number
  utilidad: number
  margenPct: number | null // utilidad sobre ingreso, en %
  litros: number
  pedidos: number
  clientes: number
  ticketPromedio: number | null
  efectivo: number
  transferencia: number
}

function resumenDe(f: Record<string, unknown>): Resumen {
  const ingreso = num(f.ingreso)
  const costo = num(f.costo)
  const pedidos = Number(f.pedidos ?? 0)
  return {
    ingreso,
    costo,
    utilidad: r2(ingreso - costo),
    margenPct: pct(ingreso - costo, ingreso),
    litros: num(f.litros),
    pedidos,
    clientes: Number(f.clientes ?? 0),
    ticketPromedio: pedidos ? r2(ingreso / pedidos) : null,
    efectivo: num(f.efectivo),
    transferencia: num(f.transferencia),
  }
}

export interface Periodo {
  periodo: string // inicio del día, la semana (lunes) o el mes
  inicio: string // primer día que cuenta dentro del rango pedido
  fin: string // último día que cuenta dentro del rango pedido
  ingreso: number
  costo: number
  utilidad: number
  litros: number
  pedidos: number
}
export interface Sabor {
  id: string
  sabor: string
  color: string
  disponible: boolean
  litros: number
  ingreso: number
  costo: number
  utilidad: number
  margenPct: number | null
  sinCosto: boolean // se vendió sin costo capturado: la utilidad sale inflada
}
export interface Vendedor {
  id: string | null
  nombre: string
  activo: boolean
  pedidos: number
  clientes: number
  litros: number
  ingreso: number
  utilidad: number
  ticketPromedio: number | null
  omitidos: number // visitas sin venta (RF-026)
}
export interface Reporte {
  desde: string
  hasta: string
  agrupar: Consulta['agrupar']
  resumen: Resumen
  anterior: { desde: string; hasta: string; resumen: Resumen } | null // mismo largo, justo antes
  periodos: Periodo[]
  sabores: Sabor[] // de más a menos litros: el primero es el sabor estrella y el último el de menor rotación
  ranking: { estrella: string | null; menorRotacion: string | null }
  vendedores: Vendedor[] // de más a menos ingreso
}

// ------------------------------------------------------------------ consultas

const LITROS = `d.cantidad * pr.presentacion_litros`
const VENDIDO = `pe.estado = 'entregado' AND pe.fecha BETWEEN $1::date AND $2::date`
const DE_VENTAS = `FROM pedidos pe JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)`

async function resumen(db: Db, desde: string, hasta: string): Promise<Resumen> {
  const { rows } = await db.query(
    `SELECT sum(d.subtotal) AS ingreso, sum(d.cantidad * d.costo_unitario) AS costo, sum(${LITROS}) AS litros,
            count(DISTINCT pe.id_pedido) AS pedidos, count(DISTINCT pe.id_cliente) AS clientes,
            sum(d.subtotal) FILTER (WHERE pe.metodo_pago = 'efectivo') AS efectivo,
            sum(d.subtotal) FILTER (WHERE pe.metodo_pago = 'transferencia') AS transferencia
       ${DE_VENTAS} WHERE ${VENDIDO}`,
    [desde, hasta],
  )
  return resumenDe(rows[0])
}

async function periodos(db: Db, q: Consulta): Promise<Periodo[]> {
  const u = UNIDAD[q.agrupar] // sale de una lista fija: es seguro ponerlo en el texto de la consulta
  const { rows } = await db.query(
    `WITH cortes AS (
       SELECT g::date AS periodo FROM generate_series(date_trunc('${u}', $1::date::timestamp), $2::date::timestamp, interval '1 ${u}') g
     ), ventas AS (
       SELECT date_trunc('${u}', pe.fecha::timestamp)::date AS periodo, sum(d.subtotal) AS ingreso, sum(d.cantidad * d.costo_unitario) AS costo,
              sum(${LITROS}) AS litros, count(DISTINCT pe.id_pedido) AS pedidos
         ${DE_VENTAS} WHERE ${VENDIDO} GROUP BY 1
     )
     SELECT c.periodo, v.ingreso, v.costo, v.litros, v.pedidos FROM cortes c LEFT JOIN ventas v USING (periodo) ORDER BY c.periodo`,
    [q.desde, q.hasta],
  )
  return rows.map((f) => {
    const inicio = f.periodo as string
    const finNatural = q.agrupar === 'dia' ? inicio : q.agrupar === 'semana' ? sumarDias(inicio, 6) : aIso(Date.UTC(+inicio.slice(0, 4), +inicio.slice(5, 7), 0))
    const ingreso = num(f.ingreso)
    const costo = num(f.costo)
    return {
      periodo: inicio,
      inicio: inicio < q.desde ? q.desde : inicio,
      fin: finNatural > q.hasta ? q.hasta : finNatural,
      ingreso,
      costo,
      utilidad: r2(ingreso - costo),
      litros: num(f.litros),
      pedidos: Number(f.pedidos ?? 0),
    }
  })
}

async function sabores(db: Db, q: Consulta): Promise<Sabor[]> {
  const { rows } = await db.query(
    `SELECT pr.id_producto, pr.sabor, pr.color_hex, pr.disponible,
            coalesce(v.litros, 0) AS litros, coalesce(v.ingreso, 0) AS ingreso, coalesce(v.costo, 0) AS costo, coalesce(v.sin_costo, false) AS sin_costo
       FROM productos pr
       LEFT JOIN (
         SELECT d.id_producto, sum(${LITROS}) AS litros, sum(d.subtotal) AS ingreso, sum(d.cantidad * d.costo_unitario) AS costo,
                bool_or(d.costo_unitario = 0 AND d.subtotal > 0) AS sin_costo
           ${DE_VENTAS} WHERE ${VENDIDO} GROUP BY d.id_producto
       ) v USING (id_producto)
      WHERE pr.disponible OR v.litros IS NOT NULL
      ORDER BY coalesce(v.litros, 0) DESC, coalesce(v.ingreso, 0) DESC, pr.sabor, pr.id_producto`,
    [q.desde, q.hasta],
  )
  return rows.map((f) => {
    const ingreso = num(f.ingreso)
    const costo = num(f.costo)
    return {
      id: f.id_producto,
      sabor: f.sabor,
      color: f.color_hex,
      disponible: f.disponible,
      litros: num(f.litros),
      ingreso,
      costo,
      utilidad: r2(ingreso - costo),
      margenPct: pct(ingreso - costo, ingreso),
      sinCosto: f.sin_costo,
    }
  })
}

async function vendedores(db: Db, q: Consulta): Promise<Vendedor[]> {
  const { rows: act } = await db.query(
    `SELECT id_vendedor, sum(ingreso) AS ingreso, sum(costo) AS costo, sum(litros) AS litros, sum(pedidos) AS pedidos, sum(clientes) AS clientes, sum(omitidos) AS omitidos
       FROM (
         SELECT pe.id_vendedor, sum(d.subtotal) AS ingreso, sum(d.cantidad * d.costo_unitario) AS costo, sum(${LITROS}) AS litros,
                count(DISTINCT pe.id_pedido) AS pedidos, count(DISTINCT pe.id_cliente) AS clientes, 0 AS omitidos
           ${DE_VENTAS} WHERE ${VENDIDO} GROUP BY pe.id_vendedor
         UNION ALL
         SELECT pe.id_vendedor, 0, 0, 0, 0, 0, count(*)
           FROM pedidos pe WHERE pe.estado = 'omitido' AND pe.fecha BETWEEN $1::date AND $2::date GROUP BY pe.id_vendedor
       ) x GROUP BY id_vendedor`,
    [q.desde, q.hasta],
  )
  // Todo el equipo activo aparece, aunque no haya vendido: un cero también es un dato.
  const { rows: gente } = await db.query(
    `SELECT id_usuario, nombre, activo FROM usuarios WHERE (rol = 'vendedor' AND activo) OR id_usuario = ANY($1::uuid[])`,
    [act.map((f) => f.id_vendedor).filter(Boolean)],
  )
  const porId = new Map(act.map((f) => [f.id_vendedor as string | null, f]))
  const filas: Vendedor[] = gente.map((u) => ({ id: u.id_usuario, nombre: u.nombre, activo: u.activo, ...metricas(porId.get(u.id_usuario)) }))
  if (porId.has(null)) filas.push({ id: null, nombre: 'Sin vendedor', activo: false, ...metricas(porId.get(null)) })
  return filas.sort((a, b) => b.ingreso - a.ingreso || b.pedidos - a.pedidos || a.nombre.localeCompare(b.nombre, 'es'))
}

function metricas(f?: Record<string, unknown>) {
  const ingreso = num(f?.ingreso)
  const pedidos = Number(f?.pedidos ?? 0)
  return {
    pedidos,
    clientes: Number(f?.clientes ?? 0),
    litros: num(f?.litros),
    ingreso,
    utilidad: r2(ingreso - num(f?.costo)),
    ticketPromedio: pedidos ? r2(ingreso / pedidos) : null,
    omitidos: Number(f?.omitidos ?? 0),
  }
}

export async function armarReporte(db: Db, q: Consulta): Promise<Reporte> {
  const dias = diasEntre(q.desde, q.hasta)
  const antes = q.compararDesde && q.compararHasta ? { desde: q.compararDesde, hasta: q.compararHasta } : { desde: sumarDias(q.desde, -dias), hasta: sumarDias(q.desde, -1) }
  const [r, ant, per, sab, ven] = await Promise.all([resumen(db, q.desde, q.hasta), resumen(db, antes.desde, antes.hasta), periodos(db, q), sabores(db, q), vendedores(db, q)])
  return {
    desde: q.desde,
    hasta: q.hasta,
    agrupar: q.agrupar,
    resumen: r,
    anterior: ant.pedidos ? { ...antes, resumen: ant } : null,
    periodos: per,
    sabores: sab,
    ranking: {
      estrella: sab[0]?.litros > 0 ? sab[0].id : null,
      menorRotacion: sab.length > 1 ? sab[sab.length - 1].id : null,
    },
    vendedores: ven,
  }
}

// ------------------------------------------------------------------ exportar

async function historial(db: Db, q: Consulta): Promise<Tabla | null> {
  const { rows } = await db.query(
    `SELECT pe.fecha, coalesce(u.nombre, 'Sin vendedor') AS vendedor, c.nombre AS cliente, pr.sabor,
            ${LITROS} AS litros, d.subtotal AS importe, d.cantidad * d.costo_unitario AS costo,
            d.subtotal - d.cantidad * d.costo_unitario AS utilidad, pe.metodo_pago
       ${DE_VENTAS}
       JOIN clientes c ON c.id_cliente = pe.id_cliente
       LEFT JOIN usuarios u ON u.id_usuario = pe.id_vendedor
      WHERE ${VENDIDO}
      ORDER BY pe.fecha, c.nombre, pr.sabor, d.id_detalle_pedido
      LIMIT ${MAX_RENGLONES_HISTORIAL + 1}`,
    [q.desde, q.hasta],
  )
  if (rows.length > MAX_RENGLONES_HISTORIAL) return null
  const suma = (k: string) => r2(rows.reduce((s, f) => s + Number(f[k]), 0))
  return {
    nombre: 'Ventas',
    columnas: [
      { titulo: 'Fecha', tipo: 'fecha' },
      { titulo: 'Vendedor', tipo: 'texto' },
      { titulo: 'Cliente', tipo: 'texto' },
      { titulo: 'Sabor', tipo: 'texto' },
      { titulo: 'Litros', tipo: 'litros' },
      { titulo: 'Importe', tipo: 'dinero' },
      { titulo: 'Costo', tipo: 'dinero' },
      { titulo: 'Utilidad', tipo: 'dinero' },
      { titulo: 'Pago', tipo: 'texto' },
    ],
    filas: rows.map((f) => [f.fecha, f.vendedor, f.cliente, f.sabor, num(f.litros), num(f.importe), num(f.costo), num(f.utilidad), f.metodo_pago]),
    total: ['Total', null, null, null, suma('litros'), suma('importe'), suma('costo'), suma('utilidad'), null],
  }
}

const tablaPeriodos = (r: Reporte): Tabla => ({
  nombre: 'Por periodo',
  columnas: [
    { titulo: 'Desde', tipo: 'fecha' },
    { titulo: 'Hasta', tipo: 'fecha' },
    { titulo: 'Pedidos', tipo: 'entero' },
    { titulo: 'Litros', tipo: 'litros' },
    { titulo: 'Ingresos', tipo: 'dinero' },
    { titulo: 'Costos', tipo: 'dinero' },
    { titulo: 'Utilidad', tipo: 'dinero' },
    { titulo: 'Margen (%)', tipo: 'porcentaje' },
  ],
  filas: r.periodos.map((p) => [p.inicio, p.fin, p.pedidos, p.litros, p.ingreso, p.costo, p.utilidad, pct(p.utilidad, p.ingreso)]),
  total: ['Total', null, r.resumen.pedidos, r.resumen.litros, r.resumen.ingreso, r.resumen.costo, r.resumen.utilidad, r.resumen.margenPct],
})

const tablaSabores = (r: Reporte): Tabla => ({
  nombre: 'Por sabor',
  columnas: [
    { titulo: 'Lugar', tipo: 'entero' },
    { titulo: 'Sabor', tipo: 'texto' },
    { titulo: 'Litros', tipo: 'litros' },
    { titulo: 'Ingresos', tipo: 'dinero' },
    { titulo: 'Costos', tipo: 'dinero' },
    { titulo: 'Utilidad', tipo: 'dinero' },
    { titulo: 'Margen (%)', tipo: 'porcentaje' },
    { titulo: 'Nota', tipo: 'texto' },
  ],
  filas: r.sabores.map((s, i) => [
    i + 1, s.sabor, s.litros, s.ingreso, s.costo, s.utilidad, s.margenPct,
    s.id === r.ranking.estrella ? 'Sabor estrella' : s.id === r.ranking.menorRotacion ? 'Menor rotación' : s.sinCosto ? 'Sin costo capturado' : null,
  ]),
  total: [null, 'Total', r.resumen.litros, r.resumen.ingreso, r.resumen.costo, r.resumen.utilidad, r.resumen.margenPct, null],
})

const tablaVendedores = (r: Reporte): Tabla => ({
  nombre: 'Por vendedor',
  columnas: [
    { titulo: 'Vendedor', tipo: 'texto' },
    { titulo: 'Pedidos', tipo: 'entero' },
    { titulo: 'Clientes', tipo: 'entero' },
    { titulo: 'Litros', tipo: 'litros' },
    { titulo: 'Ingresos', tipo: 'dinero' },
    { titulo: 'Utilidad', tipo: 'dinero' },
    { titulo: 'Ticket promedio', tipo: 'dinero' },
    { titulo: 'Visitas sin venta', tipo: 'entero' },
  ],
  filas: r.vendedores.map((v) => [v.nombre + (v.activo || v.id === null ? '' : ' (baja)'), v.pedidos, v.clientes, v.litros, v.ingreso, v.utilidad, v.ticketPromedio, v.omitidos]),
  // Clientes del total: los distintos de todo el periodo (un cliente que pasó de un vendedor a otro cuenta una vez).
  total: ['Total', r.resumen.pedidos, r.resumen.clientes, r.resumen.litros, r.resumen.ingreso, r.resumen.utilidad, r.resumen.ticketPromedio, r.vendedores.reduce((s, v) => s + v.omitidos, 0)],
})

const fechaMx = (s: string) => s.split('-').reverse().join('/')

// Cada cifra del periodo junto a la del periodo anterior y cuánto cambió (si hay con qué comparar).
const tablaResumen = (r: Reporte): Tabla => {
  const x = r.resumen
  const a = r.anterior?.resumen
  const conceptos: [string, keyof Resumen, Tipo][] = [
    ['Ingresos', 'ingreso', 'dinero'],
    ['Costos de producción', 'costo', 'dinero'],
    ['Utilidad neta', 'utilidad', 'dinero'],
    ['Margen', 'margenPct', 'porcentaje'],
    ['Litros entregados', 'litros', 'litros'],
    ['Pedidos entregados', 'pedidos', 'entero'],
    ['Clientes atendidos', 'clientes', 'entero'],
    ['Ticket promedio', 'ticketPromedio', 'dinero'],
    ['Cobrado en efectivo', 'efectivo', 'dinero'],
    ['Cobrado por transferencia', 'transferencia', 'dinero'],
  ]
  // El margen ya es un %: su cambio va en puntos ("+2.5 pts"), no en % del %.
  const cambio = (k: keyof Resumen, ahora: number | null, antes: number | null | undefined): Valor => {
    if (ahora === null || antes === null || antes === undefined) return null
    if (k === 'margenPct') return `${ahora >= antes ? '+' : '-'}${Math.abs(r2(ahora - antes)).toFixed(1)} pts`
    return { v: antes ? Math.round(((ahora - antes) / Math.abs(antes)) * 1000) / 10 : null, t: 'porcentaje' }
  }
  return {
    nombre: 'Resumen',
    columnas: [
      { titulo: 'Concepto', tipo: 'texto', ancho: 28 },
      { titulo: `${fechaMx(r.desde)} a ${fechaMx(r.hasta)}`, tipo: 'texto', ancho: 26 },
      ...(r.anterior ? [
        { titulo: `Anterior: ${fechaMx(r.anterior.desde)} a ${fechaMx(r.anterior.hasta)}`, tipo: 'texto' as const, ancho: 26 },
        { titulo: 'Cambio', tipo: 'texto' as const, ancho: 14 },
      ] : []),
    ],
    filas: conceptos.map(([concepto, k, t]) => [
      concepto,
      { v: x[k], t },
      ...(a ? [{ v: a[k], t }, cambio(k, x[k], a[k])] : []),
    ]),
  }
}

// ------------------------------------------------------------------ rutas

const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8' } as const

export async function rutasReportes(app: FastifyInstance, { db, config }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }) {
  // Valida el rango; responde 400 si no se puede usar.
  function rango<T extends Consulta>(raw: unknown, schema: z.ZodType<T>, rep: FastifyReply): T | undefined {
    const q = schema.safeParse(raw)
    if (!q.success) return void rep.code(400).send({ error: 'Indica el periodo con fechas válidas (desde y hasta)' })
    const dias = diasEntre(q.data.desde, q.data.hasta)
    if (dias < 1) return void rep.code(400).send({ error: 'La fecha inicial no puede ser posterior a la final' })
    if (dias > MAX_DIAS) return void rep.code(400).send({ error: 'El periodo puede abarcar hasta tres años' })
    if (q.data.agrupar === 'dia' && dias > MAX_DIAS_POR_DIA) return void rep.code(400).send({ error: 'Para más de un año agrupa por semana o por mes' })
    const { compararDesde: cd, compararHasta: ch } = q.data
    if (!cd !== !ch) return void rep.code(400).send({ error: 'Para comparar indica compararDesde y compararHasta' })
    if (cd && ch && (cd > ch || ch >= q.data.desde || diasEntre(cd, ch) > MAX_DIAS)) return void rep.code(400).send({ error: 'El periodo con el que se compara debe ser válido y terminar antes de que empiece este' })
    return q.data
  }

  app.get('/reportes/ventas', { preHandler: requiereAdmin, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, rep) => {
    const q = rango(req.query, consulta, rep)
    if (!q) return
    return armarReporte(db, q)
  })

  // Excel (todas las hojas) o CSV (una tabla). Un enlace común no lleva el token: la app lo pide con fetch y guarda el archivo.
  app.get('/reportes/exportar', { preHandler: requiereAdmin, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const q = rango(req.query, consultaExportar, rep)
    if (!q) return
    const { formato, tabla } = q
    const r = await armarReporte(db, q)
    const ventas = formato === 'xlsx' || tabla === 'ventas' ? await historial(db, q) : undefined
    if (ventas === null) return rep.code(413).send({ error: 'Son demasiadas ventas para un solo archivo. Elige un periodo más corto.' })

    let datos: Buffer
    const generado = new Date().toLocaleString('es-MX', { timeZone: config.zonaHoraria, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const encabezado = { titulo: 'Reporte de ventas', subtitulo: `Del ${fechaMx(q.desde)} al ${fechaMx(q.hasta)} · Generado el ${generado}` }
    if (formato === 'xlsx') datos = aXlsx([tablaResumen(r), tablaPeriodos(r), tablaSabores(r), tablaVendedores(r), ventas!], encabezado)
    else datos = aCsv({ ventas: ventas!, periodos: tablaPeriodos(r), sabores: tablaSabores(r), vendedores: tablaVendedores(r) }[tabla]!)

    const nombre = `reporte-${formato === 'xlsx' ? 'ventas' : tabla}-${q.desde}_${q.hasta}.${formato}`
    return rep
      .header('content-type', MIME[formato])
      .header('content-disposition', `attachment; filename="${nombre}"`)
      .header('cache-control', 'no-store')
      .send(datos)
  })
}
