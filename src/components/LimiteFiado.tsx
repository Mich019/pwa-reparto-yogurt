import { useState } from 'react'
import { ChevronRight, NotebookPen, TriangleAlert } from 'lucide-react'
import { guardarLimiteFiado, useServidor, type CuentaCliente } from '../lib/cobranza'
import { dinero } from '../lib/fechas'
import { sincronizar } from '../lib/sync'
import type { Cliente } from '../lib/db'
import { useMarca } from '../lib/marca'
import { Boton, Hoja, aviso, claseInput } from './ui'

// Límite de fiado por cliente (migración 036). El administrador lo pone en la ficha del cliente; viaja al teléfono con
// el cliente (`limiteFiado`) y, al elegir «Fiado» en la entrega, `AvisoLimiteFiado` le dice al vendedor si con ese
// pedido pasaría de su límite. Sólo avisa: no impide fiar.

export function LimiteFiado({ cliente }: { cliente: Cliente }) {
  const [abierta, setAbierta] = useState(false)
  const deEmpresa = useMarca()?.limiteFiado ?? null
  return (
    <>
      <button onClick={() => setAbierta(true)} className="flex w-full items-center gap-3 rounded-md bg-niebla px-4 py-3 text-left active:bg-linea">
        <NotebookPen size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-apagado">Fiado</span>
          <span className="block font-semibold">{cliente.limiteFiado != null ? `Límite de ${dinero(cliente.limiteFiado)}` : deEmpresa != null ? `El de la empresa: ${dinero(deEmpresa)}` : 'Sin límite de fiado'}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-apagado/60" />
      </button>
      {abierta && <HojaLimite cliente={cliente} onCerrar={() => setAbierta(false)} />}
    </>
  )
}

function HojaLimite({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const [texto, setTexto] = useState(cliente.limiteFiado != null ? String(cliente.limiteFiado) : '')
  const [enviando, setEnviando] = useState(false)
  const t = texto.trim().replace(',', '.')
  const valor = t === '' ? null : Number(t)
  const valido = valor === null || (Number.isFinite(valor) && valor >= 0)
  async function guardar() {
    setEnviando(true)
    try {
      await guardarLimiteFiado(cliente.id, valor)
      aviso(valor === null ? 'Sin límite de fiado' : `Límite de fiado: ${dinero(valor)}`)
      void sincronizar().catch(() => {})
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={<div>Límite de fiado<div className="text-base font-medium text-apagado">{cliente.nombre}</div></div>}
      pie={<Boton onClick={guardar} disabled={enviando || !valido || valor === (cliente.limiteFiado ?? null)} className="w-full text-lg">Guardar</Boton>}>
      <div className="space-y-3 pb-4">
        <p className="text-sm text-apagado">Lo más que puede deber. Al elegir «Fiado», el teléfono avisa al vendedor si con ese pedido se pasa. Déjalo en blanco para usar el de la empresa (Configuración → Preferencias) o no tener límite.</p>
        <label className="block">
          <span className="text-sm font-semibold">Límite</span>
          <input inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Sin límite" aria-invalid={!valido} className={`${claseInput} mt-1`} />
        </label>
        {!valido && <p role="alert" className="text-sm font-medium text-rojo">Escribe una cantidad de 0 o más.</p>}
      </div>
    </Hoja>
  )
}

// En la entrega, con «Fiado» elegido. Lo que debe viene del servidor (con conexión); sin ella sólo recuerda el límite.
export function AvisoLimiteFiado({ cliente, total }: { cliente: Cliente; total: number }) {
  const deEmpresa = useMarca()?.limiteFiado ?? null
  const limite = cliente.limiteFiado ?? deEmpresa
  const cuenta = useServidor<CuentaCliente>(limite != null ? `/cobranza/clientes/${cliente.id}` : null)
  if (limite == null) return null
  const debe = cuenta.datos?.saldo
  if (debe === undefined) return <p className="mt-2 text-sm text-apagado">Su límite de fiado es {dinero(limite)}.</p>
  const quedaria = debe + total
  const disponible = Math.max(0, limite - debe)
  if (quedaria <= limite + 0.004) return (
    <p className="mt-2 text-sm text-apagado">
      Le puedes fiar hasta <b className="font-semibold text-tinta">{dinero(disponible)}</b>{debe > 0 ? ` (ya debe ${dinero(debe)})` : ''}. Con este pedido debería {dinero(quedaria)} de {dinero(limite)}.
    </p>
  )
  return (
    <p role="alert" className="mt-2 flex gap-2 text-sm font-semibold text-rojo">
      <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      Con este pedido debería {dinero(quedaria)} y su límite es {dinero(limite)}. {debe > 0 ? `Ya debe ${dinero(debe)}.` : ''} {disponible > 0 ? `Sólo le puedes fiar ${dinero(disponible)}.` : 'Ya no le queda fiado disponible.'}
    </p>
  )
}
