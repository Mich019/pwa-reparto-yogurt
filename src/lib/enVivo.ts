import { useEffect, useRef, useSyncExternalStore } from 'react'
import { API_URL, MODO_SERVIDOR } from './api'
import { expirarToken, tokenValido } from './sesion'

// Cambios en vivo (api/_lib/envivo.ts, GET /eventos). Una sola conexión por pestaña, que abre el layout (el padre) con
// `useConexionEnVivo()`. Cada pantalla (los hijos) dice qué área le interesa con `useEnVivo(area, fn)` y vuelve a
// pedir sólo lo suyo, sin desmontarse ni mostrar «cargando»: lo que ya se veía se queda hasta que llega lo nuevo.
// El servidor sólo manda la senal «cambió tal área»; los datos siguen yendo por sus rutas de siempre.
//
// Con la pestaña oculta la conexión se cierra (no gasta servidor ni batería); al volver se abre otra vez y se avisa a
// todas las áreas, por si algo cambió mientras tanto.

export type AreaEnVivo = 'datos' | 'cobranza' | 'equipo'
const TODAS: AreaEnVivo[] = ['datos', 'cobranza', 'equipo']

const oyentes = new Map<AreaEnVivo, Set<() => void>>()
function avisar(areas: string[]) {
  for (const a of areas) oyentes.get(a as AreaEnVivo)?.forEach((f) => f())
}

// ------------------------------------------------------------------ estado de la conexión (para el indicador)
let conectado = false
const oyentesEstado = new Set<() => void>()
function fijarConectado(si: boolean) {
  if (si === conectado) return
  conectado = si
  oyentesEstado.forEach((f) => f())
}
export const enVivoConectado = () => conectado
export const useEnVivoConectado = () =>
  useSyncExternalStore((f) => { oyentesEstado.add(f); return () => { oyentesEstado.delete(f) } }, () => conectado)

// ------------------------------------------------------------------ la conexión
// Lee el flujo de eventos con fetch (no EventSource) para poder mandar el token en la cabecera y no en la dirección.
async function escuchar(senal: AbortSignal): Promise<'otra-vez' | 'fin'> {
  const token = await tokenValido()
  if (token === null) throw new Error('sin sesión')
  const r = await fetch(`${API_URL}/eventos`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: senal })
  if (r.status === 401) { expirarToken(); throw new Error('token vencido') }
  if (!r.ok || !r.body) throw new Error(`eventos: ${r.status}`)
  const lector = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let resto = ''
  for (;;) {
    const { value, done } = await lector.read()
    if (done) return 'otra-vez'
    resto += value
    let corte: number
    while ((corte = resto.indexOf('\n\n')) >= 0) {
      const bloque = resto.slice(0, corte)
      resto = resto.slice(corte + 2)
      const evento = /^event: (.+)$/m.exec(bloque)?.[1]
      const datos = /^data: (.+)$/m.exec(bloque)?.[1]
      if (evento === 'hola') fijarConectado(true)
      else if (evento === 'cambio' && datos) avisar((JSON.parse(datos) as { areas: string[] }).areas)
      else if (evento === 'fin') return 'fin'
    }
  }
}

// Mantiene la conexión mientras la pestaña está a la vista. Devuelve la función que la cierra.
function iniciar(): () => void {
  let parar: AbortController | null = null
  let despertar: (() => void) | null = null
  let corriendo = false
  let fallos = 0
  let vivo = true
  const aLaVista = () => vivo && document.visibilityState === 'visible'

  async function bucle() {
    if (corriendo) return
    corriendo = true
    while (aLaVista()) {
      parar = new AbortController()
      try {
        const como = await escuchar(parar.signal)
        fallos = 0
        if (como === 'fin') break // la sesión terminó: el resto de la app ya lo maneja
      } catch {
        if (!parar.signal.aborted) fallos++
      } finally {
        parar = null
        fijarConectado(false)
      }
      if (!aLaVista()) break
      // Reintento con espera creciente (1 s, 2 s, 4 s… hasta 30 s) si falla; enseguida si sólo se cerró por tiempo.
      const ms = fallos ? Math.min(30_000, 1000 * 2 ** (fallos - 1)) : 200
      await new Promise<void>((listo) => {
        const t = setTimeout(listo, ms)
        despertar = () => { clearTimeout(t); listo() }
      })
      despertar = null
    }
    corriendo = false
  }

  const alCambiarVista = () => {
    if (aLaVista()) {
      if (!corriendo) { avisar(TODAS); void bucle() } else despertar?.() // sin señal esperaba: que lo intente ya
    } else {
      parar?.abort()
      despertar?.()
    }
  }
  document.addEventListener('visibilitychange', alCambiarVista)
  window.addEventListener('online', alCambiarVista)
  void bucle()
  return () => {
    vivo = false
    parar?.abort()
    despertar?.()
    document.removeEventListener('visibilitychange', alCambiarVista)
    window.removeEventListener('online', alCambiarVista)
    fijarConectado(false)
  }
}

// Para el layout (el padre): abre la conexión mientras está montado.
export function useConexionEnVivo(activa = true) {
  useEffect(() => (MODO_SERVIDOR && activa ? iniciar() : undefined), [activa])
}

// Para cualquier pantalla (un hijo): `fn` corre cuando cambia algo de esa área. Se guarda en una ref, así que un padre
// que se vuelve a dibujar no la da de baja y de alta otra vez. Varios cambios seguidos se juntan en una sola llamada.
export function useEnVivo(areas: AreaEnVivo | AreaEnVivo[], fn: () => void, esperaMs = 400) {
  const ref = useRef(fn)
  ref.current = fn
  const clave = ([] as AreaEnVivo[]).concat(areas).join(',')
  useEffect(() => suscribir(clave.split(',') as AreaEnVivo[], () => ref.current(), esperaMs), [clave, esperaMs])
}

// Lo mismo fuera de React (sync.ts). Devuelve la función que da de baja.
export function suscribir(areas: AreaEnVivo[], fn: () => void, esperaMs = 400): () => void {
  let t: ReturnType<typeof setTimeout> | undefined
  const alCambio = () => { clearTimeout(t); t = setTimeout(fn, esperaMs) }
  for (const a of areas) {
    if (!oyentes.has(a)) oyentes.set(a, new Set())
    oyentes.get(a)!.add(alCambio)
  }
  return () => {
    clearTimeout(t)
    for (const a of areas) oyentes.get(a)?.delete(alCambio)
  }
}
