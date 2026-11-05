import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { aceptarLegal } from '../../lib/legal'
import { cerrarSesion, llamarAutenticado, useSesion } from '../../lib/sesion'
import { RUTA_LEGAL } from './PaginaLegal'

// Al entrar, si la cuenta no ha aceptado el aviso de privacidad y los términos vigentes (una cuenta que creó el
// administrador, o porque cambiaron), se piden antes de seguir. Sin conexión no se pregunta: el reparto no se detiene.
export function AceptarLegal() {
  const u = useSesion()?.usuario
  const [pendiente, setPendiente] = useState(false)
  const [marcado, setMarcado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!u || u.debeCambiarPassword) return
    let vigente = true
    llamarAutenticado<{ legalPendiente?: boolean }>('/me').then((r) => { if (vigente) setPendiente(!!r.legalPendiente) }).catch(() => {})
    return () => { vigente = false }
  }, [u?.id, u?.debeCambiarPassword]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!u || !pendiente) return null

  async function aceptar() {
    setEnviando(true)
    setError('')
    try {
      await aceptarLegal()
      setPendiente(false)
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'Sin conexión. Inténtalo de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  const enlace = 'font-semibold text-azul underline underline-offset-2'
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="titulo-legal" className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-papel p-6 text-tinta shadow-xl">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-niebla" aria-hidden="true"><ShieldCheck size={22} /></span>
        <h2 id="titulo-legal" className="mt-4 text-xl font-semibold">Tu privacidad</h2>
        <p className="mt-2 text-sm leading-relaxed">
          Antes de seguir, lee cómo cuidamos tus datos y las reglas del servicio. Puedes descargar tus datos o eliminar tu cuenta cuando
          quieras desde Privacidad y datos.
        </p>
        <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" checked={marcado} onChange={(e) => setMarcado(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            Leí y acepto el <a href={RUTA_LEGAL.privacidad} target="_blank" rel="noopener" className={enlace}>aviso de privacidad</a> y
            los <a href={RUTA_LEGAL.terminos} target="_blank" rel="noopener" className={enlace}>términos del servicio</a>.
          </span>
        </label>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-rojo">{error}</p>}
        <button type="button" onClick={() => void aceptar()} disabled={!marcado || enviando} className="mt-5 w-full rounded-md bg-tinta py-3 font-semibold text-white disabled:opacity-40">
          {enviando ? 'Guardando…' : 'Continuar'}
        </button>
        <button type="button" onClick={() => void cerrarSesion()} className="mt-2 w-full rounded-md py-2.5 text-sm font-semibold text-apagado hover:text-tinta">Ahora no, cerrar sesión</button>
      </div>
    </div>
  )
}
