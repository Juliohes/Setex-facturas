# PLAN — Indicador de progreso en captura (barra/círculo + frases rotativas)

**Fecha:** 2026-08-21
**Estado:** PROPUESTA — pendiente de OK de Julio antes de implementar
**Alcance:** Solo frontend (`app/frontend/src/`). Cero cambios de backend, cero cambios de contratos API (regla 3).
**Flujo cubierto:** desde el clic en «Enviar» (`uploadFile()`, app.js) hasta que aparece el panel/modal de verificación (`showConfirmModal()`).

---

## 1. Problema

Durante `uploadFile()` (POST síncrono a `/upload-preview`) la UI solo deshabilita el botón y vacía el mensaje. El usuario no recibe feedback durante los segundos que dura subida + OCR + validaciones (CIF/IVA/VIES), lo que produce percepción de cuelgue y reintentos.

## 2. Solución propuesta

Overlay de progreso **no bloqueante y no destructivo** sobre la zona de captura:

- Barra horizontal (fallback visual: círculo si `prefers-reduced-motion` o pantalla estrecha — decisión de detalle CSS, misma lógica).
- Progreso **estimado por fases** (el endpoint no emite eventos de servidor; es un POST JSON síncrono — se documenta explícitamente que % es estimación visual, no medición real):

| Fase | Rango | Frase tipo |
|---|---|---|
| Subida del fichero | 0 → 15% | «Subiendo tu factura…» |
| Lectura OCR | 15 → 70% | «Leyendo los datos de la factura…» |
| Validaciones | 70 → 90% | «Verificando CIF e importes…» |
| Preparación | 90 → 99% | «Preparando la revisión…» |
| Fin | 100% | (se cierra el overlay al llegar la respuesta) |

- Avance asíntota por timer (nunca alcanza 100% sin respuesta real).
- Rotación de frases cada 2,5 s dentro de la fase activa.
- Al responder la petición: overlay → 100% y cierre ≤ 200 ms.
- En error (catch/HTTP≠ok): cierre inmediato ≤ 300 ms, mensajes y re-habilitación de botón EXACTAMENTE como hoy (no se toca esa lógica).

## 3. Requerimientos previos medibles (línea base — se miden ANTES de tocar código)

| # | Requisito previo | Métrica / cómo se mide | Criterio para empezar |
|---|---|---|---|
| P1 | Regresión verde en rama de trabajo | `npm test` (backend, `node --test`) 100% verde | Verde en HEAD |
| P2 | Smoke HTTP operativo | `scripts/smoke-test-http.sh` exit 0 contra entorno de prueba | Exit 0 |
| P3 | Latencia real de `/upload-preview` | Mediana y p95 con 5 facturas reales de muestra (DevTools → Timing), registradas en este doc | Datos registrados aquí abajo |
| P4 | Requests de red baseline | Nº de peticiones red en flujo captura→modal (DevTools), registrado | Nº registrado |
| P5 | Sin dependencias nuevas | `package.json` frontend sin cambios (regla 11) | diff vacío |

**Registro baseline P3/P4** (a cumplimentar contra staging el día del despliegue):
```
p50 upload-preview: ____ ms · p95: ____ ms
requests red flujo completo: ____
fecha medición: ____
```

## 3bis. Resultados de implementación (2026-08-21, rama `feature/progreso-captura-v1`)

- **P1:** ✅ suite backend completa 89/89 verde (83 previas + 6 nuevas de `progreso.test.js`).
- **P5:** ✅ cero dependencias nuevas (`package.json` frontend sin cambios).
- **Unitarias F2/F4/F8:** ✅ 6/6 (`node --test app/backend/tests/unit/progreso.test.js`).
- **Capa DOM F1/F3/F5:** ✅ smoke con stubs DOM (visible al iniciar, 100% solo en `finalizar()`, cierre inmediato en `abortar()`, reinicio sin fugas de timer).
- **P2/P3/P4:** ⏳ pendientes de validación E2E contra staging (checklist §6.3) antes de promover a prod.
- Decisión UX confirmada por Julio: overlay **parcial** (solo sobre `.upload-area`, no pantalla completa), disparado **siempre** que se procesa una foto/archivo, progreso **orientativo** (no ligado a eventos reales del backend).

## 4. Requisitos funcionales (aceptación medible)

| # | Requisito | Criterio de aceptación verificable |
|---|---|---|
| F1 | Aparece overlay al iniciar `uploadFile()` | Overlay visible ≤ 100 ms tras clic «Enviar» (Playwright: `toBeVisible`) |
| F2 | El % nunca llega a 100 sin respuesta del servidor | Test unitario: simulando 10 min sin respuesta, valor < 100 |
| F3 | Cierra al llegar respuesta correcta | Overlay oculto ≤ 200 ms tras resolver fetch Y modal de verificación visible (flujo idéntico al actual) |
| F4 | Rotación de frases | Cada ~2,5 s ± 250 ms cambia la frase; frases ≥ 3 distintas visibles en proceso > 6 s (test unitario con timers falsos) |
| F5 | Error: restauración intacta | Con error forzado: overlay oculto ≤ 300 ms, botón habilitado, mensaje de error idéntico byte a byte al actual (test compara salida) |
| F6 | Accesibilidad | `role="progressbar"` + `aria-valuenow` actualizado; respeta `prefers-reduced-motion` (sin animación de círculo) |
| F7 | Sin regresión de red | Mismo nº de requests que baseline P4 (ninguna petición nueva) |
| F8 | Interruptor de seguridad | Const `PROGRESO_HABILITADO = true` en un único punto; a `false` el flujo queda 100% idéntico al actual (ruta de código original sin envoltorios) |

## 5. Diseño técnico

- **Nuevo módulo `progreso.js`** (~120 líneas): núcleo lógico **sin DOM** (máquina de estados pura: `iniciar(fases) → tick() → {porcentaje, frase}`) → testeable con `node --test tests/unit/progreso.test.js` sin navegador.
- **Capa DOM mínima** en el mismo módulo (crear/eliminar nodo overlay, `aria-*`), invocada desde `uploadFile()` en **2 puntos**: inicio y finally-equivalente (éxito/error). No se modifica ninguna otra función existente.
- **HTML/CSS:** un contenedor `<div id="progress-overlay" hidden>` en `index.html` + estilos en `styles.css`. Sin frameworks, sin librerías (vanilla, coherente con el stack actual — ADR TypeScript-no-aplicable).
- **Contratos:** ningún endpoint, esquema ni firma cambia (regla 3). BD: nada (regla 4 trivialmente cumplida).
- **Multipágina y test-captura:** FUERA de alcance V1 (se evaluará extenderlos en V2 si el resultado es bueno).

## 6. Plan de pruebas (auto-verificación)

1. **Unitarias nuevas** (`node --test app/backend/tests/unit/progreso.test.js` — el módulo es JS plano, importable): asíntota (<100 siempre), fases/rangos correctos, rotación de frases con timers falsos, cierre instantáneo ante `finalizar()`, caso `PROGRESO_HABILITADO=false` = no-op.
2. **Regresión completa:** `npm test` backend 100% verde (P1 debe seguir verde).
3. **E2E manual scriptado** (checklist ejecutable con Playwright MCP contra staging):
   - [ ] Subir factura válida → overlay visible → frases cambian → modal verificación aparece → overlay desaparecido.
   - [ ] Subir fichero corrupto → overlay desaparece, mensaje error actual, botón activo.
   - [ ] Logout de sesión expirada durante subida → comportamiento 401/403 intacto.
   - [ ] Conteo requests = baseline P4.
4. **Criterio de NO-regresión global:** si cualquier test P1/P2 o checklist falla → revertir commit (commits atómicos y revertibles, convención del repo).

## 7. Archivos afectados

| Fichero | Cambio |
|---|---|
| `app/frontend/src/progreso.js` | NUEVO — módulo lógica+DOM |
| `app/frontend/src/app.js` | ~6 líneas en `uploadFile()` (inicio/fin) + 1 línea import |
| `app/frontend/src/index.html` | 1 contenedor overlay |
| `app/frontend/src/styles.css` | estilos overlay (bloque nuevo, sin tocar existentes) |
| `app/backend/tests/unit/progreso.test.js` | NUEVO — test unitario |
| `docs/plans/PLAN-INDICADOR-PROGRESO-CAPTURA-V1.md` | este doc (baseline + resultados) |

## 8. Despliegue

*(Actualizado 2026-08-21 tras verificar el estado real del remoto: `develop` ya no existe en GitHub; el tronco es `main`. `deploy-prod.yml` es solo manual con confirmación textual; el trigger automático de staging quedó huérfano.)*

Rama `feature/progreso-captura-v1` → PR a `main` (CI en verde) → validación E2E checklist §6.3 contra un entorno real → **aprobación explícita de Julio** → `deploy-prod.yml` manual escribiendo «DESPLEGAR» (regla 1). Rollback: flag `PROGRESO_HABILITADO=false` (hotfix sin deploy completo), revert del commit o re-dispatch del commit anterior.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| % estimado confunde si proceso dura >30 s | Última frase incluye «puede tardar unos segundos más»; asíntota evita 100 falso |
| Interferencia con modales existentes | Overlay con z-index propio y `pointer-events:none`; no toca DOM del modal |
| Service Worker cachea versión vieja | Bump de versión de caché en `service-worker.js` al desplegar (patrón PWA ya usado en prod) |
