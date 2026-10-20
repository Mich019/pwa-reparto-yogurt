import { useEffect, useState } from 'react'
import { BarChart3, ChartLine, CloudOff, IceCreamBowl, LayoutDashboard, LogOut, MapPin, ShieldAlert, Smartphone, Users } from 'lucide-react'
import { MODO_SERVIDOR } from '../../lib/api'
import { hace } from '../../lib/fechas'
import { cerrarSesion, useSesion } from '../../lib/sesion'
import { iniciarSincronizacionAutomatica, useEstadoSync } from '../../lib/sync'
import { Logo } from '../../components/Logo'
import { AdminDashboard } from './AdminDashboard'
import { Equipo } from '../pwa/Equipo'
import { Clientes } from '../pwa/Clientes'
import { Produccion } from '../pwa/Produccion'
import { Ajustes } from '../pwa/Ajustes'
import { Reportes } from '../pwa/Reportes'

type SeccionAdmin = 'resumen' | 'equipo' | 'clientes' | 'produccion' | 'sabores' | 'reportes'

const PESTANAS: { id: SeccionAdmin; texto: string; corto: string; icono: typeof Users }[] = [
  { id: 'resumen', texto: 'Resumen', corto: 'Hoy', icono: LayoutDashboard },
  { id: 'equipo', texto: 'Vendedores', corto: 'Equipo', icono: Users },
  { id: 'clientes', texto: 'Clientes', corto: 'Clientes', icono: MapPin },
  { id: 'produccion', texto: 'Producción', corto: 'Producción', icono: BarChart3 },
  { id: 'sabores', texto: 'Sabores y precios', corto: 'Sabores', icono: IceCreamBowl },
  { id: 'reportes', texto: 'Reportes', corto: 'Reportes', icono: ChartLine },
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

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tinta'

export function AdminLayout({ onIrAPwa }: { onIrAPwa?: () => void }) {
  const sesion = useSesion()
  const [seccion, setSeccionEstado] = useState<SeccionAdmin>(seccionGuardada)
  const [cerrando, setCerrando] = useState(false)
  const sync = useEstadoSync()
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
      <div className="flex min-h-dvh flex-col items-center justify-center bg-papel px-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-rojo/10 text-rojo">
          <ShieldAlert size={36} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-tinta">Esta cuenta es de vendedor</h1>
        <p className="mt-2 max-w-md text-sm text-apagado leading-relaxed">
          El panel es sólo para administradores. Tu ruta y tus clientes están en la app de reparto.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          {onIrAPwa && (
            <button
              onClick={onIrAPwa}
              className="flex-1 rounded-xl bg-tinta py-3.5 text-sm font-semibold text-white transition-all active:bg-neutral-800"
            >
              Ir a la app de reparto
            </button>
          )}
          <button
            onClick={() => void cerrarSesion()}
            className="flex-1 rounded-xl bg-niebla py-3.5 text-sm font-semibold text-tinta transition-all hover:bg-linea"
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
    <div className="flex h-dvh flex-col bg-papel text-tinta antialiased">
      <header className="z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-linea px-4 sm:px-6">
        <Logo className="h-9 w-9" textoClassName="text-lg font-bold tracking-tight" />

        <div className="flex items-center gap-2">
          {onIrAPwa && (
            <button
              onClick={onIrAPwa}
              aria-label="Abrir la app de reparto"
              className={`flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors hover:bg-niebla ${anillo}`}
            >
              <Smartphone size={18} />
              <span className="hidden md:inline">App de reparto</span>
            </button>
          )}
          <div className="hidden items-center gap-2.5 rounded-xl px-2 sm:flex" title={sesion?.usuario.correo}>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-tinta text-sm font-semibold text-white" aria-hidden>
              {sesion?.usuario.nombre.charAt(0).toUpperCase() ?? 'A'}
            </span>
            <span className="text-sm font-medium">{sesion?.usuario.nombre.split(' ')[0]}</span>
          </div>
          <button
            onClick={manejarCerrarSesion}
            disabled={cerrando}
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className={`grid h-10 w-10 place-items-center rounded-xl transition-colors hover:bg-rojo/10 hover:text-rojo disabled:opacity-40 ${anillo}`}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav aria-label="Panel" className="hidden w-60 shrink-0 flex-col border-r border-linea p-3 lg:flex">
          <ul className="space-y-1">
            {PESTANAS.map(({ id, texto, icono: Icono }) => {
              const activa = seccion === id
              return (
                <li key={id}>
                  <button
                    onClick={() => setSeccion(id)}
                    aria-current={activa ? 'page' : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${anillo} ${
                      activa ? 'bg-tinta text-white' : 'hover:bg-niebla'
                    }`}
                  >
                    <Icono size={18} strokeWidth={activa ? 2.3 : 1.9} />
                    {texto}
                  </button>
                </li>
              )
            })}
          </ul>
          {MODO_SERVIDOR && (
            <p className="mt-auto flex items-center gap-2 px-3 pt-4 text-xs text-apagado" aria-live="polite">
              {sync.error ? <><CloudOff size={14} className="text-ambar" /> {sync.error}</>
                : sync.sincronizando ? 'Sincronizando…'
                : sync.ultimaOk ? `Datos al día, ${hace(sync.ultimaOk)}` : 'Esperando la primera sincronización'}
            </p>
          )}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          {seccion === 'resumen' && <AdminDashboard onNavegar={setSeccion} />}
          {seccion !== 'resumen' && (
            <div className="mx-auto max-w-6xl p-4 sm:p-8">
              {seccion === 'equipo' && <Equipo />}
              {seccion === 'clientes' && <Clientes />}
              {seccion === 'produccion' && <Produccion />}
              {seccion === 'sabores' && <Ajustes />}
              {seccion === 'reportes' && <Reportes />}
            </div>
          )}
        </main>
      </div>

      {/* En el teléfono, las mismas secciones abajo con nombres cortos para que quepan */}
      <nav aria-label="Panel" className="z-30 grid grid-cols-6 border-t border-linea bg-papel pb-safe lg:hidden">
        {PESTANAS.map(({ id, corto, icono: Icono }) => {
          const activa = seccion === id
          return (
            <button
              key={id}
              onClick={() => setSeccion(id)}
              aria-current={activa ? 'page' : undefined}
              className={`flex min-w-0 flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] ${anillo} ${activa ? 'font-semibold text-tinta' : 'font-medium text-apagado'}`}
            >
              <span className={`grid h-7 w-11 place-items-center rounded-full transition-colors ${activa ? 'bg-niebla' : ''}`}>
                <Icono size={19} strokeWidth={activa ? 2.3 : 1.8} />
              </span>
              <span className="w-full truncate px-0.5 text-center">{corto}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
