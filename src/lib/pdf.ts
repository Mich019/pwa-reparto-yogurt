// Escritor mínimo de PDF, sin librerías: texto con las fuentes estándar, rectángulos, líneas y cuadrículas de QR.
// Las medidas van en milímetros con el origen arriba a la izquierda, como se dibuja en pantalla.

const PT = 72 / 25.4

// Anchos de Helvetica y Helvetica-Bold (AFM estándar) para los caracteres ASCII 32..126, en milésimas de em.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]
const HELVETICA_NEGRITA = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

// Signos del español que no son ASCII (igual en ambas fuentes).
const SIGNOS: Record<string, number> = { '¿': 611, '¡': 333, 'º': 365, 'ª': 370, '°': 400, '·': 278 }

export type Bytes = Uint8Array<ArrayBuffer>

// Guarda un archivo en Descargas (computadora o teléfono). El enlace va dentro de la página: Firefox no descarga
// desde un enlace suelto. La dirección temporal se suelta después, cuando el navegador ya empezó a leerla.
export function descargarArchivo(datos: Blob | Bytes, nombre: string, tipo = 'application/pdf') {
  const url = URL.createObjectURL(datos instanceof Blob ? datos : new Blob([datos], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return nombre
}

export type Fuente = 'normal' | 'negrita' | 'mono'
const NOMBRE_FUENTE: Record<Fuente, string> = { normal: 'F1', negrita: 'F2', mono: 'F3' }
const BASE_FUENTE: Record<Fuente, string> = { normal: 'Helvetica', negrita: 'Helvetica-Bold', mono: 'Courier' }

// Gris (0 negro … 1 blanco) o [r, g, b] de 0 a 1.
export type Color = number | [number, number, number]

const sinAcento = (c: string) => c.normalize('NFD').replace(/[̀-ͯ]/g, '')

// Lo que la fuente estándar (WinAnsi) puede mostrar; lo demás se aproxima o se cambia por «?».
function paraPdf(texto: string): string {
  let s = ''
  for (const c of texto) {
    const n = c.codePointAt(0)!
    if (n < 32 || (n >= 127 && n < 160)) s += ' '
    else if (n <= 255) s += c
    else {
      const base = sinAcento(c)
      s += base.length === 1 && base.charCodeAt(0) < 128 ? base : '?'
    }
  }
  return s
}

export function anchoTexto(texto: string, fuente: Fuente, tam: number): number {
  let milesimas = 0
  for (const c of paraPdf(texto)) {
    if (fuente === 'mono') { milesimas += 600; continue }
    const tabla = fuente === 'negrita' ? HELVETICA_NEGRITA : HELVETICA
    const b = sinAcento(c).charCodeAt(0)
    // Con acento la «i» minúscula mide como la «l» ancha (278); las demás letras acentuadas miden igual que la base.
    milesimas += fuente === 'normal' && 'íìîï'.includes(c) ? 278 : SIGNOS[c] ?? (b >= 32 && b <= 126 ? tabla[b - 32] : 556)
  }
  return (milesimas / 1000) * tam / PT // mm
}

// Parte el texto en renglones que caben en `ancho` mm; si sobra texto, el último termina en «...».
export function ajustarTexto(texto: string, fuente: Fuente, tam: number, ancho: number, maxRenglones: number): string[] {
  const cabe = (s: string) => anchoTexto(s, fuente, tam) <= ancho
  const recortar = (s: string) => {
    let t = s
    while (t.length > 1 && !cabe(`${t}...`)) t = t.slice(0, -1)
    return `${t.trimEnd()}...`
  }
  const renglones: string[] = []
  let actual = ''
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (actual && !cabe(prueba)) { renglones.push(actual); actual = palabra } else actual = prueba
  }
  if (actual) renglones.push(actual)
  const ajustar = (r: string) => (cabe(r) ? r : recortar(r))
  if (renglones.length <= maxRenglones) return renglones.map(ajustar)
  return [...renglones.slice(0, maxRenglones - 1).map(ajustar), recortar(renglones.slice(maxRenglones - 1).join(' '))]
}

const num = (x: number) => String(Math.round(x * 100) / 100)

function color(c: Color, trazo: boolean): string {
  return Array.isArray(c) ? `${c.map(num).join(' ')} ${trazo ? 'RG' : 'rg'}` : `${num(c)} ${trazo ? 'G' : 'g'}`
}

const escapar = (s: string) => s.replace(/[\\()]/g, '\\$&')

interface Pagina { ancho: number; alto: number; ops: string[] }

export class Documento {
  private paginas: Pagina[] = []
  private actual!: Pagina

  constructor(private titulo = '') {}

  pagina(anchoMm: number, altoMm: number) {
    this.actual = { ancho: anchoMm, alto: altoMm, ops: [] }
    this.paginas.push(this.actual)
  }

  // Vuelve a dibujar sobre cada página ya hecha: el pie «Página 1 de 3» necesita saber cuántas son.
  enCadaPagina(dibujar: (n: number, total: number) => void) {
    this.paginas.forEach((p, i) => { this.actual = p; dibujar(i + 1, this.paginas.length) })
  }

  private y(mm: number) { return num((this.actual.alto - mm) * PT) }
  private x(mm: number) { return num(mm * PT) }

  rect(x: number, y: number, ancho: number, alto: number, o: { relleno?: Color; borde?: Color; grosor?: number; guion?: [number, number] }) {
    const ops = this.actual.ops
    ops.push('q')
    if (o.relleno !== undefined) ops.push(color(o.relleno, false))
    if (o.borde !== undefined) {
      ops.push(color(o.borde, true), `${num((o.grosor ?? 0.25) * PT)} w`)
      if (o.guion) ops.push(`[${num(o.guion[0] * PT)} ${num(o.guion[1] * PT)}] 0 d`)
    }
    ops.push(`${this.x(x)} ${this.y(y + alto)} ${num(ancho * PT)} ${num(alto * PT)} re`)
    ops.push(o.relleno !== undefined && o.borde !== undefined ? 'B' : o.relleno !== undefined ? 'f' : 'S', 'Q')
  }

  linea(x1: number, y1: number, x2: number, y2: number, o: { color?: Color; grosor?: number; guion?: [number, number] } = {}) {
    const ops = this.actual.ops
    ops.push('q', color(o.color ?? 0, true), `${num((o.grosor ?? 0.25) * PT)} w`)
    if (o.guion) ops.push(`[${num(o.guion[0] * PT)} ${num(o.guion[1] * PT)}] 0 d`)
    ops.push(`${this.x(x1)} ${this.y(y1)} m ${this.x(x2)} ${this.y(y2)} l S`, 'Q')
  }

  // `y` es la línea base del texto. `alinear` decide qué punto del texto cae en `x`.
  texto(texto: string, x: number, y: number, o: { fuente?: Fuente; tam?: number; color?: Color; alinear?: 'izq' | 'centro' | 'der' } = {}) {
    const fuente = o.fuente ?? 'normal'
    const tam = o.tam ?? 10
    const ancho = anchoTexto(texto, fuente, tam)
    const x0 = o.alinear === 'centro' ? x - ancho / 2 : o.alinear === 'der' ? x - ancho : x
    this.actual.ops.push(
      'q', color(o.color ?? 0, false),
      `BT /${NOMBRE_FUENTE[fuente]} ${num(tam)} Tf ${this.x(x0)} ${this.y(y)} Td (${escapar(paraPdf(texto))}) Tj ET`,
      'Q',
    )
  }

  // Dibuja una matriz de módulos (QR) dentro de un cuadrado de `lado` mm. Une los módulos contiguos de cada fila
  // en un solo rectángulo para que el archivo pese poco y no queden costuras entre módulos.
  modulos(x: number, y: number, lado: number, n: number, oscuro: (fila: number, col: number) => boolean) {
    const m = lado / n
    const ops = this.actual.ops
    ops.push('q', '0 g')
    for (let f = 0; f < n; f++) {
      let c = 0
      while (c < n) {
        if (!oscuro(f, c)) { c++; continue }
        const ini = c
        while (c < n && oscuro(f, c)) c++
        ops.push(`${this.x(x + ini * m)} ${this.y(y + (f + 1) * m)} ${num((c - ini) * m * PT)} ${num(m * PT)} re`)
      }
    }
    ops.push('f', 'Q')
  }

  bytes(): Bytes {
    let salida = ''
    const offsets: number[] = []
    const objeto = (n: number, cuerpo: string) => {
      offsets[n] = salida.length
      salida += `${n} 0 obj\n${cuerpo}\nendobj\n`
    }
    salida += '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
    const total = 6 + this.paginas.length * 2
    const ids = this.paginas.map((_, i) => 7 + i * 2)
    objeto(1, '<< /Type /Catalog /Pages 2 0 R >>')
    objeto(2, `<< /Type /Pages /Count ${this.paginas.length} /Kids [${ids.map((i) => `${i} 0 R`).join(' ')}] >>`)
    ;(['normal', 'negrita', 'mono'] as Fuente[]).forEach((f, i) =>
      objeto(3 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${BASE_FUENTE[f]} /Encoding /WinAnsiEncoding >>`))
    objeto(6, `<< /Title (${escapar(paraPdf(this.titulo))}) /Producer (Reparto de yogurt) >>`)
    this.paginas.forEach((p, i) => {
      const contenido = p.ops.join('\n')
      objeto(ids[i], `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.ancho * PT)} ${num(p.alto * PT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${ids[i] + 1} 0 R >>`)
      objeto(ids[i] + 1, `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`)
    })
    const xref = salida.length
    salida += `xref\n0 ${total + 1}\n0000000000 65535 f \n`
    for (let n = 1; n <= total; n++) salida += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
    salida += `trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`

    const bytes = new Uint8Array(salida.length)
    for (let i = 0; i < salida.length; i++) bytes[i] = salida.charCodeAt(i)
    return bytes
  }
}
