// Alta de una empresa nueva (Fase 2 y 4 del plan multiempresa): el formulario progresivo de /registro junta aquí sus
// datos, sus reglas y el borrador que se guarda en el equipo mientras se llena.
//
// El catálogo es libre: un producto («Yogurt») puede tener variantes («Fresa», «Mango») y se vende en uno o varios
// envases con su contenido y unidad («Botella 1 L», «Bolsa 500 ml», «Pieza»). Cada producto × envase es una
// presentación con su precio y costo; las variantes de un producto comparten precio.

export type Giro = 'lacteos' | 'agua' | 'pan' | 'helados' | 'abarrotes' | 'otro'

export interface Envase {
  id: string
  tipo: string // botella, garrafon, bolsa… o «propio»
  nombre: string
  contenido: number
  unidad: string // L, ml, kg, g, pieza o la que escriba la empresa
  retornable: boolean
}

export interface Producto {
  id: string
  nombre: string
  variantes: string[]
  precios: Record<string, { precio: string; costo: string; activo: boolean }> // por id de envase
}

export interface Registro {
  negocio: { nombre: string; giro: Giro | ''; giroOtro: string; ciudad: string; zonaHoraria: string }
  cuenta: { nombre: string; correo: string; telefono: string }
  envases: Envase[]
  controlRetornables: boolean
  productos: Producto[]
  marca: { color: string; logo: string | null } // logo como data URL
}

export const GIROS: { valor: Giro; texto: string; detalle: string }[] = [
  { valor: 'lacteos', texto: 'Lácteos', detalle: 'Yogurt, leche, quesos' },
  { valor: 'agua', texto: 'Agua', detalle: 'Garrafones y botellas' },
  { valor: 'pan', texto: 'Panadería', detalle: 'Pan, pasteles, galletas' },
  { valor: 'helados', texto: 'Helados', detalle: 'Paletas, nieves, vasos' },
  { valor: 'abarrotes', texto: 'Abarrotes', detalle: 'Productos por pieza o a granel' },
  { valor: 'otro', texto: 'Otro', detalle: 'Escribe qué vendes' },
]

export const UNIDADES = ['L', 'ml', 'kg', 'g', 'pieza']

// Envases de partida: al elegir uno se agrega con estos valores y se pueden cambiar.
export const TIPOS_ENVASE: { tipo: string; nombre: string; contenido: number; unidad: string; retornable: boolean }[] = [
  { tipo: 'botella', nombre: 'Botella', contenido: 1, unidad: 'L', retornable: false },
  { tipo: 'garrafon', nombre: 'Garrafón', contenido: 20, unidad: 'L', retornable: true },
  { tipo: 'bolsa', nombre: 'Bolsa de nylon', contenido: 1, unidad: 'L', retornable: false },
  { tipo: 'vaso', nombre: 'Vaso', contenido: 250, unidad: 'ml', retornable: false },
  { tipo: 'frasco', nombre: 'Frasco', contenido: 500, unidad: 'ml', retornable: true },
  { tipo: 'caja', nombre: 'Caja', contenido: 12, unidad: 'pieza', retornable: false },
  { tipo: 'pieza', nombre: 'Pieza', contenido: 1, unidad: 'pieza', retornable: false },
  { tipo: 'granel', nombre: 'A granel', contenido: 1, unidad: 'kg', retornable: false },
]

// Lo que suele usar cada giro, para que el paso de envases y el de productos no empiecen vacíos.
const SUGERENCIAS: Record<Giro, { envases: string[]; productos: { nombre: string; variantes: string[] }[] }> = {
  lacteos: { envases: ['botella', 'vaso'], productos: [{ nombre: 'Yogurt', variantes: ['Natural', 'Fresa', 'Durazno'] }] },
  agua: { envases: ['garrafon', 'botella'], productos: [{ nombre: 'Agua purificada', variantes: [] }] },
  pan: { envases: ['pieza', 'caja'], productos: [{ nombre: 'Pan dulce', variantes: ['Concha', 'Cuerno'] }] },
  helados: { envases: ['pieza', 'vaso'], productos: [{ nombre: 'Paleta', variantes: ['Limón', 'Fresa'] }] },
  abarrotes: { envases: ['pieza', 'granel'], productos: [] },
  otro: { envases: [], productos: [] },
}

export const COLORES_MARCA = ['#035d38', '#1d4ed8', '#b91c1c', '#c2410c', '#7c3aed', '#0f766e', '#be185d', '#111827']

export const ZONAS_HORARIAS = [
  'America/Mexico_City', 'America/Monterrey', 'America/Merida', 'America/Cancun', 'America/Chihuahua',
  'America/Mazatlan', 'America/Hermosillo', 'America/Tijuana', 'America/Bogota', 'America/Lima', 'America/Santiago',
  'America/Argentina/Buenos_Aires',
]

const nuevoId = () => crypto.randomUUID()

export function registroVacio(): Registro {
  const zona = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City'
  return {
    negocio: { nombre: '', giro: '', giroOtro: '', ciudad: '', zonaHoraria: zona },
    cuenta: { nombre: '', correo: '', telefono: '' },
    envases: [],
    controlRetornables: false,
    productos: [],
    marca: { color: COLORES_MARCA[0], logo: null },
  }
}

export function envaseDeTipo(tipo: string): Envase {
  const t = TIPOS_ENVASE.find((e) => e.tipo === tipo)
  return t ? { id: nuevoId(), ...t } : { id: nuevoId(), tipo: 'propio', nombre: '', contenido: 1, unidad: 'pieza', retornable: false }
}

export function productoNuevo(nombre = '', variantes: string[] = []): Producto {
  return { id: nuevoId(), nombre, variantes, precios: {} }
}

// Al elegir el giro por primera vez se proponen sus envases y productos; si ya hay algo capturado no se toca.
export function aplicarSugerencias(r: Registro, giro: Giro): Registro {
  const s = SUGERENCIAS[giro]
  return {
    ...r,
    envases: r.envases.length ? r.envases : s.envases.map(envaseDeTipo),
    productos: r.productos.length ? r.productos : s.productos.map((p) => productoNuevo(p.nombre, p.variantes)),
  }
}

export function nombreEnvase(e: Envase) {
  const n = e.nombre.trim() || 'Envase'
  if (e.unidad === 'pieza' && e.contenido === 1) return n
  return `${n} ${formatoCantidad(e.contenido)} ${e.unidad === 'pieza' ? (e.contenido === 1 ? 'pieza' : 'piezas') : e.unidad}`
}

export const formatoCantidad = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 3 })

export const numero = (s: string) => {
  const n = Number(s.replace(',', '.'))
  return s.trim() !== '' && Number.isFinite(n) ? n : NaN
}

// --- Reglas de cada paso: null si está bien, o el porqué para mostrarlo junto al botón de continuar. ---

export const correoValido = (c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.trim())

// La misma regla que el servidor (api/_lib/contrasenas.ts); el servidor vuelve a revisarla.
export function reglasPassword(p: string, correo: string) {
  const baja = p.toLowerCase()
  const usuario = correo.trim().toLowerCase().split('@')[0] ?? ''
  return [
    { texto: 'Al menos 10 caracteres', ok: p.length >= 10 && p.length <= 200 },
    { texto: 'Letras y números', ok: /[A-Za-z]/.test(p) && /\d/.test(p) },
    { texto: 'Sin tu correo ni el nombre de la app', ok: p !== '' && !(usuario.length >= 4 && baja.includes(usuario)) && !['yogurt', 'reparto'].some((w) => baja.includes(w)) },
  ]
}

export function faltaEnNegocio(r: Registro) {
  if (r.negocio.nombre.trim().length < 2) return 'Escribe el nombre de tu negocio'
  if (!r.negocio.giro) return 'Elige qué vende tu negocio'
  if (r.negocio.giro === 'otro' && !r.negocio.giroOtro.trim()) return 'Cuéntanos qué vendes'
  return null
}

export function faltaEnCuenta(r: Registro, password: string, confirmacion: string) {
  if (r.cuenta.nombre.trim().length < 2) return 'Escribe tu nombre'
  if (!correoValido(r.cuenta.correo)) return 'Escribe un correo válido'
  if (!password) return 'Escribe tu contraseña (por seguridad no se guarda en el equipo)'
  if (!reglasPassword(password, r.cuenta.correo).every((x) => x.ok)) return 'La contraseña aún no cumple las reglas'
  if (password !== confirmacion) return 'Las contraseñas no coinciden'
  return null
}

export function faltaEnEnvases(r: Registro) {
  if (!r.envases.length) return 'Elige al menos un envase'
  for (const e of r.envases) {
    if (!e.nombre.trim()) return 'Ponle nombre a tu envase propio'
    if (!(e.contenido > 0)) return `Escribe cuánto lleva «${e.nombre}»`
    if (!e.unidad.trim()) return `Elige la unidad de «${e.nombre}»`
  }
  const nombres = r.envases.map((e) => nombreEnvase(e).toLowerCase())
  if (new Set(nombres).size !== nombres.length) return 'Hay dos envases iguales'
  return null
}

export function faltaEnProductos(r: Registro) {
  if (!r.productos.length) return 'Agrega al menos un producto'
  for (const p of r.productos) {
    if (!p.nombre.trim()) return 'Hay un producto sin nombre'
    const activos = r.envases.filter((e) => p.precios[e.id]?.activo)
    if (!activos.length) return `Elige en qué envase vendes «${p.nombre}»`
    for (const e of activos) {
      const { precio, costo } = p.precios[e.id]
      if (!(numero(precio) > 0)) return `Falta el precio de «${p.nombre}» en ${nombreEnvase(e)}`
      if (costo.trim() && !(numero(costo) >= 0)) return `El costo de «${p.nombre}» en ${nombreEnvase(e)} no es un número`
    }
  }
  return null
}

// Presentaciones que verá el repartidor: una por producto × variante × envase activo.
export function presentaciones(r: Registro) {
  return r.productos.flatMap((p) => {
    const nombres = p.variantes.length ? p.variantes.map((v) => `${p.nombre.trim()} ${v}`) : [p.nombre.trim()]
    return r.envases
      .filter((e) => p.precios[e.id]?.activo)
      .flatMap((e) => nombres.map((n) => ({ clave: `${p.id}-${e.id}-${n}`, nombre: n, envase: e, precio: numero(p.precios[e.id].precio) })))
  })
}

// Lo que se manda al servidor. La contraseña va aparte: nunca se guarda en el borrador.
export function cuerpoRegistro(r: Registro, password: string) {
  return {
    empresa: {
      nombre: r.negocio.nombre.trim(),
      giro: r.negocio.giro === 'otro' ? r.negocio.giroOtro.trim() : r.negocio.giro,
      ciudad: r.negocio.ciudad.trim() || null,
      zonaHoraria: r.negocio.zonaHoraria,
      color: r.marca.color,
      logo: r.marca.logo,
      controlRetornables: r.controlRetornables,
    },
    administrador: { nombre: r.cuenta.nombre.trim(), correo: r.cuenta.correo.trim().toLowerCase(), telefono: r.cuenta.telefono.trim() || null, password },
    envases: r.envases.map((e) => ({ id: e.id, nombre: e.nombre.trim(), contenido: e.contenido, unidad: e.unidad.trim(), retornable: e.retornable })),
    productos: r.productos.map((p) => ({
      nombre: p.nombre.trim(),
      variantes: p.variantes,
      presentaciones: r.envases
        .filter((e) => p.precios[e.id]?.activo)
        .map((e) => ({ envase: e.id, precio: numero(p.precios[e.id].precio), costo: p.precios[e.id].costo.trim() ? numero(p.precios[e.id].costo) : null })),
    })),
  }
}

// --- Borrador en este equipo, para seguir después donde se quedó (sin la contraseña). ---

const CLAVE = 'registro-empresa-borrador'

export function leerBorrador(): { registro: Registro; paso: number } | null {
  try {
    const b = JSON.parse(localStorage.getItem(CLAVE) ?? 'null')
    return b?.registro?.negocio?.nombre ? b : null // un borrador sin nombre no es algo que retomar
  } catch {
    return null
  }
}

export function guardarBorrador(registro: Registro, paso: number) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ registro, paso }))
  } catch {
    // Sin espacio o en privado: el formulario sigue funcionando, sólo no se recuerda.
  }
}

export function borrarBorrador() {
  try {
    localStorage.removeItem(CLAVE)
  } catch {
    // nada que hacer
  }
}
