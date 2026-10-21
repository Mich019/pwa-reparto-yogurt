import { useState } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Mail } from 'lucide-react'
import { ErrorApi, ErrorRed } from '../lib/api'
import { mensajeErrorLogin, restablecerPassword, solicitarRecuperacion } from '../lib/sesion'
import { Campo, claseInput } from './ui'

function mensajeError(e: unknown) {
  if (e instanceof ErrorRed) return 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.'
  if (e instanceof ErrorApi && e.status === 502) return e.message // no se pudo mandar el correo
  return mensajeErrorLogin(e)
}

// RF-002: pide un código de 6 dígitos al correo y con él se elige una contraseña nueva.
// Lo usan el inicio de sesión de la app (vendedores) y el del panel.
export function RecuperarPassword({ correoInicial, onVolver }: { correoInicial: string; onVolver: (correo: string) => void }) {
  const [paso, setPaso] = useState<'correo' | 'codigo' | 'listo'>('correo')
  const [correo, setCorreo] = useState(correoInicial)
  const [codigo, setCodigo] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [verNueva, setVerNueva] = useState(false)
  const [minutos, setMinutos] = useState(15)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const volver = () => onVolver(correo.trim())

  async function pedirCodigo(e: React.FormEvent) {
    e.preventDefault()
    if (!correo.trim()) return setError('Escribe tu correo')
    setCargando(true)
    setError('')
    try {
      const r = await solicitarRecuperacion(correo.trim())
      setMinutos(r.minutos ?? 15)
      setPaso('codigo')
    } catch (err: unknown) {
      setError(mensajeError(err))
    } finally {
      setCargando(false)
    }
  }

  async function restablecer(e: React.FormEvent) {
    e.preventDefault()
    const n = nueva.trim()
    if (codigo.trim().length !== 6) return setError('Escribe el código de 6 dígitos')
    if (n.length < 10 || !/[A-Za-z]/.test(n) || !/\d/.test(n)) return setError('La nueva contraseña debe tener al menos 10 caracteres, con letras y números')
    if (n !== confirmar.trim()) return setError('Las contraseñas no coinciden')
    setCargando(true)
    setError('')
    try {
      await restablecerPassword(correo.trim(), codigo.trim(), n)
      setPaso('listo')
    } catch (err: unknown) {
      setError(mensajeError(err))
    } finally {
      setCargando(false)
    }
  }

  const aviso = error && (
    <div role="alert" className="flex items-center gap-2.5 rounded-2xl bg-rojo/10 p-3.5 text-sm font-medium text-rojo">
      <AlertCircle size={18} className="shrink-0" />
      <span>{error}</span>
    </div>
  )

  if (paso === 'listo') {
    return (
      <div className="space-y-4 py-4 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-verde/10 text-verde">
          <CheckCircle2 size={36} />
        </div>
        <h3 className="text-xl font-bold tracking-tight text-tinta">¡Contraseña restablecida!</h3>
        <p className="text-sm leading-relaxed text-apagado">Ya puedes iniciar sesión con tu contraseña nueva. Se cerró la sesión en los demás teléfonos.</p>
        <button onClick={volver} className="w-full rounded-xl bg-tinta py-3.5 text-base font-semibold text-white active:bg-neutral-800">
          Iniciar sesión
        </button>
      </div>
    )
  }

  if (paso === 'codigo') {
    return (
      <form onSubmit={restablecer} className="space-y-5">
        <div className="rounded-2xl bg-niebla p-3.5 text-xs text-apagado">
          Si hay una cuenta con <strong className="text-tinta">{correo.trim()}</strong>, te mandamos ahí un código. Vence en {minutos} minutos.
        </div>
        <Campo etiqueta="Código de 6 dígitos">
          <input
            type="text"
            required
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className={`${claseInput} text-center text-2xl font-bold tracking-[0.5em]`}
          />
        </Campo>
        <Campo etiqueta="Nueva contraseña">
          <div className="relative">
            <input
              type={verNueva ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              placeholder="Mínimo 10 caracteres (letras y números)"
              className={`${claseInput} pr-11`}
            />
            <button
              type="button"
              onClick={() => setVerNueva(!verNueva)}
              className="absolute top-1/2 right-3.5 -translate-y-1/2 text-apagado transition-colors hover:text-tinta"
              aria-label="Ver u ocultar contraseña"
            >
              {verNueva ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </Campo>
        <Campo etiqueta="Confirmar nueva contraseña">
          <input
            type="password"
            required
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            placeholder="Repite tu nueva contraseña"
            className={claseInput}
          />
        </Campo>
        {aviso}
        <button
          type="submit"
          disabled={cargando}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-tinta py-4 text-base font-semibold text-white active:bg-neutral-800 disabled:opacity-40"
        >
          {cargando ? 'Actualizando contraseña…' : 'Restablecer contraseña'}
        </button>
        <div className="flex items-center justify-between text-sm font-semibold">
          <button type="button" onClick={() => { setError(''); setPaso('correo') }} className="py-1 text-apagado hover:text-tinta">
            Pedir otro código
          </button>
          <button type="button" onClick={volver} className="py-1 text-azul hover:underline">
            Cancelar
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={pedirCodigo} className="space-y-5">
      <Campo etiqueta="Correo">
        <div className="relative">
          <input
            type="email"
            required
            autoFocus
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="correo@ejemplo.com"
            className={`${claseInput} pl-11`}
          />
          <Mail size={18} className="absolute top-1/2 left-4 -translate-y-1/2 text-apagado" />
        </div>
      </Campo>
      <p className="text-xs leading-relaxed text-apagado">Te mandamos a ese correo un código de 6 dígitos para elegir una contraseña nueva.</p>
      {aviso}
      <button
        type="submit"
        disabled={cargando}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-tinta py-4 text-base font-semibold text-white active:bg-neutral-800 disabled:opacity-40"
      >
        {cargando ? 'Enviando código…' : 'Enviar código'}
      </button>
      <button type="button" onClick={volver} className="flex w-full items-center justify-center gap-1.5 py-2 text-sm font-semibold text-apagado hover:text-tinta">
        <ArrowLeft size={16} /> Volver a iniciar sesión
      </button>
    </form>
  )
}
