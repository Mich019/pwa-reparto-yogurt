-- Para bases creadas antes de la API (db/01_esquema.sql ya lo incluye en instalaciones nuevas).
-- Uso:  psql -U postgres -d reparto_yogurt -f migraciones/001_indice_sync.sql
CREATE INDEX IF NOT EXISTS sync_registro ON operaciones_sync (tabla, id_registro, recibido_en DESC);
