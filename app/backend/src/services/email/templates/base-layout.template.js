// Layout HTML común para emails salientes. Mínimo (compatible con clientes
// estrictos — Outlook, Apple Mail) y con contenido escapado en el call-site.
'use strict';

const { escapeHtml } = require('../../../lib/html-escape');

function baseLayout({ title, bodyHtml, footer = 'SETEX · setex-facturas.es' }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="font-family: -apple-system, 'Segoe UI', Arial, sans-serif; background:#f5f5f7; margin:0; padding:24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden;">
    <tr><td style="background:#0a2540; color:#ffffff; padding:18px 24px; font-weight:600; font-size:18px;">SETEX</td></tr>
    <tr><td style="padding:24px; color:#1a1a1a; font-size:15px; line-height:1.55;">${bodyHtml}</td></tr>
    <tr><td style="background:#fafafa; padding:14px 24px; color:#6b7280; font-size:12px;">${escapeHtml(footer)}</td></tr>
  </table>
</body>
</html>`;
}

module.exports = { baseLayout };
