import { Medal } from 'lucide-react'

// Medallas por meses seguidos llegando a la meta (`mejorRacha` de GET /mi-meta/trofeos y /usuarios/:id/metas): se
// ganan con la mejor racha que haya tenido y no se pierden aunque la racha se corte. `todas` muestra también las que
// faltan, apagadas, para que el vendedor sepa qué sigue.
const MEDALLAS = [
  { meses: 3, texto: '3 meses', clase: 'bg-marca/15' },
  { meses: 6, texto: '6 meses', clase: 'bg-azul/15' },
  { meses: 12, texto: '1 año', clase: 'bg-ambar/40' },
]

// `soloMejor`: sólo la más alta ganada, sin texto (el ranking del panel).
export function Medallas({ mejorRacha, todas = false, soloMejor = false }: { mejorRacha: number; todas?: boolean; soloMejor?: boolean }) {
  const ganadas = MEDALLAS.filter((m) => mejorRacha >= m.meses)
  if (soloMejor) {
    const m = ganadas.at(-1)
    return m ? (
      <span title={`Medalla de ${m.texto} seguidos en la meta`} className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${m.clase} text-tinta`}>
        <Medal size={12} aria-hidden="true" /><span className="sr-only">Medalla de {m.texto} seguidos en la meta</span>
      </span>
    ) : null
  }
  const lista = todas ? MEDALLAS : ganadas
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
