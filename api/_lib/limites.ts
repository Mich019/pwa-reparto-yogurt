import type { Db } from './db.js'

// Dónde cuenta @fastify/rate-limit las peticiones: en la base (tabla limites_peticion) y no en la memoria del proceso.
// En Vercel cada instancia de la función tiene su propia memoria, así que un contador en memoria dejaría pasar el
// límite tantas veces como instancias haya; aquí todas suman en el mismo renglón. Si la base falla, la petición pasa
// sin límite (skipOnError en app.ts): un tropiezo del contador no debe tumbar el inicio de sesión.

type Respuesta = (err: Error | null, res?: { current: number; ttl: number }) => void

// Una vez de cada tantas se borran los renglones vencidos (no hay cron); la tabla queda chica.
const LIMPIAR_CADA = 200

export function almacenLimites(db: Db) {
  return class AlmacenLimites {
    constructor(_globales?: unknown, private prefijo = '') {}

    // Suma una petición y dice cuántas van en la ventana y cuánto le falta (ms). Si la ventana ya venció, empieza otra.
    incr(clave: string, listo: Respuesta, ventana: number) {
      if (Math.random() < 1 / LIMPIAR_CADA) void db.query(`DELETE FROM limites_peticion WHERE vence < now()`).catch(() => {})
      db.query<{ cuenta: number; ttl: number }>(
        `INSERT INTO limites_peticion AS l (clave, cuenta, vence) VALUES ($1, 1, now() + make_interval(secs => $2 / 1000.0))
         ON CONFLICT (clave) DO UPDATE SET
           cuenta = CASE WHEN l.vence <= now() THEN 1 ELSE l.cuenta + 1 END,
           vence  = CASE WHEN l.vence <= now() THEN EXCLUDED.vence ELSE l.vence END
         RETURNING cuenta, greatest(0, ceil(extract(epoch FROM vence - now()) * 1000))::int AS ttl`,
        [this.prefijo + clave, ventana],
      ).then(({ rows: [r] }) => listo(null, { current: r.cuenta, ttl: r.ttl }), (e: Error) => listo(e))
    }

    read(clave: string, listo: Respuesta) {
      db.query<{ cuenta: number; ttl: number }>(
        `SELECT cuenta, greatest(0, ceil(extract(epoch FROM vence - now()) * 1000))::int AS ttl
           FROM limites_peticion WHERE clave = $1 AND vence > now()`,
        [this.prefijo + clave],
      ).then(({ rows: [r] }) => listo(null, { current: r?.cuenta ?? 0, ttl: r?.ttl ?? 0 }), (e: Error) => listo(e))
    }

    // Cada ruta cuenta aparte (el mismo IP puede pedir 20 inicios de sesión y además 5 recuperaciones).
    // El plugin pasa los parámetros de la ruta con `routeInfo` (sus tipos no lo dicen).
    child(p: object) {
      const ruta = (p as { routeInfo?: { method?: string; url?: string } }).routeInfo
      return new AlmacenLimites(undefined, `${this.prefijo}${ruta?.method ?? ''}${ruta?.url ?? ''}:`)
    }
  }
}
