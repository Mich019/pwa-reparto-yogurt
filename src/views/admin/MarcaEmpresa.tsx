import { useEffect, useState } from 'react'
import { AlertCircle, Check, ImagePlus } from 'lucide-react'
import { colorLegible, guardarMarca, useMarca, type Marca } from '../../lib/marca'
import { COLORES_MARCA } from '../../lib/registro'
import { aviso, claseInput } from '../../components/ui'

// Configuración → Marca: el nombre, el logo y el color de la empresa (src/lib/marca.ts). Se ven en el panel, en la app de
// reparto de todo el equipo y en los PDF.

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const LOGO_MAXIMO = 500 * 1024

export function MarcaEmpresa() {
  const m = useMarca()
  const [borrador, setBorrador] = useState<Marca | null>(m)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (m && !borrador) setBorrador(m) }, [m, borrador])
  if (!m || !borrador) return <p className="text-sm text-apagado">Cargando…</p>

  const cambio = borrador.nombre.trim() !== m.nombre || borrador.color !== m.color || borrador.logo !== m.logo
  const color = borrador.color ?? '#035d38'
  const poner = (c: Partial<Marca>) => { setError(''); setBorrador({ ...borrador, ...c }) }

  function elegirLogo(f: File | undefined) {
    if (!f) return
    if (!f.type.startsWith('image/')) return setError('Elige una imagen (PNG, JPG, WEBP o SVG)')
    if (f.size > LOGO_MAXIMO) return setError('La imagen pesa más de 500 KB; prueba con una más chica')
    const lector = new FileReader()
    lector.onload = () => poner({ logo: String(lector.result) })
    lector.readAsDataURL(f)
  }

  async function guardar() {
    if (borrador!.nombre.trim().length < 2) return setError('Escribe el nombre de tu negocio')
    setGuardando(true)
    setError('')
    try {
      await guardarMarca({ nombre: borrador!.nombre.trim(), color: borrador!.color, logo: borrador!.logo })
      aviso('Marca guardada')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Nombre del negocio</span>
        <input value={borrador.nombre} onChange={(e) => poner({ nombre: e.target.value })} maxLength={120} className={claseInput} />
      </label>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Logo</span>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-linea bg-niebla transition-colors hover:border-marca ${anillo}`}>
            {borrador.logo ? <img src={borrador.logo} alt="Tu logo" className="h-full w-full object-contain p-1.5" /> : <ImagePlus size={26} className="text-apagado" />}
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => elegirLogo(e.target.files?.[0])} />
          </label>
          <div className="text-sm text-apagado">
            PNG, JPG o SVG, hasta 500 KB.
            {borrador.logo && (
              <button type="button" onClick={() => poner({ logo: null })} className="ml-2 font-semibold text-azul hover:underline">Quitar logo</button>
            )}
          </div>
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Color</span>
        <div className="flex flex-wrap items-center gap-2.5">
          {COLORES_MARCA.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => poner({ color: c })}
              aria-pressed={borrador.color === c}
              aria-label={`Color ${c}`}
              className={`grid h-11 w-11 place-items-center rounded-full ring-offset-2 ring-offset-papel transition-shadow ${borrador.color === c ? 'ring-[3px] ring-tinta' : ''} ${anillo}`}
              style={{ background: c }}
            >
              {borrador.color === c && <Check size={18} strokeWidth={3} className="text-white" />}
            </button>
          ))}
          <label className="flex h-11 items-center gap-2 rounded-full bg-niebla pr-4 pl-1.5 text-sm font-semibold">
            <input type="color" value={color} onChange={(e) => poner({ color: e.target.value })} className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent" />
            Otro
          </label>
        </div>
        {borrador.color && colorLegible(borrador.color) !== borrador.color.toLowerCase() && (
          <p className="mt-2 text-sm text-apagado">Es un color claro: en los botones lo oscurecemos un poco para que el texto blanco se lea.</p>
        )}
      </div>

      {/* Cómo se verá: el encabezado con el logo o la inicial, y un botón. */}
      <div className="overflow-hidden rounded-[22px] ring-1 ring-linea">
        <div className="flex items-center gap-3 bg-papel px-4 py-3">
          {borrador.logo
            ? <img src={borrador.logo} alt="" className="h-10 w-10 rounded-xl object-contain" />
            : <span className="grid h-10 w-10 place-items-center rounded-xl text-lg font-bold text-white" style={{ background: colorLegible(color) }}>{borrador.nombre.trim().charAt(0).toUpperCase()}</span>}
          <span className="truncate font-semibold">{borrador.nombre || 'Tu negocio'}</span>
        </div>
        <div className="bg-niebla p-4">
          <div className="rounded-full py-3 text-center text-sm font-semibold text-white" style={{ background: colorLegible(color) }}>Nuevo pedido</div>
        </div>
      </div>

      {error && <p role="alert" className="flex items-center gap-2 text-sm font-medium text-rojo"><AlertCircle size={15} className="shrink-0" /> {error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={!cambio || guardando}
          className={`rounded-full bg-tinta px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-marca-oscuro disabled:opacity-40 ${anillo}`}
        >
          {guardando ? 'Guardando…' : 'Guardar marca'}
        </button>
        {cambio && (
          <button type="button" onClick={() => { setError(''); setBorrador(m) }} className={`rounded-full bg-niebla px-5 py-3 text-sm font-semibold hover:bg-linea ${anillo}`}>
            Deshacer
          </button>
        )}
      </div>
    </div>
  )
}
