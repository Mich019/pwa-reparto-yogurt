import { useLiveQuery } from 'dexie-react-hooks'
import { TextoCargando } from '../../components/Esqueleto'
import { FileSpreadsheet, IceCreamBowl } from 'lucide-react'
import { descargar, xlsx } from '../../lib/xlsx'
import { hoy } from '../../lib/fechas'
import { unidadDe } from '../../lib/unidades'
import { ordenarPorVentas, useVentasPorSabor } from '../../lib/admin-datos'
import { db } from '../../lib/db'
import { DatosYRespaldo } from '../pwa/Ajustes'
import { useFichaSabor } from './PanelSabor'
import { Encabezado, TarjetaSabor, Vacio, botonPanel, botonPanelSuave } from './piezas'

// Sabores y precios del panel: cada sabor es un producto con su ficha (ventas, margen, 12 meses) y se edita desde ahí.
export function AdminSabores() {
  const productos = useLiveQuery(() => db.productos.toArray(), [])
  const ventas = useVentasPorSabor()

  const ordenados = ordenarPorVentas(productos ?? [], ventas)
  const ficha = useFichaSabor(ordenados)
  const aLaVenta = ordenados.filter((x) => x.producto.disponible).length
  const sinStock = ordenados.length - aLaVenta
  // El catálogo con precio, costo y margen, y lo que vendió cada sabor en 30 días (en el orden de la pantalla).
  function exportar() {
    descargar(xlsx({
      nombre: 'Sabores',
      columnas: [{ titulo: 'Sabor', ancho: 24 }, { titulo: 'Unidad', ancho: 8 }, { titulo: 'Precio por unidad', dinero: true, ancho: 14 }, { titulo: 'Costo por unidad', dinero: true, ancho: 14 },
        { titulo: 'Margen %', ancho: 10 }, { titulo: 'A la venta', ancho: 10 }, { titulo: 'Vendido 30 días', ancho: 14 }, { titulo: 'Ingreso 30 días', dinero: true, ancho: 14 }],
      filas: ordenados.map(({ producto: p, venta }) => [p.sabor, unidadDe(p), p.precio_litro, p.costo_litro,
        p.precio_litro > 0 ? Math.round(((p.precio_litro - p.costo_litro) / p.precio_litro) * 100) : null, p.disponible ? 'Sí' : 'No',
        Math.round(venta.litros * 100) / 100, Math.round(venta.ingreso * 100) / 100]),
    }), `sabores-${hoy()}.xlsx`)
  }

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-2 sm:px-8">
      <Encabezado titulo="Sabores" ayuda="sabores" detalle={productos ? `${aLaVenta} a la venta${sinStock ? ` · ${sinStock} sin stock` : ''} · ventas de los últimos 30 días` : <TextoCargando ancho="16rem" />}>
        <button type="button" onClick={exportar} disabled={!ordenados.length} className={botonPanelSuave}>
          <FileSpreadsheet size={18} aria-hidden="true" /> Bajar a Excel
        </button>
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
