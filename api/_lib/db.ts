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
