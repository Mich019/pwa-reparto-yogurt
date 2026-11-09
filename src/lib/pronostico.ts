import type { Cliente, Pedido, Producto } from './db'
import { hoy, sumarDias, tocaVisita } from './fechas'
import { unidadDe } from './unidades'

export interface FilaPronostico {
  producto: Producto
  confirmado: number
  estimado: number
  total: number
}

// Demanda en litros por sabor para los próximos 7 días (a partir de mañana):
// confirmada = pedidos PENDIENTE ya agendados; estimada = clientes a los que les toca visita
// ese día y aún no tienen pedido, con su promedio histórico por sabor.
export function pronosticoSemanal(clientes: Cliente[], pedidos: Pedido[], productos: Producto[], desde = sumarDias(hoy(), 1), dias = 7) {
  const hasta = sumarDias(desde, dias - 1)
  const confirmado = new Map<string, number>()
  const estimado = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)

  // Lo mismo, día por día (para producir cada sabor cerca del día en que sale).
  const porDia = new Map<string, Map<string, { confirmado: number; estimado: number }>>()
  const deDia = (d: string, id: string) => {
    const m = porDia.get(d) ?? porDia.set(d, new Map()).get(d)!
    return m.get(id) ?? m.set(id, { confirmado: 0, estimado: 0 }).get(id)!
  }

  // Un sabor que se dejó de producir (sin stock) ya no se estima; lo que ya pidieron sí cuenta.
  const fuera = new Set(productos.filter((p) => !p.disponible).map((p) => p.id))
  const agendados = new Set<string>()
  for (const p of pedidos) {
    if (p.fecha < desde || p.fecha > hasta) continue
    if (p.estado === 'PENDIENTE') p.items.forEach((i) => { add(confirmado, i.productoId, i.litros); deDia(p.fecha, i.productoId).confirmado += i.litros })
    if (p.estado === 'PENDIENTE' || p.estado === 'ENTREGADO') agendados.add(`${p.clienteId}|${p.fecha}`)
  }

  const entregadosPorCliente = new Map<string, Pedido[]>()
  for (const p of pedidos) {
    if (p.estado !== 'ENTREGADO') continue
    const l = entregadosPorCliente.get(p.clienteId) ?? []
    l.push(p)
    entregadosPorCliente.set(p.clienteId, l)
  }

  const pedidosConfirmados = pedidos.filter((p) => p.estado === 'PENDIENTE' && p.fecha >= desde && p.fecha <= hasta).length
  let clientesEstimados = 0
  for (const c of clientes) {
    if (!c.activo) continue
    const hist = (entregadosPorCliente.get(c.id) ?? []).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8)
    if (!hist.length) continue
    const promedio = new Map<string, number>()
    hist.forEach((p) => p.items.forEach((i) => { if (!fuera.has(i.productoId)) add(promedio, i.productoId, i.litros / hist.length) }))
    let ultima = hist[0].fecha
    let contado = false
    for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
      if (!tocaVisita(c.frecuencia, d, ultima)) continue
      if (c.frecuencia.tipo === 'intervalo') ultima = d
      if (agendados.has(`${c.id}|${d}`)) continue
      promedio.forEach((v, k) => { add(estimado, k, v); deDia(d, k).estimado += v })
      contado = true
    }
    if (contado) clientesEstimados++
  }

  const filas: FilaPronostico[] = productos
    .map((producto) => {
      const conf = confirmado.get(producto.id) ?? 0
      const est = Math.round((estimado.get(producto.id) ?? 0) * 2) / 2
      return { producto, confirmado: conf, estimado: est, total: Math.ceil(conf + est) }
    })
    .filter((f) => f.total > 0)
    .sort((a, b) => b.total - a.total)

  const porDias = [...porDia].sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, m]) => ({ fecha, sabores: [...m].map(([productoId, x]) => ({ productoId, ...x })) }))
  return { desde, hasta, filas, clientesEstimados, pedidosConfirmados, dias: porDias }
}

// Qué tan atinado fue el pronóstico en los últimos días: cada día se rehace con lo que se sabía la víspera (el historial
// de antes y los pedidos de ese día ya creados) y se compara, sabor por sabor, con lo que se entregó. Por unidad (nunca
// litros con kilos). `desvio`: promedio de lo que se erró (en % de lo entregado); `sesgo` > 0 = suele pasarse.
export interface AciertoPronostico { unidad: string; dias: number; estimado: number; real: number; desvio: number; sesgo: number }
export function aciertoPronostico(clientes: Cliente[], pedidos: Pedido[], productos: Producto[], dias = 14, hasta = sumarDias(hoy(), -1)): AciertoPronostico[] {
  const unidad = new Map(productos.map((p) => [p.id, unidadDe(p)]))
  const cuentas = new Map<string, { dias: Set<string>; estimado: number; real: number; error: number }>()
  for (let i = dias - 1; i >= 0; i--) {
    const d = sumarDias(hasta, -i)
    const vispera = new Date(`${d}T00:00:00`).getTime()
    const vistos = pedidos
      .filter((p) => p.fecha < d || (p.fecha === d && p.creado < vispera))
      .map((p) => (p.fecha === d ? { ...p, estado: 'PENDIENTE' as const } : p))
    const est = new Map<string, number>()
    for (const f of pronosticoSemanal(clientes, vistos, productos, d, 1).filas) est.set(f.producto.id, f.confirmado + f.estimado)
    const real = new Map<string, number>()
    for (const p of pedidos) if (p.fecha === d && p.estado === 'ENTREGADO') p.items.forEach((x) => real.set(x.productoId, (real.get(x.productoId) ?? 0) + x.litros))
    for (const id of new Set([...est.keys(), ...real.keys()])) {
      const u = unidad.get(id)
      if (!u) continue
      const c = cuentas.get(u) ?? { dias: new Set<string>(), estimado: 0, real: 0, error: 0 }
      const [e, r] = [est.get(id) ?? 0, real.get(id) ?? 0]
      c.estimado += e; c.real += r; c.error += Math.abs(e - r)
      if (r > 0) c.dias.add(d)
      cuentas.set(u, c)
    }
  }
  return [...cuentas].filter(([, c]) => c.real > 0 && c.dias.size >= 3).map(([u, c]) => ({
    unidad: u, dias: c.dias.size, estimado: Math.round(c.estimado * 10) / 10, real: Math.round(c.real * 10) / 10,
    desvio: Math.round((c.error / c.real) * 100), sesgo: Math.round(((c.estimado - c.real) / c.real) * 100),
  }))
}

export interface ResumenVentas {
  dinero: number
  litros: number
  clientes: number
  margen: number
  porSabor: { producto: Producto; litros: number; dinero: number; margen: number }[]
}

export function resumenVentas(pedidos: Pedido[], productos: Producto[], desde: string, hasta: string): ResumenVentas {
  const prod = new Map(productos.map((p) => [p.id, p]))
  const porSabor = new Map<string, { litros: number; dinero: number; margen: number }>()
  const clientes = new Set<string>()
  let dinero = 0, litros = 0, margen = 0
  for (const p of pedidos) {
    if (p.estado !== 'ENTREGADO' || p.fecha < desde || p.fecha > hasta) continue
    clientes.add(p.clienteId)
    for (const i of p.items) {
      const costo = prod.get(i.productoId)?.costo_litro ?? 0
      const s = porSabor.get(i.productoId) ?? { litros: 0, dinero: 0, margen: 0 }
      s.litros += i.litros
      s.dinero += i.litros * i.precio_litro
      s.margen += i.litros * (i.precio_litro - costo)
      porSabor.set(i.productoId, s)
      litros += i.litros
      dinero += i.litros * i.precio_litro
      margen += i.litros * (i.precio_litro - costo)
    }
  }
  return {
    dinero, litros, margen, clientes: clientes.size,
    porSabor: [...porSabor.entries()]
      .filter(([id]) => prod.has(id))
      .map(([id, s]) => ({ producto: prod.get(id)!, ...s }))
      .sort((a, b) => b.litros - a.litros),
  }
}
