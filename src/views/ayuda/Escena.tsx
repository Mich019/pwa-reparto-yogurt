import { createContext, useContext, type ReactNode } from 'react'
import { ChevronRight, Lock, MapPin, MoreVertical, Package, Pointer, Share, Upload, User, Users, X } from 'lucide-react'
import type { Escena as TEscena, Pieza } from './guias'

// Dibuja la «captura» de un paso: una pantalla de esqueleto (bloques grises, como cuando algo está cargando) con lo
// que se toca resaltado con el color de la marca y una manita. Todo con los colores del tema, así se ve bien en claro
// y en oscuro, y el logo y el nombre son los de la empresa.

export interface Valores { empresa: string; logo: string | null; pendientes: string }
const Datos = createContext<Valores>({ empresa: 'Tu negocio', logo: null, pendientes: '' })
const rellenar = (s: string, v: Valores) => s.replace('{empresa}', v.empresa).replace('{pendientes}', v.pendientes)

// Lo que hay que tocar: anillo con el color de la marca, un pulso suave (sin él si se pide menos movimiento) y la manita.
function Foco({ activo, children, className = '' }: { activo?: boolean; children: ReactNode; className?: string }) {
  if (!activo) return <div className={className}>{children}</div>
  return (
    <div className={`relative z-[1] rounded-md ring-2 ring-marca ring-offset-2 ring-offset-papel ${className}`}>
      <span aria-hidden="true" className="ayuda-pulso pointer-events-none absolute inset-0 rounded-[inherit]" />
      {children}
      <Pointer aria-hidden="true" size={22} strokeWidth={1.8} className="pointer-events-none absolute -right-2 -bottom-4 rotate-[-12deg] fill-papel text-tinta drop-shadow" />
    </div>
  )
}

const Barra = ({ className = '' }: { className?: string }) => <span className={`block h-2 rounded-full bg-linea ${className}`} />

function PiezaEscena({ p, compacto }: { p: Pieza; compacto: boolean }) {
  const v = useContext(Datos)
  switch (p.t) {
    case 'titulo':
      return <div className={`font-semibold leading-none ${compacto ? 'text-lg' : 'text-xl'}`}>{rellenar(p.texto, v)}</div>
    case 'botones':
      return (
        <div className={`flex gap-1.5 ${p.vertical ? 'flex-col' : 'flex-wrap'}`}>
          {p.items.map((b, i) => {
            const Icono = b.icono
            return (
              <Foco key={i} activo={b.foco}>
                <span className={`flex h-6 items-center gap-1 whitespace-nowrap rounded-md text-[10px] font-semibold ${b.texto ? 'px-2' : 'w-6 justify-center'} ${b.primario ? 'bg-tinta text-white' : 'bg-niebla text-tinta'}`}>
                  {Icono && <Icono size={11} aria-hidden="true" />}{b.texto}
                </span>
              </Foco>
            )
          })}
        </div>
      )
    case 'boton': {
      const Icono = p.icono
      return (
        <Foco activo={p.foco}>
          <span className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold ${p.secundario ? 'bg-niebla text-tinta' : 'bg-tinta text-white'}`}>
            {Icono && <Icono size={13} aria-hidden="true" />}{p.texto}
          </span>
        </Foco>
      )
    }
    case 'filas':
      return (
        <div className="divide-y divide-linea">
          {Array.from({ length: p.n }, (_, i) => (
            <Foco key={i} activo={p.foco === i}>
              <div className="flex items-center gap-2 py-1.5">
                {p.avatar && <span className="h-5 w-5 shrink-0 rounded-md bg-niebla" />}
                <span className="min-w-0 flex-1 space-y-1">
                  {p.textos?.[i] ? <span className="block truncate text-[10px] font-semibold">{p.textos[i]}</span> : <Barra className={['w-1/2', 'w-2/3', 'w-2/5', 'w-3/5'][i % 4]} />}
                  <Barra className={`h-1.5 opacity-60 ${['w-1/3', 'w-1/4', 'w-2/5', 'w-1/5'][i % 4]}`} />
                </span>
                <Barra className="w-6" />
              </div>
            </Foco>
          ))}
        </div>
      )
    case 'campos':
      return (
        <div className="space-y-2">
          {p.items.map((c) => (
            <div key={c.etiqueta}>
              <div className="mb-0.5 text-[9px] font-semibold text-apagado">{c.etiqueta}</div>
              <Foco activo={c.foco}>
                <div className="flex h-7 items-center rounded-md bg-niebla px-2 text-[10px] text-apagado">{c.valor ? rellenar(c.valor, v) : ''}</div>
              </Foco>
            </div>
          ))}
        </div>
      )
    case 'tarjetas': {
      const cols = p.cols ?? (compacto ? 2 : Math.min(p.n, 4))
      return (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: p.n }, (_, i) => (
            <Foco key={i} activo={p.foco === i}>
              <div className={`flex flex-col justify-end gap-1 rounded-lg bg-niebla p-2 ${p.alto === 'alto' ? 'h-24' : 'h-12'}`}>
                {p.alto === 'alto' && <span className="mx-auto mb-auto mt-1 h-9 w-7 rounded-md bg-linea" />}
                <Barra className="w-1/2 bg-tinta/25" />
                <Barra className="h-1.5 w-1/3" />
              </div>
            </Foco>
          ))}
        </div>
      )
    }
    case 'chips':
      return (
        <div className="flex flex-wrap gap-1">
          {p.items.map((c, i) => (
            <Foco key={c} activo={p.foco === i}>
              <span className={`flex h-6 items-center rounded-md px-2.5 text-[10px] font-semibold ${p.elegido === i ? 'bg-tinta text-white' : 'bg-niebla'}`}>{c}</span>
            </Foco>
          ))}
        </div>
      )
    case 'colores':
      return (
        <div>
          <div className="mb-1 text-[9px] font-semibold text-apagado">Color</div>
          <div className="flex gap-1.5">
            {['#e8455b', '#f2a33a', '#f9dc07', '#5cb85c', '#8a5cf6', '#6b4226'].map((c, i) => (
              <Foco key={c} activo={p.foco && i === 0} className="rounded-full">
                <span className="block h-5 w-5 rounded-full" style={{ background: c }} />
              </Foco>
            ))}
          </div>
        </div>
      )
    case 'mapa':
      return (
        <div className={`relative overflow-hidden rounded-lg bg-niebla ${p.alto ? 'h-44' : 'h-24'}`}>
          <svg aria-hidden="true" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full text-linea">
            <path d="M0 30 L200 45 M0 85 L200 70 M60 0 L75 120 M140 0 L125 120 M0 110 L90 0" stroke="currentColor" strokeWidth="5" fill="none" />
            <path d="M40 92 C 70 70, 95 60, 132 40 S 170 30, 180 22" stroke="var(--color-marca)" strokeWidth="2.5" strokeDasharray="5 4" fill="none" opacity="0.7" />
          </svg>
          {[[18, 74], [46, 50], [64, 30], [86, 18]].map(([x, y], i) => (
            <span key={i} className="absolute -translate-x-1/2 -translate-y-full" style={{ left: `${x}%`, top: `${y}%` }}>
              <Foco activo={p.foco && i === 1} className="rounded-full">
                <MapPin size={i === 1 ? 20 : 15} className="fill-tinta text-papel" aria-hidden="true" />
              </Foco>
            </span>
          ))}
        </div>
      )
    case 'texto':
      return <div className="space-y-1.5">{Array.from({ length: p.lineas }, (_, i) => <Barra key={i} className={['w-4/5', 'w-3/5', 'w-2/3'][i % 3]} />)}</div>
    case 'caja': {
      const Icono = p.icono
      return (
        <Foco activo={p.foco}>
          <div className="flex items-center gap-2 rounded-lg bg-niebla p-2.5">
            {Icono && <Icono size={16} className="shrink-0 text-apagado" aria-hidden="true" />}
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold">{p.titulo}</div>
              {p.texto && <div className="truncate text-[10px] text-apagado">{rellenar(p.texto, v)}</div>}
            </div>
          </div>
        </Foco>
      )
    }
    case 'calendario':
      return (
        <Foco activo={p.foco} className="max-w-[220px]">
          <div className="rounded-lg border border-linea bg-papel p-2">
            <div className="mb-1.5 text-center text-[10px] font-semibold">Octubre</div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: 31 }, (_, i) => {
                const d = i + 1
                const extremo = d === 1 || d === 15
                const dentro = d > 1 && d < 15
                return <span key={d} className={`grid h-4 place-items-center rounded text-[8px] tabular-nums ${extremo ? 'bg-tinta text-white' : dentro ? 'bg-marca/20' : ''}`}>{d}</span>
              })}
            </div>
          </div>
        </Foco>
      )
    case 'qr':
      return (
        <div className="grid grid-cols-3 gap-1.5">
          {Array.from({ length: p.n }, (_, i) => (
            <div key={i} className="flex flex-col items-center gap-1 rounded-md border border-dashed border-linea p-1.5">
              <CuadroQr semilla={i} />
              <Barra className="h-1.5 w-3/4" />
            </div>
          ))}
        </div>
      )
    case 'escaner':
      return (
        <div className="relative grid h-56 place-items-center overflow-hidden rounded-lg bg-[#1d1f1c]">
          <div className="relative grid h-28 w-28 place-items-center">
            {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2', 'left-0 bottom-0 border-l-2 border-b-2', 'right-0 bottom-0 border-r-2 border-b-2'].map((c) => (
              <span key={c} className={`absolute h-5 w-5 rounded-sm border-[var(--color-marca)] ${c}`} />
            ))}
            <div className="rounded bg-white p-1.5"><CuadroQr semilla={3} claro /></div>
            <span className="absolute inset-x-1 top-1/2 h-0.5 bg-[var(--color-marca)] motion-safe:animate-pulse" />
          </div>
          <span className="absolute bottom-3 text-[10px] font-semibold text-white/80">Apunta al código</span>
        </div>
      )
    case 'sabores':
      return (
        <div className="space-y-1.5">
          {Array.from({ length: p.n }, (_, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: ['#e8455b', '#f2a33a', '#8a5cf6', '#5cb85c'][i % 4] }} />
              <Barra className={['w-1/3', 'w-1/4', 'w-2/5', 'w-1/4'][i % 4]} />
              <span className="ml-auto flex items-center gap-1">
                <span className="grid h-5 w-5 place-items-center rounded-md bg-niebla text-[11px] font-semibold">−</span>
                <span className="w-4 text-center text-[10px] font-semibold tabular-nums">{p.foco === i ? 4 : i % 2 ? 0 : 2}</span>
                <Foco activo={p.foco === i}><span className="grid h-5 w-5 place-items-center rounded-md bg-tinta text-[11px] font-semibold text-white">+</span></Foco>
              </span>
            </div>
          ))}
        </div>
      )
    case 'acciones':
      return (
        <div className="flex justify-around">
          {p.items.map((a, i) => (
            <span key={a} className="flex flex-col items-center gap-1 text-[9px] font-semibold">
              <Foco activo={p.foco === i} className="rounded-full"><span className="block h-8 w-8 rounded-full bg-niebla" /></Foco>
              {a}
            </span>
          ))}
        </div>
      )
    case 'opciones':
      return (
        <div className="space-y-1.5">
          {p.items.map((o, i) => (
            <Foco key={o.titulo} activo={p.foco === i}>
              <div className={`flex items-center gap-2 rounded-lg p-2 ${p.foco === i ? 'bg-tinta text-white' : 'bg-niebla'}`}>
                <span className={`h-6 w-6 shrink-0 rounded-full ${p.foco === i ? 'bg-white/20' : 'bg-linea'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-semibold">{o.titulo}</span>
                  <span className={`block truncate text-[9px] ${p.foco === i ? 'text-white/70' : 'text-apagado'}`}>{o.sub}</span>
                </span>
                <ChevronRight size={12} aria-hidden="true" />
              </div>
            </Foco>
          ))}
        </div>
      )
    case 'logo':
      return (
        <Foco activo={p.foco}>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-linea p-2.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-niebla">
              {v.logo ? <img src={v.logo} alt="" className="h-full w-full object-contain p-1" /> : <Upload size={18} className="text-apagado" aria-hidden="true" />}
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block text-[10px] font-semibold">Subir logo</span>
              <Barra className="h-1.5 w-3/4" />
            </span>
          </div>
        </Foco>
      )
    case 'navegador': {
      const Icono = p.foco === 'compartir' ? Share : MoreVertical
      return (
        <div className="flex items-center gap-1.5 rounded-full bg-niebla px-2.5 py-1.5">
          <Lock size={10} className="shrink-0 text-apagado" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[10px] text-apagado">{v.empresa.toLowerCase().replace(/\s+/g, '')}.delisy.app</span>
          <Foco activo={!!p.foco} className="rounded-full"><Icono size={14} aria-hidden="true" /></Foco>
        </div>
      )
    }
    case 'menu':
      return (
        <div className="space-y-0.5 rounded-lg bg-papel p-1 shadow-[0_6px_20px_rgba(0,0,0,0.12)]">
          {p.items.map((m, i) => (
            <Foco key={m} activo={p.foco === i}>
              <div className={`rounded-md px-2.5 py-1.5 text-[10px] ${p.foco === i ? 'bg-niebla font-semibold' : 'text-apagado'}`}>{m}</div>
            </Foco>
          ))}
        </div>
      )
    case 'inicio':
      return (
        <div className="grid grid-cols-4 gap-x-2 gap-y-3 pt-3">
          {Array.from({ length: 11 }, (_, i) => (
            <span key={i} className="flex flex-col items-center gap-1">
              <span className="h-9 w-9 rounded-[10px] bg-niebla" />
              <Barra className="h-1 w-6" />
            </span>
          ))}
          <span className="flex flex-col items-center gap-1">
            <Foco activo className="rounded-[10px]">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-[10px] bg-papel shadow">
                {v.logo ? <img src={v.logo} alt="" className="h-full w-full object-contain p-1" /> : <span className="h-5 w-5 rounded-full bg-marca" />}
              </span>
            </Foco>
            <span className="max-w-full truncate text-[8px] font-semibold">{v.empresa}</span>
          </span>
        </div>
      )
    case 'correo':
      return (
        <div className="space-y-2 rounded-lg border border-linea bg-papel p-3">
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 shrink-0 rounded-full bg-niebla" />
            <span className="min-w-0 flex-1 space-y-1"><Barra className="w-1/3" /><Barra className="h-1.5 w-1/2" /></span>
          </div>
          <div className="text-[12px] font-semibold leading-tight">{rellenar(p.asunto, v)}</div>
          <div className="space-y-1"><Barra className="w-full" /><Barra className="w-4/5" /></div>
          <Foco activo><span className="flex h-7 items-center justify-center rounded-md bg-tinta text-[10px] font-semibold text-white">{p.boton}</span></Foco>
        </div>
      )
  }
}

// Un QR de mentira, siempre el mismo para la misma semilla (no cambia a cada dibujo).
function CuadroQr({ semilla, claro = false }: { semilla: number; claro?: boolean }) {
  const celdas = Array.from({ length: 49 }, (_, i) => ((i * 7 + semilla * 13 + (i % 5) * 3) % 5 < 2))
  const esquina = (i: number) => { const x = i % 7, y = Math.floor(i / 7); return (x < 2 && y < 2) || (x > 4 && y < 2) || (x < 2 && y > 4) }
  return (
    <span className="grid h-10 w-10 grid-cols-7 gap-px">
      {celdas.map((c, i) => <span key={i} className={esquina(i) || c ? (claro ? 'bg-[#1d1f1c]' : 'bg-tinta') : ''} />)}
    </span>
  )
}

function Hoja({ titulo, piezas, compacto, panel }: { titulo: string; piezas: Pieza[]; compacto: boolean; panel: boolean }) {
  const v = useContext(Datos)
  return (
    <>
      <span aria-hidden="true" className="absolute inset-0 z-[2] bg-black/35" />
      <div className={`absolute bottom-0 z-[3] space-y-2.5 rounded-t-2xl bg-papel p-3 pb-4 ${panel ? 'inset-x-[14%]' : 'inset-x-0'}`}>
        <span className="mx-auto -mt-1 block h-1 w-8 rounded-full bg-linea" />
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-[13px] font-semibold">{rellenar(titulo, v)}</div>
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-niebla"><X size={10} aria-hidden="true" /></span>
        </div>
        {piezas.map((p, i) => <PiezaEscena key={i} p={p} compacto={compacto} />)}
      </div>
    </>
  )
}

const MENU_PANEL = ['Resumen', 'Vendedores', 'Clientes', 'Producción', 'Sabores', 'Reportes', 'Configuración']
const PESTANAS_APP = [{ id: 'Ruta', icono: MapPin }, { id: 'Clientes', icono: Users }, { id: 'Stock', icono: Package }, { id: 'Cuenta', icono: User }]

export function Escena({ escena, valores, className = '' }: { escena: TEscena; valores: Valores; className?: string }) {
  const panel = escena.marco === 'panel'
  const piezas = escena.piezas.map((p, i) => <PiezaEscena key={i} p={p} compacto={!panel} />)
  return (
    <Datos.Provider value={valores}>
      <div aria-hidden="true" className={`select-none text-tinta ${className}`}>
        {panel ? (
          <div className="relative overflow-hidden rounded-xl border border-linea bg-[var(--color-lienzo)] shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-1 border-b border-linea bg-papel px-3 py-1.5">
              {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-linea" />)}
            </div>
            <div className="flex items-center gap-3 overflow-hidden whitespace-nowrap px-4 pt-3">
              <Marca valores={valores} />
              <span className="flex gap-3 overflow-hidden text-[10px] font-semibold">
                {MENU_PANEL.map((m) => (
                  <span key={m} className={`relative ${m === escena.seccion ? '' : 'text-tinta/45'}`}>
                    {m}
                    {m === escena.seccion && <span className="absolute inset-x-0 -bottom-0.5 -z-0 h-1 rounded-full bg-[#f9dc07]/80" />}
                  </span>
                ))}
              </span>
            </div>
            <div className="relative min-h-[300px] space-y-3 p-4 pt-5">
              {piezas}
              {escena.hoja && <Hoja {...escena.hoja} compacto={false} panel />}
            </div>
          </div>
        ) : (
          <div className="relative mx-auto h-[460px] w-[236px] overflow-hidden rounded-[34px] border-[7px] border-tinta/85 bg-[var(--color-lienzo)] shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
            <span className="absolute left-1/2 top-1.5 z-[4] h-3.5 w-16 -translate-x-1/2 rounded-full bg-tinta/85" />
            <div className="space-y-3 px-3 pt-7">
              {escena.pestana !== '' && <div className="flex items-center justify-between"><Marca valores={valores} /><span className="h-5 w-5 rounded-full bg-niebla" /></div>}
              {piezas}
            </div>
            {escena.pestana !== '' && (
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-between rounded-full bg-papel p-1 shadow-[0_4px_16px_rgba(0,0,0,0.10)]">
                {PESTANAS_APP.map(({ id, icono: Icono }) => (
                  <span key={id} className={`flex h-7 items-center justify-center gap-1 rounded-full text-[9px] font-semibold ${id === escena.pestana ? 'bg-tinta px-2.5 text-white' : 'w-8 text-tinta/60'}`}>
                    <Icono size={12} aria-hidden="true" />{id === escena.pestana && id}
                  </span>
                ))}
              </div>
            )}
            {escena.hoja && <Hoja {...escena.hoja} compacto panel={false} />}
          </div>
        )}
      </div>
    </Datos.Provider>
  )
}

function Marca({ valores }: { valores: Valores }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="grid h-5 w-5 place-items-center overflow-hidden rounded-full bg-niebla">
        {valores.logo ? <img src={valores.logo} alt="" className="h-full w-full object-contain" /> : <span className="h-3 w-3 rounded-full bg-marca" />}
      </span>
      <span className="max-w-24 truncate text-[10px] font-semibold">{valores.empresa}</span>
    </span>
  )
}
