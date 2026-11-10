import {
  ArrowRightLeft, Bell, BellRing, BookUser, Camera, CalendarDays, CircleSlash, CreditCard, Download, Factory, Flame, History,
  IceCreamBowl, KeyRound, LayoutDashboard, LineChart, LogOut, Mail, MapPin, MapPinned, Moon, Package, Pencil, QrCode,
  RefreshCw, ScanLine, ShieldCheck, ShoppingBag, Smartphone, SwatchBook, TrendingUp, UserCog, UserPlus, UserX, WifiOff,
  Archive, BadgePercent, Boxes, HandCoins, Lock, MessageCircle, MoreHorizontal, NotebookPen, Medal, Search, Target, TriangleAlert, Trophy, Wallet, type LucideIcon,
} from 'lucide-react'

// El manual de la sección Ayuda: cada guía son unos pasos cortos, y cada paso trae su «captura»: una pantalla de
// esqueleto (bloques grises, sin datos) con lo que hay que tocar resaltado. Las escenas se describen con piezas sencillas
// que dibuja Escena.tsx, así que siguen el tema (claro/oscuro) y el color de la marca, y no pesan como imágenes.
// Los textos de botones y campos son los de la app: si cambian allá, cámbialos aquí.

export type Donde = 'panel' | 'app'
export type Para = 'todos' | 'administrador' | 'vendedor'
export type Tema = 'clientes' | 'pedidos' | 'equipo' | 'produccion' | 'reportes' | 'cuenta'
export const TEMAS: { id: Tema; texto: string }[] = [
  { id: 'pedidos', texto: 'Pedidos y ruta' },
  { id: 'clientes', texto: 'Clientes' },
  { id: 'equipo', texto: 'Equipo' },
  { id: 'produccion', texto: 'Producción y sabores' },
  { id: 'reportes', texto: 'Ventas y reportes' },
  { id: 'cuenta', texto: 'Tu cuenta' },
]

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
  tema: Tema
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

const encClientes = (foco: 'nuevo' | 'mas' | null): Pieza => ({
  t: 'botones', items: [
    { texto: 'Activos', primario: true },
    { texto: 'Archivados' },
    { icono: MoreHorizontal, texto: 'Más', foco: foco === 'mas' },
    { icono: UserPlus, texto: 'Nuevo cliente', primario: true, foco: foco === 'nuevo' },
  ],
})
const masClientes = (foco: number): Pieza => ({ t: 'menu', items: ['Escanear', 'Imprimir QR', 'Bajar a Excel', 'Libreta', 'Límite sugerido para todos'], foco })
const encEquipo = (foco: 'mas' | 'nueva' | null): Pieza => ({
  t: 'botones', items: [
    { texto: 'Activas', primario: true },
    { texto: 'Dadas de baja' },
    { icono: MoreHorizontal, texto: 'Más', foco: foco === 'mas' },
    { icono: UserPlus, texto: 'Nueva cuenta', primario: true, foco: foco === 'nueva' },
  ],
})
const masEquipo = (foco: number): Pieza => ({ t: 'menu', items: ['Invitar', 'Meta para todos', 'Salón de la fama', 'Bajar a Excel'], foco })
// Los apartados de Configuración, en su orden.
const apartados = (foco: string): Pieza => {
  const items = ['Cuenta', 'Seguridad', 'Preferencias', 'Marca', 'Suscripción', 'Privacidad y datos', 'Apariencia', 'Ayuda']
  return { t: 'chips', items, foco: items.indexOf(foco) }
}
const formCliente = (foco: number): Pieza => ({
  t: 'campos', items: [
    { etiqueta: 'Nombre', valor: 'Ej. Doña Lupita', foco: foco === 0 },
    { etiqueta: 'Teléfono / WhatsApp', valor: '10 dígitos', foco: foco === 1 },
    { etiqueta: 'Dirección', valor: 'Calle, número, colonia', foco: foco === 2 },
  ],
})

// El «?» de cada sección (AyudaRapida.tsx): qué guías abre, en ese orden. Cada quien ve sólo las que le tocan.
export const AYUDA_DE = {
  resumen: ['resumen', 'buscar'],
  equipo: ['invitar', 'nueva-cuenta', 'metas-equipo', 'cartera', 'baja', 'admin-reparte'],
  clientes: ['cliente-panel', 'cliente-app', 'sin-comprar', 'pedido', 'limites-fiado', 'fiado', 'precio-especial', 'cambiar-vendedor', 'historial', 'envases', 'escanear', 'ubicacion', 'archivar', 'qr', 'libreta'],
  produccion: ['pronostico', 'produccion'],
  sabores: ['sabor'],
  cobranza: ['cobranza', 'limites-fiado', 'cortes', 'cierre-mes'],
  reportes: ['reportes'],
  ruta: ['entregar', 'avisos-ruta', 'fiado', 'omitir', 'editar-pedido', 'recordatorios', 'ruta', 'escanear', 'urgente', 'sin-senal'],
  stock: ['carga'],
} satisfies Record<string, string[]>

export const GUIAS: Guia[] = [
  // ------------------------------------------------------------------------------------------------ panel
  {
    id: 'sin-comprar', tema: 'clientes', titulo: 'Clientes que dejaron de comprar', icono: UserX, donde: 'app', para: 'todos', ir: 'clientes',
    resumen: 'Quiénes llevan más de un mes sin pedido y cómo escribirles a todos.',
    palabras: 'dejaron de comprar inactivos perdidos recuperar whatsapp ritmo cada cuanto',
    pasos: [
      { texto: 'En Clientes, arriba de la lista sale cuántos dejaron de comprar cuando hay alguien que ya compraba, no tiene pedido y su última entrega fue hace más de un mes. Tócalo.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'botones', items: [{ texto: '3 dejaron de comprar', foco: true }] }, { t: 'filas', n: 3, avatar: true }]) },
      { texto: 'La lista se queda sólo con ellos. «Escribirles» abre un WhatsApp para cada uno con tu mensaje, que puedes cambiar ahí mismo.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'botones', items: [{ texto: 'Ver todos', primario: true }, { icono: MessageCircle, texto: 'Escribirles', foco: true }] }, { t: 'filas', n: 3, avatar: true }]) },
      { texto: 'En la ficha de cada cliente ves cada cuánto compra en promedio y si ya se tardó más de lo normal; «Repetir el último» le arma el pedido de siempre.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Doña Lupita', piezas: [{ t: 'texto', lineas: 2 }, { t: 'botones', items: [{ texto: 'Nuevo pedido', primario: true }, { texto: 'Repetir el último', foco: true }] }] }) },
    ],
  },
  {
    id: 'cliente-panel', tema: 'clientes', titulo: 'Agregar un cliente', icono: UserPlus, donde: 'panel', para: 'administrador', ir: 'clientes',
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
    id: 'invitar', tema: 'equipo', titulo: 'Invitar a un vendedor', icono: Mail, donde: 'panel', para: 'administrador', ir: 'equipo',
    resumen: 'Le llega un correo, crea su contraseña y entra a la app de reparto con su cartera.',
    palabras: 'equipo vendedor repartidor cuenta correo invitacion alta usuario',
    pasos: [
      { texto: 'Entra a Vendedores, abre «Más» y toca «Invitar».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, encEquipo('mas'), masEquipo(0)]) },
      { texto: 'Escribe su correo y toca «Enviar invitación».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }], { titulo: 'Invitar a un vendedor', piezas: [{ t: 'campos', items: [{ etiqueta: 'Correo', valor: 'rosa@correo.com', foco: true }] }, { t: 'boton', texto: 'Enviar invitación' }] }) },
      { texto: 'Le llega un correo con un enlace: crea su contraseña y ya puede entrar.', escena: tel('', [{ t: 'correo', asunto: 'Te invitaron a {empresa}', boton: 'Crear mi contraseña' }]) },
    ],
  },
  {
    id: 'sabor', tema: 'produccion', titulo: 'Agregar un sabor', icono: IceCreamBowl, donde: 'panel', para: 'administrador', ir: 'sabores',
    resumen: 'Cada sabor con su envase, su precio y su color; el color lo reconoce el equipo en toda la app.',
    palabras: 'producto catalogo precio costo envase color presentacion retornable dejar de producir sin ventas',
    pasos: [
      { texto: 'Entra a Sabores y toca «Nuevo sabor».', escena: panel('Sabores', [{ t: 'titulo', texto: 'Sabores' }, { t: 'botones', items: [{ icono: IceCreamBowl, texto: 'Nuevo sabor', primario: true, foco: true }] }, { t: 'sabores', n: 4 }]) },
      { texto: 'Ponle nombre, en qué se mide (litros, kilos, piezas) y su envase. Si el envase se presta y regresa (garrafón), márcalo como retornable.', escena: panel('Sabores', [{ t: 'titulo', texto: 'Sabores' }], { titulo: 'Nuevo sabor', piezas: [{ t: 'campos', items: [{ etiqueta: 'Sabor', valor: 'Ej. Fresa', foco: true }, { etiqueta: 'Se mide en', valor: 'Litros' }, { etiqueta: 'Envase', valor: 'Botella 1 L' }] }] }) },
      { texto: 'Escribe su precio y su costo (el costo sólo lo ven los administradores), elige su color y guarda.', escena: panel('Sabores', [{ t: 'titulo', texto: 'Sabores' }], { titulo: 'Nuevo sabor', piezas: [{ t: 'campos', items: [{ etiqueta: 'Precio', valor: '$60' }, { etiqueta: 'Costo', valor: '$25' }] }, { t: 'colores', foco: true }, { t: 'boton', texto: 'Guardar' }] }) },
      { texto: 'Los que no se vendieron en 30 días salen aparte. Al abrir uno, «Dejar de producir» lo saca del pronóstico (lo ya pedido se sigue contando).', escena: panel('Sabores', [{ t: 'titulo', texto: 'Sabores' }, { t: 'sabores', n: 3 }], { titulo: 'Mango', piezas: [{ t: 'caja', titulo: 'Sin ventas en 30 días' }, { t: 'boton', texto: 'Dejar de producir', secundario: true, foco: true }] }) },
    ],
  },
  {
    id: 'produccion', tema: 'produccion', titulo: 'Registrar la producción y repartir la carga', icono: Factory, donde: 'panel', para: 'administrador', ir: 'produccion',
    resumen: 'Anota lo que produjiste hoy y cuánto se lleva cada vendedor.',
    palabras: 'stock inventario carga asignar produccion dia vendedores',
    pasos: [
      { texto: 'En Producción, abre «Stock del día» y toca «Registrar producción».', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }, { t: 'botones', items: [{ texto: 'Pronóstico' }, { texto: 'Stock del día', primario: true }, { icono: CalendarDays, texto: 'Hoy' }, { icono: Factory, texto: 'Registrar producción', primario: true, foco: true }] }, { t: 'tarjetas', n: 3, alto: 'bajo' }, { t: 'filas', n: 3 }]) },
      { texto: 'Escribe cuánto salió de cada sabor y toca «Guardar producción».', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }], { titulo: 'Producción', piezas: [{ t: 'sabores', n: 3, foco: 0 }, { t: 'boton', texto: 'Guardar producción' }] }) },
      { texto: 'Abajo, en Vendedores, toca a cada quien para asignarle su carga y guarda.', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }, { t: 'tarjetas', n: 3, alto: 'bajo' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Carga de Rosa', piezas: [{ t: 'sabores', n: 3 }, { t: 'boton', texto: 'Guardar carga · 30 L', foco: true }] }) },
    ],
  },
  {
    id: 'pronostico', tema: 'produccion', titulo: 'Saber cuánto producir', icono: TrendingUp, donde: 'panel', para: 'administrador', ir: 'produccion',
    resumen: 'Lo ya pedido más lo que se suele vender a los clientes que les toca visita, menos lo que ya anotaste.',
    palabras: 'pronostico prediccion mañana semana cuanto producir planear cocina hoja imprimir atinado dia por dia faltan',
    pasos: [
      { texto: 'En Producción, deja elegido «Pronóstico» y en «Producir para» elige Mañana, 3 días o Semana.', escena: panel('Producción', [{ t: 'titulo', texto: 'Producción' }, { t: 'botones', items: [{ texto: 'Pronóstico', primario: true }, { texto: 'Stock del día' }] }, { t: 'chips', items: ['Mañana', '3 días', 'Semana'], elegido: 0, foco: 0 }]) },
      { texto: '«Por sabor» dibuja cada uno en su color: lo lleno ya está pedido y lo rayado es lo que se estima de las visitas sin pedido. A un lado, el total a producir.', escena: panel('Producción', [{ t: 'titulo', texto: 'Por sabor' }, { t: 'filas', n: 4, foco: 0 }, { t: 'caja', titulo: 'Total a producir', texto: 'Ya pedido y estimado' }]) },
      { texto: 'Si ya anotaste producción en Stock del día, se descuenta y te dice cuánto te falta; «Anotar lo producido» te lleva ahí. «Imprimir hoja para la cocina» saca una hoja con todo.', escena: panel('Producción', [{ t: 'caja', titulo: 'Ya anotado', texto: 'Te faltan 12 L' }, { t: 'boton', texto: 'Anotar lo producido', foco: true }, { t: 'boton', texto: 'Imprimir hoja para la cocina', secundario: true }]) },
      { texto: 'Con 3 días o Semana, «Día por día» dice lo que sale cada día. «¿Qué tan atinado es?» compara lo que se estimó con lo entregado en los últimos 14 días y te deja corregir el pronóstico.', escena: panel('Producción', [{ t: 'titulo', texto: 'Día por día' }, { t: 'filas', n: 4 }, { t: 'boton', texto: '¿Qué tan atinado es?', secundario: true, foco: true }]) },
      { texto: 'Desde las 6 de la tarde te avisamos si a los pedidos de mañana les falta producción anotada.', escena: panel('Producción', [{ t: 'caja', titulo: 'Falta producir para mañana', texto: 'Fresa: faltan 8 L', icono: BellRing, foco: true }]) },
    ],
  },
  {
    id: 'reportes', tema: 'reportes', titulo: 'Ver ventas y exportar un reporte', icono: LineChart, donde: 'panel', para: 'administrador', ir: 'reportes',
    resumen: 'Ventas, utilidad y lo entregado por día, semana, mes o el rango que quieras, con su tendencia; en PDF, Excel o CSV.',
    palabras: 'reporte ventas utilidad ganancia pdf excel csv exportar imprimir semana mes rango tendencia año anterior comparar vendedor pagos fiado cobra mejor',
    pasos: [
      { texto: 'En Reportes, elige Día, Semana, Mes o Rango. Con las flechas pasas al periodo anterior; en Rango eliges las fechas en el calendario.', escena: panel('Reportes', [{ t: 'titulo', texto: 'Reportes' }, { t: 'botones', items: [{ texto: 'Día' }, { texto: 'Semana', primario: true, foco: true }, { texto: 'Mes' }, { texto: 'Rango' }, { icono: Download, texto: 'Exportar', primario: true }] }, { t: 'texto', lineas: 1 }]) },
      { texto: '«Últimos 14 días» (u 8 semanas, o 12 meses) dibuja la tendencia: elige qué medir y toca una barra para ir a ese periodo. «Comparar con hace un año» pone al lado una barrita gris.', escena: panel('Reportes', [{ t: 'chips', items: ['Ingresos', 'Utilidad', 'Litros', 'Pedidos'], elegido: 0 }, { t: 'tarjetas', n: 1, alto: 'alto', cols: 1, foco: 0 }, { t: 'caja', titulo: 'Comparar con hace un año' }]) },
      { texto: 'Abajo: «Cómo te pagaron», «De qué se vendió más», el fiado del periodo contra lo cobrado («Quién cobra mejor», por vendedor) y cada vendedor; tocar uno abre sus cifras y su meta del mes.', escena: panel('Reportes', [{ t: 'caja', titulo: 'Cómo te pagaron', texto: 'Efectivo · Transferencia · Fiado' }, { t: 'caja', titulo: 'Quién cobra mejor' }, { t: 'filas', n: 3, avatar: true, foco: 0 }]) },
      { texto: 'Toca «Exportar» y elige PDF (para imprimir o mandar), Excel o CSV.', escena: panel('Reportes', [{ t: 'titulo', texto: 'Reportes' }], { titulo: 'Exportar reporte', piezas: [{ t: 'chips', items: ['PDF', 'Excel', 'CSV'], elegido: 0, foco: 0 }, { t: 'texto', lineas: 2 }] }) },
    ],
  },
  {
    id: 'qr', tema: 'clientes', titulo: 'Imprimir los QR de tus clientes', icono: QrCode, donde: 'panel', para: 'administrador', ir: 'clientes',
    resumen: 'Una etiqueta por cliente: el vendedor la escanea y le abre su ficha al instante.',
    palabras: 'qr codigo etiqueta imprimir escanear tarjeta',
    pasos: [
      { texto: 'En Clientes, abre «Más» y toca «Imprimir QR».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, encClientes('mas'), masClientes(1)]) },
      { texto: 'Elige a quiénes y descarga la hoja tamaño Carta con sus etiquetas.', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Imprimir QR', piezas: [{ t: 'qr', n: 6 }, { t: 'boton', texto: 'Imprimir QR', foco: true }] }) },
      { texto: 'Pégala en su puerta o su refri. En la ruta se escanea con el botón de QR.', escena: tel('Ruta', [{ t: 'escaner' }]) },
    ],
  },
  {
    id: 'marca', tema: 'cuenta', titulo: 'Poner tu logo y tus colores', icono: SwatchBook, donde: 'panel', para: 'administrador', ir: 'marca',
    resumen: 'Tu logo y tu color salen en el panel, en la app de tu equipo y en los reportes PDF.',
    palabras: 'marca logo color nombre empresa personalizar pdf lema',
    pasos: [
      { texto: 'En Configuración, abre «Marca». Ahí también está la zona horaria de tu empresa, que define el «hoy» de todos.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Configuración' }, apartados('Marca'), { t: 'texto', lineas: 3 }]) },
      { texto: 'Sube tu logo: la app te avisa si le sobra fondo o se ve chico, y te propone sus colores.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Marca' }, { t: 'logo', foco: true }, { t: 'campos', items: [{ etiqueta: 'Nombre', valor: '{empresa}' }] }]) },
      { texto: 'Elige tu color, revisa la vista previa del reporte y guarda.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Marca' }, { t: 'colores', foco: true }, { t: 'tarjetas', n: 1, alto: 'alto', cols: 2 }]) },
    ],
  },

  {
    id: 'cobranza', tema: 'reportes', titulo: 'Ver quién te debe y cobrar', icono: HandCoins, donde: 'panel', para: 'administrador', ir: 'cobranza',
    resumen: 'Todos los saldos por cobrar, del adeudo más viejo al más nuevo, con su abono a un toque.',
    palabras: 'cobranza fiado deuda debe saldo abono cobrar cuentas por cobrar envases prestados limite pasaron whatsapp excel',
    pasos: [
      { texto: 'En Cobranza, «Por cobrar» lista a quien debe y desde cuándo (en rojo, quien pasó su límite). Arriba buscas por cliente o vendedor. «Envases» muestra quién tiene prestados garrafones o botellas.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }, { t: 'botones', items: [{ texto: 'Por cobrar', primario: true, foco: true }, { texto: 'Envases' }, { texto: 'Cortes' }, { texto: 'Meses' }] }, { t: 'filas', n: 4 }]) },
      { texto: 'Filtra «Más de un mes» o «Pasaron su límite». Con «Mensaje para cobrar» escribes el texto de WhatsApp ({nombre}, {saldo}); el botón verde de cada quien lo abre ya escrito y «Mandar a todos» va uno por uno. «Bajar a Excel» se lleva lo que dejó el filtro.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }, { t: 'botones', items: [{ texto: 'Más de un mes' }, { texto: 'Pasaron su límite' }, { icono: MessageCircle, texto: 'Mandar a todos', primario: true, foco: true }] }, { t: 'filas', n: 3 }]) },
      { texto: 'Toca a un cliente para registrar su abono: te dice cuánto quedaría debiendo. Si te equivocas, anúlalo con un motivo: no se borra, queda a la vista. Cada día te avisamos de quien debe desde hace más de un mes.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }], { titulo: 'Abonar', piezas: [{ t: 'campos', items: [{ etiqueta: 'Monto', valor: '420', foco: true }] }, { t: 'chips', items: ['Efectivo', 'Transferencia'], elegido: 0 }, { t: 'boton', texto: 'Registrar abono' }] }) },
    ],
  },
  {
    id: 'limites-fiado', tema: 'reportes', titulo: 'Poner límites de fiado', icono: NotebookPen, donde: 'panel', para: 'administrador', ir: 'preferencias',
    resumen: 'Hasta cuánto puede deber cada cliente: el teléfono avisa al vendedor, tú te enteras si alguien fía de más y, si quieres, fiar de más pide tu código.',
    palabras: 'limite fiado credito deuda maximo sugerido codigo bloquear pasar de mas cobrar mejor vendedor',
    pasos: [
      { texto: 'En Configuración → Preferencias → «Fiado» pon el límite de la empresa (vale para quien no tiene uno propio). Si además pones un código, el teléfono no deja fiar de más sin él: dáselo al vendedor cuando lo autorices.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Fiado' }, { t: 'campos', items: [{ etiqueta: 'Límite de fiado', valor: '500' }, { etiqueta: 'Código para fiar de más', valor: '••••', foco: true }] }]) },
      { texto: 'Para un cliente en particular, ábrelo en Clientes y toca «Fiado»: la app te sugiere un límite según lo que compra y lo bien que paga. Con «Más» → «Límite sugerido para todos» se lo pones de una vez a los que no tienen uno.', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, encClientes('mas'), masClientes(4)]) },
      { texto: 'Si un vendedor fía de más te llega «Se fió de más», y su ficha en Vendedores dice cuántas veces pasó en el mes. En Cobranza, «Pasaron su límite» los separa, con su propio mensaje de WhatsApp; en Reportes, «Quién cobra mejor» compara lo que cada vendedor fió con lo que cobró.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }, { t: 'botones', items: [{ texto: 'Más de un mes' }, { texto: 'Pasaron su límite', primario: true, foco: true }] }, { t: 'filas', n: 3 }]) },
    ],
  },
  {
    id: 'avisos-panel', tema: 'reportes', titulo: 'Recibir avisos en la computadora', icono: BellRing, donde: 'panel', para: 'administrador', ir: 'preferencias',
    resumen: 'Te llega una notificación de lo que pide tu atención (cortes, urgentes, fiado, metas, producción, tu prueba), aunque el panel esté cerrado.',
    palabras: 'avisos notificaciones push alerta computadora corte cuadrar activar preferencias silencio noche horario resumen correo diario semanal mensual urgente minutos prueba fiado limite meta produccion medalla',
    pasos: [
      { texto: 'En Configuración, abre «Preferencias» y en «Avisos en este dispositivo» toca «Activar avisos». El navegador te pide permiso: acéptalo. Con «Enviar prueba» compruebas que llegan.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Avisos en este dispositivo' }, apartados('Preferencias'), { t: 'botones', items: [{ texto: 'Activar avisos', primario: true, foco: true }, { texto: 'Enviar prueba' }] }]) },
      { texto: 'Te avisamos cuando un vendedor entrega su corte o uno confirmado deja de cuadrar, de urgentes sin atender, de quien fió de más o debe desde hace más de un mes, de metas atrasadas o cumplidas, de medallas, de lo que falta producir para mañana y de tu prueba gratis. Al tocar uno se abre donde lo atiendes.', escena: panel('Configuración', [{ t: 'caja', titulo: 'Se fió de más', texto: 'Rosa le fió a Doña Lupita: ahora debe $620', icono: BellRing, foco: true }, { t: 'caja', titulo: 'Un corte confirmado ya no cuadra', icono: Wallet }]) },
      { texto: 'En «Qué avisos recibes» apaga los que no quieras. En «Horario de silencio» eliges las horas en que no suenan (los ves después). Vale para tu cuenta en todos tus dispositivos.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Qué avisos recibes' }, { t: 'filas', n: 3 }, { t: 'titulo', texto: 'Horario de silencio' }, { t: 'filas', n: 1 }]) },
      { texto: 'En «Resumen por correo» te llega lo de ayer cada mañana, tu semana el día que elijas, y el informe del mes en PDF al cerrarlo; «Ver cómo llega» te manda uno ahora. Ahí mismo pones el límite de fiado, los minutos de un urgente y el ritmo de las metas.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Resumen por correo' }, { t: 'filas', n: 3 }, { t: 'boton', texto: 'Ver cómo llega', secundario: true, foco: true }]) },
    ],
  },
  {
    id: 'cortes', tema: 'reportes', titulo: 'Confirmar el corte de cada vendedor', icono: Wallet, donde: 'panel', para: 'administrador', ir: 'cobranza',
    resumen: 'Cada día, el efectivo que el vendedor dice que entregó contra el que debía entregar.',
    palabras: 'corte caja efectivo vendedor confirmar reabrir diferencia faltante sobrante cuadrar dia',
    pasos: [
      { texto: 'En Cobranza, abre «Cortes» y elige el día. Cada vendedor muestra el efectivo que debía entregar y el que entregó; aparte, lo que fió y lo que le pagaron por transferencia.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }, { t: 'botones', items: [{ texto: 'Por cobrar' }, { texto: 'Envases' }, { texto: 'Cortes', primario: true, foco: true }, { texto: 'Meses' }] }, { t: 'filas', n: 3 }]) },
      { texto: 'Si cuadra, toca «Confirmar». Si el vendedor no lo capturó, usa «Capturar» por él. Si después llega un cobro de ese día, «Reabrir» con un motivo lo regresa a por confirmar. Los que cambiaron después de confirmarlos salen marcados arriba.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }, { t: 'filas', n: 3 }, { t: 'botones', items: [{ texto: 'Confirmar', primario: true, foco: true }] }]) },
    ],
  },
  {
    id: 'cierre-mes', tema: 'reportes', titulo: 'Cerrar el mes y sacar el informe', icono: Lock, donde: 'panel', para: 'administrador', ir: 'cobranza',
    resumen: 'Congela las cifras del mes, bloquea correcciones y te da el informe en PDF o Excel.',
    palabras: 'cierre mes cerrar reabrir informe mensual pdf excel utilidad cobranza comisiones metas año numeros anual',
    pasos: [
      { texto: 'En Cobranza, abre «Meses» y elige el mes. Ves ventas, utilidad, por cobrar, envases, comisiones y cortes.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }, { t: 'chips', items: ['Octubre', 'Septiembre', 'Agosto'], elegido: 0, foco: 0 }, { t: 'filas', n: 4 }]) },
      { texto: 'Toca «Cerrar mes». Ya no se podrán cambiar ventas, abonos ni cortes de esos días. Con «Reabrir» y un motivo se corrige y se vuelve a cerrar. Al cerrarlo cuentan las metas, rachas y medallas de tu equipo.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }, { t: 'botones', items: [{ texto: 'PDF' }, { texto: 'Excel' }, { icono: Lock, texto: 'Cerrar mes', primario: true, foco: true }] }]) },
      { texto: 'Descarga el informe con «PDF» o «Excel». Si lo pediste en Preferencias, también te llega por correo.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'Cobranza' }, { t: 'botones', items: [{ texto: 'PDF', foco: true }, { texto: 'Excel', foco: true }, { texto: 'Reabrir' }] }]) },
      { texto: 'Hasta abajo, «El año en números» junta los meses cerrados de cualquier año contra el anterior; «Descargar PDF» lo saca en una hoja.', escena: panel('Cobranza', [{ t: 'titulo', texto: 'El año en números' }, { t: 'tarjetas', n: 1, alto: 'alto', cols: 1 }, { t: 'boton', texto: 'Descargar PDF', secundario: true, foco: true }]) },
    ],
  },
  {
    id: 'precio-especial', tema: 'clientes', titulo: 'Darle un precio especial a un cliente', icono: BadgePercent, donde: 'panel', para: 'administrador', ir: 'clientes',
    resumen: 'Mayoreo: un precio distinto por sabor sólo para ese cliente. El teléfono lo usa solo al armar sus pedidos.',
    palabras: 'precio especial mayoreo descuento cliente lista tarifa',
    pasos: [
      { texto: 'En Clientes, abre al cliente y toca «Precio especial».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Doña Lupita', piezas: [{ t: 'caja', titulo: 'Precio especial', texto: 'Precios', icono: BadgePercent, foco: true }] }) },
      { texto: 'Escribe el precio sólo en los sabores que cambian; en blanco se cobra el de lista. Toca «Guardar».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Precio especial', piezas: [{ t: 'campos', items: [{ etiqueta: 'Fresa (lista $60)', valor: '52', foco: true }, { etiqueta: 'Mango (lista $62)' }] }, { t: 'boton', texto: 'Guardar' }] }) },
    ],
  },
  {
    id: 'resumen', tema: 'reportes', titulo: 'Leer el Resumen', icono: LayoutDashboard, donde: 'panel', para: 'administrador', ir: 'resumen',
    resumen: 'Lo primero que ves al entrar: cómo va el día, lo que te toca atender y cómo va tu equipo.',
    palabras: 'inicio tablero dashboard cobrado hoy ventas avance pedidos recientes sabores mas vendidos que hacer hoy vendedores mes medallas año',
    pasos: [
      { texto: 'Arriba: lo cobrado hoy, las ventas de 30 días (contra los 30 anteriores), los pedidos y la cantidad de hoy.', escena: panel('Resumen', [{ t: 'titulo', texto: 'Buenas tardes' }, { t: 'tarjetas', n: 4, alto: 'bajo', foco: 0 }]) },
      { texto: '«Qué hacer hoy» sale sólo cuando algo espera: urgentes, producción de mañana, cortes por confirmar, fiado de más de un mes o clientes sin vendedor. Cada renglón te lleva ahí.', escena: panel('Resumen', [{ t: 'caja', titulo: 'Qué hacer hoy', icono: TriangleAlert, foco: true }, { t: 'filas', n: 3 }]) },
      { texto: '«Ventas por día» dibuja los últimos 14 días y «Avance de hoy» cuántas entregas van. Luego, los sabores más vendidos (aparte, los que no se vendieron en 30 días).', escena: panel('Resumen', [{ t: 'tarjetas', n: 1, alto: 'alto', cols: 1 }, { t: 'caja', titulo: 'Avance de hoy', texto: '12 de 20 entregas' }, { t: 'sabores', n: 4 }]) },
      { texto: 'Abajo, los pedidos recientes («Buscar pedidos» encuentra cualquiera), los vendedores del mes con su meta, las medallas del mes pasado y, en diciembre y enero, tu año en números.', escena: panel('Resumen', [{ t: 'caja', titulo: 'Pedidos recientes' }, { t: 'botones', items: [{ icono: Search, texto: 'Buscar pedidos', foco: true }] }, { t: 'caja', titulo: 'Vendedores del mes', icono: Trophy }]) },
    ],
  },
  {
    id: 'nueva-cuenta', tema: 'equipo', titulo: 'Crear una cuenta sin invitación', icono: KeyRound, donde: 'panel', para: 'administrador', ir: 'equipo',
    resumen: 'Para quien no revisa su correo: tú creas la cuenta y le pasas una contraseña temporal.',
    palabras: 'nueva cuenta usuario vendedor contraseña temporal clave whatsapp compartir crear',
    pasos: [
      { texto: 'En Vendedores, toca «Nueva cuenta».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, encEquipo('nueva'), { t: 'filas', n: 3, avatar: true }]) },
      { texto: 'Escribe su nombre y el correo con el que va a entrar, y toca «Crear cuenta».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }], { titulo: 'Nueva cuenta', piezas: [{ t: 'campos', items: [{ etiqueta: 'Nombre', valor: 'Ej. Rosa Hernández' }, { etiqueta: 'Correo (con él entra)', valor: 'rosa@correo.com' }, { etiqueta: 'Teléfono / WhatsApp', valor: '10 dígitos (opcional)' }] }, { t: 'boton', texto: 'Crear cuenta', foco: true }] }) },
      { texto: 'La contraseña temporal sólo se muestra esa vez: mándasela por WhatsApp o cópiala. Al entrar, la cambia por la suya.', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }], { titulo: 'Sólo se muestra ahora', piezas: [{ t: 'caja', titulo: 'Contraseña temporal', texto: '••••••••••', icono: KeyRound }, { t: 'acciones', items: ['WhatsApp', 'Compartir', 'Copiar mensaje', 'Sólo la clave'], foco: 0 }] }) },
    ],
  },
  {
    id: 'cartera', tema: 'equipo', titulo: 'Pasar la cartera de un vendedor a otro', icono: ArrowRightLeft, donde: 'panel', para: 'administrador', ir: 'equipo',
    resumen: 'Cuando alguien cambia de zona o se va: sus clientes pasan con sus pedidos agendados.',
    palabras: 'cartera clientes pasar mover reasignar vendedor zona',
    pasos: [
      { texto: 'En Vendedores, toca a la persona y luego «Pasar cartera».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Rosa Hernández', piezas: [{ t: 'acciones', items: ['Editar', 'Contraseña', 'Pasar cartera', 'Dar de baja'], foco: 2 }] }) },
      { texto: 'Elige a quién pasan y cuáles (todos o sólo algunos) y confirma.', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }], { titulo: 'Pasar cartera', piezas: [{ t: 'campos', items: [{ etiqueta: 'A quién', valor: 'Juan Pérez', foco: true }] }, { t: 'filas', n: 3 }, { t: 'boton', texto: 'Pasar 12 clientes a Juan' }] }) },
    ],
  },
  {
    id: 'baja', tema: 'equipo', titulo: 'Dar de baja a un vendedor', icono: UserX, donde: 'panel', para: 'administrador', ir: 'equipo',
    resumen: 'Deja de entrar al instante en todos sus teléfonos; su historial se queda y puedes reactivarlo.',
    palabras: 'baja quitar desactivar vendedor despedir reactivar acceso',
    pasos: [
      { texto: 'En Vendedores, toca a la persona y luego «Dar de baja».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Rosa Hernández', piezas: [{ t: 'acciones', items: ['Editar', 'Contraseña', 'Pasar cartera', 'Dar de baja'], foco: 3 }] }) },
      { texto: 'Decide qué pasa con sus clientes: pasarlos a otra persona, dejarlos sin vendedor o decidir después. Confirma.', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }], { titulo: 'Rosa Hernández', piezas: [{ t: 'caja', titulo: '¿Dar de baja a Rosa?', texto: 'Sus clientes y su historial se conservan' }, { t: 'campos', items: [{ etiqueta: '¿Qué hacemos con sus 12 clientes?', valor: 'Pasarlos a Juan Pérez', foco: true }] }, { t: 'botones', items: [{ texto: 'Cancelar' }, { texto: 'Dar de baja', primario: true }] }] }) },
      { texto: 'Para que vuelva, búscala en «Dadas de baja» y toca «Reactivar».', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, { t: 'botones', items: [{ texto: 'Activas' }, { texto: 'Dadas de baja', primario: true, foco: true }] }, { t: 'filas', n: 2, avatar: true }]) },
    ],
  },
  {
    id: 'cambiar-vendedor', tema: 'clientes', titulo: 'Cambiar el vendedor de un cliente', icono: UserCog, donde: 'panel', para: 'administrador', ir: 'clientes',
    resumen: 'Mueve a un solo cliente (con sus pedidos agendados) a otra persona del equipo.',
    palabras: 'vendedor cliente asignar mover cambiar repartidor sin vendedor',
    pasos: [
      { texto: 'En Clientes, abre al cliente y toca el renglón «Vendedor».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Doña Lupita', piezas: [{ t: 'acciones', items: ['Llamar', 'WhatsApp', 'Código QR', 'Editar'] }, { t: 'caja', titulo: 'Rosa Hernández', texto: 'Vendedor', icono: UserCog, foco: true }] }) },
      { texto: 'Elige a quién pasa. «Sin vendedor» lo deja sólo a la vista del administrador.', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Cambiar de vendedor', piezas: [{ t: 'opciones', items: [{ titulo: 'Juan Pérez', sub: '24 clientes' }, { titulo: 'Rosa Hernández', sub: '12 clientes' }, { titulo: 'Sin vendedor', sub: 'Sólo el administrador lo ve' }], foco: 0 }] }) },
    ],
  },
  {
    id: 'archivar', tema: 'clientes', titulo: 'Archivar a un cliente', icono: Archive, donde: 'panel', para: 'administrador', ir: 'clientes',
    resumen: 'Sale de la lista y de la ruta sin perder su historial; lo puedes volver a activar.',
    palabras: 'archivar quitar borrar cliente inactivo activar archivados',
    pasos: [
      { texto: 'En Clientes, abre al cliente y toca «Archivar».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Doña Lupita', piezas: [{ t: 'acciones', items: ['Llamar', 'WhatsApp', 'Código QR', 'Editar', 'Archivar'], foco: 4 }] }) },
      { texto: 'Para verlo otra vez, cambia a «Archivados», ábrelo y toca «Activar».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'botones', items: [{ texto: 'Activos' }, { texto: 'Archivados', primario: true, foco: true }] }, { t: 'filas', n: 2, avatar: true }]) },
    ],
  },
  {
    id: 'libreta', tema: 'clientes', titulo: 'Descargar la libreta o el Excel de clientes', icono: BookUser, donde: 'panel', para: 'administrador', ir: 'clientes',
    resumen: 'Todos tus clientes con su dirección, teléfono y lo que consumen, en PDF, Excel o CSV.',
    palabras: 'libreta lista clientes directorio pdf excel csv descargar imprimir respaldo bajar fiado envases vendedores',
    pasos: [
      { texto: 'En Clientes, abre «Más» y toca «Libreta».', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, encClientes('mas'), masClientes(3)]) },
      { texto: 'Elige el formato: PDF para imprimir, Excel o CSV para trabajar los datos.', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Libreta de clientes', piezas: [{ t: 'chips', items: ['PDF', 'Excel', 'CSV'], elegido: 0, foco: 0 }, { t: 'texto', lineas: 2 }, { t: 'boton', texto: 'Ver vista previa' }] }) },
      { texto: '«Bajar a Excel» (en el mismo «Más») se lleva lo que deja tu búsqueda, con lo que debe cada uno, su límite y sus envases. En Vendedores y en Cobranza hay uno igual.', escena: panel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, encClientes('mas'), masClientes(2)]) },
    ],
  },
  {
    id: 'suscripcion', tema: 'cuenta', titulo: 'Pagar tu suscripción', icono: CreditCard, donde: 'panel', para: 'administrador', ir: 'suscripcion',
    resumen: 'Al terminar la prueba gratis, el plan mensual se paga con Mercado Pago.',
    palabras: 'pago pagar suscripcion plan mercado pago tarjeta prueba gratis vencida cobro',
    pasos: [
      { texto: 'En Configuración, abre «Suscripción».', escena: panel('Configuración', [{ t: 'titulo', texto: 'Configuración' }, apartados('Suscripción'), { t: 'texto', lineas: 3 }]) },
      { texto: 'Toca «Suscribirme con Mercado Pago», paga con tu tarjeta y regresa al panel: el plan queda activo.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Suscripción' }, { t: 'caja', titulo: 'Plan mensual', texto: 'Tu prueba gratis termina pronto' }, { t: 'boton', texto: 'Suscribirme con Mercado Pago', icono: CreditCard, foco: true }]) },
    ],
  },
  {
    id: 'sesiones', tema: 'cuenta', titulo: 'Cerrar tu sesión en otros equipos', icono: LogOut, donde: 'panel', para: 'administrador', ir: 'seguridad',
    resumen: 'Si entraste en una computadora ajena o perdiste el teléfono.',
    palabras: 'sesion cerrar dispositivo perdi telefono robo seguridad otros equipos',
    pasos: [
      { texto: 'En Configuración, abre «Seguridad» y baja a «Sesiones abiertas».', escena: panel('Configuración', [{ t: 'titulo', texto: 'Sesiones abiertas' }, { t: 'caja', titulo: 'Este equipo', texto: 'Aquí estás' }, { t: 'filas', n: 2, avatar: true }]) },
      { texto: 'Toca «Cerrar» en la que no reconozcas, o cierra todas las demás de una vez.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Sesiones abiertas' }, { t: 'caja', titulo: 'Este equipo', texto: 'Aquí estás' }, { t: 'filas', n: 2, avatar: true, foco: 0 }, { t: 'botones', items: [{ texto: 'Cerrar las otras 2', foco: true }] }]) },
    ],
  },
  {
    id: 'apariencia', tema: 'cuenta', titulo: 'Modo oscuro y letra más grande', icono: Moon, donde: 'panel', para: 'administrador', ir: 'apariencia',
    resumen: 'El tema, el tamaño del texto, menos animaciones y el orden del menú, a tu gusto en esta computadora.',
    palabras: 'oscuro claro tema noche letra grande tamaño texto animaciones movimiento apariencia orden menu secciones acomodar',
    pasos: [
      { texto: 'En Configuración, abre «Apariencia» y elige Claro, Oscuro o Automático.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Apariencia' }, { t: 'tarjetas', n: 3, alto: 'bajo', foco: 1 }]) },
      { texto: 'En «Tamaño del texto» agrandas letras, botones y tablas; «Menos movimiento» quita animaciones.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Lectura y movimiento' }, { t: 'chips', items: ['Normal', 'Grande', 'Más grande'], elegido: 1, foco: 1 }, { t: 'caja', titulo: 'Menos movimiento', texto: 'Quita animaciones y transiciones' }]) },
      { texto: 'En «Orden del menú» arrastra cada sección a donde la quieras (en el teléfono, desde los puntitos de la izquierda). «Restablecer» lo deja como venía.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Orden del menú' }, { t: 'filas', n: 5 }, { t: 'botones', items: [{ texto: 'Restablecer', foco: true }] }]) },
    ],
  },
  {
    id: 'foto', tema: 'cuenta', titulo: 'Poner tu foto de perfil', icono: Camera, donde: 'panel', para: 'administrador', ir: 'cuenta',
    resumen: 'Así te reconoce tu equipo en la app y en los avisos.',
    palabras: 'foto perfil imagen avatar cara',
    pasos: [
      { texto: 'En Configuración → Cuenta, toca tu foto (o «Poner foto») y elige una imagen.', escena: panel('Configuración', [{ t: 'titulo', texto: 'Cuenta' }, { t: 'logo', foco: true }, { t: 'campos', items: [{ etiqueta: 'Nombre', valor: 'Tu nombre' }] }]) },
      { texto: 'Arrástrala para encuadrarla, acércala si quieres y toca «Guardar foto».', escena: panel('Configuración', [{ t: 'titulo', texto: 'Cuenta' }], { titulo: 'Encuadra tu foto', piezas: [{ t: 'tarjetas', n: 1, alto: 'alto', cols: 1 }, { t: 'boton', texto: 'Guardar foto', foco: true }] }) },
    ],
  },

  {
    id: 'buscar', tema: 'pedidos', titulo: 'Buscar pedidos y usar atajos', icono: Search, donde: 'panel', para: 'administrador', ir: 'resumen',
    resumen: 'Encuentra cualquier pedido por cliente, sabor, vendedor o fecha, y muévete por el panel con el teclado.',
    palabras: 'buscar pedidos encontrar filtrar fecha vendedor sabor pago excel atajos teclado tecla',
    pasos: [
      { texto: 'En el Resumen, en «Pedidos recientes», toca «Buscar pedidos». Escribe cliente, sabor, vendedor o fecha («ayer», «lunes», «12 oct») y filtra por estado o forma de pago.', escena: panel('Resumen', [{ t: 'caja', titulo: 'Pedidos recientes' }], { titulo: 'Buscar pedidos', piezas: [{ t: 'campos', items: [{ etiqueta: 'Cliente, sabor, vendedor o fecha', valor: 'fresa ayer', foco: true }] }, { t: 'chips', items: ['Todos', 'Pendientes', 'Entregados', 'Sin venta'], elegido: 0 }, { t: 'filas', n: 3 }] }) },
      { texto: 'Abajo suma lo encontrado y lo baja a Excel. Tocar un pedido abre la ficha de su cliente.', escena: panel('Resumen', [{ t: 'caja', titulo: 'Pedidos recientes' }], { titulo: 'Buscar pedidos', piezas: [{ t: 'filas', n: 3, foco: 0 }, { t: 'boton', texto: 'Excel', secundario: true }] }) },
      { texto: 'Con el teclado: «/» abre el buscador de la sección, «?» muestra todos los atajos y «g» y una letra te lleva a una sección (g c, Clientes; g b, Cobranza…). Las búsquedas recientes quedan a la mano.', escena: panel('Resumen', [{ t: 'titulo', texto: 'Atajos' }, { t: 'filas', n: 4, textos: ['/  Buscar en la sección', '?  Ver estos atajos', 'g c  Ir a Clientes', 'g b  Ir a Cobranza'] }]) },
    ],
  },
  {
    id: 'admin-reparte', tema: 'equipo', titulo: 'Si tú también repartes', icono: Package, donde: 'panel', para: 'administrador',
    resumen: 'En la app de reparto trabajas como un vendedor más con tus clientes; en el panel lo sigues viendo todo.',
    palabras: 'administrador reparte vendo yo mismo pequeño negocio dueño ruta app meta propia',
    pasos: [
      { texto: 'Entra a la app de reparto con tu misma cuenta: Ruta, Clientes, Stock y Por cobrar muestran tus clientes y los que no tienen vendedor. Lo que das de alta ahí queda a tu nombre.', escena: tel('Ruta', [{ t: 'mapa', alto: true }, { t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }]) },
      { texto: 'En Cuenta ves tu día y tu corte, y en Preferencias pones tu propia meta del mes.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Meta del mes', icono: Target, foco: true }, { t: 'caja', titulo: 'Corte de hoy', icono: Wallet }]) },
    ],
  },

  // -------------------------------------------------------------------------------------------- app de reparto
  {
    id: 'entregar', tema: 'pedidos', titulo: 'Entregar un pedido en la ruta', icono: MapPin, donde: 'app', para: 'todos',
    resumen: 'La ruta ya viene ordenada: llega, cobra y marca el pedido como realizado.',
    palabras: 'ruta entregar entrega cobrar efectivo transferencia navegar mapa parada comprobante',
    pasos: [
      { texto: 'En Ruta ves el mapa con las paradas en orden; la tarjeta de abajo es la siguiente. Arriba, lo cobrado hoy y tu avance hacia la meta del mes.', escena: tel('Ruta', [{ t: 'mapa', alto: true }, { t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L', foco: true }]) },
      { texto: 'Desliza la tarjeta hacia arriba: «Navegar» abre el GPS, «Llamar» le marca y «Voy en camino» le avisa por WhatsApp con tu mensaje (lo cambias en Cuenta).', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'acciones', items: ['Navegar', 'Llamar', 'Voy en camino', 'Editar'], foco: 0 }, { t: 'filas', n: 2 }]) },
      { texto: 'Elige Efectivo, Transfer o Fiado (si se lo llevó sin pagar) y toca «Pedido Realizado».', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'chips', items: ['Efectivo', 'Transfer', 'Fiado'], elegido: 0 }, { t: 'boton', texto: 'Pedido Realizado', foco: true }]) },
      { texto: 'Luego decide: agendar su siguiente pedido, mandarle su comprobante por WhatsApp, recordártelo más tarde o seguir a la siguiente parada.', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Entregado · $240', piezas: [{ t: 'opciones', items: [{ titulo: 'Realizar nuevo pedido', sub: 'Agendar su siguiente visita' }, { titulo: 'Enviar comprobante', sub: 'Por WhatsApp' }, { titulo: 'Recordar más tarde', sub: 'Te aviso para escribirle o llamarle' }, { titulo: 'Cerrar', sub: 'Ir a la siguiente parada' }], foco: 0 }] }) },
    ],
  },
  {
    id: 'avisos-ruta', tema: 'pedidos', titulo: 'Los avisos de la ruta', icono: TriangleAlert, donde: 'app', para: 'todos',
    resumen: 'Arriba del mapa salen, sólo cuando hace falta, los urgentes, el stock que se acaba y a quién le toca visita sin pedido.',
    palabras: 'avisos ruta urgente stock poco se acabo visita sin pedido whatsapp mensaje recordar',
    pasos: [
      { texto: 'Rojo: pedidos urgentes, que van primero. Ámbar: sabores con poco stock o que se acabaron.', escena: tel('Ruta', [{ t: 'chips', items: ['Un pedido urgente: va primero', '2 sabores con poco stock'], foco: 0 }, { t: 'mapa', alto: true }]) },
      { texto: '«A 3 clientes les toca visita y no tienen pedido» abre la lista: cada uno con su WhatsApp ya escrito para preguntarle si quiere.', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Les toca visita hoy', piezas: [{ t: 'filas', n: 3, avatar: true }, { t: 'boton', texto: 'Ver todos mis clientes', secundario: true }] }) },
      { texto: 'El mensaje lo cambias a tu gusto ({nombre} se cambia por el de cada cliente) y se guarda en tu cuenta; también sirve para los recordatorios de la campana.', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Les toca visita hoy', piezas: [{ t: 'campos', items: [{ etiqueta: 'Tu mensaje', valor: 'Hola {nombre}, ¿te llevo yogurt hoy?', foco: true }] }] }) },
    ],
  },
  {
    id: 'pedido', tema: 'pedidos', titulo: 'Tomar un pedido', icono: ShoppingBag, donde: 'app', para: 'todos',
    resumen: 'Elige al cliente, suma sabores y agéndalo para hoy, mañana u otro día.',
    palabras: 'pedido nuevo agendar sabores fecha urgente vender',
    pasos: [
      { texto: 'En Clientes, toca al cliente y luego «Nuevo pedido» (o «Repetir el último» para empezar con lo que pidió la vez pasada).', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 4, avatar: true }], { titulo: 'Doña Lupita', piezas: [{ t: 'texto', lineas: 2 }, { t: 'boton', texto: 'Nuevo pedido', icono: ShoppingBag, foco: true }] }) },
      { texto: 'Suma cada sabor con + y −; el total se calcula solo.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo pedido', piezas: [{ t: 'sabores', n: 4, foco: 0 }] }) },
      { texto: 'Elige la fecha de entrega (o márcalo «Urgente» para hoy) y agéndalo.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo pedido', piezas: [{ t: 'chips', items: ['Hoy', 'Mañana', 'Otro día'], elegido: 1, foco: 1 }, { t: 'sabores', n: 2 }, { t: 'boton', texto: 'Agendar para mañana' }] }) },
    ],
  },
  {
    id: 'omitir', tema: 'pedidos', titulo: 'Si el cliente no estaba', icono: CircleSlash, donde: 'app', para: 'todos',
    resumen: 'Omite la visita y, si quieres, se reprograma sola.',
    palabras: 'omitir no estaba no quiso reprogramar cancelar visita',
    pasos: [
      { texto: 'Abre la parada y, hasta abajo, toca «No estaba / no quiso (omitir)».', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'filas', n: 2 }, { t: 'boton', texto: 'No estaba / no quiso (omitir)', secundario: true, foco: true }]) },
      { texto: 'Elige «Omitir y reprogramar» para agendarlo de nuevo, o «Sólo omitir».', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Omitir visita', piezas: [{ t: 'boton', texto: 'Omitir y reprogramar', foco: true }, { t: 'boton', texto: 'Sólo omitir', secundario: true }] }) },
    ],
  },
  {
    id: 'cliente-app', tema: 'clientes', titulo: 'Dar de alta un cliente desde el teléfono', icono: UserPlus, donde: 'app', para: 'todos',
    resumen: 'Estando en su casa: el mapa toma tu ubicación para el punto exacto.',
    palabras: 'alta nuevo cliente direccion mapa ubicacion telefono',
    pasos: [
      { texto: 'En Clientes, toca «Nuevo cliente».', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 4, avatar: true }, { t: 'boton', texto: 'Nuevo cliente', icono: UserPlus, foco: true }]) },
      { texto: 'Escribe su nombre, teléfono y dirección.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo cliente', piezas: [formCliente(0)] }) },
      { texto: 'Revisa el punto en el mapa (toca para ajustarlo) y toca «Guardar cliente».', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo cliente', piezas: [{ t: 'mapa', foco: true }, { t: 'boton', texto: 'Guardar cliente' }] }) },
    ],
  },
  {
    id: 'escanear', tema: 'clientes', titulo: 'Escanear el QR de un cliente', icono: ScanLine, donde: 'app', para: 'todos',
    resumen: 'Abre su ficha y su pedido sin buscarlo en la lista.',
    palabras: 'qr escanear codigo camara tarjeta nfc',
    pasos: [
      { texto: 'En Ruta, toca el botón de QR de arriba.', escena: tel('Ruta', [{ t: 'botones', items: [{ icono: ScanLine, foco: true }] }, { t: 'mapa', alto: true }]) },
      { texto: 'Apunta a la etiqueta: se abre el cliente y su pedido de hoy.', escena: tel('Ruta', [{ t: 'escaner' }]) },
    ],
  },
  {
    id: 'carga', tema: 'produccion', titulo: 'Ver tu carga del día', icono: Package, donde: 'app', para: 'vendedor',
    resumen: 'Lo que te asignaron hoy y cuánto te queda de cada sabor mientras entregas.',
    palabras: 'stock carga inventario quedan sabores asignado',
    pasos: [
      { texto: 'Abre la pestaña Stock: arriba, «Te quedan» se descuenta con cada entrega.', escena: tel('Stock', [{ t: 'titulo', texto: 'Mi carga de hoy' }, { t: 'caja', titulo: 'Te quedan', texto: '18 L', foco: true }, { t: 'sabores', n: 3 }]) },
    ],
  },
  {
    id: 'fiado', tema: 'pedidos', titulo: 'Vender a fiado y cobrar un abono', icono: HandCoins, donde: 'app', para: 'todos',
    resumen: 'Lo que el cliente se lleva sin pagar queda como saldo; cada abono lo baja. Cobrar un abono necesita conexión.',
    palabras: 'fiado credito deuda debe abono cobrar saldo cuenta por cobrar pagar despues limite codigo pasar de mas',
    pasos: [
      { texto: 'Al entregar, elige «Fiado» en lugar de Efectivo o Transfer. No cuenta como cobrado hoy.', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'chips', items: ['Efectivo', 'Transfer', 'Fiado'], elegido: 2, foco: 2 }, { t: 'boton', texto: 'Pedido Realizado' }]) },
      { texto: 'Si el cliente tiene límite de fiado, abajo dice cuánto le puedes fiar todavía. Si con este pedido lo pasa, sale en rojo; si tu empresa pide código, escribe el que te dé el administrador para poder entregar. En la ruta, un triángulo rojo marca a quien ya lo pasó.', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'chips', items: ['Efectivo', 'Transfer', 'Fiado'], elegido: 2 }, { t: 'campos', items: [{ etiqueta: 'Para fiarle de más, pide el código al administrador', valor: '••••', foco: true }] }, { t: 'boton', texto: 'Pedido Realizado' }]) },
      { texto: 'Cuando te pague, abre al cliente (o toca «Por cobrar», arriba de Clientes, donde también le mandas su recordatorio por WhatsApp): dice cuánto debe y una barrita contra su límite. Toca ese renglón.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Doña Lupita', piezas: [{ t: 'acciones', items: ['Llamar', 'WhatsApp', 'Código QR', 'Editar'] }, { t: 'caja', titulo: '$420', texto: 'Debe desde el mié 28 de oct', icono: HandCoins, foco: true }] }) },
      { texto: 'Escribe cuánto abona, elige Efectivo o Transferencia y toca «Registrar abono»: antes te dice cuánto quedaría debiendo contra su límite. Entra a tu corte del día.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Abonar', piezas: [{ t: 'campos', items: [{ etiqueta: 'Monto', valor: '420', foco: true }] }, { t: 'chips', items: ['Efectivo', 'Transferencia'], elegido: 0 }, { t: 'boton', texto: 'Registrar abono' }] }) },
    ],
  },
  {
    id: 'envases', tema: 'clientes', titulo: 'Recoger envases retornables', icono: Boxes, donde: 'app', para: 'todos',
    resumen: 'Los garrafones y botellas que se prestan quedan a cuenta del cliente hasta que los devuelve. Necesita conexión.',
    palabras: 'envases retornables garrafon botella prestados recoger devolver saldo vacios',
    pasos: [
      { texto: 'Abre al cliente: si tiene envases prestados, lo dice arriba. Toca ese renglón.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Tienda La Esquina', piezas: [{ t: 'acciones', items: ['Llamar', 'WhatsApp', 'Código QR', 'Editar'] }, { t: 'caja', titulo: '6', texto: 'Envases prestados', icono: Boxes, foco: true }] }) },
      { texto: 'Elige el producto, cuántos te devuelve y toca «Registrar». No puede devolver más de los que tiene.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Recoger envases', piezas: [{ t: 'campos', items: [{ etiqueta: 'Producto', valor: 'Garrafón 20 L' }, { etiqueta: 'Cantidad', valor: '3', foco: true }] }, { t: 'boton', texto: 'Registrar' }] }) },
    ],
  },
  {
    id: 'corte-dia', tema: 'pedidos', titulo: 'Entregar tu corte del día', icono: Wallet, donde: 'app', para: 'vendedor',
    resumen: 'Al terminar la ruta, escribes el efectivo que entregas; el administrador lo confirma y ve si cuadra.',
    palabras: 'corte dia caja efectivo entregar cuadrar diferencia faltante sobrante cierre',
    pasos: [
      { texto: 'En Cuenta, toca «Corte de hoy»: te dice cuánto efectivo debes entregar (sin transferencias ni fiado).', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Corte de hoy', texto: 'Efectivo a entregar $1,240', icono: Wallet, foco: true }]) },
      { texto: 'Escribe lo que entregas y toca «Entregar corte». Puedes corregirlo hasta que el administrador lo confirme.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }], { titulo: 'Corte de hoy', piezas: [{ t: 'campos', items: [{ etiqueta: 'Efectivo que entregas', valor: '1240', foco: true }] }, { t: 'boton', texto: 'Entregar corte' }] }) },
    ],
  },
  {
    id: 'mis-metas', tema: 'cuenta', titulo: 'Tu meta, tu racha y tus medallas', icono: Trophy, donde: 'app', para: 'vendedor',
    resumen: 'Cuánto llevas del mes, los meses seguidos que llegas a tu meta y las medallas de 3, 6 y 12 meses.',
    palabras: 'meta mes avance racha seguidos medalla trofeo lugar ranking ventas historial',
    pasos: [
      { texto: 'En Cuenta, «Meta del mes» te dice cuánto llevas, cuánto te falta y en qué lugar vas. En Ruta la ves como una barrita bajo «cobrado hoy». Cuando llegas, te felicitamos.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Meta del mes', texto: '$14,200 de $20,000 · vas en 2.º lugar', icono: Target, foco: true }]) },
      { texto: 'Cada mes que el administrador cierra y llegaste a tu meta cuenta como trofeo. Si lo haces varios meses seguidos, llevas una racha. Del día 25 en adelante te avisamos si está en riesgo.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Llegaste a tu meta 4 meses', texto: 'Llevas 3 meses seguidos. ¡Que no se corte!', icono: Trophy, foco: true }]) },
      { texto: 'Con 3, 6 y 12 meses seguidos ganas una medalla, y se queda aunque la racha se corte; Cuenta te dice cuántos meses te faltan para la siguiente y tu lugar en el salón de la fama. Abajo, «Tus metas de los meses pasados» muestra cada mes con lo que vendiste.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'chips', items: ['3 meses', '6 meses', '1 año'], elegido: 0, foco: 1 }, { t: 'caja', titulo: 'Tus metas de los meses pasados', icono: Medal }]) },
    ],
  },
  {
    id: 'metas-equipo', tema: 'equipo', titulo: 'Poner metas y felicitar a tu equipo', icono: Target, donde: 'panel', para: 'administrador', ir: 'equipo',
    resumen: 'Una meta para todos o según lo que vendió cada uno, y cómo ver rachas, medallas y el salón de la fama.',
    palabras: 'meta metas comision vendedores todos porcentaje mes pasado racha medalla felicitar whatsapp salon fama ranking',
    pasos: [
      { texto: 'En Vendedores, abre «Más» y toca «Meta para todos». Pon la misma cantidad o «Según su mes pasado» con un porcentaje; abajo ves cómo quedaría la de cada uno antes de guardar.', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, encEquipo('mas')], { titulo: 'Meta para todos', piezas: [{ t: 'chips', items: ['La misma para todos', 'Según su mes pasado'], elegido: 1 }, { t: 'campos', items: [{ etiqueta: 'Más que su mes pasado (%)', valor: '10', foco: true }] }, { t: 'filas', n: 3, textos: ['Rosa  $12,000 → $13,200', 'Juan  $9,500 → $10,450', 'Luis  Sin ventas'] }] }) },
      { texto: 'Al cerrar el mes, quien llega a 3, 6 o 12 meses seguidos gana una medalla: te avisamos y aparece en el Resumen. En su ficha ves su historial de metas, lo que sus clientes deben y cuántas veces fió de más; «Felicitar por WhatsApp» te da tres mensajes para elegir.', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, { t: 'filas', n: 3, avatar: true }], { titulo: 'Rosa Hernández', piezas: [{ t: 'chips', items: ['Vendedor', '4 metas cumplidas', '3 seguidos'] }, { t: 'boton', texto: 'Felicitar por WhatsApp', secundario: true, foco: true }, { t: 'caja', titulo: 'Historial de metas' }] }) },
      { texto: '«Salón de la fama» (en «Más») muestra las mejores rachas de todos los tiempos, también de quienes ya no están.', escena: panel('Vendedores', [{ t: 'titulo', texto: 'Equipo' }, encEquipo('mas'), masEquipo(2)], { titulo: 'Salón de la fama', piezas: [{ t: 'opciones', items: [{ titulo: 'Rosa Hernández', sub: '6 seguidos · 9 metas cumplidas' }, { titulo: 'Juan Pérez', sub: '3 seguidos · 5 metas cumplidas' }], foco: 0 }] }) },
    ],
  },
  {
    id: 'sin-senal', tema: 'pedidos', titulo: 'Trabajar sin señal', icono: WifiOff, donde: 'app', para: 'todos',
    resumen: 'Todo se guarda en el teléfono y se envía solo cuando vuelve la señal.',
    palabras: 'sin señal internet datos offline sincronizar pendiente enviar',
    pasos: [
      { texto: 'Sigue trabajando normal: pedidos, entregas y clientes se guardan en el teléfono.', escena: tel('Ruta', [{ t: 'mapa', alto: true }, { t: 'caja', titulo: 'Sin conexión', texto: 'Se enviará al volver la señal', icono: WifiOff, foco: true }]) },
      { texto: 'En Cuenta ves lo que falta por enviar; con señal, «Sincronizar ahora» lo manda de una vez.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Sincronización', texto: '{pendientes}' }, { t: 'boton', texto: 'Sincronizar ahora', secundario: true, foco: true }]) },
    ],
  },
  {
    id: 'editar-pedido', tema: 'pedidos', titulo: 'Cambiar un pedido', icono: Pencil, donde: 'app', para: 'todos',
    resumen: 'Si el cliente pide otra cosa al llegar: cambia sabores o cantidades antes de entregarlo.',
    palabras: 'editar cambiar pedido modificar sabores cantidad corregir',
    pasos: [
      { texto: 'En Ruta, sube la tarjeta de la parada y toca «Editar».', escena: tel('Ruta', [{ t: 'caja', titulo: 'Doña Lupita', texto: '$240 · 4 L' }, { t: 'acciones', items: ['Navegar', 'Llamar', 'Voy en camino', 'Editar'], foco: 3 }, { t: 'filas', n: 2 }]) },
      { texto: 'Ajusta los sabores y toca «Guardar cambios».', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Editar pedido', piezas: [{ t: 'sabores', n: 3, foco: 1 }, { t: 'boton', texto: 'Guardar cambios' }] }) },
    ],
  },
  {
    id: 'recordatorios', tema: 'pedidos', titulo: 'Recordar a un cliente más tarde', icono: Bell, donde: 'app', para: 'todos',
    resumen: 'Para quien «te avisa»: la app te lo recuerda para escribirle o llamarle.',
    palabras: 'recordar recordatorio despues llamar escribir pendiente por confirmar campana',
    pasos: [
      { texto: 'Al entregar, elige «Recordar más tarde».', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Entregado · $240', piezas: [{ t: 'opciones', items: [{ titulo: 'Realizar nuevo pedido', sub: 'Agendar su siguiente visita' }, { titulo: 'Recordar más tarde', sub: 'Te aviso para escribirle o llamarle' }, { titulo: 'Cerrar', sub: 'Ir a la siguiente parada' }], foco: 1 }] }) },
      { texto: 'Después, en Ruta, toca la campana de arriba para ver a quién le falta confirmar.', escena: tel('Ruta', [{ t: 'botones', items: [{ icono: Bell, foco: true }, { icono: ScanLine }] }, { t: 'mapa', alto: true }]) },
      { texto: 'Escríbele por WhatsApp o tómale el pedido ahí mismo.', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Por confirmar', piezas: [{ t: 'filas', n: 3, avatar: true }, { t: 'botones', items: [{ texto: 'WhatsApp' }, { texto: 'Pedido', primario: true, foco: true }] }] }) },
    ],
  },
  {
    id: 'urgente', tema: 'pedidos', titulo: 'Mandar un pedido urgente', icono: Flame, donde: 'app', para: 'administrador',
    resumen: 'Para hoy: va primero en la ruta del vendedor y le llega un aviso al instante.',
    palabras: 'urgente rapido hoy prioridad aviso vendedor ya',
    pasos: [
      { texto: 'Toma el pedido como siempre y marca «Urgente» arriba.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo pedido', piezas: [{ t: 'caja', titulo: 'Urgente', texto: 'Para hoy, va primero en la ruta', icono: Flame, foco: true }, { t: 'sabores', n: 2 }] }) },
      { texto: 'Toca «Agendar como urgente»: al vendedor le llega la notificación.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Nuevo pedido', piezas: [{ t: 'sabores', n: 3 }, { t: 'boton', texto: 'Agendar como urgente', foco: true }] }) },
    ],
  },
  {
    id: 'ubicacion', tema: 'clientes', titulo: 'Corregir la ubicación de un cliente', icono: MapPinned, donde: 'app', para: 'todos',
    resumen: 'Si el punto del mapa quedó lejos de su casa, la ruta se arma mal.',
    palabras: 'ubicacion mapa punto direccion casa gps corregir lejos',
    pasos: [
      { texto: 'Al entregar lejos del punto guardado, la app te pregunta: si estás en su domicilio, toca «Guardar aquí».', escena: tel('Ruta', [{ t: 'mapa' }], { titulo: 'Entregado · $240', piezas: [{ t: 'caja', titulo: '¿Estás en su domicilio?', texto: 'Su ubicación está a 350 m de aquí', icono: MapPin }, { t: 'botones', items: [{ texto: 'Guardar aquí', foco: true }] }, { t: 'opciones', items: [{ titulo: 'Realizar nuevo pedido', sub: 'Agendar su siguiente visita' }] }] }) },
      { texto: 'También puedes abrir al cliente, tocar «Editar» y mover el punto en el mapa.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Editar cliente', piezas: [{ t: 'mapa', foco: true }, { t: 'boton', texto: 'Guardar cliente' }] }) },
    ],
  },
  {
    id: 'historial', tema: 'clientes', titulo: 'Ver el historial de un cliente', icono: History, donde: 'app', para: 'todos',
    resumen: 'Qué compra, cada cuándo y sus pedidos agendados, para ofrecerle lo de siempre.',
    palabras: 'historial compras consumo favorito ultima visita pedidos agendados cliente',
    pasos: [
      { texto: 'En Clientes, toca al cliente: arriba ves su sabor favorito, lo que ha consumido, su última visita y cada cuánto compra (avisa si ya se tardó).', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Doña Lupita', piezas: [{ t: 'tarjetas', n: 3, alto: 'bajo', cols: 3, foco: 0 }, { t: 'acciones', items: ['Llamar', 'WhatsApp', 'Editar'] }] }) },
      { texto: 'Más abajo, «Pedidos agendados» y el «Historial» de entregas.', escena: tel('Clientes', [{ t: 'titulo', texto: 'Clientes' }], { titulo: 'Doña Lupita', piezas: [{ t: 'caja', titulo: 'Pedidos agendados', texto: 'Mañana · $240' }, { t: 'caja', titulo: 'Historial', texto: '8 entregas', icono: History, foco: true }, { t: 'filas', n: 2 }] }) },
    ],
  },
  {
    id: 'ruta', tema: 'pedidos', titulo: 'Reordenar la ruta', icono: RefreshCw, donde: 'app', para: 'todos',
    resumen: 'Si cambian los pedidos o te desvías, la ruta se vuelve a calcular desde donde estás.',
    palabras: 'ruta orden recalcular optimizar mapa 3d 2d camino',
    pasos: [
      { texto: 'En Ruta, toca «Recalcular ruta» (las flechas en círculo) a la derecha del mapa.', escena: tel('Ruta', [{ t: 'botones', items: [{ icono: Bell }, { icono: ScanLine }, { icono: RefreshCw, foco: true }] }, { t: 'mapa', alto: true }]) },
      { texto: 'El orden de las paradas se actualiza solo; la tarjeta de abajo siempre es la siguiente.', escena: tel('Ruta', [{ t: 'mapa', alto: true, foco: true }, { t: 'caja', titulo: 'Siguiente: Don Pepe', texto: '$180 · 3 L' }]) },
    ],
  },
  {
    id: 'notificaciones', tema: 'cuenta', titulo: 'Activar las notificaciones', icono: BellRing, donde: 'app', para: 'todos',
    resumen: 'Para que te lleguen los pedidos urgentes y los cambios de ruta aunque la app esté cerrada.',
    palabras: 'notificaciones avisos push alertas sonido permiso preferencias silencio noche horario',
    pasos: [
      { texto: 'En Cuenta, en «Preferencias», toca «Activar avisos» y acepta el permiso.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Preferencias', icono: BellRing }, { t: 'boton', texto: 'Activar avisos', foco: true }]) },
      { texto: 'Con «Enviar prueba» confirmas que llegan. También puedes pedir que te avise si te quedan ventas sin enviar en la tarde.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Preferencias', icono: BellRing }, { t: 'botones', items: [{ texto: 'Enviar prueba', foco: true }, { texto: 'Desactivar' }] }]) },
      { texto: 'Si eres vendedor, en «Qué avisos recibes» puedes apagar los de tu carga del día, los cambios en tu ruta, el fiado de más de un mes o los de tu meta. Los pedidos urgentes siempre llegan. Con «Tu semana por correo» te llegan tus cifras de la semana.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Qué avisos recibes', icono: BellRing }]) },
      { texto: 'Con «Horario de silencio» los avisos no suenan de noche (o en las horas que elijas): los ves al abrir la app. Los urgentes sí suenan.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Horario de silencio', icono: BellRing }]) },
    ],
  },
  {
    id: 'dos-pasos', tema: 'cuenta', titulo: 'Proteger tu cuenta con dos pasos', icono: ShieldCheck, donde: 'app', para: 'todos',
    resumen: 'Además de tu contraseña, un código de una app de autenticación. En el panel está en Configuración → Seguridad.',
    palabras: 'seguridad dos pasos verificacion codigo autenticador 2fa contraseña proteger',
    pasos: [
      { texto: 'En Cuenta, en la verificación en dos pasos, toca «Activar».', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }, { t: 'caja', titulo: 'Verificación en dos pasos', icono: ShieldCheck }, { t: 'boton', texto: 'Activar', icono: ShieldCheck, foco: true }]) },
      { texto: 'Escanea el código con una app de autenticación (Google Authenticator, por ejemplo) y escribe el código que te muestra.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }], { titulo: 'Activar verificación en dos pasos', piezas: [{ t: 'qr', n: 1 }, { t: 'campos', items: [{ etiqueta: 'Código', valor: '123 456', foco: true }] }, { t: 'boton', texto: 'Verificar y activar' }] }) },
      { texto: 'Guarda los códigos de respaldo: sirven si pierdes el teléfono, y no se vuelven a mostrar.', escena: tel('Cuenta', [{ t: 'titulo', texto: 'Mi cuenta' }], { titulo: 'Guarda tus códigos de respaldo', piezas: [{ t: 'filas', n: 4 }, { t: 'botones', items: [{ texto: 'Copiar' }, { texto: 'Descargar', foco: true }] }, { t: 'boton', texto: 'Ya los guardé' }] }) },
    ],
  },
]

// La de instalar cambia según el teléfono: se arma al abrirla (Ayuda.tsx).
export function guiaInstalar(sistema: 'ios' | 'android' | 'otro'): Guia {
  const base = {
    id: 'instalar', tema: 'cuenta' as const, titulo: 'Instalar la app en el teléfono', icono: Smartphone, donde: 'app' as const, para: 'todos' as const,
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
