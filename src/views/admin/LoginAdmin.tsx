import { useState } from 'react'
import { AlertCircle, ArrowLeft, Eye, EyeOff, KeyRound, Mail, ShieldAlert } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { cerrarSesion, iniciarSesion, mensajeErrorLogin, sesionActual } from '../../lib/sesion'
import { RecuperarPassword } from '../../components/RecuperarPassword'
import { PasoCodigo } from '../../components/PasoCodigo'
import { Campo, claseInput } from '../../components/ui'
import { AveEmpresa, LogoEmpresa } from './marca'

type Modo = 'login' | 'recuperar' | 'codigo'

export function LoginAdmin({ onLoginExitoso, onIrAPwa, onIrARegistro }: {
  onLoginExitoso?: () => void
  onIrAPwa?: () => void
  onIrARegistro?: () => void
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
      // El panel guarda la sesión en cookies HttpOnly (fuera del alcance de cualquier script de la página).
      if ((await iniciarSesion(c, p, { cookie: true })) === 'codigo') return setModo('codigo')
      await despuesDeEntrar()
    } catch (err: unknown) {
      setEsBloqueo(err instanceof ErrorApi && err.codigo === 'BLOQUEADA')
      setError(mensajeErrorLogin(err))
    } finally {
      setCargando(false)
    }
  }

  // Restricción de rol: sólo el administrador entra al panel.
  async function despuesDeEntrar() {
    const sesion = sesionActual()
    if (sesion && sesion.usuario.rol !== 'administrador') {
      await cerrarSesion()
      setModo('login')
      setError('Acceso no autorizado: esta cuenta es de vendedor')
      return
    }
    onLoginExitoso?.()
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col justify-center overflow-hidden px-4 py-10 sm:px-6 lg:px-8">
      {/* El ave de la marca, enorme y casi transparente, asomando por la esquina */}
      <AveEmpresa className="pointer-events-none absolute -bottom-20 -right-6 -z-10 hidden h-[36rem] opacity-[0.09] sm:block lg:right-[10%]" />

      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoEmpresa className="h-24" />
          <h1 className="mt-6 text-[2rem] font-semibold leading-tight">Panel de administración</h1>
        </div>

        {/* Tarjeta principal */}
        <div className="rounded-[28px] border border-linea bg-papel p-6 shadow-[0_16px_48px_rgba(0,32,20,0.08)] sm:p-8">

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
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-apagado transition-colors hover:text-tinta focus-visible:outline-2 focus-visible:outline-marca"
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
                  className="rounded-md py-1 text-azul hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
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
                className="flex w-full items-center justify-center gap-2 rounded-full bg-tinta py-4 text-base font-semibold text-white transition-colors hover:bg-marca-oscuro active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-40"
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

          {/* MODO 3: SEGUNDO PASO (verificación en dos pasos) */}
          {modo === 'codigo' && (
            <PasoCodigo onListo={() => void despuesDeEntrar()} onVolver={() => { setPassword(''); setModo('login') }} />
          )}

          {/* MODO 2: RECUPERAR CONTRASEÑA (RF-002) */}
          {modo === 'recuperar' && (
            <RecuperarPassword correoInicial={correo} onVolver={(c) => { setCorreo(c); setError(''); setModo('login') }} />
          )}

        </div>

        {/* Alta de una empresa nueva (formulario progresivo de /registro) */}
        {onIrARegistro && modo === 'login' && (
          <p className="mt-5 text-center text-sm text-apagado">
            ¿Tu negocio aún no tiene cuenta?{' '}
            <button
              onClick={onIrARegistro}
              className="rounded-md font-semibold text-azul hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
            >
              Regístralo
            </button>
          </p>
        )}

        {/* Enlace sutil para ir a la PWA */}
        {onIrAPwa && (
          <div className="mt-6 text-center">
            <button
              onClick={onIrAPwa}
              className="inline-flex items-center gap-1.5 rounded-md py-1 text-xs font-semibold text-apagado transition-colors hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
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
