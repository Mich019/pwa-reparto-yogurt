import { useState } from 'react'
import { iniciarSesion } from '../../lib/sesion'
import { ErrorApi, ErrorRed } from '../../lib/api'
import { Campo, claseInput } from '../../components/ui'
import { FormPassword } from './Cuenta'

export function Login({ onIrAAdmin }: { onIrAAdmin?: () => void } = {}) {
  const [correo, setCorreo] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function entrar() {
    if (!correo.trim() || !password) return setError('Escribe tu correo y tu contraseña')
    setCargando(true)
    setError('')
    try {
      await iniciarSesion(correo.trim(), password)
    } catch (e) {
      setError(
        e instanceof ErrorRed ? 'Necesitas conexión para entrar la primera vez' :
        e instanceof ErrorApi || e instanceof Error ? e.message : 'No se pudo entrar',
      )
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="flex h-dvh flex-col justify-center bg-papel px-6 pt-safe pb-safe">
      <div className="mx-auto w-full max-w-sm">
        <img src="./icon.svg" alt="" className="h-14 w-14 rounded-2xl" />
        <h1 className="mt-6 text-4xl font-bold tracking-tight">Reparto Yogurt</h1>
        <p className="mt-1 text-apagado">Entra con tu cuenta para ver tu ruta.</p>
        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => { e.preventDefault(); void entrar() }}
        >
          <Campo etiqueta="Correo">
            <input className={claseInput} type="email" inputMode="email" autoComplete="username" autoCapitalize="none" value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </Campo>
          <Campo etiqueta="Contraseña">
            <input className={claseInput} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Campo>
          <div className="flex justify-end text-xs font-semibold">
            {onIrAAdmin && (
              <button
                type="button"
                onClick={onIrAAdmin}
                className="text-apagado hover:text-tinta"
              >
                Panel de Administración →
              </button>
            )}
          </div>
          {error && <p role="alert" className="rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
          <button type="submit" disabled={cargando} className="flex w-full items-center justify-center rounded-xl bg-tinta px-4 py-4 text-base font-semibold text-white active:bg-neutral-700 disabled:opacity-40">
            {cargando ? 'Entrando…' : 'Entrar'}
          </button>
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
      </div>
    </div>
  )
}
