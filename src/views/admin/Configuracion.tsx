import { useEffect, useState, type ReactNode } from 'react'
import { CreditCard, KeyRound, LifeBuoy, Monitor, Moon, Palette, ShieldCheck, Sun, SwatchBook, UserRound } from 'lucide-react'
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
import { Ayuda } from '../ayuda/Ayuda'

// Configuración del panel, en apartados con su menú al lado (arriba en el teléfono): la cuenta (perfil y actividad), su
// seguridad (contraseña, dos pasos, sesiones abiertas), la marca de la empresa, la suscripción y la apariencia (de este
// navegador). En la computadora el título y el menú quedan fijos y sólo se desplaza el apartado (AdminLayout).
// El panel de la plataforma la usa con `plataforma`: sin marca ni suscripción (sus cuentas no tienen negocio) y con sus
// propios apartados en `extra`.

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Sin conexión con el servidor')
const fechaHora = (s: string | null) => (s ? new Date(s).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

export type ApartadoConfig = 'cuenta' | 'seguridad' | 'marca' | 'suscripcion' | 'apariencia' | 'ayuda'
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
    { id: 'apariencia', texto: 'Apariencia', ayuda: 'Tema, texto y movimiento', icono: Palette },
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
            <MarcaEmpresa />
          )}
          {visible === 'suscripcion' && suscripcion && (
            <Seccion id="suscripcion" titulo="Suscripción" descripcion="El plan de tu empresa. El pago y la tarjeta los maneja Mercado Pago.">
              <SeccionSuscripcion s={suscripcion} />
            </Seccion>
          )}
          {visible === 'apariencia' && <Apariencia />}
          {visible === 'ayuda' && (
            <Seccion id="ayuda" titulo="Ayuda" descripcion="Guías cortas de lo que más se hace, con lo que hay que tocar resaltado. Sólo ves lo que tu cuenta puede hacer.">
              <Ayuda donde="panel" ir={(d) => (menu.some((m) => m.id === d) ? elegir(d) : irA?.(d))} />
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

    </>
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

function Apariencia() {
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
    </>
  )
}
