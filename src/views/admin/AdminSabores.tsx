import { useLiveQuery } from 'dexie-react-hooks'
import { IceCreamBowl } from 'lucide-react'
import { ordenarPorVentas, useVentasPorSabor } from '../../lib/admin-datos'
import { db } from '../../lib/db'
import { DatosYRespaldo } from '../pwa/Ajustes'
import { useFichaSabor } from './PanelSabor'
import { Encabezado, TarjetaSabor, Vacio, botonPanel } from './piezas'

// Sabores y precios del panel: cada sabor es un producto con su ficha (ventas, margen, 12 meses) y se edita desde ahí.
export function AdminSabores() {
  const productos = useLiveQuery(() => db.productos.toArray(), [])
  const ventas = useVentasPorSabor()

  const ordenados = ordenarPorVentas(productos ?? [], ventas)
  const ficha = useFichaSabor(ordenados)
  const aLaVenta = ordenados.filter((x) => x.producto.disponible).length
  const sinStock = ordenados.length - aLaVenta

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-2 sm:px-8">
      <Encabezado titulo="Sabores" detalle={productos ? `${aLaVenta} a la venta${sinStock ? ` · ${sinStock} sin stock` : ''} · ventas de los últimos 30 días` : 'Cargando…'}>
        <button type="button" onClick={() => void ficha.editar()} className={botonPanel}>
          <IceCreamBowl size={18} aria-hidden="true" /> Nuevo sabor
        </button>
      </Encabezado>

      <section aria-label="Sabores" className="border-t border-linea pt-5">
        {productos && !ordenados.length ? (
          <Vacio>Todavía no hay sabores. Agrega el primero con «Nuevo sabor».</Vacio>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
            {ordenados.map((x) => (
              <li key={x.producto.id}>
                <TarjetaSabor producto={x.producto} venta={x.venta} posicion={x.posicion} conPrecio frasco="h-32 sm:h-36" onAbrir={() => ficha.abrir(x.producto.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" aria-label="Copia de seguridad">
        <DatosYRespaldo equipo="equipo" compacto />
      </section>

      {ficha.panel}
    </div>
  )
}
