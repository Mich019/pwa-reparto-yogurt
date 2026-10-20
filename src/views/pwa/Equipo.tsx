import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRightLeft, Check, ChevronRight, Copy, KeyRound, MessageCircle, Pencil, Search, Share2, ShieldCheck, TriangleAlert, UserCheck, UserPlus, UserX } from 'lucide-react'
import { ErrorApi, ErrorRed } from '../../lib/api'
import { db, type Cliente } from '../../lib/db'
import {
  cargarEquipo, crearMiembro, darDeBaja, editarMiembro, reactivar, reasignarClientes, restablecerPassword, textoReasignado, useEquipo,
  type Miembro,
} from '../../lib/equipo'
import { hace } from '../../lib/fechas'
import { useSesion, type Rol } from '../../lib/sesion'
import { Accion, Boton, Campo, Hoja, Segmentado, aviso, claseInput, telLimpio } from '../../components/ui'

// M07 · Alta y baja de vendedores y reasignación de clientes (RF-038 a RF-041). Sólo para el administrador.

const ROL_TEXTO: Record<Rol, string> = { administrador: 'Administrador', vendedor: 'Vendedor' }
const SIN_VENDEDOR = 'sin' // en los selectores, "ningún vendedor"
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const mensaje = (e: unknown) => (e instanceof ErrorApi || e instanceof ErrorRed ? e.message : 'No se pudo completar. Intenta de nuevo.')
const bloqueada = (m: Miembro) => !!m.bloqueadoHasta && new Date(m.bloqueadoHasta) > new Date()

function Etiqueta({ m }: { m: Miembro }) {
  const [texto, clase] = !m.activo ? ['De baja', 'bg-rojo/10 text-rojo']
    : bloqueada(m) ? ['Bloqueada', 'bg-ambar/30 text-tinta']
    : m.debeCambiarPassword ? ['Clave temporal', 'bg-azul/10 text-azul']
    : ['', '']
  return texto ? <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${clase}`}>{texto}</span> : null
}

export function Equipo() {
  const yo = useSesion()?.usuario
  const equipo = useEquipo()
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [fichaId, setFichaId] = useState<string | null>(null)
  const [form, setForm] = useState<Miembro | 'nuevo' | null>(null)
  const [clave, setClave] = useState<DatosClave | null>(null)
  const [cartera, setCartera] = useState<{ desde: string } | null>(null)

  async function cargar() {
    setCargando(true)
    setError('')
    try {
      await cargarEquipo()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setCargando(false)
    }
  }
  useEffect(() => { void cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ficha = equipo?.usuarios.find((u) => u.id === fichaId)
  const activos = equipo?.usuarios.filter((u) => u.activo) ?? []
  const deBaja = equipo?.usuarios.filter((u) => !u.activo) ?? []

  const fila = (m: Miembro) => (
    <button key={m.id} onClick={() => setFichaId(m.id)} className="flex w-full items-center gap-3 border-b border-linea py-3.5 text-left active:bg-niebla">
      <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-semibold ${m.activo ? 'bg-niebla' : 'bg-niebla text-apagado'}`}>{m.nombre.charAt(0).toUpperCase()}</div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-base leading-5 font-semibold ${m.activo ? '' : 'text-apagado'}`}>
          {m.nombre}{m.id === yo?.id && <span className="font-medium text-apagado"> (tú)</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-sm text-apagado">
          {m.rol === 'administrador' && <ShieldCheck size={14} className="shrink-0" />}
          {m.rol === 'administrador' ? ROL_TEXTO.administrador : plural(m.clientes, 'cliente', 'clientes')}
        </div>
      </div>
      <Etiqueta m={m} />
      <ChevronRight size={18} className="shrink-0 text-apagado/60" />
    </button>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-safe">
        <div className="mt-3 flex items-center justify-between gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Equipo</h1>
          <button onClick={() => setForm('nuevo')} aria-label="Nueva cuenta" className="flex items-center gap-2 rounded-full bg-tinta px-4 py-2.5 text-sm font-semibold text-white active:bg-neutral-700">
            <UserPlus size={18} /> Nueva cuenta
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-28">
        {error && (
          <div className="mt-3 rounded-2xl bg-rojo/10 p-4">
            <p role="alert" className="text-sm font-medium text-rojo">{error}</p>
            <Boton variante="secundario" className="mt-3 w-full bg-white" onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Cargando…' : 'Reintentar'}</Boton>
          </div>
        )}
        {!equipo && !error && <div className="py-12 text-center text-apagado">Cargando equipo…</div>}

        {equipo && equipo.clientesSinAsignar > 0 && (
          <button onClick={() => setCartera({ desde: SIN_VENDEDOR })} className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-ambar/20 p-4 text-left">
            <TriangleAlert size={22} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{plural(equipo.clientesSinAsignar, 'cliente sin vendedor', 'clientes sin vendedor')}</div>
              <div className="text-sm text-apagado">Sólo tú los ves. Toca para asignarlos.</div>
            </div>
            <ChevronRight size={18} className="shrink-0 text-apagado/60" />
          </button>
        )}

        {activos.map(fila)}

        {deBaja.length > 0 && (
          <>
            <div className="mt-5 mb-1 text-sm font-semibold text-apagado">Dados de baja</div>
            {deBaja.map(fila)}
          </>
        )}
      </div>

      {ficha && (
        <FichaMiembro
          m={ficha}
          esYo={ficha.id === yo?.id}
          otros={activos.filter((u) => u.id !== ficha.id)}
          onCerrar={() => setFichaId(null)}
          onEditar={() => setForm(ficha)}
          onClave={setClave}
          onCartera={() => setCartera({ desde: ficha.id })}
        />
      )}
      {form && (
        <FormMiembro
          miembro={form === 'nuevo' ? undefined : form}
          esYo={form !== 'nuevo' && form.id === yo?.id}
          onCerrar={() => setForm(null)}
          onClave={(d) => { setForm(null); setClave(d) }}
        />
      )}
      {clave && <ClaveTemporal datos={clave} onCerrar={() => setClave(null)} />}
      {cartera && equipo && <ReasignarCartera equipo={equipo.usuarios} sinAsignar={equipo.clientesSinAsignar} desdeInicial={cartera.desde} onCerrar={() => setCartera(null)} />}
    </div>
  )
}

// ------------------------------------------------------------------ ficha de una cuenta
function FichaMiembro({ m, esYo, otros, onCerrar, onEditar, onClave, onCartera }: {
  m: Miembro
  esYo: boolean
  otros: Miembro[]
  onCerrar: () => void
  onEditar: () => void
  onClave: (d: DatosClave) => void
  onCartera: () => void
}) {
  const [confirmar, setConfirmar] = useState<'password' | 'baja' | null>(null)
  const [destino, setDestino] = useState('') // qué hacer con sus clientes al dar de baja: '' = decidir después
  const [trabajando, setTrabajando] = useState(false)

  async function correr(accion: () => Promise<void>) {
    setTrabajando(true)
    try {
      await accion()
    } catch (e) {
      aviso(mensaje(e))
    } finally {
      setTrabajando(false)
    }
  }

  const restablecer = () => correr(async () => {
    const password = await restablecerPassword(m.id)
    setConfirmar(null)
    onClave({ nombre: m.nombre, correo: m.correo, telefono: m.telefono, password, nueva: false })
  })

  const baja = () => correr(async () => {
    await darDeBaja(m.id)
    let extra = ''
    if (destino && m.clientes > 0) {
      try {
        const hacia = destino === SIN_VENDEDOR ? null : destino
        const r = await reasignarClientes({ desde: m.id, hacia })
        extra = `. ${textoReasignado(r, destino === SIN_VENDEDOR ? 'a sin vendedor' : `a ${otros.find((o) => o.id === destino)?.nombre ?? 'otro vendedor'}`)}`
      } catch (e) {
        extra = `. No se pudo pasar su cartera (${mensaje(e)}); hazlo desde «Pasar cartera»`
      }
    }
    setConfirmar(null)
    aviso(`${m.nombre} ya no puede entrar${extra}`)
  })

  const alta = () => correr(async () => {
    await reactivar(m.id)
    aviso(`${m.nombre} volvió a tener acceso`)
  })

  return (
    <Hoja abierta onCerrar={onCerrar} titulo={m.nombre}>
      <div className="space-y-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-niebla px-3 py-1.5 text-xs font-semibold">
            {m.rol === 'administrador' && <ShieldCheck size={14} />}{ROL_TEXTO[m.rol]}
          </span>
          <Etiqueta m={m} />
        </div>

        <dl className="space-y-1 rounded-2xl bg-niebla p-4 text-sm">
          <Linea t="Correo" v={m.correo} />
          <Linea t="Teléfono" v={m.telefono || '—'} />
          <Linea t="Último acceso" v={m.ultimoAcceso ? hace(new Date(m.ultimoAcceso).getTime()) : 'Todavía no ha entrado'} />
          {m.rol === 'vendedor' && <Linea t="Clientes" v={`${m.clientes}${m.clientes !== m.clientesActivos ? ` (${m.clientesActivos} activos)` : ''}`} />}
        </dl>

        {!confirmar && (
          <div className="grid grid-cols-4 gap-1">
            <Accion onClick={onEditar} icono={<Pencil size={22} />} texto="Editar" />
            {!esYo && <Accion onClick={() => setConfirmar('password')} icono={<KeyRound size={22} />} texto="Contraseña" />}
            {m.clientes > 0 && <Accion onClick={onCartera} icono={<ArrowRightLeft size={22} />} texto="Pasar cartera" />}
            {!esYo && (m.activo
              ? <Accion onClick={() => setConfirmar('baja')} icono={<UserX size={22} />} texto="Dar de baja" />
              : <Accion onClick={() => void alta()} icono={<UserCheck size={22} />} texto="Reactivar" />)}
          </div>
        )}

        {confirmar === 'password' && (
          <div className="space-y-3 rounded-2xl bg-niebla p-4">
            <p className="font-semibold">¿Restablecer la contraseña de {m.nombre}?</p>
            <p className="text-sm text-apagado">Se cierran sus sesiones en todos sus teléfonos y, al entrar con la contraseña temporal, tendrá que elegir una propia.</p>
            <div className="grid grid-cols-2 gap-2">
              <Boton variante="secundario" className="bg-white" onClick={() => setConfirmar(null)} disabled={trabajando}>Cancelar</Boton>
              <Boton onClick={() => void restablecer()} disabled={trabajando}>{trabajando ? 'Un momento…' : 'Restablecer'}</Boton>
            </div>
          </div>
        )}

        {confirmar === 'baja' && (
          <div className="space-y-3 rounded-2xl bg-rojo/10 p-4">
            <p className="font-semibold">¿Dar de baja a {m.nombre}?</p>
            <p className="text-sm">Deja de entrar al instante, en todos sus teléfonos. Sus clientes y su historial se conservan y puedes reactivarla cuando quieras.</p>
            {m.clientes > 0 && (
              <Campo etiqueta={m.clientes === 1 ? '¿Qué hacemos con su cliente?' : `¿Qué hacemos con sus ${m.clientes} clientes?`}>
                <select className={claseInput} value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <option value="">Decidir después</option>
                  {otros.map((o) => <option key={o.id} value={o.id}>Pasarlos a {o.nombre}</option>)}
                  <option value={SIN_VENDEDOR}>Dejarlos sin vendedor</option>
                </select>
              </Campo>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Boton variante="secundario" className="bg-white" onClick={() => setConfirmar(null)} disabled={trabajando}>Cancelar</Boton>
              <Boton variante="primario" className="!bg-rojo" onClick={() => void baja()} disabled={trabajando}>{trabajando ? 'Un momento…' : 'Dar de baja'}</Boton>
            </div>
          </div>
        )}
      </div>
    </Hoja>
  )
}

function Linea({ t, v }: { t: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-apagado">{t}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
    </div>
  )
}

// ------------------------------------------------------------------ alta y edición (RF-038, RF-039)
function FormMiembro({ miembro, esYo, onCerrar, onClave }: { miembro?: Miembro; esYo: boolean; onCerrar: () => void; onClave: (d: DatosClave) => void }) {
  const [nombre, setNombre] = useState(miembro?.nombre ?? '')
  const [correo, setCorreo] = useState(miembro?.correo ?? '')
  const [telefono, setTelefono] = useState(miembro?.telefono ?? '')
  const [rol, setRol] = useState<Rol>(miembro?.rol ?? 'vendedor')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    const n = nombre.trim(), c = correo.trim(), t = telefono.trim()
    if (n.length < 2) return setError('Escribe el nombre completo')
    if (!/^\S+@\S+\.\S+$/.test(c)) return setError('Escribe un correo válido')
    setGuardando(true)
    setError('')
    try {
      if (!miembro) {
        const r = await crearMiembro({ nombre: n, correo: c, telefono: t || undefined, rol })
        onClave({ nombre: r.usuario.nombre, correo: r.usuario.correo, telefono: r.usuario.telefono, password: r.passwordTemporal, nueva: true })
      } else {
        const cambios: Parameters<typeof editarMiembro>[1] = {}
        if (n !== miembro.nombre) cambios.nombre = n
        if (c !== miembro.correo) cambios.correo = c
        if (t !== miembro.telefono) cambios.telefono = t
        if (rol !== miembro.rol) cambios.rol = rol
        if (Object.keys(cambios).length) await editarMiembro(miembro.id, cambios)
        aviso('Cuenta actualizada')
        onCerrar()
      }
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Hoja
      abierta onCerrar={onCerrar} alto titulo={miembro ? 'Editar cuenta' : 'Nueva cuenta'}
      pie={<Boton className="w-full" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : miembro ? 'Guardar cambios' : 'Crear cuenta'}</Boton>}
    >
      <form className="space-y-4 pb-4" onSubmit={(e) => { e.preventDefault(); void guardar() }}>
        <Campo etiqueta="Nombre"><input className={claseInput} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Rosa Hernández" autoComplete="off" /></Campo>
        <Campo etiqueta="Correo (con él entra)"><input className={claseInput} type="email" inputMode="email" autoCapitalize="none" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="rosa@correo.com" autoComplete="off" /></Campo>
        <Campo etiqueta="Teléfono / WhatsApp"><input className={claseInput} inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="10 dígitos (opcional)" autoComplete="off" /></Campo>
        <div>
          <div className="mb-2 text-sm font-semibold text-apagado">Puesto</div>
          {esYo ? (
            <p className="rounded-xl bg-niebla px-4 py-3.5 text-sm text-apagado">Eres administrador. Tu propio puesto no se puede cambiar; que lo haga otro administrador.</p>
          ) : (
            <Segmentado valor={rol} onChange={setRol} opciones={[{ valor: 'vendedor', texto: 'Vendedor' }, { valor: 'administrador', texto: 'Administrador' }]} />
          )}
          <p className="mt-2 text-xs text-apagado">El vendedor sólo ve su ruta y sus clientes. El administrador ve todo, incluidos costos y márgenes.</p>
        </div>
        {!miembro && <p className="rounded-xl bg-niebla px-4 py-3 text-sm text-apagado">Al crearla se genera una contraseña temporal. En su primer ingreso tendrá que elegir una propia.</p>}
        {error && <p role="alert" className="rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
        <button type="submit" className="hidden" />
      </form>
    </Hoja>
  )
}

// ------------------------------------------------------------------ contraseña temporal
interface DatosClave { nombre: string; correo: string; telefono: string; password: string; nueva: boolean }

function ClaveTemporal({ datos, onCerrar }: { datos: DatosClave; onCerrar: () => void }) {
  const [copiado, setCopiado] = useState(false)
  const url = new URL('./', location.href).href
  const texto = `Hola ${datos.nombre.split(' ')[0]}, ya tienes cuenta en Reparto Yogurt.\nAbre ${url}\nCorreo: ${datos.correo}\nContraseña temporal: ${datos.password}\nAl entrar te pedirá elegir tu propia contraseña.`

  async function copiar(que: string, aviso_: string) {
    try {
      await navigator.clipboard.writeText(que)
      setCopiado(true)
      aviso(aviso_)
    } catch {
      aviso('No se pudo copiar. Anótala a mano.')
    }
  }
  const puedeCompartir = typeof navigator.share === 'function'

  return (
    <Hoja abierta onCerrar={onCerrar} titulo={datos.nueva ? 'Cuenta creada' : 'Contraseña restablecida'}>
      <div className="space-y-5 pb-4">
        <p className="text-sm text-apagado">
          Dale a {datos.nombre} esta contraseña temporal por un medio privado. <strong className="text-tinta">Sólo se muestra ahora</strong>; al entrar con ella tendrá que elegir una propia.
        </p>
        <div className="rounded-2xl bg-niebla px-4 py-5 text-center">
          <div className="text-xs font-semibold text-apagado">{datos.correo}</div>
          <div data-testid="clave-temporal" className="mt-1.5 font-mono text-3xl font-bold tracking-wider select-all">{datos.password}</div>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <Accion onClick={() => void copiar(texto, 'Mensaje copiado')} icono={copiado ? <Check size={22} /> : <Copy size={22} />} texto="Copiar mensaje" />
          {datos.telefono && <Accion href={`https://wa.me/${telLimpio(datos.telefono)}?text=${encodeURIComponent(texto)}`} icono={<MessageCircle size={22} />} texto="WhatsApp" />}
          {puedeCompartir && <Accion onClick={() => void navigator.share({ text: texto }).catch(() => {})} icono={<Share2 size={22} />} texto="Compartir" />}
          <Accion onClick={() => void copiar(datos.password, 'Contraseña copiada')} icono={<KeyRound size={22} />} texto="Sólo la clave" />
        </div>
        <Boton className="w-full" onClick={onCerrar}>Listo</Boton>
      </div>
    </Hoja>
  )
}

// ------------------------------------------------------------------ reasignar cartera (RF-041)
function ReasignarCartera({ equipo, sinAsignar, desdeInicial, onCerrar }: { equipo: Miembro[]; sinAsignar: number; desdeInicial: string; onCerrar: () => void }) {
  const [desde, setDesde] = useState(desdeInicial)
  const [hacia, setHacia] = useState('')
  const [modo, setModo] = useState<'toda' | 'elegir'>('toda')
  const [elegidos, setElegidos] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const locales = useLiveQuery(() => db.clientes.orderBy('nombre').toArray(), []) ?? []

  const origenes = equipo.filter((m) => m.clientes > 0)
  const total = desde === SIN_VENDEDOR ? sinAsignar : equipo.find((m) => m.id === desde)?.clientes ?? 0
  const destinos = equipo.filter((m) => m.activo && m.id !== desde)

  const delOrigen = useMemo(() => {
    const t = q.trim().toLowerCase()
    return locales.filter((c: Cliente) => (c.vendedorId ?? SIN_VENDEDOR) === desde && (!t || `${c.nombre} ${c.direccion}`.toLowerCase().includes(t)))
  }, [locales, desde, q])

  const cuantos = modo === 'toda' ? total : elegidos.size
  const nombreDestino = hacia === SIN_VENDEDOR ? 'a sin vendedor' : `a ${equipo.find((m) => m.id === hacia)?.nombre ?? ''}`

  function cambiarOrigen(v: string) {
    setDesde(v)
    setElegidos(new Set())
    if (hacia === v) setHacia('')
  }
  const alternar = (id: string) => setElegidos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  async function pasar() {
    if (!hacia || !cuantos) return
    setTrabajando(true)
    setError('')
    try {
      const destino = hacia === SIN_VENDEDOR ? null : hacia
      const r = await reasignarClientes(modo === 'toda' ? { desde: desde === SIN_VENDEDOR ? null : desde, hacia: destino } : { clienteIds: [...elegidos], hacia: destino })
      aviso(textoReasignado(r, nombreDestino))
      onCerrar()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <Hoja
      abierta onCerrar={onCerrar} alto titulo="Pasar cartera"
      pie={
        <Boton className="w-full" onClick={() => void pasar()} disabled={trabajando || !hacia || !cuantos}>
          {trabajando ? 'Pasando…' : hacia && cuantos ? `Pasar ${plural(cuantos, 'cliente', 'clientes')} ${nombreDestino}` : 'Elige a dónde pasan'}
        </Boton>
      }
    >
      <div className="space-y-4 pb-4">
        <Campo etiqueta="De">
          <select className={claseInput} value={desde} onChange={(e) => cambiarOrigen(e.target.value)}>
            {origenes.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.activo ? '' : ' (de baja)'} · {plural(m.clientes, 'cliente', 'clientes')}</option>)}
            {sinAsignar > 0 && <option value={SIN_VENDEDOR}>Sin vendedor · {plural(sinAsignar, 'cliente', 'clientes')}</option>}
            {!origenes.some((m) => m.id === desde) && desde !== SIN_VENDEDOR && <option value={desde}>{equipo.find((m) => m.id === desde)?.nombre}</option>}
          </select>
        </Campo>
        <Campo etiqueta="A">
          <select className={claseInput} value={hacia} onChange={(e) => setHacia(e.target.value)}>
            <option value="">Elige un vendedor…</option>
            {destinos.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.rol === 'administrador' ? ' (administrador)' : ''}</option>)}
            {desde !== SIN_VENDEDOR && <option value={SIN_VENDEDOR}>Sin vendedor (sólo el administrador los ve)</option>}
          </select>
        </Campo>
        <Segmentado
          valor={modo} onChange={setModo}
          opciones={[{ valor: 'toda', texto: `Toda la cartera (${total})` }, { valor: 'elegir', texto: 'Elegir clientes' }]}
        />

        {modo === 'elegir' && (
          <div>
            <div className="relative">
              <Search size={18} className="absolute top-1/2 left-4 -translate-y-1/2 text-tinta" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre o calle" className={`${claseInput} pl-11`} />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-apagado">{plural(elegidos.size, 'elegido', 'elegidos')} de {delOrigen.length}</span>
              <button className="font-semibold text-azul" onClick={() => setElegidos(elegidos.size === delOrigen.length ? new Set() : new Set(delOrigen.map((c) => c.id)))}>
                {elegidos.size === delOrigen.length && delOrigen.length > 0 ? 'Quitar todos' : 'Elegir todos'}
              </button>
            </div>
            <ul className="mt-1">
              {delOrigen.map((c) => (
                <li key={c.id}>
                  <button onClick={() => alternar(c.id)} aria-pressed={elegidos.has(c.id)} className="flex w-full items-center gap-3 border-b border-linea py-3 text-left active:bg-niebla">
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 ${elegidos.has(c.id) ? 'border-tinta bg-tinta text-white' : 'border-linea'}`}>{elegidos.has(c.id) && <Check size={16} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.nombre}{c.activo ? '' : ' (archivado)'}</span>
                      <span className="block truncate text-sm text-apagado">{c.direccion}</span>
                    </span>
                  </button>
                </li>
              ))}
              {delOrigen.length === 0 && <li className="py-6 text-center text-sm text-apagado">{locales.length ? 'Sin clientes que mostrar' : 'Este teléfono todavía no descarga los clientes. Sincroniza y vuelve a intentar.'}</li>}
            </ul>
          </div>
        )}

        <p className="rounded-xl bg-niebla px-4 py-3 text-sm text-apagado">
          Los clientes pasan con sus pedidos agendados y recordatorios pendientes. Lo ya entregado se queda como venta de quien lo hizo, pero el nuevo vendedor lo ve en el historial. Al sincronizar, el teléfono anterior deja de mostrarlos.
        </p>
        {error && <p role="alert" className="rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
      </div>
    </Hoja>
  )
}

// ------------------------------------------------------------------ un cliente con otro vendedor (desde su perfil)
export function CambiarVendedor({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const equipo = useEquipo()
  const [error, setError] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  useEffect(() => { void cargarEquipo().catch((e) => setError(mensaje(e))) }, [])

  const actual = cliente.vendedorId ?? SIN_VENDEDOR
  async function pasar(hacia: string, nombre: string) {
    setTrabajando(true)
    setError('')
    try {
      const r = await reasignarClientes({ clienteIds: [cliente.id], hacia: hacia === SIN_VENDEDOR ? null : hacia })
      aviso(textoReasignado(r, nombre === 'Sin vendedor' ? 'a sin vendedor' : `a ${nombre}`))
      onCerrar()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setTrabajando(false)
    }
  }

  const opciones = [
    ...(equipo?.usuarios.filter((u) => u.activo || u.id === actual) ?? []).map((u) => ({ id: u.id, nombre: u.nombre, nota: u.activo ? (u.rol === 'administrador' ? 'Administrador' : plural(u.clientes, 'cliente', 'clientes')) : 'De baja' })),
    { id: SIN_VENDEDOR, nombre: 'Sin vendedor', nota: 'Sólo el administrador lo ve' },
  ]
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Cambiar de vendedor">
      <div className="pb-4">
        <p className="mb-2 text-sm text-apagado">{cliente.nombre} pasa con sus pedidos agendados. Elige a quién:</p>
        {!equipo && !error && <div className="py-8 text-center text-apagado">Cargando…</div>}
        {equipo && opciones.map((o) => (
          <button key={o.id} disabled={trabajando || o.id === actual} onClick={() => void pasar(o.id, o.nombre)} className="flex w-full items-center gap-3 border-b border-linea py-3.5 text-left active:bg-niebla disabled:opacity-60">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{o.nombre}</span>
              <span className="block truncate text-sm text-apagado">{o.nota}</span>
            </span>
            {o.id === actual ? <span className="flex items-center gap-1 text-sm font-semibold"><Check size={16} /> Actual</span> : <ChevronRight size={18} className="shrink-0 text-apagado/60" />}
          </button>
        ))}
        {error && <p role="alert" className="mt-3 rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
      </div>
    </Hoja>
  )
}
