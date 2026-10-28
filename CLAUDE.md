# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

PWA for a yogurt delivery driver (route map, deliveries, flavors, production forecast, reports) plus its backend API. Code, comments, UI text, identifiers and docs are all in **Spanish** — keep new code consistent with that (`clientes`, `pedidos`, `sabores`, `vendedor`, `administrador`…). Requirement IDs like `RF-037`, `M10` in comments/docs refer to the functional spec.

## Commands

Node ≥ 22. Env vars live in `.env` at the repo root (git-ignored); the API and `db/` scripts read it via `--env-file-if-exists=.env` (so `railway run npm run db:migrar` also works without a `.env`).

```bash
npm run dev            # Vite (5173, --host) + API (tsx watch, port 3000) together; Vite proxies /api → :3000
npm run dev:web        # front only
npm run dev:api        # API only (api/_lib/servidor.ts)
npm run build          # tsc --noEmit (front) + vite build → dist/
npm run preview        # serve dist/ — needed to test the service worker, offline mode and push
npm run typecheck:api  # tsc -p api (front tsconfig only includes src/)
npm run test:api       # node:test via tsx, all api/_test/*.test.ts
npm run db:migrar      # create/upgrade Postgres from db/ (-- --demo loads demo data, -- --reiniciar DROPS everything)
npm run db:admin       # create an admin user (-- correo "Nombre" [--empresa "Empresa"]; creates the company if new)
npm run db:probar      # read-only check: env vars, DB connection, SSL, schema/migrations state
npm run push:claves    # generate VAPID keys
```

Single test file: `npx tsx --test api/_test/stock.test.ts`. Filter by name: add `--test-name-pattern="reasigna"`.

API tests run against a **real PostgreSQL** (default `postgres://postgres:test@localhost:5432/reparto_yogurt_test`, override with `DATABASE_URL`). Create that DB with `db/01_esquema.sql`, `02_vistas.sql`, `03_datos_iniciales.sql` (no demo data) — see `.github/workflows/server.yml`. There are no front-end tests and no linter.

Demo accounts (with `04_datos_demo.sql` / `--demo`): `admin@yogurt.local`, `vendedor@yogurt.local`. They have no usable password: `npm run db:migrar -- --demo` sets a random temporary one and prints it (it must be changed on first login). The API will not start without `JWT_SECRET` and `AUTH_PEPPER_SECRET` (two different values, `openssl rand -hex 32`; see `.env.example`). The test helpers use their own password in `api/_test/ayuda.ts`.

## Architecture

### Two runtimes, one repo
- **Front** (`src/`): Vite + React 19 + TypeScript + Tailwind 4 (theme tokens in `src/index.css` `@theme`). No router library: `App.tsx` switches between the field-worker PWA (`views/pwa/`, `PwaLayout` with tabs) and the web admin panel (`views/admin/`) based on whether the path/hash starts with `/admin`. Both share the Danelle look (cream canvas, beige cards, Danelle green/yellow, Bricolage Grotesque headings): `App.tsx` wraps the panel in `.tema-admin` and the field-worker PWA in `.tema-admin .tema-campo` (always light). `views/admin/tema.css` redefines the colour variables and remaps `bg-tinta`, so screens written with the base palette in `src/index.css` pick it up untouched. One exception: the "Nuevo pedido" sheet (`EditorPedido`, class `diseno-original`) keeps the original black-and-white look inside the PWA only (`views/pwa/tema-campo.css`, which also recolours the map pins). Keep rules in that file inside Tailwind layers: an unlayered rule would beat `hover:`/`active:` utilities. Dark mode is `.tema-admin.oscuro` in the same file (preference per browser in `src/lib/tema.ts`, chosen in the panel's Configuración section): use the colour tokens (`bg-papel`, `text-tinta`, `--chip-*`…), never literal hex or `bg-white`, so new screens work in both.
- **API** (`api/`): Fastify 5 on PostgreSQL (`pg`, raw SQL, no ORM), zod validation, JWT + Argon2id. `api/_lib/app.ts` `construirApp({db, config, enviador?})` builds the app and registers every route module (`auth`, `sync/`, `usuarios`, `cartera`, `reportes`, `stock`, `notificaciones`, `admin`, `recuperacion`). Two entry points wrap it: `api/_lib/servidor.ts` (local dev) and `api/index.ts` (single Vercel serverless function; `vercel.json` rewrites `/api/*` to it). Folders prefixed with `_` are not exposed as Vercel endpoints. The app strips a leading `/api` so routes work both with and without the prefix. API imports use `.js` extensions (NodeNext).
- `api/_lib/config.ts` is the single source of env config (`DATABASE_URL` or `DB_*`; SSL is decided there — Railway's public `*.rlwy.net` host or `?sslmode=require` → encrypted without cert verification unless `DB_SSL_CA`; `sslmode` is stripped from the URL because pg would let it override the `ssl` option; `JWT_SECRET` ≥32 chars, `CORS_ORIGINS`, `VAPID_*`, `ZONA_HORARIA`, `RESEND_API_KEY`…). `db/migrar.ts` reuses it.

### Offline-first data flow (the core concept)
- The phone stores everything in IndexedDB via Dexie (`src/lib/db.ts`, schema versions declared with `db.version(n)`; add a new version when changing stores). Every local change is also appended to the `cola` table.
- `src/lib/sync.ts` pushes the *current state* of each touched record in dependency order (productos → clientes → pedidos → recordatorios) to `POST /sync/push`, then pulls `GET /sync/pull?desde=<cursor>`. Each operation carries its own UUID (idempotent replays) and the server `version` it was edited from.
- Conflict rules live server-side in `api/_lib/sync/aplicar.ts` (closed orders always win; closing beats editing; otherwise latest timestamp with clock-skew correction; delete-vs-edit is rejected). Losers are stored in `operaciones_sync` and shown to the user, never silently dropped. `sync/adaptadores.ts` maps between the phone's shape and DB rows; `sync/esquemas.ts` holds the zod schemas.
- Deletions propagate via the global `eliminaciones` table; portfolio reassignment instead uses `retiros_vendedor` (per-seller removal). Don't conflate the two.
- Sending the queue lives in `src/lib/envio.ts`, shared by the app (`sync.ts`) and the service worker: `src/sw/envio.ts` is bundled separately into `dist/sw-envio.js` (IIFE, `vite.config.ts` plugin) and `public/sw.js` loads it with `importScripts` to push the queue on Background Sync with the app closed (RF-052). It reads a copy of the session that `sesion.ts` mirrors into `db.meta` (`sesion-segundo-plano`); refresh tokens don't rotate, so the SW and the page can both refresh. Logouts without signal are queued (`revocar-pendientes`) and revoked when back online. Page and SW serialize sends with `navigator.locks`.
- `src/lib/api.ts`: `API_URL` = `VITE_API_URL` or `/api`; `MODO_SERVIDOR` is true unless `VITE_OFFLINE_SOLO=true`. Without the server, the app works purely local (seeded flavor catalog, no login).

### Roles and security invariants
- `administrador` vs `vendedor`. Sellers only see their own portfolio and **never receive costs/margins** — the server omits them; reports, stock capture and team management are admin-only routes.
- Every authenticated request re-checks `sesiones` + `usuarios.activo` in the DB (so logout/deactivation is immediate). `debe_cambiar_password` blocks everything except password change.
- Inside transactions the API sets `SET LOCAL app.id_usuario` for DB-trigger auditing, and `SET LOCAL app.permitir_correccion = 'on'` to edit a closed order. Admin-count changes are serialized with `pg_advisory_xact_lock`.

### Multi-company (tenancy)
- One shared DB; every business table has `id_empresa` (table `empresas`), composite FKs `*_misma_empresa`, and RLS policy `por_empresa` for role `reparto_app` (PostgreSQL 15+). `api/_lib/db.ts`: an AsyncLocalStorage scope per request (`conAlcance` in `app.ts`), `fijarEmpresa` when the session is validated, then `porEmpresa(pool)` and `tx()` run each query/transaction as `SET LOCAL ROLE reparto_app` + `app.id_empresa`. Code before the company is known (login, refresh, password recovery) runs as the DB owner and sees everything — filter explicitly there.
- `id_empresa` defaults to `current_setting('app.id_empresa')`, so INSERTs don't name it. Views are `security_invoker`; trigger functions take the company from the row. A suspended company (`empresas.activa = false`) gets 403 `EMPRESA_SUSPENDIDA` on login/refresh/every request.
- Tests: `ayuda.ts` connects as owner with `app.id_empresa` = first company; `crearEmpresa()` / `sesion(rol, disp, empresa)` for a second one (`multiempresa.test.ts`).

### Database (`db/`)
- PostgreSQL is authoritative: `01_esquema.sql` (types, tables, triggers that maintain `version`/`actualizado_en`, totals, audit), `02_vistas.sql` (report views, `fn_pronostico_produccion`). Schema changes for existing DBs go in `db/migraciones/NNN_*.sql` (must be re-runnable) **and** must be reflected in `01_esquema.sql`.
- `db/mysql/` is a parallel MySQL port not used by the API. `db.txt` and `esquema_original_drawsql.sql` are older/alternate schemas the API does not work with.
- Order line items freeze `precio_unitario`/`costo_unitario` at sale time; reports count only `entregado` orders by delivery date.

### Other front-end pieces
- `public/sw.js`: hand-written service worker. The `precache` plugin in `vite.config.ts` injects the built file list and a version into `dist/sw.js` at build time. It only registers in production builds.
- `src/lib/ruteo.ts`: route optimization through OSRM `/trip` (public demo server, `OSRM_URL`), falling back to nearest-neighbor offline. Map is `maplibre-gl` with OpenFreeMap tiles.
- Hand-rolled file generation without dependencies: PDFs in `src/lib/pdf.ts` (`Documento`; reports and the client book in `reportePdf.ts`, QR labels in `codigos.ts`), XLSX export in `api/_lib/exportar.ts`. `Documento.listo()` returns the PDF bytes plus each page drawn again as SVG; generated PDFs open in `components/VisorPdf.tsx` (`mostrarPdf(pdf, nombre)`, mounted once in `App.tsx`), a preview with download/print/share that works on phones too (browsers there do not show PDFs inside the page). New drawing primitives in `Documento` must emit both the PDF op and its SVG twin.
- Stock-low and unsynced-sales alerts are computed on the phone (`src/lib/alertas.ts`); server-generated notices (urgent order, route changes) are created in the same transaction as the change and delivered in `pull` and by Web Push (`api/_lib/push.ts`, best effort; tests inject a fake `enviador`).
- `ZONA_HORARIA` (default `America/Mexico_City`) defines "today" server-side and must match the delivery phones' timezone.

### Deployment
- Production target: app + API on Vercel, PostgreSQL on Railway — step by step in `docs/produccion-railway.md`.
- `vercel.json`: Vite static build + the `api/index.ts` function. `.github/workflows/pages.yml` also deploys `dist/` to GitHub Pages (with `VITE_API_URL` from the repo variable `API_URL`); `server.yml` runs typecheck + API tests on changes to `api/`, `db/` or package files.

Note: some READMEs still refer to an old `server/` folder; the API now lives in `api/`.
