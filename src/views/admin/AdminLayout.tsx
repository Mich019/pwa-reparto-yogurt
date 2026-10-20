import { useState } from 'react'
import {
  BarChart3,
  ChartLine,
  IceCreamBowl,
  LayoutDashboard,
  LogOut,
  MapPin,
  Shield,
  ShieldAlert,
  Smartphone,
  Users
} from 'lucide-react'
import { cerrarSesion, useSesion } from '../../lib/sesion'
import { Logo } from '../../components/Logo'
import { AdminDashboard } from './AdminDashboard'
import { Equipo } from '../pwa/Equipo'
import { Clientes } from '../pwa/Clientes'
import { Produccion } from '../pwa/Produccion'
import { Ajustes } from '../pwa/Ajustes'
import { Reportes } from '../pwa/Reportes'

type SeccionAdmin = 'resumen' | 'equipo' | 'clientes' | 'produccion' | 'sabores' | 'reportes'

export function AdminLayout({ onIrAPwa }: { onIrAPwa?: () => void }) {
  const sesion = useSesion()
  const [seccion, setSeccion] = useState<SeccionAdmin>('resumen')
  const [cerrando, setCerrando] = useState(false)

  // Control de Acceso por Rol (RBAC): Sólo Administradores
  if (sesion && sesion.usuario.rol !== 'administrador') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-papel px-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-rojo/10 text-rojo">
          <ShieldAlert size={36} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-tinta">Acceso Restringido</h1>
        <p className="mt-2 max-w-md text-sm text-apagado leading-relaxed">
          Esta cuenta tiene rol de <strong className="text-tinta">Vendedor</strong>. El Panel de Administración es de acceso exclusivo para administradores.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          {onIrAPwa && (
            <button
              onClick={onIrAPwa}
              className="flex-1 rounded-xl bg-tinta py-3.5 text-sm font-semibold text-white transition-all active:bg-neutral-800"
            >
              Ir a la App de Reparto
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

  const pestanas = [
    { id: 'resumen', texto: 'Resumen', icono: LayoutDashboard },
    { id: 'equipo', texto: 'Vendedores', icono: Users },
    { id: 'clientes', texto: 'Clientes', icono: MapPin },
    { id: 'produccion', texto: 'Producción', icono: BarChart3 },
    { id: 'sabores', texto: 'Sabores y Precios', icono: IceCreamBowl },
    { id: 'reportes', texto: 'Reportes', icono: ChartLine },
  ] as const

  return (
    <div className="flex h-dvh flex-col bg-papel text-tinta antialiased">
      {/* Barra superior de navegación */}
      <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-linea bg-papel px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Logo className="h-9 w-9" textoClassName="text-lg font-bold" />
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-niebla px-3 py-1 text-xs font-semibold text-tinta">
            <Shield size={12} className="text-azul" />
            Administrador
          </span>
        </div>

        {/* Info usuario y acciones */}
        <div className="flex items-center gap-3">
          {onIrAPwa && (
            <button
              onClick={onIrAPwa}
              title="Abrir vista PWA móvil"
              className="hidden md:flex items-center gap-1.5 rounded-xl border border-linea px-3 py-2 text-xs font-semibold text-tinta transition-colors hover:bg-niebla"
            >
              <Smartphone size={14} />
              App de Reparto
            </button>
          )}

          <div className="flex items-center gap-2.5 rounded-2xl bg-niebla px-3.5 py-1.5 text-left">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-tinta text-xs font-bold text-white">
              {sesion?.usuario.nombre.charAt(0) ?? 'A'}
            </div>
            <div className="hidden sm:block">
              <div className="text-xs font-semibold leading-tight">{sesion?.usuario.nombre ?? 'Administrador'}</div>
              <div className="text-[10px] text-apagado leading-tight">{sesion?.usuario.correo ?? ''}</div>
            </div>
          </div>

          <button
            onClick={manejarCerrarSesion}
            disabled={cerrando}
            title="Cerrar sesión"
            className="grid h-10 w-10 place-items-center rounded-xl bg-niebla text-tinta transition-colors hover:bg-rojo/10 hover:text-rojo active:bg-linea disabled:opacity-40"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Contenedor principal con sidebar */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Barra lateral en escritorio */}
        <nav className="hidden lg:flex w-64 flex-col border-r border-linea bg-papel p-4 space-y-1">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-apagado">
            Módulos del Sistema
          </div>
          {pestanas.map(({ id, texto, icono: Icono }) => {
            const activa = seccion === id
            return (
              <button
                key={id}
                onClick={() => setSeccion(id as SeccionAdmin)}
                className={`flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition-colors ${
                  activa ? 'bg-tinta text-white' : 'text-tinta hover:bg-niebla'
                }`}
              >
                <Icono size={18} />
                <span>{texto}</span>
              </button>
            )
          })}
        </nav>

        {/* Área de contenido del panel */}
        <main className="flex-1 overflow-y-auto">
          {seccion === 'resumen' && <AdminDashboard onNavegar={setSeccion} />}
          {seccion === 'equipo' && <div className="p-4 sm:p-6"><Equipo /></div>}
          {seccion === 'clientes' && <div className="p-4 sm:p-6"><Clientes /></div>}
          {seccion === 'produccion' && <div className="p-4 sm:p-6"><Produccion /></div>}
          {seccion === 'sabores' && <div className="p-4 sm:p-6"><Ajustes /></div>}
          {seccion === 'reportes' && <div className="p-4 sm:p-6"><Reportes /></div>}
        </main>
      </div>

      {/* Barra inferior en pantallas móviles */}
      <nav className="lg:hidden z-30 grid grid-cols-6 border-t border-linea bg-papel pb-safe">
        {pestanas.map(({ id, texto, icono: Icono }) => {
          const activa = seccion === id
          return (
            <button
              key={id}
              onClick={() => setSeccion(id as SeccionAdmin)}
              className={`flex flex-col items-center gap-0.5 pt-2 pb-1 text-[10px] ${
                activa ? 'font-semibold text-tinta' : 'font-medium text-apagado'
              }`}
            >
              <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${activa ? 'bg-niebla' : ''}`}>
                <Icono size={18} strokeWidth={activa ? 2.3 : 1.8} />
              </span>
              <span className="truncate max-w-[50px]">{texto}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
