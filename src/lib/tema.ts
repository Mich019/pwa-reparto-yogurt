import { useEffect, useSyncExternalStore } from 'react'

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

// Más preferencias del panel, también de cada navegador: el tamaño del texto (todo va en rem, así que basta con el
// tamaño de la raíz), menos movimiento (tema.css) y el orden del menú del panel (views/admin/menu.ts).
export type TamanoTexto = 'normal' | 'grande' | 'mas-grande'
// El color del fondo en el tema claro: crema, blanco o gris. Vive en la cuenta (usuarios.fondo, migración 040; las
// cuentas nuevas empiezan en blanco) con una copia aquí para pintarlo al instante; aparte de los colores de la empresa
// (Marca): no cambia el logo ni el color de la marca, sólo el lienzo de atrás. Se elige con `elegirFondo` (sesion.ts).
export type Fondo = 'crema' | 'blanco' | 'gris'
export const COLOR_FONDO: Record<Fondo, string> = { crema: '#f8f6ec', blanco: '#ffffff', gris: '#f1f2f0' }
export interface PreferenciasPanel { texto: TamanoTexto; menosMovimiento: boolean; ordenMenu: string[]; fondo: Fondo }
const CLAVE_PREF = 'preferencias-panel'
const PREF_INICIAL: PreferenciasPanel = { texto: 'normal', menosMovimiento: false, ordenMenu: [], fondo: 'crema' }
export const TAMANOS: Record<TamanoTexto, string> = { normal: '100%', grande: '112.5%', 'mas-grande': '125%' }

let preferencias: PreferenciasPanel = (() => {
  try {
    const p = { ...PREF_INICIAL, ...JSON.parse(localStorage.getItem(CLAVE_PREF) ?? '{}') }
    return Array.isArray(p.ordenMenu) ? p : { ...p, ordenMenu: [] }
  } catch {
    return PREF_INICIAL
  }
})()

export function cambiarPreferencias(cambio: Partial<PreferenciasPanel>) {
  preferencias = { ...preferencias, ...cambio }
  try { localStorage.setItem(CLAVE_PREF, JSON.stringify(preferencias)) } catch { /* sin almacenamiento: vale mientras la página siga abierta */ }
  avisar()
}
export const usePreferenciasPanel = () => useSyncExternalStore(suscribir, () => preferencias)
export const preferenciasPanel = () => preferencias

// El fondo vale en el panel y en la app de reparto (los dos usan `.tema-admin`), por eso lo pone App.tsx siempre:
// `html.fondo-blanco` / `html.fondo-gris` (views/admin/tema.css), y el color de la barra del navegador a juego.
export function useAplicarFondo() {
  const { fondo } = usePreferenciasPanel()
  const oscuro = useTemaOscuro()
  useEffect(() => {
    const raiz = document.documentElement
    raiz.classList.toggle('fondo-blanco', fondo === 'blanco')
    raiz.classList.toggle('fondo-gris', fondo === 'gris')
    if (!oscuro) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_FONDO[fondo] ?? COLOR_FONDO.crema)
  }, [fondo, oscuro])
}

// Pone el tamaño del texto y «menos movimiento» en la página mientras el panel está abierto; al salir los quita, para
// que la app de reparto siga como estaba.
export function useAplicarPreferencias() {
  const p = usePreferenciasPanel()
  useEffect(() => {
    const raiz = document.documentElement
    raiz.style.fontSize = TAMANOS[p.texto] ?? ''
    raiz.classList.toggle('menos-movimiento', p.menosMovimiento)
    return () => { raiz.style.fontSize = ''; raiz.classList.remove('menos-movimiento') }
  }, [p.texto, p.menosMovimiento])
}

