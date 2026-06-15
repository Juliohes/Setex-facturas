// Purga periódica de actividad de usuarios `is_test=true`. Cada 60s borra
// uploads, ficheros físicos, audit_logs, refresh_tokens, known_cifs y
// password_reset_tokens de todos los usuarios sandbox. El usuario en sí
// permanece para que pueda seguir entrando.
//
// Reemplaza al script externo scripts/purge-test-uploads.sh: corre dentro
// del propio proceso Node, no requiere cron del sistema.
'use strict';

const fs = require('fs').promises;

function startTestCleanup({ pool, logger, intervalMs = 60_000 } = {}) {
  if (!pool) throw new Error('startTestCleanup: pool requerido');
  const log = logger || { info: console.log, warn: console.warn, error: console.error };

  async function tick() {
    try {
      // 1. Saber cuántos usuarios test hay (skip silencioso si 0).
      const tcount = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE is_test = true`);
      if (!tcount.rows[0]?.n) return;

      // 2. Lista de ficheros físicos antes del DELETE.
      const filesRes = await pool.query(`
        SELECT COALESCE(file_path, '/app/uploads/' || filename) AS path
          FROM uploads
         WHERE user_id IN (SELECT id FROM users WHERE is_test = true)
      `);

      // 3. DELETE en transacción atómica.
      const client = await pool.connect();
      let stats = { uploads: 0, audit: 0, rt: 0, kc: 0, prt: 0 };
      try {
        await client.query('BEGIN');
        const ru  = await client.query(`DELETE FROM uploads               WHERE user_id IN (SELECT id FROM users WHERE is_test = true)`);
        const ral = await client.query(`DELETE FROM audit_logs            WHERE user_id IN (SELECT id FROM users WHERE is_test = true)`);
        const rrt = await client.query(`DELETE FROM refresh_tokens        WHERE user_id IN (SELECT id FROM users WHERE is_test = true)`);
        const rkc = await client.query(`DELETE FROM known_cifs            WHERE user_id IN (SELECT id FROM users WHERE is_test = true)`);
        const rpt = await client.query(`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE is_test = true)`);
        await client.query('COMMIT');
        stats = { uploads: ru.rowCount, audit: ral.rowCount, rt: rrt.rowCount, kc: rkc.rowCount, prt: rpt.rowCount };
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        log.error(`[TestCleanup] DB error: ${e.message}`);
        return;
      } finally {
        client.release();
      }

      // 4. Borrar ficheros físicos del volumen.
      for (const row of filesRes.rows) {
        await fs.unlink(row.path).catch(() => {});
      }

      // 5. Limpiar carpetas vacías por email-prefix de usuarios test.
      const dirsRes = await pool.query(`
        SELECT '/app/uploads/' || split_part(email, '@', 1) AS dir
          FROM users WHERE is_test = true
      `);
      for (const r of dirsRes.rows) {
        try {
          const subs = await fs.readdir(r.dir).catch(() => null);
          if (!subs) continue;
          for (const sub of subs) {
            await fs.rmdir(`${r.dir}/${sub}`).catch(() => {});
          }
          await fs.rmdir(r.dir).catch(() => {});
        } catch { /* nop */ }
      }

      const total = stats.uploads + stats.audit + stats.rt + stats.kc + stats.prt;
      if (total > 0) {
        log.info(`[TestCleanup] purgada actividad sandbox: uploads=${stats.uploads} audit=${stats.audit} rt=${stats.rt} kc=${stats.kc} prt=${stats.prt} files=${filesRes.rowCount}`);
      }
    } catch (e) {
      log.error(`[TestCleanup] fatal: ${e.message}`);
    }
  }

  // Primera corrida 5s tras arrancar para que aparezca limpio enseguida.
  setTimeout(tick, 5_000);
  // Cron interno cada `intervalMs`.
  const handle = setInterval(tick, intervalMs);
  log.info(`[TestCleanup] iniciado: cada ${Math.round(intervalMs / 1000)}s`);
  return () => clearInterval(handle);
}

module.exports = { startTestCleanup };
