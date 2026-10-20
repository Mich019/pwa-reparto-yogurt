import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, IceCreamBowl, Map, User, UserCog, Users } from 'lucide-react'
import { Ruta } from './views/pwa/Ruta'
import { Clientes } from './views/pwa/Clientes'
import { Pronostico } from './views/pwa/Pronostico'
import { Ajustes } from './views/pwa/Ajustes'
import { Cuenta } from './views/pwa/Cuenta'
import { Equipo } from './views/pwa/Equipo'
import { CambioObligatorio, Login } from './views/pwa/Login'
import { Avisos, aviso } from './components/ui'
import { MODO_SERVIDOR } from './lib/api'
import { db } from './lib/db'
import { useSesion, type Rol } from './lib/sesion'
import { iniciarSincronizacionAutomatica } from './lib/sync'

import { LoginAdmin } from './views/admin/LoginAdmin'
import { AdminLayout } from './views/admin/AdminLayout'

type Pestana = 'ruta' | 'clientes' | 'produccion' | 'sabores' | 'equipo' | 'cuenta'

function esRutaAdmin() {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/admin') || window.location.hash.startsWith('#/admin')
}

// RF-005: el vendedor ve su ruta y sus clientes; costos, márgenes, producción y sabores son del administrador.
const PESTANAS: { id: Pestana; texto: string; icono: typeof Map; roles: Rol[]; soloServidor?: boolean }[] = [
  { id: 'ruta', texto: 'Ruta', icono: Map, roles: ['administrador', 'vendedor'] },
  { id: 'clientes', texto: 'Clientes', icono: Users, roles: ['administrador', 'vendedor'] },
  { id: 'produccion', texto: 'Producción', icono: BarChart3, roles: ['administrador'] },
  { id: 'sabores', texto: 'Sabores', icono: IceCreamBowl, roles: ['administrador'] },
  { id: 'equipo', texto: 'Equipo', icono: UserCog, roles: ['administrador'], soloServidor: true },
  { id: 'cuenta', texto: 'Cuenta', icono: User, roles: ['administrador', 'vendedor'], soloServidor: true },
]

export default function App() {
  const sesion = useSesion()
  const [esAdmin, setEsAdmin] = useState(esRutaAdmin)

  useEffect(() => {
    const alCambiar = () => setEsAdmin(esRutaAdmin())
    window.addEventListener('popstate', alCambiar)
    window.addEventListener('hashchange', alCambiar)
    return () => {
      window.removeEventListener('popstate', alCambiar)
      window.removeEventListener('hashchange', alCambiar)
    }
  }, [])

  function irAAdmin() {
    window.history.pushState({}, '', '/admin')
    setEsAdmin(true)
  }

  function irAPwa() {
    window.history.pushState({}, '', '/')
    setEsAdmin(false)
  }

  // --- VISTA PANEL ADMINISTRADOR (/admin) ---
  if (esAdmin) {
    if (!sesion) {
      return (
        <>
          <Avisos />
          <LoginAdmin onIrAPwa={irAPwa} />
        </>
      )
    }
    if (sesion.usuario.debeCambiarPassword) {
      return (
        <>
          <Avisos />
          <CambioObligatorio />
        </>
      )
    }
    return (
      <>
        <Avisos />
        <AdminLayout onIrAPwa={irAPwa} />
      </>
    )
  }

  // --- VISTA PWA MÓVIL DEL REPARTIDOR (/) ---
  if (MODO_SERVIDOR && !sesion) {
    return (
      <>
        <Avisos />
        <Login onIrAAdmin={irAAdmin} />
      </>
    )
  }
  if (MODO_SERVIDOR && sesion?.usuario.debeCambiarPassword) {
    return (
      <>
        <Avisos />
        <CambioObligatorio />
      </>
    )
  }

  return (
    <Principal
      rol={MODO_SERVIDOR ? sesion!.usuario.rol : 'administrador'}
      onIrAAdmin={irAAdmin}
    />
  )
}

function Principal({ rol, onIrAAdmin }: { rol: Rol; onIrAAdmin?: () => void }) {
  const [pestana, setPestana] = useState<Pestana>('ruta')
  const visibles = PESTANAS.filter((p) => p.roles.includes(rol) && (!p.soloServidor || MODO_SERVIDOR))
  const actual = visibles.some((p) => p.id === pestana) ? pestana : 'ruta'

  useEffect(() => iniciarSincronizacionAutomatica(), [])

  // Cambios que no se aplicaron (otro dispositivo ganó el conflicto, permisos…): se avisa una vez.
  const sinVer = useLiveQuery(() => db.problemas.filter((p) => !p.visto).count(), []) ?? 0
  const [avisados, setAvisados] = useState(0)
  useEffect(() => {
    if (sinVer > avisados) aviso(sinVer === 1 ? 'Un cambio tuyo no se aplicó. Revisa Cuenta.' : `${sinVer} cambios tuyos no se aplicaron. Revisa Cuenta.`)
    setAvisados(sinVer)
  }, [sinVer]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-dvh flex-col bg-papel text-tinta">
      <Avisos />
      <main className="relative min-h-0 flex-1">
        {actual === 'ruta' && <Ruta irAClientes={() => setPestana('clientes')} />}
        {actual === 'clientes' && <Clientes />}
        {actual === 'produccion' && <Pronostico />}
        {actual === 'sabores' && <Ajustes />}
        {actual === 'equipo' && <Equipo />}
        {actual === 'cuenta' && <Cuenta />}
        {rol === 'administrador' && onIrAAdmin && (
          <button
            onClick={onIrAAdmin}
            title="Ir al Panel Web de Administración"
            className="fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-full bg-tinta/90 px-3 py-1.5 text-xs font-semibold text-white shadow-tarjeta backdrop-blur transition-all hover:bg-tinta active:scale-95"
          >
            Panel Admin ↗
          </button>
        )}
      </main>
      <nav className="z-30 grid border-t border-linea bg-papel pb-safe" style={{ gridTemplateColumns: `repeat(${visibles.length}, minmax(0, 1fr))` }}>
        {visibles.map(({ id, texto, icono: Icono }) => {
          const activa = actual === id
          return (
            <button
              key={id}
              onClick={() => setPestana(id)}
              className={`flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] ${activa ? 'font-semibold text-tinta' : 'font-medium text-apagado'}`}
            >
              <span className={`relative grid h-8 w-14 place-items-center rounded-full transition-colors ${activa ? 'bg-niebla' : ''}`}>
                <Icono size={21} strokeWidth={activa ? 2.3 : 1.8} />
                {id === 'cuenta' && sinVer > 0 && <span className="absolute top-0.5 right-3 h-2.5 w-2.5 rounded-full bg-rojo ring-2 ring-papel" />}
              </span>
              {texto}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
