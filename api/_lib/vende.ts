// Quién reparte: los vendedores y también el administrador que vende él mismo (una empresa chica, o el único que hay).
// Un administrador cuenta como vendedor si tiene clientes asignados o pedidos a su nombre: entra a la app de reparto,
// se asigna clientes o vende, y ya sale en cortes, stock y el lugar del mes. `u` es el alias de `usuarios` en la consulta.
export const vende = (u = 'usuarios') =>
  `(${u}.rol = 'vendedor' OR EXISTS (SELECT 1 FROM clientes cv WHERE cv.id_vendedor = ${u}.id_usuario) OR EXISTS (SELECT 1 FROM pedidos pv WHERE pv.id_vendedor = ${u}.id_usuario))`
