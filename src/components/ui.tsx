import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

// Hoja modal que sube desde abajo, cómoda para usar con una mano.
export function Hoja({ abierta, onCerrar, titulo, children, alto = false }: {
  abierta: boolean
  onCerrar: () => void
  titulo?: ReactNode
  children: ReactNode
  alto?: boolean
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
        className={`absolute inset-0 bg-black/60 transition-opacity duration-250 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onCerrar}
      />
      <div
        className={`relative flex max-h-[92dvh] flex-col rounded-t-3xl bg-slate-900 text-slate-100 shadow-2xl transition-transform duration-250 ease-out ${alto ? 'h-[92dvh]' : ''} ${visible ? 'translate-y-0' : 'translate-y-full'}`}
      >
        <div className="flex items-center gap-3 px-5 pt-3 pb-2">
          <div className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-slate-700" />
          <div className="mt-3 flex-1 text-lg font-bold">{titulo}</div>
          <button onClick={onCerrar} className="mt-3 rounded-full bg-slate-800 p-2 text-slate-300 active:bg-slate-700" aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-safe">{children}</div>
      </div>
    </div>
  )
}

export function Boton({ children, onClick, variante = 'primario', className = '', disabled }: {
  children: ReactNode
  onClick?: () => void
  variante?: 'primario' | 'secundario' | 'peligro' | 'fantasma' | 'rosa'
  className?: string
  disabled?: boolean
}) {
  const estilos = {
    primario: 'bg-emerald-500 text-slate-950 active:bg-emerald-400',
    rosa: 'bg-pink-500 text-white active:bg-pink-400',
    secundario: 'bg-slate-800 text-slate-100 active:bg-slate-700',
    peligro: 'bg-red-500/15 text-red-300 active:bg-red-500/25',
    fantasma: 'text-slate-300 active:bg-slate-800',
  }[variante]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-base font-semibold transition-colors disabled:opacity-40 ${estilos} ${className}`}
    >
      {children}
    </button>
  )
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-400">{etiqueta}</span>
      {children}
    </label>
  )
}

export const claseInput =
  'w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-base text-slate-100 outline-none placeholder:text-slate-500 focus:border-pink-500'

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
      <div className="mt-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-xl">{texto}</div>
    </div>
  )
}

export function telLimpio(t: string) {
  const d = t.replace(/\D/g, '')
  return d.length === 10 ? `52${d}` : d
}
