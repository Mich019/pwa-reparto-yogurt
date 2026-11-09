import { useEffect, useMemo, useState } from 'react'
import { Selector } from '../../components/Selector'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRightLeft, BellOff, BellRing, Check, Crown, Flame, Target, Trophy, ChevronRight, Copy, KeyRound, Mail, MessageCircle, Pencil, Search, Share2, ShieldCheck, TriangleAlert, UserCheck, UserPlus, UserX } from 'lucide-react'
import { ErrorApi, ErrorRed } from '../../lib/api'
import { db, type Cliente } from '../../lib/db'
import {
  avisoDePrueba, cargarEquipo, crearMiembro, metaParaTodos, ventasMesPasado, metasCumplidas, darDeBaja, editarMiembro, invitar, reactivar, reasignarClientes, restablecerPassword, textoReasignado, useEquipo,
  type Miembro, type Rachas, type Trofeos,
} from '../../lib/equipo'
import { useServidor } from '../../lib/cobranza'
import { hace } from '../../lib/fechas'
import { copiarDelicado } from '../../lib/portapapeles'
import { useSesion, type Rol } from '../../lib/sesion'
import { Avatar } from '../../components/Avatar'
import { Medallas } from '../../components/Medallas'
import { HistorialMetas } from '../../components/HistorialMetas'
import { usePaginas } from '../../components/Paginas'
import { Accion, Boton, Campo, Hoja, Segmentado, aviso, claseInput, telLimpio } from '../../components/ui'
import { BuscadorDesplegable, Encabezado, Separador, botonPanel, botonPanelSuave, grupoPanel } from '../admin/piezas'

// M07 · Alta y baja de vendedores y reasignación de clientes (RF-038 a RF-041). Sólo para el administrador.

const ROL_TEXTO: Record<Rol, string> = { administrador: 'Administrador', vendedor: 'Vendedor' }
const SIN_VENDEDOR = 'sin' // en los selectores, "ningún vendedor"
// Los mensajes para elegir en «Felicitar por WhatsApp» de la ficha (el administrador puede cambiarlo antes de mandarlo).
function textosFelicitar(nombre: string, racha: number, mejorRacha: number) {
  const primero = nombre.split(' ')[0]
  const medalla = [12, 6, 3].find((n) => mejorRacha >= n)
  const textoMedalla = medalla ? `la medalla de ${medalla === 12 ? 'un año' : `${medalla} meses`}` : ''
  const logro = racha >= 2 ? `${racha} meses seguidos llegando a tu meta` : `${textoMedalla} seguidos en tu meta`
  return [
    racha >= 2
      ? `¡Felicidades, ${primero}! Llevas ${logro}${medalla && racha >= medalla ? ` y ya tienes ${textoMedalla}` : ''}. ¡Sigue así!`
      : `¡Felicidades, ${primero}! Ganaste ${logro}. ¡Vamos por más!`,
    `${primero}, qué orgullo: ${racha >= 2 ? `ya van ${racha} meses seguidos en tu meta` : `te ganaste ${textoMedalla}`}. Gracias por tu esfuerzo de todos los días.`,
    `¡Eres un ejemplo para el equipo, ${primero}! ${racha >= 2 ? `${racha} meses seguidos` : textoMedalla.charAt(0).toUpperCase() + textoMedalla.slice(1)}. ¡Por muchos más!`,
  ]
}
const dineroCorto = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const mensaje = (e: unknown) => (e instanceof ErrorApi || e instanceof ErrorRed ? e.message : 'No se pudo completar. Intenta de nuevo.')
const bloqueada = (m: Miembro) => !!m.bloqueadoHasta && new Date(m.bloqueadoHasta) > new Date()

// Los que cada quien puede apagar en Preferencias (api/_lib/notificaciones.ts, AVISOS_ELEGIBLES).
const NOMBRE_AVISO: Record<string, string> = {
  stock_asignado: 'carga del día', ruta_modificada: 'cambios de ruta', corte_entregado: 'cortes por confirmar',
  corte_descuadrado: 'cortes que no cuadran', prueba_por_vencer: 'prueba por vencer', urgente_sin_atender: 'urgentes sin atender', meta_atrasada: 'metas atrasadas', meta_alcanzada: 'meta alcanzada', vendedor_en_meta: 'vendedores en meta', racha_en_riesgo: 'racha en riesgo', medalla_ganada: 'medallas', record_personal: 'récords', produccion_pendiente: 'producción pendiente',
}
function textoAvisos(m: Miembro) {
  const donde = m.dispositivosPush ? `Activados en ${plural(m.dispositivosPush, 'dispositivo', 'dispositivos')}` : 'No los activó: se entera al abrir la app'
  const apagados = m.avisosApagados.map((t) => NOMBRE_AVISO[t]).filter(Boolean)
  return apagados.length ? `${donde}. Apagó: ${apagados.join(', ')}` : donde
}

function Etiqueta({ m }: { m: Miembro }) {
  const [texto, clase] = !m.activo ? ['De baja', 'bg-rojo/10 text-rojo']
    : bloqueada(m) ? ['Bloqueada', 'bg-ambar/30 text-tinta']
    : m.debeCambiarPassword ? ['Clave temporal', 'bg-azul/10 text-azul']
    : ['', '']
  return texto ? <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ${clase}`}>{texto}</span> : null
}

// `/admin?ir=equipo&persona=<id>` (aviso de meta atrasada): abre Vendedores con la ficha de esa persona. `abrirFicha`
// hace lo mismo desde el panel (tarjeta de medallas del inicio): se llama justo antes de ir a Vendedores.
const pedido = new URLSearchParams(location.search)
let personaPedida = pedido.get('ir') === 'equipo' && /^[0-9a-f-]{36}$/.test(pedido.get('persona') ?? '') ? pedido.get('persona') : null
export function abrirFicha(id: string) {
  personaPedida = id
}
export function irAEquipo() {
  if (pedido.get('ir') !== 'equipo') return false
  history.replaceState(history.state, '', location.pathname + location.hash) // que al recargar no vuelva a saltar
  pedido.delete('ir')
  return true
}

// `panel`: dentro del panel web, con el encabezado y el ancho de las demás secciones y la lista en dos columnas.
export function Equipo({ panel = false }: { panel?: boolean } = {}) {
  const yo = useSesion()?.usuario
  const equipo = useEquipo()
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [fichaId, setFichaId] = useState<string | null>(() => { const p = personaPedida; personaPedida = null; return p })
  const [form, setForm] = useState<Miembro | 'nuevo' | null>(null)
  const [clave, setClave] = useState<DatosClave | null>(null)
  const [cartera, setCartera] = useState<{ desde: string } | null>(null)
  const [invitando, setInvitando] = useState(false)
  const [q, setQ] = useState('')
  const [verBaja, setVerBaja] = useState(false)
  const [metaTodos, setMetaTodos] = useState(false)
  const [fama, setFama] = useState(false)

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
  // Panel: como Clientes, busca por nombre o correo y muestra una lista a la vez (activas o dadas de baja).
  const t = q.trim().toLowerCase()
  const lista = (verBaja ? deBaja : activos).filter((m) => !t || `${m.nombre} ${m.correo}`.toLowerCase().includes(t))
  const vista = usePaginas(panel ? lista : activos, 30, `${t}|${verBaja}`)

  const fila =(m: Miembro) => (
    <button key={m.id} onClick={() => setFichaId(m.id)} className="flex w-full items-center gap-3 border-b border-linea py-3.5 text-left transition-colors hover:bg-niebla/40 active:bg-niebla">
      <Avatar nombre={m.nombre} foto={m.foto} className={`h-12 w-12 text-lg bg-niebla ${m.activo ? '' : 'text-apagado opacity-60'}`} />
      <div className="min-w-0 flex-1">
        <div className={`truncate text-base leading-5 font-semibold ${m.activo ? '' : 'text-apagado'}`}>
          {m.nombre}{m.id === yo?.id && <span className="font-medium text-apagado"> (tú)</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1 truncate text-sm text-apagado">
          {m.rol === 'administrador' && <ShieldCheck size={14} className="shrink-0" />}
          {m.rol === 'administrador' ? ROL_TEXTO.administrador : plural(m.clientes, 'cliente', 'clientes')}
          {panel && <span className="truncate"> · {m.correo}</span>}
        </div>
      </div>
      {m.activo && m.rol === 'vendedor' && !m.dispositivosPush && (
        <span title="No tiene los avisos activados en su teléfono" className="shrink-0 text-apagado"><BellOff size={16} aria-label="Sin avisos en el teléfono" /></span>
      )}
      <Etiqueta m={m} />
      <ChevronRight size={18} className="shrink-0 text-apagado/60" />
    </button>
  )

  const botones = (
    <>
      <button onClick={() => setInvitando(true)} className={panel ? `${botonPanelSuave} max-sm:grow` : 'flex items-center gap-2 rounded-md bg-niebla px-4 py-2.5 text-sm font-semibold active:bg-linea'}>
        <Mail size={18} /> Invitar
      </button>
      <button onClick={() => setMetaTodos(true)} className={panel ? `${botonPanelSuave} max-sm:grow` : 'flex items-center gap-2 rounded-md bg-niebla px-4 py-2.5 text-sm font-semibold active:bg-linea'}>
        <Target size={18} /> Meta para todos
      </button>
      <button onClick={() => setFama(true)} className={panel ? `${botonPanelSuave} max-sm:grow` : 'flex items-center gap-2 rounded-md bg-niebla px-4 py-2.5 text-sm font-semibold active:bg-linea'}>
        <Crown size={18} /> Salón de la fama
      </button>
      <button onClick={() => setForm('nuevo')} className={panel ? `${botonPanel} max-sm:grow` : 'flex items-center gap-2 rounded-md bg-tinta px-4 py-2.5 text-sm font-semibold text-white active:bg-neutral-700'}>
        <UserPlus size={18} /> Nueva cuenta
      </button>
    </>
  )
  const columnas = panel ? 'grid gap-x-10 lg:grid-cols-2' : ''

  return (
    <div className={panel ? 'mx-auto max-w-[1280px] px-4 pt-2 sm:px-8' : 'flex h-full flex-col'}>
      {panel ? (
        <Encabezado titulo="Equipo" detalle={equipo ? `${plural(activos.length, 'cuenta activa', 'cuentas activas')}${deBaja.length ? ` · ${plural(deBaja.length, 'dada de baja', 'dadas de baja')}` : ''}` : 'Cargando…'}>
          <BuscadorDesplegable valor={q} onChange={setQ} placeholder="Buscar persona" />
          <div className={grupoPanel} role="group" aria-label="Mostrar">
            <button onClick={() => setVerBaja(false)} aria-pressed={!verBaja} className={verBaja ? botonPanelSuave : botonPanel}>Activas</button>
            <button onClick={() => setVerBaja(true)} aria-pressed={verBaja} className={verBaja ? botonPanel : botonPanelSuave}>Dadas de baja</button>
          </div>
          <Separador />
          {botones}
        </Encabezado>
      ) : (
        <div className="px-4 pt-safe">
          <div className="mt-3 flex items-center justify-between gap-2">
            <h1 className="text-3xl font-bold tracking-tight">Equipo</h1>
            <div className="flex gap-2">{botones}</div>
          </div>
        </div>
      )}

      <div className={panel ? '' : 'flex-1 overflow-y-auto px-4 pt-2 pb-28'}>
        {error && (
          <div className="mt-3 rounded-lg bg-rojo/10 p-4">
            <p role="alert" className="text-sm font-medium text-rojo">{error}</p>
            <Boton variante="secundario" className="mt-3 w-full bg-white" onClick={() => void cargar()} disabled={cargando}>{cargando ? 'Cargando…' : 'Reintentar'}</Boton>
          </div>
        )}
        {!equipo && !error && <div className="py-12 text-center text-apagado">Cargando equipo…</div>}

        {equipo && equipo.clientesSinAsignar > 0 && (
          <button onClick={() => setCartera({ desde: SIN_VENDEDOR })} className="mt-3 flex w-full items-center gap-3 rounded-lg bg-ambar/20 p-4 text-left">
            <TriangleAlert size={22} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{plural(equipo.clientesSinAsignar, 'cliente sin vendedor', 'clientes sin vendedor')}</div>
              <div className="text-sm text-apagado">Sólo tú los ves. Toca para asignarlos.</div>
            </div>
            <ChevronRight size={18} className="shrink-0 text-apagado/60" />
          </button>
        )}

        {panel ? (
          <div ref={vista.ancla} className={`${columnas} scroll-mt-4`}>
            {equipo && vista.visibles.map(fila)}
            {equipo && !lista.length && (
              <div className="py-12 text-center text-apagado lg:col-span-2">{t ? 'Sin resultados' : verBaja ? 'Nadie dado de baja.' : 'Todavía no hay cuentas activas.'}</div>
            )}
            {vista.control}
          </div>
        ) : <div ref={vista.ancla} className="scroll-mt-4">{vista.visibles.map(fila)}{vista.control}</div>}

        {!panel && deBaja.length > 0 && (
          <>
            <div className="mt-5 mb-1 text-sm font-semibold text-apagado">Dados de baja</div>
            <div className={columnas}>{deBaja.map(fila)}</div>
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
      {fama && <SalonDeLaFama onCerrar={() => setFama(false)} onAbrir={(id) => { setFama(false); setFichaId(id) }} />}
      {metaTodos && <MetaParaTodos vendedores={activos.filter((u) => u.rol === 'vendedor')} onCerrar={() => setMetaTodos(false)} />}
      {invitando && <Invitar onCerrar={() => setInvitando(false)} />}
      {cartera && equipo && <ReasignarCartera equipo={equipo.usuarios} sinAsignar={equipo.clientesSinAsignar} desdeInicial={cartera.desde} onCerrar={() => setCartera(null)} />}
    </div>
  )
}

// Invitar por correo: la persona crea su propia contraseña con el enlace y entra como vendedor.
function Invitar({ onCerrar }: { onCerrar: () => void }) {
  const [correo, setCorreo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  async function enviar() {
    setEnviando(true)
    setError('')
    try {
      const r = await invitar(correo.trim())
      aviso(`Invitación enviada a ${r.correo}`)
      onCerrar()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Invitar a un vendedor"
      pie={<Boton className="w-full" onClick={() => void enviar()} disabled={enviando || !correo.trim()}>{enviando ? 'Enviando…' : 'Enviar invitación'}</Boton>}>
      <p className="mb-3 text-sm text-apagado">Le llega un enlace por correo para crear su propia contraseña. Su cuenta aparece aquí cuando lo acepte; el enlace vence en 7 días.</p>
      <Campo etiqueta="Correo">
        <input className={claseInput} type="email" autoComplete="off" value={correo} onChange={(e) => setCorreo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && correo.trim() && void enviar()} placeholder="correo@ejemplo.com" />
      </Campo>
      {error && <p role="alert" className="mt-2 text-sm font-medium text-rojo">{error}</p>}
    </Hoja>
  )
}

// ------------------------------------------------------------------ la misma meta para todos los vendedores
// Las mejores rachas de todos los tiempos (de las fotos de los cierres de mes, también de quienes ya se fueron): la mejor
// racha manda, luego cuántos meses cumplió en total. Tocar a alguien que sigue en el equipo abre su ficha.
function SalonDeLaFama({ onCerrar, onAbrir }: { onCerrar: () => void; onAbrir: (id: string) => void }) {
  const r = useServidor<Rachas>('/usuarios/rachas', 'cobranza')
  const usuarios = useEquipo()?.usuarios ?? []
  const lista = Object.entries(r.datos ?? {})
    .map(([id, v]) => ({ id, ...v, actual: usuarios.find((u) => u.id === id) }))
    .sort((a, b) => b.mejorRacha - a.mejorRacha || b.cumplidos - a.cumplidos || a.nombre.localeCompare(b.nombre))
    .slice(0, 10)
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Salón de la fama">
      <p className="mb-3 text-sm text-apagado">Las mejores rachas de meses seguidos llegando a la meta, de todos los meses cerrados.</p>
      {r.error && !r.datos ? <p className="text-sm text-rojo">{r.error}</p>
        : !r.datos ? <p className="text-sm text-apagado">Cargando…</p>
        : !lista.length ? <p className="border-t border-linea pt-4 text-sm text-apagado">Todavía nadie llega a su meta en un mes cerrado. Al cerrar el primero aparecen aquí.</p>
        : (
          <ol className="space-y-1.5">
            {lista.map((v, i) => {
              const fila = (
                <>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums ${i === 0 ? 'bg-ambar/50 text-tinta' : i < 3 ? 'bg-marca/15 text-tinta' : 'bg-papel text-apagado'}`}>
                    {i === 0 ? <Crown size={16} aria-label="Primer lugar" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{v.nombre}</span>
                      <Medallas mejorRacha={v.mejorRacha} soloMejor />
                      {v.actual && !v.actual.activo && <span className="shrink-0 text-xs text-apagado">(de baja)</span>}
                      {!v.actual && <span className="shrink-0 text-xs text-apagado">(ya no está)</span>}
                    </span>
                    <span className="block text-xs text-apagado">
                      {plural(v.cumplidos, 'meta cumplida', 'metas cumplidas')}{v.racha >= 2 ? ` · lleva ${v.racha} seguidos ahora` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-lg font-bold tabular-nums leading-none">{v.mejorRacha}</span>
                    <span className="text-xs text-apagado">{v.mejorRacha === 1 ? 'mes' : 'seguidos'}</span>
                  </span>
                </>
              )
              const clase = 'desplegar-opcion flex w-full items-center gap-3 rounded-lg bg-niebla px-3 py-2.5 text-left'
              return (
                <li key={v.id} style={i < 10 ? { animationDelay: `${i * 30}ms` } : undefined}>
                  {v.actual
                    ? <button type="button" onClick={() => onAbrir(v.id)} className={`${clase} transition-[transform,background-color] duration-150 hover:bg-linea active:scale-[0.985] motion-reduce:active:scale-100`}>{fila}</button>
                    : <div className={clase}>{fila}</div>}
                </li>
              )
            })}
          </ol>
        )}
    </Hoja>
  )
}

function MetaParaTodos({ vendedores, onCerrar }: { vendedores: Miembro[]; onCerrar: () => void }) {
  const metas = [...new Set(vendedores.map((v) => v.metaMensual))]
  const [modo, setModo] = useState<'monto' | 'pct'>('monto')
  const [monto, setMonto] = useState(metas.length === 1 && metas[0] ? String(metas[0]) : '')
  const [pct, setPct] = useState('10')
  const [guardando, setGuardando] = useState(false)
  // Vista previa: cómo quedaría la meta de cada uno (como en el servidor: lo del mes pasado más el %, redondeado).
  const [ventas, setVentas] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (modo !== 'pct' || ventas) return
    let vigente = true
    ventasMesPasado().then((v) => { if (vigente) setVentas(v) }).catch(() => {})
    return () => { vigente = false }
  }, [modo, ventas])
  const valor = Number(monto)
  const porcentaje = Number(pct)
  const valido = modo === 'monto'
    ? monto.trim() !== '' && Number.isFinite(valor) && valor > 0
    : pct.trim() !== '' && Number.isInteger(porcentaje) && porcentaje >= -50 && porcentaje <= 300
  const enviar = () => void (modo === 'monto' ? aplicar(valor) : aplicarPct())
  async function aplicarPct() {
    setGuardando(true)
    try {
      const r = await metaParaTodos({ pctMesAnterior: porcentaje })
      aviso(`Meta nueva para ${plural(r.actualizados, 'vendedor', 'vendedores')}${r.sinVentas ? `; ${plural(r.sinVentas, 'no vendió', 'no vendieron')} el mes pasado y se ${r.sinVentas === 1 ? 'queda' : 'quedan'} con la suya` : ''}`)
      onCerrar()
    } catch (e) {
      aviso(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }
  async function aplicar(meta: number | null) {
    setGuardando(true)
    try {
      const n = (await metaParaTodos({ metaMensual: meta })).actualizados
      aviso(meta ? `Meta de $${meta.toLocaleString('es-MX')} para ${plural(n, 'vendedor', 'vendedores')}` : `Se quitó la meta a ${plural(n, 'vendedor', 'vendedores')}`)
      onCerrar()
    } catch (e) {
      aviso(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Meta para todos"
      pie={<Boton className="w-full" onClick={enviar} disabled={guardando || !valido || !vendedores.length}>{guardando ? 'Guardando…' : `Poner a ${plural(vendedores.length, 'vendedor', 'vendedores')}`}</Boton>}>
      <Segmentado className="mb-3" valor={modo} onChange={setModo}
        opciones={[{ valor: 'monto', texto: 'La misma para todos' }, { valor: 'pct', texto: 'Según su mes pasado' }]} />
      <p className="mb-3 text-sm text-apagado">
        {modo === 'monto'
          ? `La misma meta de venta del mes para cada vendedor activo. Reemplaza la que tenga cada uno; después puedes cambiar la de alguien en su ficha.${metas.length > 1 ? ' Ahora no todos tienen la misma.' : ''}`
          : 'A cada vendedor, lo que vendió el mes pasado más este porcentaje (negativo si quieres bajarla). Quien no vendió nada el mes pasado se queda con la que tiene.'}
      </p>
      {modo === 'monto' ? (
        <Campo etiqueta="Meta del mes por vendedor ($)">
          <input className={claseInput} inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && valido && enviar()} placeholder="Ej. 20000" />
        </Campo>
      ) : (
        <Campo etiqueta="Más que su mes pasado (%)">
          <input className={claseInput} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && valido && enviar()} placeholder="Ej. 10" />
        </Campo>
      )}
      {modo === 'pct' && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold text-apagado">Así quedaría</p>
          {!ventas ? <p className="text-sm text-apagado">Cargando…</p> : (
            <ul className="divide-y divide-linea rounded-lg bg-niebla px-3 text-sm">
              {vendedores.map((v) => {
                const antes = ventas[v.id] ?? 0
                const nueva = valido && antes > 0 ? Math.round((antes * (100 + porcentaje)) / 100) : null
                return (
                  <li key={v.id} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">{v.nombre}</span>
                    <span className="shrink-0 text-right tabular-nums">
                      {antes > 0 ? (
                        <>
                          <span className="text-apagado">{dineroCorto(antes)} → </span>
                          <span className="font-semibold">{nueva !== null ? dineroCorto(nueva) : '—'}</span>
                        </>
                      ) : (
                        <span className="text-apagado">Sin ventas: se queda {v.metaMensual ? `con ${dineroCorto(v.metaMensual)}` : 'sin meta'}</span>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
      {modo === 'monto' && vendedores.some((v) => v.metaMensual) && (
        <button type="button" onClick={() => void aplicar(null)} disabled={guardando} className="mt-3 text-sm font-semibold text-rojo underline-offset-4 hover:underline disabled:opacity-50">
          Quitar la meta a todos
        </button>
      )}
    </Hoja>
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
  // Trofeo: los meses cerrados en que llegó a su meta.
  const [metas, setMetas] = useState<string[] | null>(null)
  const [racha, setRacha] = useState(0)
  const [mejorRacha, setMejorRacha] = useState(0)
  const [historial, setHistorial] = useState<Trofeos['historial']>([])
  const [felicitar, setFelicitar] = useState(false)
  useEffect(() => {
    if (m.rol !== 'vendedor') return
    let vigente = true
    metasCumplidas(m.id).then((r) => { if (vigente) { setMetas(r.meses.map((x) => x.mes)); setRacha(r.racha); setMejorRacha(r.mejorRacha); setHistorial(r.historial) } }).catch(() => {})
    return () => { vigente = false }
  }, [m.id, m.rol])
  const mesCorto = (mes: string) => new Date(`${mes}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'short', year: 'numeric' })

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

  const probar = () => correr(async () => {
    const r = await avisoDePrueba(m.id)
    aviso(r.enviados ? `Aviso de prueba enviado a ${plural(r.enviados, 'dispositivo', 'dispositivos')} de ${m.nombre}`
      : r.dispositivos ? 'No llegó: sus dispositivos ya no aceptan avisos. Que los vuelva a activar en Cuenta.'
      : `${m.nombre} no tiene los avisos activados; lo verá al abrir la app`)
  })

  const alta = () => correr(async () => {
    await reactivar(m.id)
    aviso(`${m.nombre} volvió a tener acceso`)
  })

  return (
    <Hoja abierta onCerrar={onCerrar} titulo={m.nombre}>
      <div className="space-y-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 rounded-md bg-niebla px-3 py-1.5 text-xs font-semibold">
            {m.rol === 'administrador' && <ShieldCheck size={14} />}{ROL_TEXTO[m.rol]}
          </span>
          <Etiqueta m={m} />
          {!!metas?.length && (
            <span title={`Llegó a su meta en ${metas.map(mesCorto).join(', ')}`} className="flex items-center gap-1 rounded-md bg-ambar/30 px-3 py-1.5 text-xs font-semibold">
              <Trophy size={14} aria-hidden="true" /> {plural(metas.length, 'meta cumplida', 'metas cumplidas')}
            </span>
          )}
          {racha >= 2 && (
            <span title="Meses seguidos llegando a su meta" className="flex items-center gap-1 rounded-md bg-marca/15 px-3 py-1.5 text-xs font-semibold">
              <Flame size={14} aria-hidden="true" /> {racha} seguidos
            </span>
          )}
          <Medallas mejorRacha={mejorRacha} />
        </div>

        <dl className="space-y-1 border-y border-linea py-3 text-sm">
          <Linea t="Correo" v={m.correo} />
          <Linea t="Teléfono" v={m.telefono || '—'} />
          <Linea t="Último acceso" v={m.ultimoAcceso ? hace(new Date(m.ultimoAcceso).getTime()) : 'Todavía no ha entrado'} />
          {m.rol === 'vendedor' && <Linea t="Clientes" v={`${m.clientes}${m.clientes !== m.clientesActivos ? ` (${m.clientesActivos} activos)` : ''}`} />}
          <Linea t="Avisos" v={textoAvisos(m)} />
          {!!metas?.length && <Linea t="Llegó a su meta" v={metas.slice(0, 6).map(mesCorto).join(', ') + (metas.length > 6 ? ` y ${metas.length - 6} más` : '')} />}
        </dl>
        {m.telefono && (racha >= 2 || mejorRacha >= 3) && (
          <div className="-mt-2">
            <button type="button" onClick={() => setFelicitar(!felicitar)} aria-expanded={felicitar}
              className="flex w-fit items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold text-tinta underline-offset-4 hover:underline">
              <MessageCircle size={16} aria-hidden="true" /> Felicitar por WhatsApp
            </button>
            {felicitar && (
              <ul className="desplegar mt-2 space-y-1.5" aria-label="Elige el mensaje">
                {textosFelicitar(m.nombre, racha, mejorRacha).map((t, i) => (
                  <li key={i} className="desplegar-opcion" style={{ animationDelay: `${i * 30}ms` }}>
                    <a href={`https://wa.me/${telLimpio(m.telefono!)}?text=${encodeURIComponent(t)}`} target="_blank" rel="noopener noreferrer" onClick={() => setFelicitar(false)}
                      className="block rounded-lg bg-niebla px-3 py-2.5 text-sm transition-[transform,background-color] duration-150 hover:bg-linea active:scale-[0.985] motion-reduce:active:scale-100">
                      {t}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <HistorialMetas historial={historial} />
        {m.activo && m.dispositivosPush > 0 && (
          <button type="button" onClick={probar} disabled={trabajando} className="-mt-2 flex items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold text-tinta underline-offset-4 hover:underline disabled:opacity-50">
            <BellRing size={16} aria-hidden="true" /> Mandar aviso de prueba
          </button>
        )}

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
          <div className="space-y-3 border-t border-linea pt-4">
            <p className="font-semibold">¿Restablecer la contraseña de {m.nombre}?</p>
            <p className="text-sm text-apagado">Se cierran sus sesiones en todos sus teléfonos y, al entrar con la contraseña temporal, tendrá que elegir una propia.</p>
            <div className="grid grid-cols-2 gap-2">
              <Boton variante="secundario" className="bg-white" onClick={() => setConfirmar(null)} disabled={trabajando}>Cancelar</Boton>
              <Boton onClick={() => void restablecer()} disabled={trabajando}>{trabajando ? 'Un momento…' : 'Restablecer'}</Boton>
            </div>
          </div>
        )}

        {confirmar === 'baja' && (
          <div className="space-y-3 rounded-lg bg-rojo/10 p-4">
            <p className="font-semibold">¿Dar de baja a {m.nombre}?</p>
            <p className="text-sm">Deja de entrar al instante, en todos sus teléfonos. Sus clientes y su historial se conservan y puedes reactivarla cuando quieras.</p>
            {m.clientes > 0 && (
              <Campo etiqueta={m.clientes === 1 ? '¿Qué hacemos con su cliente?' : `¿Qué hacemos con sus ${m.clientes} clientes?`}>
                <Selector valor={destino} onCambiar={setDestino} className={claseInput} etiqueta="Qué hacer con sus clientes"
                  opciones={[{ valor: '', texto: 'Decidir después' }, ...otros.map((o) => ({ valor: o.id, texto: `Pasarlos a ${o.nombre}` })), { valor: SIN_VENDEDOR, texto: 'Dejarlos sin vendedor' }]} />
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
  const [comision, setComision] = useState(miembro?.comisionPct ? String(miembro.comisionPct) : '')
  const [meta, setMeta] = useState(miembro?.metaMensual ? String(miembro.metaMensual) : '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    const n = nombre.trim(), c = correo.trim(), t = telefono.trim()
    if (n.length < 2) return setError('Escribe el nombre completo')
    if (!/^\S+@\S+\.\S+$/.test(c)) return setError('Escribe un correo válido')
    const pct = comision.trim() === '' ? 0 : Number(comision.replace(',', '.'))
    const objetivo = meta.trim() === '' ? null : Number(meta.replace(',', '.'))
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setError('La comisión va de 0 a 100 %')
    if (objetivo !== null && !(objetivo > 0)) return setError('La meta debe ser un monto mayor a cero')
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
        if (rol === 'vendedor' && pct !== (miembro.comisionPct ?? 0)) cambios.comisionPct = pct
        if (rol === 'vendedor' && objetivo !== (miembro.metaMensual ?? null)) cambios.metaMensual = objetivo
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
            <p className="rounded-md bg-niebla px-4 py-3.5 text-sm text-apagado">Eres administrador. Tu propio puesto no se puede cambiar; que lo haga otro administrador.</p>
          ) : (
            <Segmentado valor={rol} onChange={setRol} opciones={[{ valor: 'vendedor', texto: 'Vendedor' }, { valor: 'administrador', texto: 'Administrador' }]} />
          )}
          <p className="mt-2 text-xs text-apagado">El vendedor sólo ve su ruta y sus clientes. El administrador ve todo, incluidos costos y márgenes.</p>
        </div>
        {miembro && rol === 'vendedor' && (
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Meta del mes ($)"><input className={claseInput} inputMode="decimal" value={meta} onChange={(e) => setMeta(e.target.value)} placeholder="Sin meta" autoComplete="off" /></Campo>
            <Campo etiqueta="Comisión (%)"><input className={claseInput} inputMode="decimal" value={comision} onChange={(e) => setComision(e.target.value)} placeholder="Sin comisión" autoComplete="off" /></Campo>
          </div>
        )}
        {!miembro && <p className="rounded-md bg-niebla px-4 py-3 text-sm text-apagado">Al crearla se genera una contraseña temporal. En su primer ingreso tendrá que elegir una propia.</p>}
        {error && <p role="alert" className="rounded-md bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
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
  const texto = `Hola ${datos.nombre.split(' ')[0]}, ya tienes cuenta en Delisy.\nAbre ${url}\nCorreo: ${datos.correo}\nContraseña temporal: ${datos.password}\nAl entrar te pedirá elegir tu propia contraseña.`

  async function copiar(que: string, aviso_: string) {
    try {
      await copiarDelicado(que)
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
        <div className="rounded-lg bg-niebla px-4 py-5 text-center">
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
  const pagina = usePaginas(delOrigen, 40, `${q}|${desde}`)

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
          <Selector valor={desde} onCambiar={cambiarOrigen} className={claseInput} etiqueta="Pasar la cartera de"
            opciones={[
              ...origenes.map((m) => ({ valor: m.id, texto: `${m.nombre}${m.activo ? '' : ' (de baja)'} · ${plural(m.clientes, 'cliente', 'clientes')}` })),
              ...(sinAsignar > 0 ? [{ valor: SIN_VENDEDOR, texto: `Sin vendedor · ${plural(sinAsignar, 'cliente', 'clientes')}` }] : []),
              ...(!origenes.some((m) => m.id === desde) && desde !== SIN_VENDEDOR ? [{ valor: desde, texto: equipo.find((m) => m.id === desde)?.nombre ?? '' }] : []),
            ]} />
        </Campo>
        <Campo etiqueta="A">
          <Selector valor={hacia} onCambiar={setHacia} className={claseInput} etiqueta="Pasar la cartera a"
            opciones={[
              { valor: '', texto: 'Elige un vendedor…' },
              ...destinos.map((m) => ({ valor: m.id, texto: `${m.nombre}${m.rol === 'administrador' ? ' (administrador)' : ''}` })),
              ...(desde !== SIN_VENDEDOR ? [{ valor: SIN_VENDEDOR, texto: 'Sin vendedor (sólo el administrador los ve)' }] : []),
            ]} />
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
            <ul ref={pagina.ancla} className="mt-1 scroll-mt-4">
              {pagina.visibles.map((c) => (
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
              {pagina.control && <li>{pagina.control}</li>}
              {delOrigen.length === 0 && <li className="py-6 text-center text-sm text-apagado">{locales.length ? 'Sin clientes que mostrar' : 'Este teléfono todavía no descarga los clientes. Sincroniza y vuelve a intentar.'}</li>}
            </ul>
          </div>
        )}

        <p className="rounded-md bg-niebla px-4 py-3 text-sm text-apagado">
          Los clientes pasan con sus pedidos agendados y recordatorios pendientes. Lo ya entregado se queda como venta de quien lo hizo, pero el nuevo vendedor lo ve en el historial. Al sincronizar, el teléfono anterior deja de mostrarlos.
        </p>
        {error && <p role="alert" className="rounded-md bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
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
        {error && <p role="alert" className="mt-3 rounded-md bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
      </div>
    </Hoja>
  )
}
