-- Avisos de la plataforma (apartado «Avisos» en /plataforma): en lugar de un solo anuncio en plataforma_ajustes, varios
-- avisos, cada uno con su vigencia y a quién va; más el aviso automático de la prueba por vencer.
--  · avisos_plataforma: texto, tipo (info | aviso), para (todos | administradores | vendedores) y desde/hasta (null = sin
--    límite por ese lado). Sólo sale a quien tiene la sesión abierta y mientras está vigente.
--  · plataforma_ajustes.aviso_prueba_dias: cuántos días antes de que termine la prueba gratis se avisa (0 = nunca);
--    aviso_prueba_vendedores: si también les sale a los vendedores (a los administradores, siempre).
-- El anuncio único de la migración 014 pasa a ser un aviso y sus columnas se quitan.
-- Repetible:  npm run db:migrar   (o psql -d … -f 015_avisos_plataforma.sql)

CREATE TABLE IF NOT EXISTS avisos_plataforma (
  id_aviso       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  texto          varchar(280) NOT NULL CHECK (btrim(texto) <> ''),
  tipo           varchar(10) NOT NULL DEFAULT 'info' CHECK (tipo IN ('info', 'aviso')),
  para           varchar(20) NOT NULL DEFAULT 'todos' CHECK (para IN ('todos', 'administradores', 'vendedores')),
  desde          timestamptz,
  hasta          timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avisos_plataforma_vigencia CHECK (hasta IS NULL OR desde IS NULL OR hasta > desde)
);

ALTER TABLE plataforma_ajustes
  ADD COLUMN IF NOT EXISTS aviso_prueba_dias integer NOT NULL DEFAULT 7 CHECK (aviso_prueba_dias BETWEEN 0 AND 60),
  ADD COLUMN IF NOT EXISTS aviso_prueba_vendedores boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plataforma_ajustes' AND column_name = 'anuncio') THEN
    INSERT INTO avisos_plataforma (texto, tipo) SELECT anuncio, anuncio_tipo FROM plataforma_ajustes WHERE btrim(coalesce(anuncio, '')) <> '';
    ALTER TABLE plataforma_ajustes DROP COLUMN anuncio, DROP COLUMN anuncio_tipo;
  END IF;
  -- Las empresas no la tocan: la leen y la cambian las rutas de la plataforma, como dueño de la base.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reparto_app') THEN
    REVOKE ALL ON avisos_plataforma FROM reparto_app;
  END IF;
END $$;
