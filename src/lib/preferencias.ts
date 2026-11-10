import { useEffect, useState } from 'react'
import { guardarPerfil, llamarAutenticado } from './sesion'
import { useListo } from '../components/Esqueleto'

// Preferencias de avisos de la cuenta (PATCH /me): qué avisos no quiere y su horario de silencio. Las usan el panel
// (Configuración → Preferencias) y el teléfono (Cuenta → Preferencias). Se piden al abrir: sin señal quedan en null.
export interface Silencio { desde: number; hasta: number }
interface Prefs { avisosApagados: string[]; silencio: Silencio | null; resumenCorreo: boolean; resumenSemanal: boolean; resumenSemanalDia: number; resumenMensual: boolean }

export function usePreferenciasAvisos(alFallar: (e: unknown) => void) {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [sinSenal, setSinSenal] = useState(false)
  // «Guardado ✓» / «No se pudo guardar» junto a cada apartado, que guarda solo al tocar.
  const [listoAvisos, marcarAvisos] = useListo(), [listoResumen, marcarResumen] = useListo(), [listoSilencio, marcarSilencio] = useListo()
  useEffect(() => {
    llamarAutenticado<Partial<Prefs>>('/me')
      .then((r) => setPrefs({ avisosApagados: r.avisosApagados ?? [], silencio: r.silencio ?? null, resumenCorreo: !!r.resumenCorreo, resumenSemanal: !!r.resumenSemanal, resumenSemanalDia: r.resumenSemanalDia ?? 1, resumenMensual: !!r.resumenMensual }))
      .catch(() => setSinSenal(true))
  }, [])
  // Se ve al momento; si el servidor no lo guarda, vuelve a como estaba.
  async function cambiar(nuevo: Partial<Prefs>) {
    if (!prefs) return
    const antes = prefs
    setPrefs({ ...prefs, ...nuevo })
    const marcar = 'avisosApagados' in nuevo ? marcarAvisos : 'silencio' in nuevo ? marcarSilencio : marcarResumen
    try {
      await guardarPerfil(nuevo)
      marcar()
    } catch (e) {
      setPrefs(antes)
      marcar(false)
      alFallar(e)
    }
  }
  const encendido = (tipo: string) => !!prefs && !prefs.avisosApagados.includes(tipo)
  const alternar = (tipo: string, si: boolean) =>
    prefs && cambiar({ avisosApagados: si ? prefs.avisosApagados.filter((t) => t !== tipo) : [...prefs.avisosApagados, tipo] })
  return { prefs, sinSenal, listo: { avisos: listoAvisos, resumen: listoResumen, silencio: listoSilencio }, encendido, alternar, cambiarSilencio: (silencio: Silencio | null) => cambiar({ silencio }), cambiarResumen: (resumenCorreo: boolean) => cambiar({ resumenCorreo }), cambiarSemanal: (resumenSemanal: boolean) => cambiar({ resumenSemanal }), cambiarDiaSemanal: (resumenSemanalDia: number) => cambiar({ resumenSemanalDia }), cambiarMensual: (resumenMensual: boolean) => cambiar({ resumenMensual }) }
}

export const HORAS = Array.from({ length: 24 }, (_, h) => h)
export const hora = (h: number) => `${String(h).padStart(2, '0')}:00`
// ¿La hora `h` (0–23) cae en el horario? Puede pasar de medianoche (21 a 7). Igual que en api/_lib/notificaciones.ts.
export const enSilencio = (s: Silencio | null | undefined, h: number) =>
  !!s && (s.desde < s.hasta ? h >= s.desde && h < s.hasta : h >= s.desde || h < s.hasta)

// Lo que se propone al prender el silencio: de noche.
export const SILENCIO_NOCHE: Silencio = { desde: 21, hasta: 7 }
