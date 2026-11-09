import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { hoy, sumarDias } from '../lib/fechas'
import { Check, ChevronRight, NotebookPen, TriangleAlert } from 'lucide-react'
import { guardarLimiteFiado, guardarLimitesFiado, useServidor, type CuentaCliente, type Deudor } from '../lib/cobranza'
import { usePaginas } from './Paginas'
import { dinero } from '../lib/fechas'
import { sincronizar } from '../lib/sync'
import type { Cliente } from '../lib/db'
import { useMarca } from '../lib/marca'
import { Boton, Hoja, aviso, claseInput } from './ui'

// Límite de fiado por cliente (migración 036). El administrador lo pone en la ficha del cliente; viaja al teléfono con
// el cliente (`limiteFiado`) y, al elegir «Fiado» en la entrega, `AvisoLimiteFiado` le dice al vendedor si con ese
// pedido pasaría de su límite. Sólo avisa: no impide fiar.

export function LimiteFiado({ cliente }: { cliente: Cliente }) {
  const [abierta, setAbierta] = useState(false)
  const deEmpresa = useMarca()?.limiteFiado ?? null
  return (
    <>
      <button onClick={() => setAbierta(true)} className="flex w-full items-center gap-3 rounded-md bg-niebla px-4 py-3 text-left active:bg-linea">
        <NotebookPen size={20} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-apagado">Fiado</span>
          <span className="block font-semibold">{cliente.limiteFiado != null ? `Límite de ${dinero(cliente.limiteFiado)}` : deEmpresa != null ? `El de la empresa: ${dinero(deEmpresa)}` : 'Sin límite de fiado'}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-apagado/60" />
      </button>
      {abierta && <HojaLimite cliente={cliente} onCerrar={() => setAbierta(false)} />}
    </>
  )
}

function HojaLimite({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const [texto, setTexto] = useState(cliente.limiteFiado != null ? String(cliente.limiteFiado) : '')
  const [enviando, setEnviando] = useState(false)
  const t = texto.trim().replace(',', '.')
  const valor = t === '' ? null : Number(t)
  const valido = valor === null || (Number.isFinite(valor) && valor >= 0)
  const sugerido = useLimiteSugerido(cliente.id)
  async function guardar() {
    setEnviando(true)
    try {
      await guardarLimiteFiado(cliente.id, valor)
      aviso(valor === null ? 'Sin límite de fiado' : `Límite de fiado: ${dinero(valor)}`)
      void sincronizar().catch(() => {})
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta onCerrar={onCerrar} titulo={<div>Límite de fiado<div className="text-base font-medium text-apagado">{cliente.nombre}</div></div>}
      pie={<Boton onClick={guardar} disabled={enviando || !valido || valor === (cliente.limiteFiado ?? null)} className="w-full text-lg">Guardar</Boton>}>
      <div className="space-y-3 pb-4">
        <p className="text-sm text-apagado">Lo más que puede deber. Al elegir «Fiado», el teléfono avisa al vendedor si con ese pedido se pasa. Déjalo en blanco para usar el de la empresa (Configuración → Preferencias) o no tener límite.</p>
        <label className="block">
          <span className="text-sm font-semibold">Límite</span>
          <input inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Sin límite" aria-invalid={!valido} className={`${claseInput} mt-1`} />
        </label>
        {!valido && <p role="alert" className="text-sm font-medium text-rojo">Escribe una cantidad de 0 o más.</p>}
        {sugerido && (
          <div className="border-t border-linea pt-3 text-sm">
            <p><span className="font-semibold">Sugerido: {dinero(sugerido.limite)}</span> <span className="text-apagado">· dos semanas de lo que compra ({dinero(sugerido.semanal)} a la semana{sugerido.lento ? '), a la mitad porque debe desde hace más de un mes' : ')'}.</span></p>
            {valor !== sugerido.limite && <button type="button" onClick={() => setTexto(String(sugerido.limite))} className="mt-1 py-1 font-semibold underline underline-offset-2">Usar este</button>}
          </div>
        )}
      </div>
    </Hoja>
  )
}

// Límite sugerido: dos semanas de lo que el cliente compra (entregas de los últimos 90 días, de cualquier forma de
// pago), redondeado hacia arriba a $50; a la mitad si lo que debe viene de hace más de 30 días (paga lento).
export function limiteSugerido(totales: number[], debeDesde: string | null, hoyIso: string) {
  const semanal = totales.reduce((s, t) => s + t, 0) / (90 / 7)
  if (semanal < 1) return null
  const lento = !!debeDesde && debeDesde < sumarDias(hoyIso, -30)
  return { semanal: Math.round(semanal * 100) / 100, lento, limite: Math.max(50, Math.ceil((semanal * 2 * (lento ? 0.5 : 1)) / 50) * 50) }
}

function useLimiteSugerido(clienteId: string) {
  const cuenta = useServidor<CuentaCliente>(`/cobranza/clientes/${clienteId}`)
  const desde = sumarDias(hoy(), -90)
  const totales = useLiveQuery(async () => (await db.pedidos.where('clienteId').equals(clienteId).toArray())
    .filter((p) => p.estado === 'ENTREGADO' && p.fecha >= desde).map((p) => p.total), [clienteId, desde])
  return totales ? limiteSugerido(totales, cuenta.datos?.saldo ? cuenta.datos.desde : null, hoy()) : null
}

// El código para fiar de más (migración 037) llega como `sal:sha256(sal:código)`; se revisa aquí, también sin señal.
export async function codigoFiadoCorrecto(guardado: string, codigo: string) {
  const [sal, hash] = guardado.split(':')
  if (!sal || !hash || !/^\d{4,8}$/.test(codigo) || !crypto.subtle) return false
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${sal}:${codigo}`)))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') === hash
}

// En la entrega, con «Fiado» elegido. Lo que debe viene del servidor (con conexión); sin ella sólo recuerda el límite.
// Si la empresa puso código (Preferencias → Fiado) y el cliente pasaría de su límite, `onPermitir(false)` frena el
// «Pedido Realizado» hasta que se escribe el código del administrador. Sin señal sólo se sabe si el pedido solo ya pasa.
export function AvisoLimiteFiado({ cliente, total, onPermitir }: { cliente: Cliente; total: number; onPermitir?: (si: boolean) => void }) {
  const marca = useMarca()
  const limite = cliente.limiteFiado ?? marca?.limiteFiado ?? null
  const cuenta = useServidor<CuentaCliente>(limite != null ? `/cobranza/clientes/${cliente.id}` : null)
  const [codigo, setCodigo] = useState('')
  const [autorizado, setAutorizado] = useState(false)
  const debe = cuenta.datos?.saldo
  const pasa = limite != null && (debe ?? 0) + total > limite + 0.004
  const frena = pasa && !!marca?.codigoFiado && !autorizado
  useEffect(() => { onPermitir?.(!frena) }, [frena, onPermitir])
  useEffect(() => () => onPermitir?.(true), [onPermitir])
  useEffect(() => {
    if (!marca?.codigoFiado || codigo.length < 4) return
    let vigente = true
    void codigoFiadoCorrecto(marca.codigoFiado, codigo).then((ok) => { if (vigente && ok) setAutorizado(true) })
    return () => { vigente = false }
  }, [codigo, marca?.codigoFiado])
  if (limite == null) return null
  const pedirCodigo = pasa && marca?.codigoFiado && (
    autorizado
      ? <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-verde"><Check size={16} aria-hidden="true" /> Autorizado: ya puedes fiarle.</p>
      : (
        <label className="mt-2 block">
          <span className="text-sm font-semibold">Para fiarle de más, pide el código al administrador</span>
          <input inputMode="numeric" autoComplete="off" maxLength={8} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            placeholder="Código" aria-label="Código del administrador" className={`${claseInput} mt-1 max-w-40 tracking-widest`} />
        </label>
      )
  )
  if (debe === undefined) return <><p className="mt-2 text-sm text-apagado">Su límite de fiado es {dinero(limite)}.</p>{pedirCodigo}</>
  const quedaria = debe + total
  const disponible = Math.max(0, limite - debe)
  if (quedaria <= limite + 0.004) return (
    <p className="mt-2 text-sm text-apagado">
      Le puedes fiar hasta <b className="font-semibold text-tinta">{dinero(disponible)}</b>{debe > 0 ? ` (ya debe ${dinero(debe)})` : ''}. Con este pedido debería {dinero(quedaria)} de {dinero(limite)}.
    </p>
  )
  return (
    <>
      <p role="alert" className="mt-2 flex gap-2 text-sm font-semibold text-rojo">
        <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        Con este pedido debería {dinero(quedaria)} y su límite es {dinero(limite)}. {debe > 0 ? `Ya debe ${dinero(debe)}.` : ''} {disponible > 0 ? `Sólo le puedes fiar ${dinero(disponible)}.` : 'Ya no le queda fiado disponible.'}
      </p>
      {pedirCodigo}
    </>
  )
}

// «Límite sugerido para todos» (Clientes → Más, administrador): a los clientes activos sin límite propio les propone el
// de `limiteSugerido` y los guarda de una vez. Los que no compraron en 90 días se quedan como están.
export function HojaLimitesSugeridos({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const cobro = useServidor<{ deudores: Deudor[] }>(abierta ? '/cobranza' : null)
  const desde = sumarDias(hoy(), -90)
  const lista = useLiveQuery(async () => {
    if (!abierta) return []
    const [clientes, pedidos] = await Promise.all([db.clientes.toArray(), db.pedidos.where('fecha').aboveOrEqual(desde).toArray()])
    const porCliente = new Map<string, number[]>()
    for (const p of pedidos) if (p.estado === 'ENTREGADO') porCliente.set(p.clienteId, [...(porCliente.get(p.clienteId) ?? []), p.total])
    return clientes.filter((c) => c.activo && c.limiteFiado == null).map((c) => ({ c, totales: porCliente.get(c.id) ?? [] }))
  }, [abierta, desde]) ?? []
  const debeDesde = new Map((cobro.datos?.deudores ?? []).map((d) => [d.id, d.desde]))
  const propuestas = lista.flatMap(({ c, totales }) => {
    const s = limiteSugerido(totales, debeDesde.get(c.id) ?? null, hoy())
    return s ? [{ c, ...s }] : []
  }).sort((a, b) => a.c.nombre.localeCompare(b.c.nombre, 'es'))
  const paginas = usePaginas(propuestas, 30, abierta)
  const [enviando, setEnviando] = useState(false)
  async function aplicar() {
    setEnviando(true)
    try {
      const { actualizados } = await guardarLimitesFiado(propuestas.map((x) => ({ clienteId: x.c.id, limite: x.limite })))
      aviso(`Límite puesto a ${actualizados} ${actualizados === 1 ? 'cliente' : 'clientes'}`)
      void sincronizar().catch(() => {})
      onCerrar()
    } catch (e) {
      aviso(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Hoja abierta={abierta} onCerrar={onCerrar} alto titulo="Límite sugerido para todos"
      pie={<Boton onClick={aplicar} disabled={enviando || !propuestas.length || cobro.cargando} className="w-full text-lg">{propuestas.length ? `Poner a ${propuestas.length} ${propuestas.length === 1 ? 'cliente' : 'clientes'}` : 'Nadie que sugerir'}</Boton>}>
      <div className="pb-4">
        <p className="text-sm text-apagado">A cada cliente activo sin límite propio: dos semanas de lo que compra (de sus entregas de los últimos 90 días), redondeado a $50; a la mitad si debe desde hace más de un mes. Los que tienen límite no cambian; quien no compró en 90 días sigue con el de la empresa.</p>
        <ul ref={paginas.ancla} className="mt-3 divide-y divide-linea border-y border-linea">
          {paginas.visibles.map((x) => (
            <li key={x.c.id} className="flex items-baseline gap-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{x.c.nombre}</span>
              <span className="text-apagado tabular-nums">{dinero(x.semanal)}/sem{x.lento ? ' · paga lento' : ''}</span>
              <span className="font-semibold tabular-nums">{dinero(x.limite)}</span>
            </li>
          ))}
        </ul>
        {paginas.control}
      </div>
    </Hoja>
  )
}
