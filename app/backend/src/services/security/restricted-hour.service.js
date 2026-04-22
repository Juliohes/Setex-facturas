// Service puro (sin deps runtime) con la lógica de horario restringido.
// Se importa desde middleware/security-ip y desde admin controllers para
// testear con TZ y configs arbitrarias.
'use strict';

function isRestrictedHour(cfg, { now = new Date() } = {}) {
  const r = cfg?.time_restriction;
  if (!r?.enabled) return false;
  const { start_hour = 0, end_hour = 6, timezone = 'Europe/Madrid' } = r;
  if (start_hour === end_hour) return false;
  let h;
  try {
    h = parseInt(
      new Intl.DateTimeFormat('es-ES', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now),
      10
    );
  } catch {
    h = now.getUTCHours();
  }
  return start_hour < end_hour ? h >= start_hour && h < end_hour : h >= start_hour || h < end_hour;
}

module.exports = { isRestrictedHour };
