import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight, Check, Factory, Printer } from 'lucide-react'
import { db } from '../../lib/db'
import { dinero, hoy, sumarDias, textoFecha } from '../../lib/fechas'
import { PuntoSabor, Segmentado, aviso } from '../../components/ui'
import { aciertoPronostico, pronosticoSemanal, resumenVentas, type AciertoPronostico } from '../../lib/pronostico'
import { useProducido } from '../../lib/stock'
import { mostrarPdf } from '../../components/VisorPdf'
import { formato, sumaPorUnidad, unidadDe } from '../../lib/unidades'
import { Encabezado, botonPanelSuave } from '../admin/piezas'

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
  const totalConf = sumaPorUnidad(pron.filas.filter((f) => f.confirmado > 0).map((f) => ({ unidad: f.producto.unidad, cantidad: f.confirmado })))
  const totalEst = sumaPorUnidad(pron.filas.filter((f) => f.estimado > 0).map((f) => ({ unidad: f.producto.unidad, cantidad: f.estimado })))
  const cuando = horizonte === 1 ? `mañana, ${textoFecha(pron.desde)}` : `de ${textoFecha(pron.desde)} a ${textoFecha(pron.hasta)}`
  // Lo ya anotado en Stock del día para esos días (sólo con servidor, administrador): se descuenta y se dice cuánto falta.
  const producido = useProducido(pron.desde, pron.hasta, !!onRegistrar)
  const hayProducido = !!producido && pron.filas.some((f) => (producido.get(f.producto.id) ?? 0) > 0)
  const faltaDe = (f: (typeof pron.filas)[number]) => Math.max(0, Math.ceil(f.total - (producido?.get(f.producto.id) ?? 0)))
  const acierto = useMemo(() => aciertoPronostico(clientes, pedidos, productos), [clientes, pedidos, productos])
  const [imprimiendo, setImprimiendo] = useState(false)
  const desde = periodo === 'hoy' ? hoy() : sumarDias(hoy(), periodo === 'semana' ? -6 : -29)
  const ventas = useMemo(() => resumenVentas(pedidos, productos, desde, hoy()), [pedidos, productos, desde])
  // Catálogo flexible: cada sabor en su unidad, los totales por unidad («40 L + 10 kg») y cada barra comparada sólo
  // con las de su misma unidad. Para el yogurt todo sigue en litros.
  const l = (n: number, p: Parameters<typeof unidadDe>[0]) => `${formato(Math.round(n * 100) / 100)} ${unidadDe(p)}`
  const totalProd = sumaPorUnidad(pron.filas.map((f) => ({ unidad: f.producto.unidad, cantidad: f.total }))) || l(0, productos[0])
  const totalFalta = sumaPorUnidad(pron.filas.map((f) => ({ unidad: f.producto.unidad, cantidad: faltaDe(f) }))) || l(0, productos[0])
  const totalProducido = sumaPorUnidad(pron.filas.map((f) => ({ unidad: f.producto.unidad, cantidad: Math.min(f.total, producido?.get(f.producto.id) ?? 0) })))
  async function imprimir() {
    setImprimiendo(true)
    try {
      const pdf = await import('../../lib/reportePdf')
      await pdf.prepararLogoPdf()
      const o = (n: number, p: (typeof productos)[number]) => (n > 0 ? l(n, p) : '—')
      mostrarPdf(pdf.hojaProduccionPdf(cuando, pron.filas.map((f) => ({
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
  const maxProdDe = maximo(pron.filas.map((f) => ({ producto: f.producto, n: f.total })))
  const maxVentaDe = maximo(ventas.porSabor.map((s) => ({ producto: s.producto, n: s.litros })))
  const soloLitros = productos.every((p) => unidadDe(p) === 'L')
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
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-sm text-apagado">Producir para</span>
          <Segmentado valor={String(horizonte) as `${Horizonte}`} onChange={(v) => elegirHorizonte(Number(v) as Horizonte)}
            opciones={(Object.keys(HORIZONTES) as `${Horizonte}`[]).map((k) => ({ valor: k, texto: HORIZONTES[Number(k) as Horizonte] }))} />
          {pron.filas.length > 0 && (
            <button type="button" onClick={() => void imprimir()} disabled={imprimiendo} className={`${botonPanelSuave} sm:ml-auto`}>
              <Printer size={16} aria-hidden="true" /> {imprimiendo ? 'Generando…' : 'Imprimir hoja'}
            </button>
          )}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[auto_1fr] lg:items-end">
          <div>
            <p className="text-sm text-apagado">Total a producir para {cuando}</p>
            <div key={horizonte} className="desplegar mt-1 text-5xl leading-none font-bold tracking-tight tabular-nums">{totalProd}</div>
            {hayProducido && (
              <p className="mt-2 text-sm">
                Ya anotaste <span className="font-semibold tabular-nums">{totalProducido}</span> en Stock del día para esos días:{' '}
                {pron.filas.every((f) => faltaDe(f) === 0)
                  ? <span className="font-semibold text-verde">ya está todo cubierto</span>
                  : <>te faltan <span className="font-semibold tabular-nums">{totalFalta}</span></>}
              </p>
            )}
          </div>
          {/* Las dos partes del total, que son también la leyenda de las barras */}
          {pron.filas.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:justify-self-end">
              <div className="flex items-start gap-2.5 rounded-xl bg-niebla p-3">
                <span className="mt-1 h-3 w-5 shrink-0 rounded-sm bg-marca" aria-hidden="true" />
                <span className="text-sm">
                  <span className="block font-semibold tabular-nums">{totalConf || '0'} ya pedidos</span>
                  <span className="block text-xs text-apagado">{pron.pedidosConfirmados} {pron.pedidosConfirmados === 1 ? 'pedido agendado' : 'pedidos agendados'}: seguro se entregan</span>
                </span>
              </div>
              <div className="flex items-start gap-2.5 rounded-xl bg-niebla p-3">
                <span className="relleno-estimado mt-1 h-3 w-5 shrink-0 rounded-sm" aria-hidden="true" />
                <span className="text-sm">
                  <span className="block font-semibold tabular-nums">{totalEst || '0'} estimados</span>
                  <span className="block text-xs text-apagado">
                    {pron.clientesEstimados
                      ? `Lo que suelen pedir ${pron.clientesEstimados} ${pron.clientesEstimados === 1 ? 'cliente al que le toca' : 'clientes a los que les toca'} visita y aún no ${pron.clientesEstimados === 1 ? 'pide' : 'piden'}`
                      : 'Nadie más tiene visita sin pedido'}
                  </span>
                </span>
              </div>
            </div>
          )}
        </div>

        {pron.filas.length === 0 && (
          <div className="mt-5 rounded-xl bg-niebla p-4 text-sm text-apagado">
            No hay nada que producir para {cuando}: no hay pedidos agendados ni clientes con visita e historial para estimar.
          </div>
        )}
        <div key={`filas-${horizonte}`} className="mt-5 divide-y divide-linea">
          {pron.filas.map((f, i) => {
            const max = maxProdDe(f.producto)
            return (
              <div key={f.producto.id} className="flex items-center gap-3 py-3.5">
                <PuntoSabor color={f.producto.color_hex} className="h-5 w-5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{f.producto.sabor}</span>
                    <span className="text-right">
                      <span className="text-lg font-semibold tabular-nums">{l(f.total, f.producto)}</span>
                      {hayProducido && (faltaDe(f) > 0
                        ? <span className="block text-xs font-semibold tabular-nums">faltan {l(faltaDe(f), f.producto)}</span>
                        : <span className="flex items-center justify-end gap-1 text-xs font-semibold text-verde"><Check size={13} aria-hidden="true" /> cubierto</span>)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-niebla" role="img"
                    aria-label={`${f.producto.sabor}: ${l(f.confirmado, f.producto)} ya pedidos y ${l(f.estimado, f.producto)} estimados`}>
                    {f.confirmado > 0 && <div className="barra-crece h-full rounded-full" style={{ width: `${(f.confirmado / max) * 100}%`, backgroundColor: f.producto.color_hex, animationDelay: `${i * 40}ms` }} />}
                    {f.estimado > 0 && <div className="barra-crece relleno-estimado h-full rounded-full" style={{ width: `${(f.estimado / max) * 100}%`, ['--estimado' as string]: f.producto.color_hex, animationDelay: `${i * 40 + 80}ms` }} />}
                  </div>
                  <div className="mt-1 text-xs text-apagado tabular-nums">
                    {[f.confirmado > 0 && `${l(f.confirmado, f.producto)} ya pedidos`, f.estimado > 0 && `${l(f.estimado, f.producto)} estimados`].filter(Boolean).join(' + ')}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        {onRegistrar && pron.filas.length > 0 && (
          <button type="button" onClick={onRegistrar}
            className="mt-4 flex items-center gap-2 rounded-md py-1 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
            ¿Ya lo produjiste? Anótalo en «Stock del día» <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        {acierto.length > 0 && <QueTanAtinado acierto={acierto} />}
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

// Cuánto se ha desviado el pronóstico de lo que de verdad se entregó, para saber cuánto fiarse del número.
function QueTanAtinado({ acierto }: { acierto: AciertoPronostico[] }) {
  return (
    <div className="mt-6 rounded-xl bg-niebla p-4">
      <h2 className="font-semibold">¿Qué tan atinado es?</h2>
      {acierto.map((a) => {
        const veredicto = a.desvio <= 15 ? 'Puedes fiarte de él.' : a.desvio <= 30 ? 'Úsalo como guía y ajusta a ojo.' : 'Todavía falla mucho: con más historial mejora.'
        const tendencia = a.sesgo >= 8 ? ` Suele pasarse (${a.sesgo}% de más): puedes producir un poco menos.` : a.sesgo <= -8 ? ` Suele quedarse corto (${-a.sesgo}% de menos): produce un poco más.` : ''
        return (
          <p key={a.unidad} className="mt-1.5 text-sm">
            En los últimos {a.dias} días con entregas, el pronóstico de cada día se desvió en promedio un{' '}
            <span className="font-semibold tabular-nums">{a.desvio}%</span> de lo entregado (estimó {formato(a.estimado)} {a.unidad}; se entregaron{' '}
            {formato(a.real)} {a.unidad}). {veredicto}{tendencia}
          </p>
        )
      })}
    </div>
  )
}

function Tarjeta({ valor, etiqueta, acento }: { valor: string; etiqueta: string; acento?: boolean }) {
  return (
    <div className="rounded-lg bg-niebla p-3">
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${acento ? 'text-verde' : ''}`}>{valor}</div>
      <div className="text-xs text-apagado">{etiqueta}</div>
    </div>
  )
}
