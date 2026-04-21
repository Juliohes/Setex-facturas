// @ts-check
const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = process.env.SETEX_E2E_ADMIN_EMAIL || 'admin@staging.setex.local';
const ADMIN_PASSWORD = process.env.SETEX_E2E_ADMIN_PASSWORD || 'Staging2026!';

test.describe('Login', () => {
  test('flujo de captura: usuario sin login ve formulario / tras login accede al capturador', async ({ page }) => {
    await page.goto('/');

    // Sin sesión debe mostrar login (form con email + password)
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /entrar|iniciar sesión|login/i }).first().click();

    // Tras login debemos ver la UI de captura (no el form de login). Aceptamos
    // cualquiera de estos selectores típicos del flujo de captura:
    //   - botón de capturar con cámara
    //   - zona de subida (drop zone / file input)
    //   - cabecera de usuario logueado
    await expect.poll(async () => {
      const hasCaptureBtn = await page.locator('text=/capturar|subir|tomar foto/i').first().isVisible().catch(() => false);
      const hasFileInput = await page.locator('input[type="file"]').first().isVisible().catch(() => false);
      return hasCaptureBtn || hasFileInput;
    }, { timeout: 15_000, message: 'Tras login debe mostrarse la UI de captura' }).toBe(true);
  });

  test('login con credenciales inválidas muestra error', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="email"]').fill('usuario.invalido@ejemplo.com');
    await page.locator('input[type="password"]').fill('PasswordIncorrecta!');
    await page.getByRole('button', { name: /entrar|iniciar sesión|login/i }).first().click();

    // Debe aparecer algún mensaje de error; no debe entrar al capturador
    const errorLocator = page.locator('text=/credenciales|inválid|incorrect|error/i');
    await expect(errorLocator.first()).toBeVisible({ timeout: 10_000 });
  });
});
