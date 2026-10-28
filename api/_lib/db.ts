import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'

// date → "YYYY-MM-DD" tal cual, sin pasar por la zona horaria del servidor.
pg.types.setTypeParser(1082, (v) => v)

export type Cx = pg.PoolClient
export type Db = pg.Pool

export function crearPool(conexion: string | pg.PoolConfig): Db {
  const pool = new pg.Pool(typeof conexion === 'string' ? { connectionString: conexion, max: 10 } : conexion)
  // Si la base o su proxy cortan una conexión ociosa (reinicio, mantenimiento), el pool la descarta y abre otra.
  // Sin este manejador, ese error tumbaría el proceso.
  pool.on('error', (e) => console.error('Conexión a la base perdida (se abrirá otra):', e.message))
  return pool
}

// ------------------------------------------------------------------ multiempresa
// Cada petición con sesión trabaja dentro de la empresa de su usuario. La base lo hace cumplir (db/01_esquema.sql,
// «Multiempresa»): sus consultas corren con el rol reparto_app, que no se salta las reglas por filas (RLS), y con
// app.id_empresa fijado, así que sólo ven y escriben filas de esa empresa aunque a una consulta se le olvide filtrar.
// Lo que pasa antes de saber la empresa (iniciar sesión, renovarla, recuperar la contraseña) corre como el dueño de la
// base y busca al usuario en todo el sistema, igual que antes.

export const ROL_APP = 'reparto_app'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const alcance = new AsyncLocalStorage<{ empresa: string | null }>()

// Abre el alcance de una petición (hook onRequest de app.ts); la empresa se fija al validar la sesión.
export const conAlcance = (fn: () => void) => alcance.run({ empresa: null }, fn)
export function fijarEmpresa(id: string) {
  if (!UUID.test(id)) throw new Error('Empresa no válida')
  const a = alcance.getStore()
  if (a) a.empresa = id
}
export const empresaActual = () => alcance.getStore()?.empresa ?? null
// Para trabajo fuera de una petición (scripts, pruebas): todo lo de `fn` corre dentro de esa empresa.
export const enEmpresa = <T>(id: string, fn: () => T): T => {
  if (!UUID.test(id)) throw new Error('Empresa no válida')
  return alcance.run({ empresa: id }, fn)
}

// Dentro de una transacción ya abierta: el rol sin privilegios y la empresa, válidos hasta el COMMIT. El id ya se
// validó como UUID, así que va directo en el texto (una sola vuelta a la base en lugar de dos).
const entrar = (empresa: string) => `SET LOCAL ROLE ${ROL_APP}; SELECT set_config('app.id_empresa', '${empresa}', true)`

// La conexión que usa la API: igual que el pool, salvo que con una empresa en el alcance cada consulta suelta corre en
// su propia transacción dentro de esa empresa. tx() hace lo mismo para las transacciones.
export function porEmpresa(pool: Db): Db {
  async function query(this: unknown, ...args: unknown[]) {
    const empresa = empresaActual()
    if (!empresa) return (pool.query as (...a: unknown[]) => unknown)(...args)
    const c = await pool.connect()
    try {
      await c.query(`BEGIN; ${entrar(empresa)}`)
      const r = await (c.query as (...a: unknown[]) => unknown)(...args)
      await c.query('COMMIT')
      return r
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  }
  return new Proxy(pool, {
    get(destino, prop) {
      if (prop === 'query') return query
      const v = Reflect.get(destino, prop, destino)
      return typeof v === 'function' ? v.bind(destino) : v
    },
  })
}

// Transacción; id_usuario queda disponible para la bitácora (db/README.md, "Notas para la API").
// `fotoFija`: sólo lectura y todo de un mismo instante (REPEATABLE READ), p. ej. la descarga de la sincronización. Va
// en el BEGIN porque el nivel de aislamiento tiene que fijarse antes que cualquier otra instrucción.
export async function tx<T>(db: Db, idUsuario: string | null, fn: (c: Cx) => Promise<T>, opciones: { fotoFija?: boolean } = {}): Promise<T> {
  const c = await db.connect()
  const empresa = empresaActual()
  const inicio = opciones.fotoFija ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'
  try {
    await c.query(empresa ? `${inicio}; ${entrar(empresa)}` : inicio)
    if (idUsuario) await c.query(`SELECT set_config('app.id_usuario', $1, true)`, [idUsuario])
    const r = await fn(c)
    await c.query('COMMIT')
    return r
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}
