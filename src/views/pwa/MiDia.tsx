import { useEffect, useState } from 'react'
import { useSesion } from '../../lib/sesion'
import { Medallas } from '../../components/Medallas'
import { HistorialMetas, type MesDeMeta } from '../../components/HistorialMetas'
import { ChevronRight, Crown, Flame, Trophy, Wallet } from 'lucide-react'
import { entregarCorte, useServidor, type FilaCorte, type MiMeta } from '../../lib/cobranza'
import { dinero } from '../../lib/fechas'
import { Boton, Campo, Hoja, aviso, claseInput } from '../../components/ui'

// Mi cuenta (vendedor): el corte del día (cuánto efectivo debe entregar y lo que entregó) y el avance contra su meta
// del mes. Si no hay meta, esa parte no aparece. Necesita conexión.

export function MiDia() {
  const corte = useServidor<{ fecha: string; filas: FilaCorte[] }>('/cortes')
  const meta = useServidor<MiMeta>('/mi-meta')
  // Sus trofeos: los meses cerrados en que llegó a su meta, y cuántos seguidos.
  const trofeos = useServidor<{ meses: { mes: string }[]; racha: number; mejorRacha: number; historial: MesDeMeta[]; fama: { lugar: number; de: number } | null }>('/mi-meta/trofeos')
  const [hoja, setHoja] = useState(false)
  // La medalla más alta que ya vio en este teléfono: si ahora tiene una más alta, la tarjeta la celebra una vez.
  const id = useSesion()?.usuario?.id ?? ''
  const llave = `delisy:medalla-vista:${id}`
  const [celebrar, setCelebrar] = useState(false)
  const nivel = (n: number) => [12, 6, 3].find((x) => n >= x) ?? 0
  const mejor = trofeos.datos ? nivel(trofeos.datos.mejorRacha) : 0
  useEffect(() => {
    if (!id || !mejor) return
    let vista = 0
    try { vista = Number(localStorage.getItem(llave)) || 0 } catch { /* sin almacenamiento: no se celebra */ return }
    if (mejor <= vista) return
    setCelebrar(true)
    try { localStorage.setItem(llave, String(mejor)) } catch { /* nada */ }
  }, [id, llave, mejor])
  const fila = corte.datos?.filas[0]
  const m = meta.datos
  const t = trofeos.datos
  const mesCorto = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })
  if (!fila && !(m && m.meta) && !t?.meses.length && !t?.historial?.length) return null
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
          {m.lugar && m.de > 1 && <p className="mt-2 text-sm text-apagado">Vas en {m.lugar}.º lugar de {m.de} vendedores este mes{m.lugar === 1 ? '. ¡Vas primero!' : ''}</p>}
          {m.comisionPct > 0 && <p className="mt-2 text-sm text-apagado">Comisión de este mes: {dinero(m.comision)}</p>}
        </div>
      )}
      {!!t?.meses.length && (
        <div className={`mt-3 flex items-center gap-3 rounded-lg bg-niebla p-4 ${celebrar ? 'medalla-nueva' : ''}`}>
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ambar/40 ${celebrar ? 'medalla-nueva-icono' : ''}`}><Trophy size={20} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t.meses.length === 1 ? 'Llegaste a tu meta 1 mes' : `Llegaste a tu meta ${t.meses.length} meses`}</span>
            <span className="block truncate text-sm text-apagado">{t.meses.slice(0, 4).map((x) => mesCorto(x.mes)).join(' · ')}{t.meses.length > 4 ? ' · …' : ''}</span>
            {t.racha >= 2 && <span className="mt-1 flex items-center gap-1 text-sm font-semibold"><Flame size={15} aria-hidden="true" className="text-marca" /> Llevas {t.racha} meses seguidos. ¡Que no se corte!</span>}
            {t.fama && t.fama.de > 1 && (
              <span className="mt-1 flex items-center gap-1 text-sm text-apagado">
                <Crown size={15} aria-hidden="true" className={t.fama.lugar === 1 ? 'text-marca' : ''} />
                {t.fama.lugar === 1 ? `¡Eres el mejor de todos los tiempos en tu equipo!` : `Vas en ${t.fama.lugar}.º lugar de todos los tiempos (de ${t.fama.de})`}
              </span>
            )}
            {(() => {
              const siguiente = [3, 6, 12].find((n) => n > t.mejorRacha)
              if (!siguiente) return null
              const falta = siguiente - t.racha
              return (
                <span className="mt-1 block text-sm text-apagado">
                  {falta === 1 ? 'Te falta 1 mes' : `Te faltan ${falta} meses`} seguidos para la medalla de {siguiente === 12 ? 'un año' : `${siguiente} meses`}
                </span>
              )
            })()}
            {celebrar && <span className="mt-1 block text-sm font-semibold text-marca" role="status">¡Medalla nueva de {mejor === 12 ? 'un año' : `${mejor} meses`}!</span>}
            <span className="mt-2 block"><Medallas mejorRacha={t.mejorRacha} todas /></span>
          </span>
        </div>
      )}
      {!!t?.historial?.length && <HistorialMetas historial={t.historial} titulo="Tus metas de los meses pasados" className="mt-3" />}
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
