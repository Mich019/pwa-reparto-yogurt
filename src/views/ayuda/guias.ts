import {
  BookUser, CalendarDays, CircleSlash, Download, Factory, IceCreamBowl, LineChart, Mail, MapPin, Package,
  Printer, QrCode, ScanLine, ShoppingBag, Smartphone, SwatchBook, TrendingUp, UserPlus, WifiOff, type LucideIcon,
} from 'lucide-react'

// El manual de la sección Ayuda: cada guía son unos pasos cortos, y cada paso trae su «captura»: una pantalla de
// esqueleto (bloques grises, sin datos) con lo que hay que tocar resaltado. Las escenas se describen con piezas sencillas
// que dibuja Escena.tsx, así que siguen el tema (claro/oscuro) y el color de la marca, y no pesan como imágenes.
// Los textos de botones y campos son los de la app: si cambian allá, cámbialos aquí.

export type Donde = 'panel' | 'app'
export type Para = 'todos' | 'administrador' | 'vendedor'

export interface BotonEsc { texto?: string; icono?: LucideIcon; primario?: boolean; foco?: boolean }
export type Pieza =
  | { t: 'titulo'; texto: string; sub?: string }
  | { t: 'botones'; items: BotonEsc[]; vertical?: boolean }
  | { t: 'boton'; texto: string; icono?: LucideIcon; foco?: boolean; secundario?: boolean }
  | { t: 'filas'; n: number; foco?: number; avatar?: boolean; textos?: string[] }
  | { t: 'campos'; items: { etiqueta: string; valor?: string; foco?: boolean }[] }
  | { t: 'tarjetas'; n: number; foco?: number; cols?: number; alto?: 'bajo' | 'alto' }
  | { t: 'chips'; items: string[]; foco?: number; elegido?: number }
  | { t: 'colores'; foco?: boolean }
  | { t: 'mapa'; foco?: boolean; alto?: boolean }
  | { t: 'texto'; lineas: number }
  | { t: 'caja'; titulo: string; texto?: string; foco?: boolean; icono?: LucideIcon }
  | { t: 'calendario'; foco?: boolean }
  | { t: 'qr'; n: number }
  | { t: 'escaner' }
  | { t: 'sabores'; n: number; foco?: number }
  | { t: 'acciones'; items: string[]; foco?: number }
  | { t: 'opciones'; items: { titulo: string; sub: string }[]; foco?: number }
  | { t: 'logo'; foco?: boolean }
  | { t: 'navegador'; foco?: 'menu' | 'compartir' }
  | { t: 'menu'; items: string[]; foco: number }
  | { t: 'inicio' }
  | { t: 'correo'; asunto: string; boton: string }

export interface Escena {
  marco: 'telefono' | 'panel'
  seccion?: string // en el panel, la del menú que se ve activa
  pestana?: string // en el teléfono, la de la barra de abajo
  piezas: Pieza[]
  hoja?: { titulo: string; piezas: Pieza[] } // una hoja abierta encima de la pantalla
}
export interface Paso { texto: string; escena: Escena }
export interface Guia {
  id: string
  titulo: string
  resumen: string
  icono: LucideIcon
  donde: Donde
  para: Para
  ir?: string // sección del panel (o apartado de Configuración) a la que lleva «Ir a…»
  palabras: string // para el buscador, además del título y los pasos
  pasos: Paso[]
}

const panel = (seccion: string, piezas: Pieza[], hoja?: Escena['hoja']): Escena => ({ marco: 'panel', seccion, piezas, hoja })
const tel = (pestana: string, piezas: Pieza[], hoja?: Escena['hoja']): Escena => ({ marco: 'telefono', pestana, piezas, hoja })

const encClientes = (foco: 'nuevo' | 'qr' | 'escanear' | null): Pieza => ({
  t: 'botones', items: [
    { icono: ScanLine, texto: 'Escanear', foco: foco === 'escanear' },
    { icono: Printer, texto: 'Imprimir QR', foco: foco === 'qr' },
    { icono: BookUser, texto: 'Libreta' },
    { icono: UserPlus, texto: 'Nuevo cliente', primario: true, foco: foco === 'nuevo' },
  ],
})
const formCliente = (foco: number): Pieza => ({
  t: 'campos', items: [
    { etiqueta: 'Nombre', valor: 'Ej. Doña Lupita', foco: foco === 0 },
    { etiqueta: 'Teléfono / WhatsApp', valor: '10 dígitos', foco: foco === 1 },
    { etiqueta: 'Dirección', valor: 'Calle, número, colonia', foco: foco === 2 },
  ],
})

export const GUIAS: Guia[] = [
  // ------------------------------------------------------------------------------------------------ panel
  {
    id: 'cliente-panel', titulo: 'Agregar un cliente', icono: UserPlus, donde: 'panel', para: 'administrador', ir: 'clientes',
    resumen: 'Dalo de alta con su dirección y su punto en el mapa para que entre a la ruta.',
    palabras: 'alta nuevo cliente direccion mapa ubicacion telefono whatsapp',
    pasos: [
      { texto: 'Entra a Clientes y toca «Nuevo cliente».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, encClientes('nuevo'), { t: 'filas', n: 4, avatar: true }]) },
      { texto: 'Escribe su nombre, su teléfono o WhatsApp y la dirección.', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 4, avatar: true }], { titulo: 'Nuevo cliente', piezas: [formCliente(0)] }) },
      { texto: 'Toca el mapa para dejar el punto exacto de su casa: con él se ordena la ruta.', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo cliente', piezas: [{ t: 'mapa', foco: true }] }) },
      { texto: 'Si quieres, deja una referencia («portón verde») y toca «Guardar cliente».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo cliente', piezas: [{ t: 'campos', items: [{ etiqueta: 'Notas (referencias)', valor: 'Ej. portón verde, tocar fuerte' }] }, { t: 'boton', texto: 'Guardar cliente', foco: true }] }) },
    ],
  },
  {
    id: 'invitar', titulo: 'Invitar a un vendedor', icono: Mail, donde: 'panel', para: 'administrador', ir: 'equipo',
    resumen: 'Le llega un correo, crea su contraseña y entra a la app de reparto con su cartera.',
    palabras: 'equipo vendedor repartidor cuenta correo invitacion alta usuario',
    pasos: [
      { texto: 'Entra a Vendedores y toca «Invitar».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, { t: 'botones', items: [{ texto: 'Activas', primario: true }, { texto: 'Dadas de baja' }, { icono: Mail, texto: 'Invitar', foco: true }, { icono: UserPlus, texto: 'Nueva cuenta', primario: true }] }, { t: 'filas', n: 3, avatar: true }]) },
      { texto: 'Escribe su correo y toca «Enviar invitación».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }], { titulo: 'Invitar a un vendedor', piezas: [{ t: 'campos', items: [{ etiqueta: 'Correo', valor: 'rosa@correo.com', foco: true }] }, { t: 'boton', texto: 'Enviar invitación' }] }) },
      { texto: 'Le llega un correo con un enlace: crea su contraseña y ya puede entrar.', escena: tel('', [{ t: 'correo', asunto: 'Te invitaron a {empresa}', boton: 'Crear mi contraseña' }]) },
    ],
  },
  {
    id: 'sabor', titulo: 'Agregar un sabor', icono: IceCreamBowl, donde: 'panel', para: 'administrador', ir: 'sabores',
    resumen: 'Cada sabor con su envase, su precio y su color; el color lo reconoce el equipo en toda la app.',
    palabras: 'producto catalogo precio costo envase color presentacion',
    pasos: [
      { texto: 'Entra a Sabores y toca «Nuevo sabor».', escena: panel('Sabores', [{ t: 'titulo', texto: 'Sabores' }, { t: 'botones', items: [{ icono: IceCreamBowl, texto: 'Nuevo sabor', primario: true, foco: true }] }, { t: 'tarjetas', n: 4, alto: 'alto' }]) },
      { texto: 'Ponle nombre, en qué se mide (litros, kilos, piezas) y su envase.', escena: panel('Sabores', [{ t: 'titulo', texto: 'Sabores' }], { titulo: 'Nuevo sabor', piezas: [{ t: 'campos', items: [{ etiqueta: 'Sabor', valor: 'Ej. Fresa', foco: true }, { etiqueta: 'Se mide en', valor: 'Litros' }, { etiqueta: 'Envase', valor: 'Botella 1 L' }] }] }) },
      { texto: 'Escribe su precio y su costo (el costo sólo lo ven los administradores), elige su color y guarda.', escena: panel('Sabores', [{ t: 'titulo', texto: 'Sabores' }], { titulo: 'Nuevo sabor', piezas: [{ t: 'campos', items: [{ etiqueta: 'Precio', valor: '$60' }, { etiqueta: 'Costo', valor: '$25' }] }, { t: 'colores', foco: true }, { t: 'boton', texto: 'Guardar' }] }) },
    ],
  },
  {
    id: 'produccion', titulo: 'Registrar la producción y repartir la carga', icono: Factory, donde: 'panel', para: 'administrador', ir: 'produccion',
    resumen: 'Anota lo que produjiste hoy y cuánto se lleva cada vendedor.',
    palabras: 'stock inventario carga asignar produccion dia vendedores',
    pasos: [
      { texto: 'En Producción, abre «Stock del día» y toca «Registrar producción».', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }, { t: 'botones', items: [{ texto: 'Pronóstico' }, { texto: 'Stock del día', primario: true }, { icono: CalendarDays, texto: 'Hoy' }, { icono: Factory, texto: 'Registrar producción', primario: true, foco: true }] }, { t: 'tarjetas', n: 3, alto: 'bajo' }, { t: 'filas', n: 3 }]) },
      { texto: 'Escribe cuánto salió de cada sabor y toca «Guardar producción».', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }], { titulo: 'Producción', piezas: [{ t: 'sabores', n: 3, foco: 0 }, { t: 'boton', texto: 'Guardar producción' }] }) },
      { texto: 'Abajo, en Vendedores, toca a cada quien para asignarle su carga y guarda.', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }, { t: 'tarjetas', n: 3, alto: 'bajo' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Carga de Rosa', piezas: [{ t: 'sabores', n: 3 }, { t: 'boton', texto: 'Guardar carga · 30 L', foco: true }] }) },
    ],
  },
  {
    id: 'pronostico', titulo: 'Saber cuánto producir', icono: TrendingUp, donde: 'panel', para: 'administrador', ir: 'produccion',
    resumen: 'El pronóstico suma los pedidos agendados y lo que se suele vender para la próxima semana.',
    palabras: 'pronostico prediccion semana cuanto producir planear',
    pasos: [
      { texto: 'En Producción, deja elegido «Pronóstico».', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }, { t: 'botones', items: [{ texto: 'Pronóstico', primario: true, foco: true }, { texto: 'Stock del día' }] }, { t: 'texto', lineas: 1 }, { t: 'tarjetas', n: 1, alto: 'bajo', cols: 3 }]) },
      { texto: 'Arriba ves el total y abajo cuánto de cada sabor, día por día.', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }, { t: 'tarjetas', n: 1, alto: 'bajo', cols: 3, foco: 0 }, { t: 'filas', n: 4 }]) },
    ],
  },
  {
    id: 'reportes', titulo: 'Ver ventas y exportar un reporte', icono: LineChart, donde: 'panel', para: 'administrador', ir: 'reportes',
    resumen: 'Ventas, utilidad y lo entregado por día, semana, mes o el rango que quieras; en PDF o Excel.',
    palabras: 'reporte ventas utilidad ganancia pdf excel exportar imprimir semana mes rango',
    pasos: [
      { texto: 'En Reportes, elige Día, Semana, Mes o Rango.', escena: panel('Reportes', [{ t: 'titulo', texto: 'Reportes' }, { t: 'botones', items: [{ texto: 'Día' }, { texto: 'Semana', primario: true, foco: true }, { texto: 'Mes' }, { texto: 'Rango' }, { icono: Download, texto: 'Exportar', primario: true }] }, { t: 'tarjetas', n: 4, alto: 'bajo' }]) },
      { texto: 'Con las flechas pasas al periodo anterior; en Rango eliges las fechas en el calendario.', escena: panel('Reportes', [{ t: 'titulo', texto: 'Reportes' }, { t: 'botones', items: [{ texto: 'Día' }, { texto: 'Semana' }, { texto: 'Mes' }, { texto: 'Rango', primario: true }, { icono: CalendarDays, texto: '1 – 15 oct' }] }, { t: 'calendario', foco: true }]) },
      { texto: 'Toca «Exportar» y elige PDF (para imprimir o mandar) o Excel.', escena: panel('Reportes', [{ t: 'titulo', texto: 'Reportes' }, { t: 'tarjetas', n: 4, alto: 'bajo' }], { titulo: 'Exportar', piezas: [{ t: 'opciones', items: [{ titulo: 'PDF', sub: 'Para imprimir o compartir' }, { titulo: 'Excel', sub: 'Cinco hojas con totales' }], foco: 0 }] }) },
    ],
  },
  {
    id: 'qr', titulo: 'Imprimir los QR de tus clientes', icono: QrCode, donde: 'panel', para: 'administrador', ir: 'clientes',
    resumen: 'Una etiqueta por cliente: el vendedor la escanea y le abre su ficha al instante.',
    palabras: 'qr codigo etiqueta imprimir escanear tarjeta',
    pasos: [
      { texto: 'En Clientes, toca «Imprimir QR».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, encClientes('qr'), { t: 'filas', n: 4, avatar: true }]) },
      { texto: 'Elige a quiénes y descarga la hoja tamaño Carta con sus etiquetas.', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Imprimir QR', piezas: [{ t: 'qr', n: 6 }, { t: 'boton', texto: 'Imprimir QR', foco: true }] }) },
      { texto: 'Pégala en su puerta o su refri. En la ruta se escanea con el botón de QR.', escena: tel('Ruta', [{ t: 'escaner' }]) },
    ],
  },
  {
    id: 'marca', titulo: 'Poner tu logo y tus colores', icono: SwatchBook, donde: 'panel', para: 'administrador', ir: 'marca',
    resumen: 'Tu logo y tu color salen en el panel, en la app de tu equipo y en los reportes PDF.',
    palabras: 'marca logo color nombre empresa personalizar pdf lema',
    pasos: [
      { texto: 'En Configuración, abre «Marca».', escena: panel('Configuración', [{ t: 'titulo', texto: 'Configuración' }, { t: 'chips', items: ['Cuenta', 'Seguridad', 'Marca', 'Apariencia', 'Ayuda'], foco: 2 }, { t: 'texto', lineas: 3 }]) },
      { texto: 'Sube tu logo: la app te avisa si le sobra fondo o se ve chico, y te propone sus colores.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Marca' }, { t: 'logo', foco: true }, { t: 'campos', items: [{ etiqueta: 'Nombre', valor: '{empresa}' }] }]) },
      { texto: 'Elige tu color, revisa la vista previa del reporte y guarda.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Marca' }, { t: 'colores', foco: true }, { t: 'tarjetas', n: 1, alto: 'alto', cols: 2 }]) },
    ],
  },

  // -------------------------------------------------------------------------------------------- app de reparto
  {
    id: 'entregar', titulo: 'Entregar un pedido en la ruta', icono: MapPin, donde: 'app', para: 'todos',
    resumen: 'La ruta ya viene ordenada: llega, cobra y marca el pedido como realizado.',
    palabras: 'ruta entregar entrega cobrar efectivo transferencia navegar mapa parada',
    pasos: [
      { texto: 'En Ruta ves el mapa con las paradas en orden; la tarjeta de abajo es la siguiente.', escena: tel('Ruta', [{ t: 'mapa', alto: true }, { t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L', foco: true }]) },
      { texto: 'Desliza la tarjeta hacia arriba: «Navegar» abre el GPS, y también puedes llamar o escribir por WhatsApp.', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'acciones', items: ['Navegar', 'Llamar', 'WhatsApp', 'Editar'], foco: 0 }, { t: 'filas', n: 2 }]) },
      { texto: 'Elige Efectivo o Transfer y toca «Pedido Realizado».', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'chips', items: ['Efectivo', 'Transfer'], elegido: 0 }, { t: 'boton', texto: 'Pedido Realizado', foco: true }]) },
      { texto: 'Luego decide: agendar su siguiente pedido, recordártelo más tarde o seguir a la siguiente parada.', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Entregado · $240', piezas: [{ t: 'opciones', items: [{ titulo: 'Realizar nuevo pedido', sub: 'Agendar su siguiente visita' }, { titulo: 'Recordar más tarde', sub: 'Te aviso para escribirle o llamarle' }, { titulo: 'Cerrar', sub: 'Ir a la siguiente parada' }], foco: 0 }] }) },
    ],
  },
  {
    id: 'pedido', titulo: 'Tomar un pedido', icono: ShoppingBag, donde: 'app', para: 'todos',
    resumen: 'Elige al cliente, suma sabores y agéndalo para hoy, mañana u otro día.',
    palabras: 'pedido nuevo agendar sabores fecha urgente vender',
    pasos: [
      { texto: 'En Clientes, toca al cliente y luego «Nuevo pedido».', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 4, avatar: true }], { titulo: 'Doña Lupita', piezas: [{ t: 'texto', lineas: 2 }, { t: 'boton', texto: 'Nuevo pedido', icono: ShoppingBag, foco: true }] }) },
      { texto: 'Suma cada sabor con + y −; el total se calcula solo.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo pedido', piezas: [{ t: 'sabores', n: 4, foco: 0 }] }) },
      { texto: 'Elige la fecha de entrega (o márcalo «Urgente» para hoy) y agéndalo.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo pedido', piezas: [{ t: 'chips', items: ['Hoy', 'Mañana', 'Otro día'], elegido: 1, foco: 1 }, { t: 'sabores', n: 2 }, { t: 'boton', texto: 'Agendar para mañana' }] }) },
    ],
  },
  {
    id: 'omitir', titulo: 'Si el cliente no estaba', icono: CircleSlash, donde: 'app', para: 'todos',
    resumen: 'Omite la visita y, si quieres, se reprograma sola.',
    palabras: 'omitir no estaba no quiso reprogramar cancelar visita',
    pasos: [
      { texto: 'Abre la parada y, hasta abajo, toca «No estaba / no quiso (omitir)».', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'filas', n: 2 }, { t: 'boton', texto: 'No estaba / no quiso (omitir)', secundario: true, foco: true }]) },
      { texto: 'Elige «Omitir y reprogramar» para agendarlo de nuevo, o «Sólo omitir».', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Omitir visita', piezas: [{ t: 'boton', texto: 'Omitir y reprogramar', foco: true }, { t: 'boton', texto: 'Sólo omitir', secundario: true }] }) },
    ],
  },
  {
    id: 'cliente-app', titulo: 'Dar de alta un cliente desde el teléfono', icono: UserPlus, donde: 'app', para: 'todos',
    resumen: 'Estando en su casa: el mapa toma tu ubicación para el punto exacto.',
    palabras: 'alta nuevo cliente direccion mapa ubicacion telefono',
    pasos: [
      { texto: 'En Clientes, toca «Nuevo cliente».', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 4, avatar: true }, { t: 'boton', texto: 'Nuevo cliente', icono: UserPlus, foco: true }]) },
      { texto: 'Escribe su nombre, teléfono y dirección.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo cliente', piezas: [formCliente(0)] }) },
      { texto: 'Revisa el punto en el mapa (toca para ajustarlo) y toca «Guardar cliente».', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo cliente', piezas: [{ t: 'mapa', foco: true }, { t: 'boton', texto: 'Guardar cliente' }] }) },
    ],
  },
  {
    id: 'escanear', titulo: 'Escanear el QR de un cliente', icono: ScanLine, donde: 'app', para: 'todos',
    resumen: 'Abre su ficha y su pedido sin buscarlo en la lista.',
    palabras: 'qr escanear codigo camara tarjeta nfc',
    pasos: [
      { texto: 'En Ruta, toca el botón de QR de arriba.', escena: tel('Ruta', [{ t: 'botones', items: [{ icono: ScanLine, foco: true }] }, { t: 'mapa', alto: true }]) },
      { texto: 'Apunta a la etiqueta: se abre el cliente y su pedido de hoy.', escena: tel('Ruta', [{ t: 'escaner' }]) },
    ],
  },
  {
    id: 'carga', titulo: 'Ver tu carga del día', icono: Package, donde: 'app', para: 'vendedor',
    resumen: 'Lo que te asignaron hoy y cuánto te queda de cada sabor mientras entregas.',
    palabras: 'stock carga inventario quedan sabores asignado',
    pasos: [
      { texto: 'Abre la pestaña Stock: arriba, «Te quedan» se descuenta con cada entrega.', escena: tel('Stock', [{ t: 'titulo', texto: 'Mi carga de hoy' }, { t: 'caja', titulo: 'Te quedan', texto: '18 L', foco: true }, { t: 'sabores', n: 3 }]) },
    ],
  },
  {
    id: 'sin-senal', titulo: 'Trabajar sin señal', icono: WifiOff, donde: 'app', para: 'todos',
    resumen: 'Todo se guarda en el teléfono y se envía solo cuando vuelve la señal.',
    palabras: 'sin señal internet datos offline sincronizar pendiente enviar',
    pasos: [
      { texto: 'Sigue trabajando normal: pedidos, entregas y clientes se guardan en el teléfono.', escena: tel('Ruta', [{ t: 'mapa', alto: true }, { t: 'caja', titulo: 'Sin conexión', texto: 'Se enviará al volver la señal', icono: WifiOff, foco: true }]) },
      { texto: 'En Cuenta ves lo que falta por enviar; con señal, «Sincronizar ahora» lo manda de una vez.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Sincronización', texto: '{pendientes}' }, { t: 'boton', texto: 'Sincronizar ahora', secundario: true, foco: true }]) },
    ],
  },
]

// La de instalar cambia según el teléfono: se arma al abrirla (Ayuda.tsx).
export function guiaInstalar(sistema: 'ios' | 'android' | 'otro'): Guia {
  const base = {
    id: 'instalar', titulo: 'Instalar la app en el teléfono', icono: Smartphone, donde: 'app' as const, para: 'todos' as const,
    resumen: 'Queda en tu pantalla de inicio como cualquier app, y abre aunque no haya señal.',
    palabras: 'instalar app telefono celular pantalla inicio icono descargar',
  }
  const final: Paso = { texto: 'Listo: ábrela desde su ícono, con tu logo.', escena: tel('', [{ t: 'inicio' }]) }
  if (sistema === 'ios') return { ...base, pasos: [
    { texto: 'Abre la app de reparto en Safari y toca el botón de Compartir.', escena: tel('', [{ t: 'navegador', foco: 'compartir' }, { t: 'mapa', alto: true }]) },
    { texto: 'Baja y toca «Agregar a inicio».', escena: tel('', [{ t: 'mapa', alto: true }], { titulo: 'Compartir', piezas: [{ t: 'menu', items: ['Copiar', 'Agregar a favoritos', 'Agregar a inicio', 'Imprimir'], foco: 2 }] }) },
    final,
  ] }
  return { ...base, pasos: [
    { texto: 'Abre la app de reparto en Chrome y toca el menú (los tres puntos).', escena: tel('', [{ t: 'navegador', foco: 'menu' }, { t: 'mapa', alto: true }]) },
    { texto: 'Toca «Instalar app» (o «Agregar a la pantalla principal»).', escena: tel('', [{ t: 'navegador' }, { t: 'menu', items: ['Nueva pestaña', 'Historial', 'Instalar app', 'Configuración'], foco: 2 }]) },
    final,
  ] }
}
