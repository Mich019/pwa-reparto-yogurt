import { useEffect, useState, type ReactNode } from 'react'
import { Bell, BellRing, CreditCard, GripVertical, KeyRound, LifeBuoy, LockKeyhole, Monitor, Moon, Palette, ShieldCheck, Sun, SwatchBook, UserRound } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { guardarPerfil, llamarAutenticado, useSesion } from '../../lib/sesion'
import { cambiarPreferencias, cambiarTema, usePreferenciasPanel, usePreferenciaTema, type PreferenciaTema, type TamanoTexto } from '../../lib/tema'
import { aviso, claseInputRecto } from '../../components/ui'
import { FotoPerfil } from '../../components/Avatar'
import { FormPassword } from '../pwa/Cuenta'
import { DosPasos } from '../pwa/DosPasos'
import { useSuscripcion } from '../../lib/suscripcion'
import { SeccionSuscripcion } from './Suscripcion'
import { MarcaEmpresa } from './MarcaEmpresa'
import { ZonaEmpresa } from './ZonaEmpresa'
import { Ayuda } from '../ayuda/Ayuda'
import { PrivacidadYDatos } from '../legal/PrivacidadYDatos'
import { activarPush, desactivarPush, enviarPrueba, useEstadoPush } from '../../lib/push'
import { guardarOrdenMenu, useMenu, type SeccionAdmin } from './menu'

// Configuración del panel, en apartados con su menú al lado (arriba en el teléfono): la cuenta (perfil y actividad), su
// seguridad (contraseña, dos pasos, sesiones abiertas), la marca de la empresa, la suscripción y la apariencia (de este
// navegador). En la computadora el título y el menú quedan fijos y sólo se desplaza el apartado (AdminLayout).
// El panel de la plataforma la usa con `plataforma`: sin marca ni suscripción (sus cuentas no tienen negocio) y con sus
// propios apartados en `extra`.

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Sin conexión con el servidor')
const fechaHora = (s: string | null) => (s ? new Date(s).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

// Secciones del panel a las que puede llevar el «Ir a…» de una guía (las demás son apartados de aquí).
const SECCIONES_PANEL = ['resumen', 'equipo', 'clientes', 'produccion', 'sabores', 'reportes']

export type ApartadoConfig = 'cuenta' | 'seguridad' | 'marca' | 'suscripcion' | 'privacidad' | 'apariencia' | 'ayuda'
export interface ApartadoExtra { id: string; texto: string; ayuda: string; icono: typeof Sun; contenido: ReactNode }

const TEMAS: { valor: PreferenciaTema; texto: string; ayuda: string; icono: typeof Sun }[] = [
  { valor: 'claro', texto: 'Claro', ayuda: 'Crema, el de siempre', icono: Sun },
  { valor: 'oscuro', texto: 'Oscuro', ayuda: 'Descansa la vista de noche', icono: Moon },
  { valor: 'sistema', texto: 'Automático', ayuda: 'Igual que tu computadora o teléfono', icono: Monitor },
]
const TAMANOS: { valor: TamanoTexto; texto: string; muestra: string }[] = [
  { valor: 'normal', texto: 'Normal', muestra: 'text-base' },
  { valor: 'grande', texto: 'Grande', muestra: 'text-lg' },
  { valor: 'mas-grande', texto: 'Más grande', muestra: 'text-xl' },
]

// `acciones` (Guardar, Deshacer…) van a la derecha del título, que se queda fijo arriba al desplazarse: siempre a mano.
export function Seccion({ id, titulo, descripcion, acciones, children }: { id: string; titulo: string; descripcion?: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-linea pt-7 first:border-t-0 first:pt-0">
      <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${acciones ? 'sticky top-0 z-10 -mx-2 bg-[var(--color-lienzo)] px-2 py-2' : ''}`}>
        <h2 id={id} className="text-xl font-semibold">{titulo}</h2>
        {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
      </div>
      {descripcion && <p className="mt-1 text-sm text-apagado">{descripcion}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

// Una opción con su explicación a la izquierda y el control a la derecha.
export function Fila({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-linea py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0 max-w-md">
        <div className="text-sm font-semibold">{titulo}</div>
        <div className="mt-0.5 text-xs text-apagado">{ayuda}</div>
      </div>
      {children}
    </div>
  )
}

// Muestra en miniatura de cada tema: fondo, una tarjeta y un botón.
function Muestra({ valor }: { valor: PreferenciaTema }) {
  const claro = <span className="flex h-full flex-1 flex-col gap-1.5 bg-[#f8f6ec] p-2"><span className="h-3 w-3/4 rounded bg-[#ecebd8]" /><span className="h-3 w-1/2 rounded-full bg-[#035d38]" /></span>
  const oscuro = <span className="flex h-full flex-1 flex-col gap-1.5 bg-[#0e1611] p-2"><span className="h-3 w-3/4 rounded bg-[#212c24]" /><span className="h-3 w-1/2 rounded-full bg-[#0f7a47]" /></span>
  return (
    <span aria-hidden="true" className="flex h-16 w-full overflow-hidden rounded-md border border-linea">
      {valor === 'claro' ? claro : valor === 'oscuro' ? oscuro : <>{claro}{oscuro}</>}
    </span>
  )
}

// `irA`: abre otra sección del panel (el «Ir a…» de las guías de Ayuda).
export function Configuracion({ inicial = 'cuenta', plataforma = false, extra = [], irA }: { inicial?: ApartadoConfig; plataforma?: boolean; extra?: ApartadoExtra[]; irA?: (seccion: string) => void }) {
  const u = useSesion()?.usuario
  const suscripcion = useSuscripcion(plataforma ? undefined : u?.id)
  const [apartado, setApartado] = useState<string>(inicial)

  const menu: { id: string; texto: string; ayuda: string; icono: typeof Sun }[] = [
    { id: 'cuenta', texto: 'Cuenta', ayuda: 'Tu perfil y tu actividad', icono: UserRound },
    { id: 'seguridad', texto: 'Seguridad', ayuda: 'Contraseña y sesiones', icono: ShieldCheck },
    ...(plataforma ? [] : [{ id: 'marca', texto: 'Marca', ayuda: 'Nombre, logo y color', icono: SwatchBook }]),
    ...(suscripcion && !plataforma ? [{ id: 'suscripcion', texto: 'Suscripción', ayuda: 'Tu plan y el pago', icono: CreditCard }] : []),
    ...extra,
    { id: 'privacidad', texto: 'Privacidad y datos', ayuda: 'Descargar, eliminar, avisos', icono: LockKeyhole },
    { id: 'apariencia', texto: 'Apariencia', ayuda: plataforma ? 'Tema, texto y movimiento' : 'Tema, texto y orden del menú', icono: Palette },
    ...(plataforma ? [] : [{ id: 'ayuda', texto: 'Ayuda', ayuda: 'Guías paso a paso', icono: LifeBuoy }]),
  ]
  const visible = menu.some((m) => m.id === apartado) ? apartado : 'cuenta'
  const elegir = (id: string) => {
    setApartado(id)
    document.getElementById('apartado-config')?.scrollTo({ top: 0 })
  }

  return (
    <div className="mx-auto max-w-[1280px] 2xl:max-w-[1600px] px-4 pt-2 sm:px-8 lg:flex lg:h-full lg:flex-col">
      <header className="pb-6 pt-4 lg:shrink-0">
        <h1 className="text-[2.5rem] font-semibold leading-none lg:text-[3.25rem]">Configuración</h1>
        <p className="mt-3 text-sm text-apagado">{plataforma ? 'Tu cuenta y su seguridad, cómo está configurado el servicio y cómo se ve el panel.' : 'Tu cuenta y su seguridad, la marca de tu negocio, tu plan, cómo se ve el panel y la ayuda.'}</p>
      </header>

      <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Apartados de la configuración" className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:mb-0 lg:flex-col lg:self-start lg:overflow-visible">
          {menu.map(({ id, texto, ayuda, icono: Icono }) => {
            const elegido = visible === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => elegir(id)}
                aria-current={elegido ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-4 py-2.5 text-left transition-colors lg:py-3 ${anillo} ${elegido ? 'bg-tinta text-white' : 'bg-niebla hover:bg-linea/60 lg:bg-transparent lg:hover:bg-niebla'}`}
              >
                <Icono size={18} aria-hidden="true" className="shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{texto}</span>
                  <span className={`hidden text-xs lg:block ${elegido ? 'text-white/70' : 'text-apagado'}`}>{ayuda}</span>
                </span>
              </button>
            )
          })}
        </nav>

        {/* Lo único que se desplaza en la computadora; el margen deja ver completo el anillo de foco. */}
        <div id="apartado-config" className="min-w-0 space-y-7 lg:-mx-2 lg:overflow-y-auto lg:px-2 lg:pb-12">
          {visible === 'cuenta' && <Cuenta plataforma={plataforma} />}
          {visible === 'seguridad' && <Seguridad plataforma={plataforma} />}
          {extra.find((x) => x.id === visible)?.contenido}
          {visible === 'marca' && (
            <>
              <MarcaEmpresa />
              <ZonaEmpresa />
            </>
          )}
          {visible === 'suscripcion' && suscripcion && (
            <Seccion id="suscripcion" titulo="Suscripción" descripcion="El plan de tu empresa. El pago y la tarjeta los maneja Mercado Pago.">
              <SeccionSuscripcion s={suscripcion} />
            </Seccion>
          )}
          {visible === 'privacidad' && (
            <Seccion id="privacidad" titulo="Privacidad y datos" descripcion={plataforma ? 'Tus datos de esta cuenta y los documentos del servicio.' : 'Tus derechos sobre tus datos (ARCO): verlos, descargarlos y eliminarlos, sin pedírselo a nadie.'}>
              <PrivacidadYDatos plataforma={plataforma} />
            </Seccion>
          )}
          {visible === 'apariencia' && <Apariencia plataforma={plataforma} />}
          {visible === 'ayuda' && (
            <Seccion id="ayuda" titulo="Ayuda" descripcion="Guías cortas de lo que más se hace, con lo que hay que tocar resaltado. Sólo ves lo que tu cuenta puede hacer.">
              <Ayuda donde="panel" ir={(d) => (menu.some((m) => m.id === d) ? elegir(d) : SECCIONES_PANEL.includes(d) && irA?.(d))} />
            </Seccion>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------- cuenta

interface Yo { nombre: string; telefono: string; empresa: string; alta: string; ultimoAcceso: string | null }

function Cuenta({ plataforma }: { plataforma: boolean }) {
  const u = useSesion()?.usuario
  const [yo, setYo] = useState<Yo | null>(null)
  const [nombre, setNombre] = useState(u?.nombre ?? '')
  const [telefono, setTelefono] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  // El teléfono y las fechas no viajan en la sesión: se piden al abrir.
  useEffect(() => {
    llamarAutenticado<Yo>('/me')
      .then((r) => { setYo(r); setNombre(r.nombre); setTelefono(r.telefono) })
      .catch(() => {})
  }, [])

  const cambios = !!yo && (nombre.trim() !== yo.nombre || telefono.trim() !== yo.telefono)
  async function guardar() {
    setGuardando(true)
    setError('')
    try {
      const r = await guardarPerfil({ nombre: nombre.trim(), telefono: telefono.trim() })
      setYo((y) => y && { ...y, ...r })
      setNombre(r.nombre)
      setTelefono(r.telefono)
      aviso('Perfil guardado')
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }

  if (!u) return null
  return (
    <>
      <Seccion id="perfil" titulo="Perfil" acciones={
        <button type="submit" form="form-perfil" disabled={!cambios || nombre.trim().length < 2 || guardando} className={`rounded-md bg-tinta px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-marca-oscuro disabled:opacity-40 ${anillo}`}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      } descripcion={plataforma ? 'Tu foto, tu nombre y tu teléfono, como los ven las demás cuentas de la plataforma.' : 'Así te ven tu equipo y los avisos de la app: tu foto, tu nombre y tu teléfono.'}>
        <FotoPerfil />
        <form id="form-perfil" onSubmit={(e) => { e.preventDefault(); if (cambios) void guardar() }} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-apagado">Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={claseInputRecto} maxLength={100} autoComplete="name" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-apagado">Teléfono</span>
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={claseInputRecto} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="Opcional" />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-apagado">Correo</span>
            <input value={u.correo} readOnly className={`${claseInputRecto} cursor-default opacity-70`} />
            <span className="mt-1.5 block text-xs text-apagado">{plataforma ? 'Es con lo que entras al panel de la plataforma.' : 'Es con lo que entras. Si necesitas cambiarlo, otro administrador lo hace desde Vendedores.'}</span>
          </label>
          {error && <p role="alert" className="text-sm font-medium text-rojo sm:col-span-2">{error}</p>}
        </form>
      </Seccion>

      <Seccion id="actividad" titulo="Tu actividad">
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-apagado">Rol</dt><dd className="mt-0.5 inline-flex items-center gap-1 font-semibold"><ShieldCheck size={14} aria-hidden="true" />{plataforma ? 'Plataforma' : u.rol === 'administrador' ? 'Administrador' : 'Vendedor'}</dd></div>
          <div><dt className="text-xs text-apagado">{plataforma ? 'Acceso' : 'Empresa'}</dt><dd className="mt-0.5 font-semibold">{plataforma ? 'Todas las empresas' : yo?.empresa ?? '—'}</dd></div>
          <div><dt className="text-xs text-apagado">Miembro desde</dt><dd className="mt-0.5 font-semibold">{yo ? new Date(yo.alta).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</dd></div>
          <div><dt className="text-xs text-apagado">Último acceso</dt><dd className="mt-0.5 font-semibold">{fechaHora(yo?.ultimoAcceso ?? null)}</dd></div>
        </dl>
      </Seccion>

      {!plataforma && u.rol === 'administrador' && <><AvisosPush /><QueAvisos /></>}

    </>
  )
}

// Avisos push en esta computadora o teléfono, sin abrir la app de reparto (lib/push.ts, el mismo service worker). Al
// administrador le llegan: un vendedor entregó su corte, un corte confirmado dejó de cuadrar y la prueba gratis por vencer.
function AvisosPush() {
  const { estado, refrescar } = useEstadoPush()
  const [ocupado, setOcupado] = useState(false)
  async function accion(f: () => Promise<string>) {
    setOcupado(true)
    try { aviso(await f()) } catch (e) { aviso(e instanceof Error ? e.message : mensaje(e)) } finally { setOcupado(false); void refrescar() }
  }
  const activar = () => accion(async () => ((await activarPush()) === 'push'
    ? 'Avisos activados en este dispositivo'
    : 'El servidor aún no tiene avisos push configurados: por ahora los cortes que no cuadran se ven en Cobranza → Cortes.'))
  const probar = () => accion(async () => {
    const r = await enviarPrueba()
    return r.dispositivos ? `Prueba enviada a ${r.enviados} de ${r.dispositivos} ${r.dispositivos === 1 ? 'dispositivo' : 'dispositivos'}` : 'Este dispositivo aún no está suscrito'
  })
  const apagar = () => accion(async () => { await desactivarPush(); return 'Este dispositivo ya no recibirá avisos' })

  const activo = !!estado?.suscrito && estado.permiso === 'granted'
  const puede = !!estado?.soportado && estado.permiso !== 'denied'
  let texto = 'Revisando…'
  if (estado) {
    if (!estado.soportado) texto = estado.motivo ?? 'Este navegador no puede recibir notificaciones.'
    else if (estado.permiso === 'denied') texto = 'Bloqueaste las notificaciones de este sitio. Actívalas en los ajustes del navegador (el candado junto a la dirección).'
    else if (activo) texto = 'Recibes los avisos aquí aunque el panel esté cerrado.'
    else if (estado.servidor === false) texto = 'El servidor aún no tiene avisos push configurados.'
    else texto = 'Actívalos para enterarte aunque no tengas el panel abierto: cuando un vendedor entrega su corte, cuando uno confirmado deja de cuadrar y cuando tu prueba gratis está por vencer.'
  }
  const boton = `rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 ${anillo}`
  return (
    <Seccion id="avisos" titulo="Avisos en este dispositivo" descripcion="Cada computadora o teléfono se activa por separado.">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex max-w-lg items-center gap-3 text-sm">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-niebla" aria-hidden="true">{activo ? <BellRing size={18} /> : <Bell size={18} />}</span>
          <span>{texto}</span>
        </div>
        {puede && estado?.servidor !== false && (
          <div className="flex flex-wrap gap-2">
            {activo ? (
              <>
                <button type="button" onClick={() => void probar()} disabled={ocupado} className={`${boton} bg-niebla hover:bg-linea`}>Enviar prueba</button>
                <button type="button" onClick={() => void apagar()} disabled={ocupado} className={`${boton} bg-niebla hover:bg-linea`}>Desactivar</button>
              </>
            ) : (
              <button type="button" onClick={() => void activar()} disabled={ocupado} className={`${boton} bg-tinta text-white hover:bg-marca-oscuro`}>Activar avisos</button>
            )}
          </div>
        )}
      </div>
    </Seccion>
  )
}

// Qué avisos quiere cada administrador. Vale para su cuenta (en todos sus dispositivos) y para la lista de avisos de la
// app: uno apagado no se guarda ni se manda. Los nombres van como en notificaciones.ts (AVISOS_ELEGIBLES).
const TIPOS_AVISO = [
  { tipo: 'corte_entregado', titulo: 'Corte por confirmar', ayuda: 'Un vendedor entregó o corrigió su corte del día.' },
  { tipo: 'corte_descuadrado', titulo: 'Corte que ya no cuadra', ayuda: 'Llegó una venta en efectivo de un día con el corte ya confirmado.' },
  { tipo: 'prueba_por_vencer', titulo: 'Prueba gratis por vencer', ayuda: 'Unos días antes y el último día de la prueba.' },
] as const

function QueAvisos() {
  const [apagados, setApagados] = useState<string[] | null>(null)
  useEffect(() => { llamarAutenticado<{ avisosApagados?: string[] }>('/me').then((r) => setApagados(r.avisosApagados ?? [])).catch(() => setApagados([])) }, [])
  async function cambiar(tipo: string, encendido: boolean) {
    if (!apagados) return
    const antes = apagados
    const nuevos = encendido ? apagados.filter((t) => t !== tipo) : [...apagados, tipo]
    setApagados(nuevos)
    try {
      await guardarPerfil({ avisosApagados: nuevos })
    } catch (e) {
      setApagados(antes)
      aviso(mensaje(e))
    }
  }
  return (
    <Seccion id="que-avisos" titulo="Qué avisos recibes" descripcion="Se guarda en tu cuenta: vale en todos tus dispositivos.">
      {TIPOS_AVISO.map(({ tipo, titulo, ayuda }) => (
        <Fila key={tipo} titulo={titulo} ayuda={ayuda}>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" role="switch" checked={!!apagados && !apagados.includes(tipo)} disabled={!apagados} onChange={(e) => void cambiar(tipo, e.target.checked)} className="peer sr-only" aria-label={titulo} />
            <span className="h-7 w-12 rounded-full bg-linea transition-colors peer-checked:bg-marca peer-disabled:opacity-40 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marca" />
            <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-papel shadow transition-transform peer-checked:translate-x-5" />
          </label>
        </Fila>
      ))}
    </Seccion>
  )
}

// ---------------------------------------------------------------------------------------------------------- seguridad

interface SesionAbierta { id: string; actual: boolean; ip: string | null; inicio: string; vence: string }

function Seguridad({ plataforma }: { plataforma: boolean }) {
  // El formulario de la contraseña sólo se abre al pedirlo, y se cierra (y se vacía) al terminar o cancelar.
  const [cambiando, setCambiando] = useState(false)
  const [cambiada, setCambiada] = useState<string | null>(null)
  useEffect(() => { llamarAutenticado<{ passwordCambiado: string }>('/me').then((r) => setCambiada(r.passwordCambiado)).catch(() => {}) }, [])
  const [sesiones, setSesiones] = useState<SesionAbierta[] | null>(null)
  const [cerrando, setCerrando] = useState<string | null>(null)

  const cargar = () => llamarAutenticado<SesionAbierta[]>('/me/sesiones').then(setSesiones).catch(() => setSesiones([]))
  useEffect(() => { void cargar() }, [])

  async function cerrar(id?: string) {
    setCerrando(id ?? 'todas')
    try {
      const r = await llamarAutenticado<{ cerradas: number }>('/me/sesiones/cerrar', { metodo: 'POST', cuerpo: id ? { id } : {} })
      aviso(r.cerradas === 1 ? 'Sesión cerrada' : `${r.cerradas} sesiones cerradas`)
      await cargar()
    } catch (e) {
      aviso(mensaje(e))
    } finally {
      setCerrando(null)
    }
  }
  const otras = sesiones?.filter((s) => !s.actual).length ?? 0

  return (
    <>
      <Seccion id="contrasena" titulo="Contraseña" descripcion="Al cambiarla se cierran tus sesiones en los demás dispositivos.">
        {cambiando ? (
          <div className="max-w-md">
            <FormPassword onListo={() => { aviso('Contraseña cambiada'); setCambiando(false); setCambiada(new Date().toISOString()); void cargar() }} />
            <button type="button" onClick={() => setCambiando(false)} className={`mt-1 w-full rounded-md py-3 text-sm font-semibold text-apagado transition-colors hover:bg-niebla hover:text-tinta ${anillo}`}>Cancelar</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-niebla" aria-hidden="true"><KeyRound size={18} /></span>
              <div>
                <div className="font-semibold tracking-[0.3em]" aria-label="Contraseña oculta">••••••••••</div>
                <div className="text-xs text-apagado">{cambiada ? `Último cambio: ${fechaHora(cambiada)}` : 'Protegida'}</div>
              </div>
            </div>
            <button type="button" onClick={() => setCambiando(true)} className={`rounded-md bg-niebla px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-linea ${anillo}`}>Cambiar contraseña</button>
          </div>
        )}
      </Seccion>
      <Seccion id="dos-pasos" titulo="Inicio de sesión" descripcion={plataforma ? 'Obligatoria para entrar al panel de la plataforma: sin ella sólo ves esta configuración.' : 'Protege la cuenta aunque alguien conozca tu contraseña.'}>
        {/* DosPasos trae su propia tarjeta; aquí sólo se le quita el margen de arriba. */}
        <div className="-mt-3"><DosPasos /></div>
      </Seccion>
      <Seccion id="sesiones" titulo="Sesiones abiertas" descripcion="Dónde está abierta tu cuenta ahora. Si no reconoces una, ciérrala y cambia tu contraseña.">
        {!sesiones ? <p className="text-sm text-apagado">Cargando…</p> : (
          <>
            <ul className="divide-y divide-linea">
              {sesiones.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0 text-sm">
                    <div className="flex items-center gap-2 font-semibold">
                      {s.actual ? 'Este navegador' : 'Otro dispositivo'}
                      {s.actual && <span className="rounded-md bg-niebla px-2 py-0.5 text-[11px] font-semibold">Aquí estás</span>}
                    </div>
                    <div className="text-xs text-apagado">Desde el {fechaHora(s.inicio)}{s.ip ? ` · IP ${s.ip}` : ''}</div>
                  </div>
                  {!s.actual && (
                    <button type="button" onClick={() => void cerrar(s.id)} disabled={!!cerrando} className={`rounded-md px-3 py-1.5 text-sm font-semibold text-rojo transition-colors hover:bg-rojo/10 disabled:opacity-40 ${anillo}`}>
                      {cerrando === s.id ? 'Cerrando…' : 'Cerrar'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {otras > 1 && (
              <button type="button" onClick={() => void cerrar()} disabled={!!cerrando} className={`mt-4 rounded-md bg-niebla px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-linea disabled:opacity-40 ${anillo}`}>
                {cerrando === 'todas' ? 'Cerrando…' : `Cerrar las otras ${otras}`}
              </button>
            )}
          </>
        )}
      </Seccion>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------- apariencia

function Apariencia({ plataforma }: { plataforma: boolean }) {
  const tema = usePreferenciaTema()
  const p = usePreferenciasPanel()
  return (
    <>
      <Seccion id="tema" titulo="Tema" descripcion="Se guarda en este navegador, igual que lo de abajo: cada computadora o teléfono puede tener el suyo.">
        <div role="radiogroup" aria-label="Tema del panel" className="grid gap-3 sm:grid-cols-3">
          {TEMAS.map(({ valor, texto, ayuda, icono: Icono }) => {
            const elegido = tema === valor
            return (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={elegido}
                onClick={() => cambiarTema(valor)}
                className={`flex flex-col gap-3 rounded-lg p-3 text-left transition-colors ${anillo} ${elegido ? 'bg-papel ring-2 ring-marca' : 'bg-niebla hover:bg-linea/60'}`}
              >
                <Muestra valor={valor} />
                <span className="flex items-center gap-2 px-1">
                  <Icono size={18} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{texto}</span>
                    <span className="block text-xs text-apagado">{ayuda}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </Seccion>

      <Seccion id="lectura" titulo="Lectura y movimiento">
        <Fila titulo="Tamaño del texto" ayuda="Agranda letras, botones y tablas del panel.">
          <div role="radiogroup" aria-label="Tamaño del texto" className="flex gap-1.5">
            {TAMANOS.map(({ valor, texto, muestra }) => (
              <button key={valor} type="button" role="radio" aria-checked={p.texto === valor} onClick={() => cambiarPreferencias({ texto: valor })}
                className={`flex items-baseline gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${anillo} ${p.texto === valor ? 'bg-tinta text-white' : 'bg-niebla hover:bg-linea'}`}>
                <span className={`${muestra} leading-none`} aria-hidden="true">A</span>{texto}
              </button>
            ))}
          </div>
        </Fila>
        <Fila titulo="Menos movimiento" ayuda="Quita animaciones y transiciones al abrir y cambiar de pantalla.">
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" role="switch" checked={p.menosMovimiento} onChange={(e) => cambiarPreferencias({ menosMovimiento: e.target.checked })} className="peer sr-only" aria-label="Menos movimiento" />
            <span className="h-7 w-12 rounded-full bg-linea transition-colors peer-checked:bg-marca peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marca" />
            <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-papel shadow transition-transform peer-checked:translate-x-5" />
          </label>
        </Fila>
      </Seccion>

      {!plataforma && <OrdenMenu />}
    </>
  )
}

// El orden de las secciones del menú del panel (arriba en la computadora, la barra de abajo en el teléfono): se
// arrastran. Con el ratón, desde cualquier parte de la fila; con el dedo, desde la agarradera (así la lista no estorba
// para desplazar la página). Con el teclado: enfocar la agarradera y mover con ↑ ↓.
function OrdenMenu() {
  const menu = useMenu().filter((m) => m.id !== 'configuracion')
  const propio = usePreferenciasPanel().ordenMenu.length > 0
  const [arrastre, setArrastre] = useState<{ id: SeccionAdmin; desde: number; y0: number; dy: number; alto: number } | null>(null)
  const ids = menu.map((m) => m.id)

  // Mientras se arrastra, las filas no cambian de lugar en la página (moverlas soltaría el puntero): se desplazan con
  // transform, la arrastrada siguiendo al puntero y las demás haciéndole hueco donde caería.
  const destino = arrastre ? Math.max(0, Math.min(ids.length - 1, arrastre.desde + Math.round(arrastre.dy / arrastre.alto))) : -1
  const orden = arrastre ? (() => { const o = ids.filter((x) => x !== arrastre.id); o.splice(destino, 0, arrastre.id); return o })() : ids
  const guardar = (o: SeccionAdmin[]) => {
    if (o.join() !== ids.join() || !o.length) guardarOrdenMenu(o).catch(() => aviso('No se guardó en tu cuenta: queda sólo en este navegador'))
  }

  function empezar(e: React.PointerEvent<HTMLLIElement>, id: SeccionAdmin) {
    if (e.button !== 0) return
    if (e.pointerType !== 'mouse' && !(e.target as HTMLElement).closest('[data-agarradera]')) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setArrastre({ id, desde: ids.indexOf(id), y0: e.clientY, dy: 0, alto: e.currentTarget.offsetHeight })
  }
  const mover = (e: React.PointerEvent) => { if (arrastre) setArrastre({ ...arrastre, dy: e.clientY - arrastre.y0 }) }
  const soltar = () => { if (arrastre) { guardar(orden); setArrastre(null) } }

  function teclado(e: React.KeyboardEvent, i: number) {
    const paso = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!paso || i + paso < 0 || i + paso >= ids.length) return
    e.preventDefault()
    const o = [...ids]
    ;[o[i], o[i + paso]] = [o[i + paso], o[i]]
    guardar(o)
    requestAnimationFrame(() => document.getElementById(`agarrar-${o[i + paso]}`)?.focus())
  }

  return (
    <Seccion id="orden-menu" titulo="Orden del menú" descripcion="Arrastra las secciones para poner primero lo que más usas. Se guarda en tu cuenta: lo ves igual en cualquier computadora. Configuración siempre va al final."
      acciones={propio && <button type="button" onClick={() => guardar([])} className={`rounded-md bg-niebla px-4 py-2 text-sm font-semibold transition-colors hover:bg-linea ${anillo}`}>Restablecer</button>}>
      <ol className="max-w-md select-none" aria-label="Orden del menú">
        {menu.map(({ id, texto, icono: Icono }, k) => {
          const i = orden.indexOf(id)
          const activa = arrastre?.id === id
          const desplazo = !arrastre ? 0 : activa ? arrastre.dy : (i - k) * arrastre.alto
          return (
            <li key={id} onPointerDown={(e) => empezar(e, id)} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
              style={desplazo ? { transform: `translateY(${desplazo}px)` } : undefined}
              className={`relative flex items-center gap-3 border-t border-linea py-2 first:border-t-0 md:cursor-grab ${activa ? 'z-10 cursor-grabbing rounded-md border-transparent bg-papel shadow-[0_8px_24px_rgba(0,32,20,0.18)]' : 'bg-[var(--color-lienzo)] transition-transform duration-150'}`}>
              <button type="button" id={`agarrar-${id}`} data-agarradera aria-label={`Mover ${texto}, posición ${i + 1} de ${orden.length}. Usa las flechas arriba y abajo.`}
                onKeyDown={(e) => teclado(e, i)}
                className={`grid h-9 w-9 shrink-0 touch-none place-items-center rounded-md text-apagado hover:bg-niebla hover:text-tinta ${anillo}`}>
                <GripVertical size={18} aria-hidden="true" />
              </button>
              <span className="w-5 text-right text-sm tabular-nums text-apagado">{i + 1}</span>
              <Icono size={18} aria-hidden="true" />
              <span className="flex-1 text-sm font-semibold">{texto}</span>
            </li>
          )
        })}
      </ol>
    </Seccion>
  )
}
