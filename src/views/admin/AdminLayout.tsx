import { useEffect, useState } from 'react'
import { BarChart3, ChartLine, CloudOff, IceCreamBowl, LayoutDashboard, LogOut, MapPin, RefreshCw, ShieldAlert, Smartphone, Users } from 'lucide-react'
import { hace } from '../../lib/fechas'
import { cerrarSesion, useSesion } from '../../lib/sesion'
import { iniciarSincronizacionAutomatica, useEstadoSync } from '../../lib/sync'
import { AdminDashboard } from './AdminDashboard'
import { AdminSabores } from './AdminSabores'
import { LogoDanelle } from './marca'
import { Equipo } from '../pwa/Equipo'
import { Clientes } from '../pwa/Clientes'
import { Produccion } from '../pwa/Produccion'
import { Reportes } from '../pwa/Reportes'
import { DosPasos } from '../pwa/DosPasos'
import { Hoja } from '../../components/ui'

export type SeccionAdmin = 'resumen' | 'equipo' | 'clientes' | 'produccion' | 'sabores' | 'reportes'

const PESTANAS: { id: SeccionAdmin; texto: string; icono: typeof Users }[] = [
  { id: 'resumen', texto: 'Resumen', icono: LayoutDashboard },
  { id: 'equipo', texto: 'Vendedores', icono: Users },
  { id: 'clientes', texto: 'Clientes', icono: MapPin },
  { id: 'produccion', texto: 'Producción', icono: BarChart3 },
  { id: 'sabores', texto: 'Sabores', icono: IceCreamBowl },
  { id: 'reportes', texto: 'Reportes', icono: ChartLine },
]

// La sección abierta sobrevive a recargar la página (sólo en esta pestaña del navegador).
const CLAVE_SECCION = 'admin-seccion'
function seccionGuardada(): SeccionAdmin {
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
  const [cuenta, setCuenta] = useState(false)
  const esAdmin = sesion?.usuario.rol === 'administrador'

  // Clientes, sabores y producción se leen de la copia local: sin esto el panel abierto directo en /admin se queda
  // vacío y lo que se edita aquí no llega al servidor hasta abrir la app de reparto.
  useEffect(() => (esAdmin ? iniciarSincronizacionAutomatica() : undefined), [esAdmin])

  function setSeccion(s: SeccionAdmin) {
    setSeccionEstado(s)
    try { sessionStorage.setItem(CLAVE_SECCION, s) } catch { /* sin almacenamiento: sólo no se recuerda */ }
  }

  // Sólo administradores. El servidor también lo exige en cada llamada; esto evita mostrar un panel que no funcionaría.
  if (sesion && sesion.usuario.rol !== 'administrador') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center">
        <LogoDanelle className="h-16" />
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
      <header className="z-20 flex shrink-0 items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-8 lg:pb-4 lg:pt-4">
        <div className="flex flex-1 items-center">
          <button
            type="button"
            onClick={() => setSeccion('resumen')}
            aria-label="Ir al resumen"
            className={`rounded-xl ${anillo}`}
          >
            <LogoDanelle className="h-11 lg:h-14" />
          </button>
        </div>

        <nav aria-label="Secciones del panel" className="hidden shrink-0 items-center gap-1.5 lg:flex">
          {PESTANAS.map(({ id, texto }) => {
            const activa = seccion === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSeccion(id)}
                aria-current={activa ? 'page' : undefined}
                className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${anillo} ${
                  activa ? 'bg-tinta text-white' : `${pildora} text-tinta hover:bg-niebla`
                }`}
              >
                {texto}
              </button>
            )
          })}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2">
          <EstadoDatos />
          {onIrAPwa && (
            <button
              type="button"
              onClick={onIrAPwa}
              aria-label="Abrir la app de reparto"
              title="Abrir la app de reparto"
              className={`flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-tinta transition-colors hover:bg-niebla xl:px-4 ${pildora} ${anillo}`}
            >
              <Smartphone size={17} aria-hidden="true" />
              <span className="hidden xl:inline">App de reparto</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setCuenta(true)}
            aria-label="Mi cuenta y seguridad"
            title={sesion ? `${sesion.usuario.nombre} · ${sesion.usuario.correo}` : 'Mi cuenta'}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tinta text-sm font-semibold text-white transition-colors hover:bg-marca-oscuro ${anillo}`}
          >
            {sesion?.usuario.nombre.charAt(0).toUpperCase() ?? 'A'}
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

      <main className="min-h-0 flex-1 overflow-y-auto">
        {/* Abajo queda sitio para la barra flotante del teléfono */}
        <div className="pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-12">
          {seccion === 'resumen' && <AdminDashboard onNavegar={setSeccion} />}
          {seccion === 'sabores' && <AdminSabores />}
          {(seccion === 'equipo' || seccion === 'clientes' || seccion === 'produccion' || seccion === 'reportes') && (
            // Estas cuatro son las pantallas de la app de reparto, que traen su propio margen interior de 16 px.
            <div className="mx-auto max-w-[1100px] px-0 pt-2 sm:px-4">
              {seccion === 'equipo' && <Equipo />}
              {seccion === 'clientes' && <Clientes />}
              {seccion === 'produccion' && <Produccion />}
              {seccion === 'reportes' && <Reportes />}
            </div>
          )}
        </div>
      </main>

      <Hoja abierta={cuenta} onCerrar={() => setCuenta(false)} titulo={<div>Mi cuenta y seguridad<div className="text-base font-medium text-apagado">{sesion?.usuario.correo}</div></div>}>
        <div className="pb-4"><DosPasos /></div>
      </Hoja>

      {/* En el teléfono, las secciones flotan abajo: la elegida se abre con su nombre y las demás quedan en icono */}
      <nav aria-label="Secciones del panel" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
        <ul className="pointer-events-auto flex w-full max-w-md items-center gap-0.5 rounded-full border border-linea/80 bg-papel/90 p-1.5 shadow-[0_10px_32px_rgba(0,32,20,0.16)] backdrop-blur-xl">
          {PESTANAS.map(({ id, texto, icono: Icono }) => {
            const activa = seccion === id
            return (
              <li key={id} className={activa ? 'min-w-0 flex-1' : 'shrink-0'}>
                <button
                  type="button"
                  onClick={() => setSeccion(id)}
                  aria-label={texto}
                  aria-current={activa ? 'page' : undefined}
                  title={texto}
                  className={`flex h-11 items-center justify-center gap-2 rounded-full transition-colors ${anillo} ${
                    activa ? 'w-full bg-tinta px-3 text-white' : 'w-11 text-apagado hover:bg-niebla max-[380px]:w-10'
                  }`}
                >
                  <Icono size={20} strokeWidth={activa ? 2.2 : 1.9} aria-hidden="true" />
                  {activa && <span className="truncate text-[13px] font-semibold">{texto}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
