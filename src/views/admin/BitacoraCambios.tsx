import { useEffect, useMemo, useState } from 'react'
import { EsqueletoLista, Ocupado } from '../../components/Esqueleto'
import { llamarAutenticado } from '../../lib/sesion'
import { hace } from '../../lib/fechas'
import { botonPanel, botonPanelSuave, grupoPanel } from './piezas'

// Bitácora de cambios (Configuración → Bitácora, sólo administradores): quién cambió qué en la empresa, contado en
// palabras por el servidor (api/_lib/bitacoraCambios.ts) con un nivel según cuánta atención pide. Se lee de 40 en 40.

type Nivel = 'leve' | 'moderado' | 'alto'
interface Evento { id: string; en: string; nivel: Nivel; area: string; texto: string; quien: { id: string | null; nombre: string }; veces: number }

const NIVEL: Record<Nivel, { texto: string; punto: string; letra: string; peso: number }> = {
  alto: { texto: 'Alto', punto: 'bg-rojo', letra: 'text-rojo', peso: 2 },
  moderado: { texto: 'Moderado', punto: 'bg-ambar', letra: 'text-[var(--chip-pendiente-texto)]', peso: 1 },
  leve: { texto: 'Leve', punto: 'bg-verde', letra: 'text-apagado', peso: 0 },
}
const FILTROS: { clave: Nivel | 'todos'; texto: string }[] = [
  { clave: 'todos', texto: 'Todos' }, { clave: 'alto', texto: 'Alto' }, { clave: 'moderado', texto: 'Moderado' }, { clave: 'leve', texto: 'Leve' },
]
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function BitacoraCambios() {
  const [nivel, setNivel] = useState<Nivel | 'todos'>('todos')
  const [orden, setOrden] = useState<'recientes' | 'atencion'>('recientes')
  const [eventos, setEventos] = useState<Evento[] | null>(null)
  const [siguiente, setSiguiente] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cargar(desde: string | null) {
    setCargando(true)
    setError(null)
    try {
      const q = new URLSearchParams()
      if (desde) q.set('antes', desde)
      if (nivel !== 'todos') q.set('nivel', nivel)
      const r = await llamarAutenticado<{ eventos: Evento[]; siguiente: string | null }>(`/bitacora${q.toString() ? `?${q}` : ''}`)
      setEventos((antes) => (desde && antes ? [...antes, ...r.eventos] : r.eventos))
      setSiguiente(r.siguiente)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la bitácora')
    } finally {
      setCargando(false)
    }
  }
  useEffect(() => { setEventos(null); void cargar(null) }, [nivel])

  const lista = useMemo(() => {
    if (!eventos) return null
    return orden === 'recientes' ? eventos : [...eventos].sort((a, b) => NIVEL[b.nivel].peso - NIVEL[a.nivel].peso || b.en.localeCompare(a.en))
  }, [eventos, orden])
  const cuenta = (n: Nivel) => eventos?.filter((e) => e.nivel === n).length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className={grupoPanel} role="group" aria-label="Nivel">
          {FILTROS.map((f) => (
            <button key={f.clave} type="button" onClick={() => setNivel(f.clave)} aria-pressed={nivel === f.clave} className={nivel === f.clave ? botonPanel : botonPanelSuave}>{f.texto}</button>
          ))}
        </div>
        {nivel === 'todos' && (
          <div className={grupoPanel} role="group" aria-label="Orden">
            <button type="button" onClick={() => setOrden('recientes')} aria-pressed={orden === 'recientes'} className={orden === 'recientes' ? botonPanel : botonPanelSuave}>Lo más reciente</button>
            <button type="button" onClick={() => setOrden('atencion')} aria-pressed={orden === 'atencion'} className={orden === 'atencion' ? botonPanel : botonPanelSuave}>Lo más serio primero</button>
          </div>
        )}
      </div>

      {nivel === 'todos' && eventos && eventos.length > 0 && (
        <p className="text-sm text-apagado" aria-live="polite">
          En lo que ves: {(['alto', 'moderado', 'leve'] as Nivel[]).map((n, i) => (
            <span key={n}>{i > 0 && ' · '}<b className={`font-semibold tabular-nums ${NIVEL[n].letra}`}>{cuenta(n)}</b> {n === 'alto' ? (cuenta(n) === 1 ? 'alto' : 'altos') : n === 'moderado' ? (cuenta(n) === 1 ? 'moderado' : 'moderados') : (cuenta(n) === 1 ? 'leve' : 'leves')}</span>
          ))}
        </p>
      )}

      {error && <p className="text-sm font-semibold text-rojo">{error}</p>}
      {!lista && !error && <EsqueletoLista filas={6} etiqueta="Leyendo la bitácora" />}
      {lista && lista.length === 0 && (
        <p className="py-6 text-sm text-apagado">{nivel === 'todos' ? 'Todavía no hay cambios registrados.' : `No hay cambios de nivel ${NIVEL[nivel].texto.toLowerCase()}.`}</p>
      )}
      {lista && lista.length > 0 && (
        <ol className={`divide-y divide-linea border-y border-linea transition-opacity ${cargando && !siguiente ? 'opacity-60' : ''}`}>
          {lista.map((e) => (
            <li key={e.id} className="flex gap-3 py-3">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${NIVEL[e.nivel].punto}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className={`mr-2 text-xs font-semibold uppercase tracking-wide ${NIVEL[e.nivel].letra}`}>{NIVEL[e.nivel].texto}</span>
                  {e.texto}
                </p>
                <p className="mt-0.5 text-xs text-apagado">
                  <span className="font-semibold text-tinta/80">{e.quien.nombre}</span> · <time dateTime={e.en} title={new Date(e.en).toLocaleString('es-MX')}>{fechaHora(e.en)}</time> · {hace(new Date(e.en).getTime())}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {lista && siguiente && (
        <button type="button" onClick={() => cargar(siguiente)} disabled={cargando} className={botonPanelSuave}>
          {cargando ? <Ocupado texto="Leyendo…" /> : 'Ver más'}
        </button>
      )}
    </div>
  )
}
