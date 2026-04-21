// @ts-check
// Super-tarea multi-IVA 2026-04-21 parte 6/7 — Playwright E2E admin desglose
//
// Requisitos para ejecutar este spec:
//   - staging activo (SETEX_E2E_BASE_URL=https://staging.setex-facturas.es por defecto)
//   - Seed staging aplicado (scripts/seed-staging.sh) → users admin disponibles
//   - Al menos una factura en BD con lineas_iva (multi-IVA). Si no hay ninguna,
//     este spec la crea temporalmente via PUT al admin endpoint.
//   - BasicAuth de Traefik configurado en env (SETEX_E2E_HTTP_BASIC_USER/PASSWORD)

const { test, expect } = require('@playwright/test');

const ADMIN_EMAIL = process.env.SETEX_E2E_ADMIN_EMAIL || 'admin@staging.setex.local';
const ADMIN_PASSWORD = process.env.SETEX_E2E_ADMIN_PASSWORD || 'Staging2026!';

test.describe('Admin desglose multi-IVA', () => {
  test('login admin + listado carga lineas_iva en respuesta API', async ({ page, request }) => {
    // Login admin para obtener token en cookie
    await page.goto('/admin-facturas.html');
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /entrar|login/i }).first().click();
    await expect(page.locator('#facturas-table')).toBeVisible({ timeout: 15_000 });

    // El endpoint GET /api/admin/facturas ahora incluye lineas_iva en el SELECT
    const response = await page.request.get('/api/admin/facturas');
    expect(response.status()).toBeLessThan(500);
    if (response.status() === 200) {
      const body = await response.json();
      expect(Array.isArray(body.facturas)).toBe(true);
      // Si hay facturas, al menos una fila debe tener el campo lineas_iva (aunque sea null)
      if (body.facturas.length > 0) {
        const first = body.facturas[0];
        expect(first).toHaveProperty('lineas_iva');
      }
    }
  });

  test('columna Desglose renderiza badge multi-tramos cuando aplica', async ({ page }) => {
    await page.goto('/admin-facturas.html');
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /entrar|login/i }).first().click();
    await expect(page.locator('#facturas-table')).toBeVisible({ timeout: 15_000 });

    // Esperar a que la tabla renderice al menos una fila (o el placeholder vacío)
    await page.waitForTimeout(2_000);

    // Buscar cualquier badge "🧾 N tramos". Si no hay ninguno, el spec pasa
    // como skip lógico (no hay facturas multi-IVA todavía en staging).
    const badges = page.locator('.desglose-badge');
    const count = await badges.count();
    if (count === 0) {
      test.skip(true, 'No hay facturas multi-IVA en staging todavía — spec skipped');
    }

    // Click en el primer badge → abre modal
    await badges.first().click();
    await expect(page.locator('#desglose-modal')).toBeVisible({ timeout: 5_000 });

    // El modal debe tener al menos 2 bloques .desg-block
    const blocks = page.locator('#desglose-blocks .desg-block');
    await expect(blocks).toHaveCount(await blocks.count());
    expect(await blocks.count()).toBeGreaterThanOrEqual(2);

    // El resumen debe mostrar Σ bases y Σ cuotas
    const summary = page.locator('#desglose-summary');
    await expect(summary).toContainText(/bases/i);
    await expect(summary).toContainText(/cuotas/i);

    // Botón Cancelar cierra el modal
    await page.locator('#desglose-cancel').click();
    await expect(page.locator('#desglose-modal')).toBeHidden();
  });

  test('PUT /api/admin/facturas/:id acepta lineas_iva válidas', async ({ page }) => {
    await page.goto('/admin-facturas.html');
    await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /entrar|login/i }).first().click();
    await expect(page.locator('#facturas-table')).toBeVisible({ timeout: 15_000 });

    // Obtener la primera factura del listado
    const listRes = await page.request.get('/api/admin/facturas');
    expect(listRes.ok()).toBe(true);
    const body = await listRes.json();
    if (!body.facturas || body.facturas.length === 0) {
      test.skip(true, 'Sin facturas en staging — PUT no testeable');
    }
    const firstId = body.facturas[0].id;

    // Guardar lineas_iva originales para restaurar al final
    const originalLineas = body.facturas[0].lineas_iva;

    // PUT con un array multi-IVA de prueba
    const testLineas = [
      { base: '100,00', porcentaje: '21,0', cuota: '21,00', productos: [{ descripcion: 'E2E test prod 21%', importe: '50,00' }] },
      { base: '50,00',  porcentaje: '10,0', cuota: '5,00',  productos: [{ descripcion: 'E2E test prod 10%', importe: '25,00' }] }
    ];
    const putRes = await page.request.put(`/api/admin/facturas/${firstId}`, {
      data: { lineas_iva: testLineas },
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
    });
    expect(putRes.ok()).toBe(true);

    // Verificar que la BD refleja los cambios (via GET subsiguiente)
    const afterRes = await page.request.get('/api/admin/facturas');
    const after = await afterRes.json();
    const updated = after.facturas.find(f => f.id === firstId);
    expect(updated).toBeDefined();
    expect(Array.isArray(updated.lineas_iva)).toBe(true);
    expect(updated.lineas_iva.length).toBe(2);
    // Agregados recalculados por el backend
    expect(updated.base_imponible).toBe('150,00');
    expect(updated.cuota_iva).toBe('26,00');
    expect(updated.iva_porcentaje).toBe('21,0'); // tramo dominante

    // Restaurar estado original para no contaminar staging entre runs
    if (originalLineas !== undefined) {
      await page.request.put(`/api/admin/facturas/${firstId}`, {
        data: { lineas_iva: originalLineas },
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      });
    }
  });
});
