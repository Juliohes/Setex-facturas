// v3 (2026-08-13): subida de versión para que las PWA ya instaladas reciban la
// actualización (subida de factura multipágina). Al cambiar el nombre se limpia
// la caché vieja en 'activate' y se re-precachean los assets nuevos.
// v7 (2026-08-21): indicador de progreso de captura (progreso.js + app.js nuevo).
const CACHE_NAME = 'setex-v8';

// Assets estáticos a pre-cachear en la instalación
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/progreso.js',
  '/multipagina.js',
  '/manifest.json'
  // NO incluyas /icons/ aquí — los iconos se cachearán on-demand
];

// ── Bloqueo horario offline (00:00–06:00 hora Madrid) ────────────────────
function isBlockedHours() {
  try {
    const hora = parseInt(
      new Intl.DateTimeFormat('es-ES', {
        timeZone: 'Europe/Madrid',
        hour: 'numeric',
        hour12: false
      }).format(new Date()),
      10
    );
    return hora >= 0 && hora < 6;
  } catch {
    return false; // si Intl falla, no bloquear
  }
}

function blockedOfflineResponse() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Servicio no disponible</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
      background: #1a202c; text-align: center; padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #2d3748; border-radius: 16px;
      padding: 40px 32px; max-width: 360px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .logo {
      font-size: 36px; font-weight: 900;
      letter-spacing: 0.05em; margin-bottom: 24px;
      display: inline-block;
      background: #1a202c; padding: 6px 18px; border-radius: 10px;
    }
    .logo .se { color: #FF6600; }
    .logo .tex { color: #ffffff; }
    h2 { color: #fff; margin: 0 0 12px; font-size: 1.25em; font-weight: 700; }
    p { color: #a0aec0; margin: 6px 0; font-size: 0.95em; line-height: 1.6; }
    .hora { color: #FF6600; font-weight: 700; font-size: 1.15em; margin: 12px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><span class="se">SE</span><span class="tex">TEX</span></div>
    <h2>Servicio no disponible</h2>
    <p>El servicio está disponible de</p>
    <p class="hora">06:00 a 00:00</p>
    <p>Vuelve más tarde.</p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ── Install: pre-cachear shell de la app ─────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: limpiar versiones antiguas ─────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Mensaje desde la app: forzar activación del nuevo SW ─────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch: network-first, /api/* nunca cacheado ──────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Las llamadas a la API nunca van a cache — siempre red
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Solo peticiones GET
  if (event.request.method !== 'GET') {
    return;
  }

  // Network-first con fallback a cache (con respeto al bloqueo horario)
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Solo cachear respuestas válidas de nuestro propio origen
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Sin red: aplicar bloqueo horario también en modo offline
        if (isBlockedHours()) {
          return blockedOfflineResponse();
        }
        return caches.match(event.request);
      })
  );
});
