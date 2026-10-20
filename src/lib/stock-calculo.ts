// La parte de las cuentas del stock (RF-037) y de los avisos locales (RF-055), sin React ni base de datos:
// son funciones puras, y por eso se pueden probar solas (api/_test/alertas.test.ts).

// Sólo lo que las cuentas necesitan de cada registro (los de db.ts lo cumplen): así este archivo no depende de Dexie.
interface PedidoMin { fecha: string; estado: string; items: { productoId: string; litros: number }[] }
interface StockMin { fecha: string; productoId: string; asignada: number; devuelta: number }
interface CambioMin { tabla: string; op: string; registroId: string }

export type Nivel = 'ok' | 'bajo' | 'falta' | 'agotado'

export interface SaborEnRuta {
  productoId: string
  asignada: number
  entregado: number
  devuelta: number
  restante: number // lo que le queda en la camioneta (nunca menos de 0)
  pendiente: number // lo que le piden los pedidos de hoy que todavía no entrega
  nivel: Nivel
}

// «Por agotarse»: le quedan 2 litros o menos, o la quinta parte o menos de lo que llevó (lo que sea más).
export const UMBRAL_LITROS = 2
export const UMBRAL_FRACCION = 0.2

const redondear = (n: number) => Math.round(n * 100) / 100
const litrosDe = (p: PedidoMin, productoId: string) => p.items.filter((i) => i.productoId === productoId).reduce((s, i) => s + i.litros, 0)

// El estado de cada sabor del día a partir de lo asignado y de los pedidos de hoy.
export function calcularStock(fecha: string, stock: StockMin[], pedidos: PedidoMin[]): SaborEnRuta[] {
  const delDia = stock.filter((s) => s.fecha === fecha)
  const deHoy = pedidos.filter((p) => p.fecha === fecha)
  // Sin carga asignada no hay nada que vigilar: así no avisa a quien no usa el control de stock.
  if (!delDia.some((s) => s.asignada > 0)) return []
  const ids = new Set([...delDia.map((s) => s.productoId), ...deHoy.filter((p) => p.estado === 'PENDIENTE').flatMap((p) => p.items.map((i) => i.productoId))])

  return [...ids].map((productoId) => {
    const fila = delDia.find((s) => s.productoId === productoId)
    const asignada = fila?.asignada ?? 0
    const entregado = redondear(deHoy.filter((p) => p.estado === 'ENTREGADO').reduce((s, p) => s + litrosDe(p, productoId), 0))
    const pendiente = redondear(deHoy.filter((p) => p.estado === 'PENDIENTE').reduce((s, p) => s + litrosDe(p, productoId), 0))
    const restante = Math.max(0, redondear(asignada - entregado))
    const nivel: Nivel =
      asignada > 0 && restante <= 0 ? 'agotado'
      : pendiente > restante ? 'falta'
      : asignada > 0 && restante <= Math.max(UMBRAL_LITROS, asignada * UMBRAL_FRACCION) ? 'bajo'
      : 'ok'
    return { productoId, asignada, entregado, devuelta: fila?.devuelta ?? 0, restante, pendiente, nivel }
  })
}

export const PESO_NIVEL: Record<Nivel, number> = { agotado: 0, falta: 1, bajo: 2, ok: 3 }
export const hayAvisoDeStock = (s: SaborEnRuta) => s.nivel !== 'ok'

export function textoNivel(s: SaborEnRuta, sabor: string): { titulo: string; cuerpo: string } {
  const l = (n: number) => `${n} L`
  if (s.nivel === 'agotado') return { titulo: `Se agotó ${sabor}`, cuerpo: s.pendiente > 0 ? `Te piden ${l(s.pendiente)} de ${sabor} hoy y ya no te queda.` : `Ya entregaste los ${l(s.asignada)} que llevabas.` }
  if (s.nivel === 'falta') return { titulo: `No te alcanza ${sabor}`, cuerpo: `Te quedan ${l(s.restante)} y tus pedidos de hoy piden ${l(s.pendiente)}.` }
  return { titulo: `Queda poco ${sabor}`, cuerpo: `Te quedan ${l(s.restante)} de los ${l(s.asignada)} que llevabas.` }
}

// ------------------------------------------------------------------ RF-055: qué avisos tocan

export interface AvisoNuevo {
  id: string
  tipo: 'stock_bajo' | 'sync_pendiente'
  titulo: string
  cuerpo: string
  pestana: 'stock' | 'cuenta'
}

export interface EntradaAlertas {
  fecha: string
  hora: number // 0 a 23, del teléfono
  horaCierre: number
  filas: SaborEnRuta[]
  productos: { id: string; sabor: string }[]
  cola: CambioMin[]
}

export function pendientesTexto(cola: CambioMin[]) {
  const ventas = new Set(cola.filter((c) => c.tabla === 'pedidos' && c.op === 'put').map((c) => c.registroId)).size
  const total = new Set(cola.map((c) => `${c.tabla}:${c.registroId}`)).size
  const otros = total - ventas
  return [ventas ? `${ventas} ${ventas === 1 ? 'pedido' : 'pedidos'}` : '', otros ? `${otros} ${otros === 1 ? 'cambio' : 'cambios'}` : ''].filter(Boolean).join(' y ')
}

// Cada aviso lleva un id que depende del día y del nivel: la app lo guarda con ese id y por eso sale una sola vez.
export function avisosQueToca({ fecha, hora, horaCierre, filas, productos, cola }: EntradaAlertas): AvisoNuevo[] {
  const lista: AvisoNuevo[] = []
  for (const f of filas.filter(hayAvisoDeStock)) {
    const sabor = productos.find((p) => p.id === f.productoId)?.sabor ?? 'un sabor'
    const { titulo, cuerpo } = textoNivel(f, sabor)
    lista.push({ id: `stock:${fecha}:${f.productoId}:${f.nivel}`, tipo: 'stock_bajo', titulo, cuerpo, pestana: 'stock' })
  }
  if (cola.length > 0 && hora >= horaCierre) {
    lista.push({
      id: `sync:${fecha}`,
      tipo: 'sync_pendiente',
      titulo: 'Tienes ventas sin enviar',
      cuerpo: `${pendientesTexto(cola)} por sincronizar. Conéctate a internet antes de cerrar el día.`,
      pestana: 'cuenta',
    })
  }
  return lista
}
