// Ruteo de paradas. Usa el servidor público de OSRM (demo, sin llave). Para producción conviene
// un OSRM propio o un proveedor con contrato: basta con cambiar OSRM_URL.
export const OSRM_URL = 'https://router.project-osrm.org'

export type Punto = [number, number] // [lng, lat]

export interface Parada {
  id: string
  punto: Punto
  ventana: 'MAÑANA' | 'TARDE'
  urgente?: boolean // RF-054: el administrador lo marcó para ya; va antes que todo
}

export interface Ruta {
  orden: string[] // ids de parada en orden de visita
  linea: Punto[]
  distancia_m: number
  duracion_s: number
  porCalles: boolean // false = respaldo en línea recta (sin conexión)
}

export function distancia(a: Punto, b: Punto) {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Vecino más cercano: respaldo cuando no hay internet.
function ordenCercano(inicio: Punto, paradas: Parada[]) {
  const pendientes = [...paradas]
  const orden: Parada[] = []
  let actual = inicio
  while (pendientes.length) {
    let mejor = 0
    for (let i = 1; i < pendientes.length; i++) {
      if (distancia(actual, pendientes[i].punto) < distancia(actual, pendientes[mejor].punto)) mejor = i
    }
    const [p] = pendientes.splice(mejor, 1)
    orden.push(p)
    actual = p.punto
  }
  return orden
}

// Resuelve el problema del viajante sobre calles reales con el servicio /trip de OSRM.
async function tramoOsrm(inicio: Punto, paradas: Parada[]) {
  const coords = [inicio, ...paradas.map((p) => p.punto)].map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';')
  const url = `${OSRM_URL}/trip/v1/driving/${coords}?source=first&roundtrip=false&geometries=geojson&overview=full`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const data = await res.json()
    if (data.code !== 'Ok') throw new Error(data.message || data.code)
    const orden = paradas
      .map((p, i) => ({ p, pos: data.waypoints[i + 1].waypoint_index as number }))
      .sort((a, b) => a.pos - b.pos)
      .map((x) => x.p)
    const trip = data.trips[0]
    return { orden, linea: trip.geometry.coordinates as Punto[], distancia_m: trip.distance, duracion_s: trip.duration }
  } finally {
    clearTimeout(t)
  }
}

// Primero las urgentes, luego las de la mañana y al final las de la tarde (RF-029), cada grupo optimizado.
export async function calcularRuta(inicio: Punto, paradas: Parada[]): Promise<Ruta> {
  const normales = paradas.filter((p) => !p.urgente)
  const grupos = [paradas.filter((p) => p.urgente), normales.filter((p) => p.ventana === 'MAÑANA'), normales.filter((p) => p.ventana === 'TARDE')]
  const ruta: Ruta = { orden: [], linea: [inicio], distancia_m: 0, duracion_s: 0, porCalles: true }
  let desde = inicio
  for (const grupo of grupos) {
    if (!grupo.length) continue
    let orden: Parada[]
    if (ruta.porCalles && navigator.onLine) {
      try {
        const t = await tramoOsrm(desde, grupo)
        orden = t.orden
        ruta.linea.push(...t.linea)
        ruta.distancia_m += t.distancia_m
        ruta.duracion_s += t.duracion_s
      } catch {
        ruta.porCalles = false
        orden = ordenCercano(desde, grupo)
      }
    } else {
      ruta.porCalles = false
      orden = ordenCercano(desde, grupo)
    }
    if (!ruta.porCalles) {
      let prev = desde
      for (const p of orden) {
        ruta.linea.push(p.punto)
        ruta.distancia_m += distancia(prev, p.punto) * 1.3
        prev = p.punto
      }
      ruta.duracion_s = ruta.distancia_m / 8 // ~30 km/h
    }
    ruta.orden.push(...orden.map((p) => p.id))
    desde = orden[orden.length - 1].punto
  }
  return ruta
}

// Posición del GPS y su precisión en metros. `maximoMs`: qué tan vieja puede ser una lectura ya hecha.
export function posicionActual(maximoMs = 60000): Promise<{ punto: Punto; precision: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ punto: [p.coords.longitude, p.coords.latitude], precision: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: maximoMs },
    )
  })
}

export const ubicacionActual = async (): Promise<Punto | null> => (await posicionActual())?.punto ?? null

export const enlaceNavegar = (p: Punto) =>
  `https://www.google.com/maps/dir/?api=1&destination=${p[1]},${p[0]}&travelmode=driving`
