import { useState } from 'react'
import { MODO_SERVIDOR } from '../../lib/api'
import { Segmentado } from '../../components/ui'
import { botonPanel, botonPanelSuave, grupoPanel } from '../admin/piezas'
import { Pronostico } from './Pronostico'
import { StockAdmin } from './StockAdmin'

// Producción del administrador: qué producir (pronóstico) y el stock del día (RF-037). El stock lo lleva el servidor,
// así que sin servidor sólo hay pronóstico. Con servidor sólo se ve en el panel, donde las ventas ya están en Resumen y
// Reportes; sin servidor no hay reportes y el pronóstico trae su resumen de ventas.
// `panel`: con el encabezado de las demás secciones del panel; el selector va entre sus acciones.
export function Produccion({ panel = false }: { panel?: boolean } = {}) {
  const [vista, setVista] = useState<'pronostico' | 'stock'>('pronostico')
  if (!MODO_SERVIDOR) return <Pronostico panel={panel} />
  const opciones = [{ valor: 'pronostico', texto: 'Pronóstico' }, { valor: 'stock', texto: 'Stock del día' }] as const
  const selector = panel ? (
    <div className={grupoPanel} role="group" aria-label="Vista">
      {opciones.map((o) => (
        <button key={o.valor} type="button" onClick={() => setVista(o.valor)} aria-pressed={vista === o.valor} className={vista === o.valor ? botonPanel : botonPanelSuave}>{o.texto}</button>
      ))}
    </div>
  ) : (
    <Segmentado valor={vista} onChange={setVista} opciones={[...opciones]} />
  )
  return vista === 'stock' ? <StockAdmin selector={selector} panel={panel} /> : <Pronostico selector={selector} conVentas={false} panel={panel} onRegistrar={() => setVista('stock')} />
}
