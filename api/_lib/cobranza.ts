import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'
import { tx, type Db } from './db.js'
import { hoyEn, zonaDeEmpresa } from './fechas.js'
import type { Despachador } from './notificaciones.js'

// Fiado (cuentas por cobrar). Un pedido entregado con forma de pago «crédito» suma a lo que el cliente debe; cada abono
// lo baja. Saldo = lo vendido a crédito − lo abonado (sin los abonos anulados). El administrador ve a todos los
// deudores; el vendedor, los de su cartera. Registrar un abono necesita conexión (no viaja por la cola de sincronización).

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>
type Consulta = Pick<Db, 'query'>

export class Falla extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje)
  }
}
// El trigger de cierre de mes (fn_mes_cerrado) avisa con P0001: se vuelve un 409 legible.
export const comoFalla = (e: unknown) => {
  const x = e as { code?: string; message?: string }
  if (x?.code === 'P0001' && x.message?.includes('ya está cerrado')) return new Falla(409, x.message)
  return e
}

export const redondear = (n: number) => Math.round(n * 100) / 100
const dinero = z.number().finite().positive().max(9_999_999)
const fechaIso = z.iso.date()

export interface Deudor {
  id: string
  nombre: string
  telefono: string | null
  vendedorId: string | null
  fiado: number
  abonado: number
  saldo: number
  desde: string | null // fecha del adeudo más viejo que sigue sin cubrirse (los abonos pagan primero lo más antiguo)
  ultimoAbono: string | null
}

// Los saldos de todos los clientes con deuda (o de uno). `hasta` mira la deuda como estaba ese día (para el cierre de mes).
export async function saldos(q: Consulta, f: { clienteId?: string; vendedorId?: string; hasta?: string } = {}): Promise<Deudor[]> {
  const { rows } = await q.query(
    `WITH cred AS (
       SELECT id_cliente, fecha, total,
              sum(total) OVER (PARTITION BY id_cliente ORDER BY fecha, creado_en, id_pedido) AS acum
         FROM pedidos
        WHERE estado = 'entregado' AND metodo_pago = 'credito' AND ($3::date IS NULL OR fecha <= $3::date)
     ), ab AS (
       SELECT id_cliente, sum(monto) AS abonado, max(fecha)::text AS ultimo FROM abonos
        WHERE anulado_en IS NULL AND ($3::date IS NULL OR fecha <= $3::date) GROUP BY id_cliente
     ), deuda AS (
       SELECT c.id_cliente, sum(c.total) AS fiado, coalesce(ab.abonado, 0) AS abonado, ab.ultimo,
              min(c.fecha) FILTER (WHERE c.acum > coalesce(ab.abonado, 0))::text AS desde
         FROM cred c LEFT JOIN ab USING (id_cliente) GROUP BY c.id_cliente, ab.abonado, ab.ultimo
     )
     SELECT cl.id_cliente, cl.nombre, cl.telefono, cl.id_vendedor, d.fiado::float8, d.abonado::float8, d.desde, d.ultimo
       FROM deuda d JOIN clientes cl USING (id_cliente)
      WHERE ($1::uuid IS NULL OR cl.id_cliente = $1) AND ($2::uuid IS NULL OR cl.id_vendedor = $2)
        AND (d.fiado - d.abonado > 0.004 OR $1::uuid IS NOT NULL)
      ORDER BY d.desde NULLS LAST, lower(cl.nombre)`,
    [f.clienteId ?? null, f.vendedorId ?? null, f.hasta ?? null],
  )
  return rows.map((r) => ({
    id: r.id_cliente, nombre: r.nombre, telefono: r.telefono, vendedorId: r.id_vendedor,
    fiado: redondear(r.fiado), abonado: redondear(r.abonado), saldo: redondear(r.fiado - r.abonado),
    desde: r.desde, ultimoAbono: r.ultimo,
  }))
}

// El cliente tiene que ser de quien lo consulta: el administrador ve todos; el vendedor sólo los de su cartera.
// Cron diario: clientes que deben desde hace más de `dias` días (lo más viejo sin cubrir). A los administradores activos
// de su empresa les llega `fiado_atrasado` (se puede apagar), que abre Cobranza → Por cobrar, donde está el mensaje de
// cobro de cada uno. Cada cliente vuelve a avisarse a los `dias` días si sigue debiendo (`datos.clienteIds`).
// Cruza empresas: la conexión del dueño. shortcut: calcula los saldos de todas las empresas en una consulta; si llegan a
// ser muchas, recorrerlas una por una.
export async function avisarFiadoAtrasado(db: Db, despachador: Despachador, dias = 30): Promise<number> {
  const viejos = (await saldos(db)).filter((d) => d.desde && Date.parse(`${d.desde}T12:00:00Z`) <= Date.now() - dias * 86_400_000)
  if (!viejos.length) return 0
  const { rows } = await db.query(
    `SELECT c.id_cliente, c.id_empresa FROM clientes c JOIN empresas e USING (id_empresa)
      WHERE c.id_cliente = ANY($1::uuid[]) AND e.activa AND NOT e.interna
        AND NOT EXISTS (SELECT 1 FROM notificaciones n
                         WHERE n.id_empresa = c.id_empresa AND n.tipo = 'fiado_atrasado' AND n.creado_en > now() - make_interval(days => $2)
                           AND coalesce(n.datos->'clienteIds', '[]') ? c.id_cliente::text)`,
    [viejos.map((d) => d.id), dias],
  )
  if (!rows.length) return 0
  const deudor = new Map(viejos.map((d) => [d.id, d]))
  const porEmpresa = new Map<string, Deudor[]>()
  for (const r of rows) porEmpresa.set(r.id_empresa, [...(porEmpresa.get(r.id_empresa) ?? []), deudor.get(r.id_cliente)!])
  const { rows: admins } = await db.query(
    `SELECT id_usuario, id_empresa FROM usuarios WHERE rol = 'administrador' AND activo AND id_empresa = ANY($1::uuid[])`, [[...porEmpresa.keys()]])
  const pesos = (n: number) => `$${n.toLocaleString('es-MX', { maximumFractionDigits: 0 })}`
  const fecha = (f: string) => new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
  await despachador.despachar([...porEmpresa].flatMap(([empresa, ds]) => {
    ds.sort((a, b) => b.saldo - a.saldo)
    const nombres = ds.slice(0, 3).map((d) => d.nombre).join(', ') + (ds.length > 3 ? ` y ${ds.length - 3} más` : '')
    const aviso = ds.length === 1
      ? { titulo: 'Fiado de más de un mes', cuerpo: `${ds[0].nombre} debe ${pesos(ds[0].saldo)} desde el ${fecha(ds[0].desde!)}` }
      : { titulo: `${ds.length} clientes deben desde hace más de un mes`, cuerpo: `${nombres}: ${pesos(ds.reduce((s, d) => s + d.saldo, 0))} en total` }
    return admins.filter((a) => a.id_empresa === empresa).map((a) => ({
      para: a.id_usuario as string, tipo: 'fiado_atrasado' as const, ...aviso,
      datos: { url: '/admin?ir=cobrar', clienteIds: ds.map((d) => d.id) },
    }))
  }))
  return rows.length
}

export async function clienteVisible(q: Consulta, usuario: { id: string; rol: string }, id: string) {
  const { rows: [c] } = await q.query(`SELECT id_cliente, nombre, id_vendedor FROM clientes WHERE id_cliente = $1`, [id])
  if (!c || (usuario.rol !== 'administrador' && c.id_vendedor !== usuario.id)) throw new Falla(404, 'Ese cliente no existe')
  return c as { id_cliente: string; nombre: string; id_vendedor: string | null }
}

const bodyAbono = z.object({
  clienteId: z.uuid(),
  monto: dinero,
  metodo: z.enum(['efectivo', 'transferencia']),
  fecha: fechaIso.optional(),
  nota: z.string().trim().max(200).optional(),
})
const bodyAnular = z.object({ motivo: z.string().trim().min(3, 'Escribe el motivo').max(200) })
const idParam = z.object({ id: z.uuid() })

export async function rutasCobranza(app: FastifyInstance, { db, config }: Contexto, { requiereSesion, requiereAdmin }: { requiereSesion: Guardia; requiereAdmin: Guardia }) {
  const responder = (rep: FastifyReply, e: unknown) => {
    const f = comoFalla(e)
    if (f instanceof Falla) return rep.code(f.status).send({ error: f.message })
    throw f
  }

  // «Quién me debe»: todos los deudores con lo que deben y desde cuándo (el vendedor, sólo los suyos).
  app.get('/cobranza', { preHandler: requiereSesion }, async (req) => {
    const deudores = await saldos(db, { vendedorId: req.usuario.rol === 'administrador' ? undefined : req.usuario.id })
    const { rows: nombres } = await db.query(`SELECT id_usuario, nombre FROM usuarios`)
    const vendedor = new Map(nombres.map((n) => [n.id_usuario as string, n.nombre as string]))
    return {
      total: redondear(deudores.reduce((s, d) => s + d.saldo, 0)),
      deudores: deudores.map((d) => ({ ...d, vendedor: d.vendedorId ? vendedor.get(d.vendedorId) ?? null : null })),
    }
  })

  // La cuenta de un cliente: saldo y movimientos (cada venta a crédito y cada abono, del más nuevo al más viejo).
  app.get('/cobranza/clientes/:id', { preHandler: requiereSesion }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    if (!p.success) return rep.code(400).send({ error: 'Cliente no válido' })
    try {
      const c = await clienteVisible(db, req.usuario, p.data.id)
      const [saldo] = await saldos(db, { clienteId: p.data.id })
      const [{ rows: ventas }, { rows: abonos }] = await Promise.all([
        db.query(`SELECT id_pedido, fecha::text, total::float8 FROM pedidos WHERE id_cliente = $1 AND estado = 'entregado' AND metodo_pago = 'credito' ORDER BY fecha DESC, creado_en DESC LIMIT 100`, [p.data.id]),
        db.query(
          `SELECT a.id_abono, a.fecha::text, a.monto::float8, a.metodo, a.nota, a.anulado_en, a.motivo_anulacion, u.nombre AS cobro
             FROM abonos a LEFT JOIN usuarios u ON u.id_usuario = a.id_vendedor WHERE a.id_cliente = $1 ORDER BY a.fecha DESC, a.creado_en DESC LIMIT 100`,
          [p.data.id],
        ),
      ])
      const movimientos = [
        ...ventas.map((v) => ({ tipo: 'venta' as const, id: v.id_pedido as string, fecha: v.fecha as string, monto: v.total as number, anulado: false, nota: null as string | null, por: null as string | null })),
        ...abonos.map((a) => ({
          tipo: 'abono' as const, id: a.id_abono as string, fecha: a.fecha as string, monto: a.monto as number, anulado: !!a.anulado_en,
          nota: (a.anulado_en ? `Anulado: ${a.motivo_anulacion}` : a.nota) as string | null, por: a.cobro as string | null, metodo: a.metodo as string,
        })),
      ].sort((x, y) => (x.fecha < y.fecha ? 1 : x.fecha > y.fecha ? -1 : 0))
      return { cliente: { id: c.id_cliente, nombre: c.nombre }, fiado: saldo?.fiado ?? 0, abonado: saldo?.abonado ?? 0, saldo: saldo?.saldo ?? 0, desde: saldo?.desde ?? null, movimientos }
    } catch (e) {
      return responder(rep, e)
    }
  })

  // Un abono: de quien lo cobró (el vendedor de ese cliente) o del administrador. No puede pasar de lo que se debe.
  app.post('/cobranza/abonos', { preHandler: requiereSesion, config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req, rep) => {
    const b = bodyAbono.safeParse(req.body)
    if (!b.success) return rep.code(400).send({ error: 'Indica cuánto abona, de qué cliente y cómo pagó' })
    try {
      const hoy = hoyEn(await zonaDeEmpresa(db, config.zonaHoraria))
      const r = await tx(db, req.usuario.id, async (c) => {
        await clienteVisible(c, req.usuario, b.data.clienteId)
        await c.query(`SELECT 1 FROM clientes WHERE id_cliente = $1 FOR UPDATE`, [b.data.clienteId]) // dos abonos a la vez no pasan del saldo
        const [s] = await saldos(c, { clienteId: b.data.clienteId })
        const saldo = s?.saldo ?? 0
        if (b.data.monto > saldo + 0.004) throw new Falla(409, saldo > 0 ? `Este cliente debe $${saldo.toFixed(2)}, no puedes abonar más` : 'Este cliente no debe nada')
        const fecha = b.data.fecha ?? hoy
        if (fecha > hoy) throw new Falla(400, 'La fecha del abono no puede ser futura')
        // El efectivo de un día con el corte ya confirmado nunca se esperaría: la deuda bajaría sin que nadie entregue ese
        // dinero. FOR SHARE espera a una confirmación en curso.
        if (b.data.metodo === 'efectivo') {
          const { rows: [k] } = await c.query(
            `SELECT 1 AS ok FROM cortes_dia WHERE fecha = $1 AND id_vendedor = $2 AND estado = 'confirmado' FOR SHARE`,
            [fecha, req.usuario.id],
          )
          if (k) throw new Falla(409, fecha === hoy ? 'Tu corte de hoy ya está confirmado: pide que lo reabran o registra este abono mañana' : 'El corte de ese día ya está confirmado: pide que lo reabran o registra el abono con la fecha de hoy')
        }
        const { rows: [a] } = await c.query(
          `INSERT INTO abonos (id_cliente, id_vendedor, fecha, monto, metodo, nota) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_abono`,
          [b.data.clienteId, req.usuario.id, fecha, b.data.monto, b.data.metodo, b.data.nota || null],
        )
        return { id: a.id_abono as string, saldo: redondear(saldo - b.data.monto) }
      })
      return rep.code(201).send(r)
    } catch (e) {
      return responder(rep, e)
    }
  })

  // Un abono mal capturado se anula con motivo (no se borra): deja de contar y queda a la vista.
  app.post('/cobranza/abonos/:id/anular', { preHandler: requiereAdmin }, async (req, rep) => {
    const p = idParam.safeParse(req.params)
    const b = bodyAnular.safeParse(req.body)
    if (!p.success || !b.success) return rep.code(400).send({ error: b.success ? 'Abono no válido' : b.error.issues[0]?.message ?? 'Escribe el motivo' })
    try {
      await tx(db, req.usuario.id, async (c) => {
        const { rows: [a] } = await c.query(`SELECT id_cliente, anulado_en FROM abonos WHERE id_abono = $1 FOR UPDATE`, [p.data.id])
        if (!a) throw new Falla(404, 'Ese abono no existe')
        if (a.anulado_en) throw new Falla(409, 'Ese abono ya está anulado')
        await c.query(`UPDATE abonos SET anulado_en = now(), anulado_por = $2, motivo_anulacion = $3 WHERE id_abono = $1`, [p.data.id, req.usuario.id, b.data.motivo])
      })
      return { ok: true }
    } catch (e) {
      return responder(rep, e)
    }
  })
}
