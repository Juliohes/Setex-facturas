# PLAN DE ESTUDIO EXHAUSTIVO DE LATENCIA — FOTO → RESULTADO

> **Versión**: 1.0 · **Fecha**: 2026-07-29 · **Estado**: propuesta, medición NO ejecutada
> **Origen**: petición de Julio (2026-07-29) — "mirar el tiempo entre hacer la foto y mostrar el resultado, análisis exhaustivo de qué tarda más y por qué".
> **Relación**: complementa `PLAN-ACTIVACION-OCR-V2.md`. La latencia es una **precondición de diseño** de la Fase 1 de aquel plan: si el pipeline elegido no baja de ~12 s, no puede servirse síncrono y hay que rediseñar la UX (asíncrona).

---

## 0. Por qué este estudio es fundamental

El usuario final (el cliente de la asesoría) percibe UNA sola cosa: el tiempo desde que pulsa el botón de la foto hasta que ve los datos en pantalla para confirmar. Todo lo demás (calidad OCR, coste, arquitectura) es invisible para él. Si ese tiempo es alto, abandona o desconfía, por muy bueno que sea el OCR.

Hoy no sabemos **dónde** se va ese tiempo, solo el total. Medición existente:
- **v1 (lo que ve el usuario)**: 2-5 s de OCR según `docs/INFORME_CAPACIDAD_Y_RENDIMIENTO.md` — pero esa cifra es solo la etapa OCR del backend, NO incluye red móvil de subida ni render.
- **v2 en sombra (56 registros reales)**: `latencia_ms` media **30.088 ms**, máx **74.055 ms**. Incluye reintentos 429 de Azure F0 + variante CLAHE (x2 llamadas) + Tesseract + re-extracción. No sabemos el peso de cada uno.

**El problema del dato actual**: `extracciones_v2` guarda solo el total. No hay desglose por etapa persistido. Sin instrumentación, cualquier conclusión sobre "qué tarda más" es una suposición.

---

## 1. La cadena completa, etapa por etapa

El tiempo foto→resultado es la suma de eslabones que hoy medimos de forma agregada o no medimos:

| # | Etapa | Dónde | ¿Se mide hoy? | Coste esperado (hipótesis) |
|---|---|---|---|---|
| E1 | Captura + compresión en el móvil | Frontend (`app.js`) | ❌ | Bajo-medio (depende del dispositivo) |
| E2 | **Subida de red** móvil → servidor | Red (4G/5G/wifi) | ❌ | **Alto en móvil con foto grande** — a menudo infravalorado |
| E3 | Recepción multer + magic bytes | Backend `server.js` | ❌ | Muy bajo |
| E4 | `sharp` optimize (1536px, JPEG85) | Backend | ❌ | Bajo (~100-300 ms) |
| E5 | **Llamada(s) OCR** por motor | APIs externas | Parcial (log `*_ms`) | **DOMINANTE** — segundos por motor |
| E6 | Árbitro externo (OpenAI/Mistral) si hay disputa | API externa | ❌ | Alto pero condicional (~37% facturas) |
| E7 | Re-extracción dirigida (si disputa + bbox) | API externa | ❌ | Alto pero condicional |
| E8 | Variante CLAHE (duplica E5) | Backend + API | ❌ | **x2 de E5 si está activa** |
| E9 | Tesseract anti-alucinación | CPU local (0.5 vCPU) | ❌ | Medio (CPU-bound, throttle) |
| E10 | Salvaguarda aritmética / fusión | Backend | ❌ | Muy bajo |
| E11 | Escritura preview en Redis | Redis | ❌ | Muy bajo |
| E12 | Respuesta HTTP + render del modal | Red + frontend | ❌ | Bajo-medio (red de bajada) |

> **Nota clave**: E5-E8 son las que gobiernan el total, y son exactamente las que el selector de modelos nuevo (2026-07-29) hace configurables. Este estudio debe medirse sobre la **pila nueva** (gemini_flash + mistral + openai árbitro, sin Azure), que es la que va a producción, no sobre la vieja azure+F0 cuyos 30 s están contaminados por los 429.

---

## 2. Hipótesis a validar (fundamentadas, no a ciegas)

- **H1**: E5 (OCR) es ≥70% del tiempo de backend. → medir ms por motor.
- **H2**: Los 30 s de la sombra actual se deben MÁS a los reintentos 429 de Azure F0 que al pipeline en sí. Sin Azure, el total cae drásticamente. → comparar con/sin Azure.
- **H3**: La variante CLAHE (E8) duplica E5 y aporta poco (calidad ya 96,3% sin ella). → medir Δlatencia y Δcalidad con `variantes` on/off. **Palanca de latencia y coste a la vez.**
- **H4**: Con el backend a 0.5 vCPU, bajo concurrencia (3 simultáneas, el óptimo medido), Tesseract (E9) y sharp compiten por CPU y la latencia por factura sube. → medir a concurrencia 1 vs 3.
- **H5**: E2 (subida móvil) es una fracción grande del tiempo *percibido* y hoy invisible en toda métrica de backend. → requiere medición en dispositivo real.
- **H6**: Mistral OCR y Gemini Flash tienen latencias distintas; el motor más lento marca el paralelo (E5 = max, no suma). → medir cada motor por separado para poder elegir el mix por velocidad, no solo por acierto.

---

## 3. Instrumentación (qué construir)

### 3.1 Backend — desglose por etapa (E3-E11)
Dos opciones, de menor a mayor intrusión:

- **Opción A (recomendada primero, cero cambio de esquema)**: script de laboratorio `eval/estudio-latencia.js` que ejecuta el pipeline v2 sobre las 28 facturas con `performance.now()` alrededor de cada etapa, N repeticiones, y emite tabla p50/p95/max por etapa y por motor. No toca producción ni el esquema. Corre bajo demanda. Coste: 28 × nº motores × N llamadas reales (con la pila nueva, ~$0.005/llamada → una pasada completa ≈ $0.5, dentro del techo autorizado).
- **Opción B (para producción, después)**: columna aditiva `tiempos_etapa JSONB` en `extracciones_v2` (migración con rollback, patrón de la Fase 8) que persiste el desglose de cada factura real en sombra. Da datos continuos, no de laboratorio. Requiere aprobación de despliegue.

### 3.2 Frontend + red (E1, E2, E12) — lo que el backend NUNCA ve
- Instrumentar `app.js` con marcas `performance.mark()` en: inicio de captura, fin de compresión, inicio de subida (fetch), primer byte de respuesta, render del modal.
- Enviar esas marcas como cabecera o beacon para correlacionarlas con el `upload_id`.
- **Medición en dispositivo real obligatoria** (E2 depende del móvil y la red del cliente): con throttling de red (DevTools: 4G rápido / 4G lento / 3G) sobre una foto de tamaño real. Esta parte **necesita a Julio o un dispositivo de prueba** — no es simulable desde el servidor.

---

## 4. Metodología de medición

1. **Dataset**: las 28 facturas reales (todo lo que hay). Para significancia estadística de la parte backend, N=5 repeticiones por factura (las llamadas OCR varían por carga del proveedor).
2. **Pila bajo estudio**: la nueva configurable. Matriz mínima:
   - base `[gemini_flash, mistral]` + árbitro `openai`, `variantes=off`.
   - misma + `variantes=on` (para aislar H3).
   - cada motor en solitario (para H6: latencia individual).
3. **Concurrencia**: medir a 1 y a 3 simultáneas (H4), que es el óptimo medido del sistema.
4. **Aislar los 429**: correr sin Azure (pila nueva) y, si se quiere cuantificar H2, una pasada con Azure F0 para comparar el peso de los reintentos.
5. **Registrar por etapa**: E3-E11 del backend + E1-E2-E12 del frontend en la sesión de dispositivo.

---

## 5. Entregable del estudio

Un informe `docs/ocr-v2/INFORME-LATENCIA-YYYY-MM-DD.md` con:
1. **Tabla foto→resultado**: p50/p95/max de cada etapa E1-E12, con su % del total.
2. **La etapa dominante identificada con números** (no "el OCR", sino "el OCR es X% y dentro de él el motor Y aporta Z ms").
3. **Latencia por motor**: gemini_flash vs mistral vs openai — permite elegir el mix por velocidad.
4. **Efecto de cada palanca** cuantificado: variantes on/off, concurrencia 1 vs 3, con/sin Azure.
5. **≥3 palancas concretas de reducción** con ahorro estimado (p.ej.: "quitar variantes ahorra ~N s y ~$M/factura sin perder calidad"; "servir E5 en async con spinner recorta el tiempo percibido a E2+render").
6. **Veredicto de diseño para el plan de activación**: ¿la pila nueva permite preview síncrono (<12 s) o hay que ir a UX asíncrona?

### Criterio de éxito del estudio
- Cada etapa E1-E12 tiene un número (p50/p95) o una razón documentada de por qué no se pudo medir.
- La suma de las etapas medidas explica ≥90% del total observado (si no, hay una etapa oculta que buscar).
- Se entregan las palancas priorizadas por (ahorro de latencia × facilidad).

---

## 6. Lo que este estudio necesita de Julio

1. **[BLOQUEA E1-E2-E12]** Una sesión de medición en un móvil real con la app, o autorización para usar un dispositivo de prueba. La subida de red móvil no es simulable desde el servidor y es probablemente una fracción grande del tiempo percibido.
2. **[BLOQUEA la pasada backend]** Visto bueno a gastar ~$0.5-2 en llamadas OCR reales para la matriz de medición (dentro del techo €500 ya autorizado, se confirma por transparencia).
3. Localización de las 28 imágenes persistentes (el volumen de eval) para la pasada de laboratorio — pendiente de verificar acceso.

---

## 7. Registro de ejecución

### 2026-07-29 — Plan creado
- Redactado el marco del estudio. Hallazgo de partida: `extracciones_v2` NO persiste tiempos por etapa (solo total 30 s media / 74 s máx, contaminado por 429 de Azure F0 y variante x2). Medición pendiente: exige instrumentación (Opción A script de laboratorio recomendada) + sesión en dispositivo real para E1-E2-E12.

---

*Documento vivo. La medición se ejecuta cuando se cierren los puntos de §6.*
