import { useEffect, useState } from 'react'
import { LoginAdmin } from './views/admin/LoginAdmin'
import { AdminLayout } from './views/admin/AdminLayout'
import { Login, CambioObligatorio } from './views/pwa/Login'
import { PwaLayout } from './views/pwa/PwaLayout'
import { Avisos } from './components/ui'
import { VisorPdf } from './components/VisorPdf'
import { MODO_SERVIDOR } from './lib/api'
import { useSesion } from './lib/sesion'
import { useTemaOscuro } from './lib/tema'

function esRutaAdmin() {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/admin') || window.location.hash.startsWith('#/admin')
}

export default function App() {
  const sesion = useSesion()
  const oscuro = useTemaOscuro()
  const [esAdmin, setEsAdmin] = useState(esRutaAdmin)

  useEffect(() => {
    const alCambiar = () => setEsAdmin(esRutaAdmin())
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

  function irAPwa() {
    window.history.pushState({}, '', '/')
    setEsAdmin(false)
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
        {!sesion ? <LoginAdmin onIrAPwa={irAPwa} />
          : sesion.usuario.debeCambiarPassword ? <CambioObligatorio />
          : <AdminLayout onIrAPwa={irAPwa} />}
      </div>
    )
  }

  // =========================================================================
  // VISTA PWA MÓVIL DE REPARTO (/)
  // =========================================================================
  if (MODO_SERVIDOR && !sesion) {
    return (
      <>
        <Avisos />
        <Login onIrAAdmin={irAAdmin} />
      </>
    )
  }
  if (MODO_SERVIDOR && sesion?.usuario.debeCambiarPassword) {
    return (
      <>
        <Avisos />
        <CambioObligatorio />
      </>
    )
  }

  return (
    <>
      <Avisos />
      <VisorPdf />
      <PwaLayout onIrAAdmin={irAAdmin} />
    </>
  )
}
