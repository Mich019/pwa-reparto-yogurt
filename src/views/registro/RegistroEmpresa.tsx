import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, ImagePlus, Mail, Minus, Plus, RotateCcw, Sparkles, X } from 'lucide-react'
import { api, ErrorApi, ErrorRed } from '../../lib/api'
import { dinero } from '../../lib/fechas'
import {
  alternarTamano, alternarTipo, aplicarGiros, borrarBorrador, COLORES_MARCA, colorPara, correoValido, cuerpoRegistro,
  GIROS, guardarBorrador, leerBorrador, leerTamano, nombreEnvase, numero, presentaciones, productoNuevo, registroVacio,
  reglasPassword, sugerenciasProductos, textoTamano, tieneTamano, tipoEnvase, TIPOS_ENVASE,
  type Producto, type Registro,
} from '../../lib/registro'
import { claseInput } from '../../components/ui'
import { DibujoEnvase, type TipoEnvase } from './dibujos'

// Registro de una empresa nueva y su asistente de configuración, una pregunta por pantalla. Las pantallas se arman
// según lo que se va contestando: una por cada envase elegido (sus tamaños) y dos por cada producto (variantes y
// precios). El avance se guarda en el equipo, sin la contraseña, para seguir después.

type Fase = 'cuenta' | 'catalogo' | 'marca' | 'equipo'
const FASES: { clave: Fase; texto: string }[] = [
  { clave: 'cuenta', texto: 'Tu cuenta' },
  { clave: 'catalogo', texto: 'Tu catálogo' },
  { clave: 'marca', texto: 'Tu marca' },
  { clave: 'equipo', texto: 'Tu equipo' },
]

interface Pantalla {
  clave: string
  fase: Fase
  pregunta: ReactNode
  ayuda?: ReactNode
  falta?: string | null
  opcional?: boolean // muestra «Omitir»
  contenido: ReactNode
}

type Envio = { estado: 'nada' } | { estado: 'enviando' } | { estado: 'listo' } | { estado: 'error'; mensaje: string; pendiente?: boolean }

export function RegistroEmpresa({ onIrAlPanel }: { onIrAlPanel: () => void }) {
  const [inicial] = useState(leerBorrador)
  const [r, setR] = useState<Registro>(() => inicial?.registro ?? registroVacio())
  const [clave, setClave] = useState(() => inicial?.paso ?? 'negocio')
  const [retomado, setRetomado] = useState(!!inicial)
  // La contraseña sólo vive en memoria: al volver a esta página hay que escribirla de nuevo.
  const [password, setPassword] = useState('')
  const [intento, setIntento] = useState(false)
  const [envio, setEnvio] = useState<Envio>({ estado: 'nada' })
  const titulo = useRef<HTMLHeadingElement>(null)

  const cambiar = (f: (x: Registro) => Registro) => setR(f)
  const pantallas = useMemo(() => armarPantallas(r, cambiar, password, setPassword, () => continuar()), [r, password])
  const i = Math.max(0, pantallas.findIndex((p) => p.clave === clave))
  const actual = pantallas[i]

  useEffect(() => {
    if (envio.estado !== 'listo') guardarBorrador(r, actual.clave)
  }, [r, actual.clave, envio.estado])

  // Al cambiar de pantalla, el teclado y el lector de pantalla empiezan por la pregunta; el campo, si hay, se enfoca.
  useEffect(() => {
    window.scrollTo({ top: 0 })
    const campo = document.querySelector<HTMLElement>('[data-enfocar]')
    ;(campo ?? titulo.current)?.focus({ preventScroll: true })
  }, [actual.clave])

  function irA(n: number) {
    setIntento(false)
    setClave(pantallas[Math.max(0, Math.min(pantallas.length - 1, n))].clave)
  }

  function continuar() {
    // Se recalcula con el estado más reciente: hay pantallas que avanzan solas al elegir.
    setIntento(false)
    setClave((c) => {
      const lista = armarPantallas(r, cambiar, password, setPassword, () => {})
      const n = lista.findIndex((p) => p.clave === c)
      return lista[Math.min(lista.length - 1, n + 1)].clave
    })
  }

  function alContinuar() {
    if (actual.falta) return setIntento(true)
    if (i < pantallas.length - 1) irA(i + 1)
    else void crear()
  }

  async function crear() {
    const primera = pantallas.findIndex((p) => p.falta)
    if (primera >= 0) {
      irA(primera)
      setIntento(true)
      return
    }
    setEnvio({ estado: 'enviando' })
    try {
      await api('/registro/empresa', { cuerpo: cuerpoRegistro(r, password) })
      borrarBorrador()
      setEnvio({ estado: 'listo' })
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 404) {
        setEnvio({ estado: 'error', pendiente: true, mensaje: 'El servidor todavía no recibe altas de empresas: llega con la fase multiempresa. Tus datos quedaron guardados en este equipo.' })
      } else if (e instanceof ErrorRed) {
        setEnvio({ estado: 'error', mensaje: 'Sin conexión con el servidor. Tus datos quedaron guardados; inténtalo en un momento.' })
      } else {
        setEnvio({ estado: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo crear la empresa' })
      }
    }
  }

  function empezarDeNuevo() {
    borrarBorrador()
    setRetomado(false)
    setR(registroVacio())
    setPassword('')
    setEnvio({ estado: 'nada' })
    setIntento(false)
    setClave('negocio')
  }

  if (envio.estado === 'listo') return <Listo r={r} onIrAlPanel={onIrAlPanel} />

  const ultima = i === pantallas.length - 1
  const faseActual = FASES.findIndex((f) => f.clave === actual.fase)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 bg-lienzo/95 backdrop-blur pt-safe">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-2">
          <button
            type="button"
            onClick={() => (i ? irA(i - 1) : onIrAlPanel())}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-niebla text-tinta active:bg-linea focus-visible:outline-2 focus-visible:outline-marca"
            aria-label={i ? 'Pregunta anterior' : 'Volver al inicio de sesión'}
          >
            <ArrowLeft size={20} />
          </button>
          {/* Cuatro tramos, uno por fase; el de la fase actual se llena pregunta a pregunta. */}
          <div className="min-w-0 flex-1" role="progressbar" aria-valuemin={1} aria-valuemax={pantallas.length} aria-valuenow={i + 1} aria-label="Avance del registro">
            <div className="flex gap-1">
              {FASES.map((f, n) => {
                const deFase = pantallas.filter((p) => p.fase === f.clave)
                const hechas = n < faseActual ? deFase.length : n > faseActual ? 0 : deFase.findIndex((p) => p.clave === actual.clave) + 1
                return (
                  <div key={f.clave} className="h-1.5 flex-1 overflow-hidden rounded-full bg-niebla">
                    <div className="h-full rounded-full bg-marca transition-[width] duration-500" style={{ width: `${deFase.length ? (hechas / deFase.length) * 100 : 0}%` }} />
                  </div>
                )
              })}
            </div>
            <div className="mt-1 flex justify-between text-xs font-semibold text-apagado">
              <span>{FASES[faseActual].texto}</span>
              <span className="tabular-nums">{i + 1} de {pantallas.length}</span>
            </div>
          </div>
        </div>
      </header>

      <form
        id="pantalla"
        onSubmit={(e) => { e.preventDefault(); alContinuar() }}
        className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pt-6 pb-40"
        noValidate
      >
        {retomado && actual.clave === inicial?.paso && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl bg-niebla px-4 py-3 text-sm">
            <span className="flex-1">Seguimos donde te quedaste.</span>
            <button type="button" onClick={empezarDeNuevo} className="flex items-center gap-1 font-semibold text-azul hover:underline">
              <RotateCcw size={14} /> Empezar de nuevo
            </button>
          </div>
        )}

        <div key={actual.clave} className="animate-[paso-entrar_.35s_ease-out]">
          {/* Sin campo que enfocar, la pregunta tiene el foco: Enter también avanza desde ahí. */}
          <h1 ref={titulo} tabIndex={-1} onKeyDown={(e) => e.key === 'Enter' && alContinuar()} className="text-[1.9rem] font-semibold leading-[1.15] outline-none">{actual.pregunta}</h1>
          {actual.ayuda && <p className="mt-2 text-[15px] text-apagado">{actual.ayuda}</p>}
          <div className="mt-7">{actual.contenido}</div>
        </div>
      </form>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-linea bg-lienzo/95 backdrop-blur">
        <div className="mx-auto w-full max-w-xl px-4 pt-3 pb-safe">
          {intento && actual.falta && (
            <p role="alert" className="mb-2 flex items-center gap-2 text-sm font-medium text-rojo">
              <AlertCircle size={16} className="shrink-0" /> {actual.falta}
            </p>
          )}
          {envio.estado === 'error' && ultima && (
            <div role="alert" className={`mb-2 flex items-start gap-2 rounded-2xl p-3 text-sm font-medium ${envio.pendiente ? 'bg-niebla text-tinta' : 'bg-rojo/10 text-rojo'}`}>
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{envio.mensaje}</span>
            </div>
          )}
          <div className="flex gap-2">
            {actual.opcional && (
              <button type="button" onClick={() => irA(i + 1)} className="rounded-full bg-niebla px-6 py-4 text-base font-semibold text-tinta transition-colors hover:bg-linea">
                Omitir
              </button>
            )}
            <button
              type="submit"
              form="pantalla"
              disabled={envio.estado === 'enviando'}
              className={`flex flex-1 items-center justify-center gap-2 rounded-full bg-tinta py-4 text-base font-semibold text-white transition-[colors,opacity] hover:bg-marca-oscuro active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:opacity-40 ${actual.falta ? 'opacity-50' : ''}`}
            >
              {envio.estado === 'enviando' ? (
                <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Creando…</>
              ) : ultima ? (
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

// ---------------------------------------------------------------------------------------------------------------
// Las pantallas, en orden. Cada una: su pregunta, qué le falta para continuar y su contenido.
// ---------------------------------------------------------------------------------------------------------------
function armarPantallas(
  r: Registro,
  cambiar: (f: (x: Registro) => Registro) => void,
  password: string,
  setPassword: (s: string) => void,
  avanzar: () => void,
): Pantalla[] {
  const nombreCorto = r.nombre.trim().split(/\s+/)[0]
  const lista: Pantalla[] = [
    // --- Tu cuenta ---
    {
      clave: 'negocio', fase: 'cuenta',
      pregunta: '¿Cómo se llama tu negocio?',
      ayuda: 'Así lo verán tus repartidores y tus clientes. Puedes cambiarlo después.',
      falta: r.negocio.trim().length < 2 ? 'Escribe el nombre de tu negocio' : null,
      contenido: <Texto valor={r.negocio} onChange={(v) => cambiar((x) => ({ ...x, negocio: v }))} placeholder="Ej. Lácteos La Esperanza" autoComplete="organization" />,
    },
    {
      clave: 'nombre', fase: 'cuenta',
      pregunta: '¿Y tú cómo te llamas?',
      ayuda: `Serás quien administre ${r.negocio.trim() || 'tu negocio'}.`,
      falta: r.nombre.trim().length < 2 ? 'Escribe tu nombre' : null,
      contenido: <Texto valor={r.nombre} onChange={(v) => cambiar((x) => ({ ...x, nombre: v }))} placeholder="Nombre y apellido" autoComplete="name" />,
    },
    {
      clave: 'correo', fase: 'cuenta',
      pregunta: nombreCorto ? `Mucho gusto, ${nombreCorto}. ¿Cuál es tu correo?` : '¿Cuál es tu correo?',
      ayuda: 'Te mandaremos un código para confirmarlo. Cada correo es de una sola empresa.',
      falta: !correoValido(r.correo) ? 'Escribe un correo válido' : null,
      contenido: <Texto tipo="email" valor={r.correo} onChange={(v) => cambiar((x) => ({ ...x, correo: v }))} placeholder="correo@ejemplo.com" autoComplete="email" icono={<Mail size={20} />} />,
    },
    {
      clave: 'password', fase: 'cuenta',
      pregunta: 'Crea una contraseña',
      ayuda: 'Por seguridad no la guardamos en este equipo mientras llenas el registro.',
      falta: !password ? 'Escribe tu contraseña' : !reglasPassword(password, r.correo).every((x) => x.ok) ? 'La contraseña aún no cumple las reglas' : null,
      contenido: <PasoPassword password={password} setPassword={setPassword} correo={r.correo} />,
    },
    {
      clave: 'terminos', fase: 'cuenta',
      pregunta: 'Un último detalle legal',
      ayuda: 'Vas a guardar datos de tus clientes (nombre, teléfono, dirección). La ley de protección de datos personales (LFPDPPP) pide que lo hagas con su aviso de privacidad.',
      falta: !r.terminos ? 'Acepta los términos para continuar' : null,
      contenido: (
        <label className={`flex cursor-pointer items-start gap-4 rounded-[22px] border-2 p-5 transition-colors ${r.terminos ? 'border-marca bg-marca/10' : 'border-linea bg-papel'}`}>
          <input type="checkbox" checked={r.terminos} onChange={(e) => cambiar((x) => ({ ...x, terminos: e.target.checked }))} className="mt-1 h-6 w-6 shrink-0" data-enfocar />
          <span className="text-base">
            Acepto los <span className="font-semibold">términos del servicio</span> y el <span className="font-semibold">aviso de privacidad</span>, y me comprometo a usar los datos de mis clientes sólo para sus pedidos.
          </span>
        </label>
      ),
    },

    // --- Tu catálogo ---
    {
      clave: 'bienvenida', fase: 'catalogo',
      pregunta: <>Listo, {nombreCorto || 'ya tienes cuenta'}. Ahora armemos tu catálogo</>,
      ayuda: 'Son unas preguntas rápidas sobre lo que vendes. Te proponemos todo según tu giro y tú sólo ajustas.',
      contenido: (
        <div className="flex items-end justify-center gap-1 rounded-[28px] bg-niebla px-4 pt-8 pb-5">
          <DibujoEnvase tipo="botella" color="#f28c28" className="h-28" />
          <DibujoEnvase tipo="costal" color="#b07a52" className="h-32" />
          <DibujoEnvase tipo="frasco" color="#e5484d" className="h-24" />
          <DibujoEnvase tipo="garrafon" color="#3aa0e0" className="h-32" />
        </div>
      ),
    },
    {
      clave: 'giros', fase: 'catalogo',
      pregunta: '¿Qué vende tu negocio?',
      ayuda: 'Elige uno o varios.',
      falta: !r.giros.length ? 'Elige al menos una opción' : null,
      contenido: (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {GIROS.map((g) => {
            const si = r.giros.includes(g.valor)
            return (
              <Tarjeta key={g.valor} elegida={si} onClick={() => cambiar((x) => aplicarGiros(x, si ? x.giros.filter((v) => v !== g.valor) : [...x.giros, g.valor]))}>
                <DibujoEnvase tipo={g.dibujo} color={g.color} className="mx-auto h-20" />
                <div className="mt-2 font-semibold leading-tight">{g.texto}</div>
                <div className="mt-0.5 text-xs text-apagado">{g.detalle}</div>
              </Tarjeta>
            )
          })}
        </div>
      ),
    },
    {
      clave: 'tipos', fase: 'catalogo',
      pregunta: '¿En qué envases lo entregas?',
      ayuda: 'Ya marcamos los más comunes para tu giro. Quita o agrega los que uses.',
      falta: !r.tipos.length ? 'Elige al menos un envase' : null,
      contenido: (
        <div className="grid grid-cols-3 gap-2.5">
          {TIPOS_ENVASE.map((t) => {
            const si = r.tipos.includes(t.tipo)
            return (
              <Tarjeta key={t.tipo} elegida={si} onClick={() => cambiar((x) => alternarTipo(x, t.tipo))} compacta>
                <DibujoEnvase tipo={t.tipo} color={colorDeGiro(r)} className="mx-auto h-16" apagado={!si} />
                <div className="mt-1.5 text-sm font-semibold leading-tight">{t.nombre}</div>
                <div className="mt-0.5 hidden text-[11px] leading-tight text-apagado sm:block">{t.detalle}</div>
              </Tarjeta>
            )
          })}
        </div>
      ),
    },
    // Una pantalla por envase elegido: sus tamaños.
    ...r.tipos.map((tipo): Pantalla => {
      const t = tipoEnvase(tipo)!
      const elegidos = r.envases.filter((e) => e.tipo === tipo)
      return {
        clave: `tam:${tipo}`, fase: 'catalogo',
        pregunta: tipo === 'granel' ? '¿Cómo vendes a granel?' : tipo === 'pieza' ? 'Por pieza, entendido' : `¿Qué tamaños de ${t.nombre.toLowerCase()} manejas?`,
        ayuda: tipo === 'granel' ? 'Elige la unidad con la que pesas o mides.' : tipo === 'pieza' ? 'Cada unidad se cuenta por separado. Continúa.' : 'Puedes elegir varios; cada tamaño tendrá su propio precio.',
        falta: !elegidos.length ? 'Elige al menos un tamaño' : null,
        contenido: <PasoTamanos r={r} tipo={tipo} cambiar={cambiar} />,
      }
    }),
  ]

  if (r.envases.length) {
    lista.push({
      clave: 'retornables', fase: 'catalogo',
      pregunta: '¿Cuáles te devuelven tus clientes?',
      ayuda: 'Los envases retornables se prestan y se recogen en la siguiente visita. Si ninguno, continúa.',
      contenido: (
        <div className="space-y-2">
          {r.envases.map((e) => (
            <label key={e.id} className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 px-3 py-2 transition-colors ${e.retornable ? 'border-marca bg-marca/10' : 'border-transparent bg-niebla'}`}>
              <DibujoEnvase tipo={e.tipo} color={colorDeGiro(r)} className="h-12" />
              <span className="flex-1 font-semibold">{nombreEnvase(e)}</span>
              <input
                type="checkbox"
                checked={e.retornable}
                onChange={(x) => cambiar((y) => ({ ...y, envases: y.envases.map((z) => (z.id === e.id ? { ...z, retornable: x.target.checked } : z)) }))}
                className="h-6 w-6"
              />
            </label>
          ))}
        </div>
      ),
    })
  }

  if (r.envases.some((e) => e.retornable)) {
    lista.push({
      clave: 'prestamos', fase: 'catalogo',
      pregunta: '¿Quieres llevar la cuenta de los envases prestados?',
      ayuda: 'El repartidor anota cuántos deja y cuántos recoge, y sabrás quién te debe envases.',
      contenido: (
        <div className="grid gap-3">
          <Opcion elegida={r.controlRetornables} onClick={() => { cambiar((x) => ({ ...x, controlRetornables: true })); avanzar() }} titulo="Sí, llevar la cuenta" detalle="Cada cliente tendrá su saldo de envases." />
          <Opcion elegida={!r.controlRetornables} onClick={() => { cambiar((x) => ({ ...x, controlRetornables: false })); avanzar() }} titulo="No por ahora" detalle="Lo puedes activar después en Configuración." />
        </div>
      ),
    })
  }

  lista.push({
    clave: 'productos', fase: 'catalogo',
    pregunta: '¿Qué productos vendes?',
    ayuda: 'Sólo el nombre por ahora. Si vienen en sabores o tipos, eso va en la siguiente pregunta.',
    falta: !r.productos.length ? 'Agrega al menos un producto' : null,
    contenido: <PasoProductos r={r} cambiar={cambiar} />,
  })

  // Dos pantallas por producto: sus variantes y sus precios.
  r.productos.forEach((p, n) => {
    lista.push({
      clave: `var:${p.id}`, fase: 'catalogo',
      pregunta: <>¿<span className="text-marca">{p.nombre}</span> viene en sabores, tipos o colores?</>,
      ayuda: 'Cada variante se distingue por su color en la app. Todas comparten el precio.',
      contenido: <PasoVariantes producto={p} indice={n} cambiar={cambiar} />,
    })
    const activos = r.envases.filter((e) => p.precios[e.id]?.activo)
    const sinPrecio = activos.find((e) => !(numero(p.precios[e.id].precio) > 0))
    lista.push({
      clave: `precio:${p.id}`, fase: 'catalogo',
      pregunta: <>¿En qué envases vendes <span className="text-marca">{p.nombre}</span> y a qué precio?</>,
      ayuda: 'El costo es opcional y sólo lo ven los administradores, nunca los repartidores.',
      falta: !activos.length ? `Elige al menos un envase para ${p.nombre}` : sinPrecio ? `Falta el precio en ${nombreEnvase(sinPrecio)}` : null,
      contenido: <PasoPrecios r={r} producto={p} cambiar={cambiar} />,
    })
  })

  lista.push(
    // --- Tu marca ---
    {
      clave: 'logo', fase: 'marca',
      pregunta: '¿Tienes un logo?',
      ayuda: 'Sale en la app de tus repartidores, el panel y los PDF.',
      opcional: !r.marca.logo,
      contenido: <PasoLogo r={r} cambiar={cambiar} />,
    },
    {
      clave: 'color', fase: 'marca',
      pregunta: 'Elige el color de tu marca',
      ayuda: 'Lo usaremos en botones y encabezados.',
      contenido: <PasoColor r={r} cambiar={cambiar} />,
    },
    // --- Tu equipo ---
    {
      clave: 'vendedores', fase: 'equipo',
      pregunta: '¿Quién reparte contigo?',
      ayuda: 'Les mandamos una invitación por correo para que creen su propia contraseña.',
      opcional: !r.invitaciones.length,
      contenido: <PasoVendedores r={r} cambiar={cambiar} />,
    },
    {
      clave: 'resumen', fase: 'equipo',
      pregunta: 'Así queda tu negocio',
      ayuda: 'Prueba cómo levanta un pedido tu repartidor. Si algo no te gusta, regresa y cámbialo.',
      contenido: <PasoResumen r={r} />,
    },
  )
  return lista
}

const colorDeGiro = (r: Registro) => GIROS.find((g) => r.giros.includes(g.valor))?.color ?? r.marca.color

// ---------------------------------------------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------------------------------------------
function Texto({ valor, onChange, placeholder, tipo = 'text', autoComplete, icono }: {
  valor: string
  onChange: (v: string) => void
  placeholder?: string
  tipo?: string
  autoComplete?: string
  icono?: ReactNode
}) {
  return (
    <div className="relative">
      <input
        data-enfocar
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        enterKeyHint="next"
        className={`${claseInput} py-5 text-xl ${icono ? 'pl-13' : ''}`}
      />
      {icono && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-apagado">{icono}</span>}
    </div>
  )
}

function Tarjeta({ elegida, onClick, children, compacta = false }: { elegida: boolean; onClick: () => void; children: ReactNode; compacta?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={elegida}
      className={`relative rounded-[22px] border-2 text-center transition-[colors,transform] active:scale-[0.98] ${compacta ? 'p-2.5' : 'p-3'} ${
        elegida ? 'border-marca bg-marca/10' : 'border-transparent bg-niebla hover:border-linea'
      }`}
    >
      {elegida && (
        <span className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-marca text-white">
          <Check size={14} strokeWidth={3.5} />
        </span>
      )}
      {children}
    </button>
  )
}

function Opcion({ elegida, onClick, titulo, detalle }: { elegida: boolean; onClick: () => void; titulo: string; detalle: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={elegida}
      className={`flex items-center gap-4 rounded-[22px] border-2 p-5 text-left transition-colors ${elegida ? 'border-marca bg-marca/10' : 'border-transparent bg-niebla hover:border-linea'}`}
    >
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${elegida ? 'border-marca bg-marca text-white' : 'border-linea'}`}>
        {elegida && <Check size={14} strokeWidth={3.5} />}
      </span>
      <span>
        <span className="block text-lg font-semibold">{titulo}</span>
        <span className="text-sm text-apagado">{detalle}</span>
      </span>
    </button>
  )
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={`flex items-center gap-1.5 rounded-full px-5 py-3 text-base font-semibold transition-colors ${activo ? 'bg-tinta text-white' : 'bg-niebla text-tinta hover:bg-linea'}`}
    >
      {activo && <Check size={16} strokeWidth={3} />}
      {children}
    </button>
  )
}

// Un campo con su botón «+» que agrega al presionar Enter, sin mandar el formulario.
function Agregar({ placeholder, onAgregar, tipo = 'text', enfocar = false }: { placeholder: string; onAgregar: (v: string) => boolean | void; tipo?: string; enfocar?: boolean }) {
  const [v, setV] = useState('')
  function agregar() {
    if (!v.trim()) return
    if (onAgregar(v.trim()) !== false) setV('')
  }
  return (
    <div className="flex gap-2">
      <input
        {...(enfocar ? { 'data-enfocar': true } : {})}
        type={tipo}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.trim()) {
            e.preventDefault()
            agregar()
          }
        }}
        placeholder={placeholder}
        className={`${claseInput} flex-1`}
      />
      <button type="button" onClick={agregar} disabled={!v.trim()} className="grid w-14 shrink-0 place-items-center rounded-xl bg-tinta text-white disabled:opacity-30" aria-label="Agregar">
        <Plus size={22} />
      </button>
    </div>
  )
}

function PasoPassword({ password, setPassword, correo }: { password: string; setPassword: (s: string) => void; correo: string }) {
  const [ver, setVer] = useState(false)
  const reglas = reglasPassword(password, correo)
  return (
    <div>
      <div className="relative">
        <input
          data-enfocar
          type={ver ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className={`${claseInput} py-5 pr-14 text-xl`}
        />
        <button
          type="button"
          onClick={() => setVer(!ver)}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md p-1 text-apagado hover:text-tinta"
          aria-label={ver ? 'Ocultar contraseña' : 'Ver contraseña'}
        >
          {ver ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>
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
    </div>
  )
}

function PasoTamanos({ r, tipo, cambiar }: { r: Registro; tipo: TipoEnvase; cambiar: (f: (x: Registro) => Registro) => void }) {
  const t = tipoEnvase(tipo)!
  const [error, setError] = useState('')
  const propios = r.envases.filter((e) => e.tipo === tipo && !t.tamanos.some((s) => tieneTamano({ ...r, envases: [e] }, tipo, s)))
  const base = (e: { contenido: number; unidad: string }) => e.contenido / (e.unidad === 'ml' || e.unidad === 'g' ? 1000 : 1)
  const elegidos = r.envases.filter((e) => e.tipo === tipo).sort((a, b) => base(a) - base(b))
  return (
    <div>
      <div className="mb-6 flex items-end justify-center gap-2 rounded-[28px] bg-niebla px-4 pt-6 pb-4">
        {/* Los tamaños elegidos, del chico al grande, cada dibujo más alto que el anterior */}
        {elegidos.length ? elegidos.slice(0, 5).map((e, n, todos) => (
          <div key={e.id} className="flex flex-col items-center">
            <div style={{ height: 64 + (todos.length > 1 ? (n / (todos.length - 1)) * 48 : 32) }}>
              <DibujoEnvase tipo={tipo} color={colorDeGiro(r)} className="h-full" />
            </div>
            {tipo !== 'pieza' && <div className="mt-1 text-xs font-semibold text-apagado">{textoTamano(e)}</div>}
          </div>
        )) : <DibujoEnvase tipo={tipo} color={colorDeGiro(r)} className="h-24" apagado />}
      </div>
      {tipo !== 'pieza' && (
        <>
          <div className="flex flex-wrap gap-2">
            {t.tamanos.map((s) => (
              <Chip key={s} activo={tieneTamano(r, tipo, s)} onClick={() => cambiar((x) => alternarTamano(x, tipo, s))}>{s}</Chip>
            ))}
            {propios.map((e) => (
              <Chip key={e.id} activo onClick={() => cambiar((x) => alternarTamano(x, tipo, textoTamano(e)))}>{textoTamano(e)}</Chip>
            ))}
          </div>
          {tipo !== 'granel' && (
            <div className="mt-5">
              <span className="mb-1.5 block text-sm font-semibold text-apagado">¿Otro tamaño? Escríbelo con su unidad</span>
              <Agregar
                placeholder="Ej. 3 L, 750 ml, 20 kg, 6 pz"
                onAgregar={(v) => {
                  setError('')
                  const x = leerTamano(v)
                  if (!x) return setError('Escribe el número y la unidad, por ejemplo 3 L'), false
                  if (tieneTamano(r, tipo, v)) return setError('Ese tamaño ya está'), false
                  cambiar((y) => alternarTamano(y, tipo, v))
                }}
              />
              {error && <p role="alert" className="mt-2 text-sm font-medium text-rojo">{error}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PasoProductos({ r, cambiar }: { r: Registro; cambiar: (f: (x: Registro) => Registro) => void }) {
  const sugeridos = sugerenciasProductos(r)
  const agregar = (nombre: string, variantes: string[] = []) => {
    if (r.productos.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase())) return false
    cambiar((x) => ({ ...x, productos: [...x.productos, productoNuevo(nombre, variantes, x.productos.length)] }))
  }
  return (
    <div className="space-y-5">
      <Agregar placeholder="Ej. Yogurt, Arroz, Agua…" onAgregar={(v) => agregar(v)} enfocar />
      {r.productos.length > 0 && (
        <ul className="space-y-2">
          {r.productos.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-papel px-4 py-3 ring-1 ring-linea">
              <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/15" style={{ background: p.color }} />
              <span className="flex-1 text-lg font-semibold">{p.nombre}</span>
              <button
                type="button"
                onClick={() => cambiar((x) => ({ ...x, productos: x.productos.filter((y) => y.id !== p.id) }))}
                className="grid h-9 w-9 place-items-center rounded-full text-apagado hover:bg-rojo/10 hover:text-rojo"
                aria-label={`Quitar ${p.nombre}`}
              >
                <X size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {sugeridos.length > 0 && (
        <div>
          <span className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-apagado"><Sparkles size={14} /> Sugerencias</span>
          <div className="flex flex-wrap gap-2">
            {sugeridos.map((s) => (
              <button key={s.nombre} type="button" onClick={() => agregar(s.nombre, s.variantes)} className="flex items-center gap-1.5 rounded-full border-2 border-dashed border-linea px-4 py-2 font-semibold hover:border-marca">
                <Plus size={15} /> {s.nombre}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PasoVariantes({ producto: p, indice, cambiar }: { producto: Producto; indice: number; cambiar: (f: (x: Registro) => Registro) => void }) {
  const poner = (f: (p: Producto) => Producto) => cambiar((x) => ({ ...x, productos: x.productos.map((y) => (y.id === p.id ? f(y) : y)) }))
  const [con, setCon] = useState(p.variantes.length > 0)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Opcion elegida={!con} onClick={() => { setCon(false); poner((y) => ({ ...y, variantes: [] })) }} titulo="No" detalle="Es uno solo" />
        <Opcion elegida={con} onClick={() => setCon(true)} titulo="Sí" detalle="Tiene variantes" />
      </div>
      {con && (
        <div className="animate-[paso-entrar_.3s_ease-out] space-y-3">
          <Agregar
            placeholder="Ej. Fresa, Integral, Grande…"
            enfocar
            onAgregar={(v) => {
              if (p.variantes.some((x) => x.nombre.toLowerCase() === v.toLowerCase())) return false
              poner((y) => ({ ...y, variantes: [...y.variantes, { nombre: v, color: colorPara(v, indice + y.variantes.length) }] }))
            }}
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {p.variantes.map((v, n) => (
              <div key={v.nombre} className="flex items-center gap-2 rounded-2xl bg-niebla py-2 pr-2 pl-2.5">
                {/* El color se cambia tocando el círculo */}
                <label className="relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full ring-2 ring-white/70" style={{ background: v.color }} title="Cambiar color">
                  <input
                    type="color"
                    value={v.color}
                    onChange={(e) => poner((y) => ({ ...y, variantes: y.variantes.map((z, m) => (m === n ? { ...z, color: e.target.value } : z)) }))}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    aria-label={`Color de ${v.nombre}`}
                  />
                </label>
                <span className="min-w-0 flex-1 truncate font-semibold">{v.nombre}</span>
                <button
                  type="button"
                  onClick={() => poner((y) => ({ ...y, variantes: y.variantes.filter((_, m) => m !== n) }))}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-linea"
                  aria-label={`Quitar ${v.nombre}`}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          {p.variantes.length > 0 && <p className="text-sm text-apagado">Toca el círculo para cambiar el color.</p>}
        </div>
      )}
    </div>
  )
}

function PasoPrecios({ r, producto: p, cambiar }: { r: Registro; producto: Producto; cambiar: (f: (x: Registro) => Registro) => void }) {
  const precio = (id: string) => p.precios[id] ?? { precio: '', costo: '', activo: false }
  const poner = (id: string, c: Partial<Producto['precios'][string]>) =>
    cambiar((x) => ({ ...x, productos: x.productos.map((y) => (y.id === p.id ? { ...y, precios: { ...y.precios, [id]: { ...precio(id), ...c } } } : y)) }))
  const color = p.variantes[0]?.color ?? p.color
  // Primero los envases que ya se usan o se sugirieron para este producto; el orden no cambia al marcar o desmarcar.
  const [primero] = useState(() => new Set(Object.keys(p.precios)))
  const orden = [...r.envases].sort((a, b) => (primero.has(a.id) ? 0 : 1) - (primero.has(b.id) ? 0 : 1))
  return (
    <div className="space-y-3">
      {orden.map((e) => {
        const v = precio(e.id)
        const ganancia = numero(v.precio) - numero(v.costo)
        return (
          <div key={e.id} className={`overflow-hidden rounded-[22px] border-2 transition-colors ${v.activo ? 'border-marca bg-papel' : 'border-transparent bg-niebla'}`}>
            <button type="button" onClick={() => poner(e.id, { activo: !v.activo })} aria-pressed={v.activo} className="flex w-full items-center gap-3 p-3 text-left">
              <DibujoEnvase tipo={e.tipo} color={color} etiqueta={p.nombre.slice(0, 1).toUpperCase()} className="h-16" apagado={!v.activo} />
              <span className="flex-1">
                <span className="block text-lg font-semibold">{nombreEnvase(e)}</span>
                <span className="text-sm text-apagado">{v.activo ? 'Lo vendo así' : 'Tócalo si lo vendes así'}</span>
              </span>
              <span className={`grid h-7 w-7 place-items-center rounded-full border-2 ${v.activo ? 'border-marca bg-marca text-white' : 'border-linea'}`}>
                {v.activo && <Check size={15} strokeWidth={3.5} />}
              </span>
            </button>
            {v.activo && (
              <div className="grid animate-[paso-entrar_.3s_ease-out] grid-cols-2 gap-3 px-3 pb-3">
                <Dinero etiqueta="Precio de venta" valor={v.precio} onChange={(s) => poner(e.id, { precio: s })} enfocar />
                <Dinero etiqueta="Te cuesta (opcional)" valor={v.costo} onChange={(s) => poner(e.id, { costo: s })} />
                {Number.isFinite(ganancia) && numero(v.precio) > 0 && (
                  <p className={`col-span-2 text-sm font-semibold ${ganancia >= 0 ? 'text-verde' : 'text-rojo'}`}>
                    {ganancia >= 0 ? `Ganas ${dinero(ganancia)} por cada uno` : `Pierdes ${dinero(-ganancia)} por cada uno`}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Dinero({ etiqueta, valor, onChange, enfocar = false }: { etiqueta: string; valor: string; onChange: (s: string) => void; enfocar?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-apagado">{etiqueta}</span>
      <span className="relative block">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-apagado">$</span>
        <input autoFocus={enfocar && !valor} inputMode="decimal" value={valor} onChange={(e) => onChange(e.target.value)} className={`${claseInput} pl-8 text-lg font-semibold`} />
      </span>
    </label>
  )
}

const LOGO_MAXIMO = 500 * 1024

function PasoLogo({ r, cambiar }: { r: Registro; cambiar: (f: (x: Registro) => Registro) => void }) {
  const [error, setError] = useState('')
  function elegir(f: File | undefined) {
    setError('')
    if (!f) return
    if (!f.type.startsWith('image/')) return setError('Elige una imagen (PNG, JPG o SVG)')
    if (f.size > LOGO_MAXIMO) return setError('La imagen pesa más de 500 KB; prueba con una más chica')
    const lector = new FileReader()
    lector.onload = () => cambiar((x) => ({ ...x, marca: { ...x.marca, logo: String(lector.result) } }))
    lector.readAsDataURL(f)
  }
  return (
    <div>
      <label className="flex cursor-pointer flex-col items-center gap-3 rounded-[28px] border-2 border-dashed border-linea p-8 text-center transition-colors hover:border-marca">
        <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-3xl bg-niebla">
          {r.marca.logo ? <img src={r.marca.logo} alt="Tu logo" className="h-full w-full object-contain p-2" /> : <ImagePlus size={36} className="text-apagado" />}
        </div>
        <div className="text-lg font-semibold">{r.marca.logo ? 'Cambiar logo' : 'Subir mi logo'}</div>
        <div className="text-sm text-apagado">PNG, JPG o SVG, hasta 500 KB</div>
        <input type="file" accept="image/*" className="sr-only" onChange={(e) => elegir(e.target.files?.[0])} />
      </label>
      {error && <p role="alert" className="mt-3 text-sm font-medium text-rojo">{error}</p>}
      {r.marca.logo && (
        <button type="button" onClick={() => cambiar((x) => ({ ...x, marca: { ...x.marca, logo: null } }))} className="mt-3 text-sm font-semibold text-azul hover:underline">
          Quitar logo
        </button>
      )}
    </div>
  )
}

function PasoColor({ r, cambiar }: { r: Registro; cambiar: (f: (x: Registro) => Registro) => void }) {
  const poner = (c: string) => cambiar((x) => ({ ...x, marca: { ...x.marca, color: c } }))
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center gap-3">
        {COLORES_MARCA.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => poner(c)}
            aria-pressed={r.marca.color === c}
            aria-label={`Color ${c}`}
            className={`grid h-14 w-14 place-items-center rounded-full ring-offset-2 ring-offset-lienzo transition-shadow ${r.marca.color === c ? 'ring-[3px] ring-tinta' : ''}`}
            style={{ background: c }}
          >
            {r.marca.color === c && <Check size={22} strokeWidth={3} className="text-white" />}
          </button>
        ))}
        <label className="flex h-14 items-center gap-2 rounded-full bg-niebla pr-5 pl-2 font-semibold">
          <input type="color" value={r.marca.color} onChange={(e) => poner(e.target.value)} className="h-10 w-10 cursor-pointer rounded-full border-0 bg-transparent" />
          Otro
        </label>
      </div>
      <div className="overflow-hidden rounded-[22px] ring-1 ring-linea">
        <div className="flex items-center gap-3 px-4 py-4 text-white" style={{ background: r.marca.color }}>
          {r.marca.logo ? <img src={r.marca.logo} alt="" className="h-10 w-10 rounded-xl bg-white object-contain p-1" /> : <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/20 text-lg font-bold">{r.negocio.trim().slice(0, 1).toUpperCase()}</span>}
          <span className="truncate text-lg font-semibold">{r.negocio || 'Tu negocio'}</span>
        </div>
        <div className="space-y-3 bg-papel p-4">
          <div className="h-3 w-2/3 rounded-full bg-niebla" />
          <div className="h-3 w-1/2 rounded-full bg-niebla" />
          <div className="rounded-full py-3 text-center font-semibold text-white" style={{ background: r.marca.color }}>Nuevo pedido</div>
        </div>
      </div>
    </div>
  )
}

function PasoVendedores({ r, cambiar }: { r: Registro; cambiar: (f: (x: Registro) => Registro) => void }) {
  const [error, setError] = useState('')
  return (
    <div className="space-y-4">
      <Agregar
        tipo="email"
        enfocar
        placeholder="correo de tu repartidor"
        onAgregar={(v) => {
          setError('')
          const c = v.toLowerCase()
          if (!correoValido(c)) return setError('Ese correo no parece válido'), false
          if (c === r.correo.trim().toLowerCase()) return setError('Ese es tu correo; tú ya eres administrador'), false
          if (r.invitaciones.includes(c)) return setError('Ya está en la lista'), false
          cambiar((x) => ({ ...x, invitaciones: [...x.invitaciones, c] }))
        }}
      />
      {error && <p role="alert" className="text-sm font-medium text-rojo">{error}</p>}
      <ul className="space-y-2">
        {r.invitaciones.map((c) => (
          <li key={c} className="flex items-center gap-3 rounded-2xl bg-niebla px-4 py-3">
            <Mail size={18} className="shrink-0 text-apagado" />
            <span className="min-w-0 flex-1 truncate font-semibold">{c}</span>
            <button type="button" onClick={() => cambiar((x) => ({ ...x, invitaciones: x.invitaciones.filter((y) => y !== c) }))} className="grid h-8 w-8 place-items-center rounded-full hover:bg-linea" aria-label={`Quitar ${c}`}>
              <X size={16} />
            </button>
          </li>
        ))}
      </ul>
      {!r.invitaciones.length && <p className="text-sm text-apagado">Si aún no los tienes, omite este paso: los invitas después desde Equipo.</p>}
    </div>
  )
}

function PasoResumen({ r }: { r: Registro }) {
  const lista = presentaciones(r)
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-[22px] px-4 py-4 text-white" style={{ background: r.marca.color }}>
        {r.marca.logo ? <img src={r.marca.logo} alt="" className="h-12 w-12 rounded-xl bg-white object-contain p-1" /> : <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/20 text-xl font-bold">{r.negocio.trim().slice(0, 1).toUpperCase()}</span>}
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold">{r.negocio}</div>
          <div className="truncate text-sm opacity-80">
            {r.productos.length} {r.productos.length === 1 ? 'producto' : 'productos'} · {lista.length} presentaciones · {r.invitaciones.length} {r.invitaciones.length === 1 ? 'repartidor' : 'repartidores'}
          </div>
        </div>
      </div>
      <VistaRepartidor r={r} />
    </div>
  )
}

// La hoja «Nuevo pedido» como la verá el repartidor: tarjetas por presentación al estilo de los sabores de yogurt,
// con el dibujo del envase del color del producto, + y − grandes, y el total por unidad abajo.
function VistaRepartidor({ r }: { r: Registro }) {
  const lista = presentaciones(r)
  const [cant, setCant] = useState<Record<string, number>>({})
  const sumar = (k: string, d: number) => setCant((c) => ({ ...c, [k]: Math.max(0, (c[k] ?? 0) + d) }))
  const total = lista.reduce((s, x) => s + (cant[x.clave] ?? 0) * (x.precio || 0), 0)
  const porUnidad = new Map<string, number>()
  for (const x of lista) {
    const c = cant[x.clave] ?? 0
    if (c) porUnidad.set(x.envase.unidad, (porUnidad.get(x.envase.unidad) ?? 0) + c * x.envase.contenido)
  }
  const resumen = [...porUnidad].map(([u, v]) => `${v.toLocaleString('es-MX', { maximumFractionDigits: 3 })} ${u}`).join(' + ')

  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-[36px] border-[7px] border-tinta/85 bg-papel shadow-tarjeta">
      <div className="flex items-center gap-2 px-4 py-3 text-white" style={{ background: r.marca.color }}>
        <span className="truncate font-semibold">Nuevo pedido</span>
      </div>
      <div className="grid max-h-[28rem] grid-cols-2 gap-2.5 overflow-y-auto p-2.5">
        {lista.map((x) => {
          const c = cant[x.clave] ?? 0
          return (
            <div key={x.clave} className={`flex flex-col overflow-hidden rounded-2xl transition-shadow ${c ? 'ring-2 ring-tinta' : 'ring-1 ring-linea'}`}>
              <div className="relative flex justify-center px-2 pt-3 pb-1" style={{ background: `color-mix(in oklab, ${x.color} 22%, var(--color-papel))` }}>
                <DibujoEnvase tipo={x.envase.tipo} color={x.color} etiqueta={x.nombre.slice(0, 1).toUpperCase()} className="h-20" />
                {c > 0 && <span className="absolute top-2 right-2 grid h-7 min-w-7 place-items-center rounded-full bg-tinta px-1.5 text-sm font-bold text-white tabular-nums">{c}</span>}
              </div>
              <div className="flex flex-1 flex-col bg-papel px-2.5 pt-2 pb-2.5">
                <div className="truncate text-sm leading-5 font-bold">{x.nombre}</div>
                <div className="truncate text-xs text-apagado">{nombreEnvase(x.envase)} · {dinero(x.precio || 0)}</div>
                <div className="mt-2 flex items-center justify-between">
                  <button type="button" onClick={() => sumar(x.clave, -1)} disabled={!c} className="grid h-9 w-9 place-items-center rounded-full bg-niebla disabled:opacity-30" aria-label={`Quitar ${x.nombre}`}>
                    <Minus size={16} strokeWidth={3} />
                  </button>
                  <span className="text-lg font-extrabold tabular-nums">{c}</span>
                  <button type="button" onClick={() => sumar(x.clave, 1)} className="grid h-9 w-9 place-items-center rounded-full text-white" style={{ background: r.marca.color }} aria-label={`Agregar ${x.nombre}`}>
                    <Plus size={16} strokeWidth={3} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between px-4 py-3.5 text-white" style={{ background: '#0e1124' }}>
        <span className="text-sm text-white/70">{resumen || 'Toca + para agregar'}</span>
        <span className="text-2xl font-extrabold tabular-nums">{dinero(total)}</span>
      </div>
    </div>
  )
}

function Listo({ r, onIrAlPanel }: { r: Registro; onIrAlPanel: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-marca text-white">
        <Check size={40} strokeWidth={3} />
      </div>
      <h1 className="mt-6 text-[2rem] font-semibold leading-tight">¡{r.negocio} ya está lista!</h1>
      <p className="mt-2 max-w-sm text-apagado">Confirma tu correo con el código que te enviamos y entra al panel.</p>
      <button type="button" onClick={onIrAlPanel} className="mt-8 rounded-full bg-tinta px-8 py-4 font-semibold text-white hover:bg-marca-oscuro">
        Ir al panel
      </button>
    </div>
  )
}
