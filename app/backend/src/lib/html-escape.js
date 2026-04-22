// Escapado HTML para strings que se inyectan en plantillas server-side
// (p.ej. emails en services/email/templates/*). NO reemplaza a helmet
// ni a una política CSP: es defensa en profundidad para cuando un valor
// controlado por usuario acaba renderizándose como HTML.
'use strict';

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"'`=/]/g, (char) => HTML_ENTITIES[char]);
}

module.exports = { escapeHtml };
