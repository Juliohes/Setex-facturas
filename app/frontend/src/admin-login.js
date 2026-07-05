// admin-login.js — Login dedicado del panel de administración (2026-07-05).
//
// Por qué existe: /admin-facturas.html está protegido por nginx auth_request
// (cookie httpOnly setex_admin) y sin sesión admin el HTML ni se descarga —
// nginx redirige aquí (302 /admin-login.html). El antiguo formulario embebido
// en admin-facturas.html era código muerto inalcanzable por ese mismo motivo.
//
// Flujo:
//   1. Al cargar: refresh silencioso (Auth.init). Si ya hay sesión admin,
//      renovamos la cookie setex_admin (POST /api/admin/refresh-session) y
//      entramos directos al panel sin pedir credenciales.
//   2. Submit: POST /api/auth/login → si el usuario es admin, refresh-session
//      confirma el rol EN SERVIDOR y emite la cookie → redirect al panel.
//   3. Credenciales válidas pero NO admin → error visible + logout silencioso
//      (decisión Julio 2026-07-05: no redirigir al portal normal).
'use strict';

const API_URL = '/api';
const PANEL_URL = '/admin-facturas.html';

function showError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function setBusy(busy) {
  const btn = document.getElementById('login-btn');
  btn.disabled = busy;
  btn.textContent = busy ? 'Comprobando...' : 'Entrar';
}

/**
 * Confirma en SERVIDOR que la sesión actual es de un admin y, de paso, emite
 * la cookie httpOnly setex_admin que nginx exige para servir el panel.
 * @returns {boolean} true si la cookie admin quedó emitida.
 */
async function ensureAdminCookie() {
  const res = await Auth.apiFetch(`${API_URL}/admin/refresh-session`, { method: 'POST' });
  return res.ok;
}

async function onSubmit(e) {
  e.preventDefault();
  document.getElementById('login-error').style.display = 'none';
  setBusy(true);

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Credenciales incorrectas');
    Auth.handleLoginResponse(data);

    // Chequeo rápido en cliente (is_admin viene decodificado del JWT) +
    // confirmación en servidor (requireAdmin) con emisión de cookie.
    const user = Auth.getUser() || {};
    if (user.is_admin !== true || !(await ensureAdminCookie())) {
      // Sesión válida pero sin rol admin: no dejamos sesión colgada aquí.
      await Auth.logout().catch(() => {});
      showError('Esta cuenta no tiene permisos de administrador.');
      setBusy(false);
      return;
    }

    window.location.href = PANEL_URL;
  } catch (err) {
    showError(err.message || 'Error de conexión con el servidor.');
    setBusy(false);
  }
}

(async () => {
  // Evitar que un logout cross-tab dispare redirecciones raras desde aquí.
  window.__authOnLogout = () => {};

  document.getElementById('login-form').addEventListener('submit', onSubmit);

  // Auto-entrada: si hay sesión admin viva (RT válido), directo al panel.
  try {
    const ok = await Auth.init();
    if (ok && Auth.isLoggedIn() && (Auth.getUser() || {}).is_admin === true) {
      if (await ensureAdminCookie()) {
        window.location.href = PANEL_URL;
        return;
      }
    }
  } catch (_) { /* sin sesión previa — se muestra el formulario */ }
})();
