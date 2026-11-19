import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Contexto } from './app.js'

// Bitácora de cambios para el administrador (Configuración → Bitácora). Lee la tabla auditoria (los triggers de
// fn_auditar guardan cada cambio con quién lo hizo, migración 047) y la cuenta en palabras, con un nivel según cuánta
// atención pide:
//   leve     = lo de todos los días (un abono, confirmar un corte, editar un producto, pasar un cliente a otro vendedor)
//   moderado = cambia dinero o reglas hacia adelante (precios, metas, límites, dar de baja un cliente, cerrar el mes)
//   alto     = deshace o abre una puerta (anular un abono, reabrir un corte o un mes, borrar, cambiar roles, el código
//              para fiar de más, quitar la verificación en dos pasos)
// No es el registro del servidor (eso es bitacora.ts): esto lo ve el dueño del negocio.

export type Nivel = 'leve' | 'moderado' | 'alto'
export const NIVELES: Nivel[] = ['leve', 'moderado', 'alto']
type Area = 'productos' | 'equipo' | 'clientes' | 'pedidos' | 'cobranza' | 'empresa' | 'seguridad'
type Fila = { id: string; en: string; quien: string | null; accion: string; tabla: string; registro: string | null; antes: Datos | null; despues: Datos | null }
type Datos = Record<string, unknown>
type Parte = { nivel: Nivel; texto: string }
type Nombres = Map<string, string>
// Varios cambios iguales seguidos (reasignar 50 clientes) se juntan en un renglón.
type Grupo = { clave: string; plural: (n: number) => string }
export interface Evento { id: string; en: string; nivel: Nivel; area: Area; texto: string; quien: { id: string | null; nombre: string }; veces: number }

const peso = (n: Nivel) => NIVELES.indexOf(n)
const dinero = (v: unknown) => `$${Number(v ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const dia = (v: unknown) => { const [a, m, d] = String(v).slice(0, 10).split('-').map(Number); return `${d} de ${MESES[m - 1]}${a === new Date().getFullYear() ? '' : ` de ${a}`}` }
const mes = (v: unknown) => { const [a, m] = String(v).slice(0, 7).split('-').map(Number); return `${MESES[m - 1]} de ${a}` }
const cambio = (f: Fila, k: string) => f.accion === 'UPDATE' && JSON.stringify(f.antes?.[k] ?? null) !== JSON.stringify(f.despues?.[k] ?? null)
const ultimoMotivo = (h: unknown) => { const l = Array.isArray(h) ? h : []; const m = l[l.length - 1]?.motivo; return typeof m === 'string' && m ? `: «${m}»` : '' }

// Lo que dice un registro de auditoria, o null si no le interesa al administrador.
export function describir(f: Fila, nombres: Nombres): { area: Area; partes: Parte[]; grupo?: Grupo } | null {
  const d = (f.despues ?? f.antes ?? {}) as Datos
  const nom = (id: unknown, otro = 'alguien') => (typeof id === 'string' && nombres.get(id)) || otro
  const yoMismo = f.quien != null && f.quien === f.registro
  switch (f.tabla) {
    case 'productos': {
      const p = `«${d.sabor ?? d.nombre}»`
      if (f.accion === 'INSERT') return { area: 'productos', partes: [{ nivel: 'leve', texto: `Agregó el producto ${p}` }] }
      if (f.accion === 'DELETE') return { area: 'productos', partes: [{ nivel: 'alto', texto: `Borró el producto ${p}` }] }
      const partes: Parte[] = []
      if (cambio(f, 'precio_unitario')) partes.push({ nivel: 'moderado', texto: `Cambió el precio de ${p} de ${dinero(f.antes?.precio_unitario)} a ${dinero(f.despues?.precio_unitario)}` })
      if (cambio(f, 'costo_produccion')) partes.push({ nivel: 'moderado', texto: `Cambió el costo de ${p} de ${dinero(f.antes?.costo_produccion)} a ${dinero(f.despues?.costo_produccion)}` })
      if (cambio(f, 'disponible')) partes.push({ nivel: 'leve', texto: f.despues?.disponible ? `Volvió a producir ${p}` : `Dejó de producir ${p}` })
      if (cambio(f, 'retornable')) partes.push({ nivel: 'leve', texto: `${f.despues?.retornable ? 'Marcó' : 'Desmarcó'} ${p} como envase retornable` })
      if (!partes.length && ['nombre', 'sabor', 'descripcion', 'color_hex'].some((k) => cambio(f, k))) partes.push({ nivel: 'leve', texto: `Editó el producto ${p}` })
      return partes.length ? { area: 'productos', partes } : null
    }
    case 'usuarios': {
      const quien = `${d.nombre ?? 'una cuenta'}`
      if (d.es_plataforma) return null
      if (f.accion === 'INSERT') return { area: 'equipo', partes: [{ nivel: 'moderado', texto: `Creó la cuenta de ${quien} (${d.rol})` }] }
      if (f.accion === 'DELETE') return { area: 'equipo', partes: [{ nivel: 'alto', texto: `Borró la cuenta de ${quien}` }] }
      const partes: Parte[] = []
      if (cambio(f, 'eliminado_en') && f.despues?.eliminado_en) return { area: 'equipo', partes: [{ nivel: 'alto', texto: yoMismo ? 'Eliminó su propia cuenta' : `Eliminó la cuenta de ${quien}` }] }
      if (cambio(f, 'rol')) partes.push({ nivel: 'alto', texto: `Cambió a ${quien} de ${f.antes?.rol} a ${f.despues?.rol}` })
      if (cambio(f, 'activo')) partes.push(f.despues?.activo ? { nivel: 'moderado', texto: `Reactivó a ${quien}` } : { nivel: 'alto', texto: `Dio de baja a ${quien}` })
      if (cambio(f, 'correo')) partes.push({ nivel: 'alto', texto: yoMismo ? 'Cambió su correo' : `Cambió el correo de ${quien}` })
      if (cambio(f, 'debe_cambiar_password') && f.despues?.debe_cambiar_password) partes.push({ nivel: 'alto', texto: `Le puso una contraseña temporal a ${quien}` })
      else if (cambio(f, 'password_cambiado_en')) partes.push({ nivel: 'leve', texto: yoMismo ? 'Cambió su contraseña' : `Cambió la contraseña de ${quien}` })
      if (cambio(f, 'meta_mensual')) partes.push({ nivel: 'moderado', texto: `Cambió la meta de ${quien} de ${f.antes?.meta_mensual == null ? 'ninguna' : dinero(f.antes.meta_mensual)} a ${f.despues?.meta_mensual == null ? 'ninguna' : dinero(f.despues.meta_mensual)}` })
      if (cambio(f, 'comision_pct')) partes.push({ nivel: 'moderado', texto: `Cambió la comisión de ${quien} de ${f.antes?.comision_pct ?? 0}% a ${f.despues?.comision_pct ?? 0}%` })
      if (!partes.length && ['nombre', 'telefono', 'foto'].some((k) => cambio(f, k))) partes.push({ nivel: 'leve', texto: yoMismo ? 'Actualizó su perfil' : `Actualizó el perfil de ${quien}` })
      return partes.length ? { area: 'equipo', partes } : null
    }
    case 'dos_pasos':
      return { area: 'seguridad', partes: [f.despues?.dos_pasos ? { nivel: 'leve', texto: 'Activó la verificación en dos pasos' } : { nivel: 'alto', texto: 'Quitó la verificación en dos pasos' }] }
    case 'clientes': {
      const c = `«${d.nombre}»`
      if (f.accion === 'DELETE') return { area: 'clientes', partes: [{ nivel: 'alto', texto: `Borró al cliente ${c}` }] }
      const partes: Parte[] = []
      let grupo: Grupo | undefined
      if (cambio(f, 'activo')) partes.push(f.despues?.activo ? { nivel: 'leve', texto: `Reactivó al cliente ${c}` } : { nivel: 'moderado', texto: `Dio de baja al cliente ${c}` })
      if (cambio(f, 'id_vendedor')) {
        const de = nom(f.antes?.id_vendedor, 'sin vendedor'), a = nom(f.despues?.id_vendedor, 'sin vendedor')
        partes.push({ nivel: 'leve', texto: `Pasó a ${c} de ${de} a ${a}` })
        if (partes.length === 1) grupo = { clave: `vendedor:${f.antes?.id_vendedor}:${f.despues?.id_vendedor}`, plural: (n) => `Pasó ${n} clientes de ${de} a ${a}` }
      }
      if (cambio(f, 'limite_fiado')) {
        const [a, b] = [f.antes?.limite_fiado, f.despues?.limite_fiado]
        partes.push({ nivel: 'moderado', texto: a == null ? `Le puso a ${c} un límite de fiado propio de ${dinero(b)}`
          : b == null ? `Le quitó a ${c} su límite de fiado propio (ahora usa el de la empresa)`
          : `Cambió el límite de fiado de ${c} de ${dinero(a)} a ${dinero(b)}` })
      }
      return partes.length ? { area: 'clientes', partes, grupo } : null
    }
    case 'pedidos':
      return { area: 'pedidos', partes: [{ nivel: 'alto', texto: `Borró un pedido de ${nom(d.id_cliente, 'un cliente')} del ${dia(d.fecha)} por ${dinero(d.total)}` }] }
    case 'precios_cliente': {
      const c = nom(d.id_cliente, 'un cliente'), p = nom(d.id_producto, 'un producto')
      const texto = f.accion === 'DELETE' ? `Quitó el precio especial de ${p} a ${c}`
        : f.accion === 'INSERT' ? `Puso a ${c} precio especial de ${dinero(d.precio_unitario)} en ${p}`
        : `Cambió el precio especial de ${p} a ${c} de ${dinero(f.antes?.precio_unitario)} a ${dinero(f.despues?.precio_unitario)}`
      return { area: 'clientes', partes: [{ nivel: 'moderado', texto }], grupo: { clave: `precios:${d.id_cliente}`, plural: (n) => `Cambió ${n} precios especiales de ${c}` } }
    }
    case 'abonos': {
      const c = nom(d.id_cliente, 'un cliente')
      if (f.accion === 'INSERT') return { area: 'cobranza', partes: [{ nivel: 'leve', texto: `Registró un abono de ${dinero(d.monto)} de ${c} (${d.metodo === 'transferencia' ? 'transferencia' : 'efectivo'})` }] }
      if (!cambio(f, 'anulado_en') || !f.despues?.anulado_en) return null
      const motivo = f.despues?.motivo_anulacion ? `: «${f.despues.motivo_anulacion}»` : ''
      return { area: 'cobranza', partes: [{ nivel: 'alto', texto: `Anuló un abono de ${dinero(d.monto)} de ${c} del ${dia(d.fecha)}${motivo}` }] }
    }
    case 'cortes_dia': {
      if (!cambio(f, 'estado')) return null
      const de = `${nom(d.id_vendedor)} del ${dia(d.fecha)}`
      if (f.despues?.estado === 'pendiente') return { area: 'cobranza', partes: [{ nivel: 'alto', texto: `Reabrió el corte de ${de}${ultimoMotivo(f.despues?.historial)}` }] }
      const dif = Number(d.diferencia ?? 0)
      return { area: 'cobranza', partes: [Math.abs(dif) >= 0.01
        ? { nivel: 'moderado', texto: `Confirmó el corte de ${de} con ${dif < 0 ? 'faltante' : 'sobrante'} de ${dinero(Math.abs(dif))}` }
        : { nivel: 'leve', texto: `Confirmó el corte de ${de}` }] }
    }
    case 'cierres_mes':
      if (f.accion === 'UPDATE' && !cambio(f, 'estado')) return null
      return { area: 'cobranza', partes: [d.estado === 'reabierto'
        ? { nivel: 'alto', texto: `Reabrió el mes de ${mes(d.mes)}${ultimoMotivo(d.historial)}` }
        : { nivel: 'moderado', texto: `Cerró el mes de ${mes(d.mes)}` }] }
    case 'envases_recogidos':
      if (!cambio(f, 'anulado_en') || !f.despues?.anulado_en) return null
      return { area: 'cobranza', partes: [{ nivel: 'moderado', texto: `Anuló una recogida de ${d.cantidad} ${Number(d.cantidad) === 1 ? 'envase' : 'envases'} de ${nom(d.id_cliente, 'un cliente')} del ${dia(d.fecha)}` }] }
    case 'invitaciones':
      return { area: 'equipo', partes: [{ nivel: 'moderado', texto: `Invitó a ${d.correo} como ${d.rol}` }] }
    case 'empresas': {
      const partes: Parte[] = []
      const leve = (k: string, que: string) => { if (cambio(f, k)) partes.push({ nivel: 'leve', texto: `Cambió ${que}` }) }
      leve('nombre', `el nombre de la empresa a «${f.despues?.nombre}»`)
      leve('logo', 'el logo')
      leve('color_marca', 'el color de la marca')
      leve('lema', 'el lema')
      leve('contacto', 'el contacto de los informes')
      leve('zona_horaria', `la zona horaria a ${f.despues?.zona_horaria}`)
      if (['firma_nombre', 'firma_cargo', 'firma_imagen'].some((k) => cambio(f, k))) partes.push({ nivel: 'leve', texto: 'Cambió la firma de los informes' })
      leve('minutos_urgente', `el aviso de urgentes a ${f.despues?.minutos_urgente} minutos`)
      leve('ritmo_meta_pct', `el aviso de metas atrasadas a ${f.despues?.ritmo_meta_pct}%`)
      if (cambio(f, 'control_retornables')) partes.push({ nivel: 'moderado', texto: `${f.despues?.control_retornables ? 'Encendió' : 'Apagó'} la cuenta de envases` })
      if (cambio(f, 'limite_fiado')) partes.push({ nivel: 'moderado', texto: `Cambió el límite de fiado de la empresa de ${f.antes?.limite_fiado == null ? 'ninguno' : dinero(f.antes.limite_fiado)} a ${f.despues?.limite_fiado == null ? 'ninguno' : dinero(f.despues.limite_fiado)}` })
      if (cambio(f, 'codigo_fiado')) partes.push({ nivel: 'alto', texto: !f.despues?.codigo_fiado ? 'Quitó el código para fiar de más' : !f.antes?.codigo_fiado ? 'Puso un código para fiar de más' : 'Cambió el código para fiar de más' })
      if (cambio(f, 'suscripcion_estado')) partes.push({ nivel: 'leve', texto: `La suscripción quedó ${f.despues?.suscripcion_estado === 'authorized' ? 'activa' : `en «${f.despues?.suscripcion_estado ?? 'sin suscripción'}»`}` })
      if (cambio(f, 'prueba_hasta')) partes.push({ nivel: 'moderado', texto: `La prueba gratis ahora termina el ${dia(f.despues?.prueba_hasta)}` })
      if (cambio(f, 'activa')) partes.push({ nivel: 'alto', texto: f.despues?.activa ? 'La empresa se reactivó' : 'La empresa quedó suspendida' })
      if (cambio(f, 'baja_solicitada_en') && f.despues?.baja_solicitada_en) partes.push({ nivel: 'alto', texto: 'Pidió dar de baja la empresa' })
      return partes.length ? { area: 'empresa', partes } : null
    }
  }
  return null
}

const TAM_PAGINA = 40
const LOTE = 200
const TOPE_LEIDOS = 4000 // con un filtro de nivel, cuánto se busca hacia atrás en una sola petición

type Guardia = (req: FastifyRequest, rep: FastifyReply) => Promise<unknown>
const query = z.object({
  antes: z.coerce.number().int().positive().optional(), // id_auditoria del último que ya se mostró
  nivel: z.enum(['leve', 'moderado', 'alto']).optional(),
})

export async function rutasBitacoraCambios(app: FastifyInstance, { db }: Contexto, { requiereAdmin }: { requiereAdmin: Guardia }) {
  app.get('/bitacora', { preHandler: requiereAdmin }, async (req, rep) => {
    const q = query.safeParse(req.query)
    if (!q.success) return rep.code(400).send({ error: 'Parámetros no válidos' })
    // Nombres de la empresa (con los dados de baja): la bitácora cita a clientes, productos y personas por su id.
    const [{ rows: personas }, { rows: clientes }, { rows: productos }] = await Promise.all([
      db.query(`SELECT id_usuario AS id, nombre FROM usuarios`),
      db.query(`SELECT id_cliente AS id, nombre FROM clientes`),
      db.query(`SELECT id_producto AS id, sabor AS nombre FROM productos`),
    ])
    const nombres: Nombres = new Map([...clientes, ...productos, ...personas].map((r) => [r.id as string, r.nombre as string]))
    const deLaEmpresa = new Set(personas.map((r) => r.id as string))

    const eventos: Evento[] = []
    let cursor = q.data.antes ?? null
    let leidos = 0
    let siguiente: string | null = null
    let agotado = false
    while (eventos.length < TAM_PAGINA && leidos < TOPE_LEIDOS) {
      const { rows } = await db.query(
        `SELECT id_auditoria::text AS id, creado_en AS en, id_usuario AS quien, accion, tabla, id_registro AS registro, datos_antes AS antes, datos_despues AS despues
           FROM auditoria
          WHERE id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid AND ($1::bigint IS NULL OR id_auditoria < $1)
          ORDER BY id_auditoria DESC LIMIT ${LOTE}`,
        [cursor],
      )
      leidos += rows.length
      for (const f of rows as Fila[]) {
        cursor = Number(f.id)
        const r = describir(f, nombres)
        if (!r) continue
        const nivel = r.partes.reduce<Nivel>((n, p) => (peso(p.nivel) > peso(n) ? p.nivel : n), 'leve')
        if (q.data.nivel && nivel !== q.data.nivel) continue
        const quien = f.quien == null ? { id: null, nombre: 'El sistema' } : deLaEmpresa.has(f.quien) ? { id: f.quien, nombre: nombres.get(f.quien)! } : { id: null, nombre: 'Soporte de Delisy' }
        const previo = eventos[eventos.length - 1] as (Evento & { grupo?: string }) | undefined
        const clave = r.grupo ? `${r.grupo.clave}:${f.quien}` : undefined
        // Juntar con el anterior si es el mismo cambio repetido, de la misma persona y a menos de 10 minutos.
        if (clave && previo?.grupo === clave && Math.abs(new Date(previo.en).getTime() - new Date(f.en).getTime()) < 10 * 60_000) {
          previo.veces++
          previo.texto = r.grupo!.plural(previo.veces)
          continue
        }
        if (eventos.length >= TAM_PAGINA) { siguiente = String(Number(f.id) + 1); break }
        eventos.push(Object.assign({ id: f.id, en: new Date(f.en).toISOString(), nivel, area: r.area, texto: r.partes.map((p) => p.texto).join('. '), quien, veces: 1 }, clave ? { grupo: clave } : {}))
      }
      if (rows.length < LOTE) agotado = true
      if (siguiente || agotado) break
    }
    // Página llena o tope de búsqueda: hay más hacia atrás.
    if (!siguiente && !agotado) siguiente = String(cursor)
    return { eventos: eventos.map(({ grupo: _g, ...e }: Evento & { grupo?: string }) => e), siguiente }
  })
}
