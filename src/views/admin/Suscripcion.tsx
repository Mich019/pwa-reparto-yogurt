import { useState } from 'react'
import { AlertCircle, CreditCard, LogOut, Sparkles } from 'lucide-react'
import { dinero } from '../../lib/fechas'
import { cerrarSesion } from '../../lib/sesion'
import { cancelarSuscripcion, suscribirse, type Suscripcion } from '../../lib/suscripcion'
import { LogoEmpresa } from './marca'

// Cobro en el panel: el aviso de días de prueba, la pantalla cuando la prueba o la suscripción se acaban, y la sección
// de Configuración. El pago pasa en Mercado Pago (src/lib/suscripcion.ts).

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const dias = (n: number) => (n === 1 ? '1 día' : `${n} días`)
const precio = (s: Suscripcion) => `${dinero(s.precio)} ${s.moneda} al mes`

function useSuscribirse() {
  const [yendo, setYendo] = useState(false)
  const [error, setError] = useState('')
  async function ir() {
    setYendo(true)
    setError('')
    try {
      await suscribirse() // la página se va a Mercado Pago
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir Mercado Pago')
      setYendo(false)
    }
  }
  return { yendo, error, ir }
}

function BotonSuscribirse({ s, grande = false }: { s: Suscripcion; grande?: boolean }) {
  const { yendo, error, ir } = useSuscribirse()
  return (
    <div>
      <button
        type="button"
        onClick={() => void ir()}
        disabled={yendo || !s.cobroDisponible}
        className={`flex items-center justify-center gap-2 rounded-full bg-tinta font-semibold text-white transition-colors hover:bg-marca-oscuro disabled:opacity-40 ${grande ? 'w-full py-4 text-base' : 'px-5 py-3 text-sm'} ${anillo}`}
      >
        <CreditCard size={grande ? 18 : 16} aria-hidden="true" /> {yendo ? 'Abriendo Mercado Pago…' : 'Suscribirme con Mercado Pago'}
      </button>
      {!s.cobroDisponible && <p className="mt-2 text-sm text-apagado">El cobro todavía no está disponible. Escríbenos y lo activamos.</p>}
      {error && <p role="alert" className="mt-2 flex items-center gap-2 text-sm font-medium text-rojo"><AlertCircle size={15} className="shrink-0" /> {error}</p>}
    </div>
  )
}

// Encima del panel durante la última semana de prueba.
export function AvisoPrueba({ s, onVer }: { s: Suscripcion; onVer: () => void }) {
  if (s.estado !== 'prueba' || s.diasPrueba > 7 || s.suscripcion === 'pending') return null
  return (
    <div className="mx-4 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-marca/10 px-4 py-3 text-sm sm:mx-8">
      <Sparkles size={18} className="shrink-0 text-marca" aria-hidden="true" />
      <span className="flex-1">
        {s.diasPrueba === 0 ? 'Tu prueba gratis termina hoy.' : <>Te {s.diasPrueba === 1 ? 'queda' : 'quedan'} <b>{dias(s.diasPrueba)}</b> de prueba gratis.</>} Suscríbete para no perder el acceso.
      </span>
      <button type="button" onClick={onVer} className={`rounded-full bg-tinta px-4 py-2 font-semibold text-white hover:bg-marca-oscuro ${anillo}`}>
        Ver suscripción
      </button>
    </div>
  )
}

// En lugar del panel cuando ya no hay acceso. Los datos siguen guardados.
export function PantallaCobro({ s }: { s: Suscripcion }) {
  const pendiente = s.suscripcion === 'pending'
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10 text-center">
      <LogoEmpresa className="h-16" />
      <h1 className="mt-10 max-w-md text-3xl font-semibold leading-tight">{s.suscripcion === 'cancelled' || s.suscripcion === 'paused' ? 'Tu suscripción terminó' : 'Tu prueba gratis terminó'}</h1>
      <p className="mt-3 max-w-md text-apagado">
        Tus clientes, pedidos y reportes siguen guardados. Suscríbete para que tú y tus repartidores sigan trabajando.
      </p>
      <div className="mt-8 w-full max-w-sm rounded-[28px] border border-linea p-6 text-left">
        <div className="text-sm font-semibold text-apagado">Plan mensual</div>
        <div className="mt-1 text-3xl font-semibold">{precio(s)}</div>
        <p className="mt-1 text-sm text-apagado">Todo incluido: panel, app de reparto y reportes. Cancelas cuando quieras.</p>
        {pendiente && <p className="mt-4 rounded-2xl bg-niebla px-4 py-3 text-sm">Empezaste a pagar pero Mercado Pago aún no lo confirma. Si ya pagaste, espera unos minutos y recarga.</p>}
        <div className="mt-5"><BotonSuscribirse s={s} grande /></div>
      </div>
      <button type="button" onClick={() => void cerrarSesion()} className={`mt-6 flex items-center gap-2 text-sm font-semibold text-apagado hover:text-tinta ${anillo}`}>
        <LogOut size={15} aria-hidden="true" /> Cerrar sesión
      </button>
    </div>
  )
}

// Configuración → Suscripción.
export function SeccionSuscripcion({ s }: { s: Suscripcion }) {
  const [cancelando, setCancelando] = useState(false)
  const [error, setError] = useState('')
  async function cancelar() {
    if (!window.confirm('¿Cancelar la suscripción? Mercado Pago dejará de cobrarte y la empresa perderá el acceso cuando termine la prueba.')) return
    setCancelando(true)
    setError('')
    try {
      await cancelarSuscripcion()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar')
    } finally {
      setCancelando(false)
    }
  }

  if (s.estado === 'exenta') return <p className="text-sm">Tu empresa no paga suscripción.</p>
  const fin = new Date(s.pruebaHasta).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-niebla p-4">
        <div className="font-semibold">
          {s.estado === 'activa' ? 'Suscripción activa'
            : s.estado === 'prueba' ? (s.suscripcion === 'pending' ? 'Prueba gratis · pago en proceso' : `Prueba gratis · ${s.diasPrueba ? `quedan ${dias(s.diasPrueba)}` : 'termina hoy'}`)
            : 'Sin acceso: la prueba terminó'}
        </div>
        <div className="mt-0.5 text-sm text-apagado">
          {s.estado === 'activa' ? `${precio(s)}, con cobro automático en Mercado Pago.` : s.estado === 'prueba' ? `Hasta el ${fin}. Si te suscribes antes, el primer cobro llega ese día.` : precio(s)}
        </div>
      </div>
      {s.estado !== 'activa' && <BotonSuscribirse s={s} />}
      {(s.suscripcion === 'authorized' || s.suscripcion === 'pending') && (
        <button type="button" onClick={() => void cancelar()} disabled={cancelando} className={`rounded-full border border-rojo/40 px-5 py-3 text-sm font-semibold text-rojo transition-colors hover:bg-rojo/10 disabled:opacity-40 ${anillo}`}>
          {cancelando ? 'Cancelando…' : 'Cancelar suscripción'}
        </button>
      )}
      {error && <p role="alert" className="text-sm font-medium text-rojo">{error}</p>}
    </div>
  )
}
