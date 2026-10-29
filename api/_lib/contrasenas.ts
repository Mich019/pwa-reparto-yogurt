import { createHmac } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { tokenAleatorio } from './seguridad.js'

// RF-004: Argon2id con los parámetros de OWASP (64 MiB, 3 pasadas) sobre la contraseña ya mezclada con el pepper.
// El pepper (AUTH_PEPPER_SECRET) es un secreto que vive sólo en el entorno del servidor, nunca en la base: con una
// copia robada de la base los hashes no se pueden atacar sin él.
const PARAMS = { memoryCost: 65536, timeCost: 3, parallelism: 4 }

export interface Pimientas {
  pimienta: string
  pimientaAnterior: string | null
}

const conPimienta = (pimienta: string, password: string) => createHmac('sha256', pimienta).update(password).digest('base64')

export const hashPassword = (c: Pimientas, password: string) => hash(conPimienta(c.pimienta, password), PARAMS)

async function coincide(guardado: string, mezclada: string) {
  try {
    return await verify(guardado, mezclada)
  } catch {
    return false
  }
}

// Un hash hecho con otros parámetros se rehace la próxima vez que la persona entra.
function parametrosViejos(guardado: string) {
  const m = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(guardado)
  return !m || Number(m[1]) !== PARAMS.memoryCost || Number(m[2]) !== PARAMS.timeCost || Number(m[3]) !== PARAMS.parallelism
}

// rehacer: la contraseña es correcta pero el hash es del pepper anterior (rotación) o de otros parámetros.
export async function verificarPassword(c: Pimientas, guardado: string, password: string) {
  if (await coincide(guardado, conPimienta(c.pimienta, password))) return { ok: true, rehacer: parametrosViejos(guardado) }
  if (c.pimientaAnterior && (await coincide(guardado, conPimienta(c.pimientaAnterior, password)))) return { ok: true, rehacer: true }
  return { ok: false, rehacer: false }
}

// Hash de relleno: con un correo que no existe se verifica contra él, para que la respuesta tarde lo mismo.
const HASH_RELLENO = await hash(tokenAleatorio(), PARAMS)
export const verificarRelleno = (c: Pimientas, password: string) => verificarPassword(c, HASH_RELLENO, password)

export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 200
const PALABRAS_DE_LA_APP = ['yogurt', 'reparto', 'delisy'] // lo primero que alguien probaría con estas cuentas

// Regla de contraseñas (RF-004): null si sirve; si no, el porqué, listo para mostrarse.
export function revisarPassword(p: string, correo?: string): string | null {
  if (p.length < PASSWORD_MIN || p.length > PASSWORD_MAX) return `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres`
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'La contraseña debe tener letras y números'
  const baja = p.toLowerCase()
  const usuario = correo?.trim().toLowerCase().split('@')[0] ?? ''
  if (baja === correo?.trim().toLowerCase() || (usuario.length >= 4 && baja.includes(usuario))) return 'La contraseña no puede llevar tu correo'
  if (PALABRAS_DE_LA_APP.some((w) => baja.includes(w))) return 'La contraseña no puede llevar el nombre de la app'
  return null
}
