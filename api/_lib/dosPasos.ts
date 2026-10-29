import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import type { Config } from './config.js'
import { PASSWORD_MAX, verificarPassword } from './contrasenas.js'
import { tx, type Db } from './db.js'

// Verificación en dos pasos con códigos de 6 dígitos que cambian cada 30 s (TOTP, RFC 6238): la misma que usan
// Google Authenticator, Microsoft Authenticator, 1Password, etc. Opcional por cuenta y recomendada para administradores.
//  · El secreto se guarda cifrado (AES-256-GCM) con una clave que sale de AUTH_PEPPER_SECRET: con una copia robada de
//    la base no se pueden generar códigos.
//  · Un código aceptado no vuelve a servir (ultimo_paso), aunque siga dentro de sus 30 s.
//  · 10 códigos de respaldo de un solo uso para cuando no se tiene el teléfono; se guardan como HMAC.
//  · Si se pierden teléfono y códigos, un administrador restablece la contraseña de la cuenta y eso la quita.

type Pimientas = Pick<Config, 'pimienta' | 'pimientaAnterior'>

const DIGITOS = 6
const PASO_S = 30
const EMISOR = 'Delisy'
const NUM_RESPALDO = 10

// ---------------------------------------------------------------- base32 (RFC 4648), como lo leen las apps

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function aBase32(b: Buffer): string {
  let bits = 0
  let valor = 0
  let s = ''
  for (const byte of b) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      s += B32[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) s += B32[(valor << (5 - bits)) & 31]
  return s
}
function deBase32(s: string): Buffer {
  let bits = 0
  let valor = 0
  const salida: number[] = []
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c)
    if (i < 0) throw new Error('base32 no válido')
    valor = (valor << 5) | i
    bits += 5
    if (bits >= 8) {
      salida.push((valor >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(salida)
}

// ---------------------------------------------------------------- TOTP

// Código de la ventana `paso` (HOTP de RFC 4226 con HMAC-SHA1, el que entienden todas las apps).
export function codigoTotp(secretoB32: string, paso: number): string {
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(paso))
  const h = createHmac('sha1', deBase32(secretoB32)).update(contador).digest()
  const o = h[h.length - 1] & 15
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** DIGITOS
  return String(n).padStart(DIGITOS, '0')
}
export const pasoActual = (ahora = Date.now()) => Math.floor(ahora / 1000 / PASO_S)

const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

// Acepta la ventana actual y la de antes y después (relojes de teléfono un poco desfasados). Devuelve el paso usado.
function pasoDelCodigo(secretoB32: string, codigo: string, ultimoPaso: number): number | null {
  const ahora = pasoActual()
  for (const p of [ahora, ahora - 1, ahora + 1]) {
    if (p > ultimoPaso && iguales(codigoTotp(secretoB32, p), codigo)) return p
  }
  return null
}

// ---------------------------------------------------------------- cifrado del secreto

const clave = (pimienta: string) => createHmac('sha256', pimienta).update('dos-pasos:secreto').digest()

function cifrar(c: Pimientas, texto: string): string {
  const iv = randomBytes(12)
  const cifrador = createCipheriv('aes-256-gcm', clave(c.pimienta), iv)
  const datos = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()])
  return ['v1', iv, cifrador.getAuthTag(), datos].map((x) => (typeof x === 'string' ? x : x.toString('base64url'))).join('.')
}

// Con el pepper anterior también (rotación): `rehacer` avisa que conviene volver a cifrarlo con el actual.
function descifrar(c: Pimientas, guardado: string): { texto: string; rehacer: boolean } {
  const [v, iv, tag, datos] = guardado.split('.')
  if (v !== 'v1') throw new Error('Secreto de dos pasos con formato desconocido')
  for (const [pimienta, rehacer] of [[c.pimienta, false], [c.pimientaAnterior, true]] as const) {
    if (!pimienta) continue
    try {
      const d = createDecipheriv('aes-256-gcm', clave(pimienta), Buffer.from(iv, 'base64url'))
      d.setAuthTag(Buffer.from(tag, 'base64url'))
      return { texto: Buffer.concat([d.update(Buffer.from(datos, 'base64url')), d.final()]).toString('utf8'), rehacer }
    } catch { /* con la otra clave */ }
  }
  throw new Error('No se pudo descifrar el secreto de dos pasos: ¿cambió AUTH_PEPPER_SECRET sin AUTH_PEPPER_ANTERIOR?')
}

// ---------------------------------------------------------------- códigos de respaldo

const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789' // sin 0/o, 1/l/i: se leen sin confusión
const normalizarRespaldo = (s: string) => s.toLowerCase().replace(/[\s-]/g, '')
const hashRespaldo = (pimienta: string, codigo: string) => createHmac('sha256', pimienta).update(`respaldo:${normalizarRespaldo(codigo)}`).digest('hex')

function nuevosRespaldos() {
  return Array.from({ length: NUM_RESPALDO }, () => {
    const s = Array.from({ length: 10 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('')
    return `${s.slice(0, 5)}-${s.slice(5)}`
  })
}

// ---------------------------------------------------------------- lo que usa el inicio de sesión

export async function tieneDosPasos(db: Db, idUsuario: string): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM dos_pasos WHERE id_usuario = $1 AND activado_en IS NOT NULL`, [idUsuario])
  return rowCount === 1
}

// Revisa un código de la app (6 dígitos) o uno de respaldo y lo gasta: ninguno se acepta dos veces.
export async function usarCodigo(db: Db, c: Pimientas, idUsuario: string, codigo: string): Promise<boolean> {
  const limpio = codigo.trim()
  const { rows: [f] } = await db.query(`SELECT secreto, ultimo_paso FROM dos_pasos WHERE id_usuario = $1 AND activado_en IS NOT NULL`, [idUsuario])
  if (!f) return false

  if (/^\d{6}$/.test(limpio.replace(/\s/g, ''))) {
    const { texto, rehacer } = descifrar(c, f.secreto)
    const paso = pasoDelCodigo(texto, limpio.replace(/\s/g, ''), Number(f.ultimo_paso))
    if (paso === null) return false
    // Condicionado al paso guardado: dos peticiones simultáneas con el mismo código no pasan las dos.
    const { rowCount } = await db.query(
      `UPDATE dos_pasos SET ultimo_paso = $2, secreto = COALESCE($3, secreto) WHERE id_usuario = $1 AND ultimo_paso < $2`,
      [idUsuario, paso, rehacer ? cifrar(c, texto) : null],
    )
    return rowCount === 1
  }

  const hashes = [c.pimienta, c.pimientaAnterior].filter((p): p is string => !!p).map((p) => hashRespaldo(p, limpio))
  const { rowCount } = await db.query(
    `UPDATE dos_pasos SET respaldo = array(SELECT x FROM unnest(respaldo) x WHERE x <> ALL($2::text[]))
      WHERE id_usuario = $1 AND respaldo && $2::text[]`,
    [idUsuario, hashes],
  )
  return rowCount === 1
}

// ---------------------------------------------------------------- rutas de la propia cuenta

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>
const bodyCodigo = z.object({ codigo: z.string().trim().min(6).max(20) })
const bodyDesactivar = z.object({ password: z.string().min(1).max(PASSWORD_MAX), codigo: z.string().trim().min(6).max(20) })

export async function rutasDosPasos(app: FastifyInstance, { db, config }: Contexto, { requiereSesion }: { requiereSesion: Guardia }) {
  const limite = { rateLimit: { max: 10, timeWindow: '1 minute' } }
  const auditar = (idUsuario: string, activa: boolean) =>
    tx(db, idUsuario, (c) => c.query(
      `INSERT INTO auditoria (id_usuario, accion, tabla, id_registro, datos_despues) VALUES ($1, 'UPDATE', 'dos_pasos', $1, $2)`,
      [idUsuario, { dos_pasos: activa }],
    ))

  app.get('/auth/dos-pasos', { preHandler: requiereSesion }, async (req) => {
    const { rows: [f] } = await db.query(`SELECT activado_en, cardinality(respaldo) AS respaldo FROM dos_pasos WHERE id_usuario = $1`, [req.usuario.id])
    return { activa: !!f?.activado_en, desde: f?.activado_en ?? null, respaldoRestante: f?.activado_en ? Number(f.respaldo) : 0 }
  })

  // Paso 1: un secreto nuevo, todavía sin activar. La app lo muestra como QR para escanearlo con el autenticador.
  app.post('/auth/dos-pasos/iniciar', { preHandler: requiereSesion, config: limite }, async (req, rep) => {
    const { rows: [u] } = await db.query(`SELECT correo FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
    const secreto = aBase32(randomBytes(20))
    const { rowCount } = await db.query(
      `INSERT INTO dos_pasos (id_usuario, secreto) VALUES ($1, $2)
       ON CONFLICT (id_usuario) DO UPDATE SET secreto = EXCLUDED.secreto, ultimo_paso = 0, respaldo = '{}', creado_en = now()
        WHERE dos_pasos.activado_en IS NULL`,
      [req.usuario.id, cifrar(config, secreto)],
    )
    if (!rowCount) return rep.code(409).send({ error: 'La verificación en dos pasos ya está activa' })
    const etiqueta = encodeURIComponent(`${EMISOR}:${u.correo}`)
    const uri = `otpauth://totp/${etiqueta}?secret=${secreto}&issuer=${encodeURIComponent(EMISOR)}&algorithm=SHA1&digits=${DIGITOS}&period=${PASO_S}`
    return { secreto, uri }
  })

  // Paso 2: el primer código del autenticador confirma que quedó bien; desde ahora se pide al entrar.
  app.post('/auth/dos-pasos/activar', { preHandler: requiereSesion, config: limite }, async (req, rep) => {
    const body = bodyCodigo.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe el código de 6 dígitos de tu app de autenticación' })
    const { rows: [f] } = await db.query(`SELECT secreto FROM dos_pasos WHERE id_usuario = $1 AND activado_en IS NULL`, [req.usuario.id])
    if (!f) return rep.code(409).send({ error: 'Empieza de nuevo la configuración' })
    const paso = pasoDelCodigo(descifrar(config, f.secreto).texto, body.data.codigo.replace(/\s/g, ''), 0)
    if (paso === null) return rep.code(400).send({ error: 'El código no coincide. Revisa que la hora del teléfono sea automática y escribe el código que se ve ahora.' })
    const respaldo = nuevosRespaldos()
    await db.query(
      `UPDATE dos_pasos SET activado_en = now(), ultimo_paso = $2, respaldo = $3 WHERE id_usuario = $1 AND activado_en IS NULL`,
      [req.usuario.id, paso, respaldo.map((r) => hashRespaldo(config.pimienta, r))],
    )
    await auditar(req.usuario.id, true)
    return { respaldo } // sólo esta vez: en la base quedan como HMAC
  })

  // Quitarla pide la contraseña y un código: con el teléfono de alguien abierto no basta para desactivarla.
  app.post('/auth/dos-pasos/desactivar', { preHandler: requiereSesion, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyDesactivar.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe tu contraseña y un código de verificación' })
    const { rows: [u] } = await db.query(`SELECT password_hash FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
    if (!(await verificarPassword(config, u.password_hash, body.data.password)).ok) return rep.code(401).send({ error: 'La contraseña no es correcta' })
    if (!(await usarCodigo(db, config, req.usuario.id, body.data.codigo))) return rep.code(401).send({ error: 'El código no es correcto o ya se usó' })
    await db.query(`DELETE FROM dos_pasos WHERE id_usuario = $1`, [req.usuario.id])
    await auditar(req.usuario.id, false)
    return rep.code(204).send()
  })

  // Códigos de respaldo nuevos (los anteriores dejan de servir). Pide un código vigente.
  app.post('/auth/dos-pasos/respaldo', { preHandler: requiereSesion, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, rep) => {
    const body = bodyCodigo.safeParse(req.body)
    if (!body.success) return rep.code(400).send({ error: 'Escribe un código de tu app de autenticación' })
    if (!(await usarCodigo(db, config, req.usuario.id, body.data.codigo))) return rep.code(401).send({ error: 'El código no es correcto o ya se usó' })
    const respaldo = nuevosRespaldos()
    await db.query(`UPDATE dos_pasos SET respaldo = $2 WHERE id_usuario = $1`, [req.usuario.id, respaldo.map((r) => hashRespaldo(config.pimienta, r))])
    return { respaldo }
  })
}
