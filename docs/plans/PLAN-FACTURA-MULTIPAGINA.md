# PLAN — SUBIDA DE FACTURA DE VARIAS PÁGINAS

> **Versión**: 1.0 · **Fecha**: 2026-08-13 · **Estado**: en construcción (Fase 1 backend hecha en rama)
> **Rama**: `feature/ocr-v2-modelos-configurables-2026-07-29` (continúa el trabajo del pipeline v2)
> **Petición**: Julio — "que los usuarios puedan subir una factura de más de una página".

---

## 1. Decisiones tomadas (Julio, 2026-08-13)

| Decisión | Elección |
|---|---|
| Formato de entrada | **Ambos**: varias fotos Y PDF multipágina |
| Semántica | **Siempre 1 factura** (no lote de varias) |
| OCR de páginas | **Todas las páginas + fusión** de campos |
| UX recomendada | 1ª hoja = datos fiscales · última hoja = importes · fotos extra si falta algún dato · **máx. 2-4 fotos** |

---

## 2. Investigación de herramientas (fuentes oficiales / GitHub)

Objetivo: no meter dependencias pesadas nuevas. **Hallazgo clave**: el proyecto ya tiene todo lo necesario vendorizado.

| Necesidad | Opciones evaluadas | **Elección** | Motivo |
|---|---|---|---|
| PDF → imágenes de página | poppler-utils/[node-poppler](https://github.com/Fdawgs/node-poppler) (binario de sistema), mupdf (WASM), pdf-to-img (@napi-rs/canvas nativo), **pdfjs en el navegador** | **pdfjs en el navegador** (ya está `pdf.min.js` + `pdf.worker.min.js` en `frontend/src/`) | El móvil rasteriza cada página del PDF a imagen y la sube como foto. **Cero dependencias nuevas en backend**; evita poppler/canvas nativo (que el proyecto descartó a propósito, `ingest.js:91`). |
| Captura + recorte de documento en móvil | [jscanify](https://github.com/puffinsoft/jscanify) + OpenCV.js, Dynamsoft (comercial), Scanbot (comercial) | **jscanify + opencv.js** (ya vendorizados y en uso para enderezado) | Reutiliza el escáner que ya funciona; sin librerías nuevas. |
| Extracción por página | — | **Pipeline v2 ya desplegado** (`ejecutarExtraccionV2Multi` + árbitro) | Sin cambios. |
| Fusión de páginas | — | **Módulo nuevo** `fusion-multipagina.js` | Única lógica realmente nueva; reutiliza los validadores fiscales existentes. |

**Consecuencia arquitectónica**: el backend recibe **siempre N imágenes**, venga de fotos o de PDF. El PDF se convierte en el cliente. Unifica todo el flujo servidor.

---

## 3. El reto real y cómo se resuelve

No es subir varios archivos: es extraer **una** factura (un total, un desglose de IVA, un número) de N páginas. Solución (`fusion-multipagina.js`):

- **Cabecera** (número, fecha, NIF/nombre): primer valor válido en orden de página (típicamente la 1ª). NIF prioriza checksum válido.
- **Líneas de IVA**: **unión** de todas las páginas, sin duplicados.
- **Total**: el candidato que **cuadra** (`base+IVA`, validador existente) y, a igualdad, el mayor (el total final ≥ subtotales de página).
- **Campos faltantes**: los críticos ausentes (`numero_factura`, `fecha_emision`, `emisor.nif`, `total`) se devuelven con su **zona** (`fiscal`/`importes`) → el frontend le dice al usuario **qué** foto extra hacer. Esto materializa la UX pedida.

---

## 4. Coste (tope €500/mes) y control

"Todas las páginas + fusión" multiplica el coste OCR por nº de páginas (~$0,015/página con la pila actual):

| Páginas/factura | Coste/factura | 6.000/mes |
|---|---|---|
| 2 (patrón recomendado) | ~$0,03 | ~€165 |
| 4 (con fotos extra) | ~$0,06 | ~€330 |
| >10 | se dispara | ❌ |

**Controles**: flag `ocr_multipagina_max_paginas` (propuesta: **6** — cubre 2-4 típicas + margen), tope de tamaño por envío, y por página NO se ejecutan variantes ni re-extracción (ya se multiplica por página). La UX de "1ª + última + extras" empuja al usuario hacia 2-4, no hacia documentos largos.

---

## 5. Fases

### Fase 1 — Backend: extracción + fusión (✅ hecha en rama, sin desplegar)
- `pipeline/fusion-multipagina.js` — fusión de N canónicos en 1 factura + campos faltantes. **9 tests.**
- `pipeline/orquestador-multipagina.js` — extrae N páginas (reutiliza pipeline v2) → fusión → estado. **4 tests.**
- Suite completa 341/342 (el fallo es la paridad v3 preexistente, no relacionado).
- **Nada tocado del flujo de una página. Nada desplegado.**

### Fase 2 — Endpoint + almacenamiento (✅ endpoint hecho en rama; persistencia pendiente)
- ✅ Endpoint **nuevo y separado** `POST /api/upload-preview-multipagina` (NO toca `upload-preview`, lección LL-002). `uploadMultipagina.array('paginas')`, solo imágenes (el PDF se rasteriza en el cliente).
- ✅ Flag `ocr_multipagina_enabled` (default **false**) + `ocr_multipagina_max_paginas` (default **6**, bloqueante). Magic bytes por página, fail-secure. Adaptador canónico→plano (`adaptador-v1.js`) para devolver el shape que ya espera el frontend + `campos_faltantes`.
- ⏳ **Pendiente Fase 2.2**: persistencia en confirm — columna aditiva `paginas JSONB` en `uploads` (+ rollback SQL) y guardar el PDF original / recomponer PDF único para archivo. El endpoint hoy devuelve preview pero NO persiste en `uploads`.
- Duplicados **sin cambios** (una factura = una fila `nif+fecha+total`).

### Fase 3 — Frontend fotos-primero (✅ hecho en rama, sin desplegar)
- ✅ `multipagina.js` — módulo autocontenido: panel plegable, añadir/reordenar/quitar páginas con miniaturas, envío a `/upload-preview-multipagina`, reutiliza `showConfirmModal`. Traduce `campos_faltantes` a un aviso dirigido ("falta el total → foto de la página de importes").
- ✅ Asistente recomendado (texto guía 1ª hoja fiscal / última importes) integrado.
- ✅ PDF: rasterizado en el cliente con pdfjs (degrada con aviso si pdfjs no está cargado — **fotos primero**, la carga de pdf.min.js en index.html se activa al habilitar PDF).
- ✅ Hooks HTML en `index.html` + CSS de miniaturas + cache-buster de styles.css bumpeado (regla 6).
- ⏳ **Pendiente**: verificación en navegador/dispositivo real (no testeable desde el servidor).

### Fase 4 — Blindaje y despliegue (pendiente)
- Test de forma de respuesta del endpoint nuevo (lección LL-002).
- **Staging → prueba en navegador con fotos reales** → activar flag → producción. NADA desplegado aún.

---

## 6. Confirmaciones pendientes de Julio
1. **Tope de páginas**: propongo 6 (`ocr_multipagina_max_paginas`). ¿OK o tus facturas son más largas?
2. **Guardar el PDF original** además de las páginas rasterizadas (auditoría): recomiendo sí.
3. **¿Fotos y PDF a la vez en la Fase 3, o fotos primero** y PDF en una segunda tanda? Fotos es lo más usado en móvil.

---

## 7. Registro de ejecución
### 2026-08-13 — Fase 1 backend construida (rama)
- Investigación de herramientas (arriba): decisión de rasterizar PDF en el cliente con el pdfjs ya vendorizado → cero dependencias nuevas en backend.
- `fusion-multipagina.js` + `orquestador-multipagina.js` + 13 tests. Reutilizan validadores fiscales (`iva.js`, `nif.js`), comparador (`arbiter.coinciden`), importes (`normalize-amount`), y el pipeline v2 de extracción.
- Suite 341/342 (fallo = paridad v3 preexistente). Nada desplegado; flujo de una página intacto.

### 2026-08-13 — Fase 2 (endpoint) + Fase 3 (frontend fotos-primero) construidas (rama)
- Backend: endpoint separado `/api/upload-preview-multipagina` (flag off), `adaptador-v1.js` (canónico→plano) + test de contrato, flags `ocr_multipagina_*` en features.json (off/6). `server.js` solo añade el multer array + el handler nuevo; el endpoint de una página intacto (verificado por diff).
- Frontend: `multipagina.js` (captura múltiple fotos-primero, miniaturas, aviso de faltantes dirigido), sección plegable en `index.html`, CSS de miniaturas, cache-buster bumpeado.
- Suite 345/346 (fallo = paridad v3 preexistente). `node --check` OK en server.js y multipagina.js. **Nada desplegado.**
- Pendiente: persistencia en confirm (Fase 2.2), verificación en navegador real, y despliegue por staging con el flag.

---

*Documento vivo. Continúa el trabajo del pipeline v2 (`PLAN-ACTIVACION-OCR-V2.md`).*
