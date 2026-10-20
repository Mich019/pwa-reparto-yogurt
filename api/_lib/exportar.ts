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

// Estilos (índice en cellXfs): 0 normal · 1 encabezado · 2 fecha · 3 entero · 4 litros · 5 dinero · 6 porcentaje
const ESTILO: Record<Tipo | 'encabezado', number> = { texto: 0, encabezado: 1, fecha: 2, entero: 3, litros: 4, dinero: 5, porcentaje: 6 }

const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="166" formatCode="0.0&quot;%&quot;"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F3F3"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
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

function celdaXlsx(ref: string, x: Valor, base: Tipo): string {
  const { v, t } = desenvolver(x, base)
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}" s="${ESTILO[t]}"><v>${v}</v></c>` : ''
  if (t === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="${ESTILO.fecha}"><v>${serie(v)}</v></c>`
  // Texto "en línea": Excel nunca lo toma por una fórmula, aunque empiece con "=".
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapar(v)}</t></is></c>`
}

function hojaXml(t: Tabla): string {
  const ancho = t.columnas.map((c, i) => {
    const largo = Math.max(c.titulo.length, ...t.filas.slice(0, 200).map((f) => String(desenvolver(f[i], c.tipo).v ?? '').length))
    return `<col min="${i + 1}" max="${i + 1}" width="${c.ancho ?? Math.min(48, Math.max(10, largo + 2))}" customWidth="1"/>`
  })
  const filas = [
    `<row r="1">${t.columnas.map((c, i) => `<c r="${letra(i)}1" s="${ESTILO.encabezado}" t="inlineStr"><is><t>${escapar(c.titulo)}</t></is></c>`).join('')}</row>`,
    ...t.filas.map((f, r) => `<row r="${r + 2}">${f.map((x, i) => celdaXlsx(`${letra(i)}${r + 2}`, x, t.columnas[i].tipo)).join('')}</row>`),
  ]
  const ultima = `${letra(t.columnas.length - 1)}${t.filas.length + 1}`
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${ancho.join('')}</cols><sheetData>${filas.join('')}</sheetData>` +
    (t.filas.length ? `<autoFilter ref="A1:${ultima}"/>` : '') +
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

export function aXlsx(tablas: Tabla[]): Buffer {
  const hojas = tablas.map((t, i) => ({ id: i + 1, ...t }))
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
        hojas.map((h) => `<sheet name="${escapar(h.nombre.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31))}" sheetId="${h.id}" r:id="rId${h.id}"/>`).join('') +
        `</sheets></workbook>`,
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
    ...hojas.map((h) => ({ nombre: `xl/worksheets/sheet${h.id}.xml`, datos: hojaXml(h) })),
  ].map((a) => ({ nombre: a.nombre, datos: Buffer.from(a.datos, 'utf8') }))
  return zip(archivos)
}
