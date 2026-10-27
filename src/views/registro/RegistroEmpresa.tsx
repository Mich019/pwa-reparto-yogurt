import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, ImagePlus, Minus, Package, Pencil, Plus, RotateCcw, Trash2, X,
} from 'lucide-react'
import { api, ErrorApi, ErrorRed } from '../../lib/api'
import { dinero } from '../../lib/fechas'
import {
  aplicarSugerencias, borrarBorrador, COLORES_MARCA, cuerpoRegistro, envaseDeTipo, faltaEnCuenta, faltaEnEnvases,
  faltaEnNegocio, faltaEnProductos, formatoCantidad, GIROS, guardarBorrador, leerBorrador, nombreEnvase, numero,
  presentaciones, productoNuevo, registroVacio, reglasPassword, TIPOS_ENVASE, UNIDADES, ZONAS_HORARIAS,
  type Envase, type Giro, type Producto, type Registro,
} from '../../lib/registro'
import { Campo, claseInput } from '../../components/ui'

// Formulario progresivo para dar de alta una empresa (/registro). Una pregunta a la vez: cada paso pide sólo lo
// suyo, lo siguiente aparece cuando lo anterior está listo, y el avance se guarda en el equipo para seguir después.

const PASOS = [
  { clave: 'negocio', titulo: 'Tu negocio', pregunta: '¿Cómo se llama tu negocio y qué vende?' },
  { clave: 'cuenta', titulo: 'Tu cuenta', pregunta: 'Crea tu cuenta de administrador' },
  { clave: 'verificar', titulo: 'Tu correo', pregunta: 'Confirma tu correo' },
  { clave: 'envases', titulo: 'Envases', pregunta: '¿En qué envases entregas?' },
  { clave: 'productos', titulo: 'Productos', pregunta: 'Tus productos y sus precios' },
  { clave: 'marca', titulo: 'Tu marca', pregunta: '¿Cómo se ve tu marca?' },
  { clave: 'resumen', titulo: 'Resumen', pregunta: 'Revisa y crea tu empresa' },
] as const

type Envio = { estado: 'nada' } | { estado: 'enviando' } | { estado: 'listo' } | { estado: 'error'; mensaje: string; pendiente?: boolean }

export function RegistroEmpresa({ onIrAlPanel }: { onIrAlPanel: () => void }) {
  const [inicial] = useState(leerBorrador)
  const [registro, setRegistro] = useState<Registro>(() => inicial?.registro ?? registroVacio())
  const [paso, setPaso] = useState(() => inicial?.paso ?? 0)
  const [retomado, setRetomado] = useState(!!inicial) // se abrió con un borrador de otra vez
  // La contraseña sólo vive en memoria: al volver a esta página hay que escribirla de nuevo.
  const [password, setPassword] = useState('')
  const [confirmacion, setConfirmacion] = useState('')
  // Correo ya confirmado con el código; si después se cambia el correo, hay que confirmarlo otra vez.
  const [verificado, setVerificado] = useState('')
  const [intento, setIntento] = useState(false) // se mostró el porqué de no poder continuar
  const [envio, setEnvio] = useState<Envio>({ estado: 'nada' })
  const titulo = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (envio.estado !== 'listo') guardarBorrador(registro, paso)
  }, [registro, paso, envio.estado])

  // Al cambiar de paso, el lector de pantalla y el teclado empiezan por la pregunta.
  useEffect(() => {
    titulo.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [paso])

  const falta = [
    faltaEnNegocio(registro),
    faltaEnCuenta(registro, password, confirmacion),
    verificado === registro.cuenta.correo.trim().toLowerCase() ? null : 'Escribe el código de 6 dígitos que te mandamos',
    faltaEnEnvases(registro),
    faltaEnProductos(registro),
    null,
    null,
  ]

  function cambiar(f: (r: Registro) => Registro) {
    setRegistro(f)
  }

  function irA(n: number) {
    setIntento(false)
    setPaso(n)
  }

  function continuar() {
    if (falta[paso]) return setIntento(true)
    if (paso < PASOS.length - 1) irA(paso + 1)
    else void crear()
  }

  async function crear() {
    // Al volver de otro día la contraseña no está: se regresa a ese paso en vez de mandar algo incompleto.
    const primero = falta.findIndex(Boolean)
    if (primero >= 0) {
      irA(primero)
      setIntento(true)
      return
    }
    setEnvio({ estado: 'enviando' })
    try {
      await api('/registro/empresa', { cuerpo: cuerpoRegistro(registro, password) })
      borrarBorrador()
      setEnvio({ estado: 'listo' })
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 404) {
        setEnvio({ estado: 'error', pendiente: true, mensaje: 'El servidor todavía no recibe altas de empresas: llega con la fase multiempresa. Tus datos quedaron guardados en este equipo y se podrán enviar entonces.' })
      } else if (e instanceof ErrorRed) {
        setEnvio({ estado: 'error', mensaje: 'Sin conexión con el servidor. Tus datos quedaron guardados; inténtalo de nuevo en un momento.' })
      } else {
        setEnvio({ estado: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo crear la empresa' })
      }
    }
  }

  function empezarDeNuevo() {
    borrarBorrador()
    setRetomado(false)
    setRegistro(registroVacio())
    setPassword('')
    setConfirmacion('')
    setVerificado('')
    setEnvio({ estado: 'nada' })
    irA(0)
  }

  if (envio.estado === 'listo') return <Listo nombre={registro.negocio.nombre} onIrAlPanel={onIrAlPanel} />

  const actual = PASOS[paso]
  const avance = ((paso + 1) / PASOS.length) * 100

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Encabezado fijo: de dónde viene, cuánto falta */}
      <header className="sticky top-0 z-20 border-b border-linea bg-lienzo/95 backdrop-blur pt-safe">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-2">
          <button
            onClick={() => (paso ? irA(paso - 1) : onIrAlPanel())}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-niebla text-tinta active:bg-linea focus-visible:outline-2 focus-visible:outline-marca"
            aria-label={paso ? 'Paso anterior' : 'Volver al inicio de sesión'}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 text-xs font-semibold text-apagado">
              <span className="truncate">{actual.titulo}</span>
              <span className="tabular-nums">Paso {paso + 1} de {PASOS.length}</span>
            </div>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-niebla"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={PASOS.length}
              aria-valuenow={paso + 1}
              aria-label="Avance del registro"
            >
              <div className="h-full rounded-full bg-marca transition-[width] duration-300" style={{ width: `${avance}%` }} />
            </div>
          </div>
        </div>
        {/* Los pasos ya hechos se pueden abrir directo */}
        <nav className="mx-auto hidden w-full max-w-xl flex-wrap gap-1 px-4 pb-2 sm:flex" aria-label="Pasos">
          {PASOS.map((p, i) => {
            const hecho = i < paso
            const abrible = i <= paso || falta.slice(0, i).every((f) => !f)
            return (
              <button
                key={p.clave}
                disabled={!abrible}
                onClick={() => irA(i)}
                aria-current={i === paso ? 'step' : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                  i === paso ? 'bg-tinta text-white' : 'bg-niebla text-tinta enabled:hover:bg-linea'
                }`}
              >
                {hecho ? <Check size={13} strokeWidth={3} /> : <span className="tabular-nums">{i + 1}</span>}
                {p.titulo}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-6 pb-36">
        {retomado && paso === inicial?.paso && (
          <div className="mb-5 flex items-center gap-3 rounded-2xl bg-niebla px-4 py-3 text-sm">
            <span className="flex-1">Seguimos donde te quedaste.</span>
            <button onClick={empezarDeNuevo} className="flex items-center gap-1 font-semibold text-azul hover:underline">
              <RotateCcw size={14} /> Empezar de nuevo
            </button>
          </div>
        )}

        <div key={paso} className="animate-[paso-entrar_.28s_ease-out]">
          <h1 ref={titulo} tabIndex={-1} className="text-[1.75rem] font-semibold leading-tight outline-none">
            {actual.pregunta}
          </h1>

          <div className="mt-6">
            {paso === 0 && <PasoNegocio registro={registro} cambiar={cambiar} />}
            {paso === 1 && (
              <PasoCuenta
                registro={registro}
                cambiar={cambiar}
                password={password}
                setPassword={setPassword}
                confirmacion={confirmacion}
                setConfirmacion={setConfirmacion}
              />
            )}
            {paso === 2 && (
              <PasoVerificar
                correo={registro.cuenta.correo.trim().toLowerCase()}
                verificado={verificado}
                onVerificado={setVerificado}
                onCambiarCorreo={() => irA(1)}
              />
            )}
            {paso === 3 && <PasoEnvases registro={registro} cambiar={cambiar} />}
            {paso === 4 && <PasoProductos registro={registro} cambiar={cambiar} />}
            {paso === 5 && <PasoMarca registro={registro} cambiar={cambiar} />}
            {paso === 6 && <PasoResumen registro={registro} irA={irA} />}
          </div>
        </div>
      </main>

      {/* Pie fijo con la acción principal, a la mano del pulgar */}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-linea bg-lienzo/95 backdrop-blur">
        <div className="mx-auto w-full max-w-xl px-4 pt-3 pb-safe">
          {intento && falta[paso] && (
            <p role="alert" className="mb-2 flex items-center gap-2 text-sm font-medium text-rojo">
              <AlertCircle size={16} className="shrink-0" /> {falta[paso]}
            </p>
          )}
          {envio.estado === 'error' && paso === PASOS.length - 1 && (
            <div role="alert" className={`mb-2 flex items-start gap-2 rounded-2xl p-3 text-sm font-medium ${envio.pendiente ? 'bg-niebla text-tinta' : 'bg-rojo/10 text-rojo'}`}>
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{envio.mensaje}</span>
            </div>
          )}
          <div className="flex gap-2">
            {paso === 5 && (
              <button
                onClick={() => irA(6)}
                className="rounded-full bg-niebla px-5 py-4 text-base font-semibold text-tinta transition-colors hover:bg-linea"
              >
                Después
              </button>
            )}
            <button
              onClick={continuar}
              disabled={envio.estado === 'enviando'}
              className={`flex flex-1 items-center justify-center gap-2 rounded-full bg-tinta py-4 text-base font-semibold text-white transition-colors hover:bg-marca-oscuro active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-40 ${falta[paso] ? 'opacity-60' : ''}`}
            >
              {envio.estado === 'enviando' ? (
                <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Creando…</>
              ) : paso === PASOS.length - 1 ? (
                <>Crear mi empresa <Check size={18} /></>
              ) : (
                <>Continuar <ArrowRight size={18} /></>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

type PropsPaso = { registro: Registro; cambiar: (f: (r: Registro) => Registro) => void }

// Un bloque que aparece cuando lo anterior está listo (lo que hace progresivo cada paso).
function Revelar({ visible, children }: { visible: boolean; children: ReactNode }) {
  if (!visible) return null
  return <div className="animate-[paso-entrar_.28s_ease-out]">{children}</div>
}

function Ayuda({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-sm text-apagado">{children}</p>
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 1: el negocio
// ---------------------------------------------------------------------------------------------------------------
function PasoNegocio({ registro, cambiar }: PropsPaso) {
  const n = registro.negocio
  const poner = (c: Partial<Registro['negocio']>) => cambiar((r) => ({ ...r, negocio: { ...r.negocio, ...c } }))
  const zonas = ZONAS_HORARIAS.includes(n.zonaHoraria) ? ZONAS_HORARIAS : [n.zonaHoraria, ...ZONAS_HORARIAS]

  function elegirGiro(g: Giro) {
    cambiar((r) => aplicarSugerencias({ ...r, negocio: { ...r.negocio, giro: g } }, g))
  }

  return (
    <div className="space-y-7">
      <Campo etiqueta="Nombre del negocio">
        <input
          autoFocus
          value={n.nombre}
          onChange={(e) => poner({ nombre: e.target.value })}
          placeholder="Ej. Lácteos La Esperanza"
          autoComplete="organization"
          className={claseInput}
        />
      </Campo>

      <Revelar visible={n.nombre.trim().length >= 2}>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-apagado">¿Qué vende?</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {GIROS.map((g) => (
              <button
                key={g.valor}
                type="button"
                onClick={() => elegirGiro(g.valor)}
                aria-pressed={n.giro === g.valor}
                className={`rounded-2xl border-2 p-3 text-left transition-colors ${
                  n.giro === g.valor ? 'border-marca bg-marca/15' : 'border-transparent bg-niebla hover:border-linea'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-base font-semibold">
                  {g.texto}
                  {n.giro === g.valor && <Check size={18} strokeWidth={3} className="shrink-0 text-verde" />}
                </div>
                <div className="mt-0.5 text-xs text-apagado">{g.detalle}</div>
              </button>
            ))}
          </div>
          {n.giro === 'otro' && (
            <input
              autoFocus
              value={n.giroOtro}
              onChange={(e) => poner({ giroOtro: e.target.value })}
              placeholder="Ej. Tortillas, carne, flores…"
              className={`${claseInput} mt-3`}
            />
          )}
          {n.giro && n.giro !== 'otro' && n.giro !== 'abarrotes' && (
            <Ayuda>Te dejamos listos unos envases y productos de ejemplo; en los siguientes pasos los cambias.</Ayuda>
          )}
        </fieldset>
      </Revelar>

      <Revelar visible={!!n.giro}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo etiqueta="Ciudad (opcional)">
            <input value={n.ciudad} onChange={(e) => poner({ ciudad: e.target.value })} placeholder="Ej. Puebla" autoComplete="address-level2" className={claseInput} />
          </Campo>
          <Campo etiqueta="Zona horaria">
            <select value={n.zonaHoraria} onChange={(e) => poner({ zonaHoraria: e.target.value })} className={claseInput}>
              {zonas.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ').replace('America/', '')}</option>)}
            </select>
          </Campo>
        </div>
        <Ayuda>La zona horaria decide cuándo empieza «hoy» para tus pedidos y reportes.</Ayuda>
      </Revelar>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 2: la cuenta del primer administrador
// ---------------------------------------------------------------------------------------------------------------
function PasoCuenta({ registro, cambiar, password, setPassword, confirmacion, setConfirmacion }: PropsPaso & {
  password: string
  setPassword: (s: string) => void
  confirmacion: string
  setConfirmacion: (s: string) => void
}) {
  const c = registro.cuenta
  const poner = (x: Partial<Registro['cuenta']>) => cambiar((r) => ({ ...r, cuenta: { ...r.cuenta, ...x } }))
  const [ver, setVer] = useState(false)
  const reglas = reglasPassword(password, c.correo)
  const correoOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.correo.trim())

  return (
    <div className="space-y-6">
      <p className="-mt-3 text-apagado">Con esta cuenta entras al panel. Después agregas a tus repartidores desde Equipo.</p>
      <Campo etiqueta="Tu nombre">
        <input autoFocus value={c.nombre} onChange={(e) => poner({ nombre: e.target.value })} autoComplete="name" placeholder="Nombre y apellido" className={claseInput} />
      </Campo>

      <Revelar visible={c.nombre.trim().length >= 2}>
        <div className="space-y-6">
          <Campo etiqueta="Correo">
            <input type="email" value={c.correo} onChange={(e) => poner({ correo: e.target.value })} autoComplete="email" placeholder="correo@ejemplo.com" className={claseInput} />
          </Campo>
          <Campo etiqueta="Teléfono (opcional)">
            <input type="tel" value={c.telefono} onChange={(e) => poner({ telefono: e.target.value })} autoComplete="tel" placeholder="10 dígitos" className={claseInput} />
          </Campo>
        </div>
        <Ayuda>Cada correo pertenece a una sola empresa.</Ayuda>
      </Revelar>

      <Revelar visible={correoOk}>
        <div className="space-y-4">
          <Campo etiqueta="Contraseña">
            <div className="relative">
              <input
                type={ver ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={`${claseInput} pr-12`}
              />
              <button
                type="button"
                onClick={() => setVer(!ver)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-apagado hover:text-tinta"
                aria-label={ver ? 'Ocultar contraseña' : 'Ver contraseña'}
              >
                {ver ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Campo>
          <ul className="space-y-1 text-sm" aria-label="Reglas de la contraseña">
            {reglas.map((r) => (
              <li key={r.texto} className={`flex items-center gap-2 ${r.ok ? 'text-verde' : 'text-apagado'}`}>
                <span className={`grid h-4 w-4 place-items-center rounded-full ${r.ok ? 'bg-verde text-white' : 'border border-linea'}`}>
                  {r.ok && <Check size={11} strokeWidth={3.5} />}
                </span>
                {r.texto}
              </li>
            ))}
          </ul>
          <Revelar visible={reglas.every((r) => r.ok)}>
            <Campo etiqueta="Repite la contraseña">
              <input
                type={ver ? 'text' : 'password'}
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                autoComplete="new-password"
                className={claseInput}
              />
            </Campo>
            {confirmacion && confirmacion !== password && <Ayuda>Todavía no coinciden.</Ayuda>}
          </Revelar>
        </div>
      </Revelar>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 3: confirmar el correo con un código de 6 dígitos
// ---------------------------------------------------------------------------------------------------------------
const ESPERA_REENVIO = 60 // segundos

function PasoVerificar({ correo, verificado, onVerificado, onCambiarCorreo }: {
  correo: string
  verificado: string
  onVerificado: (correo: string) => void
  onCambiarCorreo: () => void
}) {
  const [codigo, setCodigo] = useState('')
  const [espera, setEspera] = useState(ESPERA_REENVIO)
  const [reenviado, setReenviado] = useState(false)
  const listo = verificado === correo

  useEffect(() => {
    if (listo || espera <= 0) return
    const t = setTimeout(() => setEspera((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [espera, listo])

  // Prototipo: todavía no hay servidor que mande el correo, así que cualquier código de 6 dígitos confirma.
  // Con la fase multiempresa, aquí se llama al servidor para validar el código.
  function escribir(v: string) {
    const limpio = v.replace(/\D/g, '').slice(0, 6)
    setCodigo(limpio)
    if (limpio.length === 6) onVerificado(correo)
  }

  function reenviar() {
    setCodigo('')
    setReenviado(true)
    setEspera(ESPERA_REENVIO)
  }

  if (listo) {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-marca/15 p-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-verde text-white">
          <Check size={18} strokeWidth={3} />
        </span>
        <div>
          <div className="font-semibold">Correo confirmado</div>
          <div className="text-sm text-apagado">{correo}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <p className="-mt-3 text-apagado">
        Te mandamos un código de 6 dígitos a <span className="font-semibold text-tinta">{correo}</span>.{' '}
        <button type="button" onClick={onCambiarCorreo} className="font-semibold text-azul hover:underline">
          ¿No es tu correo?
        </button>
      </p>

      <Campo etiqueta="Código">
        <input
          autoFocus
          value={codigo}
          onChange={(e) => escribir(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          aria-label="Código de 6 dígitos"
          className={`${claseInput} text-center text-2xl font-semibold tracking-[0.5em] tabular-nums`}
        />
      </Campo>

      <div className="text-sm">
        {espera > 0 ? (
          <span className="text-apagado">
            {reenviado ? 'Te mandamos otro código. ' : '¿No te llegó? Revisa en spam. '}
            Puedes pedir otro en <span className="tabular-nums">{espera}</span> s.
          </span>
        ) : (
          <button type="button" onClick={reenviar} className="font-semibold text-azul hover:underline">
            Mandar otro código
          </button>
        )}
      </div>

      <p className="rounded-2xl bg-niebla px-4 py-3 text-sm text-apagado">
        Versión de prueba: todavía no se manda el correo, cualquier código de 6 dígitos sirve.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 4: envases
// ---------------------------------------------------------------------------------------------------------------
function PasoEnvases({ registro, cambiar }: PropsPaso) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const ponerEnvase = (id: string, x: Partial<Envase>) =>
    cambiar((r) => ({ ...r, envases: r.envases.map((e) => (e.id === id ? { ...e, ...x } : e)) }))

  function agregar(tipo: string) {
    const e = envaseDeTipo(tipo)
    cambiar((r) => ({ ...r, envases: [...r.envases, e] }))
    setAbierto(e.id)
  }

  function quitar(id: string) {
    cambiar((r) => ({
      ...r,
      envases: r.envases.filter((e) => e.id !== id),
      productos: r.productos.map((p) => {
        const { [id]: _, ...resto } = p.precios
        return { ...p, precios: resto }
      }),
    }))
  }

  const hayRetornables = registro.envases.some((e) => e.retornable)

  return (
    <div className="space-y-6">
      <p className="-mt-3 text-apagado">Elige los que usas. Puedes tener el mismo envase en varios tamaños.</p>

      <div className="flex flex-wrap gap-2">
        {TIPOS_ENVASE.map((t) => (
          <button
            key={t.tipo}
            type="button"
            onClick={() => agregar(t.tipo)}
            className="flex items-center gap-1.5 rounded-full bg-niebla px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-linea"
          >
            <Plus size={15} /> {t.nombre}
          </button>
        ))}
        <button
          type="button"
          onClick={() => agregar('propio')}
          className="flex items-center gap-1.5 rounded-full border-2 border-dashed border-linea px-4 py-2 text-sm font-semibold transition-colors hover:border-marca"
        >
          <Plus size={15} /> Uno propio
        </button>
      </div>

      {registro.envases.length > 0 && (
        <ul className="space-y-2">
          {registro.envases.map((e) => (
            <li key={e.id} className="rounded-2xl border border-linea bg-papel">
              <div className="flex items-center gap-3 px-4 py-3">
                <Package size={20} className="shrink-0 text-marca" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{nombreEnvase(e)}</div>
                  {e.retornable && <div className="text-xs text-apagado">Retornable</div>}
                </div>
                <button
                  onClick={() => setAbierto(abierto === e.id ? null : e.id)}
                  className="grid h-9 w-9 place-items-center rounded-full text-apagado hover:bg-niebla hover:text-tinta"
                  aria-label={`Editar ${nombreEnvase(e)}`}
                  aria-expanded={abierto === e.id}
                >
                  <Pencil size={16} />
                </button>
                <button onClick={() => quitar(e.id)} className="grid h-9 w-9 place-items-center rounded-full text-apagado hover:bg-rojo/10 hover:text-rojo" aria-label={`Quitar ${nombreEnvase(e)}`}>
                  <Trash2 size={16} />
                </button>
              </div>
              {abierto === e.id && (
                <div className="grid grid-cols-2 gap-3 border-t border-linea px-4 py-4">
                  <div className="col-span-2">
                    <Campo etiqueta="Nombre">
                      <input autoFocus={e.tipo === 'propio'} value={e.nombre} onChange={(x) => ponerEnvase(e.id, { nombre: x.target.value })} placeholder="Ej. Cubeta" className={claseInput} />
                    </Campo>
                  </div>
                  <Campo etiqueta="Contenido">
                    <EntradaNumero valor={e.contenido} onChange={(n) => ponerEnvase(e.id, { contenido: n })} />
                  </Campo>
                  <Campo etiqueta="Unidad">
                    <input list="unidades" value={e.unidad} onChange={(x) => ponerEnvase(e.id, { unidad: x.target.value })} className={claseInput} />
                  </Campo>
                  <label className="col-span-2 flex items-center gap-3 text-sm font-semibold">
                    <input type="checkbox" checked={e.retornable} onChange={(x) => ponerEnvase(e.id, { retornable: x.target.checked })} className="h-5 w-5" />
                    Es retornable (el cliente lo devuelve)
                  </label>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <datalist id="unidades">{UNIDADES.map((u) => <option key={u} value={u} />)}</datalist>

      <Revelar visible={hayRetornables}>
        <label className="flex items-start gap-3 rounded-2xl bg-niebla p-4">
          <input
            type="checkbox"
            checked={registro.controlRetornables}
            onChange={(e) => cambiar((r) => ({ ...r, controlRetornables: e.target.checked }))}
            className="mt-0.5 h-5 w-5"
          />
          <span>
            <span className="block font-semibold">Llevar la cuenta de envases prestados</span>
            <span className="text-sm text-apagado">El repartidor anota cuántos deja y cuántos recoge en cada cliente.</span>
          </span>
        </label>
      </Revelar>
    </div>
  )
}

// Guarda el texto tal cual se escribe («0.» o «1,5» a medias) y sólo entrega el número.
function EntradaNumero({ valor, onChange }: { valor: number; onChange: (n: number) => void }) {
  const [texto, setTexto] = useState(Number.isFinite(valor) ? String(valor) : '')
  return (
    <input
      inputMode="decimal"
      value={texto}
      onChange={(x) => {
        setTexto(x.target.value)
        onChange(numero(x.target.value))
      }}
      className={claseInput}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 5: productos, con precio y costo por envase
// ---------------------------------------------------------------------------------------------------------------
function PasoProductos({ registro, cambiar }: PropsPaso) {
  const poner = (id: string, f: (p: Producto) => Producto) =>
    cambiar((r) => ({ ...r, productos: r.productos.map((p) => (p.id === id ? f(p) : p)) }))

  return (
    <div className="space-y-4">
      <p className="-mt-3 text-apagado">
        Si un producto viene en sabores, colores o tipos, agrégalos como variantes: comparten el precio.
      </p>
      {registro.productos.map((p, i) => (
        <TarjetaProducto
          key={p.id}
          producto={p}
          envases={registro.envases}
          enfocar={i === registro.productos.length - 1 && !p.nombre}
          onCambiar={(f) => poner(p.id, f)}
          onQuitar={() => cambiar((r) => ({ ...r, productos: r.productos.filter((x) => x.id !== p.id) }))}
        />
      ))}
      <button
        type="button"
        onClick={() => cambiar((r) => ({ ...r, productos: [...r.productos, productoNuevo()] }))}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-linea py-4 font-semibold transition-colors hover:border-marca"
      >
        <Plus size={18} /> Agregar producto
      </button>
    </div>
  )
}

function TarjetaProducto({ producto: p, envases, enfocar, onCambiar, onQuitar }: {
  producto: Producto
  envases: Envase[]
  enfocar: boolean
  onCambiar: (f: (p: Producto) => Producto) => void
  onQuitar: () => void
}) {
  const [variante, setVariante] = useState('')

  function agregarVariante() {
    const v = variante.trim()
    if (v && !p.variantes.some((x) => x.toLowerCase() === v.toLowerCase())) onCambiar((x) => ({ ...x, variantes: [...x.variantes, v] }))
    setVariante('')
  }

  const precio = (id: string) => p.precios[id] ?? { precio: '', costo: '', activo: false }
  const ponerPrecio = (id: string, c: Partial<Producto['precios'][string]>) =>
    onCambiar((x) => ({ ...x, precios: { ...x.precios, [id]: { ...precio(id), ...c } } }))

  return (
    <div className="rounded-[22px] border border-linea bg-papel p-4">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Campo etiqueta="Producto">
            <input autoFocus={enfocar} value={p.nombre} onChange={(e) => onCambiar((x) => ({ ...x, nombre: e.target.value }))} placeholder="Ej. Yogurt" className={claseInput} />
          </Campo>
        </div>
        <button onClick={onQuitar} className="mb-1 grid h-11 w-11 place-items-center rounded-full text-apagado hover:bg-rojo/10 hover:text-rojo" aria-label={`Quitar ${p.nombre || 'producto'}`}>
          <Trash2 size={18} />
        </button>
      </div>

      <Revelar visible={!!p.nombre.trim()}>
        <div className="mt-4">
          <span className="mb-1.5 block text-sm font-semibold text-apagado">Variantes (opcional)</span>
          <div className="flex flex-wrap items-center gap-2">
            {p.variantes.map((v) => (
              <span key={v} className="flex items-center gap-1 rounded-full bg-niebla py-1.5 pr-1.5 pl-3 text-sm font-semibold">
                {v}
                <button
                  onClick={() => onCambiar((x) => ({ ...x, variantes: x.variantes.filter((y) => y !== v) }))}
                  className="grid h-6 w-6 place-items-center rounded-full hover:bg-linea"
                  aria-label={`Quitar ${v}`}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
            <input
              value={variante}
              onChange={(e) => setVariante(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  agregarVariante()
                }
              }}
              onBlur={agregarVariante}
              placeholder={p.variantes.length ? 'Otra…' : 'Ej. Fresa y Enter'}
              className="min-w-32 flex-1 rounded-full bg-niebla px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-marca"
            />
          </div>
        </div>

        <div className="mt-5">
          <span className="mb-1.5 block text-sm font-semibold text-apagado">¿En qué envases lo vendes?</span>
          <div className="space-y-2">
            {envases.map((e) => {
              const v = precio(e.id)
              return (
                <div key={e.id} className={`rounded-2xl p-3 transition-colors ${v.activo ? 'bg-niebla' : ''}`}>
                  <label className="flex items-center gap-3 font-semibold">
                    <input type="checkbox" checked={v.activo} onChange={(x) => ponerPrecio(e.id, { activo: x.target.checked })} className="h-5 w-5" />
                    {nombreEnvase(e)}
                  </label>
                  {v.activo && (
                    <div className="mt-3 grid grid-cols-2 gap-3 pl-8">
                      <Campo etiqueta="Precio">
                        <input inputMode="decimal" value={v.precio} onChange={(x) => ponerPrecio(e.id, { precio: x.target.value })} placeholder="$" className={`${claseInput} bg-papel`} />
                      </Campo>
                      <Campo etiqueta="Costo (opcional)">
                        <input inputMode="decimal" value={v.costo} onChange={(x) => ponerPrecio(e.id, { costo: x.target.value })} placeholder="$" className={`${claseInput} bg-papel`} />
                      </Campo>
                      {numero(v.precio) > 0 && numero(v.costo) >= 0 && (
                        <p className="col-span-2 -mt-1 text-xs text-apagado">
                          Ganas {dinero(numero(v.precio) - numero(v.costo))} por {e.nombre.toLowerCase() || 'envase'}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-apagado">El costo sólo lo ven los administradores, nunca los repartidores.</p>
        </div>
      </Revelar>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 6: marca
// ---------------------------------------------------------------------------------------------------------------
const LOGO_MAXIMO = 500 * 1024

function PasoMarca({ registro, cambiar }: PropsPaso) {
  const m = registro.marca
  const [error, setError] = useState('')
  const poner = (x: Partial<Registro['marca']>) => cambiar((r) => ({ ...r, marca: { ...r.marca, ...x } }))

  function elegirLogo(f: File | undefined) {
    setError('')
    if (!f) return
    if (!f.type.startsWith('image/')) return setError('Elige una imagen (PNG, JPG o SVG)')
    if (f.size > LOGO_MAXIMO) return setError('La imagen pesa más de 500 KB; prueba con una más chica')
    const lector = new FileReader()
    lector.onload = () => poner({ logo: String(lector.result) })
    lector.readAsDataURL(f)
  }

  return (
    <div className="space-y-7">
      <p className="-mt-3 text-apagado">Aparece en la app, el panel y los PDF. Puedes cambiarlo cuando quieras.</p>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Logo</span>
        <label className="flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-linea p-4 transition-colors hover:border-marca">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-niebla">
            {m.logo ? <img src={m.logo} alt="Tu logo" className="h-full w-full object-contain" /> : <ImagePlus size={24} className="text-apagado" />}
          </div>
          <div className="text-sm">
            <div className="font-semibold">{m.logo ? 'Cambiar logo' : 'Subir logo'}</div>
            <div className="text-apagado">PNG, JPG o SVG, hasta 500 KB</div>
          </div>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => elegirLogo(e.target.files?.[0])} />
        </label>
        {error && <p role="alert" className="mt-2 text-sm font-medium text-rojo">{error}</p>}
        {m.logo && (
          <button onClick={() => poner({ logo: null })} className="mt-2 text-sm font-semibold text-azul hover:underline">Quitar logo</button>
        )}
      </div>

      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-apagado">Color principal</legend>
        <div className="flex flex-wrap items-center gap-3">
          {COLORES_MARCA.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => poner({ color: c })}
              aria-pressed={m.color === c}
              aria-label={`Color ${c}`}
              className={`grid h-11 w-11 place-items-center rounded-full ring-offset-2 ring-offset-lienzo transition-shadow ${m.color === c ? 'ring-2 ring-tinta' : ''}`}
              style={{ background: c }}
            >
              {m.color === c && <Check size={18} strokeWidth={3} className="text-white" />}
            </button>
          ))}
          <label className="flex items-center gap-2 rounded-full bg-niebla py-1.5 pr-4 pl-1.5 text-sm font-semibold">
            <input type="color" value={m.color} onChange={(e) => poner({ color: e.target.value })} className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent" />
            Otro
          </label>
        </div>
      </fieldset>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Así se verá</span>
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 text-white" style={{ background: m.color }}>
          {m.logo ? <img src={m.logo} alt="" className="h-9 w-9 rounded-lg bg-white object-contain p-0.5" /> : <Package size={24} />}
          <span className="truncate text-lg font-semibold">{registro.negocio.nombre || 'Tu negocio'}</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Paso 7: resumen y vista del repartidor
// ---------------------------------------------------------------------------------------------------------------
function PasoResumen({ registro, irA }: { registro: Registro; irA: (n: number) => void }) {
  const n = registro.negocio
  const giro = n.giro === 'otro' ? n.giroOtro : GIROS.find((g) => g.valor === n.giro)?.texto

  return (
    <div className="space-y-4">
      <Seccion titulo="Negocio" onEditar={() => irA(0)}>
        <div className="font-semibold">{n.nombre}</div>
        <div className="text-sm text-apagado">{[giro, n.ciudad, n.zonaHoraria.replace(/_/g, ' ')].filter(Boolean).join(' · ')}</div>
      </Seccion>
      <Seccion titulo="Administrador" onEditar={() => irA(1)}>
        <div className="font-semibold">{registro.cuenta.nombre}</div>
        <div className="flex items-center gap-1.5 text-sm text-apagado">
          {registro.cuenta.correo} <Check size={14} strokeWidth={3} className="text-verde" aria-label="Correo confirmado" />
        </div>
      </Seccion>
      <Seccion titulo="Envases" onEditar={() => irA(3)}>
        <div className="flex flex-wrap gap-1.5">
          {registro.envases.map((e) => (
            <span key={e.id} className="rounded-full bg-niebla px-3 py-1 text-sm font-semibold">{nombreEnvase(e)}{e.retornable ? ' ↺' : ''}</span>
          ))}
        </div>
        {registro.controlRetornables && <div className="mt-2 text-sm text-apagado">Con cuenta de envases prestados</div>}
      </Seccion>
      <Seccion titulo="Productos" onEditar={() => irA(4)}>
        <ul className="space-y-2">
          {registro.productos.map((p) => (
            <li key={p.id}>
              <div className="font-semibold">{p.nombre}{p.variantes.length > 0 && <span className="font-normal text-apagado"> · {p.variantes.join(', ')}</span>}</div>
              <div className="text-sm text-apagado">
                {registro.envases.filter((e) => p.precios[e.id]?.activo).map((e) => `${nombreEnvase(e)} ${dinero(numero(p.precios[e.id].precio))}`).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      </Seccion>

      <div className="pt-2">
        <h2 className="text-xl font-semibold">Así lo verá tu repartidor</h2>
        <p className="mt-1 text-sm text-apagado">Pruébalo: toca + y − como si levantaras un pedido.</p>
        <VistaRepartidor registro={registro} />
      </div>
    </div>
  )
}

function Seccion({ titulo, onEditar, children }: { titulo: string; onEditar: () => void; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-linea bg-papel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-apagado">{titulo}</h2>
        <button onClick={onEditar} className="flex items-center gap-1 text-sm font-semibold text-azul hover:underline">
          <Pencil size={13} /> Cambiar
        </button>
      </div>
      {children}
    </section>
  )
}

// Un teléfono de muestra con el selector por presentación: + / − por envase y el total por unidad.
function VistaRepartidor({ registro }: { registro: Registro }) {
  const lista = presentaciones(registro)
  const [cant, setCant] = useState<Record<string, number>>({})
  const sumar = (k: string, d: number) => setCant((c) => ({ ...c, [k]: Math.max(0, (c[k] ?? 0) + d) }))

  const total = lista.reduce((s, x) => s + (cant[x.clave] ?? 0) * x.precio, 0)
  const porUnidad = new Map<string, number>()
  for (const x of lista) {
    const c = cant[x.clave] ?? 0
    if (c) porUnidad.set(x.envase.unidad, (porUnidad.get(x.envase.unidad) ?? 0) + c * x.envase.contenido)
  }
  const resumen = [...porUnidad].map(([u, v]) => `${formatoCantidad(v)} ${u === 'pieza' ? (v === 1 ? 'pieza' : 'piezas') : u}`).join(' + ')

  return (
    <div className="mx-auto mt-4 w-full max-w-sm overflow-hidden rounded-[32px] border-[6px] border-tinta/85 bg-papel shadow-tarjeta">
      <div className="flex items-center gap-2 px-4 py-3 text-white" style={{ background: registro.marca.color }}>
        {registro.marca.logo ? <img src={registro.marca.logo} alt="" className="h-7 w-7 rounded-md bg-white object-contain p-0.5" /> : <Package size={20} />}
        <span className="truncate font-semibold">Nuevo pedido</span>
      </div>
      <ul className="max-h-96 divide-y divide-linea overflow-y-auto">
        {lista.map((x) => {
          const c = cant[x.clave] ?? 0
          return (
            <li key={x.clave} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{x.nombre}</div>
                <div className="text-xs text-apagado">{nombreEnvase(x.envase)} · {dinero(x.precio)}</div>
              </div>
              <button onClick={() => sumar(x.clave, -1)} disabled={!c} className="grid h-9 w-9 place-items-center rounded-full bg-niebla disabled:opacity-40" aria-label={`Quitar ${x.nombre} ${nombreEnvase(x.envase)}`}>
                <Minus size={16} strokeWidth={3} />
              </button>
              <span className="w-6 text-center text-lg font-bold tabular-nums">{c}</span>
              <button onClick={() => sumar(x.clave, 1)} className="grid h-9 w-9 place-items-center rounded-full text-white" style={{ background: registro.marca.color }} aria-label={`Agregar ${x.nombre} ${nombreEnvase(x.envase)}`}>
                <Plus size={16} strokeWidth={3} />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between bg-tinta px-4 py-3 text-white">
        <span className="text-sm opacity-80">{resumen || 'Sin productos'}</span>
        <span className="text-xl font-bold tabular-nums">{dinero(total)}</span>
      </div>
    </div>
  )
}

function Listo({ nombre, onIrAlPanel }: { nombre: string; onIrAlPanel: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-marca text-white">
        <Check size={40} strokeWidth={3} />
      </div>
      <h1 className="mt-6 text-[2rem] font-semibold leading-tight">¡{nombre} ya está lista!</h1>
      <p className="mt-2 max-w-sm text-apagado">Tu correo ya quedó confirmado. Entra al panel y agrega a tus repartidores.</p>
      <button onClick={onIrAlPanel} className="mt-8 rounded-full bg-tinta px-8 py-4 font-semibold text-white hover:bg-marca-oscuro">
        Ir al panel
      </button>
    </div>
  )
}
