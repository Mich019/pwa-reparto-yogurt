import { useState, type ReactNode } from 'react'
import { KeyRound, LogOut, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import { cerrarSesion, useSesion } from '../../lib/sesion'
import { cambiarTema, usePreferenciaTema, type PreferenciaTema } from '../../lib/tema'
import { Hoja } from '../../components/ui'
import { FormPassword } from '../pwa/Cuenta'
import { DosPasos } from '../pwa/DosPasos'

// Configuración del panel: apariencia (de este navegador), la cuenta y su seguridad, y cerrar sesión.

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'

const TEMAS: { valor: PreferenciaTema; texto: string; ayuda: string; icono: typeof Sun }[] = [
  { valor: 'claro', texto: 'Claro', ayuda: 'Crema, el de siempre', icono: Sun },
  { valor: 'oscuro', texto: 'Oscuro', ayuda: 'Descansa la vista de noche', icono: Moon },
  { valor: 'sistema', texto: 'Automático', ayuda: 'Igual que tu computadora o teléfono', icono: Monitor },
]

function Seccion({ id, titulo, descripcion, children }: { id: string; titulo: string; descripcion?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-[28px] border border-linea p-5 sm:p-6">
      <h2 id={id} className="text-xl font-semibold">{titulo}</h2>
      {descripcion && <p className="mt-1 text-sm text-apagado">{descripcion}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

// Muestra en miniatura de cada tema: fondo, una tarjeta y un botón.
function Muestra({ valor }: { valor: PreferenciaTema }) {
  const claro = <span className="flex h-full flex-1 flex-col gap-1.5 bg-[#f8f6ec] p-2"><span className="h-3 w-3/4 rounded bg-[#ecebd8]" /><span className="h-3 w-1/2 rounded-full bg-[#035d38]" /></span>
  const oscuro = <span className="flex h-full flex-1 flex-col gap-1.5 bg-[#0e1611] p-2"><span className="h-3 w-3/4 rounded bg-[#212c24]" /><span className="h-3 w-1/2 rounded-full bg-[#0f7a47]" /></span>
  return (
    <span aria-hidden="true" className="flex h-16 w-full overflow-hidden rounded-xl border border-linea">
      {valor === 'claro' ? claro : valor === 'oscuro' ? oscuro : <>{claro}{oscuro}</>}
    </span>
  )
}

export function Configuracion() {
  const sesion = useSesion()
  const preferencia = usePreferenciaTema()
  const [cambiando, setCambiando] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  const u = sesion?.usuario

  async function salir() {
    setSaliendo(true)
    try { await cerrarSesion() } finally { setSaliendo(false) }
  }

  return (
    <div className="mx-auto max-w-[880px] px-4 pt-2 sm:px-8">
      <header className="pb-6 pt-4">
        <h1 className="text-[2.5rem] font-semibold leading-none lg:text-[3.25rem]">Configuración</h1>
        <p className="mt-3 text-sm text-apagado">Cómo se ve el panel, tu cuenta y su seguridad.</p>
      </header>

      <div className="space-y-4">
        <Seccion id="apariencia" titulo="Apariencia" descripcion="Se guarda en este navegador; cada computadora o teléfono puede tener la suya.">
          <div role="radiogroup" aria-label="Tema del panel" className="grid gap-3 sm:grid-cols-3">
            {TEMAS.map(({ valor, texto, ayuda, icono: Icono }) => {
              const elegido = preferencia === valor
              return (
                <button
                  key={valor}
                  type="button"
                  role="radio"
                  aria-checked={elegido}
                  onClick={() => cambiarTema(valor)}
                  className={`flex flex-col gap-3 rounded-[22px] p-3 text-left transition-colors ${anillo} ${elegido ? 'bg-papel ring-2 ring-marca' : 'bg-niebla hover:bg-linea/60'}`}
                >
                  <Muestra valor={valor} />
                  <span className="flex items-center gap-2 px-1">
                    <Icono size={18} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{texto}</span>
                      <span className="block text-xs text-apagado">{ayuda}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </Seccion>

        {u && (
          <Seccion id="cuenta" titulo="Cuenta">
            <div className="flex items-center gap-3 rounded-2xl bg-niebla p-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-tinta text-lg font-semibold text-white" aria-hidden="true">{u.nombre.charAt(0).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{u.nombre}</div>
                <div className="truncate text-sm text-apagado">{u.correo}</div>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-papel px-3 py-1.5 text-xs font-semibold"><ShieldCheck size={14} aria-hidden="true" />Administrador</span>
            </div>
            <button
              type="button"
              onClick={() => setCambiando(true)}
              className={`mt-3 flex items-center gap-2 rounded-full bg-niebla px-5 py-3 text-sm font-semibold transition-colors hover:bg-linea ${anillo}`}
            >
              <KeyRound size={16} aria-hidden="true" /> Cambiar contraseña
            </button>
          </Seccion>
        )}

        <Seccion id="seguridad" titulo="Seguridad" descripcion="Protege la cuenta aunque alguien conozca tu contraseña.">
          {/* DosPasos trae su propia tarjeta; aquí sólo se le quita el margen de arriba. */}
          <div className="-mt-3"><DosPasos /></div>
        </Seccion>

        <Seccion id="sesion" titulo="Sesión" descripcion="Cierra la sesión en este navegador. Para volver a entrar se piden tu contraseña y, si la activaste, la verificación en dos pasos.">
          <button
            type="button"
            onClick={() => void salir()}
            disabled={saliendo}
            className={`flex items-center gap-2 rounded-full border border-rojo/40 px-5 py-3 text-sm font-semibold text-rojo transition-colors hover:bg-rojo/10 disabled:opacity-40 ${anillo}`}
          >
            <LogOut size={16} aria-hidden="true" /> {saliendo ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </Seccion>
      </div>

      <Hoja abierta={cambiando} onCerrar={() => setCambiando(false)} titulo="Cambiar contraseña">
        <div className="pb-4"><FormPassword onListo={() => setCambiando(false)} /></div>
      </Hoja>
    </div>
  )
}
