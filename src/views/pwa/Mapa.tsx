import { useEffect, useRef, type RefObject } from 'react'
import { LngLatBounds, Map as MapaML, Marker, type StyleSpecification } from 'maplibre-gl'
import type { EstadoPedido } from '../../lib/db'
import type { Punto } from '../../lib/ruteo'
import { temaOscuroAhora, useTemaOscuro } from '../../lib/tema'

// Estilo libre de OpenFreeMap (sin llave): gris claro y limpio, como el mapa de Uber, o su versión oscura con el modo
// oscuro. Los edificios 3D se agregan abajo.
export const estiloMapa = () => `https://tiles.openfreemap.org/styles/${temaOscuroAhora() ? 'dark' : 'positron'}`

// Al cambiar el tema con el mapa abierto, le cambia el estilo ahí mismo (sin `diff`: así vuelve a sonar «style.load» y
// quien agregó capas propias las pone otra vez). Los marcadores son HTML y se quedan.
export function useEstiloDelTema(mapa: RefObject<MapaML | null>) {
  const oscuro = useTemaOscuro()
  const puesto = useRef(oscuro)
  useEffect(() => {
    if (puesto.current === oscuro) return
    puesto.current = oscuro
    mapa.current?.setStyle(estiloMapa(), { diff: false })
  }, [oscuro, mapa])
}

// El estilo oscuro de OpenFreeMap es casi negro y sus calles apenas se distinguen. Al cargarlo se viste con la noche de
// la app: tierra verde muy oscura, calles claras según su importancia, agua azul petróleo, parques verdes y letreros
// legibles. Va por tipo de capa y por lo que dibuja (`source-layer` y la clase de su filtro), no por su nombre, así que
// aguanta que el estilo cambie; una capa que no se deje pintar se queda como venía.
const NOCHE = {
  tierra: '#0f1813', barrio: '#121d17', agua: '#0c2b33', parque: '#17301f', bosque: '#152a1c',
  edificio: '#1a2720', bordeEdificio: '#26372d', pista: '#1b2921',
  autopista: '#647f6d', avenida: '#4d6355', calle: '#33443a', vereda: '#26332b', via: '#2a362f', orilla: '#0a110d',
  limite: '#3f5145', lugar: '#d5dccf', letrero: '#94a598', letreroAgua: '#62a6b0',
}
const clasesDe = (filtro: unknown) => JSON.stringify(filtro ?? '')
const tiene = (texto: string, ...clases: string[]) => clases.some((c) => texto.includes(`"${c}"`))

export function vestirMapa(m: MapaML) {
  if (!temaOscuroAhora()) return
  for (const capa of m.getStyle().layers) {
    const pintar = (propiedad: string, valor: string | number) => {
      try { m.setPaintProperty(capa.id, propiedad as Parameters<MapaML['setPaintProperty']>[1], valor) } catch { /* esa capa no tiene esa propiedad: queda igual */ }
    }
    const de = ('source-layer' in capa && capa['source-layer']) || ''
    const clases = clasesDe('filter' in capa ? capa.filter : null)
    if (capa.type === 'background') pintar('background-color', NOCHE.tierra)
    else if (capa.type === 'fill') {
      if (de === 'water') pintar('fill-color', NOCHE.agua)
      else if (de === 'park') pintar('fill-color', NOCHE.parque)
      else if (de === 'landcover') pintar('fill-color', NOCHE.bosque)
      else if (de === 'landuse') pintar('fill-color', tiene(clases, 'park', 'cemetery', 'pitch', 'stadium') ? NOCHE.parque : NOCHE.barrio)
      else if (de === 'aeroway') pintar('fill-color', NOCHE.pista)
      else if (de === 'building') { pintar('fill-color', NOCHE.edificio); pintar('fill-outline-color', NOCHE.bordeEdificio) }
    } else if (capa.type === 'line') {
      if (de === 'waterway' || de === 'water') pintar('line-color', NOCHE.agua)
      else if (de === 'boundary') pintar('line-color', NOCHE.limite)
      else if (de === 'aeroway') pintar('line-color', NOCHE.pista)
      else if (de === 'transportation') {
        if (/casing|borde/i.test(capa.id)) pintar('line-color', NOCHE.orilla)
        else if (tiene(clases, 'rail', 'transit')) pintar('line-color', NOCHE.via)
        else if (tiene(clases, 'motorway')) pintar('line-color', NOCHE.autopista)
        else if (tiene(clases, 'trunk', 'primary', 'secondary', 'tertiary')) pintar('line-color', NOCHE.avenida)
        else if (tiene(clases, 'path', 'track')) pintar('line-color', NOCHE.vereda)
        else pintar('line-color', NOCHE.calle)
      }
    } else if (capa.type === 'symbol') {
      pintar('text-color', de === 'place' ? NOCHE.lugar : de === 'water_name' || de === 'waterway' ? NOCHE.letreroAgua : NOCHE.letrero)
      pintar('text-halo-color', NOCHE.tierra)
      pintar('text-halo-width', 1.2)
    }
  }
}

export interface Pin {
  id: string
  punto: Punto
  numero: number
  estado: EstadoPedido
  activo: boolean
}

// Si el estilo no trae edificios en 3D, los agrega desde la capa vectorial "building".
function asegurarEdificios3D(mapa: MapaML) {
  const estilo = mapa.getStyle() as StyleSpecification
  if (estilo.layers.some((l) => l.type === 'fill-extrusion')) return
  const fuente = Object.entries(estilo.sources).find(([, s]) => s.type === 'vector')?.[0]
  if (!fuente) return
  mapa.addLayer({
    id: 'edificios-3d',
    type: 'fill-extrusion',
    source: fuente,
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': temaOscuroAhora() ? '#22332a' : '#e6e6e6',
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.7,
    },
  })
}

export function Mapa({ pines, linea, yo, enfoque, modo3D, onSeleccionar }: {
  pines: Pin[]
  linea: Punto[]
  yo: Punto | null
  enfoque: Punto | null // a dónde mirar (parada activa)
  modo3D: boolean
  onSeleccionar?: (id: string) => void
}) {
  const div = useRef<HTMLDivElement>(null)
  const mapa = useRef<MapaML | null>(null)
  const listo = useRef(false)
  const marcadores = useRef<Marker[]>([])
  const marcadorYo = useRef<Marker | null>(null)
  const ultimoEnfoque = useRef<string>('')
  const lineaPendiente = useRef<Punto[]>(linea)
  lineaPendiente.current = linea
  useEstiloDelTema(mapa)

  useEffect(() => {
    const m = new MapaML({
      container: div.current!,
      style: estiloMapa(),
      center: enfoque ?? yo ?? [-99.1332, 19.4326],
      zoom: 14,
      pitch: modo3D ? 60 : 0,
      maxPitch: 75,
      attributionControl: { compact: true },
    })
    mapa.current = m
    // También después de cambiar de estilo por el tema (useEstiloDelTema): el estilo nuevo llega sin estas capas.
    m.on('style.load', () => {
      if (m.getSource('ruta')) return
      vestirMapa(m)
      asegurarEdificios3D(m)
      // La ruta: en claro, verde de la marca que se aclara hacia el final con un borde blanco; de noche, verde encendido
      // con un resplandor, para que se distinga de las calles de un vistazo.
      const noche = temaOscuroAhora()
      m.addSource('ruta', { type: 'geojson', data: lineaGeo(lineaPendiente.current), lineMetrics: true })
      const trazo = { 'line-cap': 'round', 'line-join': 'round' } as const
      if (noche) m.addLayer({ id: 'ruta-brillo', type: 'line', source: 'ruta', layout: trazo, paint: { 'line-color': '#35d07f', 'line-width': 16, 'line-blur': 10, 'line-opacity': 0.35 } })
      m.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', layout: trazo, paint: { 'line-color': noche ? '#07100b' : '#ffffff', 'line-width': 9 } })
      m.addLayer({
        id: 'ruta', type: 'line', source: 'ruta', layout: trazo,
        paint: { 'line-width': 5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, noche ? '#35d07f' : '#035d38', 1, noche ? '#b7f0cd' : '#34a96f'] },
      })
      listo.current = true
    })
    return () => {
      listo.current = false
      m.remove()
      mapa.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Línea de la ruta
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    const poner = () => (m.getSource('ruta') as { setData?: (d: unknown) => void } | undefined)?.setData?.(lineaGeo(linea))
    if (listo.current) poner()
    else m.once('load', poner)
  }, [linea])

  // Pines de las paradas
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    marcadores.current.forEach((mk) => mk.remove())
    marcadores.current = [...pines]
      .sort((a, b) => Number(a.activo) - Number(b.activo))
      .map((p) => {
        const el = document.createElement('div')
        el.className = `pin pin-${p.estado} ${p.activo ? 'pin-activo' : ''}`
        el.textContent = p.estado === 'ENTREGADO' ? '✓' : p.estado === 'PENDIENTE' ? String(p.numero) : '–' // omitido: ya no tiene lugar en la ruta
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onSeleccionar?.(p.id)
        })
        return new Marker({ element: el }).setLngLat(p.punto).addTo(m)
      })
  }, [pines, onSeleccionar])

  // Mi ubicación
  useEffect(() => {
    const m = mapa.current
    if (!m || !yo) return
    if (!marcadorYo.current) {
      const el = document.createElement('div')
      el.className = 'yo'
      marcadorYo.current = new Marker({ element: el }).setLngLat(yo).addTo(m)
    } else marcadorYo.current.setLngLat(yo)
  }, [yo])

  // Cámara: al cambiar de parada activa, encuadra "yo → parada" con inclinación 3D.
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    const clave = `${enfoque?.join()}|${modo3D}|${enfoque ? '' : pines.length}|${yo ? 1 : 0}`
    if (clave === ultimoEnfoque.current) return
    ultimoEnfoque.current = clave
    const pitch = modo3D ? 60 : 0
    if (enfoque && yo) {
      // Zoom para que quepan "yo" y la parada; con inclinación se aleja un poco para no cortarlos.
      const b = new LngLatBounds(yo, yo).extend(enfoque)
      const cam = m.cameraForBounds(b, { padding: { top: 170, bottom: 340, left: 60, right: 60 }, absolutePadding: true, maxZoom: 17 })
      const medio: Punto = [(yo[0] + enfoque[0]) / 2, (yo[1] + enfoque[1]) / 2]
      m.easeTo({
        center: medio,
        zoom: (cam?.zoom ?? 15) - (modo3D ? 0.7 : 0),
        pitch,
        bearing: modo3D ? -20 : 0,
        padding: { top: 150, bottom: 300, left: 0, right: 0 },
        duration: 1200,
      })
    } else if (enfoque) {
      m.easeTo({ center: enfoque, zoom: 16, pitch, bearing: modo3D ? -20 : 0, padding: { top: 150, bottom: 300, left: 0, right: 0 }, duration: 1200 })
    } else if (pines.length) {
      const b = new LngLatBounds(pines[0].punto, pines[0].punto)
      pines.forEach((p) => b.extend(p.punto))
      if (yo) b.extend(yo)
      m.fitBounds(b, { padding: { top: 170, bottom: 340, left: 50, right: 50 }, duration: 1000, maxZoom: 16 })
    } else if (yo) {
      m.easeTo({ center: yo, zoom: 15, pitch })
    }
  }, [enfoque, yo, modo3D, pines])

  // El CSS de MapLibre fija position: relative en el contenedor, por eso va envuelto.
  return (
    <div className="absolute inset-0">
      <div ref={div} className="h-full w-full" />
    </div>
  )
}

function lineaGeo(linea: Punto[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: linea.length > 1 ? linea : [] },
  }
}
