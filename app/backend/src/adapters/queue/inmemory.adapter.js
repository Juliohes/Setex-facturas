// Adapter in-memory de QueuePort. Stub funcional pero no persistente. Hoy no
// se usa en runtime (el monolito procesa síncrono). Documentado para cuando
// haya procesamiento async con BullMQ u otro backend real.
'use strict';

const { assertQueuePort } = require('../../ports/queue.port');

function createInMemoryQueueAdapter({ logger } = {}) {
  const jobs = new Map();
  const workers = new Map();

  const adapter = {
    name: 'inmemory',
    async healthcheck() {
      return true;
    },
    async enqueue(jobName, data, opts = {}) {
      const id = `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const job = { id, name: jobName, data, attempts: 0, createdAt: new Date(), opts };
      jobs.set(id, job);
      const handler = workers.get(jobName);
      if (handler) {
        setImmediate(() => {
          handler(job).catch((err) => logger?.warn?.('inmemory queue handler failed', { message: err.message }));
        });
      }
      return id;
    },
    subscribe(jobName, handler) {
      workers.set(jobName, handler);
    },
    async close() {
      jobs.clear();
      workers.clear();
    },
  };

  return assertQueuePort(adapter);
}

module.exports = { createInMemoryQueueAdapter };
