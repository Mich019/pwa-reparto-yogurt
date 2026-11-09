import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Resaltar } from '../../components/Busqueda'
import { coincide, limpiarBusqueda, propsBuscador } from '../../lib/busqueda'
import { Selector } from '../../components/Selector'
import { ArrowDownUp, ArrowLeft, Building2, CalendarDays, Check, ChevronRight, CircleAlert, Copy, Info, LayoutDashboard, LogOut, Mail, Megaphone, RefreshCw, Search, Server, Settings, ShieldCheck, SlidersHorizontal, Store } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { usePaginas } from '../../components/Paginas'
import { desdeIso, dinero, hoy as hoyLocal } from '../../lib/fechas'
import { copiarDelicado } from '../../lib/portapapeles'
import { cerrarSesion, llamarAutenticado, refrescarPerfil, useSesion } from '../../lib/sesion'
import { useAplicarPreferencias } from '../../lib/tema'
import { Avatar } from '../../components/Avatar'
import { aviso, claseInputRecto } from '../../components/ui'
import { SelectorFecha } from '../../components/Calendario'
import { Configuracion, Fila, Seccion } from './Configuracion'
import { BarraSegmentada, BarrasPeriodo } from './graficas'
import { LogoDelisy } from './marca'

// Panel de la plataforma (/plataforma, api/_lib/plataforma.ts): para quienes administran Delisy. Un tablero con menú
// lateral: el resumen de la plataforma, las empresas con su detalle y sus ajustes, el alta de empresas, las cuentas de
// la plataforma, los avisos para las empresas y la configuración (la de Configuracion.tsx: cuenta, seguridad y
// apariencia, más los ajustes de la plataforma y el estado del servicio).
// Todo en páginas, sin ventanas encima; las secciones se separan con líneas finas, no con tarjetas.
//
// Gráficos de graficas.tsx (skill dataviz) con los colores de Delisy: la serie en su azul marino y el periodo en curso
// en su coral (bajo 3:1: lleva su valor escrito, tooltip y tabla). Los estados usan una paleta categórica validada con
// el script de la skill (azul, naranja, aqua, amarillo, magenta) y siempre van con su nombre, nunca sólo el color.

type Estado = 'prueba' | 'activa' | 'vencida' | 'cancelada' | 'exenta' | 'suspendida'
interface Empresa {
  id: string
  nombre: string
  alta: string
  contacto: string | null
  estado: Estado
  pruebaHasta: string
  usuarios: number
  clientes: number
  pedidos30: number
  ultimoPedido: string | null
}
interface Cuenta { nombre: string; correo: string; activo: boolean; dosPasos: boolean }
interface Datos {
  cuentas: Cuenta[]
  series: { altasPorMes: { mes: string; n: number }[]; pedidosPorDia: { dia: string; n: number }[] }
  resumen: { total: number; prueba: number; activas: number; vencidas: number; canceladas: number; exentas: number; suspendidas: number; porVencer: number; ingresoMensual: number; moneda: string }
  empresas: Empresa[]
}
interface Detalle {
  id: string
  nombre: string
  alta: string
  zonaHoraria: string
  giros: string[]
  color: string | null
  logo: string | null
  estado: Estado
  exenta: boolean
  pruebaHasta: string
  suscripcion: string | null
  baja: { solicitada: string; borrarEn: string; motivo: string | null } | null // la empresa pidió su baja (privacidad.ts)
  equipo: { nombre: string; correo: string; rol: string; activo: boolean; ultimoAcceso: string | null; alta: string; dosPasos: boolean }[]
  invitaciones: { correo: string; rol: string; vence: string }[]
  conteos: { clientes: number; productos: number; entregados: number; pendientes: number; ultimoPedido: string | null }
  pedidosPorDia: { dia: string; n: number }[]
}

const ESTADOS: Record<Estado, { texto: string; color: string }> = {
  activa: { texto: 'Pagando', color: '#2a78d6' },
  prueba: { texto: 'En prueba', color: '#eb6834' },
  exenta: { texto: 'Exenta', color: '#1baf7a' },
  vencida: { texto: 'Vencida', color: '#eda100' },
  cancelada: { texto: 'Cancelada', color: '#eda100' },
  suspendida: { texto: 'Suspendida', color: '#e87ba4' },
}
// La paleta de la plataforma sobre los colores del panel: el azul de Delisy (más claro en el modo oscuro, donde el marino
// se pierde), la serie de los gráficos y el periodo en curso.
const COLORES = '[--plat:#113250] [--plat-hover:#0b2238] [--plat-texto:#113250] [--color-serie:#113250] [--color-oro:#F06E4B] [.oscuro_&]:[--plat:#2a6299] [.oscuro_&]:[--plat-hover:#327ab8] [.oscuro_&]:[--plat-texto:#9cc3ea] [.oscuro_&]:[--color-serie:#5b9bd5]'
const ZONAS = ['America/Mexico_City', 'America/Monterrey', 'America/Merida', 'America/Cancun', 'America/Chihuahua', 'America/Mazatlan', 'America/Hermosillo', 'America/Tijuana']

const fecha = (s: string | null, conAnio = true) =>
  s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}) }) : '—'
const diasHasta = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86400_000)
const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Sin conexión con el servidor')
const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'

type Vista = { de: 'resumen' } | { de: 'empresas' } | { de: 'empresa'; id: string } | { de: 'nueva' } | { de: 'cuentas' } | { de: 'avisos' } | { de: 'config' }

export function Plataforma() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [vista, setVista] = useState<Vista>({ de: 'resumen' })
  useAplicarPreferencias()

  async function cargar() {
    setError('')
    try {
      setDatos(await llamarAutenticado<Datos>('/plataforma/empresas'))
    } catch (e) {
      setError(mensaje(e))
    }
  }
  useEffect(() => { void cargar(); void refrescarPerfil() }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [vista])

  const ir = (v: Vista) => setVista(v)
  const menu: { de: Vista['de']; texto: string; icono: typeof Building2 }[] = [
    { de: 'resumen', texto: 'Resumen', icono: LayoutDashboard },
    { de: 'empresas', texto: 'Empresas', icono: Building2 },
    { de: 'nueva', texto: 'Nueva empresa', icono: Store },
    { de: 'avisos', texto: 'Avisos', icono: Megaphone },
    { de: 'cuentas', texto: 'Cuentas de la plataforma', icono: ShieldCheck },
    { de: 'config', texto: 'Configuración', icono: Settings },
  ]
  const activo = vista.de === 'empresa' ? 'empresas' : vista.de

  return (
    <div className={`min-h-dvh text-tinta lg:grid lg:grid-cols-[264px_minmax(0,1fr)] ${COLORES}`}>
      {/* Menú: lateral en la computadora, una fila que se desliza en el teléfono */}
      <aside className="border-b border-linea lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between px-5 pt-5 pb-3 lg:pb-6">
          <LogoDelisy className="h-8" />
          <span className="flex items-center gap-1">
            <span className="rounded-md bg-[var(--plat)] px-2.5 py-1 text-[11px] font-semibold text-white">Plataforma</span>
            <button type="button" onClick={() => void cerrarSesion()} aria-label="Cerrar sesión" className={`grid h-10 w-10 place-items-center rounded-full text-apagado hover:text-rojo lg:hidden ${anillo}`}><LogOut size={18} aria-hidden="true" /></button>
          </span>
        </div>
        <nav aria-label="Secciones de la plataforma" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {menu.map(({ de, texto, icono: Icono }) => (
            <button
              key={de}
              type="button"
              onClick={() => ir({ de } as Vista)}
              aria-current={activo === de ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold transition-colors ${anillo} ${activo === de ? 'bg-[var(--plat)] text-white' : 'text-tinta hover:bg-niebla'}`}
            >
              <Icono size={18} aria-hidden="true" /> {texto}
            </button>
          ))}
        </nav>
        <PiePropio />
      </aside>

      {/* En Configuración, como en el panel: título y menú fijos, sólo se desplaza el apartado. */}
      <main className={`min-w-0 ${vista.de === 'config' ? 'pt-4 pb-20 lg:h-dvh lg:overflow-hidden lg:pb-0' : 'px-4 pt-6 pb-20 sm:px-8 lg:px-10 lg:pt-8'}`}>
        {error && vista.de !== 'config' && (
          <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-rojo/10 px-5 py-4 text-sm font-medium text-rojo">
            {error}
            <span className="flex gap-2">
              {/^Activa la verificación/.test(error) && <button type="button" onClick={() => ir({ de: 'config' })} className="rounded-md bg-papel px-4 py-2 font-semibold text-tinta">Ir a Configuración</button>}
              <button type="button" onClick={() => void cargar()} className="rounded-md bg-papel px-4 py-2 font-semibold text-tinta">Reintentar</button>
            </span>
          </div>
        )}
        {vista.de === 'config' ? <Configuracion plataforma extra={[
          { id: 'ajustes', texto: 'Ajustes', ayuda: 'Registro, prueba y soporte', icono: SlidersHorizontal, contenido: <AjustesServicio /> },
          { id: 'servicio', texto: 'Servicio', ayuda: 'Estado, cobro y entorno', icono: Server, contenido: <Servicio /> },
        ]} />
          : vista.de === 'avisos' ? <Avisos />
          : !datos ? !error && <p className="py-20 text-center text-apagado">Cargando la plataforma…</p>
          : vista.de === 'resumen' ? <Resumen d={datos} ir={ir} recargar={cargar} />
          : vista.de === 'empresas' ? <Empresas d={datos} ir={ir} />
          : vista.de === 'empresa' ? <DetalleEmpresa id={vista.id} ir={ir} alCambiar={cargar} />
          : vista.de === 'nueva' ? <NuevaEmpresa ir={ir} alCrear={cargar} />
          : <Cuentas cuentas={datos.cuentas} alCrear={cargar} />}
      </main>
    </div>
  )
}

function PiePropio() {
  const u = useSesion()?.usuario
  return (
    <div className="hidden px-5 pb-6 lg:mt-auto lg:block">
      <div className="flex items-center gap-3">
        <Avatar nombre={u?.nombre ?? ''} foto={u?.foto} className="h-9 w-9 bg-[var(--plat)] text-sm text-white" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{u?.nombre}</div>
          <div className="truncate text-xs text-apagado">{u?.correo}</div>
        </div>
      </div>
      <button type="button" onClick={() => void cerrarSesion()} className={`mt-3 flex items-center gap-2 rounded-lg text-sm font-semibold text-apagado hover:text-rojo ${anillo}`}>
        <LogOut size={16} aria-hidden="true" /> Cerrar sesión
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------- piezas

function Encabezado({ titulo, detalle, children }: { titulo: ReactNode; detalle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[2.25rem] font-semibold leading-none tracking-tight lg:text-[2.75rem]">{titulo}</h1>
        {detalle && <p className="mt-2 text-sm text-apagado">{detalle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  )
}

function Panel({ titulo, detalle, children, className = '' }: { titulo: string; detalle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 border-t border-linea pt-5 ${className}`}>
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {detalle && <p className="mt-0.5 text-sm text-apagado">{detalle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

// La franja de cifras: una sola pieza bajo una línea, cada cifra con su nota. Sin tarjetas.
function Cifras({ cifras }: { cifras: { valor: string; etiqueta: string; nota?: string; acento?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-6 border-t border-linea pt-6 sm:grid-cols-3 xl:grid-cols-5">
      {cifras.map((c) => (
        <div key={c.etiqueta} className="min-w-0">
          <dt className="text-xs font-medium text-apagado">{c.etiqueta}</dt>
          <dd className={`mt-1.5 text-[1.9rem] font-semibold leading-none tracking-tight tabular-nums ${c.acento ? 'text-[var(--plat-texto)]' : ''}`}>{c.valor}</dd>
          {c.nota && <dd className="mt-1.5 text-xs text-apagado">{c.nota}</dd>}
        </div>
      ))}
    </dl>
  )
}

function ChipEstado({ estado }: { estado: Estado }) {
  const e = ESTADOS[estado]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-niebla px-2.5 py-1 text-xs font-semibold">
      <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden="true" />{e.texto}
    </span>
  )
}

const boton = `inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 ${anillo}`
const botonPrimario = `${boton} bg-[var(--plat)] text-white hover:bg-[var(--plat-hover)]`
const botonSuave = `${boton} bg-niebla text-tinta hover:bg-linea`

// Pedidos por día (30) y altas por mes (12) como barras: el último periodo es el que va en curso.
const barrasDias = (serie: { dia: string; n: number }[]) =>
  serie.map((d, i) => ({ clave: d.dia, eje: String(Number(d.dia.slice(8))), nombre: fecha(d.dia, false), valor: d.n, actual: i === serie.length - 1 }))

// ---------------------------------------------------------------------------------------------------------- resumen

function Resumen({ d, ir, recargar }: { d: Datos; ir: (v: Vista) => void; recargar: () => Promise<void> }) {
  const r = d.resumen
  const pedidos30 = d.series.pedidosPorDia.reduce((s, x) => s + x.n, 0)
  const sinAcceso = r.vencidas + r.canceladas
  const segmentos = [
    { nombre: 'Pagando', n: r.activas, color: ESTADOS.activa.color },
    { nombre: 'En prueba', n: r.prueba, color: ESTADOS.prueba.color },
    { nombre: 'Exentas', n: r.exentas, color: ESTADOS.exenta.color },
    { nombre: 'Sin acceso', n: sinAcceso, color: ESTADOS.vencida.color },
    { nombre: 'Suspendidas', n: r.suspendidas, color: ESTADOS.suspendida.color },
  ]
  const porVencer = d.empresas.filter((e) => e.estado === 'prueba').sort((a, b) => a.pruebaHasta.localeCompare(b.pruebaHasta)).slice(0, 6)
  const activas = [...d.empresas].sort((a, b) => b.pedidos30 - a.pedidos30).filter((e) => e.pedidos30 > 0).slice(0, 6)
  const meses = d.series.altasPorMes.map((m, i) => {
    const f = new Date(`${m.mes}-15T12:00:00`)
    return { clave: m.mes, eje: f.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''), nombre: f.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }), valor: m.n, actual: i === d.series.altasPorMes.length - 1 }
  })

  return (
    <>
      <Encabezado titulo="Resumen" detalle={`${r.total} empresas en Delisy · ${new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}`}>
        <button type="button" onClick={() => void recargar()} className={botonSuave}><RefreshCw size={16} aria-hidden="true" /> Actualizar</button>
        <button type="button" onClick={() => ir({ de: 'nueva' })} className={botonPrimario}><Building2 size={16} aria-hidden="true" /> Nueva empresa</button>
      </Encabezado>

      <Cifras cifras={[
        { valor: dinero(r.ingresoMensual), etiqueta: `Ingreso mensual (${r.moneda})`, nota: `${r.activas} ${r.activas === 1 ? 'empresa pagando' : 'empresas pagando'}`, acento: true },
        { valor: String(r.prueba), etiqueta: 'En prueba gratis', nota: r.porVencer ? `${r.porVencer} vencen en 7 días` : 'Ninguna vence esta semana' },
        { valor: String(sinAcceso), etiqueta: 'Sin acceso', nota: `${r.vencidas} vencidas · ${r.canceladas} canceladas` },
        { valor: String(pedidos30), etiqueta: 'Pedidos entregados', nota: 'Últimos 30 días, todas las empresas' },
        { valor: String(r.total), etiqueta: 'Empresas', nota: `${r.exentas} exentas · ${r.suspendidas} suspendidas` },
      ]} />

      <div className="mt-10 grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel titulo="Pedidos entregados por día" detalle="Todas las empresas, últimos 30 días">
          <BarrasPeriodo datos={barrasDias(d.series.pedidosPorDia)} formato={(n) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`} descripcion="Pedidos entregados por día en toda la plataforma" leyenda={['Días anteriores', 'Hoy']} alto={180} ejeEn={5} />
        </Panel>
        <Panel titulo="Estado de las empresas" detalle={`${r.total} en total`}>
          <BarraSegmentada segmentos={segmentos} descripcion={segmentos.map((s) => `${s.nombre}: ${s.n}`).join(', ')} />
          <ul className="mt-5 space-y-3">
            {segmentos.map((s) => (
              <li key={s.nombre} className="flex items-center gap-3 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                <span className="flex-1">{s.nombre}</span>
                <span className="font-semibold tabular-nums">{s.n}</span>
                <span className="w-12 text-right text-apagado tabular-nums">{r.total ? Math.round((s.n / r.total) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-10 xl:grid-cols-3">
        <Panel titulo="Altas de empresas" detalle="Por mes, últimos 12 meses">
          <BarrasPeriodo datos={meses} formato={(n) => `${n} ${n === 1 ? 'empresa' : 'empresas'}`} descripcion="Empresas que se dieron de alta cada mes" leyenda={['Meses anteriores', 'Este mes']} alto={140} ejeEn={2} />
        </Panel>
        <Panel titulo="Pruebas por terminar" detalle="Las que vencen primero">
          <ListaEmpresas empresas={porVencer} vacia="No hay empresas en prueba." ir={ir} dato={(e) => {
            const dias = diasHasta(e.pruebaHasta)
            return dias <= 0 ? 'Vence hoy' : `${dias} ${dias === 1 ? 'día' : 'días'}`
          }} />
        </Panel>
        <Panel titulo="Más activas" detalle="Pedidos entregados, últimos 30 días">
          <ListaEmpresas empresas={activas} vacia="Todavía no hay pedidos entregados." ir={ir} dato={(e) => `${e.pedidos30} pedidos`} />
        </Panel>
      </div>
    </>
  )
}

function ListaEmpresas({ empresas, vacia, ir, dato }: { empresas: Empresa[]; vacia: string; ir: (v: Vista) => void; dato: (e: Empresa) => string }) {
  if (!empresas.length) return <p className="text-sm text-apagado">{vacia}</p>
  return (
    <ul className="-mx-2">
      {empresas.map((e) => (
        <li key={e.id}>
          <button type="button" onClick={() => ir({ de: 'empresa', id: e.id })} className={`flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-niebla ${anillo}`}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-niebla text-sm font-bold">{e.nombre.charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{e.nombre}</span>
              <span className="block truncate text-xs text-apagado">{e.contacto ?? 'Sin administrador'}</span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{dato(e)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------------------- empresas

const FILTROS: { clave: 'todas' | Estado | 'sin-acceso'; texto: string; cumple: (e: Empresa) => boolean }[] = [
  { clave: 'todas', texto: 'Todas', cumple: () => true },
  { clave: 'activa', texto: 'Pagando', cumple: (e) => e.estado === 'activa' },
  { clave: 'prueba', texto: 'En prueba', cumple: (e) => e.estado === 'prueba' },
  { clave: 'sin-acceso', texto: 'Sin acceso', cumple: (e) => e.estado === 'vencida' || e.estado === 'cancelada' },
  { clave: 'exenta', texto: 'Exentas', cumple: (e) => e.estado === 'exenta' },
  { clave: 'suspendida', texto: 'Suspendidas', cumple: (e) => e.estado === 'suspendida' },
]
type Orden = 'alta' | 'nombre' | 'pedidos' | 'clientes'

function Empresas({ d, ir }: { d: Datos; ir: (v: Vista) => void }) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['clave']>('todas')
  const [orden, setOrden] = useState<Orden>('alta')
  const q = limpiarBusqueda(busca)
  const lista = useMemo(() => {
    const f = FILTROS.find((x) => x.clave === filtro)!
    return d.empresas
      .filter((e) => f.cumple(e) && coincide(q, e.nombre, e.contacto))
      .sort((a, b) => orden === 'nombre' ? a.nombre.localeCompare(b.nombre, 'es') : orden === 'pedidos' ? b.pedidos30 - a.pedidos30 : orden === 'clientes' ? b.clientes - a.clientes : b.alta.localeCompare(a.alta))
  }, [d.empresas, q, filtro, orden])
  const pagina = usePaginas(lista, 25, `${busca}|${filtro}|${orden}`)
  const columna = (clave: Orden, texto: string, der = false) => (
    <th scope="col" className={`px-4 py-3 font-medium ${der ? 'text-right' : ''}`}>
      <button type="button" onClick={() => setOrden(clave)} className={`inline-flex items-center gap-1 ${orden === clave ? 'text-tinta' : ''} ${anillo}`}>
        {texto} {orden === clave && <ArrowDownUp size={12} aria-hidden="true" />}
      </button>
    </th>
  )

  return (
    <>
      <Encabezado titulo="Empresas" detalle={`${lista.length} de ${d.empresas.length}`}>
        <button type="button" onClick={() => ir({ de: 'nueva' })} className={botonPrimario}><Building2 size={16} aria-hidden="true" /> Nueva empresa</button>
      </Encabezado>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[16rem] flex-1">
          <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-apagado" aria-hidden="true" />
          <input {...propsBuscador} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o correo" aria-label="Buscar empresa" className={`${claseInputRecto} pl-11`} />
        </label>
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => {
            const n = d.empresas.filter(f.cumple).length
            return (
              <button key={f.clave} type="button" onClick={() => setFiltro(f.clave)} aria-pressed={filtro === f.clave}
                className={`rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${anillo} ${filtro === f.clave ? 'bg-[var(--plat)] text-white' : 'bg-niebla hover:bg-linea'}`}>
                {f.texto} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div ref={pagina.ancla} className="scroll-mt-4 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="text-xs text-apagado">
            <tr>
              {columna('nombre', 'Empresa')}
              <th scope="col" className="px-4 py-3 font-medium">Estado</th>
              {columna('alta', 'Alta')}
              <th scope="col" className="px-4 py-3 font-medium">Prueba</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Usuarios</th>
              {columna('clientes', 'Clientes', true)}
              {columna('pedidos', 'Pedidos 30 d', true)}
              <th scope="col" className="px-4 py-3 font-medium">Última entrega</th>
              <th scope="col" className="w-8"><span className="sr-only">Abrir</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-linea border-y border-linea">
            {pagina.visibles.map((e) => (
              <tr key={e.id} onClick={() => ir({ de: 'empresa', id: e.id })} className="cursor-pointer hover:bg-niebla/60">
                <td className="px-4 py-3">
                  <button type="button" onClick={() => ir({ de: 'empresa', id: e.id })} className={`block text-left ${anillo}`}>
                    <span className="block font-semibold"><Resaltar texto={e.nombre} t={q} /></span>
                    <span className="block text-xs text-apagado">{e.contacto ? <Resaltar texto={e.contacto} t={q} /> : 'Sin administrador'}</span>
                  </button>
                </td>
                <td className="px-4 py-3"><ChipEstado estado={e.estado} /></td>
                <td className="px-4 py-3 whitespace-nowrap tabular-nums">{fecha(e.alta)}</td>
                <td className="px-4 py-3 whitespace-nowrap tabular-nums text-apagado">{e.estado === 'prueba' ? `Hasta ${fecha(e.pruebaHasta, false)}` : '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.usuarios}</td>
                <td className="px-4 py-3 text-right tabular-nums">{e.clientes}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{e.pedidos30}</td>
                <td className="px-4 py-3 whitespace-nowrap tabular-nums">{fecha(e.ultimoPedido)}</td>
                <td className="pr-4 text-apagado"><ChevronRight size={16} aria-hidden="true" /></td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={9} className="px-4 py-12 text-center text-apagado">Ninguna empresa con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      {pagina.control}
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------- detalle

function DetalleEmpresa({ id, ir, alCambiar }: { id: string; ir: (v: Vista) => void; alCambiar: () => Promise<void> }) {
  const [e, setE] = useState<Detalle | null>(null)
  const [error, setError] = useState('')
  const [confirmar, setConfirmar] = useState(false)
  const [trabajando, setTrabajando] = useState(false)

  async function cargar() {
    try {
      setE(await llamarAutenticado<Detalle>(`/plataforma/empresas/${id}`))
    } catch (x) {
      setError(mensaje(x))
    }
  }
  useEffect(() => { void cargar() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function cambiarActiva(activa: boolean) {
    setTrabajando(true)
    try {
      await llamarAutenticado(`/plataforma/empresas/${id}/activa`, { metodo: 'POST', cuerpo: { activa } })
      aviso(activa ? 'Empresa reactivada' : 'Empresa suspendida')
      setConfirmar(false)
      await Promise.all([cargar(), alCambiar()])
    } catch (x) {
      aviso(mensaje(x))
    } finally {
      setTrabajando(false)
    }
  }

  const volver = <button type="button" onClick={() => ir({ de: 'empresas' })} className={`mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-apagado hover:text-tinta ${anillo}`}><ArrowLeft size={16} aria-hidden="true" /> Empresas</button>
  if (error) return <>{volver}<p role="alert" className="rounded-lg bg-rojo/10 p-5 text-rojo">{error}</p></>
  if (!e) return <>{volver}<p className="py-20 text-center text-apagado">Cargando la empresa…</p></>
  const suspendida = e.estado === 'suspendida'

  return (
    <>
      {volver}
      <header className="mb-8 flex flex-wrap items-center gap-5">
        {e.logo
          ? <img src={e.logo} alt="" className="h-16 w-16 rounded-lg bg-white object-contain p-2 ring-1 ring-linea" />
          : <span className="grid h-16 w-16 place-items-center rounded-lg text-2xl font-bold text-white" style={{ background: e.color ?? 'var(--plat)' }}>{e.nombre.charAt(0).toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[2.25rem] font-semibold leading-none tracking-tight">{e.nombre}</h1>
            <ChipEstado estado={e.estado} />
          </div>
          <p className="mt-2 text-sm text-apagado">
            Alta el {fecha(e.alta)} · {e.zonaHoraria.replace('America/', '').replace('_', ' ')}
            {e.estado === 'prueba' && ` · prueba hasta el ${fecha(e.pruebaHasta)}`}
          </p>
          {e.baja && (
            <p className="mt-2 rounded-md bg-rojo/10 px-3 py-2 text-sm">
              Pidió su baja el {fecha(e.baja.solicitada)}: sus datos se borran el <strong>{fecha(e.baja.borrarEn)}</strong>. Reactivarla cancela la baja.
              {e.baja.motivo && <> Motivo: «{e.baja.motivo}».</>}
            </p>
          )}
        </div>
        {confirmar ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-rojo/10 px-4 py-3">
            <span className="text-sm">Nadie de {e.nombre} podrá entrar. No se borra nada.</span>
            <button type="button" onClick={() => void cambiarActiva(false)} disabled={trabajando} className={`${boton} bg-rojo text-white`}>Sí, suspender</button>
            <button type="button" onClick={() => setConfirmar(false)} className={botonSuave}>Cancelar</button>
          </div>
        ) : suspendida ? (
          <button type="button" onClick={() => void cambiarActiva(true)} disabled={trabajando} className={botonPrimario}>Reactivar</button>
        ) : (
          <button type="button" onClick={() => setConfirmar(true)} className={`${boton} bg-niebla text-rojo hover:bg-rojo/10`}>Suspender</button>
        )}
      </header>

      <Cifras cifras={[
        { valor: String(e.conteos.clientes), etiqueta: 'Clientes activos' },
        { valor: String(e.conteos.productos), etiqueta: 'Productos a la venta' },
        { valor: String(e.conteos.entregados), etiqueta: 'Pedidos entregados', nota: 'Desde que se dio de alta' },
        { valor: String(e.conteos.pendientes), etiqueta: 'Pedidos por entregar' },
        { valor: fecha(e.conteos.ultimoPedido), etiqueta: 'Última entrega' },
      ]} />

      <div className="mt-10 grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel titulo="Actividad" detalle="Pedidos entregados por día, últimos 30 días">
          {e.pedidosPorDia.every((x) => !x.n) ? <p className="py-16 text-center text-sm text-apagado">Sin pedidos entregados en los últimos 30 días.</p> : <BarrasPeriodo datos={barrasDias(e.pedidosPorDia)} formato={(n) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`} descripcion={`Pedidos entregados por día de ${e.nombre}`} leyenda={['Días anteriores', 'Hoy']} alto={160} ejeEn={5} />}
        </Panel>
        <Panel titulo="Ajustes" detalle="Sólo para la plataforma: la empresa no los ve.">
          <Ajustes e={e} alGuardar={async () => { await Promise.all([cargar(), alCambiar()]) }} />
        </Panel>
      </div>

      <div className="mt-10 grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel titulo="Equipo" detalle={`${e.equipo.length} ${e.equipo.length === 1 ? 'cuenta' : 'cuentas'}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-apagado">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Nombre</th>
                  <th scope="col" className="px-3 py-2 font-medium">Rol</th>
                  <th scope="col" className="px-3 py-2 font-medium">Dos pasos</th>
                  <th scope="col" className="py-2 pl-3 font-medium">Último acceso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea border-t border-linea">
                {e.equipo.map((u) => (
                  <tr key={u.correo} className={u.activo ? '' : 'opacity-50'}>
                    <td className="py-2.5 pr-3"><span className="block font-semibold">{u.nombre}</span><span className="block text-xs text-apagado">{u.correo}</span></td>
                    <td className="px-3 py-2.5">{u.rol === 'administrador' ? 'Administrador' : 'Vendedor'}{!u.activo && ' · de baja'}</td>
                    <td className="px-3 py-2.5">{u.dosPasos ? <span className="inline-flex items-center gap-1 font-semibold text-verde"><Check size={14} aria-hidden="true" /> Sí</span> : <span className="text-apagado">No</span>}</td>
                    <td className="py-2.5 pl-3 whitespace-nowrap tabular-nums">{fecha(u.ultimoAcceso)}</td>
                  </tr>
                ))}
                {!e.equipo.length && <tr><td colSpan={4} className="px-6 py-6 text-center text-apagado">Nadie ha entrado todavía.</td></tr>}
              </tbody>
            </table>
          </div>
          {e.invitaciones.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold">Invitaciones sin aceptar</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {e.invitaciones.map((i) => <li key={i.correo} className="text-apagado"><span className="font-medium text-tinta">{i.correo}</span> · {i.rol === 'administrador' ? 'administrador' : 'vendedor'} · vence el {fecha(i.vence, false)}</li>)}
              </ul>
            </div>
          )}
        </Panel>
        <Panel titulo="Datos">
          <dl className="space-y-3 text-sm">
            <Dato t="Giros" v={e.giros.length ? e.giros.join(', ') : '—'} />
            <Dato t="Zona horaria" v={e.zonaHoraria} />
            <Dato t="Suscripción en Mercado Pago" v={({ pending: 'Pago en proceso', authorized: 'Autorizada', paused: 'Pausada', cancelled: 'Cancelada' } as Record<string, string>)[e.suscripcion ?? ''] ?? 'Sin suscripción'} />
            <Dato t="Color de marca" v={e.color ? <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: e.color }} />{e.color}</span> : 'Sin marca propia'} />
            <Dato t="Identificador" v={<span className="break-all font-mono text-xs">{e.id}</span>} />
          </dl>
        </Panel>
      </div>
    </>
  )
}

function Dato({ t, v }: { t: string; v: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-apagado">{t}</dt>
      <dd className="mt-0.5 font-medium">{v}</dd>
    </div>
  )
}

function Ajustes({ e, alGuardar }: { e: Detalle; alGuardar: () => Promise<void> }) {
  const hoy = (s: string) => new Date(s).toLocaleDateString('en-CA', { timeZone: e.zonaHoraria })
  const [nombre, setNombre] = useState(e.nombre)
  const [prueba, setPrueba] = useState(hoy(e.pruebaHasta))
  const [exenta, setExenta] = useState(e.exenta)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const cambios = {
    ...(nombre.trim() !== e.nombre ? { nombre: nombre.trim() } : {}),
    ...(prueba !== hoy(e.pruebaHasta) ? { pruebaHasta: prueba } : {}),
    ...(exenta !== e.exenta ? { exenta } : {}),
  }
  const hay = Object.keys(cambios).length > 0
  const sumar = (dias: number) => {
    const base = new Date(`${prueba}T12:00:00`)
    base.setDate(base.getDate() + dias)
    setPrueba(base.toISOString().slice(0, 10))
  }

  async function guardar() {
    setGuardando(true)
    setError('')
    try {
      await llamarAutenticado(`/plataforma/empresas/${e.id}`, { metodo: 'PATCH', cuerpo: cambios })
      aviso('Ajustes guardados')
      await alGuardar()
    } catch (x) {
      setError(mensaje(x))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-apagado">Nombre</span>
        <input value={nombre} onChange={(x) => setNombre(x.target.value)} className={claseInputRecto} maxLength={120} />
      </label>
      <div>
        <span className="mb-1.5 block text-xs font-medium text-apagado">Prueba gratis hasta</span>
        {exenta ? (
          <div className={`${claseInputRecto} opacity-50`}>{prueba ? desdeIso(prueba).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</div>
        ) : (
          <SelectorFecha valor={prueba || hoyLocal()} onCambiar={setPrueba} etiqueta="Prueba gratis hasta" className={`${claseInputRecto} flex items-center gap-2 text-left`}>
            <CalendarDays size={18} className="shrink-0 text-apagado" />
            {prueba ? desdeIso(prueba).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Elegir fecha'}
          </SelectorFecha>
        )}
        {!exenta && (
          <div className="mt-2 flex gap-1.5">
            {[7, 14, 30].map((n) => <button key={n} type="button" onClick={() => sumar(n)} className="rounded-md bg-niebla px-3 py-1.5 text-xs font-semibold hover:bg-linea">+{n} días</button>)}
          </div>
        )}
      </div>
      <label className="flex cursor-pointer items-center justify-between gap-4 border-y border-linea py-3">
        <span>
          <span className="block text-sm font-semibold">Exenta</span>
          <span className="block text-xs text-apagado">No paga y nunca pierde el acceso.</span>
        </span>
        <input type="checkbox" checked={exenta} onChange={(x) => setExenta(x.target.checked)} className="h-5 w-5 accent-[var(--plat)]" />
      </label>
      {error && <p role="alert" className="text-sm font-medium text-rojo">{error}</p>}
      <button type="button" onClick={() => void guardar()} disabled={!hay || guardando} className={`${botonPrimario} w-full`}>{guardando ? 'Guardando…' : 'Guardar ajustes'}</button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------- nueva

function NuevaEmpresa({ ir, alCrear }: { ir: (v: Vista) => void; alCrear: () => Promise<void> }) {
  const [f, setF] = useState({ nombre: '', zona: 'America/Mexico_City', adminNombre: '', adminCorreo: '', plan: 'prueba' as 'prueba' | 'exenta', dias: '14' })
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [hecha, setHecha] = useState<{ id: string; enlace: string; dias: number } | null>(null)
  const poner = (c: Partial<typeof f>) => setF({ ...f, ...c })

  async function crear() {
    setEnviando(true)
    setError('')
    try {
      const r = await llamarAutenticado<{ id: string; enlace: string; dias: number }>('/plataforma/empresas', {
        metodo: 'POST',
        cuerpo: {
          nombre: f.nombre.trim(), zonaHoraria: f.zona, exenta: f.plan === 'exenta',
          ...(f.plan === 'prueba' ? { pruebaDias: Number(f.dias) || 0 } : {}),
          administrador: { nombre: f.adminNombre.trim(), correo: f.adminCorreo.trim() },
        },
      })
      setHecha(r)
      await alCrear()
    } catch (x) {
      setError(mensaje(x))
    } finally {
      setEnviando(false)
    }
  }

  if (hecha) {
    return (
      <>
        <Encabezado titulo={`${f.nombre.trim()} ya está en Delisy`} detalle="Su administrador recibió un correo para crear su contraseña." />
        <section className="max-w-2xl border-t border-linea pt-6">
          <h2 className="text-lg font-semibold">Enlace de la invitación</h2>
          <p className="mt-1 text-sm text-apagado">Si no le llega el correo, mándale este enlace por WhatsApp. Vence en {hecha.dias} días y sirve una sola vez.</p>
          <div className="mt-4 flex items-center gap-2 border-y border-linea py-3">
            <code className="min-w-0 flex-1 truncate text-sm">{hecha.enlace}</code>
            <button type="button" onClick={() => void copiarDelicado(hecha.enlace).then(() => aviso('Enlace copiado'), () => {})} className={botonSuave}><Copy size={15} aria-hidden="true" /> Copiar</button>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={() => ir({ de: 'empresa', id: hecha.id })} className={botonPrimario}>Ver la empresa</button>
            <button type="button" onClick={() => { setHecha(null); setF({ ...f, nombre: '', adminNombre: '', adminCorreo: '' }) }} className={botonSuave}>Dar de alta otra</button>
          </div>
        </section>
      </>
    )
  }

  const listo = f.nombre.trim().length >= 2 && f.adminNombre.trim().length >= 2 && f.adminCorreo.includes('@')
  return (
    <>
      <Encabezado titulo="Nueva empresa" detalle="Para dar de alta a un negocio sin que pase por el registro. Su catálogo y su marca los pone su administrador al entrar." />
      <form onSubmit={(x) => { x.preventDefault(); if (listo) void crear() }} className="grid max-w-4xl gap-x-12 gap-y-10 lg:grid-cols-2">
        <section className="border-t border-linea pt-6">
          <h2 className="text-lg font-semibold">El negocio</h2>
          <div className="mt-5 space-y-4">
            <Campo t="Nombre"><input value={f.nombre} onChange={(x) => poner({ nombre: x.target.value })} className={claseInputRecto} placeholder="Ej. Agua La Fuente" maxLength={120} /></Campo>
            <Campo t="Zona horaria (define qué es «hoy» para sus rutas)">
              <Selector valor={f.zona} onCambiar={(zona) => poner({ zona })} className={claseInputRecto} etiqueta="Zona horaria"
                opciones={ZONAS.map((z) => ({ valor: z, texto: z.replace('America/', '').replace('_', ' ') }))} />
            </Campo>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-apagado">Plan</span>
              <div className="grid grid-cols-2 gap-2">
                {(['prueba', 'exenta'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => poner({ plan: p })} aria-pressed={f.plan === p}
                    className={`rounded-lg px-4 py-3 text-left transition-colors ${anillo} ${f.plan === p ? 'bg-[var(--plat)] text-white' : 'bg-niebla hover:bg-linea'}`}>
                    <span className="block text-sm font-semibold">{p === 'prueba' ? 'Prueba gratis' : 'Exenta'}</span>
                    <span className={`block text-xs ${f.plan === p ? 'text-white/70' : 'text-apagado'}`}>{p === 'prueba' ? 'Luego se suscribe' : 'No paga nunca'}</span>
                  </button>
                ))}
              </div>
            </div>
            {f.plan === 'prueba' && (
              <Campo t="Días de prueba"><input inputMode="numeric" value={f.dias} onChange={(x) => poner({ dias: x.target.value.replace(/\D/g, '').slice(0, 3) })} className={claseInputRecto} /></Campo>
            )}
          </div>
        </section>
        <section className="flex flex-col border-t border-linea pt-6">
          <h2 className="text-lg font-semibold">Su administrador</h2>
          <p className="mt-1 text-sm text-apagado">Le llega un enlace para crear su contraseña. Nadie más la ve.</p>
          <div className="mt-5 space-y-4">
            <Campo t="Nombre"><input value={f.adminNombre} onChange={(x) => poner({ adminNombre: x.target.value })} className={claseInputRecto} placeholder="Nombre y apellido" maxLength={100} /></Campo>
            <Campo t="Correo"><input type="email" value={f.adminCorreo} onChange={(x) => poner({ adminCorreo: x.target.value })} className={claseInputRecto} placeholder="correo@ejemplo.com" maxLength={150} /></Campo>
          </div>
          {error && <p role="alert" className="mt-4 text-sm font-medium text-rojo">{error}</p>}
          <button type="submit" disabled={!listo || enviando} className={`${botonPrimario} mt-6 w-full lg:mt-auto`}>{enviando ? 'Creando…' : 'Crear empresa e invitar'}</button>
        </section>
      </form>
    </>
  )
}

function Campo({ t, children }: { t: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-apagado">{t}</span>
      {children}
    </label>
  )
}

// ---------------------------------------------------------------------------------------------------------- cuentas

function Cuentas({ cuentas, alCrear }: { cuentas: Cuenta[]; alCrear: () => Promise<void> }) {
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [creada, setCreada] = useState<{ correo: string; passwordTemporal: string } | null>(null)

  async function crear() {
    setEnviando(true)
    setError('')
    try {
      setCreada(await llamarAutenticado<{ correo: string; passwordTemporal: string }>('/plataforma/cuentas', { metodo: 'POST', cuerpo: { nombre: nombre.trim(), correo: correo.trim() } }))
      setNombre('')
      setCorreo('')
      await alCrear()
    } catch (x) {
      setError(mensaje(x))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <Encabezado titulo="Cuentas de la plataforma" detalle="Quienes administran Delisy. Ven todas las empresas y no administran ningún negocio." />
      <div className="grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead className="text-xs text-apagado">
              <tr>
                <th scope="col" className="py-3 pr-3 font-medium">Nombre</th>
                <th scope="col" className="px-3 py-3 font-medium">Dos pasos</th>
                <th scope="col" className="py-3 pl-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea border-y border-linea">
              {cuentas.map((c) => (
                <tr key={c.correo}>
                  <td className="py-3 pr-3"><span className="block font-semibold">{c.nombre}</span><span className="block text-xs text-apagado">{c.correo}</span></td>
                  <td className="px-3 py-3">{c.dosPasos ? <span className="inline-flex items-center gap-1 font-semibold text-verde"><Check size={14} aria-hidden="true" /> Activa</span> : <span className="font-medium text-rojo">Falta activarla</span>}</td>
                  <td className="py-3 pl-3">{c.activo ? 'Activa' : 'De baja'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="border-t border-linea pt-5">
          <h2 className="text-lg font-semibold">Nueva cuenta</h2>
          {creada ? (
            <div className="mt-4 space-y-3 text-sm">
              <p>Compártele estos datos por un medio seguro. Al entrar se le pide cambiar la contraseña y activar la verificación en dos pasos.</p>
              <div className="space-y-2 border-y border-linea py-3">
                <div><span className="text-apagado">Correo:</span> <b>{creada.correo}</b></div>
                <div className="flex items-center gap-2">
                  <span className="text-apagado">Contraseña temporal:</span> <b className="font-mono">{creada.passwordTemporal}</b>
                  <button type="button" onClick={() => void copiarDelicado(creada.passwordTemporal).then(() => aviso('Copiada'), () => {})} aria-label="Copiar contraseña" className="grid h-8 w-8 place-items-center rounded-full hover:bg-linea"><Copy size={15} /></button>
                </div>
              </div>
              <p className="text-xs text-apagado">No se vuelve a mostrar.</p>
              <button type="button" onClick={() => setCreada(null)} className={botonSuave}>Crear otra</button>
            </div>
          ) : (
            <form onSubmit={(x) => { x.preventDefault(); void crear() }} className="mt-5 space-y-4">
              <Campo t="Nombre"><input value={nombre} onChange={(x) => setNombre(x.target.value)} className={claseInputRecto} autoComplete="off" /></Campo>
              <Campo t="Correo"><input type="email" value={correo} onChange={(x) => setCorreo(x.target.value)} className={claseInputRecto} autoComplete="off" placeholder="correo@ejemplo.com" /></Campo>
              {error && <p role="alert" className="text-sm font-medium text-rojo">{error}</p>}
              <button type="submit" disabled={enviando || nombre.trim().length < 2 || !correo.trim()} className={`${botonPrimario} w-full`}>{enviando ? 'Creando…' : 'Crear cuenta'}</button>
            </form>
          )}
        </section>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------- avisos

type Para = 'todos' | 'administradores' | 'vendedores'
interface AvisoPlataforma {
  id: string; texto: string; tipo: 'info' | 'aviso'; para: Para; desde: string | null; hasta: string | null; actualizado: string
  porCorreo: boolean; correo: { enviado: string; destinatarios: number } | null
}
const PARA: Record<Para, string> = { todos: 'Todos', administradores: 'Administradores', vendedores: 'Vendedores' }
// <input type="datetime-local"> habla en la hora de este navegador, sin zona: de ida y vuelta a ISO.
const aLocal = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const deLocal = (v: string) => (v ? new Date(v).toISOString() : null)
const momento = (iso: string) => new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const estadoAviso = (a: { desde: string | null; hasta: string | null }) =>
  a.hasta && new Date(a.hasta).getTime() <= Date.now() ? 'terminado' : a.desde && new Date(a.desde).getTime() > Date.now() ? 'programado' : 'activo'
const ESTADO_AVISO = {
  activo: { texto: 'Se ve ahora', color: '#1baf7a' },
  programado: { texto: 'Programado', color: '#2a78d6' },
  terminado: { texto: 'Terminado', color: '#9a948a' },
}

function MuestraAviso({ texto, tipo, accion }: { texto: string; tipo: 'info' | 'aviso'; accion?: string }) {
  const aviso_ = tipo === 'aviso'
  return (
    <div className={`flex items-start gap-3 rounded-md px-4 py-2.5 text-sm ${aviso_ ? 'bg-ambar/15' : 'bg-azul/10'}`}>
      {aviso_ ? <CircleAlert size={17} className="mt-0.5 shrink-0 text-ambar" aria-hidden="true" /> : <Info size={17} className="mt-0.5 shrink-0 text-azul" aria-hidden="true" />}
      <p className="min-w-0 flex-1 leading-snug">{texto}{accion && <span className="ml-2 font-semibold underline underline-offset-2">{accion}</span>}</p>
    </div>
  )
}

function Opciones<T extends string>({ valor, opciones, alCambiar, etiqueta }: { valor: T; opciones: [T, string][]; alCambiar: (v: T) => void; etiqueta: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={etiqueta}>
      {opciones.map(([v, texto]) => (
        <button key={v} type="button" role="radio" aria-checked={valor === v} onClick={() => alCambiar(v)}
          className={`rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${anillo} ${valor === v ? 'bg-[var(--plat)] text-white' : 'bg-niebla hover:bg-linea'}`}>{texto}</button>
      ))}
    </div>
  )
}

// Apartado «Avisos»: lo que ven las empresas arriba del panel y de la app de reparto (components/AnuncioPlataforma.tsx),
// sólo con la sesión abierta. Avisos escritos aquí, cada uno con a quién va y entre qué fechas sale, y el automático de
// la prueba gratis por vencer (plataforma_ajustes).
function Avisos() {
  const [lista, setLista] = useState<{ avisos: AvisoPlataforma[]; avisoPrueba: { dias: number; vendedores: boolean }; correoActivo: boolean } | null>(null)
  const [error, setError] = useState('')
  const cargar = () => llamarAutenticado<NonNullable<typeof lista>>('/plataforma/avisos').then(setLista).catch((e) => setError(mensaje(e)))
  useEffect(() => { void cargar() }, [])
  const [editando, setEditando] = useState<AvisoPlataforma | null>(null)

  return (
    <>
      <Encabezado titulo="Avisos" detalle="Salen arriba del panel y de la app de reparto, sólo a quien tiene la sesión abierta. Cada quien puede cerrarlos; vuelven a salir si los cambias." />
      {error && <p role="alert" className="mb-6 text-sm font-medium text-rojo">{error}</p>}
      {!lista ? !error && <p className="text-sm text-apagado">Cargando…</p> : (
        <div className="grid gap-x-12 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="min-w-0 space-y-10">
            <EditorAviso key={editando?.id ?? 'nuevo'} aviso={editando} correoActivo={lista.correoActivo} alTerminar={async () => { setEditando(null); await cargar() }} />
            <Panel titulo="Escritos" detalle={lista.avisos.length ? 'Los terminados quedan al final; quítalos cuando ya no los quieras ver.' : undefined}>
              {lista.avisos.length === 0 ? <p className="text-sm text-apagado">Todavía no hay avisos.</p> : (
                <ul className="divide-y divide-linea">
                  {lista.avisos.map((a) => <FilaAviso key={a.id} a={a} editando={editando?.id === a.id} alEditar={() => { setEditando(a); window.scrollTo({ top: 0, behavior: 'smooth' }) }} alQuitar={cargar} />)}
                </ul>
              )}
            </Panel>
          </div>
          <AvisoAutomatico inicial={lista.avisoPrueba} alGuardar={cargar} />
        </div>
      )}
    </>
  )
}

function FilaAviso({ a, editando, alEditar, alQuitar }: { a: AvisoPlataforma; editando: boolean; alEditar: () => void; alQuitar: () => Promise<void> }) {
  const [quitando, setQuitando] = useState(false)
  const e = ESTADO_AVISO[estadoAviso(a)]
  const vigencia = a.desde && a.hasta ? `Del ${momento(a.desde)} al ${momento(a.hasta)}`
    : a.desde ? `Desde el ${momento(a.desde)}, sin fin` : a.hasta ? `Hasta el ${momento(a.hasta)}` : 'Sin fecha de fin'
  async function quitar() {
    if (!confirm('¿Quitar este aviso? Deja de salir en todas las empresas.')) return
    setQuitando(true)
    try {
      await llamarAutenticado(`/plataforma/avisos/${a.id}`, { metodo: 'DELETE' })
      aviso('Aviso quitado')
      await alQuitar()
    } catch (x) {
      aviso(mensaje(x))
      setQuitando(false)
    }
  }
  return (
    <li className={`py-4 ${estadoAviso(a) === 'terminado' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-niebla px-2.5 py-1 font-semibold">
          <span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden="true" />{e.texto}
        </span>
        <span className="font-medium text-apagado">{PARA[a.para]} · {vigencia}</span>
        {a.tipo === 'aviso' && a.porCorreo && (
          <span className="inline-flex items-center gap-1 font-medium text-apagado">
            <Mail size={13} aria-hidden="true" />
            {a.correo ? `Por correo a ${a.correo.destinatarios} ${a.correo.destinatarios === 1 ? 'cuenta' : 'cuentas'} el ${momento(a.correo.enviado)}` : 'Por correo al empezar'}
          </span>
        )}
      </div>
      <div className="mt-2.5"><MuestraAviso texto={a.texto} tipo={a.tipo} /></div>
      <div className="mt-2 flex gap-4 text-sm font-semibold">
        <button type="button" onClick={alEditar} disabled={editando} className={`text-[var(--plat-texto)] hover:underline disabled:opacity-40 ${anillo}`}>{editando ? 'Editando…' : 'Editar'}</button>
        <button type="button" onClick={() => void quitar()} disabled={quitando} className={`text-rojo hover:underline disabled:opacity-40 ${anillo}`}>Quitar</button>
      </div>
    </li>
  )
}

function EditorAviso({ aviso: original, correoActivo, alTerminar }: { aviso: AvisoPlataforma | null; correoActivo: boolean; alTerminar: () => Promise<void> }) {
  const [texto, setTexto] = useState(original?.texto ?? '')
  const [tipo, setTipo] = useState<'info' | 'aviso'>(original?.tipo ?? 'info')
  const [para, setPara] = useState<Para>(original?.para ?? 'todos')
  const [desde, setDesde] = useState(aLocal(original?.desde ?? null))
  const [hasta, setHasta] = useState(aLocal(original?.hasta ?? null))
  const [porCorreo, setPorCorreo] = useState(original?.porCorreo ?? false)
  const yaMandado = !!original?.correo
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  // Atajos para el final: a partir del inicio (o de ahora, si sale ya).
  const durante = (horas: number) => {
    const base = desde ? new Date(desde).getTime() : Date.now()
    setHasta(aLocal(new Date(base + horas * 3600_000).toISOString()))
  }
  const alReves = !!desde && !!hasta && new Date(hasta) <= new Date(desde)
  const vencido = !!hasta && new Date(hasta).getTime() <= Date.now()

  async function guardar() {
    setGuardando(true)
    setError('')
    try {
      const cuerpo = { texto: texto.trim(), tipo, para, desde: deLocal(desde), hasta: deLocal(hasta), porCorreo: tipo === 'aviso' && porCorreo }
      if (original) await llamarAutenticado(`/plataforma/avisos/${original.id}`, { metodo: 'PUT', cuerpo })
      else await llamarAutenticado('/plataforma/avisos', { metodo: 'POST', cuerpo })
      aviso(original ? 'Aviso guardado' : 'Aviso publicado')
      if (!original) { setTexto(''); setDesde(''); setHasta(''); setPorCorreo(false) }
      await alTerminar()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Panel titulo={original ? 'Editar aviso' : 'Aviso nuevo'} detalle="Por ejemplo, un mantenimiento, una función nueva o un cambio de precio.">
      <form onSubmit={(e) => { e.preventDefault(); void guardar() }} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo t="Tipo"><Opciones etiqueta="Tipo de aviso" valor={tipo} alCambiar={setTipo} opciones={[['info', 'Información'], ['aviso', 'Importante']]} /></Campo>
          <Campo t="Para"><Opciones etiqueta="A quién va" valor={para} alCambiar={setPara} opciones={Object.entries(PARA) as [Para, string][]} /></Campo>
        </div>
        <Campo t="Texto">
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={280} rows={3}
            placeholder="Ej. El domingo de 2 a 4 a.m. haremos mantenimiento; la app de reparto sigue funcionando sin conexión."
            className={`${claseInputRecto} resize-y`} />
          <span className="mt-1 block text-right text-xs tabular-nums text-apagado">{texto.length}/280</span>
        </Campo>
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo t="Sale desde">
            <input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} className={claseInputRecto} />
            <span className="mt-1 block text-xs text-apagado">{desde ? <button type="button" onClick={() => setDesde('')} className="font-semibold hover:underline">Que salga ya</button> : 'Vacío: sale en cuanto lo publiques.'}</span>
          </Campo>
          <Campo t="Hasta">
            <input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} className={claseInputRecto} />
            <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-apagado">
              {hasta ? <button type="button" onClick={() => setHasta('')} className="font-semibold hover:underline">Sin fin</button> : <span>Vacío: hasta que lo quites.</span>}
              {([[24, '1 día'], [72, '3 días'], [168, '1 semana']] as const).map(([h, t]) => <button key={h} type="button" onClick={() => durante(h)} className="font-semibold hover:underline">{t}</button>)}
            </span>
          </Campo>
        </div>
        {tipo === 'aviso' && (
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">Mandarlo también por correo</div>
              <div className="text-xs text-apagado">
                {yaMandado ? `Ya salió por correo el ${momento(original!.correo!.enviado)}; los cambios sólo se ven en la app.`
                  : !correoActivo ? 'El correo no está configurado (RESEND_API_KEY).'
                  : `Una sola vez, a ${para === 'todos' ? 'todas las cuentas' : `los ${PARA[para].toLowerCase()}`} de las empresas activas, ${desde && new Date(desde).getTime() > Date.now() ? 'cuando empiece' : 'al publicarlo'}.`}
              </div>
            </div>
            <Interruptor activo={porCorreo && (correoActivo || yaMandado)} alCambiar={(v) => setPorCorreo(v)} etiqueta="Mandarlo también por correo" />
          </div>
        )}
        {texto.trim() && <div><span className="mb-1.5 block text-xs text-apagado">Así se verá:</span><MuestraAviso texto={texto.trim()} tipo={tipo} /></div>}
        {(alReves || vencido) && <p role="alert" className="text-sm font-medium text-ambar">{alReves ? 'El final va después del inicio.' : 'Esa fecha de fin ya pasó: no lo verá nadie.'}</p>}
        {error && <p role="alert" className="text-sm font-medium text-rojo">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={guardando || !texto.trim() || alReves} className={botonPrimario}>{guardando ? 'Guardando…' : original ? 'Guardar cambios' : desde && new Date(desde).getTime() > Date.now() ? 'Programar' : 'Publicar'}</button>
          {original && <button type="button" onClick={() => void alTerminar()} className={botonSuave}>Cancelar</button>}
        </div>
      </form>
    </Panel>
  )
}

// El aviso que el servidor arma solo para cada empresa en prueba: cuántos días antes y si también a sus vendedores.
function AvisoAutomatico({ inicial, alGuardar }: { inicial: { dias: number; vendedores: boolean }; alGuardar: () => Promise<void> }) {
  const [dias, setDias] = useState(String(inicial.dias))
  const [vendedores, setVendedores] = useState(inicial.vendedores)
  const [guardando, setGuardando] = useState(false)
  const n = Number(dias || 0)
  const hay = n !== inicial.dias || vendedores !== inicial.vendedores
  async function guardar() {
    setGuardando(true)
    try {
      await llamarAutenticado('/plataforma/ajustes', { metodo: 'PATCH', cuerpo: { avisoPruebaDias: n, avisoPruebaVendedores: vendedores } })
      aviso('Aviso automático guardado')
      await alGuardar()
    } catch (e) {
      aviso(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }
  const ejemplo = Math.min(3, n) || 1
  return (
    <Panel titulo="Prueba por vencer" detalle="Automático: a cada empresa en prueba gratis, sin suscripción en marcha, en sus últimos días. Cambia solo cada día.">
      <div className="space-y-5">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Avisar
          <input inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 2))}
            aria-label="Días antes del fin de la prueba" className={`${claseInputRecto} max-w-20 text-center tabular-nums`} />
          días antes de que termine
        </label>
        {n > 60 && <p role="alert" className="text-sm font-medium text-rojo">Hasta 60 días antes.</p>}
        {n === 0 ? <p className="text-sm text-apagado">En 0 no sale ningún aviso automático.</p> : (
          <>
            <div><span className="mb-1.5 block text-xs text-apagado">A los administradores:</span>
              <MuestraAviso tipo="aviso" accion="Ver suscripción" texto={`${ejemplo === 1 ? 'Queda 1 día' : `Quedan ${ejemplo} días`} de prueba gratis. Suscríbete para que tu equipo no pierda el acceso.`} /></div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">También a los vendedores</div>
                <div className="text-xs text-apagado">Para que le recuerden a su administrador.</div>
              </div>
              <Interruptor activo={vendedores} alCambiar={setVendedores} etiqueta="También a los vendedores" />
            </div>
            {vendedores && <MuestraAviso tipo="aviso" texto={`${ejemplo === 1 ? 'Queda 1 día' : `Quedan ${ejemplo} días`} de prueba gratis de Tu Empresa. Avísale a tu administrador para que no se corte el acceso.`} />}
          </>
        )}
        {hay && (
          <div className="flex gap-3">
            <button type="button" onClick={() => void guardar()} disabled={guardando || n > 60} className={botonPrimario}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" onClick={() => { setDias(String(inicial.dias)); setVendedores(inicial.vendedores) }} className={botonSuave}>Deshacer</button>
          </div>
        )}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------------------------------------- servicio

interface AjustesPlataforma {
  registroAbierto: boolean
  pruebaDias: number
  pruebaDiasPropia: number | null
  correoSoporte: string | null
  actualizado: string | null
}
interface EstadoServicio {
  ajustes: AjustesPlataforma
  pruebaDiasEntorno: number
  cobro: boolean
  precioMensual: number
  moneda: string
  webhookFirmado: boolean
  invitacionDias: number
  correo: boolean
  remitente: string
  push: boolean
  urlApp: string
  zonaHoraria: string
  produccion: boolean
  despliegue: { commit: string | null; mensaje: string | null; entorno: string | null; region: string | null }
  seguridad: { sesionDias: number; accesoMinutos: number; maxIntentos: number; bloqueoMinutos: number }
  base: { version: string; tamano: number }
  uso: { usuarios: number; sesiones: number; dispositivosPush: number; invitaciones: number }
}

// Las dos pantallas de Configuración que son de la plataforma piden lo mismo (GET /plataforma/servicio).
function useServicio() {
  const [s, setS] = useState<EstadoServicio | null>(null)
  const [error, setError] = useState('')
  const cargar = () => llamarAutenticado<EstadoServicio>('/plataforma/servicio').then(setS).catch((e) => setError(mensaje(e)))
  useEffect(() => { void cargar() }, [])
  return { s, error, cargar }
}

function Interruptor({ activo, alCambiar, etiqueta }: { activo: boolean; alCambiar: (v: boolean) => void; etiqueta: string }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
      <input type="checkbox" role="switch" checked={activo} onChange={(e) => alCambiar(e.target.checked)} className="peer sr-only" aria-label={etiqueta} />
      <span className="h-7 w-12 rounded-full bg-linea transition-colors peer-checked:bg-[var(--plat)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marca" />
      <span className="absolute left-1 top-1 h-5 w-5 rounded-full bg-papel shadow transition-transform peer-checked:translate-x-5" />
    </label>
  )
}

// Configuración → Ajustes: lo que se cambia sin volver a desplegar (tabla plataforma_ajustes). Se guarda junto, con
// «Guardar»; sólo viaja lo que cambió.
function AjustesServicio() {
  const { s, error, cargar } = useServicio()
  const [b, setB] = useState<{ registroAbierto: boolean; pruebaDias: string; correoSoporte: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState('')
  const desde = (a: AjustesPlataforma) => ({
    registroAbierto: a.registroAbierto,
    pruebaDias: a.pruebaDiasPropia === null ? '' : String(a.pruebaDiasPropia),
    correoSoporte: a.correoSoporte ?? '',
  })
  useEffect(() => { if (s) setB(desde(s.ajustes)) }, [s])
  if (error) return <p role="alert" className="text-sm font-medium text-rojo">{error}</p>
  if (!s || !b) return <p className="text-sm text-apagado">Cargando…</p>

  const o = desde(s.ajustes)
  const cambios = {
    ...(b.registroAbierto !== o.registroAbierto ? { registroAbierto: b.registroAbierto } : {}),
    ...(b.pruebaDias.trim() !== o.pruebaDias ? { pruebaDias: b.pruebaDias.trim() === '' ? null : Number(b.pruebaDias) } : {}),
    ...(b.correoSoporte.trim() !== o.correoSoporte ? { correoSoporte: b.correoSoporte.trim() || null } : {}),
  }
  const hay = Object.keys(cambios).length > 0
  const poner = (c: Partial<NonNullable<typeof b>>) => { setErrorGuardar(''); setB((x) => x && { ...x, ...c }) }

  async function guardar() {
    setGuardando(true)
    setErrorGuardar('')
    try {
      await llamarAutenticado('/plataforma/ajustes', { metodo: 'PATCH', cuerpo: cambios })
      aviso('Ajustes guardados')
      await cargar()
    } catch (e) {
      setErrorGuardar(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <Seccion id="registro" titulo="Empresas nuevas" descripcion="Cómo llegan los negocios a Delisy.">
        <Fila titulo="Registro abierto" ayuda={b.registroAbierto ? 'Cualquiera puede dar de alta su negocio en /registro.' : 'Cerrado: /registro avisa que no hay altas y no manda códigos. Tú sigues pudiendo dar de alta desde «Nueva empresa».'}>
          <Interruptor activo={b.registroAbierto} alCambiar={(v) => poner({ registroAbierto: v })} etiqueta="Registro abierto" />
        </Fila>
        <Fila titulo="Días de prueba gratis" ayuda={`Para cada empresa nueva, se registre sola o la des de alta tú. Vacío: ${s.pruebaDiasEntorno} días (PRUEBA_DIAS). Las que ya existen no cambian.`}>
          <label className="flex items-center gap-2 text-sm">
            <input inputMode="numeric" value={b.pruebaDias} onChange={(e) => poner({ pruebaDias: e.target.value.replace(/\D/g, '').slice(0, 3) })}
              placeholder={String(s.pruebaDiasEntorno)} aria-label="Días de prueba gratis" className={`${claseInputRecto} max-w-24 text-center tabular-nums`} />
            días
          </label>
        </Fila>
      </Seccion>

      <Seccion id="soporte" titulo="Soporte" descripcion="A dónde te escriben las empresas: sale en la pantalla de cobro y con el registro cerrado.">
        <input type="email" value={b.correoSoporte} onChange={(e) => poner({ correoSoporte: e.target.value })} maxLength={150}
          placeholder="soporte@tudominio.com" aria-label="Correo de soporte" className={`${claseInputRecto} max-w-md`} />
      </Seccion>

      <div className="flex flex-wrap items-center gap-3 border-t border-linea pt-6">
        <button type="button" onClick={() => void guardar()} disabled={!hay || guardando} className={botonPrimario}>{guardando ? 'Guardando…' : 'Guardar ajustes'}</button>
        {hay && <button type="button" onClick={() => { setErrorGuardar(''); setB(o) }} className={botonSuave}>Deshacer</button>}
        {errorGuardar && <p role="alert" className="text-sm font-medium text-rojo">{errorGuardar}</p>}
        {!hay && s.ajustes.actualizado && <span className="text-xs text-apagado">Último cambio: {new Date(s.ajustes.actualizado).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
      </div>
    </>
  )
}

const megas = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`)

// Configuración → Servicio: cómo está Delisy en el servidor. Sólo se lee: lo del entorno se cambia en Vercel y se vuelve
// a desplegar. El servidor nunca manda las claves, sólo si están puestas.
function Servicio() {
  const { s, error } = useServicio()
  if (error) return <p role="alert" className="text-sm font-medium text-rojo">{error}</p>
  if (!s) return <p className="text-sm text-apagado">Cargando…</p>
  const listo = (ok: boolean, si: string, no: string) => (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold ${ok ? 'text-verde' : 'text-ambar'}`}>
      {ok ? <Check size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}{ok ? si : no}
    </span>
  )
  const d = s.despliegue
  return (
    <>
      <Seccion id="uso" titulo="Ahora mismo" descripcion="Sin contar las cuentas de la plataforma.">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          {[
            [s.uso.usuarios, 'Cuentas activas'],
            [s.uso.sesiones, 'Sesiones abiertas'],
            [s.uso.dispositivosPush, 'Teléfonos con avisos'],
            [s.uso.invitaciones, 'Invitaciones pendientes'],
          ].map(([n, t]) => (
            <div key={t}>
              <dt className="text-xs font-medium text-apagado">{t}</dt>
              <dd className="mt-1 text-[1.6rem] font-semibold leading-none tracking-tight tabular-nums">{n}</dd>
            </div>
          ))}
        </dl>
      </Seccion>
      <Seccion id="cobro" titulo="Cobro" descripcion="La suscripción mensual de cada empresa, con Mercado Pago.">
        <Fila titulo="Mercado Pago" ayuda={s.cobro ? `${dinero(s.precioMensual)} ${s.moneda} al mes por empresa.` : 'Sin MP_ACCESS_TOKEN y MP_PRECIO_MENSUAL nadie puede suscribirse; la app funciona igual.'}>
          {listo(s.cobro, 'Activo', 'Sin configurar')}
        </Fila>
        <Fila titulo="Avisos de pago firmados" ayuda="MP_WEBHOOK_SECRET: el servidor sólo cree los avisos de Mercado Pago que vienen firmados.">
          {listo(s.webhookFirmado, 'Activos', 'Falta la clave')}
        </Fila>
      </Seccion>
      <Seccion id="comunicacion" titulo="Correo y avisos" descripcion="Lo que la plataforma manda a las empresas y a sus repartidores.">
        <Fila titulo="Correo" ayuda={s.correo ? `Sale como ${s.remitente}.` : 'Sin RESEND_API_KEY no salen invitaciones ni códigos (fuera de producción van a la consola).'}>
          {listo(s.correo, 'Activo', 'Sin configurar')}
        </Fila>
        <Fila titulo="Notificaciones push" ayuda="Claves VAPID (npm run push:claves): avisos de pedidos urgentes y cambios de ruta en los teléfonos.">
          {listo(s.push, 'Activas', 'Sin configurar')}
        </Fila>
        <Fila titulo="Invitaciones" ayuda="Cuánto vale el enlace que reciben los administradores y repartidores nuevos.">
          <span className="text-sm font-semibold tabular-nums">{s.invitacionDias} días</span>
        </Fila>
      </Seccion>
      <Seccion id="acceso" titulo="Acceso" descripcion="Cómo se protegen las cuentas de todas las empresas.">
        <Fila titulo="Sesión" ayuda="Cuánto dura una sesión sin volver a escribir la contraseña, y cada cuánto se renueva el permiso de acceso.">
          <span className="text-sm font-semibold tabular-nums">{s.seguridad.sesionDias} días · {s.seguridad.accesoMinutos} min</span>
        </Fila>
        <Fila titulo="Intentos fallidos" ayuda="Tras estos intentos seguidos con una cuenta desde una conexión, esa conexión espera antes de volver a probar.">
          <span className="text-sm font-semibold tabular-nums">{s.seguridad.maxIntentos} intentos · {s.seguridad.bloqueoMinutos} min</span>
        </Fila>
        <Fila titulo="Verificación en dos pasos" ayuda="Obligatoria para las cuentas de la plataforma; opcional para las empresas.">
          {listo(true, 'Obligatoria aquí', '')}
        </Fila>
      </Seccion>
      <Seccion id="entorno" titulo="Entorno" descripcion="Se cambian en las variables de entorno de Vercel y aplican al volver a desplegar.">
        <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
          <Dato t="Versión desplegada" v={d.commit ? <span className="font-mono">{d.commit}</span> : 'Local'} />
          <Dato t="Entorno" v={d.entorno ? ({ production: 'Producción', preview: 'Vista previa', development: 'Desarrollo' } as Record<string, string>)[d.entorno] ?? d.entorno : s.produccion ? 'Producción' : 'Desarrollo'} />
          <Dato t="Región" v={d.region ?? '—'} />
          {d.mensaje && <div className="sm:col-span-3"><Dato t="Último cambio" v={d.mensaje} /></div>}
          <Dato t="Dirección de la app" v={<span className="break-all">{s.urlApp}</span>} />
          <Dato t="Zona horaria del servidor" v={s.zonaHoraria} />
          <Dato t="Base de datos" v={`PostgreSQL ${s.base.version} · ${megas(s.base.tamano)}`} />
        </dl>
      </Seccion>
    </>
  )
}
