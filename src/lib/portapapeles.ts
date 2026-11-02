// Copiar algo delicado (contraseña temporal, códigos de respaldo, clave de dos pasos, enlace de invitación): se borra
// del portapapeles al minuto, para que no quede ahí horas y se pegue donde no debe. No se borra si mientras tanto se
// copió otra cosa en la app; fuera de ella no se puede saber, pero sin la página enfocada el navegador no deja
// escribir en el portapapeles y lo de otra app no se toca.
const BORRAR_EN = 60_000
let vez = 0
for (const evento of ['copy', 'cut']) document.addEventListener(evento, () => { vez++ })

export async function copiarDelicado(texto: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('Sin portapapeles')
  await navigator.clipboard.writeText(texto)
  const mia = ++vez
  setTimeout(() => { if (vez === mia) navigator.clipboard.writeText('').catch(() => {}) }, BORRAR_EN)
}
