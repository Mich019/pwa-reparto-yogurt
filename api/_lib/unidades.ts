// Catálogo flexible del lado del servidor: los avisos y reportes suman por unidad («12 L + 10 kg»), nunca litros con
// kilos. Lo mismo hace el teléfono con src/lib/unidades.ts.

const redondear = (n: number) => Math.round(n * 100) / 100

export function totalPorUnidad(filas: { unidad: string | null | undefined; cantidad: number }[]) {
  const suma = new Map<string, number>()
  for (const f of filas) {
    const u = f.unidad || 'L'
    suma.set(u, (suma.get(u) ?? 0) + f.cantidad)
  }
  return [...suma].map(([u, n]) => `${redondear(n)} ${u}`).join(' + ') || '0 L'
}

// Encabezado de una columna de cantidad en Excel y PDF: «Litros», «Kilos», «Piezas» o «Cantidad (cajas)».
export const tituloUnidad = (u: string) => ({ L: 'Litros', kg: 'Kilos', pz: 'Piezas' })[u] ?? `Cantidad (${u})`

// Las unidades de la empresa para sus totales, L primero: las de los productos a la venta más las que tengan ventas
// (un producto en kg dado de baja y sin ventas no agrega una columna de ceros).
export const ordenarUnidades = (us: Iterable<string>) => [...new Set(us)].sort((a, b) => (a === 'L' ? -1 : b === 'L' ? 1 : a.localeCompare(b)))
