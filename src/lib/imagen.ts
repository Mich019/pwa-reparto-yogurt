// Foto de perfil: se encuadra en un cuadrado (EncuadreFoto), se dibuja en 256 px y se guarda como data URL WEBP
// (unos 10 KB; JPG en navegadores que no generan WEBP), así viaja y se guarda chica aunque venga de la cámara.
const LADO = 256

export async function leerImagen(archivo: File): Promise<HTMLImageElement> {
  if (!archivo.type.startsWith('image/')) throw new Error('Elige una imagen (JPG, PNG o WEBP)')
  const img = new Image()
  img.src = URL.createObjectURL(archivo)
  try {
    await img.decode()
    return img
  } catch {
    URL.revokeObjectURL(img.src)
    throw new Error('No se pudo leer esa imagen; prueba con otra')
  }
}

// `x`, `y`, `lado`: el cuadrado elegido, en píxeles de la imagen original.
export function recortarFoto(img: HTMLImageElement, { x, y, lado }: { x: number; y: number; lado: number }): string {
  const lienzo = document.createElement('canvas')
  lienzo.width = LADO
  lienzo.height = LADO
  const ctx = lienzo.getContext('2d')!
  ctx.fillStyle = '#ffffff' // las PNG con transparencia quedan sobre blanco, no sobre negro
  ctx.fillRect(0, 0, LADO, LADO)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, x, y, lado, lado, 0, 0, LADO, LADO)
  const webp = lienzo.toDataURL('image/webp', 0.8)
  return webp.startsWith('data:image/webp') ? webp : lienzo.toDataURL('image/jpeg', 0.82)
}
