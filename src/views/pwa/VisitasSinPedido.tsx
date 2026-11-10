import { useState } from 'react'
import type { Cliente } from '../../lib/db'
import { Hoja } from '../../components/ui'
import { BotonWhatsApp, EditorMensaje, llenar, useMensaje } from '../../components/Mensajes'

// A los clientes que hoy les toca visita y no tienen pedido, un WhatsApp de un toque con el mensaje del repartidor
// (components/Mensajes.tsx: se edita aquí y se guarda en su teléfono).
export function VisitasSinPedido({ clientes, abierta, onCerrar, onVerClientes, titulo = 'Les toca visita hoy' }: { clientes: Cliente[]; abierta: boolean; onCerrar: () => void; onVerClientes?: () => void; titulo?: string }) {
  const plantilla = useMensaje('visita')
  const [mandados, setMandados] = useState<Set<string>>(new Set())
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} alto titulo={titulo}>
      <div className="pb-4">
        <EditorMensaje tipo="visita" abierto={abierta} />
        <ul className="mt-4 divide-y divide-linea border-y border-linea">
          {clientes.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{c.nombre}</span>
                <span className="block truncate text-sm text-apagado">{c.direccion || 'Sin dirección'}</span>
              </span>
              <BotonWhatsApp telefono={c.telefono} texto={llenar(plantilla, c)} enviado={mandados.has(c.id)} onEnviar={() => setMandados((m) => new Set(m).add(c.id))} />
            </li>
          ))}
        </ul>
        {onVerClientes && <button type="button" onClick={onVerClientes} className="mt-4 py-1 text-sm font-semibold underline underline-offset-2">Ver todos mis clientes</button>}
      </div>
    </Hoja>
  )
}
