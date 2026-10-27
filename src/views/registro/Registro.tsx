import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Building2, Check, ClipboardCheck, Eye, EyeOff, Info, MailCheck, Minus, Package, Palette, Pencil,
  Plus, ShoppingBasket, Trash2, Truck, Upload, UserRound, X,
} from 'lucide-react'
import { Campo, claseInput } from '../../components/ui'
import {
  COLORES, ENVASES_COMUNES, GIROS, UNIDADES, ZONAS, aplicarPlantilla, id, nombreEnvase, numero, problemasPassword, vacio,
  type Envase, type Giro, type Producto, type Registro as Datos,
} from './modelo'

// Registro progresivo de una empresa: un paso a la vez, con la barra de avance arriba y todo lo escrito guardado en este
// navegador (menos la contraseña) por si se cierra a medias. PROTOTIPO: el último paso todavía no crea nada en el
// servidor; sirve para revisar el recorrido antes de conectarlo con la multiempresa (fases 1, 2 y 4 del plan).

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const BORRADOR = 'registro-empresa-borrador'

type IdPaso = 'negocio' | 'cuenta' | 'verificar' | 'envases' | 'productos' | 'marca' | 'resumen'
const PASOS: { id: IdPaso; titulo: string; corto: string; icono: typeof Building2 }[] = [
  { id: 'negocio', titulo: 'Cuéntanos de tu negocio', corto: 'Negocio', icono: Building2 },
  { id: 'cuenta', titulo: 'Crea tu cuenta de administrador', corto: 'Tu cuenta', icono: UserRound },
  { id: 'verificar', titulo: 'Confirma tu correo', corto: 'Correo', icono: MailCheck },
  { id: 'envases', titulo: '¿En qué lo entregas?', corto: 'Envases', icono: Package },
  { id: 'productos', titulo: 'Tus productos y precios', corto: 'Productos', icono: ShoppingBasket },
  { id: 'marca', titulo: 'Tu marca', corto: 'Marca', icono: Palette },
  { id: 'resumen', titulo: 'Revisa y crea tu empresa', corto: 'Listo', icono: ClipboardCheck },
]

function leerBorrador(): { datos: Datos; paso: number } {
  try {
    const b = JSON.parse(localStorage.getItem(BORRADOR) ?? 'null')
    if (b?.datos?.negocio) return { datos: { ...vacio(), ...b.datos }, paso: Math.min(Number(b.paso) || 0, PASOS.length - 1) }
  } catch { /* sin borrador */ }
  return { datos: vacio(), paso: 0 }
}

// Texto claro u oscuro sobre el color de la marca, el que se lea mejor.
function textoSobre(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.36 ? '#111111' : '#ffffff'
}

export function Registro({ onIrALogin }: { onIrALogin: () => void }) {
  const inicial = useRef(leerBorrador()).current
  const [datos, setDatos] = useState<Datos>(inicial.datos)
  const [paso, setPaso] = useState(inicial.paso)
  const [password, setPassword] = useState('') // nunca va al borrador
  const [confirmacion, setConfirmacion] = useState('')
  const [codigo, setCodigo] = useState('')
  const [verificado, setVerificado] = useState(false)
  const [error, setError] = useState('')
  const [creada, setCreada] = useState(false)
  const titulo = useRef<HTMLHeadingElement>(null)

  // Sin contraseña guardada, volver a un paso posterior a «Tu cuenta» la pediría otra vez: se regresa ahí.
  useEffect(() => {
    if (paso > 1 && !password) setPaso(1)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try { localStorage.setItem(BORRADOR, JSON.stringify({ datos, paso })) } catch { /* sin almacenamiento */ }
  }, [datos, paso])

  // El aviso de lo que falta se quita en cuanto la persona corrige algo.
  useEffect(() => setError(''), [datos, password, confirmacion, verificado])

  useEffect(() => {
    titulo.current?.focus()
    window.scrollTo({ top: 0 })
  }, [paso, creada])

  const actual = PASOS[paso]
  const cambiar = <K extends keyof Datos>(k: K, v: Partial<Datos[K]> | Datos[K]) =>
    setDatos((d) => ({ ...d, [k]: Array.isArray(v) || typeof v !== 'object' || v === null ? v : { ...(d[k] as object), ...v } }))

  function revisar(): string | null {
    const { negocio, cuenta, envases, productos } = datos
    switch (actual.id) {
      case 'negocio':
        if (negocio.nombre.trim().length < 2) return 'Escribe el nombre de tu negocio'
        if (!negocio.giro) return 'Elige qué vende tu negocio'
        if (negocio.giro === 'otro' && !negocio.giroOtro.trim()) return 'Cuéntanos qué vendes'
        return null
      case 'cuenta': {
        if (cuenta.nombre.trim().length < 2) return 'Escribe tu nombre'
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cuenta.correo.trim())) return 'Escribe un correo válido'
        const falla = problemasPassword(password, cuenta.correo).find((r) => !r.ok)
        if (falla) return `La contraseña necesita: ${falla.texto.toLowerCase()}`
        if (password !== confirmacion) return 'Las dos contraseñas no coinciden'
        if (!cuenta.acepta) return 'Acepta los términos para continuar'
        return null
      }
      case 'verificar':
        return verificado ? null : 'Escribe el código de 6 dígitos que te enviamos'
      case 'envases':
        if (!envases.length) return 'Agrega al menos un envase o forma de venta'
        if (envases.some((e) => !e.nombre.trim() || !(e.contenido > 0) || !e.unidad.trim())) return 'Revisa que cada envase tenga nombre, cantidad y unidad'
        return null
      case 'productos': {
        if (!productos.length) return 'Agrega al menos un producto'
        for (const p of productos) {
          if (!p.nombre.trim()) return 'Hay un producto sin nombre'
          const usados = envases.filter((e) => p.precios[e.id])
          if (!usados.length) return `Elige en qué envases vendes «${p.nombre}»`
          for (const e of usados) {
            const { precio, costo } = p.precios[e.id]
            if (!(numero(precio) > 0)) return `Falta el precio de «${p.nombre}» en ${nombreEnvase(e)}`
            if (costo.trim() && !(numero(costo) >= 0)) return `El costo de «${p.nombre}» en ${nombreEnvase(e)} no es un número`
          }
        }
        return null
      }
      default:
        return null
    }
  }

  function avanzar(e?: FormEvent) {
    e?.preventDefault()
    const problema = revisar()
    if (problema) return setError(problema)
    setError('')
    if (actual.id === 'negocio' && !datos.marca.nombre) cambiar('marca', { nombre: datos.negocio.nombre.trim() })
    if (actual.id === 'resumen') {
      try { localStorage.removeItem(BORRADOR) } catch { /* nada */ }
      return setCreada(true)
    }
    setPaso((p) => Math.min(p + 1, PASOS.length - 1))
  }

  function irA(i: number) {
    if (i > paso) return
    if (i > 1 && !password) return setPaso(1)
    setError('')
    setPaso(i)
  }

  function elegirGiro(g: Giro) {
    // La plantilla sólo se pone si todavía no armó su catálogo: cambiar de giro no le borra lo que ya escribió.
    setDatos((d) => ({ ...d, negocio: { ...d.negocio, giro: g }, ...(!d.envases.length && !d.productos.length ? aplicarPlantilla(g) : {}) }))
  }

  if (creada) return <Creada datos={datos} onIrALogin={onIrALogin} tituloRef={titulo} />

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2 sm:px-8">
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-tinta text-white"><Truck size={18} aria-hidden="true" /></span>
          Reparto
        </span>
        <span className="flex-1" />
        <button type="button" onClick={onIrALogin} className={`rounded-full px-3 py-2 text-sm font-semibold text-apagado hover:bg-niebla hover:text-tinta ${anillo}`}>
          Ya tengo cuenta
        </button>
      </header>

      <div className="mx-auto grid max-w-5xl gap-6 px-4 pb-16 sm:px-8 lg:grid-cols-[15rem_1fr] lg:gap-10 lg:pt-6">
        {/* Avance: barra en el teléfono, lista de pasos en pantallas grandes */}
        <nav aria-label="Pasos del registro" className="lg:sticky lg:top-6 lg:self-start">
          <div className="lg:hidden">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">{actual.corto}</span>
              <span className="text-apagado">Paso {paso + 1} de {PASOS.length}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-niebla" role="progressbar" aria-valuemin={1} aria-valuemax={PASOS.length} aria-valuenow={paso + 1} aria-label="Avance del registro">
              <div className="h-full rounded-full bg-tinta transition-[width] duration-300" style={{ width: `${((paso + 1) / PASOS.length) * 100}%` }} />
            </div>
          </div>
          <ol className="hidden space-y-1 lg:block">
            {PASOS.map((p, i) => {
              const hecho = i < paso
              const Icono = p.icono
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => irA(i)}
                    disabled={i > paso}
                    aria-current={i === paso ? 'step' : undefined}
                    className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold transition-colors disabled:cursor-default ${anillo} ${
                      i === paso ? 'bg-papel shadow-[0_6px_20px_rgba(0,32,20,0.08)]' : hecho ? 'hover:bg-niebla' : 'text-apagado'
                    }`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${hecho ? 'bg-tinta text-white' : i === paso ? 'bg-limon' : 'bg-niebla'}`}>
                      {hecho ? <Check size={16} aria-hidden="true" /> : <Icono size={16} aria-hidden="true" />}
                    </span>
                    {p.corto}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <main>
          <form onSubmit={avanzar} noValidate className="rounded-[28px] border border-linea bg-papel p-5 shadow-[0_16px_48px_rgba(0,32,20,0.06)] sm:p-8">
            <h1 ref={titulo} tabIndex={-1} className="text-[1.75rem] leading-tight font-semibold outline-none sm:text-[2rem]">{actual.titulo}</h1>

            <div className="mt-6">
              {actual.id === 'negocio' && <PasoNegocio datos={datos} cambiar={cambiar} elegirGiro={elegirGiro} />}
              {actual.id === 'cuenta' && (
                <PasoCuenta datos={datos} cambiar={cambiar} password={password} setPassword={setPassword} confirmacion={confirmacion} setConfirmacion={setConfirmacion} />
              )}
              {actual.id === 'verificar' && (
                <PasoVerificar correo={datos.cuenta.correo} codigo={codigo} setCodigo={(c) => { setCodigo(c); setVerificado(/^\d{6}$/.test(c)) }} verificado={verificado} />
              )}
              {actual.id === 'envases' && <PasoEnvases datos={datos} setDatos={setDatos} />}
              {actual.id === 'productos' && <PasoProductos datos={datos} setDatos={setDatos} />}
              {actual.id === 'marca' && <PasoMarca datos={datos} cambiar={cambiar} />}
              {actual.id === 'resumen' && <PasoResumen datos={datos} irA={irA} />}
            </div>

            {error && (
              <p role="alert" className="mt-6 flex items-start gap-2 rounded-2xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">
                <Info size={18} className="mt-px shrink-0" aria-hidden="true" /> {error}
              </p>
            )}

            <div className="mt-8 flex items-center gap-3">
              {paso > 0 && (
                <button type="button" onClick={() => irA(paso - 1)} className={`flex h-13 items-center gap-2 rounded-full border border-linea px-5 font-semibold hover:bg-niebla ${anillo}`}>
                  <ArrowLeft size={18} aria-hidden="true" /> Atrás
                </button>
              )}
              <button type="submit" className={`ml-auto flex h-13 flex-1 items-center justify-center gap-2 rounded-full bg-tinta px-6 font-semibold text-white hover:bg-marca-oscuro sm:flex-none ${anillo}`}>
                {actual.id === 'resumen' ? 'Crear mi empresa' : actual.id === 'verificar' ? 'Confirmar' : 'Continuar'}
                {actual.id !== 'resumen' && <ArrowRight size={18} aria-hidden="true" />}
              </button>
            </div>
          </form>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-apagado">
            <Info size={14} aria-hidden="true" /> Prototipo: lo que escribas se guarda sólo en este navegador; todavía no se crea la empresa.
          </p>
        </main>
      </div>
    </div>
  )
}

type Cambiar = <K extends keyof Datos>(k: K, v: Partial<Datos[K]> | Datos[K]) => void
type SetDatos = (f: (d: Datos) => Datos) => void

function Ayuda({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-sm text-apagado">{children}</p>
}

function Opcion({ activa, onClick, children, className = '' }: { activa: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`rounded-2xl border-2 px-4 py-3 text-left transition-colors ${anillo} ${activa ? 'border-tinta bg-tinta/5' : 'border-linea hover:bg-niebla'} ${className}`}
    >
      {children}
    </button>
  )
}

function Interruptor({ activo, onChange, etiqueta, ayuda }: { activo: boolean; onChange: (v: boolean) => void; etiqueta: string; ayuda?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{etiqueta}</span>
        {ayuda && <span className="block text-sm text-apagado">{ayuda}</span>}
      </span>
      <input type="checkbox" role="switch" checked={activo} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full bg-linea transition-colors peer-checked:bg-tinta peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-marca after:absolute after:top-1 after:left-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  )
}

// ------------------------------------------------------------------------------------------ 1. Negocio

function PasoNegocio({ datos, cambiar, elegirGiro }: { datos: Datos; cambiar: Cambiar; elegirGiro: (g: Giro) => void }) {
  const n = datos.negocio
  return (
    <div className="space-y-6">
      <Campo etiqueta="Nombre del negocio">
        <input autoFocus value={n.nombre} onChange={(e) => cambiar('negocio', { nombre: e.target.value })} placeholder="Ej. Lácteos La Pradera" maxLength={80} className={claseInput} autoComplete="organization" />
      </Campo>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold text-apagado">¿Qué vende?</legend>
        <Ayuda>Con esto te proponemos envases y productos; en los siguientes pasos los cambias como quieras.</Ayuda>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {GIROS.map((g) => (
            <Opcion key={g.valor} activa={n.giro === g.valor} onClick={() => elegirGiro(g.valor)}>
              <span className="block font-semibold">{g.texto}</span>
              <span className="block text-xs text-apagado">{g.ejemplo}</span>
            </Opcion>
          ))}
        </div>
        {n.giro === 'otro' && (
          <input value={n.giroOtro} onChange={(e) => cambiar('negocio', { giroOtro: e.target.value })} placeholder="¿Qué vendes? Ej. hielo, carbón, flores" maxLength={80} className={`${claseInput} mt-3`} />
        )}
      </fieldset>
      <Campo etiqueta="Zona horaria">
        <select value={n.zona} onChange={(e) => cambiar('negocio', { zona: e.target.value })} className={claseInput}>
          {ZONAS.map((z) => <option key={z.valor} value={z.valor}>{z.texto}</option>)}
        </select>
      </Campo>
      <Ayuda>Define cuál es «hoy» para tus rutas y reportes. La tomamos de tu equipo.</Ayuda>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ 2. Cuenta

function PasoCuenta({ datos, cambiar, password, setPassword, confirmacion, setConfirmacion }: {
  datos: Datos; cambiar: Cambiar; password: string; setPassword: (s: string) => void; confirmacion: string; setConfirmacion: (s: string) => void
}) {
  const c = datos.cuenta
  const [ver, setVer] = useState(false)
  const reglas = problemasPassword(password, c.correo)
  return (
    <div className="space-y-5">
      <p className="text-apagado">Serás el administrador de <b className="text-tinta">{datos.negocio.nombre}</b>. Después invitas a tus repartidores.</p>
      <Campo etiqueta="Tu nombre">
        <input autoFocus value={c.nombre} onChange={(e) => cambiar('cuenta', { nombre: e.target.value })} autoComplete="name" maxLength={100} className={claseInput} />
      </Campo>
      <Campo etiqueta="Correo">
        <input type="email" value={c.correo} onChange={(e) => cambiar('cuenta', { correo: e.target.value })} autoComplete="email" placeholder="correo@ejemplo.com" maxLength={150} className={claseInput} />
      </Campo>
      <Ayuda>Cada correo pertenece a una sola empresa.</Ayuda>
      <Campo etiqueta="Teléfono (opcional)">
        <input type="tel" value={c.telefono} onChange={(e) => cambiar('cuenta', { telefono: e.target.value })} autoComplete="tel" maxLength={20} className={claseInput} />
      </Campo>
      <Campo etiqueta="Contraseña">
        <div className="relative">
          <input type={ver ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={128} className={`${claseInput} pr-12`} />
          <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar contraseña' : 'Ver contraseña'} className={`absolute right-3.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-apagado hover:text-tinta ${anillo}`}>
            {ver ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </Campo>
      <ul className="grid gap-1 text-sm" aria-label="Requisitos de la contraseña">
        {reglas.map((r) => (
          <li key={r.texto} className={`flex items-center gap-2 ${r.ok ? 'text-verde' : 'text-apagado'}`}>
            {r.ok ? <Check size={16} aria-hidden="true" /> : <span aria-hidden="true" className="mx-1 h-2 w-2 rounded-full bg-linea" />}
            {r.texto}<span className="sr-only">{r.ok ? ': cumple' : ': falta'}</span>
          </li>
        ))}
      </ul>
      <Campo etiqueta="Repite la contraseña">
        <input type={ver ? 'text' : 'password'} value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} autoComplete="new-password" maxLength={128} className={claseInput} />
      </Campo>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" checked={c.acepta} onChange={(e) => cambiar('cuenta', { acepta: e.target.checked })} className="mt-0.5 h-5 w-5" />
        <span>Acepto los términos de uso y el aviso de privacidad.</span>
      </label>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ 3. Verificar

function PasoVerificar({ correo, codigo, setCodigo, verificado }: { correo: string; codigo: string; setCodigo: (c: string) => void; verificado: boolean }) {
  const [espera, setEspera] = useState(60)
  useEffect(() => {
    if (espera <= 0) return
    const t = setTimeout(() => setEspera((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [espera])
  return (
    <div className="space-y-5">
      <p className="text-apagado">Te enviamos un código de 6 dígitos a <b className="text-tinta">{correo}</b>. Vence en 15 minutos.</p>
      <Campo etiqueta="Código">
        <input
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          className={`${claseInput} text-center text-2xl font-semibold tracking-[0.5em]`}
        />
      </Campo>
      {verificado && <p className="flex items-center gap-2 text-sm font-semibold text-verde"><Check size={16} aria-hidden="true" /> Correo confirmado</p>}
      <button type="button" disabled={espera > 0} onClick={() => setEspera(60)} className={`text-sm font-semibold text-azul disabled:text-apagado ${anillo}`}>
        {espera > 0 ? `Reenviar código en ${espera} s` : 'Reenviar código'}
      </button>
      <p className="rounded-2xl bg-niebla px-4 py-3 text-sm text-apagado">En el prototipo no se manda correo: cualquier código de 6 dígitos sirve.</p>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ 4. Envases

function PasoEnvases({ datos, setDatos }: { datos: Datos; setDatos: SetDatos }) {
  const agregar = (e: Omit<Envase, 'id'>) => setDatos((d) => ({ ...d, envases: [...d.envases, { ...e, id: id() }] }))
  const editar = (i: string, cambio: Partial<Envase>) => setDatos((d) => ({ ...d, envases: d.envases.map((e) => (e.id === i ? { ...e, ...cambio } : e)) }))
  const quitar = (i: string) => setDatos((d) => ({
    ...d,
    envases: d.envases.filter((e) => e.id !== i),
    productos: d.productos.map((p) => ({ ...p, precios: Object.fromEntries(Object.entries(p.precios).filter(([k]) => k !== i)) })),
  }))
  return (
    <div className="space-y-6">
      <p className="text-apagado">Botellas, garrafones, bolsas, piezas o a granel: agrega cada forma en que entregas, con su tamaño. Un mismo producto puede ir en varios.</p>
      <div className="flex flex-wrap gap-2">
        {ENVASES_COMUNES.map((e) => (
          <button key={e.nombre} type="button" onClick={() => agregar(e)} className={`flex items-center gap-1.5 rounded-full bg-niebla px-4 py-2.5 text-sm font-semibold hover:bg-linea ${anillo}`}>
            <Plus size={15} aria-hidden="true" /> {e.nombre}
          </button>
        ))}
        <button type="button" onClick={() => agregar({ nombre: '', contenido: 1, unidad: 'pieza', retornable: false })} className={`flex items-center gap-1.5 rounded-full border border-dashed border-apagado/50 px-4 py-2.5 text-sm font-semibold ${anillo}`}>
          <Plus size={15} aria-hidden="true" /> Otro
        </button>
      </div>

      {datos.envases.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-linea px-4 py-8 text-center text-apagado">Toca un envase de arriba para agregarlo.</p>
      ) : (
        <ul className="space-y-3">
          {datos.envases.map((e) => {
            const propia = !UNIDADES.includes(e.unidad as (typeof UNIDADES)[number])
            return (
              <li key={e.id} className="rounded-2xl bg-niebla p-4">
                <div className="grid grid-cols-[1fr_auto] gap-3 sm:grid-cols-[1.4fr_0.8fr_1fr_auto] sm:items-end">
                  <Campo etiqueta="Nombre">
                    <input value={e.nombre} onChange={(x) => editar(e.id, { nombre: x.target.value })} placeholder="Ej. Cubeta" maxLength={40} className={`${claseInput} bg-papel`} />
                  </Campo>
                  <button type="button" onClick={() => quitar(e.id)} aria-label={`Quitar ${e.nombre || 'envase'}`} className={`grid h-11 w-11 place-items-center self-end rounded-full text-apagado hover:bg-rojo/10 hover:text-rojo sm:order-last ${anillo}`}>
                    <Trash2 size={18} />
                  </button>
                  <Campo etiqueta="Contiene">
                    <input inputMode="decimal" value={Number.isNaN(e.contenido) ? '' : String(e.contenido)} onChange={(x) => editar(e.id, { contenido: numero(x.target.value) })} className={`${claseInput} bg-papel`} />
                  </Campo>
                  <Campo etiqueta="Unidad">
                    <select value={propia ? 'otra' : e.unidad} onChange={(x) => editar(e.id, { unidad: x.target.value === 'otra' ? '' : x.target.value })} className={`${claseInput} bg-papel`}>
                      {UNIDADES.map((u) => <option key={u} value={u}>{u === 'pieza' ? 'piezas' : u}</option>)}
                      <option value="otra">Otra…</option>
                    </select>
                  </Campo>
                </div>
                {propia && (
                  <input value={e.unidad} onChange={(x) => editar(e.id, { unidad: x.target.value })} placeholder="Unidad, ej. docena, rollo, metro" maxLength={20} className={`${claseInput} mt-3 bg-papel`} />
                )}
                {datos.controlRetornables && (
                  <div className="mt-3">
                    <Interruptor activo={e.retornable} onChange={(v) => editar(e.id, { retornable: v })} etiqueta="Retornable" ayuda="El cliente lo devuelve y se le lleva la cuenta" />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="rounded-2xl border border-linea p-4">
        <Interruptor
          activo={datos.controlRetornables}
          onChange={(v) => setDatos((d) => ({ ...d, controlRetornables: v }))}
          etiqueta="Llevo la cuenta de envases retornables"
          ayuda="Garrafones, cajas o frascos que el cliente devuelve. Puedes cambiarlo después."
        />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ 5. Productos

function Variantes({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  const [texto, setTexto] = useState('')
  const agregar = () => {
    const v = texto.trim()
    if (v && !valor.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...valor, v])
    setTexto('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {valor.map((v) => (
          <span key={v} className="flex items-center gap-1 rounded-full bg-papel py-1 pr-1 pl-3 text-sm font-medium">
            {v}
            <button type="button" onClick={() => onChange(valor.filter((x) => x !== v))} aria-label={`Quitar ${v}`} className={`grid h-6 w-6 place-items-center rounded-full hover:bg-niebla ${anillo}`}><X size={14} /></button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); agregar() } }}
          placeholder={valor.length ? 'Otra variante' : 'Ej. Fresa, Mango (opcional)'}
          maxLength={40}
          className={`${claseInput} bg-papel !py-2.5`}
        />
        <button type="button" onClick={agregar} className={`shrink-0 rounded-xl bg-papel px-4 text-sm font-semibold hover:bg-linea ${anillo}`}>Agregar</button>
      </div>
    </div>
  )
}

function PasoProductos({ datos, setDatos }: { datos: Datos; setDatos: SetDatos }) {
  const editar = (i: string, cambio: Partial<Producto>) => setDatos((d) => ({ ...d, productos: d.productos.map((p) => (p.id === i ? { ...p, ...cambio } : p)) }))
  const agregar = () => setDatos((d) => ({
    ...d,
    productos: [...d.productos, { id: id(), nombre: '', variantes: [], precios: Object.fromEntries(d.envases.map((e) => [e.id, { precio: '', costo: '' }])) }],
  }))
  return (
    <div className="space-y-5">
      <p className="text-apagado">Cada producto puede tener variantes (sabor, tamaño, color…) y un precio por envase. El costo es opcional, sirve para ver tu ganancia; tus repartidores nunca lo ven.</p>
      {datos.productos.map((p) => (
        <section key={p.id} className="rounded-2xl bg-niebla p-4" aria-label={p.nombre || 'Producto nuevo'}>
          <div className="flex items-end gap-3">
            <Campo etiqueta="Producto">
              <input value={p.nombre} onChange={(e) => editar(p.id, { nombre: e.target.value })} placeholder="Ej. Yogurt" maxLength={60} className={`${claseInput} bg-papel`} />
            </Campo>
            <button type="button" onClick={() => setDatos((d) => ({ ...d, productos: d.productos.filter((x) => x.id !== p.id) }))} aria-label={`Quitar ${p.nombre || 'producto'}`} className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-apagado hover:bg-rojo/10 hover:text-rojo ${anillo}`}>
              <Trash2 size={18} />
            </button>
          </div>
          <div className="mt-4">
            <span className="mb-1.5 block text-sm font-semibold text-apagado">Variantes</span>
            <Variantes valor={p.variantes} onChange={(v) => editar(p.id, { variantes: v })} />
          </div>
          <div className="mt-4">
            <span className="mb-1.5 block text-sm font-semibold text-apagado">Envases y precios</span>
            <ul className="space-y-2">
              {datos.envases.map((e) => {
                const pr = p.precios[e.id]
                return (
                  <li key={e.id} className={`rounded-xl px-3 py-2.5 ${pr ? 'bg-papel' : ''}`}>
                    <label className="flex cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!!pr}
                        onChange={(x) => {
                          const precios = { ...p.precios }
                          if (x.target.checked) precios[e.id] = { precio: '', costo: '' }
                          else delete precios[e.id]
                          editar(p.id, { precios })
                        }}
                        className="h-5 w-5"
                      />
                      <span className="font-semibold">{nombreEnvase(e)}</span>
                    </label>
                    {pr && (
                      <div className="mt-2 grid grid-cols-2 gap-2 pl-8">
                        <label className="text-xs font-semibold text-apagado">Precio
                          <span className="relative mt-1 block">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-apagado">$</span>
                            <input inputMode="decimal" value={pr.precio} onChange={(x) => editar(p.id, { precios: { ...p.precios, [e.id]: { ...pr, precio: x.target.value } } })} className={`${claseInput} !py-2.5 pl-7`} />
                          </span>
                        </label>
                        <label className="text-xs font-semibold text-apagado">Costo
                          <span className="relative mt-1 block">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-apagado">$</span>
                            <input inputMode="decimal" value={pr.costo} onChange={(x) => editar(p.id, { precios: { ...p.precios, [e.id]: { ...pr, costo: x.target.value } } })} placeholder="Opcional" className={`${claseInput} !py-2.5 pl-7`} />
                          </span>
                        </label>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      ))}
      <button type="button" onClick={agregar} className={`flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-apagado/50 py-4 font-semibold hover:bg-niebla ${anillo}`}>
        <Plus size={18} aria-hidden="true" /> Agregar producto
      </button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ 6. Marca

function PasoMarca({ datos, cambiar }: { datos: Datos; cambiar: Cambiar }) {
  const m = datos.marca
  const [aviso, setAviso] = useState('')
  function subir(f: File | undefined) {
    if (!f) return
    // Sólo imágenes de mapa de bits: un SVG puede llevar código.
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return setAviso('Usa una imagen PNG, JPG o WebP')
    if (f.size > 1_000_000) return setAviso('La imagen debe pesar menos de 1 MB')
    setAviso('')
    const r = new FileReader()
    r.onload = () => cambiar('marca', { logo: String(r.result) })
    r.readAsDataURL(f)
  }
  return (
    <div className="space-y-6">
      <Campo etiqueta="Nombre que verán tus clientes y repartidores">
        <input value={m.nombre} onChange={(e) => cambiar('marca', { nombre: e.target.value })} maxLength={60} className={claseInput} />
      </Campo>
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Logo (opcional)</span>
        <div className="flex items-center gap-4">
          <span className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-niebla">
            {m.logo ? <img src={m.logo} alt="Tu logo" className="h-full w-full object-contain" /> : <Upload size={22} className="text-apagado" aria-hidden="true" />}
          </span>
          <div className="flex flex-wrap gap-2">
            <label className={`cursor-pointer rounded-full bg-niebla px-4 py-2.5 text-sm font-semibold hover:bg-linea focus-within:outline-2 focus-within:outline-marca`}>
              {m.logo ? 'Cambiar' : 'Subir imagen'}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => subir(e.target.files?.[0])} className="sr-only" />
            </label>
            {m.logo && <button type="button" onClick={() => cambiar('marca', { logo: null })} className={`rounded-full px-4 py-2.5 text-sm font-semibold text-rojo hover:bg-rojo/10 ${anillo}`}>Quitar</button>}
          </div>
        </div>
        {aviso && <p role="alert" className="mt-2 text-sm font-medium text-rojo">{aviso}</p>}
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-apagado">Color principal</legend>
        <div className="flex flex-wrap items-center gap-2.5">
          {COLORES.map((c) => (
            <button key={c} type="button" onClick={() => cambiar('marca', { color: c })} aria-label={`Color ${c}`} aria-pressed={m.color === c}
              className={`grid h-11 w-11 place-items-center rounded-full ring-offset-2 ring-offset-papel ${m.color === c ? 'ring-2 ring-tinta' : ''} ${anillo}`} style={{ background: c, color: textoSobre(c) }}>
              {m.color === c && <Check size={18} aria-hidden="true" />}
            </button>
          ))}
          <label className="flex h-11 cursor-pointer items-center gap-2 rounded-full bg-niebla px-3 text-sm font-semibold">
            <input type="color" value={m.color} onChange={(e) => cambiar('marca', { color: e.target.value })} className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0" />
            Otro
          </label>
        </div>
      </fieldset>
      <div>
        <span className="mb-2 block text-sm font-semibold text-apagado">Así se verá</span>
        <div className="flex items-center gap-3 rounded-2xl bg-niebla p-4">
          {m.logo ? <img src={m.logo} alt="" className="h-10 w-10 rounded-xl object-contain" /> : <span className="grid h-10 w-10 place-items-center rounded-xl text-lg font-bold" style={{ background: m.color, color: textoSobre(m.color) }}>{(m.nombre || '?').charAt(0).toUpperCase()}</span>}
          <span className="min-w-0 flex-1 truncate font-semibold">{m.nombre || 'Tu negocio'}</span>
          <span className="rounded-full px-4 py-2 text-sm font-semibold" style={{ background: m.color, color: textoSobre(m.color) }}>Agendar pedido</span>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------ 7. Resumen

function Bloque({ titulo, onEditar, children }: { titulo: string; onEditar: () => void; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-niebla p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold" style={{ fontFamily: 'var(--font-sans)', letterSpacing: 'normal' }}>{titulo}</h2>
        <button type="button" onClick={onEditar} className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-papel ${anillo}`}><Pencil size={14} aria-hidden="true" /> Editar</button>
      </div>
      <div className="mt-2 text-sm text-apagado">{children}</div>
    </section>
  )
}

function PasoResumen({ datos, irA }: { datos: Datos; irA: (i: number) => void }) {
  const { negocio, cuenta, envases, productos, marca, controlRetornables } = datos
  const giro = negocio.giro === 'otro' ? negocio.giroOtro : GIROS.find((g) => g.valor === negocio.giro)?.texto
  const presentaciones = productos.reduce((s, p) => s + Object.keys(p.precios).length * Math.max(1, p.variantes.length), 0)
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_17rem]">
      <div className="space-y-3">
        <Bloque titulo="Negocio" onEditar={() => irA(0)}>
          <b className="text-tinta">{negocio.nombre}</b> · {giro} · {ZONAS.find((z) => z.valor === negocio.zona)?.texto.split(' (')[0]}
        </Bloque>
        <Bloque titulo="Administrador" onEditar={() => irA(1)}>{cuenta.nombre} · {cuenta.correo}</Bloque>
        <Bloque titulo={`Envases (${envases.length})`} onEditar={() => irA(3)}>
          {envases.map((e) => nombreEnvase(e) + (controlRetornables && e.retornable ? ' (retornable)' : '')).join(' · ')}
        </Bloque>
        <Bloque titulo={`Productos (${productos.length}) · ${presentaciones} presentaciones`} onEditar={() => irA(4)}>
          <ul className="space-y-1">
            {productos.map((p) => <li key={p.id}><b className="text-tinta">{p.nombre}</b>{p.variantes.length > 0 && ` · ${p.variantes.join(', ')}`}</li>)}
          </ul>
        </Bloque>
        <Bloque titulo="Marca" onEditar={() => irA(5)}>
          <span className="inline-flex items-center gap-2"><span className="h-4 w-4 rounded-full" style={{ background: marca.color }} /> {marca.nombre}{marca.logo ? ' · con logo' : ''}</span>
        </Bloque>
      </div>
      <VistaRepartidor datos={datos} />
    </div>
  )
}

// Cómo verá el repartidor el pedido: cada producto (y variante) con + / − por envase.
function VistaRepartidor({ datos }: { datos: Datos }) {
  const { productos, envases, marca } = datos
  const [cant, setCant] = useState<Record<string, number>>({})
  const filas = productos.flatMap((p) => (p.variantes.length ? p.variantes.map((v) => ({ clave: `${p.id}:${v}`, nombre: `${p.nombre} ${v.toLowerCase()}`, p })) : [{ clave: p.id, nombre: p.nombre, p }]))
  const total = filas.reduce((s, f) => s + envases.reduce((t, e) => t + (cant[`${f.clave}:${e.id}`] ?? 0) * (numero(f.p.precios[e.id]?.precio ?? '') || 0), 0), 0)
  const color = marca.color
  return (
    <figure aria-label="Vista previa para el repartidor" className="mx-auto w-full max-w-[17rem]">
      <figcaption className="mb-2 text-center text-sm font-semibold text-apagado">Así lo verá tu repartidor</figcaption>
      <div className="overflow-hidden rounded-[2rem] border-[6px] border-tinta bg-white text-[#111]">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          {marca.logo ? <img src={marca.logo} alt="" className="h-7 w-7 rounded-lg object-contain" /> : <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold" style={{ background: color, color: textoSobre(color) }}>{(marca.nombre || '?').charAt(0)}</span>}
          <span className="truncate text-sm font-semibold">Nuevo pedido</span>
        </div>
        <div className="max-h-[22rem] space-y-2 overflow-y-auto px-3 pb-3">
          {filas.map((f) => (
            <div key={f.clave} className="rounded-xl bg-[#f3f3f3] p-2.5">
              <p className="text-[13px] font-semibold">{f.nombre}</p>
              {envases.filter((e) => f.p.precios[e.id]).map((e) => {
                const k = `${f.clave}:${e.id}`
                const n = cant[k] ?? 0
                return (
                  <div key={e.id} className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{nombreEnvase(e)} · ${f.p.precios[e.id].precio}</span>
                    <button type="button" aria-label={`Quitar ${nombreEnvase(e)} de ${f.nombre}`} disabled={!n} onClick={() => setCant((c) => ({ ...c, [k]: n - 1 }))} className="grid h-7 w-7 place-items-center rounded-full bg-white disabled:opacity-40"><Minus size={13} /></button>
                    <span className="w-4 text-center font-semibold tabular-nums">{n}</span>
                    <button type="button" aria-label={`Agregar ${nombreEnvase(e)} de ${f.nombre}`} onClick={() => setCant((c) => ({ ...c, [k]: n + 1 }))} className="grid h-7 w-7 place-items-center rounded-full" style={{ background: color, color: textoSobre(color) }}><Plus size={13} /></button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-[#e2e2e2] p-3">
          <div className="rounded-full py-2.5 text-center text-sm font-semibold" style={{ background: color, color: textoSobre(color) }}>
            Agendar · ${total.toLocaleString('es-MX')}
          </div>
        </div>
      </div>
    </figure>
  )
}

// ------------------------------------------------------------------------------------------ Final

function Creada({ datos, onIrALogin, tituloRef }: { datos: Datos; onIrALogin: () => void; tituloRef: React.RefObject<HTMLHeadingElement | null> }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md rounded-[28px] border border-linea bg-papel p-8 text-center shadow-[0_16px_48px_rgba(0,32,20,0.06)]">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-limon"><Check size={30} aria-hidden="true" /></span>
        <h1 ref={tituloRef} tabIndex={-1} className="mt-5 text-[1.75rem] leading-tight font-semibold outline-none">¡{datos.negocio.nombre} está lista!</h1>
        <p className="mt-3 text-apagado">Así terminaría el registro. En la versión conectada aquí se crea la empresa con su catálogo y entras a tu panel para invitar a tus repartidores.</p>
        <button type="button" onClick={onIrALogin} className={`mt-6 w-full rounded-full bg-tinta py-4 font-semibold text-white hover:bg-marca-oscuro ${anillo}`}>Ir al inicio de sesión</button>
      </div>
    </div>
  )
}
