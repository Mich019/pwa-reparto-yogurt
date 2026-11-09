import { useCallback, useEffect, useRef, useState } from 'react'
import { useEnVivo, type AreaEnVivo } from './enVivo'
import { descargarAutenticado, llamarAutenticado } from './sesion'
import { descargarArchivo } from './pdf'
import { mostrarPdf } from '../components/VisorPdf'

// Cobranza, envases, cortes y cierre de mes (api/_lib/cobranza.ts, envases.ts, cortes.ts). Todo viene del servidor y
// necesita conexión: no pasa por la cola de sincronización.

export interface Deudor { id: string; nombre: string; telefono: string | null; vendedorId: string | null; vendedor: string | null; fiado: number; abonado: number; saldo: number; desde: string | null; ultimoAbono: string | null }
export interface CuentaCliente {
  cliente: { id: string; nombre: string }
  fiado: number; abonado: number; saldo: number; desde: string | null
  movimientos: { tipo: 'venta' | 'abono'; id: string; fecha: string; monto: number; anulado: boolean; nota: string | null; por: string | null; metodo?: string }[]
}
export interface EnvasesClientes {
  total: number
  clientes: { id: string; nombre: string; vendedorId: string | null; total: number; envases: { productoId: string; sabor: string; envase: string | null; prestados: number }[] }[]
  productos: { productoId: string; sabor: string; envase: string | null; prestados: number }[]
}
export interface CuentaEnvases {
  cliente: { id: string; nombre: string }
  total: number
  envases: { productoId: string; sabor: string; envase: string | null; entregados: number; recogidos: number; prestados: number }[]
  recogidas: { id: string; fecha: string; cantidad: number; sabor: string; nota: string | null; anulada: boolean; por: string | null }[]
}
export interface FilaCorte {
  id: string; fecha: string; vendedorId: string; vendedor: string
  esperado: number; transferencias: number; credito: number
  entregado: number | null; diferencia: number | null; nota: string | null
  estado: 'sin_corte' | 'pendiente' | 'confirmado'
  confirmadoPor: string | null; confirmadoEn: string | null; notaAdmin: string | null
  reabierto: { motivo: string; en: string } | null
  cambioDespues: number | null // confirmado, pero el efectivo de ese día cambió después: conviene reabrirlo
}
export interface Descuadre { id: string; fecha: string; vendedorId: string; vendedor: string; confirmado: number; ahora: number; cambio: number }
// `lugar`/`de`: su lugar entre los vendedores activos por lo vendido en el mes (null si no es vendedor activo).
export interface MiMeta { mes: string; ventas: number; meta: number | null; cumplimientoPct: number | null; comisionPct: number; comision: number; lugar: number | null; de: number }
export interface MesCierre { mes: string; estado: 'abierto' | 'cerrado' | 'reabierto'; actual: boolean; cerradoEn: string | null }
export interface CifrasMes {
  mes: string; desde: string; hasta: string
  ventas: { ingreso: number; costo: number; utilidad: number; margenPct: number | null; pedidos: number; clientes: number; porUnidad: Record<string, number> }
  cobro: { efectivo: number; transferencia: number; credito: number }
  abonos: { efectivo: number; transferencia: number; total: number }
  porCobrar: { saldo: number; clientes: number }
  envases: { prestados: number; clientes: number }
  vendedores: { id: string; nombre: string; activo: boolean; ventas: number; utilidad: number; pedidos: number; efectivo: number; transferencia: number; credito: number; abonos: number; comisionPct: number; comision: number; meta: number | null; cumplimientoPct: number | null }[]
  cortes: { dias: number; confirmados: number; pendientes: number; sinCorte: number; diferencia: number; detalle: { fecha: string; vendedor: string; esperado: number; entregado: number; diferencia: number; estado: string }[] }
}
export interface InformeMes {
  mes: string
  estado: 'abierto' | 'cerrado' | 'reabierto'
  cerradoEn: string | null
  historial: { accion: 'cerrado' | 'reabierto'; por: string; en: string; motivo?: string }[]
  cifras: CifrasMes
}

// Una consulta al servidor que se puede repetir (después de registrar algo). Cada pantalla que la usa se vuelve a pedir
// sola cuando cambia su área en la empresa (lib/enVivo.ts; por omisión, cobranza): en silencio, con lo de antes a la
// vista, y si esa vuelta falla (sin señal) se queda lo que había. Sólo la gana la última respuesta.
export function useServidor<T>(ruta: string | null, enVivo: AreaEnVivo | AreaEnVivo[] = 'cobranza') {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(!!ruta)
  const turno = useRef(0)
  const pedir = useCallback((callado: boolean) => {
    if (!ruta) return
    const mio = ++turno.current
    if (!callado) setCargando(true)
    llamarAutenticado<T>(ruta)
      .then((d) => { if (mio === turno.current) { setDatos(d); setError('') } })
      .catch((e) => { if (mio === turno.current && !callado) setError(e instanceof Error ? e.message : 'No se pudo cargar') })
      .finally(() => { if (mio === turno.current && !callado) setCargando(false) })
  }, [ruta])
  const cargar = useCallback(() => pedir(false), [pedir])
  useEffect(() => { setDatos(null); cargar() }, [cargar])
  useEnVivo(enVivo, () => pedir(true))
  return { datos, error, cargando, recargar: cargar }
}

// Sólo el administrador que también reparte: su propia meta del mes (null = sin meta).
export const fijarMiMeta = (metaMensual: number | null) => llamarAutenticado<{ metaMensual: number | null }>('/mi-meta', { metodo: 'PATCH', cuerpo: { metaMensual } })
const enviar = <T>(ruta: string, cuerpo?: unknown) => llamarAutenticado<T>(ruta, { metodo: 'POST', cuerpo: cuerpo ?? {} })

export const guardarLimiteFiado = (clienteId: string, limite: number | null) =>
  llamarAutenticado<{ limite: number | null }>(`/clientes/${clienteId}/limite-fiado`, { metodo: 'PUT', cuerpo: { limite } })
export const registrarAbono = (b: { clienteId: string; monto: number; metodo: 'efectivo' | 'transferencia'; nota?: string }) => enviar<{ id: string; saldo: number }>('/cobranza/abonos', b)
export const anularAbono = (id: string, motivo: string) => enviar(`/cobranza/abonos/${id}/anular`, { motivo })
export const registrarRecogida = (b: { clienteId: string; productoId: string; cantidad: number; nota?: string }) => enviar<{ id: string; prestados: number }>('/envases/recogidas', b)
export const anularRecogida = (id: string) => enviar(`/envases/recogidas/${id}/anular`)
export const entregarCorte = (b: { efectivoEntregado: number; nota?: string; fecha?: string; vendedorId?: string }) => enviar<{ id: string; esperado: number; entregado: number; diferencia: number }>('/cortes', b)
export const confirmarCorte = (id: string, nota?: string) => enviar<{ ok: true; esperado: number; diferencia: number }>(`/cortes/${id}/confirmar`, { nota })
export const cerrarMes = (mes: string) => enviar<{ ok: true; porCorreo: number }>(`/cierres/${mes}/cerrar`)
export const reabrirCorte = (id: string, motivo: string) => enviar<{ ok: true }>(`/cortes/${id}/reabrir`, { motivo })
export const reabrirMes = (mes: string, motivo: string) => enviar(`/cierres/${mes}/reabrir`, { motivo })

export interface PrecioCliente { productoId: string; sabor: string; unidad: string; lista: number; precioLitro: number | null }
export const guardarPrecios = (clienteId: string, precios: { productoId: string; precioLitro: number | null }[]) =>
  llamarAutenticado<{ precios: PrecioCliente[] }>(`/clientes/${clienteId}/precios`, { metodo: 'PUT', cuerpo: { precios } })

// Medallas ganadas con `mes` y las 5 mejores rachas (salón de la fama), para el PDF del informe. Si no se puede traer,
// el informe sale sin esa parte.
async function logrosDelMes(mes: string) {
  try {
    const r = await llamarAutenticado<Record<string, { nombre: string; racha: number; mejorRacha: number; cumplidos: number; medallas: { medalla: number; mes: string }[] }>>('/usuarios/rachas')
    const todos = Object.values(r)
    return {
      medallas: todos.flatMap((v) => v.medallas.filter((m) => m.mes === mes).map((m) => ({ nombre: v.nombre, medalla: m.medalla }))),
      fama: [...todos].sort((a, b) => b.mejorRacha - a.mejorRacha || b.cumplidos - a.cumplidos || a.nombre.localeCompare(b.nombre)).slice(0, 5)
        .map(({ nombre, mejorRacha, cumplidos, racha }) => ({ nombre, mejorRacha, cumplidos, racha })),
    }
  } catch {
    return undefined
  }
}

// El informe mensual: el Excel lo arma el servidor; el PDF, este equipo con las mismas cifras (se abre en la vista previa).
export async function exportarInforme(informe: InformeMes, formato: 'pdf' | 'xlsx'): Promise<void> {
  const nombre = `informe-mensual-${informe.mes}.${formato}`
  if (formato === 'xlsx') {
    descargarArchivo(await descargarAutenticado(`/cierres/${informe.mes}/informe?formato=xlsx`), nombre)
    return
  }
  const pdf = await import('./reportePdf')
  const [, logros] = await Promise.all([pdf.prepararLogoPdf(), logrosDelMes(informe.mes)])
  mostrarPdf(pdf.informeMensualPdf(informe, new Date(), logros), nombre)
}

// Al cerrar el mes: arma aquí el PDF del informe y el servidor lo manda a los administradores que lo pidieron.
export async function mandarInformePorCorreo(mes: string) {
  const informe = await llamarAutenticado<InformeMes>(`/cierres/${mes}/informe`)
  const pdf = await import('./reportePdf')
  const [, logros] = await Promise.all([pdf.prepararLogoPdf(), logrosDelMes(mes)])
  const { bytes } = pdf.informeMensualPdf(informe, new Date(), logros)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return enviar<{ enviados: number }>(`/cierres/${mes}/correo`, { pdf: btoa(s) })
}

export const textoMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  const t = new Date(a, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })
  return t.charAt(0).toUpperCase() + t.slice(1)
}
