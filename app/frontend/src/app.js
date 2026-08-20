const API_URL = window.location.origin + '/api';

// token: Access Token en memoria JS (nunca en localStorage/sessionStorage — inmune a XSS).
// Gestionado por window.Auth (auth.js). Se inicializa en el bloque init al final del archivo.
let token = null;
let selectedFile = null;
let currentPreviewId = null;
let userCompanyName = null;
let userCompanyNif = null;
let userIsAdmin = false;
let userIsTechAdmin = false; // 2026-07-27: botón de prueba de captura (sin persistir)
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
        userIsTechAdmin = data.is_tech_admin === true;
        showCompanyIdentity(data.company_name, data.is_admin === true, data.company_nif_aeat_warning === true);
        const btnTest = document.getElementById('btn-test-captura');
        if (btnTest) btnTest.style.display = userIsTechAdmin ? 'block' : 'none';
        // Multipágina abierto a todos (2026-08-13). El panel está oculto y se
        // abre desde el enlace "varias páginas" (ver listener de mp-open-link).
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

// ── Detección de documento en vivo ("modo documento", como cámaras móviles) ───
// Usa jscanify (OpenCV.js) para resaltar en vivo el contorno de la factura y
// recortar/enderezar la foto al capturar. Carga perezosa: las librerías (la
// de OpenCV.js pesa ~9 MB) solo se descargan al abrir la cámara, nunca en la
// carga inicial de la app. Módulo puramente ADITIVO: si algo falla al cargar
// o al detectar, se degrada en silencio a la captura estándar de siempre —
// nunca debe poder romper el flujo de "hacer la foto y subir la factura".
let docScanner = null;
let docScanLibsPromise = null;
let docScanLoopTimer = null;
let docScanActive = false;

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) { existing.dataset.loaded === 'true' ? resolve() : existing.addEventListener('load', resolve); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
        s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
        document.head.appendChild(s);
    });
}

function ensureDocScanLibs() {
    if (docScanLibsPromise) return docScanLibsPromise;
    docScanLibsPromise = (async () => {
        await loadScriptOnce('opencv.js?v=20260713-001');
        // 2026-07-23 — FIX de condición de carrera real (bug encontrado tras
        // reporte de Julio de que el modo documento "sigue igual", nunca se
        // ve el contorno): `loadScriptOnce` solo espera a que el <script> se
        // ejecute; el runtime WASM de opencv.js puede terminar de inicializar
        // ANTES de que este código llegue a asignar `cv.onRuntimeInitialized`.
        // El propio glue code de opencv.js dispara ese callback UNA SOLA VEZ,
        // en el instante exacto en que `calledRun` pasa a true — si ya pasó,
        // asignar el callback después nunca lo dispara, y la promesa se
        // quedaba colgada hasta el timeout de 15s (fallo silencioso).
        // Arreglo: usar `cv.then(...)`, que el propio opencv.js expone
        // precisamente para este caso — comprueba `calledRun` internamente y
        // llama al callback YA MISMO si el runtime ya estaba listo, o lo
        // encola si no. Es el mecanismo seguro documentado por Emscripten.
        await new Promise((resolve, reject) => {
            if (typeof cv !== 'undefined' && cv.Mat) { resolve(); return; }
            if (typeof cv === 'undefined' || typeof cv.then !== 'function') {
                reject(new Error('opencv.js cargado pero cv/cv.then no está definido'));
                return;
            }
            const timeout = setTimeout(() => reject(new Error('Timeout inicializando OpenCV.js')), 15000);
            cv.then(() => { clearTimeout(timeout); resolve(); });
        });
        await loadScriptOnce('jscanify.js?v=20260713-001');
        docScanner = new jscanify();
    })().catch(err => {
        console.warn('[DocScan] Detección de documento no disponible, se usa captura estándar:', err.message);
        docScanLibsPromise = null; // permite reintentar la próxima vez que se abra la cámara
        docScanner = null;
        throw err;
    });
    return docScanLibsPromise;
}

function startDocScanLoop() {
    ensureDocScanLibs().then(() => {
        docScanActive = true;
        docScanLoopTick();
    }).catch(() => {
        // Degradación silenciosa: el contorno guía no aparece, pero la
        // captura estándar sigue funcionando igual.
    });
}

function stopDocScanLoop() {
    docScanActive = false;
    if (docScanLoopTimer) { clearTimeout(docScanLoopTimer); docScanLoopTimer = null; }
    const overlay = document.getElementById('camera-scan-overlay');
    if (overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

// Downscale para detección en vivo ligera (móviles gama baja); la captura
// final (takePhoto) sí usa la resolución nativa completa del vídeo.
const DOC_SCAN_LIVE_WIDTH = 480;

function docScanLoopTick() {
    if (!docScanActive || !docScanner) return;
    try {
        const video = document.getElementById('camera-video');
        const overlay = document.getElementById('camera-scan-overlay');
        if (video.videoWidth > 0 && overlay) {
            const scale = Math.min(1, DOC_SCAN_LIVE_WIDTH / video.videoWidth);
            const dw = Math.round(video.videoWidth * scale);
            const dh = Math.round(video.videoHeight * scale);
            const tmp = document.createElement('canvas');
            tmp.width = dw; tmp.height = dh;
            tmp.getContext('2d').drawImage(video, 0, 0, dw, dh);

            const img = cv.imread(tmp);
            const contour = docScanner.findPaperContour(img);
            if (overlay.width !== video.videoWidth) overlay.width = video.videoWidth;
            if (overlay.height !== video.videoHeight) overlay.height = video.videoHeight;
            const ctx = overlay.getContext('2d');
            ctx.clearRect(0, 0, overlay.width, overlay.height);
            if (contour) {
                const c = docScanner.getCornerPoints(contour);
                if (c.topLeftCorner && c.topRightCorner && c.bottomLeftCorner && c.bottomRightCorner) {
                    const kx = overlay.width / dw, ky = overlay.height / dh;
                    const pts = [c.topLeftCorner, c.topRightCorner, c.bottomRightCorner, c.bottomLeftCorner];
                    ctx.strokeStyle = '#48bb78';
                    ctx.lineWidth = 6;
                    ctx.beginPath();
                    pts.forEach((p, i) => {
                        const x = p.x * kx, y = p.y * ky;
                        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                    });
                    ctx.closePath();
                    ctx.stroke();
                }
            }
            img.delete();
        }
    } catch (e) {
        // La detección en vivo es puramente cosmética: cualquier fallo se
        // ignora y la captura de foto normal sigue funcionando intacta.
    }
    docScanLoopTimer = setTimeout(docScanLoopTick, 400);
}

// ── Flash / linterna (2026-07-23, por defecto ON desde 2026-07-24) ──────────
// MediaStreamTrack.applyConstraints({torch}) — soportado en Chrome Android
// (desde 2017) y en Safari iOS 17.4+ (desde 2024, pese al mito extendido de
// que Apple nunca lo permite: solo la API ImageCapture completa está sin
// soportar en WebKit, el control de torch vía applyConstraints es aparte).
// Sin soporte en Firefox Android. El botón SOLO se muestra si el track
// activo confirma la capacidad. Se enciende automáticamente al abrir la
// cámara (si el dispositivo lo soporta); el usuario puede apagarlo a mano.
let flashOn = false;

async function setupFlashButton(track) {
    const btn = document.getElementById('btn-toggle-flash');
    if (!btn) return;
    flashOn = false;
    btn.classList.remove('is-on');
    btn.setAttribute('aria-label', 'Activar linterna');
    const capabilities = track.getCapabilities ? track.getCapabilities() : null;
    const supported = !!(capabilities && capabilities.torch);
    btn.style.display = supported ? 'inline-block' : 'none';
    if (!supported) { btn.onclick = null; return; }
    btn.onclick = async () => {
        const next = !flashOn;
        try {
            await track.applyConstraints({ advanced: [{ torch: next }] });
            flashOn = next;
            btn.classList.toggle('is-on', flashOn);
            btn.setAttribute('aria-label', flashOn ? 'Desactivar linterna' : 'Activar linterna');
        } catch (e) {
            // Fallo puntual del dispositivo al cambiar el torch (bug conocido en
            // gama baja Android): no debe romper la captura, solo se ignora.
            console.warn('[Flash] No se pudo cambiar el estado de la linterna:', e.message);
        }
    };
    try {
        await track.applyConstraints({ advanced: [{ torch: true }] });
        flashOn = true;
        btn.classList.add('is-on');
        btn.setAttribute('aria-label', 'Desactivar linterna');
    } catch (e) {
        console.warn('[Flash] No se pudo activar la linterna por defecto:', e.message);
    }
}

function resetFlashButton() {
    flashOn = false;
    const btn = document.getElementById('btn-toggle-flash');
    if (btn) { btn.style.display = 'none'; btn.classList.remove('is-on'); btn.onclick = null; }
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
                setupFlashButton(stream.getVideoTracks()[0]);
                video.addEventListener('loadedmetadata', startDocScanLoop, { once: true });
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
    stopDocScanLoop();
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    resetFlashButton();
    document.getElementById('camera-overlay').style.display = 'none';
}

function takePhoto() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    let extracted = null;
    if (docScanner) {
        try {
            extracted = docScanner.extractPaper(video, video.videoWidth, video.videoHeight);
        } catch (e) {
            extracted = null; // fallback silencioso a la captura estándar de todo el encuadre
        }
    }
    if (extracted) {
        canvas.width = extracted.width;
        canvas.height = extracted.height;
        canvas.getContext('2d').drawImage(extracted, 0, 0);
    } else {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
    }
    closeCamera();
    canvas.toBlob(function(blob) {
        if (!blob) return;
        if (modoPruebaCapturaActivo) {
            modoPruebaCapturaActivo = false;
            enviarCapturaDePrueba(blob);
            return;
        }
        const file = new File([blob], 'captura.jpg', { type: 'image/jpeg' });
        processFile(file);
    }, 'image/jpeg', 0.92);
}

// ── Botón de prueba (solo tech-admin, 2026-07-27) ────────────────────────────
// Ejecuta el flujo real de captura+OCR contra /api/test-captura — NUNCA se
// guarda nada (ni fichero ni registro), solo para verificar viabilidad.
let modoPruebaCapturaActivo = false;

function iniciarCapturaPrueba() {
    modoPruebaCapturaActivo = true;
    doCapturePhoto();
}

async function enviarCapturaDePrueba(blob) {
    const modal = document.getElementById('test-captura-modal');
    const contenido = document.getElementById('test-captura-resultado');
    if (!modal || !contenido) return;
    modal.style.display = 'flex';
    contenido.innerHTML = '<p>Procesando… (puede tardar unos segundos, es una llamada real a la IA)</p>';
    try {
        const formData = new FormData();
        formData.append('file', blob, 'prueba.jpg');
        const res = await Auth.apiFetch(`${API_URL}/test-captura`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        contenido.innerHTML = `
            <p style="color:#276749;font-weight:700;margin:0 0 8px;">✓ Flujo viable — ${data.aviso || 'nada se ha guardado'}</p>
            <p style="font-size:13px;color:#4a5568;margin:0 0 10px;">
                Tiempo: ${(data.tiempo_ms/1000).toFixed(2)}s · Motor: ${data.ocr_engine || '—'} ·
                Doble confirmado: ${data.dual_confirmed ? 'sí' : 'no'} · Confianza: ${data.confidence != null ? Math.round(data.confidence*100)+'%' : '—'}
            </p>
            <pre style="white-space:pre-wrap;font-size:12px;background:#f7fafc;padding:10px;border-radius:6px;max-height:300px;overflow:auto;">${JSON.stringify(data.campos, null, 2)}</pre>`;
    } catch (err) {
        contenido.innerHTML = `<p style="color:#c53030;font-weight:700;">✗ Error: ${err.message}</p>`;
    }
}

function cerrarModalPrueba() {
    const modal = document.getElementById('test-captura-modal');
    if (modal) modal.style.display = 'none';
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
    const uploadBtn = document.getElementById('upload-btn');
    uploadBtn.style.display = '';   // Enviar aparece al capturar (oculto en el estado limpio)
    uploadBtn.disabled = false;
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
    const banner = document.getElementById('confirm-descuadre-banner');

    const base   = parseAmount(document.getElementById('confirm-base').value);
    const pct    = parsePct(document.getElementById('confirm-iva-pct').value);
    const cuota  = parseAmount(document.getElementById('confirm-cuota-iva').value);
    const irpf   = parseAmount(document.getElementById('confirm-cuota-irpf').value) || 0;
    const total  = parseAmount(document.getElementById('confirm-total').value);

    const lines = [];
    const TOL = 0.05;
    let hasError = false; // bandera explícita y robusta (no depende del HTML)

    // Verificar base × % = cuota
    if (base !== null && pct !== null && cuota !== null) {
        const cuotaEsp = Math.round(base * pct * 100) / 100;
        const diff = Math.abs(cuotaEsp - cuota);
        const pctDisplay = (pct * 100).toFixed(1).replace('.', ',');
        if (diff <= TOL) {
            lines.push(`<span style="color:#276749;">✓ ${base.toFixed(2).replace('.', ',')} × ${pctDisplay}% = ${cuotaEsp.toFixed(2).replace('.', ',')}€</span>`);
        } else {
            hasError = true;
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
            hasError = true;
            lines.push(`<span style="color:#c53030;">✗ Base + IVA - IRPF = ${totalCalc.toFixed(2).replace('.', ',')}€ ≠ Total ${total.toFixed(2).replace('.', ',')}€</span>`);
        }
    }

    // Auto-calcular cuota si tenemos base y porcentaje pero no cuota
    if (base !== null && pct !== null && !document.getElementById('confirm-cuota-iva').value) {
        const auto = Math.round(base * pct * 100) / 100;
        lines.push(`<span style="color:#4a90d9;">ℹ Cuota calculada: ${auto.toFixed(2).replace('.', ',')}€</span>`);
    }

    if (calcEl) calcEl.innerHTML = lines.length > 0 ? lines.join('<br>') : '';
    if (statusEl) {
        statusEl.textContent = lines.length === 0 ? '' : (hasError ? '⚠ Revisar' : '✓ Correcto');
        statusEl.style.color = hasError ? '#c53030' : '#276749';
    }
    // Aviso prominente junto al botón de guardar (avisa, no bloquea). Se controla
    // SIEMPRE, con bandera explícita, para que nunca quede un aviso fantasma.
    if (banner) banner.style.display = hasError ? 'block' : 'none';
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
        // Mostrar SIEMPRE lo leído por el OCR (ambos lados). La validación contra
        // los datos del usuario logueado se hace en revalidateAndToggleSave():
        // si el CIF/nombre no coincide cuando debería, salta aviso y bloquea Save.
        provEl.value = campos.proveedor_nombre || (isVenta ? (userCompanyName || '') : '');
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
        // Mostrar lo leído por el OCR. Fallback al usuario solo si el OCR no
        // detectó nada Y la factura es del lado del usuario (compra→receptor).
        if (isVenta) {
            receptorNombreEl.value = campos.receptor_nombre || '';
            receptorNifEl.value    = (campos.receptor_nif || '').toUpperCase().replace(/[\s\-\.]/g, '');
        } else {
            receptorNombreEl.value = campos.receptor_nombre || userCompanyName || '';
            receptorNifEl.value    = (campos.receptor_nif || userCompanyNif || '').toUpperCase().replace(/[\s\-\.]/g, '');
        }
    }

    // CIF editable del proveedor/emisor — mostrar lo del OCR primero, fallback usuario
    const nifInput = document.getElementById('confirm-nif');
    nifInput.value = isVenta
        ? (campos.proveedor_nif || userCompanyNif || '')
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
    // Snap IVA % mono al renderizar (corrige errores OCR como 211 → 21)
    document.getElementById('confirm-iva-pct').value = snapToValidIvaRate(campos.iva_porcentaje) || (campos.iva_porcentaje || '');
    document.getElementById('confirm-cuota-iva').value = campos.cuota_iva || '';

    // IRPF: mostrar el cuadro plegable abierto si OCR lo detectó O si el NIF del proveedor parece persona física
    const irpfPct   = campos.irpf_porcentaje || '';
    const irpfCuota = campos.cuota_irpf      || '';
    const hasIrpfValue = (irpfPct && irpfPct !== '0,0' && irpfPct !== '0') || (irpfCuota && irpfCuota !== '0,00' && irpfCuota !== '0');
    // Detectar si el proveedor parece persona física (NIF: 8 dígitos + letra)
    const nifProvStr = (campos.proveedor_nif || '').toUpperCase().replace(/[\s\-\.]/g, '');
    const esPersonaFisica = /^\d{8}[A-Z]$/.test(nifProvStr) || /^[XYZ]\d{7}[A-Z]$/.test(nifProvStr);
    const showIrpf = hasIrpfValue || esPersonaFisica;

    document.getElementById('confirm-irpf-pct').value   = hasIrpfValue ? irpfPct : '';
    document.getElementById('confirm-cuota-irpf').value = hasIrpfValue ? irpfCuota : '';

    // Multi-IVA 2026-04-21 parte 3/7: decisión visual mono vs multi.
    // Si lineas_iva tiene 2+ tramos → vista multi con bloques editables por tramo.
    // Si no → vista mono (comportamiento actual).
    const isMultiIva = campos.lineas_iva && Array.isArray(campos.lineas_iva) && campos.lineas_iva.length >= 2;
    const monoEl    = document.getElementById('confirm-iva-mono');
    const multiEl   = document.getElementById('confirm-iva-multi');
    const calcEl    = document.getElementById('confirm-iva-calc');
    if (isMultiIva) {
        if (monoEl)    monoEl.style.display  = 'none';
        if (multiEl)   multiEl.style.display = 'block';
        if (calcEl)    calcEl.style.display  = 'none';
        renderLineasIvaMulti(campos.lineas_iva);
    } else {
        if (monoEl)    monoEl.style.display  = 'block';
        if (multiEl)   multiEl.style.display = 'none';
        if (calcEl)    calcEl.style.display  = 'block';
    }
    // Política 2026-04-30: cuadros plegados POR DEFECTO. Solo se abren si hay anomalía
    // detectada (cuenta que no cuadra o campo incompleto), para llamar la atención del usuario.
    const boxTramos = document.getElementById('box-tramos');
    if (boxTramos) boxTramos.open = tieneAnomaliaTramos();
    const boxIrpf = document.getElementById('box-irpf');
    if (boxIrpf) boxIrpf.open = tieneAnomaliaIrpf();

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
    // Forzar primer render del cuadro RESUMEN (en mono-IVA no se dispara solo,
    // los listeners 'input' solo reaccionan a edición del usuario, no a .value =).
    if (typeof updateLineasIvaSummary === 'function') updateLineasIvaSummary();

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

    // ── Validación CIF emisor/receptor con usuario logueado ──────────────────
    setupCifValidationListeners(invoiceType);
    revalidateAndToggleSave(invoiceType);

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

// ── Helpers de validación CIF emisor/receptor ───────────────────────────────
let _cifValidationListenersBound = false;

function setupCifValidationListeners(invoiceType) {
    if (_cifValidationListenersBound) return;
    const ids = ['confirm-nif', 'confirm-proveedor', 'confirm-receptor-nif', 'confirm-receptor-nombre'];
    ids.forEach(function (id) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', function () {
                const modal = document.getElementById('confirm-modal');
                const t = (modal && modal.dataset && modal.dataset.invoiceType) || invoiceType || 'compra';
                revalidateAndToggleSave(t);
            });
        }
    });
    _cifValidationListenersBound = true;
}

function revalidateAndToggleSave(invoiceType) {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.dataset.invoiceType = invoiceType || 'compra';
    if (typeof window === 'undefined' || !window.SetexCifValidator) return;
    const emisorNif      = (document.getElementById('confirm-nif') || {}).value || '';
    const emisorNombre   = (document.getElementById('confirm-proveedor') || {}).value || '';
    const receptorNif    = (document.getElementById('confirm-receptor-nif') || {}).value || '';
    const receptorNombre = (document.getElementById('confirm-receptor-nombre') || {}).value || '';
    const result = window.SetexCifValidator.validateInvoiceCifs({
        invoiceType: invoiceType,
        emisorNif: emisorNif.trim(),
        emisorNombre: emisorNombre.trim(),
        receptorNif: receptorNif.trim(),
        receptorNombre: receptorNombre.trim(),
        userNif: userCompanyNif,
        userNombre: userCompanyName
    });
    renderCifValidationMessages(result);
    toggleSaveButton(result.blocking);
}

function renderCifValidationMessages(result) {
    const container = document.getElementById('confirm-cif-validation');
    if (!container) return;
    if (!result.errors.length && !result.warnings.length) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }
    let html = '';
    result.errors.forEach(function (e) {
        html += '<div style="background:#fff5f5;border:1px solid #fc8181;border-radius:8px;padding:10px 14px;font-size:13px;color:#742a2a;margin-bottom:8px;line-height:1.4;">❌ ' + escapeHtmlSimple(e.message) + '</div>';
    });
    result.warnings.forEach(function (w) {
        html += '<div style="background:#fffbeb;border:1px solid #f6e05e;border-radius:8px;padding:10px 14px;font-size:13px;color:#744210;margin-bottom:8px;line-height:1.4;">⚠️ ' + escapeHtmlSimple(w.message) + '</div>';
    });
    container.innerHTML = html;
    container.style.display = 'block';
}

function toggleSaveButton(disabled) {
    const btn = document.getElementById('btn-confirm-invoice');
    if (!btn) return;
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.5' : '';
    btn.style.cursor  = disabled ? 'not-allowed' : '';
    btn.title = disabled ? 'Corrige los errores indicados antes de guardar' : '';
}

function escapeHtmlSimple(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Toggle IRPF manual ────────────────────────────────────────────────────────

function showIRPFSection() {
    const box = document.getElementById('box-irpf');
    if (box) box.open = true;
    const el = document.getElementById('confirm-irpf-pct');
    if (el && !el.value) el.focus();
    updateIVACalc();
    if (typeof updateLineasIvaSummary === 'function') updateLineasIvaSummary();
}

function hideIRPFSection() {
    const box = document.getElementById('box-irpf');
    if (box) box.open = false;
    // Resetear valores a vacío para no enviarlos al backend
    const pct   = document.getElementById('confirm-irpf-pct');
    const cuota = document.getElementById('confirm-cuota-irpf');
    if (pct)   pct.value   = '';
    if (cuota) cuota.value = '';
    updateIVACalc();
    if (typeof updateLineasIvaSummary === 'function') updateLineasIvaSummary();
}

// Flag: si abrimos el modal con history.pushState, lo dejamos consumir el "atrás".
// Si lo cerramos por flujo normal (Confirmar / Repetir / éxito), retrocedemos manualmente
// para limpiar la entrada extra del historial; el listener popstate ignora ese caso porque
// el modal ya está oculto.
let _confirmHistoryActive = false;

function _hideConfirmModalUI() {
    document.getElementById('confirm-modal').style.display = 'none';
    currentPreviewId = null;
    const b = document.getElementById('upload-btn');
    b.disabled = false;
    if (selectedFile) b.style.display = ''; // volver al preview con Enviar disponible
}

function _resetCaptureUI() {
    selectedFile = null;
    document.getElementById('preview').innerHTML = '';
    document.getElementById('file-input').value = '';
    document.getElementById('camera-input').value = '';
    const b = document.getElementById('upload-btn');
    b.disabled = true;
    b.style.display = 'none'; // vuelve al estado limpio (sin Enviar)
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

// ── Multi-IVA 2026-04-21 parte 3/7 ──────────────────────────────────────────
// Renderiza bloques editables por tramo cuando la factura tiene varios IVAs.
// Cada bloque permite editar IVA % / base / cuota.

function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escHtmlF(s) { return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

// ── Snap IVA % a {21, 10, 4, 0} ───────────────────────────────────────────
// España solo admite estos 4 tipos. Si OCR lee "211" → 21; "9.5" → 10; "3" → 4.
// Acepta entrada en cualquier formato (string/number, con coma o punto, con %)
// y devuelve un string con el entero válido más cercano. Devuelve '' si no parsea.
const IVA_RATES_VALIDOS = [21, 10, 4, 0];
function snapToValidIvaRate(raw) {
    if (raw === null || raw === undefined || raw === '') return '';
    const clean = String(raw).replace(',', '.').replace('%', '').trim();
    let n = parseFloat(clean);
    if (!Number.isFinite(n)) return '';
    // Normalizar 0.21 → 21 si vino como decimal
    if (n > 0 && n < 1) n = n * 100;
    let bestRate = IVA_RATES_VALIDOS[0];
    let bestDist = Math.abs(n - bestRate);
    for (const r of IVA_RATES_VALIDOS) {
        const d = Math.abs(n - r);
        if (d < bestDist) { bestDist = d; bestRate = r; }
    }
    return String(bestRate);
}

// Deduplica tramos por IVA % (snappeado) y limita a 4 tramos máximo.
// Conserva la PRIMERA ocurrencia de cada % — el caso típico es OCR leyendo
// dos veces el mismo tramo con valores idénticos. Tramos con % no parseable se descartan.
function dedupeAndCapTramos(lineas) {
    if (!Array.isArray(lineas)) return lineas;
    const seen = new Set();
    const out = [];
    for (const l of lineas) {
        const pct = snapToValidIvaRate(l && l.porcentaje);
        if (pct === '') continue;
        if (seen.has(pct)) continue;
        if (out.length >= IVA_RATES_VALIDOS.length) break;
        seen.add(pct);
        out.push({ ...l, porcentaje: pct });
    }
    return out;
}

// Devuelve el primer % de IVA_RATES_VALIDOS que NO está presente en los tramos
// actuales (útil para el botón "Añadir tramo"). null si los 4 ya están.
function firstAvailableRate(lineas) {
    const used = new Set((Array.isArray(lineas) ? lineas : []).map(l => snapToValidIvaRate(l && l.porcentaje)));
    for (const r of IVA_RATES_VALIDOS) {
        if (!used.has(String(r))) return String(r);
    }
    return null;
}

// Tolerancia para comparar cuotas (céntimos de euro)
const COHERENCIA_TOL_EUR = 0.02;
function round2(n) { return Math.round(n * 100) / 100; }

// Detecta si el bloque de tramos tiene alguna anomalía aritmética o campos vacíos.
// Cubre tanto multi-IVA (lista de tramos) como mono-IVA (los inputs Base/IVA%/Cuota directos).
function tieneAnomaliaTramos() {
    const multiEl = document.getElementById('confirm-iva-multi');
    const isMultiVisible = multiEl && multiEl.style.display !== 'none';
    if (isMultiVisible) {
        const lineas = readLineasIvaFromUI();
        if (!Array.isArray(lineas) || lineas.length === 0) return true; // multi visible sin tramos = anomalía
        for (const l of lineas) {
            if (!l.base || !l.cuota || !l.porcentaje) return true;
            const base  = parseSummaryNum(l.base);
            const cuota = parseSummaryNum(l.cuota);
            const pctSnapped = snapToValidIvaRate(l.porcentaje);
            const pct = pctSnapped !== '' ? parseFloat(pctSnapped) : NaN;
            if (!Number.isFinite(base) || !Number.isFinite(pct) || !Number.isFinite(cuota)) return true;
            const cuotaCalc = round2(base * pct / 100);
            if (Math.abs(cuota - cuotaCalc) > COHERENCIA_TOL_EUR) return true;
        }
        return false;
    }
    // Modo mono-IVA
    const baseRaw  = (document.getElementById('confirm-base')?.value || '').trim();
    const pctRaw   = (document.getElementById('confirm-iva-pct')?.value || '').trim();
    const cuotaRaw = (document.getElementById('confirm-cuota-iva')?.value || '').trim();
    if (!baseRaw && !pctRaw && !cuotaRaw) return false; // sin datos → no es anomalía aún
    if (!baseRaw || !pctRaw || !cuotaRaw) return true;  // alguno vacío → anomalía
    const base  = parseSummaryNum(baseRaw);
    const cuota = parseSummaryNum(cuotaRaw);
    const pctSnapped = snapToValidIvaRate(pctRaw);
    const pct = pctSnapped !== '' ? parseFloat(pctSnapped) : NaN;
    if (!Number.isFinite(base) || !Number.isFinite(pct) || !Number.isFinite(cuota)) return true;
    const cuotaCalc = round2(base * pct / 100);
    return Math.abs(cuota - cuotaCalc) > COHERENCIA_TOL_EUR;
}

// Detecta anomalía en IRPF: hay valor parcial, valor sin cuadre, o cuota ≠ base × irpf% / 100.
function tieneAnomaliaIrpf() {
    const irpfPctRaw = (document.getElementById('confirm-irpf-pct')?.value || '').trim();
    const cuotaIrpfRaw = (document.getElementById('confirm-cuota-irpf')?.value || '').trim();
    // Sin nada → sin anomalía (cuadro plegado).
    if (!irpfPctRaw && !cuotaIrpfRaw) return false;
    // Solo uno de los dos → anomalía (incompleto).
    if (!irpfPctRaw || !cuotaIrpfRaw) return true;
    const pct = parseFloat(String(irpfPctRaw).replace(',', '.'));
    const cuotaIrpf = parseSummaryNum(cuotaIrpfRaw);
    if (!Number.isFinite(pct) || !Number.isFinite(cuotaIrpf)) return true;
    // Base total para el cálculo: suma de tramos en multi, confirm-base en mono.
    const multiEl = document.getElementById('confirm-iva-multi');
    const isMultiVisible = multiEl && multiEl.style.display !== 'none';
    let baseTotal = 0;
    if (isMultiVisible) {
        const lineas = readLineasIvaFromUI() || [];
        lineas.forEach(l => baseTotal += parseSummaryNum(l.base));
    } else {
        baseTotal = parseSummaryNum(document.getElementById('confirm-base')?.value || '');
    }
    if (!Number.isFinite(baseTotal) || baseTotal <= 0) return true;
    const cuotaCalc = round2(baseTotal * pct / 100);
    return Math.abs(cuotaIrpf - cuotaCalc) > COHERENCIA_TOL_EUR;
}

// Devuelve true si el tramo cuadra (CUOTA ≈ BASE × IVA% / 100 con tolerancia 0,02€).
// Si algún valor falta o no es numérico, devuelve null (estado indeterminado, no aviso).
function tramoCuadra(base, pct, cuota) {
    if (!Number.isFinite(base) || !Number.isFinite(pct) || !Number.isFinite(cuota)) return null;
    const cuotaCalc = round2(base * pct / 100);
    return Math.abs(cuota - cuotaCalc) <= COHERENCIA_TOL_EUR;
}

// Muestra/oculta el banner de aviso de un bloque-tramo según su coherencia actual.
// Banner visible solo si los 3 campos están rellenos y los números no cuadran.
function updateTramoWarning(block) {
    if (!block) return;
    const elBase  = block.querySelector('input[data-kind="base"]');
    const elPct   = block.querySelector('input[data-kind="porcentaje"]');
    const elCuota = block.querySelector('input[data-kind="cuota"]');
    const warning = block.querySelector('.tramo-warning');
    if (!elBase || !elPct || !elCuota || !warning) return;
    // Si algún campo está vacío, ocultamos (el usuario aún está rellenando).
    if (!elBase.value.trim() || !elPct.value.trim() || !elCuota.value.trim()) {
        warning.style.display = 'none';
        return;
    }
    const base  = parseSummaryNum(elBase.value);
    const cuota = parseSummaryNum(elCuota.value);
    const pctSnapped = snapToValidIvaRate(elPct.value);
    const pct = pctSnapped !== '' ? parseFloat(pctSnapped) : NaN;
    const cuadra = tramoCuadra(base, pct, cuota);
    warning.style.display = cuadra === false ? 'block' : 'none';
}
// Itera todos los bloques visibles y actualiza sus avisos.
function updateAllTramosWarnings() {
    document.querySelectorAll('#confirm-lineas-iva-blocks .lineas-iva-block').forEach(updateTramoWarning);
}

// Recalcula CUOTA o BASE en un bloque-tramo según la regla CUOTA = BASE × IVA% / 100.
// kind = 'base' | 'cuota' | 'porcentaje' indica qué campo cambió el usuario.
// Si IVA% es snappeable y los otros valores numéricos, ajusta el campo derivado.
function recalcCoherenciaTramo(block, kind) {
    if (!block) return;
    const elBase  = block.querySelector('input[data-kind="base"]');
    const elPct   = block.querySelector('input[data-kind="porcentaje"]');
    const elCuota = block.querySelector('input[data-kind="cuota"]');
    if (!elBase || !elPct || !elCuota) return;
    const pctSnapped = snapToValidIvaRate(elPct.value);
    if (pctSnapped === '') return;
    const pct = parseFloat(pctSnapped);

    if (kind === 'base' || kind === 'porcentaje') {
        // BASE × IVA% → CUOTA
        const base = parseSummaryNum(elBase.value);
        if (!Number.isFinite(base)) return;
        if (document.activeElement === elCuota) return; // no pisar lo que el usuario edita
        elCuota.value = fmtSummaryNum(round2(base * pct / 100));
    } else if (kind === 'cuota') {
        // CUOTA × 100 / IVA% → BASE  (si IVA% > 0)
        if (pct <= 0) return;
        const cuota = parseSummaryNum(elCuota.value);
        if (!Number.isFinite(cuota)) return;
        if (document.activeElement === elBase) return;
        elBase.value = fmtSummaryNum(round2(cuota * 100 / pct));
    }
}

function renderLineasIvaMulti(lineas) {
    const container = document.getElementById('confirm-lineas-iva-blocks');
    if (!container) return;
    // Deduplica por IVA % y limita a 4 tramos antes de renderizar.
    // Caso típico: OCR lee dos veces el mismo tramo (valores duplicados).
    const safeLineas = dedupeAndCapTramos(lineas) || [];
    container.innerHTML = safeLineas.map((l, idx) => {
        // El % ya viene snappeado desde dedupeAndCapTramos
        const pctSnapped = l.porcentaje;
        return `
        <div class="lineas-iva-block" data-tramo="${idx}" style="border:1px solid #bee3f8; border-radius:6px; background:#fff; padding:10px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:10px; font-weight:700; color:#2b6cb0; letter-spacing:.05em;">TRAMO ${idx + 1}</span>
            <button type="button" class="btn-del-tramo" data-tramo="${idx}" title="Eliminar tramo"
                    style="background:transparent; border:1px solid #fbd38d; border-radius:4px; padding:4px 10px; font-size:12px; color:#c05621; cursor:pointer;">✕ Eliminar tramo</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#4a90d9; margin-bottom:3px;">IVA %</label>
              <input type="text" data-kind="porcentaje" data-tramo="${idx}" value="${escAttr(pctSnapped)}"
                     maxlength="3" placeholder="21" inputmode="numeric"
                     style="width:100%; font-size:14px; padding:7px 10px; border:1px solid #90cdf4; border-radius:6px; text-align:center; font-weight:700; box-sizing:border-box;" />
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#4a90d9; margin-bottom:3px;">BASE TRAMO (€)</label>
              <input type="text" data-kind="base" data-tramo="${idx}" value="${escAttr(l.base || '')}"
                     maxlength="15" placeholder="0,00"
                     style="width:100%; font-size:14px; padding:7px 10px; border:1px solid #90cdf4; border-radius:6px; box-sizing:border-box;" />
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#4a90d9; margin-bottom:3px;">CUOTA TRAMO (€)</label>
              <input type="text" data-kind="cuota" data-tramo="${idx}" value="${escAttr(l.cuota || '')}"
                     maxlength="15" placeholder="0,00"
                     style="width:100%; font-size:14px; padding:7px 10px; border:1px solid #90cdf4; border-radius:6px; box-sizing:border-box;" />
            </div>
          </div>
          <div class="tramo-warning" style="display:none; margin-top:8px; padding:8px 10px; background:#fff5f5; border:1px solid #fc8181; border-radius:4px; font-size:12px; color:#c53030; font-weight:600;">
            ⚠ Revisar este tramo: la cuota no cuadra con BASE × IVA % ÷ 100.
          </div>
        </div>`;
    }).join('');

    // Botón global para añadir tramo nuevo. Solo se permite si quedan tipos de IVA libres.
    // Como máximo 4 tramos: uno por cada valor de IVA_RATES_VALIDOS (21, 10, 4, 0).
    const nextRate = firstAvailableRate(safeLineas);
    const allFull = nextRate === null;
    const btnAddTramoHtml = allFull
      ? `<div style="font-size:11px; color:#718096; text-align:center; padding:6px;">Ya tienes los 4 tipos de IVA posibles (21, 10, 4 y 0).</div>`
      : `<button type="button" id="btn-add-tramo" data-next-rate="${nextRate}"
                style="width:100%; margin-top:4px; background:#f0fff4; border:1px dashed #68d391; color:#276749; border-radius:4px; padding:6px 10px; font-size:12px; cursor:pointer;">
          ➕ Añadir tramo al ${nextRate}%
        </button>`;
    container.insertAdjacentHTML('beforeend', btnAddTramoHtml);

    // Event delegation (una sola vez por render)
    container.onclick = (e) => {
        const t = e.target;
        if (t.classList.contains('btn-del-tramo')) {
            const tramo = parseInt(t.dataset.tramo, 10);
            const lineasActuales = readLineasIvaFromUI();
            lineasActuales.splice(tramo, 1);
            renderLineasIvaMulti(lineasActuales);
            updateLineasIvaSummary();
        } else if (t.id === 'btn-add-tramo') {
            const lineasActuales = readLineasIvaFromUI();
            const nextRate = t.dataset.nextRate || firstAvailableRate(lineasActuales);
            if (nextRate === null) return;
            lineasActuales.push({ porcentaje: nextRate, base: '', cuota: '' });
            renderLineasIvaMulti(lineasActuales);
            updateLineasIvaSummary();
        }
    };
    container.oninput = (e) => {
        // Coherencia matemática: CUOTA = BASE × IVA% / 100. Si cambia BASE → recalcular CUOTA.
        // Si cambia CUOTA → recalcular BASE (asume IVA% válido).
        const t = e && e.target;
        if (t && t.dataset && (t.dataset.kind === 'base' || t.dataset.kind === 'cuota')) {
            const block = t.closest('.lineas-iva-block');
            recalcCoherenciaTramo(block, t.dataset.kind);
            updateTramoWarning(block);
        }
        updateLineasIvaSummary();
    };
    // Snap + dedupe + recálculo CUOTA del IVA % al perder foco.
    container.addEventListener('focusout', (e) => {
        const t = e.target;
        if (!t || !t.dataset || t.dataset.kind !== 'porcentaje') return;
        const snapped = snapToValidIvaRate(t.value);
        if (snapped === '') return;
        if (t.value !== snapped) t.value = snapped;
        // Tras snap, recalcular CUOTA del bloque a partir de BASE × IVA% / 100.
        const block = t.closest('.lineas-iva-block');
        recalcCoherenciaTramo(block, 'porcentaje');
        updateTramoWarning(block);
        const before = readLineasIvaFromUI() || [];
        const after = dedupeAndCapTramos(before);
        if (after.length !== before.length) {
            renderLineasIvaMulti(after);
        }
        updateLineasIvaSummary();
    });

    updateLineasIvaSummary();
    // Al renderizar (incluido tras OCR), evaluar avisos de cada tramo.
    updateAllTramosWarnings();
}

function readLineasIvaFromUI() {
    const multiEl = document.getElementById('confirm-iva-multi');
    if (!multiEl || multiEl.style.display === 'none') return null;
    const blocks = multiEl.querySelectorAll('.lineas-iva-block');
    if (blocks.length === 0) return [];
    const out = [];
    blocks.forEach((block) => {
        const tramoIdx = block.dataset.tramo;
        const base       = block.querySelector(`input[data-kind="base"][data-tramo="${tramoIdx}"]`)?.value.trim() || '';
        const porcentaje = block.querySelector(`input[data-kind="porcentaje"][data-tramo="${tramoIdx}"]`)?.value.trim() || '';
        const cuota      = block.querySelector(`input[data-kind="cuota"][data-tramo="${tramoIdx}"]`)?.value.trim() || '';
        out.push({ base, porcentaje, cuota });
    });
    return out;
}

// Helper compartido: parsea un importe en formato español (1.234,56 / 1234,56 / 1234.56)
function parseSummaryNum(s) {
    if (s === null || s === undefined || s === '') return 0;
    const clean = String(s).replace(/\./g, '').replace(',', '.').replace(/[€$\s]/g, '');
    const n = parseFloat(clean);
    return Number.isFinite(n) ? n : 0;
}
function fmtSummaryNum(n) {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Flag para evitar bucles cuando un listener escribe en otro input que dispara su propio listener.
let _summarySyncing = false;
// Flag para garantizar que los listeners sobre #confirm-total y #confirm-cuota-irpf
// (campos "de arriba" en el modal) se conectan UNA sola vez aunque el resumen se re-renderice.
let _topLevelSummaryListenersWired = false;

function updateLineasIvaSummary() {
    const summaryEl = document.getElementById('confirm-lineas-iva-summary');
    if (!summaryEl) return;

    // Fuente de Base y Cuota IVA según el modo activo:
    //   - Multi-IVA visible → suma de tramos (fuente de verdad).
    //   - Mono-IVA visible → confirm-base / confirm-cuota-iva.
    // Cuota IRPF y Total se leen de los campos "de arriba" del modal (linkados).
    const multiEl = document.getElementById('confirm-iva-multi');
    const isMultiVisible = multiEl && multiEl.style.display !== 'none';
    let sumBase = 0, sumCuota = 0;
    if (isMultiVisible) {
        const lineas = readLineasIvaFromUI() || [];
        lineas.forEach((l) => {
            sumBase  += parseSummaryNum(l.base);
            sumCuota += parseSummaryNum(l.cuota);
        });
    } else {
        sumBase  = parseSummaryNum(document.getElementById('confirm-base')?.value || '');
        sumCuota = parseSummaryNum(document.getElementById('confirm-cuota-iva')?.value || '');
    }
    const irpf  = Math.abs(parseSummaryNum(document.getElementById('confirm-cuota-irpf')?.value || ''));
    const total = sumBase + sumCuota - irpf;

    // Solo recreamos el HTML si los inputs aún no existen (primer render).
    // Base y Cuota IVA son readonly (siempre coinciden con suma de tramos / mono).
    // Cuota IRPF y Total son editables y bidireccionales con confirm-cuota-irpf y confirm-total.
    const existingBase = summaryEl.querySelector('#summary-base');
    if (!existingBase) {
        summaryEl.innerHTML = `
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <label for="summary-base" style="color:#2c5282; font-weight:600;">Base</label>
              <input type="text" id="summary-base" readonly tabindex="-1"
                     title="Calculado desde los tramos. Edita los tramos para cambiar este valor."
                     style="width:130px; font-size:14px; padding:6px 8px; border:1px solid #cbd5e0; border-radius:6px; background:#f7fafc; color:#2c5282; text-align:right; box-sizing:border-box;" />
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <label for="summary-cuota-iva" style="color:#2c5282; font-weight:600;">Cuota IVA</label>
              <input type="text" id="summary-cuota-iva" readonly tabindex="-1"
                     title="Suma de las cuotas de los tramos. Edita los tramos para cambiar este valor."
                     style="width:130px; font-size:14px; padding:6px 8px; border:1px solid #cbd5e0; border-radius:6px; background:#f7fafc; color:#2c5282; text-align:right; box-sizing:border-box;" />
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <label for="summary-cuota-irpf" style="color:#c05621; font-weight:600;">Cuota IRPF</label>
              <input type="text" id="summary-cuota-irpf" inputmode="decimal" maxlength="15"
                     style="width:130px; font-size:14px; padding:6px 8px; border:1px solid #fbd38d; border-radius:6px; background:#fff; text-align:right; color:#c05621; box-sizing:border-box;" />
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; border-top:1px solid #bee3f8; padding-top:8px; margin-top:2px;">
              <label for="summary-total" style="color:#1a365d; font-weight:700;">Total</label>
              <input type="text" id="summary-total" inputmode="decimal" maxlength="15"
                     style="width:130px; font-size:15px; font-weight:700; padding:6px 8px; border:1px solid #1a365d; border-radius:6px; background:#fff; text-align:right; color:#1a365d; box-sizing:border-box;" />
            </div>
          </div>`;
        wireSummaryInputs();
    }

    // Actualizamos valores SIN disparar listeners propios: usamos el flag _summarySyncing.
    // Total siempre cuadra: Total = Base + Cuota IVA - Cuota IRPF.
    // No sobreescribimos un input mientras el usuario lo está editando (foco activo).
    _summarySyncing = true;
    try {
        const elBase = summaryEl.querySelector('#summary-base');
        const elCuotaIva = summaryEl.querySelector('#summary-cuota-iva');
        const elIrpf = summaryEl.querySelector('#summary-cuota-irpf');
        const elTotal = summaryEl.querySelector('#summary-total');
        const elTopTotal = document.getElementById('confirm-total');
        elBase.value     = fmtSummaryNum(sumBase);
        elCuotaIva.value = fmtSummaryNum(sumCuota);
        if (document.activeElement !== elIrpf)     elIrpf.value     = irpf > 0 ? `-${fmtSummaryNum(irpf)}` : fmtSummaryNum(0);
        if (document.activeElement !== elTotal)    elTotal.value    = fmtSummaryNum(total);
        if (elTopTotal && document.activeElement !== elTopTotal) elTopTotal.value = fmtSummaryNum(total);
    } finally {
        _summarySyncing = false;
    }
}

// Conecta los listeners de los 4 inputs del resumen.
// Bidireccional: editar IRPF/Total propaga a #confirm-cuota-irpf / #confirm-total y viceversa.
// Editar Base, Cuota IVA o IRPF recalcula Total. Editar Total NO recalcula otras (cuadre manual).
function wireSummaryInputs() {
    const elBase     = document.getElementById('summary-base');
    const elCuotaIva = document.getElementById('summary-cuota-iva');
    const elIrpf     = document.getElementById('summary-cuota-irpf');
    const elTotal    = document.getElementById('summary-total');
    const elTopTotal = document.getElementById('confirm-total');
    const elTopIrpf  = document.getElementById('confirm-cuota-irpf');
    if (!elBase || !elCuotaIva || !elIrpf || !elTotal) return;

    // Base y Cuota IVA del resumen son READONLY: siempre se calculan desde los tramos
    // (multi-IVA) o desde confirm-base/confirm-cuota-iva (mono). No tienen listener.

    const recalcTotal = () => {
        const b = parseSummaryNum(elBase.value);
        const ci = parseSummaryNum(elCuotaIva.value);
        const ir = Math.abs(parseSummaryNum(elIrpf.value));
        const t = b + ci - ir;
        _summarySyncing = true;
        try {
            if (document.activeElement !== elTotal)    elTotal.value    = fmtSummaryNum(t);
            if (elTopTotal && document.activeElement !== elTopTotal) elTopTotal.value = fmtSummaryNum(t);
        } finally { _summarySyncing = false; }
    };

    elIrpf.addEventListener('input', () => {
        if (_summarySyncing) return;
        const ir = Math.abs(parseSummaryNum(elIrpf.value));
        _summarySyncing = true;
        try {
            if (elTopIrpf && document.activeElement !== elTopIrpf) elTopIrpf.value = ir > 0 ? fmtSummaryNum(ir) : '';
        } finally { _summarySyncing = false; }
        recalcTotal();
        if (typeof updateIVACalc === 'function') updateIVACalc();
    });

    elTotal.addEventListener('input', () => {
        if (_summarySyncing) return;
        const t = parseSummaryNum(elTotal.value);
        _summarySyncing = true;
        try {
            if (elTopTotal && document.activeElement !== elTopTotal) elTopTotal.value = fmtSummaryNum(t);
        } finally { _summarySyncing = false; }
        if (typeof updateIVACalc === 'function') updateIVACalc();
    });

    // Inversa: si el usuario edita los campos de arriba, reflejamos en el resumen.
    // Solo conectamos UNA vez aunque el resumen se re-renderice.
    if (!_topLevelSummaryListenersWired) {
        if (elTopIrpf) elTopIrpf.addEventListener('input', () => {
            if (_summarySyncing) return;
            const elIrpfNow = document.getElementById('summary-cuota-irpf');
            if (!elIrpfNow) return;
            const ir = parseSummaryNum(elTopIrpf.value);
            _summarySyncing = true;
            try {
                if (document.activeElement !== elIrpfNow) elIrpfNow.value = ir > 0 ? `-${fmtSummaryNum(ir)}` : fmtSummaryNum(0);
            } finally { _summarySyncing = false; }
            const elBaseNow = document.getElementById('summary-base');
            const elCuotaNow = document.getElementById('summary-cuota-iva');
            const elTotalNow = document.getElementById('summary-total');
            if (elBaseNow && elCuotaNow && elTotalNow) {
                const t = parseSummaryNum(elBaseNow.value) + parseSummaryNum(elCuotaNow.value) - Math.abs(parseSummaryNum(elIrpfNow.value));
                _summarySyncing = true;
                try {
                    if (document.activeElement !== elTotalNow) elTotalNow.value = fmtSummaryNum(t);
                    if (document.activeElement !== elTopTotal) elTopTotal.value = fmtSummaryNum(t);
                } finally { _summarySyncing = false; }
            }
        });
        if (elTopTotal) elTopTotal.addEventListener('input', () => {
            if (_summarySyncing) return;
            const elTotalNow = document.getElementById('summary-total');
            if (!elTotalNow) return;
            _summarySyncing = true;
            try {
                if (document.activeElement !== elTotalNow) elTotalNow.value = fmtSummaryNum(parseSummaryNum(elTopTotal.value));
            } finally { _summarySyncing = false; }
        });
        _topLevelSummaryListenersWired = true;
    }
}

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
    // Campos IVA corregibles por el usuario — modo mono (un solo tramo editable)
    const confirmed_base_imponible  = document.getElementById('confirm-base').value.trim();
    // Snap final del IVA % mono a {21,10,4,0} antes de enviar al backend
    const confirmed_iva_porcentaje  = snapToValidIvaRate(document.getElementById('confirm-iva-pct').value)
                                       || document.getElementById('confirm-iva-pct').value.trim();
    const confirmed_cuota_iva       = document.getElementById('confirm-cuota-iva').value.trim();
    const confirmed_irpf_porcentaje = document.getElementById('confirm-irpf-pct')?.value?.trim() || '';
    const confirmed_cuota_irpf      = document.getElementById('confirm-cuota-irpf')?.value?.trim() || '';

    // Multi-IVA 2026-04-21 parte 3/7: si la vista multi está activa, serializamos
    // los tramos editados. El backend (parte 2/7) recalculará base/cuota/iva%
    // como suma + tipo dominante, sobreescribiendo los campos mono si ambos se
    // envían (el normalizeConfirmedLineasIva tiene prioridad sobre los agregados).
    // Snap + dedupe + cap a 4 tramos antes de enviar (regla 2026-04-30: 1 tramo por % máx 4).
    const _rawLineas = readLineasIvaFromUI();
    const confirmed_lineas_iva = Array.isArray(_rawLineas)
        ? dedupeAndCapTramos(_rawLineas)
        : _rawLineas;

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
                confirmed_lineas_iva,
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
        } else if (data.cif_mismatch && Array.isArray(data.errors)) {
            // Defensa profunda del backend: el CIF emisor/receptor no coincide con el usuario
            renderCifValidationMessages({ errors: data.errors, warnings: [] });
            toggleSaveButton(true);
            msgEl.innerHTML = '';
        } else {
            msgEl.innerHTML = `<p class="error">${data.error || 'Error al guardar'}</p>`;
        }
    } catch (err) {
        msgEl.innerHTML = '<p class="error">Error de conexión. Comprueba tu internet.</p>';
    } finally {
        btn.textContent = '✓ Confirmar y guardar';
        // Re-evaluar si debe seguir bloqueado por CIF mismatch (no resetear ciegamente)
        const modal = document.getElementById('confirm-modal');
        const t = (modal && modal.dataset && modal.dataset.invoiceType) || selectedInvoiceType;
        revalidateAndToggleSave(t);
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
        // Diagnóstico temporal (2026-08-13): distinguir un fallo de red REAL de un
        // error de JS al pintar el modal (que antes se disfrazaba de "conexión").
        console.error('[uploadFile] error:', err);
        const esRed = (err && (err.name === 'TypeError') && /fetch|network|Failed to fetch/i.test(err.message || ''));
        msgEl.innerHTML = esRed
            ? '<p class="error">Error de conexión. Comprueba tu conexión a internet.</p>'
            : `<p class="error">Fallo al mostrar la factura: ${(err && err.message) ? String(err.message).replace(/[<>]/g, '') : 'desconocido'}. Avísame de este mensaje.</p>`;
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
document.getElementById('btn-test-captura')?.addEventListener('click', iniciarCapturaPrueba);
document.getElementById('test-captura-modal-close')?.addEventListener('click', cerrarModalPrueba);
document.getElementById('file-input').addEventListener('change', handleFile);
document.getElementById('camera-input').addEventListener('change', handleFile);
document.getElementById('upload-btn').addEventListener('click', uploadFile);

// Enlace "varias páginas": abre/cierra el panel multipágina (oculto por defecto).
document.getElementById('mp-open-link')?.addEventListener('click', () => {
    const panel = document.getElementById('mp-panel');
    if (!panel) return;
    const abierto = panel.style.display !== 'none';
    panel.style.display = abierto ? 'none' : 'block';
    if (!abierto) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
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
    if (el) {
        el.addEventListener('input', updateIVACalc);
        // Cualquier campo del bloque IVA mono/IRPF/total afecta al resumen general
        el.addEventListener('input', () => { if (typeof updateLineasIvaSummary === 'function') updateLineasIvaSummary(); });
    }
});

// Snap + coherencia matemática del IVA % mono al perder foco.
// Al snappear el %, recalculamos cuota mono = base × % / 100 (si base definida).
const elIvaPctMono = document.getElementById('confirm-iva-pct');
if (elIvaPctMono) {
    elIvaPctMono.addEventListener('blur', () => {
        const snapped = snapToValidIvaRate(elIvaPctMono.value);
        if (snapped !== '' && elIvaPctMono.value !== snapped) {
            elIvaPctMono.value = snapped;
        }
        recalcCoherenciaMono('porcentaje');
        updateIVACalc();
        if (typeof updateLineasIvaSummary === 'function') updateLineasIvaSummary();
    });
}

// Coherencia mono CUOTA = BASE × IVA% / 100 mientras el usuario edita.
function recalcCoherenciaMono(kind) {
    const elBase  = document.getElementById('confirm-base');
    const elPct   = document.getElementById('confirm-iva-pct');
    const elCuota = document.getElementById('confirm-cuota-iva');
    if (!elBase || !elPct || !elCuota) return;
    const pctSnapped = snapToValidIvaRate(elPct.value);
    if (pctSnapped === '') return;
    const pct = parseFloat(pctSnapped);
    if (kind === 'base' || kind === 'porcentaje') {
        const base = parseSummaryNum(elBase.value);
        if (!Number.isFinite(base)) return;
        if (document.activeElement === elCuota) return;
        elCuota.value = fmtSummaryNum(round2(base * pct / 100));
    } else if (kind === 'cuota') {
        if (pct <= 0) return;
        const cuota = parseSummaryNum(elCuota.value);
        if (!Number.isFinite(cuota)) return;
        if (document.activeElement === elBase) return;
        elBase.value = fmtSummaryNum(round2(cuota * 100 / pct));
    }
}
const _elBaseMono = document.getElementById('confirm-base');
const _elCuotaMono = document.getElementById('confirm-cuota-iva');
if (_elBaseMono)  _elBaseMono.addEventListener('input',  () => recalcCoherenciaMono('base'));
if (_elCuotaMono) _elCuotaMono.addEventListener('input', () => recalcCoherenciaMono('cuota'));

// Auto-capitalizar NIF en registro + aviso en vivo si no supera el dígito de
// control AEAT (antes solo se avisaba después, en el perfil ya registrado).
document.getElementById('register-company-nif').addEventListener('input', function() {
    this.value = this.value.toUpperCase().replace(/[\s\-\.]/g, '');
    const warningEl = document.getElementById('register-cif-warning');
    if (!warningEl) return;
    const digitOk = window.SetexCifValidator ? SetexCifValidator.checkDigitCIF(this.value) : null;
    warningEl.style.display = (digitOk === false) ? 'block' : 'none';
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
