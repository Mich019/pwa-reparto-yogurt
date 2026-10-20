import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Factory, TrendingDown, TrendingUp } from 'lucide-react'
import { db } from '../../lib/db'
import { dinero, hoy, sumarDias, textoFecha } from '../../lib/fechas'
import { Segmentado } from '../../components/ui'
import { IconoSabor, Insignia } from '../../components/Fruta'
import { pronosticoSemanal, resumenVentas } from '../../lib/pronostico'

const PERIODOS = { hoy: 'Hoy', semana: '7 días', mes: '30 días' } as const

export function Pronostico({ selector }: { selector?: ReactNode }) {
  const clientes = useLiveQuery(() => db.clientes.toArray(), []) ?? []
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), []) ?? []
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const [periodo, setPeriodo] = useState<keyof typeof PERIODOS>('hoy')

  const pron = useMemo(() => pronosticoSemanal(clientes, pedidos, productos), [clientes, pedidos, productos])
  const desde = periodo === 'hoy' ? hoy() : sumarDias(hoy(), periodo === 'semana' ? -6 : -29)
  const ventas = useMemo(() => resumenVentas(pedidos, productos, desde, hoy()), [pedidos, productos, desde])
  const totalProd = pron.filas.reduce((s, f) => s + f.total, 0)
  const maxProd = Math.max(1, ...pron.filas.map((f) => f.total))
  const maxLitros = Math.max(1, ...ventas.porSabor.map((s) => s.litros))

  return (
    <div className="h-full overflow-y-auto px-4 pt-safe pb-24">
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Producción y ventas</h1>
      {selector && <div className="mt-3">{selector}</div>}

      <section className="mt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-apagado">
          <Factory size={18} /> Producción para la próxima semana
        </div>
        <div className="text-xs text-apagado">{textoFecha(pron.desde)} a {textoFecha(pron.hasta)}</div>
        <div className="mt-2 text-5xl leading-none font-bold tracking-tight tabular-nums">{totalProd} L</div>
        {pron.filas.length === 0 && <div className="mt-3 text-sm text-apagado">Aún no hay pedidos agendados ni historial para proyectar.</div>}
        <div className="mt-5 divide-y divide-linea">
          {pron.filas.map((f) => (
            <div key={f.producto.id} className="flex items-center gap-3 py-3">
              <Insignia sabor={f.producto.sabor} color={f.producto.color_hex} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{f.producto.sabor}</span>
                  <span className="text-lg font-semibold tabular-nums">{f.total} L</span>
                </div>
                <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-niebla">
                  <div className="h-full bg-tinta" style={{ width: `${(f.confirmado / maxProd) * 100}%` }} />
                  <div className="h-full bg-tinta/30" style={{ width: `${(f.estimado / maxProd) * 100}%` }} />
                </div>
                <div className="mt-1 text-[11px] text-apagado">
                  {f.confirmado} L agendados{f.estimado > 0 && ` · ~${f.estimado} L estimados por historial`}
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
        <Tarjeta valor={`${ventas.litros} L`} etiqueta="Litros entregados" />
        <Tarjeta valor={String(ventas.clientes)} etiqueta="Clientes atendidos" />
      </div>

      {ventas.porSabor.length > 0 && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-niebla p-3">
              <div className="flex items-center gap-1 text-xs text-verde"><TrendingUp size={14} /> Más vendido</div>
              <div className="mt-1 flex items-center gap-1.5 font-semibold"><IconoSabor sabor={ventas.porSabor[0].producto.sabor} size={20} />{ventas.porSabor[0].producto.sabor}</div>
            </div>
            <div className="rounded-2xl bg-niebla p-3">
              <div className="flex items-center gap-1 text-xs text-amber-600"><TrendingDown size={14} /> Menos vendido</div>
              <div className="mt-1 flex items-center gap-1.5 font-semibold"><IconoSabor sabor={ventas.porSabor[ventas.porSabor.length - 1].producto.sabor} size={20} />{ventas.porSabor[ventas.porSabor.length - 1].producto.sabor}</div>
            </div>
          </div>
          <div className="mt-3 divide-y divide-linea">
            {ventas.porSabor.map((s) => (
              <div key={s.producto.id} className="flex items-center gap-3 py-3">
                <Insignia sabor={s.producto.sabor} color={s.producto.color_hex} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-semibold">{s.producto.sabor}</span>
                    <span className="text-apagado tabular-nums">{s.litros} L · {dinero(s.dinero)} · <span className="text-verde">+{dinero(s.margen)}</span></span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-niebla">
                    <div className="h-full rounded-full bg-tinta" style={{ width: `${(s.litros / maxLitros) * 100}%` }} />
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
