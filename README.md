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
| Equipo | Sólo administrador y sólo con servidor. Altas, ediciones y bajas de cuentas, contraseña temporal, y pasar clientes de un vendedor a otro (ver abajo). |

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

## Equipo y cartera

La pestaña **Equipo** (sólo para el administrador y con servidor) cubre las altas, bajas y reasignaciones. Necesita conexión: son cambios que el servidor aplica al instante.

- **Nueva cuenta**: nombre, correo, teléfono (opcional) y puesto (vendedor o administrador). El servidor genera una contraseña temporal (`kP7x-Ym3Q-aR9d`) que se muestra **una sola vez**, con botones para copiar el mensaje, mandarlo por WhatsApp o compartirlo. Al entrar, la persona debe elegir su propia contraseña.
- **Editar**: nombre, correo, teléfono y puesto. Nadie puede cambiar su propio puesto, y siempre debe quedar al menos un administrador activo.
- **Contraseña**: restablecimiento manual. Genera otra temporal, cierra las sesiones abiertas de esa persona y quita un bloqueo por intentos fallidos.
- **Dar de baja / Reactivar**: la baja corta el acceso al instante en todos sus teléfonos (el token se valida contra la base en cada petición) y al intentar entrar se le dice que su cuenta está dada de baja. No se borra nada: clientes e historial se conservan. Al dar de baja se puede decidir qué pasa con sus clientes (pasarlos a otro vendedor, dejarlos sin vendedor o decidir después).
- **Pasar cartera**: de un vendedor a otro (o a «sin vendedor», que sólo ve el administrador), toda de una vez o eligiendo clientes. También se puede cambiar un cliente suelto desde su perfil (renglón **Vendedor**). Con el cliente viajan sus pedidos agendados y recordatorios pendientes; lo ya entregado sigue siendo venta de quien lo hizo, pero el nuevo vendedor lo ve en el historial. El teléfono del vendedor anterior quita esos clientes al sincronizar, aunque los haya editado sin conexión.

## QR, NFC y cámara

Cada cliente tiene un QR único (`YGT1:<uuid del cliente>`) que se genera al darlo de alta y no necesita internet.

- **Imprimir** (Clientes → cliente → **Código QR**): etiqueta de 60 × 75 mm para imán, en un PDF del tamaño exacto; se comparte o imprime desde la hoja de compartir del teléfono, o se descarga donde no existe. En Clientes, el botón de la impresora arma un PDF con 9 etiquetas por hoja Carta y guías de corte, para los clientes que elijas.
- **Reponer QR**: genera un QR nuevo y el anterior deja de abrir al cliente (pide confirmación). **Imprimir** sólo vuelve a sacar el mismo QR.
- **Tarjeta NFC**: se liga con el UID de la tarjeta. Si ya era de otro cliente, pide confirmar y se la quita. Donde el navegador no lee NFC se puede teclear el UID (lector USB).
- **Escanear** (botón del visor en Ruta y en Clientes): la cámara lee el QR y, en Android con Chrome, la misma pantalla escucha tarjetas NFC. En Ruta, un cliente con entrega hoy abre su parada; uno sin entrega abre un pedido para hoy con lo del pedido anterior. En Clientes abre su perfil. Códigos que no son de la app, de clientes archivados o que no existen se avisan sin cerrar el visor.
- La cámara usa el lector nativo del navegador (`BarcodeDetector`: QR y códigos de barras comunes) y, donde no existe (Safari, Firefox), `jsqr` sólo para QR. Web NFC existe únicamente en Chrome para Android y pide HTTPS. El PDF se escribe a mano en `src/lib/pdf.ts`.

## Pendiente (siguientes pasos)

- Recuperación de contraseña por correo (RF-002), cierre de sesión que no dependa de la señal.
- Stock diario, exportar a Excel, notificaciones push.
