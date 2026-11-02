import { useEffect, useState } from 'react'
import { api, MODO_SERVIDOR } from './api'

// Lo que la plataforma publica para todos, con o sin sesión (GET /plataforma/publico, api/_lib/plataforma.ts): un
// anuncio, si el registro de empresas está abierto y el correo de soporte. Se pide una vez por carga de la página; sin
// conexión no hay nada que mostrar.

export interface PlataformaPublica {
  anuncio: { texto: string; tipo: 'info' | 'aviso' } | null
  registroAbierto: boolean
  correoSoporte: string | null
}

let pedido: Promise<PlataformaPublica | null> | null = null

export function usePlataformaPublica() {
  const [datos, setDatos] = useState<PlataformaPublica | null>(null)
  useEffect(() => {
    if (!MODO_SERVIDOR) return
    pedido ??= api<PlataformaPublica>('/plataforma/publico').catch(() => {
      pedido = null // se reintenta en la siguiente pantalla que lo pida
      return null
    })
    let vigente = true
    void pedido.then((d) => { if (vigente) setDatos(d) })
    return () => { vigente = false }
  }, [])
  return datos
}
