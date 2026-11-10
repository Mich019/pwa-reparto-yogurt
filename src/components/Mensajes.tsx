import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, MessageCircle } from 'lucide-react'
import { db } from '../lib/db'
import { MODO_SERVIDOR } from '../lib/api'
import { guardarPerfil, sesionActual } from '../lib/sesion'
import { aviso, claseInput, telLimpio } from './ui'

// Mensajes de WhatsApp que cada quien escribe a su gusto. Se guardan en su cuenta (PATCH /me `mensajes`, migración 035),
// así lo siguen del teléfono a la computadora, y el dispositivo tiene una copia (db.meta) para usarlos sin señal.
// Se mandan con un enlace wa.me: abre WhatsApp con el texto ya escrito, sin API ni cuentas. Las palabras entre llaves se
// cambian por los datos de cada cliente.
export type TipoMensaje = 'visita' | 'cobro' | 'limite' | 'camino'
export const MENSAJES: Record<TipoMensaje, { porDefecto: string; variables: string[]; titulo: string }> = {
  visita: { porDefecto: 'Hola {nombre}, ¿te llevo yogurt hoy? 🍓', variables: ['{nombre}'], titulo: 'Tu mensaje' },
  cobro: { porDefecto: 'Hola {nombre}, te recuerdo tu saldo pendiente de {saldo}. ¡Gracias!', variables: ['{nombre}', '{saldo}'], titulo: 'Mensaje para cobrar' },
  camino: { porDefecto: 'Hola {nombre}, voy en camino con tu pedido. ¡Nos vemos en un rato!', variables: ['{nombre}'], titulo: 'Mensaje de «voy en camino»' },
  limite: { porDefecto: 'Hola {nombre}, tu saldo pendiente es de {saldo} y ya pasó tu límite de {limite}. ¿Me ayudas con un abono? ¡Gracias!', variables: ['{nombre}', '{saldo}', '{limite}'], titulo: 'Mensaje para quien pasó su límite' },
}
const clave = (t: TipoMensaje) => `mensaje:${t}`

export function useMensaje(tipo: TipoMensaje) {
  return useLiveQuery(async () => ((await db.meta.get(clave(tipo)))?.valor as string | undefined) ?? MENSAJES[tipo].porDefecto, [tipo]) ?? MENSAJES[tipo].porDefecto
}

// {nombre} va con el primer nombre: suena a que uno lo escribió.
export const llenar = (plantilla: string, datos: { nombre: string; saldo?: string; limite?: string }) =>
  plantilla.replaceAll('{nombre}', datos.nombre.split(' ')[0] || datos.nombre).replaceAll('{saldo}', datos.saldo ?? '').replaceAll('{limite}', datos.limite ?? '')

// Cobro por WhatsApp a un deudor: a quien pasó su límite le va su propio mensaje (con {limite}).
export const textoCobro = (d: { nombre: string; saldo: number; limite?: number | null }, cobro: string, limite: string, pasado: boolean, dinero: (n: number) => string) =>
  llenar(pasado && d.limite != null ? limite : cobro, { nombre: d.nombre, saldo: dinero(d.saldo), limite: d.limite != null ? dinero(d.limite) : '' })

export const enlaceWhatsApp = (telefono: string | null | undefined, texto: string) => {
  const tel = telLimpio(telefono ?? '')
  return tel.length >= 10 ? `https://wa.me/${tel}?text=${encodeURIComponent(texto)}` : null
}

export function EditorMensaje({ tipo, abierto = true }: { tipo: TipoMensaje; abierto?: boolean }) {
  const guardado = useMensaje(tipo)
  const [texto, setTexto] = useState<string | null>(null)
  useEffect(() => { if (abierto) setTexto(null) }, [abierto])
  const m = MENSAJES[tipo]
  const valor = texto ?? guardado
  async function guardar(v = valor) {
    const limpio = v.trim() || m.porDefecto
    await db.meta.put({ clave: clave(tipo), valor: limpio })
    setTexto(null)
    if (!MODO_SERVIDOR || !sesionActual()) return aviso('Mensaje guardado')
    try {
      await guardarPerfil({ mensajes: { [tipo]: limpio === m.porDefecto ? null : limpio } })
      aviso('Mensaje guardado en tu cuenta')
    } catch {
      aviso('Se guardó en este dispositivo; sin señal no llegó a tu cuenta')
    }
  }
  return (
    <div>
      <label htmlFor={`mensaje-${tipo}`} className="text-sm font-semibold">{m.titulo}</label>
      <textarea id={`mensaje-${tipo}`} rows={3} maxLength={500} value={valor} onChange={(e) => setTexto(e.target.value)} className={`${claseInput} mt-1.5 w-full resize-none`} />
      <p className="mt-1 text-xs text-apagado">
        {m.variables.map((v, i) => <span key={v}>{i > 0 && ' y '}<b className="font-semibold">{v}</b></span>)} se cambian por los datos de cada cliente. Se guarda en tu cuenta.
      </p>
      <div className="mt-1 flex gap-4 text-sm font-semibold">
        {texto !== null && texto !== guardado && <button type="button" onClick={() => void guardar()} className="py-1 underline underline-offset-2">Guardar mensaje</button>}
        {valor !== m.porDefecto && <button type="button" onClick={() => void guardar(m.porDefecto)} className="py-1 text-apagado underline underline-offset-2">Volver al de siempre</button>}
      </div>
    </div>
  )
}

// Botón verde que abre WhatsApp con el texto; tras tocarlo queda «Enviado» (sólo en esta pantalla).
export function BotonWhatsApp({ telefono, texto, enviado, onEnviar, chico = false }: { telefono?: string | null; texto: string; enviado?: boolean; onEnviar?: () => void; chico?: boolean }) {
  const href = enlaceWhatsApp(telefono, texto)
  if (!href) return <span className="shrink-0 text-xs text-apagado">Sin teléfono</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={onEnviar} aria-label={chico ? 'Mandar WhatsApp' : undefined}
      className={`flex shrink-0 items-center gap-1.5 rounded-md text-sm font-semibold ${chico ? 'h-10 w-10 justify-center' : 'px-3.5 py-2.5'} ${enviado ? 'bg-niebla text-apagado' : 'bg-verde text-white'}`}>
      {enviado ? <Check size={16} aria-hidden="true" /> : <MessageCircle size={16} aria-hidden="true" />}
      {!chico && (enviado ? 'Enviado' : 'WhatsApp')}
    </a>
  )
}

// «Mandar a todos»: el navegador no deja abrir varios WhatsApp de golpe, así que va uno por uno. Cada toque abre el
// chat del siguiente con su mensaje ya escrito; al volver, el botón ya dice a quién sigue. Los que no tienen teléfono
// o ya se mandaron se saltan.
export function MandarATodos({ lista, mandados, onEnviar }: {
  lista: { id: string; nombre: string; telefono?: string | null; texto: string }[]
  mandados: Set<string>
  onEnviar: (id: string) => void
}) {
  const [activo, setActivo] = useState(false)
  const [saltados, setSaltados] = useState<Set<string>>(new Set())
  const pendientes = lista.filter((x) => enlaceWhatsApp(x.telefono, x.texto) && !mandados.has(x.id) && !saltados.has(x.id))
  const conTel = lista.filter((x) => enlaceWhatsApp(x.telefono, x.texto)).length
  if (conTel < 2) return null
  if (!activo) {
    return (
      <button type="button" onClick={() => { setSaltados(new Set()); setActivo(true) }} disabled={!pendientes.length}
        className="flex items-center gap-1.5 rounded-md bg-verde px-3.5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        <MessageCircle size={16} aria-hidden="true" /> {pendientes.length ? `Mandar a todos (${pendientes.length})` : 'Ya les mandaste a todos'}
      </button>
    )
  }
  const sig = pendientes[0]
  if (!sig) {
    return (
      <span className="flex items-center gap-1.5 text-sm font-semibold text-verde">
        <Check size={16} aria-hidden="true" /> Listo: les mandaste a {lista.filter((x) => mandados.has(x.id)).length} <button type="button" onClick={() => setActivo(false)} className="ml-2 text-apagado underline underline-offset-2">Cerrar</button>
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <a href={enlaceWhatsApp(sig.telefono, sig.texto)!} target="_blank" rel="noopener noreferrer" onClick={() => onEnviar(sig.id)}
        className="flex items-center gap-1.5 rounded-md bg-verde px-3.5 py-2.5 text-sm font-semibold text-white">
        <MessageCircle size={16} aria-hidden="true" /> Mandar a {sig.nombre.split(' ')[0]} · {conTel - pendientes.length + 1} de {conTel}
      </a>
      <button type="button" onClick={() => setSaltados((m) => new Set(m).add(sig.id))} className="py-1 text-sm font-semibold text-apagado underline underline-offset-2">Saltar</button>
      <button type="button" onClick={() => setActivo(false)} className="py-1 text-sm font-semibold text-apagado underline underline-offset-2">Parar</button>
    </span>
  )
}
