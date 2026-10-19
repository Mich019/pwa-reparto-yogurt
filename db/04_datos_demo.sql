-- =============================================================================
-- Reparto Yogurt · Datos de prueba (SÓLO para desarrollo local)
-- 1 administrador, 1 vendedor, 10 clientes en CDMX, 4 semanas de historial,
-- la ruta de hoy y algunos pedidos de la próxima semana.
--
-- Usuarios (contraseña de ambos: Yogurt2026!, se pide cambiarla al entrar):
--   admin@yogurt.local     · administrador
--   vendedor@yogurt.local  · vendedor
-- Uso:  psql -U postgres -d reparto_yogurt -f 04_datos_demo.sql
-- =============================================================================

SET client_encoding = 'UTF8';

BEGIN;
SET LOCAL app.permitir_correccion = 'on';   -- permite cargar pedidos ya entregados con su detalle

DO $$
DECLARE
  hash      constant text := '$argon2id$v=19$m=65536,t=3,p=4$/3EZaDHF9wCysjRqDJQRWw$BgW3m7v++fxocFm83ZZH6ilwYSk5c+MsCQuEwnGYUKg';
  v_admin   uuid;
  v_vend    uuid;
  c         record;
  dia       date;
  ultima    date;
  ped       uuid;
  prods     uuid[];
  i         int := 0;
  nombres   text[] := ARRAY['Doña Lupita', 'Tienda La Esquina', 'Sra. Martha Ruiz', 'Café El Portal', 'Familia Hernández',
                            'Don Chuy', 'Abarrotes Sofi', 'Sra. Carmen López', 'Gimnasio Fuerza', 'Fonda Mary'];
  calles    text[] := ARRAY['Av. Juárez', 'Calle Morelos', 'Hidalgo', 'Av. Reforma', 'Allende', 'Zaragoza', 'Independencia', 'Guerrero'];
  colonias  text[] := ARRAY['Centro', 'Roma Norte', 'Condesa', 'Juárez'];
BEGIN
  PERFORM setseed(0.42);

  INSERT INTO usuarios (nombre, correo, password_hash, rol, debe_cambiar_password)
  VALUES ('Administrador', 'admin@yogurt.local', hash, 'administrador', true)
  RETURNING id_usuario INTO v_admin;
  INSERT INTO usuarios (nombre, correo, telefono, password_hash, rol, debe_cambiar_password)
  VALUES ('Vendedor Demo', 'vendedor@yogurt.local', '5512345678', hash, 'vendedor', true)
  RETURNING id_usuario INTO v_vend;

  SELECT array_agg(id_producto ORDER BY sabor) INTO prods FROM productos WHERE disponible;

  FOR k IN 1..10 LOOP
    INSERT INTO clientes (id_vendedor, nombre, direccion, colonia, telefono, latitud, longitud,
                          frecuencia_tipo, dias_semana, cada_dias, ventana_horario)
    VALUES (v_vend, nombres[k],
            calles[1 + floor(random() * 8)::int] || ' ' || (100 + floor(random() * 900)::int),
            colonias[1 + (k % 4)],
            '55' || (10000000 + floor(random() * 89999999)::bigint),
            19.4326 + (random() - 0.5) * 0.04,
            -99.1332 + (random() - 0.5) * 0.04,
            CASE WHEN k % 3 = 0 THEN 'intervalo' ELSE 'dias_semana' END::tipo_frecuencia,
            CASE k % 3 WHEN 0 THEN '{}' WHEN 1 THEN '{2,5}' ELSE '{3,6}' END::smallint[],
            CASE WHEN k % 3 = 0 THEN 7 END,
            CASE WHEN k % 2 = 0 THEN 'tarde' ELSE 'manana' END::ventana_horario);
  END LOOP;

  FOR c IN SELECT * FROM clientes ORDER BY nombre LOOP
    i := i + 1;
    -- Historial de las últimas 4 semanas según su frecuencia
    ultima := current_date - 28;
    FOR dia IN SELECT generate_series(current_date - 27, current_date - 1, interval '1 day')::date LOOP
      IF (c.frecuencia_tipo = 'dias_semana' AND extract(dow FROM dia)::smallint = ANY (c.dias_semana))
         OR (c.frecuencia_tipo = 'intervalo' AND (dia - ultima) % c.cada_dias = 0) THEN
        INSERT INTO pedidos (id_cliente, id_vendedor, fecha, estado, metodo_pago, fecha_entregado_real, creado_por)
        VALUES (c.id_cliente, v_vend, dia, 'entregado',
                CASE WHEN random() < 0.7 THEN 'efectivo' ELSE 'transferencia' END::metodo_pago,
                dia + time '10:00' + (random() * interval '7 hours'), v_vend)
        RETURNING id_pedido INTO ped;
        INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad)
        SELECT ped, prods[1 + (i + s) % array_length(prods, 1)], 1 + floor(random() * 3)
          FROM generate_series(0, (i % 2)) AS s;
        ultima := dia;
      END IF;
    END LOOP;

    -- Ruta de hoy: 7 clientes
    IF i <= 7 THEN
      INSERT INTO pedidos (id_cliente, id_vendedor, fecha, creado_por)
      VALUES (c.id_cliente, v_vend, current_date, v_vend) RETURNING id_pedido INTO ped;
      INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad)
      SELECT ped, prods[1 + (i + s) % array_length(prods, 1)], 1 + floor(random() * 3)
        FROM generate_series(0, 1) AS s;
    END IF;

    -- Pedidos ya agendados para la próxima semana: 4 clientes
    IF i % 3 = 1 THEN
      INSERT INTO pedidos (id_cliente, id_vendedor, fecha, creado_por)
      VALUES (c.id_cliente, v_vend, current_date + 1 + (i % 5), v_vend) RETURNING id_pedido INTO ped;
      INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad)
      VALUES (ped, prods[1 + i % array_length(prods, 1)], 2);
    END IF;
  END LOOP;

  -- Un recordatorio pendiente
  INSERT INTO recordatorios (id_cliente, id_vendedor, nota)
  SELECT id_cliente, v_vend, 'Confirmar sabores para la próxima vuelta' FROM clientes ORDER BY nombre DESC LIMIT 1;

  -- Stock asignado hoy
  INSERT INTO stock_diario (id_producto, id_vendedor, cantidad_asignada)
  SELECT unnest(prods), v_vend, 10;
END $$;

COMMIT;
