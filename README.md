# Reparto Yogurt · PWA

App para el repartidor: mapa 3D con la ruta del día, entrega en un toque, selector de sabores por litros y pronóstico de producción semanal. Funciona sin internet y guarda todo en el teléfono.

## Cómo probarla

```bash
npm install
npm run dev        # abre http://localhost:5173 (y la IP de tu red para probar en el celular)
npm run build      # genera la versión final en dist/
npm run preview    # sirve dist/ para probar el modo sin internet
```

La carpeta `dist/` ya compilada se puede subir tal cual a cualquier hosting estático con HTTPS (Netlify, Vercel, GitHub Pages, Cloudflare Pages). El GPS y la instalación como app requieren HTTPS.

En la pantalla **Ruta**, si no hay pedidos, el botón **Ejemplo** carga 10 clientes de prueba alrededor de tu ubicación con 4 semanas de historial. Se borran en **Sabores → Borrar clientes y pedidos**.

## Qué hace

| Pantalla | Contenido |
|---|---|
| Ruta | Mapa MapLibre en 3D, gris claro como el de Uber (edificios extruidos, vista inclinada, botón 2D/3D). Ruta óptima por calles reales con OSRM en azul, primero clientes de mañana y luego de tarde. Pines negros numerados por parada. Hoja inferior con cliente, sabores, total y **Pedido Realizado**, y una franja con el avance del día. Cada sabor lleva el ícono de su fruta. Navegar (Google Maps), llamar, WhatsApp, editar, omitir y reprogramar. |
| Post-entrega | Realizar nuevo pedido (igual que el anterior o desde cero) · Recordar más tarde (campana con WhatsApp prellenado) · Cerrar. Al cerrar, la ruta se recalcula desde tu posición. |
| Selector | Tarjetas por sabor con su color, botones grandes − / + por litro, subtotal y total en vivo, fecha sugerida según la frecuencia del cliente. |
| Clientes | Alta con GPS y ajuste en mapa, frecuencia (días fijos o cada N días), horario mañana/tarde, búsqueda, perfil con litros consumidos, sabor favorito, historial y pedidos agendados, archivar. |
| Producción | Litros por sabor para los próximos 7 días = pedidos agendados + estimado por historial de clientes a los que les toca visita. Ventas de hoy / 7 / 30 días, ganancia neta, más y menos vendido. |
| Sabores | Alta/edición de sabores, precio y costo por litro, color, disponible sí/no. Respaldo y restauración en JSON. |

## Técnico

- Diseño estilo Uber, limpio: fondo blanco, botones negros, tarjetas grises suaves y azul sólo para la ruta. Colores definidos en `src/index.css` (`@theme`). Los íconos de fruta de cada sabor están en `src/components/Fruta.tsx` y se eligen solos por el nombre del sabor (fresa, durazno, mango, nuez, zarzamora, plátano…); un sabor sin fruta conocida usa un vasito de yogurt. Tipografía Inter (licencia OFL en `src/fonts/`), incluida en la app para que se vea igual sin internet.

- Vite + React 19 + TypeScript + Tailwind 4. Mapa: `maplibre-gl` con estilo libre de OpenFreeMap (sin llave).
- Datos en IndexedDB con Dexie (`src/lib/db.ts`). Cada cambio queda también en la tabla `cola` para sincronizar con un servidor cuando exista.
- Ruteo en `src/lib/ruteo.ts`: servicio `/trip` de OSRM (resuelve el orden óptimo). Usa el servidor público de demostración; para uso diario conviene un OSRM propio (cambiar `OSRM_URL`). Sin señal usa el orden ya calculado o, si no hay, el vecino más cercano en línea recta.
- Service worker propio (`public/sw.js`): guarda la app completa al instalar y los mosaicos del mapa que ya viste.
- Pronóstico en `src/lib/pronostico.ts`.
- Base de datos del backend en `db/`: versión PostgreSQL (ver `db/README.md`) y versión MySQL 8 lista para migrar a la nube (ver `db/mysql/README.md`).

## Servidor

La API (`server/`, ver [su README](server/README.md)) da login por rol (administrador / vendedor), sincronización de lo hecho sin conexión y resolución de conflictos. Se activa compilando con `VITE_API_URL`; sin esa variable la app sigue siendo sólo local. El vendedor ve su ruta y sus clientes, sin costos ni márgenes.

## Pendiente (siguientes pasos)

- Recuperación de contraseña por correo (RF-002), cierre de sesión que no dependa de la señal.
- QR y NFC por cliente (RF-015 a RF-022).
- Panel de vendedores, stock diario, exportar a Excel, notificaciones push.
