import { randomInt, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { construirApp } from '../_lib/app.js'
import { leerConfig } from '../_lib/config.js'
import { hashPassword } from '../_lib/contrasenas.js'
import { crearPool } from '../_lib/db.js'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'x'.repeat(40)
process.env.AUTH_PEPPER_SECRET ??= 'p'.repeat(40)
process.env.DATABASE_URL ??= 'postgres://postgres:test@localhost:5432/reparto_yogurt_test'

export const PASSWORD = 'Yogurt2026!'
export const config = leerConfig()

// Multiempresa: las pruebas preparan sus datos directo en la base, como el dueño (sin reglas por filas). Esa conexión
// trae por omisión la primera empresa (la crea 03_datos_iniciales.sql), así los INSERT de siempre tienen dueño. La API,
// en cambio, corre cada petición dentro de la empresa del usuario que llama.
const conOpciones = (extra: string) => ({ ...config.conexion, options: [config.conexion.options, extra].filter(Boolean).join(' ') })
export const EMPRESA: string = await (async () => {
  const cx = new pg.Client(config.conexion)
  await cx.connect()
  try {
    await cx.query(`INSERT INTO empresas (nombre) SELECT 'Empresa principal' WHERE NOT EXISTS (SELECT 1 FROM empresas)`)
    return (await cx.query(`SELECT id_empresa FROM empresas ORDER BY creado_en, id_empresa LIMIT 1`)).rows[0].id_empresa
  } finally {
    await cx.end()
  }
})()
export const db = crearPool(conOpciones(`-c app.id_empresa=${EMPRESA}`))
export const app: FastifyInstance = await construirApp({ db, config })

// Otra empresa en la misma base, para probar que ninguna ve lo de la otra.
export async function crearEmpresa(nombre = `Empresa ${randomUUID().slice(0, 6)}`) {
  return (await db.query(`INSERT INTO empresas (nombre) VALUES ($1) RETURNING id_empresa`, [nombre])).rows[0].id_empresa as string
}
const HASH = await hashPassword(config, PASSWORD)

// Cada inicio de sesión de prueba sale de una IP distinta: los límites de intentos (RF-003) cuentan por IP y en la
// base de pruebas quedan los de corridas anteriores. Las pruebas de esos límites pasan una IP fija.
export const ipAleatoria = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`

export async function crearUsuario(rol: 'administrador' | 'vendedor', extra: { debeCambiar?: boolean; activo?: boolean; empresa?: string } = {}) {
  const correo = `${rol}-${randomUUID().slice(0, 8)}@prueba.local`
  const { rows } = await db.query(
    `INSERT INTO usuarios (id_empresa, nombre, correo, password_hash, rol, debe_cambiar_password, activo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id_usuario`,
    [extra.empresa ?? EMPRESA, `Prueba ${rol}`, correo, HASH, rol, extra.debeCambiar ?? false, extra.activo ?? true],
  )
  return { id: rows[0].id_usuario as string, correo }
}

export async function login(correo: string, password = PASSWORD, dispositivo = 'prueba', ip = ipAleatoria()) {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { correo, password, dispositivo }, remoteAddress: ip })
  return { status: r.statusCode, body: r.json() }
}

export async function sesion(rol: 'administrador' | 'vendedor', dispositivo = 'tel-1', empresa?: string) {
  const u = await crearUsuario(rol, { empresa })
  const { body } = await login(u.correo, PASSWORD, dispositivo)
  return { ...u, token: body.accessToken as string, refreshToken: body.refreshToken as string, dispositivo }
}

// Otro teléfono del mismo usuario.
export async function otroTelefono(s: { correo: string; id: string }, dispositivo: string) {
  const { body } = await login(s.correo, PASSWORD, dispositivo)
  return { ...s, token: body.accessToken as string, refreshToken: body.refreshToken as string, dispositivo }
}

type S = { token: string; dispositivo: string }
const auth = (s: S) => ({ authorization: `Bearer ${s.token}` })

export async function push(s: S, operaciones: unknown[], ahoraCliente = Date.now(), servidor: FastifyInstance = app) {
  const r = await servidor.inject({ method: 'POST', url: '/sync/push', headers: auth(s), payload: { dispositivo: s.dispositivo, ahoraCliente, operaciones } })
  return { status: r.statusCode, body: r.json() }
}
export async function pull(s: S, desde = 0, servidor: FastifyInstance = app) {
  const r = await servidor.inject({ method: 'GET', url: `/sync/pull?desde=${desde}`, headers: auth(s) })
  return { status: r.statusCode, body: r.json() }
}
export async function get(s: S, url: string) {
  const r = await app.inject({ method: 'GET', url, headers: auth(s) })
  return { status: r.statusCode, body: r.json() }
}

export const op = (tabla: string, registroId: string, datos: unknown, version = 0, ts = Date.now()) => ({ id: randomUUID(), tabla, registroId, op: 'put', version, ts, datos })
export const borrarOp = (tabla: string, registroId: string, version = 0, ts = Date.now()) => ({ id: randomUUID(), tabla, registroId, op: 'delete', version, ts })

export function cliente(over: Record<string, unknown> = {}) {
  const ahora = Date.now()
  return {
    id: randomUUID(), nombre: 'Doña Lupita', direccion: 'Hidalgo 12', latitud: 19.43, longitud: -99.13, telefono: '5511223344',
    frecuencia: { tipo: 'semana', dias: [2, 5] }, ventana: 'MAÑANA', qr_uuid: randomUUID(), activo: true, creado: ahora, actualizado: ahora, ...over,
  }
}
export function pedido(clienteId: string, productoId: string, over: Record<string, unknown> = {}) {
  const ahora = Date.now()
  return {
    id: randomUUID(), clienteId, fecha: '2026-10-20', estado: 'PENDIENTE', items: [{ productoId, litros: 3, precio_litro: 60 }],
    creado: ahora, actualizado: ahora, ...over,
  }
}
export async function sabores(s: S) {
  const { body } = await pull(s)
  return body.productos as { id: string; sabor: string; precio_litro: number; costo_litro: number; version: number }[]
}

// Una base propia (esquema aparte) para lo que depende de cuántos administradores o clientes sin vendedor hay en total.
export async function enBaseAislada(prueba: (x: { srv: FastifyInstance; pool: pg.Pool; usuario: (nombre: string, rol: 'administrador' | 'vendedor') => Promise<S & { id: string }> }) => Promise<void>) {
  const esquema = `aislado_${randomUUID().slice(0, 8)}`
  const cx = new pg.Client(config.conexion)
  await cx.connect()
  await cx.query(`CREATE SCHEMA ${esquema}`)
  await cx.query(`SET search_path TO ${esquema}`)
  // Tablas y vistas, como la base real (la libreta de clientes usa v_resumen_cliente).
  for (const f of ['01_esquema.sql', '02_vistas.sql']) await cx.query(readFileSync(new URL(`../../db/${f}`, import.meta.url), 'utf8'))
  const empresa = (await cx.query(`INSERT INTO empresas (nombre) VALUES ('Empresa aislada') RETURNING id_empresa`)).rows[0].id_empresa
  const pool = new pg.Pool({ ...conOpciones(`-c search_path=${esquema} -c app.id_empresa=${empresa}`), max: 4 })
  const srv = await construirApp({ db: pool, config })
  const hash = await hashPassword(config, PASSWORD)
  const usuario = async (nombre: string, rol: 'administrador' | 'vendedor') => {
    const correo = `${nombre}@prueba.local`
    const { rows } = await pool.query(`INSERT INTO usuarios (nombre, correo, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id_usuario`, [nombre, correo, hash, rol])
    const r = await srv.inject({ method: 'POST', url: '/auth/login', payload: { correo, password: PASSWORD, dispositivo: nombre } })
    return { id: rows[0].id_usuario as string, token: r.json().accessToken as string, dispositivo: nombre }
  }
  try {
    await prueba({ srv, pool, usuario })
  } finally {
    await srv.close()
    await pool.end()
    await cx.query(`DROP SCHEMA ${esquema} CASCADE`)
    await cx.end()
  }
}
