import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { construirApp } from '../_lib/app.js'
import { hashPassword } from '../_lib/auth.js'
import { leerConfig } from '../_lib/config.js'
import { crearPool } from '../_lib/db.js'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET ??= 'x'.repeat(40)
process.env.DATABASE_URL ??= 'postgres://postgres:test@localhost:5432/reparto_yogurt_test'

export const PASSWORD = 'Yogurt2026!'
export const config = leerConfig()
export const db = crearPool(config.conexion)
export const app: FastifyInstance = await construirApp({ db, config })
const HASH = await hashPassword(PASSWORD)

export async function crearUsuario(rol: 'administrador' | 'vendedor', extra: { debeCambiar?: boolean; activo?: boolean } = {}) {
  const correo = `${rol}-${randomUUID().slice(0, 8)}@prueba.local`
  const { rows } = await db.query(
    `INSERT INTO usuarios (nombre, correo, password_hash, rol, debe_cambiar_password, activo) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_usuario`,
    [`Prueba ${rol}`, correo, HASH, rol, extra.debeCambiar ?? false, extra.activo ?? true],
  )
  return { id: rows[0].id_usuario as string, correo }
}

export async function login(correo: string, password = PASSWORD, dispositivo = 'prueba') {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { correo, password, dispositivo } })
  return { status: r.statusCode, body: r.json() }
}

export async function sesion(rol: 'administrador' | 'vendedor', dispositivo = 'tel-1') {
  const u = await crearUsuario(rol)
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
