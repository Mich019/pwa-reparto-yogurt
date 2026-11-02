import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { color, logo } from './registro.js'

// Marca de la empresa (Fase 4): nombre, logo y color que ven su panel, su app de reparto y sus PDF; lema y contacto
// (migración 013) salen en los PDF.
// Cualquiera de la empresa la lee (también sin suscripción: la pantalla de cobro la muestra); sólo el administrador la
// cambia. Sin logo ni color, la app sigue con la imagen de Danelle (las empresas de antes de la marca por empresa).

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

const bodyMarca = z.object({
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 letras').max(120).optional(),
  color: color.nullable().optional(),
  logo: logo.nullable().optional(),
  // '' o null lo quita
  lema: z.string().trim().max(80, 'El lema es de 80 letras como máximo').nullable().optional(),
  contacto: z.string().trim().max(160, 'El contacto es de 160 letras como máximo').nullable().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nada que cambiar')

export async function rutasEmpresa(app: FastifyInstance, { db }: Contexto, { requiereSesionAunConPasswordPendiente, requiereAdmin }: { requiereSesionAunConPasswordPendiente: Guardia; requiereAdmin: Guardia }) {
  const leer = async (id: string) => {
    const { rows: [e] } = await db.query(`SELECT nombre, color_marca, logo, lema, contacto FROM empresas WHERE id_empresa = $1`, [id])
    return {
      nombre: e.nombre as string,
      color: (e.color_marca as string | null) ?? null,
      logo: (e.logo as string | null) ?? null,
      lema: (e.lema as string | null) ?? null,
      contacto: (e.contacto as string | null) ?? null,
    }
  }

  // También con la contraseña temporal pendiente o sin suscripción: desde la primera pantalla se ve la marca de su empresa.
  app.get('/empresa', { preHandler: requiereSesionAunConPasswordPendiente }, async (req) => leer(req.usuario.empresa))

  app.patch('/empresa', { preHandler: requiereAdmin, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyMarca.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const { nombre, color: c, logo: l, lema, contacto } = b.data
    await db.query(
      `UPDATE empresas SET nombre = coalesce($2, nombre),
              color_marca = CASE WHEN $3 THEN $4 ELSE color_marca END,
              logo = CASE WHEN $5 THEN $6 ELSE logo END,
              lema = CASE WHEN $7 THEN $8 ELSE lema END,
              contacto = CASE WHEN $9 THEN $10 ELSE contacto END,
              actualizado_en = now()
        WHERE id_empresa = $1`,
      [req.usuario.empresa, nombre ?? null, c !== undefined, c ?? null, l !== undefined, l ?? null,
        lema !== undefined, lema || null, contacto !== undefined, contacto || null],
    )
    return leer(req.usuario.empresa)
  })
}
