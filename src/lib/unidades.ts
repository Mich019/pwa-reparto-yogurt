import type { DetallePedido, Producto } from './db'
import { tipoEnvase } from './registro'

// Catálogo flexible: cada producto se mide en su unidad (L, kg, pz…) y se entrega en su envase (frasco, garrafón…).
// Los pedidos guardan la cantidad en la unidad (el campo `litros` de siempre) y el precio por unidad (`precio_litro`);
// aquí se convierten a lo que se lee en pantalla. Sin unidad ni envase, un producto es yogurt por litro como antes.

type Medida = Partial<Pick<Producto, 'unidad' | 'envase' | 'presentacion'>>

export const unidadDe = (p: Medida = {}) => p.unidad || 'L'
export const contenidoDe = (p: Medida = {}) => p.presentacion ?? 1
export const formato = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

// «Garrafón», o null si el producto no tiene envase propio.
export const envaseDe = (p: Medida = {}) => (p.envase ? (tipoEnvase(p.envase)?.nombre ?? p.envase) : null)

const NOMBRES: Record<string, [string, string]> = { L: ['litro', 'litros'], kg: ['kilo', 'kilos'], pz: ['pieza', 'piezas'] }
export const nombreUnidad = (u: string, n: number) => (NOMBRES[u] ? NOMBRES[u][n === 1 ? 0 : 1] : u)

// Plural de la primera palabra: «Garrafón» → «garrafones», «Bolsa de nylon» → «bolsas de nylon».
export function plural(nombre: string, n: number) {
  const [primera, ...resto] = nombre.toLowerCase().split(' ')
  if (n === 1) return [primera, ...resto].join(' ')
  const p = /[aeiouáéíóú]$/.test(primera) ? `${primera}s` : `${primera.replace(/ón$/, 'on').replace(/án$/, 'an')}es`
  return [p, ...resto].join(' ')
}

// «Garrafón 20 L», «envase de 0.5 L», o null para el litro suelto de siempre.
export function presentacionDe(p: Medida) {
  const contenido = `${formato(contenidoDe(p))} ${unidadDe(p)}`
  const e = envaseDe(p)
  if (e) return `${e} ${contenido}`
  return contenidoDe(p) !== 1 ? `envase de ${contenido}` : null
}

// Los productos con envase se cuentan por envase («3 garrafones»); los demás, en su unidad («2.5 litros»).
export function cantidadEnPantalla(cantidad: number, p: Medida = {}) {
  const e = envaseDe(p)
  if (e) {
    const n = Math.round((cantidad / contenidoDe(p)) * 100) / 100
    return { numero: n, texto: plural(e, n) }
  }
  return { numero: cantidad, texto: nombreUnidad(unidadDe(p), cantidad) }
}

// Una cantidad de un producto en una línea: «3 garrafones», «2.5 L» (el yogurt de siempre, igual que antes).
export function textoCantidad(cantidad: number, p: Medida = {}) {
  if (!envaseDe(p)) return `${formato(cantidad)} ${unidadDe(p)}`
  const c = cantidadEnPantalla(cantidad, p)
  return `${formato(c.numero)} ${c.texto}`
}

// Precio que se lee: por envase si lo hay («$450 c/u»), si no por unidad («$60 / L»).
export function precioEnPantalla(p: Producto) {
  return envaseDe(p) || contenidoDe(p) !== 1 ? { valor: p.precio_litro * contenidoDe(p), sufijo: 'c/u' } : { valor: p.precio_litro, sufijo: `/ ${unidadDe(p)}` }
}

// Suma por unidad de cantidades que ya traen la suya: «60 L + 25 kg» (no se suman litros con kilos). Vacío: ''.
export function sumaPorUnidad(filas: { unidad?: string | null; cantidad: number }[]) {
  const suma = new Map<string, number>()
  for (const f of filas) {
    const u = f.unidad || 'L'
    suma.set(u, (suma.get(u) ?? 0) + f.cantidad)
  }
  return [...suma].map(([u, n]) => `${formato(Math.round(n * 100) / 100)} ${u}`).join(' + ')
}

// Total de un pedido por unidad, buscando la de cada producto.
export function totalPorUnidad(items: Pick<DetallePedido, 'productoId' | 'litros'>[], productos: Producto[]) {
  const prod = new Map(productos.map((p) => [p.id, p]))
  return sumaPorUnidad(items.map((i) => ({ unidad: prod.get(i.productoId)?.unidad, cantidad: i.litros })))
}

// Igual, pero nunca vacío: sin nada, «0» en la unidad de la empresa («0 L» para el yogurt).
export const totalOCero = (items: Pick<DetallePedido, 'productoId' | 'litros'>[], productos: Producto[]) =>
  totalPorUnidad(items, productos) || `0 ${unidadDe(productos[0])}`

// Totales que el servidor ya trae por unidad ({ L: 60, kg: 10 }), en el orden de `unidades`: «60 L + 10 kg».
// Sin desglose (servidor anterior), los litros de siempre.
export function textoPorUnidad(pu: Record<string, number> | undefined, unidades: string[] = ['L'], litros = 0) {
  if (!pu) return `${formato(litros)} ${unidades[0] ?? 'L'}`
  const orden = [...unidades, ...Object.keys(pu).filter((u) => !unidades.includes(u))]
  return orden.filter((u) => pu[u]).map((u) => `${formato(pu[u])} ${u}`).join(' + ') || `0 ${unidades[0] ?? 'L'}`
}

// Encabezado de una columna o tarjeta de cantidad: «Litros», «Kilos», «Piezas» o «Cantidad (cajas)».
export const tituloUnidad = (u: string) => {
  const n = nombreUnidad(u, 2)
  return n === u ? `Cantidad (${u})` : n.charAt(0).toUpperCase() + n.slice(1)
}
