import { useEffect, useMemo, useState } from 'react'
import { COLOR_FONDO, usePreferenciasPanel } from '../../lib/tema'
import { coincide, limpiarBusqueda, propsBuscador } from '../../lib/busqueda'
import { useLiveQuery } from 'dexie-react-hooks'
import { verGuia } from '../../lib/guiaInicio'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Compass, MessageCircle, Search, Sparkles, X } from 'lucide-react'
import { db } from '../../lib/db'
import { elegirFondo, useSesion } from '../../lib/sesion'
import { useMarca } from '../../lib/marca'
import { useLogoEtiqueta } from '../admin/marca'
import { useSuscripcion } from '../../lib/suscripcion'
import { GUIAS, TEMAS, guiaInstalar, type Donde, type Guia, type Tema } from './guias'
import { Escena, type Valores } from './Escena'
import { NOVEDADES, type Novedad } from './novedades'
import { usePlataformaPublica } from '../../lib/plataforma'

// Ayuda: un manual corto que se adapta a quien lo abre. Muestra sólo lo que esa cuenta puede hacer (administrador o
// vendedor, panel o app de reparto), una lista «Para empezar» que se va palomeando con lo que el negocio ya tiene
// (sabores, clientes, pedidos…), la guía de instalar según el teléfono, y cada guía paso a paso con su captura de
// esqueleto. `ir` (panel) lleva a la sección de la guía.

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'

function sistema(): 'ios' | 'android' | 'otro' {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return /Android/.test(ua) ? 'android' : 'otro'
}
const instalada = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

const DESTINOS: Record<string, string> = { preferencias: 'Preferencias', resumen: 'Resumen', cuenta: 'Cuenta', seguridad: 'Seguridad', suscripcion: 'Suscripción', apariencia: 'Apariencia', clientes: 'Clientes', equipo: 'Vendedores', sabores: 'Sabores', produccion: 'Producción', cobranza: 'Finanzas', reportes: 'Reportes', marca: 'Marca' }

// Lo que las capturas dicen con los datos de este negocio (nombre, logo, cambios por enviar).
export function useValores(): Valores {
  const marca = useMarca()
  const logo = useLogoEtiqueta()
  const cola = useLiveQuery(() => db.cola.count(), [])
  return {
    empresa: marca?.nombre || 'Tu negocio',
    logo,
    pendientes: cola === undefined ? '' : cola ? `${cola} ${cola === 1 ? 'cambio' : 'cambios'} por enviar` : 'Nada pendiente por enviar',
  }
}

// Las guías que le tocan a esta cuenta aquí: por su papel, panel o app, y Suscripción sólo si la empresa paga.
export function useGuiasVisibles(donde: Donde) {
  const usuario = useSesion()?.usuario
  const rol = usuario?.rol ?? 'administrador' // sin servidor, quien usa la app es el dueño
  const suscripcion = useSuscripcion(donde === 'panel' ? usuario?.id : undefined) // null: la empresa no paga
  return useMemo(() => {
    const puede = (g: Guia) => g.para === 'todos' || g.para === rol
    const todas = [...GUIAS, guiaInstalar(sistema())]
    return todas.filter((g) => puede(g) && (donde === 'panel' || g.donde === 'app') && (g.id !== 'suscripcion' || !!suscripcion))
  }, [rol, donde, suscripcion])
}

export function Ayuda({ donde, ir }: { donde: Donde; ir?: (destino: string) => void }) {
  const rol = useSesion()?.usuario.rol ?? 'administrador'
  const [tema, setTema] = useState<Tema | null>(null)
  const marca = useMarca()
  const [q, setQ] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)

  const cuentas = useLiveQuery(async () => ({
    productos: await db.productos.count(),
    clientes: await db.clientes.count(),
    pedidos: await db.pedidos.count(),
    entregados: await db.pedidos.where('estado').equals('ENTREGADO').count(),
  }), [])

  const valores = useValores()
  const guias = useGuiasVisibles(donde)

  // Lo que ya está hecho en este negocio; cada renglón abre su guía.
  const ya = instalada()
  const pendientes: { id: string; texto: string; hecho: boolean }[] = !cuentas ? [] : donde === 'panel' && rol === 'administrador'
    ? [
        { id: 'marca', texto: 'Pon tu logo y tu color', hecho: !!(marca?.logo || marca?.color) },
        { id: 'sabor', texto: 'Agrega tus sabores', hecho: cuentas.productos > 0 },
        { id: 'cliente-panel', texto: 'Da de alta a tus clientes', hecho: cuentas.clientes > 0 },
        { id: 'pedido', texto: 'Toma el primer pedido', hecho: cuentas.pedidos > 0 },
        { id: 'entregar', texto: 'Entrega el primer pedido', hecho: cuentas.entregados > 0 },
      ]
    : [
        { id: 'instalar', texto: 'Instala la app en tu teléfono', hecho: ya },
        { id: 'cliente-app', texto: 'Da de alta un cliente', hecho: cuentas.clientes > 0 },
        { id: 'pedido', texto: 'Toma un pedido', hecho: cuentas.pedidos > 0 },
        { id: 'entregar', texto: 'Entrega tu primer pedido', hecho: cuentas.entregados > 0 },
      ]
  const hechos = pendientes.filter((p) => p.hecho).length

  const buscadas = useMemo(() => {
    const t = limpiarBusqueda(q)
    const delTema = tema ? guias.filter((g) => g.tema === tema) : guias
    if (!t) return delTema
    return delTema.filter((g) => coincide(t, g.titulo, g.resumen, g.palabras, ...g.pasos.map((x) => x.texto)))
  }, [guias, q, tema])
  const temas = TEMAS.filter((t) => guias.some((g) => g.tema === t.id))

  const guia = guias.find((g) => g.id === abierta)
  if (guia) return <Visor guia={guia} valores={valores} donde={donde} ir={ir} onVolver={() => setAbierta(null)} resumenExtra={guia.id === 'instalar' && ya ? 'Ya la tienes instalada en este teléfono.' : undefined} />

  const grupos: { titulo: string; lista: Guia[] }[] = donde === 'panel'
    ? [{ titulo: 'En el panel', lista: buscadas.filter((g) => g.donde === 'panel') }, { titulo: 'En la app de reparto', lista: buscadas.filter((g) => g.donde === 'app') }]
    : [{ titulo: 'Guías', lista: buscadas }]

  return (
    <div className="space-y-7">
      <button type="button" onClick={() => verGuia(donde)} className={`flex w-full items-center gap-3 rounded-lg bg-niebla p-4 text-left transition-colors hover:bg-linea/70 ${anillo}`}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-marca text-white"><Compass size={22} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Ver la guía otra vez</span>
          <span className="block text-xs text-apagado">El recorrido de bienvenida: para qué sirve cada parte, en un minuto.</span>
        </span>
        <ArrowRight size={18} className="shrink-0 text-apagado" aria-hidden="true" />
      </button>
      <label className="flex h-11 items-center gap-2 rounded-md bg-niebla px-3 focus-within:outline-2 focus-within:outline-marca">
        <Search size={18} className="shrink-0 text-apagado" aria-hidden="true" />
        <input {...propsBuscador} value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Qué quieres hacer? Ej. cliente, reporte, sin señal" aria-label="Buscar en la ayuda"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-apagado" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="Borrar búsqueda" className={`grid h-7 w-7 place-items-center rounded-full hover:bg-linea ${anillo}`}><X size={16} /></button>}
      </label>

      {/* Temas: se reparten en filas en la computadora y se desplazan de lado en el teléfono. */}
      <div role="group" aria-label="Temas" className="-mx-4 -mt-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {[{ id: null, texto: 'Todas' }, ...temas].map((t) => (
          <button key={t.id ?? 'todas'} type="button" onClick={() => setTema(t.id)} aria-pressed={tema === t.id}
            className={`h-9 shrink-0 rounded-md px-3.5 text-sm font-semibold transition-colors ${anillo} ${tema === t.id ? 'bg-tinta text-white' : 'bg-niebla hover:bg-linea'}`}>
            {t.texto}
          </button>
        ))}
      </div>

      {!q && !tema && <QueHayDeNuevo donde={donde} rol={rol} guias={guias} onAbrir={setAbierta} />}

      {!q && !tema && pendientes.length > 0 && hechos < pendientes.length && (
        <section aria-labelledby="para-empezar">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="para-empezar" className="text-base font-semibold">Para empezar</h3>
            <span className="text-sm text-apagado tabular-nums">{hechos} de {pendientes.length}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-niebla" role="progressbar" aria-valuemin={0} aria-valuemax={pendientes.length} aria-valuenow={hechos} aria-label="Avance">
            <div className="h-full rounded-full bg-marca transition-[width] duration-500" style={{ width: `${(hechos / pendientes.length) * 100}%` }} />
          </div>
          <ul className="mt-3 divide-y divide-linea">
            {pendientes.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setAbierta(p.id)} className={`flex w-full items-center gap-3 rounded-md py-3 text-left ${anillo}`}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${p.hecho ? 'bg-verde text-white' : 'border-2 border-linea'}`}>{p.hecho && <Check size={14} strokeWidth={3} aria-hidden="true" />}</span>
                  <span className={`min-w-0 flex-1 text-sm ${p.hecho ? 'text-apagado line-through' : 'font-semibold'}`}>{p.texto}<span className="sr-only">{p.hecho ? ' (hecho)' : ' (pendiente)'}</span></span>
                  <ChevronRight size={16} className="shrink-0 text-apagado" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {grupos.map(({ titulo, lista }) => lista.length > 0 && (
        <section key={titulo} aria-label={titulo}>
          {grupos.length > 1 && <h3 className="mb-3 text-base font-semibold">{titulo}</h3>}
          <ul className="grid border-b border-linea sm:grid-cols-2 sm:gap-x-8">
            {lista.map((g) => {
              const Icono = g.icono
              return (
                <li key={g.id}>
                  <button type="button" onClick={() => setAbierta(g.id)} className={`group flex h-full w-full items-start gap-3 border-t border-linea py-4 text-left transition-colors hover:bg-niebla/60 ${anillo}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-niebla"><Icono size={18} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{g.titulo}</span>
                      <span className="mt-0.5 block text-xs text-apagado">{g.resumen}</span>
                      <span className="mt-1.5 block text-xs font-semibold text-apagado">{g.pasos.length} {g.pasos.length === 1 ? 'paso' : 'pasos'}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {!q && tema && !buscadas.length && <p className="py-6 text-center text-sm text-apagado">No hay guías de este tema aquí.</p>}
      {q && !buscadas.length && <p className="py-6 text-center text-sm text-apagado">No hay guías sobre «{q.trim()}». Prueba con otra palabra, como «pedido» o «reporte».</p>}
    </div>
  )
}

// «¿Qué hay de nuevo?»: la última versión a la vista y las anteriores al pedirlas. Lo que esta persona no había visto en
// este dispositivo sale con «Nuevo»; al verlo, queda visto para la próxima.
const CLAVE_VISTO = 'delisy:novedades-vistas'
const leerVisto = () => { try { return localStorage.getItem(CLAVE_VISTO) ?? '' } catch { return '' } }
// En «¿Qué hay de nuevo?»: prueba el fondo blanco de un toque (o vuelve al crema si ya está en blanco). Se guarda en la
// cuenta como si se eligiera en Configuración.
function ProbarFondo() {
  const { fondo } = usePreferenciasPanel()
  const otro = fondo === 'blanco' ? 'crema' : 'blanco'
  return (
    <button type="button" onClick={() => void elegirFondo(otro).catch(() => {})} className={`inline-flex items-center gap-1.5 font-semibold text-tinta underline underline-offset-2 ${anillo}`}>
      <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border border-linea align-[-1px]" style={{ background: COLOR_FONDO[otro] }} />
      {fondo === 'blanco' ? 'Volver al crema' : 'Probar el fondo blanco'}
    </button>
  )
}

const novedadesPara = (rol: string, donde: Donde): Novedad[] => NOVEDADES
  .map((n) => ({ ...n, puntos: n.puntos.filter((p) => (!p.para || p.para === rol) && (!p.donde || p.donde === donde || donde === 'panel')) }))
  .filter((n) => n.puntos.length)

// Para el puntito junto a «Ayuda»: hay algo nuevo para esta persona que este dispositivo no ha visto.
export function useHayNovedades(donde: Donde) {
  const rol = useSesion()?.usuario.rol ?? 'administrador'
  const [visto, setVisto] = useState(leerVisto)
  useEffect(() => {
    const f = () => setVisto(leerVisto())
    addEventListener('delisy:novedades', f)
    addEventListener('storage', f)
    return () => { removeEventListener('delisy:novedades', f); removeEventListener('storage', f) }
  }, [])
  const ultima = novedadesPara(rol, donde)[0]
  return !!ultima && ultima.fecha > visto
}

function QueHayDeNuevo({ donde, rol, guias, onAbrir }: { donde: Donde; rol: string; guias: Guia[]; onAbrir: (id: string) => void }) {
  const [visto] = useState(leerVisto)
  const [todas, setTodas] = useState(false)
  const lista = novedadesPara(rol, donde)
  useEffect(() => {
    if (lista[0]) try { localStorage.setItem(CLAVE_VISTO, lista[0].fecha); dispatchEvent(new Event('delisy:novedades')) } catch { /* sin almacenamiento: vuelve a decir «Nuevo» */ }
  }, [lista[0]?.fecha]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!lista.length) return null
  const fecha = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
  return (
    <section aria-labelledby="novedades">
      <h3 id="novedades" className="flex items-center gap-2 text-base font-semibold"><Sparkles size={18} className="text-marca" aria-hidden="true" /> ¿Qué hay de nuevo?</h3>
      <div className="mt-2 divide-y divide-linea border-y border-linea">
        {(todas ? lista : lista.slice(0, 1)).map((n, i) => (
          <div key={n.fecha + n.titulo} className="py-3">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-semibold">{n.titulo}</span>
              <span className="text-xs text-apagado">{fecha(n.fecha)}</span>
              {n.fecha > visto && (visto || i === 0) && <span className="rounded-full bg-marca px-2 py-0.5 text-[11px] font-semibold text-white">Nuevo</span>}
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {n.puntos.map((p) => {
                const g = p.guia ? guias.find((x) => x.id === p.guia) : undefined
                return (
                  <li key={p.texto} className="flex gap-2 text-sm text-apagado">
                    <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-apagado" />
                    <span>{p.texto}{g && <> <button type="button" onClick={() => onAbrir(g.id)} className={`font-semibold text-tinta underline underline-offset-2 ${anillo}`}>Ver cómo</button></>}{p.probar === 'fondo' && <> <ProbarFondo /></>}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {lista.length > 1 && (
        <button type="button" onClick={() => setTodas(!todas)} aria-expanded={todas} className={`mt-2 py-1 text-sm font-semibold underline-offset-2 hover:underline ${anillo}`}>
          {todas ? 'Ver sólo lo último' : 'Ver lo de antes'}
        </button>
      )}
    </section>
  )
}

// El administrador le manda una guía de la app a su equipo: un enlace que la abre al entrar (?guia=, AyudaRapida.tsx).
function MandarGuia({ guia }: { guia: Guia }) {
  const rol = useSesion()?.usuario.rol
  if (rol !== 'administrador' || guia.para === 'administrador' || guia.donde !== 'app') return null
  const texto = `Mira esta guía de la app: «${guia.titulo}». ${location.origin}/?guia=${guia.id}`
  return (
    <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer"
      className={`mt-3 inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-2 hover:underline ${anillo}`}>
      <MessageCircle size={16} aria-hidden="true" /> Mandar esta guía por WhatsApp
    </a>
  )
}

// Al final de cada guía: ¿te sirvió? Si no, ofrece escribirle a soporte (el correo que pone la plataforma) con la guía
// ya nombrada. La respuesta se queda en este dispositivo para no volver a preguntar por la misma guía.
function TeSirvio({ guia }: { guia: Guia }) {
  const clave = `delisy:guia-sirvio:${guia.id}`
  const [voto, setVoto] = useState(() => { try { return localStorage.getItem(clave) } catch { return null } })
  const soporte = usePlataformaPublica()?.correoSoporte
  const votar = (v: 'si' | 'no') => { setVoto(v); try { localStorage.setItem(clave, v) } catch { /* sólo por esta vez */ } }
  if (voto === 'si') return <p className="mt-4 border-t border-linea pt-3 text-sm text-apagado">¡Qué bueno! Gracias por decirnos.</p>
  if (voto === 'no') return (
    <p className="mt-4 border-t border-linea pt-3 text-sm text-apagado">
      Gracias, la vamos a explicar mejor.
      {soporte && <> Si quieres, <a className={`font-semibold text-tinta underline underline-offset-2 ${anillo}`} href={`mailto:${soporte}?subject=${encodeURIComponent(`Ayuda: ${guia.titulo}`)}`}>cuéntanos qué faltó</a>.</>}
    </p>
  )
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-linea pt-3 text-sm">
      <span className="flex-1 text-apagado">¿Te sirvió esta guía?</span>
      <button type="button" onClick={() => votar('si')} className={`rounded-full bg-niebla px-3 py-1.5 font-semibold hover:bg-linea ${anillo}`}>Sí</button>
      <button type="button" onClick={() => votar('no')} className={`rounded-full bg-niebla px-3 py-1.5 font-semibold hover:bg-linea ${anillo}`}>No mucho</button>
    </div>
  )
}

// `compacto`: en la hoja del «?», una sola columna aunque la pantalla sea grande. `volver` cambia el texto de regreso.
export function Visor({ guia, valores, donde, ir, onVolver, resumenExtra, compacto = false, volver = 'Todas las guías' }: { guia: Guia; valores: Valores; donde: Donde; ir?: (d: string) => void; onVolver: () => void; resumenExtra?: string; compacto?: boolean; volver?: string }) {
  const [paso, setPaso] = useState(0)
  const total = guia.pasos.length
  const actual = guia.pasos[paso]
  const destino = donde === 'panel' && ir && guia.ir ? guia.ir : null
  const ancho = donde === 'panel' && !compacto

  // Con las flechas del teclado también se avanza (fuera de los campos de texto).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'ArrowRight') setPaso((p) => Math.min(p + 1, total - 1))
      if (e.key === 'ArrowLeft') setPaso((p) => Math.max(p - 1, 0))
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [total])

  const boton = `flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:opacity-40 ${anillo}`
  return (
    <div>
      <button type="button" onClick={onVolver} className={`-ml-1 mb-4 flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-semibold text-apagado hover:text-tinta ${anillo}`}>
        <ArrowLeft size={16} aria-hidden="true" /> {volver}
      </button>
      <h3 className="text-2xl font-semibold leading-tight">{guia.titulo}</h3>
      <p className="mt-1 text-sm text-apagado">{resumenExtra ?? guia.resumen}</p>

      <div className={`mt-6 grid gap-6 ${ancho ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-start' : ''}`}>
        {/* La lista de pasos sólo en la computadora; en pantalla chica va el paso actual sobre su captura. */}
        <ol className={`min-w-0 space-y-1 ${ancho ? 'hidden lg:order-1 lg:block' : 'hidden'}`}>
          {guia.pasos.map((p, i) => (
            <li key={i}>
              <button type="button" onClick={() => setPaso(i)} aria-current={i === paso ? 'step' : undefined}
                className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors ${anillo} ${i === paso ? 'bg-niebla' : 'hover:bg-niebla/60'}`}>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums ${i === paso ? 'bg-tinta text-white' : i < paso ? 'bg-verde text-white' : 'bg-linea'}`}>
                  {i < paso ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : i + 1}
                </span>
                <span className={`pt-0.5 text-sm ${i === paso ? 'font-semibold' : 'text-apagado'}`}>{p.texto}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className={`min-w-0 ${ancho ? 'order-1 lg:order-2 lg:sticky lg:top-2' : 'order-1'}`}>
          <p className={`mb-4 min-h-[2.75rem] text-[15px] font-semibold leading-snug ${ancho ? 'lg:hidden' : ''}`}>
            <span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-tinta align-[1px] text-xs text-white tabular-nums">{paso + 1}</span>
            {actual.texto}
          </p>
          <div key={paso} className="ayuda-entrar">
            <Escena escena={actual.escena} valores={valores} />
          </div>
          <p className="sr-only" aria-live="polite">Paso {paso + 1} de {total}: {actual.texto}</p>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => setPaso(paso - 1)} disabled={paso === 0} aria-label="Paso anterior" className={`${boton} w-10 px-0 bg-niebla hover:bg-linea`}><ArrowLeft size={18} /></button>
            <span className="flex flex-1 justify-center gap-1.5" aria-hidden="true">
              {guia.pasos.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === paso ? 'w-5 bg-tinta' : 'w-1.5 bg-linea'}`} />)}
            </span>
            {paso < total - 1 ? (
              <button type="button" onClick={() => setPaso(paso + 1)} className={`${boton} bg-tinta text-white hover:bg-marca-oscuro`}>Siguiente <ArrowRight size={18} aria-hidden="true" /></button>
            ) : destino ? (
              <button type="button" onClick={() => ir!(destino)} className={`${boton} bg-tinta text-white hover:bg-marca-oscuro`}>Ir a {DESTINOS[destino] ?? destino} <ArrowRight size={18} aria-hidden="true" /></button>
            ) : (
              <button type="button" onClick={onVolver} className={`${boton} bg-tinta text-white hover:bg-marca-oscuro`}><Check size={18} aria-hidden="true" /> Entendido</button>
            )}
          </div>
          {paso === total - 1 && <TeSirvio guia={guia} />}
          <MandarGuia guia={guia} />
        </div>
      </div>
    </div>
  )
}
