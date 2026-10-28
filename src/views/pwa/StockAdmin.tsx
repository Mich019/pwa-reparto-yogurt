import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ChevronsRight, Copy, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import { ErrorApi, ErrorRed } from '../../lib/api'
import { hoy, sumarDias, textoFecha } from '../../lib/fechas'
import { copiarCarga, guardarCarga, guardarProduccion, useDiaStock, type DiaStock } from '../../lib/stock'
import { formato, sumaPorUnidad } from '../../lib/unidades'
import { Boton, Campo, Hoja, PuntoSabor, aviso, claseInput } from '../../components/ui'

// RF-037 · El administrador registra, para un día, los litros producidos de cada sabor y los que le entrega a cada vendedor
// al empezar la jornada (y, al cerrar, lo que devuelven). Se hace por internet: el servidor es quien lleva las cuentas.

// Cada sabor en su unidad (catálogo flexible); los totales, por unidad: «40 L + 10 kg».
const l = (n: number, p?: { unidad?: string }) => `${formato(Math.round(n * 100) / 100)} ${p?.unidad || 'L'}`
const total = (filas: { p: { unidad?: string }; n: number }[]) => sumaPorUnidad(filas.map((f) => ({ unidad: f.p.unidad, cantidad: f.n }))) || l(0, filas[0]?.p)
const mensaje = (e: unknown) => (e instanceof ErrorApi || e instanceof ErrorRed ? e.message : 'No se pudo guardar. Intenta de nuevo.')
const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

// «12,5» y «12.5» valen igual; vacío = sin dato.
function leerLitros(texto: string): number | null | 'mal' {
  const t = texto.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 && n <= 99999 ? n : 'mal'
}
const aTexto = (n: number | undefined) => (n === undefined ? '' : String(Math.round(n * 100) / 100))

export function StockAdmin({ selector }: { selector?: ReactNode }) {
  const [fecha, setFecha] = useState(hoy())
  const { dia, error, cargando, recargar, adoptar } = useDiaStock(fecha)
  const [produccion, setProduccion] = useState(false)
  const [vendedorId, setVendedorId] = useState<string | null>(null)
  const [copiando, setCopiando] = useState(false)

  const actual = dia?.fecha === fecha ? dia : null // mientras llega otro día, el anterior se ve apagado
  const cuentas = useMemo(() => {
    if (!dia) return null
    const lineas = dia.vendedores.flatMap((v) => v.lineas)
    const delSabor = (id: string) => lineas.filter((x) => x.productoId === id)
    const visibles = dia.productos.filter((p) => p.disponible || dia.produccion.some((x) => x.productoId === p.id) || delSabor(p.id).length > 0)
    const filas = visibles.map((p) => {
      const producido = dia.produccion.find((x) => x.productoId === p.id)?.litros
      const asignado = suma(delSabor(p.id).map((x) => x.asignada))
      return { producto: p, producido, asignado, entregado: suma(delSabor(p.id).map((x) => x.entregado)), libre: producido === undefined ? undefined : producido - asignado }
    })
    return {
      visibles, filas,
      producido: total(filas.map((f) => ({ p: f.producto, n: f.producido ?? 0 }))),
      asignado: total(filas.map((f) => ({ p: f.producto, n: f.asignado }))),
      entregado: total(filas.map((f) => ({ p: f.producto, n: f.entregado }))),
    }
  }, [dia])

  const sinCarga = !!actual && actual.vendedores.every((v) => v.lineas.every((x) => x.asignada === 0))
  const vendedor = actual?.vendedores.find((v) => v.id === vendedorId) ?? null

  async function repetir() {
    setCopiando(true)
    try {
      const r = await copiarCarga(sumarDias(fecha, -1), fecha)
      adoptar(r)
      aviso(r.copiadas ? `Se copiaron ${r.copiadas} ${r.copiadas === 1 ? 'renglón' : 'renglones'} del día anterior` : 'El día anterior no tiene carga que copiar')
    } catch (e) {
      aviso(mensaje(e))
    } finally {
      setCopiando(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 pt-safe pb-24">
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Stock del día</h1>
      {selector && <div className="mt-3">{selector}</div>}

      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => setFecha(sumarDias(fecha, -1))} className="grid h-11 w-11 place-items-center rounded-full bg-niebla active:bg-linea" aria-label="Día anterior"><ChevronLeft size={20} /></button>
        <div className="min-w-0 flex-1 text-center">
          <div className="font-semibold capitalize">{textoFecha(fecha)}</div>
          <div className="text-xs text-apagado">{fecha === hoy() ? 'Hoy' : fecha < hoy() ? 'Día pasado' : 'Día por venir'}</div>
        </div>
        <button onClick={() => setFecha(sumarDias(fecha, 1))} className="grid h-11 w-11 place-items-center rounded-full bg-niebla active:bg-linea" aria-label="Día siguiente"><ChevronRight size={20} /></button>
        {fecha !== hoy() && <button onClick={() => setFecha(hoy())} className="grid h-11 w-11 place-items-center rounded-full bg-niebla active:bg-linea" aria-label="Ir a hoy"><ChevronsRight size={20} /></button>}
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-2xl bg-niebla p-4">
          {error.sinRed ? <WifiOff size={20} className="mt-0.5 shrink-0" /> : <TriangleAlert size={20} className="mt-0.5 shrink-0 text-rojo" />}
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{error.sinRed ? 'El stock necesita conexión' : 'No se pudo cargar el stock'}</div>
            <div className="text-sm text-apagado">{error.texto}</div>
          </div>
          <button onClick={recargar} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-papel" aria-label="Reintentar"><RefreshCw size={18} className={cargando ? 'animate-spin' : ''} /></button>
        </div>
      )}

      {!dia && !error && <div className="mt-10 text-center text-apagado">Cargando…</div>}

      {dia && cuentas && (
        <div className={`transition-opacity ${actual ? '' : 'pointer-events-none opacity-40'}`} aria-busy={!actual}>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Tarjeta valor={cuentas.producido} etiqueta="Producido" />
            <Tarjeta valor={cuentas.asignado} etiqueta="Asignado" />
            <Tarjeta valor={cuentas.entregado} etiqueta="Entregado" />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight">Por sabor</h2>
            <Boton variante="secundario" className="!px-4 !py-2.5 text-sm" onClick={() => setProduccion(true)}>Registrar producción</Boton>
          </div>
          <div className="mt-1 divide-y divide-linea">
            {cuentas.filas.map(({ producto, producido, asignado, entregado, libre }) => (
              <div key={producto.id} className="flex items-center gap-3 py-3" data-sabor={producto.sabor}>
                <PuntoSabor color={producto.color} className="h-5 w-5" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{producto.sabor}</div>
                  <div className="text-xs text-apagado">
                    {producido === undefined ? 'Sin producción registrada' : `Producido ${l(producido, producto)}`} · Asignado {l(asignado, producto)}{entregado > 0 && ` · Entregado ${l(entregado, producto)}`}
                  </div>
                </div>
                <div className="text-right">
                  {libre === undefined ? (
                    <div className="text-lg text-apagado">—</div>
                  ) : libre < 0 ? (
                    <div className="text-lg font-semibold text-rojo tabular-nums" title="Asignaste más de lo producido">−{l(-libre, producto)}</div>
                  ) : (
                    <div className="text-lg font-semibold tabular-nums">{l(libre, producto)}</div>
                  )}
                  <div className="text-[11px] text-apagado">{libre !== undefined && libre < 0 ? 'de más' : 'sin asignar'}</div>
                </div>
              </div>
            ))}
            {cuentas.filas.length === 0 && <div className="py-6 text-center text-sm text-apagado">Aún no hay sabores. Agrégalos en Sabores.</div>}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Vendedores</h2>
            {sinCarga && (
              <Boton variante="secundario" className="!px-4 !py-2.5 text-sm" onClick={repetir} disabled={copiando}>
                <Copy size={16} /> {copiando ? 'Copiando…' : 'Repetir el día anterior'}
              </Boton>
            )}
          </div>
          <div className="mt-1 divide-y divide-linea">
            {dia.vendedores.map((v) => {
              const asignado = suma(v.lineas.map((x) => x.asignada))
              const entregado = suma(v.lineas.map((x) => Math.min(x.entregado, x.asignada)))
              const prod = (id: string) => dia.productos.find((p) => p.id === id) ?? {}
              return (
                <button key={v.id} onClick={() => setVendedorId(v.id)} className="flex w-full items-center gap-3 py-3.5 text-left active:bg-niebla" data-vendedor={v.nombre}>
                  <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-semibold ${v.activo ? 'bg-niebla' : 'bg-niebla text-apagado'}`}>{v.nombre.charAt(0).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{v.nombre}</span>
                      {!v.activo && <span className="shrink-0 rounded-full bg-rojo/10 px-2 py-0.5 text-xs font-semibold text-rojo">De baja</span>}
                    </div>
                    <div className="text-xs text-apagado">{asignado > 0 ? `Lleva ${total(v.lineas.map((x) => ({ p: prod(x.productoId), n: x.asignada })))} · entregó ${total(v.lineas.map((x) => ({ p: prod(x.productoId), n: Math.min(x.entregado, x.asignada) })))}` : 'Sin carga asignada'}</div>
                    {asignado > 0 && (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-niebla"><div className="h-full rounded-full bg-tinta" style={{ width: `${Math.min(100, (entregado / asignado) * 100)}%` }} /></div>
                    )}
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-apagado" />
                </button>
              )
            })}
            {dia.vendedores.length === 0 && <div className="py-6 text-center text-sm text-apagado">Aún no tienes vendedores. Da de alta uno en Equipo.</div>}
          </div>
        </div>
      )}

      {actual && cuentas && (
        <>
          <HojaProduccion abierta={produccion} onCerrar={() => setProduccion(false)} dia={actual} sabores={cuentas.visibles} onGuardado={adoptar} />
          <HojaCarga abierta={!!vendedor} onCerrar={() => setVendedorId(null)} dia={actual} sabores={cuentas.visibles} vendedor={vendedor} onGuardado={adoptar} />
        </>
      )}
    </div>
  )
}

function Tarjeta({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="rounded-2xl bg-niebla p-3">
      <div className="text-lg leading-6 font-semibold tabular-nums">{valor}</div>
      <div className="text-xs text-apagado">{etiqueta}</div>
    </div>
  )
}

type Sabores = DiaStock['productos']

function Fila({ producto, children, nota }: { producto: Sabores[number]; children: ReactNode; nota?: string }) {
  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <PuntoSabor color={producto.color} className="h-5 w-5" />
        <div className="min-w-0 flex-1 truncate font-semibold">{producto.sabor}</div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {nota && <div className="mt-1 pl-8 text-xs text-apagado">{nota}</div>}
    </div>
  )
}

const claseLitros = `${claseInput} !w-24 !px-3 !py-2.5 text-right tabular-nums`

function HojaProduccion({ abierta, onCerrar, dia, sabores, onGuardado }: {
  abierta: boolean; onCerrar: () => void; dia: DiaStock; sabores: Sabores; onGuardado: (d: DiaStock) => void
}) {
  const [valores, setValores] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  useEffect(() => {
    if (!abierta) return
    setValores(Object.fromEntries(dia.produccion.map((x) => [x.productoId, aTexto(x.litros)])))
    setError('')
  }, [abierta, dia])

  async function guardar() {
    const lineas: { productoId: string; litros: number }[] = []
    for (const p of sabores) {
      const n = leerLitros(valores[p.id] ?? '')
      if (n === 'mal') return setError(`Revisa la cantidad de ${p.sabor}`)
      if (n !== null) lineas.push({ productoId: p.id, litros: n })
    }
    if (!lineas.length) return setError('Escribe lo producido de al menos un sabor')
    setGuardando(true)
    setError('')
    try {
      onGuardado(await guardarProduccion(dia.fecha, lineas))
      aviso('Producción guardada')
      onCerrar()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} alto titulo={<div>Producción<div className="text-base font-medium text-apagado capitalize">{textoFecha(dia.fecha)}</div></div>}
      pie={<Boton className="w-full text-lg" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar producción'}</Boton>}>
      <p className="mb-1 text-sm text-apagado">Lo que se produjo de cada sabor este día. Lo que no asignes a un vendedor queda en el almacén.</p>
      <div className="divide-y divide-linea">
        {sabores.map((p) => (
          <Fila key={p.id} producto={p}>
            <input className={claseLitros} inputMode="decimal" placeholder="0" aria-label={`Producción de ${p.sabor} en ${p.unidad || 'L'}`} value={valores[p.id] ?? ''} onChange={(e) => setValores({ ...valores, [p.id]: e.target.value })} />
            <span className="w-6 text-sm text-apagado">{p.unidad || 'L'}</span>
          </Fila>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
    </Hoja>
  )
}

function HojaCarga({ abierta, onCerrar, dia, sabores, vendedor, onGuardado }: {
  abierta: boolean; onCerrar: () => void; dia: DiaStock; sabores: Sabores; vendedor: DiaStock['vendedores'][number] | null; onGuardado: (d: DiaStock) => void
}) {
  const [asignada, setAsignada] = useState<Record<string, string>>({})
  const [devuelta, setDevuelta] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const puedeDevolver = dia.fecha <= hoy() // al cerrar el día se registra lo que regresa

  useEffect(() => {
    if (!abierta || !vendedor) return
    setAsignada(Object.fromEntries(vendedor.lineas.filter((x) => x.asignada > 0).map((x) => [x.productoId, aTexto(x.asignada)])))
    setDevuelta(Object.fromEntries(vendedor.lineas.filter((x) => x.devuelta > 0).map((x) => [x.productoId, aTexto(x.devuelta)])))
    setError('')
  }, [abierta, vendedor?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    if (!vendedor) return
    const lineas: { productoId: string; asignada: number; devuelta?: number }[] = []
    for (const p of sabores) {
      const a = leerLitros(asignada[p.id] ?? '')
      const d = leerLitros(devuelta[p.id] ?? '')
      if (a === 'mal' || d === 'mal') return setError(`Revisa la cantidad de ${p.sabor}`)
      const antes = vendedor.lineas.find((x) => x.productoId === p.id)
      if (a === null && !(antes && antes.asignada > 0)) continue // no tenía carga de este sabor y no se escribió nada
      if ((d ?? 0) > (a ?? 0)) return setError(`Lo devuelto de ${p.sabor} no puede ser más de lo asignado`)
      lineas.push({ productoId: p.id, asignada: a ?? 0, ...(puedeDevolver && (d !== null || (antes?.devuelta ?? 0) > 0) ? { devuelta: d ?? 0 } : {}) })
    }
    if (!lineas.length) return setError('Escribe cuánto se lleva de al menos un sabor')
    setGuardando(true)
    setError('')
    try {
      onGuardado(await guardarCarga(dia.fecha, vendedor.id, lineas))
      aviso(`Carga de ${vendedor.nombre} guardada`)
      onCerrar()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }

  const totalAsignado = total(sabores.map((p) => { const n = leerLitros(asignada[p.id] ?? ''); return { p, n: typeof n === 'number' ? n : 0 } }))

  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} alto
      titulo={<div>{vendedor ? `Carga de ${vendedor.nombre}` : 'Carga'}<div className="text-base font-medium text-apagado capitalize">{textoFecha(dia.fecha)}</div></div>}
      pie={<Boton className="w-full text-lg" onClick={guardar} disabled={guardando || !vendedor}>{guardando ? 'Guardando…' : `Guardar carga · ${totalAsignado}`}</Boton>}>
      <p className="mb-1 text-sm text-apagado">
        Lo que se lleva de cada sabor al empezar el día.{puedeDevolver && ' Al cerrar, anota lo que regresa.'} Le llegará un aviso al guardar.
      </p>
      {vendedor && !vendedor.activo && <p className="mb-1 rounded-xl bg-ambar/30 px-3 py-2 text-sm">Este vendedor está de baja: sólo se puede registrar lo que devolvió.</p>}
      <div className="divide-y divide-linea">
        {sabores.map((p) => {
          const antes = vendedor?.lineas.find((x) => x.productoId === p.id)
          const libre = dia.produccion.find((x) => x.productoId === p.id)
          const otros = suma(dia.vendedores.filter((v) => v.id !== vendedor?.id).flatMap((v) => v.lineas).filter((x) => x.productoId === p.id).map((x) => x.asignada))
          const n = leerLitros(asignada[p.id] ?? '')
          const demas = libre && typeof n === 'number' && otros + n > libre.litros
          return (
            <Fila key={p.id} producto={p}
              nota={[antes && antes.entregado > 0 ? `Entregó ${l(antes.entregado, p)}` : '', libre ? `Producido ${l(libre.litros, p)}, a otros ${l(otros, p)}` : ''].filter(Boolean).join(' · ') || undefined}>
              <div>
                <input className={`${claseLitros} ${demas ? '!border-ambar' : ''}`} inputMode="decimal" placeholder="0" aria-label={`${p.unidad || 'L'} de ${p.sabor} que se lleva`} value={asignada[p.id] ?? ''} onChange={(e) => setAsignada({ ...asignada, [p.id]: e.target.value })} />
              </div>
              {puedeDevolver && (
                <input className={`${claseLitros} !w-20`} inputMode="decimal" placeholder="Dev." aria-label={`${p.unidad || 'L'} de ${p.sabor} que devolvió`} value={devuelta[p.id] ?? ''} onChange={(e) => setDevuelta({ ...devuelta, [p.id]: e.target.value })} />
              )}
            </Fila>
          )
        })}
      </div>
      {sabores.some((p) => {
        const prod = dia.produccion.find((x) => x.productoId === p.id)
        const n = leerLitros(asignada[p.id] ?? '')
        const otros = suma(dia.vendedores.filter((v) => v.id !== vendedor?.id).flatMap((v) => v.lineas).filter((x) => x.productoId === p.id).map((x) => x.asignada))
        return prod && typeof n === 'number' && otros + n > prod.litros
      }) && <p className="mt-3 rounded-xl bg-ambar/30 px-4 py-3 text-sm">Estás asignando más de lo que se produjo de algún sabor. Puedes guardarlo, pero revisa las cuentas.</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-rojo/10 px-4 py-3 text-sm font-medium text-rojo">{error}</p>}
    </Hoja>
  )
}
