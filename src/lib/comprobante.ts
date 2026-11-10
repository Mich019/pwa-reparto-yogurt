import type { Cliente, Pedido, Producto } from './db'
import { dinero, textoFecha } from './fechas'
import { telLimpio } from '../components/ui'
import { textoCantidad } from './unidades'

// Comprobante de una entrega para mandarlo al cliente por WhatsApp: qué se le llevó, cuánto fue y cómo pagó. Es sólo
// un mensaje de texto (no lleva costos ni márgenes).

const PAGO = { EFECTIVO: 'Pagado en efectivo', TRANSFERENCIA: 'Pagado por transferencia', CREDITO: 'Queda a fiado' } as const

export function textoComprobante(cliente: Pick<Cliente, 'nombre'>, pedido: Pedido, productos: Producto[], empresa?: string): string {
  const prod = new Map(productos.map((p) => [p.id, p]))
  const lineas = pedido.items.map((i) => {
    const p = prod.get(i.productoId)
    const nombre = p?.sabor ?? 'Producto'
    return `• ${textoCantidad(i.litros, p)} de ${nombre}: ${dinero(i.litros * i.precio_litro)}`
  })
  const pago = pedido.metodo_pago ? PAGO[pedido.metodo_pago] : ''
  return [
    empresa ? `*${empresa}*` : '',
    `Hola ${cliente.nombre}, gracias por tu compra (${textoFecha(pedido.fecha).toLowerCase()}):`,
    '',
    ...lineas,
    '',
    `*Total: ${dinero(pedido.total)}*`,
    pago,
  ].filter((l, n, todas) => l !== '' || (n > 0 && todas[n - 1] !== '')).join('\n').trim()
}

// Estado de cuenta del fiado: los últimos movimientos (sin los anulados) y lo que queda pendiente.
export function textoEstadoCuenta(nombre: string, movimientos: { tipo: 'venta' | 'abono'; fecha: string; monto: number; anulado: boolean }[], saldo: number, empresa?: string): string {
  const ultimos = movimientos.filter((m) => !m.anulado).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 8).reverse()
  return [
    empresa ? `*${empresa}*` : '',
    `Hola ${nombre.split(' ')[0] || nombre}, este es tu estado de cuenta:`,
    '',
    ...ultimos.map((m) => `• ${textoFecha(m.fecha.slice(0, 10))}: ${m.tipo === 'venta' ? 'compra a fiado' : 'abono'} ${dinero(m.monto)}`),
    '',
    `*Saldo pendiente: ${dinero(saldo)}*`,
  ].filter((l, n, todas) => l !== '' || (n > 0 && todas[n - 1] !== '')).join('\n').trim()
}

export const enlaceComprobante = (cliente: Pick<Cliente, 'nombre' | 'telefono'>, pedido: Pedido, productos: Producto[], empresa?: string) =>
  `https://wa.me/${telLimpio(cliente.telefono)}?text=${encodeURIComponent(textoComprobante(cliente, pedido, productos, empresa))}`

