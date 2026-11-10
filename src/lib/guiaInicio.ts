import { useEffect, useSyncExternalStore } from 'react'
import { BarChart3, IceCreamBowl, LayoutDashboard, Map, MapPin, Package, Settings, Sparkles, User, Users, Wallet, type LucideIcon } from 'lucide-react'

// Guía de la primera vez: un recorrido corto que se muestra una sola vez al entrar al panel o a la app de reparto.
// Cada paso abre la sección real y resalta su botón real de la navegación (el que lleva data-seccion). Aquí van los
// pasos como datos y el estado (qué paso va, si ya se vio); el dibujo está en components/GuiaInicio.tsx y quien abre
// las secciones es cada pantalla principal (AdminLayout, PwaLayout). El panel de la plataforma no la lleva.
// Una frase por paso, con lo que se puede hacer ahí. Pocos pasos: uno de bienvenida, uno por sección principal y, en
// Finanzas, uno más para sus pestañas (`abrir`: la sección que se abre cuando lo resaltado no es un botón del menú).

export type DondeGuia = 'panel' | 'app'
export interface PasoGuia { seccion: string | null; abrir?: string; icono: LucideIcon; titulo: string; texto: string }

export const PASOS_PANEL: PasoGuia[] = [
  { seccion: null, icono: Sparkles, titulo: 'Te damos la bienvenida', texto: 'En un minuto te mostramos para qué sirve cada parte del panel.' },
  { seccion: 'resumen', icono: LayoutDashboard, titulo: 'Resumen', texto: 'Aquí ves de un vistazo lo cobrado hoy, las ventas y los pedidos del día.' },
  { seccion: 'equipo', icono: Users, titulo: 'Vendedores', texto: 'Aquí invitas a tu equipo y le repartes sus clientes.' },
  { seccion: 'clientes', icono: MapPin, titulo: 'Clientes', texto: 'Aquí das de alta a tus clientes y ves lo que compra cada uno.' },
  { seccion: 'cobranza', icono: Wallet, titulo: 'Finanzas', texto: 'Aquí ves quién te debe, confirmas los cortes del día y cierras el mes.' },
  { seccion: 'finanzas-pestanas', abrir: 'cobranza', icono: Wallet, titulo: 'Sus cuatro pestañas', texto: 'Por cobrar, Envases, Cortes del día y Cierre de mes. Debajo, cuatro cifras de un vistazo: tócalas para ir directo.' },
  { seccion: 'configuracion', icono: Settings, titulo: 'Configuración', texto: 'Aquí pones tu logo y cambias tus preferencias. Esta guía también está aquí, en Ayuda.' },
]

// Los de la app se filtran por las pestañas que tiene cada quien (PwaLayout): Stock y Cuenta con servidor; Producción y
// Sabores sin él.
export const PASOS_APP: PasoGuia[] = [
  { seccion: null, icono: Sparkles, titulo: 'Te damos la bienvenida', texto: 'En un minuto te mostramos para qué sirve cada parte de la app.' },
  { seccion: 'ruta', icono: Map, titulo: 'Ruta', texto: 'Aquí ves tus entregas de hoy en orden y marcas cada pedido al entregarlo.' },
  { seccion: 'clientes', icono: Users, titulo: 'Clientes', texto: 'Aquí buscas a un cliente, le tomas un pedido o le cobras lo que debe.' },
  { seccion: 'stock', icono: Package, titulo: 'Stock', texto: 'Aquí ves cuánto producto llevas hoy y cuánto te queda.' },
  { seccion: 'produccion', icono: BarChart3, titulo: 'Producción', texto: 'Aquí ves cuánto producir para los próximos días.' },
  { seccion: 'sabores', icono: IceCreamBowl, titulo: 'Sabores', texto: 'Aquí agregas tus sabores y cambias sus precios. Esta guía también está aquí.' },
  { seccion: 'cuenta', icono: User, titulo: 'Cuenta', texto: 'Aquí entregas tu corte y cambias tus ajustes. Esta guía también está aquí, en Ayuda.' },
]

// ---- estado: el paso que va en cada lado (null = cerrada) y la bandera «ya la vio» por cuenta en este navegador
const paso: Record<DondeGuia, number | null> = { panel: null, app: null }
let quien = 'local'
const oyentes = new Set<() => void>()
const avisar = () => oyentes.forEach((f) => f())
const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f) } }
const clave = (donde: DondeGuia) => `delisy:guia-vista:${donde}:${quien}`

export function guiaVista(donde: DondeGuia) {
  try { return !!localStorage.getItem(clave(donde)) } catch { return true } // sin almacenamiento saldría cada vez: mejor nunca
}
export function irAPasoGuia(donde: DondeGuia, n: number) { paso[donde] = n; avisar() }
export function terminarGuia(donde: DondeGuia) {
  try { localStorage.setItem(clave(donde), '1') } catch { /* sin almacenamiento */ }
  paso[donde] = null
  avisar()
}
// «Ver la guía otra vez» (Ayuda): la reinicia desde la bienvenida.
export function verGuia(donde: DondeGuia) {
  try { localStorage.removeItem(clave(donde)) } catch { /* sin almacenamiento */ }
  irAPasoGuia(donde, 0)
}

// El paso que va (null = cerrada). La primera vez de esta cuenta aquí se abre sola, poco después de entrar; `lista`
// en falso la detiene mientras haya otra cosa que atender antes (sin sesión, un enlace a una guía…).
export function useGuiaInicio(donde: DondeGuia, idUsuario: string | undefined, lista = true) {
  useEffect(() => {
    quien = idUsuario ?? 'local'
    if (!lista || guiaVista(donde) || paso[donde] !== null) return
    const t = setTimeout(() => irAPasoGuia(donde, 0), 900)
    return () => clearTimeout(t)
  }, [donde, idUsuario, lista])
  return useSyncExternalStore(suscribir, () => paso[donde])
}
export const useGuiaVista = (donde: DondeGuia) => useSyncExternalStore(suscribir, () => guiaVista(donde))
