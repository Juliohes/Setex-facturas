// Service que gestiona `config/security.json` de forma atómica: lee, valida,
// escribe con backup. Reemplaza la lógica inline de server.js sec helpers.
//
// Escribe con backup previo (ver backupSecurityConfig del monolito) para
// protegerse contra escrituras corruptas. Flock via writeFileSync semántica
// atómica en POSIX + el backup actúa como snapshot inmediato anterior.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = Object.freeze({
  time_restriction: { enabled: true, start_hour: 0, end_hour: 6, timezone: 'Europe/Madrid' },
  ip_whitelist: [],
  ip_blacklist: [],
  auto_block: { enabled: true, max_requests: 400, window_seconds: 300, block_duration_minutes: 60 },
  max_users: 350,
});

function makeIpListManagerService({ configPath = '/app/src/config/security.json', logger } = {}) {
  const backupPath = `${configPath}.bak`;
  let cache = null;
  let cacheTs = 0;
  const CACHE_TTL_MS = 30000;

  function load() {
    const now = Date.now();
    if (cache && now - cacheTs < CACHE_TTL_MS) return cache;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      cache = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      cacheTs = now;
      return cache;
    } catch (err) {
      logger?.warn?.('ip-list-manager: load falló — usando defaults', { message: err.message });
      cache = { ...DEFAULT_CONFIG };
      cacheTs = now;
      return cache;
    }
  }

  function save(next) {
    try {
      if (fs.existsSync(configPath)) {
        fs.copyFileSync(configPath, backupPath);
      }
    } catch (err) {
      logger?.warn?.('ip-list-manager: backup falló', { message: err.message });
    }
    const tmp = `${configPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, configPath);
    cache = { ...next };
    cacheTs = Date.now();
  }

  function addToList(listName, value) {
    if (!['ip_whitelist', 'ip_blacklist'].includes(listName)) {
      throw new Error(`ip-list-manager: listName inválido: ${listName}`);
    }
    const cfg = load();
    const list = new Set(cfg[listName] || []);
    list.add(String(value).trim());
    save({ ...cfg, [listName]: [...list] });
    return list.size;
  }

  function removeFromList(listName, value) {
    if (!['ip_whitelist', 'ip_blacklist'].includes(listName)) {
      throw new Error(`ip-list-manager: listName inválido: ${listName}`);
    }
    const cfg = load();
    const target = String(value).trim();
    const filtered = (cfg[listName] || []).filter((v) => v !== target);
    save({ ...cfg, [listName]: filtered });
    return filtered.length;
  }

  // Actualiza time_restriction respetando los campos no provistos. Devuelve la
  // nueva sub-config o lanza Error con código si la validación falla. Reglas:
  //   - start_hour y end_hour deben ser enteros en [0, 23].
  //   - start_hour !== end_hour (lockout permanente prevention).
  function updateTimeRestriction(patch = {}) {
    const cfg = load();
    const current = cfg.time_restriction || {};
    const next = { ...current };
    if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
    if (patch.start_hour !== undefined) next.start_hour = parseInt(patch.start_hour, 10);
    if (patch.end_hour !== undefined) next.end_hour = parseInt(patch.end_hour, 10);

    for (const key of ['start_hour', 'end_hour']) {
      const v = next[key];
      if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 23)) {
        const err = new Error(`${key} debe ser un entero entre 0 y 23 (recibido: ${v}).`);
        err.code = 'INVALID_RANGE';
        throw err;
      }
    }

    if (
      Number.isFinite(next.start_hour) &&
      Number.isFinite(next.end_hour) &&
      next.start_hour === next.end_hour
    ) {
      const err = new Error('start_hour y end_hour no pueden ser iguales (causaría bloqueo permanente del sitio).');
      err.code = 'INVALID_RANGE';
      throw err;
    }
    save({ ...cfg, time_restriction: next });
    return next;
  }

  return {
    load,
    save,
    addToList,
    removeFromList,
    updateTimeRestriction,
    DEFAULT_CONFIG,
    configPath: () => configPath,
  };
}

module.exports = { makeIpListManagerService };
