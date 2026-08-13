// multipagina.js — Subida de factura de VARIAS páginas (2026-08-13).
// Fase 3 (fotos primero). Módulo autocontenido: NO toca el flujo de una sola
// foto de app.js. Gestiona su propia lista de páginas y reutiliza el modal de
// confirmación existente (window.showConfirmModal) y Auth.apiFetch.
//
// Patrón recomendado al usuario (petición de Julio): 1ª foto = hoja con los
// datos fiscales, 2ª = hoja con los importes; fotos extra solo si falta algún
// dato. El backend devuelve `campos_faltantes` y aquí se traduce a un aviso
// concreto ("falta el total: haz una foto de la página de importes").
//
// El PDF también entra aquí: se rasteriza a imágenes EN EL NAVEGADOR con el
// pdfjs ya vendorizado (window.pdfjsLib / pdf.min.js) y cada página se añade
// como una imagen más. Así el backend recibe siempre fotos.
(function () {
  'use strict';

  const MAX_PAGINAS = 6; // coincide con el tope del backend (ocr_multipagina_max_paginas)
  const paginas = [];    // [{ file: File, url: objectURL }]

  const $ = (id) => document.getElementById(id);
  const api = () => (typeof API_URL !== 'undefined' ? API_URL : '/api');

  function etiquetaZona(zona) {
    return zona === 'importes'
      ? 'la página de importes (última hoja)'
      : 'la página con los datos fiscales (primera hoja)';
  }

  function render() {
    const cont = $('mp-thumbs');
    if (!cont) return;
    cont.innerHTML = '';
    paginas.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'mp-thumb';
      item.innerHTML =
        `<img src="${p.url}" alt="Página ${i + 1}">` +
        `<span class="mp-thumb-num">${i + 1}</span>` +
        `<div class="mp-thumb-actions">` +
          `<button type="button" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>` +
          `<button type="button" data-act="down" data-i="${i}" ${i === paginas.length - 1 ? 'disabled' : ''} title="Bajar">▼</button>` +
          `<button type="button" data-act="del" data-i="${i}" title="Quitar">✕</button>` +
        `</div>`;
      cont.appendChild(item);
    });
    const info = $('mp-info');
    if (info) {
      info.textContent = paginas.length === 0
        ? 'Haz una foto de la primera hoja (datos fiscales) y otra de la última (importes).'
        : `${paginas.length} página(s). Puedes reordenarlas o añadir más (máx. ${MAX_PAGINAS}).`;
    }
    const enviar = $('mp-enviar');
    if (enviar) enviar.disabled = paginas.length === 0;
    const add = $('mp-add');
    if (add) add.disabled = paginas.length >= MAX_PAGINAS;
  }

  function addImagen(file) {
    if (paginas.length >= MAX_PAGINAS) {
      alert(`Máximo ${MAX_PAGINAS} páginas por factura.`);
      return;
    }
    paginas.push({ file, url: URL.createObjectURL(file) });
    render();
  }

  // Rasteriza un PDF a imágenes JPEG en el navegador (una por página).
  async function addPdf(file) {
    const lib = window.pdfjsLib || (window.pdfjsLib = window['pdfjs-dist/build/pdf']);
    if (!lib) { alert('No se pudo abrir el PDF en este dispositivo. Prueba a hacer fotos.'); return; }
    try {
      const buf = await file.arrayBuffer();
      const pdf = await lib.getDocument({ data: buf }).promise;
      const n = Math.min(pdf.numPages, MAX_PAGINAS - paginas.length);
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
        addImagen(new File([blob], `pdf-p${i}.jpg`, { type: 'image/jpeg' }));
      }
      if (pdf.numPages > n) alert(`El PDF tiene ${pdf.numPages} páginas; se añadieron las primeras ${n} (máx. ${MAX_PAGINAS}).`);
    } catch (e) {
      alert('No se pudo leer el PDF. Prueba a hacer fotos de las hojas.');
    }
  }

  function onArchivo(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (file.type === 'application/pdf') addPdf(file);
    else if (file.type.startsWith('image/')) addImagen(file);
    else alert('Formato no soportado. Usa una foto o un PDF.');
  }

  function onThumbsClick(ev) {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const i = parseInt(btn.dataset.i, 10);
    const act = btn.dataset.act;
    if (act === 'del') { URL.revokeObjectURL(paginas[i].url); paginas.splice(i, 1); }
    else if (act === 'up' && i > 0) { paginas.splice(i - 1, 0, paginas.splice(i, 1)[0]); }
    else if (act === 'down' && i < paginas.length - 1) { paginas.splice(i + 1, 0, paginas.splice(i, 1)[0]); }
    render();
  }

  function reset() {
    paginas.forEach((p) => URL.revokeObjectURL(p.url));
    paginas.length = 0;
    render();
  }

  async function enviar() {
    if (paginas.length === 0) return;
    const msg = $('mp-message');
    const btn = $('mp-enviar');
    if (btn) btn.disabled = true;
    if (msg) msg.innerHTML = '';

    const fd = new FormData();
    paginas.forEach((p) => fd.append('paginas', p.file));
    fd.append('invoice_type', (typeof selectedInvoiceType !== 'undefined' ? selectedInvoiceType : 'compra'));

    try {
      const res = await Auth.apiFetch(`${api()}/upload-preview-multipagina`, { method: 'POST', body: fd });
      if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (msg) msg.innerHTML = `<p class="error">${data.error || 'Función no disponible o sesión expirada.'}</p>`;
        if (btn) btn.disabled = false;
        return;
      }
      const data = await res.json();

      if (data.preview) {
        // Aviso de datos que faltan → foto extra dirigida a la hoja correcta.
        if (Array.isArray(data.campos_faltantes) && data.campos_faltantes.length > 0) {
          const detalle = data.campos_faltantes
            .map((c) => `${c.etiqueta} → ${etiquetaZona(c.zona)}`)
            .join('; ');
          if (msg) msg.innerHTML =
            `<p class="warning">Falta: ${detalle}.<br>Puedes <strong>añadir otra foto</strong> de esa hoja y reenviar, o confirmar así y completarlo a mano.</p>`;
        }
        // Reutiliza el modal de confirmación de una página con la factura fusionada.
        if (typeof window.showConfirmModal === 'function') {
          window.showConfirmModal(data.preview_id, data.campos, {
            missing_fields: (data.campos_faltantes || []).map((c) => c.clave),
            requires_review: data.requires_review || false,
            invoice_type: data.invoice_type,
            multipagina: true,
          });
        }
        if (btn) btn.disabled = false;
      } else {
        if (msg) msg.innerHTML = `<p class="error">${data.error || 'No se pudieron leer las páginas.'}</p>`;
        if (btn) btn.disabled = false;
      }
    } catch (e) {
      if (msg) msg.innerHTML = '<p class="error">Error de conexión.</p>';
      if (btn) btn.disabled = false;
    }
  }

  function init() {
    const add = $('mp-add');
    const input = $('mp-input');
    const thumbs = $('mp-thumbs');
    const btnEnviar = $('mp-enviar');
    const btnReset = $('mp-reset');
    if (!add || !input || !thumbs) return; // los hooks HTML no están → módulo inactivo
    add.addEventListener('click', () => input.click());
    input.addEventListener('change', onArchivo);
    thumbs.addEventListener('click', onThumbsClick);
    if (btnEnviar) btnEnviar.addEventListener('click', enviar);
    if (btnReset) btnReset.addEventListener('click', reset);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.Multipagina = { reset, _paginas: paginas };
})();
