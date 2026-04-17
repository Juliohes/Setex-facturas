# Test Factura — Prueba End-to-End del Pipeline

Ejecuta una prueba completa del flujo de subida de facturas: desde la subida hasta la llegada a Google Drive y Sheets.

## Qué testear

$ARGUMENTS

Sin argumentos → test completo del pipeline con una imagen de prueba generada.

## PASO 1 — Verificar que el sistema está listo

```bash
# Contenedores
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml ps

# Redis OK
docker exec setex-redis redis-cli PING

# Backend responde
docker exec setex-backend wget -qO- http://localhost:3000/api/health 2>/dev/null
```

Si cualquier check falla → NO continuar con el test, resolver primero con `/fix-redis` o `/deploy`.

## PASO 2 — Obtener token de autenticación

```bash
# Login con las credenciales de test (pedir a Julio si no las conoces)
TOKEN=$(curl -s -X POST https://xanflatest.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"TU_EMAIL","password":"TU_PASS"}' | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token','ERROR:'+str(d)))" 2>/dev/null)
echo "Token: ${TOKEN:0:30}..."
```

Si no tienes credenciales → pide a Julio el email/contraseña de una cuenta de test.

## PASO 3 — Preparar imagen de prueba

Si no hay una factura real de test disponible:
```bash
# Crear una imagen de prueba mínima (texto de factura)
python3 - <<'EOF'
try:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new('RGB', (800, 600), color='white')
    draw = ImageDraw.Draw(img)
    draw.text((50,50), "FACTURA Nº 2024-TEST-001", fill='black')
    draw.text((50,100), "Fecha: 10/03/2026", fill='black')
    draw.text((50,150), "Proveedor: Empresa Test SL", fill='black')
    draw.text((50,200), "CIF: B12345678", fill='black')
    draw.text((50,250), "Base imponible: 1.000,00 EUR", fill='black')
    draw.text((50,300), "IVA 21%: 210,00 EUR", fill='black')
    draw.text((50,350), "TOTAL: 1.210,00 EUR", fill='black')
    img.save('/tmp/test-factura.jpg')
    print("Imagen creada en /tmp/test-factura.jpg")
except ImportError:
    print("PIL no disponible. Usa una imagen real.")
EOF
```

## PASO 4 — Subir la factura

```bash
RESPONSE=$(curl -s -X POST https://xanflatest.com/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@/tmp/test-factura.jpg')
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
```

Analiza la respuesta:
- `success: true` → OCR funcionó, factura en BD y en cola
- `duplicate` → ya existe esta combinación (nif+fecha+total) — es un warning, no error
- `missing_fields` → OCR no extrajo todos los campos requeridos
- `error` → problema grave, ver logs

## PASO 5 — Verificar procesamiento asíncrono

```bash
# Esperar 10s para que el worker procese
sleep 10

# Ver logs del worker
docker compose -f /opt/setex-captu-facture/app/docker-compose.yml logs --tail=30 backend 2>&1 | \
  grep -iE "worker|drive|sheets|job|completed|failed|n8n_sent"

# Verificar en BD
docker exec setex-postgres psql -U postgres -d facturas -c \
  "SELECT file_name, proveedor_nif, total_factura, n8n_sent, created_at
   FROM uploads ORDER BY created_at DESC LIMIT 3;"
```

## PASO 6 — Informe del test

Reporta:
- ✅/❌ OCR extrajo campos correctamente
- ✅/❌ Factura insertada en PostgreSQL
- ✅/❌ Job encolado en BullMQ
- ✅/❌ Worker procesó el job
- ✅/❌ Archivo subido a Google Drive
- ✅/❌ Fila añadida a Google Sheets
- Tiempo total de procesamiento
- Campos extraídos por OCR (nif, fecha, total, iva)

Si algún paso falla → analiza los logs y propón el fix.
