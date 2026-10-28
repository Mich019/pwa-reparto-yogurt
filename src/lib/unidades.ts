import type { DetallePedido, Producto } from './db'
import { tipoEnvase } from './registro'

// Catálogo flexible: cada producto se mide en su unidad (L, kg, pz…) y se entrega en su envase (frasco, garrafón…).
// Los pedidos guardan la cantidad en la unidad (el campo `litros` de siempre) y el precio por unidad (`precio_litro`);
// aquí se convierten a lo que se lee en pantalla. Sin unidad ni envase, un producto es yogurt por litro como antes.

export const unidadDe = (p: Pick<Producto, 'unidad'>) => p.unidad || 'L'
export const contenidoDe = (p: Pick<Producto, 'presentacion'>) => p.presentacion ?? 1
export const formato = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 2 })

// «Garrafón», o null si el producto no tiene envase propio.
export const envaseDe = (p: Pick<Producto, 'envase'>) => (p.envase ? (tipoEnvase(p.envase)?.nombre ?? p.envase) : null)

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
export function presentacionDe(p: Producto) {
  const contenido = `${formato(contenidoDe(p))} ${unidadDe(p)}`
  const e = envaseDe(p)
  if (e) return `${e} ${contenido}`
  return contenidoDe(p) !== 1 ? `envase de ${contenido}` : null
}

// Los productos con envase se cuentan por envase («3 garrafones»); los demás, en su unidad («2.5 litros»).
export function cantidadEnPantalla(cantidad: number, p: Producto) {
  const e = envaseDe(p)
  if (e) {
    const n = Math.round((cantidad / contenidoDe(p)) * 100) / 100
    return { numero: n, texto: plural(e, n) }
  }
  return { numero: cantidad, texto: nombreUnidad(unidadDe(p), cantidad) }
}

// Precio que se lee: por envase si lo hay («$450 c/u»), si no por unidad («$60 / L»).
export function precioEnPantalla(p: Producto) {
  return envaseDe(p) || contenidoDe(p) !== 1 ? { valor: p.precio_litro * contenidoDe(p), sufijo: 'c/u' } : { valor: p.precio_litro, sufijo: `/ ${unidadDe(p)}` }
}

// Total de un pedido por unidad: «60 L + 25 kg» (no se suman litros con kilos).
export function totalPorUnidad(items: DetallePedido[], productos: Producto[]) {
  const prod = new Map(productos.map((p) => [p.id, p]))
  const suma = new Map<string, number>()
  for (const i of items) {
    const u = unidadDe(prod.get(i.productoId) ?? {})
    suma.set(u, (suma.get(u) ?? 0) + i.litros)
  }
  return [...suma].map(([u, n]) => `${formato(n)} ${u}`).join(' + ')
}
