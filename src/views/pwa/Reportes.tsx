import { useId, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../lib/db'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download, Eye, FileDown, FileSpreadsheet, FileText, Star, TrendingDown, TrendingUp, WifiOff } from 'lucide-react'
import { dinero, hoy, sumarDias } from '../../lib/fechas'
import { useEquipo } from '../../lib/equipo'
import { Avatar } from '../../components/Avatar'
import {
  agrupacionesPosibles, agrupacionSugerida, cambio, diasDelRango, exportarReporte, mover, rangoDe, TABLAS_CSV, textoPeriodo, textoRango, useReporte,
  type Agrupar, type Formato, type Rango, type Reporte, type TablaCsv, type Vista,
} from '../../lib/reportes'
import { aviso, Boton, claseInput, Hoja, PuntoSabor, Segmentado } from '../../components/ui'
import { textoPorUnidad, tituloUnidad } from '../../lib/unidades'
import { Columnas } from '../../components/graficas'
import { BarraSegmentada, BarrasPeriodo } from '../admin/graficas'
import { SelectorRango, textoRangoCorto } from '../../components/Calendario'
import { Encabezado, Separador, botonPanel, botonPanelIcono, botonPanelSuave, grupoPanel } from '../admin/piezas'

// Reportes del administrador (RF-043 a RF-048): corte del día, comparativos por semana y mes, utilidad por sabor,
// ranking de sabores, rendimiento de cada vendedor y exportación a Excel o CSV. Los arma el servidor.

const VISTAS: { valor: Vista; texto: string }[] = [
  { valor: 'dia', texto: 'Día' },
  { valor: 'semana', texto: 'Semana' },
  { valor: 'mes', texto: 'Mes' },
  { valor: 'rango', texto: 'Rango' },
]
const AGRUPAR: Record<Agrupar, string> = { dia: 'Día', semana: 'Semana', mes: 'Mes' }
const MAX_DIAS = 1096
const ANTERIOR: Record<Vista, string> = { dia: 'al día anterior', semana: 'a la semana anterior', mes: 'al mes anterior', rango: 'al periodo anterior de la misma duración' }

const num = (n: number, dec = 1) => n.toLocaleString('es-MX', { maximumFractionDigits: dec })
const litros = (n: number, unidad = 'L') => `${num(n)} ${unidad}`
const porcentaje = (n: number | null) => (n === null ? '—' : `${num(n)}%`)
const dineroEje = (n: number) => `$${n >= 1000 ? `${num(n / 1000)}k` : num(n)}`
const ejeLitros = (n: number) => (n >= 1000 ? `${num(n / 1000)}k` : num(n))

// `panel`: encabezado del panel con el tipo de periodo, el cambio de periodo (o las fechas del rango) y «Exportar».
export function Reportes({ panel = false }: { panel?: boolean } = {}) {
  const [vista, setVista] = useState<Vista>('dia')
  const [ancla, setAncla] = useState(hoy)
  const [libre, setLibre] = useState<Rango>(() => ({ desde: sumarDias(hoy(), -29), hasta: hoy() }))
  const [elegida, setElegida] = useState<Agrupar | null>(null)
  const [exportando, setExportando] = useState(false)
  const [vendedorAbierto, setVendedorAbierto] = useState<Reporte['vendedores'][number] | null>(null)

  const rango = vista === 'rango' ? libre : rangoDe(vista, ancla)
  const posibles = agrupacionesPosibles(rango)
  const agrupar = elegida && posibles.includes(elegida) ? elegida : posibles.includes(agrupacionSugerida(rango)) ? agrupacionSugerida(rango) : posibles[0] ?? 'dia'
  // Un mes se compara con el mes anterior completo; lo demás, con el periodo de la misma duración justo antes.
  const comparar = vista === 'mes' ? rangoDe('mes', mover('mes', ancla, -1)) : undefined
  const { reporte, error, cargando, recargar } = useReporte(rango, agrupar, comparar)
  const enCurso = rango.hasta >= hoy() // el periodo todavía no termina: compararlo con uno completo engaña
  // Mientras llega el reporte nuevo se deja el anterior (atenuado), pero si falla no se muestra como si fuera de este periodo.
  const vigente = reporte?.desde === rango.desde && reporte.hasta === rango.hasta

  function cambiarVista(v: Vista) {
    setVista(v)
    setAncla(hoy())
  }
  // El calendario ya no deja pasar de hoy; aquí sólo se recorta a MAX_DIAS desde el final.
  function cambiarLibre(r: Rango) {
    setLibre(diasDelRango(r) > MAX_DIAS ? { desde: sumarDias(r.hasta, 1 - MAX_DIAS), hasta: r.hasta } : r)
  }

  return (
    <div className={panel ? 'mx-auto max-w-[1280px] px-4 pt-2 sm:px-8' : 'h-full overflow-y-auto px-4 pt-safe pb-24'}>
      <div className={panel ? '' : 'mx-auto max-w-5xl'}>
        {panel ? (
          <Encabezado titulo="Reportes" ayuda="reportes" detalle={`${textoRango(vista, rango)}${vista === 'dia' ? '' : ` · ${enCurso ? 'en curso' : `${diasDelRango(rango)} días`}`}`}>
            <div className={`${grupoPanel} max-sm:basis-full`} role="group" aria-label="Periodo">
              {VISTAS.map((v) => (
                <button key={v.valor} onClick={() => cambiarVista(v.valor)} aria-pressed={vista === v.valor} className={vista === v.valor ? botonPanel : botonPanelSuave}>{v.texto}</button>
              ))}
            </div>
            <Separador />
            {vista === 'rango' ? (
              <SelectorRango valor={libre} onCambiar={cambiarLibre} max={hoy()} etiqueta="Elegir fechas" className={`${botonPanelSuave} max-sm:grow`}>
                <CalendarDays size={18} /> {textoRangoCorto(libre)}
              </SelectorRango>
            ) : (
              <div className="flex grow gap-1 sm:grow-0">
                <button onClick={() => setAncla(mover(vista, ancla, -1))} aria-label="Periodo anterior" className={botonPanelIcono}><ChevronLeft size={22} strokeWidth={2.25} /></button>
                <button onClick={() => setAncla(hoy())} disabled={enCurso} className={`${botonPanelSuave} max-sm:grow`}>Actual</button>
                <button onClick={() => setAncla(mover(vista, ancla, 1))} disabled={enCurso} aria-label="Periodo siguiente" className={botonPanelIcono}><ChevronRight size={22} strokeWidth={2.25} /></button>
              </div>
            )}
            <Separador />
            <button onClick={() => setExportando(true)} disabled={!vigente} className={botonPanel}><Download size={18} /> Exportar</button>
          </Encabezado>
        ) : (
          <>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">Reportes</h1>
            <Segmentado valor={vista} onChange={cambiarVista} opciones={VISTAS} className="mt-4" />
          </>
        )}
        {panel ? null : vista === 'rango' ? (
          <SelectorRango valor={libre} onCambiar={cambiarLibre} max={hoy()} etiqueta="Elegir fechas"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-niebla px-4 py-3 font-semibold active:bg-linea">
            <CalendarDays size={20} /> {textoRangoCorto(libre)}
          </SelectorRango>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-2">
            <button onClick={() => setAncla(mover(vista, ancla, -1))} aria-label="Periodo anterior" className="grid h-11 w-11 place-items-center rounded-full bg-niebla active:bg-linea">
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0 text-center">
              <div className="truncate text-lg font-semibold tracking-tight">{textoRango(vista, rango)}</div>
              {vista !== 'dia' && <div className="text-xs text-apagado">{enCurso ? 'En curso' : `${diasDelRango(rango)} días`}</div>}
            </div>
            <button onClick={() => setAncla(mover(vista, ancla, 1))} disabled={enCurso} aria-label="Periodo siguiente" className="grid h-11 w-11 place-items-center rounded-full bg-niebla active:bg-linea disabled:opacity-30">
              <ChevronRight size={20} />
            </button>
          </div>
        )}

        {error && !vigente ? (
          <Fallo error={error} reintentar={recargar} />
        ) : !reporte ? (
          <div className="mt-10 text-center text-sm text-apagado">Cargando reporte…</div>
        ) : (
          <div className={`transition-opacity ${cargando ? 'opacity-50' : ''}`}>
            {error && <Fallo error={error} reintentar={recargar} chico />}
            <Contenido
              reporte={reporte}
              vista={vista}
              enCurso={enCurso}
              posibles={posibles}
              agrupar={agrupar}
              onAgrupar={setElegida}
              exportar={panel ? undefined : () => setExportando(true)}
              tendencia={vista !== 'rango' && <Tendencia vista={vista} rango={rango} unidades={reporte.unidades} onElegir={setAncla} />}
              onVendedor={setVendedorAbierto}
            />
          </div>
        )}
      </div>

      {reporte && <HojaExportar abierta={exportando} onCerrar={() => setExportando(false)} reporte={reporte} />}
      <HojaVendedor vendedor={vendedorAbierto} onCerrar={() => setVendedorAbierto(null)} vista={vista} rango={rango} unidades={reporte?.unidades} onElegir={setAncla} />
    </div>
  )
}

function Fallo({ error, reintentar, chico }: { error: { texto: string; sinRed: boolean }; reintentar: () => void; chico?: boolean }) {
  return (
    <div className={`${chico ? 'mt-3' : 'mt-8'} flex items-center gap-3 rounded-lg bg-niebla p-4`} role="alert">
      <WifiOff size={22} className="shrink-0 text-apagado" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">{error.sinRed ? 'Los reportes necesitan conexión' : 'No se pudo cargar el reporte'}</div>
        <div className="text-apagado">{error.sinRed ? 'Se arman en el servidor con todo el historial.' : error.texto}</div>
      </div>
      <button onClick={reintentar} className="rounded-md bg-tinta px-4 py-2 text-xs font-semibold text-white active:bg-neutral-700">Reintentar</button>
    </div>
  )
}

function Contenido({ reporte, vista, enCurso, posibles, agrupar, onAgrupar, exportar, tendencia, onVendedor }: {
  reporte: Reporte
  vista: Vista
  enCurso: boolean
  posibles: Agrupar[]
  agrupar: Agrupar
  onAgrupar: (a: Agrupar) => void
  exportar?: () => void // sin él (panel) Exportar va en el encabezado
  tendencia?: ReactNode // las gráficas de los periodos de alrededor (Día, Semana, Mes)
  onVendedor?: (v: Reporte['vendedores'][number]) => void // abre su hoja (gráfica y meta)
}) {
  const { resumen: r, anterior } = reporte
  const comparar = !enCurso && anterior
  const sinVentas = r.pedidos === 0
  const variosAnios = reporte.desde.slice(0, 4) !== reporte.hasta.slice(0, 4)
  // Catálogo flexible: con una sola unidad todo se lee como antes; con varias, los totales van por unidad
  // («60 L + 10 kg») y no hay gráfica de cantidad (no se suman litros con kilos).
  const unidades = reporte.unidades?.length ? reporte.unidades : ['L']
  const varias = unidades.length > 1
  const u0 = unidades[0]
  const cantidad = (pu: Record<string, number> | undefined, n: number) => (varias ? textoPorUnidad(pu, unidades, n) : litros(n, u0))
  const maxPorUnidad = new Map<string, number>()
  for (const s of reporte.sabores) maxPorUnidad.set(s.unidad || 'L', Math.max(maxPorUnidad.get(s.unidad || 'L') ?? 1, s.litros))
  const maxIngreso = Math.max(1, ...reporte.vendedores.map((v) => v.ingreso))
  const estrella = reporte.sabores.find((s) => s.id === reporte.ranking.estrella)
  const menor = reporte.sabores.find((s) => s.id === reporte.ranking.menorRotacion)
  const barras = (valor: (p: Reporte['periodos'][number]) => number) =>
    reporte.periodos.map((p) => ({ clave: p.periodo, eje: textoPeriodo(p, agrupar, false, variosAnios), nombre: textoPeriodo(p, agrupar, true), valor: valor(p) }))

  return (
    <>
      <div className="mt-5 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight">Resumen</h2>
        {exportar && (
          <button onClick={exportar} className="flex items-center gap-1.5 rounded-md bg-niebla px-4 py-2.5 text-[13px] font-semibold active:bg-linea">
            <Download size={16} /> Exportar
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-y-6 border-y border-linea py-6 sm:grid-cols-4 sm:divide-x sm:divide-linea">
        <Tarjeta etiqueta="Recaudado" valor={dinero(r.ingreso)} cambio={comparar ? cambio(r.ingreso, anterior.resumen.ingreso) : null} />
        <Tarjeta etiqueta="Utilidad neta" valor={dinero(r.utilidad)} acento pie={`Margen ${porcentaje(r.margenPct)}`} cambio={comparar ? cambio(r.utilidad, anterior.resumen.utilidad) : null} />
        <Tarjeta etiqueta={varias ? 'Entregado' : `${tituloUnidad(u0)} entregados`} valor={cantidad(r.porUnidad, r.litros)} cambio={comparar && !varias ? cambio(r.litros, anterior.resumen.litros) : null} />
        <Tarjeta etiqueta="Clientes atendidos" valor={String(r.clientes)} pie={`${r.pedidos} ${r.pedidos === 1 ? 'pedido' : 'pedidos'}`} />
      </div>
      {comparar && <p className="mt-2 text-xs text-apagado">Los cambios son frente {ANTERIOR[vista]}.</p>}
      {!sinVentas && (
        <p className="mt-1 text-xs text-apagado">
          Efectivo {dinero(r.efectivo)} · Transferencia {dinero(r.transferencia)}{(r.credito ?? 0) > 0 && ` · Fiado ${dinero(r.credito ?? 0)}`}{r.ticketPromedio !== null && ` · Ticket promedio ${dinero(r.ticketPromedio)}`}
        </p>
      )}

      {tendencia}
      {!sinVentas && (
        <div className="mt-8 grid gap-x-10 gap-y-8 lg:grid-cols-2">
          <ComoPagaron r={r} />
          <QueSeVendio sabores={reporte.sabores} total={r.ingreso} />
        </div>
      )}
      <FiadoDelPeriodo fiado={r.credito ?? 0} cobrado={reporte.abonos ?? 0} porVendedor={reporte.fiadoPorVendedor ?? []} />
      {!sinVentas && <ClientesDelPeriodo desde={reporte.desde} hasta={reporte.hasta} />}

      {sinVentas ? (
        <div className="mt-6 border-t border-linea py-10 text-center">
          <div className="font-semibold">Sin ventas entregadas en este periodo</div>
          <div className="mt-1 text-sm text-apagado">Cuando se entreguen pedidos aparecerán aquí.</div>
        </div>
      ) : (
        <>
          {reporte.periodos.length > 1 && (
            <section className="mt-7">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-bold tracking-tight">Comparativo</h2>
                {posibles.length > 1 && (
                  <Segmentado valor={agrupar} onChange={onAgrupar} opciones={posibles.map((a) => ({ valor: a, texto: AGRUPAR[a] }))} className="[&>button]:px-3 [&>button]:py-2" />
                )}
              </div>
              <div className="mt-3 grid gap-x-10 gap-y-6 lg:grid-cols-2">
                <Columnas titulo="Ingresos" barras={barras((p) => p.ingreso)} color="bg-azul" formato={dinero} formatoEje={dineroEje} total={dinero(r.ingreso)} />
                {!varias && <Columnas titulo={tituloUnidad(u0)} barras={barras((p) => p.litros)} color="bg-tinta" formato={(n) => litros(n, u0)} formatoEje={ejeLitros} total={litros(r.litros, u0)} />}
              </div>
              <details className="mt-4 border-t border-linea py-3 text-sm">
                <summary className="cursor-pointer font-semibold">Ver como tabla</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[26rem] text-left tabular-nums">
                    <thead className="text-xs text-apagado">
                      <tr><th className="py-1 font-medium">{AGRUPAR[agrupar]}</th><th className="font-medium">Pedidos</th><th className="font-medium">{varias ? 'Entregado' : tituloUnidad(u0)}</th><th className="font-medium">Ingresos</th><th className="font-medium">Utilidad</th></tr>
                    </thead>
                    <tbody className="divide-y divide-linea">
                      {reporte.periodos.map((p) => (
                        <tr key={p.periodo}>
                          <td className="py-1.5">{textoPeriodo(p, agrupar, true)}</td><td>{p.pedidos}</td><td>{varias ? textoPorUnidad(p.porUnidad, unidades, p.litros) : num(p.litros)}</td><td>{dinero(p.ingreso)}</td><td>{dinero(p.utilidad)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
          )}

          <div className="mt-7 grid gap-x-8 lg:grid-cols-2">
            <section>
              <h2 className="text-2xl font-bold tracking-tight">Sabores</h2>
              {estrella && menor && estrella.id !== menor.id && (
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div className="border-l-2 border-verde pl-3">
                    <div className="flex items-center gap-1 text-xs font-medium text-verde"><TrendingUp size={14} /> Sabor estrella</div>
                    <div className="mt-1 font-semibold">{estrella.sabor}</div>
                    <div className="text-xs text-apagado tabular-nums">{litros(estrella.litros, estrella.unidad)}</div>
                  </div>
                  <div className="border-l-2 border-rojo pl-3">
                    <div className="flex items-center gap-1 text-xs font-medium text-rojo"><TrendingDown size={14} /> Menor rotación</div>
                    <div className="mt-1 font-semibold">{menor.sabor}</div>
                    <div className="text-xs text-apagado tabular-nums">{litros(menor.litros, menor.unidad)}</div>
                  </div>
                </div>
              )}
              <div className="mt-2 divide-y divide-linea">
                {reporte.sabores.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3 py-3">
                    <PuntoSabor color={s.color} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold">
                          <span className="mr-1.5 text-xs font-medium text-apagado tabular-nums">{i + 1}.</span>{s.sabor}
                          {s.id === reporte.ranking.estrella && <Star size={13} className="ml-1.5 inline -translate-y-px fill-ambar text-ambar" aria-label="Sabor estrella" />}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{litros(s.litros, s.unidad)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-niebla">
                        <div className="h-full rounded-md bg-tinta" style={{ width: `${(s.litros / (maxPorUnidad.get(s.unidad || 'L') ?? 1)) * 100}%` }} />
                      </div>
                      {s.litros === 0 ? (
                        <div className="mt-1 text-[11px] text-apagado">Sin ventas en el periodo</div>
                      ) : (
                        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-apagado tabular-nums">
                          <span>{dinero(s.ingreso)} vendidos</span>
                          <span>Costo {dinero(s.costo)}</span>
                          <span className={s.utilidad >= 0 ? 'text-verde' : 'text-rojo'}>Utilidad {dinero(s.utilidad)} · {porcentaje(s.margenPct)}</span>
                        </div>
                      )}
                      {s.sinCosto && (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-tinta">
                          <AlertTriangle size={12} className="shrink-0 text-ambar" /> Se vendió sin costo capturado: la utilidad real es menor.
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-7 lg:mt-0">
              <h2 className="text-2xl font-bold tracking-tight">Vendedores</h2>
              <div className="mt-2 divide-y divide-linea">
                {reporte.vendedores.map((v) => (
                  <button key={v.id ?? 'sin'} type="button" disabled={!v.id || !onVendedor} onClick={() => onVendedor?.(v)}
                    aria-label={v.id ? `Ver la gráfica y la meta de ${v.nombre}` : undefined}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 py-3 text-left transition-colors enabled:hover:bg-niebla/70 focus-visible:outline-2 focus-visible:outline-marca disabled:cursor-default">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tinta text-sm font-bold text-white" aria-hidden>{v.nombre.charAt(0).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold">
                          {v.nombre}
                          {!v.activo && v.id && <span className="ml-1.5 rounded-md bg-niebla px-2 py-0.5 text-[10px] font-semibold text-apagado">Dado de baja</span>}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{dinero(v.ingreso)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-niebla">
                        <div className="h-full rounded-md bg-azul" style={{ width: `${(v.ingreso / maxIngreso) * 100}%` }} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-apagado tabular-nums">
                        <span>{v.pedidos} {v.pedidos === 1 ? 'pedido' : 'pedidos'}</span>
                        <span>{v.clientes} {v.clientes === 1 ? 'cliente' : 'clientes'}</span>
                        <span>{cantidad(v.porUnidad, v.litros)}</span>
                        {v.ticketPromedio !== null && <span>Ticket {dinero(v.ticketPromedio)}</span>}
                        <span className={v.utilidad >= 0 ? 'text-verde' : 'text-rojo'}>Utilidad {dinero(v.utilidad)}</span>
                        {v.omitidos > 0 && <span>{v.omitidos} {v.omitidos === 1 ? 'visita sin venta' : 'visitas sin venta'}</span>}
                      </div>
                    </div>
                    {v.id && onVendedor && <ChevronRight size={18} className="shrink-0 text-apagado" aria-hidden="true" />}
                  </button>
                ))}
                {reporte.vendedores.length === 0 && <div className="py-4 text-sm text-apagado">Todavía no hay vendedores dados de alta.</div>}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  )
}

// ------------------------------------------------------------------ estadísticas

// La tendencia alrededor del periodo que se ve: los últimos 14 días, 8 semanas o 12 meses, con el que se ve en dorado.
// Tocar una barra lleva a ese periodo. Se puede cambiar lo que mide (ingresos, utilidad, cantidad, pedidos).
type Medida = 'ingreso' | 'utilidad' | 'litros' | 'pedidos'
const CONTEXTO: Record<Exclude<Vista, 'rango'>, { titulo: string; agrupar: Agrupar; n: number; otros: string; este: string }> = {
  dia: { titulo: 'Últimos 14 días', agrupar: 'dia', n: 14, otros: 'Otros días', este: 'El día que ves' },
  semana: { titulo: 'Últimas 8 semanas', agrupar: 'semana', n: 8, otros: 'Otras semanas', este: 'La semana que ves' },
  mes: { titulo: 'Últimos 12 meses', agrupar: 'mes', n: 12, otros: 'Otros meses', este: 'El mes que ves' },
}
// Con «Comparar con hace un año», junto a cada barra va la del mismo periodo un año antes: el mismo día de la semana
// (364 días antes) para días y semanas, el mismo mes para meses. `vendedor`: sólo sus ventas (su hoja).
function Tendencia({ vista, rango, unidades, onElegir, vendedor, chico }: { vista: Exclude<Vista, 'rango'>; rango: Rango; unidades?: string[]; onElegir: (ancla: string) => void; vendedor?: string; chico?: boolean }) {
  const c = CONTEXTO[vista]
  const id = useId()
  const contexto = { desde: rangoDe(vista, mover(vista, rango.desde, 1 - c.n)).desde, hasta: rango.hasta }
  const { reporte } = useReporte(contexto, c.agrupar, undefined, { vendedor })
  const [comparar, setComparar] = useState(() => { try { return localStorage.getItem('delisy:comparar-anio') === '1' } catch { return false } })
  const elegirComparar = (si: boolean) => { setComparar(si); try { localStorage.setItem('delisy:comparar-anio', si ? '1' : '0') } catch { /* sin almacenamiento */ } }
  const haceUnAnio = vista === 'mes'
    ? { desde: mover('mes', contexto.desde, -12), hasta: rangoDe('mes', mover('mes', contexto.hasta, -12)).hasta }
    : { desde: sumarDias(contexto.desde, -364), hasta: sumarDias(contexto.hasta, -364) }
  const { reporte: antes } = useReporte(haceUnAnio, c.agrupar, undefined, { vendedor, activo: comparar })
  const [medida, setMedida] = useState<Medida>('ingreso')
  const u = unidades?.length === 1 ? unidades[0] : null // con varias unidades no se suman litros con kilos
  const medidas: { valor: Medida; texto: string }[] = [
    { valor: 'ingreso', texto: 'Ingresos' }, { valor: 'utilidad', texto: 'Utilidad' },
    ...(u ? [{ valor: 'litros' as const, texto: tituloUnidad(u) }] : []), { valor: 'pedidos', texto: 'Pedidos' },
  ]
  const m = medidas.some((x) => x.valor === medida) ? medida : 'ingreso'
  const formato = m === 'pedidos' ? (n: number) => `${num(n, 0)} ${n === 1 ? 'pedido' : 'pedidos'}` : m === 'litros' ? (n: number) => litros(n, u ?? 'L') : dinero
  if (!reporte || reporte.desde !== contexto.desde || reporte.hasta !== contexto.hasta) {
    return <div className="mt-7 h-56 animate-pulse rounded-lg bg-niebla" aria-label="Cargando la tendencia" />
  }
  const variosAnios = reporte.desde.slice(0, 4) !== reporte.hasta.slice(0, 4)
  const datos = reporte.periodos.map((p) => ({
    clave: p.inicio, eje: textoPeriodo(p, c.agrupar, false, variosAnios), nombre: textoPeriodo(p, c.agrupar, true),
    valor: Math.max(0, p[m]), actual: p.inicio <= rango.desde && rango.desde <= p.fin,
  }))
  const conVentas = reporte.periodos.filter((p) => p.pedidos > 0)
  const promedio = conVentas.length ? conVentas.reduce((s, p) => s + p[m], 0) / conVentas.length : 0
  const mejor = [...reporte.periodos].sort((a, b) => b[m] - a[m])[0]
  const previoListo = comparar && antes && antes.desde === haceUnAnio.desde && antes.hasta === haceUnAnio.hasta
  const total = reporte.periodos.reduce((s, p) => s + p[m], 0)
  const totalAntes = previoListo ? antes.periodos.reduce((s, p) => s + p[m], 0) : 0
  const previo = previoListo ? {
    valores: reporte.periodos.map((_, i) => (antes.periodos[i] ? Math.max(0, antes.periodos[i][m]) : undefined)),
    nombres: reporte.periodos.map((_, i) => (antes.periodos[i] ? textoPeriodo(antes.periodos[i], c.agrupar, true, true) : undefined)),
    leyenda: 'Hace un año',
  } : undefined
  return (
    <section className={chico ? 'mt-6' : 'mt-7'} aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className={chico ? 'text-lg font-semibold' : 'text-2xl font-bold tracking-tight'}>{c.titulo}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => elegirComparar(!comparar)} aria-pressed={comparar}
            className={`${comparar ? botonPanel : botonPanelSuave} !px-3 !py-2 text-sm`}>
            {comparar ? 'Quitar hace un año' : 'Comparar con hace un año'}
          </button>
          <Segmentado valor={m} onChange={setMedida} opciones={medidas} className="[&>button]:px-3 [&>button]:py-2" />
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div><div className="text-xs text-apagado">Total</div><div className="font-semibold tabular-nums">{formato(total)}
            {previoListo && totalAntes > 0 && <span className={`ml-1.5 text-xs ${total >= totalAntes ? 'text-verde' : 'text-rojo'}`}>{total >= totalAntes ? '+' : '−'}{num(Math.abs((total - totalAntes) / totalAntes) * 100, 0)}% vs hace un año</span>}
            {previoListo && totalAntes === 0 && <span className="ml-1.5 text-xs font-normal text-apagado">sin ventas hace un año</span>}
          </div></div>
          <div><div className="text-xs text-apagado">Promedio con ventas</div><div className="font-semibold tabular-nums">{conVentas.length ? formato(promedio) : '—'}</div></div>
          <div className="col-span-2 sm:col-span-1"><div className="text-xs text-apagado">Mejor</div><div className="font-semibold tabular-nums">{mejor && mejor[m] > 0 ? <>{formato(mejor[m])} <span className="font-normal text-apagado first-letter:uppercase">· {textoPeriodo(mejor, c.agrupar, true)}</span></> : '—'}</div></div>
        </div>
        <BarrasPeriodo key={m} datos={datos} formato={formato} alto={150} descripcion={`${medidas.find((x) => x.valor === m)?.texto}: ${c.titulo.toLowerCase()}`}
          leyenda={[c.otros, c.este]} textoActual="el que ves" onElegir={onElegir} previo={previo} />
        {comparar && !previoListo && <p className="mt-2 text-xs text-apagado">Cargando hace un año…</p>}
        <p className="mt-2 text-xs text-apagado">Toca una barra para ver ese periodo.</p>
      </div>
    </section>
  )
}

// La hoja de un vendedor: lo suyo en el periodo que se ve, su avance hacia la meta del mes (lo entregado, como en
// GET /mi-meta) con el ritmo al que va, y su gráfica de los periodos de alrededor (con la comparación de hace un año).
function HojaVendedor({ vendedor: v, onCerrar, vista, rango, unidades, onElegir }: {
  vendedor: Reporte['vendedores'][number] | null
  onCerrar: () => void
  vista: Vista
  rango: Rango
  unidades?: string[]
  onElegir: (ancla: string) => void
}) {
  const miembro = useEquipo()?.usuarios.find((u) => u.id === v?.id)
  const mes = rangoDe('mes', rango.desde)
  const { reporte: delMes } = useReporte(mes, 'dia', undefined, { vendedor: v?.id ?? undefined, activo: !!v?.id })
  const meta = miembro?.metaMensual ?? null
  const vendido = delMes && delMes.desde === mes.desde && v?.id ? delMes.resumen.ingreso : null
  const enCursoMes = mes.hasta >= hoy()
  const diasMes = diasDelRango(mes)
  const pasados = enCursoMes ? diasDelRango({ desde: mes.desde, hasta: hoy() }) : diasMes
  const ritmo = vendido !== null && enCursoMes && pasados > 0 ? (vendido / pasados) * diasMes : null
  const pctMeta = meta && vendido !== null ? (vendido / meta) * 100 : null
  const nombreMes = textoRango('mes', mes).toLowerCase()
  return (
    <Hoja abierta={!!v} onCerrar={onCerrar} alto className="sm:max-w-3xl"
      titulo={v && <span className="flex items-center gap-3"><Avatar nombre={v.nombre} foto={miembro?.foto} className="h-11 w-11 bg-tinta text-base text-white" />{v.nombre}</span>}>
      {v && (
        <div className="pb-6">
          <p className="text-sm text-apagado">{textoRango(vista, rango)}{!v.activo && ' · dado de baja'}</p>
          <div className="mt-3 grid grid-cols-2 gap-y-5 border-y border-linea py-5 sm:grid-cols-4 sm:divide-x sm:divide-linea">
            <Tarjeta etiqueta="Vendido" valor={dinero(v.ingreso)} />
            <Tarjeta etiqueta="Utilidad" valor={dinero(v.utilidad)} acento />
            <Tarjeta etiqueta="Pedidos" valor={String(v.pedidos)} pie={`${v.clientes} ${v.clientes === 1 ? 'cliente' : 'clientes'}`} />
            <Tarjeta etiqueta="Ticket promedio" valor={v.ticketPromedio === null ? '—' : dinero(v.ticketPromedio)} pie={v.omitidos ? `${v.omitidos} sin venta` : undefined} />
          </div>

          <section className="mt-6" aria-label="Meta del mes">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">Meta de {nombreMes}</h3>
              {meta && pctMeta !== null && <span className="text-sm font-semibold tabular-nums">{num(pctMeta, 0)}%</span>}
            </div>
            {!meta ? (
              <p className="mt-1 text-sm text-apagado">No tiene meta mensual. Se le pone en Vendedores, en su ficha.</p>
            ) : vendido === null ? (
              <div className="mt-3 h-3 animate-pulse rounded-full bg-niebla" />
            ) : (
              <>
                <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-niebla" role="img" aria-label={`${dinero(vendido)} de ${dinero(meta)}`}>
                  <div className="barra-crece h-full rounded-full bg-serie" style={{ width: `${Math.min(100, pctMeta ?? 0)}%` }} />
                  {ritmo !== null && ritmo < meta * 1.5 && (
                    <div className="absolute inset-y-0 w-0.5 bg-tinta/60" style={{ left: `${Math.min(99.5, (ritmo / meta) * 100)}%` }} title="A dónde llegaría a este ritmo" />
                  )}
                </div>
                <p className="mt-2 text-sm">
                  <span className="font-semibold tabular-nums">{dinero(vendido)}</span> de {dinero(meta)}
                  {vendido >= meta
                    ? <span className="text-verde"> · ¡ya llegó a su meta!</span>
                    : enCursoMes
                      ? <> · le faltan <span className="font-semibold tabular-nums">{dinero(meta - vendido)}</span>{ritmo !== null && <> · a este ritmo cerraría en <span className="font-semibold tabular-nums">{dinero(ritmo)}</span> ({num((ritmo / meta) * 100, 0)}%)</>}</>
                      : <span className="text-apagado"> · se quedó a {dinero(meta - vendido)}</span>}
                </p>
              </>
            )}
          </section>

          {vista !== 'rango' && v.id && <Tendencia vista={vista} rango={rango} unidades={unidades} onElegir={onElegir} vendedor={v.id} chico />}
        </div>
      )}
    </Hoja>
  )
}

// Lo que se fió en el periodo contra lo que se cobró de fiado (abonos): si el fiado pendiente crece o baja.
// Con los pedidos del dispositivo: a cuántos clientes se les entregó, cuántos compraron por primera vez y quiénes
// compraron más en el periodo.
function ClientesDelPeriodo({ desde, hasta }: { desde: string; hasta: string }) {
  const datos = useLiveQuery(async () => {
    const [pedidos, clientes] = await Promise.all([db.pedidos.where('fecha').belowOrEqual(hasta).filter((p) => p.estado === 'ENTREGADO').toArray(), db.clientes.toArray()])
    const primera = new Map<string, string>()
    const suma = new Map<string, number>()
    for (const p of pedidos) {
      if (p.fecha < (primera.get(p.clienteId) ?? '9')) primera.set(p.clienteId, p.fecha)
      if (p.fecha >= desde) suma.set(p.clienteId, (suma.get(p.clienteId) ?? 0) + p.total)
    }
    const nombre = new Map(clientes.map((c) => [c.id, c.nombre]))
    return {
      compraron: suma.size,
      nuevos: [...suma.keys()].filter((id) => (primera.get(id) ?? '') >= desde).length,
      mejores: [...suma.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, total]) => ({ id, nombre: nombre.get(id) ?? 'Cliente', total })),
    }
  }, [desde, hasta])
  if (!datos?.compraron) return null
  return (
    <section aria-labelledby="clientes-periodo" className="mt-8 border-t border-linea pt-6">
      <h2 id="clientes-periodo" className="text-lg font-semibold">Clientes</h2>
      <p className="mt-1 text-sm text-apagado">
        Compraron <span className="font-semibold text-tinta tabular-nums">{datos.compraron}</span>
        {datos.nuevos > 0 && <> · <span className="font-semibold text-tinta tabular-nums">{datos.nuevos}</span> por primera vez</>}
      </p>
      <ol className="mt-3 divide-y divide-linea border-y border-linea">
        {datos.mejores.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="w-5 shrink-0 font-semibold text-apagado tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{c.nombre}</span>
            <span className="font-semibold tabular-nums">{dinero(c.total)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function FiadoDelPeriodo({ fiado, cobrado, porVendedor }: { fiado: number; cobrado: number; porVendedor: NonNullable<Reporte['fiadoPorVendedor']> }) {
  if (fiado <= 0 && cobrado <= 0) return null
  const neto = fiado - cobrado
  const mayor = Math.max(fiado, cobrado)
  return (
    <section className="mt-8 border-t border-linea pt-5" aria-labelledby="fiado-periodo">
      <h3 id="fiado-periodo" className="font-semibold">Fiado</h3>
      <p className="mt-1 text-sm text-apagado">
        {Math.abs(neto) < 0.005 ? 'Se cobró lo mismo que se fió: lo pendiente quedó igual.'
          : neto > 0 ? `Se fió ${dinero(neto)} más de lo que se cobró: lo pendiente creció.`
          : `Se cobró ${dinero(-neto)} más de lo que se fió: lo pendiente bajó.`}
      </p>
      <dl className="mt-3 max-w-xl space-y-2 text-sm">
        {[{ t: 'Se fió', n: fiado, color: 'var(--color-apagado)' }, { t: 'Se cobró en abonos', n: cobrado, color: 'var(--color-serie)' }].map((x) => (
          <div key={x.t} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3">
            <dt>{x.t}</dt>
            <dd className="h-2.5 overflow-hidden rounded-full bg-linea" aria-hidden="true"><span className="block h-full rounded-full" style={{ width: `${mayor ? (x.n / mayor) * 100 : 0}%`, backgroundColor: x.color }} /></dd>
            <dd className="font-semibold tabular-nums">{dinero(x.n)}</dd>
          </div>
        ))}
      </dl>
      {porVendedor.length > 1 && (
        <div className="mt-5 max-w-2xl overflow-x-auto">
          <h4 className="text-sm font-semibold">Quién cobra mejor</h4>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-apagado">
              <tr className="border-b border-linea"><th className="py-1.5 pr-3 font-medium">Vendedor</th><th className="py-1.5 pr-3 text-right font-medium">Fió</th><th className="py-1.5 pr-3 text-right font-medium">Cobró</th><th className="py-1.5 text-right font-medium">Lo pendiente</th></tr>
            </thead>
            <tbody>
              {porVendedor.map((v) => {
                const n = v.fiado - v.abonos
                return (
                  <tr key={v.id ?? 'sin'} className="border-b border-linea/60">
                    <td className="py-2 pr-3">{v.nombre}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{dinero(v.fiado)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{dinero(v.abonos)}</td>
                    <td className={`py-2 text-right font-semibold tabular-nums ${n > 0.004 ? 'text-rojo' : n < -0.004 ? 'text-verde' : 'text-apagado'}`}>
                      {Math.abs(n) < 0.005 ? 'Igual' : n > 0 ? `Subió ${dinero(n)}` : `Bajó ${dinero(-n)}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// Cómo se cobró lo vendido: efectivo, transferencia y fiado, cada uno con su monto y su parte.
function ComoPagaron({ r }: { r: Reporte['resumen'] }) {
  const total = r.efectivo + r.transferencia + (r.credito ?? 0)
  const partes = [
    { nombre: 'Efectivo', n: r.efectivo, color: 'var(--color-serie)' },
    { nombre: 'Transferencia', n: r.transferencia, color: 'var(--color-oro)' },
    { nombre: 'Fiado', n: r.credito ?? 0, color: 'var(--color-apagado)' },
  ].filter((p) => p.n > 0)
  return (
    <section className="border-t border-linea pt-5" aria-labelledby="como-pagaron">
      <h3 id="como-pagaron" className="font-semibold">Cómo te pagaron</h3>
      <div className="mt-3"><BarraSegmentada segmentos={partes} descripcion={partes.map((p) => `${p.nombre}: ${dinero(p.n)}`).join(', ')} /></div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {partes.map((p) => (
          <li key={p.nombre} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
            <span className="flex-1">{p.nombre}</span>
            <span className="font-semibold tabular-nums">{dinero(p.n)}</span>
            <span className="w-12 text-right text-xs text-apagado tabular-nums">{total ? `${num((p.n / total) * 100, 0)}%` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// De qué se vendió más (en dinero): los 5 primeros sabores con su color y el resto junto.
function QueSeVendio({ sabores, total }: { sabores: Reporte['sabores']; total: number }) {
  const vendidos = [...sabores].filter((s) => s.ingreso > 0).sort((a, b) => b.ingreso - a.ingreso)
  const partes = [
    ...vendidos.slice(0, 5).map((s) => ({ nombre: s.sabor, n: s.ingreso, color: s.color })),
    ...(vendidos.length > 5 ? [{ nombre: `Otros ${vendidos.length - 5}`, n: vendidos.slice(5).reduce((x, s) => x + s.ingreso, 0), color: 'var(--color-apagado)' }] : []),
  ]
  return (
    <section className="border-t border-linea pt-5" aria-labelledby="que-se-vendio">
      <h3 id="que-se-vendio" className="font-semibold">De qué se vendió más</h3>
      <div className="mt-3"><BarraSegmentada segmentos={partes} descripcion={partes.map((p) => `${p.nombre}: ${dinero(p.n)}`).join(', ')} /></div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {partes.map((p) => (
          <li key={p.nombre} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-tinta/15" style={{ backgroundColor: p.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
            <span className="font-semibold tabular-nums">{dinero(p.n)}</span>
            <span className="w-12 text-right text-xs text-apagado tabular-nums">{total ? `${num((p.n / total) * 100, 0)}%` : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Una cifra del resumen, sin caja: la etiqueta, el número grande y debajo el detalle y el cambio.
function Tarjeta({ etiqueta, valor, acento, pie, cambio: c }: { etiqueta: string; valor: string; acento?: boolean; pie?: string; cambio?: number | null }) {
  return (
    <div className="min-w-0 pr-4 sm:px-6 sm:first:pl-0 sm:last:pr-0">
      <div className="text-sm text-apagado">{etiqueta}</div>
      <div className={`mt-1 truncate text-3xl font-bold tracking-tight tabular-nums sm:text-4xl ${acento ? 'text-verde' : ''}`}>{valor}</div>
      {(pie || (c !== null && c !== undefined)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-apagado">
          {pie && <span>{pie}</span>}
          {c !== null && c !== undefined && <Cambio valor={c} />}
        </div>
      )}
    </div>
  )
}

// Subió o bajó: el ícono y el signo lo dicen, el color sólo lo refuerza.
function Cambio({ valor }: { valor: number }): ReactNode {
  if (valor === 0) return <span>Sin cambio</span>
  const sube = valor > 0
  const Icono = sube ? TrendingUp : TrendingDown
  return (
    <span className={`flex items-center gap-0.5 font-semibold ${sube ? 'text-verde' : 'text-rojo'}`}>
      <Icono size={12} /> {sube ? '+' : '−'}{num(Math.abs(valor))}%
    </span>
  )
}

function HojaExportar({ abierta, onCerrar, reporte }: { abierta: boolean; onCerrar: () => void; reporte: Reporte }) {
  const [formato, setFormato] = useState<Formato>('xlsx')
  const [tabla, setTabla] = useState<TablaCsv>('ventas')
  const [bajando, setBajando] = useState(false)

  async function descargar() {
    setBajando(true)
    try {
      const nombre = await exportarReporte(reporte, formato, tabla)
      if (nombre) aviso(`Se descargó ${nombre}`)
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo descargar')
    } finally {
      setBajando(false)
    }
  }

  return (
    <Hoja
      abierta={abierta}
      onCerrar={onCerrar}
      titulo="Exportar reporte"
      pie={<Boton onClick={descargar} disabled={bajando} className="w-full">{formato === 'pdf' ? <Eye size={18} /> : <Download size={18} />} {bajando ? 'Preparando…' : formato === 'pdf' ? 'Ver vista previa' : 'Descargar'}</Boton>}
    >
      <p className="text-sm text-apagado">Del {reporte.desde.split('-').reverse().join('/')} al {reporte.hasta.split('-').reverse().join('/')}.</p>
      <Segmentado
        valor={formato}
        onChange={setFormato}
        className="mt-3"
        opciones={[
          { valor: 'pdf', texto: <><FileDown size={16} /> PDF</> },
          { valor: 'xlsx', texto: <><FileSpreadsheet size={16} /> Excel</> },
          { valor: 'csv', texto: <><FileText size={16} /> CSV</> },
        ]}
      />
      {formato === 'pdf' ? (
        <p className="mt-3 pb-4 text-sm text-apagado">Un documento listo para leer o imprimir: cifras clave, gráfica de ingresos y tablas por sabor, por vendedor y por {AGRUPAR[reporte.agrupar].toLowerCase()}.</p>
      ) : formato === 'xlsx' ? (
        <p className="mt-3 pb-4 text-sm text-apagado">Un libro de Excel (.xlsx) con cinco hojas: resumen, por periodo, por sabor, por vendedor y el historial de ventas, con totales y listo para imprimir.</p>
      ) : (
        <div className="mt-3 pb-4">
          <p className="mb-2 text-sm text-apagado">Un archivo CSV tiene una sola tabla. Elige cuál.</p>
          <div className="space-y-1.5" role="radiogroup" aria-label="Tabla a exportar">
            {TABLAS_CSV.map((t) => (
              <button
                key={t.valor}
                role="radio"
                aria-checked={tabla === t.valor}
                onClick={() => setTabla(t.valor)}
                className={`block w-full rounded-md px-4 py-3 text-left transition-colors ${tabla === t.valor ? 'bg-tinta text-white' : 'bg-niebla active:bg-linea'}`}
              >
                <div className="font-semibold">{t.texto}</div>
                <div className={`text-xs ${tabla === t.valor ? 'text-white/70' : 'text-apagado'}`}>{t.ayuda}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </Hoja>
  )
}
