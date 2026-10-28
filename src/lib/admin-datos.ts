import { useLiveQuery } from 'dexie-react-hooks'
import { db, type EstadoPedido, type Producto } from './db'
import { desdeIso, hoy, iso, sumarDias } from './fechas'

// Números del panel de administración que salen de la copia local (el administrador baja todo el historial al
// sincronizar, ver sync.ts): ventas por sabor y últimos pedidos. Los de «hoy» y los reportes los da el servidor.

// En la unidad del sabor (catálogo flexible); L para el yogurt.
export const litrosTxt = (n: number, unidad = 'L') => `${n.toLocaleString('es-MX', { maximumFractionDigits: 1 })} ${unidad}`

// 1,200 → 1.2K, para los números del eje de los gráficos (el valor exacto va en el tooltip y en la tabla).
export const compacto = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })}K` : String(Math.round(n)))

export function saludo(hora = new Date().getHours()) {
  return hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches'
}

const INICIALES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

// El mes en curso y los anteriores, del más viejo al más nuevo.
export function ultimosMeses(n = 12, ancla = hoy()) {
  const d = desdeIso(ancla)
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1)
    return {
      clave: iso(m).slice(0, 7),
      inicial: INICIALES[m.getMonth()],
      corto: m.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''),
      nombre: m.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }),
    }
  })
}

export interface VentaSabor {
  litros: number // entregados en los últimos 30 días
  ingreso: number
  litrosAntes: number // los 30 días anteriores a esos, para saber si va subiendo
  meses: number[] // litros de cada uno de los últimos 12 meses; el último es el mes en curso
}

const sinVentas = (): VentaSabor => ({ litros: 0, ingreso: 0, litrosAntes: 0, meses: Array(12).fill(0) })

// Ventas entregadas por sabor. Cuenta los pedidos por su fecha programada, igual que los reportes del servidor.
export function useVentasPorSabor() {
  const dia = hoy()
  return useLiveQuery(async () => {
    const meses = ultimosMeses(12, dia)
    const desde30 = sumarDias(dia, -29)
    const desde60 = sumarDias(dia, -59)
    const pedidos = await db.pedidos.where('fecha').between(`${meses[0].clave}-01`, dia, true, true).filter((p) => p.estado === 'ENTREGADO').toArray()
    const porSabor = new Map<string, VentaSabor>()
    for (const p of pedidos) {
      const mes = meses.findIndex((m) => m.clave === p.fecha.slice(0, 7))
      for (const it of p.items) {
        const v = porSabor.get(it.productoId) ?? sinVentas()
        if (mes >= 0) v.meses[mes] += it.litros
        if (p.fecha >= desde30) {
          v.litros += it.litros
          v.ingreso += it.litros * it.precio_litro
        } else if (p.fecha >= desde60) v.litrosAntes += it.litros
        porSabor.set(it.productoId, v)
      }
    }
    return porSabor
  }, [dia])
}

const ventaDe = (ventas: Map<string, VentaSabor> | undefined, id: string) => ventas?.get(id) ?? sinVentas()

// Sabores del que más litros vendió al que menos; los que no se vendieron, por nombre. `posicion` empieza en 1.
export function ordenarPorVentas(productos: Producto[], ventas: Map<string, VentaSabor> | undefined) {
  return productos
    .map((producto) => ({ producto, venta: ventaDe(ventas, producto.id) }))
    .sort((a, b) => b.venta.litros - a.venta.litros || a.producto.sabor.localeCompare(b.producto.sabor, 'es'))
    .map((x, i) => ({ ...x, posicion: i + 1 }))
}

export interface PedidoReciente {
  id: string
  cliente: string
  total: number
  estado: EstadoPedido
  fecha: string
}

// Los últimos pedidos que ya tocaban (los agendados para después no cuentan todavía).
export function usePedidosRecientes(cuantos = 5) {
  const dia = hoy()
  return useLiveQuery(async (): Promise<PedidoReciente[]> => {
    const hasta = await db.pedidos.orderBy('fecha').reverse().filter((p) => p.fecha <= dia).limit(60).toArray()
    hasta.sort((a, b) => (a.fecha === b.fecha ? b.actualizado - a.actualizado : b.fecha.localeCompare(a.fecha)))
    const elegidos = hasta.slice(0, cuantos)
    const clientes = await db.clientes.bulkGet(elegidos.map((p) => p.clienteId))
    return elegidos.map((p, i) => ({ id: p.id, cliente: clientes[i]?.nombre ?? 'Cliente sin ficha', total: p.total, estado: p.estado, fecha: p.fecha }))
  }, [dia, cuantos])
}
