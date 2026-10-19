import { useState } from 'react'
import { BarChart3, IceCreamBowl, Map, Users } from 'lucide-react'
import { Ruta } from './components/Ruta'
import { Clientes } from './components/Clientes'
import { Pronostico } from './components/Pronostico'
import { Ajustes } from './components/Ajustes'
import { Avisos } from './components/ui'

const PESTANAS = [
  { id: 'ruta', texto: 'Ruta', icono: Map },
  { id: 'clientes', texto: 'Clientes', icono: Users },
  { id: 'produccion', texto: 'Producción', icono: BarChart3 },
  { id: 'sabores', texto: 'Sabores', icono: IceCreamBowl },
] as const

type Pestana = (typeof PESTANAS)[number]['id']

export default function App() {
  const [pestana, setPestana] = useState<Pestana>('ruta')
  return (
    <div className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      <Avisos />
      <main className="relative min-h-0 flex-1">
        {pestana === 'ruta' && <Ruta irAClientes={() => setPestana('clientes')} />}
        {pestana === 'clientes' && <Clientes />}
        {pestana === 'produccion' && <Pronostico />}
        {pestana === 'sabores' && <Ajustes />}
      </main>
      <nav className="z-30 grid grid-cols-4 border-t border-slate-800 bg-slate-950 pb-safe">
        {PESTANAS.map(({ id, texto, icono: Icono }) => (
          <button
            key={id}
            onClick={() => setPestana(id)}
            className={`flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] font-semibold ${pestana === id ? 'text-pink-400' : 'text-slate-500'}`}
          >
            <Icono size={22} />
            {texto}
          </button>
        ))}
      </nav>
    </div>
  )
}
