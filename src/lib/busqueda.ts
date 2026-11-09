// Los buscadores filtran en el propio dispositivo (Dexie o listas ya cargadas): el texto nunca llega al servidor ni se
// usa para armar SQL, HTML o expresiones regulares, así que no hay inyección posible. Aun así se limpia: un texto
// pegado puede traer caracteres invisibles o de control, o ser enorme y trabar el teléfono al filtrar en cada tecla.

export const MAX_BUSQUEDA = 60

const ACENTOS = /[\u0300-\u036f]/g
// De control, de ancho cero y de dirección (los que se cuelan al copiar de WhatsApp o de una página).
const INVISIBLES = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g

export const normalizar = (s: string) => s.normalize('NFD').replace(ACENTOS, '').toLowerCase()

// Lo que escribió, listo para comparar: sin invisibles, sin acentos, en minúsculas, espacios de más fuera y cortado.
export const limpiarBusqueda = (s: string) => normalizar(s.replace(INVISIBLES, '').slice(0, MAX_BUSQUEDA * 2)).replace(/\s+/g, ' ').trim().slice(0, MAX_BUSQUEDA)

// ¿Aparecen todas las palabras buscadas en alguno de los campos? `t` ya limpio (limpiarBusqueda); vacío = todo.
export function coincide(t: string, ...campos: (string | null | undefined)[]) {
  if (!t) return true
  const texto = normalizar(campos.filter(Boolean).join(' '))
  return t.split(' ').every((p) => texto.includes(p))
}

// Para el <input> de cada buscador: tope de largo (también al pegar) y sin autocorrector ni sugerencias guardadas.
export const propsBuscador = { maxLength: MAX_BUSQUEDA, inputMode: 'search', enterKeyHint: 'search', autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'none', spellCheck: false } as const

// Un teléfono se busca por sus dígitos: «55-12 34» encuentra «5512 3456…» aunque el número esté guardado con espacios,
// guiones o lada. Sólo cuando lo escrito es un número (dígitos y separadores) con al menos 3 dígitos; si no, ''.
export function digitosBuscados(t: string) {
  if (!/^[\d\s().+-]+$/.test(t)) return ''
  const d = t.replace(/\D/g, '')
  return d.length >= 3 ? d : ''
}
export const telefonoCoincide = (d: string, tel: string | null | undefined) => !!d && !!tel && tel.replace(/\D/g, '').includes(d)

// Tramos de `texto` para resaltar lo que coincidió con la búsqueda, comparando sin acentos ni mayúsculas pero
// devolviendo el texto original: [['Doña ', false], ['Lupi', true], ['ta', false]].
export function tramosResaltados(texto: string, t: string): [string, boolean][] {
  if (!t || !texto) return [[texto, false]]
  // Cada letra original puede volverse 0, 1 o más letras normalizadas: se guarda de qué letra salió cada una.
  let norm = ''
  const origen: number[] = []
  for (let i = 0; i < texto.length; i++) {
    const n = normalizar(texto[i])
    norm += n
    for (let k = 0; k < n.length; k++) origen.push(i)
  }
  const marca = new Array<boolean>(texto.length).fill(false)
  for (const p of t.split(' ')) {
    if (!p) continue
    for (let j = norm.indexOf(p); j !== -1; j = norm.indexOf(p, j + p.length)) {
      for (let k = j; k < j + p.length; k++) marca[origen[k]] = true
    }
  }
  const tramos: [string, boolean][] = []
  for (let i = 0; i < texto.length; i++) {
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && ultimo[1] === marca[i]) ultimo[0] += texto[i]
    else tramos.push([texto[i], marca[i]])
  }
  return tramos
}

// Las últimas búsquedas de cada buscador, sólo en este dispositivo y por cuenta (un teléfono compartido no las mezcla).
const RECIENTES = 3
const claveRecientes = (clave: string, cuenta?: string) => `delisy:busquedas:${cuenta ?? 'local'}:${clave}`
export function leerRecientes(clave: string, cuenta?: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(claveRecientes(clave, cuenta)) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.replace(INVISIBLES, '').slice(0, MAX_BUSQUEDA)).filter(Boolean).slice(0, RECIENTES) : []
  } catch { return [] }
}
// Guarda lo escrito tal cual (con sus acentos), al frente y sin repetir; menos de 2 letras no vale la pena.
export function recordarBusqueda(clave: string, texto: string, cuenta?: string) {
  const limpio = texto.replace(INVISIBLES, '').replace(/\s+/g, ' ').trim().slice(0, MAX_BUSQUEDA)
  if (limpio.length < 2) return leerRecientes(clave, cuenta)
  const lista = [limpio, ...leerRecientes(clave, cuenta).filter((x) => limpiarBusqueda(x) !== limpiarBusqueda(limpio))].slice(0, RECIENTES)
  try { localStorage.setItem(claveRecientes(clave, cuenta), JSON.stringify(lista)) } catch { /* sin almacenamiento: no se recuerda */ }
  return lista
}
export function olvidarRecientes(clave: string, cuenta?: string) {
  try { localStorage.removeItem(claveRecientes(clave, cuenta)) } catch { /* nada */ }
}
