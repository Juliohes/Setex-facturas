// Service de orquestación OCR con patrón Strategy.
//
// Recibe N engines (OcrPort) por inyección y aplica una estrategia de arbitraje:
//   - 'fallback'   — primario; si falla o confidence baja, probar siguiente
//   - 'consensus'  — lanza todos en paralelo; si NIF+fecha+total coinciden → dual_confirmed
//   - 'weighted'   — lanza todos en paralelo; agrega por confidence-weighted average
//
// La estrategia activa se configura en features.json (ocr_arbitrage_strategy).
// Default 'consensus' si hay 2+ engines, 'fallback' si hay 1.
'use strict';

const DEFAULT_TIMEOUT_MS = 45000;

function makeOcrOrchestrationService({ engines, features, logger } = {}) {
  if (!Array.isArray(engines)) throw new Error('ocr-orchestration: "engines" array required');

  const strategyName = features?.ocr_arbitrage_strategy
    || (engines.length >= 2 ? 'consensus' : 'fallback');

  async function extract(input) {
    if (engines.length === 0) {
      throw new Error('ocr-orchestration: no hay engines activos');
    }
    const activeEngines = await filterHealthy(engines, logger);
    if (activeEngines.length === 0) {
      throw new Error('ocr-orchestration: ningún engine responde healthcheck');
    }

    const runner = STRATEGIES[strategyName] || STRATEGIES.fallback;
    return runner(activeEngines, input, logger);
  }

  return { extract, strategyName };
}

async function filterHealthy(engines, logger) {
  const checks = await Promise.all(
    engines.map(async (e) => ({ engine: e, ok: await safeHealthcheck(e, logger) }))
  );
  return checks.filter((c) => c.ok).map((c) => c.engine);
}

async function safeHealthcheck(engine, logger) {
  try {
    const ok = await Promise.race([
      engine.healthcheck(),
      new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    return !!ok;
  } catch (err) {
    logger?.warn?.('ocr engine healthcheck failed', { name: engine.name, message: err.message });
    return false;
  }
}

async function runFallback(engines, input, logger) {
  const errors = [];
  for (const engine of engines) {
    try {
      const result = await withTimeout(engine.extract(input), DEFAULT_TIMEOUT_MS, engine.name);
      if (result && result.confidence >= 0.5) {
        return { primary: result, all: [result], strategy: 'fallback' };
      }
      logger?.info?.('fallback: confidence baja, probando siguiente', {
        engine: engine.name,
        confidence: result?.confidence,
      });
    } catch (err) {
      errors.push({ engine: engine.name, message: err.message });
      logger?.warn?.('fallback engine failed', { engine: engine.name, message: err.message });
    }
  }
  const e = new Error('ocr-orchestration fallback: todos los engines fallaron');
  e.details = errors;
  throw e;
}

async function runConsensus(engines, input, logger) {
  const settled = await Promise.allSettled(
    engines.map((e) => withTimeout(e.extract(input), DEFAULT_TIMEOUT_MS, e.name))
  );
  const ok = settled
    .filter((s) => s.status === 'fulfilled')
    .map((s) => s.value);
  if (ok.length === 0) {
    const errors = settled.filter((s) => s.status === 'rejected').map((s) => s.reason?.message);
    const e = new Error('ocr-orchestration consensus: todos los engines fallaron');
    e.details = errors;
    throw e;
  }
  const primary = ok[0];
  const dual_confirmed = ok.length >= 2 && coincide(ok[0], ok[1]);
  logger?.info?.('consensus result', {
    engines: ok.map((r) => r.engine),
    dual_confirmed,
  });
  return { primary, all: ok, dual_confirmed, strategy: 'consensus' };
}

async function runWeighted(engines, input, logger) {
  const settled = await Promise.allSettled(
    engines.map((e) => withTimeout(e.extract(input), DEFAULT_TIMEOUT_MS, e.name))
  );
  const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  if (ok.length === 0) {
    throw new Error('ocr-orchestration weighted: ningún engine devolvió resultado');
  }
  const primary = ok.reduce((a, b) => (a.confidence >= b.confidence ? a : b));
  logger?.info?.('weighted result', {
    primary: primary.engine,
    confidence: primary.confidence,
  });
  return { primary, all: ok, strategy: 'weighted' };
}

function coincide(a, b) {
  return (
    !!a && !!b &&
    a.emisor_nif && a.emisor_nif === b.emisor_nif &&
    a.fecha === b.fecha &&
    Math.abs((a.total ?? 0) - (b.total ?? 0)) < 0.02
  );
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`ocr ${label} timeout ${ms}ms`)), ms)
    ),
  ]);
}

const STRATEGIES = {
  fallback: runFallback,
  consensus: runConsensus,
  weighted: runWeighted,
};

module.exports = { makeOcrOrchestrationService, STRATEGIES };
