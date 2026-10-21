import { useLiveQuery } from 'dexie-react-hooks'
import { Plus } from 'lucide-react'
import { ordenarPorVentas, useVentasPorSabor } from '../../lib/admin-datos'
import { db } from '../../lib/db'
import { DatosYRespaldo } from '../pwa/Ajustes'
import { useFichaSabor } from './PanelSabor'
import { TarjetaSabor, Vacio } from './piezas'

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
      <header className="flex flex-wrap items-end justify-between gap-4 pb-6 pt-4">
        <div>
          <h1 className="text-[2.5rem] font-semibold leading-none lg:text-[3.25rem]">Sabores</h1>
          <p className="mt-3 text-sm text-apagado">
            {productos ? `${aLaVenta} a la venta${sinStock ? ` · ${sinStock} sin stock` : ''} · ventas de los últimos 30 días` : 'Cargando…'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void ficha.editar()}
          className="flex items-center gap-2 rounded-full bg-tinta px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-marca-oscuro focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
        >
          <Plus size={18} aria-hidden="true" /> Nuevo sabor
        </button>
      </header>

      <section aria-label="Sabores" className="rounded-[28px] bg-niebla p-3 sm:p-5">
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

      {/* Sin relleno: los botones de la copia son beige y se perderían sobre una tarjeta beige */}
      <section className="mt-4 rounded-[28px] border border-linea p-5 sm:p-6" aria-labelledby="copia">
        <h2 id="copia" className="text-xl font-semibold">Copia de seguridad</h2>
        <DatosYRespaldo equipo="equipo" />
      </section>

      {ficha.panel}
    </div>
  )
}
