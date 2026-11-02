import type { Config } from './config.js'
import type { Db } from './db.js'

// Ajustes de la plataforma (tabla plataforma_ajustes, migración 014): los cambia /plataforma (PATCH /plataforma/ajustes)
// y los usan el registro, el alta de empresas, la pantalla de cobro y el aviso automático de la prueba por vencer
// (GET /plataforma/avisos/vigentes). Los avisos escritos a mano van en su propia tabla (avisos_plataforma, migración 015).

export interface AjustesPlataforma {
  registroAbierto: boolean
  pruebaDias: number // la que vale: la propia o, sin ella, PRUEBA_DIAS
  pruebaDiasPropia: number | null
  correoSoporte: string | null
  avisoPrueba: { dias: number; vendedores: boolean } // dias = 0: sin aviso automático
  actualizado: string | null
}

export async function leerAjustes(db: Db, config: Config): Promise<AjustesPlataforma> {
  const { rows: [a] } = await db.query(`SELECT * FROM plataforma_ajustes WHERE id`)
  return {
    registroAbierto: a?.registro_abierto ?? true,
    pruebaDias: a?.prueba_dias ?? config.pruebaDias,
    pruebaDiasPropia: a?.prueba_dias ?? null,
    correoSoporte: a?.correo_soporte ?? null,
    avisoPrueba: { dias: a?.aviso_prueba_dias ?? 7, vendedores: a?.aviso_prueba_vendedores ?? false },
    actualizado: a?.actualizado_en ? new Date(a.actualizado_en).toISOString() : null,
  }
}
