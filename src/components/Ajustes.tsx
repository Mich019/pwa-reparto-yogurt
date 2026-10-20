import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, Plus, Trash2, Upload } from 'lucide-react'
import { borrar, db, guardar, uid, type Producto } from '../lib/db'
import { dinero, hoy } from '../lib/fechas'
import { borrarTodo } from '../lib/demo'
import { Boton, Campo, Hoja, aviso, claseInput } from './ui'

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
      await db.transaction('rw', [db.clientes, db.productos, db.pedidos, db.recordatorios], async () => {
        await db.clientes.bulkPut(d.clientes)
        await db.productos.bulkPut(d.productos)
        await db.pedidos.bulkPut(d.pedidos)
        await db.recordatorios.bulkPut(d.recordatorios ?? [])
      })
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
            <span className="h-11 w-11 shrink-0 rounded-full border border-black/10" style={{ background: p.color_hex }} />
            <div className="flex-1">
              <div className="font-semibold">{p.sabor} {!p.disponible && <span className="text-xs font-normal text-apagado">(sin stock)</span>}</div>
              <div className="text-xs text-apagado">Venta {dinero(p.precio_litro)}/L · Costo {dinero(p.costo_litro)}/L</div>
            </div>
            <div className="text-sm font-semibold text-verde">+{dinero(p.precio_litro - p.costo_litro)}</div>
          </button>
        ))}
        <Boton variante="secundario" className="w-full" onClick={() => setEditando('nuevo')}><Plus size={18} /> Nuevo sabor</Boton>
      </div>

      <h2 className="mt-8 text-2xl font-semibold tracking-tight">Tus datos</h2>
      <p className="mt-1 text-sm text-apagado">
        Todo se guarda en este teléfono y funciona sin internet. Mientras no haya servidor, descarga un respaldo seguido.
        {cola > 0 && <> Hay {cola} cambios listos para subir cuando se conecte el servidor.</>}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Boton variante="secundario" onClick={exportar}><Download size={18} /> Respaldo</Boton>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-niebla px-4 py-4 font-semibold active:bg-linea">
          <Upload size={18} /> Restaurar
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
        </label>
      </div>
      <Boton variante="peligro" className="mt-2 w-full" onClick={() => setConfirmarBorrado(true)}><Trash2 size={18} /> Borrar clientes y pedidos</Boton>

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
          <Boton variante="peligro" className="w-full" onClick={async () => { await borrarTodo(); localStorage.clear(); setConfirmarBorrado(false); aviso('Datos borrados') }}>Sí, borrar</Boton>
        </div>
      </Hoja>
    </div>
  )
}

function FormSabor({ producto, tieneVentas, onCerrar }: { producto?: Producto; tieneVentas: boolean; onCerrar: () => void }) {
  const [sabor, setSabor] = useState(producto?.sabor ?? '')
  const [precio, setPrecio] = useState(String(producto?.precio_litro ?? ''))
  const [costo, setCosto] = useState(String(producto?.costo_litro ?? ''))
  const [color, setColor] = useState(producto?.color_hex ?? COLORES[0])
  const [disponible, setDisponible] = useState(producto?.disponible ?? true)

  async function guardarSabor() {
    if (!sabor.trim() || !Number(precio)) return aviso('Falta nombre o precio')
    await guardar('productos', { id: producto?.id ?? uid(), sabor: sabor.trim(), precio_litro: Number(precio), costo_litro: Number(costo) || 0, color_hex: color, disponible })
    onCerrar()
  }

  return (
    <Hoja abierta onCerrar={onCerrar} titulo={producto ? 'Editar sabor' : 'Nuevo sabor'}>
      <div className="space-y-4 pb-4">
        <Campo etiqueta="Sabor"><input className={claseInput} value={sabor} onChange={(e) => setSabor(e.target.value)} placeholder="Ej. Fresa" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Precio por litro"><input className={claseInput} inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} /></Campo>
          <Campo etiqueta="Costo por litro"><input className={claseInput} inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>
        </div>
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
