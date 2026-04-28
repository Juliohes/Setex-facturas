// POST /api/admin/retry-failed/:id — marca un job de la tabla failed_jobs como
// revisado (retried_at = NOW()). Endpoint admin, sin reintento async real (el
// procesamiento Drive/Sheets fue eliminado; la tabla solo conserva historial).
//
// 400: id no entero positivo.
// 404: job no encontrado o ya marcado.
// 200: { success: true, message: 'Job <id> marcado como revisado' }.
'use strict';

function makeAdminRetryFailedController({ failedJobsRepo, auditService, logger } = {}) {
  if (!failedJobsRepo?.findById || !failedJobsRepo?.markRetried) {
    throw new Error('admin retry-failed.controller: "failedJobsRepo" required');
  }

  return async function adminRetryFailedController(req, res) {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    try {
      const job = await failedJobsRepo.findById(id);
      if (!job || job.retried_at !== null) {
        return res.status(404).json({ error: 'Job no encontrado o ya marcado' });
      }
      await failedJobsRepo.markRetried(id);
      await auditService?.log?.({
        action: 'RETRY_FAILED_JOB',
        details: { failed_job_id: id, upload_id: job.upload_id },
        userId: req.user.userId,
        ip: req.ip,
      });
      logger?.info?.(`[Admin] Failed job ${id} marcado como revisado por ${req.user.email}`);
      return res.json({ success: true, message: `Job ${id} marcado como revisado` });
    } catch (err) {
      logger?.error?.('Retry failed job error:', err.message || err);
      return res.status(500).json({ error: 'Error al marcar el job' });
    }
  };
}

module.exports = { makeAdminRetryFailedController };
