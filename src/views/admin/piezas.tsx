import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { EstadoPedido, Producto } from '../../lib/db'
import { litrosTxt, type VentaSabor } from '../../lib/admin-datos'
import { cambio } from '../../lib/reportes'
import { dinero } from '../../lib/fechas'
import { presentacionDe, unidadDe } from '../../lib/unidades'
import { AveEmpresa, Frasco } from './marca'

// Cambio contra el periodo anterior, con signo y flecha (nunca sólo con color). null = no hay con qué comparar.
export function Delta({ valor, className = 'text-xs' }: { valor: number | null; className?: string }) {
  if (valor === null) return null
  const sube = valor > 0
  const igual = valor === 0
  const Icono = igual ? Minus : sube ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${igual ? 'text-apagado' : sube ? 'text-verde' : 'text-rojo'} ${className}`}>
      <Icono size={14} strokeWidth={2.4} aria-hidden="true" />
      {igual ? '0%' : `${sube ? '+' : '−'}${Math.abs(valor).toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`}
    </span>
  )
}

// Lo que se ve donde todavía no hay nada: el ave de la marca y una línea que dice qué hacer.
export function Vacio({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center">
      <AveEmpresa className="h-16 opacity-80" />
      <p className="max-w-xs text-sm text-apagado">{children}</p>
    </div>
  )
}

const ESTADOS: Record<EstadoPedido, { texto: string; clase: string }> = {
  ENTREGADO: { texto: 'Entregado', clase: 'bg-(--chip-ok-fondo) text-(--chip-ok-texto)' },
  PENDIENTE: { texto: 'Pendiente', clase: 'bg-(--chip-pendiente-fondo) text-(--chip-pendiente-texto)' },
  RECORDAR_MAS_TARDE: { texto: 'Para después', clase: 'bg-(--chip-neutro-fondo) text-tinta' },
  OMITIDO: { texto: 'Sin venta', clase: 'bg-(--chip-neutro-fondo) text-apagado' },
}

export function ChipEstado({ estado }: { estado: EstadoPedido }) {
  const e = ESTADOS[estado]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${e.clase}`}>{e.texto}</span>
}

// El sabor como producto: su envase del color del sabor, el nombre y lo que se vendió en 30 días.
export function TarjetaSabor({ producto, venta, posicion, conPrecio = false, frasco = 'h-28', onAbrir }: {
  producto: Producto
  venta: VentaSabor
  posicion?: number
  conPrecio?: boolean
  frasco?: string // alto del envase (clase de Tailwind)
  onAbrir: () => void
}) {
  const vendido = venta.litros > 0
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="group relative flex h-full w-full flex-col items-center rounded-[22px] bg-papel px-3 pb-3.5 pt-4 text-left transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(0,32,20,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
    >
      {posicion !== undefined && vendido && (
        <span
          title={posicion === 1 ? 'El que más litros vendió' : `Puesto ${posicion} en ventas`}
          className={`absolute left-3 top-3 grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${posicion === 1 ? 'bg-limon text-tinta' : 'bg-niebla text-apagado'}`}
        >
          <span className="sr-only">Puesto </span>{posicion}
        </span>
      )}
      {!producto.disponible && <span className="absolute right-3 top-3 rounded-full bg-niebla px-2 py-0.5 text-[11px] font-semibold text-apagado">Sin stock</span>}
      <div className="flex flex-1 items-center justify-center">
        <Frasco color={producto.color_hex} apagado={!producto.disponible} className={`${frasco} transition-transform duration-300 group-hover:scale-[1.03]`} />
      </div>
      <div className="mt-3 w-full min-w-0">
        <div className="truncate text-sm font-semibold">{producto.sabor}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-apagado">
          <span className="tabular-nums">{vendido ? litrosTxt(venta.litros) : 'Sin ventas'}</span>
          <Delta valor={cambio(venta.litros, venta.litrosAntes)} />
        </div>
        {conPrecio && <div className="mt-1 text-xs text-apagado tabular-nums">{dinero(producto.precio_litro)}/{unidadDe(producto)}{presentacionDe(producto) && ` · ${presentacionDe(producto)}`}</div>}
      </div>
    </button>
  )
}
