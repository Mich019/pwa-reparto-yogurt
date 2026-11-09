import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { VisitasSinPedido } from './VisitasSinPedido'
import { CalendarClock, CloudOff, Flame, Package, Wallet } from 'lucide-react'
import { MODO_SERVIDOR } from '../../lib/api'
import { db } from '../../lib/db'
import { useHoraCierre } from '../../lib/alertas'
import { useStockDeHoy } from '../../lib/stock'
import { textoNivel } from '../../lib/stock-calculo'
import { sincronizar } from '../../lib/sync'
import { dinero, hoy, tocaVisita } from '../../lib/fechas'
import { esMio } from '../../lib/reparto'
import { useServidor, type FilaCorte } from '../../lib/cobranza'
import { useSesion } from '../../lib/sesion'

// RF-055 · Sobre el mapa, lo que el vendedor debe hacer hoy: los urgentes (lo lleva al primero), el sabor que se le
// acaba, los clientes a los que les toca visita y no tienen pedido, el corte por entregar al terminar y las ventas sin
// enviar. Cada uno lleva a donde se resuelve.
// (Los mismos avisos también salen como mensaje o notificación una vez; esto se queda mientras siga pasando.)
export function AlertasRuta({ irAStock, irAClientes, irACuenta, onUrgente }: { irAStock?: () => void; irAClientes?: () => void; irACuenta?: () => void; onUrgente?: () => void }) {
  const fecha = hoy()
  const yo = useSesion()?.usuario.id
  const filas = useStockDeHoy()
  const hoyPedidos = useLiveQuery(() => db.pedidos.where('fecha').equals(fecha).filter((p) => esMio(p.vendedorId)).toArray(), [fecha]) ?? []
  // Clientes de su cartera a los que hoy les toca visita (por su frecuencia y su última entrega) y no tienen pedido.
  const sinPedido = useLiveQuery(async () => {
    const [clientes, entregados] = await Promise.all([
      db.clientes.filter((c) => c.activo && esMio(c.vendedorId)).toArray(),
      db.pedidos.where('estado').equals('ENTREGADO').toArray(),
    ])
    const ultima = new Map<string, string>()
    for (const p of entregados) if (p.fecha < fecha && (ultima.get(p.clienteId) ?? '') < p.fecha) ultima.set(p.clienteId, p.fecha)
    const conPedido = new Set((await db.pedidos.where('fecha').equals(fecha).toArray()).map((p) => p.clienteId))
    return clientes.filter((c) => !conPedido.has(c.id) && tocaVisita(c.frecuencia, fecha, ultima.get(c.id)))
  }, [fecha]) ?? []
  const [visitas, setVisitas] = useState(false)
  const corte = useServidor<{ filas: FilaCorte[] }>(MODO_SERVIDOR ? '/cortes' : null).datos?.filas.find((f) => f.vendedorId === yo)
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const sinEnviar = useLiveQuery(() => db.cola.count(), []) ?? 0
  const [horaCierre] = useHoraCierre()
  if (!MODO_SERVIDOR) return null

  const aviso = (filas ?? []).filter((f) => f.nivel !== 'ok')
  const saborDe = (id: string) => productos.find((p) => p.id === id)?.sabor ?? 'Sabor'
  const unidadDe = (id: string) => productos.find((p) => p.id === id)?.unidad || 'L'
  const tardeYSinEnviar = sinEnviar > 0 && new Date().getHours() >= horaCierre
  const urgentes = hoyPedidos.filter((p) => p.urgente && p.estado === 'PENDIENTE').length
  // El corte sale cuando ya no queda nada por entregar (o ya es tarde) y hay efectivo que entregar.
  const quedan = hoyPedidos.some((p) => p.estado === 'PENDIENTE')
  const corteListo = corte && corte.estado === 'sin_corte' && corte.esperado > 0 && (!quedan || new Date().getHours() >= horaCierre)
  if (!aviso.length && !tardeYSinEnviar && !urgentes && !sinPedido.length && !corteListo) return null
  const chip = 'flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold shadow-tarjeta'

  return (
    <div className="pointer-events-auto mt-2 flex flex-col gap-1.5" role="status">
      {urgentes > 0 && (
        <button onClick={onUrgente} className={`${chip} bg-rojo text-white`} data-alerta-urgente>
          <Flame size={15} className="shrink-0" /> <span className="min-w-0 flex-1">{urgentes === 1 ? 'Un pedido urgente: va primero' : `${urgentes} pedidos urgentes: van primero`}</span>
        </button>
      )}
      {aviso.length > 0 && (
        <button onClick={irAStock} className={`flex items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold shadow-tarjeta ${aviso.some((f) => f.nivel === 'agotado') ? 'bg-rojo text-white' : 'bg-ambar text-tinta'}`} data-alerta-stock={aviso[0].nivel}>
          <Package size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{aviso.length === 1 ? `${textoNivel(aviso[0], saborDe(aviso[0].productoId), unidadDe(aviso[0].productoId)).titulo}: ${aviso[0].nivel === 'agotado' ? 'se acabó' : `${aviso[0].restante} ${unidadDe(aviso[0].productoId)}`}` : `${aviso.length} sabores con poco stock`}</span>
        </button>
      )}
      {sinPedido.length > 0 && (
        <button onClick={() => setVisitas(true)} className={`${chip} bg-papel text-tinta`} data-alerta-visita>
          <CalendarClock size={15} className="shrink-0" /> <span className="min-w-0 flex-1">{sinPedido.length === 1 ? 'A un cliente le toca visita y no tiene pedido' : `A ${sinPedido.length} clientes les toca visita y no tienen pedido`} · mandar WhatsApp</span>
        </button>
      )}
      <VisitasSinPedido clientes={sinPedido} abierta={visitas} onCerrar={() => setVisitas(false)} onVerClientes={irAClientes && (() => { setVisitas(false); irAClientes() })} />
      {corteListo && (
        <button onClick={irACuenta} className={`${chip} bg-ambar text-tinta`} data-alerta-corte>
          <Wallet size={15} className="shrink-0" /> <span className="min-w-0 flex-1">Entrega tu corte: {dinero(corte.esperado)} en efectivo</span>
        </button>
      )}
      {tardeYSinEnviar && (
        <button onClick={() => void sincronizar()} className="flex items-center gap-2 rounded-md bg-ambar px-3 py-2 text-left text-xs font-semibold text-tinta shadow-tarjeta" data-alerta-sync>
          <CloudOff size={15} className="shrink-0" /> <span className="min-w-0 flex-1">{sinEnviar} {sinEnviar === 1 ? 'cambio' : 'cambios'} sin enviar · toca para sincronizar</span>
        </button>
      )}
    </div>
  )
}
