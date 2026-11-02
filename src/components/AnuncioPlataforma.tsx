import { useEffect, useState } from 'react'
import { Info, TriangleAlert, X } from 'lucide-react'
import { MODO_SERVIDOR } from '../lib/api'
import { llamarAutenticado, useSesion } from '../lib/sesion'

// Los avisos de la plataforma (apartado «Avisos» en /plataforma), arriba del panel y de la app de reparto: los vigentes
// que van al rol de quien entra y el automático de la prueba por vencer. Sólo dentro de una sesión: el servidor no los
// entrega sin ella (GET /plataforma/avisos/vigentes). Se piden al entrar cada cuenta y cada 15 minutos, para que uno
// programado salga a su hora; sin conexión no se muestran. Cerrar uno lo oculta en este navegador hasta que cambie
// (su «clave» cambia con él, o con cada día menos de prueba).

type Aviso = { clave: string; texto: string; tipo: 'info' | 'aviso'; accion?: 'suscripcion' }
const CLAVE = 'avisos-cerrados'
const leerCerrados = (): string[] => {
  try { return JSON.parse(localStorage.getItem(CLAVE) ?? '[]') } catch { return [] }
}

export function AnuncioPlataforma({ className = '', onVerSuscripcion }: { className?: string; onVerSuscripcion?: () => void }) {
  const idUsuario = useSesion()?.usuario.id
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [cerrados, setCerrados] = useState(leerCerrados)
  useEffect(() => {
    setAvisos([])
    if (!idUsuario || !MODO_SERVIDOR) return
    let vigente = true
    const pedir = () => llamarAutenticado<{ avisos: Aviso[] }>('/plataforma/avisos/vigentes')
      .then((r) => { if (vigente) setAvisos(r.avisos) })
      .catch(() => {})
    void pedir()
    const cada = setInterval(pedir, 15 * 60_000)
    return () => { vigente = false; clearInterval(cada) }
  }, [idUsuario])

  const visibles = avisos.filter((a) => !cerrados.includes(a.clave))
  if (!visibles.length) return null
  function cerrar(clave: string) {
    // Sólo se guardan las claves de los avisos que siguen vigentes, más la que se cierra: la lista no crece sin fin.
    const siguen = [...cerrados.filter((c) => avisos.some((a) => a.clave === c)), clave]
    try { localStorage.setItem(CLAVE, JSON.stringify(siguen)) } catch { /* sin almacenamiento: vuelve a salir al recargar */ }
    setCerrados(siguen)
  }
  return (
    <div className={`shrink-0 ${className}`}>
      {visibles.map((a) => {
        const aviso = a.tipo === 'aviso'
        const Icono = aviso ? TriangleAlert : Info
        return (
          <div key={a.clave} role={aviso ? 'alert' : 'status'} className={`flex items-start gap-3 px-4 py-2.5 text-sm sm:px-8 ${aviso ? 'bg-ambar/15' : 'bg-azul/10'}`}>
            <Icono size={17} aria-hidden="true" className={`mt-0.5 shrink-0 ${aviso ? 'text-ambar' : 'text-azul'}`} />
            <p className="min-w-0 flex-1 leading-snug">
              {a.texto}
              {a.accion === 'suscripcion' && onVerSuscripcion && (
                <button type="button" onClick={onVerSuscripcion} className="ml-2 font-semibold underline underline-offset-2 hover:text-marca-oscuro">Ver suscripción</button>
              )}
            </p>
            <button type="button" onClick={() => cerrar(a.clave)} aria-label="Cerrar aviso" className="-my-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-apagado hover:bg-niebla hover:text-tinta">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
