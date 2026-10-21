import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, IceCreamBowl, Map, Package, User, Users } from 'lucide-react'
import { Ruta } from './Ruta'
import { Clientes } from './Clientes'
import { Cuenta } from './Cuenta'
import { Stock } from './Stock'
import { Produccion } from './Produccion'
import { Ajustes } from './Ajustes'
import { Avisos, aviso } from '../../components/ui'
import { MODO_SERVIDOR } from '../../lib/api'
import { db } from '../../lib/db'
import { useAlertasLocales } from '../../lib/alertas'
import { quitarEsteTelefono, renovarSuscripcion } from '../../lib/push'
import { alCerrarSesion, useSesion } from '../../lib/sesion'
import { iniciarSincronizacionAutomatica } from '../../lib/sync'

type PestanaPwa = 'ruta' | 'clientes' | 'stock' | 'produccion' | 'sabores' | 'cuenta'

// Sin servidor no hay cuentas ni panel: el teléfono lleva también la producción y el catálogo de sabores (RF-032 a RF-036).
const PESTANAS_PWA: { id: PestanaPwa; texto: string; icono: typeof Map; solo?: 'vendedor' | 'servidor' | 'sinServidor' }[] = [
  { id: 'ruta', texto: 'Ruta', icono: Map },
  { id: 'clientes', texto: 'Clientes', icono: Users },
  { id: 'stock', texto: 'Stock', icono: Package, solo: 'vendedor' }, // RF-037: su carga del día (el administrador la captura en el panel)
  { id: 'produccion', texto: 'Producción', icono: BarChart3, solo: 'sinServidor' },
  { id: 'sabores', texto: 'Sabores', icono: IceCreamBowl, solo: 'sinServidor' },
  { id: 'cuenta', texto: 'Cuenta', icono: User, solo: 'servidor' },
]

// Al tocar una notificación con la app cerrada, se abre en la pestaña que corresponde (?abrir=stock).
function pestanaInicial(): PestanaPwa {
  const p = new URLSearchParams(window.location.search).get('abrir')
  return PESTANAS_PWA.find((x) => x.id === p)?.id ?? 'ruta'
}

export function PwaLayout({ onIrAAdmin }: { onIrAAdmin?: () => void }) {
  const [pestana, setPestana] = useState<PestanaPwa>(pestanaInicial)
  const sesion = useSesion()
  const esAdmin = sesion?.usuario.rol === 'administrador'
  const visibles = PESTANAS_PWA.filter((p) =>
    p.solo === 'vendedor' ? MODO_SERVIDOR && !esAdmin : p.solo === 'servidor' ? MODO_SERVIDOR : p.solo === 'sinServidor' ? !MODO_SERVIDOR : true)
  const actual = visibles.some((p) => p.id === pestana) ? pestana : 'ruta'
  const irA = (p: PestanaPwa) => { if (visibles.some((v) => v.id === p)) setPestana(p) }

  useEffect(() => iniciarSincronizacionAutomatica(), [])
  useAlertasLocales() // RF-055: stock por agotarse y ventas sin enviar

  // RF-054: este teléfono sigue recibiendo los avisos de la cuenta que entró, y deja de recibirlos al cerrar sesión.
  const usuarioId = sesion?.usuario.id
  useEffect(() => {
    if (!MODO_SERVIDOR || !usuarioId) return
    void renovarSuscripcion().catch(() => {})
    return alCerrarSesion(quitarEsteTelefono)
  }, [usuarioId])

  // Una notificación tocada con la app abierta (o en segundo plano) lleva a su pestaña.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const alMensaje = (e: MessageEvent) => {
      if (e.data?.tipo === 'abrir' && PESTANAS_PWA.some((p) => p.id === e.data.pestana)) irA(e.data.pestana)
    }
    navigator.serviceWorker.addEventListener('message', alMensaje)
    return () => navigator.serviceWorker.removeEventListener('message', alMensaje)
  }, [esAdmin]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (window.location.search.includes('abrir=')) window.history.replaceState({}, '', window.location.pathname + window.location.hash)
  }, [])

  // Alerta de sincronización si hubo algún problema offline
  const sinVer = useLiveQuery(() => db.problemas.filter((p) => !p.visto).count(), []) ?? 0
  const avisosSinLeer = useLiveQuery(() => db.avisos.filter((a) => !a.leida).count(), []) ?? 0
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
        {actual === 'ruta' && <Ruta irAClientes={() => setPestana('clientes')} irAStock={visibles.some((p) => p.id === 'stock') ? () => setPestana('stock') : undefined} />}
        {actual === 'clientes' && <Clientes />}
        {actual === 'stock' && <Stock />}
        {actual === 'produccion' && <Produccion />}
        {actual === 'sabores' && <Ajustes />}
        {actual === 'cuenta' && <Cuenta irA={irA} />}
      </main>

      {/* Barra inferior. Con servidor: Ruta, Clientes, Cuenta y, para el vendedor, Stock. Sin servidor: Ruta, Clientes, Producción y Sabores. */}
      <nav aria-label="Secciones" className="z-30 grid border-t border-linea bg-papel pb-safe" style={{ gridTemplateColumns: `repeat(${visibles.length}, minmax(0, 1fr))` }}>
        {visibles.map(({ id, texto, icono: Icono }) => {
          const activa = actual === id
          return (
            <button
              key={id}
              onClick={() => setPestana(id)}
              aria-current={activa ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] ${
                activa ? 'font-semibold text-tinta' : 'font-medium text-apagado'
              }`}
            >
              <span className={`relative grid h-8 w-14 place-items-center rounded-full transition-colors ${activa ? 'bg-niebla' : ''}`}>
                <Icono size={21} strokeWidth={activa ? 2.3 : 1.8} />
                {id === 'cuenta' && sinVer + avisosSinLeer > 0 && (
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
