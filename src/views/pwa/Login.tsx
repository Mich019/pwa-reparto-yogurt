import { useState } from 'react'
import { AlertCircle, Eye, EyeOff, KeyRound, Mail, ShieldAlert } from 'lucide-react'
import { cerrarSesion, iniciarSesion } from '../../lib/sesion'
import { ErrorApi, ErrorRed } from '../../lib/api'
import { Logo } from '../../components/Logo'
import { Campo, claseInput } from '../../components/ui'
import { FormPassword } from './Cuenta'

export function Login({ onIrAAdmin }: { onIrAAdmin?: () => void } = {}) {
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [error, setError] = useState('')
  const [esBloqueo, setEsBloqueo] = useState(false)
  const [cargando, setCargando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    const c = correo.trim()
    const p = password.trim()
    if (!c || !p) {
      setError('Credenciales inválidas')
      return
    }
    setCargando(true)
    setError('')
    setEsBloqueo(false)

    try {
      await iniciarSesion(c, p)
    } catch (e: unknown) {
      if (e instanceof ErrorApi) {
        if (e.status === 423 || e.codigo === 'BLOQUEADA') {
          setEsBloqueo(true)
          setError('Cuenta bloqueada temporalmente tras 5 intentos fallidos. Intenta más tarde.')
        } else if (e.status === 401 || e.status === 403) {
          setError('Credenciales inválidas')
        } else {
          setError('Algo salió mal...')
        }
      } else if (e instanceof ErrorRed) {
        setError('Algo salió mal...')
      } else {
        setError('Algo salió mal...')
      }
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="flex h-dvh flex-col justify-center bg-papel px-6 pt-safe pb-safe">
      <div className="mx-auto w-full max-w-sm">
        {/* Cabecera limpia */}
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-16 w-16 shadow-sm" textoClassName="text-3xl font-black" />
        </div>

        <form className="space-y-4" onSubmit={entrar}>
          <Campo etiqueta="Correo">
            <div className="relative">
              <input
                type="email"
                required
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="correo@ejemplo.com"
                className={`${claseInput} pl-11`}
              />
              <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-apagado" />
            </div>
          </Campo>

          <Campo etiqueta="Contraseña">
            <div className="relative">
              <input
                type={verPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`${claseInput} pl-11 pr-11`}
              />
              <KeyRound size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-apagado" />
              <button
                type="button"
                onClick={() => setVerPassword(!verPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-apagado transition-colors hover:text-tinta"
                aria-label="Ver u ocultar contraseña"
              >
                {verPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Campo>

          {error && (
            <div
              role="alert"
              className={`flex items-start gap-2.5 rounded-2xl p-3.5 text-sm font-medium ${
                esBloqueo ? 'bg-amber-500/10 text-amber-700 border border-amber-500/20' : 'bg-rojo/10 text-rojo'
              }`}
            >
              {esBloqueo ? <ShieldAlert size={18} className="shrink-0 mt-0.5" /> : <AlertCircle size={18} className="shrink-0 mt-0.5" />}
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={cargando}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-tinta py-4 text-base font-semibold text-white active:bg-neutral-800 disabled:opacity-40"
          >
            {cargando ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Entrando…
              </>
            ) : (
              'Iniciar sesión'
            )}
          </button>

          {onIrAAdmin && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={onIrAAdmin}
                className="text-xs font-semibold text-apagado hover:text-tinta"
              >
                Panel de Administración →
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

// Primera vez con una cuenta creada por el administrador: debe elegir su propia contraseña.
export function CambioObligatorio() {
  return (
    <div className="flex h-dvh flex-col justify-center bg-papel px-6 pt-safe pb-safe">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold tracking-tight">Elige tu contraseña</h1>
        <p className="mt-1 mb-6 text-apagado">Tu cuenta tiene una contraseña temporal. Cámbiala para continuar.</p>
        <FormPassword />
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void cerrarSesion()}
            className="text-xs font-semibold text-apagado hover:text-rojo transition-colors"
          >
            Cerrar sesión / Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
