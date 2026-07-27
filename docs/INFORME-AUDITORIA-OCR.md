# Informe de Auditoría — Fase 0 (solo lectura) — Pipeline OCR de Facturas v2

> Generado en respuesta a `/opt/setex/PROMPT-PIPELINE-OCR-FACTURAS-V2.md`. Alcance: `/opt/setex/prod`. Ningún fichero de código se ha modificado para producir este informe — solo lectura, `grep`, `git status`, `npm test`, `npm audit`, `docker stats`. Todos los datos están verificados por comando/lectura directa; se cita fichero:línea donde aplica.
>
> **DETENIDO tras este informe, a la espera de aprobación de Julio antes de crear la rama `feature/ocr-pipeline-v2` o tocar código (regla inviolable 2 del prompt).**

---

## 0. Aviso previo — la premisa del prompt sobre OpenAI es incorrecta

El prompt parte de la sospecha de que *"solo actúan Gemini Flash y Azure, y que la vía OpenAI nunca llega a ejecutarse"*, presentándolo como un posible bug a diagnosticar. **Verificado con evidencia línea por línea (§8): no es un bug.** Es una decisión de arquitectura deliberada y documentada en el propio código desde el 2026-07-07: el modo activo en producción es `ocr_mode: "gemini_azure"` (`features.json`), que sustituye a propósito OpenAI por Gemini Flash como motor primario. OpenAI solo se usa hoy en el sistema de benchmark comparativo (no en el pipeline real) y en dos rutas secundarias de arbitraje de CIF que casi nunca se alcanzan mientras Gemini tenga API key configurada.

Esto no invalida la misión del prompt (el pipeline sigue teniendo margen real de mejora, ver §10), pero cambia el diagnóstico de partida: el problema no es "un motor que no se ejecuta", sino "la fusión entre los motores que sí se ejecutan no valida antes de decidir" (§4.4).

**Nota adicional importante**: `CLAUDE.md` (fechado 2026-05-03) describe un estado ya obsoleto del pipeline OCR — dice que `gemini.js` está "DESACTIVADO" y que el modo activo es "dual" OpenAI+Azure. Ambas afirmaciones son falsas hoy (Gemini es el motor primario recomendado desde 2026-07-07; hay además un motor Mistral y un módulo de benchmark completo que tampoco aparecen ahí). Recomiendo actualizar `docs/INFORME_SISTEMA_COMPLETO.md`/`CLAUDE.md` con el estado real antes de que otra sesión parta de esa documentación desactualizada.

---

## 1. Mapa del proyecto

**Stack exacto** (`app/backend/package.json`, verificado):

```
Node.js >=20.0.0 (Docker: node:20-alpine)
express 4.18.2 · pg 8.11.3 · sharp 0.33.2 · zod 3.25.76 · awilix 10.0.2
bcrypt 6.0.0 · jsonwebtoken 9.0.2 · ioredis 5.4.0 · winston 3.11.0
multer 2.1.1 · helmet 7.1.0 · nodemailer 9.0.3 · exceljs 4.4.0
devDependencies: dependency-cruiser 16.10.4
package-lock.json presente, lockfileVersion 3
```

Sin framework frontend (vanilla JS + Tabulator v6.3.0 vendorizado). Imágenes base: `postgres:15-alpine`, `redis:7-alpine`, `nginx:1.25-alpine` (frontend). Estructura de carpetas y servicios ya documentada con precisión en `CLAUDE.md` §2 y §6 — verificada correcta salvo el estado del pipeline OCR (§0).

**Recursos reales del VPS** (`free -h`, `nproc`, `docker stats`):

| Recurso | Valor |
|---|---|
| CPU host | 2 vCPU (compartidas entre prod + staging + Traefik, 8 contenedores) |
| RAM host | 7.8 GiB total, 4.6 GiB disponible en el momento de la auditoría |
| Backend prod | límite 512 MiB (uso real ~78 MiB, 15%) — CPU ~0% en reposo |
| Postgres prod | límite 512 MiB (uso real ~22 MiB) |
| Redis prod | límite 192 MiB |

RAM sobra con margen holgado para preprocesado de imagen adicional (OpenCV/Sharp). El cuello de botella real, ya documentado en `CLAUDE.md` §3.4, es CPU compartida — relevante para decidir si el preprocesado nuevo (deskew, detección de blur) se ejecuta síncrono en el request o se delega a un job en background.

---

## 2. Flujo actual de una factura (con archivo:línea)

```
1. POST /api/upload-preview (server.js:1612) — multer → /app/uploads/
2. Validación magic bytes (server.js:726: PDF debe empezar por %PDF hex 25504446)
3. sharp optimize (cada adapter, p.ej. openai.js optimizeImage()) — 1536px/JPEG85%
   → SOLO si mimeType empieza por "image/". Los PDF se leen tal cual (§7).
4. ocr/index.js:extractInvoiceOCR() (línea 577) — fan-out según ocr_mode:
   - gemini_azure (activo hoy): Gemini Flash + Azure DI en paralelo (índice 584-609)
   - dual/triple/multi: OpenAI + Azure (+ Mistral/Gemini extra) — modo legacy
5. compareOCRResults() (index.js:358) — fusión POR CAMPO con prioridad FIJA
   por fuente (§4.4), no por validación
6. reconcileMultiIvaAggregates() + salvaguarda aritmética IRPF (index.js:466-497)
7. Preview en Redis (TTL 30 min)
8. Usuario confirma → POST /api/upload-confirm (server.js:2205)
9. domain/routing.js:decidirRouting() (activo desde 2026-07-22, pipeline_v2_validacion_enabled)
   decide auto_aceptada / revision_humana / recaptura — YA es determinista,
   YA usa checksums NIF/CIF/NIE + cuadre aritmético (§9)
10. INSERT uploads (PostgreSQL)
11. Fire-and-forget: benchmark multi-motor (si pipeline_v2_benchmark_enabled) y
    comparación de variante de imagen (si pipeline_v2_imagen_variante_enabled) —
    nunca afectan la respuesta real al usuario
```

---

## 3. Diagnóstico de la fusión multi-modelo

### 3.1 Por qué OpenAI "no se ejecuta" en el modo activo

Ver §0 y §8 — **por diseño**, no por bug. Evidencia exhaustiva línea por línea en §8.

### 3.2 Cómo se decide hoy el "mejor" resultado (el hallazgo más importante de esta auditoría)

`compareOCRResults()` (`ocr/index.js:358-457`) fusiona campo a campo, pero **con una tabla de prioridad FIJA por fuente**, no por validación:

```js
// ocr/index.js:434-457 (comentario del propio código, líneas 425-432)
// NIF/Nombre:  motor A (mejor lectura de texto) + Azure árbitro si discrepan
// Importes:    Azure primario (no alucina); motor A como fallback
// IRPF:        SOLO motor A (Azure no extrae IRPF español)
```

Es decir: si Azure dice IVA=21% y Gemini dice IVA=10%, **gana Azure siempre**, aunque en ese caso concreto Gemini tuviera razón — el código nunca comprueba `base × tipo ≈ cuota` antes de decidir cuál de los dos usar. Esto es EXACTAMENTE el gap que la Fase 5 del prompt (`árbitro por campo`) quiere resolver: reemplazar "prioridad fija de fuente" por "gana el valor que pasa la validación determinista".

**Hallazgo secundario de mantenibilidad**: las variables internas de esa función siguen llamándose `oF`/`openaiRes` y los comentarios siguen diciendo "OpenAI" (líneas 427-432) aunque en modo `gemini_azure` esas variables contienen en realidad los campos de **Gemini**, no de OpenAI. El código funciona correctamente (son solo nombres), pero es una fuente real de confusión para quien lea el código sin saber que el modo activo cambió el motor A. Recomiendo, dentro de la Fase 4 nueva, renombrar a `campos.motorA`/`campos.motorB` genéricos.

### 3.3 Consenso documento-a-documento existente

`dual_confirmed` (index.js:417) exige que el NIF esté confirmado por AMBOS motores (no solo presente en uno) más acuerdo en total y fecha — es un consenso a nivel de documento, no de campo. Cuando un motor falla del todo, el otro extra disponible "ocupa su hueco" (`promoteExtra`, líneas 367-373) para no degradar a motor único — mecanismo razonable, sin cambios necesarios.

---

## 4. Manejo de errores y logging — qué se traga silenciosamente

Barrido completo de los 7 `catch` de `ocr/index.js` y de los 4 adapters (openai/azure/gemini/mistral):

**Tragados sin ningún log** (riesgo real — si fallan, nadie se entera):
- `index.js:45` — `getSecret()`: si falla leer `/run/secrets/<name>`, cae a `process.env` sin rastro.
- `index.js:58` — `getConfig()`: si `features.json` es inválido o no existe, devuelve `{}` sin rastro — **todo el sistema caería silenciosamente a `ocr_mode='dual'` (legacy, con OpenAI) sin ningún aviso**, justo el escenario que el prompt sospechaba.
- `index.js:736` y `index.js:744` (`extractCIFOnlyOCR`): fallos de Gemini/OpenAI en el arbitraje de CIF, sin log.
- `openai.js:434` (`_extractCIFFromCrop`): igual, sin log.

**Loguean pero con logger inconsistente**:
- `gemini.js:323-326` (`_extractCIFZone`): usa `console.warn` en vez del logger Winston centralizado. El propio código documenta en un comentario (líneas 292-296) que este patrón **ya ocultó un bug real en producción** (el fix de `MAX_TOKENS` de esta misma semana, commit `d3fbd5b`) — evidencia directa de que "silenciar y devolver null" ya causó una regresión no detectada a tiempo.

**Correctos** (loguean con contexto, no tragan): `index.js:172` (variante contraste), `index.js:673` (modo single), `index.js:704` (2ª pasada receptor), todos los `catch` de `openai.js`/`gemini.js`/`mistral.js` sobre `JSON.parse` (relanzan con mensaje enriquecido).

**Ningún adapter tiene reintentos ni backoff** — cero ocurrencias de "retry"/"backoff" en los 4 ficheros. Esto explica directamente la avalancha de errores `HTTP 429` de Azure DI (tier gratuito F0) observada en el benchmark ejecutado esta semana sobre las 28 facturas reales: sin backoff, un único rate-limit tumba esa llamada sin segundo intento.

---

## 5. Cómo se decide hoy el estado de revisión (routing)

**Ya existe y ya es determinista** — no hace falta construirlo desde cero, solo evolucionarlo:

`domain/routing.js` (264 líneas, activo en producción desde 2026-07-22 vía `pipeline_v2_validacion_enabled`):
- `validarIdentificadores()` — checksum NIF/NIE/CIF real (delega en `domain/validators/nif.js`)
- `validarAritmetica()` — cuadre `base×tipo≈cuota` y `Σbases+Σcuotas−IRPF≈total` (delega en `domain/validators/iva.js`, 475 líneas)
- `validarFechaPlausible()` — fecha no futura, no excesivamente antigua
- `decidirRouting()` — 3 bandas: `auto_aceptada` / `revision_humana` / `recaptura`, exactamente el concepto de la Fase 8.2 del prompt (`auto_aprobada`/`pendiente_revision`/`ilegible`)

El propio código ya deja un hueco explícito para confianza por campo (`routing.js:204-206`, comentario: *"hoy el pipeline solo emite confidence global, no por campo — este umbral queda listo para cuando exista"*) — es decir, la Fase 4.1 del prompt (confianza + fuente por campo) es precisamente el dato que falta para activar código que YA está escrito y esperando.

---

## 6. Esquema de BD relevante

`uploads` (tabla principal, evolucionada 100% de forma aditiva vía `ALTER TABLE ADD COLUMN IF NOT EXISTS` desde `server.js:218` — el propio proyecto ya sigue la regla 5 del prompt sin que nadie se lo pidiera) — columnas fiscales: `proveedor_nif`, `proveedor_nombre`, `receptor_nif`, `receptor_nombre`, `numero_factura`, `fecha_emision`, `base_imponible`, `iva_porcentaje`, `cuota_iva`, `irpf_porcentaje`, `cuota_irpf`, `total_factura`, `moneda`, `lineas_iva JSONB`, `iva_validation_ok BOOLEAN`, `iva_warnings JSONB`, `ocr_result JSONB`, `confidence_level VARCHAR(10)`, `preview_id UUID`.

Tablas ya existentes que son infraestructura reutilizable (§9): `ocr_shadow_validaciones` (decision_v1/v2 + coincide + incidencias JSONB), `ocr_benchmark_resultados` (motor × variante × campos JSONB × detalle_campos JSONB por campo, con índice único `(upload_id, variante, motor)`), `failed_jobs` (cola de fallos con `attempts`, `job_data JSONB`).

---

## 7. Manejo de PDFs — gap real confirmado

**No hay ningún preprocesado local de PDF.** `package.json` no tiene ninguna librería de PDF (ni `pdf-parse`, ni `pdfjs`, ni `pdf-lib`, ni `pdf2pic`). Cada adapter, si `mimeType` no empieza por `image/`, lee el fichero tal cual y lo manda en base64 íntegro a la API externa (`openai.js`/`azure.js`/`gemini.js`, patrón `optimizeImage()` repetido); solo Mistral tiene una rama diferenciada (`document_url` en vez de `image_url`, `mistral.js:144-147`), pero sigue sin preprocesar localmente.

**Bug confirmado con evidencia real de esta semana**: en el lote de benchmark ejecutado sobre las 17 facturas pendientes (log de esta sesión), la factura `upload_id=2` es un PDF y **OpenAI la rechazó con `HTTP 400: Invalid MIME type. Only image types are supported`** en las 3 variantes. Azure, Gemini y Mistral sí la procesaron. Esto confirma exactamente el gap que la Fase 2.2 del prompt quiere resolver (clasificador PDF nativo vs imagen + extracción de texto para PDFs con capa de texto) — con la ventaja añadida de que resolver esto también ahorraría coste (evitar mandar PDFs completos en base64 a 4 APIs cuando el texto podría extraerse localmente gratis con un PDF nativo).

---

## 8. Confirmación exhaustiva: exclusión de OpenAI en `gemini_azure` (respuesta definitiva)

Fichero `ocr/index.js` leído completo (770 líneas). **Exclusión deliberada, verificada línea por línea, ningún camino de fallo silencioso:**

1. `index.js:584-590` — `motorAFn` se liga a `tryGemini(...)` cuando `mode==='gemini_azure'`; `tryOpenAI` no se referencia en esa rama.
2. `index.js:592-601` — los motores "extra" solo se activan en `triple`/`multi`; en `gemini_azure`, `extraNames=[]`.
3. `EXTRA_ENGINES` (`index.js:101-105`) no tiene clave `openai` — ni siquiera un `ocr_multi_engines: ["openai"]` mal configurado colaría OpenAI (se descartaría con warning explícito, líneas 598-600).
4. `index.js:605-609` — el array `jobs` ejecutado con `Promise.allSettled` tiene, en modo `gemini_azure`, exactamente 2 elementos: Gemini Flash + Azure. Cero referencias a OpenAI.
5. `resolverMotorPrincipal` (`index.js:111-123`, usado para la comparación de variante de contraste) replica la misma exclusión.

Las dos únicas rutas donde OpenAI puede ejecutarse aunque `gemini_azure` esté activo son secundarias y no forman parte del fan-out principal: la 2ª pasada de CIF del receptor (`_secondPassReceptorIfNeeded`, solo si Gemini no tiene key) y `extractCIFOnlyOCR` (función de arbitraje aparte, no invocada desde el flujo principal). Ninguna constituye un fallo silencioso — son *fallbacks* explícitos y documentados.

---

## 9. Infraestructura ya existente reutilizable — el hallazgo con más impacto en el plan de fases

Gran parte de lo que el prompt pide en las Fases 1, 6, 9 y 10 **ya está construido**, aunque con arquitectura distinta a la propuesta (BD real + panel admin en vez de `eval/` con ficheros JSON). Reutilizarlo cambia radicalmente la estimación de esfuerzo:

| Lo que pide el prompt | Ya existe hoy | Dónde |
|---|---|---|
| Fase 1.4-1.6: dataset dorado + harness de evaluación por campo | Sistema de benchmark: 5 motores × 3 variantes de imagen, puntuado campo a campo contra el valor confirmado por el humano (usado como "ground truth" en vivo, no un dataset curado aparte) | `ocr/benchmark.js`, tabla `ocr_benchmark_resultados`, panel admin "🧪 Benchmark IA" con ranking interactivo por campo (construido esta misma semana) |
| Fase 6: checksum NIF/CIF/NIE, cuadre aritmético, tipos IVA válidos | Completo y testeado | `domain/validators/nif.js` (168 líneas), `domain/validators/iva.js` (475 líneas), tests: `nif-checksums.test.js`, `iva-coherencia.test.js`, `iva-multi.test.js` |
| Fase 8.2: estados auto/revisión/ilegible | `decidirRouting()` ya devuelve exactamente estas 3 bandas | `domain/routing.js`, activo en producción desde 2026-07-22 |
| Fase 10.2: shadow mode antes de activar en real | Ya construido y ya usado en el switch de `pipeline_v2_validacion_enabled` | tabla `ocr_shadow_validaciones`, panel admin de comparativa v1/v2 |
| Fase 9.2: discrepancias entre modelos por campo | El benchmark ya calcula esto agregado (ranking por motor×variante×grupo de campo) | Endpoint `GET /api/admin/facturas/benchmark/ranking` (esta semana) |

**Riesgo de colisión de nombres — CRÍTICO**: el prompt propone flags `OCR_PIPELINE_V2`, `OCR_V2_SHADOW_MODE`, `OCR_V2_MODELS`. El proyecto **ya tiene**, activos en producción, los flags `pipeline_v2_shadow_mode`, `pipeline_v2_validacion_enabled`, `pipeline_v2_imagen_variante_enabled`, `pipeline_v2_benchmark_enabled` (`features.json`) — pero ese "pipeline v2" es el de **routing/validación de la factura ya extraída**, una capa distinta y ya en producción, NO el de fusión multi-modelo de extracción que este prompt quiere construir. Usar el mismo término "v2"/"pipeline_v2" para dos sistemas diferentes es una fuente garantizada de confusión operativa (para Julio, para futuras sesiones de Claude Code, para cualquier log o panel que mezcle ambos). **Recomendación firme**: nombrar los flags nuevos de forma inequívoca, p. ej. `ocr_extraccion_v2_*` o `ocr_fusion_v2_*`, nunca `pipeline_v2_*` a secas.

**Segundo riesgo de colisión — arquitectura v3 congelada**: existe ya un directorio `src/adapters/ocr/{openai,azure,gemini,paddle}.adapter.js` + `src/ports/ocr.port.js`, con el patrón adapter EXACTO que la Fase 4.2 del prompt pide construir. Todos los ficheros están fechados `28 abr 09:35` — el instante exacto del incidente **LL-002** (swap v3 desplegado y revertido quirúrgicamente el mismo día, ver `CLAUDE.md` §10.1-10.2, REGLA 11). Este código **no se ejecuta desde ningún sitio en runtime** (verificado: cero referencias desde `server.js` ni `ocr/index.js`) — está congelado, con un test de contrato (`tests/contracts/ocr-port.test.js`) que solo lo verifica en aislado. **No debe confundirse ni reutilizarse sin más**: es la arquitectura que causó el incidente de producción más grave documentado del proyecto. Cualquier trabajo de la Fase 4 nueva debe decidir explícitamente si construye sobre `src/ocr/*.js` (el orquestador LIVE) o si retoma esta v3 congelada — y si es lo segundo, requiere luz verde explícita de Julio dado el historial (regla 10 del prompt: "pregunta lo que no puedas deducir del repo" — esto es una decisión de negocio/riesgo, no técnica).

---

## 10. Tests existentes

`npm test` real: **145 tests, 144 pasan, 1 falla** (fallo preexistente y no relacionado con OCR: paridad de rutas v3 vs monolito, `contracts/api-surface-parity.test.js`). 15 ficheros de test en total; los relevantes a OCR:

| Fichero | Cubre |
|---|---|
| `nif-checksums.test.js` | Checksums NIF/NIE/CIF (AEAT) |
| `iva-coherencia.test.js`, `iva-multi.test.js` | Cuadre aritmético, multi-tramo IVA |
| `routing.test.js` | `decidirRouting()`, las 3 bandas |
| `ocr-validacion-determinista.test.js` | Integración de la validación determinista en `compareOCRResults` |
| `ocr-variante-contraste.test.js` | Que la variante CLAHE usa el mismo motor que el modo activo |
| `ocr-reconcile.test.js` | Reconciliación multi-IVA, integración de Mistral |
| `ocr-benchmark.test.js` | Puntuación del benchmark, normalización |
| `azure-lineas-iva.test.js`, `image-variants.test.js` | Extracción de líneas IVA de Azure, generación CLAHE |
| `contracts/ocr-port.test.js` | Contrato del puerto v3 congelado (§9) — no del pipeline live |

**Gap real**: ningún test cubre las llamadas de red reales de `openai.js`/`gemini.js`/`mistral.js` como módulos aislados (solo se testean las funciones puras: parsers, mergers). No hay tests de regresión que congelen el comportamiento actual del endpoint completo `/api/upload-preview` con mocks de red — exactamente lo que la Fase 1.3 del prompt pide construir.

`npm audit --production`: **3 vulnerabilidades (1 low, 2 high)**. Las dos "high" son relevantes: `brace-expansion` (DoS, fix trivial) y **`sharp <0.35.0`** (CVEs de libvips heredadas — `sharp` es el corazón del preprocesado de imagen en todos los adapters; el fix requiere `--force`, cambio potencialmente breaking, a evaluar en Fase 1 o antes).

---

## 11. Matriz de compatibilidad — candidatas de la Fase 3/4 del prompt (traducidas a Node.js real)

El prompt lista dependencias Python (`opencv-python-headless`, `PyMuPDF`, `pydantic`) asumiendo que el backend podría ser Python. **Es Node.js** (confirmado §1) — la sección "ALTERNATIVAS DESIGNADAS" ya prevé Zod como equivalente Node de Pydantic, que **ya está instalado** (`zod@3.25.76`, en uso por `awilix`/v3 congelado). Traducción real de cada candidata al entorno Node confirmado:

| Necesidad del prompt | Preferente Python (no aplica) | Equivalente Node real | Estado |
|---|---|---|---|
| Preprocesado (deskew, blur, CLAHE) | `opencv-python-headless` | `sharp` (ya en uso, CLAHE ya implementado en `image-variants.js`) para contraste/resize; **falta** detección de blur (varianza del Laplaciano) y deskew — `sharp` no lo ofrece nativo. Alternativa real: `opencv.js` (WASM) — **ya vendorizado en el FRONTEND** (`jscanify.js`+`opencv.js`, 8.98 MB) para detección de contorno en vivo, pero nunca usado en el backend. Traerlo al backend es viable (Node soporta WASM) pero pesado; alternativa ligera: implementar varianza del Laplaciano a mano sobre el buffer de `sharp` (unas ~30 líneas, sin dependencia nueva). |
| Lectura de PDF nativo | `PyMuPDF` | `pdf-parse` (extracción de texto, ligera, MIT) o `pdfjs-dist` (motor de Mozilla, ya usado en frontend como `pdf.min.js` — podría reutilizarse en backend vía `pdfjs-dist` npm) | No instalado — gap real confirmado (§7) |
| Rasterizado PDF→imagen | `pdf2image`+poppler | `pdf-to-img` o `sharp` con soporte experimental de PDF vía libvips (requiere poppler en la imagen Docker Alpine — verificar disponibilidad en `node:20-alpine`) | No instalado — requiere añadir paquete de sistema en el Dockerfile si se elige poppler |
| Validación de esquema | Pydantic v2 | **Zod — ya instalado** (`3.25.76`) | Sin trabajo de adopción, ya disponible |
| Reintentos/backoff | `tenacity` | No hay librería instalada; candidatas ligeras: `p-retry` (npm, cero dependencias nativas) o implementación manual (backoff exponencial + jitter es ~15 líneas) | Gap confirmado (§4), sin dependencia nueva necesaria si se implementa a mano |
| Clientes oficiales de API | SDKs oficiales Python | **Ningún adapter usa SDK oficial hoy** — los 4 (`openai.js`/`azure.js`/`gemini.js`/`mistral.js`) usan `fetch()` crudo contra las APIs REST, sin `openai`, `@azure/ai-form-recognizer` ni `@google/genai` como dependencias. Pros de seguir así: cero peso extra, control total sobre timeout/estructura. Contras: reintentos/parsing de streaming los reimplementa el proyecto a mano (ya un gap, §4) | Decisión de arquitectura pendiente para Fase 4 — mantener fetch crudo es coherente con el resto del proyecto (cero dependencias nuevas) pero requiere construir manualmente lo que un SDK oficial ya resuelve (retries, tipado de errores) |

**Conclusión de la matriz**: la migración es viable sin dependencias pesadas nuevas — Zod ya está, `sharp` cubre gran parte del preprocesado, y el mayor gap (PDF nativo + retries) se resuelve con paquetes npm ligeros (`pdf-parse`/`pdfjs-dist`, `p-retry`) o código propio, coherente con el perfil de dependencias actual del proyecto (deliberadamente minimalista, sin SDKs oficiales de proveedor).

---

## 12. Riesgos detectados

1. **Documentación viva desactualizada** (`CLAUDE.md`, §0) — riesgo de que cualquier trabajo (humano o IA) parta de premisas falsas sobre qué motor está activo.
2. **Arquitectura v3 congelada por LL-002** (§9) — riesgo de reutilización accidental de código asociado al incidente de producción más grave documentado.
3. **Colisión de nombres `pipeline_v2`** (§9) — riesgo operativo de confundir dos sistemas distintos con el mismo nombre.
4. **`sharp` con CVEs high sin parchear** (§10) — corazón del preprocesado de imagen, requiere plan de actualización.
5. **Cero reintentos/backoff en los 4 adapters** (§4) — causa directa confirmada de errores 429 masivos con Azure DI en el benchmark real de esta semana.
6. **PDFs sin preprocesar, enviados íntegros a 4 APIs externas** (§7) — coste innecesario + bug confirmado con OpenAI rechazándolos.
7. **`catch` silenciosos sin log** en 5 puntos concretos (§4) — uno de ellos (`getConfig()`, `index.js:58`) es especialmente sensible: un `features.json` corrupto degradaría todo el pipeline a modo `dual` (con OpenAI) sin ningún aviso.
8. **Secretos**: gestión ya madura (Docker Secrets, `/run/secrets/`, nunca en `.env` — verificado, cumple ya la regla 8 del prompt). Sin hallazgos nuevos.
9. **RGPD**: los 4 proveedores ya en uso (Azure, Gemini, OpenAI, Mistral) — el prompt (regla 11) exige no introducir proveedores nuevos sin aprobación; Mistral ya está en producción desde antes de este prompt, dato a tener en cuenta si su región de procesamiento no ha sido auditada formalmente (no verificado en esta auditoría, fuera de alcance de "solo lectura de código").

---

## 13. Plan de fases ajustado (con estimación de esfuerzo)

Dado que gran parte de las Fases 1, 6, 8 y 10 originales ya existen (§9), el plan real de esfuerzo se concentra en las fases 2 a 7:

| Fase del prompt | Estado | Esfuerzo ajustado | Nota |
|---|---|---|---|
| Fase 0 | ✅ Este informe | — | — |
| Fase 1 (arnés + dataset dorado) | 70% ya existe (benchmark.js) | Bajo — adaptar/extender lo existente, no construir de cero | Evitar duplicar: decidir si el "dataset dorado" es el histórico de `ocr_benchmark_resultados` o un `eval/` nuevo aparte |
| Fase 2 (ingesta/clasificación PDF) | 0% — gap real confirmado | Medio | `pdf-parse`/`pdfjs-dist`, sin dependencias pesadas |
| Fase 3 (preprocesado OpenCV) | CLAHE ya existe; deskew/blur-gate no | Medio-Alto | Evaluar opencv.js backend vs implementación manual del blur gate |
| Fase 4 (adapters + retries) | Adapters ya con forma uniforme; retries en 0% | Medio | Backoff manual o `p-retry`, sin SDK oficial nuevo |
| Fase 5 (árbitro por campo) | 0% — hoy es prioridad fija, no validación (§3.2) | Alto | El cambio de mayor impacto en precisión real |
| Fase 6 (validación fiscal) | ✅ 100% ya existe y testeado | — | Reutilizar tal cual |
| Fase 7 (re-extracción dirigida) | 0% — Azure no captura bounding boxes hoy | Medio-Alto | Requiere ampliar el parseo de la respuesta de Azure DI |
| Fase 8 (confianza + cola revisión) | 70% ya existe (`routing.js` + tabla `uploads`) | Bajo-Medio | Falta el endpoint `/v2/facturas/{id}/extraccion` y confianza por campo real |
| Fase 9 (observabilidad) | 40% ya existe (logs Winston, `audit_logs`, ranking del benchmark) | Bajo-Medio | Homogeneizar los `console.warn` sueltos (§4) al logger central |
| Fase 10 (canario) | Infra de shadow mode ya probada en producción (routing v2) | Bajo | Reutilizar el mismo patrón ya validado operativamente |

**Prioridad recomendada si Julio aprueba continuar**: Fase 5 (árbitro por campo) tiene el mayor impacto en precisión por el menor esfuerzo relativo, seguida de Fase 4 (retries — resuelve directamente los 429 de Azure ya observados) y Fase 2 (PDF nativo — resuelve el bug ya confirmado con OpenAI).

---

**FIN DE LA FASE 0. Detenido a la espera de aprobación explícita antes de crear `feature/ocr-pipeline-v2` o escribir cualquier código (regla inviolable 2).**
