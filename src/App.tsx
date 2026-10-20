import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, ChartLine, IceCreamBowl, Map, Package, User, UserCog, Users } from 'lucide-react'
import { Ruta } from './views/pwa/Ruta'
import { Clientes } from './views/pwa/Clientes'
import { Produccion } from './views/pwa/Produccion'
import { Stock } from './views/pwa/Stock'
import { Ajustes } from './views/pwa/Ajustes'
import { Cuenta } from './views/pwa/Cuenta'
import { Equipo } from './views/pwa/Equipo'
import { Reportes } from './views/pwa/Reportes'
import { CambioObligatorio, Login } from './views/pwa/Login'
import { Avisos, aviso } from './components/ui'
import { MODO_SERVIDOR } from './lib/api'
import { db } from './lib/db'
import { useAlertasLocales } from './lib/alertas'
import { quitarEsteTelefono, renovarSuscripcion } from './lib/push'
import { alCerrarSesion, useSesion, type Rol } from './lib/sesion'
import { iniciarSincronizacionAutomatica } from './lib/sync'

import { LoginAdmin } from './views/admin/LoginAdmin'
import { AdminLayout } from './views/admin/AdminLayout'

type Pestana = 'ruta' | 'clientes' | 'stock' | 'produccion' | 'sabores' | 'reportes' | 'equipo' | 'cuenta'

function esRutaAdmin() {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/admin') || window.location.hash.startsWith('#/admin')
}

// RF-005: el vendedor ve su ruta y sus clientes; costos, márgenes, producción y sabores son del administrador.
const PESTANAS: { id: Pestana; texto: string; icono: typeof Map; roles: Rol[]; soloServidor?: boolean }[] = [
  { id: 'ruta', texto: 'Ruta', icono: Map, roles: ['administrador', 'vendedor'] },
  { id: 'clientes', texto: 'Clientes', icono: Users, roles: ['administrador', 'vendedor'] },
  { id: 'stock', texto: 'Stock', icono: Package, roles: ['vendedor'], soloServidor: true }, // RF-037: su carga del día
  { id: 'produccion', texto: 'Producción', icono: BarChart3, roles: ['administrador'] },
  { id: 'sabores', texto: 'Sabores', icono: IceCreamBowl, roles: ['administrador'] },
  { id: 'reportes', texto: 'Reportes', icono: ChartLine, roles: ['administrador'], soloServidor: true },
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

// Al tocar una notificación con la app cerrada, se abre en la pestaña que corresponde (?abrir=stock).
function pestanaInicial(): Pestana {
  const p = new URLSearchParams(window.location.search).get('abrir')
  return p && PESTANAS.some((x) => x.id === p) ? (p as Pestana) : 'ruta'
}

function Principal({ rol, onIrAAdmin }: { rol: Rol; onIrAAdmin?: () => void }) {
  const [pestana, setPestana] = useState<Pestana>(pestanaInicial)
  const visibles = PESTANAS.filter((p) => p.roles.includes(rol) && (!p.soloServidor || MODO_SERVIDOR))
  const actual = visibles.some((p) => p.id === pestana) ? pestana : 'ruta'
  const apretada = visibles.length > 6 // el administrador con servidor: siete pestañas caben si se achican un poco

  useEffect(() => iniciarSincronizacionAutomatica(), [])
  useAlertasLocales() // RF-055: stock por agotarse y ventas sin enviar

  // RF-054: este teléfono sigue recibiendo los avisos de la cuenta que entró, y deja de recibirlos al cerrar sesión.
  const usuarioId = useSesion()?.usuario.id
  useEffect(() => {
    if (!MODO_SERVIDOR || !usuarioId) return
    void renovarSuscripcion().catch(() => {})
    return alCerrarSesion(quitarEsteTelefono)
  }, [usuarioId])

  // Una notificación tocada con la app abierta (o en segundo plano) lleva a su pestaña; si trae algo nuevo, se sincroniza.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const alMensaje = (e: MessageEvent) => {
      if (e.data?.tipo === 'abrir' && PESTANAS.some((p) => p.id === e.data.pestana)) setPestana(e.data.pestana)
    }
    navigator.serviceWorker.addEventListener('message', alMensaje)
    return () => navigator.serviceWorker.removeEventListener('message', alMensaje)
  }, [])
  useEffect(() => {
    if (window.location.search.includes('abrir=')) window.history.replaceState({}, '', window.location.pathname + window.location.hash)
  }, [])

  // Cambios que no se aplicaron (otro dispositivo ganó el conflicto, permisos…): se avisa una vez.
  const problemasSinVer = useLiveQuery(() => db.problemas.filter((p) => !p.visto).count(), []) ?? 0
  const avisosSinLeer = useLiveQuery(() => db.avisos.filter((a) => !a.leida).count(), []) ?? 0
  const sinVer = problemasSinVer
  const [avisados, setAvisados] = useState(0)
  useEffect(() => {
    if (sinVer > avisados) aviso(sinVer === 1 ? 'Un cambio tuyo no se aplicó. Revisa Cuenta.' : `${sinVer} cambios tuyos no se aplicaron. Revisa Cuenta.`)
    setAvisados(sinVer)
  }, [sinVer]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-dvh flex-col bg-papel text-tinta">
      <Avisos />
      <main className="relative min-h-0 flex-1">
        {actual === 'ruta' && <Ruta irAClientes={() => setPestana('clientes')} irAStock={visibles.some((p) => p.id === 'stock') ? () => setPestana('stock') : undefined} />}
        {actual === 'clientes' && <Clientes />}
        {actual === 'stock' && <Stock />}
        {actual === 'produccion' && <Produccion />}
        {actual === 'sabores' && <Ajustes />}
        {actual === 'reportes' && <Reportes />}
        {actual === 'equipo' && <Equipo />}
        {actual === 'cuenta' && <Cuenta irA={(p) => visibles.some((v) => v.id === p) && setPestana(p)} />}
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
      <nav className="z-30 flex border-t border-linea bg-papel pb-safe">
        {visibles.map(({ id, texto, icono: Icono }) => {
          const activa = actual === id
          return (
            <button
              key={id}
              onClick={() => setPestana(id)}
              className={`flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1 ${apretada ? 'text-[10px]' : 'text-[11px]'} ${activa ? 'font-semibold text-tinta' : 'font-medium text-apagado'}`}
            >
              <span className={`relative grid h-8 ${apretada ? 'w-11' : 'w-14'} place-items-center rounded-full transition-colors ${activa ? 'bg-niebla' : ''}`}>
                <Icono size={21} strokeWidth={activa ? 2.3 : 1.8} />
                {id === 'cuenta' && sinVer + avisosSinLeer > 0 && <span className={`absolute top-0.5 ${apretada ? 'right-2' : 'right-3'} h-2.5 w-2.5 rounded-full bg-rojo ring-2 ring-papel`} />}
              </span>
              {texto}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
