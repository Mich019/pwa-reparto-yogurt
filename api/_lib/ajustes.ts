import type { Config } from './config.js'
import type { Db } from './db.js'

// Ajustes de la plataforma (tabla plataforma_ajustes, migración 014): los cambia /plataforma (PATCH /plataforma/ajustes)
// y los usan el registro, el alta de empresas, la pantalla de cobro y el anuncio para todas las empresas.

export interface AjustesPlataforma {
  registroAbierto: boolean
  pruebaDias: number // la que vale: la propia o, sin ella, PRUEBA_DIAS
  pruebaDiasPropia: number | null
  correoSoporte: string | null
  anuncio: { texto: string; tipo: 'info' | 'aviso' } | null
  actualizado: string | null
}

export async function leerAjustes(db: Db, config: Config): Promise<AjustesPlataforma> {
  const { rows: [a] } = await db.query(`SELECT * FROM plataforma_ajustes WHERE id`)
  return {
    registroAbierto: a?.registro_abierto ?? true,
    pruebaDias: a?.prueba_dias ?? config.pruebaDias,
    pruebaDiasPropia: a?.prueba_dias ?? null,
    correoSoporte: a?.correo_soporte ?? null,
    anuncio: a?.anuncio ? { texto: a.anuncio, tipo: a.anuncio_tipo } : null,
    actualizado: a?.actualizado_en ? new Date(a.actualizado_en).toISOString() : null,
  }
}
