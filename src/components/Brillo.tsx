import { useEffect, useRef, useState, type ReactNode } from 'react'

// Una cifra que cambió sola (llegó por la actualización en vivo) brilla un instante, para que se note qué se movió sin
// anunciarlo. No brilla al cargar por primera vez (de «nada» a un valor) ni con «menos movimiento» (`.brillo` en
// index.css). `valor` es lo que se compara: cuando es distinto del anterior, brilla.
export function Brilla({ valor, children, className = '' }: { valor: unknown; children: ReactNode; className?: string }) {
  const antes = useRef(valor)
  const [vez, setVez] = useState(0)
  useEffect(() => {
    if (antes.current !== null && antes.current !== undefined && valor !== null && valor !== undefined && antes.current !== valor) setVez((n) => n + 1)
    antes.current = valor
  }, [valor])
  // La llave vuelve a montar el span: así la animación corre otra vez en cada cambio.
  return <span key={vez} className={`${vez ? 'brillo' : ''} ${className}`}>{children}</span>
}
