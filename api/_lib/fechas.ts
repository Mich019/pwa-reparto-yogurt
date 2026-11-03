import { empresaActual } from './db.js'
// "Hoy" según la zona horaria del negocio, no la del servidor (en Vercel siempre es UTC: a las 7 de la noche en
// México ya sería «mañana»). Mismo formato que la app: YYYY-MM-DD.
export function hoyEn(zona: string, ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
}

// La zona de cada empresa (empresas.zona_horaria): una de Tijuana y otra de Cancún no comparten «hoy». Si no se puede
// leer (sin empresa en el alcance), cae a la zona del servidor. Se recuerda un minuto por empresa.
const memoria = new Map<string, { zona: string; hasta: number }>()
export async function zonaDeEmpresa(db: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> }, respaldo: string): Promise<string> {
  const id = empresaActual()
  const ahora = Date.now()
  const guardada = id ? memoria.get(id) : undefined
  if (guardada && guardada.hasta > ahora) return guardada.zona
  const { rows } = await db.query('SELECT zona_horaria FROM empresas') // la política por_empresa deja sólo la suya
  const zona = (rows[0]?.zona_horaria as string | undefined) ?? respaldo
  if (id) memoria.set(id, { zona, hasta: ahora + 60_000 })
  return zona
}
export const olvidarZona = (id: string) => memoria.delete(id)
