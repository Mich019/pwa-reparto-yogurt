import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, BellRing, CloudOff, Eye, EyeOff, Flame, LogOut, MapPin, Package, RefreshCw, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { db, type Aviso, type PestanaAviso, type TipoAviso } from '../../lib/db'
import { ErrorApi, ErrorRed } from '../../lib/api'
import { HORA_CIERRE, useHoraCierre } from '../../lib/alertas'
import { hace } from '../../lib/fechas'
import { activarPush, desactivarPush, enviarPrueba, marcarLeidosEnServidor, useEstadoPush } from '../../lib/push'
import { cambiarPassword, cerrarSesion, obtenerUltimoPassword, sesionActual, useSesion } from '../../lib/sesion'
import { sincronizar, useEstadoSync } from '../../lib/sync'
import { Boton, Campo, Hoja, aviso, claseInput } from '../../components/ui'

const ROL = { administrador: 'Administrador', vendedor: 'Vendedor' }

export function FormPassword({ onListo }: { onListo?: () => void }) {
  const [actual, setActual] = useState(() => (sesionActual()?.usuario.debeCambiarPassword ? obtenerUltimoPassword() : null) ?? '')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [verActual, setVerActual] = useState(false)
  const [verNueva, setVerNueva] = useState(false)
  const [verRepetir, setVerRepetir] = useState(false)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)

  async function guardar() {
    const act = actual.trim()
    const nue = nueva.trim()
    const rep = repetir.trim()
    if (!act) return setError('Ingresa tu contraseña actual o temporal')
    if (nue.length < 10 || !/[A-Za-z]/.test(nue) || !/\d/.test(nue)) {
      return setError('La nueva contraseña debe tener al menos 10 caracteres, con letras y números')
    }
    if (nue !== rep) return setError('Las contraseñas nuevas no coinciden')
    if (act === nue) return setError('La nueva contraseña debe ser diferente a la actual')

    setCargando(true)
    setError('')
    try {
      await cambiarPassword(act, nue)
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
      <Campo etiqueta="Contraseña actual o temporal">
        <div className="relative">
          <input
            className={`${claseInput} pr-10`}
            type={verActual ? 'text' : 'password'}
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="Contraseña actual"
          />
          <button
            type="button"
            onClick={() => setVerActual(!verActual)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-apagado hover:text-tinta"
            aria-label="Ver contraseña"
          >
            {verActual ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </Campo>

      <Campo etiqueta="Contraseña nueva (mínimo 10 caract., letras y números)">
        <div className="relative">
          <input
            className={`${claseInput} pr-10`}
            type={verNueva ? 'text' : 'password'}
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            placeholder="Nueva contraseña"
          />
          <button
            type="button"
            onClick={() => setVerNueva(!verNueva)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-apagado hover:text-tinta"
            aria-label="Ver contraseña"
          >
            {verNueva ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </Campo>

      <Campo etiqueta="Repite la contraseña nueva">
        <div className="relative">
          <input
            className={`${claseInput} pr-10`}
            type={verRepetir ? 'text' : 'password'}
            autoComplete="new-password"
            value={repetir}
            onChange={(e) => setRepetir(e.target.value)}
            placeholder="Confirmar contraseña"
          />
          <button
            type="button"
            onClick={() => setVerRepetir(!verRepetir)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-apagado hover:text-tinta"
            aria-label="Ver contraseña"
          >
            {verRepetir ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </Campo>

      {error && <p role="alert" className="rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}

      <button
        type="submit"
        disabled={cargando}
        className="flex w-full items-center justify-center rounded-xl bg-tinta px-4 py-4 text-base font-semibold text-white active:bg-neutral-800 disabled:opacity-40"
      >
        {cargando ? 'Guardando…' : 'Guardar contraseña'}
      </button>
    </form>
  )
}

const ICONO_AVISO: Record<TipoAviso, LucideIcon> = {
  pedido_urgente: Flame, ruta_modificada: MapPin, stock_asignado: Package, stock_bajo: Package, sync_pendiente: CloudOff, prueba: Bell,
}
const mensajeError = (e: unknown) => (e instanceof Error ? e.message : 'No se pudo completar. Intenta de nuevo.')

// RF-054 y RF-055 · Los avisos recibidos y si este teléfono puede recibirlos con la app cerrada.
function Avisos({ irA }: { irA?: (p: PestanaAviso) => void }) {
  const avisos = useLiveQuery(() => db.avisos.orderBy('creado').reverse().limit(30).toArray(), []) ?? []
  const sinLeer = avisos.filter((a) => !a.leida)

  async function abrir(a: Aviso) {
    if (!a.leida) {
      await db.avisos.update(a.id, { leida: true })
      if (!a.local) void marcarLeidosEnServidor([a.id])
    }
    if (a.pestana) irA?.(a.pestana)
  }
  async function leerTodo() {
    await db.avisos.filter((a) => !a.leida).modify({ leida: true })
    void marcarLeidosEnServidor(sinLeer.filter((a) => !a.local).map((a) => a.id))
  }

  return (
    <div className="mt-3 rounded-2xl bg-niebla p-4">
      <div className="flex items-center gap-2 font-semibold">
        <BellRing size={18} /> Avisos
        {sinLeer.length > 0 && <span className="rounded-full bg-tinta px-2 py-0.5 text-xs font-bold text-white">{sinLeer.length}</span>}
        {sinLeer.length > 0 && <button onClick={() => void leerTodo()} className="ml-auto rounded-full bg-papel px-3 py-1 text-xs font-semibold">Marcar leídos</button>}
      </div>
      {avisos.length === 0 ? (
        <p className="mt-1 text-sm text-apagado">Aquí verás los pedidos urgentes, los cambios de tu ruta y las alertas de stock.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {avisos.map((a) => {
            const Icono = ICONO_AVISO[a.tipo] ?? Bell
            return (
              <li key={a.id}>
                <button onClick={() => void abrir(a)} className="flex w-full items-start gap-3 rounded-xl bg-papel p-3 text-left active:bg-linea" data-aviso={a.tipo}>
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-niebla"><Icono size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${a.leida ? 'font-medium' : 'font-bold'}`}>{a.titulo}</span>
                    {a.cuerpo && <span className="block text-sm text-apagado">{a.cuerpo}</span>}
                    <span className="mt-0.5 block text-xs text-apagado">{hace(a.creado)}</span>
                  </span>
                  {!a.leida && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-rojo" aria-label="Sin leer" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Notificaciones() {
  const { estado, refrescar } = useEstadoPush()
  const [horaCierre, cambiarHora] = useHoraCierre()
  const [ocupado, setOcupado] = useState(false)

  async function accion(f: () => Promise<string | void>) {
    setOcupado(true)
    try {
      const texto = await f()
      if (texto) aviso(texto)
    } catch (e) {
      aviso(mensajeError(e))
    } finally {
      setOcupado(false)
      void refrescar()
    }
  }
  const activar = () => accion(async () => ((await activarPush()) === 'push'
    ? 'Avisos activados en este teléfono'
    : 'Avisos activados. El servidor aún no tiene push: los pedidos urgentes llegan al abrir la app.'))
  const probar = () => accion(async () => {
    const r = await enviarPrueba()
    return r.dispositivos ? `Prueba enviada a ${r.enviados} de ${r.dispositivos} ${r.dispositivos === 1 ? 'teléfono' : 'teléfonos'}. Con la app abierta se ve aquí arriba; cerrada, como notificación.` : 'Este teléfono aún no está suscrito'
  })
  const apagar = () => accion(async () => { await desactivarPush(); return 'Este teléfono ya no recibirá avisos con la app cerrada' })

  let texto = 'Revisando…'
  if (estado) {
    if (!estado.soportado) texto = estado.motivo ?? 'Este teléfono no puede recibir notificaciones.'
    else if (estado.permiso === 'denied') texto = 'Bloqueaste los avisos para este sitio. Actívalos en los ajustes del navegador o de la app instalada.'
    else if (estado.permiso !== 'granted') texto = 'Activa los avisos para enterarte de un pedido urgente o de un cambio en tu ruta aunque la app esté cerrada.'
    else if (estado.suscrito) texto = 'Recibes los avisos de pedidos urgentes y cambios de ruta aunque la app esté cerrada.'
    else if (estado.servidor === false) texto = 'Los avisos de stock y de ventas sin enviar están activados. El servidor aún no tiene push, así que lo demás llega al abrir la app.'
    else texto = 'Falta suscribir este teléfono para recibir avisos con la app cerrada.'
  }
  const puede = !!estado?.soportado && estado.permiso !== 'denied'
  const activo = !!estado?.suscrito && estado.permiso === 'granted'

  return (
    <div className="mt-3 rounded-2xl bg-niebla p-4">
      <div className="flex items-center gap-2 font-semibold"><Bell size={18} /> Notificaciones en este teléfono</div>
      <p className="mt-1 text-sm text-apagado" data-estado-push={activo ? 'activo' : 'inactivo'}>{texto}</p>
      {puede && (
        <div className="mt-3 flex gap-2">
          {activo ? (
            <>
              <Boton variante="secundario" className="flex-1 bg-papel !py-3 text-sm" onClick={() => void probar()} disabled={ocupado}>Enviar prueba</Boton>
              <Boton variante="secundario" className="flex-1 bg-papel !py-3 text-sm" onClick={() => void apagar()} disabled={ocupado}>Desactivar</Boton>
            </>
          ) : (
            <Boton className="w-full !py-3 text-sm" onClick={() => void activar()} disabled={ocupado}>Activar avisos</Boton>
          )}
        </div>
      )}
      <label className="mt-4 flex items-center justify-between gap-3 text-sm">
        <span className="text-apagado">Avisarme si quedan ventas sin enviar a partir de las</span>
        <select
          value={horaCierre}
          onChange={(e) => void cambiarHora(Number(e.target.value))}
          className="rounded-xl bg-papel px-3 py-2 text-sm font-semibold"
          aria-label="Hora a partir de la cual avisar de ventas sin enviar"
        >
          {[...new Set([HORA_CIERRE, 14, 15, 16, 17, 18, 19, 20, 21, 22, horaCierre])].sort((a, b) => a - b).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
        </select>
      </label>
    </div>
  )
}

export function Cuenta({ irA }: { irA?: (p: PestanaAviso) => void }) {
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

      <Avisos irA={irA} />
      <Notificaciones />

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
