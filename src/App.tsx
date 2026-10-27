import { useEffect, useState } from 'react'
import { LoginAdmin } from './views/admin/LoginAdmin'
import { AdminLayout } from './views/admin/AdminLayout'
import { Registro } from './views/registro/Registro'
import { Login, CambioObligatorio } from './views/pwa/Login'
import { PwaLayout } from './views/pwa/PwaLayout'
import { Avisos } from './components/ui'
import { VisorPdf } from './components/VisorPdf'
import { MODO_SERVIDOR } from './lib/api'
import { useSesion } from './lib/sesion'
import { useTemaOscuro } from './lib/tema'

function esRutaRegistro() {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/registro') || window.location.hash.startsWith('#/registro')
}

function esRutaAdmin() {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/admin') || window.location.hash.startsWith('#/admin')
}

export default function App() {
  const sesion = useSesion()
  const oscuro = useTemaOscuro()
  const [esAdmin, setEsAdmin] = useState(esRutaAdmin)
  const [esRegistro, setEsRegistro] = useState(esRutaRegistro)

  useEffect(() => {
    const alCambiar = () => { setEsAdmin(esRutaAdmin()); setEsRegistro(esRutaRegistro()) }
    window.addEventListener('popstate', alCambiar)
    window.addEventListener('hashchange', alCambiar)
    return () => {
      window.removeEventListener('popstate', alCambiar)
      window.removeEventListener('hashchange', alCambiar)
    }
  }, [])

  function irAAdmin() {
    window.history.pushState({}, '', '/admin')
    setEsAdmin(true)
  }

  function irARegistro() {
    window.history.pushState({}, '', '/registro')
    setEsRegistro(true)
  }

  function irAPwa() {
    window.history.pushState({}, '', '/')
    setEsAdmin(false)
  }

  // Registro de una empresa nueva (/registro): prototipo del formulario progresivo, todavía sin servidor.
  if (esRegistro && MODO_SERVIDOR) {
    return (
      <div className="tema-admin">
        <Registro onIrALogin={() => { window.history.pushState({}, '', '/admin'); setEsRegistro(false); setEsAdmin(true) }} />
      </div>
    )
  }

  // =========================================================================
  // VISTA PANEL ADMINISTRADOR (/admin)
  // =========================================================================
  // Sin servidor no hay cuentas que validar: /admin abre la misma app, que ya trae producción y sabores.
  if (esAdmin && MODO_SERVIDOR) {
    return (
      // `.tema-admin` lleva los colores y la letra del panel; la app de reparto no la usa (views/admin/tema.css).
      // `.oscuro`: el modo oscuro que se elige en Configuración (src/lib/tema.ts).
      <div className={`tema-admin ${oscuro ? 'oscuro' : ''}`}>
        <Avisos />
        <VisorPdf />
        {!sesion ? <LoginAdmin onIrAPwa={irAPwa} onIrARegistro={irARegistro} />
          : sesion.usuario.debeCambiarPassword ? <CambioObligatorio />
          : <AdminLayout onIrAPwa={irAPwa} />}
      </div>
    )
  }

  // =========================================================================
  // VISTA PWA MÓVIL DE REPARTO (/)
  // =========================================================================
  // Con la imagen del panel (`.tema-admin`, siempre en claro); `.tema-campo` deja la hoja de «Nuevo pedido» con su
  // diseño de antes (views/pwa/tema-campo.css).
  return (
    <div className="tema-admin tema-campo">
      <Avisos />
      {MODO_SERVIDOR && !sesion ? <Login onIrAAdmin={irAAdmin} />
        : MODO_SERVIDOR && sesion?.usuario.debeCambiarPassword ? <CambioObligatorio />
        : (
          <>
            <VisorPdf />
            <PwaLayout onIrAAdmin={irAAdmin} />
          </>
        )}
    </div>
  )
}
