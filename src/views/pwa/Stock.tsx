import { useLiveQuery } from 'dexie-react-hooks'
import { Package, RefreshCw, TriangleAlert } from 'lucide-react'
import { db } from '../../lib/db'
import { textoFecha, hoy } from '../../lib/fechas'
import { sincronizar, useEstadoSync } from '../../lib/sync'
import { useStockDeHoy } from '../../lib/stock'
import type { Nivel } from '../../lib/stock-calculo'
import { Boton, PuntoSabor } from '../../components/ui'

// RF-037 · La carga del vendedor: lo que el administrador le asignó hoy y lo que le va quedando. Las cuentas salen de
// los pedidos entregados en este mismo teléfono, así funcionan sin internet.

const ETIQUETA: Record<Nivel, { texto: string; clase: string } | null> = {
  ok: null,
  bajo: { texto: 'Queda poco', clase: 'bg-ambar/30 text-tinta' },
  falta: { texto: 'No alcanza', clase: 'bg-ambar text-tinta' },
  agotado: { texto: 'Agotado', clase: 'bg-rojo/10 text-rojo' },
}
const l = (n: number) => `${Math.round(n * 100) / 100} L`

export function Stock() {
  const filas = useStockDeHoy()
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const sync = useEstadoSync()

  const asignada = filas?.reduce((s, f) => s + f.asignada, 0) ?? 0
  const entregado = filas?.reduce((s, f) => s + Math.min(f.entregado, f.asignada), 0) ?? 0
  const restante = filas?.reduce((s, f) => s + f.restante, 0) ?? 0
  const pendiente = filas?.reduce((s, f) => s + f.pendiente, 0) ?? 0

  return (
    <div className="h-full overflow-y-auto px-4 pt-safe pb-24">
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Mi carga de hoy</h1>
      <div className="text-sm text-apagado">{textoFecha(hoy())}</div>

      {filas === undefined ? (
        <div className="mt-10 text-center text-apagado">Cargando…</div>
      ) : filas.length === 0 ? (
        <div className="mt-6 rounded-2xl bg-niebla p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-papel"><Package size={26} /></span>
          <div className="mt-3 text-lg font-semibold">Aún no tienes carga asignada hoy</div>
          <p className="mt-1 text-sm text-apagado">Cuando el administrador registre cuánto yogurt llevas, aparecerá aquí y te llegará un aviso.</p>
          <Boton variante="secundario" className="mx-auto mt-4 bg-papel" onClick={() => void sincronizar()} disabled={sync.sincronizando}>
            <RefreshCw size={18} className={sync.sincronizando ? 'animate-spin' : ''} /> Buscar mi carga
          </Boton>
          {sync.error && <p className="mt-3 text-xs text-apagado">{sync.error}</p>}
        </div>
      ) : (
        <>
          <section className="mt-4 rounded-2xl bg-niebla p-4" aria-label="Resumen de la carga">
            <div className="text-sm font-medium text-apagado">Te quedan</div>
            <div className="mt-1 text-5xl leading-none font-bold tracking-tight tabular-nums">{l(restante)}</div>
            <div className="mt-1 text-sm text-apagado">de {l(asignada)} que llevabas</div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-papel" role="img" aria-label={`Entregaste ${l(entregado)} de ${l(asignada)}`}>
              <div className="h-full rounded-full bg-tinta transition-[width]" style={{ width: `${asignada ? Math.min(100, (entregado / asignada) * 100) : 0}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs text-apagado">
              <span>Entregaste {l(entregado)}</span>
              <span>Te piden {l(pendiente)} más hoy</span>
            </div>
          </section>

          <section className="mt-4 divide-y divide-linea" aria-label="Sabores">
            {filas.map((f) => {
              const p = productos.find((x) => x.id === f.productoId)
              const etiqueta = ETIQUETA[f.nivel]
              return (
                <div key={f.productoId} className="py-3.5" data-sabor={p?.sabor}>
                  <div className="flex items-center gap-3">
                    <PuntoSabor color={p?.color_hex} className="h-5 w-5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{p?.sabor ?? 'Sabor'}</span>
                        {etiqueta && <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${etiqueta.clase}`}>{etiqueta.texto}</span>}
                      </div>
                      <div className="text-xs text-apagado">
                        {f.asignada > 0 ? `Llevabas ${l(f.asignada)} · entregaste ${l(f.entregado)}` : 'Sin litros asignados'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl leading-7 font-semibold tabular-nums">{l(f.restante)}</div>
                      <div className="text-xs text-apagado">te quedan</div>
                    </div>
                  </div>
                  {f.asignada > 0 && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-niebla">
                      <div className={`h-full rounded-full ${f.nivel === 'ok' ? 'bg-tinta' : f.nivel === 'agotado' ? 'bg-rojo' : 'bg-ambar'}`} style={{ width: `${Math.min(100, (f.restante / f.asignada) * 100)}%` }} />
                    </div>
                  )}
                  {(f.pendiente > 0 || f.devuelta > 0) && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-apagado">
                      {f.pendiente > 0 && (
                        <span className={f.nivel === 'falta' || f.nivel === 'agotado' ? 'flex items-center gap-1 font-semibold text-tinta' : ''}>
                          {(f.nivel === 'falta' || f.nivel === 'agotado') && <TriangleAlert size={13} />}Te piden {l(f.pendiente)} hoy
                        </span>
                      )}
                      {f.devuelta > 0 && <span>Devolviste {l(f.devuelta)}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </section>
          <p className="mt-4 text-xs text-apagado">Se calcula con tus entregas de hoy, aun sin internet. Si algo no cuadra, avisa al administrador.</p>
        </>
      )}
    </div>
  )
}
