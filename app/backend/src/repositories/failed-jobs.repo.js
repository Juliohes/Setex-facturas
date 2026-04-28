// Failed jobs repository — registros de procesamientos OCR/confirmación que
// fallaron. Se alimenta desde el catch de endpoint confirm y desde handlers async.
// El panel admin expone reintento manual (marca retried_at).
'use strict';

class FailedJobsRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ uploadId = null, userId = null, filename = null, errorMessage, attempts = 1, jobData = null }) {
    const r = await this.pool.query(
      `INSERT INTO failed_jobs (upload_id, user_id, filename, error_message, attempts, job_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, failed_at`,
      [uploadId, userId, filename, errorMessage, attempts, jobData ? JSON.stringify(jobData) : null]
    );
    return r.rows[0];
  }

  async findById(id) {
    const r = await this.pool.query(
      `SELECT id, upload_id, user_id, filename, error_message, attempts, job_data,
              failed_at, retried_at
       FROM failed_jobs
       WHERE id = $1`,
      [id]
    );
    return r.rows[0] || null;
  }

  async incrementAttempts(id) {
    const r = await this.pool.query(
      `UPDATE failed_jobs SET attempts = attempts + 1
       WHERE id = $1 RETURNING attempts`,
      [id]
    );
    return r.rows[0]?.attempts ?? null;
  }

  async markRetried(id) {
    await this.pool.query(
      `UPDATE failed_jobs SET retried_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async listPending({ limit = 50, userId = null } = {}) {
    const params = [limit];
    let whereUser = '';
    if (userId) {
      params.push(userId);
      whereUser = ` AND user_id = $2`;
    }
    const r = await this.pool.query(
      `SELECT id, upload_id, user_id, filename, error_message, attempts, failed_at, retried_at
       FROM failed_jobs
       WHERE retried_at IS NULL${whereUser}
       ORDER BY failed_at DESC
       LIMIT $1`,
      params
    );
    return r.rows;
  }

  async deleteOlderThan(daysAgo) {
    const r = await this.pool.query(
      `DELETE FROM failed_jobs WHERE failed_at < NOW() - ($1 || ' days')::interval`,
      [String(daysAgo)]
    );
    return r.rowCount;
  }
}

module.exports = FailedJobsRepository;
