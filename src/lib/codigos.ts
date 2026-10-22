// Códigos de cliente: el QR impreso (RF-015 a 018), la tarjeta NFC (RF-019, 020) y cómo se leen (RF-022).
import { db, guardar, uid, type Cliente } from './db'
import { Documento, ajustarTexto, descargarArchivo, type Bytes } from './pdf'

// Lo que lleva el QR. El prefijo sirve para reconocer de un vistazo un código de esta app y descartar
// cualquier otro QR que pase por la cámara. También se acepta el UUID solo, por si se imprimió así.
const PREFIJO = 'YGT1:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const contenidoQR = (c: Pick<Cliente, 'qr_uuid'>) => PREFIJO + c.qr_uuid

// Devuelve el UUID del cliente si el texto leído es un código de esta app; si no, null.
export function interpretarQR(texto: string): string | null {
  const t = texto.trim()
  const s = t.slice(0, PREFIJO.length).toUpperCase() === PREFIJO ? t.slice(PREFIJO.length) : t
  return UUID.test(s) ? s.toLowerCase() : null
}

// El UID que entrega Web NFC ("04:a1:b2:...") y el que se teclea ("04A1B2…") quedan igual: hex en mayúsculas con ":".
// Las tarjetas NFC tienen UID de 4, 7 o 10 bytes.
export function normalizarUid(texto: string): string | null {
  const hex = texto.replace(/[\s:.-]/g, '').toUpperCase()
  if (!/^[0-9A-F]+$/.test(hex) || hex.length % 2 || hex.length < 8 || hex.length > 20) return null
  return hex.match(/../g)!.join(':')
}

export type Busqueda =
  | { ok: true; cliente: Cliente }
  | { ok: false; motivo: 'invalido' | 'desconocido' }

export async function clientePorQR(texto: string): Promise<Busqueda> {
  const uuid = interpretarQR(texto)
  if (!uuid) return { ok: false, motivo: 'invalido' }
  const cliente = (await db.clientes.toArray()).find((c) => c.qr_uuid.toLowerCase() === uuid)
  return cliente ? { ok: true, cliente } : { ok: false, motivo: 'desconocido' }
}

export async function clientePorNfc(texto: string): Promise<Busqueda> {
  const id = normalizarUid(texto)
  if (!id) return { ok: false, motivo: 'invalido' }
  const cliente = (await db.clientes.toArray()).find((c) => c.nfc_uid && normalizarUid(c.nfc_uid) === id)
  return cliente ? { ok: true, cliente } : { ok: false, motivo: 'desconocido' }
}

// Cantidades del último pedido entregado, para que un pedido nuevo arranque como el anterior.
export async function baseDelUltimoPedido(clienteId: string): Promise<Record<string, number>> {
  const ultimo = (await db.pedidos.where('clienteId').equals(clienteId).filter((p) => p.estado === 'ENTREGADO').toArray())
    .sort((a, b) => (b.fecha_entregado_real ?? 0) - (a.fecha_entregado_real ?? 0) || b.fecha.localeCompare(a.fecha))[0]
  return ultimo ? Object.fromEntries(ultimo.items.map((i) => [i.productoId, i.litros])) : {}
}

// ------------------------------------------------------------------ QR (RF-015, RF-018)
export interface MatrizQR { n: number; oscuro: (fila: number, col: number) => boolean }

// Nivel de corrección Q: el imán se ensucia y se raya, y con Q todavía se lee con ~25 % del código dañado.
export async function matrizQR(texto: string): Promise<MatrizQR> {
  const { create } = await import('qrcode')
  const { modules } = create(texto, { errorCorrectionLevel: 'Q' })
  return { n: modules.size, oscuro: (f, c) => modules.get(f, c) === 1 }
}

export const codigoCorto = (c: Pick<Cliente, 'qr_uuid'>) => c.qr_uuid.slice(0, 8).toUpperCase()

// RF-018: un QR nuevo para el cliente. El anterior deja de funcionar; hay que imprimir y pegar el nuevo.
export async function reponerQR(c: Cliente): Promise<Cliente> {
  const nuevo = { ...c, qr_uuid: uid() }
  await guardar('clientes', nuevo)
  return nuevo
}

// ------------------------------------------------------------------ PDF (RF-016, RF-017)
const CARTA = { ancho: 215.9, alto: 279.4 }
const ETIQUETA = { ancho: 60, alto: 75, qr: 46, columnas: 3, filas: 3 }
export const ETIQUETAS_POR_HOJA = ETIQUETA.columnas * ETIQUETA.filas

// Una etiqueta para imán: QR grande (con su margen blanco), nombre, dirección y el código corto por si no lee.
async function dibujarEtiqueta(pdf: Documento, c: Cliente, x: number, y: number, guias: boolean) {
  const { ancho, alto, qr } = ETIQUETA
  if (guias) pdf.rect(x, y, ancho, alto, { borde: 0.6, grosor: 0.2, guion: [1.5, 1.5] })
  const m = await matrizQR(contenidoQR(c))
  // El QR ocupa `qr` mm incluyendo 4 módulos de margen blanco por lado, que exige el estándar para leerse bien.
  const lado = (qr * m.n) / (m.n + 8)
  const margen = (qr - lado) / 2
  pdf.modulos(x + (ancho - qr) / 2 + margen, y + 6 + margen, lado, m.n, m.oscuro)

  const centro = x + ancho / 2
  const nombre = ajustarTexto(c.nombre, 'negrita', 11, ancho - 6, 2)
  let linea = y + 58
  for (const r of nombre) {
    pdf.texto(r, centro, linea, { fuente: 'negrita', tam: 11, alinear: 'centro' })
    linea += 4.7
  }
  const direccion = ajustarTexto(c.direccion, 'normal', 7.5, ancho - 6, 1)[0]
  if (direccion) pdf.texto(direccion, centro, linea - 0.2, { tam: 7.5, color: 0.35, alinear: 'centro' })
  pdf.texto(codigoCorto(c), centro, y + alto - 3.2, { fuente: 'mono', tam: 7, color: 0.5, alinear: 'centro' })
}

// RF-016: una sola etiqueta, en una página del tamaño exacto del imán.
export async function pdfEtiqueta(c: Cliente): Promise<Bytes> {
  const pdf = new Documento(`QR ${c.nombre}`)
  pdf.pagina(ETIQUETA.ancho, ETIQUETA.alto)
  await dibujarEtiqueta(pdf, c, 0, 0, false)
  return pdf.bytes()
}

// RF-017: varias etiquetas por hoja Carta, con guías de corte punteadas.
export async function pdfEtiquetas(clientes: Cliente[]): Promise<Bytes> {
  const { ancho, alto, columnas, filas } = ETIQUETA
  const x0 = (CARTA.ancho - ancho * columnas) / 2
  const y0 = (CARTA.alto - alto * filas) / 2
  const pdf = new Documento(`QR de ${clientes.length} clientes`)
  for (let i = 0; i < clientes.length; i++) {
    const k = i % ETIQUETAS_POR_HOJA
    if (k === 0) pdf.pagina(CARTA.ancho, CARTA.alto)
    await dibujarEtiqueta(pdf, clientes[i], x0 + (k % columnas) * ancho, y0 + Math.floor(k / columnas) * alto, true)
  }
  return pdf.bytes()
}

// Compartir el PDF (WhatsApp, correo, "Imprimir" del teléfono) sólo en pantallas táctiles: en Chrome de Windows
// también existe, pero abre el panel de Windows en lugar de guardar el archivo. Descargar siempre está disponible.
export const puedeCompartirPdf = () =>
  matchMedia('(pointer: coarse)').matches && !!navigator.canShare?.({ files: [new File([], 'x.pdf', { type: 'application/pdf' })] })

// Abre la hoja de compartir del teléfono; si falla (p. ej. el navegador ya no la deja abrir), descarga el archivo.
export async function compartirPdf(bytes: Bytes, nombre: string): Promise<'compartido' | 'descargado' | 'cancelado'> {
  try {
    await navigator.share({ files: [new File([bytes], nombre, { type: 'application/pdf' })], title: nombre })
    return 'compartido'
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return 'cancelado'
    descargarArchivo(bytes, nombre)
    return 'descargado'
  }
}

export const nombreArchivo = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'cliente'

// ------------------------------------------------------------------ NFC (RF-019)
export async function duenoDeTarjeta(uidNfc: string, excepto: string): Promise<Cliente | undefined> {
  const id = normalizarUid(uidNfc)
  return (await db.clientes.toArray()).find((c) => c.id !== excepto && c.nfc_uid && normalizarUid(c.nfc_uid) === id)
}

// Liga la tarjeta al cliente, sobrescribiendo la que tuviera. Si otro cliente la tenía, se la quita primero:
// el servidor no admite el mismo UID en dos clientes, y los cambios viajan en este orden.
export async function vincularTarjeta(c: Cliente, uidNfc: string): Promise<{ quitadaA?: Cliente }> {
  const id = normalizarUid(uidNfc)
  if (!id) throw new Error('UID no válido')
  const otro = await duenoDeTarjeta(id, c.id)
  if (otro) await guardar('clientes', { ...otro, nfc_uid: undefined })
  await guardar('clientes', { ...c, nfc_uid: id })
  return { quitadaA: otro }
}

export const quitarTarjeta = (c: Cliente) => guardar('clientes', { ...c, nfc_uid: undefined })
