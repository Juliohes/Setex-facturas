// src/pipeline/replay.js
// Gap 2 del plan de cierre sobre el pipeline v2 existente (2026-07-28):
// el modo sombra (Fase 10) solo procesa facturas NUEVAS desde que se activó
// — no existía ningún mecanismo para verificar v2 contra facturas YA
// CONFIRMADAS. Este módulo reprocesa una factura histórica con el pipeline
// v2 completo y persiste el resultado con modo='replay', SIN TOCAR la fila
// de `uploads` (v1) en ningún momento — solo lectura respecto a v1.
'use strict';

const fs = require('fs').promises;
// Acceso por propiedad (no desestructuración): permite mockear
// orchestrator.ejecutarPipelineV2Sombra en tests con mock.method() —
// desestructurar capturaría una referencia que el mock no puede interceptar.
const orchestrator = require('./orchestrator');

/**
 * Reprocesa UNA factura ya confirmada con el pipeline v2 completo.
 * Cualquier excepción se captura aquí y se devuelve como {ok:false, error}
 * — nunca propaga, para que un fallo en una factura no tumbe el lote
 * completo del comando de replay (eval/replay.js).
 *
 * @param {object} upload - fila de `uploads` (id, file_path, mimetype, invoice_type, ...)
 * @param {object} opts - {pool, logger, cfg}
 * @returns {Promise<{ok:true, registro:object} | {ok:false, error:string}>}
 */
async function replayFactura(upload, { pool, logger, cfg }) {
  try {
    await fs.access(upload.file_path); // falla pronto y con claridad si el fichero ya no existe en disco

    const registro = await orchestrator.ejecutarPipelineV2Sombra({
      uploadId: upload.id,
      filePath: upload.file_path,
      mimeType: upload.mimetype,
      context: { invoice_type: upload.invoice_type, empresa_nif: upload.empresa_nif || null },
      cfg,
      logger,
    });

    if (!registro) {
      return { ok: false, error: 'El pipeline v2 no produjo resultado (documento inválido o sin candidatos)' };
    }

    await pool.query(
      `INSERT INTO extracciones_v2
         (upload_id, campos_canonicos, confianzas, disputas, score_global, estado, version_pipeline, coste_estimado_usd, latencia_ms, modo)
       VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,'replay')`,
      [registro.upload_id, JSON.stringify(registro.campos_canonicos), JSON.stringify(registro.confianzas),
        JSON.stringify(registro.disputas), registro.score_global, registro.estado, registro.version_pipeline,
        registro.coste_estimado_usd, registro.latencia_ms]
    );

    return { ok: true, registro };
  } catch (err) {
    logger.error('[Replay] Error reprocesando factura', { upload_id: upload.id, error: err.message });
    return { ok: false, error: err.message };
  }
}

module.exports = { replayFactura };
