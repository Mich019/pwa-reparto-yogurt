import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Plus, Trash2, Upload } from 'lucide-react'
import { borrar, db, guardar, guardarVarios, uid, type Producto } from '../../lib/db'
import { dinero, hoy } from '../../lib/fechas'
import { borrarTodo } from '../../lib/demo'
import { MODO_SERVIDOR } from '../../lib/api'
import { Boton, Campo, Hoja, PuntoSabor, aviso, claseInput } from '../../components/ui'
import { TIPOS_ENVASE } from '../../lib/registro'
import { formato, nombreUnidad, presentacionDe, unidadDe } from '../../lib/unidades'

const COLORES = ['#f472b6', '#f5ecd7', '#fdba74', '#facc15', '#b45309', '#7e22ce', '#ef4444', '#22c55e', '#38bdf8', '#a3e635']

export function Ajustes() {
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), []) ?? []
  const [editando, setEditando] = useState<Producto | 'nuevo' | null>(null)

  return (
    <div className="h-full overflow-y-auto px-4 pt-safe pb-24">
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Sabores y datos</h1>

      <div className="mt-4 space-y-2">
        {productos.map((p) => (
          <button key={p.id} onClick={() => setEditando(p)} className={`flex w-full items-center gap-3 rounded-2xl bg-niebla p-3 text-left ${p.disponible ? '' : 'opacity-50'}`}>
            <PuntoSabor color={p.color_hex} className="h-11 w-11" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{p.sabor} {!p.disponible && <span className="text-xs font-normal text-apagado">(sin stock)</span>}</div>
              {p.descripcion && <div className="truncate text-xs text-apagado">{p.descripcion}</div>}
              <div className="text-xs text-apagado">
                Venta {dinero(p.precio_litro)}/{unidadDe(p)} · Costo {dinero(p.costo_litro)}/{unidadDe(p)}{presentacionDe(p) && ` · ${presentacionDe(p)}`}
              </div>
            </div>
            <div className="text-sm font-semibold text-verde">+{dinero(p.precio_litro - p.costo_litro)}</div>
          </button>
        ))}
        <Boton variante="secundario" className="w-full" onClick={() => setEditando('nuevo')}><Plus size={18} /> Nuevo sabor</Boton>
      </div>

      <h2 className="mt-8 text-2xl font-semibold tracking-tight">Tus datos</h2>
      <DatosYRespaldo />

      {editando && (
        <FormSabor
          producto={editando === 'nuevo' ? undefined : editando}
          tieneVentas={editando !== 'nuevo' && pedidos.some((p) => p.items.some((i) => i.productoId === editando.id))}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  )
}

// Respaldo, restauración y (sin servidor) borrado de datos. `equipo` es el aparato donde se guarda: el teléfono, o la
// computadora en el panel de administración.
export function DatosYRespaldo({ equipo = 'teléfono' }: { equipo?: string }) {
  const cola = useLiveQuery(() => db.cola.count(), []) ?? 0
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)

  async function exportar() {
    const datos = {
      version: 1,
      exportado: new Date().toISOString(),
      clientes: await db.clientes.toArray(),
      productos: await db.productos.toArray(),
      pedidos: await db.pedidos.toArray(),
      recordatorios: await db.recordatorios.toArray(),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `respaldo-yogurt-${hoy()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importar(f: File) {
    try {
      const d = JSON.parse(await f.text())
      if (d.version !== 1) throw new Error()
      // Pasa por la cola para que, con servidor, lo restaurado también se sincronice.
      await guardarVarios('productos', d.productos)
      await guardarVarios('clientes', d.clientes)
      await guardarVarios('pedidos', d.pedidos)
      await guardarVarios('recordatorios', d.recordatorios ?? [])
      aviso('Respaldo restaurado')
    } catch {
      aviso('Ese archivo no es un respaldo válido')
    }
  }

  return (
    <>
      <p className="mt-1 text-sm text-apagado">
        Todo se guarda en este {equipo} y funciona sin internet.
        {MODO_SERVIDOR
          ? cola > 0 ? <> Hay {cola} cambios por enviar al servidor; salen solos cuando haya señal.</> : <> Se sincroniza solo con el servidor.</>
          : <> Mientras no haya servidor, descarga un respaldo seguido.{cola > 0 && <> Hay {cola} cambios listos para subir cuando se conecte el servidor.</>}</>}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Boton variante="secundario" onClick={exportar}><Download size={18} /> Respaldo</Boton>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-niebla px-4 py-4 font-semibold active:bg-linea">
          <Upload size={18} /> Restaurar
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
        </label>
      </div>
      {/* Con servidor los clientes y pedidos son de toda la empresa: borrarlos aquí los quitaría también del servidor. */}
      {!MODO_SERVIDOR && (
        <Boton variante="peligro" className="mt-2 w-full" onClick={() => setConfirmarBorrado(true)}><Trash2 size={18} /> Borrar clientes y pedidos</Boton>
      )}
      <Hoja abierta={confirmarBorrado} onCerrar={() => setConfirmarBorrado(false)} titulo="¿Borrar todo?">
        <div className="space-y-3 pb-3">
          <p className="text-apagado">Se borran clientes, pedidos y recordatorios de este {equipo}. Los sabores se quedan. No se puede deshacer.</p>
          <Boton variante="peligro" className="w-full" onClick={async () => { await borrarTodo(); localStorage.removeItem('ruta-del-dia'); setConfirmarBorrado(false); aviso('Datos borrados') }}>Sí, borrar</Boton>
        </div>
      </Hoja>
    </>
  )
}

export function FormSabor({ producto, tieneVentas, onCerrar }: { producto?: Producto; tieneVentas: boolean; onCerrar: () => void }) {
  const [sabor, setSabor] = useState(producto?.sabor ?? '')
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? '')
  const [presentacion, setPresentacion] = useState(String(producto?.presentacion ?? 1))
  // Catálogo flexible (src/lib/unidades.ts): en qué se mide y en qué se entrega. Como la presentación, sólo al crearlo.
  const [unidad, setUnidad] = useState(producto ? unidadDe(producto) : 'L')
  const [tipoEnvase, setTipoEnvase] = useState(producto?.envase ?? '')
  const [precio, setPrecio] = useState(String(producto?.precio_litro ?? ''))
  const [costo, setCosto] = useState(String(producto?.costo_litro ?? ''))
  const [color, setColor] = useState(producto?.color_hex ?? COLORES[0])
  const [disponible, setDisponible] = useState(producto?.disponible ?? true)
  // RF-032: contenido por envase. Se elige al crear el sabor y ya no cambia: lo vendido se guarda en envases de ese tamaño.
  const envase = producto ? (producto.presentacion ?? 1) : Math.round(Number(presentacion.replace(',', '.')) * 100) / 100

  async function guardarSabor() {
    if (!sabor.trim() || !Number(precio)) return aviso('Falta nombre o precio')
    if (!(envase > 0 && envase <= 999)) return aviso(`La presentación es lo que trae cada envase en ${unidad}, por ejemplo 1 o 0.5`)
    if (!unidad.trim()) return aviso('Escribe la unidad, por ejemplo L, kg o pz')
    await guardar('productos', {
      id: producto?.id ?? uid(), sabor: sabor.trim(), descripcion: descripcion.trim(), presentacion: envase,
      ...(producto ? { unidad: producto.unidad, envase: producto.envase } : { unidad: unidad.trim(), envase: tipoEnvase || undefined }),
      precio_litro: Number(precio), costo_litro: Number(costo) || 0, color_hex: color, disponible,
    })
    onCerrar()
  }

  return (
    <Hoja abierta onCerrar={onCerrar} titulo={producto ? 'Editar sabor' : 'Nuevo sabor'}>
      <div className="space-y-4 pb-4">
        <Campo etiqueta="Sabor"><input className={claseInput} value={sabor} onChange={(e) => setSabor(e.target.value)} placeholder="Ej. Fresa" /></Campo>
        <Campo etiqueta="Descripción (opcional)">
          <textarea className={claseInput} rows={2} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Con trozos de fresa, endulzado con miel" />
        </Campo>
        {producto ? (
          <div className="rounded-xl bg-niebla px-4 py-3 text-sm">
            Presentación: <b>{presentacionDe(producto) ?? `por ${nombreUnidad(unidad, 1)}`}</b>. <span className="text-apagado">Se elige al crear el sabor.</span>
          </div>
        ) : (
          <>
            <Campo etiqueta="Se mide en">
              <div className="flex flex-wrap gap-2">
                {['L', 'kg', 'pz'].map((u) => (
                  <button key={u} type="button" onClick={() => setUnidad(u)} className={`rounded-full px-4 py-2.5 text-sm font-semibold ${unidad === u ? 'bg-tinta text-white' : 'bg-niebla'}`}>
                    {nombreUnidad(u, 2)}
                  </button>
                ))}
                <input className={`${claseInput.replace('w-full', '')} w-28 py-2.5`} value={['L', 'kg', 'pz'].includes(unidad) ? '' : unidad} onChange={(e) => setUnidad(e.target.value.slice(0, 10))} placeholder="Otra" aria-label="Otra unidad" />
              </div>
            </Campo>
            <Campo etiqueta="Envase">
              <select className={claseInput} value={tipoEnvase} onChange={(e) => setTipoEnvase(e.target.value)}>
                <option value="">Sin envase (se vende suelto)</option>
                {TIPOS_ENVASE.filter((t) => t.tipo !== 'pieza' && t.tipo !== 'granel').map((t) => <option key={t.tipo} value={t.tipo}>{t.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta={`Contenido por envase (en ${unidad || 'la unidad'})`}>
              <input className={claseInput} inputMode="decimal" value={presentacion} onChange={(e) => setPresentacion(e.target.value)} placeholder="Ej. 1, 0.5 o 20" />
            </Campo>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta={`Precio por ${nombreUnidad(unidad, 1)}`}><input className={claseInput} inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} /></Campo>
          <Campo etiqueta={`Costo por ${nombreUnidad(unidad, 1)}`}><input className={claseInput} inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>
        </div>
        {envase > 0 && (envase !== 1 || tipoEnvase) && Number(precio) > 0 && (
          <p className="-mt-2 text-xs text-apagado">Cada envase de {formato(envase)} {unidad} se vende en {dinero(Number(precio) * envase)} y cuesta {dinero((Number(costo) || 0) * envase)}.</p>
        )}
        <div>
          <div className="mb-1.5 text-sm font-semibold text-apagado">Color</div>
          <div className="flex flex-wrap gap-2">
            {COLORES.map((c) => (
              <button key={c} onClick={() => setColor(c)} className={`h-10 w-10 rounded-full ${color === c ? 'ring-2 ring-tinta ring-offset-2' : ''}`} style={{ background: c }} aria-label={c} />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-10 rounded-full bg-transparent" />
          </div>
        </div>
        <label className="flex items-center justify-between rounded-xl bg-niebla px-4 py-3">
          <span className="font-semibold">Disponible</span>
          <input type="checkbox" checked={disponible} onChange={(e) => setDisponible(e.target.checked)} className="h-6 w-6 accent-black" />
        </label>
        <Boton className="w-full" onClick={guardarSabor}>Guardar</Boton>
        {producto && !tieneVentas && (
          <Boton variante="peligro" className="w-full" onClick={async () => { await borrar('productos', producto.id); onCerrar() }}>Eliminar sabor</Boton>
        )}
      </div>
    </Hoja>
  )
}
