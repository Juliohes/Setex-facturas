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
//   SETEX_SECRETS_DIR  → directorio con secrets (default /opt/setex/prod/secrets)
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

const SECRETS_DIR = process.env.SETEX_SECRETS_DIR || '/opt/setex/prod/secrets';
const SAMPLE_PATH = process.env.SETEX_OCR_SAMPLE  || '/opt/setex/prod/scripts/samples/factura-muestra.jpg';
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

// ─── Test 2ª pasada receptor: extractReceptorCIFOnly equivalente ─────────────
// Motor primario: Gemini Flash (desde 2026-07-07, mismo motor que producción).
// Si Gemini no está configurado → usa OpenAI como fallback (coherente con producción).
// Sin recorte de imagen: el objetivo es validar que el schema CIF_ONLY +
// responseJsonSchema sigue siendo aceptado por la API. La producción sí recorta,
// pero el contrato API es el mismo.
async function testReceptorPass(geminiKey, openaiKey, imageBuffer) {
  const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
  const geminiConfigured = geminiKey && geminiKey.length >= 8
    && !geminiKey.includes('PLACEHOLDER') && !geminiKey.includes('INSERTAR');

  if (geminiConfigured) {
    // Gemini Flash — mismo schema CIF que gemini.extractReceptorCIFOnly()
    const body = {
      system_instruction: { parts: [{ text: 'Eres especialista en CIF/NIF español. ÚNICA misión: leer el CIF del CLIENTE/RECEPTOR. 9 chars exactos o null.' }] },
      contents: [{
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'image/jpeg', data: imageBuffer.toString('base64') } },
          { text: 'Lee el CIF/NIF del CLIENTE/RECEPTOR. Devuelve SOLO el campo "cif" con los 9 caracteres exactos o null.' }
        ]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 64,
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: { cif: { type: ['string', 'null'] } },
          required: ['cif']
        }
      }
    };
    const res = await fetch(`${GEMINI_BASE_URL}/gemini-3.5-flash:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Gemini Flash 2ª pasada HTTP ${res.status}: ${txt.substring(0, 300)}`);
    }
    const data  = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!parts || !parts.find(p => typeof p.text === 'string')) {
      throw new Error('Gemini Flash 2ª pasada: sin campo text en respuesta');
    }
    return true;
  }

  // Fallback OpenAI (entorno sin Gemini configurado)
  if (!openaiKey) throw new Error('Gemini no configurado y OpenAI ausente — no se puede testear 2ª pasada receptor');
  const dataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  const body = {
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: 'Lee el CIF/NIF del CLIENTE/RECEPTOR. Si no lo ves, devuelve chars:null.' },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        { type: 'text', text: 'Devuelve chars con los 9 caracteres del CIF del cliente, o null si no lo encuentras.' }
      ]}
    ],
    max_tokens: 80,
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'smoke_receptor_cif', strict: true,
        schema: { type: 'object', properties: { chars: { type: ['array', 'null'], items: { type: 'string' } } }, required: ['chars'], additionalProperties: false }
      }
    }
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenAI fallback 2ª pasada HTTP ${res.status}: ${txt.substring(0, 300)}`);
  }
  const data = await res.json();
  if (!data.choices?.[0]?.message?.content) throw new Error('OpenAI fallback: sin contenido en respuesta');
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

// ─── Test Mistral OCR 4: /v1/ocr con document_annotation json_schema ──────────
// Petición real con la muestra y el MISMO mecanismo de annotation que usa
// producción (ocr/mistral.js) — detecta regresiones de contrato (schema
// rechazado, modelo retirado, key sin permisos) igual que el test de OpenAI.
async function testMistral(apiKey, imageBuffer) {
  const dataUrl = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
  const body = {
    model: 'mistral-ocr-latest',
    document: { type: 'image_url', image_url: dataUrl },
    document_annotation_format: {
      type: 'json_schema',
      json_schema: {
        name: 'smoke_ocr_mistral',
        strict: true,
        schema: {
          type: 'object',
          properties: { es_factura: { type: 'boolean' } },
          required: ['es_factura'],
          additionalProperties: false
        }
      }
    },
    document_annotation_prompt: 'Devuelve es_factura:true si la imagen es una factura.',
    include_image_base64: false
  };
  const res = await fetch('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Mistral HTTP ${res.status}: ${txt.substring(0, 300)}`);
  }
  const data = await res.json();
  if (data.document_annotation == null) throw new Error('Mistral sin document_annotation en respuesta');
  return true;
}

// ─── Test Gemini 3.5 Flash: generateContent con responseJsonSchema ────────────
// Motor primario desde 2026-07-07 (bench winner, reemplaza OpenAI en gemini_azure).
// Detecta: key inválida, créditos agotados (429), cambio de model ID por Google.
// Si el secret no existe o es placeholder → skip con warning (entorno legacy dual).
async function testGeminiFlash(apiKey, imageBuffer) {
  const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
  const model = 'gemini-3.5-flash';
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: imageBuffer.toString('base64') } },
        { text: 'Devuelve es_factura:true si la imagen contiene una factura.' }
      ]
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 64,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { es_factura: { type: 'boolean' } },
        required: ['es_factura']
      }
    }
  };
  const res = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini Flash HTTP ${res.status}: ${txt.substring(0, 300)}`);
  }
  const data  = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!parts || !parts.find(p => typeof p.text === 'string')) {
    throw new Error('Gemini Flash sin campo text en respuesta candidates[0].content.parts');
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

  {
    const geminiKeyForReceptor = readSecret('gemini_api_key');
    const motorLabel = (geminiKeyForReceptor && geminiKeyForReceptor.length >= 8
      && !geminiKeyForReceptor.includes('PLACEHOLDER') && !geminiKeyForReceptor.includes('INSERTAR'))
      ? 'Gemini Flash' : 'OpenAI fallback';
    try {
      const t0 = Date.now();
      await testReceptorPass(geminiKeyForReceptor, openaiKey, img);
      log('info', `2ª pasada receptor (${motorLabel}): OK (${Date.now() - t0}ms)`);
    } catch (e) {
      log('error', `2ª pasada receptor (${motorLabel}): FAIL — ${e.message}`);
      errors.push(`RECEPTOR_PASS: ${e.message}`);
    }
  }

  // Mistral OCR 4 (modo triple, 2026-07-05). Si el secret no existe o es
  // placeholder → skip con warning (entorno en modo dual), NO fallo. Si la
  // key está configurada, el motor debe responder — igual de crítico que
  // los otros dos: "una sola IA activa NO es aceptable".
  const mistralKey = readSecret('mistral_api_key');
  const mistralConfigured = mistralKey && mistralKey.length >= 8
    && !mistralKey.includes('PLACEHOLDER') && !mistralKey.includes('INSERTAR');
  if (!mistralConfigured) {
    log('warn', 'Mistral OCR: secret mistral_api_key ausente o placeholder — skip (entorno sin modo triple)');
  } else {
    try {
      const t0 = Date.now();
      await testMistral(mistralKey, img);
      log('info', `Mistral OCR 4: OK (${Date.now() - t0}ms)`);
    } catch (e) {
      log('error', `Mistral OCR 4: FAIL — ${e.message}`);
      errors.push(`MISTRAL: ${e.message}`);
    }
  }

  // Gemini Flash (motor primario desde 2026-07-07). Si el secret no existe o es
  // placeholder → skip con warning (entorno legacy sin modo gemini_azure).
  const geminiKey = readSecret('gemini_api_key');
  const geminiConfigured = geminiKey && geminiKey.length >= 8
    && !geminiKey.includes('PLACEHOLDER') && !geminiKey.includes('INSERTAR');
  if (!geminiConfigured) {
    log('warn', 'Gemini Flash: secret gemini_api_key ausente o placeholder — skip (entorno sin modo gemini_azure)');
  } else {
    try {
      const t0 = Date.now();
      await testGeminiFlash(geminiKey, img);
      log('info', `Gemini Flash: OK (${Date.now() - t0}ms)`);
    } catch (e) {
      log('error', `Gemini Flash: FAIL — ${e.message}`);
      errors.push(`GEMINI_FLASH: ${e.message}`);
    }
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
