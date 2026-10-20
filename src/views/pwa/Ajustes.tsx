import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Plus, Trash2, Upload } from 'lucide-react'
import { borrar, db, guardar, guardarVarios, uid, type Producto } from '../../lib/db'
import { dinero, hoy } from '../../lib/fechas'
import { borrarTodo } from '../../lib/demo'
import { MODO_SERVIDOR } from '../../lib/api'
import { Insignia } from '../../components/Fruta'
import { Boton, Campo, Hoja, aviso, claseInput } from '../../components/ui'

const COLORES = ['#f472b6', '#f5ecd7', '#fdba74', '#facc15', '#b45309', '#7e22ce', '#ef4444', '#22c55e', '#38bdf8', '#a3e635']

export function Ajustes() {
  const productos = useLiveQuery(() => db.productos.toArray(), []) ?? []
  const pedidos = useLiveQuery(() => db.pedidos.toArray(), []) ?? []
  const cola = useLiveQuery(() => db.cola.count(), []) ?? 0
  const [editando, setEditando] = useState<Producto | 'nuevo' | null>(null)
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
    <div className="h-full overflow-y-auto px-4 pt-safe pb-24">
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Sabores y datos</h1>

      <div className="mt-4 space-y-2">
        {productos.map((p) => (
          <button key={p.id} onClick={() => setEditando(p)} className={`flex w-full items-center gap-3 rounded-2xl bg-niebla p-3 text-left ${p.disponible ? '' : 'opacity-50'}`}>
            <Insignia sabor={p.sabor} color={p.color_hex} size={48} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{p.sabor} {!p.disponible && <span className="text-xs font-normal text-apagado">(sin stock)</span>}</div>
              {p.descripcion && <div className="truncate text-xs text-apagado">{p.descripcion}</div>}
              <div className="text-xs text-apagado">
                Venta {dinero(p.precio_litro)}/L · Costo {dinero(p.costo_litro)}/L{(p.presentacion ?? 1) !== 1 && ` · envase de ${p.presentacion} L`}
              </div>
            </div>
            <div className="text-sm font-semibold text-verde">+{dinero(p.precio_litro - p.costo_litro)}</div>
          </button>
        ))}
        <Boton variante="secundario" className="w-full" onClick={() => setEditando('nuevo')}><Plus size={18} /> Nuevo sabor</Boton>
      </div>

      <h2 className="mt-8 text-2xl font-semibold tracking-tight">Tus datos</h2>
      <p className="mt-1 text-sm text-apagado">
        Todo se guarda en este teléfono y funciona sin internet.
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

      {editando && (
        <FormSabor
          producto={editando === 'nuevo' ? undefined : editando}
          tieneVentas={editando !== 'nuevo' && pedidos.some((p) => p.items.some((i) => i.productoId === editando.id))}
          onCerrar={() => setEditando(null)}
        />
      )}
      <Hoja abierta={confirmarBorrado} onCerrar={() => setConfirmarBorrado(false)} titulo="¿Borrar todo?">
        <div className="space-y-3 pb-3">
          <p className="text-apagado">Se borran clientes, pedidos y recordatorios de este teléfono. Los sabores se quedan. No se puede deshacer.</p>
          <Boton variante="peligro" className="w-full" onClick={async () => { await borrarTodo(); localStorage.removeItem('ruta-del-dia'); setConfirmarBorrado(false); aviso('Datos borrados') }}>Sí, borrar</Boton>
        </div>
      </Hoja>
    </div>
  )
}

function FormSabor({ producto, tieneVentas, onCerrar }: { producto?: Producto; tieneVentas: boolean; onCerrar: () => void }) {
  const [sabor, setSabor] = useState(producto?.sabor ?? '')
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? '')
  const [presentacion, setPresentacion] = useState(String(producto?.presentacion ?? 1))
  const [precio, setPrecio] = useState(String(producto?.precio_litro ?? ''))
  const [costo, setCosto] = useState(String(producto?.costo_litro ?? ''))
  const [color, setColor] = useState(producto?.color_hex ?? COLORES[0])
  const [disponible, setDisponible] = useState(producto?.disponible ?? true)
  // RF-032: litros por envase. Se elige al crear el sabor y ya no cambia: lo vendido se guarda en envases de ese tamaño.
  const envase = producto ? (producto.presentacion ?? 1) : Math.round(Number(presentacion.replace(',', '.')) * 100) / 100

  async function guardarSabor() {
    if (!sabor.trim() || !Number(precio)) return aviso('Falta nombre o precio')
    if (!(envase > 0 && envase <= 999)) return aviso('La presentación son los litros de cada envase, por ejemplo 1 o 0.5')
    await guardar('productos', {
      id: producto?.id ?? uid(), sabor: sabor.trim(), descripcion: descripcion.trim(), presentacion: envase,
      precio_litro: Number(precio), costo_litro: Number(costo) || 0, color_hex: color, disponible,
    })
    onCerrar()
  }

  return (
    <Hoja abierta onCerrar={onCerrar} titulo={producto ? 'Editar sabor' : 'Nuevo sabor'}>
      <div className="space-y-4 pb-4">
        <div className="flex items-center gap-3">
          <Insignia sabor={sabor} color={color} size={56} />
          <p className="text-sm text-apagado">El ícono se elige solo según el nombre: fresa, mango, durazno, nuez, zarzamora, plátano…</p>
        </div>
        <Campo etiqueta="Sabor"><input className={claseInput} value={sabor} onChange={(e) => setSabor(e.target.value)} placeholder="Ej. Fresa" /></Campo>
        <Campo etiqueta="Descripción (opcional)">
          <textarea className={claseInput} rows={2} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej. Con trozos de fresa, endulzado con miel" />
        </Campo>
        {producto ? (
          <div className="rounded-xl bg-niebla px-4 py-3 text-sm">
            Presentación: <b>envase de {envase} L</b>. <span className="text-apagado">Se elige al crear el sabor.</span>
          </div>
        ) : (
          <Campo etiqueta="Presentación (litros por envase)">
            <input className={claseInput} inputMode="decimal" value={presentacion} onChange={(e) => setPresentacion(e.target.value)} placeholder="Ej. 1 o 0.5" />
          </Campo>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Precio por litro"><input className={claseInput} inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} /></Campo>
          <Campo etiqueta="Costo por litro"><input className={claseInput} inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>
        </div>
        {envase > 0 && envase !== 1 && Number(precio) > 0 && (
          <p className="-mt-2 text-xs text-apagado">El envase de {envase} L se vende en {dinero(Number(precio) * envase)} y cuesta {dinero((Number(costo) || 0) * envase)}.</p>
        )}
        <div>
          <div className="mb-1.5 text-sm font-semibold text-apagado">Color de acento</div>
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
