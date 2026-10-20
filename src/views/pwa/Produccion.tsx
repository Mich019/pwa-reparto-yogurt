import { useState } from 'react'
import { MODO_SERVIDOR } from '../../lib/api'
import { Segmentado } from '../../components/ui'
import { Pronostico } from './Pronostico'
import { StockAdmin } from './StockAdmin'

// Producción del administrador: qué producir (pronóstico) y el stock del día (RF-037). El stock lo lleva el servidor,
// así que sin servidor sólo hay pronóstico.
export function Produccion() {
  const [vista, setVista] = useState<'pronostico' | 'stock'>('pronostico')
  if (!MODO_SERVIDOR) return <Pronostico />
  const selector = (
    <Segmentado valor={vista} onChange={setVista} opciones={[{ valor: 'pronostico', texto: 'Pronóstico' }, { valor: 'stock', texto: 'Stock del día' }]} />
  )
  return vista === 'stock' ? <StockAdmin selector={selector} /> : <Pronostico selector={selector} />
}
