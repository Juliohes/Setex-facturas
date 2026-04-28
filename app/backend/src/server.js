// SETEX backend · entry point v3 (modular Awilix DI · Express).
//
// Activo en runtime desde 2026-04-28 (FASE 1B Etapa 6 — swap completo del
// refactor v3). Las 4 etapas previas (0-4) blindaron el swap:
//   0) rollback estable de develop (PR #85)
//   1) 5 rutas auth_request portadas (PR #86)
//   2) test paridad legacy↔v3 + integración CI (PR #87)
//   3) healthcheck container endurecido a /api/internal/check-access (PR #87)
//   4) smoke HTTP post-deploy en deploy-staging.yml + deploy-prod.yml (PR #87)
//
// Flujo: bootstrap DI (Awilix) → createApp (Express modular) → listen PORT →
//        SIGTERM/SIGINT graceful shutdown con dispose container.
//
// El monolito legacy de 4308 líneas queda como src/server.legacy.js para
// rollback rápido (npm run start:legacy). Se eliminará en Q3 tras 30 días de
// v3 estable en producción (ROADMAP Q3).
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
