import { useState } from 'react'
import { guardarMarca, useMarca } from '../../lib/marca'
import { aviso, claseInputRecto } from '../../components/ui'
import { Fila, Seccion } from './Configuracion'

// Configuración → Marca → Zona horaria: define el «hoy» de la empresa (ruta del día, stock, resumen y reportes).
const ZONAS: [string, string][] = [
  ['America/Tijuana', 'Tijuana (Baja California)'],
  ['America/Hermosillo', 'Hermosillo (Sonora)'],
  ['America/Mazatlan', 'Mazatlán (Pacífico)'],
  ['America/Chihuahua', 'Chihuahua'],
  ['America/Mexico_City', 'Ciudad de México (Centro)'],
  ['America/Monterrey', 'Monterrey'],
  ['America/Merida', 'Mérida'],
  ['America/Cancun', 'Cancún (Quintana Roo)'],
]

export function ZonaEmpresa() {
  const marca = useMarca()
  const [guardando, setGuardando] = useState(false)
  if (!marca?.zonaHoraria) return null
  const zona = marca.zonaHoraria
  const opciones = ZONAS.some(([z]) => z === zona) ? ZONAS : [...ZONAS, [zona, zona] as [string, string]]
  async function cambiar(nueva: string) {
    setGuardando(true)
    try {
      await guardarMarca({ zonaHoraria: nueva })
      aviso('Zona horaria guardada')
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }
  return (
    <Seccion id="zona" titulo="Zona horaria">
      <Fila titulo="Dónde está tu negocio" ayuda="Decide cuándo empieza y termina «hoy» para la ruta, el stock y los reportes.">
        <select value={zona} disabled={guardando} onChange={(e) => cambiar(e.target.value)} className={claseInputRecto}>
          {opciones.map(([z, n]) => <option key={z} value={z}>{n}</option>)}
        </select>
      </Fila>
    </Seccion>
  )
}
