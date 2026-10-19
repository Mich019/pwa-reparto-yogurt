import { Minus, Plus } from 'lucide-react'
import type { DetallePedido, Producto } from '../lib/db'
import { dinero } from '../lib/fechas'

export type Cantidades = Record<string, number> // productoId -> litros

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

// Tarjetas grandes por sabor con [-] litros [+], pensadas para una sola mano.
export function SelectorSabores({ productos, valor, onChange }: {
  productos: Producto[]
  valor: Cantidades
  onChange: (c: Cantidades) => void
}) {
  const visibles = productos.filter((p) => p.disponible || valor[p.id])
  const cambiar = (id: string, d: number) => onChange({ ...valor, [id]: Math.max(0, (valor[id] ?? 0) + d) })
  const items = aItems(valor, productos)
  const litros = items.reduce((s, i) => s + i.litros, 0)
  const total = items.reduce((s, i) => s + i.litros * i.precio_litro, 0)

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {visibles.map((p) => {
          const l = valor[p.id] ?? 0
          const color = textoSobre(p.color_hex)
          return (
            <div
              key={p.id}
              className={`overflow-hidden rounded-2xl border-2 transition-all ${l ? 'border-white/80' : 'border-transparent opacity-80'}`}
              style={{ background: p.color_hex, color }}
            >
              <div className="px-3 pt-3">
                <div className="text-lg leading-tight font-extrabold">{p.sabor}</div>
                <div className="text-xs font-medium opacity-75">{dinero(p.precio_litro)} / L</div>
              </div>
              <div className="flex items-center justify-between gap-1 p-2">
                <button
                  onClick={() => cambiar(p.id, -1)}
                  className="grid h-12 w-12 place-items-center rounded-xl bg-black/15 active:bg-black/30"
                  aria-label={`Quitar litro de ${p.sabor}`}
                >
                  <Minus size={22} strokeWidth={3} />
                </button>
                <div className="text-center">
                  <div className="text-3xl leading-none font-black tabular-nums">{l}</div>
                  <div className="text-[11px] font-semibold opacity-75">litros</div>
                </div>
                <button
                  onClick={() => cambiar(p.id, 1)}
                  className="grid h-12 w-12 place-items-center rounded-xl bg-black/15 active:bg-black/30"
                  aria-label={`Agregar litro de ${p.sabor}`}
                >
                  <Plus size={22} strokeWidth={3} />
                </button>
              </div>
              <div className="bg-black/10 px-3 py-1 text-right text-sm font-bold tabular-nums">{l ? dinero(l * p.precio_litro) : '—'}</div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-800 px-4 py-3">
        <span className="text-slate-300">{litros} L en total</span>
        <span className="text-xl font-extrabold tabular-nums">{dinero(total)}</span>
      </div>
    </div>
  )
}
