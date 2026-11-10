import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronRight, CircleHelp } from 'lucide-react'
import { Hoja } from '../../components/ui'
import { AYUDA_DE, type Donde } from './guias'
import { Visor, useGuiasVisibles, useValores } from './Ayuda'
import { useSesion } from '../../lib/sesion'

// El «?» de cada sección: abre, encima de lo que se está viendo, las guías de esa sección (AYUDA_DE en guias.ts). Con
// una sola guía va directo a ella. `HojaAyuda` se monta una vez por vista en App.tsx, como el visor de PDF.

type Seccion = keyof typeof AYUDA_DE
// Lo abierto: las guías de una sección («?») o una sola guía (bienvenida, enlace ?guia=).
let seccion: Seccion | `guia:${string}` | null = null
const oyentes = new Set<() => void>()
const fijar = (s: typeof seccion) => { seccion = s; oyentes.forEach((f) => f()) }
const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f) } }
export const abrirAyuda = (s: Seccion) => fijar(s)
export const abrirGuia = (id: string) => fijar(`guia:${id}`)

export function BotonAyuda({ seccion: s, className = '' }: { seccion: keyof typeof AYUDA_DE; className?: string }) {
  return (
    <button type="button" onClick={() => abrirAyuda(s)} aria-label="Ayuda de esta sección" title="Ayuda de esta sección"
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-apagado transition-colors hover:bg-niebla hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca ${className}`}>
      <CircleHelp size={20} aria-hidden="true" />
    </button>
  )
}

export function HojaAyuda({ donde }: { donde: Donde }) {
  const actual = useSyncExternalStore(suscribir, () => seccion)
  // Un enlace con ?guia=<id> (el que manda el administrador por WhatsApp) abre esa guía al entrar, ya con sesión.
  const conSesion = !!useSesion()
  useEffect(() => {
    if (!conSesion) return
    const url = new URL(location.href)
    const id = url.searchParams.get('guia')
    if (!id || !/^[a-z-]{2,40}$/.test(id)) return
    url.searchParams.delete('guia')
    history.replaceState(history.state, '', url)
    abrirGuia(id)
  }, [conSesion])
  const visibles = useGuiasVisibles(donde)
  const valores = useValores()
  const [abierta, setAbierta] = useState<string | null>(null)
  useEffect(() => setAbierta(null), [actual])
  useEffect(() => {
    if (!actual) return
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fijar(null) }
    addEventListener('keydown', tecla)
    return () => removeEventListener('keydown', tecla)
  }, [actual])
  const ids: string[] = !actual ? [] : actual.startsWith('guia:') ? [actual.slice(5)] : AYUDA_DE[actual as Seccion]
  const guias = ids.flatMap((id) => visibles.filter((g) => g.id === id))
  const guia = guias.length === 1 ? guias[0] : guias.find((g) => g.id === abierta)
  const cerrar = () => fijar(null)
  return (
    <Hoja abierta={!!actual && guias.length > 0} onCerrar={cerrar} alto titulo="Ayuda">
      <div className="pb-6">
        {guia ? (
          <Visor key={guia.id} guia={guia} valores={valores} donde={donde} compacto
            volver={guias.length > 1 ? 'Las guías de aquí' : 'Volver'} onVolver={guias.length > 1 ? () => setAbierta(null) : cerrar} />
        ) : (
          <ul className="border-b border-linea">
            {guias.map((g) => {
              const Icono = g.icono
              return (
                <li key={g.id}>
                  <button type="button" onClick={() => setAbierta(g.id)} className="flex w-full items-start gap-3 border-t border-linea py-4 text-left transition-colors hover:bg-niebla/60 focus-visible:outline-2 focus-visible:outline-marca">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-niebla"><Icono size={18} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{g.titulo}</span>
                      <span className="mt-0.5 block text-xs text-apagado">{g.resumen}</span>
                    </span>
                    <ChevronRight size={16} className="mt-2.5 shrink-0 text-apagado" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Hoja>
  )
}
