import { useState } from 'react'
import {
  BarChart3,
  ChartLine,
  IceCreamBowl,
  LogOut,
  MapPin,
  Shield,
  ShieldAlert,
  Smartphone,
  UserCheck,
  Users
} from 'lucide-react'
import { cerrarSesion, useSesion } from '../../lib/sesion'
import { Logo } from '../../components/Logo'
import { Equipo } from '../pwa/Equipo'
import { Clientes } from '../pwa/Clientes'
import { Pronostico } from '../pwa/Pronostico'
import { Ajustes } from '../pwa/Ajustes'
import { Reportes } from '../pwa/Reportes'

type SeccionAdmin = 'resumen' | 'equipo' | 'clientes' | 'produccion' | 'sabores' | 'reportes'

export function AdminLayout({ onIrAPwa }: { onIrAPwa?: () => void }) {
  const sesion = useSesion()
  const [seccion, setSeccion] = useState<SeccionAdmin>('resumen')
  const [cerrando, setCerrando] = useState(false)

  // RF-005: Control de Acceso por Rol (RBAC)
  // Si un usuario con rol de 'vendedor' entra a la ruta del admin, se bloquea la vista
  if (sesion && sesion.usuario.rol !== 'administrador') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-papel px-6 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-3xl bg-rojo/10 text-rojo">
          <ShieldAlert size={36} />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-tinta">Acceso Restringido (RBAC)</h1>
        <p className="mt-2 max-w-md text-sm text-apagado leading-relaxed">
          Tu cuenta (<strong className="text-tinta">{sesion.usuario.correo}</strong>) está registrada con rol de{' '}
          <strong className="text-tinta">Vendedor</strong>. El Panel de Administración requiere permisos de Administrador (RF-005).
        </p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          <button
            onClick={onIrAPwa}
            className="flex-1 rounded-xl bg-tinta py-3.5 text-sm font-semibold text-white transition-all active:bg-neutral-800"
          >
            Ir a App de Reparto
          </button>
          <button
            onClick={() => void cerrarSesion()}
            className="flex-1 rounded-xl bg-niebla py-3.5 text-sm font-semibold text-tinta transition-all hover:bg-linea"
          >
            Cerrar Sesión
          </button>
        </div>
      </div>
    )
  }

  // RF-006: Cierre de Sesión Seguro
  async function manejarCerrarSesion() {
    setCerrando(true)
    try {
      await cerrarSesion()
    } finally {
      setCerrando(false)
    }
  }

  const pestañas = [
    { id: 'resumen', texto: 'Resumen M01', icono: Shield },
    { id: 'equipo', texto: 'Equipo y Vendedores', icono: Users },
    { id: 'clientes', texto: 'Clientes', icono: MapPin },
    { id: 'produccion', texto: 'Producción', icono: BarChart3 },
    { id: 'sabores', texto: 'Sabores y Precios', icono: IceCreamBowl },
    { id: 'reportes', texto: 'Reportes', icono: ChartLine },
  ] as const

  return (
    <div className="flex h-dvh flex-col bg-papel text-tinta antialiased">
      {/* Barra superior de navegación estilo Uber */}
      <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-linea bg-papel px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Logo className="h-9 w-9" textoClassName="text-lg font-bold" />
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-niebla px-3 py-1 text-xs font-semibold text-tinta">
            <Shield size={12} className="text-azul" />
            Admin
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
              Vista Repartidor
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

          {/* RF-006: Botón de cierre de sesión */}
          <button
            onClick={manejarCerrarSesion}
            disabled={cerrando}
            title="Cerrar sesión seguro (RF-006)"
            className="grid h-10 w-10 place-items-center rounded-xl bg-niebla text-tinta transition-colors hover:bg-rojo/10 hover:text-rojo active:bg-linea disabled:opacity-40"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Contenedor con barra lateral y área de contenido */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Barra lateral en escritorio */}
        <nav className="hidden lg:flex w-64 flex-col border-r border-linea bg-papel p-4 space-y-1">
          <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-apagado">
            Módulos del Sistema
          </div>
          {pestañas.map(({ id, texto, icono: Icono }) => {
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

        {/* Área de contenido */}
        <main className="flex-1 overflow-y-auto">
          {seccion === 'resumen' && (
            <div className="p-6 sm:p-8 max-w-5xl mx-auto space-y-6">
              <div>
                <h2 className="text-3xl font-bold tracking-tight">Módulo 1: Autenticación y Seguridad</h2>
                <p className="mt-1 text-sm text-apagado">
                  Estado y verificación de los Requerimientos Funcionales RF-001 al RF-006
                </p>
              </div>

              {/* Grid de Requisitos Implementados */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl border border-linea bg-papel p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-verde/10 px-2 py-0.5 text-xs font-bold text-verde">RF-001</span>
                    <UserCheck size={18} className="text-verde" />
                  </div>
                  <h3 className="font-bold text-base">Login Multirrol</h3>
                  <p className="text-xs text-apagado leading-relaxed">
                    Validación de credenciales para administradores y vendedores con persistencia y renovación de JWT.
                  </p>
                </div>

                <div className="rounded-2xl border border-linea bg-papel p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-verde/10 px-2 py-0.5 text-xs font-bold text-verde">RF-002</span>
                    <Shield size={18} className="text-verde" />
                  </div>
                  <h3 className="font-bold text-base">Recuperación de Contraseña</h3>
                  <p className="text-xs text-apagado leading-relaxed">
                    Flujo por correo con código de verificación de 6 dígitos (vence en 15 min con HMAC y Resend).
                  </p>
                </div>

                <div className="rounded-2xl border border-linea bg-papel p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-verde/10 px-2 py-0.5 text-xs font-bold text-verde">RF-003</span>
                    <ShieldAlert size={18} className="text-verde" />
                  </div>
                  <h3 className="font-bold text-base">Bloqueo por Intentos Fallidos</h3>
                  <p className="text-xs text-apagado leading-relaxed">
                    Bloqueo temporal automático tras 5 intentos fallidos consecutivos para mitigar ataques de fuerza bruta.
                  </p>
                </div>

                <div className="rounded-2xl border border-linea bg-papel p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-verde/10 px-2 py-0.5 text-xs font-bold text-verde">RF-004</span>
                    <Shield size={18} className="text-verde" />
                  </div>
                  <h3 className="font-bold text-base">Hashing Argon2id</h3>
                  <p className="text-xs text-apagado leading-relaxed">
                    Almacenamiento seguro con el algoritmo criptográfico Argon2id en PostgreSQL (OWASP: 64MiB, 3 pasadas).
                  </p>
                </div>

                <div className="rounded-2xl border border-linea bg-papel p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-verde/10 px-2 py-0.5 text-xs font-bold text-verde">RF-005</span>
                    <Users size={18} className="text-verde" />
                  </div>
                  <h3 className="font-bold text-base">Control de Acceso RBAC</h3>
                  <p className="text-xs text-apagado leading-relaxed">
                    Restricción de vistas y endpoints: los vendedores no tienen acceso a finanzas globales ni a este panel.
                  </p>
                </div>

                <div className="rounded-2xl border border-linea bg-papel p-5 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="rounded-lg bg-verde/10 px-2 py-0.5 text-xs font-bold text-verde">RF-006</span>
                    <LogOut size={18} className="text-verde" />
                  </div>
                  <h3 className="font-bold text-base">Cierre de Sesión Seguro</h3>
                  <p className="text-xs text-apagado leading-relaxed">
                    Revocación de tokens de sesión en la base de datos y limpieza de almacenamiento local.
                  </p>
                </div>
              </div>

              {/* Acceso rápido a las demás funciones */}
              <div className="rounded-3xl border border-linea bg-niebla/60 p-6 space-y-4">
                <h3 className="text-lg font-bold">Gestión de Administrador</h3>
                <p className="text-sm text-apagado">
                  Selecciona una sección en la barra lateral para gestionar al equipo de repartidores, la cartera de clientes o el catálogo de producción.
                </p>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={() => setSeccion('equipo')}
                    className="rounded-xl bg-tinta px-4 py-2.5 text-xs font-semibold text-white hover:bg-neutral-800"
                  >
                    Ver Vendedores y Equipo →
                  </button>
                  <button
                    onClick={() => setSeccion('produccion')}
                    className="rounded-xl bg-papel border border-linea px-4 py-2.5 text-xs font-semibold text-tinta hover:bg-niebla"
                  >
                    Pronóstico de Producción →
                  </button>
                </div>
              </div>
            </div>
          )}

          {seccion === 'equipo' && <div className="p-4 sm:p-6"><Equipo /></div>}
          {seccion === 'clientes' && <div className="p-4 sm:p-6"><Clientes /></div>}
          {seccion === 'produccion' && <div className="p-4 sm:p-6"><Pronostico /></div>}
          {seccion === 'sabores' && <div className="p-4 sm:p-6"><Ajustes /></div>}
          {seccion === 'reportes' && <div className="p-4 sm:p-6"><Reportes /></div>}
        </main>
      </div>

      {/* Navegación móvil inferior para administradores */}
      <nav className="lg:hidden z-30 grid grid-cols-6 border-t border-linea bg-papel pb-safe">
        {pestañas.map(({ id, texto, icono: Icono }) => {
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
              <span className="truncate max-w-[50px]">{texto.split(' ')[0]}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
