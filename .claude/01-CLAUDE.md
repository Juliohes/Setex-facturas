# CLAUDE.md — Setex-facturas · Reglas permanentes

Rigen TODAS las sesiones de Claude Code en este repo. Prevalecen sobre cualquier prompt salvo aprobación literal de Julio.

## Contexto
App REAL en PRODUCCIÓN (uso diario) que extrae campos de facturas españolas (NIF/CIF ambas partes, número, fecha, importes, IVA por tramos, total) desde fotos y PDF. Se evoluciona a pipeline por capas en la rama `feature/ocr-pipeline-v2`, tras feature flags, sin interrumpir nada. La verdad del proyecto es el dataset de facturas REALES exportadas de producción con ground truth VERIFICADO POR HUMANO (los resultados históricos de v1 solo pre-rellenan, nunca son verdad). La verificación en producción se hace por REPLAY de esas facturas (modo `replay`, solo-lectura respecto a v1), no esperando tráfico nuevo.

## Reglas inviolables
1. **PROD ES SAGRADO.** Solo se trabaja en `feature/ocr-pipeline-v2`. Nada llega a producción sin aprobación explícita de Julio.
2. **TODO TRAS FLAGS.** `OCR_PIPELINE_V2=false` por defecto. v1 sigue siendo ruta por defecto y fallback automático si v2 lanza cualquier excepción.
3. **CONTRATOS INTOCABLES.** No modificar firma/ruta/esquema de endpoints existentes. Solo añadir campos opcionales o endpoints `/v2/...`.
4. **BD SOLO ADITIVA.** Solo añadir tablas o columnas nullable/default. Prohibido renombrar, borrar, cambiar tipos. Toda migración con script de rollback.
5. **NO BORRAR CÓDIGO.** Lo viejo se marca `// DEPRECATED (fecha, motivo)`.
6. **SECRETOS.** Jamás hardcodear claves; nuevas variables documentadas en `.env.example` sin valores. Prohibido leer `.env` reales. Ningún log imprime claves ni facturas completas.
7. **ERRORES JAMÁS SILENCIADOS.** Prohibido catch sin registro. Todo fallo externo se loguea con contexto (servicio, document_id, tipo) y se refleja en el resultado. Aplica desde el primer commit.
8. **ANTI-ALUCINACIÓN.** Campo no legible = `null` + estado. Estados de campo: `legible | ambiguo | ilegible | ausente`. PROHIBIDA la confianza autodeclarada por LLM (no calibrada); numérica solo la nativa de Azure DI (metadato) y la derivada de acuerdo+validaciones.
9. **CORRECCIÓN LIMITADA.** La resolución aritmética solo sobrescribe campos `ambiguo`/`ilegible`. Un `legible` que no cuadra va a revisión humana, jamás se sobreescribe.
10. **GDPR.** Solo proveedores ya configurados (Azure, Google/Gemini, OpenAI) en regiones UE donde la configuración lo permita. Preferencia para la vía OpenAI: endpoint Azure OpenAI UE vía `OPENAI_BASE_URL`. Ningún servicio nuevo sin aprobación.
11. **COMPATIBILIDAD ANTES QUE PREFERENCIA.** Dependencias nuevas verificadas contra el entorno real (runtime, Docker, CPU-only, RAM); si no viable, alternativa designada + pros/contras.
12. **PREGUNTAR SOLO LO NO DEDUCIBLE.** Técnico dentro de reglas: decidir y documentar. Negocio o riesgo a una regla: PARAR y preguntar.

## Convenciones
- Commits `feat|fix|test|docs(ocr-v2/diaN): ...`, atómicos y revertibles. Tag al cerrar día: `ocr-v2-diaN-done`.
- Nada se cierra sin sus tests en verde Y la regresión en verde. Desde que existe baseline (`eval/resultados/baseline.json`): toda entrega ≥ baseline o se revierte.
- Código completo; comentarios en español donde la lógica no sea obvia (validadores y árbitro: obligatorio).
- Cierre de día: mini-informe `docs/ocr-v2/INFORME-DIA-N.md` (decisiones, alternativas aplicadas, deuda) y DETENERSE.
- Al iniciar sesión: leer `docs/INFORME-AUDITORIA-OCR.md` y el último informe de día. El repo es la memoria, no la conversación.
