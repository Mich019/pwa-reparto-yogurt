import { useState } from 'react'
import { BotonWhatsApp, EditorMensaje, llenar, useMensaje } from './Mensajes'
import { esMio } from '../lib/reparto'
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
  const cobro = useMensaje('cobro')
  const [mandados, setMandados] = useState<Set<string>>(new Set())
  // El administrador en la app de reparto cobra lo de su cartera y lo que no tiene vendedor (lib/reparto.ts).
  const deudores = (lista.datos?.deudores ?? []).filter((x) => esMio(x.vendedorId))
  const d = lista.datos && { total: deudores.reduce((s, x) => s + x.saldo, 0), deudores }
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
          <details className="mb-2">
            <summary className="cursor-pointer py-1 text-sm font-semibold">Mensaje para cobrar por WhatsApp</summary>
            <div className="mt-2"><EditorMensaje tipo="cobro" abierto={abierta} /></div>
          </details>
          {d.deudores.map((x) => (
            <div key={x.id} className="flex items-center gap-2 border-b border-linea">
              <button onClick={() => setCliente(x.id)} className="flex min-w-0 flex-1 items-center gap-3 py-3.5 text-left active:bg-niebla">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{x.nombre}</span>
                  {x.desde && <span className="block text-sm text-apagado">Desde el {textoFecha(x.desde).toLowerCase()}</span>}
                </span>
                <span className="font-semibold tabular-nums">{dinero(x.saldo)}</span>
                <ChevronRight size={18} className="shrink-0 text-apagado/60" />
              </button>
              {x.telefono && <BotonWhatsApp chico telefono={x.telefono} texto={llenar(cobro, { nombre: x.nombre, saldo: dinero(x.saldo) })} enviado={mandados.has(x.id)} onEnviar={() => setMandados((m) => new Set(m).add(x.id))} />}
            </div>
          ))}
        </div>
      </Hoja>
      {cliente && <CuentaAbierta tipo="abono" clienteId={cliente} onCerrar={() => setCliente(null)} onHecho={lista.recargar} />}
    </>
  )
}
