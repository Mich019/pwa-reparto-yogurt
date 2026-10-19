import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
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

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), precache()],
})
