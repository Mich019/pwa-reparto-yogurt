import { useRef, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, Search } from 'lucide-react'
import type { EstadoPedido, Producto } from '../../lib/db'
import { litrosTxt, type VentaSabor } from '../../lib/admin-datos'
import { cambio } from '../../lib/reportes'
import { dinero } from '../../lib/fechas'
import { presentacionDe, unidadDe } from '../../lib/unidades'
import { AveEmpresa, Frasco, useLogoEtiqueta } from './marca'
import { DibujoEnvase } from '../registro/dibujos'

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

// Encabezado de una sección del panel: título grande, una línea de detalle y, a la derecha, sus acciones. Las acciones
// siempre llevan texto (Nuevo cliente, Invitar…), nunca un «+» suelto. En el teléfono, si no caben junto al título,
// bajan a su propia fila y la llenan (los grupos con `grupoPanel` se reparten el ancho).
export function Encabezado({ titulo, detalle, children }: { titulo: string; detalle?: ReactNode; children?: ReactNode }) {
  return (
    // Las acciones se centran con el título (no con el título y el detalle juntos); el detalle va debajo.
    <header className="pb-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[2.25rem] font-semibold leading-none sm:text-[2.5rem] lg:text-[3.25rem]">{titulo}</h1>
        {children && <div className="flex flex-wrap items-center gap-2 max-sm:grow max-sm:justify-end">{children}</div>}
      </div>
      {detalle && <p className="mt-3 text-sm text-apagado">{detalle}</p>}
    </header>
  )
}

const anilloFoco = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const baseBoton = `flex h-10 items-center whitespace-nowrap justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 ${anilloFoco}`
export const botonPanel = `${baseBoton} bg-tinta text-white hover:bg-marca-oscuro`
export const botonPanelSuave = `${baseBoton} bg-niebla text-tinta hover:bg-linea`
// Botones que van juntos (filtro, periodo, vista): en el teléfono se reparten el ancho de su fila; desde 640 px, a su medida.
export const grupoPanel = 'flex grow gap-1 sm:grow-0 [&>*]:grow sm:[&>*]:grow-0'
// Texto de un botón secundario que en el teléfono queda en sólo ícono (el texto sigue para el lector de pantalla).
export function TextoBoton({ children }: { children: ReactNode }) {
  return <span className="max-sm:sr-only">{children}</span>
}
// Línea vertical entre grupos de acciones; en el teléfono, donde las acciones se acomodan en filas, no va.
export function Separador() {
  return <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-linea sm:block" />
}
// Sólo un ícono (flechas de periodo): cuadrado de 40 px, sin el relleno lateral de los botones con texto.
export const botonPanelIcono = `grid h-10 w-10 shrink-0 place-items-center rounded-md bg-niebla text-tinta transition-colors hover:bg-linea disabled:opacity-40 ${anilloFoco}`

// Buscador del encabezado: sólo la lupa, del alto de los botones; al tocarla se despliega el campo (anima el ancho de
// un solo input). Desde 1280 px crece hacia la izquierda por encima del hueco junto al título, sin empujar los
// botones; en pantalla chica, donde las acciones ya van en su propia fila, ocupa su lugar (en el teléfono, abierto,
// toma una fila entera). Se queda abierto mientras
// haya texto; Escape lo borra y lo cierra.
export function BuscadorDesplegable({ valor, onChange, placeholder }: { valor: string; onChange: (v: string) => void; placeholder: string }) {
  const [abierto, setAbierto] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  const visible = abierto || valor !== ''
  return (
    <div className={`relative h-10 xl:w-10 ${visible ? 'max-sm:basis-full' : ''}`}>
    <div className={`z-10 flex h-10 max-sm:w-full flex-row-reverse items-center rounded-md bg-niebla transition-colors xl:absolute xl:right-0 xl:top-0 ${visible ? '' : 'hover:bg-linea'}`}>
      <button type="button" aria-label="Buscar" aria-expanded={visible} onClick={() => { setAbierto(true); campo.current?.focus() }}
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${anilloFoco}`}>
        <Search size={18} aria-hidden="true" />
      </button>
      <input
        ref={campo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { if (!valor) setAbierto(false) }}
        onKeyDown={(e) => { if (e.key === 'Escape') { onChange(''); setAbierto(false); e.currentTarget.blur() } }}
        tabIndex={visible ? 0 : -1}
        aria-label={placeholder}
        placeholder={placeholder}
        className={`h-full min-w-0 bg-transparent text-sm outline-none transition-[width,padding] duration-200 ease-out placeholder:text-apagado motion-reduce:transition-none ${visible ? 'w-40 pl-4 max-sm:grow xl:w-52 2xl:w-64' : 'w-0 p-0'}`}
      />
    </div>
    </div>
  )
}

// El trazo amarillo a mano bajo una palabra (el nombre del saludo, la sección activa del menú). Crece con la letra.
// Con `dibujar` (el menú) se dibuja de izquierda a derecha al aparecer (.trazo-dibujar en index.css); el del saludo, quieto.
export function Subrayado({ children, dibujar = false }: { children: ReactNode; dibujar?: boolean }) {
  return (
    <span className="relative isolate inline-block">
      {children}
      <svg aria-hidden="true" viewBox="0 0 200 14" preserveAspectRatio="none" className="absolute -bottom-[0.02em] -left-[0.04em] -z-10 h-[0.3em] w-[calc(100%+0.1em)]">
        <path d="M3 9 C 45 3, 95 11, 135 6 S 190 5, 197 8" pathLength={1} className={dibujar ? 'trazo-dibujar' : undefined} stroke="#f9dc07" strokeWidth="9" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  )
}

// La «foto» de un sabor: el dibujo de su envase (bolsa, garrafón, botella…), para que coincida con lo que dice su
// presentación, con la etiqueta crema y el logo de la marca como el frasco; sin envase o en frasco, el frasco.
export function ImagenSabor({ producto, className }: { producto: Pick<Producto, 'color_hex' | 'disponible' | 'envase' | 'sabor'>; className?: string }) {
  const logo = useLogoEtiqueta()
  if (!producto.envase || producto.envase === 'frasco') return <Frasco color={producto.color_hex} apagado={!producto.disponible} className={className} />
  return <DibujoEnvase tipo={producto.envase} color={producto.color_hex} apagado={!producto.disponible} logo={logo} etiqueta={producto.sabor.trim().charAt(0).toUpperCase()} className={className} />
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
        <ImagenSabor producto={producto} className={`${frasco} transition-transform duration-300 group-hover:scale-[1.03]`} />
      </div>
      <div className="mt-3 w-full min-w-0">
        <div className="truncate text-sm font-semibold">{producto.sabor}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-apagado">
          <span className="tabular-nums">{vendido ? litrosTxt(venta.litros, unidadDe(producto)) : 'Sin ventas'}</span>
          <Delta valor={cambio(venta.litros, venta.litrosAntes)} />
        </div>
        {conPrecio && <div className="mt-1 text-xs text-apagado tabular-nums">{dinero(producto.precio_litro)}/{unidadDe(producto)}{presentacionDe(producto) && ` · ${presentacionDe(producto)}`}</div>}
      </div>
    </button>
  )
}
