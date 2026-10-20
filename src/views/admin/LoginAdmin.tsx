import { useState } from 'react'
import { AlertCircle, ArrowLeft, Eye, EyeOff, KeyRound, Mail, ShieldAlert } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { cerrarSesion, iniciarSesion, mensajeErrorLogin, sesionActual } from '../../lib/sesion'
import { Logo } from '../../components/Logo'
import { RecuperarPassword } from '../../components/RecuperarPassword'
import { Campo, claseInput } from '../../components/ui'

type Modo = 'login' | 'recuperar'

export function LoginAdmin({ onLoginExitoso, onIrAPwa }: {
  onLoginExitoso?: () => void
  onIrAPwa?: () => void
}) {
  const [modo, setModo] = useState<Modo>('login')

  // Campos de formulario
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)

  // Estados de carga y error
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [esBloqueo, setEsBloqueo] = useState(false)

  // Login para rol Administrador (solo 2 roles: administrador y vendedor)
  async function manejarLogin(e: React.FormEvent) {
    e.preventDefault()
    const c = correo.trim()
    const p = password.trim()
    if (!c || !p) {
      setError('Escribe tu correo y tu contraseña')
      return
    }
    setCargando(true)
    setError('')
    setEsBloqueo(false)

    try {
      await iniciarSesion(c, p)
      const sesion = sesionActual()

      // Restricción de rol: Solo Administrador puede ingresar al panel de admin
      if (sesion && sesion.usuario.rol !== 'administrador') {
        await cerrarSesion()
        setError('Acceso no autorizado: esta cuenta es de vendedor')
        return
      }

      onLoginExitoso?.()
    } catch (err: unknown) {
      setEsBloqueo(err instanceof ErrorApi && err.codigo === 'BLOQUEADA')
      setError(mensajeErrorLogin(err))
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-niebla/50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        
        {/* Cabecera limpia sin textos adicionales */}
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-16 w-16 shadow-sm" textoClassName="text-3xl font-black" />
        </div>

        {/* Tarjeta principal */}
        <div className="rounded-3xl border border-linea bg-papel p-6 shadow-tarjeta sm:p-8">
          
          {/* MODO 1: LOGIN */}
          {modo === 'login' && (
            <form onSubmit={manejarLogin} className="space-y-5">
              <Campo etiqueta="Correo">
                <div className="relative">
                  <input
                    type="email"
                    required
                    autoComplete="email"
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

              <div className="flex items-center justify-end text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => { setError(''); setModo('recuperar') }}
                  className="text-azul hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>

              {/* Mensaje de error / bloqueo */}
              {error && (
                <div
                  role="alert"
                  className={`flex items-start gap-3 rounded-2xl p-4 text-sm font-medium ${
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
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-tinta py-4 text-base font-semibold text-white transition-all active:scale-[0.99] active:bg-neutral-800 disabled:opacity-40"
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
            </form>
          )}

          {/* MODO 2: RECUPERAR CONTRASEÑA (RF-002) */}
          {modo === 'recuperar' && (
            <RecuperarPassword correoInicial={correo} onVolver={(c) => { setCorreo(c); setError(''); setModo('login') }} />
          )}

        </div>

        {/* Enlace sutil para ir a la PWA */}
        {onIrAPwa && (
          <div className="mt-8 text-center">
            <button
              onClick={onIrAPwa}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-apagado transition-colors hover:text-tinta"
            >
              <ArrowLeft size={14} />
              Ir a la App Móvil de Reparto
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
