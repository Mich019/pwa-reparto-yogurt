// Genera las claves VAPID para las notificaciones push (RF-054):  npm run push:claves
// Pon las tres variables en el servidor (Vercel: Settings → Environment Variables). La privada es secreta;
// si la cambias, los teléfonos tendrán que volver a activar los avisos.
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log('VAPID_SUBJECT=mailto:tu@correo.com   # cámbialo por un correo tuyo')
