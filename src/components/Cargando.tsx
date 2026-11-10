import type { CSSProperties } from 'react'
import { useMarca } from '../lib/marca'
import delisy from '../assets/delisy-logo.svg'

// El logo de la empresa en medio, con un aro que gira y un punto en órbita, mientras algo carga. Es el mismo dibujo de
// la pantalla de arranque (index.html, donde viven sus clases `cargador*` para que existan antes que el CSS de la app).
// Sin logo, la inicial en el color de la empresa; sin empresa, Delisy. Con «menos movimiento» se queda quieto.
export function Cargando({ texto = 'Cargando…', lado = 72, className = 'py-12' }: { texto?: string; lado?: number; className?: string }) {
  const m = useMarca()
  return (
    <div role="status" className={`flex flex-col items-center gap-4 text-center ${className}`}>
      <div className="cargador" style={{ '--carga-lado': `${lado}px`, '--carga-color': m ? 'var(--color-marca)' : undefined } as CSSProperties} aria-hidden="true">
        <span className="cargador-aro" />
        <span className="cargador-orbita" />
        {m && !m.logo
          ? <span className="cargador-logo inicial">{m.nombre.trim().charAt(0).toUpperCase()}</span>
          : <span className="cargador-logo"><img src={m?.logo ?? delisy} alt="" draggable={false} /></span>}
      </div>
      <p className="text-sm text-apagado">{texto}</p>
    </div>
  )
}
