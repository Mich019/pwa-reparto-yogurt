-- Alta de empresas por cuenta propia (Fase 2): /registro crea la empresa con su primer administrador.
--  · empresas.giros y control_retornables: lo que contestó en el registro (el catálogo flexible llega después).
--  · verificaciones_correo: el código de 6 dígitos que confirma el correo antes de crear la cuenta. Todavía no hay
--    empresa, así que no es de ninguna: sólo la usa el dueño de la base (la API antes de saber la empresa).
--  · invitaciones: el enlace que reciben los repartidores para crear su contraseña. Sólo se guarda un HMAC del enlace.
-- Repetible:  npm run db:migrar   (o psql -d … -f 008_registro.sql)

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS giros text[] NOT NULL DEFAULT '{}';
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS control_retornables boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS verificaciones_correo (
  id_verificacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correo          varchar(150) NOT NULL,
  codigo_hash     text NOT NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  expira_en       timestamptz NOT NULL,
  usado_en        timestamptz,
  intentos        smallint NOT NULL DEFAULT 0,                 -- códigos incorrectos; a los 5 se invalida
  ip              inet
);
CREATE INDEX IF NOT EXISTS verificaciones_correo_abiertas ON verificaciones_correo (lower(correo), creado_en DESC);
CREATE INDEX IF NOT EXISTS verificaciones_correo_ip ON verificaciones_correo (ip, creado_en DESC);
REVOKE ALL ON verificaciones_correo FROM reparto_app;

CREATE TABLE IF NOT EXISTS invitaciones (
  id_invitacion uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_empresa    uuid NOT NULL DEFAULT nullif(current_setting('app.id_empresa', true), '')::uuid REFERENCES empresas (id_empresa) ON DELETE CASCADE,
  correo        varchar(150) NOT NULL,
  rol           rol_usuario NOT NULL DEFAULT 'vendedor',
  token_hash    text NOT NULL UNIQUE,
  id_invitador  uuid,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  expira_en     timestamptz NOT NULL,
  usado_en      timestamptz,
  CONSTRAINT invitaciones_invitador_misma_empresa FOREIGN KEY (id_empresa, id_invitador) REFERENCES usuarios (id_empresa, id_usuario) ON DELETE SET NULL (id_invitador)
);
CREATE INDEX IF NOT EXISTS invitaciones_empresa ON invitaciones (id_empresa);
GRANT SELECT, INSERT, UPDATE, DELETE ON invitaciones TO reparto_app;
ALTER TABLE invitaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS por_empresa ON invitaciones;
CREATE POLICY por_empresa ON invitaciones TO reparto_app
  USING (id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid)
  WITH CHECK (id_empresa = nullif(current_setting('app.id_empresa', true), '')::uuid);
