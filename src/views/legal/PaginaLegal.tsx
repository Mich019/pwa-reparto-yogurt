import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ACTUALIZADO, AvisoPrivacidad, Terminos } from './textos'

// /legal/privacidad y /legal/terminos: públicas, sin sesión, para leerlas antes de registrarse o desde un enlace.
export type DocumentoLegal = 'privacidad' | 'terminos'
export const RUTA_LEGAL: Record<DocumentoLegal, string> = { privacidad: '/legal/privacidad', terminos: '/legal/terminos' }
const TITULO: Record<DocumentoLegal, string> = { privacidad: 'Aviso de privacidad', terminos: 'Términos del servicio' }

export const documentoDeRuta = (ruta: string): DocumentoLegal | null =>
  ruta.startsWith(RUTA_LEGAL.privacidad) ? 'privacidad' : ruta.startsWith(RUTA_LEGAL.terminos) ? 'terminos' : null

export function ContenidoLegal({ documento }: { documento: DocumentoLegal }) {
  return documento === 'privacidad' ? <AvisoPrivacidad /> : <Terminos />
}

export function PaginaLegal({ documento }: { documento: DocumentoLegal }) {
  useEffect(() => { document.title = `${TITULO[documento]} · Delisy` }, [documento])
  const otro: DocumentoLegal = documento === 'privacidad' ? 'terminos' : 'privacidad'
  const volver = () => (history.length > 1 ? history.back() : location.assign('/'))
  return (
    <main className="min-h-dvh bg-[var(--color-lienzo)] px-4 py-8 text-tinta sm:px-8">
      <article className="mx-auto max-w-3xl">
        <button type="button" onClick={volver} className="inline-flex items-center gap-1.5 text-sm font-semibold text-apagado hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca">
          <ArrowLeft size={16} aria-hidden="true" /> Volver
        </button>
        <h1 className="mt-6 text-[2.25rem] font-semibold leading-tight sm:text-[2.75rem]">{TITULO[documento]}</h1>
        <p className="mt-2 text-sm text-apagado">Última actualización: {ACTUALIZADO}</p>
        <div className="mt-8 rounded-lg bg-papel p-5 text-[15px] sm:p-8">
          <ContenidoLegal documento={documento} />
        </div>
        <p className="mt-6 text-sm">
          Ve también: <a href={RUTA_LEGAL[otro]} className="font-semibold text-azul underline underline-offset-2">{TITULO[otro]}</a>
        </p>
      </article>
    </main>
  )
}

// Los dos enlaces, para el pie de las pantallas de entrada y registro.
export function EnlacesLegales({ className = '' }: { className?: string }) {
  const clase = 'underline underline-offset-2 hover:text-tinta'
  return (
    <p className={`text-xs text-apagado ${className}`}>
      <a href={RUTA_LEGAL.privacidad} target="_blank" rel="noopener" className={clase}>Aviso de privacidad</a>
      <span aria-hidden="true"> · </span>
      <a href={RUTA_LEGAL.terminos} target="_blank" rel="noopener" className={clase}>Términos del servicio</a>
    </p>
  )
}
