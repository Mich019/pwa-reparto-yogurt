// La Ayuda (src/views/ayuda) copia los textos de botones y campos de la app. Esta prueba lee los archivos como texto
// (no hace falta la base de datos) y avisa cuando una guía nombra algo que ya no existe, o apunta a una guía o sección
// que no está.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const leer = (p: string) => readFileSync(p, 'utf8')
const guias = leer('src/views/ayuda/guias.ts')
const ayuda = leer('src/views/ayuda/Ayuda.tsx')
const novedades = leer('src/views/ayuda/novedades.ts')

// Lo que las capturas muestran como ejemplo (datos inventados) o pertenece al navegador, no a la app.
const EJEMPLOS = new Set([
  '12 oct', 'A 3 clientes les toca visita y no tienen pedido', 'Instalar app', 'Agregar a la pantalla principal',
  'Guardar carga · 30 L', 'Pasar 12 clientes a Juan', 'Agendar para mañana', 'Agregar a favoritos', 'Nueva pestaña',
])

function codigoDeLaApp() {
  const archivos: string[] = []
  const recorrer = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) { if (!p.endsWith('ayuda')) recorrer(p) } else if (/\.(tsx?|js)$/.test(f)) archivos.push(p)
    }
  }
  recorrer('src')
  return [...archivos, 'public/sw.js'].map(leer).join('\n')
}

const idsDeGuias = [...guias.matchAll(/^ {4}id: '([^']+)'/gm)].map((m) => m[1])

test('cada botón o texto que nombra una guía existe en la app', () => {
  const app = codigoDeLaApp()
  const etiquetas = new Set<string>()
  for (const m of guias.matchAll(/«([^»]+)»/g)) etiquetas.add(m[1])
  for (const m of guias.matchAll(/t: 'boton', texto: '([^']+)'/g)) etiquetas.add(m[1])
  for (const m of guias.matchAll(/t: 'menu', items: \[([^\]]+)\]/g)) for (const x of m[1].matchAll(/'([^']+)'/g)) etiquetas.add(x[1])
  assert.ok(etiquetas.size > 50, 'no se encontraron las etiquetas de las guías')
  const faltan = [...etiquetas].filter((e) => !EJEMPLOS.has(e) && !app.includes(e))
  assert.deepEqual(faltan, [], `Estas guías nombran textos que ya no están en la app (cámbialos en guias.ts, o si es un ejemplo, agrégalo a EJEMPLOS): ${faltan.join(' | ')}`)
})

test('las guías tienen ids únicos', () => {
  assert.ok(idsDeGuias.length > 30)
  const repetidos = idsDeGuias.filter((id, i) => idsDeGuias.indexOf(id) !== i)
  assert.deepEqual(repetidos, [])
})

test('el «?» de cada sección abre guías que existen', () => {
  const bloque = guias.match(/export const AYUDA_DE = \{([\s\S]*?)\n\}/)
  assert.ok(bloque, 'falta AYUDA_DE en guias.ts')
  const ids = [...bloque[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  const faltan = ids.filter((id) => !idsDeGuias.includes(id))
  assert.deepEqual(faltan, [])
})

test('«Ir a…» lleva a secciones que el panel conoce', () => {
  const destinos = ayuda.match(/const DESTINOS: Record<string, string> = \{([^}]*)\}/)
  assert.ok(destinos, 'falta DESTINOS en Ayuda.tsx')
  const conocidos = [...destinos[1].matchAll(/(\w+):/g)].map((m) => m[1])
  const usados = [...new Set([...guias.matchAll(/\bir: '([^']+)'/g)].map((m) => m[1]))]
  assert.deepEqual(usados.filter((d) => !conocidos.includes(d)), [])
})

test('«¿Qué hay de nuevo?» va de lo más nuevo a lo más viejo y abre guías que existen', () => {
  const fechas = [...novedades.matchAll(/fecha: '([^']+)'/g)].map((m) => m[1])
  assert.ok(fechas.length > 0)
  for (const f of fechas) assert.match(f, /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(fechas, [...fechas].sort().reverse(), 'la versión más nueva va hasta arriba')
  const guiasNombradas = [...novedades.matchAll(/guia: '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(guiasNombradas.filter((id) => !idsDeGuias.includes(id)), [])
})
