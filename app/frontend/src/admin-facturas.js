/* global Tabulator */
'use strict';

const API_URL = '/api';
let table = null;
let currentFilters = {};
let currentCompanyFilter = null; // { cif, nombre } cuando se filtra desde tab Empresas
let editingRow = null;
let editingField = null;
let deleteModeFacturas = false; // toggle: muestra botón ✕ en cada fila para borrar factura

// ── Auth ──────────────────────────────────────────────────────────────────────
// Delegamos toda la gestión de autenticación a window.Auth (auth.js).
// El Access Token vive en memoria (nunca en localStorage/sessionStorage).
function getToken() { return Auth.getToken(); }

// authFetch: wrapper que delega a Auth.apiFetch (incluye refresh automático + retry).
// El callback window.__authOnLogout (definido en init) maneja los 401 irrecuperables.
async function authFetch(url, opts = {}) {
  return Auth.apiFetch(url, opts);
}

async function doLogin(email, password) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Credenciales incorrectas');
  Auth.handleLoginResponse(data);
  // Tarea 5: capturar is_tech_admin de la respuesta de login
  window._isTechAdmin = data.is_tech_admin === true;
  return Auth.getToken();
}
async function checkAdminAccess(_token) {
  const res = await authFetch(`${API_URL}/admin/facturas/usuarios`);
  if (res.status === 403) throw new Error('Tu cuenta no tiene permisos de administrador.');
  if (!res.ok) throw new Error('Error de conexión con el servidor.');
  return await res.json();
}
function showLogin() { document.getElementById('login-screen').style.display = 'flex'; }
function hideLogin() { document.getElementById('login-screen').style.display = 'none'; }
function setupLoginForm(onSuccess) {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    document.getElementById('login-error').style.display = 'none';
    btn.disabled = true; btn.textContent = 'Comprobando...';
    try {
      const token = await doLogin(email, password);
      const authData = await checkAdminAccess(token);
      hideLogin(); onSuccess(authData);
    } catch (err) {
      const el = document.getElementById('login-error');
      el.textContent = err.message; el.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).style.display = 'block';
      if (btn.dataset.tab === 'empresas')  loadEmpresas();
    });
  });
}

// ── Tabla de facturas ─────────────────────────────────────────────────────────

// Campos editables en BD con sus etiquetas de UI.
// Las columnas "display_*" son campos virtuales computados en el backend;
// al editarlas se traduce al campo raw correcto según matched_side (ver getActualField).
const EDITABLE_FIELDS = {
  display_empresa:         'Empresa',
  display_empresa_nif:     'CIF Empresa',
  display_contraparte:     'Cliente / Proveedor',
  display_contraparte_nif: 'CIF Cliente / Proveedor',
  numero_factura:          'Nº Factura',
  fecha_emision:           'Fecha (DD/MM/AAAA)',
  total_factura:           'Total (€)',
  base_imponible:          'Base Imponible (€)',
  iva_porcentaje:          'IVA %',
  cuota_iva:               'Cuota IVA (€)',
  irpf_porcentaje:         'IRPF %',
  cuota_irpf:              'Cuota IRPF (€)',
};

// Traduce un campo display virtual al campo raw de BD según qué lado coincidió.
// matched_side: 'issuer' → proveedor es nuestra empresa | 'receiver' → receptor es nuestra empresa
function getActualField(displayField, rowData) {
  const side = rowData.matched_side; // 'issuer' | 'receiver' | 'none'
  const isIssuer = side !== 'receiver'; // issuer y none → empresa = proveedor
  const map = {
    display_empresa:         isIssuer ? 'proveedor_nombre' : 'receptor_nombre',
    display_empresa_nif:     isIssuer ? 'proveedor_nif'    : 'receptor_nif',
    display_contraparte:     isIssuer ? 'receptor_nombre'  : 'proveedor_nombre',
    display_contraparte_nif: isIssuer ? 'receptor_nif'     : 'proveedor_nif',
  };
  return map[displayField] || displayField;
}

function openEditModal(rowData, field) {
  editingRow = rowData;
  editingField = field;
  document.getElementById('edit-modal-title').textContent = `Editar — Factura #${rowData.id}`;
  document.getElementById('edit-field-label').textContent = EDITABLE_FIELDS[field] || field;
  document.getElementById('edit-field-input').value = rowData[field] || '';
  document.getElementById('edit-error').style.display = 'none';
  document.getElementById('edit-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('edit-field-input').focus(), 50);
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  editingRow = null; editingField = null;
}

async function saveEdit() {
  if (!editingRow || !editingField) return;
  const newValue = document.getElementById('edit-field-input').value.trim();
  const errEl = document.getElementById('edit-error');
  errEl.style.display = 'none';
  const saveBtn = document.getElementById('edit-save');
  saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';

  // Traducir campo display virtual → campo raw de BD
  const actualField = getActualField(editingField, editingRow);

  try {
    const res = await authFetch(`${API_URL}/admin/facturas/${editingRow.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [actualField]: newValue || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    // 2026-07-23: refrescar SIEMPRE con lo que el backend confirma que quedó
    // guardado (data.factura), no con lo que el admin escribió en el input.
    // Bug reportado por Julio: el panel se quedaba mostrando el valor
    // antiguo (sobre todo en "Total") hasta volver a pulsar la celda.
    const row = table.getRow(editingRow.id);
    if (row && data.factura) {
      const updates = { ...data.factura };
      // El campo display virtual (display_empresa, etc.) no existe en BD:
      // se sincroniza a mano con el valor real ya confirmado.
      if (editingField !== actualField) updates[editingField] = data.factura[actualField];
      row.update(updates);
      row.reformat(); // fuerza el repintado de la fila, no depender solo de la reactividad de Tabulator
    }
    closeEditModal();
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar en BD';
  }
}

// Campos "hoja" que se pueden marcar como no fiables desde el panel (ej. CIF
// ilegible incluso a simple vista) — debe coincidir con CAMPOS_FLAGEABLES del
// backend (PUT /api/admin/facturas/:id). Antes solo existía para el CIF de
// Coca-Cola vía la herramienta temporal de ground truth; ahora es permanente
// y aplica a cualquier factura, presente o futura.
const CAMPOS_FLAGEABLES = ['proveedor_nombre', 'proveedor_nif', 'receptor_nombre', 'receptor_nif',
  'numero_factura', 'fecha_emision', 'total_factura', 'base_imponible', 'cuota_iva', 'cuota_irpf'];

// Etiquetas legibles de los campos marcables, para el modal de revisión.
const ETIQUETAS_FLAGEABLES = {
  proveedor_nombre: 'Proveedor / Emisor (nombre)',
  proveedor_nif:    'CIF Proveedor / Emisor',
  receptor_nombre:  'Receptor / Cliente (nombre)',
  receptor_nif:     'CIF Receptor / Cliente',
  numero_factura:   'Nº Factura',
  fecha_emision:    'Fecha de emisión',
  total_factura:    'Total',
  base_imponible:   'Base imponible',
  cuota_iva:        'Cuota IVA',
  cuota_irpf:       'Cuota IRPF',
};

// El botón 🚩 NO se pinta aquí: vive una sola vez por fila, en la celda de ID
// (repetirlo en cada celda editable ensuciaba toda la tabla). Aquí solo queda
// el resaltado en rojo del valor cuando ese campo está marcado como no fiable.
function makeEditableFormatter(field, innerFormatter) {
  return (cell) => {
    const val = innerFormatter ? innerFormatter(cell) : (cell.getValue() ?? '<span style="color:#a0aec0">—</span>');
    const rowData = cell.getRow().getData();
    const actualField = getActualField(field, rowData);
    const flagueado = Array.isArray(rowData.campos_no_fiables) && rowData.campos_no_fiables.includes(actualField);
    const valSpan = flagueado
      ? `<span class="cell-val" style="background:#fc8181;border-radius:3px;padding:1px 4px;" title="Marcado como no fiable — requiere revisión">${val}</span>`
      : `<span class="cell-val">${val}</span>`;
    return `${valSpan}<button class="edit-cell-btn" title="Editar ${EDITABLE_FIELDS[field] || field}">✏️</button>`;
  };
}

// Formatter UNIFICADO de IVA %: SIEMPRE abre el modal de desglose completo
// (base/% /cuota por tramo, añadir/quitar tramos), tenga 0, 1, 2, 3 o 4 tramos
// guardados. Antes, con 0/1 tramo, solo se podía editar el número de IVA% —
// si el OCR se equivocaba y detectaba mono-IVA cuando en realidad había 2+
// tramos, no había forma de corregirlo desde el panel (bug reportado por
// Julio 2026-07-23). openDesgloseModal() reconstruye un tramo inicial a
// partir de iva_porcentaje/base_imponible/cuota_iva cuando lineas_iva viene
// vacío, así nunca se pierde lo que ya había.
function formatIvaPctUnified(cell) {
  const row = cell.getRow().getData();
  const lineas = Array.isArray(row.lineas_iva) ? row.lineas_iva : [];
  if (lineas.length >= 2) {
    return `<span class="desglose-badge" title="Click para ver/editar el desglose completo" style="background:#ebf8ff;color:#2b6cb0;border:1px solid #90cdf4;border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;cursor:pointer;">🧾 ${lineas.length} tramos</span>`;
  }
  const val = formatPct(cell);
  return `<span class="cell-val">${val}</span><span class="desglose-badge" title="Click para ver/editar como desglose de tramos (permite añadir más tramos)" style="margin-left:4px;background:#ebf8ff;color:#2b6cb0;border:1px solid #90cdf4;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;cursor:pointer;">🧾</span>`;
}

function makeEditableCellClick(field) {
  return (_e, cell) => {
    if (_e.target.classList.contains('edit-cell-btn')) {
      openEditModal(cell.getRow().getData(), field);
    }
  };
}

// ── Marcado de campos no fiables (una bandera por fila, en la celda de ID) ───
// campos_no_fiables es un array JSONB en uploads: los campos ahí listados se
// pintan en rojo en la tabla para avisar de que ese dato no es de fiar (ej.
// un CIF ilegible incluso a simple vista).
let noFiableRowId = null;

function openNoFiableModal(rowData) {
  noFiableRowId = rowData.id;
  const marcados = Array.isArray(rowData.campos_no_fiables) ? rowData.campos_no_fiables : [];
  document.getElementById('nofiable-modal-title').textContent = `Campos no fiables — Factura #${rowData.id}`;
  document.getElementById('nofiable-error').style.display = 'none';
  document.getElementById('nofiable-lista').innerHTML = CAMPOS_FLAGEABLES.map((campo) => {
    const valor = rowData[campo];
    return `
      <label style="display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid #edf2f7;cursor:pointer;font-size:13px;">
        <input type="checkbox" data-campo="${campo}" ${marcados.includes(campo) ? 'checked' : ''}>
        <span style="flex:1;">${ETIQUETAS_FLAGEABLES[campo]}</span>
        <code style="color:#4a5568;font-size:12px;">${valor ? escHtml(String(valor)) : '—'}</code>
      </label>`;
  }).join('');
  document.getElementById('nofiable-modal').style.display = 'flex';
}

function closeNoFiableModal() {
  document.getElementById('nofiable-modal').style.display = 'none';
  noFiableRowId = null;
}

async function saveNoFiable() {
  if (noFiableRowId == null) return;
  const seleccionados = [...document.querySelectorAll('#nofiable-lista input[type=checkbox]')]
    .filter((cb) => cb.checked)
    .map((cb) => cb.dataset.campo);
  const errEl = document.getElementById('nofiable-error');
  errEl.style.display = 'none';
  const btn = document.getElementById('nofiable-save');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const res = await authFetch(`${API_URL}/admin/facturas/${noFiableRowId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campos_no_fiables: seleccionados }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    const row = table.getRow(noFiableRowId);
    if (row) { row.update(data.factura); row.reformat(); }
    closeNoFiableModal();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar';
  }
}

// CellClick UNIFICADO de IVA %: siempre abre el modal de desglose completo,
// independientemente de cuántos tramos tenga guardados hoy la factura.
function ivaPctUnifiedCellClick(_e, cell) {
  openDesgloseModal(cell.getRow().getData());
}

// Parsea un importe en formato español "1.234,56" (o inglés "1234.56") a
// número JS. 2026-07-23: `parseFloat` ingenuo interpreta la coma como fin de
// número — "1.234,56" se leía como 1.234 (mostrando "1,23 €" en vez de
// "1.234,56 €") para cualquier importe ≥ 1.000€. Bug real reportado por
// Julio como "el total sigue apareciendo mal" tras editar. Fuente única
// reutilizada en la tabla principal, el modal de desglose y las tarjetas de
// la galería de facturas de empresa — antes cada sitio tenía su propia
// copia (o ninguna) de este parseo.
function parseSpanishAmountAdmin(v) {
  if (v == null || v === '') return null;
  let s = String(v).replace(/[€$\s]/g, '');
  if (!s) return null;
  const hasComma = s.includes(','), hasDot = s.includes('.');
  let n;
  if (hasComma && hasDot) {
    n = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? parseFloat(s.replace(/\./g, '').replace(',', '.'))
      : parseFloat(s.replace(/,/g, ''));
  } else if (hasComma) {
    const after = s.split(',').pop() || '';
    n = after.length === 3 ? parseFloat(s.replace(/,/g, '')) : parseFloat(s.replace(',', '.'));
  } else {
    n = parseFloat(s);
  }
  return Number.isFinite(n) ? n : null;
}

function formatEuro(cell) {
  const v = cell.getValue();
  if (v == null || v === '') return '<span style="color:#a0aec0">—</span>';
  const n = parseSpanishAmountAdmin(v);
  if (n == null) return escHtml(String(v));
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function formatEstado(cell) {
  const v = cell.getValue();
  return v
    ? '<span class="badge-ok">✓ Procesado</span>'
    : '<span class="badge-pending">⏳ Pendiente</span>';
}
function formatConfianza(cell) {
  const v = cell.getValue() || '';
  const cls = v === 'high' ? 'badge-high' : v === 'medium' ? 'badge-medium' : 'badge-low';
  const label = v === 'high' ? 'Alta' : v === 'medium' ? 'Media' : v === 'low' ? 'Baja' : v;
  return label ? `<span class="${cls}">${label}</span>` : '<span style="color:#a0aec0">—</span>';
}
function formatNull(cell) {
  const v = cell.getValue();
  return v != null && v !== '' ? escHtml(String(v)) : '<span style="color:#a0aec0">—</span>';
}
function formatEuroStr(cell) {
  // Formatea importes guardados como string español "1.234,56" a display legible
  const v = cell.getValue();
  if (v == null || v === '') return '<span style="color:#a0aec0">—</span>';
  const n = parseSpanishAmountAdmin(v);
  if (n == null) return escHtml(String(v));
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
// 2026-07-23 (petición de Julio): SOLO para la columna "Cuota IRPF" — un
// importe de 0 (o "0,00", "0.00"...) se muestra como "—", igual que ya hace
// "IRPF %" (formatPct) con su 0. Es puramente de visualización: no toca el
// valor guardado en BD ni ninguna otra columna (cuota_iva/base_imponible
// siguen usando formatEuroStr sin cambios — un 0,00€ de IVA sí es un dato
// real en una factura exenta). El "—" solo deja de verse cuando alguien
// edita la celda a mano, o cuando el usuario/la IA capturan un IRPF real
// antes de guardar la factura.
function formatCuotaIrpf(cell) {
  const v = cell.getValue();
  if (v == null || v === '') return '<span style="color:#a0aec0">—</span>';
  const n = parseSpanishAmountAdmin(v);
  if (n == null) return escHtml(String(v));
  if (n === 0) return '<span style="color:#a0aec0">—</span>';
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function formatPct(cell) {
  const v = cell.getValue();
  if (v == null || v === '' || v === '0,0' || v === '0') return '<span style="color:#a0aec0">—</span>';
  return escHtml(String(v)) + '%';
}
function formatTipo(cell) {
  const v = cell.getValue();
  const badge = !v
    ? '<span style="color:#a0aec0">—</span>'
    : v === 'venta'
      ? '<span style="font-size:11px;font-weight:700;color:#6b46c1;background:#e9d8fd;padding:2px 7px;border-radius:8px;">↑ Emitida</span>'
      : '<span style="font-size:11px;font-weight:700;color:#2b6cb0;background:#ebf8ff;padding:2px 7px;border-radius:8px;">↓ Recibida</span>';
  return `<span class="cell-val" style="cursor:pointer;" title="Click para cambiar entre Recibida (compra) y Emitida (venta)">${badge}</span>`;
}

// Cambia invoice_type entre 'compra' y 'venta' desde el panel — antes solo se
// podía corregir editando la BD a mano. Julio 2026-07-29: "yo no puedo cambiar
// a mano de recibida a emitida o viceversa y quiero poder tener disponible
// esta edición". No cambia proveedor_nombre/receptor_nombre — solo la etiqueta;
// ver computeDisplayCompanies() en el backend para cómo interactúan ambas cosas.
async function toggleInvoiceType(rowData) {
  const actual = rowData.invoice_type || 'compra';
  const nuevo = actual === 'venta' ? 'compra' : 'venta';
  const etiquetaActual = actual === 'venta' ? 'Emitida' : 'Recibida';
  const etiquetaNueva = nuevo === 'venta' ? 'Emitida' : 'Recibida';
  if (!confirm(`Factura #${rowData.id}: cambiar de "${etiquetaActual}" a "${etiquetaNueva}"?`)) return;
  try {
    const res = await authFetch(`${API_URL}/admin/facturas/${rowData.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_type: nuevo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    const row = table.getRow(rowData.id);
    if (row) { row.update(data.factura); row.reformat(); }
  } catch (err) {
    alert(`No se pudo cambiar el tipo: ${err.message}`);
  }
}
function formatFechaHora(cell) {
  const v = cell.getValue();
  if (!v) return '<span style="color:#a0aec0">—</span>';
  return new Date(v).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}
function formatImagen(cell) {
  const row = cell.getRow().getData();
  if (row.file_path) {
    return `<span class="img-link" style="cursor:pointer;" title="Ver imagen de la factura">🖼 Ver</span>`;
  }
  return '<span style="color:#a0aec0">—</span>';
}

async function verImagenAdmin(id) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const content = document.createElement('div');
  content.style.cssText = 'position:relative;max-width:95vw;max-height:95vh;display:flex;align-items:center;justify-content:center;';
  content.innerHTML = '<p style="color:#fff;font-size:14px;">Cargando imagen...</p>';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.style.cssText = 'position:fixed;top:18px;right:18px;background:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:22px;cursor:pointer;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,0.4);z-index:10000;';

  // Barra de navegación de páginas (solo visible en facturas multipágina).
  const nav = document.createElement('div');
  nav.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:none;align-items:center;gap:14px;background:#fff;border-radius:24px;padding:8px 16px;box-shadow:0 2px 8px rgba(0,0,0,0.4);z-index:10000;';
  nav.innerHTML = '<button data-nav="prev" aria-label="Anterior" style="border:none;background:transparent;font-size:20px;cursor:pointer;">◀</button>' +
    '<span data-nav="label" style="font-size:14px;font-weight:600;color:#2d3748;min-width:90px;text-align:center;"></span>' +
    '<button data-nav="next" aria-label="Siguiente" style="border:none;background:transparent;font-size:20px;cursor:pointer;">▶</button>';

  let imgUrl = null;
  const cleanup = () => {
    if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = null; }
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };

  // Carga una URL autenticada (imagen o PDF) en el área de contenido.
  const cargarUrl = async (url) => {
    content.innerHTML = '<p style="color:#fff;font-size:14px;">Cargando...</p>';
    if (imgUrl) { URL.revokeObjectURL(imgUrl); imgUrl = null; }
    const res = await authFetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    imgUrl = URL.createObjectURL(blob);
    content.innerHTML = '';
    if ((blob.type || '').toLowerCase().includes('pdf')) {
      const frame = document.createElement('iframe');
      frame.src = imgUrl;
      frame.style.cssText = 'width:90vw;height:90vh;border:0;border-radius:8px;background:#fff;box-shadow:0 4px 32px rgba(0,0,0,0.6);';
      content.appendChild(frame);
    } else {
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = 'Imagen de la factura';
      img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,0.6);';
      content.appendChild(img);
    }
  };

  let paginaActual = 1;
  let totalPaginas = 1;
  const irAPagina = async (n) => {
    if (n < 1 || n > totalPaginas) return;
    paginaActual = n;
    const url = totalPaginas > 1
      ? `${API_URL}/admin/facturas/${id}/pagina/${n}`
      : `${API_URL}/admin/facturas/${id}/imagen`;
    try { await cargarUrl(url); } catch (err) {
      content.innerHTML = `<p style="color:#fff;font-size:14px;">No se pudo cargar la imagen (${escHtml(err.message || 'error')}).</p>`;
    }
    nav.querySelector('[data-nav="label"]').textContent = `Página ${paginaActual} / ${totalPaginas}`;
    nav.querySelector('[data-nav="prev"]').disabled = paginaActual <= 1;
    nav.querySelector('[data-nav="next"]').disabled = paginaActual >= totalPaginas;
  };

  const onKey = (e) => {
    if (e.key === 'Escape') cleanup();
    else if (e.key === 'ArrowLeft' && totalPaginas > 1) irAPagina(paginaActual - 1);
    else if (e.key === 'ArrowRight' && totalPaginas > 1) irAPagina(paginaActual + 1);
  };

  closeBtn.addEventListener('click', cleanup);
  nav.querySelector('[data-nav="prev"]').addEventListener('click', () => irAPagina(paginaActual - 1));
  nav.querySelector('[data-nav="next"]').addEventListener('click', () => irAPagina(paginaActual + 1));
  overlay.appendChild(content);
  overlay.appendChild(closeBtn);
  overlay.appendChild(nav);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  // Averiguar cuántas páginas tiene; si son varias, mostrar la navegación.
  try {
    const pr = await authFetch(`${API_URL}/admin/facturas/${id}/paginas`);
    if (pr.ok) {
      const data = await pr.json();
      totalPaginas = Array.isArray(data.paginas) && data.paginas.length > 1 ? data.paginas.length : 1;
    }
  } catch { /* si falla, se trata como una sola página */ }
  if (totalPaginas > 1) nav.style.display = 'flex';
  await irAPagina(1);
}

function initTable() {
  table = new Tabulator('#facturas-table', {
    index: 'id',
    height: 'calc(100vh - 230px)',
    layout: 'fitDataFill',
    responsiveLayout: false,
    placeholder: 'No hay facturas con los filtros aplicados',
    movableColumns: true,
    persistence: { sort: true, columns: ['width'] },
    // v10 (2026-07-29): Tabulator persiste tambien el ORDEN de columnas bajo
    // esta clave. Al anadir la columna "id" (nueva, no presente en el layout
    // guardado en localStorage) quedaba anexada AL FINAL y, por tener
    // frozen:true, se congelaba a la DERECHA en vez de a la izquierda.
    // Subir la version invalida el layout viejo y respeta el orden de aqui.
    // v11 (2026-08-12): al quitar "Código cliente" hay que invalidar de nuevo. Un
    // layout guardado que aun la liste la reintroduciria al final y volveria a
    // congelar un bloque a la derecha sobre "Acciones".
    // v12 (2026-08-12): al retirar `frozen` de la columna ID hay que invalidar otra
    // vez, o un layout guardado con la columna congelada la seguiria anclando.
    persistenceID: 'setex-admin-facturas-v12',
    columns: [
      // La bandera de "campos no fiables" vive AQUI, una sola por fila, en vez
      // de repetirse en cada celda editable (ensuciaba toda la tabla). Abre un
      // modal donde se elige QUE campos concretos no son fiables — se conserva
      // asi la granularidad por campo y el resaltado en rojo de esas celdas.
      // 2026-08-12: retirado `frozen: true`. La columna sigue siendo la PRIMERA por
      // la izquierda (que es lo que se quiere ver), pero deja de estar congelada.
      // `frozen` era la unica causa posible de un bloque de columnas anclado a la
      // derecha sobre "Acciones": Tabulator lo reancla ahi en cada `redraw(true)`
      // —justo lo que hace el toggle del modo eliminar— y por eso reaparecia al ir
      // a borrar. Quitar el ancla elimina el problema de raiz. Contrapartida
      // aceptada: el ID ya no permanece a la vista al hacer scroll horizontal.
      { title: 'ID',               field: 'id',              width: 62,  resizable: true, sorter: 'number', hozAlign: 'center',
        formatter: (cell) => {
          const rowData = cell.getRow().getData();
          const n = Array.isArray(rowData.campos_no_fiables) ? rowData.campos_no_fiables.length : 0;
          const flag = n > 0
            ? `<button class="flag-row-btn marcado" title="${n} campo(s) marcados como no fiables — click para revisar">🚩${n}</button>`
            : '<button class="flag-row-btn" title="Marcar campos no fiables (requieren revisión)">🚩</button>';
          return `<code style="font-size:12px;font-weight:700;">#${cell.getValue()}</code>${flag}`;
        },
        cellClick: (e, cell) => {
          if (e.target.closest('.flag-row-btn')) openNoFiableModal(cell.getRow().getData());
        } },
      // 2026-08-12: eliminada la columna "Código cliente". Estaba oculta desde el
      // 2026-07-29 (visible:false) pero conservaba frozen:true, y Tabulator sigue
      // montando el contenedor de columnas congeladas aunque la unica que lo ocupa
      // este oculta. Ese bloque se anclaba a la DERECHA y tapaba "Acciones", que es
      // la ultima columna: el boton de borrar factura quedaba inalcanzable.
      // ── Empresa y contraparte: campos computados por el backend via matching CIF/nombre/tipo ──
      { title: 'Empresa',          field: 'display_empresa',      minWidth: 160, sorter: 'string',
        formatter: makeEditableFormatter('display_empresa'), cellClick: makeEditableCellClick('display_empresa') },
      { title: 'CIF Empresa',      field: 'display_empresa_nif',  width: 130, sorter: 'string',
        formatter: makeEditableFormatter('display_empresa_nif'), cellClick: makeEditableCellClick('display_empresa_nif') },
      { title: 'TIPO',             field: 'invoice_type',    width: 100, sorter: 'string', formatter: formatTipo, hozAlign: 'center',
        cellClick: (_e, cell) => toggleInvoiceType(cell.getRow().getData()) },
      { title: 'Cliente / Proveedor', field: 'display_contraparte', minWidth: 160, sorter: 'string',
        formatter: makeEditableFormatter('display_contraparte'), cellClick: makeEditableCellClick('display_contraparte') },
      { title: 'CIF Cl/Prov',      field: 'display_contraparte_nif', width: 130, sorter: 'string',
        formatter: makeEditableFormatter('display_contraparte_nif'), cellClick: makeEditableCellClick('display_contraparte_nif') },
      { title: 'Nº Factura',       field: 'numero_factura',  width: 130, sorter: 'string',
        formatter: makeEditableFormatter('numero_factura'), cellClick: makeEditableCellClick('numero_factura') },
      { title: 'Fecha',            field: 'fecha_emision',   width: 110, sorter: 'string', formatter: makeEditableFormatter('fecha_emision'), cellClick: makeEditableCellClick('fecha_emision') },
      { title: 'Base Imp.',        field: 'base_imponible',  width: 115, sorter: 'string', hozAlign: 'right',
        formatter: makeEditableFormatter('base_imponible', formatEuroStr), cellClick: makeEditableCellClick('base_imponible') },
      { title: 'IVA %',            field: 'iva_porcentaje',  width: 110, sorter: 'string', hozAlign: 'center', headerSort: false,
        formatter: formatIvaPctUnified, cellClick: ivaPctUnifiedCellClick },
      { title: 'Cuota IVA',        field: 'cuota_iva',       width: 110, sorter: 'string', hozAlign: 'right',
        formatter: makeEditableFormatter('cuota_iva', formatEuroStr), cellClick: makeEditableCellClick('cuota_iva') },
      { title: 'IRPF %',           field: 'irpf_porcentaje', width: 80,  sorter: 'string', hozAlign: 'center',
        formatter: makeEditableFormatter('irpf_porcentaje', formatPct), cellClick: makeEditableCellClick('irpf_porcentaje') },
      { title: 'Cuota IRPF',       field: 'cuota_irpf',      width: 110, sorter: 'string', hozAlign: 'right',
        formatter: makeEditableFormatter('cuota_irpf', formatCuotaIrpf), cellClick: makeEditableCellClick('cuota_irpf') },
      // sorter propio: los importes se guardan en formato español ("1.234,56") y
      // el sorter 'number' de Tabulator hace parseFloat, que corta en la coma
      // ("1.234,56" -> 1.234) y ordenaba mal.
      { title: 'Total',            field: 'total_factura',   width: 120, hozAlign: 'right',
        sorter: (a, b) => (parseSpanishAmountAdmin(a) ?? -Infinity) - (parseSpanishAmountAdmin(b) ?? -Infinity),
        cellStyle: () => ({ fontWeight: '700', color: '#1a365d' }),
        formatter: makeEditableFormatter('total_factura', formatEuro), cellClick: makeEditableCellClick('total_factura') },
      { title: 'Estado',           field: 'procesado_en',    width: 120, formatter: formatEstado, sorter: 'datetime' },
      { title: 'Imagen',           field: 'file_path',       width: 90,  formatter: formatImagen, hozAlign: 'center', headerSort: false,
        cellClick: (_e, cell) => {
          const row = cell.getRow().getData();
          if (row.file_path) verImagenAdmin(row.id);
        }
      },
      { title: 'Subido',           field: 'uploaded_at',     width: 130, sorter: 'datetime', formatter: formatFechaHora },
      { title: '⚠',                field: 'posible_duplicado', width: 60, hozAlign: 'center', headerSort: false,
        formatter: (cell) => cell.getValue()
          ? '<button class="btn-tbl-del dup-resolver" title="Resolver posible duplicado">🗑️ Duplicado</button>'
          : '',
        cellClick: (_e, cell) => { if (cell.getValue()) openDuplicadoModal(cell.getRow().getData()); } },
      { title: 'Acciones',         field: 'id',              width: 110, hozAlign: 'center', headerSort: false,
        formatter: (cell) => {
          if (!deleteModeFacturas) return '<span style="color:#cbd5e0;font-size:11px;">—</span>';
          const row = cell.getData();
          const num = row.numero_factura || `#${row.id}`;
          return `<button class="btn-tbl-del fac-delete" data-id="${row.id}" data-num="${escAttr(num)}">✕ Eliminar</button>`;
        } },
    ],
    initialSort: [{ column: 'uploaded_at', dir: 'desc' }],
    rowFormatter: (row) => {
      // Clase CSS (no estilo inline): #facturas-table tiene reglas !important
      // de zebra-striping y :hover que taparían un background puesto por JS.
      row.getElement().classList.toggle('row-duplicado', !!row.getData().posible_duplicado);
    },
  });

  // Event delegation para botón eliminar (CSP-safe: sin onclick inline)
  document.getElementById('facturas-table').addEventListener('click', (e) => {
    const btn = e.target.closest('.fac-delete');
    if (!btn) return;
    e.stopPropagation();
    const id  = parseInt(btn.dataset.id, 10);
    const num = btn.dataset.num || `#${id}`;
    eliminarFactura(id, num);
  });

  // Modal de resolución de duplicados
  document.getElementById('duplicado-lista').addEventListener('click', (e) => {
    const btn = e.target.closest('.dup-keep');
    if (!btn) return;
    const keepId = parseInt(btn.dataset.keepId, 10);
    const grupoIds = btn.dataset.group.split(',').map((s) => parseInt(s, 10));
    resolverDuplicado(keepId, grupoIds);
  });
  document.getElementById('duplicado-modal-close').addEventListener('click', closeDuplicadoModal);
  document.getElementById('duplicado-cancel').addEventListener('click', closeDuplicadoModal);

  // Modal de campos no fiables (bandera de la columna ID)
  document.getElementById('nofiable-modal-close').addEventListener('click', closeNoFiableModal);
  document.getElementById('nofiable-cancel').addEventListener('click', closeNoFiableModal);
  document.getElementById('nofiable-save').addEventListener('click', saveNoFiable);
}

// Eliminación de factura — confirmación en modal propio + DELETE al backend.
// 2026-08-11 (petición de Julio): antes la confirmación era un confirm()
// nativo, que solo mostraba el número de factura. Para una acción irreversible
// sobre datos fiscales el admin necesita ver de qué factura se trata
// (proveedor, fecha, importe) y comprobar que es la fila correcta.
let _delFacturaPendiente = null; // { id, num }

function cerrarDelFacturaModal() {
  const m = document.getElementById('del-factura-modal');
  if (m) m.style.display = 'none';
  _delFacturaPendiente = null;
}

function eliminarFactura(id, num) {
  const modal   = document.getElementById('del-factura-modal');
  const resumen = document.getElementById('del-factura-resumen');
  const errorEl = document.getElementById('del-factura-error');
  const btn     = document.getElementById('del-factura-confirm');
  // Sin el modal en el DOM (HTML cacheado antiguo) no se borra a ciegas:
  // mejor no hacer nada que ejecutar un borrado irreversible sin confirmar.
  if (!modal || !resumen || !btn) return;

  const d = (table && table.getRow(id)) ? table.getRow(id).getData() : {};
  const totalNum = parseSpanishAmountAdmin(d.total_factura);
  const total = totalNum != null
    ? totalNum.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
    : '—';
  const fecha = d.fecha_emision ? new Date(d.fecha_emision).toLocaleDateString('es-ES') : '—';
  const nif   = d.proveedor_nif ? ` · ${escHtml(d.proveedor_nif)}` : '';

  resumen.innerHTML = `
    <div class="del-resumen-num">Factura ${escHtml(num)}</div>
    <div class="del-resumen-prov">${escHtml(d.proveedor_nombre || 'Proveedor desconocido')}${nif}</div>
    <div class="del-resumen-meta">${escHtml(fecha)} · <strong>${escHtml(total)}</strong></div>`;

  errorEl.style.display = 'none';
  errorEl.textContent = '';
  btn.disabled = false;
  btn.textContent = 'Eliminar definitivamente';
  _delFacturaPendiente = { id, num };
  modal.style.display = 'flex';
}

async function confirmarBorradoFactura() {
  if (!_delFacturaPendiente) return;
  const { id } = _delFacturaPendiente;
  const btn     = document.getElementById('del-factura-confirm');
  const errorEl = document.getElementById('del-factura-error');
  btn.disabled = true;
  btn.textContent = 'Eliminando…';
  try {
    const res = await authFetch(`${API_URL}/admin/facturas/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    // Quitar la fila del Tabulator sin recargar toda la tabla
    const row = table.getRow(id);
    if (row) row.delete();
    // Actualizar contador
    const totalEl = document.getElementById('total-label');
    const m = (totalEl.textContent || '').match(/^([\d.]+)/);
    if (m) {
      const n = parseInt(m[1].replace(/\./g, ''), 10) - 1;
      totalEl.innerHTML = `<strong>${n.toLocaleString('es-ES')}</strong> factura${n !== 1 ? 's' : ''}`;
    }
    cerrarDelFacturaModal();
  } catch (err) {
    // El error se queda DENTRO del modal: un alert() lo cerraría y obligaría a
    // repetir la selección de la fila.
    errorEl.textContent = `No se pudo eliminar la factura: ${err.message}`;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Eliminar definitivamente';
  }
}

function initDelFacturaModal() {
  const modal  = document.getElementById('del-factura-modal');
  const cerrar = document.getElementById('del-factura-close');
  const cancel = document.getElementById('del-factura-cancel');
  const btn    = document.getElementById('del-factura-confirm');
  if (!modal || !cerrar || !cancel || !btn) return;
  cerrar.addEventListener('click', cerrarDelFacturaModal);
  cancel.addEventListener('click', cerrarDelFacturaModal);
  btn.addEventListener('click', confirmarBorradoFactura);
  // Clic en el backdrop cancela; Escape también. En un modal destructivo la
  // salida siempre es la opción segura.
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrarDelFacturaModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') cerrarDelFacturaModal();
  });
}

// ── Resolución de posibles duplicados ────────────────────────────────────────
// Detección real: mismo numero_factura + fecha_emision + total_factura,
// ignorando el NIF (un CIF ilegible puede producir lecturas distintas del NIF
// para el mismo documento físico subido dos veces — ver src/lib/duplicate-detector.js).
function openDuplicadoModal(rowData) {
  const grupoIds = [rowData.id, ...(rowData.duplicado_grupo || [])];
  const filas = grupoIds
    .map((id) => table.getRow(id))
    .filter(Boolean)
    .map((row) => row.getData());

  document.getElementById('duplicado-error').style.display = 'none';
  const lista = document.getElementById('duplicado-lista');
  lista.innerHTML = filas.map((f) => `
    <div style="display:flex;align-items:center;gap:12px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:8px;">
      <div style="flex:1;font-size:13px;line-height:1.5;">
        <strong>Factura #${f.id}</strong> — ${escHtml(f.numero_factura || '—')}<br>
        ${escHtml(f.display_empresa || f.proveedor_nombre || '—')} · ${escHtml(f.fecha_emision || '—')} · ${escHtml(f.total_factura || '—')} €<br>
        <span style="color:#718096;">Subida: ${f.uploaded_at ? new Date(f.uploaded_at).toLocaleString('es-ES') : '—'} · CIF proveedor leído: ${escHtml(f.proveedor_nif || '—')}</span>
      </div>
      <button class="btn-primary dup-keep" data-keep-id="${f.id}" data-group="${grupoIds.join(',')}">Conservar esta</button>
    </div>
  `).join('');
  document.getElementById('duplicado-modal').style.display = 'flex';
}

function closeDuplicadoModal() {
  document.getElementById('duplicado-modal').style.display = 'none';
}

async function resolverDuplicado(keepId, grupoIds) {
  const aEliminar = grupoIds.filter((id) => id !== keepId);
  if (!confirm(`Se conservará la factura #${keepId} y se eliminarán definitivamente: ${aEliminar.map((id) => `#${id}`).join(', ')}.\n\n¿Continuar?`)) return;
  const errEl = document.getElementById('duplicado-error');
  errEl.style.display = 'none';
  try {
    for (const id of aEliminar) {
      const res = await authFetch(`${API_URL}/admin/facturas/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Factura #${id}: ${data.error || 'HTTP ' + res.status}`);
      const row = table.getRow(id);
      if (row) row.delete();
    }
    // La fila conservada ya no forma parte de ningún grupo tras el borrado —
    // se refresca desde servidor para limpiar posible_duplicado/duplicado_grupo.
    closeDuplicadoModal();
    loadData(currentFilters);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
}

async function loadData(filters = {}) {
  const params = new URLSearchParams();
  if (filters.desde)      params.set('desde', filters.desde);
  if (filters.hasta)      params.set('hasta', filters.hasta);
  if (filters.usuario_id) params.set('usuario_id', filters.usuario_id);
  if (filters.estado)     params.set('estado', filters.estado);
  // Filtro por empresa (viene de tab Empresas → Ver facturas)
  if (currentCompanyFilter) params.set('company_nif', currentCompanyFilter.cif);

  document.getElementById('total-label').innerHTML = 'Cargando...';
  renderCompanyFilterBanner();
  try {
    const res = await authFetch(`${API_URL}/admin/facturas${params.toString() ? '?' + params : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    table.setData(data.facturas);
    const n = data.total;

    const nDuplicados = (data.facturas || []).filter((f) => f.posible_duplicado).length;
    const dupBanner = document.getElementById('duplicados-banner');
    if (dupBanner) {
      dupBanner.style.display = nDuplicados > 0 ? 'flex' : 'none';
      if (nDuplicados > 0) document.getElementById('duplicados-count').textContent = nDuplicados;
    }
    const companyTag = currentCompanyFilter
      ? ` <span style="font-size:12px;background:#ebf8ff;color:#2b6cb0;padding:2px 8px;border-radius:10px;font-weight:600;">📂 ${escHtml(currentCompanyFilter.nombre)}</span>`
      : '';
    document.getElementById('total-label').innerHTML = `<strong>${n.toLocaleString('es-ES')}</strong> factura${n !== 1 ? 's' : ''}${companyTag}`;
  } catch (err) {
    document.getElementById('total-label').textContent = 'Error al cargar datos';
    console.error(err);
  }
}

function renderCompanyFilterBanner() {
  const banner = document.getElementById('company-filter-banner');
  if (!banner) return;
  if (currentCompanyFilter) {
    banner.style.display = 'flex';
    document.getElementById('company-filter-name').textContent = `${currentCompanyFilter.nombre} — ${currentCompanyFilter.cif}`;
  } else {
    banner.style.display = 'none';
  }
}

function getFilters() {
  return {
    desde:      document.getElementById('f-desde').value,
    hasta:      document.getElementById('f-hasta').value,
    usuario_id: document.getElementById('f-usuario').value,
    estado:     document.getElementById('f-estado').value,
  };
}
function clearFilters() {
  ['f-desde','f-hasta','f-usuario','f-estado'].forEach(id => { document.getElementById(id).value = ''; });
  currentFilters = {};
  currentCompanyFilter = null;
  loadData();
}
function downloadExcel() {
  const params = new URLSearchParams();
  if (currentFilters.desde)      params.set('desde', currentFilters.desde);
  if (currentFilters.hasta)      params.set('hasta', currentFilters.hasta);
  if (currentFilters.usuario_id) params.set('usuario_id', currentFilters.usuario_id);
  if (currentFilters.estado)     params.set('estado', currentFilters.estado);
  if (currentCompanyFilter)      params.set('company_nif', currentCompanyFilter.cif);
  authFetch(`${API_URL}/admin/facturas/export.xlsx${params.toString() ? '?' + params : ''}`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const fn = (r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'facturas.xlsx';
      return r.blob().then(blob => ({ blob, fn }));
    })
    .then(({ blob, fn }) => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click(); URL.revokeObjectURL(a.href);
    })
    .catch(err => alert('Error al descargar: ' + err.message));
}

// ── Empresas clientes (whitelist) — tabla Tabulator ──────────────────────────
let tableEmpresas = null;
let editingEmpresaId = null;
let deleteMode = false;       // modo eliminar empresas (activado por botón externo)
let approvingEmpresaId = null; // id de empresa pendiente que se está aprobando

// Toast de feedback para edición inline de empresa
function showEmpresaToast(msg, type) {
  const existing = document.getElementById('emp-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'emp-toast';
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;color:#fff;background:${type === 'ok' ? '#276749' : '#9b2335'};box-shadow:0 4px 14px rgba(0,0,0,0.25);transition:opacity 0.3s;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2800);
}

// Guardado inline al editar una celda de empresa
async function onEmpresaCellEdited(cell) {
  const rowData = cell.getRow().getData();
  const field = cell.getField();
  let value = cell.getValue();

  // Validaciones locales antes de llamar a la API
  if (field === 'nombre') {
    if (!value || !String(value).trim()) {
      cell.restoreOldValue();
      showEmpresaToast('El nombre no puede estar vacío.', 'error');
      return;
    }
    value = String(value).trim();
  }
  if (field === 'cif') {
    const clean = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length < 5) {
      cell.restoreOldValue();
      showEmpresaToast('CIF inválido (mínimo 5 caracteres alfanuméricos).', 'error');
      return;
    }
    value = clean;
    cell.getRow().update({ cif: clean }); // normalizar a mayúsculas en la tabla
  }
  if (field === 'codigo_cliente') {
    value = value ? String(value).trim() || null : null;
  }
  if (field === 'notas') {
    value = value ? String(value).trim() || null : null;
  }

  try {
    const res = await authFetch(`${API_URL}/admin/client-companies/${rowData.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    const data = await res.json();
    if (!res.ok) {
      cell.restoreOldValue();
      showEmpresaToast(data.error || 'Error al guardar.', 'error');
      return;
    }
    showEmpresaToast('✓ Guardado', 'ok');
  } catch (err) {
    cell.restoreOldValue();
    showEmpresaToast('Error de red: ' + err.message, 'error');
  }
}

function initEmpresasTable() {
  tableEmpresas = new Tabulator('#empresas-table', {
    index: 'id',
    height: 'calc(100vh - 260px)',
    layout: 'fitDataStretch',
    placeholder: 'No hay empresas registradas.',
    persistence: { sort: true },
    persistenceID: 'setex-admin-empresas-v6',
    columns: [
      { title: 'ID',             field: 'codigo_cliente', width: 120, sorter: 'number', hozAlign: 'center',
        editor: 'input', cssClass: 'emp-cell-editable',
        editorParams: { search: false, elementAttributes: { maxlength: '50', placeholder: 'Ej: CLI-001' } },
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? `<code style="font-size:13px;font-weight:700;">${escHtml(v)}</code>` : '<span style="color:#cbd5e0;font-size:12px;">— editar —</span>';
        } },
      { title: 'Empresa',        field: 'nombre',         minWidth: 220, sorter: 'string',
        editor: 'input', cssClass: 'emp-cell-editable',
        editorParams: { elementAttributes: { maxlength: '255' } },
        formatter: (cell) => `<strong>${escHtml(cell.getValue() || '')}</strong>`,
        headerFilter: 'input', headerFilterPlaceholder: 'Buscar...' },
      { title: 'CIF',            field: 'cif',            width: 150, sorter: 'string',
        editor: 'input', cssClass: 'emp-cell-editable',
        editorParams: { elementAttributes: { maxlength: '20', style: 'text-transform:uppercase;font-family:monospace;letter-spacing:1px;' } },
        formatter: (cell) => `<code style="font-size:13px;">${escHtml(cell.getValue() || '')}</code>`,
        headerFilter: 'input', headerFilterPlaceholder: 'CIF...' },
      { title: 'Estado',         field: 'activa',         width: 130, hozAlign: 'center', sorter: 'boolean',
        cssClass: 'emp-cell-toggle',
        formatter: (cell) => {
          const row = cell.getRow().getData();
          if (row.pendiente && !row.activa) {
            return '<span class="badge-pendiente" title="Click para aprobar">⏳ Pendiente</span>';
          }
          return row.activa
            ? '<span class="badge-activa" title="Click para desactivar">✓ Activa</span>'
            : '<span class="badge-inactiva" title="Click para activar">✗ Inactiva</span>';
        },
        cellClick: async (_e, cell) => {
          const row = cell.getRow().getData();
          if (row.pendiente && !row.activa) {
            showEmpresaToast('Usa los botones "✓ Aprobar" o "✗ Rechazar" en la columna Acciones.', 'error');
            return;
          }
          const newVal = !row.activa;
          const accion = newVal ? 'activar' : 'desactivar';
          if (!confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} la empresa "${row.nombre}"?\n${newVal ? 'Los usuarios de esta empresa podrán volver a acceder.' : 'Los usuarios de esta empresa NO podrán iniciar sesión.'}`)) return;
          try {
            const res = await authFetch(`${API_URL}/admin/client-companies/${row.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ activa: newVal }),
            });
            const data = await res.json();
            if (!res.ok) { showEmpresaToast(data.error || 'Error al actualizar', 'error'); return; }
            cell.getRow().update({ activa: newVal });
            showEmpresaToast(newVal ? '✓ Empresa activada' : '✓ Empresa desactivada', 'ok');
          } catch (err) { showEmpresaToast('Error de red: ' + err.message, 'error'); }
        } },
      { title: 'Usuarios',       field: 'num_usuarios',   width: 100, sorter: 'number', hozAlign: 'right',
        formatter: (cell) => {
          const v = parseInt(cell.getValue()) || 0;
          return `<strong>${v}</strong>`;
        } },
      { title: 'Facturas',       field: 'total_facturas', width: 100, sorter: 'number', hozAlign: 'right',
        formatter: (cell) => {
          const v = parseInt(cell.getValue()) || 0;
          return v > 0 ? `<strong style="color:#2b6cb0;">${v.toLocaleString('es-ES')}</strong>` : '<span style="color:#a0aec0;">0</span>';
        } },
      { title: 'Última factura', field: 'ultima_factura', width: 140, sorter: 'datetime',
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? new Date(v).toLocaleDateString('es-ES') : '<span style="color:#a0aec0">—</span>';
        } },
      { title: 'Alta',           field: 'created_at',     width: 110, sorter: 'datetime',
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? new Date(v).toLocaleDateString('es-ES') : '—';
        } },
      { title: 'Notas',          field: 'notas',          minWidth: 160,
        editor: 'input', cssClass: 'emp-cell-editable',
        editorParams: { elementAttributes: { maxlength: '500', placeholder: 'Ej: Cliente desde 2024…' } },
        formatter: (cell) => {
          const v = cell.getValue();
          return v ? `<span style="color:#718096;font-size:12px;">${escHtml(v)}</span>` : '<span style="color:#cbd5e0;font-size:12px;">— editar —</span>';
        } },
      { title: 'Acciones',       field: 'id',             width: 200, hozAlign: 'center', headerSort: false,
        formatter: (cell) => {
          const row = cell.getData();
          const d = `data-id="${row.id}" data-cif="${escAttr(row.cif)}" data-nombre="${escAttr(row.nombre)}"`;
          const verBtn = `<button class="btn-tbl-filter emp-action" data-action="ver" ${d}>📂 Ver facturas</button>`;
          if (row.pendiente && !row.activa) {
            // Pendientes: Aprobar + Rechazar (y Eliminar en modo eliminar)
            const delBtn = deleteMode ? `<button class="btn-tbl-del emp-action" data-action="eliminar" ${d}>✕ Eliminar</button>` : '';
            return `${verBtn}
              <button class="btn-tbl-ok emp-action"  data-action="aprobar"  ${d}>✓ Aprobar</button>
              <button class="btn-tbl-del emp-action" data-action="rechazar" ${d}>✗ Rechazar</button>${delBtn}`;
          }
          // Empresas activas/inactivas: solo Ver facturas (+ Eliminar en modo eliminar)
          const delBtn = deleteMode ? `<button class="btn-tbl-del emp-action" data-action="eliminar" ${d}>✕ Eliminar</button>` : '';
          return `${verBtn}${delBtn}`;
        } },
    ],
    initialSort: [{ column: 'pendiente', dir: 'desc' }, { column: 'codigo_cliente', dir: 'asc' }],
  });
  // Vincular edición inline después de que la tabla existe
  tableEmpresas.on('cellEdited', onEmpresaCellEdited);

  // Event delegation para botones de Acciones (CSP-safe: sin onclick inline)
  document.getElementById('empresas-table').addEventListener('click', (e) => {
    const btn = e.target.closest('.emp-action');
    if (!btn) return;
    e.stopPropagation();
    const id     = parseInt(btn.dataset.id, 10);
    const cif    = btn.dataset.cif    || '';
    const nombre = btn.dataset.nombre || '';
    const action = btn.dataset.action;
    if (action === 'ver')      window._empVerFacturas(id, cif, nombre);
    if (action === 'aprobar')  window._empRevisar(id, nombre);  // abre modal completo de revisión
    if (action === 'rechazar') window._empRechazar(id, nombre);
    if (action === 'eliminar') window._empEliminar(id, nombre);
  });
}

// ── Helpers de galería de empresa (Tareas 1, 4) ──────────────────────────────

// Parsea fecha en formato DD/MM/YYYY evitando "Invalid Date" (Tarea 1).
// new Date("01/04/2026") devuelve Invalid Date en JS — hay que reordenar a YYYY-MM-DD.
function parseFechaEs(fechaStr) {
  if (!fechaStr) return null;
  const m = String(fechaStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  const d = new Date(fechaStr);
  return isNaN(d.getTime()) ? null : d;
}

// Abre el lightbox con botones de navegación prev/next (Tarea 4).
function openLightbox(url) {
  const lb = document.getElementById('lightbox');
  document.getElementById('lightbox-img').src = url;

  // Crear botones de navegación la primera vez (lazy, dentro del lightbox div)
  let btnPrev = document.getElementById('lb-nav-prev');
  let btnNext = document.getElementById('lb-nav-next');
  if (!btnPrev) {
    const NAV_STYLE = 'position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.55);border:none;border-radius:50%;width:48px;height:48px;color:#fff;font-size:32px;cursor:pointer;z-index:1000001;display:flex;align-items:center;justify-content:center;line-height:1;transition:background 0.15s;';
    btnPrev = document.createElement('button');
    btnPrev.id = 'lb-nav-prev';
    btnPrev.setAttribute('aria-label', 'Factura anterior');
    btnPrev.style.cssText = NAV_STYLE + 'left:16px;';
    btnPrev.textContent = '‹';
    btnPrev.addEventListener('click', (e) => { e.stopPropagation(); navigateLightbox(window._empFacturaIdx - 1); });
    lb.appendChild(btnPrev);
    btnNext = document.createElement('button');
    btnNext.id = 'lb-nav-next';
    btnNext.setAttribute('aria-label', 'Factura siguiente');
    btnNext.style.cssText = NAV_STYLE + 'right:16px;';
    btnNext.textContent = '›';
    btnNext.addEventListener('click', (e) => { e.stopPropagation(); navigateLightbox(window._empFacturaIdx + 1); });
    lb.appendChild(btnNext);
  }
  const facturas = window._empFacturasActuales;
  const hasNav = facturas && facturas.length > 1;
  btnPrev.style.display = hasNav && window._empFacturaIdx > 0 ? 'flex' : 'none';
  btnNext.style.display = hasNav && window._empFacturaIdx < facturas.length - 1 ? 'flex' : 'none';

  lb.style.display = 'flex';
}

// Navega al índice newIdx de la galería activa, cargando la imagen si no estaba aún.
async function navigateLightbox(newIdx) {
  const facturas = window._empFacturasActuales;
  if (!facturas || newIdx < 0 || newIdx >= facturas.length) return;
  window._empFacturaIdx = newIdx;
  const entry = facturas[newIdx];
  if (entry.url !== null) {
    openLightbox(entry.url);
    return;
  }
  // Carga bajo demanda si el lazy-load aún no ha disparado para esta tarjeta
  try {
    const ir = await authFetch(`${API_URL}/admin/facturas/${entry.id}/imagen`);
    if (!ir.ok) throw new Error('sin imagen');
    const blob = await ir.blob();
    const url  = URL.createObjectURL(blob);
    entry.url  = url;
    openLightbox(url);
  } catch {
    /* no-op: imagen no disponible en esta factura */
  }
}

// Ver facturas de una empresa → modal con galería de imágenes
window._empVerFacturas = async function(id, cif, nombre) {
  const modal = document.getElementById('facemp-modal');
  const grid  = document.getElementById('facemp-grid');
  const loading = document.getElementById('facemp-loading');
  const empty   = document.getElementById('facemp-empty');
  const countEl = document.getElementById('facemp-count');

  // Reiniciar estado de navegación entre facturas (Tarea 4)
  window._empFacturasActuales = [];
  window._empFacturaIdx = 0;

  document.getElementById('facemp-title').textContent = `Facturas de "${nombre}"`;
  countEl.textContent = '';
  loading.style.display = 'block';
  empty.style.display = 'none';
  grid.innerHTML = '';
  modal.style.display = 'flex';

  try {
    const cleanCif = cif.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const res = await authFetch(`${API_URL}/admin/facturas?company_nif=${encodeURIComponent(cleanCif)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const facturas = (data.facturas || []).slice(0, 60); // ya vienen ordenadas DESC por fecha

    loading.style.display = 'none';
    if (facturas.length === 0) { empty.style.display = 'block'; return; }

    countEl.textContent = `${facturas.length} factura${facturas.length !== 1 ? 's' : ''}`;

    // Poblar array de navegación con URLs null (se rellenan al lazy-load)
    facturas.forEach(f => { window._empFacturasActuales.push({ id: f.id, url: null }); });

    facturas.forEach((f, idx) => {
      const card = document.createElement('div');
      card.className = 'facemp-card';

      // Tarea 1: parsear fecha ES (DD/MM/YYYY) sin producir "Invalid Date"
      const fechaObj = parseFechaEs(f.fecha_emision)
        || (f.uploaded_at ? new Date(f.uploaded_at) : null);
      const fecha = fechaObj ? fechaObj.toLocaleDateString('es-ES') : '—';

      // Tarea 2: nombre del proveedor confirmado por humano (proveedor_nombre), no OCR raw
      const cardNombre = escHtml(f.proveedor_nombre || f.display_nombre || '—');

      // Tarea 3: importe con mínimos y máximos de 2 decimales
      // 2026-07-23: parseSpanishAmountAdmin (no parseFloat ingenuo) — un total
      // "1.234,56" con parseFloat directo se leía como 1.234 (mal para
      // importes ≥ 1.000€, bug reportado por Julio en esta misma tarjeta).
      const totalNum = parseSpanishAmountAdmin(f.total_factura);
      const total = totalNum != null
        ? totalNum.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
        : '—';

      // Tarea 6: botón OCR solo visible para tech admins
      const showOcr = window._isTechAdmin === true;

      card.innerHTML = `
        <div class="facemp-img-wrap" data-id="${f.id}">
          <div class="facemp-placeholder">⏳</div>
          <img class="facemp-img" src="" style="display:none;" alt="Factura #${f.id}">
        </div>
        <div class="facemp-info">
          <span class="facemp-fecha">📅 ${fecha}</span>
          <span class="facemp-proveedor" title="${cardNombre}">${cardNombre}</span>
          <span class="facemp-total">${total}</span>
          ${showOcr ? '<button class="facemp-ocr-btn" title="Ver comparador OCR vs Humano" style="margin-top:4px;font-size:11px;padding:2px 8px;background:#4a5568;color:#fff;border:none;border-radius:4px;cursor:pointer;">&#9881; OCR</button>' : ''}
        </div>`;
      grid.appendChild(card);

      // Tarea 6: click handler del botón OCR (sin onclick inline — CSP-safe)
      if (showOcr) {
        card.querySelector('.facemp-ocr-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          openOcrModal(f.id);
        });
      }

      // Lazy-load con IntersectionObserver (Tarea 4: rellena navEntry.url al cargar)
      const navEntry = window._empFacturasActuales[idx];
      const wrap = card.querySelector('.facemp-img-wrap');
      const img  = card.querySelector('.facemp-img');
      const ph   = card.querySelector('.facemp-placeholder');
      const obs  = new IntersectionObserver(async (entries) => {
        if (!entries[0].isIntersecting) return;
        obs.disconnect();
        try {
          const ir = await authFetch(`${API_URL}/admin/facturas/${f.id}/imagen`);
          if (!ir.ok) throw new Error('sin imagen');
          const blob = await ir.blob();
          const url  = URL.createObjectURL(blob);
          navEntry.url = url;
          img.src = url;
          img.style.display = 'block';
          ph.style.display  = 'none';
          img.onclick = () => {
            window._empFacturaIdx = idx;
            openLightbox(url);
          };
        } catch {
          ph.textContent = '📄';
          ph.title = 'Imagen no disponible';
        }
      }, { threshold: 0.1 });
      obs.observe(wrap);
    });
  } catch (err) {
    loading.textContent = `Error al cargar: ${err.message}`;
  }
};

// Abrir modal de edición de empresa
window._empEditar = function(id) {
  if (!tableEmpresas) return;
  const row = tableEmpresas.getRow(id);
  if (!row) return;
  const data = row.getData();
  editingEmpresaId = id;
  document.getElementById('emp-modal-title').textContent = `Editar empresa — ${data.nombre}`;
  document.getElementById('emp-nombre').value = data.nombre || '';
  document.getElementById('emp-cif').value = data.cif || '';
  document.getElementById('emp-codigo').value = data.codigo_cliente || '';
  document.getElementById('emp-notas').value = data.notas || '';
  document.getElementById('emp-error').style.display = 'none';
  document.getElementById('empresa-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('emp-nombre').focus(), 50);
};

// Aprobar empresa pendiente → usa el nuevo endpoint dedicado con transacción atómica
window._empAprobar = async function(id, nombre) {
  if (!confirm(`¿Aprobar la empresa "${nombre}"?\nSus usuarios podrán acceder y sus documentos serán activados.`)) return;
  try {
    const res = await authFetch(`${API_URL}/admin/companies/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: `Aprobada manualmente por ${window._adminEmail || 'admin'}` }),
    });
    const data = await res.json();
    if (!res.ok) { showEmpresaToast(data.error || 'Error al aprobar', 'error'); return; }
    const modal = document.getElementById('review-company-modal');
    if (modal) modal.remove();
    showEmpresaToast(`✓ "${data.nombre}" aprobada. ${data.uploads_activated || 0} documentos activados.`, 'ok');
    loadEmpresas();
    if (table) loadData(currentFilters);
  } catch (err) { showEmpresaToast('Error de red: ' + err.message, 'error'); }
};

// Rechazar empresa pendiente → usa el nuevo endpoint dedicado (quarantine uploads)
window._empRechazar = async function(id, nombre) {
  const reason = prompt(`¿Rechazar la empresa "${nombre}"?\n\nMotivo (opcional):`, '');
  if (reason === null) return; // cancelado
  try {
    const res = await authFetch(`${API_URL}/admin/companies/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || null, notes: reason || null }),
    });
    const data = await res.json();
    if (!res.ok) { showEmpresaToast(data.error || 'Error al rechazar', 'error'); return; }
    const modal = document.getElementById('review-company-modal');
    if (modal) modal.remove();
    showEmpresaToast(`Empresa "${data.nombre}" rechazada. ${data.quarantined_uploads || 0} docs en cuarentena.`, 'ok');
    loadEmpresas();
    if (table) loadData(currentFilters);
  } catch (err) { showEmpresaToast('Error de red: ' + err.message, 'error'); }
};

// Revisar empresa pendiente con el modal completo de aprobación
window._empRevisar = async function(id, nombre) {
  try {
    const res = await authFetch(`${API_URL}/admin/companies/${id}/detail`);
    if (!res.ok) { alert('Error al cargar el detalle de la empresa'); return; }
    const data = await res.json();
    openReviewModal(id, data);
  } catch (err) { alert('Error de red: ' + err.message); }
};

// Eliminar empresa (solo si no tiene usuarios)
window._empEliminar = async function(id, nombre) {
  if (!confirm(`¿Eliminar definitivamente la empresa "${nombre}"?\nEsta acción no se puede deshacer.`)) return;
  try {
    const res = await authFetch(`${API_URL}/admin/client-companies/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Error al eliminar'); return; }
    loadEmpresas();
  } catch (err) { alert('Error de red: ' + err.message); }
};

function actualizarBadgePendientes() {
  if (!tableEmpresas) return;
  const rows = tableEmpresas.getData();
  const nPendientes = rows.filter(r => r.pendiente && !r.activa).length;
  const badge = document.getElementById('badge-pendientes');
  if (nPendientes > 0) {
    badge.textContent = nPendientes;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
}

async function loadEmpresas() {
  if (!tableEmpresas) initEmpresasTable();
  document.getElementById('empresas-label').textContent = 'Cargando...';
  try {
    const res = await authFetch(`${API_URL}/admin/client-companies`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const companies = data.companies || [];
    tableEmpresas.setData(companies);
    const n = companies.length;
    const nActivas   = companies.filter(c => c.activa && !c.pendiente).length;
    const nPendientes = companies.filter(c => c.pendiente && !c.activa).length;
    let label = `<strong>${n}</strong> empresa${n !== 1 ? 's' : ''} &nbsp;<span style="color:#718096;font-weight:400;">(${nActivas} activa${nActivas !== 1 ? 's' : ''}`;
    if (nPendientes > 0) label += `, <strong style="color:#d69e2e;">${nPendientes} pendiente${nPendientes !== 1 ? 's' : ''}</strong>`;
    label += ')</span>';
    document.getElementById('empresas-label').innerHTML = label;
    actualizarBadgePendientes();
  } catch (err) {
    document.getElementById('empresas-label').textContent = 'Error al cargar empresas';
    console.error(err);
  }
}

// Guardar empresa desde el modal (nueva o edición)
async function saveEmpresa() {
  const nombre  = document.getElementById('emp-nombre').value.trim();
  const cif     = document.getElementById('emp-cif').value.trim();
  const codigo  = document.getElementById('emp-codigo').value.trim();
  const notas   = document.getElementById('emp-notas').value.trim();
  const errEl   = document.getElementById('emp-error');
  const saveBtn = document.getElementById('emp-save');
  errEl.style.display = 'none';
  if (!nombre || !cif) { errEl.textContent = 'Nombre y CIF son obligatorios.'; errEl.style.display = 'block'; return; }
  if (cif.replace(/[^A-Z0-9]/gi, '').length < 5) { errEl.textContent = 'CIF inválido (mínimo 5 caracteres).'; errEl.style.display = 'block'; return; }

  saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
  try {
    let res, data;
    if (editingEmpresaId) {
      // Editar empresa existente (o aprobar pendiente si approvingEmpresaId coincide)
      const payload = { nombre, cif, codigo_cliente: codigo || null, notas: notas || null };
      if (approvingEmpresaId === editingEmpresaId) {
        payload.activa   = true;
        payload.pendiente = false;
      }
      res  = await authFetch(`${API_URL}/admin/client-companies/${editingEmpresaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      // Nueva empresa
      res  = await authFetch(`${API_URL}/admin/client-companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, cif, codigo_cliente: codigo || null, notas: notas || null }),
      });
    }
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    const wasApproving = approvingEmpresaId !== null;
    closeEmpresaModal();
    loadEmpresas();
    if (wasApproving) showEmpresaToast(`✓ Empresa "${nombre}" aprobada y activada`, 'ok');
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Guardar';
  }
}

function openNuevaEmpresaModal() {
  editingEmpresaId = null;
  document.getElementById('emp-modal-title').textContent = 'Nueva empresa';
  document.getElementById('emp-nombre').value = '';
  document.getElementById('emp-cif').value = '';
  document.getElementById('emp-codigo').value = '';
  document.getElementById('emp-notas').value = '';
  document.getElementById('emp-error').style.display = 'none';
  document.getElementById('empresa-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('emp-nombre').focus(), 50);
}

function closeEmpresaModal() {
  document.getElementById('empresa-modal').style.display = 'none';
  editingEmpresaId    = null;
  approvingEmpresaId  = null;
  const saveBtn = document.getElementById('emp-save');
  saveBtn.textContent = 'Guardar';
  saveBtn.style.background = '';
}

function initEmpresaModal() {
  document.getElementById('emp-modal-close').addEventListener('click', closeEmpresaModal);
  document.getElementById('emp-cancel').addEventListener('click', closeEmpresaModal);
  document.getElementById('emp-save').addEventListener('click', saveEmpresa);
  document.getElementById('empresa-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('empresa-modal')) closeEmpresaModal();
  });
  document.getElementById('emp-nombre').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEmpresa(); });
  document.getElementById('emp-cif').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEmpresa(); });

  // Modal galería de facturas de empresa
  document.getElementById('facemp-close').addEventListener('click', () => {
    document.getElementById('facemp-modal').style.display = 'none';
  });
  document.getElementById('facemp-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('facemp-modal')) document.getElementById('facemp-modal').style.display = 'none';
  });

  // Lightbox: botón × explícito
  document.getElementById('lb-close').addEventListener('click', () => {
    document.getElementById('lightbox').style.display = 'none';
  });

  // Lightbox: cerrar al hacer click sobre el fondo (no sobre botones de nav)
  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === document.getElementById('lightbox') || e.target === document.getElementById('lightbox-img')) {
      document.getElementById('lightbox').style.display = 'none';
    }
  });

  // Escape: cierra solo el modal más profundo visible (lightbox → facemp-modal),
  // para que el usuario pueda volver a la galería sin perder el contexto.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const lb = document.getElementById('lightbox');
      if (lb.style.display !== 'none') { lb.style.display = 'none'; return; }
      document.getElementById('facemp-modal').style.display = 'none';
    }
  });
}

function openRenameModal(userId, currentName) {
  document.getElementById('rename-user-id').value = userId;
  document.getElementById('rename-company-input').value = currentName || '';
  document.getElementById('rename-error').style.display = 'none';
  document.getElementById('rename-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('rename-company-input').focus(), 50);
}
function closeRenameModal() {
  document.getElementById('rename-modal').style.display = 'none';
}
async function saveRename() {
  const userId = document.getElementById('rename-user-id').value;
  const newName = document.getElementById('rename-company-input').value.trim();
  const errEl = document.getElementById('rename-error');
  const saveBtn = document.getElementById('rename-save');
  errEl.style.display = 'none';
  saveBtn.disabled = true; saveBtn.textContent = 'Guardando...';
  try {
    const res = await authFetch(`${API_URL}/admin/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: newName || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');
    closeRenameModal();
    loadEmpresas();
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Guardar';
  }
}

function initRenameModal() {
  document.getElementById('rename-modal-close').addEventListener('click', closeRenameModal);
  document.getElementById('rename-cancel').addEventListener('click', closeRenameModal);
  document.getElementById('rename-save').addEventListener('click', saveRename);
  document.getElementById('rename-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('rename-modal')) closeRenameModal();
  });
  document.getElementById('rename-company-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveRename();
    if (e.key === 'Escape') closeRenameModal();
  });
}

// ── Catálogo de empresas ──────────────────────────────────────────────────────
async function loadCatalog() {
  try {
    const res = await authFetch(`${API_URL}/admin/catalog`);
    const data = await res.json();
    const tbody = document.getElementById('catalog-tbody');
    tbody.innerHTML = '';
    (data.catalog || []).forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escHtml(row.proveedor_nombre)}</td>
        <td><code>${escHtml(row.proveedor_nif)}</code></td>
        <td>${escHtml(row.notas || '')}</td>
        <td>${new Date(row.created_at).toLocaleDateString('es-ES')}</td>
        <td><button class="btn-del" data-id="${row.id}" title="Eliminar">✕</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta empresa del catálogo?')) return;
        const r = await authFetch(`${API_URL}/admin/catalog/${btn.dataset.id}`, { method: 'DELETE' });
        if (r.ok) loadCatalog();
      });
    });
  } catch (err) { console.error('Catalog load error:', err); }
}

function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// escAttr: seguro para usar dentro de atributos HTML (incluye comillas simples y dobles)
function escAttr(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function initCatalog() {
  document.getElementById('btn-add-empresa').addEventListener('click', () => {
    document.getElementById('catalog-form').style.display = 'flex';
    document.getElementById('btn-add-empresa').style.display = 'none';
    document.getElementById('cat-nombre').focus();
  });
  document.getElementById('btn-cancel-empresa').addEventListener('click', () => {
    document.getElementById('catalog-form').style.display = 'none';
    document.getElementById('btn-add-empresa').style.display = 'inline-flex';
  });
  document.getElementById('btn-save-empresa').addEventListener('click', async () => {
    const nombre = document.getElementById('cat-nombre').value.trim();
    const nif = document.getElementById('cat-nif').value.trim();
    const notas = document.getElementById('cat-notas').value.trim();
    const msg = document.getElementById('catalog-msg');
    if (!nombre || !nif) { msg.textContent = 'Nombre y NIF son obligatorios.'; msg.style.display = 'block'; msg.className = 'inline-msg error'; return; }
    try {
      const res = await authFetch(`${API_URL}/admin/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proveedor_nombre: nombre, proveedor_nif: nif, notas }),
      });
      const data = await res.json();
      if (!res.ok) { msg.textContent = data.error; msg.style.display = 'block'; msg.className = 'inline-msg error'; return; }
      msg.textContent = `✓ "${nombre}" guardado correctamente.`; msg.style.display = 'block'; msg.className = 'inline-msg ok';
      document.getElementById('cat-nombre').value = '';
      document.getElementById('cat-nif').value = '';
      document.getElementById('cat-notas').value = '';
      loadCatalog();
      setTimeout(() => { msg.style.display = 'none'; }, 3000);
    } catch { msg.textContent = 'Error de red.'; msg.style.display = 'block'; msg.className = 'inline-msg error'; }
  });
}

// ── Seguridad ─────────────────────────────────────────────────────────────────
async function loadSecurity() {
  try {
    const [cfgRes, blockedRes] = await Promise.all([
      authFetch(`${API_URL}/admin/security`),
      authFetch(`${API_URL}/admin/security/blocked`),
    ]);
    const cfg = await cfgRes.json();
    const blocked = await blockedRes.json();
    document.getElementById('sec-time-enabled').checked = !!cfg.time_restriction?.enabled;
    document.getElementById('sec-start').value = cfg.time_restriction?.start_hour ?? 0;
    document.getElementById('sec-end').value = cfg.time_restriction?.end_hour ?? 6;
    renderIpList('wl-list', cfg.ip_whitelist || [], 'whitelist');
    renderIpList('bl-list', cfg.ip_blacklist || [], 'blacklist');
    renderBlockedList(blocked.blocked || []);
  } catch (err) { console.error('Security load error:', err); }
}

function renderIpList(listId, ips, type) {
  const ul = document.getElementById(listId);
  ul.innerHTML = '';
  if (ips.length === 0) { ul.innerHTML = '<li class="ip-empty">Sin entradas</li>'; return; }
  ips.forEach(ip => {
    const li = document.createElement('li');
    li.className = 'ip-item';
    li.innerHTML = `<code>${escHtml(ip)}</code><button class="btn-del-ip" data-ip="${escHtml(ip)}" data-type="${type}">✕</button>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.btn-del-ip').forEach(btn => {
    btn.addEventListener('click', () => removeIp(btn.dataset.ip, btn.dataset.type));
  });
}

function renderBlockedList(blocked) {
  const ul = document.getElementById('blocked-list');
  ul.innerHTML = '';
  if (blocked.length === 0) { ul.innerHTML = '<li class="ip-empty">Ninguna IP bloqueada actualmente</li>'; return; }
  blocked.forEach(({ ip }) => {
    const li = document.createElement('li');
    li.className = 'ip-item';
    li.innerHTML = `<code>${escHtml(ip)}</code><button class="btn-del-ip" data-ip="${escHtml(ip)}" data-type="blocked">Desbloquear</button>`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.btn-del-ip').forEach(btn => {
    btn.addEventListener('click', () => removeIp(btn.dataset.ip, 'blocked'));
  });
}

async function addIp(ip, type) {
  const endpoint = type === 'whitelist' ? `${API_URL}/admin/security/whitelist` : `${API_URL}/admin/security/blacklist`;
  const res = await authFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip }),
  });
  if (res.ok) loadSecurity();
  else { const d = await res.json(); alert(d.error || 'Error'); }
}

async function removeIp(ip, type) {
  let endpoint;
  if (type === 'whitelist') endpoint = `${API_URL}/admin/security/whitelist`;
  else if (type === 'blacklist') endpoint = `${API_URL}/admin/security/blacklist`;
  else endpoint = `${API_URL}/admin/security/blocked`;
  const res = await authFetch(endpoint, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip }),
  });
  if (res.ok) loadSecurity();
}

function initSecurity() {
  document.getElementById('btn-add-wl').addEventListener('click', () => {
    const ip = document.getElementById('wl-ip').value.trim();
    if (!ip) return;
    addIp(ip, 'whitelist');
    document.getElementById('wl-ip').value = '';
  });
  document.getElementById('btn-add-bl').addEventListener('click', () => {
    const ip = document.getElementById('bl-ip').value.trim();
    if (!ip) return;
    addIp(ip, 'blacklist');
    document.getElementById('bl-ip').value = '';
  });
  document.getElementById('btn-refresh-blocked').addEventListener('click', loadSecurity);
  document.getElementById('btn-save-time').addEventListener('click', async () => {
    const enabled = document.getElementById('sec-time-enabled').checked;
    const start_hour = parseInt(document.getElementById('sec-start').value, 10);
    const end_hour = parseInt(document.getElementById('sec-end').value, 10);
    const res = await authFetch(`${API_URL}/admin/security/time`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, start_hour, end_hour }),
    });
    if (res.ok) alert('Restricción horaria actualizada.');
    else alert('Error al guardar.');
  });
}

// ── Modal de edición de factura ───────────────────────────────────────────────
function initEditModal() {
  document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
  document.getElementById('edit-cancel').addEventListener('click', closeEditModal);
  document.getElementById('edit-save').addEventListener('click', saveEdit);
  document.getElementById('edit-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('edit-modal')) closeEditModal();
  });
  document.getElementById('edit-field-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') closeEditModal();
  });
}

// ── Arranque ──────────────────────────────────────────────────────────────────
function launchApp(authData) {
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-email').textContent = (Auth.getUser() || {}).email || '';

  // Tarea 5: persistir is_tech_admin a través de refresh de sesión.
  // doLogin lo setea ya si el login ocurrió en esta pestaña; aquí lo garantizamos
  // también para la ruta de auto-login vía Auth.init() (refresh de sesión).
  if (!('_isTechAdmin' in window)) {
    const userEmail = (Auth.getUser() || {}).email || '';
    window._isTechAdmin = authData.is_tech_admin === true
      || userEmail === 'juliohesuni@gmail.com';
  }
  // Botón "Pipeline v2" (comparativa shadow) — solo administradores técnicos
  const btnShadowV2 = document.getElementById('btn-shadow-v2');
  if (btnShadowV2) btnShadowV2.style.display = window._isTechAdmin ? 'inline-block' : 'none';
  // Botón "Benchmark IA" (3 imágenes × todos los motores) — solo tech_admin
  const btnBenchmark = document.getElementById('btn-benchmark');
  if (btnBenchmark) btnBenchmark.style.display = window._isTechAdmin ? 'inline-block' : 'none';
  // Botón "Verificar ground truth" (herramienta temporal, 2026-07-28) — solo tech_admin
  const btnEvalVerificacion = document.getElementById('btn-eval-verificacion');
  if (btnEvalVerificacion) btnEvalVerificacion.style.display = window._isTechAdmin ? 'inline-block' : 'none';

  const select = document.getElementById('f-usuario');
  (authData.usuarios || []).forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.company_nombre_registrado || u.company_name || u.email;
    select.appendChild(opt);
  });

  initTabs();
  initTable();
  initEditModal();
  initRenameModal();
  initEmpresaModal();
  initDesgloseModal();
  initOcrModal();
  initShadowModal();
  initBenchmarkModal();
  initDelFacturaModal();
  initEvalVerificacionModal();
  loadData();

  document.getElementById('btn-filtrar').addEventListener('click', () => { currentFilters = getFilters(); loadData(currentFilters); });
  document.getElementById('btn-limpiar').addEventListener('click', clearFilters);
  document.getElementById('btn-refresh').addEventListener('click', () => loadData(currentFilters));
  document.getElementById('btn-csv').addEventListener('click', downloadExcel);
  document.getElementById('btn-refresh-empresas').addEventListener('click', loadEmpresas);
  document.getElementById('btn-nueva-empresa').addEventListener('click', openNuevaEmpresaModal);
  document.getElementById('btn-modo-eliminar').addEventListener('click', () => {
    deleteMode = !deleteMode;
    const btn = document.getElementById('btn-modo-eliminar');
    if (deleteMode) {
      btn.textContent = '✕ Cancelar';
      btn.style.background = 'linear-gradient(135deg,#e53e3e,#c53030)';
      btn.style.color = '#fff';
    } else {
      btn.textContent = '🗑 Eliminar';
      btn.style.background = '';
      btn.style.color = '';
    }
    if (tableEmpresas) tableEmpresas.redraw(true);
  });
  document.getElementById('btn-company-filter-clear').addEventListener('click', () => {
    currentCompanyFilter = null;
    loadData(currentFilters);
  });
  // Toggle modo eliminar facturas (análogo al de empresas)
  document.getElementById('btn-modo-eliminar-fac').addEventListener('click', () => {
    deleteModeFacturas = !deleteModeFacturas;
    const btn = document.getElementById('btn-modo-eliminar-fac');
    if (deleteModeFacturas) {
      btn.textContent = '✕ Cancelar';
      btn.style.background = 'linear-gradient(135deg,#e53e3e,#c53030)';
      btn.style.color = '#fff';
    } else {
      btn.textContent = '🗑 Eliminar';
      btn.style.background = '';
      btn.style.color = '';
    }
    if (table) table.redraw(true);
  });
  document.getElementById('btn-logout').addEventListener('click', async () => {
    // Borrar cookie httpOnly admin en el servidor (JS no puede borrarla directamente)
    try { await fetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); } catch {}
    localStorage.removeItem('token');
    document.getElementById('app').style.display = 'none';
    showLogin();
  });
}

// ── Modal de revisión de empresa pendiente ─────────────────────────────────────

let reviewModalCompanyId = null;
let reviewModalActiveCompanies = [];

function openReviewModal(companyId, detailData) {
  reviewModalCompanyId = companyId;
  const { company, users, pending_uploads, matching_suggestions } = detailData;

  // Crear modal si no existe
  let modal = document.getElementById('review-company-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'review-company-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px;';
    document.body.appendChild(modal);
  }

  // Sugerencias de coincidencia
  const suggestionsHtml = (matching_suggestions || []).length > 0
    ? `<div style="margin-top:12px;">
        <strong style="font-size:13px;color:#2d3748;">Coincidencias detectadas:</strong>
        <div id="review-matching-list" style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
          ${matching_suggestions.map((s) => `
            <div style="background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;">
              <div>
                <strong>${escHtml(s.nombre)}</strong> — <span style="font-family:monospace;">${escHtml(s.cif)}</span>
                <span style="margin-left:8px;font-size:11px;color:#718096;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${escHtml(s.match_type)}</span>
                <span style="margin-left:6px;font-size:12px;color:#4299e1;">${Math.round(s.score * 100)}%</span>
              </div>
              <button data-review-action="link" data-target-id="${s.id}" data-target-nombre="${escHtml(s.nombre)}"
                style="background:#4299e1;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">
                Vincular
              </button>
            </div>
          `).join('')}
        </div>
      </div>`
    : `<p style="color:#718096;font-size:13px;font-style:italic;">Sin coincidencias automáticas — parece empresa nueva.</p>`;

  // Usuarios asociados
  const usersHtml = (users || []).length > 0
    ? users.map(u => `<li style="font-size:13px;">${escHtml(u.email)} <span style="color:#a0aec0;font-size:11px;">(registrado ${new Date(u.created_at).toLocaleDateString('es-ES')})</span></li>`).join('')
    : '<li style="color:#a0aec0;font-size:13px;">Sin usuarios aún</li>';

  // Uploads pendientes
  const uploadsHtml = (pending_uploads || []).length > 0
    ? pending_uploads.slice(0, 10).map(u => `<li style="font-size:12px;">${escHtml(u.filename)} — ${escHtml(u.proveedor_nombre || u.proveedor_nif || '-')} — ${escHtml(u.total_factura || '-')}</li>`).join('')
    : '<li style="color:#a0aec0;font-size:12px;">Sin documentos pendientes</li>';

  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:640px;width:100%;padding:28px;box-shadow:0 8px 40px rgba(0,0,0,0.2);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
        <h2 style="color:#2d3748;font-size:18px;margin:0;">Revisar empresa pendiente</h2>
        <button data-review-action="close" style="background:none;border:none;font-size:24px;cursor:pointer;color:#718096;">✕</button>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
        <tr><td style="padding:6px 8px;color:#718096;width:140px;">Nombre registrado</td><td style="padding:6px 8px;font-weight:600;">${escHtml(company.nombre_registrado || company.nombre)}</td></tr>
        <tr style="background:#f7fafc;"><td style="padding:6px 8px;color:#718096;">CIF</td><td style="padding:6px 8px;font-family:monospace;font-weight:600;">${escHtml(company.cif)}</td></tr>
        <tr><td style="padding:6px 8px;color:#718096;">Email solicitante</td><td style="padding:6px 8px;">${escHtml(company.requested_by_email || '-')}</td></tr>
        <tr style="background:#f7fafc;"><td style="padding:6px 8px;color:#718096;">Fecha solicitud</td><td style="padding:6px 8px;">${company.requested_at ? new Date(company.requested_at).toLocaleString('es-ES') : '-'}</td></tr>
        <tr><td style="padding:6px 8px;color:#718096;">Usuarios</td><td style="padding:6px 8px;">${users.length}</td></tr>
        <tr style="background:#f7fafc;"><td style="padding:6px 8px;color:#718096;">Docs pendientes</td><td style="padding:6px 8px;">${pending_uploads.length}</td></tr>
      </table>

      ${suggestionsHtml}

      <details style="margin-top:14px;cursor:pointer;">
        <summary style="font-size:13px;font-weight:600;color:#4a5568;">Usuarios (${users.length})</summary>
        <ul style="margin:8px 0 0 16px;padding:0;">${usersHtml}</ul>
      </details>
      <details style="margin-top:8px;cursor:pointer;">
        <summary style="font-size:13px;font-weight:600;color:#4a5568;">Documentos pendientes (${pending_uploads.length})</summary>
        <ul style="margin:8px 0 0 16px;padding:0;">${uploadsHtml}</ul>
      </details>

      <div style="margin-top:20px;border-top:1px solid #e2e8f0;padding-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <button data-review-action="approve"
          style="flex:1;background:linear-gradient(135deg,#38a169,#2f855a);color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:700;cursor:pointer;min-width:120px;">
          ✓ Aprobar
        </button>
        <button data-review-action="reject"
          style="flex:1;background:#e53e3e;color:#fff;border:none;border-radius:8px;padding:10px;font-size:14px;font-weight:700;cursor:pointer;min-width:120px;">
          ✗ Rechazar
        </button>
        <button data-review-action="close"
          style="background:#e2e8f0;color:#4a5568;border:none;border-radius:8px;padding:10px 20px;font-size:13px;cursor:pointer;">
          Cancelar
        </button>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  // Handlers CSP-safe (la CSP bloquea onclick inline con scriptSrc 'self')
  const nombreCompany = company.nombre;
  modal.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-review-action]');
    if (!btn) return;
    const action = btn.dataset.reviewAction;
    if (action === 'close')   { modal.remove(); return; }
    if (action === 'approve') { window._empAprobar(companyId, nombreCompany); return; }
    if (action === 'reject')  { window._empRechazar(companyId, nombreCompany); return; }
    if (action === 'link') {
      const targetId = parseInt(btn.dataset.targetId, 10);
      const targetNombre = btn.dataset.targetNombre || '';
      window._linkToCompany(targetId, targetNombre);
    }
  });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

window._linkToCompany = async function(targetId, targetNombre) {
  if (!reviewModalCompanyId) return;
  const reason = prompt(`¿Vincular esta empresa a "${targetNombre}"?\n\nTodos los usuarios y documentos serán migrados a la empresa destino.\n\nNotas opcionales:`, '');
  if (reason === null) return;
  try {
    const res = await authFetch(`${API_URL}/admin/companies/${reviewModalCompanyId}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_company_id: targetId, notes: reason || null }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Error al vincular'); return; }
    const modal = document.getElementById('review-company-modal');
    if (modal) modal.remove();
    showEmpresaToast(`✓ Vinculada → "${data.target.nombre}". ${data.migrated_users} usuarios y ${data.migrated_uploads} docs migrados.`, 'ok');
    loadEmpresas();
  } catch (err) { alert('Error de red: ' + err.message); }
};

async function init() {
  // Callback cross-tab: si se cierra sesión en otra pestaña → redirigir al login
  window.__authOnLogout = () => { window.location.href = '/?next=admin'; };

  const ok = await Auth.init();
  if (ok && Auth.isLoggedIn()) {
    try {
      // Cookie httpOnly setex_admin (8h) renovada en cada apertura → sliding window.
      // Mientras el RT de 30 días siga válido, el admin no pierde sesión por inactividad.
      // La ventana 00-06 sigue bloqueando vía isRestrictedHour del backend (intencional).
      // Errores ignorados: si falla, checkAdminAccess de abajo recoge la excepción.
      try { await authFetch(`${API_URL}/admin/refresh-session`, { method: 'POST' }); } catch (_) { /* no-op */ }

      const authData = await checkAdminAccess(Auth.getToken());
      launchApp(authData);
      return;
    } catch {
      // Token inválido o sin permisos admin → revocar y redirigir
      await Auth.logout().catch(() => {});
    }
  }
  // Sin sesión válida o sin permisos: redirigir al login principal con intención admin.
  window.location.href = '/?next=admin';
}

// ── Multi-IVA 2026-04-21 parte 4/7 — Modal desglose admin ────────────────────
// Permite al admin ver/editar los tramos IVA de una factura multi-IVA.
// Reutiliza el patrón del modal de comprobación pero con submit PUT a
// /api/admin/facturas/:id y refresh de la fila Tabulator tras éxito.

// Snap IVA % a {21,10,4,0} (España solo admite estos tipos)
const ADMIN_IVA_RATES_VALIDOS = [21, 10, 4, 0];
function snapAdminIvaRate(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  const clean = String(raw).replace(',', '.').replace('%', '').trim();
  let n = parseFloat(clean);
  if (!Number.isFinite(n)) return '';
  if (n > 0 && n < 1) n = n * 100;
  let bestRate = ADMIN_IVA_RATES_VALIDOS[0];
  let bestDist = Math.abs(n - bestRate);
  for (const r of ADMIN_IVA_RATES_VALIDOS) {
    const d = Math.abs(n - r);
    if (d < bestDist) { bestDist = d; bestRate = r; }
  }
  return String(bestRate);
}

// Deduplica tramos por % (snappeado) y limita a 4. Conserva el primero.
function dedupeAndCapAdminTramos(lineas) {
  if (!Array.isArray(lineas)) return lineas;
  const seen = new Set();
  const out = [];
  for (const l of lineas) {
    const pct = snapAdminIvaRate(l && l.porcentaje);
    if (pct === '') continue;
    if (seen.has(pct)) continue;
    if (out.length >= ADMIN_IVA_RATES_VALIDOS.length) break;
    seen.add(pct);
    out.push({ ...l, porcentaje: pct });
  }
  return out;
}

function firstAvailableAdminRate(lineas) {
  const used = new Set((Array.isArray(lineas) ? lineas : []).map(l => snapAdminIvaRate(l && l.porcentaje)));
  for (const r of ADMIN_IVA_RATES_VALIDOS) {
    if (!used.has(String(r))) return String(r);
  }
  return null;
}

function _round2Admin(n) { return Math.round(n * 100) / 100; }
const ADMIN_COHERENCIA_TOL_EUR = 0.02;

function tramoCuadraAdmin(base, pct, cuota) {
  if (!Number.isFinite(base) || !Number.isFinite(pct) || !Number.isFinite(cuota)) return null;
  const cuotaCalc = _round2Admin(base * pct / 100);
  return Math.abs(cuota - cuotaCalc) <= ADMIN_COHERENCIA_TOL_EUR;
}

function updateAdminTramoWarning(block) {
  if (!block) return;
  const elBase  = block.querySelector('input[data-kind="base"]');
  const elPct   = block.querySelector('input[data-kind="porcentaje"]');
  const elCuota = block.querySelector('input[data-kind="cuota"]');
  const warning = block.querySelector('.desg-tramo-warning');
  if (!elBase || !elPct || !elCuota || !warning) return;
  if (!elBase.value.trim() || !elPct.value.trim() || !elCuota.value.trim()) {
    warning.style.display = 'none';
    return;
  }
  const base  = parseDesgNum(elBase.value);
  const cuota = parseDesgNum(elCuota.value);
  const pctSnapped = snapAdminIvaRate(elPct.value);
  const pct = pctSnapped !== '' ? parseFloat(pctSnapped) : NaN;
  const cuadra = tramoCuadraAdmin(base, pct, cuota);
  warning.style.display = cuadra === false ? 'block' : 'none';
}
function updateAllAdminTramosWarnings() {
  document.querySelectorAll('#desglose-blocks .desg-block').forEach(updateAdminTramoWarning);
}

// Coherencia matemática admin: CUOTA = BASE × IVA% / 100. Recalcula el campo derivado.
function recalcCoherenciaAdminTramo(block, kind) {
  if (!block) return;
  const elBase  = block.querySelector('input[data-kind="base"]');
  const elPct   = block.querySelector('input[data-kind="porcentaje"]');
  const elCuota = block.querySelector('input[data-kind="cuota"]');
  if (!elBase || !elPct || !elCuota) return;
  const pctSnapped = snapAdminIvaRate(elPct.value);
  if (pctSnapped === '') return;
  const pct = parseFloat(pctSnapped);
  if (kind === 'base' || kind === 'porcentaje') {
    const base = parseDesgNum(elBase.value);
    if (!Number.isFinite(base)) return;
    if (document.activeElement === elCuota) return;
    elCuota.value = fmtDesgNum(_round2Admin(base * pct / 100));
  } else if (kind === 'cuota') {
    if (pct <= 0) return;
    const cuota = parseDesgNum(elCuota.value);
    if (!Number.isFinite(cuota)) return;
    if (document.activeElement === elBase) return;
    elBase.value = fmtDesgNum(_round2Admin(cuota * 100 / pct));
  }
}

let desgloseRowId = null;
let desgloseIrpfCuota = 0;  // CUOTA IRPF (€) de la fila — para calcular Total = bases + cuotas - IRPF

function openDesgloseModal(rowData) {
  desgloseRowId = rowData.id;
  // Parseamos cuota_irpf como número español (puede venir "0,00" o "120,50" o number)
  const rawIrpf = rowData.cuota_irpf;
  if (rawIrpf == null || rawIrpf === '') {
    desgloseIrpfCuota = 0;
  } else if (typeof rawIrpf === 'number') {
    desgloseIrpfCuota = Number.isFinite(rawIrpf) ? rawIrpf : 0;
  } else {
    const clean = String(rawIrpf).replace(/\./g, '').replace(',', '.').replace(/[€$\s]/g, '');
    const n = parseFloat(clean);
    desgloseIrpfCuota = Number.isFinite(n) ? n : 0;
  }
  let lineas = Array.isArray(rowData.lineas_iva) ? rowData.lineas_iva : [];
  // 2026-07-23: si la factura no tiene tramos guardados (mono-IVA de toda la
  // vida, o el caso que reportó Julio: el OCR detectó mal 1 solo tramo cuando
  // en realidad había 2), se reconstruye un tramo inicial desde los campos
  // agregados de la factura — así el admin ve lo que ya había y puede
  // corregirlo añadiendo/editando tramos, en vez de partir de una pantalla
  // vacía que perdería esos datos.
  if (lineas.length === 0 && rowData.iva_porcentaje != null && rowData.iva_porcentaje !== '') {
    lineas = [{
      porcentaje: rowData.iva_porcentaje,
      base: rowData.base_imponible || '',
      cuota: rowData.cuota_iva || '',
    }];
  }
  document.getElementById('desglose-modal-title').textContent =
    `Desglose IVA — Factura ${rowData.numero_factura ? '#' + rowData.numero_factura : '#' + rowData.id}`;
  const metaEl = document.getElementById('desglose-meta');
  metaEl.innerHTML = `
    <strong>${escHtml(rowData.display_empresa || rowData.proveedor_nombre || '—')}</strong>
    ${rowData.display_empresa_nif ? ` · <code>${escHtml(rowData.display_empresa_nif)}</code>` : ''}
    ${rowData.fecha_emision ? ` · ${escHtml(rowData.fecha_emision)}` : ''}
    ${(() => { const t = parseSpanishAmountAdmin(rowData.total_factura); return t != null ? ` · Total: <strong>${t.toLocaleString('es-ES', {minimumFractionDigits:2, maximumFractionDigits:2})} €</strong>` : ''; })()}
  `;
  renderDesgloseBlocks(lineas);
  document.getElementById('desglose-error').style.display = 'none';
  document.getElementById('desglose-modal').style.display = 'flex';
}

function closeDesgloseModal() {
  document.getElementById('desglose-modal').style.display = 'none';
  desgloseRowId = null;
}

function renderDesgloseBlocks(lineas) {
  const container = document.getElementById('desglose-blocks');
  // Deduplica por IVA % y limita a 4 antes de renderizar
  const safeLineas = dedupeAndCapAdminTramos(lineas) || [];
  container.innerHTML = safeLineas.map((l, idx) => {
    const pctSnapped = l.porcentaje;
    return `
    <div class="desg-block" data-tramo="${idx}" style="border:1px solid #bee3f8;border-radius:6px;background:#fff;padding:10px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="font-size:10px;font-weight:700;color:#2b6cb0;letter-spacing:.05em;">TRAMO ${idx + 1}</span>
        <button type="button" class="btn-desg-del-tramo" data-tramo="${idx}" title="Eliminar tramo"
                style="background:transparent;border:1px solid #fbd38d;border-radius:4px;padding:4px 10px;font-size:12px;color:#c05621;cursor:pointer;">✕ Eliminar tramo</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div>
          <label style="display:block;font-size:11px;font-weight:700;color:#4a90d9;margin-bottom:3px;">IVA %</label>
          <input type="text" data-kind="porcentaje" data-tramo="${idx}" value="${escAttr(pctSnapped)}"
                 maxlength="3" placeholder="21" inputmode="numeric"
                 style="width:100%;font-size:14px;padding:7px 10px;border:1px solid #90cdf4;border-radius:6px;text-align:center;font-weight:700;box-sizing:border-box;" />
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:700;color:#4a90d9;margin-bottom:3px;">BASE TRAMO (€)</label>
          <input type="text" data-kind="base" data-tramo="${idx}" value="${escAttr(l.base || '')}"
                 maxlength="15" placeholder="0,00"
                 style="width:100%;font-size:14px;padding:7px 10px;border:1px solid #90cdf4;border-radius:6px;box-sizing:border-box;" />
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:700;color:#4a90d9;margin-bottom:3px;">CUOTA TRAMO (€)</label>
          <input type="text" data-kind="cuota" data-tramo="${idx}" value="${escAttr(l.cuota || '')}"
                 maxlength="15" placeholder="0,00"
                 style="width:100%;font-size:14px;padding:7px 10px;border:1px solid #90cdf4;border-radius:6px;box-sizing:border-box;" />
        </div>
      </div>
      <div class="desg-tramo-warning" style="display:none;margin-top:8px;padding:8px 10px;background:#fff5f5;border:1px solid #fc8181;border-radius:4px;font-size:12px;color:#c53030;font-weight:600;">
        ⚠ Revisar este tramo: la cuota no cuadra con BASE × IVA % ÷ 100.
      </div>
    </div>`;
  }).join('');

  // Botón añadir tramo: solo si quedan tipos libres (máx 4: 21, 10, 4, 0)
  const nextRate = firstAvailableAdminRate(safeLineas);
  const allFull = nextRate === null;
  container.insertAdjacentHTML('beforeend',
    allFull
      ? `<div style="font-size:11px;color:#718096;text-align:center;padding:6px;">Ya tienes los 4 tipos de IVA posibles (21, 10, 4 y 0).</div>`
      : `<button type="button" id="btn-desg-add-tramo" data-next-rate="${nextRate}"
                 style="width:100%;margin-top:4px;background:#f0fff4;border:1px dashed #68d391;color:#276749;border-radius:4px;padding:6px 10px;font-size:12px;cursor:pointer;">➕ Añadir tramo al ${nextRate}%</button>`);

  container.onclick = (e) => {
    const t = e.target;
    if (t.classList.contains('btn-desg-del-tramo')) {
      const tramo = parseInt(t.dataset.tramo, 10);
      const lineas = readDesgloseFromUI();
      lineas.splice(tramo, 1);
      renderDesgloseBlocks(lineas);
    } else if (t.id === 'btn-desg-add-tramo') {
      const lineas = readDesgloseFromUI();
      const next = t.dataset.nextRate || firstAvailableAdminRate(lineas);
      if (next === null) return;
      lineas.push({ porcentaje: next, base: '', cuota: '' });
      renderDesgloseBlocks(lineas);
    }
  };
  container.oninput = (e) => {
    // Coherencia matemática: CUOTA = BASE × IVA% / 100.
    const t = e && e.target;
    if (t && t.dataset && (t.dataset.kind === 'base' || t.dataset.kind === 'cuota')) {
      const block = t.closest('.desg-block');
      recalcCoherenciaAdminTramo(block, t.dataset.kind);
      updateAdminTramoWarning(block);
    }
    updateDesgloseSummary();
  };
  // Snap + dedupe + recálculo CUOTA del IVA % al perder foco
  container.addEventListener('focusout', (e) => {
    const t = e.target;
    if (!t || !t.dataset || t.dataset.kind !== 'porcentaje') return;
    const snapped = snapAdminIvaRate(t.value);
    if (snapped === '') return;
    if (t.value !== snapped) t.value = snapped;
    const block = t.closest('.desg-block');
    recalcCoherenciaAdminTramo(block, 'porcentaje');
    updateAdminTramoWarning(block);
    const before = readDesgloseFromUI() || [];
    const after = dedupeAndCapAdminTramos(before);
    if (after.length !== before.length) {
      renderDesgloseBlocks(after);
    }
    updateDesgloseSummary();
  });
  updateDesgloseSummary();
  updateAllAdminTramosWarnings();
}

function readDesgloseFromUI() {
  const out = [];
  document.querySelectorAll('#desglose-blocks .desg-block').forEach((block) => {
    const tramoIdx = block.dataset.tramo;
    const base       = block.querySelector(`input[data-kind="base"][data-tramo="${tramoIdx}"]`)?.value.trim() || '';
    const porcentaje = block.querySelector(`input[data-kind="porcentaje"][data-tramo="${tramoIdx}"]`)?.value.trim() || '';
    const cuota      = block.querySelector(`input[data-kind="cuota"][data-tramo="${tramoIdx}"]`)?.value.trim() || '';
    out.push({ base, porcentaje, cuota });
  });
  return out;
}

// Helpers compartidos del resumen del modal admin
function parseDesgNum(s) {
  if (s === null || s === undefined || s === '') return 0;
  const clean = String(s).replace(/\./g, '').replace(',', '.').replace(/[€$\s]/g, '');
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}
function fmtDesgNum(n) {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
let _desgSummarySyncing = false;

function updateDesgloseSummary() {
  const summaryEl = document.getElementById('desglose-summary');
  if (!summaryEl) return;
  const lineas = readDesgloseFromUI();
  let sumBase = 0, sumCuota = 0;
  lineas.forEach((l) => {
    sumBase  += parseDesgNum(l.base);
    sumCuota += parseDesgNum(l.cuota);
  });
  const irpf = Math.abs(desgloseIrpfCuota || 0);
  const total = sumBase + sumCuota - irpf;

  const existingBase = summaryEl.querySelector('#desg-summary-base');
  if (!existingBase) {
    summaryEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <label for="desg-summary-base" style="color:#2c5282;font-weight:600;">Base</label>
          <input type="text" id="desg-summary-base" readonly tabindex="-1"
                 title="Suma de las bases de los tramos. Edita los tramos para cambiar."
                 style="width:140px;font-size:14px;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;background:#f7fafc;color:#2c5282;text-align:right;box-sizing:border-box;" />
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <label for="desg-summary-cuota-iva" style="color:#2c5282;font-weight:600;">Cuota IVA</label>
          <input type="text" id="desg-summary-cuota-iva" readonly tabindex="-1"
                 title="Suma de las cuotas de los tramos. Edita los tramos para cambiar."
                 style="width:140px;font-size:14px;padding:6px 8px;border:1px solid #cbd5e0;border-radius:6px;background:#f7fafc;color:#2c5282;text-align:right;box-sizing:border-box;" />
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <label for="desg-summary-cuota-irpf" style="color:#c05621;font-weight:600;">Cuota IRPF</label>
          <input type="text" id="desg-summary-cuota-irpf" inputmode="decimal" maxlength="15"
                 style="width:140px;font-size:14px;padding:6px 8px;border:1px solid #fbd38d;border-radius:6px;background:#fff;text-align:right;color:#c05621;box-sizing:border-box;" />
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid #bee3f8;padding-top:8px;margin-top:2px;">
          <label for="desg-summary-total" style="color:#1a365d;font-weight:700;">Total</label>
          <input type="text" id="desg-summary-total" inputmode="decimal" maxlength="15"
                 style="width:140px;font-size:15px;font-weight:700;padding:6px 8px;border:1px solid #1a365d;border-radius:6px;background:#fff;text-align:right;color:#1a365d;box-sizing:border-box;" />
        </div>
      </div>`;
    wireDesgSummaryInputs();
  }

  _desgSummarySyncing = true;
  try {
    const elBase = summaryEl.querySelector('#desg-summary-base');
    const elCuotaIva = summaryEl.querySelector('#desg-summary-cuota-iva');
    const elIrpf = summaryEl.querySelector('#desg-summary-cuota-irpf');
    const elTotal = summaryEl.querySelector('#desg-summary-total');
    if (document.activeElement !== elBase)     elBase.value     = fmtDesgNum(sumBase);
    if (document.activeElement !== elCuotaIva) elCuotaIva.value = fmtDesgNum(sumCuota);
    if (document.activeElement !== elIrpf)     elIrpf.value     = irpf > 0 ? `-${fmtDesgNum(irpf)}` : fmtDesgNum(0);
    if (document.activeElement !== elTotal)    elTotal.value    = fmtDesgNum(total);
  } finally { _desgSummarySyncing = false; }
}

function wireDesgSummaryInputs() {
  const elBase     = document.getElementById('desg-summary-base');
  const elCuotaIva = document.getElementById('desg-summary-cuota-iva');
  const elIrpf     = document.getElementById('desg-summary-cuota-irpf');
  const elTotal    = document.getElementById('desg-summary-total');
  if (!elBase || !elCuotaIva || !elIrpf || !elTotal) return;

  const recalcTotal = () => {
    const t = parseDesgNum(elBase.value) + parseDesgNum(elCuotaIva.value) - Math.abs(parseDesgNum(elIrpf.value));
    _desgSummarySyncing = true;
    try {
      if (document.activeElement !== elTotal) elTotal.value = fmtDesgNum(t);
    } finally { _desgSummarySyncing = false; }
  };

  // Base y Cuota IVA son readonly en el resumen — se calculan desde los tramos.
  elIrpf.addEventListener('input', () => {
    if (_desgSummarySyncing) return;
    desgloseIrpfCuota = Math.abs(parseDesgNum(elIrpf.value));
    recalcTotal();
  });
  // Total editable a mano: NO recalcula otras (sería destructivo). El admin asume el cuadre.
  elTotal.addEventListener('input', () => { /* no-op por diseño */ });
}

async function saveDesglose() {
  if (!desgloseRowId) return;
  const _rawLineas = readDesgloseFromUI();
  // Snap + dedupe + cap a 4 tramos antes de enviar (regla 2026-04-30: 1 tramo por % máx 4)
  const lineas = Array.isArray(_rawLineas)
    ? dedupeAndCapAdminTramos(_rawLineas)
    : _rawLineas;
  const errEl = document.getElementById('desglose-error');
  errEl.style.display = 'none';
  const btn = document.getElementById('desglose-save');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    // Total y Cuota IRPF editados en el resumen — formateados al estilo español
    // que el backend espera ("1.234,56"). Si están vacíos enviamos null.
    const elIrpf  = document.getElementById('desg-summary-cuota-irpf');
    const elTotal = document.getElementById('desg-summary-total');
    const irpfNum  = elIrpf  ? Math.abs(parseDesgNum(elIrpf.value))  : 0;
    const totalNum = elTotal ? parseDesgNum(elTotal.value) : 0;
    const payload = {
      lineas_iva:    lineas,
      cuota_irpf:    irpfNum  > 0 ? fmtDesgNum(irpfNum)  : null,
      total_factura: totalNum > 0 ? fmtDesgNum(totalNum) : null,
    };
    const res = await authFetch(`${API_URL}/admin/facturas/${desgloseRowId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    // 2026-07-23: refrescar SIEMPRE con data.factura (lo que el backend
    // confirma que quedó guardado), no con un recálculo local optimista.
    // Bug reportado por Julio: el recálculo local (suma de tramos, tramo
    // dominante) podía divergir de lo que normalizeConfirmedLineasIva()
    // calcula de verdad en el backend (redondeos, tramos descartados por
    // inválidos, etc.), dejando el panel mostrando un total/IVA% distinto
    // al que realmente quedó en BD hasta refrescar la página.
    const row = table.getRow(desgloseRowId);
    if (row && data.factura) {
      row.update({ ...data.factura });
      row.reformat(); // fuerza el repintado de la fila (Total, IVA%, badge de tramos...)
    }
    closeDesgloseModal();
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Guardar cambios';
  }
}

function initDesgloseModal() {
  const closeBtn = document.getElementById('desglose-modal-close');
  const cancelBtn = document.getElementById('desglose-cancel');
  const saveBtn = document.getElementById('desglose-save');
  const modal = document.getElementById('desglose-modal');
  if (closeBtn)  closeBtn.addEventListener('click', closeDesgloseModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeDesgloseModal);
  if (saveBtn)   saveBtn.addEventListener('click', saveDesglose);
  if (modal)     modal.addEventListener('click', (e) => { if (e.target === modal) closeDesgloseModal(); });
}

// ── Vista OCR / Comparador IA vs Humano (solo tech admins) — Tarea 6 ──────────

function fmtOcrImporte(v) {
  if (v == null || v === '') return '—';
  // parseSpanishAmountAdmin y no parseFloat: "1.234,56" con parseFloat ingenuo
  // se lee como 1,23 € (corta en el punto de los miles).
  const n = parseSpanishAmountAdmin(v);
  if (n == null) return escHtml(String(v));
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

async function openOcrModal(facturaId) {
  const modal = document.getElementById('ocr-modal');
  const body  = document.getElementById('ocr-modal-body');
  document.getElementById('ocr-modal-title').textContent = `Vista OCR — Factura #${facturaId}`;
  body.innerHTML = '<p style="color:#718096;text-align:center;padding:30px 0;">Cargando datos OCR...</p>';
  modal.style.display = 'flex';

  try {
    const res = await authFetch(`${API_URL}/admin/facturas/${facturaId}/ocr-detail`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();

    const confirmed    = d.confirmed     || {};
    const raw          = d.ocr_raw       || {};   // lo que decidio el SISTEMA
    const iaPura       = d.ia_pura       || null; // lo que leyo la IA (null en facturas antiguas)
    const overridesBd  = d.overrides_bd  || [];
    const meta         = d.meta          || {};
    const campoSources = d.campo_sources || null;
    // Mapa campo -> quien sobrescribio a la IA y con que valor
    const overridePorCampo = {};
    for (const o of overridesBd) overridePorCampo[o.campo] = o;
    const motors       = d.motors        || {};
    const motorEntries = Object.entries(motors);

    // Badge de color por motor que leyó el campo
    const MOTOR_COLOR = {
      consensus:    { bg: '#276749', label: 'consenso' },
      openai:       { bg: '#2b6cb0', label: 'OpenAI'   },
      azure:        { bg: '#553c9a', label: 'Azure DI'  },
      gemini_flash: { bg: '#c05621', label: 'Gemini Flash' },
      gemini_pro:   { bg: '#b83280', label: 'Gemini Pro' },
      gemini:       { bg: '#c05621', label: 'Gemini'    },
      mistral:      { bg: '#9b2335', label: 'Mistral'   },
      calculated:   { bg: '#718096', label: 'calculado' },
    };
    function motorBadge(key, vRaw) {
      if (!campoSources) return '';
      const src = campoSources[key];
      if (!src) return '';
      if (src === 'consensus' && vRaw != null) {
        const nombres = motorEntries
          .filter(([, m]) => {
            const campoObj = (m && m.campos) || {};
            const v = key === 'total_factura' ? (campoObj.total_factura ?? campoObj.total) : campoObj[key];
            return v != null && v !== '' && normCmp(v) === normCmp(vRaw);
          })
          .map(([k, m]) => (MOTOR_COLOR[(m && m.engine) || k] || { label: k }).label);
        if (nombres.length >= 2) {
          return ` <span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;background:${MOTOR_COLOR.consensus.bg};color:#fff;vertical-align:middle;font-family:sans-serif;">consenso: ${escHtml(nombres.join(' + '))}</span>`;
        }
      }
      const m = MOTOR_COLOR[src] || { bg: '#718096', label: src };
      return ` <span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;background:${m.bg};color:#fff;vertical-align:middle;font-family:sans-serif;">${m.label}</span>`;
    }

    const CAMPOS = [
      { label: 'NIF proveedor',    key: 'proveedor_nif' },
      { label: 'Nombre proveedor', key: 'proveedor_nombre' },
      { label: 'NIF receptor',     key: 'receptor_nif' },
      { label: 'Nombre receptor',  key: 'receptor_nombre' },
      { label: 'Número factura',   key: 'numero_factura' },
      { label: 'Fecha emisión',    key: 'fecha_emision' },
      { label: 'Total',            key: 'total_factura',   fmt: fmtOcrImporte },
      { label: 'Base imponible',   key: 'base_imponible',  fmt: fmtOcrImporte },
      { label: 'IVA %',            key: 'iva_porcentaje',  fmt: v => v != null ? escHtml(String(v)) + ' %' : '—' },
      { label: 'Cuota IVA',        key: 'cuota_iva',       fmt: fmtOcrImporte },
      { label: 'IRPF %',           key: 'irpf_porcentaje', fmt: v => v != null ? escHtml(String(v)) + ' %' : '—' },
      { label: 'Cuota IRPF',       key: 'cuota_irpf',      fmt: fmtOcrImporte },
    ];

    // Normaliza para comparar. Alineada con normalizarParaComparar() del backend
    // (ocr/benchmark.js): mismo criterio de acierto en este panel y en el de
    // Benchmark IA — antes uno pasaba a mayusculas y el otro no, y la misma
    // pareja de valores salia verde en un panel y roja en el otro.
    // Los numeros se comparan por VALOR, no por texto: "21" y "21,0" son el
    // mismo IVA y antes se pintaban en rojo como si fueran una discrepancia.
    function normCmp(v) {
      if (v == null) return null;
      const s = String(v).trim().toUpperCase();
      const num = parseFloat(s.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
      if (!isNaN(num) && /^-?[\d.,]+$/.test(s)) return String(num);
      return s;
    }
    // Compara dos importes con tolerancia numérica (2%, igual que el backend en ocr/index.js)
    function tramoNumMatch(a, b) {
      if (a == null || b == null) return false;
      const fa = parseFloat(String(a).replace(',', '.'));
      const fb = parseFloat(String(b).replace(',', '.'));
      if (isNaN(fa) || isNaN(fb)) return false;
      const max = Math.max(Math.abs(fa), Math.abs(fb));
      if (max === 0) return true;
      return Math.abs(fa - fb) / max < 0.02;
    }
    function tramoMatches(t, motorTramo) {
      if (!motorTramo) return false;
      return normCmp(t.porcentaje) === normCmp(motorTramo.porcentaje)
        && tramoNumMatch(t.base, motorTramo.base)
        && tramoNumMatch(t.cuota, motorTramo.cuota);
    }
    // Badge de atribución por tramo — qué motor(es) reportaron ese tramo concreto,
    // usando los datos crudos por motor (motors.<engine>.campos.lineas_iva) que ya
    // viajan en /ocr-detail. Solo aplica a la columna "IA (OCR raw)".
    function tramoBadge(tramo) {
      if (!motorEntries.length) return '';
      const matching = motorEntries.filter(([, m]) => {
        const lineas = (m && m.campos && Array.isArray(m.campos.lineas_iva)) ? m.campos.lineas_iva : [];
        return lineas.some((l) => tramoMatches(tramo, l));
      });
      if (matching.length === 0) return '';
      if (matching.length >= 2) {
        const nombres = matching.map(([k, m]) => (MOTOR_COLOR[(m && m.engine) || k] || { label: k }).label).join(' + ');
        return ` <span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;background:${MOTOR_COLOR.consensus.bg};color:#fff;vertical-align:middle;font-family:sans-serif;">consenso: ${escHtml(nombres)}</span>`;
      }
      const cfg = MOTOR_COLOR[(matching[0][1] && matching[0][1].engine) || matching[0][0]] || { bg: '#718096', label: matching[0][0] };
      return ` <span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;background:${cfg.bg};color:#fff;vertical-align:middle;font-family:sans-serif;">${cfg.label}</span>`;
    }
    function fmtLineasIva(lineas, conBadges) {
      if (!Array.isArray(lineas) || lineas.length === 0) return '—';
      return lineas.map((l, i) =>
        `[${i+1}] ${escHtml(String(l.porcentaje || '?'))}% | base ${fmtOcrImporte(l.base)} | cuota ${fmtOcrImporte(l.cuota)}${conBadges ? tramoBadge(l) : ''}`
      ).join('<br>');
    }
    // Comparación normalizada de lineas_iva: ignora 'productos' y normaliza decimales
    function normLineasCmp(lineas) {
      if (!Array.isArray(lineas)) return null;
      return lineas.map(l => ({
        porcentaje: normCmp(l.porcentaje),
        base:       normCmp(l.base),
        cuota:      normCmp(l.cuota),
      }));
    }

    // La key en el raw OCR es 'total' (no 'total_factura')
    const rawNormalized = { ...raw, total_factura: raw.total_factura ?? raw.total };
    const iaNormalized  = iaPura ? { ...iaPura, total_factura: iaPura.total_factura ?? iaPura.total } : null;

    // Etiqueta de quien sobrescribio a la IA en este campo (known_cifs,
    // registro del usuario, etc.). Es lo que antes hacia que el panel afirmara
    // que "la IA acerto" un valor que la IA nunca habia leido.
    function origenBadge(key) {
      const o = overridePorCampo[key];
      if (!o) return '';
      return ` <span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;background:#975a16;color:#fff;vertical-align:middle;font-family:sans-serif;" title="La IA leyó: ${escAttr(String(o.valor_ia ?? '—'))}">${escHtml(o.fuente)}</span>`;
    }

    const rows = CAMPOS.map(c => {
      const fmt = c.fmt || (v => v != null && v !== '' ? escHtml(String(v)) : '—');
      const vIa   = iaNormalized ? iaNormalized[c.key] : undefined;
      const vRaw  = rawNormalized[c.key];
      const vConf = confirmed[c.key];
      // 2026-08-01 (petición de Julio): el acierto se mide COLUMNA 2 vs COLUMNA 3
      // — lo que el sistema decidió (ya con las sobrescrituras de BD aplicadas,
      // que es exactamente lo que se le presentó al usuario en el modal de
      // confirmación) contra lo que el usuario aceptó y quedó guardado.
      // Antes se medía columna 1 (lectura pura de la IA) vs 3: mide la precisión
      // del motor OCR aislado, pero NO mide lo que de verdad llega al usuario, y
      // deja en n/d todas las facturas anteriores al 29/07/2026, cuando aún no se
      // guardaba `ia_pura`. La columna 1 sigue visible con sus badges de motor.
      // La fila "Tramos IVA" de más abajo ya usaba este mismo criterio 2 vs 3:
      // este cambio también elimina esa incoherencia dentro de la misma tabla.
      const comparable = vRaw != null && vConf != null;
      const igualSistema = comparable && normCmp(vRaw) === normCmp(vConf);
      const badge = !comparable
        ? '<span style="color:#a0aec0;font-size:14px;">—</span>'
        : igualSistema
          ? '<span style="color:#276749;font-weight:700;font-size:14px;">&#10003;&#10003;</span>'
          : '<span style="color:#9b2335;font-weight:700;font-size:14px;">&#10007;</span>';
      const rowBg = (comparable && !igualSistema) ? 'background:#fff5f5;' : '';
      const celdaIa = iaNormalized
        ? `${fmt(vIa)}${motorBadge(c.key, vIa)}`
        : '<span style="color:#a0aec0;">n/d</span>';
      return `<tr style="${rowBg}">
        <td style="padding:7px 10px;font-weight:600;color:#2d3748;white-space:nowrap;">${escHtml(c.label)}</td>
        <td style="padding:7px 10px;font-family:monospace;font-size:13px;">${celdaIa}</td>
        <td style="padding:7px 10px;font-family:monospace;font-size:13px;">${fmt(vRaw)}${origenBadge(c.key)}</td>
        <td style="padding:7px 10px;font-family:monospace;font-size:13px;">${fmt(vConf)}</td>
        <td style="padding:7px 10px;text-align:center;">${badge}</td>
      </tr>`;
    }).join('');

    // Fila especial para lineas_iva — comparación normalizada (excluye 'productos')
    const rawLineas  = raw.lineas_iva;
    const confLineas = confirmed.lineas_iva;
    const lineasIgual = JSON.stringify(normLineasCmp(rawLineas)) === JSON.stringify(normLineasCmp(confLineas));
    const lineasBadge = (rawLineas == null && confLineas == null)
      ? '<span style="color:#a0aec0;font-size:14px;">—</span>'
      : lineasIgual
        ? '<span style="color:#276749;font-weight:700;font-size:14px;">&#10003;&#10003;</span>'
        : '<span style="color:#9b2335;font-weight:700;font-size:14px;">&#10007;</span>';
    const lineasRowBg = (!lineasIgual && (rawLineas || confLineas)) ? 'background:#fff5f5;' : '';
    const rowLineas = `<tr style="${lineasRowBg}">
      <td style="padding:7px 10px;font-weight:600;color:#2d3748;white-space:nowrap;">Tramos IVA</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;line-height:1.6;">${iaNormalized ? fmtLineasIva(iaPura.lineas_iva, true) : '<span style="color:#a0aec0;">n/d</span>'}</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;line-height:1.6;">${fmtLineasIva(rawLineas, true)}</td>
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;line-height:1.6;">${fmtLineasIva(confLineas, false)}</td>
      <td style="padding:7px 10px;text-align:center;">${lineasBadge}</td>
    </tr>`;

    const dualConf   = meta.dual_confirmed    ? '&#10003; Sí' : '&#10007; No';
    const confidence = escHtml(meta.confidence_level || '—');
    const ivaOk      = meta.iva_validation_ok ? '&#10003; Sí' : '&#10007; No';
    const motorLabel = escHtml(meta.ocr_engine || '—');

    // ── Comparativa de imagen: original vs variante de contraste (2026-07-22) ──
    // Bloque 5: solo aparece si esta factura se procesó con
    // pipeline_v2_imagen_variante_enabled activo.
    const imagenVariante = d.imagen_variante || null;
    let imagenComparativaHtml = '';
    if (imagenVariante) {
      const diffs = imagenVariante.diffs || [];
      const diffsRows = diffs.length === 0
        ? '<tr><td colspan="3" style="padding:6px 8px;color:#276749;text-align:center;">Sin diferencias — el motor leyó lo mismo en ambas imágenes</td></tr>'
        : diffs.map((df) => `<tr>
            <td style="padding:6px 8px;font-weight:600;">${escHtml(df.campo)}</td>
            <td style="padding:6px 8px;font-family:monospace;">${df.original != null ? escHtml(String(df.original)) : '—'}</td>
            <td style="padding:6px 8px;font-family:monospace;">${df.variante != null ? escHtml(String(df.variante)) : '—'}</td>
          </tr>`).join('');
      imagenComparativaHtml = `
        <h4 style="margin:18px 0 8px;color:#2d3748;font-size:13px;">🖼️ Comparativa de imagen — original vs contraste (CLAHE)</h4>
        <div style="display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
          <div style="flex:1;min-width:160px;">
            <div style="font-size:11px;color:#718096;margin-bottom:4px;">Original</div>
            <img id="ocr-img-original" style="width:100%;border-radius:6px;border:1px solid #e2e8f0;background:#f7fafc;" alt="Original">
          </div>
          <div style="flex:1;min-width:160px;">
            <div style="font-size:11px;color:#718096;margin-bottom:4px;">Variante contraste (motor: ${escHtml(imagenVariante.motor)})</div>
            <img id="ocr-img-variante" style="width:100%;border-radius:6px;border:1px solid #e2e8f0;background:#f7fafc;" alt="Variante de contraste">
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;">
          <thead><tr style="background:#f7fafc;border-bottom:2px solid #e2e8f0;">
            <th style="padding:6px 8px;text-align:left;">Campo distinto</th>
            <th style="padding:6px 8px;text-align:left;">Original</th>
            <th style="padding:6px 8px;text-align:left;">Variante</th>
          </tr></thead>
          <tbody>${diffsRows}</tbody>
        </table>`;
    }

    // ── Ranking multi-motor (2026-07-22) — qué leyó cada motor de verdad ──────
    // Solo para tech_admin: ver campo a campo qué IA acierta más/menos en esta
    // factura concreta, sin depender de campo_sources (que solo dice quién
    // "ganó" el campo final, no qué leyeron los demás).
    const motorRankingHtml = motorEntries.length === 0 ? '' : `
      <h4 style="margin:18px 0 8px;color:#2d3748;font-size:13px;">🏆 Ranking por motor — qué leyó cada IA</h4>
      <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px;">
        <thead>
          <tr style="background:#f7fafc;border-bottom:2px solid #e2e8f0;">
            <th style="padding:6px 8px;text-align:left;white-space:nowrap;">Campo</th>
            ${motorEntries.map(([key, m]) => {
              const engineKey = (m && m.engine) || key;
              const cfg = MOTOR_COLOR[engineKey] || { bg: '#718096', label: engineKey };
              return `<th style="padding:6px 8px;text-align:left;white-space:nowrap;"><span style="display:inline-block;padding:1px 6px;border-radius:3px;background:${cfg.bg};color:#fff;font-size:11px;">${escHtml(cfg.label)}</span></th>`;
            }).join('')}
            <th style="padding:6px 8px;text-align:left;background:#edf2f7;white-space:nowrap;">Confirmado</th>
          </tr>
        </thead>
        <tbody>
          ${CAMPOS.map(c => {
            const fmt = c.fmt || (v => v != null && v !== '' ? escHtml(String(v)) : '—');
            const vConf = confirmed[c.key];
            const cells = motorEntries.map(([, m]) => {
              const campoObj = (m && m.campos) || {};
              const v = c.key === 'total_factura' ? (campoObj.total_factura ?? campoObj.total) : campoObj[c.key];
              const matches = v != null && vConf != null && normCmp(v) === normCmp(vConf);
              const bg = (v != null && vConf != null) ? (matches ? 'background:#f0fff4;' : 'background:#fff5f5;') : '';
              return `<td style="padding:6px 8px;font-family:monospace;${bg}">${fmt(v)}</td>`;
            }).join('');
            return `<tr>
              <td style="padding:6px 8px;font-weight:600;color:#2d3748;white-space:nowrap;">${escHtml(c.label)}</td>
              ${cells}
              <td style="padding:6px 8px;font-family:monospace;font-weight:700;background:#edf2f7;">${fmt(vConf)}</td>
            </tr>`;
          }).join('')}
          ${(() => {
            // 2026-08-01 (petición de Julio): fila de Tramos IVA en el ranking.
            // Faltaba porque el bucle de arriba itera CAMPOS, que solo contiene
            // campos escalares; en la tabla principal los tramos se añaden como
            // fila manual (rowLineas) y esa adición nunca se replicó aquí.
            // Los datos siempre estuvieron disponibles: motors.<engine>.campos.lineas_iva
            // ya lo consume tramoBadge() para la atribución por tramo de la columna 1.
            // A diferencia del resto de filas, aquí no hay un valor escalar que
            // comparar: se cuentan cuántos de los tramos confirmados reportó cada
            // motor (tramoMatches → % exacto + importes con tolerancia del 2 %).
            const confT = Array.isArray(confLineas) ? confLineas : [];
            const cells = motorEntries.map(([, m]) => {
              const mt = ((m && m.campos) || {}).lineas_iva;
              const tramosMotor = Array.isArray(mt) ? mt : [];
              if (tramosMotor.length === 0) {
                return '<td style="padding:6px 8px;font-family:monospace;color:#a0aec0;">—</td>';
              }
              const aciertos = confT.filter(t => tramosMotor.some(tm => tramoMatches(t, tm))).length;
              const total    = confT.length;
              let bg = '', marcador = '';
              if (total > 0) {
                const col = aciertos === total ? '#276749' : (aciertos === 0 ? '#9b2335' : '#975a16');
                bg = aciertos === total ? 'background:#f0fff4;' : (aciertos === 0 ? 'background:#fff5f5;' : 'background:#fffbeb;');
                // Señal extra cuando el motor inventa tramos que nadie confirmó.
                const sobra = tramosMotor.length > total ? ` (+${tramosMotor.length - total} no confirmado${tramosMotor.length - total !== 1 ? 's' : ''})` : '';
                marcador = `<div style="margin-top:4px;font-family:sans-serif;font-size:11px;font-weight:700;color:${col};">${aciertos}/${total} tramos${sobra}</div>`;
              }
              return `<td style="padding:6px 8px;font-family:monospace;${bg}">${fmtLineasIva(tramosMotor, false)}${marcador}</td>`;
            }).join('');
            return `<tr>
              <td style="padding:6px 8px;font-weight:600;color:#2d3748;white-space:nowrap;">Tramos IVA</td>
              ${cells}
              <td style="padding:6px 8px;font-family:monospace;font-weight:700;background:#edf2f7;">${fmtLineasIva(confLineas, false)}</td>
            </tr>`;
          })()}
        </tbody>
      </table>
      </div>
      <p style="font-size:11px;color:#718096;margin:0 0 14px;">Verde = coincide con lo confirmado · Rojo = discrepa. Para comparar qué motor se equivoca más en esta factura concreta.<br>En <strong>Tramos IVA</strong> se cuenta cuántos tramos confirmados reportó cada motor (<em>n/total</em>): verde = todos, ámbar = algunos, rojo = ninguno. Los importes se comparan con tolerancia del 2 %, el tipo de IVA debe ser exacto. <em>—</em> = ese motor no devolvió tramos.</p>`;

    body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:14px;">
        <thead>
          <tr style="background:#f7fafc;border-bottom:2px solid #e2e8f0;">
            <th style="padding:8px 10px;text-align:left;color:#4a5568;font-weight:600;">Campo</th>
            <th style="padding:8px 10px;text-align:left;color:#4a5568;font-weight:600;">1 · Leyó la IA</th>
            <th style="padding:8px 10px;text-align:left;color:#4a5568;font-weight:600;">2 · Decidió el sistema</th>
            <th style="padding:8px 10px;text-align:left;color:#4a5568;font-weight:600;">3 · Confirmado humano</th>
            <th style="padding:8px 10px;text-align:center;color:#4a5568;font-weight:600;" title="Compara la columna 2 (lo que el sistema le presentó al usuario) con la 3 (lo que el usuario aceptó)">¿Acertó el sistema?</th>
          </tr>
        </thead>
        <tbody>${rows}${rowLineas}</tbody>
      </table>
      <p style="font-size:11px;color:#718096;margin:0 0 12px;line-height:1.6;">
        <strong>1 · Leyó la IA</strong>: fusión de los motores + recálculos aritméticos, tal cual, sin tocar la base de datos. Los badges de color dicen qué motor aportó cada valor.<br>
        <strong>2 · Decidió el sistema</strong>: lo anterior, pero con los campos que el sistema sobrescribe desde la BD. El badge marrón indica el origen (pasa el ratón por encima para ver qué había leído la IA). El nombre y CIF de la empresa que hace la foto se toman <em>siempre</em> del registro del usuario, nunca de la IA — es deliberado.<br>
        <strong>3 · Confirmado humano</strong>: lo que hay hoy en la base de datos, incluidas las ediciones manuales del panel.<br>
        <strong>¿Acertó el sistema?</strong> compara la columna <strong>2 contra la 3</strong>: lo que el sistema decidió y le presentó al usuario, frente a lo que el usuario aceptó y quedó guardado. Mide lo que de verdad llega al cliente, no la precisión del motor OCR aislado. Para eso último, mira la columna 1 y el ranking por motor. Disponible en <em>todas</em> las facturas, también en las anteriores al 29/07/2026.
      </p>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;padding:10px 12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;">
        <span><strong>Motor OCR:</strong> <span style="font-family:monospace;">${motorLabel}</span></span>
        <span><strong>Dual confirmado:</strong> <span style="font-family:monospace;">${dualConf}</span></span>
        <span><strong>Confianza:</strong> <span style="font-family:monospace;">${confidence}</span></span>
        <span><strong>IVA válido:</strong> <span style="font-family:monospace;">${ivaOk}</span></span>
      </div>
      ${motorRankingHtml}
      ${imagenComparativaHtml}`;

    // Cargar las imágenes autenticadas (blob) tras pintar el HTML — un <img
    // src="url"> normal no llevaría el header de autenticación.
    if (imagenVariante) {
      const cargarImg = (url, imgId) => {
        const img = document.getElementById(imgId);
        // cache: 'no-store' — un Ctrl+Shift+R en la página NO invalida la
        // caché HTTP de un fetch() lanzado después al abrir el modal; sin
        // esto, un 404 servido antes de que la variante existiera puede
        // quedar cacheado indefinidamente para esta URL exacta (sin
        // cache-buster) y el usuario no tiene forma de forzar una petición
        // nueva desde la propia página.
        authFetch(url, { cache: 'no-store' })
          .then((r) => {
            if (!r.ok) throw new Error(r.status === 404 ? 'no disponible' : `HTTP ${r.status}`);
            return r.blob();
          })
          .then((b) => { img.src = URL.createObjectURL(b); })
          .catch((err) => {
            img.replaceWith(Object.assign(document.createElement('div'), {
              style: 'padding:20px;text-align:center;color:#a0aec0;font-size:11px;border:1px dashed #e2e8f0;border-radius:6px;',
              textContent: `Imagen no disponible (${err.message})`,
            }));
          });
      };
      cargarImg(`${API_URL}/admin/facturas/${facturaId}/imagen`, 'ocr-img-original');
      cargarImg(`${API_URL}/admin/facturas/${facturaId}/imagen-variante`, 'ocr-img-variante');
    }
  } catch (err) {
    body.innerHTML = `<p style="color:#9b2335;padding:20px 0;text-align:center;">Error al cargar datos OCR: ${escHtml(err.message)}</p>`;
  }
}

function closeOcrModal() {
  const m = document.getElementById('ocr-modal');
  if (m) m.style.display = 'none';
}

function initOcrModal() {
  const modal    = document.getElementById('ocr-modal');
  const closeBtn = document.getElementById('ocr-modal-close');
  if (!modal || !closeBtn) return; // el modal solo existe en el HTML para esta sesión
  closeBtn.addEventListener('click', closeOcrModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeOcrModal(); });
}

// ── Pipeline v2 — comparativa shadow (2026-07-21, solo tech_admin) ────────────
// Panel de solo lectura: v1 (decisión real) vs v2 (routing determinista nuevo)
// vs si el humano corrigió algo al confirmar. Pensado para volumen bajo —
// cada fila es una factura revisable a mano, no hace falta esperar a acumular
// cientos de casos para sacar conclusiones.
let shadowTable = null;

function closeShadowModal() {
  const m = document.getElementById('shadow-modal');
  if (m) m.style.display = 'none';
}

function initShadowModal() {
  const modal    = document.getElementById('shadow-modal');
  const closeBtn = document.getElementById('shadow-modal-close');
  const openBtn  = document.getElementById('btn-shadow-v2');
  if (!modal || !closeBtn || !openBtn) return; // solo existe en el HTML para esta sesión
  closeBtn.addEventListener('click', closeShadowModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeShadowModal(); });
  openBtn.addEventListener('click', openShadowModal);
}

function shadowBadge(ok) {
  if (ok == null) return '<span style="color:#a0aec0;">—</span>';
  return ok
    ? '<span style="color:#276749;font-weight:700;">&#10003;</span>'
    : '<span style="color:#9b2335;font-weight:700;">&#10007;</span>';
}

async function openShadowModal() {
  const modal = document.getElementById('shadow-modal');
  modal.style.display = 'flex';

  try {
    const res = await authFetch(`${API_URL}/admin/facturas/shadow-comparativa`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = (data.rows || []).map(r => ({
      ...r,
      total_factura: r.total_factura != null ? parseFloat(r.total_factura) : null,
      incidencias_error: Array.isArray(r.incidencias)
        ? r.incidencias.filter(i => i.severidad === 'error').length
        : 0,
    }));

    if (shadowTable) {
      shadowTable.replaceData(rows);
      return;
    }

    shadowTable = new Tabulator('#shadow-table', {
      data: rows,
      index: 'id',
      height: 'calc(80vh - 160px)',
      layout: 'fitDataFill',
      placeholder: 'Sin datos todavía — activa pipeline_v2_shadow_mode en features.json para empezar a recoger comparaciones.',
      columns: [
        { title: 'Fecha proceso', field: 'creado_en', width: 150, sorter: 'datetime',
          formatter: (cell) => { const v = cell.getValue(); return v ? new Date(v).toLocaleString('es-ES') : '—'; } },
        // 2026-07-23: fix reportado por Julio — sin esto, una foto que se
        // previsualizó pero NUNCA se confirmó (usuario cerró la app, fallo,
        // etc.) aparecía con proveedor/NIF/total en blanco y la decisión de
        // v2 al lado, dando la falsa impresión de "aceptó una factura
        // vacía". No es eso: decidirRouting() sí analizó una foto real en su
        // momento, pero como nunca se confirmó no queda registrada como
        // factura (los datos del preview viven solo 30 min en Redis).
        { title: 'Factura', field: 'upload_id', width: 130, hozAlign: 'center',
          formatter: (cell) => cell.getValue()
            ? '<span style="color:#276749;font-weight:600;">✓ Confirmada</span>'
            : '<span style="color:#c05621;font-weight:600;" title="Se analizó la foto pero el usuario nunca confirmó/guardó la factura — no hay datos reales que mostrar, la decisión fue sobre esa foto en su momento.">⚠ Sin confirmar</span>' },
        { title: 'Proveedor',  field: 'proveedor_nombre', minWidth: 160, sorter: 'string',
          formatter: (cell) => cell.getValue() ? escHtml(cell.getValue()) : '<span style="color:#a0aec0;">(foto abandonada)</span>' },
        { title: 'NIF',        field: 'proveedor_nif', width: 110, sorter: 'string',
          formatter: (cell) => cell.getValue() ? escHtml(cell.getValue()) : '<span style="color:#a0aec0;">—</span>' },
        { title: 'Total',      field: 'total_factura', width: 100, hozAlign: 'right',
          sorter: (a, b) => (parseSpanishAmountAdmin(a) ?? -Infinity) - (parseSpanishAmountAdmin(b) ?? -Infinity),
          formatter: formatEuro },
        { title: 'Decisión v1 (real)', field: 'decision_v1', width: 140, sorter: 'string' },
        { title: 'Decisión v2 (nueva)', field: 'decision_v2', width: 140, sorter: 'string' },
        { title: '¿Coincide?', field: 'coincide', width: 90, hozAlign: 'center',
          formatter: (cell) => shadowBadge(cell.getValue()) },
        { title: '¿Humano corrigió?', field: 'humano_corrigio', width: 110, hozAlign: 'center',
          formatter: (cell) => shadowBadge(cell.getValue()) },
        { title: 'Incidencias v2 (error)', field: 'incidencias_error', width: 130, hozAlign: 'center', sorter: 'number' },
      ],
      rowFormatter: (row) => {
        const d = row.getData();
        if (!d.upload_id) {
          // Foto sin confirmar: gris + cursiva, para que nunca se confunda
          // con una factura real ya guardada (aunque coincida y no tenga
          // incidencias, no representa una decisión real sobre datos reales).
          row.getElement().style.background = '#f7fafc';
          row.getElement().style.fontStyle = 'italic';
        } else if (d.coincide === false) {
          row.getElement().style.background = '#fff5f5';
        }
      },
    });
  } catch (err) {
    document.getElementById('shadow-table').innerHTML =
      `<p style="color:#9b2335;padding:20px 0;text-align:center;">Error al cargar la comparativa: ${escHtml(err.message)}</p>`;
  }
}

// ── Benchmark IA — 3 imágenes × todos los motores (2026-07-23) ──────────────
// Petición de Julio: comparar actual/original/contraste contra TODOS los
// motores OCR, puntuado contra lo confirmado por el humano. Coste real
// asumido explícitamente — solo tech_admin, "activable" desde el propio panel.
let benchmarkTable = null;

// ── Ranking profesional + gráfico interactivo (2026-07-24) ──────────────────
// Petición de Julio: un único análisis fino, con desglose POR CAMPO (no solo
// el ratio agregado) — ¿un motor falla más en CIF? ¿en fecha? ¿en tramos de
// IVA? Los datos vienen ya agregados del backend (GET .../benchmark/ranking),
// sin volver a llamar a ninguna IA. El gráfico es vanilla JS/CSS (barras) —
// sin vendorizar ninguna librería nueva, coherente con el resto del stack.
const BENCHMARK_MOTORES = ['openai', 'azure', 'gemini_flash', 'gemini_pro', 'mistral'];
const BENCHMARK_VARIANTES = ['actual', 'original', 'contraste'];
const BENCHMARK_MOTOR_LABELS = {
  openai: 'OpenAI', azure: 'Azure DI', gemini_flash: 'Gemini Flash',
  gemini_pro: 'Gemini Pro', mistral: 'Mistral',
};
const BENCHMARK_ORDEN_GRUPOS = ['CIF/NIF', 'Nombre', 'Fecha', 'Nº factura', 'Importes', 'Tramos IVA'];

let benchmarkRankingData = null;
let benchmarkRankingTable = null;
let benchmarkFiltroMotor = '__todos';
let benchmarkFiltroVariante = '__todas';

// 2026-07-27: además de las barras (un solo grupo de campo agregado), dos
// vistas nuevas pedidas por Julio — "quiero ver todo, cuando le doy a
// todos, como un gráfico de colores en 2D" (mapa de calor motor×variante,
// SIEMPRE con todos los combos, ignora los chips de motor/variante a
// propósito) y "gráficos de líneas" (una línea por motor, comparando los
// 6 grupos de campo a la vez — más fácil ver patrones que con barras
// sueltas de un único motor). Todo vanilla JS/CSS, sin librerías nuevas.
const BENCHMARK_VISTAS = [
  { key: 'barras', label: '📊 Barras' },
  { key: 'heatmap', label: '🔥 Mapa de calor' },
  { key: 'lineas', label: '📈 Líneas' },
];
let benchmarkVistaActual = 'barras';
// 2026-07-27: mapa de calor con selector de campo (Global + los 6 grupos) y
// degradado de color CONTINUO (HSL, rojo→amarillo→verde) en vez de bandas
// planas — pedido explícito de Julio ("más visual, más atractivo").
let benchmarkHeatmapCampo = '__global';
function benchmarkColorGradiente(ratio) {
  if (ratio == null) return '#e2e8f0';
  const clamped = Math.max(0, Math.min(100, ratio));
  const hue = (clamped / 100) * 120; // 0=rojo, 60=amarillo, 120=verde
  const luz = 42 + (clamped / 100) * 8; // ligeramente más claro cuanto mejor el resultado
  return `hsl(${hue}, 68%, ${luz}%)`;
}

function initBenchmarkTabs() {
  const tabRanking = document.getElementById('tab-benchmark-ranking');
  const tabDetalle = document.getElementById('tab-benchmark-detalle');
  const viewRanking = document.getElementById('benchmark-view-ranking');
  const viewDetalle = document.getElementById('benchmark-view-detalle');
  if (!tabRanking || !tabDetalle || !viewRanking || !viewDetalle) return;
  tabRanking.addEventListener('click', () => {
    tabRanking.classList.add('is-active');
    tabDetalle.classList.remove('is-active');
    viewRanking.style.display = '';
    viewDetalle.style.display = 'none';
  });
  tabDetalle.addEventListener('click', () => {
    tabDetalle.classList.add('is-active');
    tabRanking.classList.remove('is-active');
    viewDetalle.style.display = '';
    viewRanking.style.display = 'none';
  });
}

function initBenchmarkChips() {
  const contVista = document.getElementById('benchmark-chips-vista');
  const contMotor = document.getElementById('benchmark-chips-motor');
  const contVariante = document.getElementById('benchmark-chips-variante');
  const contCampo = document.getElementById('benchmark-chips-campo');
  if (!contVista || !contMotor || !contVariante || !contCampo) return;

  const campos = [{ key: '__global', label: 'Global' }, ...BENCHMARK_ORDEN_GRUPOS.map((g) => ({ key: g, label: g }))];
  contCampo.innerHTML = campos.map((c) =>
    `<button class="benchmark-chip${c.key === benchmarkHeatmapCampo ? ' is-active' : ''}" data-campo="${escHtml(c.key)}">${escHtml(c.label)}</button>`
  ).join('');
  contCampo.querySelectorAll('.benchmark-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      benchmarkHeatmapCampo = btn.dataset.campo;
      contCampo.querySelectorAll('.benchmark-chip').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderBenchmarkRanking();
    });
  });

  contVista.innerHTML = BENCHMARK_VISTAS.map((v) =>
    `<button class="benchmark-chip${v.key === benchmarkVistaActual ? ' is-active' : ''}" data-vista="${escHtml(v.key)}">${escHtml(v.label)}</button>`
  ).join('');
  contVista.querySelectorAll('.benchmark-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      benchmarkVistaActual = btn.dataset.vista;
      contVista.querySelectorAll('.benchmark-chip').forEach((b) => b.classList.toggle('is-active', b === btn));
      actualizarVisibilidadFiltrosBenchmark();
      renderBenchmarkRanking();
    });
  });

  const motores = [{ key: '__todos', label: 'Todos' }, ...BENCHMARK_MOTORES.map((m) => ({ key: m, label: BENCHMARK_MOTOR_LABELS[m] || m }))];
  const variantes = [{ key: '__todas', label: 'Todas' }, ...BENCHMARK_VARIANTES.map((v) => ({ key: v, label: benchmarkVarianteLabel(v) }))];

  contMotor.innerHTML = motores.map((m) =>
    `<button class="benchmark-chip${m.key === benchmarkFiltroMotor ? ' is-active' : ''}" data-motor="${escHtml(m.key)}">${escHtml(m.label)}</button>`
  ).join('');
  contVariante.innerHTML = variantes.map((v) =>
    `<button class="benchmark-chip${v.key === benchmarkFiltroVariante ? ' is-active' : ''}" data-variante="${escHtml(v.key)}">${escHtml(v.label)}</button>`
  ).join('');

  contMotor.querySelectorAll('.benchmark-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      benchmarkFiltroMotor = btn.dataset.motor;
      contMotor.querySelectorAll('.benchmark-chip').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderBenchmarkRanking();
    });
  });
  contVariante.querySelectorAll('.benchmark-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      benchmarkFiltroVariante = btn.dataset.variante;
      contVariante.querySelectorAll('.benchmark-chip').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderBenchmarkRanking();
    });
  });

  actualizarVisibilidadFiltrosBenchmark();
}

/** El mapa de calor SIEMPRE muestra todos los combos a propósito ("quiero
 *  ver todo, cuando le doy a todos") — los chips de motor/variante no
 *  aplican ahí, se ocultan para no sugerir un filtrado que no hace nada. */
function actualizarVisibilidadFiltrosBenchmark() {
  const grupoMotor = document.getElementById('benchmark-filtros-motor-variante');
  const grupoVariante = document.getElementById('benchmark-filtros-variante');
  const grupoCampo = document.getElementById('benchmark-filtros-campo');
  const nota = document.getElementById('benchmark-vista-nota');
  const esHeatmap = benchmarkVistaActual === 'heatmap';
  if (grupoMotor) grupoMotor.style.display = esHeatmap ? 'none' : '';
  if (grupoVariante) grupoVariante.style.display = esHeatmap ? 'none' : '';
  if (grupoCampo) grupoCampo.style.display = esHeatmap ? '' : 'none';
  if (nota) {
    nota.style.display = esHeatmap ? 'block' : 'none';
    nota.textContent = esHeatmap ? 'El mapa de calor siempre muestra todos los motores y variantes a la vez — elige qué campo comparar.' : '';
  }
}

function benchmarkCombosFiltrados() {
  if (!benchmarkRankingData) return [];
  return benchmarkRankingData.ranking.filter((c) =>
    (benchmarkFiltroMotor === '__todos' || c.motor === benchmarkFiltroMotor) &&
    (benchmarkFiltroVariante === '__todas' || c.variante === benchmarkFiltroVariante)
  );
}

/** Suma aciertos/comparables por grupo de campo a través de varios combos
 *  motor×variante (p.ej. "todos los motores" = agregado de las 5 filas). */
function benchmarkAgregarGrupos(combos) {
  const acc = {};
  combos.forEach((c) => {
    (c.por_grupo || []).forEach((g) => {
      if (!acc[g.grupo]) acc[g.grupo] = { aciertos: 0, comparables: 0 };
      acc[g.grupo].aciertos += g.aciertos;
      acc[g.grupo].comparables += g.comparables;
    });
  });
  const grupos = Object.entries(acc).map(([grupo, v]) => ({
    grupo,
    ratio: v.comparables ? Math.round((v.aciertos / v.comparables) * 100) : null,
    aciertos: v.aciertos,
    comparables: v.comparables,
  }));
  return BENCHMARK_ORDEN_GRUPOS
    .map((nombre) => grupos.find((g) => g.grupo === nombre))
    .filter(Boolean)
    .concat(grupos.filter((g) => !BENCHMARK_ORDEN_GRUPOS.includes(g.grupo)));
}

function renderBenchmarkChart(grupos) {
  const cont = document.getElementById('benchmark-chart');
  if (!cont) return;
  if (!grupos.length) {
    cont.innerHTML = '<p style="color:#a0aec0;padding:20px;margin:0;">Sin datos todavía para esta combinación.</p>';
    return;
  }
  const barras = grupos.map((g) => {
    const pct = g.ratio ?? 0;
    const nivel = pct >= 85 ? '' : pct >= 60 ? 'nivel-medio' : 'nivel-bajo';
    return `
      <div class="benchmark-bar-col">
        <span class="benchmark-bar-pct">${g.ratio != null ? g.ratio + '%' : '—'}</span>
        <div class="benchmark-bar ${nivel}" style="height:${Math.max(pct, 2)}%"></div>
        <span class="benchmark-bar-label">${escHtml(g.grupo)}<br>(${g.aciertos}/${g.comparables})</span>
      </div>`;
  }).join('');
  cont.innerHTML = `<div class="benchmark-barras-wrap">${barras}</div>`;
}

function renderBenchmarkRankingTable() {
  if (!benchmarkRankingData) return;
  const rows = benchmarkRankingData.ranking.map((c, i) => {
    const fila = {
      _id: `${c.motor}-${c.variante}`,
      posicion: i + 1,
      motor: BENCHMARK_MOTOR_LABELS[c.motor] || c.motor,
      variante: benchmarkVarianteLabel(c.variante),
      ratio_global: c.ratio_global,
      ejecuciones: c.ejecuciones,
      errores: c.errores,
      tiempo_medio_s: c.tiempo_medio_s,
    };
    (c.por_grupo || []).forEach((g) => { fila[`grupo_${g.grupo}`] = g.ratio; });
    return fila;
  });

  if (benchmarkRankingTable) {
    benchmarkRankingTable.replaceData(rows);
    return;
  }

  const gruposColumnas = BENCHMARK_ORDEN_GRUPOS.map((g) => ({
    title: g, field: `grupo_${g}`, width: 100, hozAlign: 'center', sorter: 'number',
    formatter: (cell) => cell.getValue() != null ? `${cell.getValue()}%` : '<span style="color:#a0aec0;">—</span>',
  }));

  benchmarkRankingTable = new Tabulator('#benchmark-ranking-table', {
    data: rows,
    index: '_id',
    layout: 'fitDataFill',
    height: '360px',
    placeholder: 'Sin datos todavía — activa el benchmark o pulsa "Ejecutar sobre las últimas 10 facturas".',
    columns: [
      { title: '#', field: 'posicion', width: 46, hozAlign: 'center' },
      { title: 'Motor', field: 'motor', width: 130, sorter: 'string' },
      { title: 'Variante', field: 'variante', width: 170, sorter: 'string' },
      { title: '% global', field: 'ratio_global', width: 100, hozAlign: 'center', sorter: 'number',
        formatter: (cell) => cell.getValue() != null ? `${cell.getValue()}%` : '<span style="color:#a0aec0;">—</span>' },
      ...gruposColumnas,
      { title: 'Ejecuciones', field: 'ejecuciones', width: 100, hozAlign: 'center', sorter: 'number' },
      { title: 'Errores', field: 'errores', width: 90, hozAlign: 'center', sorter: 'number' },
      { title: 'Tiempo medio', field: 'tiempo_medio_s', width: 110, hozAlign: 'right', sorter: 'number',
        formatter: (cell) => cell.getValue() != null ? `${cell.getValue()}s` : '—' },
    ],
    rowFormatter: (row) => { if (row.getData().posicion === 1) row.getElement().style.background = '#f0fff4'; },
  });
}

const BENCHMARK_COLOR_MOTOR = {
  openai: '#3182ce', azure: '#805ad5', gemini_flash: '#38a169',
  gemini_pro: '#d69e2e', mistral: '#e53e3e',
};

/** Mapa de calor motor×variante — SIEMPRE todos los combos, ignora los
 *  chips de motor/variante a propósito (es la vista "quiero verlo todo"). */
/** Obtiene el ratio a colorear para una combinación motor×variante, según
 *  el campo elegido en los chips (Global = ratio_global agregado, o el
 *  ratio de ese grupo concreto dentro de por_grupo). */
function benchmarkRatioParaCampo(combo, campo) {
  if (!combo) return null;
  if (campo === '__global') return combo.ratio_global;
  const grupo = (combo.por_grupo || []).find((g) => g.grupo === campo);
  return grupo ? grupo.ratio : null;
}

function renderBenchmarkHeatmap() {
  const cont = document.getElementById('benchmark-chart');
  if (!cont) return;
  if (!benchmarkRankingData || !benchmarkRankingData.ranking.length) {
    cont.innerHTML = '<p style="color:#a0aec0;padding:20px;margin:0;">Sin datos todavía.</p>';
    return;
  }
  const mapa = {};
  benchmarkRankingData.ranking.forEach((c) => { mapa[`${c.motor}__${c.variante}`] = c; });
  const campo = benchmarkHeatmapCampo;
  const tituloCampo = campo === '__global' ? 'ratio global' : campo;

  let html = `<div class="benchmark-heatmap-titulo-vista">${escHtml(campo === '__global' ? 'Vista general (todos los campos)' : `Campo: ${campo}`)}</div>`;
  html += '<div class="benchmark-heatmap">';
  html += '<div class="benchmark-heatmap-row benchmark-heatmap-header"><div class="benchmark-heatmap-celda benchmark-heatmap-esquina"></div>';
  BENCHMARK_VARIANTES.forEach((v) => { html += `<div class="benchmark-heatmap-celda benchmark-heatmap-titulo">${escHtml(benchmarkVarianteLabel(v))}</div>`; });
  html += '</div>';
  BENCHMARK_MOTORES.forEach((motor) => {
    html += `<div class="benchmark-heatmap-row"><div class="benchmark-heatmap-celda benchmark-heatmap-titulo">${escHtml(BENCHMARK_MOTOR_LABELS[motor] || motor)}</div>`;
    BENCHMARK_VARIANTES.forEach((variante) => {
      const c = mapa[`${motor}__${variante}`];
      const ratio = benchmarkRatioParaCampo(c, campo);
      const color = benchmarkColorGradiente(ratio);
      const texto = ratio != null ? `${ratio}%` : '—';
      const subtexto = c ? `${c.ejecuciones} facturas${c.errores ? ` · ${c.errores} err.` : ''}` : '';
      const titulo = c ? `${BENCHMARK_MOTOR_LABELS[motor] || motor} / ${benchmarkVarianteLabel(variante)} — ${tituloCampo}: ${texto} (${c.ejecuciones} ejecuciones, ${c.errores} errores)` : 'Sin datos';
      html += `<div class="benchmark-heatmap-celda benchmark-heatmap-dato" style="background:${color};" title="${escHtml(titulo)}">
                 <span class="benchmark-heatmap-pct">${texto}</span>
                 ${subtexto ? `<span class="benchmark-heatmap-sub">${escHtml(subtexto)}</span>` : ''}
               </div>`;
    });
    html += '</div>';
  });
  html += '</div>';
  html += `<div class="benchmark-heatmap-leyenda">
             <span>0%</span>
             <span class="benchmark-heatmap-leyenda-barra"></span>
             <span>100%</span>
           </div>`;
  cont.innerHTML = html;
}

/** Gráfico de líneas: una línea por motor, comparando los 6 grupos de campo
 *  a la vez — mejor que barras sueltas para ver en qué falla cada motor
 *  respecto a los demás. Respeta los chips de motor/variante (filtran qué
 *  líneas/variantes se agregan), a diferencia del mapa de calor. */
function renderBenchmarkLineas() {
  const cont = document.getElementById('benchmark-chart');
  if (!cont) return;
  const motoresAIncluir = benchmarkFiltroMotor === '__todos' ? BENCHMARK_MOTORES : [benchmarkFiltroMotor];
  const variantesAIncluir = benchmarkFiltroVariante === '__todas' ? BENCHMARK_VARIANTES : [benchmarkFiltroVariante];

  const series = motoresAIncluir.map((motor) => {
    const combos = (benchmarkRankingData?.ranking || []).filter((c) => c.motor === motor && variantesAIncluir.includes(c.variante));
    return { motor, grupos: benchmarkAgregarGrupos(combos) };
  }).filter((s) => s.grupos.length);

  if (!series.length) {
    cont.innerHTML = '<p style="color:#a0aec0;padding:20px;margin:0;">Sin datos todavía para esta combinación.</p>';
    return;
  }

  const ancho = 640, alto = 200, padIzq = 34, padDer = 12, padSup = 12, padInf = 30;
  const anchoUtil = ancho - padIzq - padDer, altoUtil = alto - padSup - padInf;
  const categorias = BENCHMARK_ORDEN_GRUPOS;
  const posX = (i) => padIzq + (categorias.length > 1 ? (i / (categorias.length - 1)) * anchoUtil : anchoUtil / 2);
  const posY = (pct) => padSup + altoUtil - (Math.max(0, Math.min(100, pct ?? 0)) / 100) * altoUtil;

  let svg = `<svg viewBox="0 0 ${ancho} ${alto}" class="benchmark-lineas-svg" preserveAspectRatio="xMidYMid meet">`;
  [0, 25, 50, 75, 100].forEach((marca) => {
    svg += `<line x1="${padIzq}" y1="${posY(marca)}" x2="${ancho - padDer}" y2="${posY(marca)}" stroke="#edf2f7" stroke-width="1"/>`;
    svg += `<text x="${padIzq - 6}" y="${posY(marca) + 3}" font-size="9" fill="#a0aec0" text-anchor="end">${marca}</text>`;
  });
  categorias.forEach((cat, i) => {
    const etiqueta = cat.length > 10 ? cat.substring(0, 9) + '…' : cat;
    svg += `<text x="${posX(i)}" y="${alto - 8}" font-size="9" fill="#718096" text-anchor="middle">${escHtml(etiqueta)}</text>`;
  });
  series.forEach((s) => {
    const color = BENCHMARK_COLOR_MOTOR[s.motor] || '#4a5568';
    const puntos = categorias.map((cat, i) => {
      const g = s.grupos.find((gr) => gr.grupo === cat);
      return `${posX(i)},${posY(g ? g.ratio : null)}`;
    }).join(' ');
    svg += `<polyline points="${puntos}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
    categorias.forEach((cat, i) => {
      const g = s.grupos.find((gr) => gr.grupo === cat);
      if (g && g.ratio != null) {
        svg += `<circle cx="${posX(i)}" cy="${posY(g.ratio)}" r="3.5" fill="${color}"><title>${escHtml(BENCHMARK_MOTOR_LABELS[s.motor] || s.motor)} · ${escHtml(cat)}: ${g.ratio}%</title></circle>`;
      }
    });
  });
  svg += '</svg>';

  const leyenda = series.map((s) =>
    `<span class="benchmark-leyenda-item"><span class="benchmark-leyenda-color" style="background:${BENCHMARK_COLOR_MOTOR[s.motor] || '#4a5568'}"></span>${escHtml(BENCHMARK_MOTOR_LABELS[s.motor] || s.motor)}</span>`
  ).join('');

  cont.innerHTML = `<div class="benchmark-lineas-wrap">${svg}<div class="benchmark-leyenda">${leyenda}</div></div>`;
}

/** Para cada grupo de campo (CIF, Nombre, Fecha, Nº factura, Importes,
 *  Tramos IVA), encuentra qué combinación motor+variante saca el mejor
 *  ratio — "quiero una parte que me diga la combinación... del mejor
 *  modelo unido con la mejor forma de imagen para cada variable" (Julio,
 *  2026-07-27). Siempre visible, independiente de la vista/chips elegidos.*/
function renderBenchmarkMejoresCombinaciones() {
  const cont = document.getElementById('benchmark-mejores-combinaciones');
  if (!cont) return;
  if (!benchmarkRankingData || !benchmarkRankingData.ranking.length) {
    cont.innerHTML = '';
    return;
  }
  const tarjetas = BENCHMARK_ORDEN_GRUPOS.map((grupo) => {
    let mejor = null;
    benchmarkRankingData.ranking.forEach((c) => {
      const g = (c.por_grupo || []).find((x) => x.grupo === grupo);
      if (g && g.ratio != null && g.comparables > 0 && (!mejor || g.ratio > mejor.ratio)) {
        mejor = { ratio: g.ratio, motor: c.motor, variante: c.variante };
      }
    });
    return { grupo, mejor };
  });

  cont.innerHTML = tarjetas.map(({ grupo, mejor }) => {
    if (!mejor) {
      return `<div class="benchmark-mejor-card">
                <span class="benchmark-mejor-grupo">${escHtml(grupo)}</span>
                <span class="benchmark-mejor-combo" style="color:#a0aec0;">Sin datos</span>
              </div>`;
    }
    const color = benchmarkColorGradiente(mejor.ratio);
    return `<div class="benchmark-mejor-card" style="border-left-color:${color}">
              <span class="benchmark-mejor-grupo">${escHtml(grupo)}</span>
              <span class="benchmark-mejor-combo">${escHtml(BENCHMARK_MOTOR_LABELS[mejor.motor] || mejor.motor)} · ${escHtml(benchmarkVarianteLabel(mejor.variante))}</span>
              <span class="benchmark-mejor-pct" style="background:${color}">${mejor.ratio}%</span>
            </div>`;
  }).join('');
}

function renderBenchmarkRanking() {
  renderBenchmarkMejoresCombinaciones();
  if (benchmarkVistaActual === 'heatmap') {
    renderBenchmarkHeatmap();
  } else if (benchmarkVistaActual === 'lineas') {
    renderBenchmarkLineas();
  } else {
    renderBenchmarkChart(benchmarkAgregarGrupos(benchmarkCombosFiltrados()));
  }
  renderBenchmarkRankingTable();
}

function closeBenchmarkModal() {
  const m = document.getElementById('benchmark-modal');
  if (m) m.style.display = 'none';
}

function initBenchmarkModal() {
  const modal = document.getElementById('benchmark-modal');
  const closeBtn = document.getElementById('benchmark-modal-close');
  const openBtn = document.getElementById('btn-benchmark');
  const toggle = document.getElementById('benchmark-toggle');
  const btnUltimas = document.getElementById('btn-benchmark-ultimas');
  if (!modal || !closeBtn || !openBtn || !toggle || !btnUltimas) return;
  closeBtn.addEventListener('click', closeBenchmarkModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeBenchmarkModal(); });
  openBtn.addEventListener('click', openBenchmarkModal);
  initBenchmarkTabs();
  initBenchmarkChips();

  toggle.addEventListener('change', async () => {
    const statusEl = document.getElementById('benchmark-status');
    const wanted = toggle.checked;
    toggle.disabled = true;
    try {
      const res = await authFetch(`${API_URL}/admin/benchmark-flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: wanted }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      statusEl.textContent = wanted ? 'Activado — se ejecutará en cada factura nueva.' : 'Desactivado.';
    } catch (err) {
      toggle.checked = !wanted; // revertir visualmente si falló el guardado
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      toggle.disabled = false;
    }
  });

  btnUltimas.addEventListener('click', async () => {
    const statusEl = document.getElementById('benchmark-status');
    btnUltimas.disabled = true;
    btnUltimas.textContent = 'Iniciando…';
    try {
      const res = await authFetch(`${API_URL}/admin/facturas/benchmark/ultimas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 10 }),
      });
      const data = await res.json();
      if (res.status === 409) {
        // Ya había un lote en curso (p.ej. doble clic) — el backend lo
        // rechaza para no duplicar el gasto en OCR. Nos limitamos a
        // engancharnos al progreso del que ya está corriendo.
        statusEl.textContent = data.error;
        pollBenchmarkEstado();
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      pollBenchmarkEstado();
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      btnUltimas.disabled = false;
      btnUltimas.textContent = '▶ Últimas 10';
    }
  });
}

// 2026-07-23: progreso real del lote retroactivo (antes no había ninguna
// señal — Julio pulsó el botón, no vio nada, y lo volvió a pulsar,
// duplicando sin querer el gasto real en OCR sobre las mismas facturas).
let benchmarkPollTimer = null;

async function pollBenchmarkEstado() {
  const statusEl = document.getElementById('benchmark-status');
  const btnUltimas = document.getElementById('btn-benchmark-ultimas');
  if (benchmarkPollTimer) { clearTimeout(benchmarkPollTimer); benchmarkPollTimer = null; }

  try {
    const res = await authFetch(`${API_URL}/admin/facturas/benchmark/estado`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const estado = await res.json();
    if (estado.enCurso) {
      btnUltimas.disabled = true;
      btnUltimas.textContent = `Procesando… (${estado.completadas}/${estado.total})`;
      statusEl.textContent = `Factura ${estado.completadas + 1} de ${estado.total} en curso (hasta 15 llamadas cada una) — puedes dejar el panel abierto o cerrarlo, seguirá en segundo plano.`;
      benchmarkPollTimer = setTimeout(pollBenchmarkEstado, 4000);
    } else {
      btnUltimas.disabled = false;
      btnUltimas.textContent = '▶ Últimas 10';
      if (estado.total > 0) {
        statusEl.textContent = `Lote completado (${estado.total} facturas). Actualizando tabla…`;
        openBenchmarkModal(); // refresca la tabla con los resultados ya guardados
      }
    }
  } catch (err) {
    statusEl.textContent = `Error consultando progreso: ${err.message}`;
    btnUltimas.disabled = false;
    btnUltimas.textContent = '▶ Últimas 10';
  }
}

function benchmarkVarianteLabel(v) {
  const map = { actual: 'Actual (1536px)', original: 'Original (sin reducir)', contraste: 'Contraste (CLAHE)' };
  return map[v] || v;
}

async function openBenchmarkModal() {
  const modal = document.getElementById('benchmark-modal');
  modal.style.display = 'flex';
  document.getElementById('benchmark-status').textContent = '';

  // Si ya hay un lote en curso (p.ej. lanzado antes de cerrar el panel), que
  // el botón lo refleje de inmediato en vez de invitar a pulsarlo otra vez.
  authFetch(`${API_URL}/admin/facturas/benchmark/estado`)
    .then((r) => r.ok ? r.json() : null)
    .then((estado) => { if (estado && estado.enCurso) pollBenchmarkEstado(); })
    .catch(() => {});

  try {
    const flagRes = await authFetch(`${API_URL}/admin/benchmark-flag`);
    if (flagRes.ok) {
      const flagData = await flagRes.json();
      document.getElementById('benchmark-toggle').checked = !!flagData.enabled;
    }
  } catch { /* no-op: el toggle se queda como estaba si falla la lectura */ }

  try {
    const rankRes = await authFetch(`${API_URL}/admin/facturas/benchmark/ranking`);
    if (rankRes.ok) {
      benchmarkRankingData = await rankRes.json();
      renderBenchmarkRanking();
    }
  } catch (err) {
    document.getElementById('benchmark-chart').innerHTML =
      `<p style="color:#9b2335;padding:20px;margin:0;">Error al cargar el ranking: ${escHtml(err.message)}</p>`;
  }

  try {
    const res = await authFetch(`${API_URL}/admin/facturas/benchmark`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // El "ganador" es relativo a CADA factura (mayor % de acierto), no un
    // recuento absoluto entre facturas con distinto nº de campos comparables.
    const porFactura = {};
    (data.rows || []).forEach((r) => {
      (porFactura[r.upload_id] = porFactura[r.upload_id] || []).push(r);
    });
    const ganadorPorFactura = {};
    Object.entries(porFactura).forEach(([uploadId, filas]) => {
      let mejorClave = null, mejorRatio = -1;
      filas.forEach((f) => {
        const ratio = f.comparables > 0 ? f.aciertos / f.comparables : -1;
        if (ratio > mejorRatio) { mejorRatio = ratio; mejorClave = `${f.variante}|${f.motor}`; }
      });
      ganadorPorFactura[uploadId] = mejorClave;
    });

    const rows = (data.rows || []).map((r) => ({
      ...r,
      total_factura: r.total_factura != null ? parseFloat(r.total_factura) : null,
      ratio: r.comparables > 0 ? Math.round((r.aciertos / r.comparables) * 100) : null,
      es_ganador: ganadorPorFactura[r.upload_id] === `${r.variante}|${r.motor}`,
      _rowId: `${r.upload_id}-${r.variante}-${r.motor}`,
    }));

    if (benchmarkTable) {
      benchmarkTable.replaceData(rows);
      return;
    }

    benchmarkTable = new Tabulator('#benchmark-table', {
      data: rows,
      index: '_rowId',
      height: '100%',
      layout: 'fitDataFill',
      groupBy: 'upload_id',
      groupHeader: (value, count, data0) => {
        const first = (data0 && data0[0]) || {};
        const fecha = first.uploaded_at ? new Date(first.uploaded_at).toLocaleDateString('es-ES') : '—';
        const total = first.total_factura != null
          ? first.total_factura.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
          : '—';
        return `Factura #${escHtml(String(value))} — ${escHtml(first.proveedor_nombre || '—')} · ${fecha} · ${total} (${count} combinaciones)`;
      },
      placeholder: 'Sin datos todavía — activa el benchmark o pulsa "Ejecutar sobre las últimas 10 facturas".',
      columns: [
        { title: 'Variante', field: 'variante', width: 170, sorter: 'string',
          formatter: (cell) => escHtml(benchmarkVarianteLabel(cell.getValue())) },
        { title: 'Motor', field: 'motor', width: 120, sorter: 'string' },
        { title: '¿Válida?', field: 'es_factura_valida', width: 90, hozAlign: 'center',
          formatter: (cell) => {
            const v = cell.getValue();
            return v === true ? '<span style="color:#276749;">✓</span>' : v === false ? '<span style="color:#9b2335;">✗</span>' : '<span style="color:#a0aec0;">—</span>';
          } },
        { title: 'Aciertos', field: 'aciertos', width: 100, hozAlign: 'center', sorter: 'number',
          formatter: (cell) => { const d = cell.getRow().getData(); return `${d.aciertos}/${d.comparables}`; } },
        { title: '% acierto', field: 'ratio', width: 100, hozAlign: 'center', sorter: 'number',
          formatter: (cell) => cell.getValue() != null ? `${cell.getValue()}%` : '<span style="color:#a0aec0;">—</span>' },
        { title: 'Tiempo', field: 'tiempo_ms', width: 90, hozAlign: 'right', sorter: 'number',
          formatter: (cell) => cell.getValue() != null ? `${(cell.getValue() / 1000).toFixed(1)}s` : '—' },
        { title: 'Error', field: 'error', minWidth: 180,
          formatter: (cell) => cell.getValue() ? `<span style="color:#c53030;">${escHtml(cell.getValue())}</span>` : '' },
      ],
      rowFormatter: (row) => {
        const d = row.getData();
        if (d.es_ganador) row.getElement().style.background = '#f0fff4';
        else if (d.error) row.getElement().style.background = '#fff5f5';
      },
    });
  } catch (err) {
    document.getElementById('benchmark-table').innerHTML =
      `<p style="color:#9b2335;padding:20px 0;text-align:center;">Error al cargar el benchmark: ${escHtml(err.message)}</p>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Herramienta TEMPORAL de verificación del dataset de verdad OCR v2
// (2026-07-28). Borrar este bloque completo + el botón/modal en el HTML +
// los 3 endpoints /api/admin/eval-facturas* en server.js cuando termine la
// verificación manual — no es una feature permanente del producto.
// ══════════════════════════════════════════════════════════════════════════

const EVAL_CAMPOS_ESCALARES = [
  ['emisor.nombre', 'Nombre emisor'], ['emisor.nif', 'NIF emisor'],
  ['receptor.nombre', 'Nombre receptor'], ['receptor.nif', 'NIF receptor'],
  ['numero_factura', 'Nº factura'], ['fecha_emision', 'Fecha emisión'],
  ['retencion_irpf', 'Retención IRPF'], ['total', 'Total'],
];
const EVAL_ESTADOS = ['legible', 'ambiguo', 'ilegible', 'ausente'];

function evalCampoHtml(path, etiqueta, campo) {
  const v = campo || { valor: null, estado: 'ausente', verificado: false };
  return `
    <div class="eval-campo" data-campo="${escHtml(path)}">
      <label>${escHtml(etiqueta)}</label>
      <input type="text" class="eval-valor" value="${escHtml(v.valor ?? '')}" placeholder="—">
      <select class="eval-estado">
        ${EVAL_ESTADOS.map((e) => `<option value="${e}" ${e === v.estado ? 'selected' : ''}>${e}</option>`).join('')}
      </select>
      <label class="eval-verificado-label">
        <input type="checkbox" class="eval-verificado" ${v.verificado ? 'checked' : ''}> verificado
      </label>
    </div>`;
}

function evalFacturaHtml(f) {
  const c = f.ground_truth.campos || {};
  const lineas = Array.isArray(c.desglose_iva) ? c.desglose_iva : [];
  const esImagen = /\.(jpg|jpeg|png)$/i.test(f.documento || '');
  return `
    <div class="eval-factura" data-id="${f.id}" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:18px;padding:14px 16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong>Factura #${f.id}</strong>
        <span class="eval-guardado" style="font-size:12px;color:#276749;"></span>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;">
        <div style="flex:0 0 260px;">
          ${esImagen
            ? `<img class="eval-doc-img" data-id="${f.id}" style="width:100%;border:1px solid #e2e8f0;border-radius:6px;" alt="Documento factura ${f.id}">`
            : `<iframe class="eval-doc-pdf" data-id="${f.id}" style="width:100%;height:340px;border:1px solid #e2e8f0;border-radius:6px;"></iframe>`}
        </div>
        <div style="flex:1;min-width:320px;">
          <div class="eval-campos-escalares">
            ${EVAL_CAMPOS_ESCALARES.map(([path, etiqueta]) => evalCampoHtml(path, etiqueta, c[path])).join('')}
          </div>
          <div style="margin-top:8px;font-size:12px;font-weight:600;color:#4a5568;">Tramos de IVA</div>
          <div class="eval-desglose-iva">
            ${lineas.map((l, i) => `
              <div style="display:flex;gap:8px;margin:4px 0;flex-wrap:wrap;" data-linea="${i}">
                ${evalCampoHtml(`desglose_iva.${i}.base`, 'Base', l.base)}
                ${evalCampoHtml(`desglose_iva.${i}.tipo`, '% IVA', l.tipo)}
                ${evalCampoHtml(`desglose_iva.${i}.cuota`, 'Cuota', l.cuota)}
              </div>`).join('')}
          </div>
          <button class="btn-primary btn-compacto eval-btn-guardar" data-id="${f.id}" style="width:auto;margin-top:10px;">💾 Guardar factura #${f.id}</button>
        </div>
      </div>
    </div>`;
}

function evalLeerCamposDelDom(card) {
  const campos = {};
  card.querySelectorAll('.eval-campo').forEach((el) => {
    const path = el.dataset.campo;
    const valor = el.querySelector('.eval-valor').value.trim() || null;
    const estado = el.querySelector('.eval-estado').value;
    const verificado = el.querySelector('.eval-verificado').checked;
    const partes = path.split('.');
    if (partes[0] === 'desglose_iva') {
      campos.desglose_iva = campos.desglose_iva || [];
      const idx = parseInt(partes[1], 10);
      campos.desglose_iva[idx] = campos.desglose_iva[idx] || {};
      campos.desglose_iva[idx][partes[2]] = { valor, estado, verificado };
    } else {
      campos[path] = { valor, estado, verificado };
    }
  });
  return campos;
}

async function evalGuardarFactura(id, card) {
  const campos = evalLeerCamposDelDom(card);
  const span = card.querySelector('.eval-guardado');
  try {
    const res = await authFetch(`${API_URL}/admin/eval-facturas/${id}/ground-truth`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campos }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    span.textContent = '✓ guardado';
    setTimeout(() => { span.textContent = ''; }, 2500);
  } catch (err) {
    span.style.color = '#9b2335';
    span.textContent = `Error: ${err.message}`;
  }
}

async function abrirEvalVerificacionModal() {
  const modal = document.getElementById('eval-verificacion-modal');
  const cont = document.getElementById('eval-verificacion-lista');
  modal.style.display = 'flex';
  cont.innerHTML = 'Cargando dataset...';
  try {
    const res = await authFetch(`${API_URL}/admin/eval-facturas`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { facturas } = await res.json();
    cont.innerHTML = facturas.map(evalFacturaHtml).join('');

    cont.querySelectorAll('.eval-doc-img').forEach((img) => {
      authFetch(`${API_URL}/admin/eval-facturas/${img.dataset.id}/documento`)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => { img.src = URL.createObjectURL(b); })
        .catch(() => { img.replaceWith(Object.assign(document.createElement('div'), { textContent: 'Imagen no disponible' })); });
    });
    cont.querySelectorAll('.eval-doc-pdf').forEach((iframe) => {
      authFetch(`${API_URL}/admin/eval-facturas/${iframe.dataset.id}/documento`)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => { iframe.src = URL.createObjectURL(b); })
        .catch(() => {});
    });
    cont.querySelectorAll('.eval-btn-guardar').forEach((btn) => {
      btn.addEventListener('click', () => evalGuardarFactura(btn.dataset.id, btn.closest('.eval-factura')));
    });
  } catch (err) {
    cont.innerHTML = `<p style="color:#9b2335;">Error al cargar el dataset: ${escHtml(err.message)}</p>`;
  }
}

function initEvalVerificacionModal() {
  const btn = document.getElementById('btn-eval-verificacion');
  const modal = document.getElementById('eval-verificacion-modal');
  const closeBtn = document.getElementById('eval-verificacion-modal-close');
  if (btn) btn.addEventListener('click', abrirEvalVerificacionModal);
  if (closeBtn) closeBtn.addEventListener('click', () => { modal.style.display = 'none'; });
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

document.addEventListener('DOMContentLoaded', init);
