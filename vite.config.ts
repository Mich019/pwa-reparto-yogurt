import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Escribe en dist/sw.js la lista de archivos generados, para guardarlos en caché al instalar.
function precache(): Plugin {
  let archivos: string[] = []
  return {
    name: 'precache',
    apply: 'build',
    generateBundle(_, bundle) {
      archivos = Object.keys(bundle)
    },
    writeBundle(opts) {
      const sw = resolve(opts.dir!, 'sw.js')
      const lista = JSON.stringify(archivos.map((f) => `./${f}`))
      const version = Date.now().toString(36)
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('self.__ARCHIVOS__', lista).replace('__VERSION__', version))
    },
  }
}

// Política de contenido (CSP) de la app compilada: sólo carga sus propios archivos, el mapa (OpenFreeMap), las rutas
// (OSRM) y la API; nada de scripts en línea ni de terceros. Va en un <meta> para que valga en cualquier hosting
// (GitHub Pages no deja poner cabeceras); vercel.json agrega las que sólo sirven como cabecera (frame-ancestors, HSTS…).
// En desarrollo no se pone: Vite mete un script en línea para recargar al guardar.
function politicaDeContenido(apiUrl: string): Plugin {
  const api = /^https?:\/\//i.test(apiUrl) ? ` ${new URL(apiUrl).origin}` : ''
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    `connect-src 'self' https://tiles.openfreemap.org https://router.project-osrm.org${api}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'politica-de-contenido',
    apply: 'build',
    // Justo después del charset: antes de cualquier script o estilo, para que la política valga para todos.
    transformIndexHtml: (html) => html.replace(/<meta charset="UTF-8" \/>/, `$&\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), precache(), politicaDeContenido(loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL ?? '')],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
}))
