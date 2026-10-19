import { Minus, Plus } from 'lucide-react'
import type { DetallePedido, Producto } from '../lib/db'
import { dinero } from '../lib/fechas'
import { Insignia } from './Fruta'

export type Cantidades = Record<string, number> // productoId -> litros

export const aCantidades = (items: DetallePedido[]): Cantidades =>
  Object.fromEntries(items.map((i) => [i.productoId, i.litros]))

export function aItems(c: Cantidades, productos: Producto[]): DetallePedido[] {
  const prod = new Map(productos.map((p) => [p.id, p]))
  return Object.entries(c)
    .filter(([id, l]) => l > 0 && prod.has(id))
    .map(([id, litros]) => ({ productoId: id, litros, precio_litro: prod.get(id)!.precio_litro }))
}

// Una tarjeta limpia por sabor: su fruta, el precio y [-] litros [+] con botones grandes para una sola mano.
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
          return (
            <div key={p.id} className={`rounded-2xl bg-papel p-3.5 transition-colors ${l ? 'ring-2 ring-tinta' : 'ring-1 ring-linea'}`}>
              <div className="flex items-start justify-between">
                <Insignia sabor={p.sabor} color={p.color_hex} size={52} />
                <div className={`pt-1 text-sm font-semibold tabular-nums ${l ? 'text-tinta' : 'text-transparent'}`}>{dinero(l * p.precio_litro)}</div>
              </div>
              <div className="mt-2.5 truncate text-base leading-5 font-semibold">{p.sabor}</div>
              <div className="text-xs text-apagado">{dinero(p.precio_litro)} / L</div>
              <div className="mt-3 flex items-center justify-between">
                <button
                  onClick={() => cambiar(p.id, -1)}
                  className="grid h-11 w-11 place-items-center rounded-full bg-niebla active:bg-linea disabled:opacity-35"
                  aria-label={`Quitar litro de ${p.sabor}`}
                  disabled={!l}
                >
                  <Minus size={20} strokeWidth={2.5} />
                </button>
                <div className="text-center">
                  <div className="text-2xl leading-6 font-semibold tabular-nums">{l}</div>
                  <div className="text-[11px] text-apagado">litros</div>
                </div>
                <button
                  onClick={() => cambiar(p.id, 1)}
                  className="grid h-11 w-11 place-items-center rounded-full bg-niebla active:bg-linea"
                  aria-label={`Agregar litro de ${p.sabor}`}
                >
                  <Plus size={20} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-niebla px-4 py-3.5">
        <span className="text-apagado">{litros} L en total</span>
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{dinero(total)}</span>
      </div>
    </div>
  )
}
