import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarHeart, ChevronRight, Crown, Flame, RefreshCw, TriangleAlert } from 'lucide-react'
import { Medallas } from '../../components/Medallas'
import type { Rachas } from '../../lib/equipo'
import { abrirFicha } from '../pwa/Equipo'
import { litrosTxt, ordenarPorVentas, saludo, usePedidosRecientes, useVentasPorSabor } from '../../lib/admin-datos'
import { db } from '../../lib/db'
import { DIAS_CORTOS, desdeIso, dinero, hoy, sumarDias } from '../../lib/fechas'
import { cambio, useReporte } from '../../lib/reportes'
import { llamarAutenticado, useSesion } from '../../lib/sesion'
import { enVivoConectado, useEnVivo, useEnVivoConectado } from '../../lib/enVivo'
import type { SeccionAdmin } from './AdminLayout'
import { BarraSegmentada, BarrasPeriodo } from './graficas'
import { useFichaSabor } from './PanelSabor'
import { textoPorUnidad } from '../../lib/unidades'
import { useServidor, type CifrasMes } from '../../lib/cobranza'
import { ChipEstado, Delta, Subrayado, TarjetaSabor, Vacio } from './piezas'

export interface DashboardStats {
  fecha: string
  vendedores: {
    total: number
    activos: number
  }
  clientes: {
    total: number
    activos: number
    sinVendedor: number
  }
  productos: {
    total: number
    disponibles: number
  }
  pedidosHoy: {
    total: number
    pendientes: number
    enCamino: number
    entregados: number
    omitidos: number
    cancelados: number
    totalCobrado: number
    totalEsperado: number
    litrosHoy: number
    cantidadesHoy?: Record<string, number> // por unidad (catálogo flexible)
    unidades?: string[] // las de la empresa, L primero
  }
  saboresTop: Array<{
    sabor: string
    color: string
    litros: number
  }>
}

const SABORES_POR_PAGINA = 6
const botonRedondo = 'grid h-10 w-10 shrink-0 place-items-center rounded-full bg-papel text-tinta transition-colors hover:bg-linea/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-40 disabled:hover:bg-papel'

function Tarjeta({ id, titulo, subtitulo, accion, className = '', children }: { id: string; titulo: string; subtitulo?: ReactNode; accion?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={`rounded-[28px] bg-niebla p-5 sm:p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-semibold leading-tight">{titulo}</h2>
          {subtitulo && <p className="mt-1 text-[13px] text-apagado">{subtitulo}</p>}
        </div>
        {accion}
      </div>
      {children}
    </section>
  )
}

function Cifra({ etiqueta, valor, pie }: { etiqueta: string; valor: string; pie?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-apagado">{etiqueta}</dt>
      <dd className="mt-1.5">
        <span className="cifra block whitespace-nowrap text-[2rem] sm:text-[2.25rem]">{valor}</span>
        <span className="mt-2 flex min-h-5 items-center gap-1.5 whitespace-nowrap text-xs text-apagado">{pie}</span>
      </dd>
    </div>
  )
}

const esperando = <div className="mt-4 h-28 animate-pulse rounded-2xl bg-linea/60" aria-hidden="true" />

export function AdminDashboard({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const sesion = useSesion()
  const dia = hoy()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [girando, setGirando] = useState(false) // sólo al tocar «Actualizar»: lo automático no se anuncia
  const enVivo = useEnVivoConectado()
  const [error, setError] = useState<string | null>(null)
  const [ultima, setUltima] = useState<Date | null>(null)
  const [pagina, setPagina] = useState(0)

  // Los últimos 30 días del servidor (los mismos números que Reportes) para las cifras y el gráfico de la semana.
  const rango = useMemo(() => ({ desde: sumarDias(dia, -29), hasta: dia }), [dia])
  const ventas = useReporte(rango, 'dia')
  const recargarVentas = ventas.recargar

  // Lo que ya se ve se queda mientras llega lo nuevo: nada parpadea ni dice «actualizando».
  async function cargar() {
    try {
      setStats(await llamarAutenticado<DashboardStats>('/admin/stats'))
      setUltima(new Date())
      setError(null)
    } catch {
      setError('No se pudo traer el resumen. Revisa tu conexión e intenta de nuevo.')
    }
  }
  async function aMano() {
    setGirando(true)
    recargarVentas()
    await cargar()
    setGirando(false)
  }

  // En vivo: cuando cambia un pedido, un cliente o un sabor en la empresa (lib/enVivo.ts). Las ventas (useReporte) se piden solas.
  useEnVivo('datos', () => void cargar())

  // Sin la conexión en vivo (sin señal, o el servidor no la da) se refresca cada minuto mientras se ve. Al volver a la
  // pestaña la conexión en vivo ya avisa de todo.
  useEffect(() => {
    void cargar()
    const reloj = setInterval(() => { if (document.visibilityState === 'visible' && !enVivoConectado()) { void cargar(); recargarVentas() } }, 60_000)
    return () => clearInterval(reloj)
  }, [recargarVentas])

  const productos = useLiveQuery(() => db.productos.toArray(), [])
  const ventasSabor = useVentasPorSabor()
  const ordenados = ordenarPorVentas(productos ?? [], ventasSabor)
  const ficha = useFichaSabor(ordenados)
  const recientes = usePedidosRecientes(5)

  const p = stats?.pedidosHoy
  // Los cancelados no cuentan para el avance: ya no hay que entregarlos.
  const porAtender = p ? p.total - p.cancelados : 0
  const atendidos = p ? p.entregados + p.omitidos : 0
  const avance = porAtender ? Math.round((atendidos / porAtender) * 100) : 0
  const nombre = sesion?.usuario.nombre.split(' ')[0] ?? ''
  const fechaTexto = stats ? desdeIso(stats.fecha).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }) : ''
  const valor = (texto: string) => (stats ? texto : '—')

  const reporte = ventas.reporte
  const crecimiento = reporte ? cambio(reporte.resumen.ingreso, reporte.anterior?.resumen.ingreso) : null
  const porDia = new Map((reporte?.periodos ?? []).map((x) => [x.periodo, x]))
  const semana = Array.from({ length: 7 }, (_, i) => {
    const f = sumarDias(dia, i - 6)
    const d = desdeIso(f)
    return {
      clave: f,
      eje: f === dia ? 'Hoy' : DIAS_CORTOS[d.getDay()],
      nombre: d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
      valor: porDia.get(f)?.ingreso ?? 0,
      actual: f === dia,
    }
  })
  const totalSemana = semana.reduce((s, x) => s + x.valor, 0)

  const segmentos = [
    { nombre: 'Entregados', n: p?.entregados ?? 0, color: 'var(--color-serie)' },
    { nombre: 'En camino', n: p?.enCamino ?? 0, color: 'var(--color-oro)' },
    { nombre: 'Pendientes', n: p?.pendientes ?? 0, color: '#c3c1a8' },
    { nombre: 'Sin venta', n: p?.omitidos ?? 0, color: '#8a9186' },
  ]

  const paginas = Math.max(1, Math.ceil(ordenados.length / SABORES_POR_PAGINA))
  const paginaActual = Math.min(pagina, paginas - 1)
  const visibles = ordenados.slice(paginaActual * SABORES_POR_PAGINA, (paginaActual + 1) * SABORES_POR_PAGINA)
  const corto = (f: string) => (f === dia ? 'Hoy' : f === sumarDias(dia, -1) ? 'Ayer' : desdeIso(f).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', ''))
  const pedidosRecientes = <PedidosRecientes recientes={recientes} corto={corto} onNavegar={onNavegar} />

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-2 sm:px-8">
      <section className="flex flex-col gap-x-12 gap-y-7 pb-8 pt-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-5xl xl:text-[3.5rem]">
            {saludo()},
            <br />
            <Subrayado>{nombre || 'equipo'}</Subrayado>
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-apagado">
            <span className="first-letter:uppercase">{fechaTexto || 'Cargando…'}</span>
            {!enVivo && <button
              type="button"
              onClick={() => void aMano()}
              disabled={girando}
              className="flex items-center gap-1.5 rounded-md py-1 font-medium text-tinta hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-60"
            >
              <RefreshCw size={14} className={girando ? 'animate-spin' : ''} aria-hidden="true" />
              {ultima ? `Actualizado ${ultima.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Actualizar'}
            </button>}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:flex sm:flex-wrap sm:gap-x-10">
          <Cifra etiqueta="Cobrado hoy" valor={valor(dinero(p?.totalCobrado ?? 0))} pie={stats && p!.totalEsperado > p!.totalCobrado ? `de ${dinero(p!.totalEsperado)} esperados` : undefined} />
          <Cifra
            etiqueta="Ventas, 30 días"
            valor={reporte ? dinero(reporte.resumen.ingreso) : '—'}
            pie={reporte && crecimiento !== null ? <><Delta valor={crecimiento} /> <span>vs. 30 días antes</span></> : undefined}
          />
          <Cifra etiqueta="Pedidos de hoy" valor={valor(String(porAtender))} />
          <Cifra etiqueta={(p?.unidades ?? ['L']).some((u) => u !== 'L') ? 'Cantidad de hoy' : 'Litros de hoy'} valor={valor(p?.cantidadesHoy ? textoPorUnidad(p.cantidadesHoy, p.unidades) : litrosTxt(p?.litrosHoy ?? 0))} />
        </dl>
      </section>

      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-rojo/10 p-4 text-sm font-medium text-rojo">
          <span>{error}{stats && ' Los números de abajo son de la última vez.'}</span>
          <button onClick={() => void cargar()} className="shrink-0 font-semibold underline underline-offset-2">Reintentar</button>
        </div>
      )}

      {!!stats?.clientes.sinVendedor && (
        <button
          onClick={() => onNavegar('clientes')}
          className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-ambar/25 p-4 text-left text-sm transition-colors hover:bg-ambar/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
        >
          <TriangleAlert size={20} className="shrink-0" aria-hidden="true" />
          <span className="flex-1">
            <strong className="font-semibold">
              {stats.clientes.sinVendedor === 1 ? 'Un cliente no tiene vendedor' : `${stats.clientes.sinVendedor} clientes no tienen vendedor`}
            </strong>{' '}
            y no aparece en ninguna ruta.
          </span>
          <span className="flex items-center font-semibold">Asignar <ChevronRight size={16} aria-hidden="true" /></span>
        </button>
      )}

      {/* Dos columnas que se apilan cada una por su lado (en pantallas chicas, una sola): así ninguna tarjeta se estira
          para igualar el alto de la otra columna ni queda un hueco al lado de la última. */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="grid gap-4">
        {/* Los sabores son los productos: se ordenan por los litros que vendieron en 30 días */}
        <Tarjeta
          id="t-sabores"
          titulo="Sabores más vendidos"
          subtitulo={(p?.unidades ?? ['L']).some((u) => u !== 'L') ? 'Lo entregado en los últimos 30 días' : 'Litros entregados en los últimos 30 días'}
          className="flex flex-col"
          accion={paginas > 1 && (
            <div className="flex gap-2">
              <button type="button" aria-label="Sabores anteriores" disabled={paginaActual === 0} onClick={() => setPagina(paginaActual - 1)} className={botonRedondo}><ArrowLeft size={18} /></button>
              <button type="button" aria-label="Más sabores" disabled={paginaActual === paginas - 1} onClick={() => setPagina(paginaActual + 1)} className={botonRedondo}><ArrowRight size={18} /></button>
            </div>
          )}
        >
          {productos && !ordenados.length ? (
            <Vacio>Todavía no hay sabores. Agrégalos en la sección Sabores.</Vacio>
          ) : (
            <ul className="mt-5 grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-3">
              {visibles.map((x) => (
                <li key={x.producto.id}>
                  <TarjetaSabor producto={x.producto} venta={x.venta} posicion={x.posicion} frasco="h-28 xl:h-36" onAbrir={() => ficha.abrir(x.producto.id)} />
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
        {pedidosRecientes}
        </div>

        <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Tarjeta id="t-semana" titulo="Ventas por día" subtitulo={reporte ? `${dinero(totalSemana)} en los últimos 7 días` : 'Últimos 7 días'}>
            <div className="mt-5">
              {ventas.error && !reporte ? (
                <p className="rounded-2xl bg-rojo/10 p-3 text-sm font-medium text-rojo">
                  No se pudieron traer las ventas. <button className="font-semibold underline underline-offset-2" onClick={recargarVentas}>Reintentar</button>
                </p>
              ) : !reporte ? esperando : (
                <BarrasPeriodo datos={semana} formato={dinero} descripcion="Ventas entregadas de cada uno de los últimos 7 días" leyenda={['Días previos', 'Hoy']} />
              )}
            </div>
          </Tarjeta>

          <Tarjeta
            id="t-avance"
            titulo="Avance de hoy"
            subtitulo="Pedidos atendidos"
            accion={<button type="button" aria-label="Abrir los reportes" title="Reportes" onClick={() => onNavegar('reportes')} className={botonRedondo}><ArrowUpRight size={18} /></button>}
          >
            <p className="cifra mt-4 text-[3rem]">{stats ? `${avance}%` : '—'}</p>
            <p className="mt-2 text-[13px] text-apagado">{stats ? (porAtender ? `${atendidos} de ${porAtender} pedidos` : 'No hay pedidos agendados para hoy') : 'Cargando…'}</p>
            <div className="mt-5">
              <BarraSegmentada segmentos={segmentos} descripcion={segmentos.map((s) => `${s.nombre}: ${s.n}`).join(', ')} />
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px]">
              {segmentos.map((s) => (
                <li key={s.nombre} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                  <span className="text-apagado">{s.nombre}</span>
                  <span className="ml-auto font-semibold tabular-nums">{stats ? s.n : '—'}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>

        <ResumenDelAnio onNavegar={onNavegar} />
        <MedallasDelMes onNavegar={onNavegar} />
        <RankingMes onNavegar={onNavegar} />
        </div>
      </div>

      {ficha.panel}
    </div>
  )
}

function PedidosRecientes({ recientes, corto, onNavegar }: { recientes: ReturnType<typeof usePedidosRecientes>; corto: (f: string) => string; onNavegar: (seccion: SeccionAdmin) => void }) {
  return (
        <Tarjeta
          id="t-pedidos"
          titulo="Pedidos recientes"
          accion={<button type="button" onClick={() => onNavegar('reportes')} className="rounded-md py-1 text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">Ver reportes</button>}
        >
          {recientes && !recientes.length ? (
            <Vacio>Cuando haya pedidos aparecen aquí.</Vacio>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-xs text-apagado">
                <tr>
                  <th scope="col" className="w-full pb-2 text-left font-medium">Cliente</th>
                  <th scope="col" className="pb-2 pl-3 text-right font-medium">Total</th>
                  <th scope="col" className="pb-2 pl-4 text-left font-medium">Estado</th>
                  <th scope="col" className="hidden pb-2 pl-4 text-right font-medium sm:table-cell">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {(recientes ?? []).map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className="max-w-0 py-3 text-left font-semibold">
                      <span className="block truncate">{r.cliente}</span>
                      <span className="block text-xs font-normal text-apagado sm:hidden">{corto(r.fecha)}</span>
                    </th>
                    <td className="whitespace-nowrap py-3 pl-3 text-right font-semibold tabular-nums">{dinero(r.total)}</td>
                    <td className="py-3 pl-4"><ChipEstado estado={r.estado} /></td>
                    <td className="hidden whitespace-nowrap py-3 pl-4 text-right text-apagado tabular-nums sm:table-cell">{corto(r.fecha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
  )
}

// Vendedores del mes, de quien más vendió a quien menos, con su avance contra la meta. Sólo el administrador ve esta
// pantalla; las cifras son las del cierre de mes en vivo (GET /cierres/:mes).
// En diciembre (el año en curso) y en enero (el que acaba de terminar): el año en números (AnioEnNumeros, también en
// Cobranza → Meses para cualquier año).
function ResumenDelAnio({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const [a, m] = hoy().slice(0, 7).split('-').map(Number)
  const anio = m === 12 ? a : m === 1 ? a - 1 : null
  const r = useServidor<ResumenAnio>(anio ? `/cierres/anio/${anio}` : null, 'cobranza').datos
  if (!anio || !r || !r.meses.length) return null
  return (
    <Tarjeta id="t-anio" titulo={`Tu ${anio} en números`} subtitulo={`Con ${r.meses.length} ${r.meses.length === 1 ? 'mes cerrado' : 'meses cerrados'}${m === 12 ? '; diciembre se suma al cerrarlo' : ''}`}
      accion={<CalendarHeart size={20} className="text-marca" aria-hidden="true" />}>
      <AnioEnNumeros r={r} onFicha={(id) => { abrirFicha(id); onNavegar('equipo') }} />
    </Tarjeta>
  )
}

// Las cifras del año (GET /cierres/anio/:anio): lo vendido mes a mes, el mes más vendido, el vendedor del año y la mejor
// racha. Tocar a una persona abre su ficha.
export interface ResumenAnio {
  anio: number
  meses: { mes: string; ventas: number }[]
  total: number
  mesMasVendido: { mes: string; ventas: number } | null
  vendedorDelAnio: { id: string; nombre: string; ventas: number } | null
  mejorRacha: { id: string; nombre: string; meses: number } | null
  anterior: { anio: number; meses: number; total: number; actual: number } | null
}
export function AnioEnNumeros({ r, onFicha }: { r: ResumenAnio; onFicha: (id: string) => void }) {
  const nombreMes = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'long' })
  const tope = Math.max(1, ...r.meses.map((x) => x.ventas))
  const ficha = onFicha
  const dato = 'desplegar-opcion rounded-xl bg-papel p-3'
  return (
    <>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <div className={dato}>
          <p className="text-xs text-apagado">Vendido en el año</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{dinero(r.total)}</p>
          {r.anterior && r.anterior.total > 0 && (() => {
            const pct = Math.round(((r.anterior.actual - r.anterior.total) / r.anterior.total) * 100)
            return (
              <p className="mt-0.5 text-xs" title={`${dinero(r.anterior.actual)} contra ${dinero(r.anterior.total)} en los mismos ${r.anterior.meses} meses de ${r.anterior.anio}`}>
                <span className={`font-semibold ${pct > 0 ? 'text-verde' : pct < 0 ? 'text-rojo' : ''}`}>{pct > 0 ? '+' : ''}{pct}%</span>
                <span className="text-apagado"> contra {r.anterior.anio}</span>
              </p>
            )
          })()}
        </div>
        {r.mesMasVendido && (
          <div className={dato} style={{ animationDelay: '40ms' }}>
            <p className="text-xs text-apagado">Mes más vendido</p>
            <p className="mt-1 font-semibold capitalize">{nombreMes(r.mesMasVendido.mes)}</p>
            <p className="text-sm tabular-nums text-apagado">{dinero(r.mesMasVendido.ventas)}</p>
          </div>
        )}
        {r.vendedorDelAnio && (
          <button type="button" onClick={() => ficha(r.vendedorDelAnio!.id)} style={{ animationDelay: '80ms' }}
            className={`${dato} text-left transition-[transform,background-color] duration-150 hover:bg-linea active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca motion-reduce:active:scale-100`}>
            <p className="flex items-center gap-1 text-xs text-apagado"><Crown size={13} aria-hidden="true" className="text-marca" /> Vendedor del año</p>
            <p className="mt-1 truncate font-semibold">{r.vendedorDelAnio.nombre}</p>
            <p className="text-sm tabular-nums text-apagado">{dinero(r.vendedorDelAnio.ventas)}</p>
          </button>
        )}
        {r.mejorRacha && (
          <button type="button" onClick={() => ficha(r.mejorRacha!.id)} style={{ animationDelay: '120ms' }}
            className={`${dato} text-left transition-[transform,background-color] duration-150 hover:bg-linea active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca motion-reduce:active:scale-100`}>
            <p className="flex items-center gap-1 text-xs text-apagado"><Flame size={13} aria-hidden="true" className="text-marca" /> Mejor racha</p>
            <p className="mt-1 truncate font-semibold">{r.mejorRacha.nombre}</p>
            <p className="text-sm text-apagado">{r.mejorRacha.meses} {r.mejorRacha.meses === 1 ? 'mes' : 'meses seguidos'} en su meta</p>
          </button>
        )}
      </div>
      <ol className="mt-10 flex h-20 items-end gap-1" aria-label="Lo vendido en cada mes cerrado">
        {r.meses.map((x) => (
          // Al pasar el mouse (o al enfocarla con el teclado o tocarla) sale un globito con el mes y la cifra.
          <li key={x.mes} tabIndex={0} className="group relative flex h-full flex-1 flex-col items-center justify-end gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-marca">
            <span role="tooltip" className="pointer-events-none absolute bottom-full z-10 mb-1 translate-y-1 whitespace-nowrap rounded-lg bg-tinta px-2.5 py-1.5 text-center text-xs text-papel opacity-0 shadow-tarjeta transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus:translate-y-0 group-focus:opacity-100 motion-reduce:transition-none"
              style={{ bottom: `${Math.max(3, (x.ventas / tope) * 100)}%` }}>
              <span className="block capitalize">{nombreMes(x.mes)}</span>
              <span className="block font-semibold tabular-nums">{dinero(x.ventas)}</span>
            </span>
            <span className={`w-full max-w-8 rounded-t-md transition-[filter] duration-150 group-hover:brightness-110 ${x.mes === r.mesMasVendido?.mes ? 'bg-marca' : 'bg-marca/40'}`} style={{ height: `${Math.max(3, (x.ventas / tope) * 100)}%` }} />
            <span className="text-[10px] capitalize text-apagado">{nombreMes(x.mes).slice(0, 3)}</span>
            <span className="sr-only">{dinero(x.ventas)}</span>
          </li>
        ))}
      </ol>
    </>
  )
}

// Quién ganó una medalla con el mes pasado (3, 6 o 12 meses seguidos en su meta): sólo aparece si alguien la ganó, es
// decir, una vez cerrado ese mes. Tocar a alguien abre su ficha, desde donde se le puede felicitar.
function MedallasDelMes({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const rachas = useServidor<Rachas>('/usuarios/rachas', 'cobranza').datos
  const pasado = moverMes(hoy().slice(0, 7), -1)
  const ganadas = Object.entries(rachas ?? {}).flatMap(([id, r]) => r.medallas.filter((m) => m.mes === pasado).map((m) => ({ id, nombre: r.nombre, medalla: m.medalla })))
  if (!ganadas.length) return null
  const nombreMes = new Date(`${pasado}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'long' })
  return (
    <Tarjeta id="t-medallas" titulo={`Medallas de ${nombreMes}`} subtitulo="Llegaron a su meta varios meses seguidos. Un buen momento para felicitarlos.">
      <ul className="mt-3 flex flex-wrap gap-2">
        {ganadas.map((g, i) => (
          <li key={`${g.id}-${g.medalla}`} className="medalla-nueva" style={{ animationDelay: `${i * 60}ms` }}>
            <button type="button" onClick={() => { abrirFicha(g.id); onNavegar('equipo') }}
              className="flex items-center gap-2 rounded-full bg-papel py-1.5 pl-1.5 pr-3.5 text-sm transition-[transform,background-color] duration-150 hover:bg-linea active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca motion-reduce:active:scale-100">
              <Medallas mejorRacha={g.medalla} soloMejor />
              <span className="font-semibold">{g.nombre}</span>
              <span className="text-apagado">{g.medalla === 12 ? '1 año' : `${g.medalla} meses`}</span>
            </button>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}

// Con las flechas se ven los meses anteriores (hasta dos años): los cerrados con la foto de su cierre.
const MESES_ATRAS = 24
const moverMes = (mes: string, n: number) => {
  const [a, m] = mes.split('-').map(Number)
  const f = new Date(a, m - 1 + n, 1)
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`
}
function RankingMes({ onNavegar }: { onNavegar: (seccion: SeccionAdmin) => void }) {
  const actual = hoy().slice(0, 7)
  const [atras, setAtras] = useState(0)
  const mes = moverMes(actual, -atras)
  const r = useServidor<{ cifras: CifrasMes }>(`/cierres/${mes}`, ['datos', 'cobranza', 'equipo'])
  // La racha de hoy (meses seguidos en la meta hasta el mes pasado) y la mejor medalla de cada quien.
  const rachas = useServidor<Rachas>('/usuarios/rachas', 'cobranza').datos ?? {}
  const filas = (r.datos?.cifras.mes === mes ? r.datos.cifras.vendedores : []).filter((v) => v.activo || v.ventas > 0).sort((a, b) => b.ventas - a.ventas)
  const nombreMes = new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-MX', atras ? { month: 'long', year: 'numeric' } : { month: 'long' })
  const flecha = `grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-papel disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca`
  return (
    <Tarjeta
      id="t-ranking"
      titulo={atras ? 'Vendedores de ese mes' : 'Vendedores del mes'}
      subtitulo={`Lo vendido en ${nombreMes} y cómo le fue a cada quien con su meta`}
      accion={
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setAtras(atras + 1)} disabled={atras >= MESES_ATRAS} aria-label="Mes anterior" title="Mes anterior" className={flecha}><ArrowLeft size={16} /></button>
          <button type="button" onClick={() => setAtras(atras - 1)} disabled={atras === 0} aria-label="Mes siguiente" title="Mes siguiente" className={flecha}><ArrowRight size={16} /></button>
          <button type="button" onClick={() => onNavegar('equipo')} className="ml-2 rounded-md py-1 text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">Ver vendedores</button>
        </div>
      }
    >
      {r.error && !r.datos ? (
        <p className="mt-3 rounded-2xl bg-rojo/10 p-3 text-sm font-medium text-rojo">No se pudo traer el mes. <button className="font-semibold underline underline-offset-2" onClick={r.recargar}>Reintentar</button></p>
      ) : !r.datos || r.datos.cifras.mes !== mes ? (
        <p className="mt-3 text-sm text-apagado">Cargando…</p>
      ) : !filas.length ? (
        <Vacio>{atras ? 'Ese mes no hubo ventas de vendedores.' : 'Cuando tus vendedores entreguen pedidos este mes aparecen aquí.'}</Vacio>
      ) : (
        <ol className="mt-3 divide-y divide-linea">
          {filas.map((v, i) => {
            const pct = v.meta ? Math.round(v.cumplimientoPct ?? 0) : null
            return (
              <li key={v.id} className="flex items-center gap-3 py-3">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums ${i === 0 && v.ventas > 0 ? 'bg-marca text-white' : 'bg-papel text-apagado'}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-semibold">{v.nombre}</span>
                      {(rachas[v.id]?.racha ?? 0) >= 2 && (
                        <span title={`${rachas[v.id].racha} meses seguidos en su meta`} className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-marca">
                          <Flame size={13} aria-hidden="true" />{rachas[v.id].racha}<span className="sr-only"> meses seguidos en su meta</span>
                        </span>
                      )}
                      <Medallas mejorRacha={rachas[v.id]?.mejorRacha ?? 0} soloMejor />
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{dinero(v.ventas)}</span>
                  </div>
                  {pct !== null ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-linea" role="progressbar" aria-label={`${v.nombre}: ${pct}% de su meta`} aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-full rounded-full ${pct >= 100 ? 'bg-verde' : 'bg-marca'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs text-apagado tabular-nums">{pct}% de {dinero(v.meta!)}</span>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-apagado">{v.pedidos} {v.pedidos === 1 ? 'pedido' : 'pedidos'} · sin meta</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Tarjeta>
  )
}
