import { useState } from 'react'
import { AlertCircle, ArrowLeft, ShieldCheck } from 'lucide-react'
import { ErrorApi } from '../lib/api'
import { cancelarCodigo, confirmarCodigo, mensajeErrorLogin } from '../lib/sesion'
import { Campo, claseInput } from './ui'

// Segundo paso del inicio de sesión: el código de 6 dígitos de la app de autenticación o un código de respaldo.
export function PasoCodigo({ onListo, onVolver }: { onListo?: () => void; onVolver: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [respaldo, setRespaldo] = useState(false)
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!codigo.trim()) return setError(respaldo ? 'Escribe uno de tus códigos de respaldo' : 'Escribe el código de 6 dígitos')
    setEnviando(true)
    setError('')
    try {
      await confirmarCodigo(codigo)
      onListo?.()
    } catch (err) {
      if (err instanceof ErrorApi && err.codigo === 'DESAFIO_VENCIDO') return onVolver()
      setError(mensajeErrorLogin(err))
      setCodigo('')
    } finally {
      setEnviando(false)
    }
  }

  function volver() {
    cancelarCodigo()
    onVolver()
  }

  return (
    <form className="space-y-4" onSubmit={enviar}>
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-niebla"><ShieldCheck size={22} /></span>
        <div>
          <div className="text-lg font-semibold">Verificación en dos pasos</div>
          <p className="text-sm text-apagado">
            {respaldo ? 'Escribe uno de los códigos de respaldo que guardaste. Cada uno sirve una sola vez.' : 'Abre tu app de autenticación y escribe el código de 6 dígitos de Delisy.'}
          </p>
        </div>
      </div>

      <Campo etiqueta={respaldo ? 'Código de respaldo' : 'Código'}>
        <input
          key={respaldo ? 'r' : 'c'}
          autoFocus
          value={codigo}
          onChange={(e) => setCodigo(respaldo ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode={respaldo ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={respaldo ? 'abcde-fghij' : '123456'}
          className={`${claseInput} text-center font-mono text-2xl tracking-[0.3em]`}
        />
      </Campo>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl bg-rojo/10 p-3.5 text-sm font-medium text-rojo">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button type="submit" disabled={enviando} className="flex w-full items-center justify-center gap-2 rounded-xl bg-tinta py-4 text-base font-semibold text-white active:bg-neutral-800 disabled:opacity-40">
        {enviando ? 'Verificando…' : 'Verificar y entrar'}
      </button>

      <div className="flex items-center justify-between text-sm font-semibold">
        <button type="button" onClick={volver} className="flex items-center gap-1 py-1 text-apagado hover:text-tinta"><ArrowLeft size={16} /> Volver</button>
        <button type="button" onClick={() => { setRespaldo(!respaldo); setCodigo(''); setError('') }} className="py-1 text-azul hover:underline">
          {respaldo ? 'Usar la app de autenticación' : 'Usar un código de respaldo'}
        </button>
      </div>
    </form>
  )
}
