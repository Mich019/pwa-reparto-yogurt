import { BarChart3, ChartLine, HandCoins, IceCreamBowl, LayoutDashboard, MapPin, Settings, Users } from 'lucide-react'
import { guardarPerfil } from '../../lib/sesion'
import { cambiarPreferencias, usePreferenciasPanel } from '../../lib/tema'

// Las secciones del panel. El orden de aquí es el de fábrica; cada quien puede cambiarlo en Configuración → Apariencia
// (se guarda en la cuenta, usuarios.orden_menu, y una copia en el navegador para pintarlo al instante y sin señal).
// Configuración no se mueve: siempre va al final.
export type SeccionAdmin = 'resumen' | 'equipo' | 'clientes' | 'produccion' | 'sabores' | 'cobranza' | 'reportes' | 'configuracion'

export const PESTANAS: { id: SeccionAdmin; texto: string; icono: typeof Users }[] = [
  { id: 'resumen', texto: 'Resumen', icono: LayoutDashboard },
  { id: 'equipo', texto: 'Vendedores', icono: Users },
  { id: 'clientes', texto: 'Clientes', icono: MapPin },
  { id: 'produccion', texto: 'Producción', icono: BarChart3 },
  { id: 'sabores', texto: 'Sabores', icono: IceCreamBowl },
  { id: 'cobranza', texto: 'Cobranza', icono: HandCoins },
  { id: 'reportes', texto: 'Reportes', icono: ChartLine },
  { id: 'configuracion', texto: 'Configuración', icono: Settings },
]

// Lo guardado manda; lo que no esté ahí (una sección nueva, o un valor viejo) sigue en su lugar de fábrica, al final.
export function ordenarMenu(orden: string[]) {
  const pos = (id: string) => { const i = orden.indexOf(id); return i < 0 ? orden.length + PESTANAS.findIndex((p) => p.id === id) : i }
  const movibles = PESTANAS.filter((p) => p.id !== 'configuracion').sort((a, b) => pos(a.id) - pos(b.id))
  return [...movibles, PESTANAS.find((p) => p.id === 'configuracion')!]
}

export const useMenu = () => ordenarMenu(usePreferenciasPanel().ordenMenu)

// [] = el de fábrica. Se ve al momento; si no llega a la cuenta (sin señal), avisa y queda en este navegador.
export async function guardarOrdenMenu(orden: SeccionAdmin[]) {
  cambiarPreferencias({ ordenMenu: orden })
  await guardarPerfil({ ordenMenu: orden })
}
