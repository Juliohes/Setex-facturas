/**
 * auth.js — Módulo centralizado de autenticación SETEX
 *
 * Arquitectura: Access Token (AT) en memoria JS + Refresh Token (RT) en cookie httpOnly.
 * - AT: 15 min, nunca en localStorage/sessionStorage (inmune a XSS)
 * - RT: 7d/1d según remember_me, cookie httpOnly SameSite=Strict (inmune a CSRF)
 * - Rotación de RT en cada uso + detección de reuso (revocación de familia completa)
 * - BroadcastChannel: logout sincronizado entre pestañas
 *
 * Uso:
 *   await Auth.init()                   → restaurar sesión desde RT cookie
 *   Auth.handleLoginResponse(data)      → guardar AT después de login/register
 *   await Auth.apiFetch(url, opts)      → fetch autenticado con refresh proactivo
 *   Auth.isLoggedIn()                   → boolean
 *   Auth.getToken()                     → AT string (para casos que lo necesiten explícitamente)
 *   Auth.getUser()                      → { id, email, is_admin }
 *   await Auth.logout()                 → revocar RT en servidor + limpiar estado
 *   window.__authOnLogout               → callback invocado en logout (cross-tab incluido)
 */
(function () {
  'use strict';

  // ── Estado interno (solo en memoria, nunca expuesto al DOM) ──────────────────
  let _at       = null;  // Access Token string
  let _atExpiry = 0;     // AT expiry timestamp en ms
  let _user     = null;  // { id, email, is_admin } decodificado del AT
  let _refreshPromise = null;

  // Margen de refresco proactivo: renovar AT 60s antes de expirar
  const REFRESH_MARGIN_MS = 60_000;

  // ── BroadcastChannel — logout sincronizado entre pestañas ────────────────────
  const _bc = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('setex_auth_v2') : null;

  if (_bc) {
    _bc.onmessage = function (e) {
      if (e.data && e.data.type === 'LOGOUT') {
        _clearState();
        if (typeof window.__authOnLogout === 'function') window.__authOnLogout();
      }
    };
  }

  // ── Helpers privados ─────────────────────────────────────────────────────────

  function _clearState() {
    _at = null; _atExpiry = 0; _user = null;
  }

  /** Decodifica el payload del JWT para extraer info del usuario (sin verificar firma). */
  function _decodeUser(at) {
    try {
      const p = JSON.parse(atob(at.split('.')[1]));
      return {
        id:       p.userId || null,
        email:    p.email  || '',
        is_admin: p.is_admin === true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Intenta renovar el AT llamando a POST /api/auth/refresh.
   * El RT viaja automáticamente en la cookie httpOnly.
   * Previene llamadas concurrentes con _refreshPromise.
   */
  async function _silentRefresh() {
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = (async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method:      'POST',
          credentials: 'include',
          headers:     { 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!res.ok) { _clearState(); return false; }
        const data = await res.json();
        _at       = data.accessToken;
        _atExpiry = Date.now() + (data.expiresIn || 900) * 1000;
        _user     = _decodeUser(_at);
        return true;
      } catch {
        _clearState(); return false;
      } finally {
        _refreshPromise = null;
      }
    })();
    return _refreshPromise;
  }

  /**
   * Garantiza que el AT esté fresco antes de una petición autenticada.
   * Si falta menos de REFRESH_MARGIN_MS para expirar → fuerza refresh.
   */
  async function _ensureFreshToken() {
    if (_at && (_atExpiry - Date.now()) > REFRESH_MARGIN_MS) return true;
    return _silentRefresh();
  }

  // ── API pública ──────────────────────────────────────────────────────────────
  window.Auth = {

    /**
     * Restaura la sesión intentando un refresh silencioso.
     * Llamar una vez al inicio de cada página (antes de cualquier fetch autenticado).
     * @returns {Promise<boolean>} true si hay sesión activa
     */
    async init() {
      return _silentRefresh();
    },

    /** @returns {boolean} */
    isLoggedIn() { return !!_at; },

    /** @returns {string|null} Access Token actual */
    getToken() { return _at; },

    /** @returns {{ id, email, is_admin }|null} */
    getUser() { return _user; },

    /**
     * Almacena el AT recibido tras login o register.
     * El RT ya fue establecido como cookie httpOnly por el servidor.
     * @param {{ accessToken: string, expiresIn?: number, user?: object }} data
     */
    handleLoginResponse(data) {
      _at       = data.accessToken;
      _atExpiry = Date.now() + (data.expiresIn || 900) * 1000;
      _user     = _decodeUser(_at);
      // Si el servidor devuelve user explícito, completar campos que el AT no tenga
      if (data.user && _user) {
        _user.id    = _user.id    || data.user.id;
        _user.email = _user.email || data.user.email || '';
      }
    },

    /**
     * Fetch autenticado que:
     * 1. Renueva el AT proactivamente si está a punto de expirar
     * 2. Añade automáticamente Authorization + X-Requested-With
     * 3. Si recibe 401, intenta un refresh y reintenta la petición una vez
     * 4. Si el reintento también falla → llama a window.__authOnLogout
     *
     * @param {string} url
     * @param {RequestInit} opts
     * @returns {Promise<Response>}
     */
    async apiFetch(url, opts = {}) {
      const ok = await _ensureFreshToken();
      if (!ok || !_at) {
        _clearState();
        if (typeof window.__authOnLogout === 'function') window.__authOnLogout();
        return new Response(JSON.stringify({ error: 'Sesión caducada. Por favor, inicia sesión de nuevo.' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        });
      }

      const _buildHeaders = (at, extra) => ({
        'X-Requested-With': 'XMLHttpRequest',
        'Authorization':    `Bearer ${at}`,
        ...(extra || {}),
      });

      const res = await fetch(url, {
        ...opts,
        headers:     _buildHeaders(_at, opts.headers),
        credentials: 'include',
      });

      if (res.status !== 401) return res;

      // 401 → intentar refresh y reintentar una vez
      const refreshed = await _silentRefresh();
      if (refreshed && _at) {
        const res2 = await fetch(url, {
          ...opts,
          headers:     _buildHeaders(_at, opts.headers),
          credentials: 'include',
        });
        if (res2.status === 401) {
          _clearState();
          if (typeof window.__authOnLogout === 'function') window.__authOnLogout();
        }
        return res2;
      }

      _clearState();
      if (typeof window.__authOnLogout === 'function') window.__authOnLogout();
      return res;
    },

    /**
     * Cierra la sesión: revoca el RT en el servidor, limpia el estado local,
     * y notifica a otras pestañas vía BroadcastChannel.
     */
    async logout() {
      try {
        await fetch('/api/auth/logout', {
          method:      'POST',
          credentials: 'include',
          headers:     { 'X-Requested-With': 'XMLHttpRequest' },
        });
      } catch { /* best-effort */ }
      _clearState();
      if (_bc) _bc.postMessage({ type: 'LOGOUT' });
    },
  };
})();

/**
 * Botón "ojo" para mostrar/ocultar la contraseña (2026-08-10, petición de Julio).
 *
 * Vive aquí y no en app.js/admin-login.js/admin-facturas.js porque auth.js es
 * el único script cargado por las TRES páginas con campos de contraseña
 * (index.html, admin-login.html, admin-facturas.html): una sola implementación
 * en lugar de tres copias que se desincronizarían.
 *
 * Se aplica a TODOS los input[type=password] del documento, así que cualquier
 * campo nuevo lo hereda sin tocar este fichero. Es idempotente (marca los ya
 * procesados) y no toca los formularios ni sus handlers: solo envuelve el
 * input y cambia su atributo `type`.
 */
(function () {
  'use strict';

  // Feather icons "eye" / "eye-off" — SVG inline, sin dependencias externas
  // (la CSP bloquea recursos de terceros y el proyecto no vendoriza iconos).
  const SVG_ABIERTO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const SVG_TACHADO = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

  function ocultar(input, btn) {
    input.type = 'password';
    btn.innerHTML = SVG_ABIERTO;
    btn.setAttribute('aria-label', 'Mostrar contraseña');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Mostrar contraseña';
  }

  function mostrar(input, btn) {
    input.type = 'text';
    btn.innerHTML = SVG_TACHADO;
    btn.setAttribute('aria-label', 'Ocultar contraseña');
    btn.setAttribute('aria-pressed', 'true');
    btn.title = 'Ocultar contraseña';
  }

  function equipar(input) {
    if (input.dataset.pwdToggle === '1') return; // ya procesado
    input.dataset.pwdToggle = '1';

    const wrap = document.createElement('span');
    wrap.className = 'pwd-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement('button');
    // type="button" es obligatorio: dentro de un <form> el default es
    // "submit" y pulsar el ojo enviaría el login en vez de revelar el texto.
    btn.type = 'button';
    btn.className = 'pwd-toggle';
    btn.tabIndex = -1; // el tabulador salta del campo al botón "Entrar", no al ojo
    ocultar(input, btn);
    wrap.appendChild(btn);

    btn.addEventListener('click', () => {
      const visible = input.type === 'text';
      if (visible) ocultar(input, btn); else mostrar(input, btn);
      // Devolver el foco al campo y el cursor al final: si no, tras pulsar el
      // ojo hay que volver a hacer clic en el input para seguir escribiendo.
      input.focus();
      try {
        const n = input.value.length;
        input.setSelectionRange(n, n);
      } catch { /* setSelectionRange no aplica a algunos tipos */ }
    });

    // Volver a ocultar cuando el campo deja de estar visible (login enviado,
    // cambio de pantalla). Evita que la contraseña siga en claro en pantalla
    // después de entrar — shoulder surfing gratis en un móvil sobre la mesa.
    if (typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver((entradas) => {
        if (!entradas[0].isIntersecting && input.type === 'text') ocultar(input, btn);
      }).observe(input);
    }
  }

  function equiparTodos() {
    document.querySelectorAll('input[type="password"]').forEach(equipar);
  }

  // Mismo motivo que el IntersectionObserver: al enviar cualquier formulario,
  // la contraseña vuelve a ocultarse. En fase de captura para que corra aunque
  // otro handler haga preventDefault().
  document.addEventListener('submit', () => {
    document.querySelectorAll('.pwd-wrap input[type="text"]').forEach((input) => {
      const btn = input.parentNode.querySelector('.pwd-toggle');
      if (btn) ocultar(input, btn);
    });
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', equiparTodos);
  } else {
    equiparTodos();
  }

  // Expuesto por si alguna pantalla inyecta campos de contraseña más tarde.
  window.initPasswordToggles = equiparTodos;
})();
