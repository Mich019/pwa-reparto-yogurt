import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Recientes, Resaltar, useRecientes } from '../../components/Busqueda'
import { coincide, digitosBuscados, limpiarBusqueda, normalizar, propsBuscador, telefonoCoincide } from '../../lib/busqueda'
import { esMio } from '../../lib/reparto'
import { useLiveQuery } from 'dexie-react-hooks'
import { Map as MapaML, Marker } from 'maplibre-gl'
import { BookUser, ChevronRight, NotebookPen, Download, Eye, FileDown, FileSpreadsheet, FileText, Crosshair, Flame, MessageCircle, Moon, Pencil, Phone, Printer, QrCode, RotateCcw, ScanLine, Search, ShoppingBag, Star, Sun, TriangleAlert, UserCheck, UserCog, UserPlus, UserX } from 'lucide-react'
import { MODO_SERVIDOR } from '../../lib/api'
import { db, guardar, uid, type Cliente, type Frecuencia, type Pedido, type Producto, type Ventana } from '../../lib/db'
import { cargarEquipo, useEquipo } from '../../lib/equipo'
import { descargar, xlsx } from '../../lib/xlsx'
import { llamarAutenticado } from '../../lib/sesion'
import type { Deudor, EnvasesClientes } from '../../lib/cobranza'
import { DIAS_CORTOS, DIAS_LARGOS, dinero, hoy, sumarDias, textoFecha, textoFrecuencia } from '../../lib/fechas'
import { ubicacionActual, type Punto } from '../../lib/ruteo'
import { useRol } from '../../lib/sesion'
import { exportarLibreta, type Formato } from '../../lib/reportes'
import { ESTILO_MAPA } from './Mapa'
import { EditorPedido } from './EditorPedido'
import { aCantidades, type Cantidades } from './SelectorSabores'
import { CambiarVendedor } from './Equipo'
import { FichaCodigos, ImpresionMasiva } from './CodigosCliente'
import { usePaginas } from '../../components/Paginas'
import { BotonAyuda } from '../ayuda/AyudaRapida'
import { VisitasSinPedido } from './VisitasSinPedido'
import { CuentaDelCliente } from '../../components/CuentaDelCliente'
import { PreciosDelCliente } from '../../components/PreciosDelCliente'
import { HojaLimitesSugeridos, LimiteFiado } from '../../components/LimiteFiado'
import { useMarca } from '../../lib/marca'
import { PorCobrar } from '../../components/PorCobrar'
import { textoCantidad, totalOCero } from '../../lib/unidades'
import { Accion, Boton, Campo, Hoja, PuntoSabor, Segmentado, aviso, claseInput, telLimpio } from '../../components/ui'
import { BuscadorDesplegable, Encabezado, MenuMas, Separador, botonPanel, botonPanelSuave, grupoPanel } from '../admin/piezas'

const Escaner = lazy(() => import('./Escaner'))


// Lo que encuentra el buscador (RF-011): nombre, teléfono, dirección (con su colonia), días o cada cuánto se le surte, y horario.
function textoBusqueda(c: Cliente) {
  const dias = c.frecuencia.tipo === 'semana' ? c.frecuencia.dias.map((d) => DIAS_LARGOS[d]).join(' ') : ''
  return normalizar(`${c.nombre} ${c.telefono} ${c.telefono.replace(/\D/g, '')} ${c.direccion} ${textoFrecuencia(c.frecuencia)} ${dias} ${c.ventana === 'MAÑANA' ? 'mañana' : 'tarde'}`)
}

// `abrirCliente` (panel: «Buscar pedidos» del inicio) deja pedida la ficha de un cliente; se llama justo antes de ir a
// Clientes, que la abre al montarse (como abrirFicha en Equipo).
let clientePedido: string | null = null
export function abrirCliente(id: string) {
  clientePedido = id
}
// Abre Clientes con «dejaron de comprar» puesto (desde «Qué hacer hoy» del Resumen).
let abrirSinComprar = false
export function verSinComprar() {
  abrirSinComprar = true
}

// `panel`: dentro del panel web, con el encabezado y el ancho de las demás secciones y la lista en dos columnas.
export function Clientes({ panel = false }: { panel?: boolean } = {}) {
  // En la app de reparto, el administrador ve su cartera y la que no tiene vendedor (lib/reparto.ts); en el panel, todo.
  const clientes = useLiveQuery(() => db.clientes.orderBy('nombre').filter((c) => panel || esMio(c.vendedorId)).toArray(), [panel]) ?? []
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), []) ?? []
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const [q, setQ] = useState('')
  const [enBuscador, setEnBuscador] = useState(false)
  const recientes = useRecientes('clientes')
  const [verInactivos, setVerInactivos] = useState(false)
  const [soloSinComprar, setSoloSinComprar] = useState(() => { const v = abrirSinComprar; abrirSinComprar = false; return v })
  const [escribirles, setEscribirles] = useState(false)
  const [form, setForm] = useState<Cliente | 'nuevo' | null>(null)
  const [perfilId, setPerfilId] = useState<string | null>(() => { const c = clientePedido; clientePedido = null; return c })
  const [escaner, setEscaner] = useState(false)
  const [imprimir, setImprimir] = useState(false)
  const [libreta, setLibreta] = useState(false)
  const [sugerir, setSugerir] = useState(false)
  const rol = useRol()
  const equipoNombres = useEquipo()
  const limiteDeEmpresa = useMarca()?.limiteFiado ?? null

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

  const t = limpiarBusqueda(q)
  // Un número (con espacios, guiones o paréntesis) se compara sólo con los dígitos del teléfono.
  const digitos = digitosBuscados(t)
  // Dejaron de comprar: activos que ya compraron, sin pedido pendiente y con la última entrega hace más de 30 días.
  const hace30 = sumarDias(hoy(), -30)
  const dejo = (c: Cliente) => { const s = stats.get(c.id); return c.activo && !!s?.ultima && !s.proximo && s.ultima < hace30 }
  const sinComprar = clientes.filter(dejo).length
  const filtrarSinComprar = soloSinComprar && !verInactivos && sinComprar > 0
  const lista = clientes.filter((c) => c.activo !== verInactivos && (!filtrarSinComprar || dejo(c)) && (coincide(t, textoBusqueda(c)) || telefonoCoincide(digitos, c.telefono)))
  const paginas = usePaginas(lista, 40, `${t}|${verInactivos}|${filtrarSinComprar}`)
  const perfil = clientes.find((c) => c.id === perfilId)
  // Lo que dejó la búsqueda, a Excel. El vendedor sale si el equipo ya está cargado; con conexión se agregan lo que debe
  // cada cliente (fiado) y los envases que tiene prestados, y sin ella el Excel sale igual, sin esas dos columnas.
  async function exportar() {
    const vendedor = new Map((equipoNombres?.usuarios ?? []).map((u) => [u.id, u.nombre]))
    const [cobro, envases] = MODO_SERVIDOR
      ? await Promise.all([
        llamarAutenticado<{ deudores: Deudor[] }>('/cobranza').catch(() => null),
        llamarAutenticado<EnvasesClientes>('/envases').catch(() => null),
      ])
      : [null, null]
    const saldo = cobro && new Map(cobro.deudores.map((d) => [d.id, d.saldo]))
    const prestados = envases && new Map(envases.clientes.map((c) => [c.id, c.total]))
    descargar(xlsx({
      nombre: verInactivos ? 'Clientes archivados' : 'Clientes',
      columnas: [{ titulo: 'Cliente', ancho: 28 }, { titulo: 'Teléfono', ancho: 16 }, { titulo: 'Dirección', ancho: 40 }, { titulo: 'Vendedor', ancho: 22 }, { titulo: 'Visita', ancho: 22 }, { titulo: 'Último pedido entregado', ancho: 14 }, { titulo: 'Compra cada (días)', ancho: 12 },
        ...(saldo ? [{ titulo: 'Debe (fiado)', dinero: true, ancho: 14 }] : []), { titulo: 'Límite de fiado', dinero: true, ancho: 14 }, ...(prestados ? [{ titulo: 'Envases prestados', ancho: 12 }] : []), { titulo: 'Notas', ancho: 36 }],
      filas: lista.map((c) => [c.nombre, c.telefono, c.direccion, c.vendedorId ? vendedor.get(c.vendedorId) ?? '' : 'Sin vendedor', textoFrecuencia(c.frecuencia), stats.get(c.id)?.ultima ?? '', cadaCuanto(pedidos.filter((p) => p.clienteId === c.id)),
        ...(saldo ? [saldo.get(c.id) ?? 0] : []), c.limiteFiado ?? limiteDeEmpresa, ...(prestados ? [prestados.get(c.id) ?? 0] : []), c.notas ?? '']),
    }), `clientes-${hoy()}.xlsx`)
  }

  const archivados = clientes.filter((c) => !c.activo).length
  const buscador = (
    <div className="relative mt-4">
      <Search size={18} className="absolute top-1/2 left-4 -translate-y-1/2 text-tinta" />
      <input {...propsBuscador} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, teléfono, colonia o día" className={`${claseInput} pl-11`}
        onFocus={() => setEnBuscador(true)} onBlur={() => { setEnBuscador(false); recientes.recordar(q) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { recientes.recordar(q); e.currentTarget.blur() } }} />
      {enBuscador && !q && <Recientes className="mt-2" lista={recientes.lista} onElegir={setQ} onOlvidar={recientes.olvidar} />}
    </div>
  )

  return (
    <div className={panel ? 'mx-auto max-w-[1280px] px-4 pt-2 sm:px-8' : 'flex h-full flex-col'}>
      {panel ? (
        <>
          {/* Una sola fila a la altura del detalle: buscar y filtrar, y luego las acciones; todo de 40 px de alto. */}
          <Encabezado titulo="Clientes" ayuda="clientes" detalle={`${clientes.length - archivados} activos${archivados ? ` · ${archivados} archivados` : ''}`}>
            <BuscadorDesplegable valor={q} onChange={setQ} placeholder="Buscar cliente" clave="clientes" />
            <div className={grupoPanel} role="group" aria-label="Mostrar">
              <button onClick={() => setVerInactivos(false)} aria-pressed={!verInactivos} className={verInactivos ? botonPanelSuave : botonPanel}>Activos</button>
              <button onClick={() => setVerInactivos(true)} aria-pressed={verInactivos} className={verInactivos ? botonPanel : botonPanelSuave}>Archivados</button>
            </div>
            <Separador />
            <MenuMas opciones={[
              { texto: 'Escanear', icono: <ScanLine size={18} aria-hidden="true" />, onElegir: () => setEscaner(true) },
              { texto: 'Imprimir QR', icono: <Printer size={18} aria-hidden="true" />, onElegir: () => setImprimir(true) },
              { texto: 'Bajar a Excel', icono: <FileSpreadsheet size={18} aria-hidden="true" />, onElegir: () => void exportar() },
              ...(MODO_SERVIDOR && rol === 'administrador' ? [{ texto: 'Libreta', icono: <BookUser size={18} aria-hidden="true" />, onElegir: () => setLibreta(true) },
                { texto: 'Límite sugerido para todos', icono: <NotebookPen size={18} aria-hidden="true" />, onElegir: () => setSugerir(true) }] : []),
            ]} />
            <button onClick={() => setForm('nuevo')} className={`${botonPanel} max-sm:grow`}><UserPlus size={18} /> Nuevo cliente</button>
          </Encabezado>
        </>
      ) : (
      <div className="px-4 pt-safe">
        <div className="mt-3 flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-1 text-3xl font-bold tracking-tight">Clientes<BotonAyuda seccion="clientes" /></h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setEscaner(true)} aria-label="Escanear QR o tarjeta" className="grid h-10 w-10 place-items-center rounded-full bg-niebla active:bg-linea">
              <ScanLine size={20} />
            </button>
            <button onClick={() => setImprimir(true)} aria-label="Imprimir QR" title="Imprimir QR" className="grid h-10 w-10 place-items-center rounded-full bg-niebla active:bg-linea">
              <Printer size={20} />
            </button>
            {/* La libreta junta la cartera de todos los vendedores en el servidor: sólo el administrador. */}
            {MODO_SERVIDOR && rol === 'administrador' && (
              <button onClick={() => setLibreta(true)} aria-label="Libreta de clientes" title="Libreta de clientes" className="grid h-10 w-10 place-items-center rounded-full bg-niebla active:bg-linea">
                <BookUser size={20} />
              </button>
            )}
            <button onClick={() => setVerInactivos(!verInactivos)} className="rounded-md bg-niebla px-3.5 py-2 text-sm font-semibold active:bg-linea">
              {verInactivos ? 'Activos' : 'Archivados'}
            </button>
          </div>
        </div>
        {buscador}
      </div>
      )}
      {!verInactivos && sinComprar > 0 && (
        <div className={panel ? '-mt-2 mb-2 text-sm' : 'px-4 pt-2 text-sm'}>
          <button type="button" onClick={() => setSoloSinComprar(!filtrarSinComprar)} aria-pressed={filtrarSinComprar}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-semibold transition-colors ${filtrarSinComprar ? 'bg-tinta text-white' : 'bg-niebla text-tinta hover:bg-linea'}`}>
            {filtrarSinComprar ? 'Ver todos' : `${sinComprar} ${sinComprar === 1 ? 'dejó' : 'dejaron'} de comprar`}
          </button>
          {filtrarSinComprar && <>
            <button type="button" onClick={() => setEscribirles(true)} className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-niebla px-3 py-1.5 font-semibold hover:bg-linea">
              <MessageCircle size={15} aria-hidden="true" /> Escribirles
            </button>
            <span className="ml-2 text-apagado max-sm:mt-2 max-sm:block max-sm:ml-0">Sin pedido y su última entrega fue hace más de un mes.</span>
          </>}
        </div>
      )}
      <VisitasSinPedido titulo="Dejaron de comprar" clientes={escribirles ? clientes.filter(dejo) : []} abierta={escribirles} onCerrar={() => setEscribirles(false)} />
      <div className={panel ? 'mt-2 grid gap-x-10 lg:grid-cols-2' : 'flex-1 overflow-y-auto px-4 pt-2 pb-28'}>
        {!panel && MODO_SERVIDOR && <div className="col-span-full"><PorCobrar /></div>}
        <div ref={paginas.ancla} className="col-span-full scroll-mt-4" />
        {lista.length === 0 && (
          <div className="py-12 text-center text-apagado lg:col-span-2">
            {clientes.length ? 'Sin resultados' : 'Aún no hay clientes. Agrega el primero con «Nuevo cliente».'}
          </div>
        )}
        {paginas.visibles.map((c) => {
          const s = stats.get(c.id)
          const fav = favorito(c.id)
          return (
            <button key={c.id} onClick={() => setPerfilId(c.id)} className="flex w-full items-center gap-3 border-b border-linea py-3.5 text-left transition-colors hover:bg-niebla/40 active:bg-niebla">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-niebla text-lg font-semibold">
                {c.nombre.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-base leading-5 font-semibold"><Resaltar texto={c.nombre} t={t} /></div>
                <div className="mt-0.5 truncate text-sm text-apagado">
                  {telefonoCoincide(digitos, c.telefono) && <><b className="font-extrabold text-tinta underline decoration-limon decoration-[3px] underline-offset-2">{c.telefono}</b> · </>}
                  {textoFrecuencia(c.frecuencia)} · {c.ventana === 'MAÑANA' ? 'mañana' : 'tarde'}
                  {/* En línea con el texto: si no cabe, se recorta el nombre del sabor y no desaparece entero. */}
                  {fav && <> · <PuntoSabor color={fav.color_hex} className="h-2.5 w-2.5 align-middle" /> {fav.sabor}</>}
                </div>
                {dejo(c) && s?.ultima && <div className="mt-0.5 flex items-center gap-1 text-xs font-semibold"><TriangleAlert size={12} className="text-ambar" aria-hidden="true" /> Sin comprar desde el {textoFecha(s.ultima).toLowerCase()}</div>}
              </div>
              {s?.proximo && <div className="rounded-md bg-azul/10 px-2.5 py-1 text-xs font-semibold text-azul">{textoFecha(s.proximo)}</div>}
              <ChevronRight size={18} className="shrink-0 text-apagado/60" />
            </button>
          )
        })}
        {paginas.control}
      </div>
      {!panel && (
        <button onClick={() => setForm('nuevo')} className="fixed right-4 bottom-24 z-20 flex items-center gap-2 rounded-md bg-tinta px-5 py-4 font-semibold text-white shadow-tarjeta active:bg-neutral-700">
          <UserPlus size={20} /> Nuevo cliente
        </button>
      )}

      {imprimir && <ImpresionMasiva clientes={clientes} onCerrar={() => setImprimir(false)} />}
      <HojaLibreta abierta={libreta} onCerrar={() => setLibreta(false)} />
      {MODO_SERVIDOR && rol === 'administrador' && <HojaLimitesSugeridos abierta={sugerir} onCerrar={() => setSugerir(false)} />}
      {escaner && (
        <Suspense fallback={null}>
          <Escaner onCliente={(c) => { setEscaner(false); setPerfilId(c.id) }} onCerrar={() => setEscaner(false)} />
        </Suspense>
      )}
      {perfil && (
        <Perfil
          cliente={perfil}
          pedidos={pedidos.filter((p) => p.clienteId === perfil.id)}
          consumido={totalOCero([...(stats.get(perfil.id)?.sabores ?? [])].map(([productoId, litros]) => ({ productoId, litros })), productos)}
          favorito={favorito(perfil.id)}
          sabor={(id) => prod.get(id)}
          onCerrar={() => setPerfilId(null)}
          onEditar={() => setForm(perfil)}
        />
      )}
      {/* Después del perfil: al editar desde él, el formulario queda encima y no detrás. */}
      {form && <FormCliente cliente={form === 'nuevo' ? undefined : form} onCerrar={() => setForm(null)} />}
    </div>
  )
}

// Días promedio entre sus últimas entregas (hasta 10), o null con menos de tres.
function cadaCuanto(pedidos: Pedido[]): number | null {
  const fechas = [...new Set(pedidos.filter((p) => p.estado === 'ENTREGADO').map((p) => p.fecha))].sort().slice(-10)
  if (fechas.length < 3) return null
  const dia = (s: string) => Date.parse(`${s}T12:00:00`) / 864e5
  return Math.round((dia(fechas[fechas.length - 1]) - dia(fechas[0])) / (fechas.length - 1))
}

// Cada cuánto compra de verdad (promedio entre sus últimas entregas) y hace cuánto fue la última; con eso se ve si ya
// se tardó más de lo normal.
function RitmoDeCompra({ pedidos }: { pedidos: Pedido[] }) {
  const ultima = pedidos.filter((p) => p.estado === 'ENTREGADO').reduce((m, p) => (p.fecha > m ? p.fecha : m), '')
  if (!ultima) return null
  const hace = Math.round((Date.parse(`${hoy()}T12:00:00`) - Date.parse(`${ultima}T12:00:00`)) / 864e5)
  const cada = cadaCuanto(pedidos)
  const tarde = cada != null && cada > 0 && hace > cada * 1.5
  const texto = hace <= 0 ? 'su última entrega fue hoy' : hace === 1 ? 'su última entrega fue ayer' : `su última entrega fue hace ${hace} días`
  return (
    <p className={`text-sm ${tarde ? 'font-semibold text-tinta' : 'text-apagado'}`}>
      {tarde && <TriangleAlert size={14} className="mr-1 inline align-[-2px] text-ambar" aria-hidden="true" />}
      {cada != null ? `Compra cada ${cada <= 1 ? 'día' : `${cada} días`} en promedio; ${texto}` : `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`}
      {tarde && ': ya se tardó más de lo normal.'}
    </p>
  )
}

function Perfil({ cliente, pedidos, consumido, favorito, sabor, onCerrar, onEditar }: {
  cliente: Cliente
  pedidos: Pedido[]
  consumido: string // por unidad: «12 L», «60 L + 10 kg»
  favorito?: { sabor: string; color_hex: string }
  sabor: (id: string) => Producto | undefined
  onCerrar: () => void
  onEditar: () => void
}) {
  const [editor, setEditor] = useState<{ pedido?: Pedido; repetir?: Cantidades } | null>(null)
  const [codigos, setCodigos] = useState(false)
  const [cambiandoVendedor, setCambiandoVendedor] = useState(false)
  // RF-041: el administrador ve de quién es el cliente y puede pasarlo a otro vendedor (sólo si ya está en el servidor).
  const rol = useRol()
  const gestiona = MODO_SERVIDOR && rol === 'administrador' && cliente.version != null
  const limiteEmpresa = useMarca()?.limiteFiado ?? null
  const equipo = useEquipo()
  useEffect(() => {
    if (gestiona && !equipo) void cargarEquipo().catch(() => {})
  }, [gestiona]) // eslint-disable-line react-hooks/exhaustive-deps
  const vendedor = cliente.vendedorId ? equipo?.usuarios.find((u) => u.id === cliente.vendedorId)?.nombre ?? 'Asignado' : 'Sin vendedor'
  const ordenados = [...pedidos].sort((a, b) => b.fecha.localeCompare(a.fecha))
  const pendientes = ordenados.filter((p) => p.estado === 'PENDIENTE')
  const historial = ordenados.filter((p) => p.estado !== 'PENDIENTE').slice(0, 15)
  const ultima = historial.find((p) => p.estado === 'ENTREGADO')
  const base = useMemo(() => ({}), [])

  return (
    <Hoja abierta onCerrar={onCerrar} alto titulo={cliente.nombre}>
      <div className="space-y-5 pb-4">
        <div className="text-sm text-apagado">{cliente.direccion} · {textoFrecuencia(cliente.frecuencia)} · {cliente.ventana === 'MAÑANA' ? 'mañana' : 'tarde'}</div>
        <RitmoDeCompra pedidos={pedidos} />
        <div className="grid grid-cols-3 gap-2 text-center">
          <Dato valor={consumido} etiqueta="Consumidos" />
          <Dato valor={favorito?.sabor ?? '—'} etiqueta="Favorito" icono={favorito ? <PuntoSabor color={favorito.color_hex} className="h-2.5 w-2.5 align-[-1px]" /> : <Star size={12} className="inline" />} />
          <Dato valor={ultima ? textoFecha(ultima.fecha) : '—'} etiqueta="Última visita" />
        </div>
        <div className="grid grid-cols-5 gap-1">
          <Accion href={`tel:${cliente.telefono}`} icono={<Phone size={22} />} texto="Llamar" />
          <Accion href={`https://wa.me/${telLimpio(cliente.telefono)}`} icono={<MessageCircle size={22} />} texto="WhatsApp" />
          <Accion onClick={() => setCodigos(true)} icono={<QrCode size={22} />} texto="Código QR" />
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
        {gestiona && (
          <button onClick={() => setCambiandoVendedor(true)} className="flex w-full items-center gap-3 rounded-md bg-niebla px-4 py-3 text-left active:bg-linea">
            <UserCog size={20} className="shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-apagado">Vendedor</span>
              <span className="block truncate font-semibold">{vendedor}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-apagado/60" />
          </button>
        )}
        {gestiona && <PreciosDelCliente clienteId={cliente.id} nombre={cliente.nombre} />}
        {gestiona && <LimiteFiado cliente={cliente} />}
        <div className="flex gap-2">
          <Boton className="flex-1" onClick={() => setEditor({})}><ShoppingBag size={20} /> Nuevo pedido</Boton>
          {ultima && <Boton variante="secundario" className="flex-1" onClick={() => setEditor({ repetir: aCantidades(ultima.items) })}><RotateCcw size={20} /> Repetir el último</Boton>}
        </div>
        {MODO_SERVIDOR && cliente.version != null && <CuentaDelCliente clienteId={cliente.id} limite={cliente.limiteFiado ?? limiteEmpresa} telefono={cliente.telefono} />}

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
      {editor && <EditorPedido abierto cliente={cliente} pedido={editor.pedido} base={editor.repetir ?? base} onCerrar={() => setEditor(null)} />}
      {codigos && <FichaCodigos cliente={cliente} onCerrar={() => setCodigos(false)} />}
      {cambiandoVendedor && <CambiarVendedor cliente={cliente} onCerrar={() => setCambiandoVendedor(false)} />}
    </Hoja>
  )
}

function Dato({ valor, etiqueta, icono }: { valor: string; etiqueta: string; icono?: ReactNode }) {
  return (
    <div className="rounded-md bg-niebla px-2 py-3">
      <div className="truncate text-base font-semibold">{valor}</div>
      <div className="text-[11px] text-apagado">{icono} {etiqueta}</div>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-lg font-semibold tracking-tight">{titulo}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

const ETIQUETA_ESTADO = { PENDIENTE: 'Agendado', ENTREGADO: 'Entregado', OMITIDO: 'Omitido', RECORDAR_MAS_TARDE: 'Por confirmar' }

function FilaPedido({ p, sabor, onClick }: { p: Pedido; sabor: (id: string) => Producto | undefined; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 rounded-md bg-niebla px-3 py-3 text-left">
      <div className="w-20 shrink-0 text-sm font-medium">{textoFecha(p.fecha)}</div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {p.items.map((i) => (
          <span key={i.productoId} className="flex items-center gap-1 text-xs">
            <PuntoSabor color={sabor(i.productoId)?.color_hex} className="h-3 w-3" />
            {textoCantidad(i.litros, sabor(i.productoId))} {sabor(i.productoId)?.sabor}
          </span>
        ))}
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums">{dinero(p.total)}</div>
        <div className={`flex items-center justify-end gap-0.5 text-[10px] ${p.urgente && p.estado === 'PENDIENTE' ? 'font-bold text-rojo' : 'text-apagado'}`}>
          {p.urgente && p.estado === 'PENDIENTE' && <Flame size={10} />}
          {p.urgente && p.estado === 'PENDIENTE' ? 'Urgente' : ETIQUETA_ESTADO[p.estado]}
        </div>
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
                  className={`grid aspect-square place-items-center rounded-full text-xs font-semibold ${dias.includes(d) ? 'bg-tinta text-white' : 'bg-niebla text-tinta active:bg-linea'}`}
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
      marca.current = new Marker({ color: '#035d38', draggable: true }).setLngLat(punto).addTo(m)
      marca.current.on('dragend', () => {
        const ll = marca.current!.getLngLat()
        cb.current([ll.lng, ll.lat])
      })
      m.jumpTo({ center: punto, zoom: 16 })
    } else marca.current.setLngLat(punto)
  }, [punto])

  return <div ref={div} className="h-48 overflow-hidden rounded-lg bg-niebla" />
}

const FORMATOS_LIBRETA: Record<Formato, string> = {
  pdf: 'Un directorio listo para imprimir, en hoja horizontal: resumen por vendedor y los clientes de cada uno con teléfono, dirección, días de visita, última compra y lo que han comprado.',
  xlsx: 'Un libro de Excel con todos los clientes activos en una tabla con filtros: contacto, dirección, referencias, días y horario de visita, compras acumuladas y ubicación.',
  csv: 'La misma tabla que el Excel, en un archivo CSV para importarla en otro sistema.',
}

function HojaLibreta({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const [formato, setFormato] = useState<Formato>('pdf')
  const [bajando, setBajando] = useState(false)

  async function descargar() {
    setBajando(true)
    try {
      const nombre = await exportarLibreta(formato)
      if (nombre) aviso(`Se descargó ${nombre}`)
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo descargar')
    } finally {
      setBajando(false)
    }
  }

  return (
    <Hoja
      abierta={abierta}
      onCerrar={onCerrar}
      titulo="Libreta de clientes"
      pie={<Boton onClick={descargar} disabled={bajando} className="w-full">{formato === 'pdf' ? <Eye size={18} /> : <Download size={18} />} {bajando ? 'Preparando…' : formato === 'pdf' ? 'Ver vista previa' : 'Descargar'}</Boton>}
    >
      <p className="text-sm text-apagado">Todos los clientes activos de todos los vendedores, con sus datos al día de hoy.</p>
      <Segmentado
        valor={formato}
        onChange={setFormato}
        className="mt-3"
        opciones={[
          { valor: 'pdf', texto: <><FileDown size={16} /> PDF</> },
          { valor: 'xlsx', texto: <><FileSpreadsheet size={16} /> Excel</> },
          { valor: 'csv', texto: <><FileText size={16} /> CSV</> },
        ]}
      />
      <p className="mt-3 pb-4 text-sm text-apagado">{FORMATOS_LIBRETA[formato]}</p>
    </Hoja>
  )
}
