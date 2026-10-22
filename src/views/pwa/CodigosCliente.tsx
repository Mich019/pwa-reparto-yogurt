import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CreditCard, Download, Nfc, RotateCcw, Search, Share2, Unlink } from 'lucide-react'
import type { Cliente } from '../../lib/db'
import {
  ETIQUETAS_POR_HOJA, codigoCorto, compartirPdf, contenidoQR, duenoDeTarjeta, matrizQR, nombreArchivo, normalizarUid, puedeCompartirPdf,
  pdfEtiqueta, pdfEtiquetas, quitarTarjeta, reponerQR, vincularTarjeta, type MatrizQR,
} from '../../lib/codigos'
import { iniciarNfc, nfcDisponible } from '../../lib/escaneo'
import { descargarArchivo } from '../../lib/pdf'
import { Boton, Hoja, aviso, claseInput } from '../../components/ui'

// El QR del cliente en pantalla, como vector.
export function ImagenQR({ texto, className = '', etiqueta = 'Código QR del cliente' }: { texto: string; className?: string; etiqueta?: string }) {
  const [m, setM] = useState<MatrizQR | null>(null)
  useEffect(() => {
    let vigente = true
    matrizQR(texto).then((r) => vigente && setM(r))
    return () => { vigente = false }
  }, [texto])
  const ruta = useMemo(() => {
    if (!m) return ''
    let d = ''
    for (let f = 0; f < m.n; f++) {
      for (let c = 0; c < m.n; c++) {
        if (!m.oscuro(f, c)) continue
        const ini = c
        while (c + 1 < m.n && m.oscuro(f, c + 1)) c++
        d += `M${ini + 4} ${f + 4}h${c - ini + 1}v1h-${c - ini + 1}z`
      }
    }
    return d
  }, [m])
  if (!m) return <div className={`aspect-square animate-pulse rounded-2xl bg-niebla ${className}`} />
  return (
    <svg viewBox={`0 0 ${m.n + 8} ${m.n + 8}`} shapeRendering="crispEdges" role="img" aria-label={etiqueta} className={`aspect-square rounded-2xl bg-white ring-1 ring-linea ${className}`}>
      <path d={ruta} fill="#000" />
    </svg>
  )
}

type Modo =
  | { t: 'reposo' }
  | { t: 'reponer' }
  | { t: 'leyendo' }
  | { t: 'manual' }
  | { t: 'confirmar'; uid: string; dueno: Cliente }

// Ficha de códigos de un cliente: su QR para imprimir o reponer (RF-015, 016, 018) y su tarjeta NFC (RF-019).
export function FichaCodigos({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const [modo, setModo] = useState<Modo>({ t: 'reposo' })
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const actual = useRef(cliente)
  actual.current = cliente
  const hayNfc = nfcDisponible()
  const compartible = puedeCompartirPdf()

  async function exportar(compartir: boolean) {
    setOcupado(true)
    try {
      const nombre = `qr-${nombreArchivo(cliente.nombre)}.pdf`
      const pdf = await pdfEtiqueta(cliente)
      const r = compartir ? await compartirPdf(pdf, nombre) : (descargarArchivo(pdf, nombre), 'descargado')
      if (r === 'descargado') aviso(`Se descargó ${nombre}. Imprímelo a tamaño real (100 %).`)
    } catch {
      aviso('No se pudo generar el PDF del QR')
    } finally { setOcupado(false) }
  }

  async function reponer() {
    await reponerQR(cliente)
    setModo({ t: 'reposo' })
    aviso('QR nuevo listo. Imprime la etiqueta y cambia el imán.')
  }

  async function recibirUid(bruto: string) {
    const id = normalizarUid(bruto)
    const c = actual.current
    if (!id) return setError('Ese UID no es válido: son de 8 a 20 dígitos hexadecimales (0-9 y A-F).')
    setError(null)
    if (c.nfc_uid && normalizarUid(c.nfc_uid) === id) {
      setModo({ t: 'reposo' })
      return aviso('Esa tarjeta ya es de este cliente')
    }
    const dueno = await duenoDeTarjeta(id, c.id)
    if (dueno) return setModo({ t: 'confirmar', uid: id, dueno })
    await vincular(id)
  }

  async function vincular(id: string) {
    const { quitadaA } = await vincularTarjeta(actual.current, id)
    setModo({ t: 'reposo' })
    setManual('')
    aviso(quitadaA ? `Tarjeta pasada de ${quitadaA.nombre} a ${cliente.nombre}` : 'Tarjeta vinculada')
  }

  // Mientras se espera la tarjeta, el navegador escucha el NFC.
  useEffect(() => {
    if (modo.t !== 'leyendo') return
    let cancelado = false
    let parar: (() => void) | undefined
    iniciarNfc(recibirUid, setError)
      .then((p) => { if (cancelado) p(); else parar = p })
      .catch((e: Error) => { if (!cancelado) { setError(e.message); setModo({ t: 'reposo' }) } })
    return () => { cancelado = true; parar?.() }
  }, [modo.t]) // eslint-disable-line react-hooks/exhaustive-deps

  const empezar = (t: 'leyendo' | 'manual') => { setError(null); setModo({ t }) }
  const cancelar = () => { setError(null); setModo({ t: 'reposo' }) }

  return (
    <Hoja abierta onCerrar={onCerrar} alto titulo={<div>Código del cliente<div className="text-base font-medium text-apagado">{cliente.nombre}</div></div>}>
      <div className="space-y-6 pb-4">
        <div className="mx-auto w-64 max-w-full">
          <ImagenQR texto={contenidoQR(cliente)} className="w-full" />
          <div className="mt-2 text-center font-mono text-xs tracking-widest text-apagado">{codigoCorto(cliente)}</div>
        </div>

        {modo.t === 'reponer' ? (
          <div className="space-y-3 rounded-2xl bg-niebla p-4">
            <div className="font-semibold">¿Generar un QR nuevo?</div>
            <div className="text-sm text-apagado">El QR de ahora deja de funcionar en todos los teléfonos. Tendrás que imprimir el nuevo y cambiar el imán de {cliente.nombre}.</div>
            <div className="grid grid-cols-2 gap-2">
              <Boton variante="secundario" onClick={cancelar}>Cancelar</Boton>
              <Boton onClick={reponer}>Sí, generar</Boton>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Boton onClick={() => exportar(false)} disabled={ocupado}><Download size={20} /> Descargar PDF</Boton>
            <Boton variante="secundario" onClick={() => setModo({ t: 'reponer' })}><RotateCcw size={20} /> Reponer QR</Boton>
            {compartible && <Boton variante="fantasma" className="col-span-2" onClick={() => exportar(true)} disabled={ocupado}><Share2 size={20} /> Compartir o imprimir</Boton>}
          </div>
        )}

        <div>
          <div className="mb-2 text-lg font-semibold tracking-tight">Tarjeta NFC</div>
          <div className="rounded-2xl bg-niebla p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-papel"><CreditCard size={22} /></span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{cliente.nfc_uid ? 'Tarjeta vinculada' : 'Sin tarjeta'}</div>
                <div className="truncate font-mono text-xs text-apagado">{cliente.nfc_uid ?? 'Acerca el imán o tarjeta para vincularla'}</div>
              </div>
            </div>

            {modo.t === 'leyendo' && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 rounded-xl bg-papel p-3 text-sm font-semibold"><Nfc size={20} className="animate-pulse" /> Acerca la tarjeta a la parte trasera del teléfono…</div>
                <Boton variante="secundario" className="w-full" onClick={cancelar}>Cancelar</Boton>
              </div>
            )}

            {modo.t === 'confirmar' && (
              <div className="mt-4 space-y-3">
                <div className="text-sm">Esa tarjeta ya es de <b>{modo.dueno.nombre}</b>. ¿La pasas a {cliente.nombre}? {modo.dueno.nombre} se queda sin tarjeta.</div>
                <div className="grid grid-cols-2 gap-2">
                  <Boton variante="secundario" onClick={cancelar}>Cancelar</Boton>
                  <Boton onClick={() => vincular(modo.uid)}>Pasarla</Boton>
                </div>
              </div>
            )}

            {modo.t === 'manual' && (
              <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); recibirUid(manual) }}>
                <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="UID, por ejemplo 04:A1:B2:C3" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className={`${claseInput} font-mono`} />
                <div className="grid grid-cols-2 gap-2">
                  <Boton variante="secundario" onClick={cancelar}>Cancelar</Boton>
                  <Boton disabled={!manual.trim()} onClick={() => recibirUid(manual)}><Check size={20} /> Vincular</Boton>
                </div>
              </form>
            )}

            {modo.t === 'reposo' && (
              <div className="mt-4 space-y-2">
                {hayNfc ? (
                  <Boton className="w-full" onClick={() => empezar('leyendo')}><Nfc size={20} /> {cliente.nfc_uid ? 'Cambiar tarjeta' : 'Vincular tarjeta'}</Boton>
                ) : (
                  <div className="text-sm text-apagado">Este teléfono o navegador no lee NFC (hace falta Chrome en Android). Si tienes un lector USB, teclea o pega el UID.</div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Boton variante={hayNfc ? 'fantasma' : 'primario'} className={hayNfc || !cliente.nfc_uid ? 'col-span-2' : ''} onClick={() => empezar('manual')}>Escribir el UID</Boton>
                  {cliente.nfc_uid && (
                    <Boton variante="peligro" onClick={async () => { await quitarTarjeta(cliente); aviso('Tarjeta quitada') }}><Unlink size={18} /> Quitar</Boton>
                  )}
                </div>
              </div>
            )}

            {error && <div className="mt-3 text-sm font-medium text-rojo">{error}</div>}
          </div>
        </div>
      </div>
    </Hoja>
  )
}

// RF-017: elegir clientes y bajar un PDF con varias etiquetas por hoja.
export function ImpresionMasiva({ clientes, onCerrar }: { clientes: Cliente[]; onCerrar: () => void }) {
  const activos = useMemo(() => clientes.filter((c) => c.activo), [clientes])
  const [elegidos, setElegidos] = useState(() => new Set(activos.map((c) => c.id)))
  const [q, setQ] = useState('')
  const [generando, setGenerando] = useState(false)

  const t = q.trim().toLowerCase()
  const visibles = activos.filter((c) => !t || `${c.nombre} ${c.direccion}`.toLowerCase().includes(t))
  const todosVisibles = visibles.length > 0 && visibles.every((c) => elegidos.has(c.id))
  const alternar = (id: string) => setElegidos((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const alternarVisibles = () => setElegidos((s) => {
    const n = new Set(s)
    visibles.forEach((c) => (todosVisibles ? n.delete(c.id) : n.add(c.id)))
    return n
  })
  const total = activos.filter((c) => elegidos.has(c.id)).length
  const hojas = Math.ceil(total / ETIQUETAS_POR_HOJA)

  const compartible = puedeCompartirPdf()

  async function generar(compartir: boolean) {
    setGenerando(true)
    try {
      const nombre = `qr-clientes-${total}.pdf`
      const pdf = await pdfEtiquetas(activos.filter((c) => elegidos.has(c.id)))
      const r = compartir ? await compartirPdf(pdf, nombre) : (descargarArchivo(pdf, nombre), 'descargado')
      if (r === 'descargado') aviso(`Se descargó ${nombre}. Imprímelo a tamaño real (100 %).`)
    } catch {
      aviso('No se pudo generar el PDF de los QR')
    } finally { setGenerando(false) }
  }

  return (
    <Hoja
      abierta
      onCerrar={onCerrar}
      alto
      titulo={<div>Imprimir QR<div className="text-base font-medium text-apagado">{ETIQUETAS_POR_HOJA} etiquetas por hoja Carta</div></div>}
      pie={
        <div className="flex gap-2">
          <Boton className="flex-1 text-lg" disabled={!total || generando} onClick={() => generar(false)}>
            <Download size={20} /> {generando ? 'Generando…' : total ? `Descargar PDF · ${total} ${total === 1 ? 'etiqueta' : 'etiquetas'} (${hojas} ${hojas === 1 ? 'hoja' : 'hojas'})` : 'Elige clientes'}
          </Boton>
          {compartible && (
            <Boton variante="secundario" disabled={!total || generando} onClick={() => generar(true)}><Share2 size={20} /><span className="sr-only">Compartir o imprimir</span></Boton>
          )}
        </div>
      }
    >
      <div className="relative mb-2">
        <Search size={18} className="absolute top-1/2 left-4 -translate-y-1/2" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" className={`${claseInput} pl-11`} />
      </div>
      <button onClick={alternarVisibles} className="mb-1 py-2 text-sm font-semibold text-azul">{todosVisibles ? 'Quitar la selección' : 'Elegir todos'}</button>
      {visibles.map((c) => {
        const on = elegidos.has(c.id)
        return (
          <button key={c.id} onClick={() => alternar(c.id)} className="flex w-full items-center gap-3 border-b border-linea py-3 text-left active:bg-niebla">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 ${on ? 'border-tinta bg-tinta text-white' : 'border-linea'}`}>{on && <Check size={16} strokeWidth={3} />}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{c.nombre}</span>
              <span className="block truncate text-sm text-apagado">{c.direccion || 'Sin dirección'}</span>
            </span>
          </button>
        )
      })}
      {visibles.length === 0 && <div className="py-10 text-center text-apagado">{activos.length ? 'Sin resultados' : 'No hay clientes activos'}</div>}
    </Hoja>
  )
}
