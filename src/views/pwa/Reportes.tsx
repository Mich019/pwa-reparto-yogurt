import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Star, TrendingDown, TrendingUp, WifiOff } from 'lucide-react'
import { dinero, hoy, sumarDias } from '../../lib/fechas'
import {
  agrupacionesPosibles, agrupacionSugerida, cambio, diasDelRango, exportarReporte, mover, rangoDe, TABLAS_CSV, textoPeriodo, textoRango, useReporte,
  type Agrupar, type Formato, type Rango, type Reporte, type TablaCsv, type Vista,
} from '../../lib/reportes'
import { aviso, Boton, claseInput, Hoja, PuntoSabor, Segmentado } from '../../components/ui'
import { Columnas } from '../../components/graficas'

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
const litros = (n: number) => `${num(n)} L`
const porcentaje = (n: number | null) => (n === null ? '—' : `${num(n)}%`)
const dineroEje = (n: number) => `$${n >= 1000 ? `${num(n / 1000)}k` : num(n)}`
const ejeLitros = (n: number) => (n >= 1000 ? `${num(n / 1000)}k` : num(n))

export function Reportes() {
  const [vista, setVista] = useState<Vista>('dia')
  const [ancla, setAncla] = useState(hoy)
  const [libre, setLibre] = useState<Rango>(() => ({ desde: sumarDias(hoy(), -29), hasta: hoy() }))
  const [elegida, setElegida] = useState<Agrupar | null>(null)
  const [exportando, setExportando] = useState(false)

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
  function cambiarLibre(campo: keyof Rango, valor: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return
    const r = { ...libre, [campo]: valor > hoy() ? hoy() : valor }
    if (r.desde > r.hasta) r[campo === 'desde' ? 'hasta' : 'desde'] = r[campo]
    if (diasDelRango(r) > MAX_DIAS) r[campo === 'desde' ? 'hasta' : 'desde'] = sumarDias(r[campo], campo === 'desde' ? MAX_DIAS - 1 : 1 - MAX_DIAS)
    setLibre(r)
  }

  return (
    <div className="h-full overflow-y-auto px-4 pt-safe pb-24">
      <div className="mx-auto max-w-5xl">
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Reportes</h1>

        <Segmentado valor={vista} onChange={cambiarVista} opciones={VISTAS} className="mt-4" />
        {vista === 'rango' ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-apagado">Desde</span>
              <input type="date" className={claseInput} value={libre.desde} max={libre.hasta} onChange={(e) => cambiarLibre('desde', e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-apagado">Hasta</span>
              <input type="date" className={claseInput} value={libre.hasta} min={libre.desde} max={hoy()} onChange={(e) => cambiarLibre('hasta', e.target.value)} />
            </label>
          </div>
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
              exportar={() => setExportando(true)}
            />
          </div>
        )}
      </div>

      <HojaExportar abierta={exportando} onCerrar={() => setExportando(false)} rango={rango} agrupar={agrupar} />
    </div>
  )
}

function Fallo({ error, reintentar, chico }: { error: { texto: string; sinRed: boolean }; reintentar: () => void; chico?: boolean }) {
  return (
    <div className={`${chico ? 'mt-3' : 'mt-8'} flex items-center gap-3 rounded-2xl bg-niebla p-4`} role="alert">
      <WifiOff size={22} className="shrink-0 text-apagado" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">{error.sinRed ? 'Los reportes necesitan conexión' : 'No se pudo cargar el reporte'}</div>
        <div className="text-apagado">{error.sinRed ? 'Se arman en el servidor con todo el historial.' : error.texto}</div>
      </div>
      <button onClick={reintentar} className="rounded-full bg-tinta px-4 py-2 text-xs font-semibold text-white active:bg-neutral-700">Reintentar</button>
    </div>
  )
}

function Contenido({ reporte, vista, enCurso, posibles, agrupar, onAgrupar, exportar }: {
  reporte: Reporte
  vista: Vista
  enCurso: boolean
  posibles: Agrupar[]
  agrupar: Agrupar
  onAgrupar: (a: Agrupar) => void
  exportar: () => void
}) {
  const { resumen: r, anterior } = reporte
  const comparar = !enCurso && anterior
  const sinVentas = r.pedidos === 0
  const variosAnios = reporte.desde.slice(0, 4) !== reporte.hasta.slice(0, 4)
  const maxLitros = Math.max(1, ...reporte.sabores.map((s) => s.litros))
  const maxIngreso = Math.max(1, ...reporte.vendedores.map((v) => v.ingreso))
  const estrella = reporte.sabores.find((s) => s.id === reporte.ranking.estrella)
  const menor = reporte.sabores.find((s) => s.id === reporte.ranking.menorRotacion)
  const barras = (valor: (p: Reporte['periodos'][number]) => number) =>
    reporte.periodos.map((p) => ({ clave: p.periodo, eje: textoPeriodo(p, agrupar, false, variosAnios), nombre: textoPeriodo(p, agrupar, true), valor: valor(p) }))

  return (
    <>
      <div className="mt-5 flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight">Resumen</h2>
        <button onClick={exportar} className="flex items-center gap-1.5 rounded-full bg-niebla px-4 py-2.5 text-[13px] font-semibold active:bg-linea">
          <Download size={16} /> Exportar
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tarjeta etiqueta="Recaudado" valor={dinero(r.ingreso)} cambio={comparar ? cambio(r.ingreso, anterior.resumen.ingreso) : null} />
        <Tarjeta etiqueta="Utilidad neta" valor={dinero(r.utilidad)} acento pie={`Margen ${porcentaje(r.margenPct)}`} cambio={comparar ? cambio(r.utilidad, anterior.resumen.utilidad) : null} />
        <Tarjeta etiqueta="Litros entregados" valor={litros(r.litros)} cambio={comparar ? cambio(r.litros, anterior.resumen.litros) : null} />
        <Tarjeta etiqueta="Clientes atendidos" valor={String(r.clientes)} pie={`${r.pedidos} ${r.pedidos === 1 ? 'pedido' : 'pedidos'}`} />
      </div>
      {comparar && <p className="mt-2 text-xs text-apagado">Los cambios son frente {ANTERIOR[vista]}.</p>}
      {!sinVentas && (
        <p className="mt-1 text-xs text-apagado">
          Efectivo {dinero(r.efectivo)} · Transferencia {dinero(r.transferencia)}{r.ticketPromedio !== null && ` · Ticket promedio ${dinero(r.ticketPromedio)}`}
        </p>
      )}

      {sinVentas ? (
        <div className="mt-8 rounded-2xl bg-niebla p-6 text-center">
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
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                <Columnas titulo="Ingresos" barras={barras((p) => p.ingreso)} color="bg-azul" formato={dinero} formatoEje={dineroEje} total={dinero(r.ingreso)} />
                <Columnas titulo="Litros" barras={barras((p) => p.litros)} color="bg-tinta" formato={litros} formatoEje={ejeLitros} total={litros(r.litros)} />
              </div>
              <details className="mt-2 rounded-2xl bg-niebla px-4 py-3 text-sm">
                <summary className="cursor-pointer font-semibold">Ver como tabla</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[26rem] text-left tabular-nums">
                    <thead className="text-xs text-apagado">
                      <tr><th className="py-1 font-medium">{AGRUPAR[agrupar]}</th><th className="font-medium">Pedidos</th><th className="font-medium">Litros</th><th className="font-medium">Ingresos</th><th className="font-medium">Utilidad</th></tr>
                    </thead>
                    <tbody className="divide-y divide-linea">
                      {reporte.periodos.map((p) => (
                        <tr key={p.periodo}>
                          <td className="py-1.5">{textoPeriodo(p, agrupar, true)}</td><td>{p.pedidos}</td><td>{num(p.litros)}</td><td>{dinero(p.ingreso)}</td><td>{dinero(p.utilidad)}</td>
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
              <p className="text-xs text-apagado">Del que más litros vendió al que menos. La utilidad usa el costo de cuando se vendió.</p>
              {estrella && menor && estrella.id !== menor.id && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-niebla p-3">
                    <div className="flex items-center gap-1 text-xs font-medium text-verde"><TrendingUp size={14} /> Sabor estrella</div>
                    <div className="mt-1 font-semibold">{estrella.sabor}</div>
                    <div className="text-xs text-apagado tabular-nums">{litros(estrella.litros)}</div>
                  </div>
                  <div className="rounded-2xl bg-niebla p-3">
                    <div className="flex items-center gap-1 text-xs font-medium text-rojo"><TrendingDown size={14} /> Menor rotación</div>
                    <div className="mt-1 font-semibold">{menor.sabor}</div>
                    <div className="text-xs text-apagado tabular-nums">{litros(menor.litros)}</div>
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
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{litros(s.litros)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-niebla">
                        <div className="h-full rounded-full bg-tinta" style={{ width: `${(s.litros / maxLitros) * 100}%` }} />
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
              <p className="text-xs text-apagado">Rendimiento en el periodo, de más a menos ingresos.</p>
              <div className="mt-2 divide-y divide-linea">
                {reporte.vendedores.map((v) => (
                  <div key={v.id ?? 'sin'} className="flex items-center gap-3 py-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tinta text-sm font-bold text-white" aria-hidden>{v.nombre.charAt(0).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-semibold">
                          {v.nombre}
                          {!v.activo && v.id && <span className="ml-1.5 rounded-full bg-niebla px-2 py-0.5 text-[10px] font-semibold text-apagado">Dado de baja</span>}
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{dinero(v.ingreso)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-niebla">
                        <div className="h-full rounded-full bg-azul" style={{ width: `${(v.ingreso / maxIngreso) * 100}%` }} />
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-apagado tabular-nums">
                        <span>{v.pedidos} {v.pedidos === 1 ? 'pedido' : 'pedidos'}</span>
                        <span>{v.clientes} {v.clientes === 1 ? 'cliente' : 'clientes'}</span>
                        <span>{litros(v.litros)}</span>
                        {v.ticketPromedio !== null && <span>Ticket {dinero(v.ticketPromedio)}</span>}
                        <span className={v.utilidad >= 0 ? 'text-verde' : 'text-rojo'}>Utilidad {dinero(v.utilidad)}</span>
                        {v.omitidos > 0 && <span>{v.omitidos} {v.omitidos === 1 ? 'visita sin venta' : 'visitas sin venta'}</span>}
                      </div>
                    </div>
                  </div>
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

function Tarjeta({ etiqueta, valor, acento, pie, cambio: c }: { etiqueta: string; valor: string; acento?: boolean; pie?: string; cambio?: number | null }) {
  return (
    <div className="rounded-2xl bg-niebla p-3">
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${acento ? 'text-verde' : ''}`}>{valor}</div>
      <div className="text-xs text-apagado">{etiqueta}</div>
      {(pie || (c !== null && c !== undefined)) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-apagado">
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

function HojaExportar({ abierta, onCerrar, rango, agrupar }: { abierta: boolean; onCerrar: () => void; rango: Rango; agrupar: Agrupar }) {
  const [formato, setFormato] = useState<Formato>('xlsx')
  const [tabla, setTabla] = useState<TablaCsv>('ventas')
  const [bajando, setBajando] = useState(false)

  async function descargar() {
    setBajando(true)
    try {
      const nombre = await exportarReporte(rango, agrupar, formato, tabla)
      aviso(`Se descargó ${nombre}`)
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
      pie={<Boton onClick={descargar} disabled={bajando} className="w-full"><Download size={18} /> {bajando ? 'Preparando…' : 'Descargar'}</Boton>}
    >
      <p className="text-sm text-apagado">Del {rango.desde} al {rango.hasta}.</p>
      <Segmentado
        valor={formato}
        onChange={setFormato}
        className="mt-3"
        opciones={[
          { valor: 'xlsx', texto: <><FileSpreadsheet size={16} /> Excel</> },
          { valor: 'csv', texto: <><FileText size={16} /> CSV</> },
        ]}
      />
      {formato === 'xlsx' ? (
        <p className="mt-3 pb-4 text-sm text-apagado">Un libro de Excel (.xlsx) con cinco hojas: resumen, por periodo, por sabor, por vendedor y el historial de ventas.</p>
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
                className={`block w-full rounded-xl px-4 py-3 text-left transition-colors ${tabla === t.valor ? 'bg-tinta text-white' : 'bg-niebla active:bg-linea'}`}
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
