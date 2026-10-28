import { useSyncExternalStore } from 'react'
import { llamarAutenticado, type Rol } from './sesion'
import { sincronizar } from './sync'

// Cuentas del equipo y cartera de clientes (RF-038 a RF-041). Sólo el administrador; requiere conexión.

export interface Miembro {
  id: string
  nombre: string
  correo: string
  telefono: string
  rol: Rol
  activo: boolean
  debeCambiarPassword: boolean // todavía no ha elegido su contraseña
  bloqueadoHasta: string | null
  ultimoAcceso: string | null
  creadoEn: string
  clientes: number
  clientesActivos: number
}
export interface Equipo {
  usuarios: Miembro[]
  clientesSinAsignar: number
}

let equipo: Equipo | null = null
const oyentes = new Set<() => void>()
export const useEquipo = () =>
  useSyncExternalStore((f) => { oyentes.add(f); return () => { oyentes.delete(f) } }, () => equipo)

export async function cargarEquipo(): Promise<Equipo> {
  equipo = await llamarAutenticado<Equipo>('/usuarios')
  oyentes.forEach((f) => f())
  return equipo
}
const refrescar = () => void cargarEquipo().catch(() => {})

export async function crearMiembro(d: { nombre: string; correo: string; telefono?: string; rol: Rol }) {
  const r = await llamarAutenticado<{ usuario: Miembro; passwordTemporal: string }>('/usuarios', { metodo: 'POST', cuerpo: d })
  refrescar()
  return r
}

// Le llega un enlace por correo para crear su propia contraseña (api/_lib/registro.ts); la cuenta aparece al aceptarlo.
export const invitar = (correo: string) =>
  llamarAutenticado<{ correo: string; dias: number }>('/invitaciones', { metodo: 'POST', cuerpo: { correo } })

export async function editarMiembro(id: string, d: Partial<{ nombre: string; correo: string; telefono: string; rol: Rol }>) {
  const r = await llamarAutenticado<{ usuario: Miembro }>(`/usuarios/${id}`, { metodo: 'PATCH', cuerpo: d })
  refrescar()
  return r.usuario
}

export async function restablecerPassword(id: string) {
  const r = await llamarAutenticado<{ passwordTemporal: string }>(`/usuarios/${id}/password`, { metodo: 'POST' })
  refrescar()
  return r.passwordTemporal
}

export async function darDeBaja(id: string) {
  await llamarAutenticado(`/usuarios/${id}/baja`, { metodo: 'POST' })
  refrescar()
}

export async function reactivar(id: string) {
  await llamarAutenticado(`/usuarios/${id}/reactivar`, { metodo: 'POST' })
  refrescar()
}

export interface ResultadoReasignar { clientes: number; pedidos: number; recordatorios: number }

// `hacia: null` los deja sin vendedor. Con `clienteIds` pasan sólo esos; con `desde` toda la cartera de ese vendedor
// (`desde: null` = los que hoy no tienen vendedor). Después se sincroniza para que este teléfono vea el cambio.
export async function reasignarClientes(d: { hacia: string | null } & ({ clienteIds: string[] } | { desde: string | null })) {
  const r = await llamarAutenticado<ResultadoReasignar>('/clientes/reasignar', { metodo: 'POST', cuerpo: d })
  refrescar()
  void sincronizar()
  return r
}

export function textoReasignado(r: ResultadoReasignar, destino: string) {
  if (!r.clientes) return 'No había clientes por pasar'
  const pedidos = r.pedidos ? `, con ${r.pedidos} ${r.pedidos === 1 ? 'pedido agendado' : 'pedidos agendados'}` : ''
  return `${r.clientes} ${r.clientes === 1 ? 'cliente pasó' : 'clientes pasaron'} ${destino}${pedidos}`
}
