# PLAN DE ACTIVACIÓN DEL PIPELINE OCR v2 EN PRODUCCIÓN

> **Versión**: 2.0 (ultradetallada) · **Estado**: propuesta, NO ejecutada · **Fecha**: 2026-07-29 · **Autor**: sesión Claude Code con Julio
> **Sustituye a**: v1.0 del mismo día (mismo fichero). Cambios v2.0: contrato de ejecución para la IA (§A), anclas de código verificadas contra el fuente real, criterios de salida ejecutables por comando, diseño del canario por usuario, FASE 6 de consolidación definitiva, bitácora de ejecución (§H).
> **Precondición dura**: NO se empieza ninguna fase sin que la FASE 0 esté cerrada al completo con evidencia en §H.

---

## §A. CONTRATO DE EJECUCIÓN PARA LA IA — leer SIEMPRE antes de tocar nada

Este bloque existe para que ninguna sesión futura (humana o IA) se desvíe del plan. Es vinculante.

### A.1 Orden de lectura obligatorio al retomar este plan en una sesión nueva

1. `/opt/setex/prod/.claude/CLAUDE.md` — §4 (11 reglas inviolables) y §10 (estado técnico, LL-002, REGLA 11).
2. Este documento completo, incluida la bitácora §H (dice en qué punto exacto está la ejecución).
3. `docs/ocr-v2/DESPLIEGUE-Y-ACTIVACION.md` — flags y coste de cada uno.
4. `docs/ocr-v2/INFORME-REPLAY.md` — cómo se midió la calidad y cómo repetir la medición.
5. Verificar las anclas de código de A.3 con los comandos indicados. **Si un ancla no aparece donde se espera, PARAR y avisar a Julio** — significa que el código cambió después de escribir este plan.

### A.2 Reglas de comportamiento durante la ejecución (innegociables)

1. **Explicar antes de ejecutar**: antes de empezar CADA fase (y cada subfase con riesgo), explicar a Julio en lenguaje simple qué se va a hacer, qué puede salir mal y cómo se revierte. Esperar su OK explícito. Sin excepción.
2. **Una fase no empieza hasta que la anterior tiene su evidencia registrada en §H** (comando ejecutado + salida + fecha).
3. **Ante duda razonable → parar y preguntar.** No se avanza "porque probablemente sea así".
4. **Prohibido reutilizar** los adapters congelados de `src/adapters/ocr/*.adapter.js` + `src/ports/ocr.port.js` (arquitectura fechada el día del incidente LL-002, cero referencias desde el runtime) sin aprobación explícita de Julio.
5. **Prohibido tocar ficheros v1** (`ocr/*.js`, lógica post-extracción de `server.js`) salvo el punto de enganche definido en FASE 1. Cualquier otra modificación de v1, aunque sea aditiva, requiere aprobación explícita previa de Julio (precedente: `ocr/azure.js` bounding boxes, aprobado como excepción puntual).
6. **Flags nuevos**: prefijo `ocr_extraccion_v2_*` SIEMPRE. Nunca `pipeline_v2_*` (ese prefijo pertenece al sistema de routing/validación, distinto y activo en producción desde 2026-07-22).
7. **Operaciones destructivas** (DROP, DELETE masivo, `rm -rf`, force push, `down -v`) → confirmación explícita de Julio cada vez, aunque estén escritas en este plan.
8. **Deploy**: siempre `docker compose build backend && docker compose stop backend && docker compose up -d backend` (REGLAS 3 y 7). Nunca `restart` para cambios de código o env.
9. **`features.json` es bind-mount**: tras editarlo, verificar que el contenedor lo ve (`docker exec setex-prod-backend cat /app/src/config/features.json`). Si no lo ve (inodo nuevo por la herramienta de edición), `docker compose stop backend && docker compose up -d backend` — nunca rebuild para esto, nunca `restart`.
10. **Cualquier desviación del plan se anota en §H con fecha y motivo ANTES de ejecutarla**, no después.

### A.3 Anclas de código — verificadas el 2026-07-29 contra el fuente real

Las líneas caducan; el texto ancla no. Al retomar, localizar por contenido, no por número.

| Ancla | Fichero | Línea (2026-07-29) | Comando de verificación |
|---|---|---|---|
| Punto de enganche en preview (inicio de la validación v1) | `app/backend/src/server.js` | 1819 | `grep -n "const campos = ocrData.campos" app/backend/src/server.js` |
| Único uso real de `ocr_extraccion_v2_enabled` (solo decide log del quality gate) | `app/backend/src/server.js` | 1769 | `grep -n "ocr_extraccion_v2_enabled" app/backend/src/server.js` |
| Sombra v2 actual en confirm (fire-and-forget + INSERT `extracciones_v2`) | `app/backend/src/server.js` | 2916-2945 | `grep -n "ejecutarPipelineV2Sombra" app/backend/src/server.js` |
| Orquestador v2 completo | `app/backend/src/pipeline/orchestrator.js` | — | `ls app/backend/src/pipeline/` |
| Shape canónico v2 (Zod) | `app/backend/src/pipeline/schema.js` | — | ídem |
| Comparador v1 vs v2 (mide v1 por `ocr_result.merged` inmutable, no por columnas corregidas a mano) | `app/backend/eval/comparar-v1-v2.js` | — | `ls app/backend/eval/` |
| Flags v2 | `app/backend/src/config/features.json` | bloque `_OCR_EXTRACCION_V2` y `_GAPS_APRENDIZAJE_2026_07_28` | `grep ocr_extraccion_v2 app/backend/src/config/features.json` |

Estado de flags verificado el 2026-07-29: `enabled=false`, `shadow_mode=true`, `modelos=["azure","gemini_flash","openai"]`, `umbral_auto=0.9`, `umbral_revision=0.6`, `variantes=true`, `tesseract=true`, `aprendizaje=true`, `quality_gate_blocking=false`.

### A.4 Formato de evidencia

Cada criterio de salida se cierra con una entrada en §H que incluye: fecha, comando(s) ejecutado(s), salida relevante (resumida, no truncada en lo esencial), y quién aprobó si requería aprobación. Un criterio sin evidencia registrada NO está cerrado, diga lo que diga la memoria de la sesión.

---

## §B. Por qué existe este documento

El 2026-04-28 se ejecutó el "v3 swap" (incidente **LL-002**): un cambio en la ruta crítica pasó los tres blindajes existentes (paridad CI ✅, healthcheck ✅, smoke HTTP ✅) y **rompió producción igualmente**, porque ninguno comprobaba la *forma* de la respuesta (`{items, total}` vs `{facturas, total}`). Hubo que revertir en caliente en 22 minutos, y el descalce main↔runtime que dejó sigue abierto (REGLA 11).

La activación de v2 es un cambio de la misma naturaleza o mayor: afecta a **lo que el cliente ve en cada factura**. Este plan está escrito asumiendo que volverá a haber un LL-002 si se hace con prisa.

**Regla que gobierna todo el documento**: ante duda razonable → se para y se pregunta. No se avanza de fase sin que la anterior esté verificada con evidencia.

---

## §C. Situación real de partida (verificada 2026-07-29 contra código y datos)

### C.1 Lo que v2 ES hoy

- Corre **solo en `POST /api/upload-confirm`**, después de que la factura ya esté guardada (`server.js:2916-2945`), en fire-and-forget.
- Escribe en `extracciones_v2` y **no toca nada** de lo que ve el usuario.
- Se activa con `ocr_extraccion_v2_shadow_mode` (hoy `true`, activo desde 2026-07-27).
- Cadena interna (orchestrator.js): ingesta → quality gate → extracción azure+gemini_flash con retry → árbitro por campo (checksum NIF / cuadre IVA, OpenAI desempata) → re-extracción dirigida por bounding boxes → variante CLAHE → cotejo Tesseract anti-alucinación → aprendizaje de proveedor → score + estado.

### C.2 Lo que v2 NO es (hallazgo crítico)

> **El flag `ocr_extraccion_v2_enabled` NO activa v2.**
> Su único uso real (`server.js:1769`) es decidir si se loguea el análisis de calidad de imagen. No existe **ninguna** ruta de código por la que el resultado de v2 llegue al usuario.

Consecuencia: *activar v2* no es cambiar un flag. Es **construir la integración que no existe** (FASE 1).

### C.3 Evidencia de calidad (medición del 2026-07-29)

27 facturas reales, contra ground truth verificado a mano, solo campos `legible`:

| Métrica | v1 | v2 |
|---|---|---|
| Campos del documento (nº factura, fecha, total) | 73/81 — **90,1%** | 78/81 — **96,3%** |
| Todos los campos | 150/187 — 80,2% | 156/187 — 83,4% |

- **v2 gana claramente en lectura del documento**, que es lo que mide la calidad del OCR.
- Los campos de *identidad* (nombre/NIF de emisor y receptor) no miden OCR: ambos pipelines los toman de la BD (registro del usuario, `known_cifs`). v2 en sombra no aplica esa sustitución, por eso "pierde" ahí artificialmente.
- Herramienta: `app/backend/eval/comparar-v1-v2.js` (mide v1 por su salida inmutable `ocr_result.merged`, NO por las columnas de `uploads`, que ya han sido corregidas a mano).

### C.4 Errores conocidos que v2 auto-aprobaría

De 17 facturas que v2 marcó `auto_aprobada`, **2 llevan un error real de documento**:

| Factura | Campo | v2 leyó | Verdad |
|---|---|---|---|
| #13 | `numero_factura` | `1/000115` | `000115` |
| #22 | `fecha_emision` | `10/07/2023` | `10/07/2026` |

La #22 **v1 también la falla** (lee 2023); la corrigió un humano al confirmar — no es regresión de v2. Mitigación ya desplegada (2026-07-29): `fecha_emision` se coteja contra el texto bruto de Tesseract, lo que habría marcado la #22 como sospechosa. **Pendiente**: que esa sospecha *cambie el routing*, no solo se registre (FASE 3).

### C.5 Restricción de infraestructura — BLOQUEANTE

**El recurso Azure Document Intelligence usado en el replay está en plan gratuito F0** y devolvió `429 rate limit` de forma sostenida durante el replay del 2026-07-29.

Volumen real: ~5.000-6.000 facturas/mes, picos trimestrales ~15.000. v2 hace 2 llamadas de extracción por factura, y con `variantes_enabled=true` (hoy activo) hasta 4 — entre 2× y 4× la carga actual sobre Azure.

> **Sin Azure DI en plan de pago verificado bajo carga, v2 NO se activa. Punto.**

⚠️ **Trampa de coste detectada al revisar este plan**: el coste medido en el replay (~$0.008/factura) se midió con Azure en F0, que es **gratis** — es decir, la cifra **NO incluye el coste de Azure**. En S0, `prebuilt-invoice` cuesta del orden de ~$10/1.000 páginas: con 2 llamadas Azure/factura son ~$0,02/factura SOLO de Azure. La proyección real se calcula en FASE 0.2 con la tarifa vigente, no con la cifra del replay.

---

## §D. Riesgos identificados y su mitigación

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | Repetir LL-002: cambio de contrato invisible a los tests | Producción caída, clientes sin facturar | FASE 2: tests de *forma* de respuesta, no solo de status |
| R2 | Perder la regla de identidad del usuario (nombre/CIF del registro) | El cliente ve su propia empresa mal → desconfianza inmediata | FASE 1: la integración se hace **aguas arriba** de la sustitución (ancla `server.js:1819`), nunca la sustituye |
| R3 | Perder validaciones que hoy sí corren (lista negra CIF, IVA, duplicados) | Datos fiscales inválidos en contabilidad | FASE 1: v2 solo sustituye la **extracción**, nunca la validación posterior |
| R4 | Azure 429 en producción con volumen real | Facturas fallando en hora punta | FASE 0.1: plan de pago + prueba de carga + concurrencia ajustada a cuota |
| R5 | Coste por factura infravalorado (ver trampa C.5) | Sobrecoste no presupuestado | FASE 0.2: cálculo con tarifas reales de TODOS los motores, aprobación por escrito |
| R6 | v2 auto-aprueba errores (#13, #22) | Error en contabilidad sin revisión | FASE 3: sospecha de alucinación calibrada fuerza revisión |
| R7 | Regresión silenciosa en facturas que hoy salen perfectas | Cliente nota que "antes iba mejor" | FASE 4: sombra → canario por usuario → % gradual, con tasa de corrección humana como métrica |
| R8 | Rollback lento si algo va mal | Minutos de caída | FASE 5: rollback por flag en caliente < 2 min, procedimiento ensayado ANTES de activar |
| R9 | Doble coste en sombra: v2 corre en preview (nuevo) Y en confirm (sombra actual) por la misma factura | Coste x2 sin valor añadido | FASE 1.5: el resultado de preview se guarda en Redis y se reutiliza en confirm; el fire-and-forget de confirm se apaga al activar `modo=sombra` |
| R10 | Desplegar desde `main` descalzado (REGLA 11) | Reconstruir producción con v3 roto | Todo el trabajo sale de la rama activa del runtime; NUNCA build desde `main` sin verificar el revert `508d7ae` |
| R11 | Sesión IA futura "reinterpreta" el plan | Cualquiera de los anteriores | §A completo + anclas verificables + bitácora §H |

---

## FASE 0 — Precondiciones (NO es opcional, NO se comprime)

Nada de lo que sigue se empieza sin estos cinco puntos cerrados con evidencia en §H.

### 0.1 Azure DI a plan de pago

**Pasos**:
1. Identificar qué recurso/tier de Azure usa producción HOY (secreto en `secrets/`, ver el endpoint en la config del backend) y cuál usó el replay. **No asumir que son el mismo.** Si producción ya está en S0 y solo el replay usó F0, este punto se reduce a apuntar el replay al recurso bueno.
2. Contratar/confirmar plan S0 (o superior) para el recurso que usará v2.
3. Consultar la cuota real de peticiones/minuto del tier contratado en el portal de Azure y **fijar la concurrencia del backend v2 por debajo de esa cuota** (documentar el valor elegido en §H).
4. Prueba de carga: repetir el mecanismo de replay (documentado en `docs/ocr-v2/INFORME-REPLAY.md`) sobre ≥50 facturas seguidas contra el recurso definitivo.

**Criterio de salida**: 50 llamadas consecutivas sin un solo 429, con log como evidencia.
**Prohibición**: no subir la concurrencia por encima de la cuota "porque va bien".

### 0.2 Cálculo y aprobación del coste

**Pasos**:
1. Calcular coste/factura de v2 con tarifas vigentes (verificarlas online, no de memoria) de: Azure S0 `prebuilt-invoice` × nº de llamadas real (2 con variantes), Gemini Flash × llamadas, OpenAI (solo desempates — medir % real de desempates en `extracciones_v2`), re-extracción dirigida (medir frecuencia real).
2. Restar el coste de v1 que desaparece cuando v2 sea el único pipeline (FASE 6) y sumar el doble coste transitorio de las fases sombra (v1+v2 a la vez).
3. Proyectar tres escenarios: 6.000/mes, 15.000/mes (pico), y sombra transitoria (v1+v2).

**Criterio de salida**: tabla de costes en §H y **aprobación de Julio por escrito** de la cifra y del techo mensual.

### 0.3 Ampliar el dataset de verdad

- Hoy: 27 facturas verificadas. Es poco para decidir sobre 6.000/mes.
- Objetivo: **≥100 facturas verificadas a mano**, cubriendo todos los proveedores recurrentes, ≥10 fotos de mala calidad, y los dos tipos de factura (emitida/recibida) si aplica.
- Método: mismo procedimiento de ground truth ya usado (ver historial 2026-07-28/29 en `docs/INFORME_SISTEMA_COMPLETO.md`); las facturas nuevas se verifican ANTES de mirar qué dijo cada pipeline, para no sesgar.

**Criterio de salida**: `app/backend/eval/comparar-v1-v2.js` corre sobre ≥100 facturas y el informe resultante se guarda en `docs/ocr-v2/` con fecha.

### 0.4 Congelar el alcance de v2

Documento corto (`docs/ocr-v2/ALCANCE-ACTIVACION.md`) que fija:
- **Campos que v2 decide**: `numero_factura`, `fecha_emision`, `total`, `base_imponible`, `cuota_iva`, `lineas_iva`, `cuota_irpf`.
- **Campos que v2 NO toca**: identidad de emisor y receptor (nombre/NIF) — siguen saliendo de registro del usuario / `known_cifs` / `company_catalog` / árbitro de CIF **exactamente como hoy**. Requisito explícito de Julio.
- Qué pasa con cada flag auxiliar durante la activación (`variantes`, `tesseract`, `aprendizaje`, `quality_gate_blocking`): se congelan en su valor actual; cambiarlos durante la activación contaminaría la comparación.

**Criterio de salida**: documento firmado por Julio (un "OK al alcance" escrito vale).

### 0.5 Ensayar el rollback ANTES de necesitarlo

En staging: cambiar `ocr_extraccion_v2_modo` (cuando exista, FASE 1) de `sombra` a `off` y cronometrar el procedimiento completo de A.2.9, incluida la verificación de que el contenedor ve el cambio.

**Criterio de salida**: rollback ensayado en < 2 minutos, pasos exactos transcritos en §H y en `docs/PLAYBOOK_EMERGENCIAS.md`.

---

## FASE 1 — Construir la integración (rama propia, sin desplegar)

**Rama**: `feature/ocr-v2-integracion-preview-YYYY-MM-DD`, creada desde la rama actualmente desplegada en el runtime de producción (verificar con `git log --oneline -5` que contiene los commits `feat(ocr-v2/fase10)`). **NUNCA desde `main`** (R10).

**Antes de empezar**: explicar la fase a Julio (A.2.1) y verificar las anclas A.3.

### 1.1 Punto de enganche

Ejecutar v2 dentro de `POST /api/upload-preview`, **inmediatamente antes** del ancla `const campos = ocrData.campos || {}` (`server.js:1819` a fecha de este plan), sustituyendo —cuando el modo lo mande— los campos de extracción dentro de `ocrData.campos` por los de v2 ya adaptados. Así **todo lo que hay después sigue corriendo idéntico e intacto**: foto inmutable de la IA, árbitro de CIF, lista negra, swap proveedor/receptor, `company_catalog`, `known_cifs`, `company_relationships`, sustitución por el registro del usuario, validación de IVA, detección de duplicados en confirm.

> Esto es lo que protege R2 y R3: v2 sustituye **de dónde salen los números**, no **qué se hace con ellos después**.

Implementación: función única `ejecutarPipelineV2Preview()` en `pipeline/orchestrator.js` (reutilizando `ejecutarPipelineV2Sombra` internamente, no duplicando lógica), llamada desde un bloque de ≤20 líneas en `server.js`. Cuanto menos toque `server.js`, más fácil el rollback por código.

### 1.2 Adaptador de forma

v2 devuelve shape canónico anidado (definido en `pipeline/schema.js`); v1 usa shape plano (`ocrData.campos`). Crear `app/backend/src/pipeline/adaptador-v1.js`:

1. **Antes de escribir una línea**: enumerar TODOS los campos reales del shape plano leyendo `ocr/index.js` (qué claves produce `campos`) y el consumo aguas abajo en `server.js`. Listar el mapeo campo a campo en un comentario de cabecera del adaptador.
2. `canonicoAPlano(canonico)` → objeto con el shape exacto de `ocrData.campos`. Los campos fuera del alcance (identidad, 0.4) se copian **del resultado v1**, no de v2.
3. **Test de contrato** (`adaptador-v1.test.js`, junto a los tests existentes del pipeline): para cada campo del shape plano — existe, tipo correcto, formato correcto (fechas `DD/MM/YYYY` o el formato que use v1 — verificarlo, no asumirlo; importes con el mismo tipo número/string que v1). El test se construye desde un resultado v1 real capturado como fixture, no desde suposiciones.

### 1.3 Un solo flag de modo, cuatro valores

Nuevo flag **`ocr_extraccion_v2_modo`** (string) en `features.json`, que **sustituye y elimina** al equívoco `ocr_extraccion_v2_enabled` (migrar en el mismo commit su único uso, `server.js:1769`, a `modo !== "off"`, y actualizar el comentario `_OCR_EXTRACCION_V2`):

| Valor | Qué hace | Quién ve v2 |
|---|---|---|
| `"off"` | v2 no corre en preview. La sombra de confirm sigue gobernada por `shadow_mode` como hoy | Nadie |
| `"sombra"` | v2 corre tras responder el preview (fire-and-forget, cero latencia añadida), se registra resultado y divergencia con v1. **Se sirve v1** | Nadie (coste real, riesgo cero) |
| `"canario"` | v2 se sirve SOLO a los usuarios de `ocr_extraccion_v2_pilotos` (array de emails). Para el resto, comportamiento `"sombra"` | Solo pilotos |
| `"activo"` | v2 se sirve al porcentaje `ocr_extraccion_v2_porcentaje` (0-100) de usuarios, por hash determinista del `userId` (mismo usuario → siempre mismo pipeline). 100 = todos | % de usuarios |

Reglas duras: la progresión es siempre `off → sombra → canario → activo`, sin saltos. `pilotos=[]` en modo canario significa **nadie** (no "todos"). Valor de `modo` no reconocido → se trata como `"off"` y se loguea error (fail-safe).

### 1.4 Fallback obligatorio a v1

En modos `canario`/`activo`, para el usuario al que le toca v2:
- v1 y v2 **no** corren en paralelo (duplicaría el coste para siempre). Corre v2; si v2 falla, supera el timeout (**10 s**, `Promise.race` — presupuesto p95 total del preview: 12 s) o su resultado no valida contra `pipeline/schema.js` → se ejecuta v1 y se sirve v1. El usuario nunca ve un error por culpa de v2, solo (raramente) unos segundos más.
- Cada fallback se registra (`observabilidad.js`) con motivo: `error | timeout | schema_invalido`. Esta métrica alimenta el criterio de rollback 5.2.

### 1.5 Eliminar el doble coste en sombra (R9)

Al pasar `modo=sombra`:
- El resultado v2 del preview se guarda junto al preview en Redis (mismo TTL 30 min).
- En `upload-confirm`, en lugar de relanzar `ejecutarPipelineV2Sombra` (2-4 llamadas más), se recupera el resultado de Redis y se hace el mismo INSERT en `extracciones_v2` con el `uploadId` ya disponible. Si no está en Redis (expiró), se registra el hueco, no se relanza.
- `ocr_extraccion_v2_shadow_mode` pasa a `false` en el mismo cambio de flags que active `modo=sombra` (documentarlo en el comentario del flag). El código de sombra en confirm se conserva como está (rollback trivial).

### 1.6 Criterio de salida de la FASE 1

- Suite completa de tests en verde (mismo número o más que antes de empezar; el fallo preexistente conocido de `api-surface-parity.test.js` #8 se anota, no se "arregla de pasada").
- Test de contrato del adaptador en verde.
- Revisión del diff completa: `git diff develop...HEAD -- app/backend/src/server.js` toca SOLO el punto de enganche y la línea 1769 migrada. Cualquier otra línea de `server.js` en el diff = violación de A.2.5.
- Evidencia en §H. **No se despliega nada en esta fase.**

---

## FASE 2 — Blindaje contra LL-002

Esto es exactamente lo que faltó en abril. No se salta ni se recorta.

### 2.1 Test de forma de respuesta

Para `POST /api/upload-preview` y `POST /api/upload-confirm`: test que valida **claves exactas y tipos** del JSON de respuesta contra un snapshot explícito (no autogenerado a ciegas: el snapshot se escribe a mano desde una respuesta real de producción y se revisa). El test falla si aparece, desaparece o cambia de tipo cualquier clave.

### 2.2 Test de equivalencia sombra ↔ off

Sobre el dataset de ≥100 facturas (0.3), en entorno de test: para cada factura, la respuesta servida con `modo=sombra` debe ser **byte a byte idéntica** a la de `modo=off` (excluyendo campos intrínsecamente variables como timestamps/request-id, que se listan explícitamente en el test). Si difiere en algo más, v2 está contaminando la ruta v1 → bug bloqueante.

### 2.3 Smoke post-despliegue con validación de cuerpo

Ampliar el smoke HTTP del CI/CD para validar la **forma del cuerpo** en `/api/upload-preview`, `/api/upload-confirm`, `/api/admin/facturas`, `/api/me/facturas` y `/api/auth/login`. Si la forma no cuadra, el despliegue se marca fallido automáticamente. (Esto además salda parte de la deuda pendiente de LL-002, §10.2 del CLAUDE.md.)

**Criterio de salida**: los tres puntos en verde en CI, con enlace/salida en §H.

---

## FASE 3 — Cerrar el agujero del auto-aprobado (R6)

### 3.1 Sospecha de alucinación → fuerza revisión

Hoy `alucinaciones_sospechosas` se registra pero no cambia el routing. Cambio: si hay sospecha en un campo crítico (`fecha_emision`, `numero_factura`, `total`), el estado de v2 no puede ser `auto_aprobada` → cae a `pendiente_revision`.

### 3.2 Calibrar ANTES de aplicar

**Atención**: en la medición actual, 22 de 27 facturas tenían alguna sospecha. Aplicar la regla en bruto mandaría casi todo a revisión y destruiría el valor de la automatización.

Trabajo previo obligatorio, sobre el dataset de ≥100 (0.3):
1. Medir tasa de falsos positivos del cotejo Tesseract **por campo** (query sobre `extracciones_v2.alucinaciones_sospechosas` cruzada con el ground truth).
2. Aplicar la regla **solo** a los campos con falso positivo bajo (hipótesis a validar: `fecha_emision` sí; `total` probablemente no).
3. Documentar en el código el umbral elegido por campo y por qué (comentario con la cifra medida).

**Criterio de salida**: con la regla aplicada sobre el dataset: **0 errores auto-aprobados** Y **≤20% de facturas desviadas de más a revisión** (respecto a sin regla). Ambos números en §H.

### 3.3 Verificar contra los dos casos conocidos

La regla debe capturar la #13 y la #22 del dataset actual. Si no las captura, no sirve y se rediseña. Test de regresión fijado con ambas como fixtures.

---

## FASE 4 — Despliegue progresivo

Cada transición de esta fase requiere: explicación previa a Julio (A.2.1) + evidencia del escalón anterior en §H.

### 4.1 Staging primero

Desplegar la rama en `staging.setex-facturas.es` con `modo=sombra` durante ≥48 h con tráfico de prueba (usar `scripts/seed-staging.*` y facturas reales de prueba). Revisar logs de divergencia v1↔v2 y de fallbacks. Ensayar aquí el rollback (0.5) si no se hizo ya.

### 4.2 Sombra en producción

Deploy a producción (procedimiento A.2.8, checklist de deploy del proyecto) con `modo=off`; activar `modo=sombra` en caliente después de verificar el arranque sano. Duración: **≥1 semana o ≥500 facturas reales**, lo que llegue antes.

Métrica a vigilar: **divergencia v1↔v2 por campo** (extender `comparar-v1-v2.js` o consultar `extracciones_v2` vs `uploads.ocr_result->'merged'`). Umbral de investigación: si v2 difiere de v1 en >5% de las facturas en cualquiera de `numero_factura`, `fecha_emision`, `total`, se investiga muestra a muestra antes de seguir (la divergencia puede ser v2 acertando donde v1 falla — hay que mirar, no asumir).

También vigilar: tasa de fallback (motivo y frecuencia), latencia del pipeline v2, coste real acumulado vs proyección 0.2.

### 4.3 Canario

`modo=canario` con `pilotos=[cuenta de Julio y/o una empresa de bajo volumen que acepte]`, hasta acumular **≥100 facturas servidas por v2**.

Métrica de éxito, la única que importa de verdad:
> **Tasa de corrección humana**: % de facturas donde el usuario edita algún campo del alcance de v2 en la pantalla de confirmación. El sistema ya guarda las tres columnas (IA → sistema → humano, cambio 2026-07-29), así que es medible con una query, sin instrumentación nueva.
> Si con v2 el usuario corrige **menos o igual** que con v1, v2 es mejor *en la práctica*, no solo en el laboratorio.

### 4.4 Activación general

Solo si el canario cumple TODO: tasa de corrección humana ≤ la de v1 · 0 incidencias del piloto · 0 facturas con identidad del cliente incorrecta · coste dentro de lo aprobado en 0.2.

`modo=activo` con `porcentaje`: **10 → 50 → 100**, con **≥48 h en cada escalón** y revisión de las métricas de 4.2/4.3 antes de cada salto. Cualquier criterio de rollback (5.2) → se baja al escalón anterior o a `sombra`, se investiga, y solo se reintenta con causa raíz documentada en §H.

---

## FASE 5 — Rollback y vigilancia

### 5.1 Rollback en caliente (< 2 minutos, ensayado en 0.5)

`ocr_extraccion_v2_modo` vive en `features.json` (bind-mount, relectura sin rebuild). Procedimiento exacto:

```bash
cd /opt/setex/prod
# 1. Editar app/backend/src/config/features.json → "ocr_extraccion_v2_modo": "off"
# 2. Verificar que el contenedor lo ve:
docker exec setex-prod-backend cat /app/src/config/features.json | grep ocr_extraccion_v2_modo
# 3. Si NO lo ve (la edición rompió el inodo del bind-mount):
cd app && docker compose stop backend && docker compose up -d backend   # nunca 'restart', nunca rebuild
# 4. Confirmar con una factura de prueba que el preview vuelve a servir v1.
```

### 5.2 Criterios de rollback automático (sin discutir, sin esperar a Julio)

- Tasa de error de `upload-preview` > 1%.
- Latencia p95 del preview > 12 s.
- Tasa de fallback v2→v1 > 10% sostenida (v2 no está siendo fiable aunque el usuario no lo note).
- **Cualquier** factura servida con campos de identidad del cliente incorrectos (violación de R2): rollback + incidente.

Tras un rollback: anotar en §H fecha, disparador y datos; avisar a Julio; no reactivar sin causa raíz.

### 5.3 Vigilancia post-activación

Primeras 2 semanas tras el 100%: revisión **diaria** de tasa de corrección humana, tasa de fallback, coste/factura y errores. Después: semanal hasta cerrar FASE 6.

---

## FASE 6 — Consolidación: v2 como motor definitivo

Objetivo declarado por Julio: si v2 demuestra ser mejor que v1, **usarlo para siempre**. "Para siempre" se gana con evidencia, no se declara:

### 6.1 Criterios para declarar v2 definitivo (los tres, sostenidos)

1. **≥3 meses** al 100% sin incidencias atribuibles a v2.
2. Tasa de corrección humana **consistentemente ≤** la histórica de v1 (comparar contra el histórico previo a la activación, mismo tipo de mes — ojo con comparar un mes pico con uno valle).
3. Coste real mensual dentro del techo aprobado en 0.2.

### 6.2 Qué se hace entonces (y qué no)

- Se escribe un **ADR nuevo** (`docs/adr/0006+`, convención Nygard): "Pipeline OCR v2 como motor de extracción definitivo", con las métricas de los 3 meses como evidencia.
- v1 pasa a **fallback congelado**: se mantiene funcional (es el fallback de 1.4) pero no recibe mejoras. NO se borra código v1 — borrar es otra decisión, con su propio análisis, y solo con aprobación explícita de Julio.
- Se revisan los flags transitorios: la sombra de confirm (`shadow_mode`) y el registro de divergencia pueden apagarse para ahorrar coste; `extracciones_v2` pasa a ser la fuente primaria.
- Se decide (con Julio) el futuro del quality gate bloqueante y de la re-extracción dirigida como mejoras post-consolidación, cada una con su propio mini-plan.

### 6.3 Si v2 NO cumple

Se documenta en §H y en el ADR qué falló y contra qué métrica, `modo=off`, y v1 sigue siendo el motor. El trabajo no se tira: la infraestructura de blindaje (FASE 2) y el dataset (0.3) quedan para el siguiente intento.

---

## §E. Lo que este plan deliberadamente NO hace

- **No borra v1.** Ni ahora ni al consolidar (6.2). Fallback permanente hasta decisión explícita separada.
- **No toca la identidad del cliente.** Sigue viniendo del registro/`known_cifs` exactamente como hoy. Requisito explícito de Julio (R2, alcance 0.4).
- **No activa el quality gate bloqueante** (`ocr_extraccion_v2_quality_gate_blocking`). Decisión aparte, con su propio riesgo (rechazar fotos de clientes).
- **No cambia ningún flag `pipeline_v2_*`** (routing/validación): sistema distinto, activo desde 2026-07-22, fuera del alcance.
- **No mergea a `main` sin resolver la REGLA 11.** `main` sigue descalzado del runtime desde LL-002. Ese descalce se resuelve **antes** de que este trabajo llegue a `main` (pregunta abierta §G.5).

---

## §F. Estimación honesta

| Fase | Trabajo | Depende de |
|---|---|---|
| 0 | Azure de pago + coste + dataset 100 + alcance + ensayo rollback | Julio (coste, verificación manual) |
| 1 | Integración + adaptador + modos + fallback + anti-doble-coste | FASE 0 cerrada |
| 2 | Blindaje anti-LL-002 (3 tests/smoke) | FASE 1 |
| 3 | Calibrado de alucinaciones | Dataset ampliado (0.3) |
| 4 | Staging 48h → sombra prod 1 sem → canario 100 facturas → 10/50/100% | Calendario real: **≥3-4 semanas** no comprimibles |
| 5 | Vigilancia + rollback ensayado | Continuo |
| 6 | Consolidación | ≥3 meses al 100% |

**El cuello de botella no es programar: es acumular evidencia real.** Las fases 1-3 son días de trabajo; las fases 4 y 6 son calendario que no se puede comprimir sin asumir exactamente el riesgo que este plan existe para evitar.

---

## §G. Preguntas abiertas para Julio (bloqueantes marcadas)

1. **[BLOQUEA FASE 0]** ¿Se contrata el plan de pago de Azure DI (o se confirma que producción ya lo tiene y solo el replay usaba F0)?
2. **[BLOQUEA 4.3]** ¿Qué cuenta hace de piloto del canario: la tuya, una empresa de bajo volumen, o ambas?
3. **[BLOQUEA 0.2]** ¿Cuál es el techo de coste mensual aceptable para OCR (v1+v2 en transición, y v2 solo en régimen)?
4. **[BLOQUEA 0.3]** ¿Quién verifica a mano las ~75 facturas que faltan para llegar a 100? (Si soy yo con tu revisión por muestreo, dime el % de muestreo que te da confianza.)
5. **[BLOQUEA merge a main]** ¿El descalce `main` vs runtime (REGLA 11) se resuelve antes de este trabajo o en paralelo? Recomendación técnica: antes — mergear `508d7ae` primero deja una base limpia y elimina R10 de raíz.

---

## §H. REGISTRO DE EJECUCIÓN (bitácora viva — obligatoria)

Toda fase cerrada, desviación, rollback o aprobación de Julio se anota aquí con este formato:

```
### YYYY-MM-DD HH:MM — [Fase X.Y] Título corto
- Qué se hizo / qué se decidió
- Evidencia: comando(s) + salida relevante
- Aprobación: (si aplica) quién y cómo
```

### 2026-07-29 — [Plan] Versión 2.0 del plan
- Reescritura ultradetallada del plan v1.0: contrato de ejecución §A, anclas verificadas contra el fuente (correcciones: enganche real `server.js:1819`, no 1800; eval en `app/backend/eval/`; sombra confirm en 2916-2945), riesgos R9-R11 nuevos (doble coste sombra, deploy desde main descalzado, deriva de sesión IA), modo `canario` por lista de pilotos + `activo` por porcentaje determinista, trampa de coste Azure F0 detectada (C.5), FASE 6 de consolidación y esta bitácora.
- Evidencia: `grep -n "const campos = ocrData.campos" app/backend/src/server.js` → 1819 · `grep -n "ejecutarPipelineV2Sombra" app/backend/src/server.js` → 2928 · `ls app/backend/eval/` → `comparar-v1-v2.js`, `evaluate.js`.
- Ejecución: NO iniciada. Próximo paso: respuestas de Julio a §G y cierre de FASE 0.

### 2026-07-29 — [Fase 0.1/0.2/0.3] Verificación de realidad — tres muros duros medidos
- **Volumen real del producto**: `SELECT COUNT(*) FROM uploads` → **28 facturas en toda la historia** (28 procesadas). `extracciones_v2` → 56 filas de sombra. El plan pide ≥100 verificadas para decidir (0.3) y ≥500 de sombra en producción (4.2): **ninguno de los dos umbrales es alcanzable hoy** — no existen 100 facturas de cliente que verificar; el dataset máximo hoy = las 28 ya verificadas. El bottleneck no es programar, es que el producto aún no tiene tráfico real.
- **Coste real medido por v2 en sombra** (`AVG(coste_estimado_usd)` sobre 56 filas): **$0.00825/factura** (min $0.006, max $0.015). ⚠️ Medido con Azure en F0 (gratis) → NO incluye Azure. Tarifa Azure S0 verificada online 2026: **$10/1.000 páginas** = $0.01/página; v2 con `variantes=true` hace 2 llamadas Azure/factura → +$0.02. **Coste real v2 en S0 ≈ $0.028/factura ≈ €0.026.** Disputas medidas: 0.57/factura, 21/56 (37%) invocan árbitro OpenAI.
- **Proyección vs techo €400/mes de Julio**: 6.000/mes → ~€155 ✓ · 15.000/mes (pico) → ~€390 ✓ (al límite) · transición sombra (v1+v2 simultáneos) a pico → **>€400, se pasa**. Palanca: apagar `variantes_enabled` baja Azure a la mitad → holgura amplia. Coste v1 actual ≈ $0.017/factura (GPT-4.1 + Azure dual).
- **Latencia real medida** (`AVG/MAX(latencia_ms)`): **media 30.088 ms (30 s), máx 74.055 ms (74 s)**. El plan presupone p95 <12 s (1.4/5.2). Parte se debe a reintentos 429 de F0, pero es un **riesgo de arquitectura no contemplado**: si en S0 la latencia no baja de 12 s, v2 NO puede servirse síncrono en el preview (v1 hoy tarda 2-5 s) y necesitaría UX asíncrona (cambio mayor que "cambiar la fuente de los números"). **Medir latencia real en S0 es precondición de decidir el diseño de la Fase 1.**
- **Calidad actual** (`eval/comparar-v1-v2.js` re-ejecutado, solo lectura): v2 78/81 **96.3%** vs v1 73/81 **90.1%** en campos de documento. De las 10 facturas donde "v2 empeora", 9 son el artefacto de identidad (v2 lee el nombre real de la persona en el papel; el ground truth trae el de la BD) — NO regresión de OCR. Única regresión real de documento: #13 (`numero_factura` "1/000115" vs "000115"). Errores que v2 auto-aprobaría: 2/17 (#13, #22), como ya constaba.
- **Conclusión ejecutiva**: activar v2 hoy es prematuro por FALTA DE DATOS (28 muestras), no por falta de trabajo. Decidir el destino de cada factura de cliente sobre 28 ejemplos es exactamente el error de fondo de LL-002 (decidir con poca evidencia). Acción que desbloquea el resto y que solo Julio puede hacer: confirmar/contratar Azure S0 en el portal → medir latencia real en S0 → esa medición decide si el diseño síncrono de la Fase 1 es viable.
- Evidencia: queries psql sobre `uploads` y `extracciones_v2`; `docker exec setex-prod-backend node eval/comparar-v1-v2.js`; tarifas Azure S0/F0 verificadas en learn.microsoft.com y agregadores 2026. Ninguna escritura en producción; todo lectura.

### 2026-07-29 — [Decisión de Julio] Azure fuera de momento + selector de modelos configurable
Decisiones tomadas por Julio (reencuadran las Fases 0-1):
- **NO se contrata Azure ahora.** Se deja todo preparado para cuando haga falta (el motor `azure` sigue soportado en el código, solo retirado del default). El bloqueante Azure de la Fase 0.1 queda EN PAUSA, no cancelado.
- **Pila nueva sin Azure**: base configurable con Gemini Flash + Mistral OCR 4 + OpenAI 4.1, con OpenAI también utilizable como árbitro.
- **Selector interactivo**: poder incluir/quitar en caliente entre 2 y 4 modelos (base + árbitro on/off), vía `features.json`.
- **Techo de coste**: €500/mes aceptado para el pico puntual de la transición (hoy).
- **Dataset**: se trabaja solo con las 28 facturas reales existentes (no hay más). Julio verifica el ground truth él mismo.
- **Estudio de latencia** foto→resultado como pieza fundamental y separada → `PLAN-ESTUDIO-LATENCIA-CAPTURA.md`.

### 2026-07-29 — [Fase 1 parcial] Construida la selección configurable de modelos (rama, sin desplegar)
- Rama `feature/ocr-v2-modelos-configurables-2026-07-29` (desde el HEAD del runtime, NO main). Commit `feat(ocr-v2): selección configurable de 2-4 motores base + árbitro opcional`.
- **Diseño de seguridad**: sin flags nuevos, el comportamiento es idéntico a hoy (azure+gemini, sin árbitro externo) — desplegar el código NO cambia nada por sí solo. El cambio de mezcla es una decisión explícita vía `features.json` (la "parte interactiva"). `features.json` NO se ha tocado (es bind-mount en caliente): los flags se añaden al desplegar.
- **Ficheros** (todos v2, ningún fichero v1 tocado): `pipeline/seleccion-modelos.js` (nuevo, config con validación fail-safe), `pipeline/extractors.js` (+`ejecutarExtractorPorNombre`/`ejecutarExtraccionV2Multi`, aditivo), `pipeline/arbiter.js` (+`arbitrarFacturaMulti`: 2 modelos = pairwise idéntico; 3-4 = torneo que reutiliza el árbitro probado), `pipeline/orchestrator.js` (helper `extraerYArbitrar`, generaliza variantes/score/coste sin romper la ruta legacy).
- **Config recomendada a activar al desplegar** (documentada en `seleccion-modelos.js:CONFIG_RECOMENDADA`, se añade a `features.json` en el deploy, NO ahora):
  ```json
  "ocr_extraccion_v2_modelos_base": ["gemini_flash", "mistral"],
  "ocr_extraccion_v2_modelo_arbitro": "openai"
  ```
  Toggle rápido: quitar Mistral → `["gemini_flash"]`; sin árbitro → `"ninguno"`; 3 base → añadir `"openai"` o `"gemini_pro"` a la lista.
- **Consecuencia asumida**: sin Azure en la base, la re-extracción dirigida (Fase 7) se omite — hoy solo Azure aporta bounding boxes. Documentado en el código.
- **Tests**: 56 nuevos (seleccion-modelos + arbitraje/extracción multi), suite completa 327/328 verde — el único fallo es la paridad v3 preexistente (no relacionado). Comando: `node --test tests/` en `app/backend`.
- **Pendiente (gates que SÍ necesitan a Julio)**: (1) desplegar la rama a producción (procedimiento A.2.8); (2) añadir los flags a `features.json` en caliente tras el deploy; (3) sesión de dispositivo real para el estudio de latencia (§6 del plan de latencia); (4) reactivar la vía Azure cuando se contrate S0.

---

*Documento vivo. Cualquier desviación de este plan durante la ejecución se anota en §H con fecha y motivo ANTES de ejecutarla.*
