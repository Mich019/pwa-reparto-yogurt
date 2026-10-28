import { Minus, Plus } from 'lucide-react'
import type { DetallePedido, Producto } from '../../lib/db'
import { dinero } from '../../lib/fechas'
import { cantidadEnPantalla, contenidoDe, precioEnPantalla, presentacionDe, totalPorUnidad, unidadDe } from '../../lib/unidades'

export type Cantidades = Record<string, number> // productoId -> cantidad en la unidad del producto (litros para el yogurt)

export const aCantidades = (items: DetallePedido[]): Cantidades =>
  Object.fromEntries(items.map((i) => [i.productoId, i.litros]))

export function aItems(c: Cantidades, productos: Producto[]): DetallePedido[] {
  const prod = new Map(productos.map((p) => [p.id, p]))
  return Object.entries(c)
    .filter(([id, l]) => l > 0 && prod.has(id))
    .map(([id, litros]) => ({ productoId: id, litros, precio_litro: prod.get(id)!.precio_litro }))
}

// Texto claro sobre el fondo de color del sabor.
function textoSobre(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return l > 0.6 ? '#0f172a' : '#ffffff'
}

// Tarjetas por sabor: el color arriba con [-] cantidad [+] y una franja oscura con nombre y precio,
// como las tarjetas de vehículo de Uber. Botones grandes para usar con una sola mano.
export function SelectorSabores({ productos, valor, onChange }: {
  productos: Producto[]
  valor: Cantidades
  onChange: (c: Cantidades) => void
}) {
  const visibles = productos.filter((p) => p.disponible || valor[p.id])
  // Cada toque suma o quita un envase (RF-032: 1 litro, kilo o pieza si el sabor no dice otra cosa).
  const cambiar = (id: string, d: number) => onChange({ ...valor, [id]: Math.max(0, Math.round(((valor[id] ?? 0) + d) * 100) / 100) })
  const items = aItems(valor, productos)
  const total = items.reduce((s, i) => s + i.litros * i.precio_litro, 0)

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {visibles.map((p) => {
          const l = valor[p.id] ?? 0
          const envase = contenidoDe(p)
          const color = textoSobre(p.color_hex)
          const cantidad = cantidadEnPantalla(l, p)
          const precio = precioEnPantalla(p)
          const presentacion = presentacionDe(p)
          return (
            <div key={p.id} className={`flex flex-col overflow-hidden rounded-2xl transition-shadow ${l ? 'shadow-tarjeta ring-2 ring-tinta' : 'ring-1 ring-linea'}`}>
              <div className="flex items-center justify-between gap-1 px-2 py-4" style={{ background: p.color_hex, color }}>
                <button
                  onClick={() => cambiar(p.id, -envase)}
                  className="grid h-11 w-11 place-items-center rounded-full bg-white/80 text-tinta active:bg-white disabled:opacity-40"
                  aria-label={`Quitar ${presentacion ?? 'uno'} de ${p.sabor}`}
                  disabled={!l}
                >
                  <Minus size={20} strokeWidth={3} />
                </button>
                <div className="text-center">
                  <div className="text-4xl leading-none font-extrabold tabular-nums">{cantidad.numero}</div>
                  <div className="mt-0.5 text-[11px] font-semibold opacity-70">{cantidad.texto}</div>
                </div>
                <button
                  onClick={() => cambiar(p.id, envase)}
                  className="grid h-11 w-11 place-items-center rounded-full bg-white/80 text-tinta active:bg-white"
                  aria-label={`Agregar ${presentacion ?? 'uno'} de ${p.sabor}`}
                >
                  <Plus size={20} strokeWidth={3} />
                </button>
              </div>
              <div className="flex-1 bg-marino px-3 py-2.5 text-white">
                <div className="truncate text-base leading-5 font-bold">{p.sabor}</div>
                <div className="mt-0.5 flex justify-between gap-2 text-xs text-white/60">
                  <span>{dinero(precio.valor)} {precio.sufijo}</span>
                  <span className={`font-bold tabular-nums ${l ? 'text-white' : ''}`}>{l ? dinero(l * p.precio_litro) : '—'}</span>
                </div>
                {presentacion && <div className="mt-0.5 truncate text-[11px] text-white/60">{presentacion}</div>}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-marino px-4 py-3.5 text-white">
        <span className="text-white/70">{totalPorUnidad(items, productos) || `0 ${unidadDe(visibles[0] ?? {})}`} en total</span>
        <span className="text-2xl font-extrabold tracking-tight tabular-nums">{dinero(total)}</span>
      </div>
    </div>
  )
}
