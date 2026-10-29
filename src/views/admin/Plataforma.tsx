import { useEffect, useState } from 'react'
import { Copy, LogOut, RefreshCw, ShieldCheck, UserPlus } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { dinero } from '../../lib/fechas'
import { cerrarSesion, llamarAutenticado, useSesion } from '../../lib/sesion'
import { aviso, Boton, Campo, claseInput, Hoja } from '../../components/ui'
import { LogoDelisy } from './marca'
import { FormPassword } from '../pwa/Cuenta'
import { DosPasos } from '../pwa/DosPasos'

// Panel de la plataforma (/plataforma, api/_lib/plataforma.ts): para quienes administran el servicio. Todas las empresas
// con su estado de pago y su uso, y suspender o reactivar. Sin enlace desde el panel: se entra con la dirección.

type Estado = 'prueba' | 'activa' | 'vencida' | 'cancelada' | 'exenta' | 'suspendida'
interface Empresa {
  id: string
  nombre: string
  alta: string
  contacto: string | null
  estado: Estado
  pruebaHasta: string
  usuarios: number
  clientes: number
  pedidos30: number
  ultimoPedido: string | null
}
interface Cuenta { nombre: string; correo: string; activo: boolean; dosPasos: boolean }
interface Datos {
  cuentas: Cuenta[]
  resumen: { total: number; prueba: number; activas: number; vencidas: number; canceladas: number; exentas: number; suspendidas: number; ingresoMensual: number; moneda: string }
  empresas: Empresa[]
}

const ESTADO: Record<Estado, { texto: string; clase: string }> = {
  prueba: { texto: 'En prueba', clase: 'bg-(--chip-pendiente-fondo) text-(--chip-pendiente-texto)' },
  activa: { texto: 'Pagando', clase: 'bg-(--chip-ok-fondo) text-(--chip-ok-texto)' },
  vencida: { texto: 'Vencida', clase: 'bg-rojo/10 text-rojo' },
  cancelada: { texto: 'Cancelada', clase: 'bg-rojo/10 text-rojo' },
  exenta: { texto: 'Exenta', clase: 'bg-niebla text-apagado' },
  suspendida: { texto: 'Suspendida', clase: 'bg-tinta text-papel' },
}
const fecha = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export function Plataforma() {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState('')
  const [cambiando, setCambiando] = useState<string | null>(null)
  const [nueva, setNueva] = useState(false)
  const [cuenta, setCuenta] = useState(false)

  async function cargar() {
    setError('')
    try {
      setDatos(await llamarAutenticado<Datos>('/plataforma/empresas'))
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'Sin conexión con el servidor')
    }
  }
  useEffect(() => { void cargar() }, [])

  async function cambiar(e: Empresa, activa: boolean) {
    if (!activa && !window.confirm(`¿Suspender ${e.nombre}? Nadie de esa empresa podrá entrar hasta que la reactives. No se borra nada.`)) return
    setCambiando(e.id)
    try {
      await llamarAutenticado(`/plataforma/empresas/${e.id}/activa`, { metodo: 'POST', cuerpo: { activa } })
      aviso(activa ? `${e.nombre} reactivada` : `${e.nombre} suspendida`)
      await cargar()
    } catch (x) {
      aviso(x instanceof ErrorApi ? x.message : 'No se pudo cambiar')
    } finally {
      setCambiando(null)
    }
  }

  const r = datos?.resumen
  return (
    <div className="mx-auto min-h-dvh max-w-[1100px] px-4 pb-16 sm:px-8">
      <header className="flex items-center justify-between gap-3 pt-6 pb-4">
        <div>
          <LogoDelisy className="mb-4 h-9" />
          <h1 className="text-[2.25rem] font-semibold leading-none">Plataforma</h1>
          <p className="mt-2 text-sm text-apagado">Todas las empresas, su estado de pago y su uso.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setCuenta(true)} className="flex h-10 items-center gap-2 rounded-full bg-niebla px-4 text-sm font-semibold hover:bg-linea"><ShieldCheck size={16} /> Mi cuenta y seguridad</button>
          <button type="button" onClick={() => void cargar()} aria-label="Actualizar" className="grid h-10 w-10 place-items-center rounded-full bg-niebla hover:bg-linea"><RefreshCw size={17} /></button>
          <button type="button" onClick={() => void cerrarSesion()} aria-label="Cerrar sesión" className="grid h-10 w-10 place-items-center rounded-full bg-niebla hover:bg-rojo/10 hover:text-rojo"><LogOut size={17} /></button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-2xl bg-rojo/10 p-4 text-sm font-medium text-rojo">
          {error}
          <Boton variante="secundario" className="mt-3" onClick={() => void cargar()}>Reintentar</Boton>
        </div>
      )}
      {!datos && !error && <p className="py-12 text-center text-apagado">Cargando…</p>}

      {r && (
        <section aria-label="Resumen" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cifra valor={dinero(r.ingresoMensual)} etiqueta={`Ingreso mensual (${r.moneda})`} />
          <Cifra valor={String(r.activas)} etiqueta="Pagando" />
          <Cifra valor={String(r.prueba)} etiqueta="En prueba" />
          <Cifra valor={String(r.vencidas + r.canceladas)} etiqueta="Vencidas o canceladas" />
        </section>
      )}
      {r && (
        <p className="mt-2 text-xs text-apagado">
          {r.total} empresas · {r.exentas} exentas · {r.suspendidas} suspendidas
        </p>
      )}

      {datos && (
        <section aria-labelledby="cuentas" className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 id="cuentas" className="text-xl font-semibold">Cuentas de la plataforma</h2>
            <button type="button" onClick={() => setNueva(true)} className="flex items-center gap-2 rounded-full bg-tinta px-4 py-2 text-sm font-semibold text-white hover:bg-marca-oscuro"><UserPlus size={16} /> Nueva cuenta</button>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {datos.cuentas.map((c) => (
              <li key={c.correo} className={`rounded-2xl bg-niebla px-4 py-2.5 text-sm ${c.activo ? '' : 'opacity-50'}`}>
                <div className="font-semibold">{c.nombre}</div>
                <div className="text-apagado">{c.correo} · {c.dosPasos ? 'con verificación en dos pasos' : 'sin verificación en dos pasos'}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {datos && <h2 className="mt-8 text-xl font-semibold">Empresas</h2>}
      {datos && (
        <ul className="mt-3 divide-y divide-linea rounded-[22px] border border-linea">
          {datos.empresas.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{e.nombre}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO[e.estado].clase}`}>{ESTADO[e.estado].texto}</span>
                </div>
                <div className="mt-0.5 truncate text-sm text-apagado">
                  {e.contacto ?? 'Sin administrador'} · alta {fecha(e.alta)}{e.estado === 'prueba' && ` · prueba hasta ${fecha(e.pruebaHasta)}`}
                </div>
              </div>
              <div className="text-sm tabular-nums text-apagado">
                {e.usuarios} usuarios · {e.clientes} clientes · {e.pedidos30} pedidos en 30 días · último {fecha(e.ultimoPedido)}
              </div>
              <button
                type="button"
                onClick={() => void cambiar(e, e.estado === 'suspendida')}
                disabled={cambiando === e.id}
                className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${e.estado === 'suspendida' ? 'bg-tinta text-white hover:bg-marca-oscuro' : 'border border-rojo/40 text-rojo hover:bg-rojo/10'}`}
              >
                {cambiando === e.id ? 'Un momento…' : e.estado === 'suspendida' ? 'Reactivar' : 'Suspender'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {nueva && <NuevaCuenta onCerrar={() => setNueva(false)} onCreada={() => void cargar()} />}
      {cuenta && <MiCuenta onCerrar={() => { setCuenta(false); void cargar() }} />}
    </div>
  )
}

// Mi cuenta y seguridad, aquí mismo: la cuenta vive en una empresa (la interna u otra) y su panel no es éste.
// Las mismas piezas que Configuración del panel.
function MiCuenta({ onCerrar }: { onCerrar: () => void }) {
  const u = useSesion()?.usuario
  const [clave, setClave] = useState(false)
  return (
    <Hoja abierta alto onCerrar={onCerrar} titulo="Mi cuenta y seguridad">
      <div className="space-y-5 pb-4">
        <div className="rounded-2xl bg-niebla p-4">
          <div className="font-semibold">{u?.nombre}</div>
          <div className="text-sm text-apagado">{u?.correo}</div>
        </div>
        {clave ? <FormPassword onListo={() => setClave(false)} /> : <Boton variante="secundario" onClick={() => setClave(true)}>Cambiar contraseña</Boton>}
        <div>
          <h3 className="font-semibold">Verificación en dos pasos</h3>
          <p className="text-sm text-apagado">El panel de la plataforma la pide.</p>
          <DosPasos />
        </div>
      </div>
    </Hoja>
  )
}

// Alta de otra persona que administra la plataforma. La contraseña temporal se ve una sola vez.
function NuevaCuenta({ onCerrar, onCreada }: { onCerrar: () => void; onCreada: () => void }) {
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [creada, setCreada] = useState<{ correo: string; passwordTemporal: string } | null>(null)

  async function crear() {
    setEnviando(true)
    setError('')
    try {
      setCreada(await llamarAutenticado<{ correo: string; passwordTemporal: string }>('/plataforma/cuentas', { metodo: 'POST', cuerpo: { nombre: nombre.trim(), correo: correo.trim() } }))
      onCreada()
    } catch (e) {
      setError(e instanceof ErrorApi ? e.message : 'Sin conexión con el servidor')
    } finally {
      setEnviando(false)
    }
  }

  if (creada) {
    return (
      <Hoja abierta onCerrar={onCerrar} titulo="Cuenta creada" pie={<Boton className="w-full" onClick={onCerrar}>Listo</Boton>}>
        <p className="text-sm text-apagado">Compártele estos datos por un medio seguro. Al entrar se le pide cambiar la contraseña y, para este panel, activar la verificación en dos pasos.</p>
        <div className="mt-4 space-y-2 rounded-2xl bg-niebla p-4 text-sm">
          <div><span className="text-apagado">Correo:</span> <b>{creada.correo}</b></div>
          <div className="flex items-center gap-2">
            <span className="text-apagado">Contraseña temporal:</span> <b className="font-mono">{creada.passwordTemporal}</b>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(creada.passwordTemporal).then(() => aviso('Copiada'))} aria-label="Copiar contraseña" className="grid h-8 w-8 place-items-center rounded-full hover:bg-linea"><Copy size={15} /></button>
          </div>
        </div>
        <p className="mt-3 text-xs text-apagado">No se vuelve a mostrar. Si se pierde, usa «¿Olvidaste tu contraseña?» en el inicio de sesión.</p>
      </Hoja>
    )
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Nueva cuenta de la plataforma"
      pie={<Boton className="w-full" onClick={() => void crear()} disabled={enviando || nombre.trim().length < 2 || !correo.trim()}>{enviando ? 'Creando…' : 'Crear cuenta'}</Boton>}>
      <p className="mb-3 text-sm text-apagado">Podrá ver todas las empresas, suspenderlas y crear otras cuentas como ésta. No administra ningún negocio.</p>
      <div className="space-y-3">
        <Campo etiqueta="Nombre"><input className={claseInput} value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" /></Campo>
        <Campo etiqueta="Correo"><input className={claseInput} type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="off" placeholder="correo@ejemplo.com" /></Campo>
      </div>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-rojo">{error}</p>}
    </Hoja>
  )
}

function Cifra({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="rounded-2xl bg-niebla p-4">
      <div className="text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="mt-0.5 text-xs text-apagado">{etiqueta}</div>
    </div>
  )
}
