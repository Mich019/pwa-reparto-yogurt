import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BotonAyuda, abrirAyuda } from '../ayuda/AyudaRapida'
import type { AYUDA_DE } from '../ayuda/guias'
import { propsBuscador } from '../../lib/busqueda'
import { Recientes, useRecientes } from '../../components/Busqueda'
import { ArrowDownRight, ArrowUpRight, ChevronDown, Minus, MoreHorizontal, Search } from 'lucide-react'
import type { EstadoPedido, Producto } from '../../lib/db'
import { litrosTxt, type VentaSabor } from '../../lib/admin-datos'
import { cambio } from '../../lib/reportes'
import { dinero } from '../../lib/fechas'
import { presentacionDe, unidadDe } from '../../lib/unidades'
import { AveEmpresa, Frasco, useLogoEtiqueta } from './marca'
import { DibujoEnvase } from '../registro/dibujos'
import { Hoja, vidrio } from '../../components/ui'
import type { SeccionAdmin } from './menu'

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

// Encabezado de una sección del panel: título (mediano: el panel va compacto), una línea de detalle y, a la derecha, sus acciones. Las acciones
// siempre llevan texto (Nuevo cliente, Invitar…), nunca un «+» suelto. En el teléfono, si no caben junto al título,
// bajan a su propia fila y la llenan (los grupos con `grupoPanel` se reparten el ancho).
// `ayuda`: la sección cuyas guías abre el «?» junto al título (AYUDA_DE en views/ayuda/guias.ts).
export function Encabezado({ titulo, detalle, children, ayuda }: { titulo: string; detalle?: ReactNode; children?: ReactNode; ayuda?: keyof typeof AYUDA_DE }) {
  return (
    // Las acciones se centran con el título (no con el título y el detalle juntos); el detalle va debajo.
    <header className="pb-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-center gap-1 text-[1.75rem] font-semibold leading-tight lg:text-[2rem]">{titulo}{ayuda && <BotonAyuda seccion={ayuda} className="self-center" />}</h1>
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
// Elegir una opción entre varias (filtro, periodo, vista, apartado): una sola barra del alto de los demás botones (40 px),
// con la elegida rellena (`botonPanel`) y las otras (`botonPanelSuave`) fundidas en la barra. Es la misma pieza en
// todo el panel: Clientes, Equipo, Producción, Reportes, Finanzas, Buscar pedidos. En el teléfono la barra se reparte
// el ancho de su fila; desde 640 px, a su medida. Los botones que se prenden y apagan solos («Más de un mes») no van aquí.
export const grupoPanel = 'flex grow gap-1 rounded-lg bg-niebla p-1 sm:grow-0 [&>*]:h-8 [&>*]:grow sm:[&>*]:grow-0 [&>*:not([aria-pressed=true])]:bg-transparent [&>*:not([aria-pressed=true])]:hover:bg-linea/70'
// Línea vertical entre grupos de acciones; en el teléfono, donde las acciones se acomodan en filas, no va.
export function Separador() {
  return <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-linea sm:block" />
}
// Sólo un ícono (flechas de periodo): cuadrado de 40 px, sin el relleno lateral de los botones con texto.
export const botonPanelIcono = `grid h-10 w-10 shrink-0 place-items-center rounded-md bg-niebla text-tinta transition-colors hover:bg-linea disabled:opacity-40 ${anilloFoco}`

// Buscador del encabezado: sólo la lupa, del alto de los botones; al tocarla se despliega el campo (anima el ancho de
// un solo input). Desde 1280 px crece hacia la izquierda por encima del hueco junto al título, sin empujar los
// botones (por eso las acciones de más van en «Más», MenuMas: que quede hueco); en pantalla chica ocupa su lugar
// (en el teléfono, abierto, toma una fila entera). Se queda abierto mientras haya texto; Escape lo borra y lo cierra. Con `clave`, abierto y vacío, ofrece las últimas búsquedas de este dispositivo.
export function BuscadorDesplegable({ valor, onChange, placeholder, clave }: { valor: string; onChange: (v: string) => void; placeholder: string; clave?: string }) {
  const [abierto, setAbierto] = useState(false)
  const [foco, setFoco] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  const recientes = useRecientes(clave ?? '')
  const visible = abierto || valor !== ''
  // «/» abre el buscador de la sección (como en GitHub o Gmail), salvo cuando ya se escribe en un campo o hay una hoja abierta.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== '/' || !teclaLibre(e)) return
      e.preventDefault()
      setAbierto(true)
      campo.current?.focus()
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [])
  return (
    <div className={`relative h-10 xl:w-10 ${visible ? 'max-sm:basis-full' : ''}`}>
      <div className={`z-10 flex h-10 max-sm:w-full flex-row-reverse xl:absolute xl:right-0 xl:top-0 items-center rounded-md bg-niebla transition-colors ${visible ? '' : 'hover:bg-linea'}`}>
        <button type="button" aria-label="Buscar" title="Buscar (tecla /)" aria-expanded={visible} onClick={() => { setAbierto(true); campo.current?.focus() }}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${anilloFoco}`}>
          <Search size={18} aria-hidden="true" />
        </button>
        <input
          {...propsBuscador}
          ref={campo}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFoco(true)}
          onBlur={() => { setFoco(false); if (clave) recientes.recordar(valor); if (!valor) setAbierto(false) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && clave) recientes.recordar(valor)
            if (e.key === 'Escape') { onChange(''); setAbierto(false); e.currentTarget.blur() }
          }}
          tabIndex={visible ? 0 : -1}
          aria-label={placeholder}
          aria-keyshortcuts="/"
          placeholder={placeholder}
          className={`h-full min-w-0 bg-transparent text-sm outline-none transition-[width,padding] duration-200 ease-out placeholder:text-apagado motion-reduce:transition-none ${visible ? 'w-40 pl-4 max-sm:grow xl:w-52 2xl:w-64' : 'w-0 p-0'}`}
        />
      </div>
      {clave && foco && !valor && recientes.lista.length > 0 && (
        <div className="desplegar absolute left-0 top-full z-20 mt-1 w-64 max-w-[85vw] xl:left-auto xl:right-0 rounded-md bg-papel p-2 shadow-lg ring-1 ring-linea">
          <Recientes lista={recientes.lista} onElegir={(t) => onChange(t)} onOlvidar={recientes.olvidar} />
        </div>
      )}
    </div>
  )
}

// «?» muestra los atajos de teclado del panel y «g» seguida de una letra (antes de 1,5 s) salta a una sección, como en
// GitHub o Gmail (montado una vez en AdminLayout). Mismas reglas que «/»: no mientras se escribe en un campo ni con
// una hoja abierta.
const IR_A: [string, SeccionAdmin, string][] = [
  ['i', 'resumen', 'Resumen'], ['v', 'equipo', 'Vendedores'], ['c', 'clientes', 'Clientes'], ['p', 'produccion', 'Producción'],
  ['s', 'sabores', 'Sabores'], ['f', 'cobranza', 'Finanzas'], ['r', 'reportes', 'Reportes'], ['o', 'configuracion', 'Configuración'],
]
// «g c»: el atajo de una sección, para el title del menú.
export const atajoDe = (s: SeccionAdmin) => { const a = IR_A.find(([, id]) => id === s); return a ? `g ${a[0]}` : undefined }
const ATAJOS: [string, string][] = [
  ['/', 'Buscar en la sección (Clientes, Vendedores, Finanzas)'],
  ['Esc', 'Borrar la búsqueda y cerrar el buscador, o cerrar un menú'],
  ['↑ ↓', 'Moverse entre las opciones de un menú'],
  ['?', 'Ver estos atajos'],
  ['h', 'Ayuda de la sección en la que estás'],
  ...IR_A.map(([k, , texto]): [string, string] => [`g ${k}`, `Ir a ${texto}`]),
]
export function teclaLibre(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return false
  const el = e.target as HTMLElement | null
  if (el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role=dialog]')) return false
  return !document.querySelector('[role=dialog][aria-modal=true]')
}
export function AtajosTeclado({ onIr, seccion }: { onIr: (s: SeccionAdmin) => void; seccion?: SeccionAdmin }) {
  const [abierta, setAbierta] = useState(false)
  const ir = useRef(onIr)
  ir.current = onIr
  const actual = useRef(seccion)
  actual.current = seccion
  useEffect(() => {
    let g = 0 // cuándo se tocó la «g»; 0 = no está esperando la segunda letra
    const tecla = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key !== '?') { g = 0; return }
      if (!teclaLibre(e)) return
      if (e.key === '?') { e.preventDefault(); g = 0; setAbierta(true); return }
      if (g && Date.now() - g < 1500) {
        const destino = IR_A.find(([k]) => k === e.key.toLowerCase())
        g = 0
        if (destino) { e.preventDefault(); ir.current(destino[1]) }
        return
      }
      if (e.key === 'h') {
        const s = actual.current
        if (s && s !== 'configuracion') { e.preventDefault(); abrirAyuda(s) }
      }
      g = e.key === 'g' ? Date.now() : 0
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [])
  if (!abierta) return null
  return (
    <Hoja abierta onCerrar={() => setAbierta(false)} titulo="Atajos de teclado">
      <dl className="divide-y divide-linea border-y border-linea mb-4">
        {ATAJOS.map(([k, texto]) => (
          <div key={k} className="flex items-center gap-4 py-3">
            <dt className="w-16 shrink-0"><kbd className="rounded-md bg-niebla px-2 py-1 font-sans text-sm font-semibold">{k}</kbd></dt>
            <dd className="text-sm">{texto}</dd>
          </div>
        ))}
      </dl>
    </Hoja>
  )
}

// «Más»: las acciones secundarias de un encabezado en un menú, para que la fila no se llene de botones.
// Se cierra con Escape, al elegir o al tocar fuera; flechas arriba/abajo recorren las opciones.
export function MenuMas({ opciones }: { opciones: { texto: string; icono: ReactNode; onElegir: () => void }[] }) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('pointerdown', fuera)
    caja.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    return () => document.removeEventListener('pointerdown', fuera)
  }, [abierto])
  const teclas = (e: React.KeyboardEvent) => {
    const items = [...(caja.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { setAbierto(false); caja.current?.querySelector<HTMLElement>('button')?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
  }
  return (
    <div ref={caja} className="relative max-sm:grow" onKeyDown={teclas}>
      <button type="button" aria-haspopup="menu" aria-expanded={abierto} onClick={() => setAbierto(!abierto)} className={`${botonPanelSuave} w-full`}>
        <MoreHorizontal size={18} aria-hidden="true" /> Más <ChevronDown size={16} aria-hidden="true" className={`transition-transform motion-reduce:transition-none ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <div role="menu" className={`desplegar absolute right-0 top-full z-20 mt-1 min-w-[13rem] rounded-md bg-papel py-1 shadow-lg ring-1 ring-linea ${vidrio}`}>
          {opciones.map((o) => (
            <button key={o.texto} type="button" role="menuitem" onClick={() => { setAbierto(false); o.onElegir() }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold hover:bg-niebla focus-visible:bg-niebla focus-visible:outline-none">
              {o.icono} {o.texto}
            </button>
          ))}
        </div>
      )}
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
