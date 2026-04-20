---
name: Bug report
about: Reportar un fallo del sistema en producción o staging
title: 'bug: '
labels: bug
---

## Resumen

<!-- Una frase. Qué falla. -->

## Entorno

- [ ] Producción (setex-facturas.es)
- [ ] Staging (staging.setex-facturas.es)
- [ ] Local

Versión del navegador/dispositivo:

## Pasos para reproducir

1.
2.
3.

## Comportamiento esperado

## Comportamiento observado

## Logs / capturas

<!-- Si es backend: `docker compose logs backend --tail 100`
     Si es frontend: consola del navegador (F12)
     Si es OCR: salida del smoke test -->

```
<pegar logs aquí>
```

## Severidad

- [ ] 🚨 Crítico — sitio caído o pérdida de datos
- [ ] ⚠️ Alto — funcionalidad principal rota, hay workaround
- [ ] 💡 Medio — funcionalidad secundaria afectada
- [ ] 📝 Bajo — cosmético o mejora

## Contexto adicional

<!-- Cualquier info que ayude a entender el bug. ¿Cuándo empezó? ¿Tras qué cambio? -->
