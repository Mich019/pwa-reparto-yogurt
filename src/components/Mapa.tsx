import { useEffect, useRef } from 'react'
import { LngLatBounds, Map as MapaML, Marker, type StyleSpecification } from 'maplibre-gl'
import type { EstadoPedido } from '../lib/db'
import type { Punto } from '../lib/ruteo'

// Estilo libre de OpenFreeMap (sin llave): gris claro y limpio, como el mapa de Uber. Los edificios 3D se agregan abajo.
export const ESTILO_MAPA = 'https://tiles.openfreemap.org/styles/positron'

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
      'fill-extrusion-color': '#e6e6e6',
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

  useEffect(() => {
    const m = new MapaML({
      container: div.current!,
      style: ESTILO_MAPA,
      center: enfoque ?? yo ?? [-99.1332, 19.4326],
      zoom: 14,
      pitch: modo3D ? 60 : 0,
      maxPitch: 75,
      attributionControl: { compact: true },
    })
    mapa.current = m
    m.on('load', () => {
      asegurarEdificios3D(m)
      // Ruta azul que se aclara hacia el final, con un borde blanco para que destaque sobre las calles.
      m.addSource('ruta', { type: 'geojson', data: lineaGeo(lineaPendiente.current), lineMetrics: true })
      m.addLayer({ id: 'ruta-borde', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } })
      m.addLayer({
        id: 'ruta', type: 'line', source: 'ruta', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 5, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#1f48d8', 1, '#7fb0ff'] },
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
        el.textContent = p.estado === 'ENTREGADO' ? '✓' : String(p.numero)
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
