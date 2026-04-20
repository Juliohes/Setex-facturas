const API_URL = window.location.origin + '/api';

// token: Access Token en memoria JS (nunca en localStorage/sessionStorage — inmune a XSS).
// Gestionado por window.Auth (auth.js). Se inicializa en el bloque init al final del archivo.
let token = null;
let selectedFile = null;
let currentPreviewId = null;
let userCompanyName = null;
let userCompanyNif = null;
let userIsAdmin = false;
let historyAllFacturas = [];
let historyShowAll = false;

// Tipo de factura seleccionado por el usuario
// 'compra' = Factura Recibida | 'venta' = Factura Emitida
let selectedInvoiceType = 'compra'; // defecto: la mayoría son facturas recibidas

// ── Token helpers ─────────────────────────────────────────────────────────────

function isTokenValid(t) {
    if (!t) return false;
    try {
        const payload = JSON.parse(atob(t.split('.')[1]));
        return payload.exp * 1000 > Date.now();
    } catch (e) {
        return false;
    }
}

function forceLogin() {
    Auth.logout().catch(() => {});
    token = null;
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'block';
    showLogin();
}

// ── Auth functions ────────────────────────────────────────────────────────────

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('forgot-password-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
}

function showLogin() {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('forgot-password-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
}

function showForgotPassword() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('forgot-password-form').style.display = 'block';
    document.getElementById('forgot-message').innerHTML = '';
}

async function register() {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const company_name = document.getElementById('register-company-name').value.trim();
    const company_nif = document.getElementById('register-company-nif').value.trim().toUpperCase().replace(/[\s\-\.]/g, '');
    const messageDiv = document.getElementById('register-message');

    if (!company_name || !company_nif || !email || !password) {
        messageDiv.innerHTML = '<p class="error">Por favor completa todos los campos</p>';
        return;
    }

    try {
        const res = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, company_name, company_nif })
        });
        const data = await res.json();
        if (res.status === 202 && data.pending) {
            // Empresa pendiente de aprobación — no hay token todavía
            messageDiv.innerHTML = '';
            showPendingApprovalScreen(null, company_nif);
            const infoDiv = document.getElementById('pending-company-info');
            if (infoDiv) infoDiv.innerHTML = `<strong>${company_name || company_nif}</strong><br><span style="font-size:12px;opacity:0.7;">Tu solicitud fue recibida. Un administrador revisará tu empresa en breve.</span>`;
        } else if (data.accessToken) {
            Auth.handleLoginResponse(data);
            token = Auth.getToken();
            showMainScreen();
        } else {
            messageDiv.innerHTML = `<p class="error">${data.error || 'Error al registrar'}</p>`;
        }
    } catch (err) {
        messageDiv.innerHTML = '<p class="error">Error de conexión</p>';
    }
}

async function login() {
    const email      = document.getElementById('login-email').value;
    const password   = document.getElementById('login-password').value;
    const rememberEl = document.getElementById('login-remember');
    const remember_me = rememberEl ? rememberEl.checked : false;

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, remember_me })
        });
        const data = await res.json();
        if (data.accessToken) {
            Auth.handleLoginResponse(data);
            token = Auth.getToken();
            // Redirect al panel admin si el login vino de /?next=admin
            if (sessionStorage.getItem('postLoginRedirect') === 'admin') {
                sessionStorage.removeItem('postLoginRedirect');
                const user = Auth.getUser();
                if (user && user.is_admin) { window.location.href = '/admin-facturas.html'; return; }
            }
            showMainScreen();
        } else {
            alert(data.error || 'Error al iniciar sesión');
        }
    } catch (err) {
        alert('Error de conexión');
    }
}

function logout() {
    Auth.logout().catch(() => {});
    token = null;
    hideCompanyIdentity();
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('pending-approval-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'block';
}

async function forgotPassword() {
    const email = document.getElementById('forgot-email').value;
    const messageDiv = document.getElementById('forgot-message');

    if (!email) {
        messageDiv.innerHTML = '<p class="error">Por favor ingresa tu email</p>';
        return;
    }

    try {
        const res = await fetch(`${API_URL}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok) {
            messageDiv.innerHTML = '<p class="success">Si el email existe, recibirás instrucciones de recuperación</p>';
            document.getElementById('forgot-email').value = '';
        } else {
            messageDiv.innerHTML = `<p class="error">${data.error || 'Error al procesar la solicitud'}</p>`;
        }
    } catch (err) {
        messageDiv.innerHTML = '<p class="error">Error de conexión</p>';
    }
}

async function resetPassword() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    const messageDiv = document.getElementById('reset-message');
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) { messageDiv.innerHTML = '<p class="error">Token inválido o faltante</p>'; return; }
    if (!newPassword || !confirmPassword) { messageDiv.innerHTML = '<p class="error">Por favor completa todos los campos</p>'; return; }
    if (newPassword !== confirmPassword) { messageDiv.innerHTML = '<p class="error">Las contraseñas no coinciden</p>'; return; }
    if (newPassword.length < 6) { messageDiv.innerHTML = '<p class="error">La contraseña debe tener al menos 6 caracteres</p>'; return; }

    try {
        const res = await fetch(`${API_URL}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword })
        });
        const data = await res.json();
        if (res.ok) {
            messageDiv.innerHTML = '<p class="success">¡Contraseña actualizada exitosamente! Redirigiendo al login...</p>';
            setTimeout(() => { window.location.href = '/'; }, 2000);
        } else {
            messageDiv.innerHTML = `<p class="error">${data.error || 'Error al restablecer la contraseña'}</p>`;
        }
    } catch (err) {
        messageDiv.innerHTML = '<p class="error">Error de conexión</p>';
    }
}

// ── Identidad visual de empresa ───────────────────────────────────────────────

/**
 * Genera iniciales de empresa descartando formas jurídicas comunes.
 * "TEXTIL GARCÍA SL" → "TG"  |  "FRUTAS PACO" → "FP"  |  "AUTOKENIAS" → "AU"
 */
function getCompanyInitials(name) {
    const LEGAL = /\b(S\.?L\.?U?\.?|S\.?A\.?U?\.?|S\.?R\.?L\.?|S\.?L\.?N?\.?E?\.?|S\.?C\.?P?\.?|C\.?B\.?)\b/gi;
    const clean = name.replace(LEGAL, '').replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').filter(w => w.length > 0);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return clean.substring(0, 2).toUpperCase();
}

/**
 * Color determinístico basado en el nombre de empresa.
 * Estable entre sesiones — la misma empresa siempre tiene el mismo color.
 * Devuelve [colorPrincipal, colorOscuro] para el gradiente del avatar.
 */
function getCompanyColor(name) {
    const palette = [
        ['#4299e1', '#2b6cb0'], // azul
        ['#48bb78', '#276749'], // verde
        ['#ed8936', '#c05621'], // naranja
        ['#9f7aea', '#6b46c1'], // morado
        ['#38b2ac', '#285e61'], // teal
        ['#e53e3e', '#9b2c2c'], // rojo
        ['#d69e2e', '#975a16'], // ámbar
        ['#667eea', '#434190'], // índigo
    ];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    return palette[Math.abs(h) % palette.length];
}

/**
 * Muestra el chip de empresa en el header con avatar colorido y nombre.
 * Si es admin o no hay nombre de empresa, oculta el chip.
 * También "brandea" el border-top del main-screen con el color de la empresa.
 */
function showCompanyIdentity(companyName, isAdmin, aeatWarning = false) {
    const chip = document.getElementById('company-chip');
    if (!chip) return;
    if (!companyName || isAdmin) { chip.style.display = 'none'; return; }

    const [c1, c2] = getCompanyColor(companyName);

    // Fondo degradado con el color de empresa
    chip.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
    chip.style.boxShadow  = `0 2px 10px ${c1}55`;

    document.getElementById('company-name-chip').textContent = companyName;
    chip.classList.add('visible');

    // Aviso visual cuando el CIF guardado no pasa el algoritmo AEAT (typo probable).
    // No bloquea — sólo informa para que el usuario revise.
    const warn = document.getElementById('company-cif-warning');
    if (warn) warn.style.display = aeatWarning ? 'inline-block' : 'none';

    // El borde superior de la tarjeta toma el mismo color — UI "branded"
    const mainScreen = document.getElementById('main-screen');
    if (mainScreen) mainScreen.style.borderTopColor = c1;
}

function hideCompanyIdentity() {
    const chip = document.getElementById('company-chip');
    if (chip) { chip.classList.remove('visible'); chip.style.display = 'none'; }
    const mainScreen = document.getElementById('main-screen');
    if (mainScreen) mainScreen.style.borderTopColor = '';
}

// ── Preferencias de usuario ───────────────────────────────────────────────────

async function loadUserSettings() {
    try {
        const res = await Auth.apiFetch(`${API_URL}/me/settings`);
        if (!res.ok) return;
        const data = await res.json();
        userCompanyNif  = data.company_nif  || null;
        userCompanyName = data.company_name || null;
        userIsAdmin     = data.is_admin === true;
        showCompanyIdentity(data.company_name, data.is_admin === true, data.company_nif_aeat_warning === true);
    } catch { /* no bloquear */ }
}

function showMainScreen() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'block';
    document.getElementById('reset-password-screen').style.display = 'none';
    document.getElementById('pending-approval-screen').style.display = 'none';
    loadUserSettings();
    loadHistory();
}

function showPendingApprovalScreen(companyName, companyNif) {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('reset-password-screen').style.display = 'none';
    document.getElementById('pending-approval-screen').style.display = 'block';
    const infoDiv = document.getElementById('pending-company-info');
    if (infoDiv) {
        infoDiv.innerHTML = (companyName ? `<strong>${companyName}</strong>` : '')
            + (companyNif ? `<br><span style="font-size:12px;opacity:0.7;">CIF: ${companyNif}</span>` : '');
    }
}

// ── Historial de facturas ─────────────────────────────────────────────────────

// ── Helpers del historial ──────────────────────────────────────────────────────

/** Parsea importe en formato español ("1.234,56") a float. */
function parseHistoryAmount(v) {
    if (!v) return null;
    let s = String(v).trim().replace(/[€\s]/g, '');
    if (!s) return null;
    let num;
    if (s.includes(',') && s.includes('.')) {
        num = s.lastIndexOf(',') > s.lastIndexOf('.')
            ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
            : parseFloat(s.replace(/,/g, ''));
    } else if (s.includes(',')) {
        num = parseFloat(s.replace(',', '.'));
    } else {
        num = parseFloat(s);
    }
    return isNaN(num) ? null : num;
}

/** Formatea float a "1.234,56 €" en locale español. */
function fmtEur(v) {
    const n = parseHistoryAmount(v);
    if (n === null) return '<span style="color:#cbd5e0;">—</span>';
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/** Detecta el tipo de identificador fiscal español. */
function detectTaxIdType(nif) {
    if (!nif) return null;
    const c = nif.toUpperCase().replace(/[\s\-\.]/g, '');
    if (/^\d{8}[A-Z]$/.test(c))       return 'NIF'; // persona física española
    if (/^[XYZ]\d{7}[A-Z]$/.test(c))  return 'NIE'; // extranjero residente
    if (/^[A-Z]\d{7}[A-Z0-9]$/.test(c)) return 'CIF'; // empresa/sociedad
    return null;
}

function renderHistoryTable(facturas) {
    const list       = document.getElementById('history-list');
    const actionsDiv = document.getElementById('history-actions');
    if (!facturas.length) {
        list.innerHTML = '<p style="padding:16px;color:#a0aec0;font-size:13px;text-align:center;">Sin facturas en los últimos 7 días</p>';
        if (actionsDiv) actionsDiv.style.display = 'none';
        return;
    }

    const visible    = historyShowAll ? facturas : facturas.slice(0, 3);
    const empresa    = userCompanyName || '—';
    const cifEmpresa = userCompanyNif  || '—';

    const TH = 'padding:7px 9px;font-size:10px;font-weight:700;color:#718096;letter-spacing:.05em;white-space:nowrap;border-bottom:2px solid #e2e8f0;background:#f7fafc;text-align:left;';
    const TD = 'padding:7px 9px;font-size:12px;color:#2d3748;white-space:nowrap;border-bottom:1px solid #f0f4f8;vertical-align:middle;';

    const header = `<tr>
        <th style="${TH}">Nº</th>
        <th style="${TH}">Nº FACTURA</th>
        <th style="${TH}">PROVEEDOR / CLIENTE</th>
        <th style="${TH}">TIPO ID</th>
        <th style="${TH}">NIF / CIF</th>
        <th style="${TH}">FECHA</th>
        <th style="${TH}">BASE IMP.</th>
        <th style="${TH}">IVA %</th>
        <th style="${TH}">CUOTA IVA</th>
        <th style="${TH}">IRPF %</th>
        <th style="${TH}">CUOTA IRPF</th>
        <th style="${TH}">TOTAL</th>
        <th style="${TH}">COMPRA/VENTA</th>
        <th style="${TH}">✓</th>
        <th style="${TH}">IMG</th>
    </tr>`;

    const rows = visible.map((f, i) => {
        // ── Identificador fiscal del proveedor ────────────────────────────────
        const nifRaw    = (f.proveedor_nif || '').toUpperCase().replace(/[\s\-\.]/g, '');
        const idType    = detectTaxIdType(nifRaw);
        const esAutonomo = idType === 'NIF' || idType === 'NIE';

        // Badge tipo identificador
        let idBadge = '<span style="color:#cbd5e0;font-size:10px;">—</span>';
        if (idType === 'NIF') {
            idBadge = '<span style="display:inline-block;font-size:9px;font-weight:700;color:#c05621;background:#fffbeb;border:1px solid #fbd38d;border-radius:4px;padding:1px 5px;">NIF</span>';
        } else if (idType === 'NIE') {
            idBadge = '<span style="display:inline-block;font-size:9px;font-weight:700;color:#6b46c1;background:#faf5ff;border:1px solid #d6bcfa;border-radius:4px;padding:1px 5px;">NIE</span>';
        } else if (idType === 'CIF') {
            idBadge = '<span style="display:inline-block;font-size:9px;font-weight:700;color:#2b6cb0;background:#ebf8ff;border:1px solid #90cdf4;border-radius:4px;padding:1px 5px;">CIF</span>';
        }

        // ── Importes ──────────────────────────────────────────────────────────
        const base       = fmtEur(f.base_imponible);
        const cuotaIva   = fmtEur(f.cuota_iva);
        const cuotaIrpf  = fmtEur(f.cuota_irpf);
        const total      = fmtEur(f.total_factura);

        const ivaPct  = f.iva_porcentaje  ? `<b>${f.iva_porcentaje}%</b>`  : '<span style="color:#cbd5e0;">—</span>';
        const hasIrpf = f.irpf_porcentaje && f.irpf_porcentaje !== '0,0' && f.irpf_porcentaje !== '0';
        const irpfPct = hasIrpf
            ? `<b style="color:#c05621;">${f.irpf_porcentaje}%</b>`
            : '<span style="color:#cbd5e0;">—</span>';
        const irpfCuotaFmt = hasIrpf
            ? `<span style="color:#c05621;">${cuotaIrpf}</span>`
            : '<span style="color:#cbd5e0;">—</span>';

        // ── Badge compra/venta ─────────────────────────────────────────────────
        const typeColor = f.invoice_type === 'venta' ? '#6b46c1' : '#2b6cb0';
        const typeBg    = f.invoice_type === 'venta' ? '#e9d8fd' : '#ebf8ff';
        const typeLabel = f.invoice_type === 'venta' ? '↑ Emitida' : '↓ Recibida';
        const typeBadge = f.invoice_type
            ? `<span style="font-size:10px;font-weight:700;color:${typeColor};background:${typeBg};padding:2px 6px;border-radius:8px;">${typeLabel}</span>`
            : '<span style="color:#cbd5e0;font-size:10px;">—</span>';

        // ── Indicador validación fiscal ────────────────────────────────────────
        let validBadge = '<span style="color:#cbd5e0;">—</span>';
        if (f.iva_validation_ok === true)
            validBadge = '<span style="color:#276749;font-weight:700;" title="Cálculo fiscal correcto">✓</span>';
        else if (f.iva_validation_ok === false)
            validBadge = '<span style="color:#c53030;font-weight:700;" title="Inconsistencia detectada">⚠</span>';

        // ── Imagen ─────────────────────────────────────────────────────────────
        let imgBtn = '<span style="color:#cbd5e0;">—</span>';
        if (f.file_path) {
            imgBtn = `<span onclick="verImagenFactura(${f.id})" style="cursor:pointer;font-size:16px;" title="Ver imagen">🖼</span>`;
        }

        // ── Color de fila: naranja suave para autónomos ────────────────────────
        const rowBg = esAutonomo
            ? (i % 2 === 0 ? '#fffaf5' : '#fff7ed')
            : (i % 2 === 0 ? '#fff'    : '#fafbfc');

        const numFact = f.numero_factura
            ? `<span style="font-family:monospace;font-size:11px;color:#4a5568;">${f.numero_factura}</span>`
            : '<span style="color:#cbd5e0;">—</span>';

        return `<tr style="background:${rowBg};">
            <td style="${TD}color:#a0aec0;font-size:11px;">${f.id}</td>
            <td style="${TD}text-align:center;">${numFact}</td>
            <td style="${TD}font-weight:600;max-width:140px;overflow:hidden;text-overflow:ellipsis;" title="${f.proveedor_nombre || ''}">${f.proveedor_nombre || '<span style="color:#cbd5e0;">—</span>'}</td>
            <td style="${TD}text-align:center;">${idBadge}</td>
            <td style="${TD}font-family:monospace;font-size:11px;letter-spacing:.03em;">${nifRaw || '<span style="color:#cbd5e0;">—</span>'}</td>
            <td style="${TD}color:#718096;">${f.fecha_emision || '<span style="color:#cbd5e0;">—</span>'}</td>
            <td style="${TD}text-align:right;">${base}</td>
            <td style="${TD}text-align:center;">${ivaPct}</td>
            <td style="${TD}text-align:right;">${cuotaIva}</td>
            <td style="${TD}text-align:center;">${irpfPct}</td>
            <td style="${TD}text-align:right;">${irpfCuotaFmt}</td>
            <td style="${TD}font-weight:700;text-align:right;">${total}</td>
            <td style="${TD}text-align:center;">${typeBadge}</td>
            <td style="${TD}text-align:center;">${validBadge}</td>
            <td style="${TD}text-align:center;">${imgBtn}</td>
        </tr>`;
    }).join('');

    list.innerHTML = `<table style="width:100%;border-collapse:collapse;min-width:860px;">
        <thead>${header}</thead>
        <tbody>${rows}</tbody>
    </table>`;

    if (actionsDiv) {
        actionsDiv.style.display = (!historyShowAll && facturas.length > 3) ? 'block' : 'none';
    }
}

async function loadHistory() {
    if (!Auth.isLoggedIn()) return;
    const countEl = document.getElementById('history-count');
    try {
        const res = await Auth.apiFetch(`${API_URL}/mis-facturas`);
        if (!res.ok) return;
        const data = await res.json();
        historyAllFacturas = data.facturas || [];
        if (countEl) countEl.textContent = historyAllFacturas.length > 0
            ? `${historyAllFacturas.length} factura${historyAllFacturas.length !== 1 ? 's' : ''}`
            : '';
        const section = document.getElementById('history-section');
        if (section && section.style.display !== 'none') {
            renderHistoryTable(historyAllFacturas);
        }
    } catch { /* no romper */ }
}

// ── Ver imagen local de factura ───────────────────────────────────────────────

function verImagenFactura(id) {
    const url = `${API_URL}/facturas/${id}/imagen`;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="position:relative;max-width:95vw;max-height:95vh;">
            <img src="" style="max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,0.6);display:none;">
            <button onclick="this.closest('[style*=fixed]').remove()"
                    style="position:absolute;top:-14px;right:-14px;background:#fff;border:none;border-radius:50%;width:30px;height:30px;font-size:18px;cursor:pointer;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,0.3);">×</button>
        </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    Auth.apiFetch(url)
        .then(r => r.ok ? r.blob() : Promise.reject())
        .then(blob => {
            const img = overlay.querySelector('img');
            const blobUrl = URL.createObjectURL(blob);
            img.src = blobUrl;
            img.style.display = 'block';
            img.onload = () => URL.revokeObjectURL(blobUrl);
        })
        .catch(() => { overlay.querySelector('img').replaceWith(Object.assign(document.createElement('p'), { textContent: 'No se pudo cargar la imagen', style: 'color:#fff' })); });
    document.body.appendChild(overlay);
}

// ── Selector de tipo de factura (inline, sin overlay) ────────────────────────

/**
 * Cambia el tipo de factura seleccionado y actualiza visualmente los botones.
 * @param {'compra'|'venta'} type
 */
function setInvoiceType(type) {
    selectedInvoiceType = type;
    const btnRec = document.getElementById('btn-type-recibida');
    const btnEmi = document.getElementById('btn-type-emitida');
    if (!btnRec || !btnEmi) return;

    if (type === 'compra') {
        // Recibida activa
        btnRec.style.background    = '#ebf8ff';
        btnRec.style.borderColor   = '#4299e1';
        btnRec.style.color         = '#2b6cb0';
        btnRec.style.boxShadow     = '0 0 0 2px #4299e1';
        btnRec.style.opacity       = '1';
        // Emitida inactiva
        btnEmi.style.background    = '#f7fafc';
        btnEmi.style.borderColor   = '#e2e8f0';
        btnEmi.style.color         = '#a0aec0';
        btnEmi.style.boxShadow     = 'none';
        btnEmi.style.opacity       = '1';
    } else {
        // Emitida activa
        btnEmi.style.background    = '#f0fff4';
        btnEmi.style.borderColor   = '#48bb78';
        btnEmi.style.color         = '#276749';
        btnEmi.style.boxShadow     = '0 0 0 2px #48bb78';
        btnEmi.style.opacity       = '1';
        // Recibida inactiva
        btnRec.style.background    = '#f7fafc';
        btnRec.style.borderColor   = '#e2e8f0';
        btnRec.style.color         = '#a0aec0';
        btnRec.style.boxShadow     = 'none';
        btnRec.style.opacity       = '1';
    }
}

// ── File handling ─────────────────────────────────────────────────────────────

let cameraStream = null;

function capturePhoto() {
    doCapturePhoto();
}

function doCapturePhoto() {
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
            }).then(stream => {
                cameraStream = stream;
                const video = document.getElementById('camera-video');
                video.srcObject = cameraStream;
                document.getElementById('camera-overlay').style.display = 'flex';
            }).catch(() => {
                document.getElementById('camera-input').click();
            });
            return;
        }
    } catch (e) { /* intentional */ }
    document.getElementById('camera-input').click();
}

function selectFile() {
    document.getElementById('file-input').click();
}

function closeCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    document.getElementById('camera-overlay').style.display = 'none';
}

function takePhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    closeCamera();
    canvas.toBlob(function(blob) {
        if (blob) {
            const file = new File([blob], 'captura.jpg', { type: 'image/jpeg' });
            processFile(file);
        }
    }, 'image/jpeg', 0.92);
}

function handleFile(event) {
    const file = event.target.files[0];
    if (file) processFile(file);
}

function processFile(file) {
    const user = Auth.getUser();
    const username = (user && user.email) ? user.email.split('@')[0] : 'usuario';
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0');
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop().toLowerCase() : '.jpg';
    const newName = `${username}_${dateStr}${ext}`;
    selectedFile = new File([file], newName, { type: file.type });

    const typeLabel = selectedInvoiceType === 'venta' ? '📤 Emitida' : '📥 Recibida';
    const typeColor = selectedInvoiceType === 'venta' ? '#6b46c1' : '#2b6cb0';
    document.getElementById('preview').innerHTML = `
        <p>Archivo: ${selectedFile.name} (${(selectedFile.size/1024).toFixed(2)} KB)</p>
        <span style="display:inline-block;font-size:12px;font-weight:700;color:${typeColor};background:${selectedInvoiceType === 'venta' ? '#e9d8fd' : '#ebf8ff'};padding:3px 10px;border-radius:10px;">${typeLabel}</span>`;
    document.getElementById('upload-btn').disabled = false;
    document.getElementById('message').innerHTML = '';
}

// ── Validación fiscal cliente (NIF/NIE/CIF) ───────────────────────────────────

function validateTaxIdClient(taxId) {
    if (!taxId || typeof taxId !== 'string') return { result: 'incomplete', msg: '' };
    const clean = taxId.toUpperCase().replace(/[\s\-\.]/g, '');
    if (clean.length < 9 || clean.length > 9) return { result: 'incomplete', msg: '' };

    if (/^\d{8}[A-Z]$/.test(clean))         return { result: 'valid', msg: '✓ NIF personal' };
    if (/^[XYZ]\d{7}[A-Z]$/.test(clean))    return { result: 'valid', msg: '✓ NIE' };
    if (/^[A-Z]\d{7}[A-Z0-9]$/.test(clean)) return { result: 'valid', msg: '✓ CIF' };

    return { result: 'unknown', msg: '' };
}

function updateCIFStatus(nif) {
    const statusEl = document.getElementById('confirm-cif-status');
    if (!nif || nif.length === 0) { statusEl.textContent = ''; return; }
    const { result, msg } = validateTaxIdClient(nif);
    const colors = { valid: '#276749', invalid: '#c53030', unknown: '#718096', incomplete: '#718096' };
    statusEl.style.color = colors[result] || '#718096';
    statusEl.textContent = msg;
}

async function fetchVIESAsync(nif) {
    const viesEl = document.getElementById('confirm-vies-status');
    if (!nif || !/^[A-Z]\d{7}[A-Z0-9]$/.test(nif)) return;
    viesEl.style.color = '#718096';
    viesEl.textContent = 'Consultando registro fiscal europeo...';
    try {
        const res = await fetch(`${API_URL}/vies/${encodeURIComponent(nif)}`);
        if (!res.ok) { viesEl.textContent = ''; return; }
        const data = await res.json();
        if (data.valid === true) {
            viesEl.style.color = '#276749';
            viesEl.textContent = data.nombre ? `✓ Registrado en VIES · ${data.nombre}` : '✓ CIF válido en registro fiscal europeo (VIES)';
        } else if (data.valid === false) {
            viesEl.style.color = '#c05621';
            viesEl.textContent = '⚠ No encontrado en VIES (puede ser PYME sin registro UE)';
        } else {
            viesEl.textContent = '';
        }
    } catch {
        viesEl.textContent = '';
    }
}

// ── Lookup de proveedor por NIF (historial del usuario) ──────────────────────
// Rellena automáticamente el nombre cuando el usuario introduce/corrige un CIF conocido

async function lookupProveedorPorNIF(nif) {
    if (!Auth.isLoggedIn() || !nif) return;
    try {
        const res = await Auth.apiFetch(`${API_URL}/proveedor/${encodeURIComponent(nif)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.found && data.nombre) {
            const nombreInput = document.getElementById('confirm-proveedor');
            if (nombreInput) nombreInput.value = data.nombre;
            const badge = document.getElementById('confirm-known-badge');
            if (badge) badge.style.display = 'block';
        }
    } catch { /* silencioso — no interrumpir flujo */ }
}

// ── Validación IVA en tiempo real (frontend) ──────────────────────────────────

function parseAmount(str) {
    if (!str) return null;
    let s = String(str).trim().replace(/[€\s]/g, '');
    if (!s) return null;
    const hasComma = s.includes(',');
    const hasDot   = s.includes('.');
    let val;
    if (hasComma && hasDot) {
        val = s.lastIndexOf(',') > s.lastIndexOf('.')
            ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
            : parseFloat(s.replace(/,/g, ''));
    } else if (hasComma) {
        const after = s.split(',').pop() || '';
        val = after.length === 3 ? parseFloat(s.replace(/,/g, '')) : parseFloat(s.replace(',', '.'));
    } else {
        val = parseFloat(s);
    }
    return isNaN(val) ? null : val;
}

function parsePct(str) {
    if (!str) return null;
    const n = parseFloat(String(str).replace(',', '.').replace('%', '').trim());
    if (isNaN(n)) return null;
    return n < 1 ? n : n / 100;
}

function updateIVACalc() {
    const calcEl = document.getElementById('confirm-iva-calc');
    const statusEl = document.getElementById('confirm-iva-status');
    if (!calcEl) return;

    const base   = parseAmount(document.getElementById('confirm-base').value);
    const pct    = parsePct(document.getElementById('confirm-iva-pct').value);
    const cuota  = parseAmount(document.getElementById('confirm-cuota-iva').value);
    const irpf   = parseAmount(document.getElementById('confirm-cuota-irpf').value) || 0;
    const total  = parseAmount(document.getElementById('confirm-total').value);

    const lines = [];
    const TOL = 0.05;

    // Verificar base × % = cuota
    if (base !== null && pct !== null && cuota !== null) {
        const cuotaEsp = Math.round(base * pct * 100) / 100;
        const diff = Math.abs(cuotaEsp - cuota);
        const pctDisplay = (pct * 100).toFixed(1).replace('.', ',');
        if (diff <= TOL) {
            lines.push(`<span style="color:#276749;">✓ ${base.toFixed(2).replace('.', ',')} × ${pctDisplay}% = ${cuotaEsp.toFixed(2).replace('.', ',')}€</span>`);
        } else {
            lines.push(`<span style="color:#c53030;">✗ ${base.toFixed(2).replace('.', ',')} × ${pctDisplay}% = ${cuotaEsp.toFixed(2).replace('.', ',')}€ ≠ ${cuota.toFixed(2).replace('.', ',')}€ (diff: ${diff.toFixed(2)}€)</span>`);
        }
    }

    // Verificar base + cuota - irpf = total
    if (base !== null && cuota !== null && total !== null) {
        const totalCalc = Math.round((base + cuota - irpf) * 100) / 100;
        const diff = Math.abs(totalCalc - total);
        if (diff <= TOL) {
            lines.push(`<span style="color:#276749;">✓ Base + IVA - IRPF = ${totalCalc.toFixed(2).replace('.', ',')}€ = Total ✓</span>`);
        } else {
            lines.push(`<span style="color:#c53030;">Base + IVA - IRPF no cuadra</span>`);
        }
    }

    // Auto-calcular cuota si tenemos base y porcentaje pero no cuota
    if (base !== null && pct !== null && !document.getElementById('confirm-cuota-iva').value) {
        const auto = Math.round(base * pct * 100) / 100;
        lines.push(`<span style="color:#4a90d9;">ℹ Cuota calculada: ${auto.toFixed(2).replace('.', ',')}€</span>`);
    }

    if (lines.length > 0) {
        calcEl.innerHTML = lines.join('<br>');
        // Estado global IVA
        const hasError = lines.some(l => l.includes('✗'));
        if (statusEl) {
            statusEl.textContent = hasError ? '⚠ Revisar' : '✓ Correcto';
            statusEl.style.color = hasError ? '#c53030' : '#276749';
        }
    } else {
        calcEl.textContent = '';
        if (statusEl) statusEl.textContent = '';
    }
}

// ── Corrección automática error OCR: confusión coma decimal / punto miles (×1000) ──
// Ocurre cuando el OCR lee "1,230" (= 1,23 €) como separador de miles → 1230 €

function corregirErrorFactor1000IVA(campos) {
    const base  = parseAmount(campos.base_imponible);
    const pct   = parsePct(campos.iva_porcentaje);
    const cuota = parseAmount(campos.cuota_iva);
    const total = parseAmount(campos.total);

    if (base === null || pct === null || cuota === null) return;
    const cuotaEsperada = base * pct;          // pct ya viene normalizado (0.21 para 21%)
    if (cuotaEsperada <= 0) return;

    // Detectar error ×1000 en cuota_iva: ratio entre 950 y 1050
    const ratioCuota = cuota / cuotaEsperada;
    if (ratioCuota > 950 && ratioCuota < 1050) {
        campos.cuota_iva = (cuota / 1000).toFixed(2).replace('.', ',');
    }

    // Re-parsear cuota ya corregida y comprobar el total
    const cuotaFinal = parseAmount(campos.cuota_iva);
    if (cuotaFinal === null || total === null) return;

    const totalEsperado = base + cuotaFinal;
    if (totalEsperado <= 0) return;

    const ratioTotal = total / totalEsperado;
    if (ratioTotal > 950 && ratioTotal < 1050) {
        campos.total = (total / 1000).toFixed(2).replace('.', ',');
    }
}

// ── Modal de confirmación ─────────────────────────────────────────────────────

function showConfirmModal(previewId, campos, meta) {
    currentPreviewId = previewId;
    const missing = meta.missing_fields || [];
    const requiresReview = meta.requires_review || false;
    const invoiceType = meta.invoice_type || selectedInvoiceType;

    // Título según tipo de factura y estado
    const titleEl = document.querySelector('#confirm-modal h2');
    const descEl  = document.querySelector('#confirm-modal p');
    if (titleEl && descEl) {
        if (missing.length > 0) {
            titleEl.textContent = 'Completa los datos que faltan';
            titleEl.style.color = '#c53030';
            descEl.textContent = 'La IA no pudo leer algún campo. Introduce los datos manualmente o cancela para repetir la foto.';
        } else {
            titleEl.textContent = 'Confirma los datos';
            titleEl.style.color = '#276749';
            descEl.textContent = 'Revisa que la información extraída es correcta antes de guardar.';
        }
    }

    // Badge tipo de factura
    const typeBadgeEl = document.getElementById('confirm-invoice-type-badge');
    if (typeBadgeEl) {
        const isVenta = invoiceType === 'venta';
        typeBadgeEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:${isVenta ? '#6b46c1' : '#2b6cb0'};background:${isVenta ? '#e9d8fd' : '#ebf8ff'};padding:5px 12px;border-radius:20px;border:1px solid ${isVenta ? '#d6bcfa' : '#90cdf4'};">${isVenta ? '📤 Factura Emitida' : '📥 Factura Recibida'}</span>`;
    }

    // Labels según tipo de factura — adaptar ambas secciones
    const isVenta        = invoiceType === 'venta';
    const labelProveedor = document.getElementById('confirm-proveedor-label');
    const labelNif       = document.getElementById('confirm-nif-label');
    const labelReceptorSection = document.getElementById('confirm-receptor-section-label');
    if (labelProveedor) {
        labelProveedor.textContent = isVenta ? 'EMISOR (NUESTRA EMPRESA)' : 'PROVEEDOR / EMISOR';
    }
    if (labelNif) {
        labelNif.textContent = isVenta ? 'CIF / NIF EMISOR' : 'CIF / NIF PROVEEDOR';
    }
    if (labelReceptorSection) {
        labelReceptorSection.textContent = isVenta ? 'RECEPTOR / CLIENTE' : 'RECEPTOR (NUESTRA EMPRESA)';
    }
    const labelProveedorSection = document.getElementById('confirm-proveedor-section-label');
    if (labelProveedorSection) {
        labelProveedorSection.textContent = isVenta ? 'DATOS DEL EMISOR' : 'EMPRESA EN LA FACTURA (IA)';
    }

    // ── Sección PROVEEDOR/EMISOR ─────────────────────────────────────────────
    // Para factura VENTA: proveedor = nosotros (pre-relleno con datos empresa si OCR no lo tiene)
    // Para factura COMPRA: proveedor = la empresa que nos factura (OCR)
    const provEl = document.getElementById('confirm-proveedor');
    if (provEl) {
        if (isVenta) {
            // Emisor = nosotros → SIEMPRE BD (ignora OCR salvo si BD vacía como red de seguridad)
            provEl.value = userCompanyName || campos.proveedor_nombre || '';
        } else {
            provEl.value = campos.proveedor_nombre || '';
        }
    }

    // Badge proveedor conocido
    const badge = document.getElementById('confirm-known-badge');
    if (badge) badge.style.display = meta.known_provider ? 'block' : 'none';

    // Indicador autocorrección / sugerencia via company_relationships
    const relHint = document.getElementById('confirm-relationship-hint');
    if (relHint) {
        relHint.style.display = 'none';
        relHint.innerHTML = '';
        if (meta.ocr_corrected) {
            const c = meta.ocr_corrected;
            const plural = c.confirmations !== 1 ? 'es' : '';
            relHint.style.display = 'block';
            relHint.innerHTML = `<span style="font-size:11px;color:#276749;font-weight:600;display:inline-flex;align-items:center;gap:4px;background:#f0fff4;border:1px solid #c6f6d5;border-radius:4px;padding:2px 8px;">✓ Completado con datos conocidos <span style="font-weight:400;color:#48bb78;">(${c.confirmations} confirmación${plural})</span></span>`;
        } else if (meta.suggested_counterparty) {
            const s = meta.suggested_counterparty;
            const fieldLabel = s.field === 'receptor' ? 'cliente' : 'proveedor';
            const nameDisplay = [s.nombre, s.nif ? `(${s.nif})` : ''].filter(Boolean).join(' ');
            relHint.style.display = 'block';
            relHint.innerHTML = `<span style="font-size:11px;color:#744210;font-weight:600;">¿Es este ${fieldLabel}?</span> <button id="btn-apply-suggestion" type="button" style="font-size:11px;background:#fffbeb;border:1px solid #f6e05e;border-radius:4px;padding:2px 9px;cursor:pointer;color:#744210;font-weight:600;margin-left:4px;">${nameDisplay}</button>`;
            document.getElementById('btn-apply-suggestion')?.addEventListener('click', () => {
                if (s.field === 'receptor') {
                    if (s.nombre) document.getElementById('confirm-receptor-nombre').value = s.nombre;
                    if (s.nif)    document.getElementById('confirm-receptor-nif').value    = s.nif;
                } else {
                    if (s.nombre) document.getElementById('confirm-proveedor').value = s.nombre;
                    if (s.nif) {
                        document.getElementById('confirm-nif').value = s.nif;
                        updateCIFStatus(s.nif);
                    }
                }
                relHint.innerHTML = '<span style="font-size:11px;color:#276749;font-weight:600;background:#f0fff4;border:1px solid #c6f6d5;border-radius:4px;padding:2px 8px;">✓ Sugerencia aplicada</span>';
            });
        }
    }

    // ── Sección RECEPTOR / NUESTRA EMPRESA ───────────────────────────────────
    // Para factura COMPRA: receptor = nosotros (pre-relleno con datos empresa)
    // Para factura VENTA:  receptor = el cliente (OCR)
    // ADMIN + empresa cliente seleccionada: receptor = empresa cliente (prioridad absoluta)
    const receptorNombreEl = document.getElementById('confirm-receptor-nombre');
    const receptorNifEl    = document.getElementById('confirm-receptor-nif');
    if (receptorNombreEl && receptorNifEl) {
        if (isVenta) {
            // Para venta: el receptor es el cliente (extraído por OCR)
            receptorNombreEl.value = campos.receptor_nombre || '';
            receptorNifEl.value    = (campos.receptor_nif || '').toUpperCase().replace(/[\s\-\.]/g, '');
        } else {
            // Para compra: el receptor SOMOS NOSOTROS → SIEMPRE BD (la factura se asocia a
            // nuestra empresa, no a lo que diga el OCR). OCR queda como red de seguridad si
            // por algún motivo el perfil de empresa no se cargó.
            receptorNombreEl.value = userCompanyName || campos.receptor_nombre || '';
            receptorNifEl.value    = (userCompanyNif || campos.receptor_nif || '').toUpperCase().replace(/[\s\-\.]/g, '');
        }
    }

    // CIF editable del proveedor/emisor
    const nifInput = document.getElementById('confirm-nif');
    // Para venta: emisor = NOSOTROS → SIEMPRE BD (mismo criterio que el nombre)
    nifInput.value = isVenta
        ? (userCompanyNif || campos.proveedor_nif || '')
        : (campos.proveedor_nif || '');
    // En factura emitida (venta), el CIF del campo `confirm-nif` somos NOSOTROS y se
    // pre-rellena desde BD (userCompanyNif). En ese caso no marcamos rojo por "missing"
    // ni validamos algorítmicamente (algunos CIFs reales ya guardados pueden no pasar el
    // dígito de control estricto): mostramos un estado verde neutro "CIF de tu empresa".
    // Si el usuario edita manualmente el campo, el listener input sí ejecuta validación.
    const nifIsFromOwnCompany = isVenta && userCompanyNif &&
                                 nifInput.value === userCompanyNif;

    if (nifIsFromOwnCompany) {
        nifInput.style.borderColor = '#68d391';
        nifInput.style.background = '#f0fff4';
        const statusEl = document.getElementById('confirm-cif-status');
        statusEl.style.color = '#276749';
        statusEl.textContent = '✓ CIF de tu empresa';
    } else {
        if (missing.includes('proveedor_nif')) {
            nifInput.style.borderColor = '#e53e3e';
            nifInput.style.background = '#fff5f5';
            nifInput.placeholder = 'Introduce el CIF/NIF (obligatorio)';
        } else if (!meta.cif_confident) {
            nifInput.style.borderColor = '#d69e2e';
            nifInput.style.background = '#fffff0';
        } else {
            nifInput.style.borderColor = '#68d391';
            nifInput.style.background = '#f0fff4';
        }
        updateCIFStatus(nifInput.value);
    }

    document.getElementById('confirm-vies-status').textContent = '';

    // Número de factura editable
    const numFacturaInput = document.getElementById('confirm-numero-factura');
    if (numFacturaInput) {
        numFacturaInput.value = campos.numero_factura || '';
    }

    // Corregir error OCR ×1000 antes de mostrar valores al usuario
    corregirErrorFactor1000IVA(campos);

    // Fecha editable
    const fechaInput = document.getElementById('confirm-fecha');
    fechaInput.value = campos.fecha_emision || '';
    if (missing.includes('fecha_emision')) {
        fechaInput.style.borderColor = '#e53e3e';
        fechaInput.style.background = '#fff5f5';
        fechaInput.placeholder = 'DD/MM/AAAA (obligatorio)';
    } else {
        fechaInput.style.borderColor = '';
        fechaInput.style.background = '';
    }

    // Total editable
    const totalInput = document.getElementById('confirm-total');
    totalInput.value = campos.total || '';
    if (missing.includes('total')) {
        totalInput.style.borderColor = '#e53e3e';
        totalInput.style.background = '#fff5f5';
        totalInput.placeholder = '0,00 (obligatorio)';
    } else {
        totalInput.style.borderColor = '';
        totalInput.style.background = '';
    }

    // ── Sección IVA ────────────────────────────────────────────────────────
    document.getElementById('confirm-base').value = campos.base_imponible || '';
    document.getElementById('confirm-iva-pct').value = campos.iva_porcentaje || '';
    document.getElementById('confirm-cuota-iva').value = campos.cuota_iva || '';

    // IRPF: mostrar si OCR lo detectó O si el NIF del proveedor parece persona física
    const irpfPct   = campos.irpf_porcentaje || '0,0';
    const irpfCuota = campos.cuota_irpf      || '0,00';
    const hasIrpfValue = irpfPct !== '0,0' && irpfPct !== '0' && irpfCuota !== '0,00' && irpfCuota !== '0';
    // Detectar si el proveedor parece persona física (NIF: 8 dígitos + letra)
    const nifProvStr = (campos.proveedor_nif || '').toUpperCase().replace(/[\s\-\.]/g, '');
    const esPersonaFisica = /^\d{8}[A-Z]$/.test(nifProvStr) || /^[XYZ]\d{7}[A-Z]$/.test(nifProvStr);
    const showIrpf = hasIrpfValue || esPersonaFisica;

    const irpfSection   = document.getElementById('irpf-section');
    const irpfToggleRow = document.getElementById('irpf-toggle-row');
    if (irpfSection) {
        irpfSection.style.display = showIrpf ? 'flex' : 'none';
        document.getElementById('confirm-irpf-pct').value   = irpfPct;
        document.getElementById('confirm-cuota-irpf').value = irpfCuota;
    }
    // El botón toggle: ocultarlo si ya mostramos el IRPF automáticamente
    if (irpfToggleRow) irpfToggleRow.style.display = showIrpf ? 'none' : 'block';

    // Líneas IVA múltiple (informativo)
    const lineasEl = document.getElementById('confirm-lineas-iva');
    if (lineasEl && campos.lineas_iva && Array.isArray(campos.lineas_iva) && campos.lineas_iva.length > 1) {
        const lineasHtml = campos.lineas_iva.map(l =>
            `<div style="display:flex;justify-content:space-between;font-size:11px;padding:3px 0;border-bottom:1px solid #bee3f8;">
                <span style="color:#2b6cb0;">Base ${l.porcentaje}%:</span>
                <span>${l.base || '—'}</span>
                <span style="color:#2b6cb0;">Cuota:</span>
                <span style="font-weight:700;">${l.cuota || '—'}</span>
            </div>`
        ).join('');
        lineasEl.innerHTML = `<div style="font-size:10px;font-weight:700;color:#4a90d9;margin-bottom:4px;">DESGLOSE POR TIPO DE IVA</div>${lineasHtml}`;
        lineasEl.style.display = 'block';
    } else if (lineasEl) {
        lineasEl.style.display = 'none';
    }

    // Estado de validación IVA del backend
    const ivaStatusEl = document.getElementById('confirm-iva-status');
    if (ivaStatusEl && meta.iva_validation) {
        if (meta.iva_validation.valid) {
            ivaStatusEl.textContent = '✓ Correcto';
            ivaStatusEl.style.color = '#276749';
        } else if (meta.iva_validation.errors && meta.iva_validation.errors.length > 0) {
            ivaStatusEl.textContent = '⚠ Revisar';
            ivaStatusEl.style.color = '#c53030';
        }
    }

    // Calcular IVA en tiempo real
    updateIVACalc();

    // Limpiar mensaje previo
    document.getElementById('confirm-message').innerHTML = '';

    // Banner estado OCR — solo avisamos cuando NINGÚN motor leyó el NIF (input manual obligatorio)
    const ocrStatusEl = document.getElementById('confirm-ocr-status');
    if (ocrStatusEl) {
        if (meta.nif_status === 'both_missing') {
            ocrStatusEl.innerHTML = `<div style="background:#fff5f5;border:1px solid #fc8181;border-radius:8px;padding:10px 14px;font-size:13px;color:#742a2a;margin-bottom:0;">⚠ <strong>CIF/NIF no detectado por ninguna IA</strong> — Verifica e introduce manualmente el CIF o NIF del proveedor antes de confirmar.</div>`;
            ocrStatusEl.style.display = 'block';
        } else {
            ocrStatusEl.style.display = 'none';
        }
    }

    // Mostrar modal
    document.getElementById('confirm-modal').style.display = 'block';
    document.getElementById('confirm-modal').scrollTop = 0;
    // Sincronizar con history del navegador: el "atrás" del móvil/PC no debe sacar de la
    // PWA, debe cerrar el modal y dejar al usuario en la pantalla principal de captura.
    if (!_confirmHistoryActive) {
        history.pushState({ setexModal: 'confirm' }, '');
        _confirmHistoryActive = true;
    }
}

// ── Toggle IRPF manual ────────────────────────────────────────────────────────

function showIRPFSection() {
    const sec = document.getElementById('irpf-section');
    const row = document.getElementById('irpf-toggle-row');
    if (sec) sec.style.display = 'flex';
    if (row) row.style.display = 'none';
    // Poner foco en el campo porcentaje para que el usuario escriba directamente
    const el = document.getElementById('confirm-irpf-pct');
    if (el) { el.value = ''; el.focus(); }
    updateIVACalc();
}

function hideIRPFSection() {
    const sec = document.getElementById('irpf-section');
    const row = document.getElementById('irpf-toggle-row');
    if (sec) sec.style.display = 'none';
    if (row) row.style.display = 'block';
    // Resetear valores a cero para no enviarlos al backend
    const pct   = document.getElementById('confirm-irpf-pct');
    const cuota = document.getElementById('confirm-cuota-irpf');
    if (pct)   pct.value   = '0,0';
    if (cuota) cuota.value = '0,00';
    updateIVACalc();
}

// Flag: si abrimos el modal con history.pushState, lo dejamos consumir el "atrás".
// Si lo cerramos por flujo normal (Confirmar / Repetir / éxito), retrocedemos manualmente
// para limpiar la entrada extra del historial; el listener popstate ignora ese caso porque
// el modal ya está oculto.
let _confirmHistoryActive = false;

function _hideConfirmModalUI() {
    document.getElementById('confirm-modal').style.display = 'none';
    currentPreviewId = null;
    document.getElementById('upload-btn').disabled = false;
}

function _resetCaptureUI() {
    selectedFile = null;
    document.getElementById('preview').innerHTML = '';
    document.getElementById('file-input').value = '';
    document.getElementById('camera-input').value = '';
    document.getElementById('upload-btn').disabled = true;
}

function closeConfirmModal() {
    _hideConfirmModalUI();
    if (_confirmHistoryActive) {
        _confirmHistoryActive = false;
        history.back(); // limpia la entrada extra; popstate handler la ignora (modal oculto)
    }
}

// "✗ Repetir foto": cierra modal, descarta preview/file y abre la cámara directamente.
function repetirFoto() {
    closeConfirmModal();
    _resetCaptureUI();
    capturePhoto();
}

// Botón "atrás" del navegador con el modal abierto → cerrar modal, descartar preview y
// dejar al usuario en la pantalla principal de captura (NO abrir cámara — distinto de Repetir).
window.addEventListener('popstate', function() {
    const modal = document.getElementById('confirm-modal');
    if (modal && modal.style.display === 'block') {
        _confirmHistoryActive = false; // la entrada ya fue consumida por el navegador
        _hideConfirmModalUI();
        _resetCaptureUI();
    }
});

async function confirmUpload() {
    if (!currentPreviewId) return;

    const confirmed_nif             = document.getElementById('confirm-nif').value.trim().toUpperCase().replace(/[\s\-\.]/g, '');
    const confirmed_fecha           = document.getElementById('confirm-fecha').value.trim();
    const confirmed_total           = document.getElementById('confirm-total').value.trim();
    const confirmed_numero_factura  = document.getElementById('confirm-numero-factura')?.value?.trim() || '';
    // Nombres y NIFs de ambas partes (editables en el modal)
    const confirmed_proveedor_nombre = document.getElementById('confirm-proveedor')?.value?.trim() || '';
    const confirmed_receptor_nombre  = document.getElementById('confirm-receptor-nombre')?.value?.trim() || '';
    const confirmed_receptor_nif     = document.getElementById('confirm-receptor-nif')?.value?.trim().toUpperCase().replace(/[\s\-\.]/g, '') || '';
    // Campos IVA corregibles por el usuario
    const confirmed_base_imponible  = document.getElementById('confirm-base').value.trim();
    const confirmed_iva_porcentaje  = document.getElementById('confirm-iva-pct').value.trim();
    const confirmed_cuota_iva       = document.getElementById('confirm-cuota-iva').value.trim();
    const confirmed_irpf_porcentaje = document.getElementById('confirm-irpf-pct')?.value?.trim() || '';
    const confirmed_cuota_irpf      = document.getElementById('confirm-cuota-irpf')?.value?.trim() || '';

    const msgEl = document.getElementById('confirm-message');

    if (!confirmed_nif || !confirmed_fecha || !confirmed_total) {
        msgEl.innerHTML = '<p class="error">CIF/NIF, fecha y total son obligatorios</p>';
        return;
    }

    const btn = document.getElementById('btn-confirm-invoice');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    msgEl.innerHTML = '';

    try {
        const res = await Auth.apiFetch(`${API_URL}/upload-confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preview_id:              currentPreviewId,
                confirmed_nif,
                confirmed_fecha,
                confirmed_total,
                confirmed_numero_factura,
                confirmed_proveedor_nombre,
                confirmed_receptor_nombre,
                confirmed_receptor_nif,
                confirmed_base_imponible,
                confirmed_iva_porcentaje,
                confirmed_cuota_iva,
                confirmed_irpf_porcentaje,
                confirmed_cuota_irpf,
            })
        });

        if (res.status === 401 || res.status === 403) {
            closeConfirmModal();
            forceLogin();
            alert('Tu sesión ha expirado. Por favor, inicia sesión de nuevo.');
            return;
        }

        const data = await res.json();

        if (data.success) {
            closeConfirmModal();
            document.getElementById('message').innerHTML =
                `<p class="success">Factura guardada correctamente ✓ (${data.invoice_type === 'venta' ? 'Emitida' : 'Recibida'})</p>`;
            selectedFile = null;
            document.getElementById('preview').innerHTML = '';
            document.getElementById('file-input').value = '';
            document.getElementById('camera-input').value = '';
            selectedInvoiceType = 'compra'; // resetear a defecto
            setInvoiceType('compra');        // actualizar visual
            loadHistory();
        } else if (data.duplicate) {
            closeConfirmModal();
            document.getElementById('message').innerHTML = `<p class="warning">${data.error}</p>`;
        } else {
            msgEl.innerHTML = `<p class="error">${data.error || 'Error al guardar'}</p>`;
        }
    } catch (err) {
        msgEl.innerHTML = '<p class="error">Error de conexión. Comprueba tu internet.</p>';
    } finally {
        btn.disabled = false;
        btn.textContent = '✓ Confirmar y guardar';
    }
}

// ── Flujo principal de subida ─────────────────────────────────────────────────

async function uploadFile() {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('invoice_type', selectedInvoiceType); // ← tipo seleccionado por el usuario

    const msgEl = document.getElementById('message');

    try {
        document.getElementById('upload-btn').disabled = true;
        msgEl.innerHTML = '';

        const res = await Auth.apiFetch(`${API_URL}/upload-preview`, {
            method: 'POST',
            body: formData
        });

        if (res.status === 401 || res.status === 403) {
            forceLogin();
            alert('Tu sesión ha expirado. Por favor, inicia sesión de nuevo.');
            return;
        }

        const data = await res.json();

        if (data.preview) {
            msgEl.innerHTML = '';
            showConfirmModal(data.preview_id, data.campos, {
                cif_confident:          data.cif_confident,
                known_provider:         data.known_provider,
                vies_valid:             data.vies_valid,
                vies_nombre:            data.vies_nombre,
                nif_uncertain:          data.nif_uncertain,
                missing_fields:         data.missing_fields || [],
                requires_review:        data.requires_review || false,
                dual_confirmed:         data.dual_confirmed,
                nif_status:             data.nif_status || null,
                ocr_discrepancy:        data.ocr_discrepancy || null,
                invoice_type:           data.invoice_type || selectedInvoiceType,
                iva_validation:         data.iva_validation || null,
                ocr_corrected:          data.ocr_corrected || null,
                suggested_counterparty: data.suggested_counterparty || null,
            });
        } else {
            msgEl.innerHTML = `<p class="error">${data.error || 'Error al procesar la imagen'}</p>`;
            document.getElementById('upload-btn').disabled = false;
        }
    } catch (err) {
        msgEl.innerHTML = '<p class="error">Error de conexión. Comprueba tu conexión a internet.</p>';
        document.getElementById('upload-btn').disabled = false;
    }
}

// ── Event Listeners ───────────────────────────────────────────────────────────

document.getElementById('btn-login').addEventListener('click', login);
document.getElementById('link-register').addEventListener('click', function(e) { e.preventDefault(); showRegister(); });
document.getElementById('link-forgot').addEventListener('click', function(e) { e.preventDefault(); showForgotPassword(); });
document.getElementById('btn-register').addEventListener('click', register);
document.getElementById('link-login-from-register').addEventListener('click', function(e) { e.preventDefault(); showLogin(); });
document.getElementById('btn-forgot-send').addEventListener('click', forgotPassword);
document.getElementById('link-login-from-forgot').addEventListener('click', function(e) { e.preventDefault(); showLogin(); });
document.getElementById('btn-reset').addEventListener('click', resetPassword);
document.getElementById('btn-logout').addEventListener('click', logout);

// Captura/selección — ahora pasan por el selector de tipo
document.getElementById('btn-capture-photo').addEventListener('click', capturePhoto);
document.getElementById('btn-select-file').addEventListener('click', selectFile);
document.getElementById('file-input').addEventListener('change', handleFile);
document.getElementById('camera-input').addEventListener('change', handleFile);
document.getElementById('upload-btn').addEventListener('click', uploadFile);
document.getElementById('btn-close-camera').addEventListener('click', closeCamera);
document.getElementById('btn-take-photo').addEventListener('click', takePhoto);

// Selector de tipo de factura (inline, en pantalla principal)
const elTypeRecibida = document.getElementById('btn-type-recibida');
const elTypeEmitida  = document.getElementById('btn-type-emitida');
if (elTypeRecibida) elTypeRecibida.addEventListener('click', function() { setInvoiceType('compra'); });
if (elTypeEmitida)  elTypeEmitida.addEventListener('click',  function() { setInvoiceType('venta'); });

// Modal confirmación
const elConfirmBtn  = document.getElementById('btn-confirm-invoice');
const elCancelBtn   = document.getElementById('btn-cancel-invoice');
if (elConfirmBtn) elConfirmBtn.addEventListener('click', confirmUpload);
if (elCancelBtn)  elCancelBtn.addEventListener('click', repetirFoto);

// Validación en tiempo real del CIF
const elConfirmNif = document.getElementById('confirm-nif');
if (elConfirmNif) elConfirmNif.addEventListener('input', function() {
    const val = this.value.toUpperCase().replace(/[\s\-\.]/g, '');
    this.value = val;
    this.style.borderColor = '';
    this.style.background = '';
    updateCIFStatus(val);
    if (val.length === 9 && /^[A-Z]\d{7}[A-Z0-9]$/.test(val)) {
        lookupProveedorPorNIF(val);
    }
});

// Toggle IRPF manual
const elToggleIrpf = document.getElementById('btn-toggle-irpf');
const elRemoveIrpf = document.getElementById('btn-remove-irpf');
if (elToggleIrpf) elToggleIrpf.addEventListener('click', showIRPFSection);
if (elRemoveIrpf) elRemoveIrpf.addEventListener('click', hideIRPFSection);

// Validación IVA en tiempo real mientras el usuario edita
['confirm-base', 'confirm-iva-pct', 'confirm-cuota-iva', 'confirm-total', 'confirm-cuota-irpf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateIVACalc);
});

// Auto-capitalizar NIF en registro
document.getElementById('register-company-nif').addEventListener('input', function() {
    this.value = this.value.toUpperCase().replace(/[\s\-\.]/g, '');
});

// Historial
document.getElementById('btn-toggle-history').addEventListener('click', function() {
    const section = document.getElementById('history-section');
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    if (isHidden) renderHistoryTable(historyAllFacturas);
});
document.getElementById('btn-ver-mas').addEventListener('click', function() {
    historyShowAll = true;
    renderHistoryTable(historyAllFacturas);
});

// Pantalla de empresa pendiente de aprobación
const elPendingLogout = document.getElementById('btn-pending-logout');
const elPendingCheck  = document.getElementById('btn-pending-check');
if (elPendingLogout) elPendingLogout.addEventListener('click', logout);
if (elPendingCheck) elPendingCheck.addEventListener('click', checkCompanyStatus);

async function checkCompanyStatus() {
    // Sin sesión activa (caso: recién registrado, sin RT cookie) → redirigir al login.
    // Si la empresa fue aprobada, el admin habrá notificado y el usuario podrá hacer login.
    if (!Auth.isLoggedIn()) {
        document.getElementById('pending-approval-screen').style.display = 'none';
        document.getElementById('auth-screen').style.display = 'block';
        showLogin();
        return;
    }
    const btn = document.getElementById('btn-pending-check');
    if (btn) btn.textContent = 'Comprobando...';
    try {
        const res = await Auth.apiFetch(`${API_URL}/company/status`);
        if (!res.ok) { logout(); return; }
        const data = await res.json();
        if (data.status === 'active') {
            // Empresa aprobada — necesitamos sesión fresca con nuevo RT/AT.
            // Cerramos sesión y pedimos re-login para que el servidor emita nuevas cookies.
            await Auth.logout();
            token = null;
            document.getElementById('pending-approval-screen').style.display = 'none';
            document.getElementById('auth-screen').style.display = 'block';
            const loginMsg = document.getElementById('login-form');
            if (loginMsg) {
                const notice = document.createElement('p');
                notice.style.cssText = 'color:#38a169;font-weight:600;font-size:14px;margin-top:8px;';
                notice.textContent = '¡Tu empresa fue aprobada! Inicia sesión para acceder.';
                loginMsg.prepend(notice);
            }
            showLogin();
        } else {
            const infoDiv = document.getElementById('pending-company-info');
            if (infoDiv) infoDiv.innerHTML = (data.company_name ? `<strong>${data.company_name}</strong><br>` : '') + `<span style="font-size:12px;opacity:0.7;">Estado: pendiente de revisión</span>`;
            if (btn) btn.textContent = 'Verificar estado';
        }
    } catch {
        if (btn) btn.textContent = 'Verificar estado';
    }
}

// ── Init al cargar ────────────────────────────────────────────────────────────

// Inicializar visual del selector de tipo (Recibida activa por defecto)
setInvoiceType('compra');

// Callback para Auth.apiFetch: si el AT expira sin poder renovarse → mostrar login
window.__authOnLogout = function () {
    token = null;
    hideCompanyIdentity();
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('pending-approval-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'block';
    showLogin();
};

const urlParams = new URLSearchParams(window.location.search);
const resetToken = urlParams.get('token');

if (resetToken) {
    // Flujo de recuperación de contraseña — mostrar formulario de reset directamente
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'none';
    document.getElementById('reset-password-screen').style.display = 'block';
} else {
    // Intentar restaurar sesión via Refresh Token (cookie httpOnly)
    (async () => {
        const ok = await Auth.init();
        token = Auth.getToken();

        const next = urlParams.get('next');
        if (next === 'admin') {
            // Venimos de nginx porque no había cookie admin activa — limpiar URL
            window.history.replaceState({}, document.title, window.location.pathname);
            if (ok && Auth.isLoggedIn()) {
                const user = Auth.getUser();
                if (user && user.is_admin) {
                    // Auth.init() ya renovó la cookie setex_admin — podemos ir directo
                    window.location.href = '/admin-facturas.html';
                    return;
                }
            }
            // No autenticado o no es admin → guardar intención y mostrar login
            sessionStorage.setItem('postLoginRedirect', 'admin');
            return; // auth-screen visible por defecto
        }

        if (ok && token) {
            // Sesión restaurada → verificar estado de empresa antes de mostrar pantalla
            try {
                const statusRes = await Auth.apiFetch(`${API_URL}/company/status`);
                if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    if (statusData.status === 'pending') {
                        showPendingApprovalScreen(statusData.company_name, statusData.company_nif);
                    } else {
                        showMainScreen();
                    }
                } else {
                    showMainScreen(); // fallback seguro — requireActiveCompany filtrará en BD
                }
            } catch {
                showMainScreen();
            }
        }
        // else: auth-screen visible por defecto (display:block en HTML)
    })();
}
