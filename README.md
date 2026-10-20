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

En la pantalla **Ruta**, si no hay pedidos, el botón **Cargar datos de ejemplo** carga 10 clientes de prueba alrededor de tu ubicación con 4 semanas de historial. Se borran en **Sabores → Borrar clientes y pedidos**. Los dos botones sólo aparecen sin servidor: con servidor, los clientes de ejemplo se subirían como reales y el borrado quitaría del servidor los de toda la empresa. Para probar con servidor están los datos de `npm run db:migrar -- --demo`.

## Qué hace

| Pantalla | Contenido |
|---|---|
| Ruta | Mapa MapLibre en 3D, gris claro como el de Uber (edificios extruidos, vista inclinada, botón 2D/3D). Ruta óptima por calles reales con OSRM en azul, primero clientes de mañana y luego de tarde. Pines negros numerados por parada. Hoja inferior con cliente, sabores, total, forma de pago (vuelve a efectivo en cada parada) y **Pedido Realizado**, y una franja con el avance del día. Cada sabor se reconoce por su color. Navegar (Google Maps), llamar, WhatsApp, editar, omitir y reprogramar. |
| Post-entrega | Realizar nuevo pedido (igual que el anterior o desde cero) · Recordar más tarde (campana con WhatsApp prellenado) · Cerrar. Al cerrar, la ruta se recalcula desde tu posición. Si la ubicación guardada del cliente queda lejos de donde se entregó, ofrece guardarla ahí con un toque. |
| Selector | Tarjetas por sabor con su color arriba y una franja azul marino con nombre, precio y subtotal; botones grandes − / + por envase (1 L si el sabor no dice otra cosa), subtotal y total en vivo, fecha sugerida según la frecuencia del cliente. |
| Clientes | Alta con GPS y ajuste en mapa, frecuencia (días fijos o cada N días), horario mañana/tarde, búsqueda por nombre, teléfono, colonia, día de visita u horario, perfil con litros consumidos, sabor favorito, historial y pedidos agendados, archivar. |
| Producción | Litros por sabor para los próximos 7 días = pedidos agendados + estimado por historial de clientes a los que les toca visita. Ventas de hoy / 7 / 30 días, ganancia neta, más y menos vendido. Con servidor, el administrador también ve aquí **Stock del día** (ver abajo). |
| Stock | Sólo vendedor y sólo con servidor. Su carga del día, lo que ha entregado y lo que le queda de cada sabor, aunque no tenga señal. |
| Sabores | Alta/edición de sabores con descripción, presentación (litros por envase, se elige al crearlo), precio y costo por litro, color, disponible sí/no. Respaldo y restauración en JSON. Con servidor está en el panel `/admin`; sin servidor, en la propia app junto con Producción. |
| Reportes | Sólo administrador y sólo con servidor. Corte del día, comparativos por semana y mes, utilidad por sabor, ranking, rendimiento por vendedor y exportación a Excel o CSV (ver abajo). |
| Equipo | Sólo administrador y sólo con servidor. Altas, ediciones y bajas de cuentas, contraseña temporal, y pasar clientes de un vendedor a otro (ver abajo). |

## Técnico

- Diseño estilo Uber, limpio: fondo blanco, botones negros, tarjetas grises suaves y azul sólo para la ruta. Colores definidos en `src/index.css` (`@theme`). Cada sabor se identifica por el color que se le elige en Sabores: el selector usa tarjetas de ese color con una franja azul marino (`--color-marino`), y en la ruta, clientes, stock, producción y reportes un punto del mismo color (`PuntoSabor` en `src/components/ui.tsx`). Tipografía Inter (licencia OFL en `src/fonts/`), incluida en la app para que se vea igual sin internet.

- Vite + React 19 + TypeScript + Tailwind 4. Mapa: `maplibre-gl` con estilo libre de OpenFreeMap (sin llave).
- Datos en IndexedDB con Dexie (`src/lib/db.ts`). Cada cambio queda también en la tabla `cola` para sincronizar con un servidor cuando exista.
- Ruteo en `src/lib/ruteo.ts`: servicio `/trip` de OSRM (resuelve el orden óptimo). Usa el servidor público de demostración; para uso diario conviene un OSRM propio (cambiar `OSRM_URL`). Sin señal usa el orden ya calculado o, si no hay, el vecino más cercano en línea recta.
- Service worker propio (`public/sw.js`): guarda la app completa al instalar y los mosaicos del mapa que ya viste.
- Pronóstico en `src/lib/pronostico.ts`.
- Base de datos del backend en `db/`: versión PostgreSQL (ver `db/README.md`) y versión MySQL 8 lista para migrar a la nube (ver `db/mysql/README.md`).

## Servidor

La API (`api/`, ver [su README](api/README.md)) da login por rol (administrador / vendedor), sincronización de lo hecho sin conexión y resolución de conflictos. La app usa el servidor por omisión: llama a `/api`, o a `VITE_API_URL` si la API vive en otro dominio (variables en [`.env.example`](.env.example)). Con `VITE_OFFLINE_SOLO=true` es sólo local y sin cuentas. El administrador trabaja en el panel `/admin`. El vendedor ve su ruta y sus clientes, sin costos ni márgenes.

## Equipo y cartera

La pestaña **Equipo** (sólo para el administrador y con servidor) cubre las altas, bajas y reasignaciones. Necesita conexión: son cambios que el servidor aplica al instante.

- **Nueva cuenta**: nombre, correo, teléfono (opcional) y puesto (vendedor o administrador). El servidor genera una contraseña temporal (`kP7x-Ym3Q-aR9d`) que se muestra **una sola vez**, con botones para copiar el mensaje, mandarlo por WhatsApp o compartirlo. Al entrar, la persona debe elegir su propia contraseña.
- **Editar**: nombre, correo, teléfono y puesto. Nadie puede cambiar su propio puesto, y siempre debe quedar al menos un administrador activo.
- **Contraseña**: restablecimiento manual. Genera otra temporal, cierra las sesiones abiertas de esa persona y quita un bloqueo por intentos fallidos.
- **Dar de baja / Reactivar**: la baja corta el acceso al instante en todos sus teléfonos (el token se valida contra la base en cada petición) y al intentar entrar se le dice que su cuenta está dada de baja. No se borra nada: clientes e historial se conservan. Al dar de baja se puede decidir qué pasa con sus clientes (pasarlos a otro vendedor, dejarlos sin vendedor o decidir después).
- **Pasar cartera**: de un vendedor a otro (o a «sin vendedor», que sólo ve el administrador), toda de una vez o eligiendo clientes. También se puede cambiar un cliente suelto desde su perfil (renglón **Vendedor**). Con el cliente viajan sus pedidos agendados y recordatorios pendientes; lo ya entregado sigue siendo venta de quien lo hizo, pero el nuevo vendedor lo ve en el historial. El teléfono del vendedor anterior quita esos clientes al sincronizar, aunque los haya editado sin conexión.

## Reportes

La pestaña **Reportes** (también en el panel web, `/admin`) es sólo para el administrador y necesita conexión: el servidor los arma con todo el historial de todos los vendedores. Un vendedor no los ve ni el servidor se los entrega, porque llevan costos y márgenes.

- **Periodo**: **Día** (el corte de un día, con ‹ › para ir a otros), **Semana** (lunes a domingo), **Mes** o **Rango** con dos fechas. Abre en el corte de hoy.
- **Resumen**: recaudado, utilidad neta y margen, litros entregados, clientes atendidos y pedidos, más lo cobrado en efectivo y por transferencia. En un periodo ya terminado muestra cuánto subió o bajó frente al anterior (un mes se compara con el mes anterior completo; lo demás, con el periodo de la misma duración justo antes).
- **Comparativo**: gráficas de ingresos y de litros agrupadas por día, semana o mes (según lo largo del periodo). Tocar una barra muestra su valor; **Ver como tabla** da los mismos números.
- **Sabores**: del que más litros vendió al que menos, con ingresos, costo y utilidad por sabor. El primero es el sabor estrella y el último el de menor rotación; un sabor disponible que no se vendió cuenta como 0 L. Si algo se vendió sin costo capturado lo avisa, porque su utilidad sale inflada.
- **Vendedores**: pedidos, clientes, litros, ingresos, utilidad, ticket promedio y visitas sin venta de cada uno, incluidos los dados de baja que vendieron en el periodo.
- **Exportar**: un libro de **Excel** (.xlsx) con las hojas Resumen, Por periodo, Por sabor, Por vendedor y el historial de Ventas (una fila por sabor entregado a cada cliente), o un **CSV** de la tabla que elijas.

Cuentan los pedidos **entregados**, por su fecha de entrega, con el precio y el costo que tenían al venderse (el costo se congela en cada renglón, así que cambiar el costo de un sabor no reescribe los reportes pasados). En **Producción** se conserva el resumen rápido de ventas que funciona sin conexión, calculado en el teléfono.

## QR, NFC y cámara

Cada cliente tiene un QR único (`YGT1:<uuid del cliente>`) que se genera al darlo de alta y no necesita internet.

- **Imprimir** (Clientes → cliente → **Código QR**): etiqueta de 60 × 75 mm para imán, en un PDF del tamaño exacto; se comparte o imprime desde la hoja de compartir del teléfono, o se descarga donde no existe. En Clientes, el botón de la impresora arma un PDF con 9 etiquetas por hoja Carta y guías de corte, para los clientes que elijas.
- **Reponer QR**: genera un QR nuevo y el anterior deja de abrir al cliente (pide confirmación). **Imprimir** sólo vuelve a sacar el mismo QR.
- **Tarjeta NFC**: se liga con el UID de la tarjeta. Si ya era de otro cliente, pide confirmar y se la quita. Donde el navegador no lee NFC se puede teclear el UID (lector USB).
- **Escanear** (botón del visor en Ruta y en Clientes): la cámara lee el QR y, en Android con Chrome, la misma pantalla escucha tarjetas NFC. En Ruta, un cliente con entrega hoy abre su parada; uno sin entrega abre un pedido para hoy con lo del pedido anterior. En Clientes abre su perfil. Códigos que no son de la app, de clientes archivados o que no existen se avisan sin cerrar el visor.
- La cámara usa el lector nativo del navegador (`BarcodeDetector`: QR y códigos de barras comunes) y, donde no existe (Safari, Firefox), `jsqr` sólo para QR. Web NFC existe únicamente en Chrome para Android y pide HTTPS. El PDF se escribe a mano en `src/lib/pdf.ts`.

## Stock diario y avisos

**Stock del día** (RF-037) está en **Producción** del administrador, con servidor. Se captura en dos pasos: **Registrar producción** (litros hechos de cada sabor) y, tocando un vendedor, **su carga** (litros que se lleva de cada sabor, y al cerrar lo que devuelve). Cada sabor muestra cuánto queda sin asignar y avisa en rojo si se asignó más de lo producido; **Repetir el día anterior** copia la carga de ayer. Es una captura del administrador (el servidor la valida y la audita), así que necesita conexión.

El vendedor la ve en su pestaña **Stock**: «Te quedan 7 L de 16 L», y por sabor lo que llevaba, lo entregado y lo que le piden hoy. Lo entregado se cuenta con los pedidos entregados en su propio teléfono, así que el saldo se actualiza al instante y sin señal.

**Avisos** (M10, RF-054 y RF-055), todos en **Cuenta → Avisos**:

- **Pedido urgente y ruta modificada** (RF-054). El administrador marca **Urgente** al crear o editar un pedido (queda para hoy y va primero en la ruta del vendedor, con una etiqueta roja). También avisan una parada nueva, quitada o movida de hoy, una cartera que cambió y una carga de stock nueva. El aviso llega como notificación del sistema aunque la app esté cerrada (**Cuenta → Notificaciones → Activar avisos**) y, si no hay push, al abrir la app o sincronizar.
- **Stock por agotarse** (RF-055): queda poco (2 L o menos, o la quinta parte o menos de lo que llevaba), no alcanza para los pedidos de hoy, o se agotó. Salen como mensaje con la app abierta o como notificación con la app en segundo plano, una sola vez por sabor y por nivel; varios a la vez se juntan en un solo mensaje. La ruta muestra una franja mientras siga pasando.
- **Ventas sin enviar** (RF-055): a partir de las 18:00 (se cambia en Cuenta), si quedan cambios sin sincronizar.

Los avisos de stock y de ventas se generan **en el teléfono**, así que funcionan sin internet pero sólo mientras la app esté abierta o se vuelva a abrir; el sistema operativo no deja a una PWA vigilar en segundo plano. Las notificaciones push necesitan que el servidor tenga claves VAPID y HTTPS (ver [`api/README.md`](api/README.md)). En iPhone sólo funcionan con la app instalada («Compartir → Agregar a inicio»). El service worker sólo se registra en la app compilada, así que para probar push hay que usar `npm run build` y `npm run preview`.

## Pendiente (siguientes pasos)

- Cierre de sesión que no dependa de la señal.
- Sincronizar con la app cerrada (RF-052): hoy el service worker despierta a la app al volver la señal y es la app la que envía la cola; con la app cerrada, se envía al abrirla.
