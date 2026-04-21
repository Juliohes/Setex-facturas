# SETEX · Tests E2E (Playwright)

Suite de tests end-to-end sobre la aplicación desplegada. Target por defecto: `staging.setex-facturas.es` (seed users idempotentes via `scripts/seed-staging.sh`).

## Requisitos

- Node.js 20+
- Conexión al entorno objetivo (staging accesible desde la máquina donde se corren)

## Uso

```bash
cd tests/e2e
npm install
npm run install:browsers   # descarga chromium una vez
npm test                   # corre las 3 specs
```

### Variables de entorno (opcional)

Copia `.env.example` a `.env` y rellena si necesitas overrides:

| Variable | Default | Uso |
|---|---|---|
| `SETEX_E2E_BASE_URL` | `https://staging.setex-facturas.es` | URL contra la que correr |
| `SETEX_E2E_ADMIN_EMAIL` | `admin@staging.setex.local` | User seed admin staging |
| `SETEX_E2E_ADMIN_PASSWORD` | `Staging2026!` | Password seed |
| `SETEX_E2E_USER_EMAIL` | `empresa1@staging.setex.local` | User no-admin seed |
| `SETEX_E2E_USER_PASSWORD` | `Staging2026!` | Password seed |

### Modos

```bash
npm run test:headed   # navegador visible
npm run test:ui       # UI interactiva de Playwright
npm run test:report   # ver último reporte HTML
```

## Specs incluidos (v1)

- `01-login.spec.js` — flujo de login exitoso + credenciales inválidas
- `02-admin-panel.spec.js` — panel admin carga, tabs navegables, toggle modo eliminar
- `03-health.spec.js` — endpoints `/health`, `/api/auth/login`, headers de seguridad

## Pendiente (Fase 1 MACROPLAN P1.1)

- `04-invoice-upload.spec.js` — upload de factura real + validación modal OCR (requiere factura muestra en `fixtures/`, no commiteada)
- Integración CI en `.github/workflows/` (job opcional que corra contra staging tras merge a develop)
