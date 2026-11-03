import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { asegurarCatalogo } from './lib/db'
import { MODO_SERVIDOR } from './lib/api'
import { iniciarMonitoreo, reportarError } from './lib/errores'
import { setWorkerUrl } from 'maplibre-gl'
import urlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

setWorkerUrl(urlWorker)
iniciarMonitoreo()

// Con servidor, los sabores vienen de él (si cada teléfono creara los suyos, tendrían ids distintos).
if (!MODO_SERVIDOR) asegurarCatalogo()
navigator.storage?.persist?.()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'))
}

// Los errores al dibujar la pantalla no pasan por window.onerror: React los entrega aquí.
createRoot(document.getElementById('root')!, { onUncaughtError: (e) => { reportarError(e); console.error(e) } }).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
