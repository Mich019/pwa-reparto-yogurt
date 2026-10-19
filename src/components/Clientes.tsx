import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Map as MapaML, Marker } from 'maplibre-gl'
import { Crosshair, MessageCircle, Pencil, Phone, Plus, Search, Star, UserX, UserCheck } from 'lucide-react'
import { db, guardar, uid, type Cliente, type Frecuencia, type Pedido, type Ventana } from '../lib/db'
import { DIAS_CORTOS, dinero, textoFecha, textoFrecuencia } from '../lib/fechas'
import { ubicacionActual, type Punto } from '../lib/ruteo'
import { ESTILO_MAPA } from './Mapa'
import { EditorPedido } from './EditorPedido'
import { Boton, Campo, Hoja, aviso, claseInput, telLimpio } from './ui'

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
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-extrabold">Clientes</h1>
          <button onClick={() => setVerInactivos(!verInactivos)} className="text-sm font-semibold text-slate-400">
            {verInactivos ? 'Ver activos' : 'Ver archivados'}
          </button>
        </div>
        <div className="relative mt-3">
          <Search size={18} className="absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, teléfono o calle" className={`${claseInput} pl-10`} />
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 pt-3 pb-24">
        {lista.length === 0 && (
          <div className="py-12 text-center text-slate-400">
            {clientes.length ? 'Sin resultados' : 'Aún no hay clientes. Toca + para pasar el primero de tu libreta.'}
          </div>
        )}
        {lista.map((c) => {
          const s = stats.get(c.id)
          const fav = favorito(c.id)
          return (
            <button key={c.id} onClick={() => setPerfilId(c.id)} className="flex w-full items-center gap-3 rounded-2xl bg-slate-900 p-3 text-left active:bg-slate-800">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-bold" style={{ background: fav?.color_hex ?? '#334155', color: '#0f172a' }}>
                {c.nombre.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{c.nombre}</div>
                <div className="truncate text-xs text-slate-400">
                  {textoFrecuencia(c.frecuencia)} · {c.ventana === 'MAÑANA' ? 'mañana' : 'tarde'}
                  {fav && <> · ★ {fav.sabor}</>}
                </div>
              </div>
              {s?.proximo && <div className="rounded-full bg-pink-500/15 px-2.5 py-1 text-xs font-semibold text-pink-300">{textoFecha(s.proximo)}</div>}
            </button>
          )
        })}
      </div>
      <button onClick={() => setForm('nuevo')} aria-label="Nuevo cliente" className="fixed right-5 bottom-24 z-20 grid h-16 w-16 place-items-center rounded-full bg-pink-500 shadow-xl active:bg-pink-400">
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
      <div className="space-y-4 pb-4">
        <div className="text-sm text-slate-400">{cliente.direccion} · {textoFrecuencia(cliente.frecuencia)} · {cliente.ventana === 'MAÑANA' ? 'mañana' : 'tarde'}</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Dato valor={`${litros} L`} etiqueta="Consumidos" />
          <Dato valor={favorito ?? '—'} etiqueta="Favorito" icono={<Star size={12} className="inline" />} />
          <Dato valor={ultima ? textoFecha(ultima.fecha) : '—'} etiqueta="Última visita" />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <a href={`tel:${cliente.telefono}`} className="flex flex-col items-center gap-1 rounded-xl bg-slate-800 py-2.5 text-xs font-semibold"><Phone size={20} />Llamar</a>
          <a href={`https://wa.me/${telLimpio(cliente.telefono)}`} target="_blank" className="flex flex-col items-center gap-1 rounded-xl bg-slate-800 py-2.5 text-xs font-semibold"><MessageCircle size={20} />WhatsApp</a>
          <button onClick={onEditar} className="flex flex-col items-center gap-1 rounded-xl bg-slate-800 py-2.5 text-xs font-semibold"><Pencil size={20} />Editar</button>
          <button
            onClick={async () => {
              await guardar('clientes', { ...cliente, activo: !cliente.activo })
              aviso(cliente.activo ? 'Cliente archivado' : 'Cliente reactivado')
            }}
            className="flex flex-col items-center gap-1 rounded-xl bg-slate-800 py-2.5 text-xs font-semibold"
          >
            {cliente.activo ? <UserX size={20} /> : <UserCheck size={20} />}
            {cliente.activo ? 'Archivar' : 'Activar'}
          </button>
        </div>
        <Boton variante="rosa" className="w-full" onClick={() => setEditor({})}><Plus size={20} /> Nuevo pedido</Boton>

        {pendientes.length > 0 && (
          <Seccion titulo="Pedidos agendados">
            {pendientes.map((p) => (
              <FilaPedido key={p.id} p={p} sabor={sabor} onClick={() => setEditor({ pedido: p })} />
            ))}
          </Seccion>
        )}
        <Seccion titulo="Historial">
          {historial.length === 0 && <div className="text-sm text-slate-500">Sin visitas todavía</div>}
          {historial.map((p) => <FilaPedido key={p.id} p={p} sabor={sabor} />)}
        </Seccion>
      </div>
      {editor && <EditorPedido abierto cliente={cliente} pedido={editor.pedido} base={base} onCerrar={() => setEditor(null)} />}
    </Hoja>
  )
}

function Dato({ valor, etiqueta, icono }: { valor: string; etiqueta: string; icono?: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-800 px-2 py-2.5">
      <div className="truncate font-bold">{valor}</div>
      <div className="text-[11px] text-slate-400">{icono} {etiqueta}</div>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-400">{titulo}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

const ETIQUETA_ESTADO = { PENDIENTE: 'Agendado', ENTREGADO: 'Entregado', OMITIDO: 'Omitido', RECORDAR_MAS_TARDE: 'Por confirmar' }

function FilaPedido({ p, sabor, onClick }: { p: Pedido; sabor: (id: string) => { sabor: string; color_hex: string } | undefined; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 rounded-xl bg-slate-800/70 px-3 py-2.5 text-left">
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
        <div className="text-[10px] text-slate-400">{ETIQUETA_ESTADO[p.estado]}</div>
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
            <span className="text-sm font-medium text-slate-400">Ubicación (toca el mapa para ajustar)</span>
            <button onClick={usarGps} className="flex items-center gap-1 text-sm font-semibold text-pink-400">
              <Crosshair size={16} className={buscandoGps ? 'animate-spin' : ''} /> Mi GPS
            </button>
          </div>
          <MapaSelector punto={punto} onCambio={setPunto} />
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-400">¿Cada cuándo le surtes?</div>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Chip activo={frecuencia.tipo === 'semana'} onClick={() => setFrecuencia({ tipo: 'semana', dias })}>Días fijos</Chip>
            <Chip activo={frecuencia.tipo === 'intervalo'} onClick={() => setFrecuencia({ tipo: 'intervalo', cada: frecuencia.tipo === 'intervalo' ? frecuencia.cada : 7 })}>Cada N días</Chip>
          </div>
          {frecuencia.tipo === 'semana' ? (
            <div className="grid grid-cols-7 gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <Chip key={d} activo={dias.includes(d)} onClick={() => setFrecuencia({ tipo: 'semana', dias: dias.includes(d) ? dias.filter((x) => x !== d) : [...dias, d] })}>
                  {DIAS_CORTOS[d]}
                </Chip>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-slate-300">Cada</span>
              <input type="number" min={1} max={60} className={`${claseInput} !w-24 text-center`} value={frecuencia.cada} onChange={(e) => setFrecuencia({ tipo: 'intervalo', cada: Math.max(1, Number(e.target.value) || 1) })} />
              <span className="text-slate-300">días</span>
            </div>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-slate-400">Horario preferido</div>
          <div className="grid grid-cols-2 gap-2">
            <Chip activo={ventana === 'MAÑANA'} onClick={() => setVentana('MAÑANA')}>☀️ Mañana</Chip>
            <Chip activo={ventana === 'TARDE'} onClick={() => setVentana('TARDE')}>🌙 Tarde</Chip>
          </div>
        </div>
        <Campo etiqueta="Notas (referencias)"><textarea className={claseInput} rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. portón verde, tocar fuerte" /></Campo>
        <Boton variante="rosa" className="w-full" onClick={guardarCliente}>Guardar cliente</Boton>
      </div>
    </Hoja>
  )
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-xl py-2.5 text-sm font-semibold ${activo ? 'bg-pink-500 text-white' : 'bg-slate-800 text-slate-300'}`}>
      {children}
    </button>
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
      marca.current = new Marker({ color: '#ec4899', draggable: true }).setLngLat(punto).addTo(m)
      marca.current.on('dragend', () => {
        const ll = marca.current!.getLngLat()
        cb.current([ll.lng, ll.lat])
      })
      m.jumpTo({ center: punto, zoom: 16 })
    } else marca.current.setLngLat(punto)
  }, [punto])

  return <div ref={div} className="h-48 overflow-hidden rounded-2xl bg-slate-800" />
}
