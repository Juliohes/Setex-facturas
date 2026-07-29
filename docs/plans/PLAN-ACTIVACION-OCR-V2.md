# PLAN DE ACTIVACIÓN DEL PIPELINE OCR v2 EN PRODUCCIÓN

> **Estado**: propuesta, NO ejecutada · **Fecha**: 2026-07-29 · **Autor**: sesión Claude Code con Julio
> **Precondición dura**: este plan NO se empieza hasta que se cumpla la Fase 0 completa.

---

## 0. Por qué existe este documento

El 2026-04-28 se ejecutó el "v3 swap" (incidente **LL-002**): un cambio en la ruta crítica que pasó los tres blindajes existentes (paridad CI ✅, healthcheck ✅, smoke HTTP ✅) y **rompió producción igualmente**, porque ninguno comprobaba la *forma* de la respuesta. Hubo que revertir en caliente en 22 minutos.

La activación de v2 es un cambio de la misma naturaleza o mayor: afecta a **lo que el cliente ve en cada factura**. Este plan está escrito asumiendo que volverá a haber un LL-002 si se hace con prisa.

**Regla que gobierna todo el documento**: en cualquier fase, ante duda razonable → se para y se pregunta. No se avanza de fase sin que la anterior esté verificada con evidencia.

---

## 1. Situación real de partida (verificada 2026-07-29)

### 1.1 Lo que v2 ES hoy

- Corre **solo en `POST /api/upload-confirm`**, después de que la factura ya esté guardada (`server.js:2924-2940`), en `fire-and-forget`.
- Escribe en `extracciones_v2` y **no toca nada** de lo que ve el usuario.
- Se activa con `ocr_extraccion_v2_shadow_mode` (hoy `true`).

### 1.2 Lo que v2 NO es (hallazgo crítico)

> **El flag `ocr_extraccion_v2_enabled` NO activa v2.**
> Su único uso real (`server.js:1769`) es decidir si se loguea el análisis de calidad de imagen. No existe **ninguna** ruta de código por la que el resultado de v2 llegue al usuario.

Consecuencia: *activar v2* no es cambiar un flag. Es **construir la integración que no existe**.

### 1.3 Evidencia de calidad (medición del 2026-07-29)

27 facturas reales, contra ground truth verificado a mano, solo campos `legible`:

| Métrica | v1 | v2 |
|---|---|---|
| Campos del documento (nº factura, fecha, total) | 73/81 — **90,1%** | 78/81 — **96,3%** |
| Todos los campos | 150/187 — 80,2% | 156/187 — 83,4% |

- **v2 gana claramente en lectura del documento**, que es lo que mide la calidad del OCR.
- Los campos de *identidad* (nombre/NIF de emisor y receptor) no miden OCR: ambos pipelines los toman de la BD (registro del usuario, `known_cifs`). v2 en sombra no aplica esa sustitución, por eso "pierde" ahí artificialmente.
- Herramienta de medición: `eval/comparar-v1-v2.js` (mide v1 por su salida inmutable `ocr_result.merged`, no por las columnas de `uploads`, que ya han sido corregidas a mano).

### 1.4 Errores conocidos que v2 auto-aprobaría

De 17 facturas que v2 marcó `auto_aprobada`, **2 llevan un error real de documento**:

| Factura | Campo | v2 leyó | Verdad |
|---|---|---|---|
| #13 | `numero_factura` | `1/000115` | `000115` |
| #22 | `fecha_emision` | `10/07/2023` | `10/07/2026` |

Nota: la #22 **v1 también la falla** (lee 2023). La corrigió un humano al confirmar. No es una regresión de v2.

Mitigación ya desplegada (2026-07-29): `fecha_emision` se coteja ahora contra el texto bruto de Tesseract, lo que habría marcado la #22 como sospechosa. **Pendiente**: que esa sospecha *cambie el routing*, no solo se registre (ver Fase 3).

### 1.5 Restricción de infraestructura — BLOQUEANTE

**Azure Document Intelligence está en plan gratuito F0.** Durante el replay del 2026-07-29 devolvió `429 rate limit` de forma sostenida, con reintentos en casi todas las facturas.

Volumen real del cliente: ~5.000-6.000 facturas/mes, picos trimestrales de ~15.000. **El plan F0 no soporta esto.** v2 hace 2 llamadas por factura (+2 más si `variantes_enabled`), es decir, entre 2× y 4× la carga actual sobre Azure.

> **Sin migrar Azure DI a plan de pago, v2 NO se activa. Punto.**

---

## 2. Riesgos identificados y su mitigación

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | Repetir LL-002: cambio de contrato invisible a los tests | Producción caída, clientes sin poder facturar | Fase 2: tests de *forma* de respuesta, no solo de status |
| R2 | Perder la regla de identidad del usuario (nombre/CIF del registro) | El cliente ve su propia empresa mal → desconfianza inmediata | Fase 1: la integración se hace **aguas arriba** de la sustitución, no la sustituye |
| R3 | Perder validaciones que hoy sí corren (lista negra CIF, IVA, duplicados) | Datos fiscales inválidos en contabilidad | Fase 1: v2 solo sustituye la **extracción**, nunca la validación posterior |
| R4 | Azure 429 en producción con volumen real | Facturas fallando en hora punta | Fase 0: plan de pago + prueba de carga |
| R5 | Coste por factura se dispara | Sobrecoste no presupuestado | Fase 0: cálculo explícito y aprobación de Julio |
| R6 | v2 auto-aprueba errores (#13, #22) | Error en contabilidad sin revisión | Fase 3: sospecha de alucinación fuerza revisión |
| R7 | Regresión silenciosa en facturas que hoy salen perfectas | Cliente nota que "antes iba mejor" | Fase 4: canario + métrica de corrección humana |
| R8 | Rollback lento si algo va mal | Minutos de caída | Fase 5: rollback por flag en caliente, sin rebuild |

---

## FASE 0 — Precondiciones (NO es opcional)

Nada de lo que sigue se empieza sin estos cuatro puntos cerrados.

### 0.1 Azure DI a plan de pago
- Contratar plan S0 (o superior) en Azure Document Intelligence.
- Verificar cuota real de peticiones/minuto y ajustar la concurrencia del backend a ese límite.
- **Criterio de salida**: 50 llamadas consecutivas sin un solo 429.

### 0.2 Cálculo y aprobación del coste
- Medir coste real por factura de v2 (el replay dio ~$0.008/factura con variantes activas).
- Proyectar a 6.000 y a 15.000 facturas/mes.
- **Criterio de salida**: Julio aprueba la cifra por escrito.

### 0.3 Ampliar el dataset de verdad
- Hoy: 27 facturas verificadas. Es **poco** para decidir sobre 6.000/mes.
- Objetivo: ≥100 facturas verificadas, cubriendo todos los proveedores recurrentes y al menos 10 fotos de mala calidad.
- **Criterio de salida**: `eval/comparar-v1-v2.js` corre sobre ≥100 facturas.

### 0.4 Congelar el alcance
- Escribir qué campos decide v2 y cuáles **no** toca. Propuesta: v2 decide `numero_factura`, `fecha_emision`, `total`, `lineas_iva`, `base_imponible`, `cuota_iva`, `cuota_irpf`. **NO** toca identidad (emisor/receptor) — eso sigue viniendo de registro/`known_cifs`/catálogo exactamente como hoy.
- **Criterio de salida**: documento de alcance firmado por Julio.

---

## FASE 1 — Construir la integración (rama propia, sin desplegar)

Rama: `feature/ocr-v2-integracion-preview-YYYY-MM-DD`

### 1.1 Punto de enganche
Ejecutar v2 dentro de `POST /api/upload-preview`, **antes** de la línea `const campos = ocrData.campos` (`server.js:1800`), de forma que **todo lo que hay después siga corriendo igual**: árbitro de CIF, lista negra, swap proveedor/receptor, `company_catalog`, `known_cifs`, `company_relationships`, sustitución por el registro del usuario, validación de IVA.

> Esto es lo que protege R2 y R3: v2 sustituye **de dónde salen los números**, no **qué se hace con ellos después**.

### 1.2 Adaptador de forma
v2 devuelve shape canónico anidado (`emisor.nif`, `lineas_iva[]`); v1 usa shape plano (`proveedor_nif`, `base_imponible`). Crear `src/pipeline/adaptador-v1.js` con:
- `canonicoAPlano(canonico)` → shape exacto que hoy produce `compareOCRResults`.
- Test de contrato: para cada campo del shape plano, existe y tiene el tipo correcto.

### 1.3 Tres modos, un solo flag
`ocr_extraccion_v2_modo` (string, sustituye al mal llamado `ocr_extraccion_v2_enabled`):
- `"off"` — v2 no corre en preview (comportamiento actual).
- `"sombra"` — v2 corre en preview, se registra su resultado y la diferencia con v1, pero **se sirve v1**. Coste real, riesgo cero.
- `"activo"` — se sirve v2.

Nunca se pasa de `off` a `activo` directamente.

### 1.4 Fallback obligatorio
Si v2 falla, tarda más de N segundos, o devuelve un canónico que no valida contra su esquema → **se sirve v1 automáticamente** y se registra el evento. El usuario nunca ve un error por culpa de v2.

**Criterio de salida de la Fase 1**: suite completa en verde, incluido el test de contrato del adaptador.

---

## FASE 2 — Blindaje contra LL-002

Esto es lo que faltó en abril. No se salta.

### 2.1 Test de forma de respuesta
Para `/api/upload-preview` y `/api/upload-confirm`: comprobar **claves exactas y tipos** de la respuesta JSON, no solo el status 200. Un test que falle si aparece o desaparece una clave.

### 2.2 Test de equivalencia v1↔v2
Sobre el dataset de ≥100 facturas: con `modo=sombra`, para cada factura, la respuesta servida debe ser **byte a byte idéntica** a la de `modo=off`. Si difiere, v2 está contaminando la ruta de v1 → bug.

### 2.3 Smoke post-despliegue con validación de cuerpo
Ampliar el smoke HTTP existente para que valide la forma del cuerpo en los endpoints críticos. Si falla, el despliegue se marca como fallido automáticamente.

**Criterio de salida**: los tres puntos en verde en CI.

---

## FASE 3 — Cerrar el agujero del auto-aprobado (R6)

### 3.1 Sospecha de alucinación → fuerza revisión
Hoy `alucinaciones_sospechosas` se registra pero **no cambia el routing**. Cambiar: si hay sospecha en un campo crítico (`fecha_emision`, `numero_factura`, `total`), el estado no puede ser `auto_aprobada`.

### 3.2 Calibrar antes de aplicar
**Atención**: en la medición actual, 22 de 27 facturas tenían alguna sospecha. Aplicar la regla en bruto mandaría casi todo a revisión y destruiría el valor de la automatización.

Trabajo previo obligatorio:
- Medir tasa de falsos positivos de Tesseract **por campo** sobre el dataset ampliado.
- Aplicar la regla **solo** a los campos donde el falso positivo sea bajo (hipótesis: `fecha_emision` sí, `total` probablemente no).
- **Criterio de salida**: con la regla aplicada, 0 errores auto-aprobados en el dataset y ≤20% de facturas desviadas a revisión de más.

### 3.3 Verificar contra los dos casos conocidos
La regla debe capturar #13 y #22. Si no los captura, no sirve.

---

## FASE 4 — Despliegue progresivo

### 4.1 Staging primero
Desplegar en `staging.setex-facturas.es` con `modo=sombra` ≥48h. Revisar logs de divergencia v1 vs v2.

### 4.2 Sombra en producción
`modo=sombra` en producción ≥1 semana, o ≥500 facturas reales, lo que llegue antes.
Métrica a vigilar: **divergencia v1↔v2 por campo**. Si v2 diverge en >X% en un campo, se investiga antes de seguir.

### 4.3 Canario
`modo=activo` para **un solo usuario piloto** (propuesta: la propia cuenta de Julio o una empresa de bajo volumen que acepte ser piloto), ≥100 facturas.

Métrica de éxito, la única que importa de verdad:
> **Tasa de corrección humana**: % de facturas donde el usuario edita algún campo en la pantalla de confirmación.
> Si con v2 el usuario corrige **menos** que con v1, v2 es mejor *en la práctica*, no solo en el laboratorio.

### 4.4 Activación general
Solo si el canario cumple:
- Tasa de corrección humana ≤ la de v1.
- 0 incidencias del piloto.
- Coste dentro de lo aprobado en 0.2.

Despliegue por lotes: 10% de usuarios → 50% → 100%, con ≥48h entre saltos.

---

## FASE 5 — Rollback y vigilancia

### 5.1 Rollback en caliente
`ocr_extraccion_v2_modo` vive en `features.json`, que es *bind-mount* y se relee sin rebuild. Volver a `"off"` es un cambio de una palabra.

> **Gotcha documentado del proyecto**: editar `features.json` con una herramienta que reescriba el fichero rompe el mount (inodo nuevo). Tras editar, verificar con `docker exec ... cat` y, si no lo ve, `docker compose stop backend && up -d backend` (nunca `restart`).

**Objetivo de rollback: < 2 minutos.**

### 5.2 Criterios de rollback automático
Se revierte sin discutir si:
- Tasa de error de `upload-preview` > 1%.
- Latencia p95 de preview > 12s.
- Cualquier factura servida con campos de identidad del cliente incorrectos.

### 5.3 Vigilancia post-activación
Primeras 2 semanas: revisión diaria de la tasa de corrección humana y del coste por factura.

---

## 6. Lo que este plan deliberadamente NO hace

- **No borra v1.** v1 queda como fallback permanente hasta que v2 acumule ≥3 meses sin incidencias.
- **No toca la identidad del cliente.** Sigue viniendo del registro, exactamente como hoy. Es requisito explícito de Julio.
- **No activa el quality gate bloqueante** (`ocr_extraccion_v2_quality_gate_blocking`). Es otra decisión, con su propio riesgo (rechazar fotos de clientes).
- **No mergea a `main`.** Ojo: `main` sigue descalzado del runtime desde LL-002 (REGLA 11 del CLAUDE.md del proyecto). Ese descalce debe resolverse **antes** de que este plan llegue a `main`.

---

## 7. Estimación honesta

| Fase | Trabajo | Depende de |
|---|---|---|
| 0 | Contratación Azure + ampliar dataset a 100 facturas | Julio (coste) + trabajo manual de verificación |
| 1 | Integración + adaptador + modos + fallback | Fase 0 cerrada |
| 2 | Blindaje anti-LL-002 | Fase 1 |
| 3 | Calibrado de alucinaciones | Dataset ampliado |
| 4 | Sombra → canario → general | Tiempo de calendario (≥2 semanas de observación real) |
| 5 | Vigilancia | Continuo |

**El cuello de botella no es programar: es acumular evidencia real.** Las fases 1-3 son días de trabajo; la fase 4 son semanas de calendario que no se pueden comprimir sin asumir el riesgo que se quiere evitar.

---

## 8. Preguntas abiertas para Julio

1. ¿Se contrata el plan de pago de Azure DI? Sin eso, el plan se detiene en la Fase 0.
2. ¿Qué empresa cliente acepta ser piloto del canario, o se usa una cuenta propia?
3. ¿Cuál es el techo de coste por factura aceptable?
4. ¿Quién verifica a mano las ~75 facturas que faltan para llegar a 100 en el dataset de verdad?
5. ¿Se resuelve el descalce `main` vs runtime (REGLA 11) antes o después de este trabajo?

---

*Documento vivo. Cualquier desviación de este plan durante la ejecución se anota aquí con fecha y motivo.*
