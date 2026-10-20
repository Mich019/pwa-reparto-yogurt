// Lectura de códigos con la cámara (RF-021) y de tarjetas NFC (RF-020). Sólo habla con el navegador;
// qué hacer con lo leído (RF-022) lo decide quien llama.

export type TipoError = 'permiso' | 'sin-camara' | 'ocupada' | 'inseguro' | 'sin-nfc' | 'nfc-apagado' | 'otro'

export class ErrorEscaneo extends Error {
  constructor(public tipo: TipoError, mensaje: string) { super(mensaje) }
}

export interface Lectura { texto: string; formato: string }

// ------------------------------------------------------------------ cámara
interface DetectorNativo {
  detect(fuente: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>
}
declare const BarcodeDetector: (new (o?: { formats?: string[] }) => DetectorNativo) & { getSupportedFormats(): Promise<string[]> } | undefined

// QR y los códigos de barras de uso común.
const FORMATOS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar']

type Detectar = (video: HTMLVideoElement) => Promise<Lectura | null>

// Chrome para Android trae lector propio (rápido, QR y barras). Donde no existe se decodifica con jsQR, sólo QR.
async function crearDetector(): Promise<{ detectar: Detectar; barras: boolean }> {
  if (typeof BarcodeDetector !== 'undefined') {
    try {
      const soportados = await BarcodeDetector.getSupportedFormats()
      const formatos = FORMATOS.filter((f) => soportados.includes(f))
      if (formatos.includes('qr_code')) {
        const d = new BarcodeDetector({ formats: formatos })
        return {
          barras: formatos.length > 1,
          detectar: async (v) => {
            const [r] = await d.detect(v)
            return r ? { texto: r.rawValue, formato: r.format } : null
          },
        }
      }
    } catch { /* cae al lector por software */ }
  }
  const { default: jsQR } = await import('jsqr')
  const lienzo = document.createElement('canvas')
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })!
  return {
    barras: false,
    detectar: async (v) => {
      if (!v.videoWidth) return null
      const ancho = Math.min(v.videoWidth, 720)
      const alto = Math.round((v.videoHeight * ancho) / v.videoWidth)
      lienzo.width = ancho
      lienzo.height = alto
      ctx.drawImage(v, 0, 0, ancho, alto)
      const r = jsQR(ctx.getImageData(0, 0, ancho, alto).data, ancho, alto, { inversionAttempts: 'dontInvert' })
      return r ? { texto: r.data, formato: 'qr_code' } : null
    },
  }
}

export interface Camara {
  detener(): void
  barras: boolean
  linterna: ((encendida: boolean) => Promise<void>) | null
}

function errorDeCamara(e: unknown): ErrorEscaneo {
  const nombre = (e as DOMException)?.name
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError')
    return new ErrorEscaneo('permiso', 'Sin permiso para usar la cámara. Actívalo en los ajustes del navegador para esta app.')
  if (nombre === 'NotFoundError' || nombre === 'OverconstrainedError')
    return new ErrorEscaneo('sin-camara', 'Este dispositivo no tiene cámara disponible.')
  if (nombre === 'NotReadableError' || nombre === 'AbortError')
    return new ErrorEscaneo('ocupada', 'La cámara está en uso por otra aplicación. Ciérrala e inténtalo de nuevo.')
  return new ErrorEscaneo('otro', 'No pude abrir la cámara.')
}

// Abre la cámara trasera dentro de `video` y llama a `alLeer` cada vez que ve un código.
// `alLeer` puede dispararse varias veces con el mismo código mientras siga a la vista: quien llama decide si lo ignora.
export async function iniciarCamara(video: HTMLVideoElement, alLeer: (l: Lectura) => void, cancelado: () => boolean): Promise<Camara> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new ErrorEscaneo('inseguro', 'La cámara sólo funciona en una página segura (https).')

  let flujo: MediaStream
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    })
  } catch (e) {
    throw errorDeCamara(e)
  }
  const apagar = () => { flujo.getTracks().forEach((t) => t.stop()); video.srcObject = null }
  if (cancelado()) { apagar(); throw new ErrorEscaneo('otro', 'Cancelado') }

  video.srcObject = flujo
  video.muted = true
  video.setAttribute('playsinline', 'true')
  try {
    await video.play()
  } catch (e) {
    apagar()
    throw errorDeCamara(e)
  }

  const { detectar, barras } = await crearDetector()
  let activa = true
  const ciclo = async () => {
    if (!activa) return
    if (video.readyState >= 2) {
      try {
        const l = await detectar(video)
        if (l && activa) alLeer(l)
      } catch { /* un cuadro que no se pudo leer no detiene el escaneo */ }
    }
    if (activa) setTimeout(ciclo, 120)
  }
  ciclo()

  const pista = flujo.getVideoTracks()[0]
  const capacidades = (pista.getCapabilities?.() ?? {}) as { torch?: boolean }
  return {
    barras,
    detener() { activa = false; apagar() },
    linterna: capacidades.torch
      ? (on) => pista.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      : null,
  }
}

// ------------------------------------------------------------------ NFC
interface EventoNfc extends Event { serialNumber: string }
interface LectorNfc extends EventTarget {
  scan(o?: { signal?: AbortSignal }): Promise<void>
  onreading: ((e: EventoNfc) => void) | null
  onreadingerror: (() => void) | null
}
declare const NDEFReader: (new () => LectorNfc) | undefined

// Web NFC existe sólo en Chrome para Android y exige página segura.
export const nfcDisponible = () => window.isSecureContext && typeof NDEFReader !== 'undefined'

// Escucha tarjetas hasta que se llame a lo que devuelve. `alLeer` recibe el UID tal como lo da el navegador.
export async function iniciarNfc(alLeer: (uid: string) => void, alFallar: (mensaje: string) => void): Promise<() => void> {
  if (!nfcDisponible()) throw new ErrorEscaneo('sin-nfc', 'Este teléfono o navegador no lee NFC. Se necesita Chrome en Android.')
  const lector = new NDEFReader!()
  const control = new AbortController()
  try {
    await lector.scan({ signal: control.signal })
  } catch (e) {
    const nombre = (e as DOMException)?.name
    if (nombre === 'NotAllowedError') throw new ErrorEscaneo('permiso', 'Sin permiso para usar el NFC. Actívalo en los ajustes del navegador.')
    if (nombre === 'NotReadableError') throw new ErrorEscaneo('nfc-apagado', 'El NFC está apagado. Enciéndelo en los ajustes del teléfono.')
    throw new ErrorEscaneo('sin-nfc', 'No pude activar el NFC en este teléfono.')
  }
  lector.onreading = (e) => alLeer(e.serialNumber)
  lector.onreadingerror = () => alFallar('No pude leer esa tarjeta. Acércala de nuevo, despacio.')
  return () => control.abort()
}
