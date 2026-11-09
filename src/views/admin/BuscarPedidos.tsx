import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search } from 'lucide-react'
import { Hoja, claseInput } from '../../components/ui'
import { usePaginas } from '../../components/Paginas'
import { Recientes, Resaltar, useRecientes } from '../../components/Busqueda'
import { coincide, limpiarBusqueda, propsBuscador } from '../../lib/busqueda'
import { db, type EstadoPedido } from '../../lib/db'
import { dinero, textoFecha } from '../../lib/fechas'
import { ChipEstado, grupoPanel, botonPanel, botonPanelSuave } from './piezas'

// Todos los pedidos que tiene este dispositivo (Dexie), del más nuevo al más viejo, buscando por cliente o sabor y
// filtrando por estado. Como los demás buscadores, filtra aquí mismo: nada se manda al servidor.
const FILTROS: { clave: EstadoPedido | 'todos'; texto: string }[] = [
  { clave: 'todos', texto: 'Todos' },
  { clave: 'PENDIENTE', texto: 'Pendientes' },
  { clave: 'ENTREGADO', texto: 'Entregados' },
  { clave: 'OMITIDO', texto: 'Sin venta' },
]

// `onCliente`: tocar un pedido abre la ficha de su cliente (en Clientes).
export function BuscarPedidos({ onCerrar, onCliente }: { onCerrar: () => void; onCliente: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState<EstadoPedido | 'todos'>('todos')
  const [enBuscador, setEnBuscador] = useState(false)
  const recientes = useRecientes('pedidos')
  const datos = useLiveQuery(async () => {
    const [pedidos, clientes, productos] = await Promise.all([db.pedidos.toArray(), db.clientes.toArray(), db.productos.toArray()])
    const cliente = new Map(clientes.map((c) => [c.id, c.nombre]))
    const sabor = new Map(productos.map((p) => [p.id, p.sabor]))
    return pedidos
      .sort((a, b) => (a.fecha === b.fecha ? b.actualizado - a.actualizado : b.fecha.localeCompare(a.fecha)))
      .map((p) => ({
        ...p,
        cliente: cliente.get(p.clienteId) ?? 'Cliente sin ficha',
        sabores: [...new Set(p.items.map((i) => sabor.get(i.productoId)).filter((s): s is string => !!s))].join(', '),
      }))
  }, [])
  const t = limpiarBusqueda(q)
  const lista = (datos ?? []).filter((p) => (estado === 'todos' || p.estado === estado) && coincide(t, p.cliente, p.sabores))
  const pagina = usePaginas(lista, 30, `${t}|${estado}`)

  return (
    <Hoja abierta alto onCerrar={onCerrar} titulo="Buscar pedidos">
      <div className="relative">
        <Search size={18} aria-hidden="true" className="absolute top-1/2 left-4 -translate-y-1/2 text-tinta" />
        <input {...propsBuscador} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cliente o sabor" aria-label="Buscar pedidos por cliente o sabor"
          className={`${claseInput} pl-11`}
          onFocus={() => setEnBuscador(true)} onBlur={() => { setEnBuscador(false); recientes.recordar(q) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { recientes.recordar(q); e.currentTarget.blur() } }} />
      </div>
      {enBuscador && !q && <Recientes className="mt-2" lista={recientes.lista} onElegir={setQ} onOlvidar={recientes.olvidar} />}
      <div className={`${grupoPanel} mt-3`} role="group" aria-label="Estado">
        {FILTROS.map((f) => (
          <button key={f.clave} type="button" onClick={() => setEstado(f.clave)} aria-pressed={estado === f.clave} className={estado === f.clave ? botonPanel : botonPanelSuave}>{f.texto}</button>
        ))}
      </div>
      <p className="mt-3 text-sm text-apagado" aria-live="polite">{datos ? `${lista.length} ${lista.length === 1 ? 'pedido' : 'pedidos'}` : 'Cargando…'}</p>
      <ul ref={pagina.ancla} className="mt-1 scroll-mt-4 divide-y divide-linea border-y border-linea">
        {pagina.visibles.map((p) => (
          <li key={p.id}>
           <button type="button" onClick={() => onCliente(p.clienteId)} className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-niebla/40 active:bg-niebla focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold"><Resaltar texto={p.cliente} t={t} /></span>
              <span className="block truncate text-sm text-apagado">{textoFecha(p.fecha)}{p.sabores && <> · <Resaltar texto={p.sabores} t={t} /></>}</span>
            </span>
            <span className="font-semibold tabular-nums">{dinero(p.total)}</span>
            <ChipEstado estado={p.estado} />
           </button>
          </li>
        ))}
        {datos && !lista.length && <li className="py-8 text-center text-sm text-apagado">{t ? 'Ningún pedido coincide con la búsqueda.' : 'No hay pedidos con ese estado.'}</li>}
      </ul>
      {pagina.control}
    </Hoja>
  )
}
