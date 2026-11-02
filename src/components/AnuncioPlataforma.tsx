import { useState } from 'react'
import { Info, TriangleAlert, X } from 'lucide-react'
import { usePlataformaPublica } from '../lib/plataforma'

// El anuncio de la plataforma para todas las empresas (Configuración → Servicio en /plataforma), arriba del panel, de la
// app de reparto y de las pantallas de entrada. Cerrarlo lo oculta en este navegador hasta que cambie el texto.

const CLAVE = 'anuncio-cerrado'
const leerCerrado = () => {
  try { return localStorage.getItem(CLAVE) } catch { return null }
}

export function AnuncioPlataforma({ className = '' }: { className?: string }) {
  const anuncio = usePlataformaPublica()?.anuncio
  const [cerrado, setCerrado] = useState(leerCerrado)
  if (!anuncio || cerrado === anuncio.texto) return null
  const aviso = anuncio.tipo === 'aviso'
  const Icono = aviso ? TriangleAlert : Info
  function cerrar() {
    try { localStorage.setItem(CLAVE, anuncio!.texto) } catch { /* sin almacenamiento: vuelve a salir al recargar */ }
    setCerrado(anuncio!.texto)
  }
  return (
    <div role={aviso ? 'alert' : 'status'} className={`flex shrink-0 items-start gap-3 px-4 py-2.5 text-sm sm:px-8 ${aviso ? 'bg-ambar/15' : 'bg-azul/10'} ${className}`}>
      <Icono size={17} aria-hidden="true" className={`mt-0.5 shrink-0 ${aviso ? 'text-ambar' : 'text-azul'}`} />
      <p className="min-w-0 flex-1 leading-snug">{anuncio.texto}</p>
      <button type="button" onClick={cerrar} aria-label="Cerrar aviso" className="-my-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-apagado hover:bg-niebla hover:text-tinta">
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  )
}
