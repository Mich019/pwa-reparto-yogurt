import { useEffect, useState } from 'react'
import { LoginAdmin } from './views/admin/LoginAdmin'
import { AdminLayout } from './views/admin/AdminLayout'
import { Login, CambioObligatorio } from './views/pwa/Login'
import { PwaLayout } from './views/pwa/PwaLayout'
import { Avisos } from './components/ui'
import { MODO_SERVIDOR } from './lib/api'
import { useSesion } from './lib/sesion'

function esRutaAdmin() {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith('/admin') || window.location.hash.startsWith('#/admin')
}

export default function App() {
  const sesion = useSesion()
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
  if (esAdmin) {
    if (!sesion) {
      return (
        <>
          <Avisos />
          <LoginAdmin onIrAPwa={irAPwa} />
        </>
      )
    }
    if (sesion.usuario.debeCambiarPassword) {
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
        <AdminLayout onIrAPwa={irAPwa} />
      </>
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
      <PwaLayout onIrAAdmin={irAAdmin} />
    </>
  )
}
