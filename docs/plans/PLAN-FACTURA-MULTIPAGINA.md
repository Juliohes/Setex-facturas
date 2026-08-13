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

### Fase 2 — Endpoint + almacenamiento (pendiente)
- `upload.array('files', N)` junto al `upload.single` actual, tras flag `ocr_multipagina_enabled` (default off → comportamiento idéntico a hoy).
- Magic bytes por página; tope de páginas y de tamaño.
- Columna aditiva `paginas JSONB` en `uploads` (rutas + metadatos por página), con rollback SQL. Duplicados **sin cambios** (una factura = una fila `nif+fecha+total`).
- Guardar el PDF original como adjunto de auditoría cuando la fuente sea PDF.

### Fase 3 — Frontend (el grueso de UX)
- Captura múltiple con tira de miniaturas: foto → añadir / reordenar / borrar → enviar. Reutiliza jscanify.
- **Asistente recomendado**: "Haz una foto de la 1ª hoja (datos fiscales) y otra de la última (importes)". Si `camposFaltantes` vuelve del backend, mostrar "Falta el total: haz una foto de la página de importes".
- Selector que acepte PDF → rasterizado en el cliente con el pdfjs vendorizado → subir páginas como imágenes.
- Cache-buster (regla 6).

### Fase 4 — Blindaje y despliegue
- Tests de forma de respuesta del endpoint (lección LL-002) + los de fusión ya hechos.
- Staging → producción con el flag, sombra primero si procede.

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

---

*Documento vivo. Continúa el trabajo del pipeline v2 (`PLAN-ACTIVACION-OCR-V2.md`).*
