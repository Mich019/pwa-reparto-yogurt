import { useEffect, useRef, useState } from 'react'
import { LoginAdmin } from './views/admin/LoginAdmin'
import { AdminLayout } from './views/admin/AdminLayout'
import { Login, CambioObligatorio } from './views/pwa/Login'
import { PwaLayout } from './views/pwa/PwaLayout'
import { RegistroEmpresa } from './views/registro/RegistroEmpresa'
import { AceptarInvitacion } from './views/registro/AceptarInvitacion'
import { Plataforma } from './views/admin/Plataforma'
import { Avisos } from './components/ui'
import { VisorPdf } from './components/VisorPdf'
import { MODO_SERVIDOR } from './lib/api'
import { useSesion } from './lib/sesion'
import { useTemaOscuro } from './lib/tema'
import { estiloMarca, useCargarMarca, useMarca } from './lib/marca'

function esRuta(ruta: string) {
  if (typeof window === 'undefined') return false
  return window.location.pathname.startsWith(ruta) || window.location.hash.startsWith(`#${ruta}`)
}
const esRutaAdmin = () => esRuta('/admin')
const esRutaRegistro = () => esRuta('/registro')
const esRutaPlataforma = () => esRuta('/plataforma')
// El enlace de la invitación va en el fragmento (/invitacion#…), así que aquí sólo cuenta la ruta.
const esRutaInvitacion = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/invitacion')

export default function App() {
  const sesion = useSesion()
  const oscuro = useTemaOscuro()
  // Marca de la empresa (src/lib/marca.ts): su color en los botones del panel y de la app de reparto.
  useCargarMarca(sesion?.usuario.id)
  const colorMarca = estiloMarca(useMarca())
  const [esAdmin, setEsAdmin] = useState(esRutaAdmin)
  const [esRegistro, setEsRegistro] = useState(esRutaRegistro)
  const [esPlataforma, setEsPlataforma] = useState(esRutaPlataforma)
  const [esInvitacion, setEsInvitacion] = useState(esRutaInvitacion)

  useEffect(() => {
    const alCambiar = () => {
      setEsAdmin(esRutaAdmin())
      setEsRegistro(esRutaRegistro())
      setEsPlataforma(esRutaPlataforma())
      setEsInvitacion(esRutaInvitacion())
    }
    window.addEventListener('popstate', alCambiar)
    window.addEventListener('hashchange', alCambiar)
    return () => {
      window.removeEventListener('popstate', alCambiar)
      window.removeEventListener('hashchange', alCambiar)
    }
  }, [])

  // Un solo inicio de sesión: cada cuenta va a lo suyo. Quien administra la plataforma, de /admin a /plataforma (su cuenta
  // y su seguridad están en la misma plataforma); un vendedor que entró por /admin, a la app.
  const antes = useRef(sesion?.usuario.id)
  useEffect(() => {
    const recien = !antes.current && sesion
    antes.current = sesion?.usuario.id
    if (sesion?.usuario.plataforma && (recien || esAdmin)) {
      window.history.replaceState({}, '', '/plataforma')
      setEsAdmin(false)
      setEsPlataforma(true)
    } else if (esPlataforma && !sesion?.usuario.plataforma) {
      // /plataforma no tiene login propio: sin sesión (o al cerrarla), o con una cuenta que no es de la plataforma, al de /admin.
      window.history.replaceState({}, '', '/admin')
      setEsPlataforma(false)
      setEsAdmin(true)
    } else if (recien && esAdmin && sesion.usuario.rol === 'vendedor') {
      irAPwa()
    }
  }, [sesion?.usuario.id, sesion?.usuario.plataforma, esAdmin, esPlataforma]) // eslint-disable-line react-hooks/exhaustive-deps

  function irAAdmin() {
    window.history.pushState({}, '', '/admin')
    setEsAdmin(true)
  }

  function irAPwa() {
    window.history.pushState({}, '', '/')
    setEsAdmin(false)
  }

  function irARegistro() {
    window.history.pushState({}, '', '/registro')
    setEsRegistro(true)
  }

  function irAlPanelDesdeRegistro() {
    window.history.pushState({}, '', '/admin')
    setEsRegistro(false)
    setEsAdmin(true)
  }

  function irAPwaDesdeInvitacion() {
    window.history.pushState({}, '', '/')
    setEsInvitacion(false)
    setEsAdmin(false)
  }

  // =========================================================================
  // PANEL DE LA PLATAFORMA (/plataforma): para quienes administran el servicio (api/_lib/plataforma.ts)
  // =========================================================================
  if (esPlataforma && sesion?.usuario.plataforma && MODO_SERVIDOR) {
    return (
      <div className={`tema-admin ${oscuro ? 'oscuro' : ''}`}>
        <Avisos />
        {sesion.usuario.debeCambiarPassword ? <CambioObligatorio /> : <Plataforma />}
      </div>
    )
  }

  // =========================================================================
  // INVITACIÓN A UN REPARTIDOR (/invitacion#…): crea su cuenta y entra a la app
  // =========================================================================
  if (esInvitacion && MODO_SERVIDOR) {
    return (
      <div className="tema-admin tema-campo">
        <Avisos />
        <AceptarInvitacion onListo={irAPwaDesdeInvitacion} />
      </div>
    )
  }

  // =========================================================================
  // ALTA DE EMPRESA (/registro): formulario progresivo, sin sesión
  // =========================================================================
  if (esRegistro && MODO_SERVIDOR) {
    return (
      <div className={`tema-admin ${oscuro ? 'oscuro' : ''}`}>
        <Avisos />
        <RegistroEmpresa onIrAlPanel={irAlPanelDesdeRegistro} />
      </div>
    )
  }

  // =========================================================================
  // VISTA PANEL ADMINISTRADOR (/admin)
  // =========================================================================
  // Sin servidor no hay cuentas que validar: /admin abre la misma app, que ya trae producción y sabores.
  if ((esAdmin || esPlataforma) && MODO_SERVIDOR) {
    return (
      // `.tema-admin` lleva los colores y la letra del panel; la app de reparto no la usa (views/admin/tema.css).
      // `.oscuro`: el modo oscuro que se elige en Configuración (src/lib/tema.ts).
      <div className={`tema-admin ${oscuro ? 'oscuro' : ''}`} style={colorMarca}>
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
    <div className="tema-admin tema-campo" style={colorMarca}>
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
