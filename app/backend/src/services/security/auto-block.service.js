// Service que gestiona los bloqueos automáticos en Redis (sec:block:*, sec:count:*).
// Expuesto para admin endpoints: list blocked, unblock IP.
'use strict';

function makeAutoBlockService({ cache, logger } = {}) {
  if (!cache?.keys || !cache?.get || !cache?.del) {
    throw new Error('auto-block.service: "cache" port required');
  }

  async function listBlocked() {
    const keys = await cache.keys('sec:block:*');
    const items = [];
    for (const key of keys) {
      const ip = key.replace(/^sec:block:/, '');
      const blockedAt = await cache.get(key);
      items.push({ ip, blocked_at: blockedAt, key });
    }
    return items;
  }

  async function unblock(ip) {
    if (!ip) return 0;
    const deleted = await cache.del(`sec:block:${ip}`);
    await cache.del(`sec:count:${ip}`);
    logger?.info?.('auto-block: unblocked', { ip, deleted });
    return deleted;
  }

  async function countBlocked() {
    const keys = await cache.keys('sec:block:*');
    return keys.length;
  }

  return { listBlocked, unblock, countBlocked };
}

module.exports = { makeAutoBlockService };
