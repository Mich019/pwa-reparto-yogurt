import type { Frecuencia } from './db'

export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

export function iso(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export const hoy = () => iso(new Date())

export function desdeIso(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function sumarDias(s: string, n: number) {
  const d = desdeIso(s)
  d.setDate(d.getDate() + n)
  return iso(d)
}

export function textoFecha(s: string) {
  const d = desdeIso(s)
  const diff = Math.round((d.getTime() - desdeIso(hoy()).getTime()) / 86400000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Mañana'
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ¿Le toca visita a este cliente en la fecha dada? `ultima` = última entrega (YYYY-MM-DD).
export function tocaVisita(f: Frecuencia, fecha: string, ultima?: string) {
  if (f.tipo === 'semana') return f.dias.includes(desdeIso(fecha).getDay())
  if (!ultima) return false
  const diff = Math.round((desdeIso(fecha).getTime() - desdeIso(ultima).getTime()) / 86400000)
  return diff > 0 && diff % f.cada === 0
}

export function siguienteVisita(f: Frecuencia, desde = hoy()) {
  if (f.tipo === 'intervalo') return sumarDias(desde, f.cada)
  for (let i = 1; i <= 7; i++) {
    const d = sumarDias(desde, i)
    if (f.dias.includes(desdeIso(d).getDay())) return d
  }
  return sumarDias(desde, 7)
}

export function textoFrecuencia(f: Frecuencia) {
  if (f.tipo === 'intervalo') return `Cada ${f.cada} días`
  if (!f.dias.length) return 'Sin días fijos'
  return [...f.dias].sort().map((d) => DIAS_CORTOS[d]).join(', ')
}

export const dinero = (n: number) =>
  n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
