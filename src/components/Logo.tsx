export function Logo({ className = 'h-10 w-10', textoClassName = 'text-xl font-bold tracking-tight', conTexto = true }: {
  className?: string
  textoClassName?: string
  conTexto?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <img src="./icon.svg" alt={conTexto ? '' : 'Reparto Yogurt'} className={`object-contain rounded-xl ${className}`} />
      {conTexto && (
        <span className={`text-tinta select-none ${textoClassName}`}>
          Reparto <span className="text-azul font-black">Yogurt</span>
        </span>
      )}
    </div>
  )
}
