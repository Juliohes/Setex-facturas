// @ts-check
const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = process.env.SETEX_E2E_ADMIN_EMAIL || 'admin@staging.setex.local';
const ADMIN_PASSWORD = process.env.SETEX_E2E_ADMIN_PASSWORD || 'Staging2026!';

test.describe('Panel admin', () => {
  test('admin: login y listado de facturas carga con Tabulator', async ({ page }) => {
    await page.goto('/admin-facturas.html');

    // El panel admin tiene su propio form de login (distinto del raíz)
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /entrar|login/i }).first().click();

    // Tabulator inicializa #facturas-table tras autenticación
    await expect(page.locator('#facturas-table')).toBeVisible({ timeout: 15_000 });

    // El contador de facturas debe aparecer (aunque sea "0 facturas")
    await expect(page.locator('#total-label')).toBeVisible();
    await expect(page.locator('#total-label')).toContainText(/factura/i, { timeout: 10_000 });
  });

  test('admin: tabs Facturas y Empresas son navegables', async ({ page }) => {
    // Login primero (reutilizamos flujo)
    await page.goto('/admin-facturas.html');
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /entrar|login/i }).first().click();
    await expect(page.locator('#facturas-table')).toBeVisible({ timeout: 15_000 });

    // Click en tab Empresas
    await page.locator('.nav-tab[data-tab="empresas"]').click();
    // La tabla empresas debe renderizarse
    await expect(page.locator('#tab-empresas')).toBeVisible();

    // Volver a Facturas
    await page.locator('.nav-tab[data-tab="facturas"]').click();
    await expect(page.locator('#tab-facturas')).toBeVisible();
    await expect(page.locator('#facturas-table')).toBeVisible();
  });

  test('admin: botón "🗑 Eliminar" en toolbar de facturas activa el modo eliminar', async ({ page }) => {
    await page.goto('/admin-facturas.html');
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /entrar|login/i }).first().click();
    await expect(page.locator('#facturas-table')).toBeVisible({ timeout: 15_000 });

    // Botón modo eliminar facturas
    const btn = page.locator('#btn-modo-eliminar-fac');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText(/Eliminar/i);

    await btn.click();
    // Tras click debe cambiar a Cancelar (modo activo)
    await expect(btn).toContainText(/Cancelar/i, { timeout: 5_000 });

    await btn.click();
    await expect(btn).toContainText(/Eliminar/i, { timeout: 5_000 });
  });
});
