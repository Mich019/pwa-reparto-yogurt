import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { desdeIso, hoy, iso, sumarDias } from '../lib/fechas'

// Calendario propio en lugar del <input type="date"> del navegador (que en cada sistema se ve distinto y no sigue el
// tema). Dos formas: SelectorFecha (un día) y SelectorRango (desde–hasta, con atajos). El botón que lo abre lo pone
// quien lo usa (`className` y `children`); la ventanita flota con position: fixed junto a él, así ninguna hoja con
// overflow la recorta, y se cierra con Escape, al tocar fuera o al desplazar la página. Fechas en YYYY-MM-DD.

export interface Rango { desde: string; hasta: string }

const SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const nombreMes = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })

// Los días de la cuadrícula de un mes, empezando en lunes; null = hueco antes del día 1.
function diasDelMes(y: number, m: number): (string | null)[] {
  const primero = (new Date(y, m, 1).getDay() + 6) % 7
  const total = new Date(y, m + 1, 0).getDate()
  return [...Array(primero).fill(null), ...Array.from({ length: total }, (_, i) => iso(new Date(y, m, i + 1)))]
}

// Texto corto de un rango: «4 oct – 2 nov 2026» (el año sólo una vez si es el mismo).
export function textoRangoCorto({ desde, hasta }: Rango) {
  const a = desdeIso(desde)
  const b = desdeIso(hasta)
  const corto = (d: Date, conAnio: boolean) => d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}) }).replace('.', '')
  return `${corto(a, a.getFullYear() !== b.getFullYear())} – ${corto(b, true)}`
}

function Flotante({ ancla, onCerrar, children }: { ancla: HTMLElement | null; onCerrar: () => void; children: ReactNode }) {
  const caja = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!ancla || !caja.current) return
    const r = ancla.getBoundingClientRect()
    const w = caja.current.offsetWidth
    const h = caja.current.offsetHeight
    const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) // alineado a la derecha del botón, sin salirse
    const top = r.bottom + 6 + h > innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : r.bottom + 6
    setPos({ top, left })
  }, [ancla])

  useEffect(() => {
    const fuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node) && !ancla?.contains(e.target as Node)) onCerrar()
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') { onCerrar(); ancla?.focus() } }
    const mover = (e: Event) => { if (!caja.current?.contains(e.target as Node)) onCerrar() }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', tecla)
    addEventListener('scroll', mover, true)
    addEventListener('resize', onCerrar)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', tecla)
      removeEventListener('scroll', mover, true)
      removeEventListener('resize', onCerrar)
    }
  }, [ancla, onCerrar])

  return createPortal(
    <div
      ref={caja}
      role="dialog"
      style={pos ?? { top: 0, left: 0, visibility: 'hidden' }}
      className="calendario-entrar fixed z-[60] rounded-lg border border-linea bg-papel p-3 text-tinta shadow-[0_12px_36px_rgba(0,0,0,0.16)]"
    >
      {children}
    </div>,
    // Dentro del tema del panel o de la app para heredar sus colores (y el modo oscuro).
    ancla?.closest('.tema-admin') ?? document.body,
  )
}

function Mes({ mes, setMes, min, max, clase, onElegir, onEncima }: {
  mes: { y: number; m: number }
  setMes: (m: { y: number; m: number }) => void
  min?: string
  max?: string
  clase: (d: string) => string
  onElegir: (d: string) => void
  onEncima?: (d: string | null) => void
}) {
  const ir = (n: number) => { const d = new Date(mes.y, mes.m + n, 1); setMes({ y: d.getFullYear(), m: d.getMonth() }) }
  const primero = iso(new Date(mes.y, mes.m, 1))
  const ultimo = iso(new Date(mes.y, mes.m + 1, 0))
  return (
    <div className="w-[17.5rem]">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => ir(-1)} disabled={!!min && primero <= min} aria-label="Mes anterior" className="grid h-9 w-9 place-items-center rounded-md hover:bg-niebla disabled:opacity-30"><ChevronLeft size={20} /></button>
        <span className="text-sm font-semibold first-letter:uppercase">{nombreMes(mes.y, mes.m)}</span>
        <button type="button" onClick={() => ir(1)} disabled={!!max && ultimo >= max} aria-label="Mes siguiente" className="grid h-9 w-9 place-items-center rounded-md hover:bg-niebla disabled:opacity-30"><ChevronRight size={20} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-apagado">
        {SEMANA.map((d, i) => <span key={i} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5" onPointerLeave={() => onEncima?.(null)}>
        {diasDelMes(mes.y, mes.m).map((d, i) => d === null ? <span key={i} /> : (
          <button
            key={d}
            type="button"
            disabled={(!!min && d < min) || (!!max && d > max)}
            onClick={() => onElegir(d)}
            onPointerEnter={() => onEncima?.(d)}
            aria-label={desdeIso(d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            className={`h-9 text-sm tabular-nums transition-colors disabled:cursor-default disabled:opacity-25 ${clase(d)}`}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  )
}

const mesDe = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1 })
const marcaHoy = (d: string) => (d === hoy() ? 'font-bold underline decoration-2 underline-offset-4' : '')

export function SelectorFecha({ valor, onCambiar, min, max, className, children, etiqueta }: {
  valor: string
  onCambiar: (d: string) => void
  min?: string
  max?: string
  className?: string
  children: ReactNode
  etiqueta?: string
}) {
  const boton = useRef<HTMLButtonElement>(null)
  const [abierto, setAbierto] = useState(false)
  const [mes, setMes] = useState(() => mesDe(valor))
  const cerrar = () => setAbierto(false)
  const elegir = (d: string) => { onCambiar(d); cerrar(); boton.current?.focus() }
  const hoyValido = (!min || hoy() >= min) && (!max || hoy() <= max)
  return (
    <>
      <button ref={boton} type="button" aria-haspopup="dialog" aria-expanded={abierto} aria-label={etiqueta}
        onClick={() => { setMes(mesDe(valor)); setAbierto((a) => !a) }} className={className}>
        {children}
      </button>
      {abierto && (
        <Flotante ancla={boton.current} onCerrar={cerrar}>
          <Mes mes={mes} setMes={setMes} min={min} max={max} onElegir={elegir}
            clase={(d) => `rounded-md ${d === valor ? 'bg-tinta font-semibold text-white' : `hover:bg-niebla ${marcaHoy(d)}`}`} />
          {hoyValido && (
            <div className="mt-2 flex justify-end border-t border-linea pt-2">
              <button type="button" onClick={() => elegir(hoy())} className="rounded-md px-3 py-1.5 text-sm font-semibold hover:bg-niebla">Hoy</button>
            </div>
          )}
        </Flotante>
      )}
    </>
  )
}

const ATAJOS: { texto: string; rango: (h: string) => Rango }[] = [
  { texto: 'Últimos 7 días', rango: (h) => ({ desde: sumarDias(h, -6), hasta: h }) },
  { texto: 'Últimos 30 días', rango: (h) => ({ desde: sumarDias(h, -29), hasta: h }) },
  { texto: 'Este mes', rango: (h) => ({ desde: `${h.slice(0, 7)}-01`, hasta: h }) },
  { texto: 'Mes pasado', rango: (h) => { const d = desdeIso(`${h.slice(0, 7)}-01`); return { desde: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), hasta: sumarDias(iso(d), -1) } } },
  { texto: 'Últimos 90 días', rango: (h) => ({ desde: sumarDias(h, -89), hasta: h }) },
  { texto: 'Este año', rango: (h) => ({ desde: `${h.slice(0, 4)}-01-01`, hasta: h }) },
]

// Rango: el primer toque marca el inicio, el segundo el final (en cualquier orden); mientras tanto se ve el rango
// bajo el cursor. Los atajos lo aplican de una vez.
export function SelectorRango({ valor, onCambiar, max, className, children, etiqueta }: {
  valor: Rango
  onCambiar: (r: Rango) => void
  max?: string
  className?: string
  children: ReactNode
  etiqueta?: string
}) {
  const boton = useRef<HTMLButtonElement>(null)
  const [abierto, setAbierto] = useState(false)
  const [mes, setMes] = useState(() => mesDe(valor.hasta))
  const [inicio, setInicio] = useState<string | null>(null)
  const [encima, setEncima] = useState<string | null>(null)
  const cerrar = () => { setAbierto(false); setInicio(null) }
  const aplicar = (r: Rango) => { onCambiar(r); cerrar(); boton.current?.focus() }

  const vista: Rango = inicio
    ? (encima && encima < inicio ? { desde: encima, hasta: inicio } : { desde: inicio, hasta: encima ?? inicio })
    : valor
  const clase = (d: string) => {
    const extremo = d === vista.desde || d === vista.hasta
    const dentro = d > vista.desde && d < vista.hasta
    const forma = d === vista.desde && d === vista.hasta ? 'rounded-md' : d === vista.desde ? 'rounded-l-md' : d === vista.hasta ? 'rounded-r-md' : ''
    if (extremo) return `${forma} bg-tinta font-semibold text-white`
    if (dentro) return 'bg-niebla'
    return `rounded-md hover:bg-niebla ${marcaHoy(d)}`
  }
  const h = max ?? hoy()

  return (
    <>
      <button ref={boton} type="button" aria-haspopup="dialog" aria-expanded={abierto} aria-label={etiqueta}
        onClick={() => { setMes(mesDe(valor.hasta)); setInicio(null); setAbierto((a) => !a) }} className={className}>
        {children}
      </button>
      {abierto && (
        <Flotante ancla={boton.current} onCerrar={cerrar}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex flex-wrap gap-1 sm:w-36 sm:flex-col sm:border-r sm:border-linea sm:pr-3">
              {ATAJOS.map((a) => {
                const r = a.rango(h)
                const activo = !inicio && r.desde === valor.desde && r.hasta === valor.hasta
                return (
                  <button key={a.texto} type="button" onClick={() => aplicar(r)}
                    className={`rounded-md px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors ${activo ? 'bg-tinta text-white' : 'hover:bg-niebla'}`}>
                    {a.texto}
                  </button>
                )
              })}
            </div>
            <div>
              <Mes mes={mes} setMes={setMes} max={max} clase={clase} onEncima={inicio ? setEncima : undefined}
                onElegir={(d) => {
                  if (!inicio) { setInicio(d); setEncima(d); return }
                  aplicar(d < inicio ? { desde: d, hasta: inicio } : { desde: inicio, hasta: d })
                }} />
              <p className="mt-2 border-t border-linea pt-2 text-xs text-apagado">
                {inicio ? 'Ahora elige el último día.' : `${textoRangoCorto(valor)} · elige el primer día para cambiarlo.`}
              </p>
            </div>
          </div>
        </Flotante>
      )}
    </>
  )
}
