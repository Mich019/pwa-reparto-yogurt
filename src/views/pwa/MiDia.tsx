import { useState } from 'react'
import { ChevronRight, Wallet } from 'lucide-react'
import { entregarCorte, useServidor, type FilaCorte, type MiMeta } from '../../lib/cobranza'
import { dinero } from '../../lib/fechas'
import { Boton, Campo, Hoja, aviso, claseInput } from '../../components/ui'

// Mi cuenta (vendedor): el corte del día (cuánto efectivo debe entregar y lo que entregó) y el avance contra su meta
// del mes. Si no hay meta, esa parte no aparece. Necesita conexión.

export function MiDia() {
  const corte = useServidor<{ fecha: string; filas: FilaCorte[] }>('/cortes')
  const meta = useServidor<MiMeta>('/mi-meta')
  const [hoja, setHoja] = useState(false)
  const fila = corte.datos?.filas[0]
  const m = meta.datos
  if (!fila && !(m && m.meta)) return null
  const estado = !fila ? '' : fila.estado === 'confirmado' ? 'Confirmado' : fila.estado === 'pendiente' ? (fila.reabierto ? `Reabierto: ${fila.reabierto.motivo}` : 'Entregado, falta que lo confirmen') : 'Sin entregar'
  return (
    <>
      {fila && (
        <button onClick={() => fila.estado !== 'confirmado' && setHoja(true)} className="mt-3 flex w-full items-center gap-3 rounded-lg bg-niebla p-4 text-left active:bg-linea">
          <Wallet size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Corte de hoy</span>
            <span className="block text-sm text-apagado">
              Efectivo a entregar {dinero(fila.esperado)} · {estado}
              {fila.entregado !== null && fila.diferencia !== null && fila.diferencia !== 0 && ` · ${fila.diferencia < 0 ? 'faltan' : 'sobran'} ${dinero(Math.abs(fila.diferencia))}`}
            </span>
          </span>
          {fila.estado !== 'confirmado' && <ChevronRight size={18} className="shrink-0 text-apagado" />}
        </button>
      )}
      {m && m.meta && (
        <div className="mt-3 rounded-lg bg-niebla p-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">Meta del mes</span>
            <span className="text-sm tabular-nums text-apagado">{dinero(m.ventas)} de {dinero(m.meta)}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-linea" role="progressbar" aria-valuenow={Math.min(100, Math.round(m.cumplimientoPct ?? 0))} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-tinta" style={{ width: `${Math.min(100, m.cumplimientoPct ?? 0)}%` }} />
          </div>
          {m.comisionPct > 0 && <p className="mt-2 text-sm text-apagado">Comisión de este mes: {dinero(m.comision)}</p>}
        </div>
      )}
      {hoja && fila && <HojaCorte fila={fila} onCerrar={() => setHoja(false)} onHecho={corte.recargar} />}
    </>
  )
}

function HojaCorte({ fila, onCerrar, onHecho }: { fila: FilaCorte; onCerrar: () => void; onHecho: () => void }) {
  const [monto, setMonto] = useState(String(fila.entregado ?? fila.esperado))
  const [nota, setNota] = useState(fila.nota ?? '')
  const [enviando, setEnviando] = useState(false)
  const valor = Number(monto)
  const valido = monto.trim() !== '' && Number.isFinite(valor) && valor >= 0
  async function enviar() {
    setEnviando(true)
    try {
      const r = await entregarCorte({ efectivoEntregado: valor, nota: nota.trim() || undefined })
      aviso(r.diferencia === 0 ? 'Corte entregado, cuadra' : `Corte entregado: ${r.diferencia < 0 ? 'faltan' : 'sobran'} ${dinero(Math.abs(r.diferencia))}`)
      onHecho()
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo enviar el corte')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Corte de hoy"
      pie={<Boton onClick={enviar} disabled={!valido || enviando} className="w-full text-lg">Entregar corte</Boton>}>
      <div className="space-y-4 pb-4">
        <div className="rounded-md bg-niebla p-4">
          <div className="text-sm text-apagado">Efectivo que debes entregar</div>
          <div className="text-3xl font-semibold tabular-nums">{dinero(fila.esperado)}</div>
          {(fila.transferencias > 0 || fila.credito > 0) && (
            <div className="mt-1 text-xs text-apagado">
              {fila.transferencias > 0 && `Transferencias ${dinero(fila.transferencias)}`}{fila.transferencias > 0 && fila.credito > 0 && ' · '}{fila.credito > 0 && `Fiado ${dinero(fila.credito)}`} (no cuentan)
            </div>
          )}
        </div>
        <Campo etiqueta="Efectivo que entregas">
          <input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(',', '.'))} className={claseInput} autoFocus />
        </Campo>
        <Campo etiqueta="Nota (opcional)">
          <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} className={claseInput} />
        </Campo>
      </div>
    </Hoja>
  )
}
