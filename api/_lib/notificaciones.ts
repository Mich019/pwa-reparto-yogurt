import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import type { Db } from './db.js'
import { endpointPermitido, SuscripcionCaducada, type Enviador } from './push.js'

// M10 · Notificaciones (RF-054). Cada aviso se guarda en `notificaciones` (la app lo trae al sincronizar, así llega
// aunque no haya push) y, si hay claves VAPID, también se manda por Web Push a los teléfonos del destinatario.

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

export type TipoAviso = 'pedido_urgente' | 'ruta_modificada' | 'stock_asignado' | 'prueba'
export interface AvisoPendiente {
  para: string // id del usuario
  tipo: TipoAviso
  titulo: string
  cuerpo: string
  datos?: { pestana?: 'ruta' | 'stock' | 'clientes' | 'cuenta'; pedidoId?: string }
}

const MAX_DISPOSITIVOS = 10

// Varios cambios seguidos del mismo tipo para la misma persona llegan como un solo aviso: una carga de 8 pedidos
// no debe hacer sonar el teléfono 8 veces.
export function unir(avisos: AvisoPendiente[]): AvisoPendiente[] {
  const grupos = new Map<string, AvisoPendiente[]>()
  for (const a of avisos) {
    const k = `${a.para}|${a.tipo}`
    grupos.set(k, [...(grupos.get(k) ?? []), a])
  }
  return [...grupos.values()].map((g) => {
    if (g.length === 1) return g[0]
    const lineas = [...new Set(g.map((a) => a.cuerpo).filter(Boolean))]
    const cuerpo = lineas.slice(0, 3).join('. ') + (lineas.length > 3 ? ` y ${lineas.length - 3} más` : '')
    const { para, tipo } = g[0]
    const titulo = tipo === 'pedido_urgente' ? `${g.length} pedidos urgentes` : tipo === 'ruta_modificada' ? 'Tu ruta cambió' : g[0].titulo
    return { para, tipo, titulo, cuerpo, datos: { pestana: g[0].datos?.pestana } }
  })
}

export interface Registro { error: (e: unknown, mensaje?: string) => void }

export function crearDespachador(db: Db, enviador: Enviador | null, log: Registro) {
  // Lo guarda sólo si la persona sigue activa; devuelve su id.
  async function guardar(a: AvisoPendiente): Promise<string | null> {
    const { rows } = await db.query(
      `INSERT INTO notificaciones (id_usuario, tipo, titulo, cuerpo, datos)
       SELECT id_usuario, $2, $3, $4, $5::jsonb FROM usuarios WHERE id_usuario = $1 AND activo
       RETURNING id_notificacion`,
      [a.para, a.tipo, a.titulo.slice(0, 120), a.cuerpo, JSON.stringify(a.datos ?? {})],
    )
    return rows[0]?.id_notificacion ?? null
  }

  // Manda el aviso a cada teléfono suscrito. Los que ya no existen se olvidan.
  async function entregar(id: string, a: AvisoPendiente): Promise<{ dispositivos: number; enviados: number }> {
    if (!enviador) return { dispositivos: 0, enviados: 0 }
    const { rows: subs } = await db.query(`SELECT id_suscripcion, endpoint, clave_p256dh, clave_auth FROM suscripciones_push WHERE id_usuario = $1`, [a.para])
    const carga = JSON.stringify({ id, tipo: a.tipo, titulo: a.titulo, cuerpo: a.cuerpo, datos: a.datos ?? {} })
    const resultados = await Promise.allSettled(subs.map((s) => enviador({ endpoint: s.endpoint, p256dh: s.clave_p256dh, auth: s.clave_auth }, carga)))
    const caducadas: string[] = []
    resultados.forEach((r, i) => {
      if (r.status !== 'rejected') return
      if (r.reason instanceof SuscripcionCaducada) caducadas.push(subs[i].id_suscripcion)
      else log.error(r.reason, 'No se pudo mandar la notificación push')
    })
    if (caducadas.length) await db.query(`DELETE FROM suscripciones_push WHERE id_suscripcion = ANY($1::uuid[])`, [caducadas])
    return { dispositivos: subs.length, enviados: resultados.filter((r) => r.status === 'fulfilled').length }
  }

  return {
    // Nunca falla: un aviso que no sale no debe tumbar el cambio que lo causó.
    async despachar(avisos: AvisoPendiente[]) {
      await Promise.all(
        unir(avisos).map(async (a) => {
          try {
            const id = await guardar(a)
            if (id) await entregar(id, a)
          } catch (e) {
            log.error(e, 'No se pudo registrar el aviso')
          }
        }),
      )
    },
    async probar(idUsuario: string) {
      const aviso: AvisoPendiente = { para: idUsuario, tipo: 'prueba', titulo: 'Prueba de avisos', cuerpo: 'Si lo ves, este teléfono recibirá los avisos de tu ruta.', datos: { pestana: 'cuenta' } }
      const id = await guardar(aviso)
      return id ? entregar(id, aviso) : { dispositivos: 0, enviados: 0 }
    },
  }
}
export type Despachador = ReturnType<typeof crearDespachador>

const base64url = (min: number, max: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`))
const bodySuscripcion = z.object({
  endpoint: z.string().max(2000).refine(endpointPermitido, 'Dirección de notificaciones no permitida'),
  keys: z.object({ p256dh: base64url(20, 200), auth: base64url(8, 100) }),
})
const bodyBaja = z.object({ endpoint: z.string().max(2000) })
const bodyLeidas = z.object({ ids: z.array(z.uuid()).min(1).max(200) })

const limite = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => req.headers.authorization ?? req.ip } })

export async function rutasNotificaciones(
  app: FastifyInstance,
  { db, config }: Contexto,
  { requiereSesion }: { requiereSesion: Guardia },
  despachador: Despachador,
  enviador: Enviador | null,
) {
  // Qué puede hacer el servidor y con qué clave suscribirse.
  app.get('/notificaciones/config', { preHandler: requiereSesion }, async () => ({ push: !!enviador, clavePublica: enviador ? config.vapidPublica : null }))

  // El teléfono se suscribe (o renueva su suscripción). Si el mismo teléfono cambia de cuenta, el aviso pasa a la nueva.
  app.post('/notificaciones/suscripcion', { preHandler: requiereSesion, config: limite(30) }, async (req, rep) => {
    const b = bodySuscripcion.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Suscripción de notificaciones inválida' })
    await db.query(
      `INSERT INTO suscripciones_push (id_usuario, endpoint, clave_p256dh, clave_auth) VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET id_usuario = EXCLUDED.id_usuario, clave_p256dh = EXCLUDED.clave_p256dh, clave_auth = EXCLUDED.clave_auth, creado_en = now()`,
      [req.usuario.id, b.data.endpoint, b.data.keys.p256dh, b.data.keys.auth],
    )
    // Una cuenta no acumula teléfonos que ya no usa.
    await db.query(
      `DELETE FROM suscripciones_push WHERE id_usuario = $1 AND id_suscripcion NOT IN
         (SELECT id_suscripcion FROM suscripciones_push WHERE id_usuario = $1 ORDER BY creado_en DESC LIMIT ${MAX_DISPOSITIVOS})`,
      [req.usuario.id],
    )
    return { ok: true }
  })

  // El teléfono deja de recibir los avisos de esta cuenta (al cerrar sesión o apagarlos).
  app.post('/notificaciones/suscripcion/baja', { preHandler: requiereSesion, config: limite(30) }, async (req, rep) => {
    const b = bodyBaja.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Falta la dirección de la suscripción' })
    await db.query(`DELETE FROM suscripciones_push WHERE endpoint = $1 AND id_usuario = $2`, [b.data.endpoint, req.usuario.id])
    return { ok: true }
  })

  app.post('/notificaciones/leidas', { preHandler: requiereSesion, config: limite(60) }, async (req, rep) => {
    const b = bodyLeidas.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Indica qué avisos se leyeron' })
    await db.query(`UPDATE notificaciones SET leida_en = now() WHERE id_usuario = $1 AND id_notificacion = ANY($2::uuid[]) AND leida_en IS NULL`, [req.usuario.id, b.data.ids])
    return { ok: true }
  })

  // «Enviar prueba» desde Cuenta: comprueba de punta a punta que este teléfono recibe avisos.
  app.post('/notificaciones/prueba', { preHandler: requiereSesion, config: limite(6) }, async (req, rep) => {
    if (!enviador) return rep.code(409).send({ error: 'Este servidor no tiene activadas las notificaciones push', codigo: 'PUSH_NO_CONFIGURADO' })
    return despachador.probar(req.usuario.id)
  })
}
