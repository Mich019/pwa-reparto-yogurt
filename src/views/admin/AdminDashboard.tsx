import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react'
import { litrosTxt, ordenarPorVentas, saludo, usePedidosRecientes, useVentasPorSabor } from '../../lib/admin-datos'
import { db } from '../../lib/db'
import { DIAS_CORTOS, desdeIso, dinero, hoy, sumarDias } from '../../lib/fechas'
import { cambio, useReporte } from '../../lib/reportes'
import { llamarAutenticado, useSesion } from '../../lib/sesion'
import type { SeccionAdmin } from './AdminLayout'
import { BarraSegmentada, BarrasPeriodo } from './graficas'
import { useFichaSabor } from './PanelSabor'
import { textoPorUnidad } from '../../lib/unidades'
import { ChipEstado, Delta, TarjetaSabor, Vacio } from './piezas'

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
  const [actualizando, setActualizando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ultima, setUltima] = useState<Date | null>(null)
  const [pagina, setPagina] = useState(0)

  // Los últimos 30 días del servidor (los mismos números que Reportes) para las cifras y el gráfico de la semana.
  const rango = useMemo(() => ({ desde: sumarDias(dia, -29), hasta: dia }), [dia])
  const ventas = useReporte(rango, 'dia')
  const recargarVentas = ventas.recargar

  async function cargar() {
    setActualizando(true)
    try {
      setStats(await llamarAutenticado<DashboardStats>('/admin/stats'))
      setUltima(new Date())
      setError(null)
    } catch {
      setError('No se pudo traer el resumen. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setActualizando(false)
    }
  }

  // Se refresca cada minuto mientras la pestaña está a la vista, y al volver a ella.
  useEffect(() => {
    const refrescar = () => { if (document.visibilityState === 'visible') { void cargar(); recargarVentas() } }
    void cargar()
    const reloj = setInterval(refrescar, 60_000)
    document.addEventListener('visibilitychange', refrescar)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', refrescar)
    }
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

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-2 sm:px-8">
      <section className="flex flex-col gap-x-12 gap-y-7 pb-8 pt-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[2.5rem] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-5xl xl:text-[3.5rem]">
            {saludo()},
            <br />
            <span className="relative isolate inline-block">
              {nombre || 'equipo'}
              <svg aria-hidden="true" viewBox="0 0 200 14" preserveAspectRatio="none" className="absolute -bottom-[0.02em] -left-[0.04em] -z-10 h-[0.3em] w-[calc(100%+0.1em)]">
                <path d="M3 9 C 45 3, 95 11, 135 6 S 190 5, 197 8" stroke="#f9dc07" strokeWidth="9" strokeLinecap="round" fill="none" />
              </svg>
            </span>
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-apagado">
            <span className="first-letter:uppercase">{fechaTexto || 'Cargando…'}</span>
            <button
              type="button"
              onClick={() => { void cargar(); recargarVentas() }}
              disabled={actualizando}
              className="flex items-center gap-1.5 rounded-md py-1 font-medium text-tinta hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-60"
            >
              <RefreshCw size={14} className={actualizando ? 'animate-spin' : ''} aria-hidden="true" />
              {actualizando ? 'Actualizando…' : ultima ? `Actualizado ${ultima.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Actualizar'}
            </button>
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

      <div className="grid gap-4 xl:grid-cols-2 xl:grid-rows-[auto_1fr]">
        {/* Los sabores son los productos: se ordenan por los litros que vendieron en 30 días */}
        <Tarjeta
          id="t-sabores"
          titulo="Sabores más vendidos"
          subtitulo={(p?.unidades ?? ['L']).some((u) => u !== 'L') ? 'Lo entregado en los últimos 30 días' : 'Litros entregados en los últimos 30 días'}
          className="flex flex-col xl:row-span-2"
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
            <ul className="mt-5 grid flex-1 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-3 xl:grid-rows-2">
              {visibles.map((x) => (
                <li key={x.producto.id}>
                  <TarjetaSabor producto={x.producto} venta={x.venta} posicion={x.posicion} frasco="h-28 xl:h-36" onAbrir={() => ficha.abrir(x.producto.id)} />
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

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
      </div>

      {ficha.panel}
    </div>
  )
}
