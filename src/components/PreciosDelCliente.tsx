import { useState } from 'react'
import { BadgePercent, ChevronRight } from 'lucide-react'
import { guardarPrecios, useServidor, type PrecioCliente } from '../lib/cobranza'
import { dinero } from '../lib/fechas'
import { sincronizar } from '../lib/sync'
import { nombreUnidad } from '../lib/unidades'
import { Boton, Hoja, aviso, claseInput } from './ui'

// Precio especial por cliente (mayoreo), sólo para el administrador. Un precio en blanco = el de lista. El teléfono
// recibe el cambio en la siguiente sincronización y lo usa al armar los pedidos de ese cliente.

export function PreciosDelCliente({ clienteId, nombre }: { clienteId: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const lista = useServidor<{ precios: PrecioCliente[] }>(abierta ? `/clientes/${clienteId}/precios` : null)
  return (
    <>
      <button onClick={() => setAbierta(true)} className="flex w-full items-center gap-3 rounded-md bg-niebla px-4 py-3 text-left active:bg-linea">
        <BadgePercent size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-apagado">Precios</span>
          <span className="block font-semibold">Precio especial</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-apagado/60" />
      </button>
      {abierta && <HojaPrecios nombre={nombre} clienteId={clienteId} precios={lista.datos?.precios} error={lista.error} onCerrar={() => setAbierta(false)} />}
    </>
  )
}

function HojaPrecios({ nombre, clienteId, precios, error, onCerrar }: { nombre: string; clienteId: string; precios?: PrecioCliente[]; error: string; onCerrar: () => void }) {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  const texto = (p: PrecioCliente) => valores[p.productoId] ?? (p.precioLitro === null ? '' : String(p.precioLitro))
  const invalido = (p: PrecioCliente) => { const t = texto(p).trim(); return t !== '' && !(Number(t.replace(',', '.')) > 0) }
  const cambiados = (precios ?? []).filter((p) => {
    const t = texto(p).trim()
    return (t === '' ? null : Number(t.replace(',', '.'))) !== p.precioLitro
  })
  async function guardar() {
    setEnviando(true)
    try {
      await guardarPrecios(clienteId, cambiados.map((p) => ({ productoId: p.productoId, precioLitro: texto(p).trim() === '' ? null : Number(texto(p).replace(',', '.')) })))
      aviso('Precios guardados')
      void sincronizar().catch(() => {})
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} alto titulo={<div>Precio especial<div className="text-base font-medium text-apagado">{nombre}</div></div>}
      pie={<Boton onClick={guardar} disabled={enviando || !cambiados.length || (precios ?? []).some(invalido)} className="w-full text-lg">Guardar</Boton>}>
      <div className="pb-4">
        <p className="pb-3 text-sm text-apagado">Déjalo en blanco para cobrar el precio de lista.</p>
        {error && <p role="alert" className="text-sm font-medium text-rojo">{error}</p>}
        {!precios && !error && <p className="py-8 text-center text-apagado">Cargando…</p>}
        <div className="divide-y divide-linea">
          {(precios ?? []).map((p) => (
            <label key={p.productoId} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{p.sabor}</span>
                <span className="block text-xs text-apagado">Lista {dinero(p.lista)} por {nombreUnidad(p.unidad, 1)}</span>
              </span>
              <input inputMode="decimal" value={texto(p)} onChange={(e) => setValores((v) => ({ ...v, [p.productoId]: e.target.value }))} placeholder={String(p.lista)}
                aria-label={`Precio especial de ${p.sabor}`} aria-invalid={invalido(p)} className={`${claseInput.replace('w-full', '')} w-28 py-2.5 text-right tabular-nums`} />
            </label>
          ))}
        </div>
      </div>
    </Hoja>
  )
}
