import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, Check, CheckCircle2, ChevronDown, ImagePlus, Sparkles } from 'lucide-react'
import { colorLegible, guardarMarca, useMarca, type Marca } from '../../lib/marca'
import { prepararLogo, revisarLogo, type RevisionLogo } from '../../lib/logo'
import { COLORES_MARCA } from '../../lib/registro'
import { aviso, claseInput } from '../../components/ui'

// Configuración → Marca: nombre, lema, logo, color y contacto de la empresa (src/lib/marca.ts). Se ven en el panel, en
// la app de reparto de todo el equipo y en los PDF. El logo se revisa y se arregla aquí mismo (src/lib/logo.ts).

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const SVG_MAXIMO = 500 * 1024
const IMAGEN_MAXIMA = 15 * 1024 * 1024 // se reduce a 512 px antes de guardarla

type Borrador = Marca & { lema: string; contacto: string }
const aBorrador = (m: Marca): Borrador => ({ ...m, lema: m.lema ?? '', contacto: m.contacto ?? '' })

export function MarcaEmpresa() {
  const m = useMarca()
  const [borrador, setBorrador] = useState<Borrador | null>(m && aBorrador(m))
  const [guardando, setGuardando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState<RevisionLogo | null>(null)
  const [original, setOriginal] = useState<string | null>(null) // el logo antes de quitarle el fondo, para deshacerlo
  useEffect(() => { if (m && !borrador) setBorrador(aBorrador(m)) }, [m, borrador])
  const logoActual = borrador?.logo ?? null
  useEffect(() => {
    setRevision(null)
    if (!logoActual) return
    let vigente = true
    revisarLogo(logoActual).then((r) => { if (vigente) setRevision(r) }).catch(() => {})
    return () => { vigente = false }
  }, [logoActual])
  if (!m || !borrador) return <p className="text-sm text-apagado">Cargando…</p>

  const cambio = borrador.nombre.trim() !== m.nombre || borrador.color !== m.color || borrador.logo !== m.logo
    || borrador.lema.trim() !== (m.lema ?? '') || borrador.contacto.trim() !== (m.contacto ?? '')
  const color = borrador.color ?? '#035d38'
  const poner = (c: Partial<Borrador>) => { setError(''); setBorrador({ ...borrador, ...c }) }

  async function elegirLogo(f: File | undefined) {
    if (!f) return
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type)) return setError('Elige una imagen PNG, JPG, WEBP o SVG')
    if (f.size > (f.type === 'image/svg+xml' ? SVG_MAXIMO : IMAGEN_MAXIMA)) return setError(f.type === 'image/svg+xml' ? 'El SVG pesa más de 500 KB; expórtalo simplificado' : 'La imagen pesa más de 15 MB')
    setProcesando(true)
    setError('')
    try {
      setOriginal(null)
      poner({ logo: await prepararLogo(f) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer esa imagen')
    } finally {
      setProcesando(false)
    }
  }

  async function quitarFondo() {
    if (!borrador!.logo) return
    setProcesando(true)
    try {
      const blob = await (await fetch(borrador!.logo)).blob()
      const limpio = await prepararLogo(new File([blob], 'logo', { type: blob.type }), { quitarFondo: true })
      setOriginal(borrador!.logo)
      poner({ logo: limpio })
    } catch {
      setError('No se pudo quitar el fondo; prueba con un PNG transparente')
    } finally {
      setProcesando(false)
    }
  }

  function soltar(e: DragEvent) {
    e.preventDefault()
    void elegirLogo(e.dataTransfer.files?.[0])
  }

  async function guardar() {
    if (borrador!.nombre.trim().length < 2) return setError('Escribe el nombre de tu negocio')
    setGuardando(true)
    setError('')
    try {
      await guardarMarca({
        nombre: borrador!.nombre.trim(), color: borrador!.color, logo: borrador!.logo,
        lema: borrador!.lema.trim() || null, contacto: borrador!.contacto.trim() || null,
      })
      setOriginal(null)
      aviso('Marca guardada')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  const iniciales = borrador.nombre.trim().charAt(0).toUpperCase()
  const fondoBoton = colorLegible(color)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-apagado">Nombre del negocio</span>
          <input value={borrador.nombre} onChange={(e) => poner({ nombre: e.target.value })} maxLength={120} className={claseInput} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-apagado">Lema <span className="font-normal">(opcional)</span></span>
          <input value={borrador.lema} onChange={(e) => poner({ lema: e.target.value })} maxLength={80} placeholder="Ej. Frescura que llega a tu puerta" className={claseInput} />
        </label>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Logo</span>
        <div className="flex flex-wrap items-start gap-4">
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={soltar}
            className={`grid h-28 w-28 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-2xl border-2 border-dashed border-linea bg-niebla transition-colors hover:border-marca ${anillo} ${procesando ? 'animate-pulse' : ''}`}
          >
            {borrador.logo
              ? <img src={borrador.logo} alt="Tu logo" className="h-full w-full object-contain p-2" />
              : <span className="flex flex-col items-center gap-1 px-2 text-center text-xs font-semibold text-apagado"><ImagePlus size={26} aria-hidden="true" />Súbelo o arrástralo aquí</span>}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="sr-only"
              onChange={(e) => { void elegirLogo(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {borrador.logo && (
            <div className="flex gap-3" aria-label="Así se ve sobre fondo claro y oscuro">
              <div className="grid h-28 w-28 place-items-center rounded-2xl bg-white p-3 ring-1 ring-linea">
                <img src={borrador.logo} alt="" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="grid h-28 w-28 place-items-center rounded-2xl bg-neutral-900 p-3">
                <img src={borrador.logo} alt="" className="max-h-full max-w-full object-contain" />
              </div>
            </div>
          )}
          <div className="flex min-w-48 flex-1 flex-col items-start gap-1.5 text-sm text-apagado">
            <span>PNG sin fondo o SVG. Recortamos los márgenes vacíos y lo reducimos solos.</span>
            {borrador.logo && (
              <button type="button" onClick={() => { setOriginal(null); poner({ logo: null }) }} className="font-semibold text-azul hover:underline">Quitar logo</button>
            )}
          </div>
        </div>

        {borrador.logo && revision && (
          <ul className="mt-4 space-y-2.5 text-sm">
            {revision.vectorial || revision.transparente
              ? <Consejo ok>{revision.vectorial ? 'SVG: nítido en cualquier tamaño.' : 'Sin fondo: se ve bien sobre cualquier color.'}</Consejo>
              : revision.fondo
                ? (
                  <Consejo>
                    Tu logo trae un fondo <Muestra color={revision.fondo} />: en la app se verá como un recuadro.{' '}
                    <button type="button" onClick={() => void quitarFondo()} disabled={procesando}
                      className={`inline-flex items-center gap-1 font-semibold text-azul hover:underline disabled:opacity-40 ${anillo}`}>
                      <Sparkles size={14} aria-hidden="true" /> {procesando ? 'Quitando…' : 'Quitar el fondo'}
                    </button>
                  </Consejo>
                )
                : <Consejo>Tiene fondo con dibujo o degradado: no lo podemos quitar solos. Si puedes, súbelo como PNG transparente.</Consejo>}
            {original && (
              <li className="pl-7 text-apagado">
                ¿Se borró de más? <button type="button" onClick={() => { poner({ logo: original }); setOriginal(null) }} className="font-semibold text-azul hover:underline">Volver al original</button>
              </li>
            )}
            {!revision.vectorial && (Math.max(revision.ancho, revision.alto) < 200
              ? <Consejo>Es pequeño ({revision.ancho} × {revision.alto} px) y se verá borroso. Súbelo de al menos 400 px de ancho.</Consejo>
              : <Consejo ok>Buena resolución.</Consejo>)}
            {revision.ancho / Math.max(1, revision.alto) > 3.5
              ? <Consejo>Es muy alargado: en el teléfono se verá chico. Si tienes la versión con sólo el símbolo, súbela.</Consejo>
              : <Consejo ok>Proporción cómoda para el encabezado y los envases.</Consejo>}
            {revision.claro && <Consejo>Es casi blanco: sobre fondo claro apenas se ve. Mejor la versión a color u oscura.</Consejo>}
            {revision.oscuro && <Consejo>Es casi negro: en modo oscuro se pierde. Si tienes una versión con color, úsala.</Consejo>}
          </ul>
        )}

        <details className="group mt-4 text-sm">
          <summary className={`inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-azul hover:underline ${anillo}`}>
            Cómo preparar tu logo <ChevronDown size={15} className="transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-relaxed text-apagado">
            <li><b className="text-tinta">Sin fondo.</b> Descárgalo como PNG con fondo transparente o como SVG. En Canva: Compartir → Descargar → PNG → «Fondo transparente».</li>
            <li><b className="text-tinta">Sólo tienes JPG o una foto?</b> Si el fondo es de un solo color (blanco, por ejemplo), súbelo y toca «Quitar el fondo».</li>
            <li><b className="text-tinta">Compacto.</b> Un logo cuadrado o poco alargado se lee mejor en el teléfono. Evita letras muy pequeñas.</li>
            <li><b className="text-tinta">Con contraste.</b> Revisa las dos muestras de arriba: debe leerse en fondo claro y en oscuro.</li>
            <li><b className="text-tinta">Nítido.</b> De al menos 400 px de ancho. No hace falta que pese poco: lo reducimos nosotros.</li>
          </ul>
        </details>
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Color</span>
        <div className="flex flex-wrap items-center gap-2.5">
          {COLORES_MARCA.map((c) => <BotonColor key={c} c={c} activo={borrador.color === c} onClick={() => poner({ color: c })} />)}
          <label className="flex h-11 items-center gap-2 rounded-full bg-niebla pr-4 pl-1.5 text-sm font-semibold">
            <input type="color" value={color} onChange={(e) => poner({ color: e.target.value })} className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent" />
            Otro
          </label>
        </div>
        {borrador.logo && revision && revision.colores.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span className="text-sm text-apagado">De tu logo:</span>
            {revision.colores.map((c) => <BotonColor key={c} c={c} activo={borrador.color === c} onClick={() => poner({ color: c })} />)}
          </div>
        )}
        {borrador.color && colorLegible(borrador.color) !== borrador.color.toLowerCase() && (
          <p className="mt-2 text-sm text-apagado">Es un color claro: en los botones lo oscurecemos un poco para que el texto blanco se lea.</p>
        )}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Contacto en los documentos <span className="font-normal">(opcional)</span></span>
        <input value={borrador.contacto} onChange={(e) => poner({ contacto: e.target.value })} maxLength={160}
          placeholder="Ej. Tel. 55 1234 5678 · Av. Juárez 12, Centro · tunegocio.mx" className={claseInput} />
        <span className="mt-1 block text-xs text-apagado">Sale al pie de los reportes y la libreta de clientes en PDF.</span>
      </label>

      {/* Cómo se verá: el encabezado de la app, un botón y la cabecera de un PDF. */}
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-apagado">Así se verá</span>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="overflow-hidden rounded-[22px] ring-1 ring-linea">
            <div className="flex items-center gap-3 bg-papel px-4 py-3">
              {borrador.logo
                ? <img src={borrador.logo} alt="" className="h-10 max-w-[8rem] object-contain" />
                : <span className="grid h-10 w-10 place-items-center rounded-xl text-lg font-bold text-white" style={{ background: fondoBoton }}>{iniciales}</span>}
              <span className="truncate font-semibold">{borrador.nombre || 'Tu negocio'}</span>
            </div>
            <div className="bg-niebla p-4">
              <div className="rounded-full py-3 text-center text-sm font-semibold text-white" style={{ background: fondoBoton }}>Nuevo pedido</div>
            </div>
          </div>
          <div aria-label="Cabecera y pie de un PDF" className="flex min-h-36 flex-col overflow-hidden rounded-[22px] bg-white text-neutral-900 ring-1 ring-linea">
            <div className="h-1.5" style={{ background: fondoBoton }} />
            <div className="flex-1 px-4 pt-3">
              <p className="truncate text-[10px] font-bold tracking-wide">
                <span style={{ color: fondoBoton }}>{(borrador.nombre || 'Tu negocio').toUpperCase()}</span>
                {borrador.lema.trim() && <span className="ml-1.5 font-normal tracking-normal text-neutral-500">{borrador.lema.trim()}</span>}
              </p>
              <p className="mt-1 text-lg font-bold">Reporte de ventas</p>
              <p className="text-xs text-neutral-500">Octubre 2026</p>
            </div>
            <p className="truncate border-t border-neutral-200 px-4 py-2 text-[10px] text-neutral-500">
              {borrador.nombre || 'Tu negocio'} · {borrador.contacto.trim() || 'Documento interno y confidencial'}
            </p>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="flex items-center gap-2 text-sm font-medium text-rojo"><AlertCircle size={15} className="shrink-0" /> {error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={!cambio || guardando || procesando}
          className={`rounded-full bg-tinta px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-marca-oscuro disabled:opacity-40 ${anillo}`}
        >
          {guardando ? 'Guardando…' : 'Guardar marca'}
        </button>
        {cambio && (
          <button type="button" onClick={() => { setError(''); setOriginal(null); setBorrador(aBorrador(m)) }} className={`rounded-full bg-niebla px-5 py-3 text-sm font-semibold hover:bg-linea ${anillo}`}>
            Deshacer
          </button>
        )}
      </div>
    </div>
  )
}

function Consejo({ ok = false, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok
        ? <CheckCircle2 size={18} className="mt-px shrink-0 text-verde" aria-label="Bien" />
        : <AlertTriangle size={18} className="mt-px shrink-0 text-ambar" aria-label="Sugerencia" />}
      <span className={ok ? 'text-apagado' : 'text-tinta'}>{children}</span>
    </li>
  )
}

function Muestra({ color }: { color: string }) {
  return <span className="inline-block h-3.5 w-3.5 translate-y-0.5 rounded ring-1 ring-linea" style={{ background: color }} aria-label={color} />
}

function BotonColor({ c, activo, onClick }: { c: string; activo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      aria-label={`Color ${c}`}
      className={`grid h-11 w-11 place-items-center rounded-full ring-offset-2 ring-offset-papel transition-shadow ${activo ? 'ring-[3px] ring-tinta' : ''} ${anillo}`}
      style={{ background: c }}
    >
      {activo && <Check size={18} strokeWidth={3} className="text-white" />}
    </button>
  )
}
