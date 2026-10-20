import { useState } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Lock, Mail, ShieldAlert } from 'lucide-react'
import { ErrorApi, ErrorRed } from '../../lib/api'
import { iniciarSesion, restablecerPassword, solicitarRecuperacion } from '../../lib/sesion'
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
  const [rolNoAutorizado, setRolNoAutorizado] = useState(false)
  const [minutosVence, setMinutosVence] = useState(15)

  // RF-001 / RF-003 / RF-005: Inicio de sesión con validación de rol
  async function manejarLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!correo.trim() || !password) {
      setError('Por favor ingresa tu correo y contraseña')
      return
    }
    setCargando(true)
    setError('')
    setEsBloqueo(false)
    setRolNoAutorizado(false)

    try {
      await iniciarSesion(correo.trim(), password)
      onLoginExitoso?.()
    } catch (err: unknown) {
      if (err instanceof ErrorApi) {
        if (err.status === 423 || err.codigo === 'BLOQUEADA') {
          // RF-003: Bloqueo tras 5 intentos fallidos
          setEsBloqueo(true)
          setError('Cuenta bloqueada temporalmente tras 5 intentos fallidos. Intenta nuevamente en 15 minutos o contacta al administrador.')
        } else if (err.codigo === 'CUENTA_SUSPENDIDA') {
          setError('Esta cuenta está dada de baja o suspendida.')
        } else {
          setError(err.message || 'Correo o contraseña incorrectos.')
        }
      } else if (err instanceof ErrorRed) {
        setError('No se pudo conectar con el servidor. Revisa tu conexión a internet.')
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Ocurrió un error inesperado al intentar iniciar sesión.')
      }
    } finally {
      setCargando(false)
    }
  }

  // RF-002: Solicitar código de recuperación por correo
  async function manejarSolicitarCodigo(e: React.FormEvent) {
    e.preventDefault()
    if (!correo.trim()) {
      setError('Ingresa el correo asociado a tu cuenta.')
      return
    }
    setCargando(true)
    setError('')
    try {
      const res = await solicitarRecuperacion(correo.trim())
      setMinutosVence(res.minutos ?? 15)
      setModo('codigo')
    } catch (err: unknown) {
      if (err instanceof ErrorRed) {
        setError('Sin conexión con el servidor para enviar el código.')
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('No se pudo enviar el código de recuperación.')
      }
    } finally {
      setCargando(false)
    }
  }

  // RF-002 / RF-004: Restablecer contraseña con código de 6 dígitos
  async function manejarRestablecer(e: React.FormEvent) {
    e.preventDefault()
    if (!codigo.trim() || codigo.trim().length !== 6) {
      setError('Ingresa el código de 6 dígitos enviado a tu correo.')
      return
    }
    if (nuevaPassword.length < 8 || !/[A-Za-z]/.test(nuevaPassword) || !/\d/.test(nuevaPassword)) {
      setError('La nueva contraseña debe tener al menos 8 caracteres, con letras y números.')
      return
    }
    if (nuevaPassword !== confirmarPassword) {
      setError('Las contraseñas no coinciden.')
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
      if (err instanceof ErrorApi) {
        setError(err.message || 'El código es inválido o ha expirado.')
      } else if (err instanceof ErrorRed) {
        setError('Sin conexión con el servidor.')
      } else {
        setError('No se pudo restablecer la contraseña. Intenta pedir un nuevo código.')
      }
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-niebla/50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        
        {/* Cabecera y Logo */}
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-14 w-14 shadow-sm" textoClassName="text-2xl font-black" />
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-tinta px-3 py-1 text-xs font-semibold text-white">
            <Lock size={12} className="text-azul" />
            Panel de Administración
          </div>
          <p className="mt-2 text-sm text-apagado">
            {modo === 'login' && 'Ingresa tus credenciales de administrador para continuar'}
            {modo === 'olvido' && 'Restablecimiento de contraseña por correo (RF-002)'}
            {modo === 'codigo' && 'Ingresa el código de verificación recibido'}
            {modo === 'exito' && 'Tu contraseña ha sido actualizada'}
          </p>
        </div>

        {/* Tarjeta principal con estilo Uber / PWA */}
        <div className="rounded-3xl border border-linea bg-papel p-6 shadow-tarjeta sm:p-8">
          
          {/* MODO 1: LOGIN MULTIRROL (RF-001 / RF-003 / RF-005) */}
          {modo === 'login' && (
            <form onSubmit={manejarLogin} className="space-y-5">
              <Campo etiqueta="Correo institucional o de administrador">
                <div className="relative">
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    placeholder="admin@yogurt.local"
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

              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-apagado">Argon2id protegido (RF-004)</span>
                <button
                  type="button"
                  onClick={() => { setError(''); setModo('olvido') }}
                  className="text-azul hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>

              {/* Banner de error o bloqueo temporal (RF-003) */}
              {error && (
                <div
                  role="alert"
                  className={`flex items-start gap-3 rounded-2xl p-4 text-sm font-medium ${
                    esBloqueo ? 'bg-amber-500/10 text-amber-700 border border-amber-500/20' : 'bg-rojo/10 text-rojo'
                  }`}
                >
                  {esBloqueo ? <ShieldAlert size={20} className="shrink-0 mt-0.5" /> : <AlertCircle size={20} className="shrink-0 mt-0.5" />}
                  <div>
                    <p className="font-semibold">{esBloqueo ? 'Protección activa contra fuerza bruta' : 'Error al ingresar'}</p>
                    <p className="mt-0.5">{error}</p>
                  </div>
                </div>
              )}

              {/* Botón de envío */}
              <button
                type="submit"
                disabled={cargando}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-tinta py-4 text-base font-semibold text-white transition-all active:scale-[0.99] active:bg-neutral-800 disabled:opacity-40"
              >
                {cargando ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Validando credenciales…
                  </>
                ) : (
                  'Entrar al Panel'
                )}
              </button>
            </form>
          )}

          {/* MODO 2: RECUPERACIÓN - PASO 1 (RF-002) */}
          {modo === 'olvido' && (
            <form onSubmit={manejarSolicitarCodigo} className="space-y-5">
              <Campo etiqueta="Correo registrado">
                <div className="relative">
                  <input
                    type="email"
                    required
                    autoFocus
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    placeholder="tu@correo.com"
                    className={`${claseInput} pl-11`}
                  />
                  <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-apagado" />
                </div>
              </Campo>

              <p className="text-xs text-apagado leading-relaxed">
                Te enviaremos un código de seguridad de 6 dígitos con validez de 15 minutos para que puedas definir una nueva contraseña.
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
                {cargando ? 'Enviando código…' : 'Enviar código de recuperación'}
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

          {/* MODO 3: RECUPERACIÓN - PASO 2: CÓDIGO Y NUEVA CONTRASEÑA (RF-002) */}
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

          {/* MODO 4: CONFIRMACIÓN EXITOSA */}
          {modo === 'exito' && (
            <div className="py-4 text-center space-y-4">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-verde/10 text-verde">
                <CheckCircle2 size={36} />
              </div>
              <h3 className="text-xl font-bold tracking-tight text-tinta">¡Contraseña restablecida!</h3>
              <p className="text-sm text-apagado leading-relaxed">
                Tu clave ha sido actualizada con éxito bajo el cifrado seguro Argon2id. Ya puedes entrar con tus nuevas credenciales.
              </p>
              <button
                onClick={() => { setError(''); setModo('login') }}
                className="w-full rounded-xl bg-tinta py-3.5 text-base font-semibold text-white active:bg-neutral-800"
              >
                Iniciar sesión ahora
              </button>
            </div>
          )}

        </div>

        {/* Enlace para cambiar a la vista de la PWA Móvil */}
        <div className="mt-8 text-center">
          <button
            onClick={onIrAPwa}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-apagado transition-colors hover:text-tinta"
          >
            <ArrowLeft size={14} />
            Cambiar a la App Móvil de Reparto (PWA)
          </button>
        </div>

      </div>
    </div>
  )
}
