import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, Flame } from 'lucide-react'
import { MODO_SERVIDOR } from '../../lib/api'
import { useRol } from '../../lib/sesion'
import { db, guardar, totalDe, uid, type Cliente, type Pedido } from '../../lib/db'
import { hoy, siguienteVisita, sumarDias, textoFecha } from '../../lib/fechas'
import { SelectorSabores, aCantidades, aItems, type Cantidades } from './SelectorSabores'
import { Boton, Hoja, aviso, claseInput } from '../../components/ui'

// Crear un pedido nuevo (RF-024) o editar uno pendiente (RF-025): sabores, litros y fecha.
export function EditorPedido({ abierto, onCerrar, cliente, pedido, base, fechaInicial, onGuardado }: {
  abierto: boolean
  onCerrar: () => void
  cliente: Cliente
  pedido?: Pedido // si viene, se edita
  base?: Cantidades // cantidades iniciales para un pedido nuevo
  fechaInicial?: string // para un pedido nuevo; si no, la siguiente visita según su frecuencia
  onGuardado?: (p: Pedido) => void
}) {
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const [cant, setCant] = useState<Cantidades>({})
  const [fecha, setFecha] = useState(hoy())
  const [urgente, setUrgente] = useState(false)
  const rol = useRol()
  const puedeUrgente = MODO_SERVIDOR && rol === 'administrador' // RF-054: sólo el administrador manda un pedido "para ya"

  useEffect(() => {
    if (!abierto) return
    setCant(pedido ? aCantidades(pedido.items) : (base ?? {}))
    setFecha(pedido?.fecha ?? fechaInicial ?? siguienteVisita(cliente.frecuencia))
    setUrgente(pedido?.urgente ?? false)
  }, [abierto, pedido, base, cliente, fechaInicial])

  const esUrgente = puedeUrgente && urgente
  const fechaVista = esUrgente ? hoy() : fecha // urgente = para hoy; se ve elegido «Hoy» aunque la fecha de abajo quede guardada
  const sugerida = siguienteVisita(cliente.frecuencia)
  const opciones = [...new Set([sugerida, sumarDias(hoy(), 1), sumarDias(hoy(), 2), sumarDias(hoy(), 7), hoy()])]
    .sort()
    .slice(0, 5)

  async function guardarPedido() {
    const items = aItems(cant, productos)
    if (!items.length) return aviso('Agrega al menos un litro')
    const ahora = Date.now()
    const dia = fechaVista
    const p: Pedido = pedido
      ? { ...pedido, items, total: totalDe(items), fecha: dia, ...(puedeUrgente ? { urgente: esUrgente } : {}) }
      : { id: uid(), clienteId: cliente.id, fecha: dia, estado: 'PENDIENTE', items, total: totalDe(items), creado: ahora, actualizado: ahora, ...(esUrgente ? { urgente: true } : {}) }
    await guardar('pedidos', p)
    aviso(pedido ? 'Pedido actualizado' : esUrgente ? 'Pedido urgente enviado para hoy' : `Pedido agendado para ${textoFecha(fecha).toLowerCase()}`)
    onGuardado?.(p)
    onCerrar()
  }

  return (
    <Hoja
      abierta={abierto}
      onCerrar={onCerrar}
      alto
      className="diseno-original" // en la app de reparto conserva el diseño en blanco y negro (views/pwa/tema-campo.css)
      pie={
        <Boton onClick={guardarPedido} className="w-full text-lg">
          {pedido ? 'Guardar cambios' : esUrgente ? 'Agendar como urgente' : `Agendar para ${textoFecha(fecha).toLowerCase()}`}
        </Boton>
      }
      titulo={<div>{pedido ? 'Editar pedido' : 'Nuevo pedido'}<div className="text-base font-medium text-apagado">{cliente.nombre}</div></div>}>
      {puedeUrgente && (
        <label className={`mb-4 flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 ${urgente ? 'border-rojo bg-rojo/10' : 'border-linea'}`}>
          <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} className="h-5 w-5 accent-rojo" />
          <Flame size={18} className={urgente ? 'text-rojo' : 'text-apagado'} />
          <span className="min-w-0 flex-1 text-sm"><b>Urgente</b><span className="block text-xs text-apagado">Para hoy, va primero en la ruta y se le avisa al vendedor</span></span>
        </label>
      )}
      <div className={`mb-4 ${esUrgente ? 'pointer-events-none opacity-40' : ''}`}>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-apagado">
          <CalendarDays size={16} /> Fecha de entrega
        </div>
        <div className="flex flex-wrap gap-2">
          {opciones.map((d) => (
            <button
              key={d}
              onClick={() => setFecha(d)}
              className={`rounded-full px-4 py-2.5 text-sm font-semibold ${fechaVista === d ? 'bg-tinta text-white' : 'bg-niebla text-tinta'}`}
            >
              {textoFecha(d)}
              {d === sugerida && <span className="ml-1 opacity-70">★</span>}
            </button>
          ))}
          <input type="date" value={fechaVista} min={hoy()} onChange={(e) => e.target.value && setFecha(e.target.value)} className={`${claseInput} !w-auto !py-2 text-sm`} />
        </div>
      </div>
      <SelectorSabores productos={productos} valor={cant} onChange={setCant} />
    </Hoja>
  )
}
