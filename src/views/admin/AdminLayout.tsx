import { useEffect, useState } from 'react'
import { CloudOff, LogOut, RefreshCw, Settings, ShieldAlert, Smartphone } from 'lucide-react'
import { PESTANAS, useMenu, type SeccionAdmin } from './menu'
import { hace } from '../../lib/fechas'
import { alCerrarSesion, cerrarSesion, refrescarPerfil, useSesion } from '../../lib/sesion'
import { quitarEsteTelefono, renovarSuscripcion } from '../../lib/push'
import { iniciarSincronizacionAutomatica, useEstadoSync } from '../../lib/sync'
import { AdminDashboard } from './AdminDashboard'
import { AdminSabores } from './AdminSabores'
import { Cobranza, irACortes } from './Cobranza'
import { LogoEmpresa } from './marca'
import { Subrayado } from './piezas'
import { Equipo } from '../pwa/Equipo'
import { Clientes } from '../pwa/Clientes'
import { Produccion } from '../pwa/Produccion'
import { Reportes } from '../pwa/Reportes'
import { useAplicarPreferencias } from '../../lib/tema'
import { Configuracion, type ApartadoConfig } from './Configuracion'
import { Avatar } from '../../components/Avatar'
import { PantallaCobro } from './Suscripcion'
import { useSuscripcion } from '../../lib/suscripcion'
import { AnuncioPlataforma } from '../../components/AnuncioPlataforma'

export type { SeccionAdmin } from './menu'

// La sección abierta sobrevive a recargar la página (sólo en esta pestaña del navegador).
const CLAVE_SECCION = 'admin-seccion'
function seccionGuardada(): SeccionAdmin {
  if (irACortes()) return 'cobranza'
  try {
    const s = sessionStorage.getItem(CLAVE_SECCION)
    return PESTANAS.find((p) => p.id === s)?.id ?? 'resumen'
  } catch {
    return 'resumen'
  }
}

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
// Los botones del encabezado son píldoras blancas con borde fino: sobre el crema sin borde casi no se distinguen.
const pildora = 'border border-linea/70 bg-papel'

// Estado de la copia local contra el servidor. Con poco espacio queda el punto de color y el texto va en el tooltip.
function EstadoDatos() {
  const sync = useEstadoSync()
  const hayError = !!sync.error
  const corto = hayError ? (sync.error!.startsWith('Sin conexión') ? 'Sin conexión' : 'Sin sincronizar')
    : sync.sincronizando ? 'Sincronizando'
    : sync.ultimaOk ? 'Al día'
    : 'Esperando datos'
  const largo = sync.error ?? (sync.sincronizando ? 'Sincronizando…' : sync.ultimaOk ? `Datos al día, ${hace(sync.ultimaOk)}` : 'Esperando la primera sincronización')
  const alDia = !hayError && !sync.sincronizando && sync.ultimaOk
  return (
    // En el teléfono, con todo en orden el punto sobra: el aviso sólo aparece cuando sincroniza o algo falla.
    <p title={largo} aria-live="polite" className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-xs font-medium text-apagado ${pildora} ${alDia ? 'max-sm:hidden' : ''}`}>
      {hayError ? <CloudOff size={15} className="shrink-0 text-amber-600" aria-hidden="true" />
        : sync.sincronizando ? <RefreshCw size={14} className="shrink-0 animate-spin" aria-hidden="true" />
        : <span className={`h-2 w-2 shrink-0 rounded-full ${alDia ? 'bg-serie' : 'bg-linea'}`} aria-hidden="true" />}
      <span className="hidden sm:inline">{corto}</span>
      <span className="sr-only sm:hidden">{largo}</span>
    </p>
  )
}

export function AdminLayout({ onIrAPwa }: { onIrAPwa?: () => void }) {
  const sesion = useSesion()
  const [seccion, setSeccionEstado] = useState<SeccionAdmin>(seccionGuardada)
  const [cerrando, setCerrando] = useState(false)
  const menu = useMenu()
  useAplicarPreferencias()
  // Con qué apartado se abre Configuración: el aviso de la prueba lleva directo a la suscripción.
  const [apartado, setApartado] = useState<{ id: ApartadoConfig; vez: number }>({ id: 'cuenta', vez: 0 })
  const abrirConfiguracion = (id: ApartadoConfig) => { setApartado((a) => ({ id, vez: a.vez + 1 })); setSeccion('configuracion') }
  const esAdmin = sesion?.usuario.rol === 'administrador'
  const suscripcion = useSuscripcion(esAdmin ? sesion?.usuario.id : undefined)

  // Clientes, sabores y producción se leen de la copia local: sin esto el panel abierto directo en /admin se queda
  // vacío y lo que se edita aquí no llega al servidor hasta abrir la app de reparto.
  useEffect(() => (esAdmin ? iniciarSincronizacionAutomatica() : undefined), [esAdmin])
  // Avisos push en esta computadora (Configuración → Cuenta): como en la app, al entrar se le recuerda al servidor de
  // quién es la suscripción y al cerrar sesión deja de recibir los de la cuenta.
  useEffect(() => {
    if (!esAdmin) return
    void renovarSuscripcion().catch(() => {})
    return alCerrarSesion(quitarEsteTelefono)
  }, [esAdmin, sesion?.usuario.id])
  useEffect(() => { if (sesion) void refrescarPerfil() }, [sesion?.usuario.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function setSeccion(s: SeccionAdmin) {
    setSeccionEstado(s)
    try { sessionStorage.setItem(CLAVE_SECCION, s) } catch { /* sin almacenamiento: sólo no se recuerda */ }
  }

  // Sólo administradores. El servidor también lo exige en cada llamada; esto evita mostrar un panel que no funcionaría.
  if (sesion && sesion.usuario.rol !== 'administrador') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center">
        <LogoEmpresa className="h-16" />
        <div className="mt-10 grid h-14 w-14 place-items-center rounded-full bg-rojo/10 text-rojo">
          <ShieldAlert size={28} aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-3xl font-semibold">Esta cuenta es de vendedor</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-apagado">
          El panel es sólo para administradores. Tu ruta y tus clientes están en la app de reparto.
        </p>
        <div className="mt-7 flex w-full max-w-xs flex-col gap-3 sm:max-w-sm sm:flex-row">
          {onIrAPwa && (
            <button
              onClick={onIrAPwa}
              className={`flex-1 rounded-full bg-tinta py-3.5 text-sm font-semibold text-white transition-colors hover:bg-marca-oscuro ${anillo}`}
            >
              Ir a la app de reparto
            </button>
          )}
          <button
            onClick={() => void cerrarSesion()}
            className={`flex-1 rounded-full border border-linea bg-papel py-3.5 text-sm font-semibold text-tinta transition-colors hover:bg-niebla ${anillo}`}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  // Sin prueba ni suscripción, el panel sólo deja pagar (el servidor responde 402 a lo demás).
  if (suscripcion?.estado === 'vencida') return <PantallaCobro s={suscripcion} />

  async function manejarCerrarSesion() {
    setCerrando(true)
    try {
      await cerrarSesion()
    } finally {
      setCerrando(false)
    }
  }

  return (
    <div className="flex h-dvh flex-col text-tinta antialiased">
      <AnuncioPlataforma onVerSuscripcion={() => abrirConfiguracion('suscripcion')} />
      <header className="z-20 flex shrink-0 items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8 xl:pb-4 xl:pt-4">
        <div className="flex min-w-0 flex-1 items-center">
          <button
            type="button"
            onClick={() => setSeccion('resumen')}
            aria-label="Ir al resumen"
            className={`flex min-w-0 rounded-xl ${anillo}`}
          >
            <LogoEmpresa className="h-11 xl:h-14" />
          </button>
        </div>

        {/* Sólo texto; la sección activa lleva el mismo trazo amarillo que el nombre del saludo. */}
        <nav aria-label="Secciones del panel" className="hidden shrink-0 items-center gap-1 xl:flex">
          {menu.map(({ id, texto }) => {
            const activa = seccion === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSeccion(id)}
                aria-current={activa ? 'page' : undefined}
                className={`rounded-md px-2.5 py-2.5 text-[15px] font-semibold transition-colors 2xl:px-3.5 ${id === 'configuracion' ? 'max-2xl:hidden' : ''} ${anillo} ${
                  activa ? 'text-tinta' : 'text-tinta/65 hover:text-tinta'
                }`}
              >
                {activa ? <Subrayado dibujar>{texto}</Subrayado> : texto}
              </button>
            )
          })}
        </nav>

        <div className="flex items-center justify-end gap-2 max-xl:shrink-0 xl:flex-1">
          <EstadoDatos />
          {onIrAPwa && (
            <button
              type="button"
              onClick={onIrAPwa}
              aria-label="Abrir la app de reparto"
              title="Abrir la app de reparto"
              className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-tinta transition-colors hover:bg-niebla 2xl:px-4 ${pildora} ${anillo}`}
            >
              <Smartphone size={17} aria-hidden="true" />
              <span className="hidden 2xl:inline">App de reparto</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setSeccion('configuracion')}
            aria-label="Configuración"
            title="Configuración"
            className={`hidden h-10 w-10 shrink-0 place-items-center rounded-full text-tinta transition-colors hover:bg-niebla xl:grid 2xl:hidden ${pildora} ${anillo}`}
          >
            <Settings size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => abrirConfiguracion('cuenta')}
            aria-label="Configuración de tu cuenta"
            title={sesion ? `${sesion.usuario.nombre} · ${sesion.usuario.correo}` : 'Mi cuenta'}
            className={`h-10 w-10 shrink-0 rounded-full transition-opacity hover:opacity-85 ${anillo}`}
          >
            <Avatar nombre={sesion?.usuario.nombre ?? 'A'} foto={sesion?.usuario.foto} className="h-10 w-10 bg-tinta text-sm text-white" />
          </button>
          <button
            type="button"
            onClick={manejarCerrarSesion}
            disabled={cerrando}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-tinta transition-colors hover:bg-rojo/10 hover:text-rojo disabled:opacity-40 ${pildora} ${anillo}`}
          >
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* En la computadora, Configuración lleva su propio desplazamiento: el título y su menú quedan fijos. */}
      <main className={`min-h-0 flex-1 overflow-y-auto ${seccion === 'configuracion' ? 'lg:overflow-hidden' : ''}`}>
        {/* Abajo queda sitio para la barra flotante del teléfono */}
        <div className={`pb-[calc(7rem+env(safe-area-inset-bottom))] ${seccion === 'configuracion' ? 'lg:h-full lg:pb-[calc(6rem+env(safe-area-inset-bottom))] xl:pb-0' : 'xl:pb-12'}`}>
          {seccion === 'resumen' && <AdminDashboard onNavegar={setSeccion} />}
          {seccion === 'sabores' && <AdminSabores />}
          {seccion === 'configuracion' && <Configuracion key={apartado.vez} inicial={apartado.id} irA={(s) => setSeccion(s as SeccionAdmin)} />}
          {seccion === 'equipo' && <Equipo panel />}
          {seccion === 'clientes' && <Clientes panel />}
          {seccion === 'produccion' && <Produccion panel />}
          {seccion === 'cobranza' && <Cobranza />}
          {seccion === 'reportes' && <Reportes panel />}
        </div>
      </main>

      {/* En el teléfono, las secciones flotan abajo: la elegida se abre con su nombre y las demás quedan en icono.
          Configuración no va aquí (con siete no cabe el nombre de la elegida): se abre con el círculo de la cuenta. */}
      <nav aria-label="Secciones del panel" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] xl:hidden">
        <ul className="pointer-events-auto flex w-full max-w-md items-center gap-0.5 rounded-full border border-linea/80 bg-papel/90 p-1.5 shadow-[0_10px_32px_rgba(0,32,20,0.16)] backdrop-blur-xl">
          {menu.filter((p) => p.id !== 'configuracion').map(({ id, texto, icono: Icono }) => {
            const activa = seccion === id
            return (
              <li key={id} className={activa ? 'shrink-0 min-[430px]:min-w-0 min-[430px]:flex-1' : 'shrink-0'}>
                <button
                  type="button"
                  onClick={() => setSeccion(id)}
                  aria-label={texto}
                  aria-current={activa ? 'page' : undefined}
                  title={texto}
                  className={`flex h-11 items-center justify-center gap-2 rounded-full transition-colors ${anillo} ${
                    activa ? 'bg-tinta text-white max-[429px]:w-11 min-[430px]:w-full min-[430px]:px-3' : 'w-11 text-apagado hover:bg-niebla max-[380px]:w-10'
                  }`}
                >
                  <Icono size={20} strokeWidth={activa ? 2.2 : 1.9} aria-hidden="true" />
                  {/* Con siete secciones, en el teléfono angosto sólo cabe el ícono (el título de la sección ya dice cuál es). */}
                  {activa && <span className="truncate text-[13px] font-semibold max-[429px]:hidden">{texto}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
