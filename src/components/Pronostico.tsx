import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Factory, TrendingDown, TrendingUp } from 'lucide-react'
import { db } from '../lib/db'
import { dinero, hoy, sumarDias, textoFecha } from '../lib/fechas'
import { Segmentado } from './ui'
import { pronosticoSemanal, resumenVentas } from '../lib/pronostico'

const PERIODOS = { hoy: 'Hoy', semana: '7 días', mes: '30 días' } as const

export function Pronostico() {
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
      <h1 className="mt-3 text-[32px] leading-9 font-extrabold tracking-tight">Producción y ventas</h1>

      <section className="mt-4 rounded-2xl bg-marino p-5 text-white">
        <div className="flex items-center gap-2 text-sm font-semibold text-white/70">
          <Factory size={18} /> Producción para la próxima semana
        </div>
        <div className="text-xs text-white/50">{textoFecha(pron.desde)} a {textoFecha(pron.hasta)}</div>
        <div className="mt-3 text-5xl leading-none font-extrabold tracking-tight tabular-nums">{totalProd} L</div>
        {pron.filas.length === 0 && <div className="mt-3 text-sm text-white/60">Aún no hay pedidos agendados ni historial para proyectar.</div>}
        <div className="mt-3 space-y-2.5">
          {pron.filas.map((f) => (
            <div key={f.producto.id}>
              <div className="flex items-baseline justify-between">
                <span className="flex items-center gap-2 font-bold">
                  <span className="h-4 w-4 rounded-full border border-white/40" style={{ background: f.producto.color_hex }} />
                  {f.producto.sabor}
                </span>
                <span className="text-xl font-extrabold tabular-nums">{f.total} L</span>
              </div>
              <div className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-white/15">
                <div className="h-full" style={{ width: `${(f.confirmado / maxProd) * 100}%`, background: f.producto.color_hex }} />
                <div className="h-full opacity-60" style={{ width: `${(f.estimado / maxProd) * 100}%`, background: f.producto.color_hex }} />
              </div>
              <div className="mt-1 text-[11px] text-white/55">
                {f.confirmado} L agendados{f.estimado > 0 && ` · ~${f.estimado} L estimados por historial`}
              </div>
            </div>
          ))}
        </div>
        {pron.clientesEstimados > 0 && (
          <div className="mt-4 text-xs text-white/55">
            La parte más tenue es lo estimado para {pron.clientesEstimados} cliente{pron.clientesEstimados > 1 ? 's' : ''} que les toca visita pero aún no confirman pedido.
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
              <div className="mt-1 font-bold">{ventas.porSabor[0].producto.sabor}</div>
            </div>
            <div className="rounded-2xl bg-niebla p-3">
              <div className="flex items-center gap-1 text-xs text-amber-600"><TrendingDown size={14} /> Menos vendido</div>
              <div className="mt-1 font-bold">{ventas.porSabor[ventas.porSabor.length - 1].producto.sabor}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3 rounded-2xl bg-niebla p-4">
            {ventas.porSabor.map((s) => (
              <div key={s.producto.id}>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{s.producto.sabor}</span>
                  <span className="text-apagado tabular-nums">{s.litros} L · {dinero(s.dinero)} · <span className="text-verde">+{dinero(s.margen)}</span></span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-linea">
                  <div className="h-full rounded-full" style={{ width: `${(s.litros / maxLitros) * 100}%`, background: s.producto.color_hex }} />
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
      <div className={`text-2xl font-extrabold tracking-tight tabular-nums ${acento ? 'text-verde' : ''}`}>{valor}</div>
      <div className="text-xs text-apagado">{etiqueta}</div>
    </div>
  )
}
