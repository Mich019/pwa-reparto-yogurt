import { ajustarTexto, anchoTexto, Documento, type Bytes, type Color, type Fuente } from './pdf'
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
const ACENTO: Color = [3 / 255, 93 / 255, 56 / 255] // --color-marca
const POSITIVO: Color = [0.016, 0.471, 0.341] // #047857
const NEGATIVO: Color = [0.725, 0.11, 0.11] // #B91C1C

const n2 = (n: number, dec: number) => n.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec })
const din = (n: number | null) => (n === null ? '-' : `${n < 0 ? '-' : ''}$${n2(Math.abs(n), 2)}`)
const dinCorto = (n: number) => `$${n >= 1000 ? `${n2(n / 1000, n >= 10_000 ? 0 : 1)}k` : n2(n, 0)}`
const lit = (n: number) => `${n2(n, 1)} L`
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

  // Primera página: nombre del documento a la izquierda y sus datos (periodo, fecha…) a la derecha.
  portada(subtitulo: string, datos: [string, string][], ahora: Date) {
    const { pdf } = this
    pdf.pagina(this.ancho, this.alto)
    pdf.rect(0, 0, this.ancho, 2.2, { relleno: ACENTO })
    pdf.texto('REPARTO YOGURT', M, 15, { fuente: 'negrita', tam: 8, color: ACENTO })
    pdf.texto(this.titulo, M, 26, { fuente: 'negrita', tam: 22, color: TINTA })
    pdf.texto(subtitulo, M, 33, { tam: 10.5, color: SECUNDARIO })
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
    pdf.rect(0, 0, this.ancho, 1.2, { relleno: ACENTO })
    pdf.texto('REPARTO YOGURT', M, 11, { fuente: 'negrita', tam: 7, color: ACENTO })
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
    pdf.texto(dos(this.seccion), M, this.y + 4, { fuente: 'negrita', tam: 10, color: ACENTO })
    pdf.texto(texto, M + 8, this.y + 4, { fuente: 'negrita', tam: 10.5, color: TINTA })
    if (nota) pdf.texto(nota, this.ancho - M, this.y + 4, { tam: 7.5, color: TENUE, alinear: 'der' })
    pdf.linea(M, this.y + 6.8, this.ancho - M, this.y + 6.8, { color: REGLA, grosor: 0.2 })
    this.y += 12
  }

  subtitulo(texto: string, nota?: string) {
    this.asegurar(22)
    this.pdf.texto(texto, M, this.y + 3, { fuente: 'negrita', tam: 9, color: SECUNDARIO })
    if (nota) this.pdf.texto(nota, this.ancho - M, this.y + 3, { tam: 7.5, color: TENUE, alinear: 'der' })
    this.y += 6
  }

  celda(texto: string, x: number, ancho: number, base: number, o: { fuente?: Fuente; tam?: number; color?: Color; der?: boolean }) {
    const tam = o.tam ?? 8.3
    const [t = ''] = ajustarTexto(texto, o.fuente ?? 'normal', tam, ancho - 3.5, 1)
    this.pdf.texto(t, o.der ? x + ancho - 1.75 : x + 1.75, base, { fuente: o.fuente, tam, color: o.color ?? TINTA, alinear: o.der ? 'der' : 'izq' })
  }

  tabla<T>(columnas: Columna<T>[], filas: T[], total?: string[]) {
    const { pdf } = this
    const xs = columnas.reduce<number[]>((a, c) => [...a, a[a.length - 1] + c.ancho * this.util], [M])
    const doble = columnas.some((c) => c.detalle)
    const alto = doble ? 9.6 : RENGLON
    const encabezado = () => {
      columnas.forEach((c, i) => this.celda(c.titulo.toUpperCase(), xs[i], c.ancho * this.util, this.y + 4, { fuente: 'negrita', tam: 6.5, color: TENUE, der: c.der }))
      this.y += 6
      pdf.linea(M, this.y, this.ancho - M, this.y, { color: TINTA, grosor: 0.35 })
    }
    this.asegurar(6 + alto * Math.min(3, Math.max(1, filas.length)))
    encabezado()
    if (!filas.length) {
      pdf.texto('Sin registros.', M + 1.75, this.y + 4.6, { tam: 8.3, color: TENUE })
      this.y += RENGLON + 8
      return
    }
    filas.forEach((f) => {
      if (this.y + alto > this.limite) { this.nuevaPagina(); encabezado() }
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

  nota(texto: string) {
    this.asegurar(8)
    for (const r of ajustarTexto(texto, 'normal', 7.5, this.util, 3)) {
      this.pdf.texto(r, M, this.y, { tam: 7.5, color: TENUE })
      this.y += 3.8
    }
    this.y += 4
  }

  bytes(): Bytes {
    this.pdf.enCadaPagina((n, total) => {
      this.pdf.linea(M, this.alto - 13, this.ancho - M, this.alto - 13, { color: REGLA, grosor: 0.2 })
      this.pdf.texto('Reparto Yogurt · Documento interno y confidencial', M, this.alto - 8.5, { tam: 7, color: TENUE })
      this.pdf.texto(`Página ${n} de ${total}`, this.ancho - M, this.alto - 8.5, { tam: 7, color: TENUE, alinear: 'der' })
    })
    return this.pdf.bytes()
  }
}

// ---------------------------------------------------------------------------------------------- reporte de ventas

export function reportePdf(r: Reporte, ahora = new Date()): Bytes {
  const periodo = `${fechaMx(r.desde)} al ${fechaMx(r.hasta)}`
  const inf = new Informe('Reporte de ventas', periodo)
  const { pdf } = inf
  const x = r.resumen
  const a = r.anterior?.resumen
  const UNIDAD = { dia: 'día', semana: 'semana', mes: 'mes' }[r.agrupar]

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
    { titulo: 'Litros entregados', valor: lit(x.litros), pie: variacion(x.litros, a?.litros) },
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
    pdf.texto(t.valor, tx, ty + 12, { fuente: 'negrita', tam: 15, color: TINTA })
    pdf.texto(t.pie.texto, tx, ty + 17, { tam: 7, color: t.pie.color })
  })
  pdf.linea(M + 4, inf.y + 20.5, M + inf.util - 4, inf.y + 20.5, { color: REGLA, grosor: 0.2 })
  inf.y += 50
  const cobrado = x.efectivo + x.transferencia
  if (cobrado > 0) {
    const parte = (n: number) => `${din(n)} (${n2((n / cobrado) * 100, 0)}%)`
    inf.nota(`Forma de cobro: efectivo ${parte(x.efectivo)} y transferencia ${parte(x.transferencia)}.`)
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
      if (h > 0) pdf.rect(bx, inf.y + alto - h, barra, h, { relleno: ACENTO })
      if (r.periodos.length <= 12 && p.ingreso > 0) pdf.texto(dinCorto(p.ingreso), bx + barra / 2, inf.y + alto - h - 1.4, { tam: 6.5, color: SECUNDARIO, alinear: 'centro' })
      if (i % cadaCuanto === 0) pdf.texto(textoPeriodo(p, r.agrupar, false), bx + barra / 2, inf.y + alto + 4, { tam: 6.5, color: TENUE, alinear: 'centro' })
    })
    inf.y += alto + 14
  }

  // ---------------------------------------------------------------- tablas
  const signo = (u: number) => (u < 0 ? NEGATIVO : undefined)
  const nota = (s: SaborVendido) => (s.id === r.ranking.estrella ? 'Mayor venta' : s.id === r.ranking.menorRotacion ? 'Menor rotación' : s.sinCosto ? 'Sin costo capturado' : '')
  inf.tituloSeccion('Rentabilidad por sabor', 'Ordenado de mayor a menor volumen')
  inf.tabla<SaborVendido>([
    { titulo: 'Sabor', ancho: 0.18, valor: (s) => s.sabor, muestra: (s) => hex(s.color) },
    { titulo: 'Litros', ancho: 0.1, der: true, valor: (s) => lit(s.litros) },
    { titulo: 'Part.', ancho: 0.08, der: true, valor: (s) => (x.litros ? `${n2((s.litros / x.litros) * 100, 1)}%` : '-') },
    { titulo: 'Ingresos', ancho: 0.13, der: true, valor: (s) => din(s.ingreso) },
    { titulo: 'Costo', ancho: 0.13, der: true, valor: (s) => din(s.costo) },
    { titulo: 'Utilidad', ancho: 0.13, der: true, valor: (s) => din(s.utilidad), color: (s) => signo(s.utilidad) },
    { titulo: 'Margen', ancho: 0.09, der: true, valor: (s) => pct(s.margenPct) },
    { titulo: 'Observación', ancho: 0.16, valor: nota, color: (s) => (s.sinCosto ? NEGATIVO : TENUE) },
  ], r.sabores, ['Total', lit(x.litros), x.litros ? '100.0%' : '-', din(x.ingreso), din(x.costo), din(x.utilidad), pct(x.margenPct), ''])

  inf.tituloSeccion('Desempeño por vendedor', 'Ordenado por ingresos')
  inf.tabla<VendedorRendimiento>([
    { titulo: 'Vendedor', ancho: 0.22, valor: (v) => v.nombre, detalle: (v) => (v.activo || v.id === null ? null : 'Cuenta dada de baja') },
    { titulo: 'Pedidos', ancho: 0.09, der: true, valor: (v) => ent(v.pedidos) },
    { titulo: 'Clientes', ancho: 0.09, der: true, valor: (v) => ent(v.clientes) },
    { titulo: 'Litros', ancho: 0.1, der: true, valor: (v) => lit(v.litros) },
    { titulo: 'Ingresos', ancho: 0.14, der: true, valor: (v) => din(v.ingreso) },
    { titulo: 'Utilidad', ancho: 0.13, der: true, valor: (v) => din(v.utilidad), color: (v) => signo(v.utilidad) },
    { titulo: 'Ticket prom.', ancho: 0.12, der: true, valor: (v) => din(v.ticketPromedio) },
    { titulo: 'Sin venta', ancho: 0.11, der: true, valor: (v) => ent(v.omitidos) },
  ], r.vendedores, ['Total', ent(x.pedidos), ent(x.clientes), lit(x.litros), din(x.ingreso), din(x.utilidad), din(x.ticketPromedio), ent(r.vendedores.reduce((s, v) => s + v.omitidos, 0))])

  const nombrePeriodo = (p: Periodo) => (r.agrupar === 'semana' ? (p.inicio === p.fin ? fechaMx(p.inicio) : `${fechaMx(p.inicio)} al ${fechaMx(p.fin)}`) : textoPeriodo(p, r.agrupar, true))
  inf.tituloSeccion(`Detalle por ${UNIDAD}`)
  inf.tabla<Periodo>([
    { titulo: UNIDAD.charAt(0).toUpperCase() + UNIDAD.slice(1), ancho: 0.26, valor: nombrePeriodo },
    { titulo: 'Pedidos', ancho: 0.1, der: true, valor: (p) => ent(p.pedidos) },
    { titulo: 'Litros', ancho: 0.11, der: true, valor: (p) => lit(p.litros) },
    { titulo: 'Ingresos', ancho: 0.14, der: true, valor: (p) => din(p.ingreso) },
    { titulo: 'Costos', ancho: 0.14, der: true, valor: (p) => din(p.costo) },
    { titulo: 'Utilidad', ancho: 0.14, der: true, valor: (p) => din(p.utilidad), color: (p) => signo(p.utilidad) },
    { titulo: 'Margen', ancho: 0.11, der: true, valor: (p) => pct(p.ingreso > 0 ? Math.round((p.utilidad / p.ingreso) * 1000) / 10 : null) },
  ], r.periodos, ['Total', ent(x.pedidos), lit(x.litros), din(x.ingreso), din(x.costo), din(x.utilidad), pct(x.margenPct)])

  inf.nota('Notas: se consideran los pedidos entregados, por su fecha de entrega, con el precio y el costo vigentes al momento de la venta. '
    + '"Sin venta" son visitas registradas en las que el cliente no compró.')
  return inf.bytes()
}

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
  comprado: number
  ultimaCompra: string | null
  proximaEntrega: string | null
  saborFavorito: string | null
}

// Directorio de la cartera activa, una sección por vendedor (vienen ordenados por vendedor y nombre).
export function libretaPdf(clientes: ClienteLibreta[], ahora = new Date()): Bytes {
  const hoy = `${dos(ahora.getDate())}/${dos(ahora.getMonth() + 1)}/${ahora.getFullYear()}`
  const inf = new Informe('Libreta de clientes', `al ${hoy}`, true)
  const grupos = new Map<string, ClienteLibreta[]>()
  for (const c of clientes) grupos.set(c.vendedor, [...(grupos.get(c.vendedor) ?? []), c])
  const suma = (cs: ClienteLibreta[], k: 'pedidos' | 'litros' | 'comprado') => cs.reduce((s, c) => s + c[k], 0)

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
    { titulo: 'Litros', ancho: 0.13, der: true, valor: ([, cs]) => lit(suma(cs, 'litros')) },
    { titulo: 'Compras', ancho: 0.15, der: true, valor: ([, cs]) => din(suma(cs, 'comprado')) },
  ], [...grupos], ['Total', ent(clientes.length), `${ent(clientes.filter((c) => c.horario === 'Mañana').length)} / ${ent(clientes.filter((c) => c.horario === 'Tarde').length)}`, ent(suma(clientes, 'pedidos')), lit(suma(clientes, 'litros')), din(suma(clientes, 'comprado'))])

  inf.tituloSeccion('Directorio de clientes', 'Historial: pedidos entregados desde el alta')
  for (const [vendedor, cs] of grupos) {
    inf.subtitulo(vendedor, `${ent(cs.length)} ${cs.length === 1 ? 'cliente' : 'clientes'}`)
    inf.tabla<ClienteLibreta>([
      { titulo: 'Cliente', ancho: 0.17, negrita: true, valor: (c) => c.nombre, detalle: (c) => `Desde ${fechaMx(c.alta)}` },
      { titulo: 'Teléfono', ancho: 0.09, valor: (c) => c.telefono ?? '-' },
      { titulo: 'Dirección', ancho: 0.2, valor: (c) => c.direccion, detalle: (c) => [c.colonia, c.referencias].filter(Boolean).join(' · ') },
      { titulo: 'Visita', ancho: 0.11, valor: (c) => c.visita, detalle: (c) => c.horario },
      { titulo: 'Última compra', ancho: 0.11, der: true, valor: (c) => fechaMx(c.ultimaCompra), detalle: (c) => (c.proximaEntrega ? `Próx. ${fechaMx(c.proximaEntrega)}` : null) },
      { titulo: 'Pedidos', ancho: 0.06, der: true, valor: (c) => ent(c.pedidos) },
      { titulo: 'Litros', ancho: 0.07, der: true, valor: (c) => lit(c.litros) },
      { titulo: 'Compras', ancho: 0.09, der: true, valor: (c) => din(c.comprado) },
      { titulo: 'Favorito', ancho: 0.1, valor: (c) => c.saborFavorito ?? '-' },
    ], cs, ['Subtotal', '', '', '', '', ent(suma(cs, 'pedidos')), lit(suma(cs, 'litros')), din(suma(cs, 'comprado')), ''])
  }
  if (!clientes.length) inf.nota('No hay clientes activos.')
  return inf.bytes()
}
