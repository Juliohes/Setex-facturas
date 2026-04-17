# OCR — Gestión del Motor OCR

Gestiona la configuración del sistema OCR multi-motor de SETEX.

## Qué hacer

$ARGUMENTS

Sin argumentos → muestra el estado actual y las opciones disponibles.

## Motores disponibles

| Motor | Estado | Velocidad | Coste | Notas |
|-------|--------|-----------|-------|-------|
| `openai` | ACTIVO (default) | 2-5s | ~$0.004/factura | GPT-4.1, 95%+ precisión |
| `azure` | LISTO (necesita creds) | 5-10s | $0.0015/factura | Sin alucinaciones, 65% más barato |
| `gemini` | DESACTIVADO | — | — | Falló quality test, no usar |

## Comandos de gestión

### Ver estado actual
```bash
cat /opt/setex-captu-facture/app/backend/src/config/features.json
```

### Cambiar motor (efecto INMEDIATO, sin rebuild)
Lee `features.json`, cambia `ocr_primary_engine` y guarda.
Opciones válidas: `"openai"` | `"azure"` | `"gemini"` (gemini desactivado, no usar)

### Activar/desactivar n8n vs Google APIs directo
Cambia `"use_n8n": false/true` en features.json.

### Test rápido del motor activo
```bash
# Verificar que el backend responde
docker exec setex-backend wget -qO- http://localhost:3000/api/health 2>/dev/null || echo "Backend no responde"

# Ver motor activo en logs recientes
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=50 backend 2>&1 | grep -iE "ocr|engine|openai|azure|gemini" | tail -10
```

## Si el usuario pide cambiar el motor

1. Lee el `features.json` actual
2. Valida que el motor solicitado es válido (`openai` o `azure`)
3. Advierte si pide `gemini` → estaba desactivado por alucinaciones en producción
4. Modifica SOLO el campo `ocr_primary_engine` en features.json
5. Confirma que el cambio fue guardado correctamente
6. Recuerda que el cambio es INMEDIATO (volume-mounted, no requiere rebuild)

## Si el usuario quiere activar Azure DI

Necesita configurar primero:
- `AZURE_DI_ENDPOINT` → en secrets o .env del backend
- `AZURE_DI_KEY` → en secrets del Docker

Verificar que `azure.js` tiene configuradas las variables de entorno correctas.
Advertir: Azure DI no extrae IRPF (impuesto español adicional) — tenerlo en cuenta.

## Recomendación de optimización

Si el volumen de facturas crece más de 500/mes → evaluar Azure DI como primario:
- 65% más barato que GPT-4.1
- Sin riesgo de alucinaciones (modelo especializado en documentos)
- Desventaja: no extrae IRPF, que GPT sí puede extraer con el prompt correcto
