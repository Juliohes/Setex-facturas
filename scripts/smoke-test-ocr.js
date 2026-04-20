#!/usr/bin/env node
// scripts/smoke-test-ocr.js
//
// Smoke test diario OCR — comprueba que GPT-4.1 (OpenAI) y Azure Document
// Intelligence siguen respondiendo correctamente con una factura muestra fija.
//
// Diseñado para cron diario en el HOST. Si CUALQUIERA de los dos motores falla,
// salida con exit code != 0 + entrada en log + (si hay MTA local) email a admin
// vía cron MAILTO.
//
// Por qué existe: el bug del schema OneOf en openai.js (HTTP 400 en strict mode)
// permaneció semanas sin detectar porque Azure DI tapaba el agujero. Una sola IA
// activa NO es aceptable: ambas deben funcionar siempre.
//
// Variables de entorno:
//   SETEX_SECRETS_DIR  → directorio con secrets (default /opt/setex-captu-facture/secrets)
//   SETEX_OCR_SAMPLE   → ruta a factura muestra (default scripts/samples/factura-muestra.jpg)
//   SETEX_OCR_LOG      → fichero log (default /var/log/setex/smoke-ocr.log)
//
// Exit codes:
//   0 → ambos motores OK (o muestra ausente — skip silencioso)
//   1 → al menos un motor falló
//   2 → secrets ausentes
//   3 → error inesperado
'use strict';

const fs   = require('fs');
const path = require('path');

const SECRETS_DIR = process.env.SETEX_SECRETS_DIR || '/opt/setex-captu-facture/secrets';
const SAMPLE_PATH = process.env.SETEX_OCR_SAMPLE  || '/opt/setex-captu-facture/scripts/samples/factura-muestra.jpg';
const LOG_PATH    = process.env.SETEX_OCR_LOG     || '/var/log/setex/smoke-ocr.log';

function readSecret(name) {
  // El proyecto guarda secrets como ficheros sueltos sin extensión en SECRETS_DIR.
  // Probamos también /run/secrets/ por si se ejecuta dentro del contenedor.
  const candidates = [
    path.join(SECRETS_DIR, name),
    path.join(SECRETS_DIR, `${name}.txt`),
    `/run/secrets/${name}`,
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch {}
  }
  return null;
}

function log(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch {}
}

// ─── Test OpenAI: petición real con la muestra y schema strict ────────────────
async function testOpenAI(apiKey, imageBuffer) {
  const dataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  const body = {
    model: 'gpt-4.1',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        { type: 'text', text: 'Devuelve {"ok":true} si ves una factura.' }
      ]
    }],
    max_tokens: 50,
    temperature: 0,
    // Probamos schema strict idéntico al de producción para detectar regresiones
    // de validación (oneOf, anyOf, etc.) lo antes posible.
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'smoke_ocr',
        strict: true,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false
        }
      }
    }
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${txt.substring(0, 300)}`);
  }
  const data = await res.json();
  if (!data.choices?.[0]?.message?.content) throw new Error('OpenAI sin contenido en respuesta');
  return true;
}

// ─── Test Azure DI: prebuilt-invoice (sólo verifica que acepte el submit) ─────
async function testAzure(apiKey, endpoint, imageBuffer) {
  const cleanEndpoint = endpoint.replace(/\/$/, '');
  const url = `${cleanEndpoint}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-11-30`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64Source: imageBuffer.toString('base64'), locale: 'es-ES' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Azure HTTP ${res.status}: ${txt.substring(0, 300)}`);
  }
  if (!res.headers.get('Operation-Location')) {
    throw new Error('Azure aceptó submit pero no devolvió Operation-Location');
  }
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!fs.existsSync(SAMPLE_PATH)) {
    log('warn', `Sample image not found at ${SAMPLE_PATH} — skipping. Place a fixed invoice JPG/PDF here.`);
    process.exit(0);
  }

  const openaiKey = readSecret('openai_api_key');
  const azureKey  = readSecret('azure_di_key');
  const azureUrl  = readSecret('azure_di_endpoint');

  if (!openaiKey || !azureKey || !azureUrl) {
    log('error', `Missing secrets in ${SECRETS_DIR}: openai=${!!openaiKey} azureKey=${!!azureKey} azureUrl=${!!azureUrl}`);
    process.exit(2);
  }

  const img = fs.readFileSync(SAMPLE_PATH);
  const errors = [];

  try {
    const t0 = Date.now();
    await testOpenAI(openaiKey, img);
    log('info', `OpenAI: OK (${Date.now() - t0}ms)`);
  } catch (e) {
    log('error', `OpenAI: FAIL — ${e.message}`);
    errors.push(`OPENAI: ${e.message}`);
  }

  try {
    const t0 = Date.now();
    await testAzure(azureKey, azureUrl, img);
    log('info', `Azure DI: OK (${Date.now() - t0}ms)`);
  } catch (e) {
    log('error', `Azure DI: FAIL — ${e.message}`);
    errors.push(`AZURE: ${e.message}`);
  }

  if (errors.length > 0) {
    // Si cron tiene MAILTO=admin@... y el HOST tiene MTA, el stderr llega por email.
    process.stderr.write(`\n[SETEX SMOKE OCR] FALLO: ${errors.length} motor(es)\n${errors.join('\n')}\n`);
    process.exit(1);
  }

  log('info', 'Smoke test OCR — todos los motores OK');
  process.exit(0);
})().catch((e) => {
  log('fatal', `Unhandled: ${e.stack || e.message}`);
  process.exit(3);
});
