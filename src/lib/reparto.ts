// El administrador que entra a la app de reparto la usa como vendedor (api/_lib/vende.ts): ve su cartera y la que no
// tiene vendedor, nunca la de los demás, y lo que crea ahí queda a su nombre. PwaLayout lo fija al abrirse y lo quita
// al cerrarse, así el panel (que comparte la base del teléfono) sigue viendo todo. Sin dependencias: db.ts lo usa.
let quien: string | null = null // quien usa la app de reparto (con servidor)
let admin = false
export function fijarReparto(id: string | null, esAdmin = false) { quien = id; admin = !!id && esAdmin }

// El administrador en la app de reparto: a su nombre queda lo que crea.
export const repartidorAdmin = () => (admin ? quien : null)

// ¿Le toca a quien usa la app? Al vendedor, todo lo que tiene (el servidor sólo le manda lo suyo).
export const esMio = (vendedorId?: string | null) => !admin || !vendedorId || vendedorId === quien

// Vende y entrega corte: el vendedor o el administrador, mientras usan la app de reparto.
export const reparte = () => quien !== null
