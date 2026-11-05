import type { ReactNode } from 'react'
import { DIAS_BAJA, RESPONSABLE, VERSION_LEGAL } from '../../lib/legal'
import { usePlataformaPublica } from '../../lib/plataforma'

// Aviso de privacidad integral (LFPDPPP, publicada el 20 de marzo de 2025) y términos del servicio. Son datos de Delisy
// como plataforma; cada empresa responde por los datos de sus propios clientes (ver «Encargo» en los términos).
// Si se cambia algo de fondo, sube VERSION_LEGAL (src/lib/legal.ts y api/_lib/privacidad.ts).

const fecha = new Date(`${VERSION_LEGAL}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })

// Lo que falta llenar en RESPONSABLE se ve resaltado: el aviso no cumple sin el nombre y el domicilio del responsable.
const Falta = ({ children }: { children: ReactNode }) => <mark className="rounded bg-ambar/30 px-1 text-tinta">{children}</mark>

function useContacto() {
  const p = usePlataformaPublica()
  return RESPONSABLE.correo || p?.correoSoporte || ''
}
function Correo() {
  const correo = useContacto()
  return correo ? <a href={`mailto:${correo}`} className="font-semibold text-azul underline underline-offset-2">{correo}</a> : <Falta>correo de privacidad por definir</Falta>
}
const Nombre = () => <>{RESPONSABLE.razonSocial || <Falta>nombre o razón social del responsable</Falta>}</>
const Domicilio = () => <>{RESPONSABLE.domicilio || <Falta>domicilio del responsable</Falta>}</>

const H = ({ children }: { children: ReactNode }) => <h2 className="mt-9 text-xl font-semibold first:mt-0">{children}</h2>
const P = ({ children }: { children: ReactNode }) => <p className="mt-3 leading-relaxed">{children}</p>
const L = ({ children }: { children: ReactNode }) => <ul className="mt-3 list-disc space-y-1.5 pl-6 leading-relaxed">{children}</ul>

export const ACTUALIZADO = fecha

export function AvisoPrivacidad() {
  return (
    <div>
      <H>1. Quién es responsable de tus datos</H>
      <P>
        <Nombre /> («{RESPONSABLE.nombre}», «nosotros»), con domicilio en <Domicilio />, es responsable de los datos personales de
        las cuentas de {RESPONSABLE.nombre} (administradores, vendedores y repartidores) y de quienes registran una empresa. Para
        cualquier tema de privacidad escríbenos a <Correo />.
      </P>
      <P>
        Los datos de los <strong>clientes de cada negocio</strong> (nombres, teléfonos, direcciones, ubicación en el mapa, pedidos y
        adeudos) los decide y captura la empresa que usa {RESPONSABLE.nombre}: ella es su responsable y nosotros sólo los tratamos por
        su encargo, para darle el servicio. Si eres cliente de un negocio, ejerce tus derechos con ese negocio; nosotros lo
        apoyamos para atender tu solicitud.
      </P>

      <H>2. Qué datos tratamos</H>
      <L>
        <li><strong>Identificación y contacto:</strong> nombre, correo, teléfono y foto de perfil (opcional).</li>
        <li><strong>De tu trabajo en el negocio:</strong> empresa, rol, cartera de clientes asignada, ventas, cobros y cortes que registras, y la meta y comisión que fije tu administrador.</li>
        <li><strong>De seguridad:</strong> contraseña (sólo guardamos una huella irreversible hecha con Argon2id: nadie puede leerla), verificación en dos pasos, sesiones abiertas, dirección IP, dispositivo e intentos de entrada.</li>
        <li><strong>De tu empresa y su cobro:</strong> nombre, logo, colores, giro y el estado de su suscripción. Los datos de tarjeta los recibe y guarda Mercado Pago; nosotros nunca los vemos.</li>
        <li><strong>Técnicos:</strong> errores de la aplicación (sin el contenido de lo que capturas) para corregir fallas.</li>
      </L>
      <P>No pedimos datos personales sensibles (salud, origen, religión, preferencias, datos biométricos ni financieros de tarjeta).</P>

      <H>3. Para qué los usamos</H>
      <P>Finalidades necesarias para darte el servicio:</P>
      <L>
        <li>Crear y administrar tu cuenta, dejarte entrar y proteger el acceso.</li>
        <li>Que tu negocio registre pedidos, rutas, entregas, cobranza, inventario y reportes, también sin conexión.</li>
        <li>Mandarte avisos del servicio (códigos, invitaciones, cambios de ruta, fin de la prueba, avisos importantes).</li>
        <li>Cobrar la suscripción de la empresa y llevar su estado.</li>
        <li>Atender soporte, prevenir fraudes y abusos, corregir errores y cumplir obligaciones legales.</li>
      </L>
      <P>
        No usamos tus datos para publicidad, no los vendemos y no hacemos perfiles para mercadotecnia. Si algún día quisiéramos usarlos
        para algo distinto, te pediríamos permiso antes y podrías negarte sin perder el servicio.
      </P>

      <H>4. Con quién los compartimos</H>
      <P>Para funcionar nos apoyamos en estos proveedores, que tratan los datos sólo por nuestra cuenta y con medidas de seguridad:</P>
      <L>
        <li><strong>Vercel</strong> (aplicación y servidor) y el proveedor de la base de datos (<strong>Supabase</strong> o <strong>Railway</strong>), con servidores que pueden estar fuera de México, principalmente en Estados Unidos.</li>
        <li><strong>Resend</strong>, para enviar correos.</li>
        <li><strong>Mercado Pago</strong>, para cobrar la suscripción.</li>
        <li><strong>Sentry</strong>, para registrar errores de la aplicación.</li>
        <li><strong>OpenFreeMap</strong> (mapas) y <strong>OSRM</strong> (cálculo de rutas), que reciben coordenadas de los puntos de entrega sin nombres ni teléfonos.</li>
      </L>
      <P>
        Sólo entregaríamos datos a una autoridad que los pida legalmente. Estas comunicaciones a proveedores y autoridades no requieren
        tu consentimiento según la ley; no hacemos otras transferencias.
      </P>

      <H>5. Tus derechos ARCO y cómo ejercerlos</H>
      <P>
        Tienes derecho a <strong>Acceder</strong> a tus datos, <strong>Rectificarlos</strong> si están mal, <strong>Cancelarlos</strong> (que
        los borremos) y <strong>Oponerte</strong> a un uso, así como a revocar tu consentimiento. Casi todo lo puedes hacer tú mismo:
      </P>
      <L>
        <li><strong>Acceso:</strong> en Configuración → Privacidad y datos (o Cuenta → Privacidad y datos en la app) descarga tus datos en un archivo.</li>
        <li><strong>Rectificación:</strong> cambia tu nombre, teléfono y foto en tu perfil; el correo lo cambia el administrador de tu negocio.</li>
        <li><strong>Cancelación:</strong> «Eliminar mi cuenta» en el mismo apartado. Se borran tu nombre, correo, teléfono, foto, sesiones y accesos al instante.</li>
        <li><strong>Oposición:</strong> apaga los avisos en tu teléfono desde Cuenta; para lo demás, escríbenos.</li>
      </L>
      <P>
        También puedes enviar tu solicitud a <Correo /> con tu nombre, el correo de tu cuenta, una identificación (o la de quien te
        represente, con su poder), qué derecho quieres ejercer y sobre qué datos. Te respondemos en un máximo de <strong>20 días
        hábiles</strong> y, si procede, lo hacemos efectivo dentro de los <strong>15 días hábiles</strong> siguientes. Es gratis.
      </P>

      <H>6. Cuánto tiempo los guardamos</H>
      <L>
        <li>Mientras tengas tu cuenta. Al eliminarla, tus datos personales se borran y la cuenta queda como «Cuenta eliminada».</li>
        <li>
          Las ventas, cobros y cortes que registraste no se borran: son de tu negocio, que debe conservar su contabilidad (el Código
          Fiscal de la Federación pide 5 años), pero ya sin tus datos.
        </li>
        <li>
          Cuando una empresa se da de baja, sus datos se guardan {DIAS_BAJA} días por si se arrepiente y después se borran por completo.
          Las copias de seguridad del proveedor de la base de datos se reemplazan en su ciclo normal.
        </li>
      </L>

      <H>7. Cookies y almacenamiento en tu equipo</H>
      <P>
        Sólo usamos lo necesario para que funcione: una cookie de sesión del panel, tus preferencias (tema, tamaño de letra) y los datos
        que la app guarda en el teléfono para trabajar sin señal. No usamos cookies de publicidad ni de rastreo de terceros.
      </P>

      <H>8. Seguridad</H>
      <P>
        Conexiones cifradas, contraseñas con Argon2id, verificación en dos pasos opcional, límites de intentos, cada empresa separada de
        las demás en la base de datos y revisión de cada sesión en cada petición. Si ocurriera una vulneración que te afecte de forma
        importante, te avisaremos sin demora para que puedas protegerte.
      </P>

      <H>9. Menores de edad</H>
      <P>{RESPONSABLE.nombre} es una herramienta de trabajo para mayores de 18 años. No recabamos datos de menores a sabiendas.</P>

      <H>10. Cambios a este aviso</H>
      <P>
        Si lo cambiamos, te lo mostraremos al entrar y te pediremos aceptarlo. La versión vigente siempre está en esta página.
      </P>

      <H>11. Autoridad</H>
      <P>
        Si consideras que no atendimos tus derechos, puedes acudir a la autoridad de protección de datos personales (la Secretaría
        Anticorrupción y Buen Gobierno, según la ley de 2025).
      </P>
    </div>
  )
}

export function Terminos() {
  return (
    <div>
      <H>1. Qué es {RESPONSABLE.nombre}</H>
      <P>
        {RESPONSABLE.nombre} es un servicio en internet para negocios de reparto: app para vendedores y repartidores, panel de
        administración, rutas, pedidos, cobranza, inventario y reportes. Lo presta <Nombre />, con domicilio en <Domicilio /> y
        contacto en <Correo />. Al crear una empresa o aceptar una invitación aceptas estos términos y el aviso de privacidad.
      </P>

      <H>2. Cuentas</H>
      <L>
        <li>Quien registra la empresa es su administrador y puede invitar a su equipo. Cada cuenta es personal; no compartas tu contraseña.</li>
        <li>El administrador responde por quién tiene acceso y con qué rol, y por dar de baja a quien ya no trabaja con el negocio.</li>
        <li>Debes ser mayor de 18 años y dar datos verdaderos.</li>
      </L>

      <H>3. Prueba gratis y suscripción</H>
      <L>
        <li>Cada empresa nueva tiene unos días de prueba sin tarjeta. Al terminar, para seguir usándolo se contrata la suscripción mensual con el precio que se muestra antes de pagar.</li>
        <li>El cobro lo hace Mercado Pago cada mes, de forma automática, hasta que la canceles.</li>
        <li><strong>Puedes cancelar cuando quieras</strong> desde Configuración → Suscripción, por el mismo medio en que contrataste y sin llamar a nadie. No hay plazos forzosos ni penalizaciones; ya no se hacen más cobros.</li>
        <li>Sin suscripción vigente el panel queda en pausa, pero no se borra nada: puedes descargar tus datos o volver a suscribirte.</li>
        <li>Si necesitas factura, pídela a <Correo /> con tus datos fiscales dentro del mes del cobro.</li>
      </L>

      <H>4. Tus datos y los de tus clientes</H>
      <P>
        Lo que tu negocio captura (clientes, pedidos, precios, cobranza) es de tu negocio. Puedes descargarlo completo cuando quieras
        desde Configuración → Privacidad y datos.
      </P>
      <P>
        Respecto de los datos personales de tus clientes, tu empresa es la <strong>responsable</strong> y {RESPONSABLE.nombre} es su
        <strong> encargado</strong>. Por eso tu empresa se compromete a darles a conocer su propio aviso de privacidad, a capturar sólo
        lo necesario para venderles y entregarles, y a atender sus solicitudes de acceso, rectificación, cancelación u oposición (puedes
        corregir o borrar a un cliente desde la app). {RESPONSABLE.nombre}, como encargado: trata esos datos sólo para darte el servicio
        y según tus instrucciones; no los usa para nada más ni los vende; los protege y guarda confidencialidad; sólo se apoya en los
        proveedores listados en el aviso de privacidad; te avisa si hubiera una vulneración que los afecte; y al terminar el servicio los
        borra, como se dice abajo.
      </P>

      <H>5. Uso aceptable</H>
      <P>
        No uses {RESPONSABLE.nombre} para actividades ilegales, para guardar datos que no tengas derecho a tratar, para mandar mensajes no
        deseados ni para intentar entrar a cuentas o empresas ajenas o afectar el servicio. Podemos suspender una empresa que lo haga, avisándole.
      </P>

      <H>6. Disponibilidad</H>
      <P>
        Trabajamos para que el servicio esté siempre disponible y la app guarda lo que haces sin señal para enviarlo después, pero puede
        haber interrupciones por mantenimiento o fallas de proveedores. Te recomendamos descargar tus reportes y datos con regularidad.
      </P>

      <H>7. Baja de la empresa y borrado</H>
      <P>
        El administrador puede dar de baja la empresa desde Configuración → Privacidad y datos. Al hacerlo se cancela la suscripción,
        nadie del equipo puede entrar y, pasados {DIAS_BAJA} días, borramos todos sus datos para siempre. Dentro de ese plazo puedes
        arrepentirte escribiendo a <Correo />. Cualquier cuenta puede eliminarse a sí misma en cualquier momento.
      </P>

      <H>8. Responsabilidad</H>
      <P>
        {RESPONSABLE.nombre} es una herramienta: las ventas, precios, cobros, entregas y la contabilidad y facturación de tu negocio son
        responsabilidad de tu negocio. En lo que la ley permita, nuestra responsabilidad por daños se limita a lo que tu empresa nos haya
        pagado en los últimos tres meses. Esto no limita tus derechos como consumidor.
      </P>

      <H>9. Cambios a los términos</H>
      <P>Si los cambiamos, te lo avisaremos en la app antes de que apliquen y te pediremos aceptarlos. Si no estás de acuerdo, puedes cancelar.</P>

      <H>10. Ley y quejas</H>
      <P>
        Estos términos se rigen por las leyes federales de México. Para cualquier duda o queja escríbenos primero a <Correo />. Como
        consumidor también puedes acudir a la Procuraduría Federal del Consumidor (Profeco). Para lo que no se resuelva así, los
        tribunales competentes del domicilio del responsable.
      </P>
    </div>
  )
}
