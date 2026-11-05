import { useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, FileText, Mail, Trash2, TriangleAlert } from 'lucide-react'
import { ErrorApi } from '../../lib/api'
import { db } from '../../lib/db'
import { DIAS_BAJA, RESPONSABLE, darDeBajaEmpresa, descargarDatosEmpresa, descargarMisDatos, eliminarMiCuenta } from '../../lib/legal'
import { usePlataformaPublica } from '../../lib/plataforma'
import { llamarAutenticado, useSesion } from '../../lib/sesion'
import { aviso, claseInput } from '../../components/ui'
import { RUTA_LEGAL } from './PaginaLegal'

// «Privacidad y datos»: los derechos ARCO sin tener que pedírselos a nadie (api/_lib/privacidad.ts). Está en el panel
// (Configuración) y en la app (Cuenta); `plataforma` quita lo de la empresa (sus cuentas no tienen negocio ni se borran aquí).

const anillo = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'
const boton = `inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 ${anillo}`
const mensaje = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Sin conexión con el servidor. Inténtalo con señal.')

function Bloque({ icono, titulo, children }: { icono: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-niebla p-5">
      <h3 className="flex items-center gap-2 font-semibold">{icono}{titulo}</h3>
      <div className="mt-2 text-sm leading-relaxed">{children}</div>
    </section>
  )
}

// Contraseña y, si la cuenta tiene verificación en dos pasos, el código: lo mismo que pide el servidor para borrar.
function Confirmacion({ password, setPassword, codigo, setCodigo }: { password: string; setPassword: (s: string) => void; codigo: string; setCodigo: (s: string) => void }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-apagado">Tu contraseña</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={`${claseInput} bg-papel`} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-apagado">Código de verificación (si la tienes activada)</span>
        <input value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric" autoComplete="one-time-code" className={`${claseInput} bg-papel`} placeholder="Opcional" />
      </label>
    </div>
  )
}

export function PrivacidadYDatos({ plataforma = false }: { plataforma?: boolean }) {
  const u = useSesion()?.usuario
  const admin = u?.rol === 'administrador' && !plataforma
  const soporte = usePlataformaPublica()?.correoSoporte
  const contacto = RESPONSABLE.correo || soporte || ''
  const pendientes = useLiveQuery(() => db.cola.count(), []) ?? 0
  const [empresa, setEmpresa] = useState('')
  useEffect(() => { llamarAutenticado<{ empresa: string }>('/me').then((r) => setEmpresa(r.empresa)).catch(() => {}) }, [])

  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<'cuenta' | 'empresa' | null>(null)
  const [password, setPassword] = useState('')
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')

  const abrir = (q: 'cuenta' | 'empresa' | null) => { setAbierto(q); setPassword(''); setCodigo(''); setNombre(''); setMotivo(''); setError('') }

  async function hacer(clave: string, f: () => Promise<unknown>) {
    setTrabajando(clave)
    setError('')
    try {
      await f()
    } catch (e) {
      if (abierto) setError(mensaje(e))
      else aviso(mensaje(e))
    } finally {
      setTrabajando(null)
    }
  }

  if (!u) return null
  return (
    <div className="space-y-4">
      <Bloque icono={<FileText size={18} aria-hidden="true" />} titulo="Documentos">
        <p>Qué datos guardamos, para qué y con quién, y las reglas del servicio.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={RUTA_LEGAL.privacidad} target="_blank" rel="noopener" className={`${boton} bg-papel hover:bg-linea`}>Aviso de privacidad</a>
          <a href={RUTA_LEGAL.terminos} target="_blank" rel="noopener" className={`${boton} bg-papel hover:bg-linea`}>Términos del servicio</a>
        </div>
      </Bloque>

      <Bloque icono={<Download size={18} aria-hidden="true" />} titulo="Descargar tus datos">
        <p>Un archivo con todo lo que Delisy guarda de tu cuenta: perfil, sesiones y aceptaciones (derecho de acceso).</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void hacer('mios', descargarMisDatos)} disabled={!!trabajando} className={`${boton} bg-tinta text-white hover:bg-marca-oscuro`}>
            {trabajando === 'mios' ? 'Preparando…' : 'Descargar mis datos'}
          </button>
          {admin && (
            <button type="button" onClick={() => void hacer('empresa', () => descargarDatosEmpresa((t) => setTrabajando(`empresa:${t}`)))} disabled={!!trabajando} className={`${boton} bg-papel hover:bg-linea`}>
              {trabajando?.startsWith('empresa') ? `Juntando ${trabajando.slice(8).replace('_', ' ') || 'datos'}…` : 'Descargar todo lo de la empresa'}
            </button>
          )}
        </div>
        {admin && <p className="mt-2 text-xs text-apagado">El de la empresa trae clientes, productos, pedidos, cobranza, cortes y cierres en formato JSON, para guardarlo o llevarlo a otro sistema.</p>}
      </Bloque>

      {!plataforma && (
        <Bloque icono={<Trash2 size={18} aria-hidden="true" />} titulo="Eliminar mi cuenta">
          <p>
            Se borran tu nombre, correo, teléfono, foto y sesiones, y ya no podrás entrar. Las ventas y cobros que registraste se quedan en
            los libros de {empresa || 'tu negocio'}, sin tus datos. No se puede deshacer.
          </p>
          {abierto === 'cuenta' ? (
            <form onSubmit={(e) => { e.preventDefault(); void hacer('cuenta', () => eliminarMiCuenta(password, codigo)) }}>
              {pendientes > 0 && (
                <p className="mt-3 flex items-start gap-2 rounded-md bg-ambar/20 p-3"><TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  Este teléfono tiene {pendientes} {pendientes === 1 ? 'cambio' : 'cambios'} sin enviar. Sincroniza antes: al eliminar la cuenta se pierden.</p>
              )}
              <Confirmacion password={password} setPassword={setPassword} codigo={codigo} setCodigo={setCodigo} />
              {error && <p role="alert" className="mt-3 font-medium text-rojo">{error}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" disabled={!password || !!trabajando} className={`${boton} bg-rojo text-white`}>{trabajando === 'cuenta' ? 'Eliminando…' : 'Eliminar mi cuenta para siempre'}</button>
                <button type="button" onClick={() => abrir(null)} className={`${boton} bg-papel hover:bg-linea`}>Cancelar</button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => abrir('cuenta')} className={`${boton} mt-3 bg-papel text-rojo hover:bg-rojo/10`}>Eliminar mi cuenta…</button>
          )}
        </Bloque>
      )}

      {admin && (
        <Bloque icono={<TriangleAlert size={18} aria-hidden="true" />} titulo="Dar de baja la empresa">
          <p>
            Cancela la suscripción y nadie del equipo podrá entrar. Guardamos los datos {DIAS_BAJA} días por si te arrepientes y luego
            borramos todo: clientes, pedidos, cobranza y cuentas. Descarga antes lo de la empresa si lo quieres conservar.
          </p>
          {abierto === 'empresa' ? (
            <form onSubmit={(e) => {
              e.preventDefault()
              void hacer('baja', async () => {
                const r = await darDeBajaEmpresa({ password, codigo, nombre: nombre.trim(), motivo: motivo.trim() || undefined })
                aviso(`Empresa dada de baja. Sus datos se borran el ${new Date(r.borrarEn).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}.`)
              })
            }}>
              <label className="mt-4 block">
                <span className="mb-1.5 block text-xs font-medium text-apagado">Escribe el nombre de la empresa: <strong className="text-tinta">{empresa}</strong></span>
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={`${claseInput} bg-papel`} autoComplete="off" />
              </label>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-xs font-medium text-apagado">¿Por qué te vas? (opcional, nos ayuda a mejorar)</span>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} className={`${claseInput} bg-papel`} />
              </label>
              <Confirmacion password={password} setPassword={setPassword} codigo={codigo} setCodigo={setCodigo} />
              {error && <p role="alert" className="mt-3 font-medium text-rojo">{error}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="submit" disabled={!password || nombre.trim().toLocaleLowerCase('es') !== empresa.trim().toLocaleLowerCase('es') || !!trabajando} className={`${boton} bg-rojo text-white`}>
                  {trabajando === 'baja' ? 'Dando de baja…' : 'Dar de baja la empresa'}
                </button>
                <button type="button" onClick={() => abrir(null)} className={`${boton} bg-papel hover:bg-linea`}>Cancelar</button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => abrir('empresa')} className={`${boton} mt-3 bg-papel text-rojo hover:bg-rojo/10`}>Dar de baja la empresa…</button>
          )}
        </Bloque>
      )}

      <Bloque icono={<Mail size={18} aria-hidden="true" />} titulo="Otra solicitud">
        <p>
          Para corregir tu correo, oponerte a un uso de tus datos o cualquier otra solicitud de privacidad
          {contacto ? <> escribe a <a href={`mailto:${contacto}`} className="font-semibold text-azul underline underline-offset-2">{contacto}</a></> : ' escribe al soporte de Delisy'}.
          Respondemos en un máximo de 20 días hábiles. Si eres cliente de un negocio, tu solicitud va con ese negocio.
        </p>
      </Bloque>
    </div>
  )
}
