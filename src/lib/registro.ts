// Alta de una empresa nueva y su asistente de configuración (plan SaaS: Fase 2 «Registro» y Fase 6 «Asistente»).
// El formulario de /registro hace una pregunta por pantalla; aquí viven sus datos, sus catálogos de partida, las
// reglas de cada pantalla y el borrador que se guarda en el equipo.
//
// El catálogo es libre: un producto («Arroz») puede tener variantes («Blanco», «Integral»), cada una con su color, y
// se vende en envases con contenido y unidad («Bolsa 1 kg», «Costal 25 kg»). Cada producto × envase es una
// presentación con su precio y costo; las variantes de un producto comparten precio.

import type { TipoEnvase } from '../views/registro/dibujos'

// --- Giros: qué vende el negocio. Cada uno propone envases, tamaños y productos para no empezar en blanco. ---

export interface Giro {
  valor: string
  texto: string
  detalle: string
  dibujo: TipoEnvase
  color: string
  envases: { tipo: TipoEnvase; tamanos: string[] }[] // tamaños como «1 L», «25 kg», «12 pz»
  productos: { nombre: string; variantes: string[] }[]
}

export const GIROS: Giro[] = [
  { valor: 'lacteos', texto: 'Lácteos', detalle: 'Yogurt, leche, crema', dibujo: 'frasco', color: '#e5484d',
    envases: [{ tipo: 'frasco', tamanos: ['1 L'] }, { tipo: 'botella', tamanos: ['1 L'] }, { tipo: 'vaso', tamanos: ['250 ml'] }],
    productos: [{ nombre: 'Yogurt', variantes: ['Natural', 'Fresa', 'Mango', 'Durazno'] }] },
  { valor: 'bebidas', texto: 'Jugos y bebidas', detalle: 'Jugos, aguas frescas, refrescos', dibujo: 'botella', color: '#f28c28',
    envases: [{ tipo: 'botella', tamanos: ['500 ml', '1 L'] }, { tipo: 'vaso', tamanos: ['500 ml'] }],
    productos: [{ nombre: 'Jugo', variantes: ['Naranja', 'Verde'] }, { nombre: 'Agua fresca', variantes: ['Jamaica', 'Horchata', 'Limón'] }] },
  { valor: 'agua', texto: 'Agua y hielo', detalle: 'Garrafones, botellas, bolsas', dibujo: 'garrafon', color: '#3aa0e0',
    envases: [{ tipo: 'garrafon', tamanos: ['20 L'] }, { tipo: 'botella', tamanos: ['600 ml'] }, { tipo: 'bolsa_nylon', tamanos: ['5 kg'] }],
    productos: [{ nombre: 'Agua purificada', variantes: [] }, { nombre: 'Hielo', variantes: [] }] },
  { valor: 'granos', texto: 'Granos y semillas', detalle: 'Arroz, frijol, maíz, café', dibujo: 'costal', color: '#b07a52',
    envases: [{ tipo: 'bolsa', tamanos: ['1 kg'] }, { tipo: 'costal', tamanos: ['25 kg', '50 kg'] }, { tipo: 'granel', tamanos: ['kg'] }],
    productos: [{ nombre: 'Arroz', variantes: ['Blanco', 'Integral'] }, { nombre: 'Frijol', variantes: ['Negro', 'Pinto'] }] },
  { valor: 'panaderia', texto: 'Panadería', detalle: 'Pan, pasteles, galletas', dibujo: 'pieza', color: '#d9a05b',
    envases: [{ tipo: 'pieza', tamanos: ['1 pz'] }, { tipo: 'bolsa', tamanos: ['6 pz'] }, { tipo: 'caja', tamanos: ['12 pz'] }],
    productos: [{ nombre: 'Pan dulce', variantes: ['Concha', 'Cuerno', 'Dona'] }, { nombre: 'Bolillo', variantes: [] }] },
  { valor: 'helados', texto: 'Helados y paletas', detalle: 'Paletas, nieves, litros', dibujo: 'vaso', color: '#ff7aa8',
    envases: [{ tipo: 'pieza', tamanos: ['1 pz'] }, { tipo: 'vaso', tamanos: ['250 ml'] }, { tipo: 'cubeta', tamanos: ['4 L'] }],
    productos: [{ nombre: 'Paleta', variantes: ['Limón', 'Fresa', 'Mango'] }, { nombre: 'Nieve', variantes: ['Vainilla', 'Chocolate'] }] },
  { valor: 'carnes', texto: 'Carnes y pollo', detalle: 'Por kilo o en charola', dibujo: 'charola', color: '#c0392b',
    envases: [{ tipo: 'charola', tamanos: ['1 kg'] }, { tipo: 'granel', tamanos: ['kg'] }],
    productos: [{ nombre: 'Pollo', variantes: ['Pechuga', 'Pierna'] }, { nombre: 'Carne de res', variantes: [] }] },
  { valor: 'frutas', texto: 'Frutas y verduras', detalle: 'Por kilo, caja o costal', dibujo: 'granel', color: '#4caf50',
    envases: [{ tipo: 'granel', tamanos: ['kg'] }, { tipo: 'caja', tamanos: ['10 kg'] }, { tipo: 'costal', tamanos: ['25 kg'] }],
    productos: [{ nombre: 'Jitomate', variantes: [] }, { nombre: 'Aguacate', variantes: [] }] },
  { valor: 'huevo', texto: 'Huevo', detalle: 'Por cartón o por caja', dibujo: 'huevo', color: '#e8c07a',
    envases: [{ tipo: 'huevo', tamanos: ['30 pz'] }, { tipo: 'caja', tamanos: ['360 pz'] }],
    productos: [{ nombre: 'Huevo', variantes: ['Blanco', 'Rojo'] }] },
  { valor: 'tortillas', texto: 'Tortillas y masa', detalle: 'Por kilo o en paquete', dibujo: 'bolsa', color: '#f2c94c',
    envases: [{ tipo: 'bolsa', tamanos: ['1 kg'] }, { tipo: 'granel', tamanos: ['kg'] }],
    productos: [{ nombre: 'Tortilla', variantes: ['Maíz', 'Harina'] }, { nombre: 'Masa', variantes: [] }] },
  { valor: 'limpieza', texto: 'Limpieza', detalle: 'Cloro, jabón, suavizante', dibujo: 'cubeta', color: '#7c3aed',
    envases: [{ tipo: 'botella', tamanos: ['1 L'] }, { tipo: 'garrafon', tamanos: ['5 L'] }, { tipo: 'cubeta', tamanos: ['19 L'] }],
    productos: [{ nombre: 'Cloro', variantes: [] }, { nombre: 'Jabón líquido', variantes: ['Lavanda', 'Limón'] }] },
  { valor: 'abarrotes', texto: 'Abarrotes', detalle: 'Un poco de todo', dibujo: 'caja', color: '#0f766e',
    envases: [{ tipo: 'pieza', tamanos: ['1 pz'] }, { tipo: 'caja', tamanos: ['12 pz'] }, { tipo: 'lata', tamanos: ['355 ml'] }],
    productos: [] },
]

// --- Envases: el dibujo, su nombre y los tamaños que más se usan (más cualquiera que se escriba). ---

export const TIPOS_ENVASE: { tipo: TipoEnvase; nombre: string; detalle: string; tamanos: string[]; retornable?: boolean }[] = [
  { tipo: 'botella', nombre: 'Botella', detalle: 'Jugos, leche, agua', tamanos: ['250 ml', '500 ml', '600 ml', '1 L', '1.5 L', '2 L'] },
  { tipo: 'garrafon', nombre: 'Garrafón', detalle: 'Agua, limpieza', tamanos: ['5 L', '10 L', '11 L', '19 L', '20 L'], retornable: true },
  { tipo: 'frasco', nombre: 'Frasco', detalle: 'Yogurt, mermelada, miel', tamanos: ['250 ml', '500 ml', '1 L'] },
  { tipo: 'vaso', nombre: 'Vaso', detalle: 'Yogurt, nieve, bebidas', tamanos: ['120 ml', '250 ml', '500 ml', '1 L'] },
  { tipo: 'bolsa_nylon', nombre: 'Bolsa de nylon', detalle: 'Hielo, agua, leche', tamanos: ['500 ml', '1 L', '2 kg', '5 kg'] },
  { tipo: 'bolsa', nombre: 'Bolsa', detalle: 'Arroz, café, tortillas', tamanos: ['250 g', '500 g', '1 kg', '2 kg', '5 kg'] },
  { tipo: 'costal', nombre: 'Costal', detalle: 'Granos, harina, alimento', tamanos: ['10 kg', '20 kg', '25 kg', '50 kg'] },
  { tipo: 'caja', nombre: 'Caja', detalle: 'Varias piezas o kilos', tamanos: ['6 pz', '12 pz', '24 pz', '10 kg'] },
  { tipo: 'charola', nombre: 'Charola', detalle: 'Carne, pollo, fruta', tamanos: ['500 g', '1 kg', '6 pz'] },
  { tipo: 'cubeta', nombre: 'Cubeta', detalle: 'Helado, pintura, limpieza', tamanos: ['4 L', '10 L', '19 L'] },
  { tipo: 'lata', nombre: 'Lata', detalle: 'Refrescos, conservas', tamanos: ['355 ml', '473 ml'] },
  { tipo: 'carton', nombre: 'Cartón (tetra)', detalle: 'Leche, jugo', tamanos: ['250 ml', '1 L', '1.9 L'] },
  { tipo: 'huevo', nombre: 'Cartón de huevo', detalle: 'Por docena o por 30', tamanos: ['12 pz', '18 pz', '30 pz'] },
  { tipo: 'pieza', nombre: 'Por pieza', detalle: 'Pan, paletas, unidades', tamanos: ['1 pz'] },
  { tipo: 'granel', nombre: 'A granel', detalle: 'Se pesa o se mide', tamanos: ['kg', 'g', 'L'] },
]

export const tipoEnvase = (t: string) => TIPOS_ENVASE.find((x) => x.tipo === t)

export const COLORES_MARCA = ['#035d38', '#1d4ed8', '#b91c1c', '#c2410c', '#7c3aed', '#0f766e', '#be185d', '#111827']

// Colores para que cada producto o variante se reconozca a la vista, como los sabores de hoy.
const COLOR_POR_NOMBRE: Record<string, string> = {
  natural: '#efe8d6', fresa: '#e5484d', mango: '#f5a623', durazno: '#f7a072', 'limón': '#8cc63f', limon: '#8cc63f',
  naranja: '#f28c28', verde: '#5cb85c', jamaica: '#9b1b46', horchata: '#e9dcc0', vainilla: '#f3e3b5', chocolate: '#6b3f2a',
  coco: '#f1ece2', nuez: '#a77b52', 'café': '#6f4e37', cafe: '#6f4e37', uva: '#6c3b8c', 'piña': '#f4d03f', pina: '#f4d03f',
  guayaba: '#f08a8a', zarzamora: '#4b2343', blanco: '#f1eee4', integral: '#b89b72', negro: '#3a3a3a', pinto: '#b07a52',
  rojo: '#c0392b', 'maíz': '#f2c94c', maiz: '#f2c94c', harina: '#f1e7cf', pechuga: '#f2c6a0', pierna: '#d99a6c',
  lavanda: '#a78bfa', concha: '#e8b36d', cuerno: '#d9a05b', dona: '#c97b4a', agua: '#7cc6f0', hielo: '#bfe8fb',
  cloro: '#9fd8f5', arroz: '#f1eee4', frijol: '#5a3a2a', huevo: '#e8c07a', jitomate: '#e0402f', aguacate: '#4f7d2b',
  pollo: '#f2c6a0', 'carne de res': '#b03a2e', tortilla: '#f2c94c', masa: '#f2dc8c', bolillo: '#d9a05b', leche: '#f4f1ea',
  yogurt: '#f4f1ea', jugo: '#f28c28', 'agua purificada': '#7cc6f0', 'agua fresca': '#e86f8f', paleta: '#ff7aa8', nieve: '#f3e3b5',
  'pan dulce': '#e8b36d', 'jabón líquido': '#a78bfa',
}
const PALETA = ['#e5484d', '#f5a623', '#3aa0e0', '#4caf50', '#7c3aed', '#e86f8f', '#0f766e', '#b07a52', '#f2c94c', '#6b7280']

export function colorPara(nombre: string, i = 0) {
  return COLOR_POR_NOMBRE[nombre.trim().toLowerCase()] ?? PALETA[i % PALETA.length]
}

// --- Datos del registro ---

export interface Envase {
  id: string
  tipo: TipoEnvase
  contenido: number
  unidad: string // L, ml, kg, g, pz o la que escriba la empresa
  retornable: boolean
}

export interface Variante { nombre: string; color: string }

export interface Producto {
  id: string
  nombre: string
  color: string // si no tiene variantes
  variantes: Variante[]
  precios: Record<string, { precio: string; costo: string; activo: boolean }> // por id de envase
}

export interface Registro {
  negocio: string
  nombre: string
  correo: string
  verificado: string // el correo que ya se confirmó con el código; si se cambia el correo, hay que confirmarlo otra vez
  terminos: boolean
  giros: string[]
  tipos: TipoEnvase[] // envases elegidos, en orden
  envases: Envase[] // un renglón por tipo y tamaño
  controlRetornables: boolean
  productos: Producto[]
  marca: { color: string; logo: string | null }
  zonaHoraria: string
  invitaciones: string[]
}

const nuevoId = () => crypto.randomUUID()

export function registroVacio(): Registro {
  return {
    negocio: '', nombre: '', correo: '', verificado: '', terminos: false,
    giros: [], tipos: [], envases: [], controlRetornables: false, productos: [],
    marca: { color: COLORES_MARCA[0], logo: null },
    zonaHoraria: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City',
    invitaciones: [],
  }
}

// «1.5 L» → 1.5 y L; «kg» (a granel) → 1 kg; «12 pz» → 12 y pz.
export function leerTamano(s: string): { contenido: number; unidad: string } | null {
  const m = s.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)?\s*([a-zA-Záéíóú.]+)$/)
  if (!m) return null
  const contenido = m[1] ? Number(m[1]) : 1
  return contenido > 0 ? { contenido, unidad: m[2] } : null
}

export const formatoCantidad = (n: number) => n.toLocaleString('es-MX', { maximumFractionDigits: 3 })
export const textoTamano = (e: Pick<Envase, 'contenido' | 'unidad'>) => `${formatoCantidad(e.contenido)} ${e.unidad}`

export function nombreEnvase(e: Envase) {
  const t = tipoEnvase(e.tipo)
  if (e.tipo === 'pieza') return 'Pieza'
  if (e.tipo === 'granel') return `A granel (${e.unidad})`
  return `${t?.nombre ?? 'Envase'} ${textoTamano(e)}`
}

export const tieneTamano = (r: Registro, tipo: TipoEnvase, tam: string) => {
  const t = leerTamano(tam)
  return !!t && r.envases.some((e) => e.tipo === tipo && e.contenido === t.contenido && e.unidad === t.unidad)
}

export function alternarTamano(r: Registro, tipo: TipoEnvase, tam: string): Registro {
  const t = leerTamano(tam)
  if (!t) return r
  const existe = r.envases.find((e) => e.tipo === tipo && e.contenido === t.contenido && e.unidad === t.unidad)
  if (existe) return quitarEnvase(r, existe.id)
  const retornable = !!tipoEnvase(tipo)?.retornable
  return { ...r, envases: [...r.envases, { id: nuevoId(), tipo, ...t, retornable }] }
}

function quitarEnvase(r: Registro, id: string): Registro {
  return {
    ...r,
    envases: r.envases.filter((e) => e.id !== id),
    productos: r.productos.map((p) => {
      const { [id]: _, ...resto } = p.precios
      return { ...p, precios: resto }
    }),
  }
}

export function alternarTipo(r: Registro, tipo: TipoEnvase): Registro {
  if (r.tipos.includes(tipo)) {
    const sin = r.envases.filter((e) => e.tipo === tipo).reduce((x, e) => quitarEnvase(x, e.id), r)
    return { ...sin, tipos: sin.tipos.filter((t) => t !== tipo) }
  }
  // Al elegir un envase se marca el tamaño más común para no dejarlo vacío.
  const tamanos = tipoEnvase(tipo)?.tamanos ?? []
  const comun = tamanos.find((t) => ['1 L', '250 ml', '1 kg', '20 L', '25 kg', '12 pz', '30 pz'].includes(t)) ?? tamanos[0]
  const con = { ...r, tipos: [...r.tipos, tipo] }
  return comun ? alternarTamano(con, tipo, comun) : con
}

export function productoNuevo(nombre: string, variantes: string[] = [], i = 0): Producto {
  return {
    id: nuevoId(),
    nombre,
    color: colorPara(nombre, i),
    variantes: variantes.map((v, j) => ({ nombre: v, color: colorPara(v, i + j) })),
    precios: {},
  }
}

// Envases (con tamaños) y productos que proponen unos giros.
function propuesta(giros: string[]) {
  const elegidos = GIROS.filter((g) => giros.includes(g.valor))
  let x: Registro = { ...registroVacio(), giros }
  for (const g of elegidos) {
    for (const e of g.envases) {
      if (!x.tipos.includes(e.tipo)) x = { ...x, tipos: [...x.tipos, e.tipo] }
      for (const t of e.tamanos) if (!tieneTamano(x, e.tipo, t)) x = alternarTamano(x, e.tipo, t)
    }
  }
  // Cada producto sugerido llega con los envases de su giro ya marcados (sin precio): el agua en garrafón, el arroz
  // en costal…
  const productos: Producto[] = []
  for (const g of elegidos) {
    for (const p of g.productos) {
      if (productos.some((y) => y.nombre === p.nombre)) continue
      const suyos = x.envases.filter((e) => g.envases.some((ge) => ge.tipo === e.tipo && ge.tamanos.some((t) => {
        const l = leerTamano(t)
        return l?.contenido === e.contenido && l.unidad === e.unidad
      })))
      productos.push({ ...productoNuevo(p.nombre, p.variantes, productos.length), precios: Object.fromEntries(suyos.map((e) => [e.id, { precio: '', costo: '', activo: true }])) })
    }
  }
  return { tipos: x.tipos, envases: x.envases, productos }
}

const firmaEnvases = (es: Envase[]) => es.map((e) => `${e.tipo}:${e.contenido}${e.unidad}`).sort().join('|')
const firmaProductos = (ps: { nombre: string }[]) => ps.map((p) => p.nombre).sort().join('|')

// Al cambiar los giros se cambia también lo que se había propuesto; lo que ya se ajustó a mano se respeta.
export function aplicarGiros(r: Registro, giros: string[]): Registro {
  const antes = propuesta(r.giros)
  const ahora = propuesta(giros)
  let x: Registro = { ...r, giros }
  if (firmaEnvases(r.envases) === firmaEnvases(antes.envases)) x = { ...x, tipos: ahora.tipos, envases: ahora.envases }
  const sinPrecios = r.productos.every((p) => Object.values(p.precios).every((v) => !v.precio && !v.costo))
  if (firmaProductos(r.productos) === firmaProductos(antes.productos) && sinPrecios) {
    x = { ...x, productos: ahora.productos }
  }
  return x
}

// Productos que se pueden sugerir según los giros y que aún no están en la lista.
export function sugerenciasProductos(r: Registro) {
  const ya = new Set(r.productos.map((p) => p.nombre.trim().toLowerCase()))
  return GIROS.filter((g) => r.giros.includes(g.valor)).flatMap((g) => g.productos).filter((p) => !ya.has(p.nombre.toLowerCase()))
}

export const numero = (s: string) => {
  const n = Number(s.replace(',', '.'))
  return s.trim() !== '' && Number.isFinite(n) ? n : NaN
}

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

// Presentaciones que verá el repartidor: una por producto (o variante) y envase activo.
export function presentaciones(r: Registro) {
  return r.productos.flatMap((p) => {
    const vs = p.variantes.length ? p.variantes.map((v) => ({ nombre: `${p.nombre.trim()} ${v.nombre}`, color: v.color })) : [{ nombre: p.nombre.trim(), color: p.color }]
    return r.envases
      .filter((e) => p.precios[e.id]?.activo)
      .flatMap((e) => vs.map((v) => ({ clave: `${p.id}-${e.id}-${v.nombre}`, nombre: v.nombre, color: v.color, envase: e, precio: numero(p.precios[e.id].precio) })))
  })
}

// Lo que se manda al servidor. La contraseña va aparte: nunca se guarda en el borrador.
export function cuerpoRegistro(r: Registro, password: string) {
  return {
    empresa: {
      nombre: r.negocio.trim(),
      giros: r.giros,
      zonaHoraria: r.zonaHoraria,
      color: r.marca.color,
      logo: r.marca.logo,
      controlRetornables: r.controlRetornables,
    },
    administrador: { nombre: r.nombre.trim(), correo: r.correo.trim().toLowerCase(), password, aceptaTerminos: r.terminos },
    envases: r.envases.map((e) => ({ id: e.id, tipo: e.tipo, contenido: e.contenido, unidad: e.unidad, retornable: e.retornable })),
    productos: r.productos.map((p) => ({
      nombre: p.nombre.trim(),
      color: p.color,
      variantes: p.variantes,
      presentaciones: r.envases
        .filter((e) => p.precios[e.id]?.activo)
        .map((e) => ({ envase: e.id, precio: numero(p.precios[e.id].precio), costo: p.precios[e.id].costo.trim() ? numero(p.precios[e.id].costo) : null })),
    })),
    invitaciones: r.invitaciones,
  }
}

// --- Borrador en este equipo, para seguir después donde se quedó (sin la contraseña). ---

const CLAVE = 'registro-empresa-v2'

export function leerBorrador(): { registro: Registro; paso: string } | null {
  try {
    const b = JSON.parse(localStorage.getItem(CLAVE) ?? 'null')
    return b?.registro?.negocio ? b : null // un borrador sin nombre no es algo que retomar
  } catch {
    return null
  }
}

export function guardarBorrador(registro: Registro, paso: string) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ registro, paso }))
  } catch {
    // Sin espacio o en privado: el formulario sigue funcionando, sólo no se recuerda.
  }
}

export function borrarBorrador() {
  try {
    localStorage.removeItem(CLAVE)
    localStorage.removeItem('registro-empresa-borrador') // el de la primera versión
  } catch {
    // nada que hacer
  }
}
