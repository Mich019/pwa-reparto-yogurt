-- Ajustes de la plataforma (Configuración → Servicio en /plataforma): lo que quienes administran Delisy cambian sin
-- volver a desplegar. Una sola fila.
--  · registro_abierto: si las empresas nuevas pueden registrarse solas en /registro.
--  · prueba_dias: días de prueba gratis de cada empresa nueva; null = PRUEBA_DIAS del entorno.
--  · correo_soporte: a dónde escribir; sale en la pantalla de cobro y con el registro cerrado.
--  · anuncio / anuncio_tipo: un aviso para todas las empresas (panel y app de reparto), p. ej. un mantenimiento.
-- Las empresas sólo la leen (GET /plataforma/publico); la API la cambia como dueño de la base.
-- Repetible:  npm run db:migrar   (o psql -d … -f 014_ajustes_plataforma.sql)

CREATE TABLE IF NOT EXISTS plataforma_ajustes (
  id               boolean PRIMARY KEY DEFAULT true CHECK (id),
  registro_abierto boolean NOT NULL DEFAULT true,
  prueba_dias      integer CHECK (prueba_dias BETWEEN 0 AND 365),
  correo_soporte   varchar(150),
  anuncio          varchar(280),
  anuncio_tipo     varchar(10) NOT NULL DEFAULT 'info' CHECK (anuncio_tipo IN ('info', 'aviso')),
  actualizado_en   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO plataforma_ajustes DEFAULT VALUES ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reparto_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON plataforma_ajustes FROM reparto_app;
  END IF;
END $$;
