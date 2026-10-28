import { useLiveQuery } from 'dexie-react-hooks'
import { CloudOff, Package } from 'lucide-react'
import { MODO_SERVIDOR } from '../../lib/api'
import { db } from '../../lib/db'
import { useHoraCierre } from '../../lib/alertas'
import { useStockDeHoy } from '../../lib/stock'
import { textoNivel } from '../../lib/stock-calculo'
import { sincronizar } from '../../lib/sync'

// RF-055 · Sobre el mapa, lo que el vendedor debe saber ya: el sabor que se le acaba y las ventas sin enviar.
// (Los mismos avisos también salen como mensaje o notificación una vez; esto se queda mientras siga pasando.)
export function AlertasRuta({ irAStock }: { irAStock?: () => void }) {
  const filas = useStockDeHoy()
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const sinEnviar = useLiveQuery(() => db.cola.count(), []) ?? 0
  const [horaCierre] = useHoraCierre()
  if (!MODO_SERVIDOR) return null

  const aviso = (filas ?? []).filter((f) => f.nivel !== 'ok')
  const saborDe = (id: string) => productos.find((p) => p.id === id)?.sabor ?? 'Sabor'
  const unidadDe = (id: string) => productos.find((p) => p.id === id)?.unidad || 'L'
  const tardeYSinEnviar = sinEnviar > 0 && new Date().getHours() >= horaCierre
  if (!aviso.length && !tardeYSinEnviar) return null

  return (
    <div className="pointer-events-auto mt-2 flex flex-col gap-1.5" role="status">
      {aviso.length > 0 && (
        <button onClick={irAStock} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold shadow-tarjeta ${aviso.some((f) => f.nivel === 'agotado') ? 'bg-rojo text-white' : 'bg-ambar text-tinta'}`} data-alerta-stock={aviso[0].nivel}>
          <Package size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{aviso.length === 1 ? `${textoNivel(aviso[0], saborDe(aviso[0].productoId), unidadDe(aviso[0].productoId)).titulo}: ${aviso[0].nivel === 'agotado' ? 'se acabó' : `${aviso[0].restante} ${unidadDe(aviso[0].productoId)}`}` : `${aviso.length} sabores con poco stock`}</span>
        </button>
      )}
      {tardeYSinEnviar && (
        <button onClick={() => void sincronizar()} className="flex items-center gap-2 rounded-xl bg-ambar px-3 py-2 text-left text-xs font-semibold text-tinta shadow-tarjeta" data-alerta-sync>
          <CloudOff size={15} className="shrink-0" /> <span className="min-w-0 flex-1">{sinEnviar} {sinEnviar === 1 ? 'cambio' : 'cambios'} sin enviar · toca para sincronizar</span>
        </button>
      )}
    </div>
  )
}
