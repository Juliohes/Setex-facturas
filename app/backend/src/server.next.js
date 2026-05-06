/**
 * SETEX backend · entry point v3 (modular Awilix DI · Express)
 *
 * ⚠️ ESTADO: CONGELADO desde 2026-04-28 por bug LL-002 (NO en runtime)
 *
 * Cronología:
 * - 2026-04-28 09:36 UTC: este fichero se renombró a server.js y se
 *   desplegó a producción (FASE 1B Etapa 6, PR #90 + tag v2.0.0).
 * - 2026-04-28 09:37 UTC: panel admin se rompió por bug LL-002
 *   (contrato `/api/admin/facturas` devolvía {items, total} cuando
 *   el frontend esperaba {facturas, total}).
 * - 2026-04-28 09:35-09:57 UTC: rollback quirúrgico en filesystem.
 *   `mv server.js server.next.js` (este fichero) y restauración del
 *   monolito como server.js. Container reiniciado. Producción sana.
 * - 2026-04-28 09:57 UTC: commit revert `508d7ae` en rama
 *   `hotfix/revert-v3-swap-2026-04-28`. NO mergeado a main todavía
 *   (ver REGLA 11 del CLAUDE.md §4).
 *
 * Producción runtime: monolito 4308 líneas (server.js).
 * Este fichero (server.next.js): congelado, NO se ejecuta.
 *
 * Pre-requisitos para reactivar este fichero como server.js (ver
 * Bloque C del plan estratégico 2026-05-05 en `.claude/CLAUDE.md`):
 * 1. Análisis post-mortem de LL-002 documentado.
 * 2. Paridad CI con shape de respuesta JSON (no solo status code).
 * 3. Smoke HTTP post-deploy verificando body shape.
 * 4. Mergear `508d7ae` a main para sincronizar git con runtime.
 * 5. Re-validación staging 24-48h con la nueva infraestructura.
 *
 * NO ejecutar este fichero directamente. NO renombrar a server.js
 * sin completar los 5 pre-requisitos.
 */

'use strict';

const { createApp } = require('./app');
const { disposeContainer } = require('./bootstrap');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const SHUTDOWN_GRACE_MS = 10000;

(async () => {
  const { app, container } = await createApp({ withInfra: true });
  const logger = container.hasRegistration('logger') ? container.resolve('logger') : console;

  const server = app.listen(PORT, () => {
    logger.info?.('SETEX backend (v3) escuchando', { port: PORT, pid: process.pid });
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info?.('Shutdown signal recibido', { signal });
    const forceExit = setTimeout(() => {
      logger.warn?.('Shutdown timeout excedido — forzando exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceExit.unref();

    server.close(async () => {
      await disposeContainer(container, { logger }).catch(() => {});
      logger.info?.('Shutdown limpio completado');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error?.('unhandledRejection', { reason: reason?.message || String(reason) });
  });
})().catch((err) => {
  console.error('Startup failed:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
