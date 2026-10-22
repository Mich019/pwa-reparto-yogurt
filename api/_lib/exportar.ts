import { crc32, deflateRawSync } from 'node:zlib'

// Tablas listas para exportar (RF-048). La misma tabla sale como hoja de Excel o como CSV.
// El .xlsx se arma a mano (un zip con XML), igual que el PDF de la app: sin dependencias nuevas.

export type Tipo = 'texto' | 'fecha' | 'entero' | 'litros' | 'dinero' | 'porcentaje'
// Una celda suelta puede traer su propio tipo (la hoja de resumen mezcla pesos, litros y conteos).
export type Valor = string | number | null | { v: string | number | null; t: Tipo }
export interface Tabla {
  nombre: string // nombre de la hoja (máx. 31 caracteres)
  columnas: { titulo: string; tipo: Tipo; ancho?: number }[]
  filas: Valor[][]
  total?: Valor[] // renglón de totales al pie (sólo en Excel; el CSV lleva únicamente los datos)
}

const desenvolver = (x: Valor, base: Tipo): { v: string | number | null; t: Tipo } =>
  x !== null && typeof x === 'object' ? x : { v: x, t: base }

// ------------------------------------------------------------------ CSV

// Un nombre de cliente que empiece con = + - @ se abriría como fórmula en Excel; se le antepone ' para que sea texto.
const neutralizar = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s)

function celdaCsv(x: Valor, base: Tipo): string {
  const { v } = desenvolver(x, base)
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  const s = neutralizar(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// RFC 4180 con BOM, para que Excel abra bien los acentos.
export function aCsv(t: Tabla): Buffer {
  const lineas = [t.columnas.map((c) => celdaCsv(c.titulo, 'texto')).join(',')]
  for (const f of t.filas) lineas.push(f.map((x, i) => celdaCsv(x, t.columnas[i].tipo)).join(','))
  return Buffer.from('﻿' + lineas.join('\r\n') + '\r\n', 'utf8')
}

// ------------------------------------------------------------------ XLSX

// Cada hoja: título (fila 1), periodo y fecha de generación (fila 2), encabezados (fila 4), datos con renglones
// alternados y, si la tabla lo trae, un renglón de totales. Colores de la marca (--color-marca en src/index.css).
const FILA_ENCABEZADO = 4

// Estilos (índice en cellXfs): 0 vacío · 1 título · 2 subtítulo · 3 encabezado · desde 4, uno por tipo y variante
// (renglón normal, renglón alterno, totales).
const TIPOS: Tipo[] = ['texto', 'fecha', 'entero', 'litros', 'dinero', 'porcentaje']
const FORMATO: Record<Tipo, number> = { texto: 0, fecha: 164, entero: 3, litros: 167, dinero: 165, porcentaje: 166 }
const VARIANTES = [
  { fontId: 0, fillId: 0, borderId: 1 }, // renglón
  { fontId: 0, fillId: 3, borderId: 1 }, // renglón alterno
  { fontId: 4, fillId: 4, borderId: 2 }, // totales
] as const
type Variante = 0 | 1 | 2
const estilo = (t: Tipo, v: Variante) => 4 + v * TIPOS.length + TIPOS.indexOf(t)

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00;[Red]\\-&quot;$&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="0.0&quot;%&quot;;[Red]\\-0.0&quot;%&quot;"/><numFmt numFmtId="167" formatCode="#,##0.0&quot; L&quot;"/></numFmts>
<fonts count="5"><font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF035D38"/><name val="Calibri"/></font><font><sz val="10"/><color rgb="FF6B6B6B"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF035D38"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F7F4"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE1EEE6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFDDE5E0"/></bottom><diagonal/></border><border><left/><right/><top style="medium"><color rgb="FF035D38"/></top><bottom style="thin"><color rgb="FF035D38"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${4 + VARIANTES.length * TIPOS.length}">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
${VARIANTES.flatMap((v) => TIPOS.map((t) => `<xf numFmtId="${FORMATO[t]}" fontId="${v.fontId}" fillId="${v.fillId}" borderId="${v.borderId}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${t === 'texto' ? 'left' : 'right'}" vertical="center" indent="1"/></xf>`)).join('\n')}
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

const escapar = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '') // caracteres que XML no admite
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function letra(i: number) {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

// "2026-10-20" → número de serie de Excel (días desde 1899-12-30).
function serie(fecha: string) {
  const [y, m, d] = fecha.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25_569
}

// Texto "en línea": Excel nunca lo toma por una fórmula, aunque empiece con "=".
const textoXlsx = (ref: string, s: number, texto: string) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escapar(texto)}</t></is></c>`

function celdaXlsx(ref: string, x: Valor, base: Tipo, variante: Variante): string {
  const { v, t } = desenvolver(x, base)
  // Las celdas vacías también llevan estilo, para que el renglón alterno y los totales se vean completos.
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return `<c r="${ref}" s="${estilo(t, variante)}"/>`
  if (typeof v === 'number') return `<c r="${ref}" s="${estilo(t, variante)}"><v>${v}</v></c>`
  if (t === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="${estilo('fecha', variante)}"><v>${serie(v)}</v></c>`
  return textoXlsx(ref, estilo('texto', variante), v)
}

// Lo que ocupa un valor ya con formato ("$1,234.00", "12.5 L"), para el ancho de la columna.
function largo(x: Valor, base: Tipo) {
  const { v, t } = desenvolver(x, base)
  if (typeof v !== 'number') return t === 'fecha' ? 10 : String(v ?? '').length
  const entero = Math.round(Math.abs(v)).toLocaleString('en-US').length
  return entero + (t === 'dinero' ? 5 : t === 'litros' ? 4 : t === 'porcentaje' ? 3 : 0)
}

export interface Encabezado {
  titulo: string // "Reporte de ventas"
  subtitulo: string // periodo y fecha de generación
}

function hojaXml(t: Tabla, e: Encabezado): string {
  const n = t.columnas.length
  const ancho = t.columnas.map((c, i) => {
    const mayor = Math.max(...c.titulo.split(' ').map((p) => p.length), ...[...t.filas.slice(0, 200), ...(t.total ? [t.total] : [])].map((f) => largo(f[i], c.tipo)))
    return `<col min="${i + 1}" max="${i + 1}" width="${c.ancho ?? Math.min(48, Math.max(11, mayor + 5))}" customWidth="1"/>`
  })
  const primera = FILA_ENCABEZADO + 1
  const filas = [
    `<row r="1" ht="26" customHeight="1">${textoXlsx('A1', 1, `${e.titulo} · ${t.nombre}`)}</row>`,
    `<row r="2">${textoXlsx('A2', 2, e.subtitulo)}</row>`,
    `<row r="${FILA_ENCABEZADO}" ht="30" customHeight="1">${t.columnas.map((c, i) => textoXlsx(`${letra(i)}${FILA_ENCABEZADO}`, 3, c.titulo)).join('')}</row>`,
    ...t.filas.map((f, r) => `<row r="${primera + r}" ht="18" customHeight="1">${f.map((x, i) => celdaXlsx(`${letra(i)}${primera + r}`, x, t.columnas[i].tipo, (r % 2) as Variante)).join('')}</row>`),
  ]
  const fin = primera + t.filas.length - 1
  if (t.total && t.filas.length) {
    const total = t.total
    filas.push(`<row r="${fin + 1}" ht="20" customHeight="1">${t.columnas.map((c, i) => celdaXlsx(`${letra(i)}${fin + 1}`, total[i] ?? null, c.tipo, 2)).join('')}</row>`)
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${FILA_ENCABEZADO}" topLeftCell="A${primera}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${ancho.join('')}</cols><sheetData>${filas.join('')}</sheetData>` +
    (t.filas.length ? `<autoFilter ref="A${FILA_ENCABEZADO}:${letra(n - 1)}${fin}"/>` : '') +
    // Al imprimir: horizontal, todas las columnas en el ancho de la hoja y el encabezado repetido en cada página.
    `<printOptions horizontalCentered="1"/><pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `<headerFooter><oddFooter>&amp;L${escapar(e.titulo)}&amp;RPágina &amp;P de &amp;N</oddFooter></headerFooter>` +
    `</worksheet>`
  )
}

// Zip mínimo (método deflate, nombres en UTF-8).
function zip(archivos: { nombre: string; datos: Buffer }[]): Buffer {
  const ahora = new Date()
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1)
  const dia = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate()
  const locales: Buffer[] = []
  const centrales: Buffer[] = []
  let desplazamiento = 0
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, 'utf8')
    const comprimido = deflateRawSync(a.datos)
    const crc = crc32(a.datos)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versión mínima
    local.writeUInt16LE(0x0800, 6) // nombres en UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(hora, 10)
    local.writeUInt16LE(dia, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comprimido.length, 18)
    local.writeUInt32LE(a.datos.length, 22)
    local.writeUInt16LE(nombre.length, 26)
    locales.push(local, nombre, comprimido)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // hecho con
    central.writeUInt16LE(20, 6) // versión mínima
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(hora, 12)
    central.writeUInt16LE(dia, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(comprimido.length, 20)
    central.writeUInt32LE(a.datos.length, 24)
    central.writeUInt16LE(nombre.length, 28)
    central.writeUInt32LE(desplazamiento, 42)
    centrales.push(central, nombre)
    desplazamiento += local.length + nombre.length + comprimido.length
  }
  const tamCentral = centrales.reduce((s, b) => s + b.length, 0)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(archivos.length, 8)
  fin.writeUInt16LE(archivos.length, 10)
  fin.writeUInt32LE(tamCentral, 12)
  fin.writeUInt32LE(desplazamiento, 16)
  return Buffer.concat([...locales, ...centrales, fin])
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

export function aXlsx(tablas: Tabla[], encabezado: Encabezado): Buffer {
  const hojas = tablas.map((t, i) => ({ id: i + 1, ...t, nombre: t.nombre.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) }))
  const archivos = [
    {
      nombre: '[Content_Types].xml',
      datos:
        XML +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        hojas.map((h) => `<Override PartName="/xl/worksheets/sheet${h.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        `</Types>`,
    },
    {
      nombre: '_rels/.rels',
      datos: XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      datos:
        XML +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        hojas.map((h) => `<sheet name="${escapar(h.nombre)}" sheetId="${h.id}" r:id="rId${h.id}"/>`).join('') +
        `</sheets><definedNames>` +
        hojas.map((h, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${escapar(h.nombre.replace(/'/g, "''"))}'!$${FILA_ENCABEZADO}:$${FILA_ENCABEZADO}</definedName>`).join('') +
        `</definedNames></workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      datos:
        XML +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        hojas.map((h) => `<Relationship Id="rId${h.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${h.id}.xml"/>`).join('') +
        `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { nombre: 'xl/styles.xml', datos: ESTILOS_XML },
    ...hojas.map((h) => ({ nombre: `xl/worksheets/sheet${h.id}.xml`, datos: hojaXml(h, encabezado) })),
  ].map((a) => ({ nombre: a.nombre, datos: Buffer.from(a.datos, 'utf8') }))
  return zip(archivos)
}
