import { useEffect, useSyncExternalStore, type CSSProperties } from 'react'
import { llamarAutenticado } from './sesion'

// Marca de la empresa (api/_lib/empresa.ts): nombre, logo y color en el panel, la app de reparto y los PDF.
// Se guarda una copia en este navegador: así se ve sin conexión y en la pantalla de entrada del próximo inicio de
// sesión. Sin logo, la empresa se ve con su nombre y su inicial (views/admin/marca.tsx).

export interface Marca {
  nombre: string
  color: string | null
  logo: string | null
  lema?: string | null // en los PDF; falta en la copia guardada antes de la migración 013
  contacto?: string | null
  zonaHoraria?: string // define el «hoy» de la empresa (migración 007)
  minutosUrgente?: number // cuánto espera un urgente antes de recordarlo (migración 031)
  ritmoMetaPct?: number // por debajo de qué % del ritmo del mes una meta va atrasada (migración 034)
  limiteFiado?: number | null // límite de fiado de los clientes sin uno propio (migración 036); null = sin límite
  codigoFiado?: string | null // `sal:sha256`: con él, fiar de más pide el código del administrador (037); al guardar se manda el código
  firmaNombre?: string | null // quién firma el informe del cierre de mes (038); null = quien lo genera
  firmaCargo?: string | null // debajo de la firma; null = «Administrador»
  firmaImagen?: string | null // la firma dibujada o fotografiada, sobre la línea (039)
  controlRetornables?: boolean // sus clientes devuelven envases (registro, migración 008): sin esto no se ven Envases
  de?: string // id de la cuenta con la que se guardó la copia
}

const CLAVE = 'marca-empresa'
const leerCopia = (): Marca | null => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE) ?? 'null')
  } catch {
    return null
  }
}

let actual: Marca | null = leerCopia()
let deQuien: string | undefined
const oyentes = new Set<() => void>()
function fijar(m: Marca | null) {
  actual = m
  try { if (m) localStorage.setItem(CLAVE, JSON.stringify(m)); else localStorage.removeItem(CLAVE) } catch { /* sin almacenamiento: sólo no se recuerda */ }
  oyentes.forEach((f) => f())
}

export const marcaActual = () => actual

// ¿La empresa lleva la cuenta de envases que se devuelven? Sin la respuesta todavía (copia vieja), como antes: sí.
export const useConEnvases = () => useMarca()?.controlRetornables ?? true

export function useMarca() {
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f)
      return () => oyentes.delete(f)
    },
    () => actual,
  )
}

// Lo pide al servidor cuando cambia la cuenta (App.tsx). Sin conexión queda la copia.
export function useCargarMarca(idUsuario: string | undefined) {
  useEffect(() => {
    if (!idUsuario || idUsuario === deQuien) return
    deQuien = idUsuario
    // La copia de otra cuenta puede ser de otra empresa: no se muestra mientras llega la de ésta.
    if (actual && actual.de !== idUsuario) fijar(null)
    llamarAutenticado<Marca>('/empresa').then((m) => fijar({ ...m, de: idUsuario })).catch(() => {})
  }, [idUsuario])
}

export async function guardarMarca(cambios: Partial<Marca>) {
  fijar({ ...(await llamarAutenticado<Marca>('/empresa', { metodo: 'PATCH', cuerpo: cambios })), de: deQuien })
}

// --- Color: el de la empresa en los botones y acentos, oscurecido si hace falta para que el texto blanco se lea. ---

const canal = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const hex = (c: number[]) => `#${c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`
const luminancia = (c: number[]) => 0.2126 * canal(c[0]) + 0.7152 * canal(c[1]) + 0.0722 * canal(c[2])
const oscurecer = (c: number[], f: number) => c.map((x) => x * (1 - f))

export function colorLegible(color: string) {
  let c = rgb(color)
  // Contraste con blanco ≥ 4.5:1 (WCAG AA), oscureciendo poco a poco.
  for (let i = 0; i < 20 && 1.05 / (luminancia(c) + 0.05) < 4.5; i++) c = oscurecer(c, 0.08)
  return hex(c)
}

export function estiloMarca(m: Marca | null): CSSProperties | undefined {
  if (!m?.color || !/^#[0-9a-f]{6}$/i.test(m.color)) return undefined
  const base = colorLegible(m.color)
  return { '--color-marca': base, '--color-marca-oscuro': hex(oscurecer(rgb(base), 0.2)) } as CSSProperties
}
