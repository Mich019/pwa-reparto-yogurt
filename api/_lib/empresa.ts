import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { color, logo } from './registro.js'

// Marca de la empresa (Fase 4): nombre, logo y color que ven su panel, su app de reparto y sus PDF.
// Cualquiera de la empresa la lee (también sin suscripción: la pantalla de cobro la muestra); sólo el administrador la
// cambia. Sin logo ni color, la app sigue con la imagen de Danelle (las empresas de antes de la marca por empresa).

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

const bodyMarca = z.object({
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 letras').max(120).optional(),
  color: color.nullable().optional(),
  logo: logo.nullable().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nada que cambiar')

export async function rutasEmpresa(app: FastifyInstance, { db }: Contexto, { requiereSesionSinCobro, requiereAdmin }: { requiereSesionSinCobro: Guardia; requiereAdmin: Guardia }) {
  const leer = async (id: string) => {
    const { rows: [e] } = await db.query(`SELECT nombre, color_marca, logo FROM empresas WHERE id_empresa = $1`, [id])
    return { nombre: e.nombre as string, color: (e.color_marca as string | null) ?? null, logo: (e.logo as string | null) ?? null }
  }

  app.get('/empresa', { preHandler: requiereSesionSinCobro }, async (req) => leer(req.usuario.empresa))

  app.patch('/empresa', { preHandler: requiereAdmin, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyMarca.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const { nombre, color: c, logo: l } = b.data
    await db.query(
      `UPDATE empresas SET nombre = coalesce($2, nombre),
              color_marca = CASE WHEN $3 THEN $4 ELSE color_marca END,
              logo = CASE WHEN $5 THEN $6 ELSE logo END,
              actualizado_en = now()
        WHERE id_empresa = $1`,
      [req.usuario.empresa, nombre ?? null, c !== undefined, c ?? null, l !== undefined, l ?? null],
    )
    return leer(req.usuario.empresa)
  })
}
