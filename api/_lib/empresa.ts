import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { color, logo } from './registro.js'
import { olvidarZona } from './fechas.js'
import { createHash, randomBytes } from 'node:crypto'

// Marca de la empresa (Fase 4): nombre, logo y color que ven su panel, su app de reparto y sus PDF; lema y contacto
// (migración 013) salen en los PDF.
// Cualquiera de la empresa la lee (también sin suscripción: la pantalla de cobro la muestra); sólo el administrador la
// cambia. Sin logo ni color, la app sigue con la imagen de Danelle (las empresas de antes de la marca por empresa).

const zonaValida = (z: string) => { try { new Intl.DateTimeFormat('en', { timeZone: z }); return true } catch { return false } }

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>

const bodyMarca = z.object({
  nombre: z.string().trim().min(2, 'El nombre debe tener al menos 2 letras').max(120).optional(),
  color: color.nullable().optional(),
  logo: logo.nullable().optional(),
  // '' o null lo quita
  lema: z.string().trim().max(80, 'El lema es de 80 letras como máximo').nullable().optional(),
  contacto: z.string().trim().max(160, 'El contacto es de 160 letras como máximo').nullable().optional(),
  // Define el «hoy» de la empresa (ruta del día, stock, resumen y reportes).
  zonaHoraria: z.string().refine(zonaValida, 'Zona horaria no válida').optional(),
  // Cuánto espera un urgente pendiente antes de recordarlo (urgentes.ts).
  minutosUrgente: z.number().int().min(5, 'Mínimo 5 minutos').max(240, 'Máximo 4 horas').optional(),
  // Por debajo de qué porcentaje del ritmo del mes se avisa de una meta atrasada (resumen.ts).
  ritmoMetaPct: z.number().int().min(30, 'Mínimo 30%').max(100, 'Máximo 100%').optional(),
  // Límite de fiado de los clientes que no tienen uno propio (migración 036); null lo quita. Sólo avisa al fiar.
  limiteFiado: z.number().finite().min(0, 'El límite no puede ser negativo').max(99999999).nullable().optional(),
  // Código para fiar de más (migración 037); null lo quita y vuelve a sólo avisar.
  codigoFiado: z.string().regex(/^\d{4,8}$/, 'El código lleva de 4 a 8 números').nullable().optional(),
  // Quién firma el informe del cierre de mes (migración 038); '' o null vuelve a «quien lo genera» / «Administrador».
  firmaNombre: z.string().trim().max(120, 'El nombre es de 120 letras como máximo').nullable().optional(),
  firmaCargo: z.string().trim().max(80, 'El cargo es de 80 letras como máximo').nullable().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'Nada que cambiar')

export async function rutasEmpresa(app: FastifyInstance, { db }: Contexto, { requiereSesionAunConPasswordPendiente, requiereAdmin }: { requiereSesionAunConPasswordPendiente: Guardia; requiereAdmin: Guardia }) {
  const leer = async (id: string) => {
    const { rows: [e] } = await db.query(`SELECT nombre, color_marca, logo, lema, contacto, zona_horaria, minutos_urgente, ritmo_meta_pct, limite_fiado, codigo_fiado, firma_nombre, firma_cargo FROM empresas WHERE id_empresa = $1`, [id])
    return {
      nombre: e.nombre as string,
      color: (e.color_marca as string | null) ?? null,
      logo: (e.logo as string | null) ?? null,
      lema: (e.lema as string | null) ?? null,
      contacto: (e.contacto as string | null) ?? null,
      zonaHoraria: e.zona_horaria as string,
      minutosUrgente: e.minutos_urgente as number,
      ritmoMetaPct: e.ritmo_meta_pct as number,
      limiteFiado: e.limite_fiado === null ? null : Number(e.limite_fiado),
      // Va a todos los teléfonos para revisarlo sin señal: es un freno para el día a día, no una contraseña (con 4 a 8
      // números, quien saque esto del teléfono lo adivina probando). Lo serio sigue siendo el aviso al administrador.
      codigoFiado: (e.codigo_fiado as string | null) ?? null,
      firmaNombre: (e.firma_nombre as string | null) ?? null,
      firmaCargo: (e.firma_cargo as string | null) ?? null,
    }
  }

  // También con la contraseña temporal pendiente o sin suscripción: desde la primera pantalla se ve la marca de su empresa.
  app.get('/empresa', { preHandler: requiereSesionAunConPasswordPendiente }, async (req) => leer(req.usuario.empresa))

  app.patch('/empresa', { preHandler: requiereAdmin, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyMarca.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: b.error.issues[0]?.message ?? 'Datos no válidos' })
    const { nombre, color: c, logo: l, lema, contacto, zonaHoraria, minutosUrgente, ritmoMetaPct, limiteFiado, codigoFiado, firmaNombre, firmaCargo } = b.data
    const sal = randomBytes(8).toString('hex')
    const codigo = codigoFiado ? `${sal}:${createHash('sha256').update(`${sal}:${codigoFiado}`).digest('hex')}` : null
    await db.query(
      `UPDATE empresas SET nombre = coalesce($2, nombre),
              color_marca = CASE WHEN $3 THEN $4 ELSE color_marca END,
              logo = CASE WHEN $5 THEN $6 ELSE logo END,
              lema = CASE WHEN $7 THEN $8 ELSE lema END,
              contacto = CASE WHEN $9 THEN $10 ELSE contacto END,
              zona_horaria = coalesce($11, zona_horaria),
              minutos_urgente = coalesce($12::smallint, minutos_urgente),
              ritmo_meta_pct = coalesce($13::smallint, ritmo_meta_pct),
              limite_fiado = CASE WHEN $14 THEN $15::numeric ELSE limite_fiado END,
              codigo_fiado = CASE WHEN $16 THEN $17 ELSE codigo_fiado END,
              firma_nombre = CASE WHEN $18 THEN $19 ELSE firma_nombre END,
              firma_cargo = CASE WHEN $20 THEN $21 ELSE firma_cargo END,
              actualizado_en = now()
        WHERE id_empresa = $1`,
      [req.usuario.empresa, nombre ?? null, c !== undefined, c ?? null, l !== undefined, l ?? null,
        lema !== undefined, lema || null, contacto !== undefined, contacto || null, zonaHoraria ?? null, minutosUrgente ?? null, ritmoMetaPct ?? null, limiteFiado !== undefined, limiteFiado ?? null, codigoFiado !== undefined, codigo, firmaNombre !== undefined, firmaNombre || null, firmaCargo !== undefined, firmaCargo || null],
    )
    if (zonaHoraria) olvidarZona(req.usuario.empresa)
    return leer(req.usuario.empresa)
  })
}
