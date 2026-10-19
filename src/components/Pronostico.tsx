import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Factory, TrendingDown, TrendingUp } from 'lucide-react'
import { db } from '../lib/db'
import { dinero, hoy, sumarDias, textoFecha } from '../lib/fechas'
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
      <h1 className="mt-2 text-2xl font-extrabold">Producción y ventas</h1>

      <section className="mt-4 rounded-3xl bg-gradient-to-br from-pink-500/20 to-slate-900 p-4 ring-1 ring-pink-500/30">
        <div className="flex items-center gap-2 text-sm font-semibold text-pink-300">
          <Factory size={18} /> Producción para la próxima semana
        </div>
        <div className="text-xs text-slate-400">{textoFecha(pron.desde)} a {textoFecha(pron.hasta)}</div>
        <div className="mt-2 text-4xl font-black tabular-nums">{totalProd} L</div>
        {pron.filas.length === 0 && <div className="mt-2 text-sm text-slate-400">Aún no hay pedidos agendados ni historial para proyectar.</div>}
        <div className="mt-3 space-y-2.5">
          {pron.filas.map((f) => (
            <div key={f.producto.id}>
              <div className="flex items-baseline justify-between">
                <span className="flex items-center gap-2 font-bold">
                  <span className="h-4 w-4 rounded-full border border-white/30" style={{ background: f.producto.color_hex }} />
                  {f.producto.sabor}
                </span>
                <span className="text-xl font-black tabular-nums">{f.total} L</span>
              </div>
              <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full" style={{ width: `${(f.confirmado / maxProd) * 100}%`, background: f.producto.color_hex }} />
                <div className="h-full opacity-40" style={{ width: `${(f.estimado / maxProd) * 100}%`, background: f.producto.color_hex }} />
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {f.confirmado} L agendados{f.estimado > 0 && ` · ~${f.estimado} L estimados por historial`}
              </div>
            </div>
          ))}
        </div>
        {pron.clientesEstimados > 0 && (
          <div className="mt-3 text-xs text-slate-400">
            La parte clara es lo estimado para {pron.clientesEstimados} cliente{pron.clientesEstimados > 1 ? 's' : ''} que les toca visita pero aún no confirman pedido.
          </div>
        )}
      </section>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-lg font-bold">Ventas</h2>
        <div className="flex rounded-xl bg-slate-900 p-1">
          {(Object.keys(PERIODOS) as (keyof typeof PERIODOS)[]).map((k) => (
            <button key={k} onClick={() => setPeriodo(k)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${periodo === k ? 'bg-slate-700' : 'text-slate-400'}`}>
              {PERIODOS[k]}
            </button>
          ))}
        </div>
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
            <div className="rounded-2xl bg-slate-900 p-3">
              <div className="flex items-center gap-1 text-xs text-emerald-400"><TrendingUp size={14} /> Más vendido</div>
              <div className="mt-1 font-bold">{ventas.porSabor[0].producto.sabor}</div>
            </div>
            <div className="rounded-2xl bg-slate-900 p-3">
              <div className="flex items-center gap-1 text-xs text-amber-400"><TrendingDown size={14} /> Menos vendido</div>
              <div className="mt-1 font-bold">{ventas.porSabor[ventas.porSabor.length - 1].producto.sabor}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3 rounded-2xl bg-slate-900 p-4">
            {ventas.porSabor.map((s) => (
              <div key={s.producto.id}>
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">{s.producto.sabor}</span>
                  <span className="text-slate-400 tabular-nums">{s.litros} L · {dinero(s.dinero)} · <span className="text-emerald-400">+{dinero(s.margen)}</span></span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-800">
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
    <div className="rounded-2xl bg-slate-900 p-3">
      <div className={`text-2xl font-black tabular-nums ${acento ? 'text-emerald-400' : ''}`}>{valor}</div>
      <div className="text-xs text-slate-400">{etiqueta}</div>
    </div>
  )
}
