import { Medal } from 'lucide-react'

// Medallas por meses seguidos llegando a la meta (`mejorRacha` de GET /mi-meta/trofeos y /usuarios/:id/metas): se
// ganan con la mejor racha que haya tenido y no se pierden aunque la racha se corte. `todas` muestra también las que
// faltan, apagadas, para que el vendedor sepa qué sigue.
const MEDALLAS = [
  { meses: 3, texto: '3 meses', clase: 'bg-marca/15' },
  { meses: 6, texto: '6 meses', clase: 'bg-azul/15' },
  { meses: 12, texto: '1 año', clase: 'bg-ambar/40' },
]

export function Medallas({ mejorRacha, todas = false }: { mejorRacha: number; todas?: boolean }) {
  const lista = MEDALLAS.filter((m) => todas || mejorRacha >= m.meses)
  if (!lista.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Medallas por meses seguidos en la meta">
      {lista.map((m) => {
        const ganada = mejorRacha >= m.meses
        return (
          <li key={m.meses} title={ganada ? `${m.meses} meses seguidos en la meta` : `Faltan ${m.meses - mejorRacha} meses seguidos`}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${ganada ? `${m.clase} text-tinta` : 'border border-dashed border-linea text-apagado'}`}>
            <Medal size={13} aria-hidden="true" /> {m.texto}{!ganada && <span className="sr-only"> (por ganar)</span>}
          </li>
        )
      })}
    </ul>
  )
}
