import { ajustarTexto, anchoTexto, Documento, imagenParaPdf, type Color, type Fuente, type ImagenPdf, type PdfListo } from './pdf'
import { colorLegible, marcaActual, type Marca } from './marca'
import { textoPorUnidad, tituloUnidad } from './unidades'
import type { InformeMes } from './cobranza'
import { cambio, textoPeriodo, type Periodo, type Reporte, type SaborVendido, type VendedorRendimiento } from './reportes'

// Informes en PDF para leer o imprimir (RF-048): el reporte de ventas y la libreta de clientes. Estilo sobrio de
// documento de empresa: fondo blanco, texto gris oscuro, líneas finas y el verde de la marca sólo como acento.
// Se arman en el teléfono con los datos que ya mandó el servidor.

const CARTA = { ancho: 215.9, alto: 279.4 } // mm
const M = 16
const RENGLON = 6.4

const TINTA: Color = [0.067, 0.094, 0.153] // #111827
const SECUNDARIO: Color = [0.29, 0.333, 0.408] // #4B5563
const TENUE: Color = [0.42, 0.447, 0.502] // #6B7280
const REGLA: Color = [0.82, 0.835, 0.859] // #D1D5DB
const FINA: Color = [0.898, 0.906, 0.922] // #E5E7EB
const FONDO: Color = [0.976, 0.98, 0.984] // #F9FAFB
// Marca de la empresa (src/lib/marca.ts): su nombre y su lema arriba, su contacto en el pie y su color como acento.
// Sin color propio, el verde de siempre; sin empresa, «Delisy». La hoja de muestra (hojaDeMuestra) dibuja con la marca que se está
// editando, aún sin guardar.
let marcaDeMuestra: Marca | null = null
let logoDeMuestra: ImagenPdf | null = null
const marca = () => marcaDeMuestra ?? marcaActual()
// El logo va como JPEG (pdf.ts imagenParaPdf), que se prepara antes de armar el PDF: prepararLogoPdf.
let logoListo: { fuente: string; img: ImagenPdf } | null = null
const logo = () => (marcaDeMuestra ? logoDeMuestra : logoListo && logoListo.fuente === marcaActual()?.logo ? logoListo.img : null)
export async function prepararLogoPdf() {
  const fuente = marcaActual()?.logo
  if (!fuente || logoListo?.fuente === fuente) return
  try {
    logoListo = { fuente, img: await imagenParaPdf(fuente) }
  } catch { /* una imagen que el navegador no sabe dibujar: el PDF sale sin logo */ }
}
const acento = (): Color => {
  const c = marca()?.color
  if (!c) return [3 / 255, 93 / 255, 56 / 255]
  const h = colorLegible(c)
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
}
const empresa = () => {
  const m = marca()
  return m?.nombre || 'Delisy'
}
const POSITIVO: Color = [0.016, 0.471, 0.341] // #047857
const NEGATIVO: Color = [0.725, 0.11, 0.11] // #B91C1C

const n2 = (n: number, dec: number) => n.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const din = (n: number | null) => (n === null ? '-' : `${n < 0 ? '-' : ''}$${n2(Math.abs(n), 2)}`)
const dinCorto = (n: number) => `$${n >= 1000 ? `${n2(n / 1000, n >= 10_000 ? 0 : 1)}k` : n2(n, 0)}`
const lit = (n: number, unidad = 'L') => `${n2(n, 1)} ${unidad}`
const pct = (n: number | null) => (n === null ? '-' : `${n2(n, 1)}%`)
const ent = (n: number) => n.toLocaleString('es-MX')
const fechaMx = (s: string | null) => (s ? s.split('-').reverse().join('/') : '-')
const hex = (s: string): Color => {
  const m = /^#?([0-9a-f]{6})$/i.exec(s)
  if (!m) return TENUE
  const v = parseInt(m[1], 16)
  return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}
const dos = (x: number) => String(x).padStart(2, '0')
const fechaHora = (d: Date) => `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()} ${dos(d.getHours())}:${dos(d.getMinutes())}`

export interface Columna<T> {
  titulo: string
  ancho: number // fracción del ancho útil
  der?: boolean
  valor: (f: T) => string
  detalle?: (f: T) => string | null | undefined // segundo renglón, más tenue (p. ej. la colonia bajo la dirección)
  color?: (f: T) => Color | undefined
  negrita?: boolean
  muestra?: (f: T) => Color // cuadrito de color antes del texto (el color del sabor)
}

// Cantidades: con una unidad, la columna de siempre («Litros», «12.5 L»); con varias, una columna por unidad («Litros»,
// «Kilos», «Piezas») con la cifra sola, porque «73,179 L + 5,301 kg + 48,058 pz» no cabe en una casilla. Las columnas
// de más le quitan ancho a las otras (la tabla reparte el ancho en proporción).
// Desde mil, sin decimales: «14,636» cabe en su columna con la letra de siempre («14,635.8» se achicaba).
const cifra = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 })
function columnasCantidad<T>(unidades: string[], ancho: number, pu: (f: T) => Record<string, number> | undefined, litros: (f: T) => number): Columna<T>[] {
  if (unidades.length < 2) return [{ titulo: tituloUnidad(unidades[0] ?? 'L'), ancho, der: true, valor: (f) => lit(litros(f), unidades[0]) }]
  return unidades.map((u) => ({ titulo: tituloUnidad(u), ancho: ancho * 0.9, der: true, valor: (f) => cifra(pu(f)?.[u] ?? 0) }))
}
const totalCantidad = (unidades: string[], pu: Record<string, number> | undefined, litros: number) =>
  unidades.length < 2 ? [lit(litros, unidades[0])] : unidades.map((u) => cifra(pu?.[u] ?? 0))

// Documento con encabezado, pie «Página n de N», secciones numeradas y tablas que continúan en la página siguiente.
class Informe {
  readonly pdf: Documento
  readonly ancho: number
  readonly alto: number
  readonly util: number
  y = 0
  private seccion = 0

  constructor(private titulo: string, private referencia: string, horizontal = false) {
    this.pdf = new Documento(`${titulo} · ${referencia}`)
    this.ancho = horizontal ? CARTA.alto : CARTA.ancho
    this.alto = horizontal ? CARTA.ancho : CARTA.alto
    this.util = this.ancho - 2 * M
  }

  get limite() { return this.alto - 20 }

  // Primera página: el logo (si hay), el nombre del documento a su lado y sus datos (periodo, fecha…) a la derecha.
  portada(subtitulo: string, datos: [string, string][], ahora: Date) {
    const { pdf } = this
    pdf.pagina(this.ancho, this.alto)
    pdf.rect(0, 0, this.ancho, 2.2, { relleno: acento() })
    let x = M
    const img = logo()
    if (img) {
      // En una caja de 36 × 22 mm, centrado a la altura del bloque de títulos.
      const k = Math.min(36 / img.ancho, 22 / img.alto)
      const [w, h] = [img.ancho * k, img.alto * k]
      pdf.imagen(img, M, 11 + (22 - h) / 2, w, h)
      x = M + w + 5
    }
    pdf.texto(empresa().toUpperCase(), x, 15, { fuente: 'negrita', tam: 8, color: acento() })
    const lema = marca()?.lema
    const xLema = x + anchoTexto(empresa().toUpperCase(), 'negrita', 8) + 3
    // Sin pisar los datos de la derecha (periodo, fecha…).
    if (lema) pdf.texto(ajustarTexto(lema, 'normal', 8, Math.max(20, this.util * 0.55 - xLema + M), 1)[0] ?? '', xLema, 15, { tam: 8, color: TENUE })
    pdf.texto(this.titulo, x, 26, { fuente: 'negrita', tam: 22, color: TINTA })
    pdf.texto(subtitulo, x, 33, { tam: 10.5, color: SECUNDARIO })
    const filas: [string, string][] = [...datos, ['Generado', fechaHora(ahora)]]
    const xEtiqueta = this.ancho - M - Math.max(...filas.map(([, v]) => anchoTexto(v, 'normal', 8.5))) - Math.max(...filas.map(([e]) => anchoTexto(e.toUpperCase(), 'negrita', 6.5))) - 6
    filas.forEach(([etiqueta, valor], i) => {
      const fy = 15 + i * 6
      pdf.texto(etiqueta.toUpperCase(), xEtiqueta, fy, { fuente: 'negrita', tam: 6.5, color: TENUE })
      pdf.texto(valor, this.ancho - M, fy, { tam: 8.5, color: TINTA, alinear: 'der' })
    })
    this.y = Math.max(40, 15 + filas.length * 6) + 2
    pdf.linea(M, this.y, this.ancho - M, this.y, { color: TINTA, grosor: 0.5 })
    this.y += 9
  }

  private nuevaPagina() {
    const { pdf } = this
    pdf.pagina(this.ancho, this.alto)
    pdf.rect(0, 0, this.ancho, 1.2, { relleno: acento() })
    pdf.texto(empresa().toUpperCase(), M, 11, { fuente: 'negrita', tam: 7, color: acento() })
    pdf.texto(`${this.titulo} · ${this.referencia}`, this.ancho - M, 11, { tam: 7.5, color: TENUE, alinear: 'der' })
    pdf.linea(M, 13.5, this.ancho - M, 13.5, { color: REGLA, grosor: 0.2 })
    this.y = 21
  }

  // Si lo que sigue no cabe en esta página, pasa a la siguiente.
  asegurar(alto: number) { if (this.y + alto > this.limite) this.nuevaPagina() }

  tituloSeccion(texto: string, nota?: string) {
    const { pdf } = this
    this.asegurar(30)
    this.seccion++
    pdf.texto(dos(this.seccion), M, this.y + 4, { fuente: 'negrita', tam: 10, color: acento() })
    pdf.texto(texto, M + 8, this.y + 4, { fuente: 'negrita', tam: 10.5, color: TINTA })
    if (nota) pdf.texto(nota, this.ancho - M, this.y + 4, { tam: 7.5, color: TENUE, alinear: 'der' })
    pdf.linea(M, this.y + 6.8, this.ancho - M, this.y + 6.8, { color: REGLA, grosor: 0.2 })
    this.y += 12
  }

  subtitulo(texto: string, nota?: string) {
    this.asegurar(30) // el subtítulo, el encabezado de su tabla, un renglón doble y el total
    this.pdf.texto(texto, M, this.y + 3, { fuente: 'negrita', tam: 9, color: SECUNDARIO })
    if (nota) this.pdf.texto(nota, this.ancho - M, this.y + 3, { tam: 7.5, color: TENUE, alinear: 'der' })
    this.y += 6
  }

  celda(texto: string, x: number, ancho: number, base: number, o: { fuente?: Fuente; tam?: number; color?: Color; der?: boolean }) {
    // Las cifras (columnas a la derecha) no se cortan: con varias unidades se achican hasta 6 pt para caber enteras.
    const tamNormal = o.tam ?? 8.3
    const tam = o.der ? Math.max(6, Math.min(tamNormal, Math.floor((100 * tamNormal * (ancho - 3.5)) / anchoTexto(texto, o.fuente ?? 'normal', tamNormal)) / 100)) : tamNormal // hacia abajo: justo al límite, el redondeo lo cortaba
    const [t = ''] = ajustarTexto(texto, o.fuente ?? 'normal', tam, ancho - 3.5, 1)
    this.pdf.texto(t, o.der ? x + ancho - 1.75 : x + 1.75, base, { fuente: o.fuente, tam, color: o.color ?? TINTA, alinear: o.der ? 'der' : 'izq' })
  }

  tabla<T>(columnas: Columna<T>[], filas: T[], total?: string[]) {
    const { pdf } = this
    // Los anchos son proporciones: si suman más de 1 (columnas por unidad), se reparten en el ancho útil.
    const suma = columnas.reduce((s, c) => s + c.ancho, 0)
    columnas = columnas.map((c) => ({ ...c, ancho: c.ancho / suma }))
    const xs = columnas.reduce<number[]>((a, c) => [...a, a[a.length - 1] + c.ancho * this.util], [M])
    const doble = columnas.some((c) => c.detalle)
    const alto = doble ? 9.6 : RENGLON
    const encabezado = () => {
      columnas.forEach((c, i) => this.celda(c.titulo.toUpperCase(), xs[i], c.ancho * this.util, this.y + 4, { fuente: 'negrita', tam: 6.5, color: TENUE, der: c.der }))
      this.y += 6
      pdf.linea(M, this.y, this.ancho - M, this.y, { color: TINTA, grosor: 0.35 })
    }
    // Una tabla corta no empieza al pie de la hoja si su total no cabe ahí.
    this.asegurar(6 + alto * Math.min(3, Math.max(1, filas.length)) + (total && filas.length <= 3 ? RENGLON + 1 : 0))
    encabezado()
    if (!filas.length) {
      pdf.texto('Sin registros.', M + 1.75, this.y + 4.6, { tam: 8.3, color: TENUE })
      this.y += RENGLON + 8
      return
    }
    filas.forEach((f, n) => {
      // El último renglón se va con el total: un total solo al inicio de la hoja no dice de qué es.
      const conTotal = total && n === filas.length - 1 ? RENGLON + 1 : 0
      if (this.y + alto + conTotal > this.limite) { this.nuevaPagina(); encabezado() }
      columnas.forEach((c, i) => {
        let x = xs[i]
        let ancho = c.ancho * this.util
        const muestra = c.muestra?.(f)
        if (muestra) {
          pdf.rect(x + 1.75, this.y + 2.1, 2.2, 2.2, { relleno: muestra })
          x += 3.4
          ancho -= 3.4
        }
        this.celda(c.valor(f), x, ancho, this.y + 4.3, { color: c.color?.(f), der: c.der, fuente: c.negrita ? 'negrita' : 'normal' })
        const detalle = c.detalle?.(f)
        if (detalle) this.celda(detalle, x, ancho, this.y + 8, { tam: 7, color: TENUE, der: c.der })
      })
      this.y += alto
      pdf.linea(M, this.y, this.ancho - M, this.y, { color: FINA, grosor: 0.15 })
    })
    if (total) {
      if (this.y + RENGLON + 1 > this.limite) { this.nuevaPagina(); encabezado() }
      pdf.linea(M, this.y, this.ancho - M, this.y, { color: TINTA, grosor: 0.35 })
      columnas.forEach((c, i) => this.celda(total[i] ?? '', xs[i], c.ancho * this.util, this.y + 4.6, { fuente: 'negrita', der: c.der }))
      this.y += RENGLON + 0.6
      pdf.linea(M, this.y, this.ancho - M, this.y, { color: TINTA, grosor: 0.35 })
    }
    this.y += 10
  }

  // La hoja de muestra de Configuración → Marca: secciones con su título y, en vez de datos, bloques grises con la forma
  // de cada cosa (cifras, gráfica, tablas). El acento va donde lo pone el reporte de verdad.
  esqueleto() {
    const { pdf, util } = this
    const gris = (x: number, y: number, ancho: number, alto: number, c: Color = FINA) => pdf.rect(x, y, ancho, alto, { relleno: c })
    this.tituloSeccion('Resumen', 'contra el mes anterior')
    for (let i = 0; i < 4; i++) {
      const x = M + (i * util) / 4
      gris(x, this.y, 16, 1.6)
      gris(x, this.y + 4, 24 - i * 2, 4.4, REGLA)
      gris(x, this.y + 11, 12, 1.4, i % 2 ? FINA : acento())
    }
    this.y += 22
    this.tituloSeccion('Ventas por día')
    const alturas = [12, 18, 15, 22, 9, 16, 24, 19, 14, 26, 21, 17, 28, 23]
    const paso = util / alturas.length
    const base = this.y + 30
    alturas.forEach((h, i) => gris(M + i * paso + paso * 0.18, base - h, paso * 0.64, h, i === alturas.length - 1 ? acento() : REGLA))
    pdf.linea(M, base, M + util, base, { color: TINTA, grosor: 0.35 })
    this.y = base + 10
    const tabla = (titulo: string, filas: number, cuadro: boolean) => {
      this.tituloSeccion(titulo)
      const anchos = [0.4, 0.2, 0.2, 0.2]
      const xs = anchos.reduce<number[]>((a, f) => [...a, a[a.length - 1] + f * util], [M])
      anchos.forEach((f, i) => gris(i ? xs[i + 1] - 1.75 - f * util * 0.4 : xs[i] + 1.75, this.y + 2, f * util * 0.4, 1.4))
      this.y += 6
      pdf.linea(M, this.y, M + util, this.y, { color: TINTA, grosor: 0.35 })
      for (let f = 0; f < filas; f++) {
        if (cuadro) pdf.rect(M + 1.75, this.y + 2.1, 2.2, 2.2, { relleno: f === 0 ? acento() : REGLA })
        gris(M + (cuadro ? 5.2 : 1.75), this.y + 2.3, util * (0.16 + ((f * 7) % 5) * 0.025), 1.8, REGLA)
        anchos.slice(1).forEach((a, i) => gris(xs[i + 2] - 1.75 - a * util * (0.3 + ((f + i) % 3) * 0.08), this.y + 2.3, a * util * (0.3 + ((f + i) % 3) * 0.08), 1.8))
        this.y += RENGLON
        pdf.linea(M, this.y, M + util, this.y, { color: FINA, grosor: 0.15 })
      }
      this.y += 10
    }
    tabla('Por sabor', 6, true)
    tabla('Por vendedor', 3, false)
  }

  nota(texto: string) {
    this.asegurar(8)
    for (const r of ajustarTexto(texto, 'normal', 7.5, this.util, 3)) {
      this.pdf.texto(r, M, this.y, { tam: 7.5, color: TENUE })
      this.y += 3.8
    }
    this.y += 4
  }

  listo(): PdfListo {
    this.pdf.enCadaPagina((n, total) => {
      this.pdf.linea(M, this.alto - 13, this.ancho - M, this.alto - 13, { color: REGLA, grosor: 0.2 })
      const contacto = marca()?.contacto
      const pie = `${empresa()} · ${contacto || 'Documento interno y confidencial'}`
      this.pdf.texto(ajustarTexto(pie, 'normal', 7, this.util - 30, 1)[0] ?? '', M, this.alto - 8.5, { tam: 7, color: TENUE })
      this.pdf.texto(`Página ${n} de ${total}`, this.ancho - M, this.alto - 8.5, { tam: 7, color: TENUE, alinear: 'der' })
    })
    return this.pdf.listo()
  }
}

// ---------------------------------------------------------------------------------------------- hoja de muestra

// La primera hoja de un reporte de ventas con la marca que se está editando (aún sin guardar) y sin datos: cómo se verá
// el PDF. Devuelve su SVG, el mismo que dibuja el visor de PDF. El logo llega ya preparado (imagenParaPdf).
export function hojaDeMuestra(m: Marca, logoPdf: ImagenPdf | null, ahora = new Date()): string {
  marcaDeMuestra = m
  logoDeMuestra = logoPdf
  try {
    const mes = ahora.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
    const inf = new Informe('Reporte de ventas', mes)
    inf.portada(`Las ventas de ${mes}`, [['Periodo', mes.charAt(0).toUpperCase() + mes.slice(1)]], ahora)
    inf.esqueleto()
    return inf.listo().paginas[0].svg
  } finally {
    marcaDeMuestra = null
    logoDeMuestra = null
  }
}

// ---------------------------------------------------------------------------------------------- reporte de ventas

export function reportePdf(r: Reporte, ahora = new Date()): PdfListo {
  const periodo = `${fechaMx(r.desde)} al ${fechaMx(r.hasta)}`
  const inf = new Informe('Reporte de ventas', periodo)
  const { pdf } = inf
  const x = r.resumen
  const a = r.anterior?.resumen
  const UNIDAD = { dia: 'día', semana: 'semana', mes: 'mes' }[r.agrupar]
  const unidades = r.unidades?.length ? r.unidades : ['L']
  const varias = unidades.length > 1
  const cant = (pu: Record<string, number> | undefined, n: number) => (varias ? textoPorUnidad(pu, unidades, n) : lit(n, unidades[0]))
  const total = totalCantidad.bind(null, unidades)
  const tituloCant = varias ? 'Cantidad' : tituloUnidad(unidades[0])

  inf.portada(`Resultados del ${periodo}`, [
    ['Periodo', periodo],
    ...(r.anterior ? [['Comparado con', `${fechaMx(r.anterior.desde)} al ${fechaMx(r.anterior.hasta)}`] as [string, string]] : []),
    ['Agrupado por', UNIDAD.charAt(0).toUpperCase() + UNIDAD.slice(1)],
  ], ahora)

  // ---------------------------------------------------------------- 01 resumen: indicadores en dos filas de tres
  inf.tituloSeccion('Resumen ejecutivo', r.anterior ? 'Variación frente al periodo anterior' : undefined)
  const variacion = (ahora: number | null, antes: number | null | undefined): { texto: string; color: Color } => {
    const c = ahora === null || antes === null ? null : cambio(ahora, antes)
    if (c === null) return { texto: a ? 'Sin base de comparación' : 'Sin periodo anterior', color: TENUE }
    return { texto: `${c >= 0 ? '+' : '-'}${n2(Math.abs(c), 1)}% vs. anterior`, color: c >= 0 ? POSITIVO : NEGATIVO }
  }
  const indicadores: { titulo: string; valor: string; pie: { texto: string; color: Color } }[] = [
    { titulo: 'Ingresos', valor: din(x.ingreso), pie: variacion(x.ingreso, a?.ingreso) },
    { titulo: 'Utilidad neta', valor: din(x.utilidad), pie: { texto: x.margenPct === null ? 'Sin ventas en el periodo' : `Margen ${pct(x.margenPct)}`, color: x.utilidad < 0 ? NEGATIVO : TENUE } },
    { titulo: varias ? 'Entregado' : `${tituloCant} entregados`, valor: cant(x.porUnidad, x.litros), pie: varias ? { texto: 'Por unidad', color: TENUE } : variacion(x.litros, a?.litros) },
    { titulo: 'Pedidos entregados', valor: ent(x.pedidos), pie: variacion(x.pedidos, a?.pedidos) },
    { titulo: 'Clientes atendidos', valor: ent(x.clientes), pie: variacion(x.clientes, a?.clientes) },
    { titulo: 'Ticket promedio', valor: din(x.ticketPromedio), pie: variacion(x.ticketPromedio, a?.ticketPromedio) },
  ]
  const col = inf.util / 3
  pdf.rect(M, inf.y - 2, inf.util, 46, { relleno: FONDO })
  indicadores.forEach((t, i) => {
    const tx = M + (i % 3) * col + 5
    const ty = inf.y + Math.floor(i / 3) * 22
    if (i % 3) pdf.linea(M + (i % 3) * col, ty + 1, M + (i % 3) * col, ty + 17, { color: REGLA, grosor: 0.2 })
    pdf.texto(t.titulo.toUpperCase(), tx, ty + 4.5, { fuente: 'negrita', tam: 6.5, color: TENUE })
    // Con varias unidades («73,179 L + 5,301.5 kg + 48,058 pz») el valor no cabe a 15 pt: se achica hasta su casilla.
    const tam = Math.max(8, Math.min(15, (15 * (col - 10)) / anchoTexto(t.valor, 'negrita', 15)))
    pdf.texto(t.valor, tx, ty + 12, { fuente: 'negrita', tam, color: TINTA })
    pdf.texto(t.pie.texto, tx, ty + 17, { tam: 7, color: t.pie.color })
  })
  pdf.linea(M + 4, inf.y + 20.5, M + inf.util - 4, inf.y + 20.5, { color: REGLA, grosor: 0.2 })
  inf.y += 50
  const credito = x.credito ?? 0
  const cobrado = x.efectivo + x.transferencia + credito
  if (cobrado > 0) {
    const parte = (n: number) => `${din(n)} (${n2((n / cobrado) * 100, 0)}%)`
    inf.nota(`Forma de cobro: efectivo ${parte(x.efectivo)}, transferencia ${parte(x.transferencia)}${credito > 0 ? ` y fiado ${parte(credito)}` : ''}.`)
  }

  // ---------------------------------------------------------------- 02 evolución de ingresos
  if (r.periodos.length > 1 && x.ingreso > 0) {
    const alto = 48
    inf.asegurar(12 + alto + 12)
    inf.tituloSeccion(`Evolución de ingresos por ${UNIDAD}`)
    const ejeX = M + 14
    const anchoG = inf.util - 14
    // Escala con números redondos: cada línea vale 1, 2, 2.5 o 5 por una potencia de 10.
    const mayor = Math.max(...r.periodos.map((p) => p.ingreso), 1)
    const base = 10 ** Math.floor(Math.log10(mayor / 4))
    const max = 4 * base * ([1, 2, 2.5, 5, 10].find((m) => 4 * base * m >= mayor) ?? 10)
    for (let k = 0; k <= 4; k++) {
      const gy = inf.y + alto - (alto * k) / 4
      pdf.linea(ejeX, gy, inf.ancho - M, gy, { color: k ? FINA : TINTA, grosor: k ? 0.15 : 0.35 })
      pdf.texto(dinCorto((max * k) / 4), ejeX - 2, gy + 1, { tam: 6.5, color: TENUE, alinear: 'der' })
    }
    const hueco = anchoG / r.periodos.length
    const barra = Math.min(11, hueco * 0.62)
    const cadaCuanto = Math.ceil(r.periodos.length / 16) // etiquetas del eje que caben sin encimarse
    r.periodos.forEach((p, i) => {
      const bx = ejeX + i * hueco + (hueco - barra) / 2
      const h = (p.ingreso / max) * alto
      if (h > 0) pdf.rect(bx, inf.y + alto - h, barra, h, { relleno: acento() })
      if (r.periodos.length <= 12 && p.ingreso > 0) pdf.texto(dinCorto(p.ingreso), bx + barra / 2, inf.y + alto - h - 1.4, { tam: 6.5, color: SECUNDARIO, alinear: 'centro' })
      if (i % cadaCuanto === 0) pdf.texto(textoPeriodo(p, r.agrupar, false), bx + barra / 2, inf.y + alto + 4, { tam: 6.5, color: TENUE, alinear: 'centro' })
    })
    inf.y += alto + 14
  }

  // ---------------------------------------------------------------- tablas
  const signo = (u: number) => (u < 0 ? NEGATIVO : undefined)
  const nota = (s: SaborVendido) => (s.id === r.ranking.estrella ? 'Mayor venta' : s.id === r.ranking.menorRotacion ? 'Menor rotación' : s.sinCosto ? 'Sin costo capturado' : '')
  inf.tituloSeccion('Rentabilidad por sabor', varias ? 'Ordenado de mayor a menor ingreso' : 'Ordenado de mayor a menor volumen')
  inf.tabla<SaborVendido>([
    { titulo: 'Sabor', ancho: 0.18, valor: (s) => s.sabor, muestra: (s) => hex(s.color) },
    { titulo: tituloCant, ancho: 0.1, der: true, valor: (s) => lit(s.litros, s.unidad) },
    { titulo: 'Part.', ancho: 0.08, der: true, valor: (s) => (!varias && x.litros ? `${n2((s.litros / x.litros) * 100, 1)}%` : '-') },
    { titulo: 'Ingresos', ancho: 0.13, der: true, valor: (s) => din(s.ingreso) },
    { titulo: 'Costo', ancho: 0.13, der: true, valor: (s) => din(s.costo) },
    { titulo: 'Utilidad', ancho: 0.13, der: true, valor: (s) => din(s.utilidad), color: (s) => signo(s.utilidad) },
    { titulo: 'Margen', ancho: 0.09, der: true, valor: (s) => pct(s.margenPct) },
    { titulo: 'Observación', ancho: 0.16, valor: nota, color: (s) => (s.sinCosto ? NEGATIVO : TENUE) },
  ], r.sabores, ['Total', varias ? '' : lit(x.litros, unidades[0]), !varias && x.litros ? '100.0%' : '-', din(x.ingreso), din(x.costo), din(x.utilidad), pct(x.margenPct), ''])

  inf.tituloSeccion('Desempeño por vendedor', 'Ordenado por ingresos')
  inf.tabla<VendedorRendimiento>([
    { titulo: 'Vendedor', ancho: 0.22, valor: (v) => v.nombre, detalle: (v) => (v.activo || v.id === null ? null : 'Cuenta dada de baja') },
    { titulo: 'Pedidos', ancho: 0.09, der: true, valor: (v) => ent(v.pedidos) },
    { titulo: 'Clientes', ancho: 0.09, der: true, valor: (v) => ent(v.clientes) },
    ...columnasCantidad<VendedorRendimiento>(unidades, 0.1, (v) => v.porUnidad, (v) => v.litros),
    { titulo: 'Ingresos', ancho: 0.14, der: true, valor: (v) => din(v.ingreso) },
    { titulo: 'Utilidad', ancho: 0.13, der: true, valor: (v) => din(v.utilidad), color: (v) => signo(v.utilidad) },
    { titulo: 'Ticket prom.', ancho: 0.12, der: true, valor: (v) => din(v.ticketPromedio) },
    { titulo: 'Sin venta', ancho: 0.11, der: true, valor: (v) => ent(v.omitidos) },
  ], r.vendedores, ['Total', ent(x.pedidos), ent(x.clientes), ...total(x.porUnidad, x.litros), din(x.ingreso), din(x.utilidad), din(x.ticketPromedio), ent(r.vendedores.reduce((s, v) => s + v.omitidos, 0))])

  const nombrePeriodo = (p: Periodo) => (r.agrupar === 'semana' ? (p.inicio === p.fin ? fechaMx(p.inicio) : `${fechaMx(p.inicio)} al ${fechaMx(p.fin)}`) : textoPeriodo(p, r.agrupar, true))
  inf.tituloSeccion(`Detalle por ${UNIDAD}`)
  inf.tabla<Periodo>([
    { titulo: UNIDAD.charAt(0).toUpperCase() + UNIDAD.slice(1), ancho: 0.26, valor: nombrePeriodo },
    { titulo: 'Pedidos', ancho: 0.1, der: true, valor: (p) => ent(p.pedidos) },
    ...columnasCantidad<Periodo>(unidades, 0.11, (p) => p.porUnidad, (p) => p.litros),
    { titulo: 'Ingresos', ancho: 0.14, der: true, valor: (p) => din(p.ingreso) },
    { titulo: 'Costos', ancho: 0.14, der: true, valor: (p) => din(p.costo) },
    { titulo: 'Utilidad', ancho: 0.14, der: true, valor: (p) => din(p.utilidad), color: (p) => signo(p.utilidad) },
    { titulo: 'Margen', ancho: 0.11, der: true, valor: (p) => pct(p.ingreso > 0 ? Math.round((p.utilidad / p.ingreso) * 1000) / 10 : null) },
  ], r.periodos, ['Total', ent(x.pedidos), ...total(x.porUnidad, x.litros), din(x.ingreso), din(x.costo), din(x.utilidad), pct(x.margenPct)])

  inf.nota('Notas: se consideran los pedidos entregados, por su fecha de entrega, con el precio y el costo vigentes al momento de la venta. '
    + '"Sin venta" son visitas registradas en las que el cliente no compró.')
  return inf.listo()
}

// ---------------------------------------------------------------------------------------------- informe mensual

// Ventas y utilidad del mes, cobranza y comisión por vendedor y las diferencias de los cortes. Si el mes está cerrado
// son las cifras congeladas al cerrarlo (api/_lib/cortes.ts).
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
export function informeMensualPdf(i: InformeMes, ahora = new Date()): PdfListo {
  const c = i.cifras
  const [anio, mesNum] = i.mes.split('-').map(Number)
  const nombreMes = `${MESES[mesNum - 1]} de ${anio}`
  const inf = new Informe('Informe mensual', i.mes)
  const { pdf } = inf
  const estado = i.estado === 'cerrado' ? `Cerrado el ${fechaMx((i.cerradoEn ?? '').slice(0, 10))}` : i.estado === 'reabierto' ? 'Reabierto: cifras al momento de generarlo' : 'Abierto: cifras al momento de generarlo'
  inf.portada(`Resultados de ${nombreMes}`, [['Mes', nombreMes], ['Estado', estado]], ahora)

  inf.tituloSeccion('Resumen del mes', i.estado === 'cerrado' ? 'Cifras congeladas al cierre' : undefined)
  const unidades = Object.entries(c.ventas.porUnidad).map(([u, n]) => lit(n, u)).join(' + ') || '0'
  const indicadores: { titulo: string; valor: string; pie: { texto: string; color: Color } }[] = [
    { titulo: 'Ventas', valor: din(c.ventas.ingreso), pie: { texto: `${ent(c.ventas.pedidos)} pedidos · ${ent(c.ventas.clientes)} clientes`, color: TENUE } },
    { titulo: 'Utilidad neta', valor: din(c.ventas.utilidad), pie: { texto: c.ventas.margenPct === null ? 'Sin ventas en el mes' : `Margen ${pct(c.ventas.margenPct)}`, color: c.ventas.utilidad < 0 ? NEGATIVO : TENUE } },
    { titulo: 'Entregado', valor: unidades, pie: { texto: 'Por unidad', color: TENUE } },
    { titulo: 'Cobrado (efectivo y transf.)', valor: din(c.cobro.efectivo + c.cobro.transferencia), pie: { texto: `Efectivo ${dinCorto(c.cobro.efectivo)} · Transf. ${dinCorto(c.cobro.transferencia)}`, color: TENUE } },
    { titulo: 'Vendido a crédito', valor: din(c.cobro.credito), pie: { texto: `Abonos recibidos ${din(c.abonos.total)}`, color: TENUE } },
    { titulo: 'Por cobrar al cierre', valor: din(c.porCobrar.saldo), pie: { texto: `${ent(c.porCobrar.clientes)} ${c.porCobrar.clientes === 1 ? 'cliente' : 'clientes'} con saldo`, color: c.porCobrar.saldo > 0 ? NEGATIVO : TENUE } },
  ]
  const col = inf.util / 3
  pdf.rect(M, inf.y - 2, inf.util, 46, { relleno: FONDO })
  indicadores.forEach((t, k) => {
    const tx = M + (k % 3) * col + 5
    const ty = inf.y + Math.floor(k / 3) * 22
    if (k % 3) pdf.linea(M + (k % 3) * col, ty + 1, M + (k % 3) * col, ty + 17, { color: REGLA, grosor: 0.2 })
    pdf.texto(t.titulo.toUpperCase(), tx, ty + 4.5, { fuente: 'negrita', tam: 6.5, color: TENUE })
    const tam = Math.max(8, Math.min(15, (15 * (col - 10)) / anchoTexto(t.valor, 'negrita', 15)))
    pdf.texto(t.valor, tx, ty + 12, { fuente: 'negrita', tam, color: TINTA })
    pdf.texto(ajustarTexto(t.pie.texto, 'normal', 7, col - 8, 1)[0] ?? '', tx, ty + 17, { tam: 7, color: t.pie.color })
  })
  pdf.linea(M + 4, inf.y + 20.5, M + inf.util - 4, inf.y + 20.5, { color: REGLA, grosor: 0.2 })
  inf.y += 50
  if (c.envases.prestados > 0) inf.nota(`Envases retornables prestados al cierre: ${ent(c.envases.prestados)} en ${ent(c.envases.clientes)} ${c.envases.clientes === 1 ? 'cliente' : 'clientes'}.`)

  inf.tituloSeccion('Cobranza y comisión por vendedor', 'Ordenado por ventas')
  const suma = (k: 'ventas' | 'utilidad' | 'efectivo' | 'transferencia' | 'credito' | 'abonos' | 'comision') => din(c.vendedores.reduce((s, v) => s + v[k], 0))
  inf.tabla<CifrasMes_Vendedor>([
    { titulo: 'Vendedor', ancho: 0.19, valor: (v) => v.nombre, detalle: (v) => (v.activo ? null : 'Cuenta dada de baja') },
    { titulo: 'Ventas', ancho: 0.11, der: true, valor: (v) => din(v.ventas) },
    { titulo: 'Utilidad', ancho: 0.11, der: true, valor: (v) => din(v.utilidad), color: (v) => (v.utilidad < 0 ? NEGATIVO : undefined) },
    { titulo: 'Efectivo', ancho: 0.1, der: true, valor: (v) => din(v.efectivo) },
    { titulo: 'Transf.', ancho: 0.1, der: true, valor: (v) => din(v.transferencia) },
    { titulo: 'Fiado', ancho: 0.09, der: true, valor: (v) => din(v.credito) },
    { titulo: 'Abonos', ancho: 0.09, der: true, valor: (v) => din(v.abonos) },
    { titulo: 'Meta', ancho: 0.1, der: true, valor: (v) => (v.cumplimientoPct === null ? '-' : `${n2(v.cumplimientoPct, 0)}%`), detalle: (v) => (v.meta === null ? null : `de ${dinCorto(v.meta)}`) },
    { titulo: 'Comisión', ancho: 0.11, der: true, valor: (v) => din(v.comision), detalle: (v) => (v.comisionPct ? `${n2(v.comisionPct, 1)}%` : null) },
  ], c.vendedores, ['Total', suma('ventas'), suma('utilidad'), suma('efectivo'), suma('transferencia'), suma('credito'), suma('abonos'), '', suma('comision')])

  inf.tituloSeccion('Diferencias de los cortes', `${ent(c.cortes.dias)} ${c.cortes.dias === 1 ? 'corte' : 'cortes'} · diferencia total ${din(c.cortes.diferencia)}`)
  inf.tabla<CifrasMes_Corte>([
    { titulo: 'Fecha', ancho: 0.14, valor: (k) => fechaMx(k.fecha) },
    { titulo: 'Vendedor', ancho: 0.3, valor: (k) => k.vendedor },
    { titulo: 'Esperado', ancho: 0.15, der: true, valor: (k) => din(k.esperado) },
    { titulo: 'Entregado', ancho: 0.15, der: true, valor: (k) => din(k.entregado) },
    { titulo: 'Diferencia', ancho: 0.14, der: true, valor: (k) => din(k.diferencia), color: (k) => (k.diferencia < 0 ? NEGATIVO : k.diferencia > 0 ? POSITIVO : undefined) },
    { titulo: 'Estado', ancho: 0.12, valor: (k) => (k.estado === 'confirmado' ? 'Confirmado' : 'Pendiente') },
  ], c.cortes.detalle, c.cortes.detalle.length ? ['Total', '', din(c.cortes.detalle.reduce((s, k) => s + k.esperado, 0)), din(c.cortes.detalle.reduce((s, k) => s + k.entregado, 0)), din(c.cortes.diferencia), ''] : undefined)
  if (c.cortes.sinCorte > 0) inf.nota(`${ent(c.cortes.sinCorte)} ${c.cortes.sinCorte === 1 ? 'día con cobro en efectivo no tiene' : 'días con cobro en efectivo no tienen'} corte.`)
  inf.nota('Notas: se consideran los pedidos entregados por su fecha de entrega. La comisión es el porcentaje de cada vendedor sobre lo vendido en el mes. '
    + '"Por cobrar" es lo vendido a crédito menos los abonos, al último día del mes. Una diferencia negativa es efectivo que faltó.')
  return inf.listo()
}
type CifrasMes_Vendedor = InformeMes['cifras']['vendedores'][number]
type CifrasMes_Corte = InformeMes['cifras']['cortes']['detalle'][number]

// ---------------------------------------------------------------------------------------------- libreta de clientes

export interface ClienteLibreta {
  nombre: string
  telefono: string | null
  direccion: string
  colonia: string | null
  referencias: string | null
  vendedor: string
  visita: string
  horario: 'Mañana' | 'Tarde'
  alta: string
  ubicacion: string | null
  pedidos: number
  litros: number
  porUnidad?: Record<string, number> // catálogo flexible: { L: 60, kg: 10 }
  comprado: number
  ultimaCompra: string | null
  proximaEntrega: string | null
  saborFavorito: string | null
}

// Directorio de la cartera activa, una sección por vendedor (vienen ordenados por vendedor y nombre).
export function libretaPdf(clientes: ClienteLibreta[], ahora = new Date()): PdfListo {
  const hoy = `${dos(ahora.getDate())}/${dos(ahora.getMonth() + 1)}/${ahora.getFullYear()}`
  const inf = new Informe('Libreta de clientes', `al ${hoy}`, true)
  const grupos = new Map<string, ClienteLibreta[]>()
  for (const c of clientes) grupos.set(c.vendedor, [...(grupos.get(c.vendedor) ?? []), c])
  const suma = (cs: ClienteLibreta[], k: 'pedidos' | 'litros' | 'comprado') => cs.reduce((s, c) => s + c[k], 0)
  // Lo comprado por unidad ({ L: 60, kg: 10 }); sin desglose (servidor anterior), los litros de siempre.
  const porUnidad = (cs: ClienteLibreta[]) => {
    const pu: Record<string, number> = {}
    for (const c of cs) for (const [u, n] of Object.entries(c.porUnidad ?? {})) pu[u] = (pu[u] ?? 0) + n
    return pu
  }
  // L primero; una empresa que sólo vende en kilos dice «Kilos» y «0 kg», no litros.
  const unidades = [...new Set(clientes.flatMap((c) => Object.keys(c.porUnidad ?? {})))].sort((a, b) => (a === 'L' ? -1 : b === 'L' ? 1 : a.localeCompare(b)))

  inf.portada('Directorio de la cartera activa', [
    ['Clientes activos', ent(clientes.length)],
    ['Vendedores', ent([...grupos.keys()].filter((v) => v !== 'Sin vendedor').length)],
    ['Compras acumuladas', din(suma(clientes, 'comprado'))],
  ], ahora)

  inf.tituloSeccion('Resumen por vendedor')
  inf.tabla<[string, ClienteLibreta[]]>([
    { titulo: 'Vendedor', ancho: 0.34, valor: ([v]) => v },
    { titulo: 'Clientes', ancho: 0.13, der: true, valor: ([, cs]) => ent(cs.length) },
    { titulo: 'Mañana / tarde', ancho: 0.13, der: true, valor: ([, cs]) => `${ent(cs.filter((c) => c.horario === 'Mañana').length)} / ${ent(cs.filter((c) => c.horario === 'Tarde').length)}` },
    { titulo: 'Pedidos', ancho: 0.12, der: true, valor: ([, cs]) => ent(suma(cs, 'pedidos')) },
    ...columnasCantidad<[string, ClienteLibreta[]]>(unidades, 0.13, ([, cs]) => porUnidad(cs), ([, cs]) => suma(cs, 'litros')),
    { titulo: 'Compras', ancho: 0.15, der: true, valor: ([, cs]) => din(suma(cs, 'comprado')) },
  ], [...grupos], ['Total', ent(clientes.length), `${ent(clientes.filter((c) => c.horario === 'Mañana').length)} / ${ent(clientes.filter((c) => c.horario === 'Tarde').length)}`, ent(suma(clientes, 'pedidos')), ...totalCantidad(unidades, porUnidad(clientes), suma(clientes, 'litros')), din(suma(clientes, 'comprado'))])

  inf.tituloSeccion('Directorio de clientes', 'Historial: pedidos entregados desde el alta')
  for (const [vendedor, cs] of grupos) {
    inf.subtitulo(vendedor, `${ent(cs.length)} ${cs.length === 1 ? 'cliente' : 'clientes'}`)
    inf.tabla<ClienteLibreta>([
      { titulo: 'Cliente', ancho: 0.17, negrita: true, valor: (c) => c.nombre, detalle: (c) => `Desde ${fechaMx(c.alta)}` },
      { titulo: 'Teléfono', ancho: 0.1, valor: (c) => c.telefono ?? '-' },
      { titulo: 'Dirección', ancho: 0.19, valor: (c) => c.direccion, detalle: (c) => [c.colonia, c.referencias].filter(Boolean).join(' · ') },
      { titulo: 'Visita', ancho: 0.11, valor: (c) => c.visita, detalle: (c) => c.horario },
      { titulo: 'Última compra', ancho: 0.11, der: true, valor: (c) => fechaMx(c.ultimaCompra), detalle: (c) => (c.proximaEntrega ? `Próx. ${fechaMx(c.proximaEntrega)}` : null) },
      { titulo: 'Pedidos', ancho: 0.06, der: true, valor: (c) => ent(c.pedidos) },
      ...columnasCantidad<ClienteLibreta>(unidades, 0.07, (c) => c.porUnidad, (c) => c.litros),
      { titulo: 'Compras', ancho: 0.09, der: true, valor: (c) => din(c.comprado) },
      { titulo: 'Favorito', ancho: 0.1, valor: (c) => c.saborFavorito ?? '-' },
    ], cs, ['Subtotal', '', '', '', '', ent(suma(cs, 'pedidos')), ...totalCantidad(unidades, porUnidad(cs), suma(cs, 'litros')), din(suma(cs, 'comprado')), ''])
  }
  if (!clientes.length) inf.nota('No hay clientes activos.')
  return inf.listo()
}
