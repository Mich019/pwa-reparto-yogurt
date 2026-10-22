-- Verificación en dos pasos (TOTP, RFC 6238), sobre todo para administradores. Tabla aparte de usuarios: la bitácora
-- automática de usuarios copia la fila entera y guardaría el secreto, además de un renglón por cada código usado.
-- El secreto va cifrado con una clave derivada de AUTH_PEPPER_SECRET, que vive sólo en el servidor (api/_lib/dosPasos.ts).
-- Repetible. Para bases creadas antes de este cambio:  psql -d reparto_yogurt -f 006_dos_pasos.sql
CREATE TABLE IF NOT EXISTS dos_pasos (
  id_usuario   uuid PRIMARY KEY REFERENCES usuarios (id_usuario) ON DELETE CASCADE,
  secreto      text NOT NULL,                 -- cifrado con AES-256-GCM
  activado_en  timestamptz,                   -- null = se está configurando: todavía no se pide al entrar
  ultimo_paso  bigint NOT NULL DEFAULT 0,     -- ventana de 30 s del último código aceptado: no se acepta dos veces
  respaldo     text[] NOT NULL DEFAULT '{}',  -- HMAC de los códigos de respaldo que quedan sin usar
  creado_en    timestamptz NOT NULL DEFAULT now()
);
