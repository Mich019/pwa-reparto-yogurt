import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Factory, TrendingDown, TrendingUp } from 'lucide-react'
import { db } from '../../lib/db'
import { dinero, hoy, sumarDias, textoFecha } from '../../lib/fechas'
import { PuntoSabor, Segmentado } from '../../components/ui'
import { pronosticoSemanal, resumenVentas } from '../../lib/pronostico'
import { formato, sumaPorUnidad, unidadDe } from '../../lib/unidades'

const PERIODOS = { hoy: 'Hoy', semana: '7 días', mes: '30 días' } as const

export function Pronostico({ selector }: { selector?: ReactNode }) {
  const clientes = useLiveQuery(() => db.clientes.toArray(), []) ?? []
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), []) ?? []
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const [periodo, setPeriodo] = useState<keyof typeof PERIODOS>('hoy')

  const pron = useMemo(() => pronosticoSemanal(clientes, pedidos, productos), [clientes, pedidos, productos])
  const desde = periodo === 'hoy' ? hoy() : sumarDias(hoy(), periodo === 'semana' ? -6 : -29)
  const ventas = useMemo(() => resumenVentas(pedidos, productos, desde, hoy()), [pedidos, productos, desde])
  // Catálogo flexible: cada sabor en su unidad, los totales por unidad («40 L + 10 kg») y cada barra comparada sólo
  // con las de su misma unidad. Para el yogurt todo sigue en litros.
  const l = (n: number, p: Parameters<typeof unidadDe>[0]) => `${formato(Math.round(n * 100) / 100)} ${unidadDe(p)}`
  const totalProd = sumaPorUnidad(pron.filas.map((f) => ({ unidad: f.producto.unidad, cantidad: f.total }))) || l(0, productos[0])
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
    <div className="h-full overflow-y-auto px-4 pt-safe pb-24">
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Producción y ventas</h1>
      {selector && <div className="mt-3">{selector}</div>}

      <section className="mt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-apagado">
          <Factory size={18} /> Producción para la próxima semana
        </div>
        <div className="text-xs text-apagado">{textoFecha(pron.desde)} a {textoFecha(pron.hasta)}</div>
        <div className="mt-2 text-5xl leading-none font-bold tracking-tight tabular-nums">{totalProd}</div>
        {pron.filas.length === 0 && <div className="mt-3 text-sm text-apagado">Aún no hay pedidos agendados ni historial para proyectar.</div>}
        <div className="mt-5 divide-y divide-linea">
          {pron.filas.map((f) => (
            <div key={f.producto.id} className="flex items-center gap-3 py-3">
              <PuntoSabor color={f.producto.color_hex} className="h-5 w-5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{f.producto.sabor}</span>
                  <span className="text-lg font-semibold tabular-nums">{l(f.total, f.producto)}</span>
                </div>
                <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-niebla">
                  <div className="h-full bg-tinta" style={{ width: `${(f.confirmado / maxProdDe(f.producto)) * 100}%` }} />
                  <div className="h-full bg-tinta/30" style={{ width: `${(f.estimado / maxProdDe(f.producto)) * 100}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-apagado">
                  {l(f.confirmado, f.producto)} agendados{f.estimado > 0 && ` · ~${l(f.estimado, f.producto)} estimados por historial`}
                </div>
              </div>
            </div>
          ))}
        </div>
        {pron.clientesEstimados > 0 && (
          <div className="mt-2 text-xs text-apagado">
            La parte gris es lo estimado para {pron.clientesEstimados} cliente{pron.clientesEstimados > 1 ? 's' : ''} que les toca visita pero aún no confirman pedido.
          </div>
        )}
      </section>

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
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-niebla p-3">
              <div className="flex items-center gap-1 text-xs text-verde"><TrendingUp size={14} /> Más vendido</div>
              <div className="mt-1 flex items-center gap-1.5 font-semibold"><PuntoSabor color={ventas.porSabor[0].producto.color_hex} className="h-3.5 w-3.5" />{ventas.porSabor[0].producto.sabor}</div>
            </div>
            <div className="rounded-2xl bg-niebla p-3">
              <div className="flex items-center gap-1 text-xs text-amber-600"><TrendingDown size={14} /> Menos vendido</div>
              <div className="mt-1 flex items-center gap-1.5 font-semibold"><PuntoSabor color={ventas.porSabor[ventas.porSabor.length - 1].producto.color_hex} className="h-3.5 w-3.5" />{ventas.porSabor[ventas.porSabor.length - 1].producto.sabor}</div>
            </div>
          </div>
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
                    <div className="h-full rounded-full bg-tinta" style={{ width: `${(s.litros / maxVentaDe(s.producto)) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Tarjeta({ valor, etiqueta, acento }: { valor: string; etiqueta: string; acento?: boolean }) {
  return (
    <div className="rounded-2xl bg-niebla p-3">
      <div className={`text-2xl font-semibold tracking-tight tabular-nums ${acento ? 'text-verde' : ''}`}>{valor}</div>
      <div className="text-xs text-apagado">{etiqueta}</div>
    </div>
  )
}
