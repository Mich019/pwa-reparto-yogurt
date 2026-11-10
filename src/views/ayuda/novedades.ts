import type { Donde, Para } from './guias'

// «¿Qué hay de nuevo?» en la Ayuda: lo que cambió, de lo más nuevo a lo más viejo, contado para quien usa la app (no
// para quien la programa). Cada punto puede ser sólo para el administrador o el vendedor, sólo del panel, y abrir su
// guía. Al agregar una versión, va hasta arriba con su fecha (AAAA-MM-DD): la Ayuda marca «Nuevo» lo que esa persona
// todavía no vio en este dispositivo. Las pruebas (api/_test/guias.test.ts) revisan el orden y que cada guía exista.

export interface PuntoNovedad { texto: string; para?: Para; donde?: Donde; guia?: string }
export interface Novedad { fecha: string; titulo: string; puntos: PuntoNovedad[] }

export const NOVEDADES: Novedad[] = [
  {
    fecha: '2026-11-10', titulo: 'Clientes que dejaron de comprar y más WhatsApp',
    puntos: [
      { texto: '«Cobranza» ahora se llama «Finanzas», con pestañas más claras: Por cobrar, Envases, Cortes del día y Cierre de mes; debajo del título dice para qué sirve cada una. Arriba, cuatro cifras de un vistazo (lo que te deben, el efectivo de hoy por confirmar, los envases prestados y lo vendido en el mes) y «Cortes del día» trae un numerito con los que faltan por confirmar. Su atajo es «g f».', para: 'administrador', donde: 'panel', guia: 'cobranza' },
      { texto: 'La primera vez que entras, un recorrido corto te muestra para qué sirve cada parte, señalando cada botón. Lo repites cuando quieras con «Ver la guía otra vez», aquí en Ayuda.' },
      { texto: 'En Clientes ves quiénes dejaron de comprar (más de un mes sin pedido) y les escribes desde ahí.', guia: 'sin-comprar' },
      { texto: '«Qué hacer hoy» en el Resumen te dice cuántos dejaron de comprar, y la ficha de cada vendedor cuántos de su cartera.', para: 'administrador', donde: 'panel' },
      { texto: 'La ficha del cliente dice cada cuánto compra y avisa si ya se tardó; «Repetir el último» arma su pedido de siempre.' },
      { texto: 'En la parada de la ruta, «Voy en camino» abre WhatsApp con tu mensaje (lo cambias en Cuenta). Al terminar la ruta ves cuánto entró en efectivo, transferencia y fiado, y lo mandas por WhatsApp.', donde: 'app', guia: 'entregar' },
      { texto: 'A quien te debe le mandas su estado de cuenta por WhatsApp desde su ficha.' },
      { texto: 'Mejores clientes del mes en el Resumen, y quiénes compraron (y cuántos por primera vez) en Reportes.', para: 'administrador', guia: 'reportes' },
      { texto: 'Por cobrar se ordena por deuda, por antigüedad o por nombre; el pronóstico de producción se baja a Excel.', para: 'administrador', donde: 'panel' },
      { texto: 'El informe del cierre de mes, el del año y la hoja de producción terminan con una firma y un espacio para la fecha; en Preferencias eliges quién firma, su cargo, y puedes dibujar la firma o subirla en foto para que salga impresa.', para: 'administrador', donde: 'panel' },
      { texto: 'Cada guía tiene un «¿Te sirvió?», el administrador puede mandar una guía a su equipo por WhatsApp y la «h» abre la ayuda de la sección en el panel.' },
    ],
  },
  {
    fecha: '2026-11-09', titulo: 'Límites de fiado',
    puntos: [
      { texto: 'Pon hasta cuánto puede deber cada cliente, o uno para toda la empresa. La app te sugiere uno según lo que compra y lo bien que paga, y en Clientes → «Más» se lo pones a todos de una vez.', para: 'administrador', guia: 'limites-fiado' },
      { texto: 'Al elegir «Fiado» en la entrega ves cuánto le puedes fiar todavía; en la ruta, un triángulo rojo marca a quien ya pasó su límite.', guia: 'fiado' },
      { texto: 'Si alguien fía de más te llega «Se fió de más», y si quieres, un código tuyo para autorizarlo. La ficha de cada vendedor dice cuántas veces pasó en el mes.', para: 'administrador', guia: 'limites-fiado' },
      { texto: 'Por cobrar separa a quienes pasaron su límite, con su propio mensaje de WhatsApp, y al abonar dice cuánto quedaría debiendo.', guia: 'cobranza', donde: 'panel' },
      { texto: 'Reportes compara lo que se fió con lo que se cobró, y «Quién cobra mejor» lo dice por vendedor; el correo semanal también.', para: 'administrador', guia: 'reportes' },
      { texto: 'Cada guía de la Ayuda se abre desde el «?» de su sección, y aquí ves lo nuevo.' },
    ],
  },
  {
    fecha: '2026-11-09', titulo: 'Buscar más rápido y cobrar por WhatsApp',
    puntos: [
      { texto: '«Buscar pedidos» en el Resumen encuentra cualquier pedido por cliente, sabor, vendedor o fecha, lo suma y lo baja a Excel.', para: 'administrador', donde: 'panel', guia: 'buscar' },
      { texto: 'Atajos en el panel: «/» para buscar, «?» para verlos todos y «g» y una letra para cambiar de sección.', para: 'administrador', donde: 'panel', guia: 'buscar' },
      { texto: 'Los buscadores entienden el teléfono por dígitos, resaltan lo encontrado y recuerdan tus últimas búsquedas.' },
      { texto: 'Mensajes de WhatsApp a tu gusto para las visitas sin pedido y para cobrar; «Mandar a todos» va uno por uno.', guia: 'avisos-ruta' },
      { texto: 'Avisos de quien debe desde hace más de un mes, y «Más de un mes» en Por cobrar.', guia: 'cobranza', donde: 'panel' },
      { texto: 'Excel en Clientes, Vendedores y Por cobrar, con lo que deja tu búsqueda.', para: 'administrador', donde: 'panel', guia: 'libreta' },
      { texto: 'Clientes y Vendedores juntan lo que se usa poco en «Más».', para: 'administrador', donde: 'panel' },
    ],
  },
  {
    fecha: '2026-11-08', titulo: 'Producción y el Resumen',
    puntos: [
      { texto: 'Producción rediseñada: para mañana, 3 días o la semana, lo ya pedido contra lo estimado, cuánto te falta, la hoja para la cocina y qué tan atinado es el pronóstico.', para: 'administrador', guia: 'pronostico' },
      { texto: '«Qué hacer hoy» en el Resumen: urgentes, producción de mañana, cortes, fiado viejo y clientes sin vendedor.', para: 'administrador', donde: 'panel', guia: 'resumen' },
      { texto: 'Si tú también repartes, la app de reparto te muestra tus clientes como a un vendedor y pones tu propia meta.', para: 'administrador', guia: 'admin-reparte' },
      { texto: 'Reportes con tendencia, comparación con hace un año y la ficha de cada vendedor.', para: 'administrador', guia: 'reportes' },
      { texto: 'Tu año en números: en el Resumen en diciembre y enero, y en Finanzas → Cierre de mes para cualquier año, con su PDF.', para: 'administrador', guia: 'cierre-mes' },
    ],
  },
  {
    fecha: '2026-11-07', titulo: 'Metas, rachas y medallas',
    puntos: [
      { texto: 'Tu meta del mes en la ruta y en Cuenta, con tu lugar, tus rachas y medallas de 3, 6 y 12 meses.', para: 'vendedor', guia: 'mis-metas' },
      { texto: 'Meta para todos (la misma o según su mes pasado), ranking del mes, salón de la fama y felicitar por WhatsApp.', para: 'administrador', guia: 'metas-equipo' },
      { texto: 'Resumen por correo: el de cada día, el de la semana y el informe del mes al cerrarlo.', para: 'administrador', guia: 'avisos-panel' },
      { texto: 'Avisos de urgentes sin atender, metas atrasadas o cumplidas, y horario de silencio.', guia: 'notificaciones' },
    ],
  },
]
