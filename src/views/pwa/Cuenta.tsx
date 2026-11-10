import { useState } from 'react'
import { reparte } from '../../lib/reparto'
import { Selector } from '../../components/Selector'
import { useLiveQuery } from 'dexie-react-hooks'
import { Bell, BellRing, ChevronRight, CloudOff, Eye, EyeOff, Flame, LifeBuoy, LockKeyhole, LogOut, MapPin, Package, RefreshCw, ShieldCheck, TriangleAlert, Wallet, CreditCard, type LucideIcon } from 'lucide-react'
import { db, type Aviso, type PestanaAviso, type TipoAviso } from '../../lib/db'
import { ErrorApi, ErrorRed, MODO_SERVIDOR } from '../../lib/api'
import { HORA_CIERRE, useHoraCierre } from '../../lib/alertas'
import { dinero, hace } from '../../lib/fechas'
import { fijarMiMeta, useServidor, type MiMeta } from '../../lib/cobranza'
import { activarPush, desactivarPush, enviarPrueba, marcarLeidosEnServidor, renovarSuscripcion, useEstadoPush } from '../../lib/push'
import { cambiarPassword, cerrarSesion, obtenerUltimoPassword, sesionActual, useSesion } from '../../lib/sesion'
import { HORAS, SILENCIO_NOCHE, hora, usePreferenciasAvisos } from '../../lib/preferencias'
import { useEnVivoConectado } from '../../lib/enVivo'
import { sincronizar, useEstadoSync } from '../../lib/sync'
import { Boton, Campo, Hoja, aviso, claseInput } from '../../components/ui'
import { DosPasos } from './DosPasos'
import { MiDia } from './MiDia'
import { FotoPerfil } from '../../components/Avatar'
import { Ayuda, useHayNovedades } from '../ayuda/Ayuda'
import { EditorMensaje } from '../../components/Mensajes'
import { PrivacidadYDatos } from '../legal/PrivacidadYDatos'

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
      void renovarSuscripcion().catch(() => {}) // el servidor quitó los avisos de todos los teléfonos: éste se vuelve a suscribir
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

      {error && <p role="alert" className="rounded-md bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}

      <button
        type="submit"
        disabled={cargando}
        className="flex w-full items-center justify-center rounded-md bg-tinta px-4 py-4 text-base font-semibold text-white active:bg-neutral-800 disabled:opacity-40"
      >
        {cargando ? 'Guardando…' : 'Guardar contraseña'}
      </button>
    </form>
  )
}

const ICONO_AVISO: Record<TipoAviso, LucideIcon> = {
  pedido_urgente: Flame, urgente_sin_atender: Flame, ruta_modificada: MapPin, stock_asignado: Package, stock_bajo: Package, sync_pendiente: CloudOff, corte_descuadrado: Wallet, corte_entregado: Wallet, prueba_por_vencer: CreditCard, prueba: Bell,
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
    if (a.url) location.assign(a.url)
    else if (a.pestana) irA?.(a.pestana)
  }
  async function leerTodo() {
    await db.avisos.filter((a) => !a.leida).modify({ leida: true })
    void marcarLeidosEnServidor(sinLeer.filter((a) => !a.local).map((a) => a.id))
  }

  return (
    <div className="mt-6 border-t border-linea pt-4">
      <div className="flex items-center gap-2 font-semibold">
        <BellRing size={18} /> Avisos
        {sinLeer.length > 0 && <span className="rounded-md bg-tinta px-2 py-0.5 text-xs font-bold text-white">{sinLeer.length}</span>}
        {sinLeer.length > 0 && <button onClick={() => void leerTodo()} className="ml-auto rounded-md bg-niebla px-3 py-1 text-xs font-semibold">Marcar leídos</button>}
      </div>
      {avisos.length === 0 ? (
        <p className="mt-1 text-sm text-apagado">Aquí verás los pedidos urgentes, los cambios de tu ruta y las alertas de stock.</p>
      ) : (
        <ul className="mt-2 divide-y divide-linea">
          {avisos.map((a) => {
            const Icono = ICONO_AVISO[a.tipo] ?? Bell
            return (
              <li key={a.id}>
                <button onClick={() => void abrir(a)} className="flex w-full items-start gap-3 py-3 text-left active:bg-niebla" data-aviso={a.tipo}>
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
    <div className="mt-6 border-t border-linea pt-4">
      <div className="flex items-center gap-2 font-semibold"><Bell size={18} /> Preferencias</div>
      <div className="mt-3 text-sm font-semibold">Notificaciones en este teléfono</div>
      <p className="mt-0.5 text-sm text-apagado" data-estado-push={activo ? 'activo' : 'inactivo'}>{texto}</p>
      {puede && (
        <div className="mt-3 flex gap-2">
          {activo ? (
            <>
              <Boton variante="secundario" className="flex-1 !py-3 text-sm" onClick={() => void probar()} disabled={ocupado}>Enviar prueba</Boton>
              <Boton variante="secundario" className="flex-1 !py-3 text-sm" onClick={() => void apagar()} disabled={ocupado}>Desactivar</Boton>
            </>
          ) : (
            <Boton className="w-full !py-3 text-sm" onClick={() => void activar()} disabled={ocupado}>Activar avisos</Boton>
          )}
        </div>
      )}
      <label className="mt-4 flex items-center justify-between gap-3 text-sm">
        <span className="text-apagado">Avisarme si quedan ventas sin enviar a partir de las</span>
        <Selector
          valor={horaCierre}
          onCambiar={(h) => void cambiarHora(h)}
          className="rounded-md bg-niebla px-3 py-2 text-sm font-semibold"
          etiqueta="Hora a partir de la cual avisar de ventas sin enviar"
          opciones={[...new Set([HORA_CIERRE, 14, 15, 16, 17, 18, 19, 20, 21, 22, horaCierre])].sort((a, b) => a - b).map((h) => ({ valor: h, texto: `${String(h).padStart(2, '0')}:00` }))}
        />
      </label>
      {MODO_SERVIDOR && <PreferenciasAvisos vendedor={sesionActual()?.usuario.rol === 'vendedor'} />}
      <details className="mt-4 border-t border-linea pt-3">
        <summary className="cursor-pointer py-1 text-sm font-semibold">Mensaje de «voy en camino»</summary>
        <p className="mt-1 text-sm text-apagado">Es el que se abre al tocar «Voy en camino» en la parada de la ruta.</p>
        <div className="mt-2"><EditorMensaje tipo="camino" /></div>
      </details>
      {MODO_SERVIDOR && sesionActual()?.usuario.rol === 'administrador' && reparte() && <MiMetaPropia />}
    </div>
  )
}

// El administrador que también reparte pone su meta del mes (a un vendedor se la pone él en su ficha de Vendedores).
function MiMetaPropia() {
  const r = useServidor<MiMeta>('/mi-meta')
  const [texto, setTexto] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const valor = texto ?? (r.datos?.meta ? String(r.datos.meta) : '')
  async function guardar() {
    const n = valor.trim() ? Number(valor.replace(/[$,\s]/g, '')) : null
    if (n !== null && !(n > 0)) return aviso('Escribe un monto mayor a cero, o déjalo vacío para no tener meta')
    setGuardando(true)
    try {
      await fijarMiMeta(n)
      setTexto(null)
      r.recargar()
      aviso(n ? `Tu meta del mes: ${dinero(n)}` : 'Ya no tienes meta del mes')
    } catch (e) {
      aviso(mensajeError(e))
    } finally {
      setGuardando(false)
    }
  }
  return (
    <div className="mt-5 border-t border-linea pt-4">
      <label htmlFor="mi-meta" className="text-sm font-semibold">Mi meta del mes</label>
      <p className="mt-0.5 text-sm text-apagado">Como también repartes: lo que quieres vender cada mes. Se ve en tu Ruta y aquí en Cuenta.</p>
      <div className="mt-3 flex gap-2">
        <input id="mi-meta" inputMode="decimal" placeholder="Sin meta" value={valor} onChange={(e) => setTexto(e.target.value)} className={`${claseInput} flex-1`} />
        <Boton className="!py-3 text-sm" onClick={() => void guardar()} disabled={guardando || texto === null}>Guardar</Boton>
      </div>
    </div>
  )
}

// Los avisos del servidor que el vendedor puede apagar (AVISOS_ELEGIBLES en api/_lib/notificaciones.ts) y el horario de
// silencio. Se guardan en su cuenta (lib/preferencias.ts): uno apagado no llega; en silencio no suena por push y llega
// al sincronizar. El pedido urgente siempre llega y siempre suena.
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const TIPOS_AVISO = [
  { tipo: 'stock_asignado', titulo: 'Tu carga del día', ayuda: 'Cuando te asignan o cambian la carga.' },
  { tipo: 'meta_alcanzada', titulo: 'Tu meta del mes', ayuda: 'Te felicitamos cuando llegas a tu meta.' },
  { tipo: 'medalla_ganada', titulo: 'Tus medallas', ayuda: 'Cuando llegas a 3, 6 o 12 meses seguidos en tu meta.' },
  { tipo: 'record_personal', titulo: 'Tus récords', ayuda: 'Cuando superas tu mejor racha de meses seguidos.' },
  { tipo: 'racha_en_riesgo', titulo: 'Tu racha en riesgo', ayuda: 'Al final del mes, si llegaste a tu meta el mes pasado y este todavía no.' },
  { tipo: 'fiado_atrasado', titulo: 'Fiado de más de un mes', ayuda: 'Una vez al día, si alguno de tus clientes debe desde hace más de 30 días.' },
  { tipo: 'ruta_modificada', titulo: 'Cambios en tu ruta', ayuda: 'Pedidos de hoy que se agregan, cambian o quitan, y clientes que pasan a tu cartera.' },
] as const

function Interruptor({ encendido, deshabilitado, alCambiar }: { encendido: boolean; deshabilitado: boolean; alCambiar: (si: boolean) => void }) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <input type="checkbox" role="switch" checked={encendido} disabled={deshabilitado} onChange={(e) => alCambiar(e.target.checked)} className="peer sr-only" />
      <span className="h-7 w-12 rounded-full bg-linea transition-colors peer-checked:bg-marca peer-disabled:opacity-40 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marca" />
      <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-papel shadow transition-transform peer-checked:translate-x-5" />
    </span>
  )
}

function Opcion({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 flex cursor-pointer items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block text-xs text-apagado">{ayuda}</span>
      </span>
      {children}
    </label>
  )
}

function PreferenciasAvisos({ vendedor }: { vendedor: boolean }) {
  const { prefs, sinSenal, encendido, alternar, cambiarSilencio, cambiarSemanal, cambiarDiaSemanal } = usePreferenciasAvisos((e) => aviso(mensajeError(e)))
  const diaSemanal = prefs?.resumenSemanalDia ?? 1
  const silencio = prefs?.silencio ?? null
  const claseHora = 'rounded-md bg-niebla px-3 py-2 text-sm font-semibold'
  return (
    <>
      {sinSenal && <p className="mt-4 border-t border-linea pt-3 text-xs text-apagado">Sin conexión: lo de abajo se puede cambiar cuando haya señal.</p>}
      {vendedor && (
        <div className="mt-4 border-t border-linea pt-3">
          <div className="text-sm font-semibold">Qué avisos recibes</div>
          <p className="text-xs text-apagado">Los pedidos urgentes siempre te llegan.</p>
          {TIPOS_AVISO.map(({ tipo, titulo, ayuda }) => (
            <Opcion key={tipo} titulo={titulo} ayuda={ayuda}>
              <Interruptor encendido={encendido(tipo)} deshabilitado={!prefs} alCambiar={(si) => void alternar(tipo, si)} />
            </Opcion>
          ))}
        </div>
      )}
      {vendedor && (
        <div className="mt-4 border-t border-linea pt-3">
          <Opcion titulo="Tu semana por correo" ayuda={prefs?.resumenSemanal ? `Cada ${DIAS_SEMANA[diaSemanal - 1].toLowerCase()}: lo que vendiste, contra la semana anterior y cómo vas con tu meta.` : 'Apagado.'}>
            <Interruptor encendido={!!prefs?.resumenSemanal} deshabilitado={!prefs} alCambiar={(si) => void cambiarSemanal(si)} />
          </Opcion>
          {prefs?.resumenSemanal && (
            <div className="mt-3 w-fit">
              <Selector valor={diaSemanal} onCambiar={(d) => void cambiarDiaSemanal(d)} className={claseHora} etiqueta="Día de tu resumen semanal"
                opciones={DIAS_SEMANA.map((d, i) => ({ valor: i + 1, texto: d }))} />
            </div>
          )}
        </div>
      )}
      <div className="mt-4 border-t border-linea pt-3">
        <Opcion titulo="Horario de silencio" ayuda={silencio ? `De ${hora(silencio.desde)} a ${hora(silencio.hasta)} no suenan; los ves al abrir la app. Los urgentes sí suenan.` : 'Los avisos suenan a cualquier hora.'}>
          <Interruptor encendido={!!silencio} deshabilitado={!prefs} alCambiar={(si) => void cambiarSilencio(si ? SILENCIO_NOCHE : null)} />
        </Opcion>
        {silencio && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Selector valor={silencio.desde} onCambiar={(desde) => void cambiarSilencio({ ...silencio, desde })} className={claseHora} etiqueta="Silencio desde"
              opciones={HORAS.map((h) => ({ valor: h, texto: hora(h), deshabilitada: h === silencio.hasta }))} />
            <span className="text-apagado">a</span>
            <Selector valor={silencio.hasta} onCambiar={(hasta) => void cambiarSilencio({ ...silencio, hasta })} className={claseHora} etiqueta="Silencio hasta"
              opciones={HORAS.map((h) => ({ valor: h, texto: hora(h), deshabilitada: h === silencio.desde }))} />
          </div>
        )}
      </div>
    </>
  )
}

export function Cuenta({ irA }: { irA?: (p: PestanaAviso) => void }) {
  const sesion = useSesion()
  const sync = useEstadoSync()
  const pendientes = useLiveQuery(() => db.cola.count(), []) ?? 0
  const problemas = useLiveQuery(() => db.problemas.filter((p) => !p.visto).toArray(), []) ?? []
  const [cambiando, setCambiando] = useState(false)
  const [ayuda, setAyuda] = useState(false)
  const novedades = useHayNovedades('app')
  const [privacidad, setPrivacidad] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  const [aMano, setAMano] = useState(false) // sólo lo que pidió la persona gira; lo automático pasa en silencio
  const enVivo = useEnVivoConectado()
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

      <div className="mt-4 flex items-center gap-3 border-y border-linea py-4">
        <FotoPerfil tamano="h-12 w-12 text-lg" compacto />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{u.nombre}</div>
          <div className="truncate text-sm text-apagado">{u.correo}</div>
        </div>
        <span className="flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-semibold"><ShieldCheck size={14} />{ROL[u.rol]}</span>
      </div>

      {MODO_SERVIDOR && reparte() && <MiDia />}

      <div className="mt-6 border-t border-linea pt-4">
        <div className="flex items-center gap-2 font-semibold">
          {sync.error ? <CloudOff size={18} className="text-ambar" /> : <RefreshCw size={18} className={aMano ? 'animate-spin' : ''} />}
          Sincronización
        </div>
        <p className="mt-1 text-sm text-apagado">
          {sync.error ?? (!sync.ultimaOk ? 'Pendiente de la primera sincronización' : enVivo ? 'Los cambios llegan solos.' : `Última vez ${hace(sync.ultimaOk)}`)}
        </p>
        <p className="mt-0.5 text-sm text-apagado">
          {pendientes ? `${pendientes} ${pendientes === 1 ? 'cambio' : 'cambios'} por enviar` : 'Nada pendiente por enviar'}
        </p>
        <Boton variante="secundario" className="mt-3 w-full bg-white" onClick={() => { setAMano(true); void sincronizar().finally(() => setAMano(false)) }} disabled={aMano}>Sincronizar ahora</Boton>
      </div>

      <DosPasos />
      <Avisos irA={irA} />
      <Notificaciones />

      {problemas.length > 0 && (
        <div className="mt-3 rounded-lg bg-ambar/20 p-4">
          <div className="flex items-center gap-2 font-semibold"><TriangleAlert size={18} />Cambios que no se aplicaron</div>
          <ul className="mt-2 space-y-2">
            {problemas.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                <span className="flex-1">{p.mensaje}</span>
                <button className="shrink-0 rounded-md bg-white px-3 py-1 text-xs font-semibold" onClick={() => db.problemas.update(p.id, { visto: true })}>Entendido</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button onClick={() => setAyuda(true)} className="mt-6 flex w-full items-center gap-3 border-y border-linea py-4 text-left active:bg-niebla">
        <LifeBuoy size={20} className="shrink-0" />
        <span className="min-w-0 flex-1"><span className="flex items-center gap-2 font-semibold">Ayuda{novedades && <span className="rounded-full bg-marca px-2 py-0.5 text-[11px] font-semibold text-white">Nuevo</span>}</span><span className="block text-sm text-apagado">{novedades ? 'Hay cosas nuevas en la app: míralas aquí.' : 'Guías paso a paso: pedidos, entregas, clientes…'}</span></span>
        <ChevronRight size={18} className="shrink-0 text-apagado" />
      </button>

      {MODO_SERVIDOR && (
        <button onClick={() => setPrivacidad(true)} className="mt-6 flex w-full items-center gap-3 border-y border-linea py-4 text-left active:bg-niebla">
          <LockKeyhole size={20} className="shrink-0" />
          <span className="min-w-0 flex-1"><span className="block font-semibold">Privacidad y datos</span><span className="block text-sm text-apagado">Descargar tus datos, eliminar tu cuenta, aviso de privacidad</span></span>
          <ChevronRight size={18} className="shrink-0 text-apagado" />
        </button>
      )}

      <div className="mt-3 space-y-2">
        <Boton variante="secundario" className="w-full" onClick={() => setCambiando(true)}>Cambiar contraseña</Boton>
        <Boton variante="peligro" className="w-full" onClick={() => void salir()} disabled={saliendo}><LogOut size={18} />{saliendo ? 'Cerrando…' : 'Cerrar sesión'}</Boton>
        {pendientes > 0 && <p className="px-1 text-xs text-apagado">Los cambios por enviar se guardan en este teléfono y salen cuando vuelvas a entrar con esta cuenta.</p>}
      </div>

      <Hoja abierta={ayuda} onCerrar={() => setAyuda(false)} titulo="Ayuda" alto>
        <div className="pb-6"><Ayuda donde="app" /></div>
      </Hoja>

      <Hoja abierta={privacidad} onCerrar={() => setPrivacidad(false)} titulo="Privacidad y datos" alto>
        <div className="pb-6"><PrivacidadYDatos /></div>
      </Hoja>

      <Hoja abierta={cambiando} onCerrar={() => setCambiando(false)} titulo="Cambiar contraseña">
        <div className="pb-4"><FormPassword onListo={() => setCambiando(false)} /></div>
      </Hoja>
    </div>
  )
}
