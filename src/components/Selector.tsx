import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { vidrio } from './ui'

// Lista desplegable propia, en lugar del <select> del navegador (que en cada sistema se ve distinto y no lleva los
// colores del tema). Se abre con un leve desliz (sólo opacity/transform: no recalcula el layout), hacia arriba si abajo
// no cabe y alineada a la derecha si se saldría de la pantalla. Teclado como un select: flechas, Inicio/Fin, Enter o
// espacio para elegir, Esc para cerrar y escribir para saltar a la opción que empieza así. Clic fuera la cierra.
// Sin animación si el sistema o «Menos movimiento» lo piden (src/index.css, views/admin/tema.css).

export interface OpcionSelector<T> { valor: T; texto: string; deshabilitada?: boolean }

const ALTO_OPCION = 38
const ALTO_MAXIMO = 264

export function Selector<T extends string | number>({ valor, opciones, onCambiar, etiqueta, className = '', deshabilitado = false }: {
  valor: T
  opciones: OpcionSelector<T>[]
  onCambiar: (v: T) => void
  etiqueta: string // para lectores de pantalla (lo que antes era aria-label del select)
  className?: string // el aspecto del campo cerrado: las mismas clases que llevaba el select
  deshabilitado?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(-1)
  const [lado, setLado] = useState({ arriba: false, derecha: false })
  const raiz = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const lista = useRef<HTMLUListElement>(null)
  const busqueda = useRef({ texto: '', en: 0 })
  const id = useId()
  const indice = opciones.findIndex((o) => o.valor === valor)

  const siguiente = (desde: number, paso: number) => {
    for (let i = desde + paso; i >= 0 && i < opciones.length; i += paso) if (!opciones[i].deshabilitada) return i
    return desde
  }
  function abrir() {
    if (deshabilitado || !boton.current) return
    const r = boton.current.getBoundingClientRect()
    const alto = Math.min(opciones.length * ALTO_OPCION + 10, ALTO_MAXIMO)
    const abajo = innerHeight - r.bottom
    setLado({ arriba: abajo < alto + 12 && r.top > abajo, derecha: r.left + Math.max(r.width, 240) > innerWidth - 8 })
    setActivo(indice >= 0 ? indice : siguiente(-1, 1))
    setAbierto(true)
  }
  function cerrar(enfocar = true) {
    setAbierto(false)
    if (enfocar) boton.current?.focus()
  }
  function elegir(i: number) {
    const o = opciones[i]
    if (!o || o.deshabilitada) return
    if (o.valor !== valor) onCambiar(o.valor)
    cerrar()
  }

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [abierto])
  // La opción activa siempre a la vista (al abrir, la elegida).
  useLayoutEffect(() => {
    if (abierto && activo >= 0) (lista.current?.children[activo] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [abierto, activo])

  function teclas(e: KeyboardEvent) {
    if (!abierto) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir() }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => siguiente(a, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => siguiente(a, -1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActivo(siguiente(-1, 1)) }
    else if (e.key === 'End') { e.preventDefault(); setActivo(siguiente(opciones.length, -1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); elegir(activo) }
    else if (e.key === 'Escape') { e.preventDefault(); cerrar() }
    else if (e.key === 'Tab') setAbierto(false)
    else if (e.key.length === 1) {
      const b = busqueda.current
      const ahora = Date.now()
      b.texto = (ahora - b.en > 700 ? '' : b.texto) + e.key.toLowerCase()
      b.en = ahora
      const i = opciones.findIndex((o) => !o.deshabilitada && o.texto.toLowerCase().startsWith(b.texto))
      if (i >= 0) setActivo(i)
    }
  }

  return (
    <div ref={raiz} className="relative">
      <button
        ref={boton} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={abierto} aria-controls={`${id}-lista`} aria-label={etiqueta}
        aria-activedescendant={abierto && activo >= 0 ? `${id}-${activo}` : undefined}
        disabled={deshabilitado} onClick={() => (abierto ? cerrar() : abrir())} onKeyDown={teclas}
        className={`${className} flex items-center justify-between gap-2 text-left transition-[transform,border-color] duration-150 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:active:scale-100`}
      >
        <span className="truncate">{opciones[indice]?.texto ?? ''}</span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-apagado transition-transform duration-200 ease-out ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <ul
          ref={lista} id={`${id}-lista`} role="listbox" aria-label={etiqueta} tabIndex={-1}
          className={`desplegar absolute z-50 max-h-64 w-max min-w-full max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-linea bg-papel p-1 shadow-tarjeta ${vidrio}
            ${lado.arriba ? 'desplegar-arriba bottom-full mb-1.5' : 'top-full mt-1.5'} ${lado.derecha ? 'right-0' : 'left-0'}`}
        >
          {opciones.map((o, i) => (
            <li
              key={String(o.valor)} id={`${id}-${i}`} role="option" aria-selected={o.valor === valor} aria-disabled={o.deshabilitada || undefined}
              onPointerEnter={() => { if (!o.deshabilitada) setActivo(i) }}
              onPointerDown={(e) => e.preventDefault()} // que el botón no pierda el foco
              onClick={() => elegir(i)}
              style={i < 10 ? { animationDelay: `${i * 14}ms` } : undefined}
              className={`desplegar-opcion flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-tinta transition-colors duration-100
                ${o.deshabilitada ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'} ${i === activo ? 'bg-niebla' : ''} ${o.valor === valor ? 'font-semibold' : ''}`}
            >
              <span>{o.texto}</span>
              {o.valor === valor && <Check size={15} aria-hidden="true" className="shrink-0 text-marca" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
