import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorRed } from './api'
import { descargarAutenticado, llamarAutenticado } from './sesion'
import { desdeIso, hoy, iso, sumarDias } from './fechas'
import { descargarArchivo } from './pdf'
import type { ClienteLibreta } from './reportePdf'

// Reportes de ventas para el administrador (RF-043 a RF-048). Los arma el servidor con todo el historial y los
// costos de cuando se vendió; por eso necesitan conexión y sólo los ve el administrador (RF-005).

export type Agrupar = 'dia' | 'semana' | 'mes'
export interface Rango { desde: string; hasta: string }

export interface Resumen {
  ingreso: number
  costo: number
  utilidad: number
  margenPct: number | null
  litros: number
  pedidos: number
  clientes: number
  ticketPromedio: number | null
  efectivo: number
  transferencia: number
}
export interface Periodo { periodo: string; inicio: string; fin: string; ingreso: number; costo: number; utilidad: number; litros: number; pedidos: number }
export interface SaborVendido {
  id: string
  sabor: string
  color: string
  disponible: boolean
  litros: number
  ingreso: number
  costo: number
  utilidad: number
  margenPct: number | null
  sinCosto: boolean
}
export interface VendedorRendimiento {
  id: string | null
  nombre: string
  activo: boolean
  pedidos: number
  clientes: number
  litros: number
  ingreso: number
  utilidad: number
  ticketPromedio: number | null
  omitidos: number
}
export interface Reporte {
  desde: string
  hasta: string
  agrupar: Agrupar
  resumen: Resumen
  anterior: (Rango & { resumen: Resumen }) | null
  periodos: Periodo[]
  sabores: SaborVendido[]
  ranking: { estrella: string | null; menorRotacion: string | null }
  vendedores: VendedorRendimiento[]
}

// ------------------------------------------------------------------ periodos

export type Vista = 'dia' | 'semana' | 'mes' | 'rango'

export const diasDelRango = (r: Rango) => Math.round((desdeIso(r.hasta).getTime() - desdeIso(r.desde).getTime()) / 86_400_000) + 1

// El día, la semana (lunes a domingo) o el mes que contiene la fecha `ancla`.
export function rangoDe(vista: Exclude<Vista, 'rango'>, ancla: string): Rango {
  if (vista === 'dia') return { desde: ancla, hasta: ancla }
  if (vista === 'semana') {
    const lunes = sumarDias(ancla, -((desdeIso(ancla).getDay() + 6) % 7))
    return { desde: lunes, hasta: sumarDias(lunes, 6) }
  }
  const d = desdeIso(ancla)
  return { desde: iso(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
}

// El mismo tipo de periodo, `n` veces antes (negativo) o después.
export function mover(vista: Exclude<Vista, 'rango'>, ancla: string, n: number): string {
  if (vista === 'dia') return sumarDias(ancla, n)
  if (vista === 'semana') return sumarDias(ancla, 7 * n)
  const d = desdeIso(ancla)
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

// Cómo se puede agrupar un rango: por día mientras las barras quepan, por semana o mes cuando ya es largo.
export function agrupacionesPosibles(r: Rango): Agrupar[] {
  const dias = diasDelRango(r)
  return [...(dias <= 92 ? ['dia' as const] : []), ...(dias >= 8 ? ['semana' as const] : []), ...(dias >= 29 ? ['mes' as const] : [])]
}
export const agrupacionSugerida = (r: Rango): Agrupar => {
  const dias = diasDelRango(r)
  return dias <= 31 ? 'dia' : dias <= 180 ? 'semana' : 'mes'
}

const corto = (s: string, conAnio = false) => desdeIso(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', ...(conAnio ? { year: 'numeric' } : {}) }).replace('.', '')
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function textoRango(vista: Vista, r: Rango): string {
  if (vista === 'dia') {
    if (r.desde === hoy()) return 'Hoy'
    if (r.desde === sumarDias(hoy(), -1)) return 'Ayer'
    return mayuscula(desdeIso(r.desde).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''))
  }
  if (vista === 'mes') return mayuscula(desdeIso(r.desde).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }))
  const mismoAnio = r.desde.slice(0, 4) === r.hasta.slice(0, 4)
  return `${corto(r.desde, !mismoAnio)} – ${corto(r.hasta, !mismoAnio || r.hasta.slice(0, 4) !== hoy().slice(0, 4))}`
}

// Nombre de una barra del gráfico: largo para el detalle, corto para el eje.
export function textoPeriodo(p: Periodo, agrupar: Agrupar, largo: boolean, variosAnios = false): string {
  const d = desdeIso(p.periodo)
  if (agrupar === 'dia') {
    return largo ? d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '') : String(d.getDate())
  }
  if (agrupar === 'semana') return largo ? (p.inicio === p.fin ? corto(p.inicio) : `${corto(p.inicio)} – ${corto(p.fin)}`) : corto(p.periodo)
  const mes = d.toLocaleDateString('es-MX', { month: largo ? 'long' : 'short', ...(largo || variosAnios ? { year: largo ? 'numeric' : '2-digit' } : {}) }).replace('.', '')
  return largo ? mayuscula(mes) : mes
}

// Cuánto cambió respecto al periodo anterior, en %. null = no hay con qué comparar.
export function cambio(actual: number, antes: number | undefined): number | null {
  return antes ? Math.round(((actual - antes) / antes) * 1000) / 10 : null
}

// ------------------------------------------------------------------ datos

// `comparar`: el periodo con el que se contrasta. Sin él, el servidor usa el de la misma duración justo antes.
export function rutaReporte(r: Rango, agrupar: Agrupar, comparar?: Rango) {
  return `/reportes/ventas?desde=${r.desde}&hasta=${r.hasta}&agrupar=${agrupar}${comparar ? `&compararDesde=${comparar.desde}&compararHasta=${comparar.hasta}` : ''}`
}

// Pide el reporte al servidor cada vez que cambia el periodo. Mientras llega el nuevo, se queda el anterior a la vista.
export function useReporte(rango: Rango, agrupar: Agrupar, comparar?: Rango) {
  const [reporte, setReporte] = useState<Reporte | null>(null)
  const [error, setError] = useState<{ texto: string; sinRed: boolean } | null>(null)
  const [cargando, setCargando] = useState(true)
  const pedido = useRef(0)

  const cargar = useCallback(() => {
    const mio = ++pedido.current
    setCargando(true)
    llamarAutenticado<Reporte>(rutaReporte(rango, agrupar, comparar))
      .then((r) => { if (mio === pedido.current) { setReporte(r); setError(null) } })
      .catch((e: Error) => {
        if (mio !== pedido.current) return
        setError({ texto: e.message, sinRed: e instanceof ErrorRed })
      })
      .finally(() => { if (mio === pedido.current) setCargando(false) })
  }, [rango.desde, rango.hasta, agrupar, comparar?.desde, comparar?.hasta])

  useEffect(() => { cargar() }, [cargar])
  return { reporte, error, cargando, recargar: cargar }
}

// ------------------------------------------------------------------ exportar (RF-048)

export type Formato = 'xlsx' | 'csv' | 'pdf'
export type TablaCsv = 'ventas' | 'periodos' | 'sabores' | 'vendedores'
export const TABLAS_CSV: { valor: TablaCsv; texto: string; ayuda: string }[] = [
  { valor: 'ventas', texto: 'Historial de ventas', ayuda: 'Una fila por sabor entregado a cada cliente' },
  { valor: 'periodos', texto: 'Por periodo', ayuda: 'Ingresos, costos y utilidad por día, semana o mes' },
  { valor: 'sabores', texto: 'Por sabor', ayuda: 'Ranking y rentabilidad de cada sabor' },
  { valor: 'vendedores', texto: 'Por vendedor', ayuda: 'Ventas e ingresos de cada vendedor' },
]

// Excel y CSV los arma el servidor (traen el historial completo de ventas); el PDF, el teléfono con el reporte en pantalla.
export async function exportarReporte(reporte: Reporte, formato: Formato, tabla: TablaCsv) {
  const { desde, hasta, agrupar } = reporte
  const blob = formato === 'pdf'
    ? new Blob([(await import('./reportePdf')).reportePdf(reporte)], { type: 'application/pdf' })
    : await descargarAutenticado(`/reportes/exportar?desde=${desde}&hasta=${hasta}&agrupar=${agrupar}&formato=${formato}&tabla=${tabla}`)
  return descargarArchivo(blob, `reporte-${formato === 'csv' ? tabla : 'ventas'}-${desde}_${hasta}.${formato}`)
}

// Libreta de clientes: la cartera activa de todos los vendedores. El servidor da los datos (y arma Excel y CSV).
export async function exportarLibreta(formato: Formato) {
  const blob = formato === 'pdf'
    ? new Blob([(await import('./reportePdf')).libretaPdf((await llamarAutenticado<{ clientes: ClienteLibreta[] }>('/reportes/clientes')).clientes)], { type: 'application/pdf' })
    : await descargarAutenticado(`/reportes/clientes?formato=${formato}`)
  return descargarArchivo(blob, `libreta-clientes-${hoy()}.${formato}`)
}
