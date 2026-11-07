import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from './db.js'

// Cambios en vivo. GET /eventos deja abierta una respuesta (server-sent events) por la que el servidor dice qué área
// cambió en la empresa de quien escucha (tabla `cambios`, migración 029): la app y el panel vuelven a pedir sólo eso,
// sin recargar y sin mostrar «actualizando». Es sólo una señal: los datos siguen yendo por sus rutas de siempre, con sus
// permisos, así que nadie ve aquí nada que no pudiera pedir.
//
// Cada `intervaloMs` se lee el contador (una consulta por la llave primaria) y se revisa que la sesión siga viva: cerrar
// sesión, desactivar la cuenta o suspender la empresa corta la conexión en segundos. A los `duracionMs` se cierra sola
// (Vercel corta las funciones largas) y el navegador vuelve a conectarse.

export const AREAS = ['datos', 'cobranza', 'equipo'] as const
export interface OpcionesEnVivo { intervaloMs: number; duracionMs: number; latidoMs: number }
export const EN_VIVO: OpcionesEnVivo = { intervaloMs: 3000, duracionMs: 240_000, latidoMs: 20_000 }

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

// `db` es la conexión sin envolver (dueño de la base): la consulta filtra por empresa y sesión a mano, sin abrir una
// transacción por vuelta.
export async function rutasEnVivo(app: FastifyInstance, db: Db, { requiereSesion }: { requiereSesion: Guardia }, opciones: OpcionesEnVivo = EN_VIVO) {
  app.get('/eventos', { preHandler: requiereSesion }, async (req, rep) => {
    const { empresa, sid, id } = req.usuario
    const leer = async () => {
      const { rows: [r] } = await db.query(
        `SELECT EXISTS (SELECT 1 FROM sesiones s JOIN usuarios u USING (id_usuario) JOIN empresas e USING (id_empresa)
                         WHERE s.id_sesion = $2 AND s.id_usuario = $3 AND s.revocado_en IS NULL AND s.expira_en > now()
                           AND u.activo AND e.activa) AS viva,
                coalesce((SELECT jsonb_object_agg(area, version) FROM cambios WHERE id_empresa = $1), '{}') AS versiones`,
        [empresa, sid, id],
      )
      return r as { viva: boolean; versiones: Record<string, string> }
    }
    let antes = (await leer()).versiones

    rep.hijack()
    const res = rep.raw
    // Las cabeceras que ya pusieron los hooks (CORS, seguridad) van también.
    res.writeHead(200, {
      ...(rep.getHeaders() as Record<string, string | string[]>),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const enviar = (evento: string, datos: unknown) => res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`)
    res.write('retry: 2000\n\n')
    enviar('hola', { areas: AREAS })

    let cerrado = false
    let ultimoEnvio = Date.now()
    const terminar = (evento?: string) => {
      if (cerrado) return
      cerrado = true
      clearInterval(vuelta)
      clearTimeout(fin)
      if (evento) enviar(evento, {})
      res.end()
    }
    req.raw.on('close', () => terminar())
    const fin = setTimeout(() => terminar('otra-vez'), opciones.duracionMs)
    let ocupado = false
    const vuelta = setInterval(async () => {
      if (ocupado || cerrado) return
      ocupado = true
      try {
        const r = await leer()
        if (!r.viva) return terminar('fin')
        const areas = Object.keys(r.versiones).filter((a) => r.versiones[a] !== antes[a])
        antes = r.versiones
        if (areas.length) {
          enviar('cambio', { areas })
          ultimoEnvio = Date.now()
        } else if (Date.now() - ultimoEnvio >= opciones.latidoMs) {
          res.write(': latido\n\n') // que ningún proxy la dé por muerta
          ultimoEnvio = Date.now()
        }
      } catch (e) {
        req.log.error(e, 'No se pudieron leer los cambios en vivo')
        terminar('otra-vez')
      } finally {
        ocupado = false
      }
    }, opciones.intervaloMs)
  })
}
