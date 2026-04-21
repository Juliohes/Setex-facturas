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

    // Actualizar tanto el campo display como el raw en la fila de Tabulator
    const row = table.getRow(editingRow.id);
    if (row) {
      const updates = {
        [actualField]: newValue || null,
        [editingField]: newValue || null, // actualiza también el campo display
      };
      row.update(updates);
    }
    closeEditModal();
  } catch (err) {
    errEl.textContent = err.message; errEl.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar en BD';
  }
}

function makeEditableFormatter(field, innerFormatter) {
  return (cell) => {
    const val = innerFormatter ? innerFormatter(cell) : (cell.getValue() ?? '<span style="color:#a0aec0">—</span>');
    return `<span class="cell-val">${val}</span><button class="edit-cell-btn" title="Editar ${EDITABLE_FIELDS[field] || field}">✏️</button>`;
  };
}

function makeEditableCellClick(field) {
  return (_e, cell) => {
    // Solo abrir modal si el click fue en el botón de editar
    if (_e.target.classList.contains('edit-cell-btn')) {
      openEditModal(cell.getRow().getData(), field);
    }
  };
}

function formatEuro(cell) {
  const v = cell.getValue();
  if (v == null || v === '') return '<span style="color:#a0aec0">—</span>';
  const n = parseFloat(v);
  if (isNaN(n)) return v;
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
  // Intentar parsear formato español
  let s = String(v).replace(/[€\s]/g, '');
  const hasComma = s.includes(','), hasDot = s.includes('.');
  let n;
  if (hasComma && hasDot) {
    n = s.lastIndexOf(',') > s.lastIndexOf('.') ? parseFloat(s.replace(/\./g,'').replace(',','.')) : parseFloat(s.replace(/,/g,''));
  } else if (hasComma) {
    const after = s.split(',').pop() || '';
    n = after.length === 3 ? parseFloat(s.replace(/,/g,'')) : parseFloat(s.replace(',','.'));
  } else { n = parseFloat(s); }
  if (isNaN(n)) return escHtml(v);
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function formatPct(cell) {
  const v = cell.getValue();
  if (v == null || v === '' || v === '0,0' || v === '0') return '<span style="color:#a0aec0">—</span>';
  return escHtml(String(v)) + '%';
}
function formatTipo(cell) {
  const v = cell.getValue();
  if (!v) return '<span style="color:#a0aec0">—</span>';
  return v === 'venta'
    ? '<span style="font-size:11px;font-weight:700;color:#6b46c1;background:#e9d8fd;padding:2px 7px;border-radius:8px;">↑ Emitida</span>'
    : '<span style="font-size:11px;font-weight:700;color:#2b6cb0;background:#ebf8ff;padding:2px 7px;border-radius:8px;">↓ Recibida</span>';
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

function verImagenAdmin(id) {
  const token = localStorage.getItem('token');
  const url = `${API_URL}/admin/facturas/${id}/imagen`;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;';

  const content = document.createElement('div');
  content.style.cssText = 'position:relative;max-width:95vw;max-height:95vh;display:flex;align-items:center;justify-content:center;';
  content.innerHTML = '<p style="color:#fff;font-size:14px;">Cargando imagen...</p>';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'position:fixed;top:18px;right:18px;background:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:22px;cursor:pointer;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,0.4);z-index:10000;';
  closeBtn.addEventListener('click', () => overlay.remove());

  overlay.appendChild(content);
  overlay.appendChild(closeBtn);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
    .then(blob => {
      const imgUrl = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = imgUrl;
      img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 4px 32px rgba(0,0,0,0.6);';
      img.addEventListener('load', () => URL.revokeObjectURL(imgUrl));
      content.innerHTML = '';
      content.appendChild(img);
    })
    .catch((err) => {
      content.innerHTML = `<p style="color:#fff;font-size:14px;">No se pudo cargar la imagen (${err.message}).</p>`;
    });
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
    persistenceID: 'setex-admin-facturas-v8',
    columns: [
      { title: 'ID',               field: 'codigo_cliente',  width: 90,  sorter: 'string', hozAlign: 'center', frozen: true,
        formatter: (cell) => { const v = cell.getValue(); return v ? `<code style="font-size:12px;font-weight:700;">${escHtml(v)}</code>` : '<span style="color:#a0aec0;">—</span>'; } },
      // ── Empresa y contraparte: campos computados por el backend via matching CIF/nombre/tipo ──
      { title: 'Empresa',          field: 'display_empresa',      minWidth: 160, sorter: 'string',
        formatter: makeEditableFormatter('display_empresa'), cellClick: makeEditableCellClick('display_empresa') },
      { title: 'CIF Empresa',      field: 'display_empresa_nif',  width: 130, sorter: 'string',
        formatter: makeEditableFormatter('display_empresa_nif'), cellClick: makeEditableCellClick('display_empresa_nif') },
      { title: 'TIPO',             field: 'invoice_type',    width: 100, sorter: 'string', formatter: formatTipo, hozAlign: 'center' },
      { title: 'Cliente / Proveedor', field: 'display_contraparte', minWidth: 160, sorter: 'string',
        formatter: makeEditableFormatter('display_contraparte'), cellClick: makeEditableCellClick('display_contraparte') },
      { title: 'CIF Cl/Prov',      field: 'display_contraparte_nif', width: 130, sorter: 'string',
        formatter: makeEditableFormatter('display_contraparte_nif'), cellClick: makeEditableCellClick('display_contraparte_nif') },
      { title: 'Nº Factura',       field: 'numero_factura',  width: 130, sorter: 'string',
        formatter: makeEditableFormatter('numero_factura'), cellClick: makeEditableCellClick('numero_factura') },
      { title: 'Fecha',            field: 'fecha_emision',   width: 110, sorter: 'string', formatter: makeEditableFormatter('fecha_emision'), cellClick: makeEditableCellClick('fecha_emision') },
      { title: 'Base Imp.',        field: 'base_imponible',  width: 115, sorter: 'string', hozAlign: 'right',
        formatter: makeEditableFormatter('base_imponible', formatEuroStr), cellClick: makeEditableCellClick('base_imponible') },
      { title: 'IVA %',            field: 'iva_porcentaje',  width: 80,  sorter: 'string', hozAlign: 'center',
        formatter: makeEditableFormatter('iva_porcentaje', formatPct), cellClick: makeEditableCellClick('iva_porcentaje') },
      { title: 'Cuota IVA',        field: 'cuota_iva',       width: 110, sorter: 'string', hozAlign: 'right',
        formatter: makeEditableFormatter('cuota_iva', formatEuroStr), cellClick: makeEditableCellClick('cuota_iva') },
      { title: 'IRPF %',           field: 'irpf_porcentaje', width: 80,  sorter: 'string', hozAlign: 'center',
        formatter: makeEditableFormatter('irpf_porcentaje', formatPct), cellClick: makeEditableCellClick('irpf_porcentaje') },
      { title: 'Cuota IRPF',       field: 'cuota_irpf',      width: 110, sorter: 'string', hozAlign: 'right',
        formatter: makeEditableFormatter('cuota_irpf', formatEuroStr), cellClick: makeEditableCellClick('cuota_irpf') },
      { title: 'Total',            field: 'total_factura',   width: 120, sorter: 'number', hozAlign: 'right',
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
      { title: 'Acciones',         field: 'id',              width: 110, hozAlign: 'center', headerSort: false,
        formatter: (cell) => {
          if (!deleteModeFacturas) return '<span style="color:#cbd5e0;font-size:11px;">—</span>';
          const row = cell.getData();
          const num = row.numero_factura || `#${row.id}`;
          return `<button class="btn-tbl-del fac-delete" data-id="${row.id}" data-num="${escAttr(num)}">✕ Eliminar</button>`;
        } },
    ],
    initialSort: [{ column: 'uploaded_at', dir: 'desc' }],
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
}

// Eliminación de factura con confirmación y DELETE al backend
async function eliminarFactura(id, num) {
  if (!confirm(`¿Eliminar definitivamente la factura ${num}?\n\nEsta acción no se puede deshacer. Se borrarán los datos y el fichero de imagen asociado.`)) return;
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
  } catch (err) {
    alert(`No se pudo eliminar la factura: ${err.message}`);
  }
}

async function loadData(filters = {}) {
  const params = new URLSearchParams();
  if (filters.desde)      params.set('desde', filters.desde);
  if (filters.hasta)      params.set('hasta', filters.hasta);
  if (filters.proveedor)  params.set('proveedor', filters.proveedor);
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
    proveedor:  document.getElementById('f-proveedor').value.trim(),
    usuario_id: document.getElementById('f-usuario').value,
    estado:     document.getElementById('f-estado').value,
  };
}
function clearFilters() {
  ['f-desde','f-hasta','f-proveedor','f-usuario','f-estado'].forEach(id => { document.getElementById(id).value = ''; });
  currentFilters = {};
  currentCompanyFilter = null;
  loadData();
}
function downloadExcel() {
  const params = new URLSearchParams();
  if (currentFilters.desde)      params.set('desde', currentFilters.desde);
  if (currentFilters.hasta)      params.set('hasta', currentFilters.hasta);
  if (currentFilters.proveedor)  params.set('proveedor', currentFilters.proveedor);
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

// Ver facturas de una empresa → modal con galería de imágenes
window._empVerFacturas = async function(id, cif, nombre) {
  const modal = document.getElementById('facemp-modal');
  const grid  = document.getElementById('facemp-grid');
  const loading = document.getElementById('facemp-loading');
  const empty   = document.getElementById('facemp-empty');
  const countEl = document.getElementById('facemp-count');

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

    facturas.forEach(f => {
      const card = document.createElement('div');
      card.className = 'facemp-card';

      const fecha = f.fecha_emision
        ? new Date(f.fecha_emision + 'T00:00:00').toLocaleDateString('es-ES')
        : (f.uploaded_at ? new Date(f.uploaded_at).toLocaleDateString('es-ES') : '—');
      const contraparte = escHtml(f.display_contraparte || f.proveedor_nombre || '—');
      const total = f.total_factura
        ? parseFloat(String(f.total_factura).replace(/\./g, '').replace(',', '.')).toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €'
        : '—';

      card.innerHTML = `
        <div class="facemp-img-wrap" data-id="${f.id}">
          <div class="facemp-placeholder">⏳</div>
          <img class="facemp-img" src="" style="display:none;" alt="Factura #${f.id}">
        </div>
        <div class="facemp-info">
          <span class="facemp-fecha">📅 ${fecha}</span>
          <span class="facemp-proveedor" title="${contraparte}">${contraparte}</span>
          <span class="facemp-total">${total}</span>
        </div>`;
      grid.appendChild(card);

      // Lazy-load con IntersectionObserver
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
          img.src = url;
          img.style.display = 'block';
          ph.style.display  = 'none';
          img.onclick = () => {
            const lb = document.getElementById('lightbox');
            document.getElementById('lightbox-img').src = url;
            lb.style.display = 'flex';
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

  // Lightbox: cerrar al hacer click sobre el fondo
  document.getElementById('lightbox').addEventListener('click', () => {
    document.getElementById('lightbox').style.display = 'none';
  });

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('lightbox').style.display = 'none';
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

  const select = document.getElementById('f-usuario');
  (authData.usuarios || []).forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id; opt.textContent = u.email; select.appendChild(opt);
  });

  initTabs();
  initTable();
  initEditModal();
  initRenameModal();
  initEmpresaModal();
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
  document.getElementById('f-proveedor').addEventListener('keydown', e => {
    if (e.key === 'Enter') { currentFilters = getFilters(); loadData(currentFilters); }
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

document.addEventListener('DOMContentLoaded', init);
