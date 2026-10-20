import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Map, User, Users } from 'lucide-react'
import { Ruta } from './Ruta'
import { Clientes } from './Clientes'
import { Cuenta } from './Cuenta'
import { Avisos, aviso } from '../../components/ui'
import { db } from '../../lib/db'
import { useSesion } from '../../lib/sesion'
import { iniciarSincronizacionAutomatica } from '../../lib/sync'

type PestanaPwa = 'ruta' | 'clientes' | 'cuenta'

const PESTANAS_PWA = [
  { id: 'ruta', texto: 'Ruta', icono: Map },
  { id: 'clientes', texto: 'Clientes', icono: Users },
  { id: 'cuenta', texto: 'Cuenta', icono: User },
] as const

export function PwaLayout({ onIrAAdmin }: { onIrAAdmin?: () => void }) {
  const [pestana, setPestana] = useState<PestanaPwa>('ruta')
  const sesion = useSesion()
  const esAdmin = sesion?.usuario.rol === 'administrador'

  useEffect(() => iniciarSincronizacionAutomatica(), [])

  // Alerta de sincronización si hubo algún problema offline
  const sinVer = useLiveQuery(() => db.problemas.filter((p) => !p.visto).count(), []) ?? 0
  const [avisados, setAvisados] = useState(0)
  useEffect(() => {
    if (sinVer > avisados) {
      aviso(sinVer === 1 ? 'Un cambio tuyo no se aplicó. Revisa Cuenta.' : `${sinVer} cambios no se aplicaron. Revisa Cuenta.`)
    }
    setAvisados(sinVer)
  }, [sinVer])

  return (
    <div className="flex h-dvh flex-col bg-papel text-tinta">
      <Avisos />

      {/* Botón flotante para administradores que están usando la PWA */}
      {esAdmin && onIrAAdmin && (
        <button
          onClick={onIrAAdmin}
          title="Abrir Panel Web de Administración"
          className="fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-full bg-tinta/90 px-3 py-1.5 text-xs font-semibold text-white shadow-tarjeta backdrop-blur transition-all hover:bg-tinta active:scale-95"
        >
          Panel Admin ↗
        </button>
      )}

      {/* Contenido principal móvil */}
      <main className="relative min-h-0 flex-1">
        {pestana === 'ruta' && <Ruta irAClientes={() => setPestana('clientes')} />}
        {pestana === 'clientes' && <Clientes />}
        {pestana === 'cuenta' && <Cuenta />}
      </main>

      {/* Barra de navegación inferior exclusiva para repartidores (3 pestañas) */}
      <nav className="z-30 grid grid-cols-3 border-t border-linea bg-papel pb-safe">
        {PESTANAS_PWA.map(({ id, texto, icono: Icono }) => {
          const activa = pestana === id
          return (
            <button
              key={id}
              onClick={() => setPestana(id)}
              className={`flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] ${
                activa ? 'font-semibold text-tinta' : 'font-medium text-apagado'
              }`}
            >
              <span className={`relative grid h-8 w-14 place-items-center rounded-full transition-colors ${activa ? 'bg-niebla' : ''}`}>
                <Icono size={21} strokeWidth={activa ? 2.3 : 1.8} />
                {id === 'cuenta' && sinVer > 0 && (
                  <span className="absolute top-0.5 right-3 h-2.5 w-2.5 rounded-full bg-rojo ring-2 ring-papel" />
                )}
              </span>
              {texto}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
