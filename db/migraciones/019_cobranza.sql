-- Fiado (2/2): abonos de los clientes y su índice de lo vendido a crédito.
-- Repetible:  npm run db:migrar   (o psql -d … -f 019_cobranza.sql)

-- Fiado: lo que un cliente abona a su cuenta (los pedidos entregados «a crédito» suman a lo que debe; los abonos lo bajan).
-- No se borran: un abono mal capturado se anula con motivo y deja de contar.
CREATE TABLE IF NOT EXISTS abonos (
  id_abono         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE RESTRICT,
  id_cliente       uuid NOT NULL REFERENCES clientes (id_cliente) ON DELETE RESTRICT,
  id_vendedor      uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,   -- quién lo cobró
  fecha            date NOT NULL,
  monto            numeric(10, 2) NOT NULL,
  metodo           varchar(15) NOT NULL,
  nota             varchar(200),
  anulado_en       timestamptz,
  anulado_por      uuid REFERENCES usuarios (id_usuario) ON DELETE SET NULL,
  motivo_anulacion varchar(200),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abonos_monto_positivo CHECK (monto > 0),
  CONSTRAINT abonos_metodo_valido CHECK (metodo IN ('efectivo', 'transferencia')),
  CONSTRAINT abonos_cliente_misma_empresa FOREIGN KEY (id_empresa, id_cliente) REFERENCES clientes (id_empresa, id_cliente),
  CONSTRAINT abonos_vendedor_misma_empresa FOREIGN KEY (id_empresa, id_vendedor) REFERENCES usuarios (id_empresa, id_usuario)
);
CREATE INDEX IF NOT EXISTS abonos_cliente ON abonos (id_cliente, fecha DESC);
CREATE INDEX IF NOT EXISTS abonos_fecha ON abonos (id_empresa, fecha);
CREATE INDEX IF NOT EXISTS pedidos_credito ON pedidos (id_cliente) WHERE metodo_pago = 'credito';

-- Reglas por empresa de las tablas nuevas (como las demás: ver «Multiempresa»).
DO $$
DECLARE
  t text;
  regla constant text := $r$id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid$r$;
BEGIN
  FOREACH t IN ARRAY ARRAY['abonos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS por_empresa ON %I', t);
    EXECUTE format('CREATE POLICY por_empresa ON %I TO reparto_app USING (%s) WITH CHECK (%s)', t, regla, regla);
  END LOOP;
END $$;
