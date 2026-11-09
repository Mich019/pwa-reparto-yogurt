import { useEffect, useState } from 'react'
import { Boxes, ChevronRight, HandCoins } from 'lucide-react'
import { anularAbono, registrarAbono, registrarRecogida, useServidor, type CuentaCliente, type CuentaEnvases } from '../lib/cobranza'
import { dinero, textoFecha } from '../lib/fechas'
import { useRol } from '../lib/sesion'
import { Boton, Campo, Hoja, Segmentado, aviso, claseInput } from './ui'

// En la ficha de un cliente: lo que debe (fiado) y los envases que tiene prestados, con lo necesario para cobrar un
// abono o recoger envases. Si no debe nada ni tiene envases, no aparece nada. Necesita conexión.

export function CuentaDelCliente({ clienteId, limite }: { clienteId: string; limite?: number | null }) {
  const cuenta = useServidor<CuentaCliente>(`/cobranza/clientes/${clienteId}`)
  const envases = useServidor<CuentaEnvases>(`/envases/clientes/${clienteId}`)
  const [hoja, setHoja] = useState<'abono' | 'envases' | null>(null)
  const saldo = cuenta.datos?.saldo ?? 0
  const prestados = envases.datos?.total ?? 0
  if (saldo <= 0 && prestados <= 0) return null
  const recargar = () => { cuenta.recargar(); envases.recargar() }
  return (
    <div className="space-y-2">
      {saldo > 0 && (
        <button onClick={() => setHoja('abono')} className="flex w-full items-center gap-3 rounded-md bg-niebla px-4 py-3 text-left active:bg-linea">
          <HandCoins size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-apagado">Debe{cuenta.datos?.desde ? ` desde el ${textoFecha(cuenta.datos.desde).toLowerCase()}` : ''}</span>
            <span className="block font-semibold tabular-nums">{dinero(saldo)}</span>
          </span>
          <span className="text-sm font-semibold">Abonar</span>
          <ChevronRight size={18} className="shrink-0 text-apagado/60" />
        </button>
      )}
      {saldo > 0 && limite != null && limite > 0 && <BarraLimite saldo={saldo} limite={limite} />}
      {prestados > 0 && (
        <button onClick={() => setHoja('envases')} className="flex w-full items-center gap-3 rounded-md bg-niebla px-4 py-3 text-left active:bg-linea">
          <Boxes size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-apagado">Envases prestados</span>
            <span className="block font-semibold tabular-nums">{prestados}</span>
          </span>
          <span className="text-sm font-semibold">Recoger</span>
          <ChevronRight size={18} className="shrink-0 text-apagado/60" />
        </button>
      )}
      {hoja === 'abono' && cuenta.datos && <HojaAbono cuenta={cuenta.datos} onCerrar={() => setHoja(null)} onHecho={recargar} />}
      {hoja === 'envases' && envases.datos && <HojaEnvases cuenta={envases.datos} onCerrar={() => setHoja(null)} onHecho={recargar} />}
    </div>
  )
}

// Lo que debe contra su límite de fiado (el suyo o el de la empresa): verde, ámbar desde el 80%, rojo si lo pasó.
function BarraLimite({ saldo, limite }: { saldo: number; limite: number }) {
  const pct = saldo / limite
  const color = pct > 1.00001 ? 'bg-rojo' : pct >= 0.8 ? 'bg-ambar' : 'bg-verde'
  return (
    <div className="px-1">
      <div className="h-2 overflow-hidden rounded-full bg-linea" role="meter" aria-valuemin={0} aria-valuemax={limite} aria-valuenow={saldo} aria-label="Lo que debe contra su límite de fiado">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <p className={`mt-1 text-xs ${pct > 1.00001 ? 'font-semibold text-rojo' : 'text-apagado'}`}>
        {pct > 1.00001 ? `Pasó su límite de ${dinero(limite)} por ${dinero(saldo - limite)}` : `${Math.round(pct * 100)}% de su límite de ${dinero(limite)}`}
      </p>
    </div>
  )
}

export function HojaAbono({ cuenta, onCerrar, onHecho }: { cuenta: CuentaCliente; onCerrar: () => void; onHecho: () => void }) {
  const [monto, setMonto] = useState(String(cuenta.saldo))
  const [metodo, setMetodo] = useState<'efectivo' | 'transferencia'>('efectivo')
  const [enviando, setEnviando] = useState(false)
  const [anulando, setAnulando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const rol = useRol()
  const valor = Number(monto)
  const valido = Number.isFinite(valor) && valor > 0 && valor <= cuenta.saldo + 0.004
  async function guardarAbono() {
    setEnviando(true)
    try {
      const r = await registrarAbono({ clienteId: cuenta.cliente.id, monto: valor, metodo })
      aviso(r.saldo > 0 ? `Abono registrado. Debe ${dinero(r.saldo)}` : 'Abono registrado. Ya no debe nada')
      onHecho()
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo registrar')
    } finally {
      setEnviando(false)
    }
  }
  const abonos = cuenta.movimientos.filter((m) => m.tipo === 'abono').slice(0, 5)
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={<div>Abonar<div className="text-base font-medium text-apagado">{cuenta.cliente.nombre} · debe {dinero(cuenta.saldo)}</div></div>}
      pie={<Boton onClick={guardarAbono} disabled={!valido || enviando} className="w-full text-lg">Registrar abono</Boton>}>
      <div className="space-y-4 pb-4">
        <Campo etiqueta="Monto">
          <input inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value.replace(',', '.'))} className={claseInput} autoFocus />
        </Campo>
        <Segmentado valor={metodo} onChange={setMetodo} opciones={[{ valor: 'efectivo', texto: 'Efectivo' }, { valor: 'transferencia', texto: 'Transferencia' }]} />
        {abonos.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-semibold text-apagado">Últimos abonos</div>
            <div className="divide-y divide-linea">
              {abonos.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className={a.anulado ? 'text-apagado line-through' : ''}>{textoFecha(a.fecha)} · {a.metodo === 'transferencia' ? 'transferencia' : 'efectivo'}</span>
                  <span className="flex items-center gap-3">
                    <span className={`font-semibold tabular-nums ${a.anulado ? 'text-apagado line-through' : ''}`}>{dinero(a.monto)}</span>
                    {rol === 'administrador' && !a.anulado && (
                      <button className="text-xs font-semibold text-rojo" onClick={() => { setAnulando(a.id); setMotivo('') }}>Anular</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            {anulando && (
              <div className="mt-2 flex gap-2">
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Por qué se anula?" className={claseInput} />
                <Boton disabled={motivo.trim().length < 3} onClick={async () => {
                  try { await anularAbono(anulando, motivo.trim()); aviso('Abono anulado'); onHecho(); onCerrar() } catch (e) { aviso(e instanceof Error ? e.message : 'No se pudo anular') }
                }}>Anular</Boton>
              </div>
            )}
          </div>
        )}
      </div>
    </Hoja>
  )
}

export function HojaEnvases({ cuenta, onCerrar, onHecho }: { cuenta: CuentaEnvases; onCerrar: () => void; onHecho: () => void }) {
  const pendientes = cuenta.envases.filter((e) => e.prestados > 0)
  const [productoId, setProductoId] = useState(pendientes[0]?.productoId ?? '')
  const elegido = pendientes.find((e) => e.productoId === productoId)
  const [cantidad, setCantidad] = useState(1)
  const [enviando, setEnviando] = useState(false)
  const tope = elegido?.prestados ?? 0
  async function guardarRecogida() {
    setEnviando(true)
    try {
      const r = await registrarRecogida({ clienteId: cuenta.cliente.id, productoId, cantidad })
      aviso(r.prestados > 0 ? `Recogidos. Le quedan ${r.prestados}` : 'Recogidos. No le queda ninguno')
      onHecho()
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo registrar')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={<div>Recoger envases<div className="text-base font-medium text-apagado">{cuenta.cliente.nombre}</div></div>}
      pie={<Boton onClick={guardarRecogida} disabled={!elegido || cantidad < 1 || cantidad > tope || enviando} className="w-full text-lg">Registrar</Boton>}>
      <div className="space-y-4 pb-4">
        {pendientes.length > 1 && (
          <Segmentado valor={productoId} onChange={(v) => { setProductoId(v); setCantidad(1) }} opciones={pendientes.map((e) => ({ valor: e.productoId, texto: `${e.sabor} (${e.prestados})` }))} className="flex-wrap" />
        )}
        {elegido && <div className="text-sm text-apagado">{elegido.sabor}: tiene {elegido.prestados} {elegido.prestados === 1 ? 'prestado' : 'prestados'}</div>}
        <div className="flex items-center justify-center gap-6 py-2">
          <button onClick={() => setCantidad((c) => Math.max(1, c - 1))} className="grid h-14 w-14 place-items-center rounded-full bg-niebla text-2xl font-semibold active:bg-linea" aria-label="Menos">−</button>
          <span className="w-16 text-center text-4xl font-semibold tabular-nums">{cantidad}</span>
          <button onClick={() => setCantidad((c) => Math.min(tope, c + 1))} className="grid h-14 w-14 place-items-center rounded-full bg-niebla text-2xl font-semibold active:bg-linea" aria-label="Más">+</button>
        </div>
      </div>
    </Hoja>
  )
}

// Abre la hoja de un cliente con sus datos al día (los trae del servidor al abrirla).
export function CuentaAbierta({ tipo, clienteId, onCerrar, onHecho }: { tipo: 'abono' | 'envases'; clienteId: string; onCerrar: () => void; onHecho: () => void }) {
  const abono = useServidor<CuentaCliente>(tipo === 'abono' ? `/cobranza/clientes/${clienteId}` : null)
  const envases = useServidor<CuentaEnvases>(tipo === 'envases' ? `/envases/clientes/${clienteId}` : null)
  const error = abono.error || envases.error
  useEffect(() => { if (error) { aviso(error); onCerrar() } }, [error]) // eslint-disable-line react-hooks/exhaustive-deps
  if (tipo === 'abono' && abono.datos) return <HojaAbono cuenta={abono.datos} onCerrar={onCerrar} onHecho={onHecho} />
  if (tipo === 'envases' && envases.datos) return <HojaEnvases cuenta={envases.datos} onCerrar={onCerrar} onHecho={onHecho} />
  return null
}
