// Contrato del puerto de colas. Hoy usamos una in-memory queue para jobs ligeros
// (adapters/queue/inmemory.adapter.js). Futuro: BullMQ con Redis-backed si escalamos.
'use strict';

/**
 * @typedef {Object} QueueJob
 * @property {string} id
 * @property {string} name
 * @property {Object} data
 * @property {number} attempts                   Número de intentos hasta ahora
 * @property {Date} createdAt
 */

/**
 * @typedef {Object} QueueEnqueueOptions
 * @property {number} [delayMs]                  Retraso inicial
 * @property {number} [maxAttempts]              Reintentos totales permitidos
 */

/**
 * @typedef {Object} QueuePort
 * @property {string} name
 * @property {() => Promise<boolean>} healthcheck
 * @property {(jobName: string, data: Object, opts?: QueueEnqueueOptions) => Promise<string>} enqueue
 *    Devuelve el jobId
 * @property {(jobName: string, handler: (job: QueueJob) => Promise<void>) => void} subscribe
 *    Registra un worker para jobs con ese nombre
 * @property {() => Promise<void>} close          Para graceful shutdown
 */

function assertQueuePort(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('QueuePort: candidate must be an object');
  }
  const required = ['name', 'healthcheck', 'enqueue', 'subscribe', 'close'];
  for (const field of required) {
    if (candidate[field] === undefined) {
      throw new Error(`QueuePort: missing "${field}"`);
    }
  }
  return candidate;
}

module.exports = { assertQueuePort };
