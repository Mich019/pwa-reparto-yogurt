import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Map as MapaML, Marker } from 'maplibre-gl'
import { ChevronRight, Crosshair, MessageCircle, Moon, Pencil, Phone, Plus, Search, Star, Sun, UserX, UserCheck } from 'lucide-react'
import { db, guardar, uid, type Cliente, type Frecuencia, type Pedido, type Ventana } from '../lib/db'
import { DIAS_CORTOS, dinero, textoFecha, textoFrecuencia } from '../lib/fechas'
import { ubicacionActual, type Punto } from '../lib/ruteo'
import { ESTILO_MAPA } from './Mapa'
import { EditorPedido } from './EditorPedido'
import { Accion, Boton, Campo, Hoja, Segmentado, aviso, claseInput, telLimpio } from './ui'

export function Clientes() {
  const clientes = useLiveQuery(() => db.clientes.orderBy('nombre').toArray(), []) ?? []
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), []) ?? []
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [form, setForm] = useState<Cliente | 'nuevo' | null>(null)
  const [perfilId, setPerfilId] = useState<string | null>(null)

  const prod = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const stats = useMemo(() => {
    type Stats = { litros: number; ultima?: string; sabores: Map<string, number>; proximo?: string }
    const m = new Map<string, Stats>()
    for (const p of pedidos) {
      const s: Stats = m.get(p.clienteId) ?? { litros: 0, sabores: new Map() }
      if (p.estado === 'ENTREGADO') {
        p.items.forEach((i) => {
          s.litros += i.litros
          s.sabores.set(i.productoId, (s.sabores.get(i.productoId) ?? 0) + i.litros)
        })
        if (!s.ultima || p.fecha > s.ultima) s.ultima = p.fecha
      }
      if (p.estado === 'PENDIENTE' && (!s.proximo || p.fecha < s.proximo)) s.proximo = p.fecha
      m.set(p.clienteId, s)
    }
    return m
  }, [pedidos])

  const favorito = (id: string) => {
    const s = stats.get(id)
    if (!s?.sabores.size) return undefined
    return prod.get([...s.sabores.entries()].sort((a, b) => b[1] - a[1])[0][0])
  }

  const t = q.trim().toLowerCase()
  const lista = clientes.filter(
    (c) => c.activo !== verInactivos && (!t || `${c.nombre} ${c.telefono} ${c.direccion}`.toLowerCase().includes(t)),
  )
  const perfil = clientes.find((c) => c.id === perfilId)

  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-safe">
        <div className="mt-3 flex items-center justify-between">
          <h1 className="text-[32px] leading-9 font-extrabold tracking-tight">Clientes</h1>
          <button onClick={() => setVerInactivos(!verInactivos)} className="rounded-full bg-niebla px-3.5 py-2 text-sm font-semibold active:bg-linea">
            {verInactivos ? 'Ver activos' : 'Ver archivados'}
          </button>
        </div>
        <div className="relative mt-4">
          <Search size={18} className="absolute top-1/2 left-4 -translate-y-1/2 text-tinta" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, teléfono o calle" className={`${claseInput} pl-11`} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-2 pb-28">
        {lista.length === 0 && (
          <div className="py-12 text-center text-apagado">
            {clientes.length ? 'Sin resultados' : 'Aún no hay clientes. Toca + para pasar el primero de tu libreta.'}
          </div>
        )}
        {lista.map((c) => {
          const s = stats.get(c.id)
          const fav = favorito(c.id)
          return (
            <button key={c.id} onClick={() => setPerfilId(c.id)} className="flex w-full items-center gap-3 border-b border-linea py-3.5 text-left active:bg-niebla">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-[3px] border-linea bg-niebla text-lg font-bold" style={fav ? { borderColor: fav.color_hex } : undefined}>
                {c.nombre.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] leading-5 font-bold">{c.nombre}</div>
                <div className="mt-0.5 truncate text-sm text-apagado">
                  {textoFrecuencia(c.frecuencia)} · {c.ventana === 'MAÑANA' ? 'mañana' : 'tarde'}
                  {fav && <> · ★ {fav.sabor}</>}
                </div>
              </div>
              {s?.proximo && <div className="rounded-full bg-azul/10 px-2.5 py-1 text-xs font-semibold text-azul">{textoFecha(s.proximo)}</div>}
              <ChevronRight size={18} className="shrink-0 text-apagado/60" />
            </button>
          )
        })}
      </div>
      <button onClick={() => setForm('nuevo')} aria-label="Nuevo cliente" className="fixed right-5 bottom-24 z-20 grid h-16 w-16 place-items-center rounded-full bg-tinta text-white shadow-tarjeta active:bg-neutral-700">
        <Plus size={30} />
      </button>

      {form && <FormCliente cliente={form === 'nuevo' ? undefined : form} onCerrar={() => setForm(null)} />}
      {perfil && (
        <Perfil
          cliente={perfil}
          pedidos={pedidos.filter((p) => p.clienteId === perfil.id)}
          litros={stats.get(perfil.id)?.litros ?? 0}
          favorito={favorito(perfil.id)?.sabor}
          sabor={(id) => prod.get(id)}
          onCerrar={() => setPerfilId(null)}
          onEditar={() => setForm(perfil)}
        />
      )}
    </div>
  )
}

function Perfil({ cliente, pedidos, litros, favorito, sabor, onCerrar, onEditar }: {
  cliente: Cliente
  pedidos: Pedido[]
  litros: number
  favorito?: string
  sabor: (id: string) => { sabor: string; color_hex: string } | undefined
  onCerrar: () => void
  onEditar: () => void
}) {
  const [editor, setEditor] = useState<{ pedido?: Pedido } | null>(null)
  const ordenados = [...pedidos].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const pendientes = ordenados.filter((p) => p.estado === 'PENDIENTE')
  const historial = ordenados.filter((p) => p.estado !== 'PENDIENTE').slice(0, 15)
  const ultima = historial.find((p) => p.estado === 'ENTREGADO')
  const base = useMemo(() => ({}), [])

  return (
    <Hoja abierta onCerrar={onCerrar} alto titulo={cliente.nombre}>
      <div className="space-y-5 pb-4">
        <div className="text-sm text-apagado">{cliente.direccion} · {textoFrecuencia(cliente.frecuencia)} · {cliente.ventana === 'MAÑANA' ? 'mañana' : 'tarde'}</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Dato valor={`${litros} L`} etiqueta="Consumidos" />
          <Dato valor={favorito ?? '—'} etiqueta="Favorito" icono={<Star size={12} className="inline" />} />
          <Dato valor={ultima ? textoFecha(ultima.fecha) : '—'} etiqueta="Última visita" />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Accion href={`tel:${cliente.telefono}`} icono={<Phone size={22} />} texto="Llamar" />
          <Accion href={`https://wa.me/${telLimpio(cliente.telefono)}`} icono={<MessageCircle size={22} />} texto="WhatsApp" />
          <Accion onClick={onEditar} icono={<Pencil size={22} />} texto="Editar" />
          <Accion
            onClick={async () => {
              await guardar('clientes', { ...cliente, activo: !cliente.activo })
              aviso(cliente.activo ? 'Cliente archivado' : 'Cliente reactivado')
            }}
            icono={cliente.activo ? <UserX size={22} /> : <UserCheck size={22} />}
            texto={cliente.activo ? 'Archivar' : 'Activar'}
          />
        </div>
        <Boton className="w-full" onClick={() => setEditor({})}><Plus size={20} /> Nuevo pedido</Boton>

        {pendientes.length > 0 && (
          <Seccion titulo="Pedidos agendados">
            {pendientes.map((p) => (
              <FilaPedido key={p.id} p={p} sabor={sabor} onClick={() => setEditor({ pedido: p })} />
            ))}
          </Seccion>
        )}
        <Seccion titulo="Historial">
          {historial.length === 0 && <div className="text-sm text-apagado">Sin visitas todavía</div>}
          {historial.map((p) => <FilaPedido key={p.id} p={p} sabor={sabor} />)}
        </Seccion>
      </div>
      {editor && <EditorPedido abierto cliente={cliente} pedido={editor.pedido} base={base} onCerrar={() => setEditor(null)} />}
    </Hoja>
  )
}

function Dato({ valor, etiqueta, icono }: { valor: string; etiqueta: string; icono?: ReactNode }) {
  return (
    <div className="rounded-xl bg-niebla px-2 py-3">
      <div className="truncate text-base font-bold">{valor}</div>
      <div className="text-[11px] text-apagado">{icono} {etiqueta}</div>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-lg font-bold tracking-tight">{titulo}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

const ETIQUETA_ESTADO = { PENDIENTE: 'Agendado', ENTREGADO: 'Entregado', OMITIDO: 'Omitido', RECORDAR_MAS_TARDE: 'Por confirmar' }

function FilaPedido({ p, sabor, onClick }: { p: Pedido; sabor: (id: string) => { sabor: string; color_hex: string } | undefined; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 rounded-xl bg-niebla px-3 py-3 text-left">
      <div className="w-20 shrink-0 text-sm font-semibold">{textoFecha(p.fecha)}</div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {p.items.map((i) => (
          <span key={i.productoId} className="flex items-center gap-1 text-xs">
            <span className="h-3 w-3 rounded-full" style={{ background: sabor(i.productoId)?.color_hex }} />
            {i.litros}L {sabor(i.productoId)?.sabor}
          </span>
        ))}
      </div>
      <div className="text-right">
        <div className="text-sm font-bold tabular-nums">{dinero(p.total)}</div>
        <div className="text-[10px] text-apagado">{ETIQUETA_ESTADO[p.estado]}</div>
      </div>
    </button>
  )
}

function FormCliente({ cliente, onCerrar }: { cliente?: Cliente; onCerrar: () => void }) {
  const [nombre, setNombre] = useState(cliente?.nombre ?? '')
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '')
  const [direccion, setDireccion] = useState(cliente?.direccion ?? '')
  const [notas, setNotas] = useState(cliente?.notas ?? '')
  const [punto, setPunto] = useState<Punto | null>(cliente ? [cliente.longitud, cliente.latitud] : null)
  const [frecuencia, setFrecuencia] = useState<Frecuencia>(cliente?.frecuencia ?? { tipo: 'semana', dias: [] })
  const [ventana, setVentana] = useState<Ventana>(cliente?.ventana ?? 'MAÑANA')
  const [buscandoGps, setBuscandoGps] = useState(false)

  async function usarGps() {
    setBuscandoGps(true)
    const p = await ubicacionActual()
    setBuscandoGps(false)
    if (p) setPunto(p)
    else aviso('No pude leer el GPS. Revisa el permiso de ubicación.')
  }

  useEffect(() => {
    if (!cliente) usarGps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function guardarCliente() {
    if (!nombre.trim()) return aviso('Falta el nombre')
    if (!punto) return aviso('Falta la ubicación en el mapa')
    const ahora = Date.now()
    await guardar('clientes', {
      id: cliente?.id ?? uid(),
      qr_uuid: cliente?.qr_uuid ?? uid(),
      nfc_uid: cliente?.nfc_uid,
      activo: cliente?.activo ?? true,
      creado: cliente?.creado ?? ahora,
      actualizado: ahora,
      nombre: nombre.trim(),
      telefono: telefono.trim(),
      direccion: direccion.trim(),
      notas: notas.trim() || undefined,
      longitud: punto[0],
      latitud: punto[1],
      frecuencia,
      ventana,
    } satisfies Cliente)
    aviso(cliente ? 'Cliente actualizado' : 'Cliente guardado')
    onCerrar()
  }

  const dias = frecuencia.tipo === 'semana' ? frecuencia.dias : []
  return (
    <Hoja abierta onCerrar={onCerrar} alto titulo={cliente ? 'Editar cliente' : 'Nuevo cliente'}>
      <div className="space-y-4 pb-4">
        <Campo etiqueta="Nombre"><input className={claseInput} value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Doña Lupita" /></Campo>
        <Campo etiqueta="Teléfono / WhatsApp"><input className={claseInput} value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" placeholder="10 dígitos" /></Campo>
        <Campo etiqueta="Dirección"><input className={claseInput} value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle, número, colonia" /></Campo>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-apagado">Ubicación (toca el mapa para ajustar)</span>
            <button onClick={usarGps} className="flex items-center gap-1 text-sm font-semibold text-azul">
              <Crosshair size={16} className={buscandoGps ? 'animate-spin' : ''} /> Mi GPS
            </button>
          </div>
          <MapaSelector punto={punto} onCambio={setPunto} />
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-apagado">¿Cada cuándo le surtes?</div>
          <Segmentado
            className="mb-3"
            valor={frecuencia.tipo}
            onChange={(t) => setFrecuencia(t === 'semana' ? { tipo: 'semana', dias } : { tipo: 'intervalo', cada: frecuencia.tipo === 'intervalo' ? frecuencia.cada : 7 })}
            opciones={[{ valor: 'semana', texto: 'Días fijos' }, { valor: 'intervalo', texto: 'Cada N días' }]}
          />
          {frecuencia.tipo === 'semana' ? (
            <div className="grid grid-cols-7 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button
                  key={d}
                  onClick={() => setFrecuencia({ tipo: 'semana', dias: dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d] })}
                  className={`grid aspect-square place-items-center rounded-full text-xs font-bold ${dias.includes(d) ? 'bg-tinta text-white' : 'bg-niebla text-tinta active:bg-linea'}`}
                >
                  {DIAS_CORTOS[d].slice(0, 2)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-tinta">Cada</span>
              <input type="number" min={1} max={60} className={`${claseInput} !w-24 text-center`} value={frecuencia.cada} onChange={(e) => setFrecuencia({ tipo: 'intervalo', cada: Math.max(1, Number(e.target.value) || 1) })} />
              <span className="text-tinta">días</span>
            </div>
          )}
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-apagado">Horario preferido</div>
          <Segmentado
            valor={ventana}
            onChange={setVentana}
            opciones={[{ valor: 'MAÑANA', texto: <><Sun size={15} /> Mañana</> }, { valor: 'TARDE', texto: <><Moon size={15} /> Tarde</> }]}
          />
        </div>
        <Campo etiqueta="Notas (referencias)"><textarea className={claseInput} rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. portón verde, tocar fuerte" /></Campo>
        <Boton className="w-full" onClick={guardarCliente}>Guardar cliente</Boton>
      </div>
    </Hoja>
  )
}

function MapaSelector({ punto, onCambio }: { punto: Punto | null; onCambio: (p: Punto) => void }) {
  const div = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapaML | null>(null)
  const marca = useRef<Marker | null>(null)
  const cb = useRef(onCambio)
  cb.current = onCambio

  useEffect(() => {
    const m = new MapaML({ container: div.current!, style: ESTILO_MAPA, center: punto ?? [-99.1332, 19.4326], zoom: punto ? 16 : 11, attributionControl: false })
    m.on('click', (e) => cb.current([e.lngLat.lng, e.lngLat.lat]))
    mapa.current = m
    return () => m.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = mapa.current
    if (!m || !punto) return
    if (!marca.current) {
      marca.current = new Marker({ color: '#000000', draggable: true }).setLngLat(punto).addTo(m)
      marca.current.on('dragend', () => {
        const ll = marca.current!.getLngLat()
        cb.current([ll.lng, ll.lat])
      })
      m.jumpTo({ center: punto, zoom: 16 })
    } else marca.current.setLngLat(punto)
  }, [punto])

  return <div ref={div} className="h-48 overflow-hidden rounded-2xl bg-niebla" />
}
