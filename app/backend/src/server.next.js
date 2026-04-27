// SETEX backend · entry point v3 — CONGELADO desde 2026-04-22 (post-rollback Round 16).
//
// NO arranca por defecto. El runtime activo es src/server.js (monolito legacy de
// 4308 líneas) tras el incidente del 2026-04-22: el v3 no portaba las rutas
// /api/internal/check-access ni /api/internal/check-admin-page que nginx usa como
// auth_request, lo que tiraba 404 en toda la app post-swap.
//
// Este fichero se mantiene en paralelo para permitir descongelar el v3 con:
//   1) portar los 5 endpoints faltantes (check-access, check-admin-page,
//      refresh-session, retry-failed/:id, security/time),
//   2) test de paridad de superficie API legacy ↔ v3,
//   3) endurecer healthcheck del container contra /api/internal/check-access,
//   4) smoke-test post-deploy login + preview + confirm.
//
// Stack v3: bootstrap DI (Awilix) → createApp (Express modular) → listen PORT →
//           SIGTERM/SIGINT graceful shutdown con dispose container.
// Para arrancarlo manualmente (debugging): npm run start:next
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
