import { db } from './db'
import { descargarArchivo } from './pdf'
import { llamarAutenticado, sesionRevocada } from './sesion'

// Privacidad y derechos ARCO (api/_lib/privacidad.ts). Los textos viven en src/views/legal/; si cambian de fondo, sube
// VERSION_LEGAL aquí y en la API: todas las cuentas los vuelven a aceptar al entrar.
export const VERSION_LEGAL = '2026-11-05'

// Quién responde por los datos personales de las cuentas (el «responsable» del aviso de privacidad). Lo que falta lo
// llena quien opera Delisy antes de publicarlo: un aviso sin nombre ni domicilio del responsable no cumple la ley.
export const RESPONSABLE = {
  nombre: 'Delisy',
  razonSocial: '', // p. ej. «Nombre Apellido» (persona física con actividad empresarial) o «Delisy S.A.S. de C.V.»
  domicilio: '', // calle, número, colonia, código postal, ciudad y estado
  correo: '', // correo para solicitudes ARCO; si queda vacío se usa el de soporte de la plataforma
}

export const DIAS_BAJA = 30

export const aceptarLegal = () => llamarAutenticado<{ version: string }>('/me/legal', { metodo: 'POST', cuerpo: { version: VERSION_LEGAL } })

const hoy = () => new Date().toISOString().slice(0, 10)
const json = (datos: unknown) => new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' })

export async function descargarMisDatos() {
  const datos = await llamarAutenticado<unknown>('/me/datos')
  descargarArchivo(json(datos), `mis-datos-delisy-${hoy()}.json`, 'application/json')
}

// Todo lo de la empresa en un archivo: cada tabla se pide por páginas y se junta aquí.
export async function descargarDatosEmpresa(alAvanzar?: (tabla: string) => void) {
  const base = await llamarAutenticado<{ empresa: { nombre: string }; tablas: string[] } & Record<string, unknown>>('/empresa/datos')
  const tablas: Record<string, unknown[]> = {}
  for (const t of base.tablas) {
    alAvanzar?.(t)
    tablas[t] = []
    let desde = ''
    for (;;) {
      const p = await llamarAutenticado<{ filas: unknown[]; siguiente: string | null }>(`/empresa/datos/${t}?desde=${encodeURIComponent(desde)}`)
      tablas[t].push(...p.filas)
      if (!p.siguiente) break
      desde = p.siguiente
    }
  }
  const nombre = base.empresa.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
  descargarArchivo(json({ ...base, tablas }), `datos-${nombre}-${hoy()}.json`, 'application/json')
}

// Después de eliminar la cuenta o dar de baja la empresa: este teléfono o navegador no guarda nada de ella.
async function olvidarTodo() {
  await Promise.all(db.tables.map((t) => t.clear())).catch(() => {})
  sesionRevocada()
}

export async function eliminarMiCuenta(password: string, codigo?: string) {
  await llamarAutenticado('/me/eliminar', { metodo: 'POST', cuerpo: { password, codigo: codigo || undefined } })
  await olvidarTodo()
}

export async function darDeBajaEmpresa(datos: { password: string; codigo?: string; nombre: string; motivo?: string }) {
  const r = await llamarAutenticado<{ borrarEn: string }>('/empresa/baja', { metodo: 'POST', cuerpo: { ...datos, codigo: datos.codigo || undefined } })
  await olvidarTodo()
  return r
}
