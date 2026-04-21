// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Infraestructura', () => {
  test('endpoint /health responde 200 o 401 (servidor alive)', async ({ request }) => {
    const res = await request.get('/health');
    // Prod: 200 público. Staging: 401 (auth required). Ambos son "servidor alive".
    expect([200, 401]).toContain(res.status());
  });

  test('POST /api/auth/login vacío rechaza con 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: {},
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => ({}));
    expect(String(body.error || '').toLowerCase()).toMatch(/credencial|inválid|incorrect/);
  });

  test('HTTPS con headers de seguridad presentes (HSTS, CSP, X-Frame)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    const headers = response.headers();
    // HSTS obligatorio tras cutover
    expect(headers['strict-transport-security'] || '').toMatch(/max-age=/);
    // CSP presente (aunque el contenido exacto puede variar entre envs)
    expect(headers['content-security-policy'] || '').toBeTruthy();
    // X-Frame-Options o frame-ancestors en CSP
    const frameOk =
      (headers['x-frame-options'] || '').toUpperCase() === 'DENY' ||
      (headers['content-security-policy'] || '').includes("frame-ancestors 'none'");
    expect(frameOk).toBe(true);
  });
});
