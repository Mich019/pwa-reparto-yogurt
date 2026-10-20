import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MODO_SERVIDOR } from './api'
import { db, type Aviso } from './db'
import { hoy } from './fechas'
import { useStockDeHoy } from './stock'
import { avisosQueToca, type AvisoNuevo, type EntradaAlertas } from './stock-calculo'
import { aviso } from '../components/ui'

// RF-055 · Avisos locales: los genera la propia app en el teléfono (no necesitan servidor ni internet) cuando el stock
// de un sabor en ruta está por agotarse o cuando, ya entrada la tarde, quedan ventas sin sincronizar.
// Cada aviso se guarda en `avisos` (se ve en Cuenta) y sale una sola vez: con la app abierta como mensaje, y con la
// app en segundo plano como notificación del sistema.

export const HORA_CIERRE = 18 // «el final del día» por omisión; cada persona puede cambiarla en Cuenta

export function useHoraCierre() {
  const guardada = useLiveQuery(async () => (await db.meta.get('horaCierre'))?.valor as number | undefined, [])
  const cambiar = (h: number) => db.meta.put({ clave: 'horaCierre', valor: h })
  return [guardada ?? HORA_CIERRE, cambiar] as const
}

// Guarda el aviso si es nuevo. false = ya existía (ese día ya se avisó): no se repite.
async function guardarSiEsNuevo(a: AvisoNuevo): Promise<Aviso | null> {
  const nuevo: Aviso = { ...a, creado: Date.now(), leida: false, local: true }
  try {
    await db.avisos.add(nuevo)
    return nuevo
  } catch (e) {
    if ((e as Error).name === 'ConstraintError') return null
    throw e
  }
}

async function mostrar(a: Aviso) {
  if (document.visibilityState === 'visible') return aviso(`${a.titulo}. ${a.cuerpo}`)
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  const reg = await navigator.serviceWorker?.getRegistration()
  await reg?.showNotification(a.titulo, { body: a.cuerpo, tag: a.id, data: { pestana: a.pestana } })
}

// Varios sabores que se complican a la vez (p. ej. al llegar la carga del día) salen como un solo mensaje; cada uno
// queda aparte en Cuenta.
function resumen(nuevos: Aviso[], productos: EntradaAlertas['productos']): Aviso {
  const sabores = nuevos.map((a) => productos.find((p) => a.id.includes(`:${p.id}:`))?.sabor).filter((x): x is string => !!x)
  const lista = sabores.length > 3 ? `${sabores.slice(0, 3).join(', ')} y ${sabores.length - 3} más` : sabores.join(', ')
  return { ...nuevos[0], id: `${nuevos[0].id}+`, titulo: `${nuevos.length} sabores con poco stock`, cuerpo: lista || 'Revisa tu carga de hoy.' }
}

// Se revisa de a una a la vez: dos revisiones seguidas no avisan dos veces lo mismo.
let enFila: Promise<unknown> = Promise.resolve()
export function revisarAlertas(entrada: EntradaAlertas): Promise<void> {
  enFila = enFila.then(async () => {
    const nuevos: Aviso[] = []
    for (const a of avisosQueToca(entrada)) {
      const guardado = await guardarSiEsNuevo(a)
      if (guardado) nuevos.push(guardado)
    }
    const deStock = nuevos.filter((a) => a.tipo === 'stock_bajo')
    const aMostrar = [...nuevos.filter((a) => a.tipo !== 'stock_bajo'), ...(deStock.length > 1 ? [resumen(deStock, entrada.productos)] : deStock)]
    for (const a of aMostrar) await mostrar(a).catch(() => {})
  })
  return enFila as Promise<void>
}

// Se monta una vez, con la app abierta: revisa al cambiar el stock, los pedidos o la cola, y cada minuto.
export function useAlertasLocales() {
  const filas = useStockDeHoy()
  const productos = useLiveQuery(() => db.productos.toArray(), [])
  const cola = useLiveQuery(() => db.cola.toArray(), [])
  const [horaCierre] = useHoraCierre()
  const [tic, setTic] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTic((x) => x + 1), 60_000)
    const alVolver = () => { if (document.visibilityState === 'visible') setTic((x) => x + 1) }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [])

  useEffect(() => {
    if (!MODO_SERVIDOR || !filas || !productos || !cola) return
    void revisarAlertas({ fecha: hoy(), hora: new Date().getHours(), horaCierre, filas, productos, cola })
  }, [filas, productos, cola, horaCierre, tic])
}
