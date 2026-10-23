import { useSyncExternalStore } from 'react'

// Tema del panel de administración (claro, oscuro o el del sistema). Es una preferencia de cada navegador: se guarda
// aquí y no en el servidor. La app de reparto no la usa (views/admin/tema.css).

export type PreferenciaTema = 'claro' | 'oscuro' | 'sistema'
const CLAVE = 'tema-panel'
const oyentes = new Set<() => void>()
const sistemaOscuro = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

function leer(): PreferenciaTema {
  try {
    const v = localStorage.getItem(CLAVE)
    return v === 'claro' || v === 'oscuro' ? v : 'sistema'
  } catch {
    return 'sistema'
  }
}

let preferencia = leer()
const avisar = () => oyentes.forEach((f) => f())
sistemaOscuro?.addEventListener('change', avisar)

export function cambiarTema(p: PreferenciaTema) {
  preferencia = p
  try {
    if (p === 'sistema') localStorage.removeItem(CLAVE)
    else localStorage.setItem(CLAVE, p)
  } catch { /* sin almacenamiento: vale mientras la página siga abierta */ }
  avisar()
}

const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f) } }
export const usePreferenciaTema = () => useSyncExternalStore(suscribir, () => preferencia)
// true si el panel debe verse oscuro ahora mismo (en «sistema», según el sistema operativo).
export const useTemaOscuro = () =>
  useSyncExternalStore(suscribir, () => preferencia === 'oscuro' || (preferencia === 'sistema' && !!sistemaOscuro?.matches))
