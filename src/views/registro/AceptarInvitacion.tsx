import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Check, Eye, EyeOff } from 'lucide-react'
import { api, ErrorApi, ErrorRed } from '../../lib/api'
import { reglasPassword } from '../../lib/registro'
import { iniciarSesion } from '../../lib/sesion'
import { claseInput } from '../../components/ui'

// El repartidor abre el enlace de su invitación (/invitacion#<enlace>, api/_lib/registro.ts), escribe su nombre y crea su
// contraseña. Al terminar entra directo a la app de reparto.

type Invitacion = { correo: string; empresa: { nombre: string; color: string | null; logo: string | null } }

// El enlace va en el fragmento (#): no viaja a ningún servidor ni queda en el historial al quitarlo de la dirección.
const leerEnlace = () => {
  const t = window.location.hash.slice(1)
  if (t) window.history.replaceState({}, '', window.location.pathname)
  return t
}

export function AceptarInvitacion({ onListo }: { onListo: () => void }) {
  const [token] = useState(leerEnlace)
  const [inv, setInv] = useState<Invitacion | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'lista' | 'invalida' | 'enviando'>('cargando')
  const [nombre, setNombre] = useState('')
  const [password, setPassword] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return setEstado('invalida')
    api<Invitacion>('/invitacion/consultar', { cuerpo: { token } })
      .then((r) => { setInv(r); setEstado('lista') })
      .catch((e) => {
        if (e instanceof ErrorRed) setError('Sin conexión con el servidor. Revisa tu señal y vuelve a abrir el enlace.')
        setEstado('invalida')
      })
  }, [token])

  const reglas = reglasPassword(password, inv?.correo ?? '')
  const falta = nombre.trim().length < 2 ? 'Escribe tu nombre' : !reglas.every((x) => x.ok) ? 'La contraseña aún no cumple las reglas' : null

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (falta || !inv) return setError(falta ?? '')
    setEstado('enviando')
    setError('')
    try {
      await api('/invitacion/aceptar', { cuerpo: { token, nombre: nombre.trim(), password: password.trim() } })
      await iniciarSesion(inv.correo, password).catch(() => {}) // si falla, la app pide iniciar sesión
      onListo()
    } catch (x) {
      if (x instanceof ErrorApi && x.codigo === 'INVITACION_INVALIDA') return setEstado('invalida')
      setError(x instanceof ErrorRed ? 'Sin conexión con el servidor. Inténtalo en un momento.' : x instanceof Error ? x.message : 'No se pudo crear tu cuenta')
      setEstado('lista')
    }
  }

  if (estado === 'cargando') {
    return <div className="grid min-h-dvh place-items-center"><span className="h-8 w-8 animate-spin rounded-full border-[3px] border-tinta border-t-transparent" /></div>
  }

  if (estado === 'invalida' || !inv) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-niebla text-apagado"><AlertCircle size={32} /></span>
        <h1 className="mt-6 text-[1.9rem] font-semibold leading-tight">Esta invitación ya no sirve</h1>
        <p className="mt-2 max-w-sm text-apagado">{error || 'Ya se usó o venció. Pide a quien te invitó que te mande otra.'}</p>
        <button type="button" onClick={onListo} className="mt-8 rounded-full bg-niebla px-8 py-4 font-semibold text-tinta hover:bg-linea">
          Ir a iniciar sesión
        </button>
      </div>
    )
  }

  const color = inv.empresa.color ?? undefined
  return (
    <form onSubmit={crear} noValidate className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4 py-10">
      <div className="flex items-center gap-3">
        {inv.empresa.logo
          ? <img src={inv.empresa.logo} alt="" className="h-14 w-14 rounded-2xl bg-papel object-contain p-1.5 ring-1 ring-linea" />
          : <span className="grid h-14 w-14 place-items-center rounded-2xl bg-tinta text-2xl font-bold text-white" style={{ background: color }}>{inv.empresa.nombre.slice(0, 1).toUpperCase()}</span>}
        <span className="text-lg font-semibold">{inv.empresa.nombre}</span>
      </div>
      <h1 className="mt-8 text-[1.9rem] font-semibold leading-[1.15]">Te invitaron a repartir</h1>
      <p className="mt-2 text-[15px] text-apagado">Crea tu cuenta para ver tu ruta y levantar pedidos desde tu teléfono. Entrarás con <span className="font-semibold text-tinta">{inv.correo}</span>.</p>

      <label className="mt-8 block">
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Tu nombre</span>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" placeholder="Nombre y apellido" autoFocus className={`${claseInput} py-4 text-lg`} />
      </label>
      <label className="mt-5 block">
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Tu contraseña</span>
        <span className="relative block">
          <input type={ver ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={`${claseInput} py-4 pr-14 text-lg`} />
          <button type="button" onClick={() => setVer(!ver)} className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-apagado hover:text-tinta" aria-label={ver ? 'Ocultar contraseña' : 'Ver contraseña'}>
            {ver ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </span>
      </label>
      <ul className="mt-4 space-y-2" aria-label="Reglas de la contraseña">
        {reglas.map((x) => (
          <li key={x.texto} className={`flex items-center gap-2.5 text-[15px] transition-colors ${x.ok ? 'text-verde' : 'text-apagado'}`}>
            <span className={`grid h-5 w-5 place-items-center rounded-full transition-colors ${x.ok ? 'bg-verde text-white' : 'border-2 border-linea'}`}>
              {x.ok && <Check size={12} strokeWidth={3.5} />}
            </span>
            {x.texto}
          </li>
        ))}
      </ul>

      {error && <p role="alert" className="mt-5 flex items-center gap-2 text-sm font-medium text-rojo"><AlertCircle size={16} className="shrink-0" /> {error}</p>}
      <button
        type="submit"
        disabled={estado === 'enviando'}
        className={`mt-8 flex items-center justify-center gap-2 rounded-full bg-tinta py-4 text-base font-semibold text-white transition-opacity hover:bg-marca-oscuro disabled:opacity-40 ${falta ? 'opacity-50' : ''}`}
      >
        {estado === 'enviando' ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Creando…</> : <>Crear mi cuenta <ArrowRight size={18} /></>}
      </button>
    </form>
  )
}
