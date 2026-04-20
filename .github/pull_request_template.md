## Resumen

<!-- 1-3 líneas explicando QUÉ y POR QUÉ. El cómo está en el diff. -->

## Tipo

- [ ] feat (funcionalidad nueva)
- [ ] fix (corrección de bug)
- [ ] chore (build, dependencias, limpieza)
- [ ] docs (sólo documentación)
- [ ] refactor (sin cambio funcional)
- [ ] perf (optimización)
- [ ] ci (pipelines)

## Cambios

<!-- Lista de cambios principales con fichero afectado. -->

-

## Test plan

- [ ] Cambios validados localmente o en staging
- [ ] Sin regresiones obvias en flujo normal (login + upload + admin)
- [ ] Smoke test OCR sigue OK (`node scripts/smoke-test-ocr.js`)
- [ ] Cambios en backend → `npm audit --omit=dev` sigue sin vulnerabilidades
- [ ] Cambios en frontend → cache-buster actualizado

## Despliegue

<!-- Marca lo que aplique -->

- [ ] No requiere acción especial — `docker compose restart` suficiente
- [ ] Requiere `docker compose build backend` antes del restart
- [ ] Requiere `docker compose build frontend` antes del restart
- [ ] Cambios en `docker-compose.yml` o secretos — coordinar ventana
- [ ] Cambios en BD (migración) — backup pre-despliegue obligatorio

## Riesgos identificados

<!-- Si tiene blast radius medio o alto, qué podría romperse y cómo se revierte. -->

## Checklist pre-merge

- [ ] PR base correcto (develop para features, main solo para hotfix o releases)
- [ ] Conflictos resueltos
- [ ] Commits con mensajes en formato Conventional Commits
- [ ] CI verde
- [ ] Sin secretos hardcoded en el diff
- [ ] Documentación actualizada si aplica
