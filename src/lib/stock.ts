import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ErrorRed } from './api'
import { db } from './db'
import { hoy } from './fechas'
import { PESO_NIVEL, calcularStock, type SaborEnRuta } from './stock-calculo'
import { llamarAutenticado } from './sesion'

// Control de stock diario (RF-037). El administrador registra lo producido y lo que le da a cada vendedor al empezar
// la jornada (por internet, pantalla «Stock» de Producción); el vendedor lo recibe al sincronizar y la app le va
// restando lo que entrega, aun sin señal. Las cuentas están en stock-calculo.ts; los avisos de «por agotarse» (RF-055), en alertas.ts.

// ------------------------------------------------------------------ el stock del vendedor, en su teléfono

// Lo de hoy, con lo más urgente primero. `undefined` mientras carga.
export function useStockDeHoy(): SaborEnRuta[] | undefined {
  const fecha = hoy()
  return useLiveQuery(async () => {
    const [stock, pedidos] = await Promise.all([db.stock.where('fecha').equals(fecha).toArray(), db.pedidos.where('fecha').equals(fecha).toArray()])
    return calcularStock(fecha, stock, pedidos).sort((a, b) => PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel])
  }, [fecha])
}

// ------------------------------------------------------------------ administrador: capturar el día (por internet)

export interface LineaStock { productoId: string; asignada: number; devuelta: number; entregado: number }
export interface DiaStock {
  fecha: string
  productos: { id: string; sabor: string; color: string; disponible: boolean; unidad?: string }[] // unidad: L si no viene
  produccion: { productoId: string; litros: number }[]
  vendedores: { id: string; nombre: string; activo: boolean; lineas: LineaStock[] }[]
}

export const cargarDia = (fecha: string) => llamarAutenticado<DiaStock>(`/stock?fecha=${fecha}`)
export const guardarProduccion = (fecha: string, lineas: { productoId: string; litros: number }[]) =>
  llamarAutenticado<DiaStock>('/stock/produccion', { metodo: 'PUT', cuerpo: { fecha, lineas } })
export const guardarCarga = (fecha: string, vendedorId: string, lineas: { productoId: string; asignada: number; devuelta?: number }[]) =>
  llamarAutenticado<DiaStock>(`/stock/vendedor/${vendedorId}`, { metodo: 'PUT', cuerpo: { fecha, lineas } })
export const copiarCarga = (desde: string, hacia: string) =>
  llamarAutenticado<DiaStock & { copiadas: number }>('/stock/copiar', { cuerpo: { desde, hacia } })

// El día pedido al servidor. Mientras llega otro día se queda el anterior a la vista; los errores no la borran.
export function useDiaStock(fecha: string) {
  const [dia, setDia] = useState<DiaStock | null>(null)
  const [error, setError] = useState<{ texto: string; sinRed: boolean } | null>(null)
  const [cargando, setCargando] = useState(true)
  const pedido = useRef(0)

  const recargar = useCallback(() => {
    const mio = ++pedido.current
    setCargando(true)
    cargarDia(fecha)
      .then((d) => { if (mio === pedido.current) { setDia(d); setError(null) } })
      .catch((e: Error) => { if (mio === pedido.current) setError({ texto: e.message, sinRed: e instanceof ErrorRed }) })
      .finally(() => { if (mio === pedido.current) setCargando(false) })
  }, [fecha])

  useEffect(() => { recargar() }, [recargar])
  // Lo que devuelve el servidor tras guardar sustituye al día a la vista (si sigue siendo el mismo día).
  const adoptar = useCallback((d: DiaStock) => { if (d.fecha === fecha) setDia(d) }, [fecha])
  return { dia, error, cargando, recargar, adoptar }
}
