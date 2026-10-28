import { useEffect, useSyncExternalStore } from 'react'
import { llamarAutenticado } from './sesion'

// La suscripción de la empresa (api/_lib/suscripcion.ts), compartida por el panel: el aviso de días de prueba, la
// pantalla de cobro cuando se acaba y la sección de Configuración.

export interface Suscripcion {
  estado: 'exenta' | 'prueba' | 'activa' | 'vencida'
  pruebaHasta: string
  diasPrueba: number
  suscripcion: 'pending' | 'authorized' | 'paused' | 'cancelled' | null
  precio: number
  moneda: string
  cobroDisponible: boolean
}

let actual: Suscripcion | null = null
let deQuien: string | undefined // la cuenta de la que es: otra sesión en el mismo navegador la vuelve a pedir
const oyentes = new Set<() => void>()
const fijar = (s: Suscripcion | null) => {
  actual = s
  oyentes.forEach((f) => f())
}

// Al volver de Mercado Pago la dirección trae ?suscripcion=volver: se pregunta a Mercado Pago sin esperar su aviso.
function volvioDePagar() {
  const u = new URL(window.location.href)
  if (u.searchParams.get('suscripcion') !== 'volver') return false
  u.searchParams.delete('suscripcion')
  window.history.replaceState({}, '', u.pathname + u.search + u.hash)
  return true
}

export async function cargarSuscripcion(actualizar = false) {
  try {
    fijar(await llamarAutenticado<Suscripcion>(`/suscripcion${actualizar ? '?actualizar=1' : ''}`))
  } catch {
    // Sin conexión o sin permiso: el panel sigue como estaba.
  }
  return actual
}

export function useSuscripcion(idUsuario: string | undefined) {
  useEffect(() => {
    if (!idUsuario || idUsuario === deQuien) return
    deQuien = idUsuario
    fijar(null)
    void cargarSuscripcion(volvioDePagar())
  }, [idUsuario])
  return useSyncExternalStore(
    (f) => {
      oyentes.add(f)
      return () => oyentes.delete(f)
    },
    () => actual,
  )
}

// Crea la suscripción y lleva a Mercado Pago a poner la tarjeta.
export async function suscribirse() {
  const { url } = await llamarAutenticado<{ url: string }>('/suscripcion', { metodo: 'POST' })
  window.location.assign(url)
}

export async function cancelarSuscripcion() {
  fijar(await llamarAutenticado<Suscripcion>('/suscripcion/cancelar', { metodo: 'POST' }))
}
