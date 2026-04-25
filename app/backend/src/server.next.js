// SETEX backend · entry point v3.
//
// Arranca: bootstrap DI (Awilix) → createApp (Express con stack modular) →
//          listen PORT → SIGTERM/SIGINT graceful shutdown con dispose container.
//
// Historia: reemplaza al monolito src/server.js legacy de 4308 líneas tras el
//           refactor modular v3 (PRs #63-#82, 2026-04-22). El fichero anterior
//           se conserva como src/server.legacy.js durante un tiempo por rollback
//           rápido; Round futuro lo eliminará cuando estemos cómodos.
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
