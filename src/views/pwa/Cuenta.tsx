import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CloudOff, LogOut, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react'
import { db } from '../../lib/db'
import { ErrorApi, ErrorRed } from '../../lib/api'
import { hace } from '../../lib/fechas'
import { cambiarPassword, cerrarSesion, useSesion } from '../../lib/sesion'
import { sincronizar, useEstadoSync } from '../../lib/sync'
import { Boton, Campo, Hoja, aviso, claseInput } from '../../components/ui'

const ROL = { administrador: 'Administrador', vendedor: 'Vendedor' }

export function FormPassword({ onListo }: { onListo?: () => void }) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function guardar() {
    if (nueva.length < 8 || !/[A-Za-z]/.test(nueva) || !/\d/.test(nueva)) return setError('La nueva contraseña debe tener al menos 8 caracteres, con letras y números')
    if (nueva !== repetir) return setError('Las contraseñas nuevas no coinciden')
    setCargando(true)
    setError('')
    try {
      await cambiarPassword(actual, nueva)
      aviso('Contraseña actualizada')
      onListo?.()
    } catch (e) {
      setError(e instanceof ErrorApi || e instanceof ErrorRed ? e.message : 'No se pudo cambiar la contraseña')
    } finally {
      setCargando(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void guardar() }}>
      <Campo etiqueta="Contraseña actual">
        <input className={claseInput} type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} />
      </Campo>
      <Campo etiqueta="Contraseña nueva">
        <input className={claseInput} type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} />
      </Campo>
      <Campo etiqueta="Repite la contraseña nueva">
        <input className={claseInput} type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} />
      </Campo>
      {error && <p role="alert" className="rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
      <button type="submit" disabled={cargando} className="flex w-full items-center justify-center rounded-xl bg-tinta px-4 py-4 text-base font-semibold text-white active:bg-neutral-700 disabled:opacity-40">
        {cargando ? 'Guardando…' : 'Guardar contraseña'}
      </button>
    </form>
  )
}

export function Cuenta() {
  const sesion = useSesion()
  const sync = useEstadoSync()
  const pendientes = useLiveQuery(() => db.cola.count(), []) ?? 0
  const problemas = useLiveQuery(() => db.problemas.filter((p) => !p.visto).toArray(), []) ?? []
  const [cambiando, setCambiando] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  if (!sesion) return null
  const u = sesion.usuario

  async function salir() {
    setSaliendo(true)
    await sincronizar() // si hay señal, lo pendiente sale antes de cerrar
    await cerrarSesion()
    setSaliendo(false)
  }

  return (
    <div className="h-full overflow-y-auto px-4 pt-safe pb-24">
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Mi cuenta</h1>

      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-niebla p-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-tinta text-lg font-bold text-white">{u.nombre.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{u.nombre}</div>
          <div className="truncate text-sm text-apagado">{u.correo}</div>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold"><ShieldCheck size={14} />{ROL[u.rol]}</span>
      </div>

      <div className="mt-3 rounded-2xl bg-niebla p-4">
        <div className="flex items-center gap-2 font-semibold">
          {sync.error ? <CloudOff size={18} className="text-ambar" /> : <RefreshCw size={18} className={sync.sincronizando ? 'animate-spin' : ''} />}
          Sincronización
        </div>
        <p className="mt-1 text-sm text-apagado">
          {sync.sincronizando ? 'Sincronizando…' : sync.error ?? (sync.ultimaOk ? `Al día, ${hace(sync.ultimaOk)}` : 'Pendiente de la primera sincronización')}
        </p>
        <p className="mt-0.5 text-sm text-apagado">
          {pendientes ? `${pendientes} ${pendientes === 1 ? 'cambio' : 'cambios'} por enviar` : 'Nada pendiente por enviar'}
        </p>
        <Boton variante="secundario" className="mt-3 w-full bg-white" onClick={() => void sincronizar()} disabled={sync.sincronizando}>Sincronizar ahora</Boton>
      </div>

      {problemas.length > 0 && (
        <div className="mt-3 rounded-2xl bg-ambar/20 p-4">
          <div className="flex items-center gap-2 font-semibold"><TriangleAlert size={18} />Cambios que no se aplicaron</div>
          <ul className="mt-2 space-y-2">
            {problemas.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                <span className="flex-1">{p.mensaje}</span>
                <button className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold" onClick={() => db.problemas.update(p.id, { visto: true })}>Entendido</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <Boton variante="secundario" className="w-full" onClick={() => setCambiando(true)}>Cambiar contraseña</Boton>
        <Boton variante="peligro" className="w-full" onClick={() => void salir()} disabled={saliendo}><LogOut size={18} />{saliendo ? 'Cerrando…' : 'Cerrar sesión'}</Boton>
        {pendientes > 0 && <p className="px-1 text-xs text-apagado">Los cambios por enviar se guardan en este teléfono y salen cuando vuelvas a entrar con esta cuenta.</p>}
      </div>

      <Hoja abierta={cambiando} onCerrar={() => setCambiando(false)} titulo="Cambiar contraseña">
        <div className="pb-4"><FormPassword onListo={() => setCambiando(false)} /></div>
      </Hoja>
    </div>
  )
}
