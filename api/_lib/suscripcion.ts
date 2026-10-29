import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Contexto } from './app.js'
import { firmaValida, type ClienteMp } from './mercadopago.js'

// Cobro de la plataforma (Fase 3): prueba gratis y suscripción mensual con Mercado Pago.
// - Cada empresa nueva usa todo durante su prueba (empresas.prueba_hasta), sin tarjeta.
// - El administrador se suscribe cuando quiere: POST /suscripcion crea la suscripción en Mercado Pago y devuelve el
//   enlace para poner la tarjeta. Si aún le quedan días de prueba, el primer cobro llega cuando terminan.
// - Mercado Pago avisa los cambios a POST /mercadopago/webhook; además, al volver de pagar, el panel pide
//   GET /suscripcion?actualizar=1. En los dos casos el estado se lee de la API de Mercado Pago, no del aviso.
// - Sin acceso (prueba vencida y sin suscripción autorizada) la API responde 402 a todo salvo la sesión y esta pantalla
//   (app.ts). No se borra nada.

// Acceso de una empresa (alias «e»). Lo usa app.ts al validar cada sesión.
export const CON_ACCESO = `(e.exenta OR e.prueba_hasta > now() OR e.suscripcion_estado = 'authorized')`
export const SUSCRIPCION_VENCIDA = {
  error: 'La prueba gratis o la suscripción de tu empresa terminó. El administrador puede renovarla desde el panel; tus datos siguen guardados.',
  codigo: 'SUSCRIPCION_VENCIDA',
}

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

export async function rutasSuscripcion(app: FastifyInstance, { db, config }: Contexto, mp: ClienteMp | null, { requiereAdminSinCobro }: { requiereAdminSinCobro: Guardia }) {
  const cobro = config.mercadoPago

  async function leer(idEmpresa: string) {
    const { rows: [e] } = await db.query(
      `SELECT e.nombre, e.exenta, e.prueba_hasta, e.suscripcion_estado, e.mp_preapproval_id, ${CON_ACCESO} AS con_acceso,
              greatest(0, ceil(extract(epoch FROM e.prueba_hasta - now()) / 86400))::int AS dias_prueba
         FROM empresas e WHERE e.id_empresa = $1`,
      [idEmpresa],
    )
    return e
  }

  const guardarEstado = (id: string, estado: string) =>
    db.query(`UPDATE empresas SET suscripcion_estado = $2, suscripcion_actualizada = now() WHERE mp_preapproval_id = $1`, [id, estado])

  // Lo que ve el panel. «estado» resume: exenta, activa (suscripción autorizada), prueba o vencida.
  function resumen(e: Awaited<ReturnType<typeof leer>>) {
    const estado = e.exenta ? 'exenta' : e.suscripcion_estado === 'authorized' ? 'activa' : e.con_acceso ? 'prueba' : 'vencida'
    return {
      estado,
      pruebaHasta: e.prueba_hasta,
      diasPrueba: e.dias_prueba as number,
      suscripcion: (e.suscripcion_estado as string | null) ?? null, // el estado en Mercado Pago (pending = falta pagar)
      precio: cobro.precioMensual,
      moneda: cobro.moneda,
      cobroDisponible: cobro.activo && !!mp,
    }
  }

  app.get('/suscripcion', { preHandler: requiereAdminSinCobro }, async (req) => {
    let e = await leer(req.usuario.empresa)
    // Al volver de Mercado Pago el aviso puede tardar: se pregunta directo.
    if ((req.query as { actualizar?: string }).actualizar && mp && e.mp_preapproval_id) {
      try {
        const s = await mp.consultar(e.mp_preapproval_id)
        await guardarEstado(s.id, s.estado)
        e = await leer(req.usuario.empresa)
      } catch (err) {
        req.log.warn(err, 'no se pudo consultar la suscripción en Mercado Pago')
      }
    }
    return resumen(e)
  })

  app.post('/suscripcion', { preHandler: requiereAdminSinCobro, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req, rep) => {
    if (!cobro.activo || !mp) return rep.code(503).send({ error: 'El cobro todavía no está configurado en el servidor.', codigo: 'COBRO_NO_CONFIGURADO' })
    const e = await leer(req.usuario.empresa)
    if (e.exenta) return rep.code(409).send({ error: 'Tu empresa no necesita suscripción.', codigo: 'EXENTA' })
    if (e.suscripcion_estado === 'authorized') return rep.code(409).send({ error: 'Tu suscripción ya está activa.', codigo: 'YA_SUSCRITA' })
    const { rows: [u] } = await db.query(`SELECT correo FROM usuarios WHERE id_usuario = $1`, [req.usuario.id])
    const enPrueba = new Date(e.prueba_hasta).getTime() > Date.now()
    const nueva = await mp.crear({
      empresa: req.usuario.empresa,
      correo: u.correo,
      motivo: `Delisy · ${e.nombre}`.slice(0, 120),
      monto: cobro.precioMensual,
      moneda: cobro.moneda,
      inicio: enPrueba ? new Date(e.prueba_hasta) : null,
      volverA: `${config.urlApp}/admin?suscripcion=volver`,
    })
    // Una suscripción anterior que quedó sin pagar ya no sirve: la nueva la reemplaza.
    const anterior = e.mp_preapproval_id as string | null
    await db.query(
      `UPDATE empresas SET mp_preapproval_id = $2, suscripcion_estado = 'pending', suscripcion_actualizada = now() WHERE id_empresa = $1`,
      [req.usuario.empresa, nueva.id],
    )
    if (anterior && anterior !== nueva.id) await mp.cancelar(anterior).catch((err) => req.log.warn(err, 'no se pudo cancelar la suscripción anterior'))
    return rep.code(201).send({ url: nueva.url })
  })

  app.post('/suscripcion/cancelar', { preHandler: requiereAdminSinCobro }, async (req, rep) => {
    const e = await leer(req.usuario.empresa)
    if (!e.mp_preapproval_id || !e.suscripcion_estado || e.suscripcion_estado === 'cancelled') {
      return rep.code(409).send({ error: 'No hay una suscripción que cancelar.', codigo: 'SIN_SUSCRIPCION' })
    }
    if (!mp) return rep.code(503).send({ error: 'El cobro todavía no está configurado en el servidor.', codigo: 'COBRO_NO_CONFIGURADO' })
    await mp.cancelar(e.mp_preapproval_id)
    await guardarEstado(e.mp_preapproval_id, 'cancelled')
    return resumen(await leer(req.usuario.empresa))
  })

  // Avisos de Mercado Pago (Webhooks, evento «Planes y suscripciones»). Responde 200 enseguida a lo que no le toca,
  // para que Mercado Pago no lo reintente.
  app.post('/mercadopago/webhook', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, rep) => {
    const q = req.query as Record<string, string | undefined>
    const b = (req.body ?? {}) as { type?: string; topic?: string; data?: { id?: string } }
    const tipo = b.type ?? b.topic ?? q.type ?? q.topic ?? ''
    const id = String(q['data.id'] ?? b.data?.id ?? q.id ?? '')
    if (!tipo.includes('preapproval') || !id || id.length > 64) return rep.code(200).send({ ok: true })
    if (cobro.webhookSecret) {
      const firma = req.headers['x-signature']
      const idPeticion = req.headers['x-request-id']
      if (!firmaValida(cobro.webhookSecret, { firma: typeof firma === 'string' ? firma : undefined, idPeticion: typeof idPeticion === 'string' ? idPeticion : undefined, idDato: id })) {
        req.log.warn({ id }, 'aviso de Mercado Pago con firma no válida')
        return rep.code(401).send({ error: 'Firma no válida' })
      }
    }
    if (!mp) return rep.code(200).send({ ok: true })
    const s = await mp.consultar(id)
    const r = await guardarEstado(s.id, s.estado)
    if (!r.rowCount) req.log.warn({ id: s.id, empresa: s.empresa }, 'aviso de Mercado Pago de una suscripción que no conocemos')
    return rep.code(200).send({ ok: true })
  })
}
