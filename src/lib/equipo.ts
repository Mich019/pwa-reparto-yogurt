import { useSyncExternalStore } from 'react'
import { llamarAutenticado, type Rol } from './sesion'
import { sincronizar } from './sync'
import { suscribir } from './enVivo'

// Cuentas del equipo y cartera de clientes (RF-038 a RF-041). Sólo el administrador; requiere conexión.

export interface Miembro {
  id: string
  nombre: string
  correo: string
  telefono: string
  foto: string | null
  rol: Rol
  activo: boolean
  debeCambiarPassword: boolean // todavía no ha elegido su contraseña
  bloqueadoHasta: string | null
  ultimoAcceso: string | null
  creadoEn: string
  clientes: number
  clientesActivos: number
  comisionPct: number // % de comisión sobre lo vendido en el mes (0 = sin comisión)
  metaMensual: number | null
  dispositivosPush: number // teléfonos o computadoras con los avisos activados
  avisosApagados: string[] // tipos que apagó en Preferencias
}
export interface Equipo {
  usuarios: Miembro[]
  clientesSinAsignar: number
}

let equipo: Equipo | null = null
const oyentes = new Set<() => void>()
// Mientras alguna pantalla lo use, se vuelve a pedir solo cuando cambia una cuenta o la cartera (lib/enVivo.ts). Una sola
// vez aunque lo usen varios componentes a la vez.
let dejarDeEscuchar: (() => void) | null = null
export const useEquipo = () =>
  useSyncExternalStore((f) => {
    oyentes.add(f)
    dejarDeEscuchar ??= suscribir(['equipo', 'datos'], () => void cargarEquipo().catch(() => {}))
    return () => {
      oyentes.delete(f)
      if (!oyentes.size) { dejarDeEscuchar?.(); dejarDeEscuchar = null }
    }
  }, () => equipo)

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

export async function editarMiembro(id: string, d: Partial<{ nombre: string; correo: string; telefono: string; rol: Rol; comisionPct: number; metaMensual: number | null }>) {
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

// Los meses cerrados en que un vendedor llegó a su meta (trofeo de su ficha).
export interface Trofeos {
  meses: { mes: string; ventas: number; meta: number }[]
  racha: number
  mejorRacha: number
  historial: { mes: string; ventas: number; meta: number | null; cumplimientoPct: number | null }[] // últimos 12 meses cerrados
}
export function metasCumplidas(id: string) {
  return llamarAutenticado<Trofeos>(`/usuarios/${id}/metas`)
}

// La misma meta del mes para todos los vendedores activos (null la quita), o lo que vendió cada uno el mes pasado más
// un porcentaje (`sinVentas`: los que no vendieron nada y se quedan con la suya).
export async function metaParaTodos(cuerpo: { metaMensual: number | null } | { pctMesAnterior: number }) {
  const r = await llamarAutenticado<{ actualizados: number; sinVentas: number }>('/usuarios/metas', { metodo: 'POST', cuerpo })
  refrescar()
  return r
}

// Racha y mejor racha de cada vendedor con algún mes cumplido (ranking del panel).
export type Rachas = Record<string, { nombre: string; racha: number; mejorRacha: number; medallas: { medalla: number; mes: string }[]; cumplidos: number }>

// Lo que vendió cada vendedor activo el mes pasado, para la vista previa de «según su mes pasado».
export function ventasMesPasado() {
  return llamarAutenticado<{ ventas: Record<string, number> }>('/usuarios/metas/mes-pasado').then((r) => r.ventas)
}

// Aviso de prueba a los dispositivos de otra cuenta (api/_lib/notificaciones.ts).
export function avisoDePrueba(id: string) {
  return llamarAutenticado<{ dispositivos: number; enviados: number }>(`/usuarios/${id}/aviso-prueba`, { metodo: 'POST' })
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
