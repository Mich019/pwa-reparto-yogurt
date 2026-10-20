import pg from 'pg'

// date → "YYYY-MM-DD" tal cual, sin pasar por la zona horaria del servidor.
pg.types.setTypeParser(1082, (v) => v)

export type Cx = pg.PoolClient
export type Db = pg.Pool

export function crearPool(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 10 })
}

// Transacción; id_usuario queda disponible para la bitácora (db/README.md, "Notas para la API").
export async function tx<T>(db: Db, idUsuario: string | null, fn: (c: Cx) => Promise<T>): Promise<T> {
  const c = await db.connect()
  try {
    await c.query('BEGIN')
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
