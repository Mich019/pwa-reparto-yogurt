// "Hoy" según la zona horaria del negocio, no la del servidor (en Vercel siempre es UTC: a las 7 de la noche en
// México ya sería «mañana»). Mismo formato que la app: YYYY-MM-DD.
export function hoyEn(zona: string, ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
}
