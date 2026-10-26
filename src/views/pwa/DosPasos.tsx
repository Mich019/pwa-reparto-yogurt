import { useCallback, useEffect, useState } from 'react'
import { Copy, Download, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react'
import { ErrorRed } from '../../lib/api'
import { descargarArchivo } from '../../lib/pdf'
import { llamarAutenticado, useRol } from '../../lib/sesion'
import { Boton, Campo, Hoja, aviso, claseInput } from '../../components/ui'
import { ImagenQR } from './CodigosCliente'

// Mi cuenta → Verificación en dos pasos: activarla con una app de autenticación, ver cuántos códigos de respaldo
// quedan, generar otros o quitarla. Todo con conexión: lo decide el servidor (api/_lib/dosPasos.ts).

interface Estado { activa: boolean; respaldoRestante: number }
type Paso =
  | { t: 'reposo' }
  | { t: 'configurando'; secreto: string; uri: string }
  | { t: 'respaldo'; codigos: string[] }
  | { t: 'desactivando' }
  | { t: 'renovando' }

const mensaje = (e: unknown) => (e instanceof ErrorRed ? 'Necesitas conexión para esto' : e instanceof Error ? e.message : 'No se pudo')

export function DosPasos() {
  const rol = useRol()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [sinRed, setSinRed] = useState(false)
  const [paso, setPaso] = useState<Paso>({ t: 'reposo' })
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(() => {
    llamarAutenticado<Estado>('/auth/dos-pasos')
      .then((e) => { setEstado(e); setSinRed(false) })
      .catch(() => setSinRed(true))
  }, [])
  useEffect(cargar, [cargar])

  async function empezar() {
    setOcupado(true)
    try {
      setPaso({ t: 'configurando', ...(await llamarAutenticado<{ secreto: string; uri: string }>('/auth/dos-pasos/iniciar', { cuerpo: {} })) })
    } catch (e) {
      aviso(mensaje(e))
    } finally {
      setOcupado(false)
    }
  }

  const cerrar = () => { setPaso({ t: 'reposo' }); cargar() }

  return (
    <div className="mt-3 rounded-2xl bg-niebla p-4">
      <div className="flex items-center gap-2 font-semibold">
        {estado?.activa ? <ShieldCheck size={18} className="text-verde" /> : <ShieldAlert size={18} className={rol === 'administrador' ? 'text-ambar' : ''} />}
        Verificación en dos pasos
      </div>
      {sinRed && !estado ? (
        <p className="mt-1 text-sm text-apagado">Conéctate a internet para ver o cambiar esta opción.</p>
      ) : !estado ? (
        <p className="mt-1 text-sm text-apagado">Cargando…</p>
      ) : estado.activa ? (
        <>
          <p className="mt-1 text-sm text-apagado">
            Activa. Al entrar se pide tu contraseña y el código de tu app de autenticación.
            {' '}{estado.respaldoRestante === 0 ? 'Ya no te quedan códigos de respaldo: genera otros.' : `Te ${estado.respaldoRestante === 1 ? 'queda 1 código' : `quedan ${estado.respaldoRestante} códigos`} de respaldo.`}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Boton variante="secundario" className="bg-white" onClick={() => setPaso({ t: 'renovando' })}>Nuevos códigos</Boton>
            <Boton variante="peligro" onClick={() => setPaso({ t: 'desactivando' })}>Desactivar</Boton>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-apagado">
            {rol === 'administrador'
              ? 'Recomendada para administradores: aunque alguien sepa tu contraseña, sin tu teléfono no puede entrar.'
              : 'Además de la contraseña, al entrar se pide un código de una app en tu teléfono.'}
          </p>
          <Boton className="mt-3 w-full" onClick={empezar} disabled={ocupado}><ShieldCheck size={18} /> {ocupado ? 'Preparando…' : 'Activar'}</Boton>
        </>
      )}

      {paso.t === 'configurando' && <Configurar secreto={paso.secreto} uri={paso.uri} onActivada={(codigos) => setPaso({ t: 'respaldo', codigos })} onCerrar={cerrar} />}
      {paso.t === 'respaldo' && <CodigosRespaldo codigos={paso.codigos} onCerrar={cerrar} />}
      {paso.t === 'desactivando' && <Desactivar onCerrar={cerrar} />}
      {paso.t === 'renovando' && <Renovar onNuevos={(codigos) => setPaso({ t: 'respaldo', codigos })} onCerrar={cerrar} />}
    </div>
  )
}

function CampoCodigo({ valor, onChange, etiqueta = 'Código de 6 dígitos' }: { valor: string; onChange: (v: string) => void; etiqueta?: string }) {
  return (
    <Campo etiqueta={etiqueta}>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value.replace(/[^\da-zA-Z-]/g, '').slice(0, 11))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="123456"
        className={`${claseInput} text-center font-mono text-xl tracking-[0.25em]`}
      />
    </Campo>
  )
}

function Configurar({ secreto, uri, onActivada, onCerrar }: { secreto: string; uri: string; onActivada: (codigos: string[]) => void; onCerrar: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function activar() {
    setEnviando(true)
    setError('')
    try {
      const r = await llamarAutenticado<{ respaldo: string[] }>('/auth/dos-pasos/activar', { cuerpo: { codigo } })
      onActivada(r.respaldo)
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja abierta onCerrar={onCerrar} alto titulo="Activar verificación en dos pasos"
      pie={<Boton className="w-full" onClick={activar} disabled={enviando || codigo.length < 6}>{enviando ? 'Verificando…' : 'Verificar y activar'}</Boton>}>
      <ol className="space-y-5 pb-4 text-sm">
        <li>
          <div className="font-semibold">1. Instala una app de autenticación</div>
          <p className="text-apagado">Google Authenticator, Microsoft Authenticator o la que ya uses.</p>
        </li>
        <li>
          <div className="font-semibold">2. Escanea este código con la app</div>
          <div className="mx-auto mt-3 w-52 max-w-full"><ImagenQR texto={uri} className="w-full" etiqueta="Código QR para la app de autenticación" /></div>
          <p className="mt-3 text-apagado">¿Estás en el mismo teléfono? Copia esta clave y pégala en la app («Ingresar clave de configuración»):</p>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(secreto).then(() => aviso('Clave copiada'), () => {})}
            className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl bg-niebla px-3 py-2.5 text-left font-mono text-xs break-all active:bg-linea"
          >
            {secreto.match(/.{1,4}/g)?.join(' ')} <Copy size={16} className="shrink-0" />
          </button>
        </li>
        <li>
          <div className="mb-2 font-semibold">3. Escribe el código que muestra la app</div>
          <CampoCodigo valor={codigo} onChange={setCodigo} />
          {error && <p className="mt-2 font-medium text-rojo">{error}</p>}
        </li>
      </ol>
    </Hoja>
  )
}

function CodigosRespaldo({ codigos, onCerrar }: { codigos: string[]; onCerrar: () => void }) {
  const texto = `Reparto Yogurt · Códigos de respaldo de la verificación en dos pasos\nCada uno sirve una sola vez.\n\n${codigos.join('\n')}\n`
  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Guarda tus códigos de respaldo"
      pie={<Boton className="w-full" onClick={onCerrar}>Ya los guardé</Boton>}>
      <div className="pb-4">
        <p className="text-sm text-apagado">
          Si pierdes el teléfono, entra con uno de estos códigos. Cada uno sirve una sola vez y <b>no se volverán a mostrar</b>.
          Guárdalos fuera de este teléfono (impresos o en tu gestor de contraseñas).
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-niebla p-4 font-mono text-base">
          {codigos.map((c) => <span key={c} className="text-center">{c}</span>)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Boton variante="secundario" onClick={() => navigator.clipboard?.writeText(texto).then(() => aviso('Códigos copiados'), () => {})}><Copy size={18} /> Copiar</Boton>
          <Boton variante="secundario" onClick={() => descargarArchivo(new Blob([texto], { type: 'text/plain;charset=utf-8' }), 'codigos-respaldo-reparto-yogurt.txt')}><Download size={18} /> Descargar</Boton>
        </div>
      </div>
    </Hoja>
  )
}

function Desactivar({ onCerrar }: { onCerrar: () => void }) {
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function desactivar() {
    setEnviando(true)
    setError('')
    try {
      await llamarAutenticado('/auth/dos-pasos/desactivar', { cuerpo: { password, codigo } })
      aviso('Verificación en dos pasos desactivada')
      onCerrar()
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Desactivar verificación en dos pasos"
      pie={<Boton variante="peligro" className="w-full" onClick={desactivar} disabled={enviando || !password || codigo.length < 6}>{enviando ? 'Desactivando…' : 'Desactivar'}</Boton>}>
      <div className="space-y-4 pb-4">
        <p className="text-sm text-apagado">Tu cuenta quedará protegida sólo con la contraseña. Para confirmar, escribe tu contraseña y un código de tu app (o uno de respaldo).</p>
        <Campo etiqueta="Contraseña">
          <div className="relative">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${claseInput} pl-11`} />
            <KeyRound size={18} className="absolute top-1/2 left-4 -translate-y-1/2 text-apagado" />
          </div>
        </Campo>
        <CampoCodigo valor={codigo} onChange={setCodigo} etiqueta="Código" />
        {error && <p className="text-sm font-medium text-rojo">{error}</p>}
      </div>
    </Hoja>
  )
}

function Renovar({ onNuevos, onCerrar }: { onNuevos: (codigos: string[]) => void; onCerrar: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function renovar() {
    setEnviando(true)
    setError('')
    try {
      onNuevos((await llamarAutenticado<{ respaldo: string[] }>('/auth/dos-pasos/respaldo', { cuerpo: { codigo } })).respaldo)
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Hoja abierta onCerrar={onCerrar} titulo="Nuevos códigos de respaldo"
      pie={<Boton className="w-full" onClick={renovar} disabled={enviando || codigo.length < 6}>{enviando ? 'Generando…' : 'Generar códigos nuevos'}</Boton>}>
      <div className="space-y-4 pb-4">
        <p className="text-sm text-apagado">Los códigos de respaldo que tienes ahora dejarán de servir. Escribe el código que muestra tu app para confirmar.</p>
        <CampoCodigo valor={codigo} onChange={setCodigo} />
        {error && <p className="text-sm font-medium text-rojo">{error}</p>}
      </div>
    </Hoja>
  )
}
