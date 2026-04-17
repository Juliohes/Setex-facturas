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
