FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup src/ ./src/
COPY --chown=appuser:appgroup eval/ ./eval/
RUN mkdir -p /app/uploads /app/logs /app/eval/resultados /app/tesseract-data
# Gap "aprendizaje continuo" (2026-07-28): descarga el paquete de idioma
# español de Tesseract UNA VEZ en build time. Nunca en producción — evita
# depender de red en tiempo de ejecución y evita re-descargarlo en cada
# arranque del contenedor (TESSERACT_CACHE_PATH en src/ocr/tesseract.js
# apunta a esta misma ruta).
RUN node -e "const T=require('tesseract.js'); (async()=>{const w=await T.createWorker('spa',1,{cachePath:'/app/tesseract-data'}); await w.terminate();})()"
RUN chown -R appuser:appgroup /app/uploads /app/logs /app/eval /app/tesseract-data
USER appuser
EXPOSE 3000
# Healthcheck endurecido (FASE 1B Etapa 3) — apunta a /api/internal/check-access
# en lugar de /health trivial. Razón: detecta el incidente Round 16 (2026-04-22)
# automáticamente. Si la ruta crítica de auth_request devuelve 404 (no portada
# en el v3), el container se marca unhealthy y Docker lo reinicia.
# Códigos válidos:
#   200 = ruta responde y horario permitido        → healthy
#   403 = ruta responde y dentro de bloqueo 00-06  → healthy (comportamiento esperado)
#   *   = cualquier otro (incluido 404, 5xx, conn refused, timeout) → unhealthy
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/internal/check-access', r => process.exit([200,403].includes(r.statusCode) ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["node", "src/server.js"]
