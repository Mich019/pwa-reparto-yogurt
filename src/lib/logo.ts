import { leerImagen } from './imagen'

// Logo de la empresa (Configuración → Marca). Se revisa y se arregla en el navegador, sin servicios de fuera:
// detectar si trae fondo, quitarlo (relleno desde los bordes), recortar márgenes vacíos y reducirlo a 512 px en WEBP
// con transparencia (PNG si el navegador no genera WEBP). Los SVG se dejan tal cual: ya son ligeros y nítidos.

const LOGO_LADO = 512

export interface RevisionLogo {
  vectorial: boolean
  fondo: string | null // color del fondo liso que rodea al logo, si lo trae (#rrggbb)
  transparente: boolean
  ancho: number // tamaño original, en px
  alto: number
  claro: boolean // casi todo blanco o muy claro: no se lee sobre fondos claros
  oscuro: boolean // casi todo negro o muy oscuro: no se lee en modo oscuro
  colores: string[] // los colores principales, para sugerirlos como color de la marca
}

const hexDe = (r: number, g: number, b: number) => `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
const distancia = (d: Uint8ClampedArray, i: number, [r, g, b]: number[]) => Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b)

function pixeles(img: HTMLImageElement, lado: number) {
  // Los SVG sin tamaño propio llegan con 0 × 0: se dibujan a `lado`.
  const iw = img.naturalWidth || lado
  const ih = img.naturalHeight || lado
  const f = Math.min(1, lado / Math.max(iw, ih))
  const w = Math.max(1, Math.round(iw * f))
  const h = Math.max(1, Math.round(ih * f))
  const lienzo = document.createElement('canvas')
  lienzo.width = w
  lienzo.height = h
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, w, h)
  return { lienzo, ctx, datos: ctx.getImageData(0, 0, w, h), w, h }
}

// Índices (de a 4) de los píxeles del borde.
function borde(w: number, h: number) {
  const r: number[] = []
  for (let x = 0; x < w; x++) r.push(x * 4, ((h - 1) * w + x) * 4)
  for (let y = 1; y < h - 1; y++) r.push(y * w * 4, (y * w + w - 1) * 4)
  return r
}

// El fondo es liso si casi todo el borde es opaco y del mismo color.
function fondoDe(d: Uint8ClampedArray, w: number, h: number): number[] | null {
  const b = borde(w, h)
  const opacos = b.filter((i) => d[i + 3] > 240)
  if (opacos.length < b.length * 0.9) return null
  const medio = [0, 1, 2].map((k) => opacos.map((i) => d[i + k]).sort((x, y) => x - y)[opacos.length >> 1])
  return opacos.filter((i) => distancia(d, i, medio) < 36).length >= b.length * 0.85 ? medio : null
}

export async function revisarLogo(src: string): Promise<RevisionLogo> {
  const img = new Image()
  img.src = src
  await img.decode()
  const { datos: { data: d }, w, h } = pixeles(img, 200)
  const fondo = fondoDe(d, w, h)
  let visibles = 0, transparentes = 0, claros = 0, oscuros = 0
  const cubetas = new Map<string, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { transparentes++; continue }
    if (fondo && distancia(d, i, fondo) < 36) continue
    visibles++
    const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
    if (lum > 0.85) claros++
    if (lum < 0.18) oscuros++
    const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2])
    if (max - min < 40 || max < 40) continue // grises, blancos y negros no sirven de color de marca
    const k = `${d[i] >> 5},${d[i + 1] >> 5},${d[i + 2] >> 5}`
    const c = cubetas.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
    c.n++; c.r += d[i]; c.g += d[i + 1]; c.b += d[i + 2]
    cubetas.set(k, c)
  }
  const colores = [...cubetas.values()].filter((c) => c.n > visibles * 0.03).sort((a, b) => b.n - a.n).slice(0, 4)
    .map((c) => hexDe(Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)))
  return {
    vectorial: src.startsWith('data:image/svg'),
    fondo: fondo ? hexDe(fondo[0], fondo[1], fondo[2]) : null,
    transparente: transparentes > (d.length / 4) * 0.02,
    ancho: img.naturalWidth,
    alto: img.naturalHeight,
    claro: visibles > 0 && claros / visibles > 0.8,
    oscuro: visibles > 0 && oscuros / visibles > 0.8,
    colores,
  }
}

const leerComoDataUrl = (archivo: File) => new Promise<string>((ok, mal) => {
  const lector = new FileReader()
  lector.onload = () => ok(String(lector.result))
  lector.onerror = () => mal(new Error('No se pudo leer esa imagen; prueba con otra'))
  lector.readAsDataURL(archivo)
})

// Deja el logo listo para guardar: sin fondo (si se pide), sin márgenes vacíos y a lo más de 512 px.
export async function prepararLogo(archivo: File, { quitarFondo = false } = {}): Promise<string> {
  if (archivo.type === 'image/svg+xml') return leerComoDataUrl(archivo)
  const img = await leerImagen(archivo)
  try {
    const { lienzo, ctx, datos, w, h } = pixeles(img, 1024)
    const d = datos.data
    const fondo = quitarFondo ? fondoDe(d, w, h) : null
    if (fondo) {
      // Relleno desde los bordes: sólo se borra el fondo que toca la orilla, no el blanco de adentro del logo.
      const visto = new Uint8Array(w * h)
      const pila = borde(w, h).map((i) => i / 4)
      while (pila.length) {
        const p = pila.pop()!
        if (visto[p]) continue
        visto[p] = 1
        const dist = distancia(d, p * 4, fondo)
        if (dist >= 90) continue
        // Cerca del color del fondo, transparente; en la orilla del dibujo, a medias (suaviza el contorno).
        d[p * 4 + 3] = dist < 45 ? 0 : Math.min(d[p * 4 + 3], Math.round(((dist - 45) / 45) * 255))
        if (dist >= 45) continue
        const x = p % w, y = (p / w) | 0
        if (x > 0) pila.push(p - 1)
        if (x < w - 1) pila.push(p + 1)
        if (y > 0) pila.push(p - w)
        if (y < h - 1) pila.push(p + w)
      }
      ctx.putImageData(datos, 0, 0)
    }
    // Márgenes: todo lo que es transparente o del color del fondo que se dejó.
    const resto = fondo ? null : fondoDe(d, w, h)
    let x0 = w, y0 = h, x1 = -1, y1 = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (d[i + 3] < 16 || (resto && distancia(d, i, resto) < 36)) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (x1 < 0) throw new Error('La imagen está vacía')
    const aire = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04) // un poco de aire alrededor
    x0 = Math.max(0, x0 - aire); y0 = Math.max(0, y0 - aire); x1 = Math.min(w - 1, x1 + aire); y1 = Math.min(h - 1, y1 + aire)
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1
    const f = Math.min(1, LOGO_LADO / Math.max(cw, ch))
    const salida = document.createElement('canvas')
    salida.width = Math.max(1, Math.round(cw * f))
    salida.height = Math.max(1, Math.round(ch * f))
    const sctx = salida.getContext('2d')!
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(lienzo, x0, y0, cw, ch, 0, 0, salida.width, salida.height)
    const webp = salida.toDataURL('image/webp', 0.9)
    return webp.startsWith('data:image/webp') ? webp : salida.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(img.src)
  }
}
