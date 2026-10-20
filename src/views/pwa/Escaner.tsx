import { useEffect, useRef, useState } from 'react'
import { Flashlight, FlashlightOff, Nfc, X } from 'lucide-react'
import type { Cliente } from '../../lib/db'
import { clientePorNfc, clientePorQR, type Busqueda } from '../../lib/codigos'
import { iniciarCamara, iniciarNfc, nfcDisponible, type Camara } from '../../lib/escaneo'

// Visor a pantalla completa: la cámara lee QR (y códigos de barras donde el navegador puede) y, en Android con
// Chrome, la misma pantalla escucha tarjetas NFC. Lo primero que se lea y sea de un cliente activo se entrega
// a `onCliente` (RF-020, 021, 022). Se monta sólo mientras está abierto, así la cámara se apaga al cerrarlo.
export default function Escaner({ onCliente, onCerrar }: { onCliente: (c: Cliente) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [camara, setCamara] = useState<Camara | null>(null)
  const [errorCamara, setErrorCamara] = useState<string | null>(null)
  const [nfc, setNfc] = useState<{ ok: boolean; texto: string } | null>(null)
  const [luz, setLuz] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const alCliente = useRef(onCliente)
  alCliente.current = onCliente
  const resuelto = useRef(false)
  const reciente = useRef({ clave: '', ts: 0 })
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined)

  function avisar(texto: string) {
    setMensaje(texto)
    clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => setMensaje(null), 3000)
  }

  // El mismo código sigue a la vista cuadro tras cuadro: no se vuelve a evaluar durante unos segundos.
  async function leido(clave: string, buscar: () => Promise<Busqueda>) {
    if (resuelto.current) return
    const ahora = Date.now()
    if (reciente.current.clave === clave && ahora - reciente.current.ts < 2500) return
    reciente.current = { clave, ts: ahora }
    const r = await buscar()
    if (resuelto.current) return
    if (!r.ok) return avisar(r.motivo === 'invalido' ? 'Ese código no es de un cliente.' : 'No encontré ese código entre tus clientes.')
    if (!r.cliente.activo) return avisar(`${r.cliente.nombre} está archivado. Reactívalo desde Clientes.`)
    resuelto.current = true
    navigator.vibrate?.(80)
    alCliente.current(r.cliente)
  }

  useEffect(() => {
    let cancelado = false
    let abierta: Camara | undefined
    iniciarCamara(video.current!, (l) => leido(l.texto, () => clientePorQR(l.texto)), () => cancelado)
      .then((c) => { if (cancelado) c.detener(); else { abierta = c; setCamara(c) } })
      .catch((e: Error) => { if (!cancelado) setErrorCamara(e.message) })
    return () => { cancelado = true; abierta?.detener() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!nfcDisponible()) return
    let cancelado = false
    let parar: (() => void) | undefined
    iniciarNfc((uid) => leido(`nfc:${uid}`, () => clientePorNfc(uid)), avisar)
      .then((p) => { if (cancelado) p(); else { parar = p; setNfc({ ok: true, texto: 'NFC listo: acerca la tarjeta del cliente al teléfono.' }) } })
      .catch((e: Error) => { if (!cancelado) setNfc({ ok: false, texto: e.message }) })
    return () => { cancelado = true; parar?.() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(temporizador.current), [])

  async function alternarLuz() {
    try {
      await camara?.linterna?.(!luz)
      setLuz(!luz)
    } catch { avisar('No pude encender la linterna.') }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black text-white">
      <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" />

      {!errorCamara && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-64 w-64 rounded-3xl border-4 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
        </div>
      )}

      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-safe">
        <button onClick={onCerrar} aria-label="Cerrar" className="mt-2 grid h-11 w-11 place-items-center rounded-full bg-black/55 active:bg-black/80">
          <X size={22} />
        </button>
        {camara?.linterna && (
          <button onClick={alternarLuz} aria-label="Linterna" className="mt-2 grid h-11 w-11 place-items-center rounded-full bg-black/55 active:bg-black/80">
            {luz ? <FlashlightOff size={22} /> : <Flashlight size={22} />}
          </button>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 px-4 pb-safe">
        {mensaje && <div className="mx-auto mb-3 w-fit max-w-full rounded-full bg-ambar px-4 py-2.5 text-center text-sm font-semibold text-tinta">{mensaje}</div>}
        <div className="mx-auto mb-2 max-w-xl space-y-1.5 rounded-2xl bg-papel p-4 text-tinta shadow-hoja">
          <div className="text-lg font-semibold">Escanear cliente</div>
          {errorCamara ? (
            <div className="text-sm text-rojo">{errorCamara}</div>
          ) : (
            <div className="text-sm text-apagado">
              {camara ? `Apunta al QR${camara.barras ? ' o código de barras' : ''} de la tarjeta del cliente.` : 'Abriendo la cámara…'}
            </div>
          )}
          {nfc && (
            <div className={`flex items-start gap-2 text-sm ${nfc.ok ? 'text-verde' : 'text-apagado'}`}>
              <Nfc size={18} className="mt-px shrink-0" /> {nfc.texto}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
