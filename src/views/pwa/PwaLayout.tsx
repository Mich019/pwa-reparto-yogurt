import { useEffect, useState } from 'react'
import { fijarReparto } from '../../lib/reparto'
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
import { alCerrarSesion, refrescarPerfil, useSesion } from '../../lib/sesion'
import { abrirGuia } from '../ayuda/AyudaRapida'
import { GuiaInicio } from '../../components/GuiaInicio'
import { PASOS_APP, irAPasoGuia, terminarGuia, useGuiaInicio, useGuiaVista } from '../../lib/guiaInicio'
import { iniciarSincronizacionAutomatica } from '../../lib/sync'
import { useConexionEnVivo } from '../../lib/enVivo'
import { AnuncioPlataforma } from '../../components/AnuncioPlataforma'

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
  // Guía de la primera vez (lib/guiaInicio.ts): un paso por pestaña de las que tiene esta cuenta.
  const pasoGuia = useGuiaInicio('app', sesion?.usuario.id, (!MODO_SERVIDOR || !!sesion) && !location.search.includes('guia='))
  const guiaYaVista = useGuiaVista('app')
  // La primera vez que un vendedor entra en este teléfono, le abre la guía de entregar (una sola vez por cuenta).
  const idUsuario = sesion?.usuario.id
  useEffect(() => {
    if (!idUsuario || esAdmin) return
    if (pasoGuia !== null || !guiaYaVista) return // primero el recorrido; la guía de entregar, al terminarlo
    const clave = `delisy:bienvenida:${idUsuario}`
    try { if (localStorage.getItem(clave)) return } catch { return }
    // Se marca al abrirla, no antes: al entrar la pantalla se monta dos veces y la primera cancela su espera.
    const t = setTimeout(() => { try { localStorage.setItem(clave, '1') } catch { /* sin almacenamiento */ } abrirGuia('entregar') }, 1200)
    return () => clearTimeout(t)
  }, [idUsuario, esAdmin, pasoGuia, guiaYaVista])
  const visibles = PESTANAS_PWA.filter((p) =>
    p.solo === 'vendedor' ? MODO_SERVIDOR : p.solo === 'servidor' ? MODO_SERVIDOR : p.solo === 'sinServidor' ? !MODO_SERVIDOR : true)
  const actual = visibles.some((p) => p.id === pestana) ? pestana : 'ruta'
  const irA = (p: PestanaPwa) => { if (visibles.some((v) => v.id === p)) setPestana(p) }
  const pasosGuia = PASOS_APP.filter((x) => !x.seccion || visibles.some((v) => v.id === x.seccion))
  useEffect(() => {
    if (pasoGuia !== null) setPestana((pasosGuia[pasoGuia]?.seccion ?? 'ruta') as PestanaPwa)
  }, [pasoGuia]) // eslint-disable-line react-hooks/exhaustive-deps

  // Aquí se reparte: el administrador también, como un vendedor con su cartera (lib/reparto.ts). Se fija antes de que
  // las pestañas lean la base; al salir al panel se quita.
  fijarReparto(MODO_SERVIDOR && sesion ? sesion.usuario.id : null, esAdmin)
  useEffect(() => () => fijarReparto(null), [])

  useEffect(() => iniciarSincronizacionAutomatica(), [])
  useConexionEnVivo() // una conexión para toda la app; los datos llegan a cada pestaña por Dexie (lib/enVivo.ts)
  useEffect(() => { if (sesion) void refrescarPerfil() }, [sesion?.usuario.id]) // eslint-disable-line react-hooks/exhaustive-deps
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
    <div className="flex h-dvh flex-col bg-lienzo text-tinta">
      <Avisos />
      {/* El primero se baja de la muesca y, si hay botón «Panel Admin», le deja su lugar a la derecha. */}
      <AnuncioPlataforma className={`[&>div:first-child]:pt-[max(0.625rem,env(safe-area-inset-top))] ${esAdmin && onIrAAdmin ? '[&>div:first-child]:pr-32' : ''}`} />

      {/* Botón flotante para administradores que están usando la PWA */}
      {esAdmin && onIrAAdmin && (
        <button
          onClick={onIrAAdmin}
          title="Abrir Panel Web de Administración"
          className="fixed top-3 right-3 z-40 flex items-center gap-1.5 rounded-md bg-tinta/90 px-3 py-1.5 text-xs font-semibold text-white shadow-tarjeta backdrop-blur transition-all hover:bg-tinta active:scale-95"
        >
          Panel Admin ↗
        </button>
      )}

      {/* Contenido principal móvil */}
      <main className="relative min-h-0 flex-1">
        {actual === 'ruta' && <Ruta irAClientes={() => setPestana('clientes')} irAStock={visibles.some((p) => p.id === 'stock') ? () => setPestana('stock') : undefined} irACuenta={() => setPestana('cuenta')} />}
        {actual === 'clientes' && <Clientes />}
        {actual === 'stock' && <Stock />}
        {actual === 'produccion' && <Produccion />}
        {actual === 'sabores' && <Ajustes />}
        {actual === 'cuenta' && <Cuenta irA={irA} />}
      </main>

      {/* Barra inferior: cada pestaña con su icono y su nombre (un icono solo obliga a adivinar); la elegida, en verde. Con servidor: Ruta, Clientes, Cuenta y, para el vendedor, Stock. Sin
          servidor: Ruta, Clientes, Producción y Sabores. */}
      <nav aria-label="Secciones" className="z-30 flex justify-center bg-lienzo px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ul className="flex w-full max-w-md items-center gap-0.5 rounded-md border border-linea/80 bg-papel p-1.5 shadow-[0_10px_32px_rgba(0,32,20,0.12)]">
          {visibles.map(({ id, texto, icono: Icono }) => {
            const activa = actual === id
            const punto = id === 'cuenta' && sinVer + avisosSinLeer > 0
            return (
              <li key={id} className="min-w-0 flex-1">
                <button
                  onClick={() => setPestana(id)}
                  data-seccion={id}
                  aria-label={texto}
                  aria-current={activa ? 'page' : undefined}
                  className={`relative flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-md px-1 transition-colors ${
                    activa ? 'bg-tinta text-white' : 'text-apagado active:bg-niebla'
                  }`}
                >
                  <Icono size={21} strokeWidth={activa ? 2.2 : 1.9} aria-hidden="true" />
                  <span className="max-w-full truncate text-[11px] leading-tight font-semibold">{texto}</span>
                  {punto && <span className="absolute top-1.5 right-[calc(50%-1.1rem)] h-2.5 w-2.5 rounded-full bg-rojo ring-2 ring-papel" />}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      {pasoGuia !== null && <GuiaInicio pasos={pasosGuia} paso={pasoGuia} onPaso={(n) => irAPasoGuia('app', n)} onTerminar={() => { terminarGuia('app'); setPestana('ruta') }} />}
    </div>
  )
}
