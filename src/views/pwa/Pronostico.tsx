import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Check, Factory, Printer } from 'lucide-react'
import { db, type Producto } from '../../lib/db'
import { dinero, hoy, sumarDias, textoFecha } from '../../lib/fechas'
import { PuntoSabor, Segmentado, aviso } from '../../components/ui'
import { aciertoPronostico, pronosticoSemanal, resumenVentas, type AciertoPronostico } from '../../lib/pronostico'
import { useProducido } from '../../lib/stock'
import { mostrarPdf } from '../../components/VisorPdf'
import { formato, sumaPorUnidad, unidadDe } from '../../lib/unidades'
import { Encabezado, botonPanel, botonPanelSuave } from '../admin/piezas'

const PERIODOS = { hoy: 'Hoy', semana: '7 días', mes: '30 días' } as const
// Para cuántos días producir: mañana, los próximos 3 o la semana (desde mañana).
const HORIZONTES = { 1: 'Mañana', 3: '3 días', 7: 'Semana' } as const
type Horizonte = keyof typeof HORIZONTES

// `onRegistrar`: lleva a «Stock del día» para anotar lo que ya se produjo.
export function Pronostico({ selector, conVentas = true, panel = false, onRegistrar }: { selector?: ReactNode; conVentas?: boolean; panel?: boolean; onRegistrar?: () => void }) {
  const clientes = useLiveQuery(() => db.clientes.toArray(), []) ?? []
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), []) ?? []
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const [periodo, setPeriodo] = useState<keyof typeof PERIODOS>('hoy')
  const [horizonte, setHorizonte] = useState<Horizonte>(() => { try { return (Number(localStorage.getItem('delisy:horizonte')) || 7) as Horizonte } catch { return 7 } })
  const elegirHorizonte = (h: Horizonte) => { setHorizonte(h); try { localStorage.setItem('delisy:horizonte', String(h)) } catch { /* sin almacenamiento */ } }

  const pron = useMemo(() => pronosticoSemanal(clientes, pedidos, productos, undefined, horizonte), [clientes, pedidos, productos, horizonte])
  // Corrección (opcional, se recuerda): si el pronóstico suele pasarse o quedarse corto (`sesgo` de «¿Qué tan atinado
  // es?»), se escala por lo entregado contra lo estimado, sin bajar nunca de lo ya pedido.
  const acierto = useMemo(() => aciertoPronostico(clientes, pedidos, productos), [clientes, pedidos, productos])
  const [corregir, setCorregir] = useState(() => { try { return localStorage.getItem('delisy:corregir-pronostico') === '1' } catch { return false } })
  const elegirCorregir = (si: boolean) => { setCorregir(si); try { localStorage.setItem('delisy:corregir-pronostico', si ? '1' : '0') } catch { /* sin almacenamiento */ } }
  const factores = useMemo(() => new Map(acierto.filter((a) => Math.abs(a.sesgo) >= 8 && a.estimado > 0).map((a) => [a.unidad, a.real / a.estimado])), [acierto])
  const corregido = corregir && factores.size > 0
  const filas = useMemo(() => pron.filas.map((f) => {
    const k = corregido ? factores.get(unidadDe(f.producto)) ?? 1 : 1
    if (k === 1) return { ...f, razon: 1 }
    const estimado = Math.max(0, Math.round(((f.confirmado + f.estimado) * k - f.confirmado) * 2) / 2)
    return { ...f, estimado, total: Math.ceil(f.confirmado + estimado), razon: f.estimado > 0 ? estimado / f.estimado : 1 }
  }).filter((f) => f.total > 0).sort((a, b) => b.total - a.total), [pron.filas, corregido, factores])
  const totalConf = sumaPorUnidad(filas.filter((f) => f.confirmado > 0).map((f) => ({ unidad: f.producto.unidad, cantidad: f.confirmado })))
  const totalEst = sumaPorUnidad(filas.filter((f) => f.estimado > 0).map((f) => ({ unidad: f.producto.unidad, cantidad: f.estimado })))
  const cuando = horizonte === 1 ? `mañana, ${textoFecha(pron.desde)}` : `de ${textoFecha(pron.desde)} a ${textoFecha(pron.hasta)}`
  // Lo ya anotado en Stock del día para esos días (sólo con servidor, administrador): se descuenta y se dice cuánto falta.
  const producido = useProducido(pron.desde, pron.hasta, !!onRegistrar)
  const hayProducido = !!producido && filas.some((f) => (producido.get(f.producto.id) ?? 0) > 0)
  const faltaDe = (f: (typeof filas)[number]) => Math.max(0, Math.ceil(f.total - (producido?.get(f.producto.id) ?? 0)))
  const [imprimiendo, setImprimiendo] = useState(false)
  const desde = periodo === 'hoy' ? hoy() : sumarDias(hoy(), periodo === 'semana' ? -6 : -29)
  const ventas = useMemo(() => resumenVentas(pedidos, productos, desde, hoy()), [pedidos, productos, desde])
  // Catálogo flexible: cada sabor en su unidad, los totales por unidad («40 L + 10 kg») y cada barra comparada sólo
  // con las de su misma unidad. Para el yogurt todo sigue en litros.
  const l = (n: number, p: Parameters<typeof unidadDe>[0]) => `${formato(Math.round(n * 100) / 100)} ${unidadDe(p)}`
  const totalProd = sumaPorUnidad(filas.map((f) => ({ unidad: f.producto.unidad, cantidad: f.total }))) || l(0, productos[0])
  const totalFalta = sumaPorUnidad(filas.map((f) => ({ unidad: f.producto.unidad, cantidad: faltaDe(f) }))) || l(0, productos[0])
  const totalProducido = sumaPorUnidad(filas.map((f) => ({ unidad: f.producto.unidad, cantidad: Math.min(f.total, producido?.get(f.producto.id) ?? 0) })))
  async function imprimir() {
    setImprimiendo(true)
    try {
      const pdf = await import('../../lib/reportePdf')
      await pdf.prepararLogoPdf()
      const o = (n: number, p: (typeof productos)[number]) => (n > 0 ? l(n, p) : '—')
      mostrarPdf(pdf.hojaProduccionPdf(cuando, filas.map((f) => ({
        sabor: f.producto.sabor, color: f.producto.color_hex, pedido: o(f.confirmado, f.producto), estimado: o(f.estimado, f.producto),
        total: l(f.total, f.producto), falta: hayProducido ? o(faltaDe(f), f.producto) : undefined,
      })), { total: totalProd, falta: hayProducido ? totalFalta : undefined }), `produccion-${pron.desde}.pdf`)
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo generar')
    } finally {
      setImprimiendo(false)
    }
  }
  const maximo = (filas: { producto: { unidad?: string }; n: number }[]) => {
    const m = new Map<string, number>()
    for (const f of filas) m.set(unidadDe(f.producto), Math.max(m.get(unidadDe(f.producto)) ?? 1, f.n))
    return (p: { unidad?: string }) => m.get(unidadDe(p)) ?? 1
  }
  const maxProdDe = maximo(filas.map((f) => ({ producto: f.producto, n: f.total })))
  const maxVentaDe = maximo(ventas.porSabor.map((s) => ({ producto: s.producto, n: s.litros })))
  const soloLitros = productos.every((p) => unidadDe(p) === 'L')
  // Con una sola unidad, el total se puede partir en una barra: cuánto ya está pedido y cuánto es estimado.
  const unaUnidad = new Set(filas.map((f) => unidadDe(f.producto))).size === 1
  const sumaConf = filas.reduce((a, f) => a + f.confirmado, 0)
  const sumaEst = filas.reduce((a, f) => a + f.estimado, 0)
  const sumaTotal = filas.reduce((a, f) => a + f.total, 0)
  const sumaHecha = filas.reduce((a, f) => a + Math.min(f.total, producido?.get(f.producto.id) ?? 0), 0)
  const entregado = sumaPorUnidad(ventas.porSabor.map((s) => ({ unidad: s.producto.unidad, cantidad: s.litros }))) || l(0, productos[0])

  return (
    <div className={panel ? 'mx-auto max-w-[1280px] px-4 pt-2 sm:px-8' : 'h-full overflow-y-auto px-4 pt-safe pb-24'}>
      {panel ? (
        <Encabezado titulo={conVentas ? 'Producción y ventas' : 'Producción'} detalle="Cuánto producir de cada sabor para cubrir lo que viene">
          {selector}
        </Encabezado>
      ) : (
        <>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{conVentas ? 'Producción y ventas' : 'Producción'}</h1>
          {selector && <div className="mt-3">{selector}</div>}
        </>
      )}

      <section className={panel ? '' : 'mt-4'}>
        {!panel && (
          <div className="flex items-center gap-2 text-sm font-medium text-apagado">
            <Factory size={18} /> Cuánto producir de cada sabor
          </div>
        )}
        {/* Para cuándo: cambia todo lo de abajo */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linea pb-4">
          <span className="text-sm text-apagado">Producir para</span>
          <Segmentado valor={String(horizonte) as `${Horizonte}`} onChange={(v) => elegirHorizonte(Number(v) as Horizonte)}
            opciones={(Object.keys(HORIZONTES) as `${Horizonte}`[]).map((k) => ({ valor: k, texto: HORIZONTES[Number(k) as Horizonte] }))} />
          <span className="text-sm font-medium first-letter:uppercase">{cuando}</span>
        </div>

        {/* Dos columnas en pantalla grande: los sabores (lo que se lee renglón por renglón) y, a la derecha y fijo al
            bajar, el total con sus partes, lo ya anotado y las acciones. En el teléfono el resumen va primero. */}
        <div className="mt-8 grid gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <aside className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-6 lg:self-start" aria-label="Resumen de la producción">
            <p className="text-sm text-apagado">Total a producir</p>
            <div key={horizonte} className="desplegar mt-1 text-6xl leading-none font-bold tracking-tight tabular-nums">{totalProd}</div>
            {corregido && (
              <p className="mt-2 text-xs text-apagado">
                Corregido según cómo le ha ido: {[...factores].map(([u, k]) => `${k > 1 ? '+' : ''}${Math.round((k - 1) * 100)}% en ${u}`).join(', ')}.
              </p>
            )}

            {filas.length > 0 && (
              <>
                {unaUnidad && sumaConf + sumaEst > 0 && (
                  <div className="mt-6 flex h-3 gap-0.5 overflow-hidden rounded-full bg-niebla" role="img" aria-label={`${totalConf || '0'} ya pedidos y ${totalEst || '0'} estimados`}>
                    {sumaConf > 0 && <div className="barra-crece h-full rounded-full bg-tinta" style={{ width: `${(sumaConf / (sumaConf + sumaEst)) * 100}%` }} />}
                    {sumaEst > 0 && <div className="barra-crece relleno-estimado h-full rounded-full" style={{ width: `${(sumaEst / (sumaConf + sumaEst)) * 100}%`, ['--estimado' as string]: 'var(--color-tinta)', animationDelay: '80ms' }} />}
                  </div>
                )}
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-1 h-3 w-5 shrink-0 rounded-sm bg-tinta" aria-hidden="true" />
                    <div>
                      <dt className="font-semibold tabular-nums">{totalConf || 'Nada'} ya pedido</dt>
                      <dd className="text-xs text-apagado">{pron.pedidosConfirmados ? `${pron.pedidosConfirmados} ${pron.pedidosConfirmados === 1 ? 'pedido agendado' : 'pedidos agendados'}: seguro se entregan` : 'Todavía nadie ha pedido para esos días'}</dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="relleno-estimado mt-1 h-3 w-5 shrink-0 rounded-sm" style={{ ['--estimado' as string]: 'var(--color-tinta)' }} aria-hidden="true" />
                    <div>
                      <dt className="font-semibold tabular-nums">{totalEst || 'Nada'} estimado</dt>
                      <dd className="text-xs text-apagado">
                        {pron.clientesEstimados
                          ? `Lo que suelen pedir ${pron.clientesEstimados} ${pron.clientesEstimados === 1 ? 'cliente al que le toca' : 'clientes a los que les toca'} visita y aún no ${pron.clientesEstimados === 1 ? 'pide' : 'piden'}`
                          : 'Nadie más tiene visita sin pedido'}
                      </dd>
                    </div>
                  </div>
                </dl>
              </>
            )}

            {hayProducido && (
              <div className="mt-6 border-t border-linea pt-4">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-semibold">Ya anotado</span>
                  <span className="tabular-nums text-apagado">{totalProducido} de {totalProd}</span>
                </div>
                {unaUnidad && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-niebla" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((sumaHecha / Math.max(1, sumaTotal)) * 100)}>
                    <div className="barra-crece h-full rounded-full bg-verde" style={{ width: `${Math.min(100, (sumaHecha / Math.max(1, sumaTotal)) * 100)}%` }} />
                  </div>
                )}
                <p className="mt-2 text-sm">
                  {filas.every((f) => faltaDe(f) === 0)
                    ? <span className="flex items-center gap-1 font-semibold text-verde"><Check size={15} aria-hidden="true" /> Ya está todo cubierto</span>
                    : <>Te faltan <span className="font-semibold tabular-nums">{totalFalta}</span></>}
                </p>
              </div>
            )}

            {filas.length > 0 && (
              <div className="mt-6 flex flex-col gap-2">
                {onRegistrar && <button type="button" onClick={onRegistrar} className={`${botonPanel} justify-center`}>Anotar lo producido <ArrowRight size={16} aria-hidden="true" /></button>}
                <button type="button" onClick={() => void imprimir()} disabled={imprimiendo} className={`${botonPanelSuave} justify-center`}>
                  <Printer size={16} aria-hidden="true" /> {imprimiendo ? 'Generando…' : 'Imprimir hoja para la cocina'}
                </button>
              </div>
            )}

            {acierto.length > 0 && <QueTanAtinado acierto={acierto} corregir={corregido} puede={factores.size > 0} onCorregir={elegirCorregir} />}
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-xl font-semibold tracking-tight">Por sabor</h2>
              {filas.length > 0 && (
                <p className="flex items-center gap-3 text-xs text-apagado">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-apagado" aria-hidden="true" /> pedido</span>
                  <span className="flex items-center gap-1.5"><span className="relleno-estimado h-2.5 w-4 rounded-sm" style={{ ['--estimado' as string]: 'var(--color-apagado)' }} aria-hidden="true" /> estimado</span>
                </p>
              )}
            </div>

            {filas.length === 0 ? (
              <p className="mt-4 border-t border-linea py-8 text-sm text-apagado">
                No hay nada que producir para {cuando}: no hay pedidos agendados ni clientes con visita e historial para estimar.
              </p>
            ) : (
              <ul key={`filas-${horizonte}`} className="mt-3 divide-y divide-linea border-y border-linea">
                {filas.map((f, i) => {
                  const max = maxProdDe(f.producto)
                  const falta = faltaDe(f)
                  return (
                    <li key={f.producto.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)_7rem]">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <PuntoSabor color={f.producto.color_hex} className="h-4 w-4" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{f.producto.sabor}</div>
                          <div className="truncate text-xs text-apagado tabular-nums">
                            {[f.confirmado > 0 && `${l(f.confirmado, f.producto)} pedido`, f.estimado > 0 && `${l(f.estimado, f.producto)} est.`].filter(Boolean).join(' + ')}
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2 row-start-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-niebla sm:col-span-1 sm:col-start-2 sm:row-start-1" role="img"
                        aria-label={`${f.producto.sabor}: ${l(f.confirmado, f.producto)} ya pedidos y ${l(f.estimado, f.producto)} estimados`}>
                        {f.confirmado > 0 && <div className="barra-crece h-full rounded-full" style={{ width: `${(f.confirmado / max) * 100}%`, backgroundColor: f.producto.color_hex, animationDelay: `${i * 40}ms` }} />}
                        {f.estimado > 0 && <div className="barra-crece relleno-estimado h-full rounded-full" style={{ width: `${(f.estimado / max) * 100}%`, ['--estimado' as string]: f.producto.color_hex, animationDelay: `${i * 40 + 80}ms` }} />}
                      </div>
                      <div className="col-start-2 row-start-1 text-right sm:col-start-3">
                        <div className="text-xl font-semibold tabular-nums">{l(f.total, f.producto)}</div>
                        {hayProducido && (falta > 0
                          ? <div className="text-xs font-semibold tabular-nums">faltan {l(falta, f.producto)}</div>
                          : <div className="flex items-center justify-end gap-1 text-xs font-semibold text-verde"><Check size={13} aria-hidden="true" /> cubierto</div>)}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {horizonte > 1 && filas.length > 0 && <DiaPorDia dias={pron.dias} filas={filas} productos={productos} l={l} />}
          </div>
        </div>
      </section>

      {conVentas && <>
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Ventas</h2>
        <Segmentado
          valor={periodo}
          onChange={setPeriodo}
          opciones={(Object.keys(PERIODOS) as (keyof typeof PERIODOS)[]).map((k) => ({ valor: k, texto: PERIODOS[k] }))}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Tarjeta valor={dinero(ventas.dinero)} etiqueta="Cobrado" />
        <Tarjeta valor={dinero(ventas.margen)} etiqueta="Ganancia neta" acento />
        <Tarjeta valor={entregado} etiqueta={soloLitros ? 'Litros entregados' : 'Entregado'} />
        <Tarjeta valor={String(ventas.clientes)} etiqueta="Clientes atendidos" />
      </div>

      {ventas.porSabor.length > 0 && (
        <>
          <div className="mt-3 divide-y divide-linea">
            {ventas.porSabor.map((s) => (
              <div key={s.producto.id} className="flex items-center gap-3 py-3">
                <PuntoSabor color={s.producto.color_hex} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-semibold">{s.producto.sabor}</span>
                    <span className="text-apagado tabular-nums">{l(s.litros, s.producto)} · {dinero(s.dinero)} · <span className="text-verde">+{dinero(s.margen)}</span></span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-niebla">
                    <div className="h-full rounded-md bg-tinta" style={{ width: `${(s.litros / maxVentaDe(s.producto)) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      </>}
    </div>
  )
}

// Cuánto se ha desviado el pronóstico de lo que de verdad se entregó, para saber cuánto fiarse del número. Va en la
// columna del resumen: el desvío grande, el veredicto y, si se pasa o se queda corto, el botón para corregirlo.
function QueTanAtinado({ acierto, corregir, puede, onCorregir }: { acierto: AciertoPronostico[]; corregir: boolean; puede: boolean; onCorregir: (si: boolean) => void }) {
  return (
    <div className="mt-8 border-t border-linea pt-5">
      <h2 className="text-sm font-semibold">¿Qué tan atinado es?</h2>
      {acierto.map((a) => {
        const veredicto = a.desvio <= 15 ? 'Puedes fiarte de él.' : a.desvio <= 30 ? 'Úsalo como guía y ajusta a ojo.' : 'Todavía falla mucho: con más historial mejora.'
        const tendencia = a.sesgo >= 8 ? `Suele pasarse un ${a.sesgo}%: puedes producir un poco menos.` : a.sesgo <= -8 ? `Suele quedarse corto un ${-a.sesgo}%: produce un poco más.` : ''
        return (
          <div key={a.unidad} className="mt-3">
            <p className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight tabular-nums">±{a.desvio}%</span>
              <span className="text-xs text-apagado">de desvío por día{acierto.length > 1 && ` (${a.unidad})`}</span>
            </p>
            <p className="mt-1 text-sm">{veredicto} {tendencia}</p>
            <p className="mt-1 text-xs text-apagado tabular-nums">Últimos {a.dias} días con entregas: estimó {formato(a.estimado)} {a.unidad}, se entregaron {formato(a.real)} {a.unidad}.</p>
          </div>
        )
      })}
      {puede && (
        <button type="button" onClick={() => onCorregir(!corregir)} aria-pressed={corregir} className={`${botonPanelSuave} mt-4 w-full justify-center`}>
          {corregir ? 'Quitar la corrección' : 'Corregir el pronóstico según esto'}
        </button>
      )}
    </div>
  )
}

// Para la semana o los 3 días: qué se necesita de cada sabor cada día (lo ya pedido más lo estimado, con la corrección
// si está puesta), para producir cerca del día en que sale. Una tabla: días en columnas, sabores en renglones; cada
// celda se tiñe del color del sabor según cuánto sale ese día (comparado con su día más fuerte).
function DiaPorDia({ dias, filas, productos, l }: {
  dias: { fecha: string; sabores: { productoId: string; confirmado: number; estimado: number }[] }[]
  filas: { producto: Producto; razon: number }[]
  productos: Producto[]
  l: (n: number, p: Producto) => string
}) {
  const prod = new Map(productos.map((p) => [p.id, p]))
  const razon = new Map(filas.map((f) => [f.producto.id, f.razon]))
  const cantidad = new Map<string, number>()
  for (const d of dias) for (const x of d.sabores) cantidad.set(`${d.fecha}|${x.productoId}`, Math.ceil((x.confirmado + x.estimado * (razon.get(x.productoId) ?? 1)) * 2) / 2)
  const sabores = filas.map((f) => f.producto).filter((p) => prod.has(p.id))
  if (!dias.length || !sabores.length) return null
  return (
    <section className="mt-10" aria-labelledby="dia-por-dia">
      <h2 id="dia-por-dia" className="text-xl font-semibold tracking-tight">Día por día</h2>
      <p className="mt-1 text-sm text-apagado">Qué sale cada día, para producir cada sabor lo más cerca del día en que se entrega.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b border-linea text-xs text-apagado">
              <th scope="col" className="py-2 pr-3 text-left font-medium">Sabor</th>
              {dias.map((d) => <th key={d.fecha} scope="col" className="px-1 py-2 text-center font-medium capitalize">{textoFecha(d.fecha)}</th>)}
            </tr>
          </thead>
          <tbody>
            {sabores.map((p) => {
              const fuerte = Math.max(1, ...dias.map((d) => cantidad.get(`${d.fecha}|${p.id}`) ?? 0))
              return (
                <tr key={p.id} className="border-b border-linea">
                  <th scope="row" className="py-1.5 pr-3 text-left font-semibold">
                    <span className="flex items-center gap-2 whitespace-nowrap"><PuntoSabor color={p.color_hex} className="h-3 w-3" /> {p.sabor}</span>
                  </th>
                  {dias.map((d) => {
                    const n = cantidad.get(`${d.fecha}|${p.id}`) ?? 0
                    return (
                      <td key={d.fecha} className="p-1 text-center">
                        {n > 0
                          ? <span className="block rounded-md py-1.5 font-medium whitespace-nowrap" style={{ backgroundColor: `color-mix(in srgb, ${p.color_hex} ${Math.round(12 + (n / fuerte) * 33)}%, transparent)` }}>{l(n, p)}</span>
                          : <span className="block py-1.5 text-apagado/60">—</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Tarjeta({ valor, etiqueta, acento }: { valor: string; etiqueta: string; acento?: boolean }) {
  return (
    <div className="border-t border-linea pt-3">
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${acento ? 'text-verde' : ''}`}>{valor}</div>
      <div className="text-xs text-apagado">{etiqueta}</div>
    </div>
  )
}
