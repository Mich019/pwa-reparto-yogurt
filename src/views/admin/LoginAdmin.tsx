import { useState } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Mail, ShieldAlert } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { cerrarSesion, iniciarSesion, mensajeErrorLogin, restablecerPassword, sesionActual, solicitarRecuperacion } from '../../lib/sesion'
import { Logo } from '../../components/Logo'
import { Campo, claseInput } from '../../components/ui'

type Modo = 'login' | 'olvido' | 'codigo' | 'exito'

export function LoginAdmin({ onLoginExitoso, onIrAPwa }: {
  onLoginExitoso?: () => void
  onIrAPwa?: () => void
}) {
  const [modo, setModo] = useState<Modo>('login')

  // Campos de formulario
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [verPassword, setVerPassword] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [nuevaPassword, setNuevaPassword] = useState('')
  const [confirmarPassword, setConfirmarPassword] = useState('')
  const [verNuevaPassword, setVerNuevaPassword] = useState(false)

  // Estados de carga y error
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [esBloqueo, setEsBloqueo] = useState(false)
  const [minutosVence, setMinutosVence] = useState(15)

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

  // Solicitar código de recuperación por correo
  async function manejarSolicitarCodigo(e: React.FormEvent) {
    e.preventDefault()
    if (!correo.trim()) {
      setError('Credenciales inválidas')
      return
    }
    setCargando(true)
    setError('')
    try {
      const res = await solicitarRecuperacion(correo.trim())
      setMinutosVence(res.minutos ?? 15)
      setModo('codigo')
    } catch (err: unknown) {
      setError(mensajeErrorLogin(err))
    } finally {
      setCargando(false)
    }
  }

  // Restablecer contraseña con código de 6 dígitos
  async function manejarRestablecer(e: React.FormEvent) {
    e.preventDefault()
    if (!codigo.trim() || codigo.trim().length !== 6) {
      setError('Ingresa el código de 6 dígitos')
      return
    }
    if (nuevaPassword.length < 8 || !/[A-Za-z]/.test(nuevaPassword) || !/\d/.test(nuevaPassword)) {
      setError('La nueva contraseña debe tener al menos 8 caracteres con letras y números')
      return
    }
    if (nuevaPassword !== confirmarPassword) {
      setError('Las contraseñas no coinciden')
      return
    }

    setCargando(true)
    setError('')
    try {
      await restablecerPassword(correo.trim(), codigo.trim(), nuevaPassword)
      setModo('exito')
      setPassword('')
      setCodigo('')
      setNuevaPassword('')
      setConfirmarPassword('')
    } catch (err: unknown) {
      if (err instanceof ErrorApi && err.status < 500) {
        setError(err.message || 'El código es incorrecto o ya venció')
      } else {
        setError('Algo salió mal...')
      }
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
                  onClick={() => { setError(''); setModo('olvido') }}
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

          {/* MODO 2: SOLICITUD DE CÓDIGO */}
          {modo === 'olvido' && (
            <form onSubmit={manejarSolicitarCodigo} className="space-y-5">
              <Campo etiqueta="Correo">
                <div className="relative">
                  <input
                    type="email"
                    required
                    autoFocus
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    placeholder="correo@ejemplo.com"
                    className={`${claseInput} pl-11`}
                  />
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-apagado" />
                </div>
              </Campo>

              <p className="text-xs text-apagado leading-relaxed">
                Ingresa tu correo para recibir un código de recuperación de 6 dígitos.
              </p>

              {error && (
                <div role="alert" className="flex items-center gap-2.5 rounded-2xl bg-rojo/10 p-3.5 text-sm font-medium text-rojo">
                  <AlertCircle size={18} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={cargando}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-tinta py-4 text-base font-semibold text-white transition-all active:bg-neutral-800 disabled:opacity-40"
              >
                {cargando ? 'Enviando código…' : 'Enviar código'}
              </button>

              <button
                type="button"
                onClick={() => { setError(''); setModo('login') }}
                className="flex w-full items-center justify-center gap-1.5 py-2 text-sm font-semibold text-apagado hover:text-tinta"
              >
                <ArrowLeft size={16} /> Volver a iniciar sesión
              </button>
            </form>
          )}

          {/* MODO 3: CÓDIGO Y NUEVA CONTRASEÑA */}
          {modo === 'codigo' && (
            <form onSubmit={manejarRestablecer} className="space-y-5">
              <div className="rounded-2xl bg-niebla p-3.5 text-xs text-apagado">
                Código enviado a <strong className="text-tinta">{correo}</strong>. Expira en {minutosVence} minutos.
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
                  className={`${claseInput} text-center tracking-[0.5em] text-2xl font-bold`}
                />
              </Campo>

              <Campo etiqueta="Nueva contraseña">
                <div className="relative">
                  <input
                    type={verNuevaPassword ? 'text' : 'password'}
                    required
                    value={nuevaPassword}
                    onChange={(e) => setNuevaPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres (letras y números)"
                    className={`${claseInput} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setVerNuevaPassword(!verNuevaPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-apagado transition-colors hover:text-tinta"
                  >
                    {verNuevaPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </Campo>

              <Campo etiqueta="Confirmar nueva contraseña">
                <input
                  type="password"
                  required
                  value={confirmarPassword}
                  onChange={(e) => setConfirmarPassword(e.target.value)}
                  placeholder="Repite tu nueva contraseña"
                  className={claseInput}
                />
              </Campo>

              {error && (
                <div role="alert" className="flex items-center gap-2.5 rounded-2xl bg-rojo/10 p-3.5 text-sm font-medium text-rojo">
                  <AlertCircle size={18} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={cargando}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-tinta py-4 text-base font-semibold text-white transition-all active:bg-neutral-800 disabled:opacity-40"
              >
                {cargando ? 'Actualizando contraseña…' : 'Restablecer contraseña'}
              </button>

              <div className="flex justify-between items-center text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => { setError(''); setModo('olvido') }}
                  className="text-apagado hover:text-tinta"
                >
                  Solicitar otro código
                </button>
                <button
                  type="button"
                  onClick={() => { setError(''); setModo('login') }}
                  className="text-azul hover:underline"
                >
                  Cancelar y volver
                </button>
              </div>
            </form>
          )}

          {/* MODO 4: ÉXITO */}
          {modo === 'exito' && (
            <div className="py-4 text-center space-y-4">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-verde/10 text-verde">
                <CheckCircle2 size={36} />
              </div>
              <h3 className="text-xl font-bold tracking-tight text-tinta">¡Contraseña restablecida!</h3>
              <p className="text-sm text-apagado leading-relaxed">
                Tu contraseña ha sido actualizada con éxito. Ya puedes iniciar sesión con tu nueva clave.
              </p>
              <button
                onClick={() => { setError(''); setModo('login') }}
                className="w-full rounded-xl bg-tinta py-3.5 text-base font-semibold text-white active:bg-neutral-800"
              >
                Iniciar sesión
              </button>
            </div>
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
