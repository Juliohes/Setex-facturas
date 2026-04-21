// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * SETEX Captura de Facturas — E2E tests
 *
 * Target por defecto: staging.setex-facturas.es (seed users presentes)
 * Override con SETEX_E2E_BASE_URL si se quiere correr contra prod o local.
 *
 * Credenciales de test: seed staging → Staging2026! (ver scripts/seed-staging.js)
 */

const BASE_URL = process.env.SETEX_E2E_BASE_URL || 'https://staging.setex-facturas.es';

// BasicAuth de Traefik en staging (middleware setex-stg-auth). Prod no lo usa.
// Si SETEX_E2E_HTTP_BASIC_USER está definida, Playwright la enviará en toda
// request. Si no, se omite (compatible con prod).
const httpBasicUser = process.env.SETEX_E2E_HTTP_BASIC_USER;
const httpBasicPass = process.env.SETEX_E2E_HTTP_BASIC_PASSWORD;

module.exports = defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Staging puede tener certificado válido o self-signed según config; aceptamos
    // self-signed en staging para no depender de la cadena de Traefik + LE.
    ignoreHTTPSErrors: true,
    // Timeout de navegación y acciones
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // BasicAuth (solo si envs están definidas)
    ...(httpBasicUser ? { httpCredentials: { username: httpBasicUser, password: httpBasicPass || '' } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
