import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import type { Db } from './db.js'
import { ordenarUnidades, tituloUnidad } from './unidades.js'
import { aCsv, aXlsx, type Tabla } from './exportar.js'

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

// Libreta de clientes: el directorio de la cartera activa con datos de contacto, cuándo se le visita y cuánto ha
// comprado. Sólo el administrador (lleva la cartera de todos los vendedores). El PDF lo arma la app con el JSON.

export interface ClienteLibreta {
  nombre: string
  telefono: string | null
  direccion: string
  colonia: string | null
  referencias: string | null
  vendedor: string
  visita: string // "Lun, Jue" o "Cada 7 días"
  horario: 'Mañana' | 'Tarde'
  alta: string // YYYY-MM-DD
  ubicacion: string | null // "19.43260000, -99.13320000"
  pedidos: number
  litros: number // todas las unidades juntas: sólo sirve si la empresa usa una
  porUnidad: Record<string, number> // catálogo flexible: { L: 60, kg: 10 }
  comprado: number
  ultimaCompra: string | null
  proximaEntrega: string | null
  saborFavorito: string | null
}

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0] // la semana del negocio empieza en lunes

function textoVisita(tipo: string, dias: number[], cada: number | null) {
  if (tipo === 'intervalo') return cada === 1 ? 'Diario' : `Cada ${cada} días`
  return dias.length ? ORDEN_SEMANA.filter((d) => dias.includes(d)).map((d) => DIAS[d]).join(', ') : 'Sin días fijos'
}

export async function libreta(db: Db): Promise<ClienteLibreta[]> {
  const { rows: pu } = await db.query(
    `SELECT x.id_cliente, pr.unidad, sum(d.cantidad * pr.presentacion_litros)::float8 AS n
       FROM pedidos x JOIN detalle_pedido d USING (id_pedido) JOIN productos pr USING (id_producto)
      WHERE x.estado = 'entregado' GROUP BY 1, 2`,
  )
  const porCliente = new Map<string, Record<string, number>>()
  for (const f of pu) porCliente.set(f.id_cliente, { ...porCliente.get(f.id_cliente), [f.unidad]: Math.round(f.n * 100) / 100 })
  const { rows } = await db.query(
    `SELECT c.id_cliente, c.nombre, c.telefono, c.direccion, c.colonia, c.referencias, coalesce(u.nombre, 'Sin vendedor') AS vendedor,
            c.frecuencia_tipo, c.dias_semana, c.cada_dias, c.ventana_horario, c.creado_en::date AS alta, c.latitud, c.longitud,
            r.pedidos_entregados, r.litros_acumulados, r.ultima_visita, r.proxima_entrega, r.sabor_favorito,
            (SELECT coalesce(sum(d.subtotal), 0) FROM pedidos x JOIN detalle_pedido d USING (id_pedido)
              WHERE x.id_cliente = c.id_cliente AND x.estado = 'entregado') AS comprado
       FROM clientes c
       JOIN v_resumen_cliente r USING (id_cliente)
       LEFT JOIN usuarios u ON u.id_usuario = c.id_vendedor
      WHERE c.activo
      ORDER BY c.id_vendedor IS NULL, vendedor, c.nombre`,
  )
  return rows.map((f) => ({
    nombre: f.nombre,
    telefono: f.telefono,
    direccion: f.direccion,
    colonia: f.colonia,
    referencias: f.referencias,
    vendedor: f.vendedor,
    visita: textoVisita(f.frecuencia_tipo, f.dias_semana ?? [], f.cada_dias),
    horario: f.ventana_horario === 'tarde' ? 'Tarde' : 'Mañana',
    alta: f.alta,
    ubicacion: f.latitud === null ? null : `${f.latitud}, ${f.longitud}`,
    pedidos: Number(f.pedidos_entregados),
    litros: Number(f.litros_acumulados),
    porUnidad: porCliente.get(f.id_cliente) ?? {},
    comprado: Number(f.comprado),
    ultimaCompra: f.ultima_visita,
    proximaEntrega: f.proxima_entrega,
    saborFavorito: f.sabor_favorito,
  }))
}

// Una columna por unidad que se haya vendido («Litros», «Kilos»…); con una sola, la de siempre.
const tablaLibreta = (cs: ClienteLibreta[]): Tabla => {
  const unidades = ordenarUnidades(cs.flatMap((c) => Object.keys(c.porUnidad)))
  if (!unidades.length) unidades.push('L')
  const de = (c: ClienteLibreta) => unidades.map((u) => c.porUnidad[u] ?? 0)
  return {
  nombre: 'Directorio',
  columnas: [
    { titulo: 'Vendedor', tipo: 'texto' },
    { titulo: 'Cliente', tipo: 'texto' },
    { titulo: 'Teléfono', tipo: 'texto' },
    { titulo: 'Dirección', tipo: 'texto', ancho: 32 },
    { titulo: 'Colonia', tipo: 'texto' },
    { titulo: 'Referencias', tipo: 'texto', ancho: 28 },
    { titulo: 'Días de visita', tipo: 'texto' },
    { titulo: 'Horario', tipo: 'texto' },
    { titulo: 'Cliente desde', tipo: 'fecha' },
    { titulo: 'Pedidos', tipo: 'entero' },
    ...unidades.map((u) => ({ titulo: tituloUnidad(u), tipo: 'litros' as const })),
    { titulo: 'Total comprado', tipo: 'dinero' },
    { titulo: 'Última compra', tipo: 'fecha' },
    { titulo: 'Próxima entrega', tipo: 'fecha' },
    { titulo: 'Sabor favorito', tipo: 'texto' },
    { titulo: 'Ubicación (lat, lng)', tipo: 'texto' },
  ],
  filas: cs.map((c) => [
    c.vendedor, c.nombre, c.telefono, c.direccion, c.colonia, c.referencias, c.visita, c.horario, c.alta,
    c.pedidos, ...de(c), c.comprado, c.ultimaCompra, c.proximaEntrega, c.saborFavorito, c.ubicacion,
  ]),
  total: [`${cs.length} clientes`, null, null, null, null, null, null, null, null,
    cs.reduce((s, c) => s + c.pedidos, 0), ...unidades.map((u) => Math.round(cs.reduce((s, c) => s + (c.porUnidad[u] ?? 0), 0) * 100) / 100),
    Math.round(cs.reduce((s, c) => s + c.comprado, 0) * 100) / 100],
  }
}

const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv; charset=utf-8' } as const
const consulta = z.object({ formato: z.enum(['json', 'xlsx', 'csv']).default('json') })

export async function rutasLibreta(app: FastifyInstance, { db, config }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }) {
  app.get('/reportes/clientes', { preHandler: requiereAdmin, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, rep) => {
    const q = consulta.safeParse(req.query)
    if (!q.success) return rep.code(400).send({ error: 'Formato no válido (json, xlsx o csv)' })
    const clientes = await libreta(db)
    const { formato } = q.data
    if (formato === 'json') return { clientes }

    const ahora = new Date()
    const hoy = ahora.toLocaleDateString('en-CA', { timeZone: config.zonaHoraria })
    const generado = ahora.toLocaleString('es-MX', { timeZone: config.zonaHoraria, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const datos = formato === 'xlsx'
      ? aXlsx([tablaLibreta(clientes)], { titulo: 'Libreta de clientes', subtitulo: `${clientes.length} clientes activos · Generado el ${generado}` })
      : aCsv(tablaLibreta(clientes))
    return rep
      .header('content-type', MIME[formato])
      .header('content-disposition', `attachment; filename="libreta-clientes-${hoy}.${formato}"`)
      .header('cache-control', 'no-store')
      .send(datos)
  })
}
