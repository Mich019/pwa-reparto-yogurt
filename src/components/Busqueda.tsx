import { useState } from 'react'
import { History, X } from 'lucide-react'
import { leerRecientes, olvidarRecientes, recordarBusqueda, tramosResaltados } from '../lib/busqueda'
import { sesionActual } from '../lib/sesion'

// Lo que coincidió con la búsqueda, en negritas con el trazo amarillo de la marca (se lee igual en claro y oscuro).
// `t` ya limpio (limpiarBusqueda). El texto se pinta como texto de React: nunca como HTML.
export function Resaltar({ texto, t }: { texto: string; t: string }) {
  if (!t) return <>{texto}</>
  return <>{tramosResaltados(texto, t).map(([s, si], i) => si
    ? <b key={i} className="font-extrabold underline decoration-limon decoration-[3px] underline-offset-2">{s}</b>
    : <span key={i}>{s}</span>)}</>
}

// Las últimas 3 búsquedas de un buscador en este dispositivo (por cuenta). `recordar` al soltar el campo o con Enter.
export function useRecientes(clave: string) {
  const cuenta = sesionActual()?.usuario.id
  const [lista, setLista] = useState(() => leerRecientes(clave, cuenta))
  return {
    lista,
    recordar: (texto: string) => setLista(recordarBusqueda(clave, texto, cuenta)),
    olvidar: () => { olvidarRecientes(clave, cuenta); setLista([]) },
  }
}

// Chips para repetir una búsqueda con un toque. onMouseDown evita que el campo pierda el foco antes del clic.
export function Recientes({ lista, onElegir, onOlvidar, className = '' }: { lista: string[]; onElegir: (t: string) => void; onOlvidar: () => void; className?: string }) {
  if (!lista.length) return null
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} onMouseDown={(e) => e.preventDefault()}>
      <History size={14} aria-hidden="true" className="shrink-0 text-apagado" />
      <span className="sr-only">Búsquedas recientes:</span>
      {lista.map((x) => (
        <button key={x} type="button" onClick={() => onElegir(x)} className="max-w-[12rem] truncate rounded-full bg-niebla px-3 py-1 text-sm font-medium hover:bg-linea active:bg-linea">{x}</button>
      ))}
      <button type="button" onClick={onOlvidar} aria-label="Borrar búsquedas recientes" className="grid h-7 w-7 place-items-center rounded-full text-apagado hover:bg-niebla"><X size={14} /></button>
    </div>
  )
}
