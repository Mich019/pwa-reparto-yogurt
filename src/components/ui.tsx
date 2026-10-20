import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

// Hoja modal que sube desde abajo, cómoda para usar con una mano.
export function Hoja({ abierta, onCerrar, titulo, children, alto = false, pie }: {
  abierta: boolean
  onCerrar: () => void
  titulo?: ReactNode
  children: ReactNode
  alto?: boolean
  pie?: ReactNode // botón fijo abajo, fuera del área que se desplaza
}) {
  const [montada, setMontada] = useState(abierta)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (abierta) {
      setMontada(true)
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
      return () => cancelAnimationFrame(r)
    }
    setVisible(false)
    const t = setTimeout(() => setMontada(false), 250)
    return () => clearTimeout(t)
  }, [abierta])
  if (!montada) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-250 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onCerrar}
      />
      <div
        className={`relative mx-auto flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-[28px] bg-papel text-tinta shadow-hoja transition-transform duration-250 ease-out ${alto ? 'h-[92dvh]' : ''} ${visible ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="absolute left-1/2 top-2.5 h-1 w-10 -translate-x-1/2 rounded-full bg-linea" />
        <div className="flex items-center gap-3 px-5 pt-7 pb-3">
          <div className="min-w-0 flex-1 text-2xl leading-tight font-semibold tracking-tight">{titulo}</div>
          <button onClick={onCerrar} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-niebla text-tinta active:bg-linea" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto px-5 ${pie ? 'pb-3' : 'pb-safe'}`}>{children}</div>
        {pie && <div className="px-5 pt-3 pb-safe">{pie}</div>}
      </div>
    </div>
  )
}

export function Boton({ children, onClick, variante = 'primario', className = '', disabled }: {
  children: ReactNode
  onClick?: () => void
  variante?: 'primario' | 'secundario' | 'peligro' | 'fantasma'
  className?: string
  disabled?: boolean
}) {
  const estilos = {
    primario: 'bg-tinta text-white active:bg-neutral-700',
    secundario: 'bg-niebla text-tinta active:bg-linea',
    peligro: 'bg-rojo/10 text-rojo active:bg-rojo/20',
    fantasma: 'text-tinta active:bg-niebla',
  }[variante]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-semibold transition-colors disabled:opacity-40 ${estilos} ${className}`}
    >
      {children}
    </button>
  )
}

// Opciones en píldora, como "CAR / BIKE / SCOOT" de Uber: la activa va en negro.
export function Segmentado<T extends string>({ opciones, valor, onChange, className = '' }: {
  opciones: { valor: T; texto: ReactNode }[]
  valor: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={`flex gap-1 ${className}`}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          onClick={() => onChange(o.valor)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${valor === o.valor ? 'bg-tinta text-white' : 'bg-niebla text-tinta active:bg-linea'}`}
        >
          {o.texto}
        </button>
      ))}
    </div>
  )
}

// Botón circular con su etiqueta debajo (Navegar, Llamar…), como las acciones de Uber.
export function Accion({ icono, texto, href, onClick }: { icono: ReactNode; texto: string; href?: string; onClick?: () => void }) {
  const clase = 'group flex flex-col items-center gap-1.5 text-xs font-semibold'
  const circulo = <span className="grid h-14 w-14 place-items-center rounded-full bg-niebla group-active:bg-linea">{icono}</span>
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={clase}>{circulo}{texto}</a>
  ) : (
    <button onClick={onClick} className={clase}>{circulo}{texto}</button>
  )
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-apagado">{etiqueta}</span>
      {children}
    </label>
  )
}

export const claseInput =
  'w-full rounded-xl border-2 border-transparent bg-niebla px-4 py-3.5 text-base text-tinta outline-none placeholder:text-apagado focus:border-tinta'

let avisar: (t: string) => void = () => {}
export const aviso = (t: string) => avisar(t)

export function Avisos() {
  const [texto, setTexto] = useState<string | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    avisar = (s) => {
      setTexto(s)
      clearTimeout(t)
      t = setTimeout(() => setTexto(null), 2600)
    }
  }, [])
  if (!texto) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center pt-safe">
      <div className="mt-2 max-w-[92%] rounded-3xl bg-tinta px-5 py-3 text-center text-sm font-semibold text-white shadow-tarjeta">{texto}</div>
    </div>
  )
}

export function telLimpio(t: string) {
  const d = t.replace(/\D/g, '')
  return d.length === 10 ? `52${d}` : d
}
