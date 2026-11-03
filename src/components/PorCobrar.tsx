import { useState } from 'react'
import { ChevronRight, HandCoins } from 'lucide-react'
import { useServidor, type Deudor } from '../lib/cobranza'
import { dinero, textoFecha } from '../lib/fechas'
import { CuentaAbierta } from './CuentaDelCliente'
import { Hoja } from './ui'

// «Quién me debe»: arriba de la lista de clientes, sólo si alguien debe algo. Toca para ver la lista y cobrar un abono.
// El vendedor ve a los suyos; el administrador, a todos. Necesita conexión (sin ella no aparece).

export function PorCobrar() {
  const lista = useServidor<{ total: number; deudores: Deudor[] }>('/cobranza')
  const [abierta, setAbierta] = useState(false)
  const [cliente, setCliente] = useState<string | null>(null)
  const d = lista.datos
  if (!d || d.total <= 0) return null
  return (
    <>
      <button onClick={() => setAbierta(true)} className="mb-1 mt-2 flex w-full items-center gap-3 rounded-md bg-niebla px-4 py-3 text-left active:bg-linea">
        <HandCoins size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-apagado">Por cobrar · {d.deudores.length} {d.deudores.length === 1 ? 'cliente' : 'clientes'}</span>
          <span className="block font-semibold tabular-nums">{dinero(d.total)}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-apagado/60" />
      </button>
      <Hoja abierta={abierta} onCerrar={() => setAbierta(false)} alto titulo="Por cobrar">
        <div className="pb-4">
          {d.deudores.map((x) => (
            <button key={x.id} onClick={() => setCliente(x.id)} className="flex w-full items-center gap-3 border-b border-linea py-3.5 text-left active:bg-niebla">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{x.nombre}</span>
                {x.desde && <span className="block text-sm text-apagado">Desde el {textoFecha(x.desde).toLowerCase()}</span>}
              </span>
              <span className="font-semibold tabular-nums">{dinero(x.saldo)}</span>
              <ChevronRight size={18} className="shrink-0 text-apagado/60" />
            </button>
          ))}
        </div>
      </Hoja>
      {cliente && <CuentaAbierta tipo="abono" clienteId={cliente} onCerrar={() => setCliente(null)} onHecho={lista.recargar} />}
    </>
  )
}
