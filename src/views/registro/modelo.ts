// Registro de una empresa nueva (prototipo de las fases 2 y 4 del plan multiempresa): los datos que junta el formulario
// progresivo y las plantillas que propone según el giro. Todavía no se manda al servidor.
//
// Catálogo general: producto (nombre libre) → variantes opcionales (sabor, tamaño…) → presentación (producto en un
// envase, con su precio y costo). Cada envase dice cuánto contiene y en qué unidad, así se pueden sumar cantidades.

export type Giro = 'lacteos' | 'agua' | 'pan' | 'tortilla' | 'frutas' | 'otro'

export interface Envase {
  id: string
  nombre: string // "Botella", "Garrafón"…
  contenido: number // 1, 20, 0.5…
  unidad: string // L, ml, kg, g, pieza o la que escriba la empresa
  retornable: boolean
}

export interface Precio { precio: string; costo: string } // texto tal como se escribe; se valida al avanzar

export interface Producto {
  id: string
  nombre: string
  variantes: string[] // vacío = sin variantes
  precios: Record<string, Precio> // por id de envase; un envase sin entrada no se vende en ese producto
}

export interface Registro {
  negocio: { nombre: string; giro: Giro | null; giroOtro: string; zona: string }
  cuenta: { nombre: string; correo: string; telefono: string; acepta: boolean }
  envases: Envase[]
  controlRetornables: boolean
  productos: Producto[]
  marca: { nombre: string; color: string; logo: string | null } // logo como data: URL (sólo la vista previa)
}

export const id = () => Math.random().toString(36).slice(2, 10)

export const UNIDADES = ['L', 'ml', 'kg', 'g', 'pieza'] as const

export const GIROS: { valor: Giro; texto: string; ejemplo: string }[] = [
  { valor: 'lacteos', texto: 'Lácteos y yogurt', ejemplo: 'Yogurt, leche, queso' },
  { valor: 'agua', texto: 'Agua purificada', ejemplo: 'Garrafones y botellas' },
  { valor: 'pan', texto: 'Panadería', ejemplo: 'Bolillo, pan dulce' },
  { valor: 'tortilla', texto: 'Tortillería', ejemplo: 'Tortilla y masa' },
  { valor: 'frutas', texto: 'Frutas y verduras', ejemplo: 'Por kilo o por caja' },
  { valor: 'otro', texto: 'Otro', ejemplo: 'Lo que vendas' },
]

// Envases para elegir con un toque; cada uno trae su tamaño más común y se puede cambiar.
export const ENVASES_COMUNES: Omit<Envase, 'id'>[] = [
  { nombre: 'Botella', contenido: 1, unidad: 'L', retornable: false },
  { nombre: 'Garrafón', contenido: 20, unidad: 'L', retornable: true },
  { nombre: 'Bolsa', contenido: 1, unidad: 'L', retornable: false },
  { nombre: 'Vaso', contenido: 250, unidad: 'ml', retornable: false },
  { nombre: 'Frasco', contenido: 500, unidad: 'g', retornable: true },
  { nombre: 'Caja', contenido: 10, unidad: 'kg', retornable: false },
  { nombre: 'Paquete', contenido: 1, unidad: 'kg', retornable: false },
  { nombre: 'Pieza', contenido: 1, unidad: 'pieza', retornable: false },
  { nombre: 'A granel', contenido: 1, unidad: 'kg', retornable: false },
]

// Lo que se propone al elegir el giro; la persona lo cambia a su gusto en los pasos siguientes.
const PLANTILLAS: Record<Giro, { envases: Omit<Envase, 'id'>[]; productos: { nombre: string; variantes: string[]; precios: [string, string][] }[] }> = {
  lacteos: {
    envases: [{ nombre: 'Botella', contenido: 1, unidad: 'L', retornable: false }, { nombre: 'Bolsa', contenido: 1, unidad: 'L', retornable: false }],
    productos: [{ nombre: 'Yogurt', variantes: ['Fresa', 'Mango', 'Natural'], precios: [['60', '28'], ['55', '25']] }],
  },
  agua: {
    envases: [{ nombre: 'Garrafón', contenido: 20, unidad: 'L', retornable: true }, { nombre: 'Botella', contenido: 1, unidad: 'L', retornable: false }],
    productos: [{ nombre: 'Agua purificada', variantes: [], precios: [['40', '12'], ['12', '5']] }],
  },
  pan: {
    envases: [{ nombre: 'Pieza', contenido: 1, unidad: 'pieza', retornable: false }, { nombre: 'Bolsa', contenido: 10, unidad: 'pieza', retornable: false }],
    productos: [
      { nombre: 'Bolillo', variantes: [], precios: [['3', '1.2'], ['28', '11']] },
      { nombre: 'Concha', variantes: ['Vainilla', 'Chocolate'], precios: [['12', '5'], ['110', '48']] },
    ],
  },
  tortilla: {
    envases: [{ nombre: 'Paquete', contenido: 1, unidad: 'kg', retornable: false }, { nombre: 'A granel', contenido: 1, unidad: 'kg', retornable: false }],
    productos: [{ nombre: 'Tortilla de maíz', variantes: [], precios: [['26', '14'], ['24', '13']] }],
  },
  frutas: {
    envases: [{ nombre: 'A granel', contenido: 1, unidad: 'kg', retornable: false }, { nombre: 'Caja', contenido: 10, unidad: 'kg', retornable: true }],
    productos: [
      { nombre: 'Aguacate', variantes: [], precios: [['70', '45'], ['650', '420']] },
      { nombre: 'Naranja', variantes: ['Para jugo', 'De mesa'], precios: [['18', '9'], ['160', '80']] },
    ],
  },
  otro: { envases: [], productos: [] },
}

export function aplicarPlantilla(giro: Giro): Pick<Registro, 'envases' | 'productos' | 'controlRetornables'> {
  const p = PLANTILLAS[giro]
  const envases = p.envases.map((e) => ({ ...e, id: id() }))
  const productos = p.productos.map((x) => ({
    id: id(),
    nombre: x.nombre,
    variantes: x.variantes,
    precios: Object.fromEntries(envases.map((e, i) => [e.id, { precio: x.precios[i]?.[0] ?? '', costo: x.precios[i]?.[1] ?? '' }])),
  }))
  return { envases, productos, controlRetornables: envases.some((e) => e.retornable) }
}

export const nombreEnvase = (e: Pick<Envase, 'nombre' | 'contenido' | 'unidad'>) =>
  `${e.nombre} ${e.contenido.toLocaleString('es-MX')} ${e.unidad === 'pieza' ? (e.contenido === 1 ? 'pieza' : 'piezas') : e.unidad}`

export const numero = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')))

// Misma regla que el servidor (api/_lib/contrasenas.ts), para avisar antes de enviar.
export function problemasPassword(p: string, correo: string) {
  const usuario = correo.trim().toLowerCase().split('@')[0] ?? ''
  const baja = p.toLowerCase()
  return [
    { ok: p.length >= 10, texto: 'Al menos 10 caracteres' },
    { ok: /[A-Za-z]/.test(p) && /\d/.test(p), texto: 'Letras y números' },
    { ok: !(usuario.length >= 4 && baja.includes(usuario)) && !/yogurt|reparto/.test(baja), texto: 'Sin tu correo ni el nombre de la app' },
  ]
}

export const ZONAS: { valor: string; texto: string }[] = [
  { valor: 'America/Mexico_City', texto: 'Centro (Ciudad de México, Guadalajara, Monterrey)' },
  { valor: 'America/Cancun', texto: 'Sureste (Quintana Roo)' },
  { valor: 'America/Chihuahua', texto: 'Chihuahua' },
  { valor: 'America/Mazatlan', texto: 'Pacífico (Sinaloa, Nayarit, BCS)' },
  { valor: 'America/Hermosillo', texto: 'Sonora' },
  { valor: 'America/Tijuana', texto: 'Noroeste (Baja California)' },
]

export function zonaInicial() {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone
    return ZONAS.some((x) => x.valor === z) ? z : 'America/Mexico_City'
  } catch {
    return 'America/Mexico_City'
  }
}

export const COLORES = ['#035d38', '#1f4fd1', '#b42318', '#7a3db8', '#c2410c', '#0f766e', '#111827']

export const vacio = (): Registro => ({
  negocio: { nombre: '', giro: null, giroOtro: '', zona: zonaInicial() },
  cuenta: { nombre: '', correo: '', telefono: '', acepta: false },
  envases: [],
  controlRetornables: false,
  productos: [],
  marca: { nombre: '', color: COLORES[0], logo: null },
})
