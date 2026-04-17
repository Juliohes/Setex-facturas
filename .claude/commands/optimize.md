# Optimize — Análisis y Optimización del Sistema

Analiza el sistema en profundidad y busca la mejor manera de hacer lo que ya existe.
No solo que funcione — que sea óptimo, eficiente y limpio.

## Qué optimizar

$ARGUMENTS

Sin argumentos → análisis completo de todo el sistema.

## Dimensiones de optimización

### 1. Rendimiento
- ¿Cuál es el bottleneck actual? (Stress test: Sharp con 0.5 CPU)
- ¿Qué endpoints tienen mayor latencia?
- ¿Hay queries PostgreSQL sin índices?
- ¿Redis se usa eficientemente?
- ¿Las imágenes se optimizan correctamente antes del OCR?

### 2. Coste
- Motor OCR actual: GPT-4.1 ~$0.004/factura
- Azure DI alternativa: $0.0015/factura (65% más barato)
- ¿A qué volumen mensual justifica el cambio?
- ¿Hay llamadas API innecesarias o redundantes?

### 3. Fiabilidad
- ¿Qué pasa si Redis cae? (actual: facturas se pierden de la cola)
- ¿Qué pasa si Google Drive falla? (actual: job falla, reintenta 3x)
- ¿Hay single points of failure?
- ¿Los timeouts están bien configurados?

### 4. Seguridad
- Revisar los puntos pendientes del `docs/INFORME_SEGURIDAD.md`
- CSRF middleware: ¿implementado?
- JWT en httpOnly cookies: ¿migrado desde localStorage?
- Redis password: ¿configurado?

### 5. Mantenibilidad
- ¿Hay código duplicado entre motores OCR?
- ¿Los logs son suficientemente descriptivos para debugging?
- ¿Las variables de configuración están bien documentadas?
- ¿Hay dead code? (n8nWorker.js sin usar, paddleocr.js sin integrar)

### 6. Escalabilidad
- Límite actual: x3 concurrencia (100% éxito), x5 empieza a fallar
- Fix conocido: subir CPU de backend de 0.5 a 1.0
- ¿Cuántos usuarios simultáneos puede manejar?
- ¿Qué hay que cambiar para pasar de 100 a 1.000 facturas/día?

## Proceso de análisis

1. Lee los archivos relevantes al área solicitada
2. Investiga si existe una solución mejor (npm packages, patrones de diseño, config)
3. Compara la solución actual vs la mejor alternativa
4. Propón cambios concretos con impacto esperado cuantificado
5. Ordena las mejoras por ratio impacto/esfuerzo

## Regla de este proyecto

Una mejora que funciona y que el usuario puede verificar en 10 minutos vale más
que una mejora arquitectural que tarda 3 días. Priorizar quick wins con alto impacto.

## Output esperado

Para cada área analizada:
```
ÁREA: [nombre]
Estado actual: [descripción breve]
Problema: [qué está subóptimo y por qué]
Solución propuesta: [qué cambiar exactamente]
Impacto esperado: [mejora cuantificada si es posible]
Esfuerzo: [bajo/medio/alto]
Riesgo: [bajo/medio/alto]
```
