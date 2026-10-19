import type { Cliente, Pedido, Producto } from './db'
import { hoy, sumarDias, tocaVisita } from './fechas'

export interface FilaPronostico {
  producto: Producto
  confirmado: number
  estimado: number
  total: number
}

// Demanda en litros por sabor para los próximos 7 días (a partir de mañana):
// confirmada = pedidos PENDIENTE ya agendados; estimada = clientes a los que les toca visita
// ese día y aún no tienen pedido, con su promedio histórico por sabor.
export function pronosticoSemanal(clientes: Cliente[], pedidos: Pedido[], productos: Producto[], desde = sumarDias(hoy(), 1)) {
  const hasta = sumarDias(desde, 6)
  const confirmado = new Map<string, number>()
  const estimado = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)

  const agendados = new Set<string>()
  for (const p of pedidos) {
    if (p.fecha < desde || p.fecha > hasta) continue
    if (p.estado === 'PENDIENTE') p.items.forEach((i) => add(confirmado, i.productoId, i.litros))
    if (p.estado === 'PENDIENTE' || p.estado === 'ENTREGADO') agendados.add(`${p.clienteId}|${p.fecha}`)
  }

  const entregadosPorCliente = new Map<string, Pedido[]>()
  for (const p of pedidos) {
    if (p.estado !== 'ENTREGADO') continue
    const l = entregadosPorCliente.get(p.clienteId) ?? []
    l.push(p)
    entregadosPorCliente.set(p.clienteId, l)
  }

  let clientesEstimados = 0
  for (const c of clientes) {
    if (!c.activo) continue
    const hist = (entregadosPorCliente.get(c.id) ?? []).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8)
    if (!hist.length) continue
    const promedio = new Map<string, number>()
    hist.forEach((p) => p.items.forEach((i) => add(promedio, i.productoId, i.litros / hist.length)))
    let ultima = hist[0].fecha
    let contado = false
    for (let d = desde; d <= hasta; d = sumarDias(d, 1)) {
      if (!tocaVisita(c.frecuencia, d, ultima)) continue
      if (c.frecuencia.tipo === 'intervalo') ultima = d
      if (agendados.has(`${c.id}|${d}`)) continue
      promedio.forEach((v, k) => add(estimado, k, v))
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

  return { desde, hasta, filas, clientesEstimados }
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
