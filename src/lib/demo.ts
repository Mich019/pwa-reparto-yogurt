import { asegurarCatalogo, db, guardarVarios, totalDe, uid, type Cliente, type Pedido } from './db'
import { MODO_SERVIDOR } from './api'
import { hoy, sumarDias, tocaVisita } from './fechas'
import type { Punto } from './ruteo'

const NOMBRES = [
  'Doña Lupita', 'Tienda La Esquina', 'Sra. Martha Ruiz', 'Café El Portal', 'Familia Hernández',
  'Don Chuy', 'Abarrotes Sofi', 'Sra. Carmen López', 'Gimnasio Fuerza', 'Fonda Mary',
]
const CALLES = ['Av. Juárez', 'Calle Morelos', 'Hidalgo', 'Av. Reforma', 'Allende', 'Zaragoza', 'Independencia', 'Guerrero']

// Carga clientes y pedidos de ejemplo alrededor de `centro` para probar la app.
export async function cargarDemo(centro: Punto) {
  if (!MODO_SERVIDOR) await asegurarCatalogo()
  const productos = (await db.productos.toArray()).filter((p) => p.disponible)
  const rnd = (n: number) => Math.floor(Math.random() * n)
  const ahora = Date.now()
  const clientes: Cliente[] = NOMBRES.map((nombre, i) => ({
    id: uid(),
    nombre,
    direccion: `${CALLES[rnd(CALLES.length)]} ${100 + rnd(900)}`,
    telefono: `55${String(10000000 + rnd(89999999))}`,
    latitud: centro[1] + (Math.random() - 0.5) * 0.04,
    longitud: centro[0] + (Math.random() - 0.5) * 0.04,
    frecuencia: i % 3 === 0 ? { tipo: 'intervalo', cada: 7 } : { tipo: 'semana', dias: [[1, 4], [2, 5], [3, 6]][i % 3] },
    ventana: i % 2 ? 'TARDE' : 'MAÑANA',
    qr_uuid: uid(),
    activo: true,
    creado: ahora,
    actualizado: ahora,
  }))

  const pedidos: Pedido[] = []
  const hoyIso = hoy()
  for (const c of clientes) {
    const favoritos = [productos[rnd(productos.length)], productos[rnd(productos.length)]]
    const items = () =>
      [...new Set(favoritos)].map((p) => ({ productoId: p.id, litros: 1 + rnd(3), precio_litro: p.precio_litro }))
    // Historial: últimas 4 semanas
    let ultima: string | undefined = c.frecuencia.tipo === 'intervalo' ? sumarDias(hoyIso, -28) : undefined
    for (let d = sumarDias(hoyIso, -27); d < hoyIso; d = sumarDias(d, 1)) {
      if (!tocaVisita(c.frecuencia, d, ultima)) continue
      ultima = d
      const it = items()
      pedidos.push({
        id: uid(), clienteId: c.id, fecha: d, estado: 'ENTREGADO', items: it, total: totalDe(it),
        metodo_pago: Math.random() > 0.3 ? 'EFECTIVO' : 'TRANSFERENCIA', creado: ahora, actualizado: ahora,
      })
    }
  }
  // Ruta de hoy: 7 clientes con pedido pendiente
  clientes.slice(0, 7).forEach((c) => {
    const it = [productos[rnd(productos.length)], productos[rnd(productos.length)]]
      .filter((p, i, a) => a.indexOf(p) === i)
      .map((p) => ({ productoId: p.id, litros: 1 + rnd(3), precio_litro: p.precio_litro }))
    pedidos.push({ id: uid(), clienteId: c.id, fecha: hoyIso, estado: 'PENDIENTE', items: it, total: totalDe(it), creado: ahora, actualizado: ahora })
  })

  await guardarVarios('clientes', clientes)
  await guardarVarios('pedidos', pedidos)
}

// Sólo sin servidor. Con servidor el borrado se sincronizaría y quitaría del servidor los clientes y pedidos de toda la empresa.
export async function borrarTodo() {
  if (MODO_SERVIDOR) return
  await Promise.all([db.clientes.clear(), db.pedidos.clear(), db.recordatorios.clear(), db.cola.clear()])
}
