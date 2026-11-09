import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, MessageCircle } from 'lucide-react'
import { db } from '../lib/db'
import { aviso, claseInput, telLimpio } from './ui'

// Mensajes de WhatsApp que cada quien escribe a su gusto y quedan guardados en su teléfono o computadora (db.meta).
// Se mandan con un enlace wa.me: abre WhatsApp con el texto ya escrito, sin API ni cuentas. Las palabras entre llaves se
// cambian por los datos de cada cliente.
export type TipoMensaje = 'visita' | 'cobro'
export const MENSAJES: Record<TipoMensaje, { porDefecto: string; variables: string[]; titulo: string }> = {
  visita: { porDefecto: 'Hola {nombre}, ¿te llevo yogurt hoy? 🍓', variables: ['{nombre}'], titulo: 'Tu mensaje' },
  cobro: { porDefecto: 'Hola {nombre}, te recuerdo tu saldo pendiente de {saldo}. ¡Gracias!', variables: ['{nombre}', '{saldo}'], titulo: 'Mensaje para cobrar' },
}
const clave = (t: TipoMensaje) => `mensaje:${t}`

export function useMensaje(tipo: TipoMensaje) {
  return useLiveQuery(async () => ((await db.meta.get(clave(tipo)))?.valor as string | undefined) ?? MENSAJES[tipo].porDefecto, [tipo]) ?? MENSAJES[tipo].porDefecto
}

// {nombre} va con el primer nombre: suena a que uno lo escribió.
export const llenar = (plantilla: string, datos: { nombre: string; saldo?: string }) =>
  plantilla.replaceAll('{nombre}', datos.nombre.split(' ')[0] || datos.nombre).replaceAll('{saldo}', datos.saldo ?? '')

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
    await db.meta.put({ clave: clave(tipo), valor: v.trim() || m.porDefecto })
    setTexto(null)
    aviso('Mensaje guardado')
  }
  return (
    <div>
      <label htmlFor={`mensaje-${tipo}`} className="text-sm font-semibold">{m.titulo}</label>
      <textarea id={`mensaje-${tipo}`} rows={3} maxLength={500} value={valor} onChange={(e) => setTexto(e.target.value)} className={`${claseInput} mt-1.5 w-full resize-none`} />
      <p className="mt-1 text-xs text-apagado">
        {m.variables.map((v, i) => <span key={v}>{i > 0 && ' y '}<b className="font-semibold">{v}</b></span>)} se cambian por los datos de cada cliente. Se guarda en este dispositivo.
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
