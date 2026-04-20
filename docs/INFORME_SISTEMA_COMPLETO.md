# SETEX Captura de Facturas — Informe Completo del Sistema
## setex-facturas.es · Estado del producto · Actualizado: 2026-04-10

---

## 1. QUÉ ES ESTE SISTEMA

SETEX es una **asesoría contable y fiscal** que gestiona la administración de múltiples empresas clientes (pymes y autónomos). Esas empresas emiten facturas a sus propios clientes y las envían a SETEX para su gestión: contabilidad, impuestos trimestrales, relación con Hacienda, etc.

Este sistema es una **aplicación web progresiva (PWA) para captura móvil de facturas**, diseñada para que los clientes de SETEX puedan fotografiar o subir sus facturas desde el móvil. El sistema extrae automáticamente los datos fiscales mediante OCR con inteligencia artificial, los valida, los muestra para confirmación del usuario, y los envía a Google Drive y Google Sheets del equipo contable de SETEX.

**El flujo en una frase:** El cliente de SETEX saca una foto a su factura → la IA lee los datos → el usuario los confirma → la factura llega automáticamente al sistema contable de SETEX.

**Contexto multicliente importante:** El sistema está diseñado para una asesoría con múltiples clientes empresariales simultáneos. Cada usuario representa a una empresa distinta. Los datos se aíslan por usuario para evitar contaminación cruzada entre clientes.

---

## 2. ARQUITECTURA TÉCNICA

### Stack completo
| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5 + CSS3 + Vanilla JavaScript (sin frameworks) |
| Backend | Node.js 20 + Express 4 |
| Base de datos | PostgreSQL 15 |
| Cola asíncrona | BullMQ sobre Redis 7 |
| OCR primario | OpenAI GPT-4.1 Vision (activo) |
| OCR alternativo | Azure Document Intelligence prebuilt-invoice (listo, pendiente credenciales) |
| Almacenamiento facturas | Google Drive (API directa, Service Account) |
| Registro contable | Google Sheets (API directa, 16 columnas) |
| Infraestructura | Docker Compose, 4 contenedores |
| Proxy/HTTPS | Traefik + Let's Encrypt (certificado automático) |
| Servidor | VPS Ubuntu — Hostinger |
| Dominio | setex-facturas.es (definitivo desde 2026-04-10) |

### Infraestructura Docker
```
setex-postgres   postgres:15-alpine   0.5 CPU  512MB   Base de datos principal
setex-backend    Node.js 20           0.5 CPU  512MB   API + OCR + workers
setex-redis      redis:7-alpine       0.25 CPU 192MB   Cola BullMQ + previews
setex-frontend   Nginx                0.25 CPU 128MB   Archivos estáticos
n8n-traefik-1    traefik:latest                        HTTPS + routing
```

### Red
Todos los contenedores en la red Docker `n8n_default`. Traefik enruta el tráfico HTTPS externo al frontend (puerto 80 interno), que hace proxy al backend en `/api/*`.

### Secretos
Todos los secretos se almacenan en `/opt/setex-captu-facture/secrets/` y se montan como Docker secrets en `/run/secrets/` dentro del contenedor. **Nunca en variables de entorno ni en código.**
- `jwt_secret.txt` — firma de tokens JWT
- `postgres_password.txt` — contraseña PostgreSQL
- `openai_api_key.txt` — clave OpenAI GPT-4.1
- `azure_di_key.txt` + `azure_di_endpoint.txt` — Azure DI (pendiente activación)
- `google_sa_key.json` — Service Account Google (Drive + Sheets)
- `google_oauth2.json` — tokens OAuth2 Google persistidos en BD
- `n8n_api_key.txt` — clave n8n (modo webhook, actualmente desactivado)
- `gemini_api_key.txt` — Gemini (desactivado)

---

## 3. MAPA DE ARCHIVOS CRÍTICOS

```
/opt/setex-captu-facture/
├── app/
│   ├── backend/src/
│   │   ├── server.js                    ← CORE backend (~1000 líneas)
│   │   ├── config/
│   │   │   ├── features.json            ← TOGGLES EN CALIENTE (sin rebuild)
│   │   │   └── index.js                 ← loader con defaults seguros
│   │   ├── ocr/
│   │   │   ├── index.js                 ← orquestador multi-motor
│   │   │   ├── openai.js                ← GPT-4.1 ACTIVO (extracción completa + CIF)
│   │   │   ├── azure.js                 ← Azure DI LISTO (pendiente credenciales)
│   │   │   ├── gemini.js                ← DESACTIVADO
│   │   │   ├── paddleocr.js             ← local, NO integrado (sin uso)
│   │   │   └── validateCIF.js           ← validador anti-alucinaciones + dígito control
│   │   ├── services/
│   │   │   ├── googleAuth.js            ← OAuth2 con refresh_token persistido en BD
│   │   │   ├── googleDrive.js           ← upload streaming
│   │   │   ├── googleSheets.js          ← append 16 columnas
│   │   │   ├── formatters.js            ← formato español (ES locale)
│   │   │   └── viesValidator.js         ← validación VIES UE (no bloqueante)
│   │   └── queue/
│   │       ├── index.js                 ← BullMQ Queue init
│   │       └── invoiceWorker.js         ← worker dual-mode (Drive/Sheets o n8n)
│   ├── frontend/src/
│   │   ├── app.js                       ← TODO el JS frontend
│   │   ├── index.html                   ← HTML completo con modal de confirmación
│   │   └── styles.css                   ← CSS con fixes iOS Safari / Android Chrome
│   └── docker-compose.yml               ← 4 servicios + traefik
├── secrets/                             ← credenciales (fuera del contenedor)
├── data/
│   ├── postgres/                        ← volumen PostgreSQL persistente
│   ├── redis/                           ← volumen Redis persistente
│   └── uploads/                         ← facturas subidas (montado en /app/uploads)
├── logs/
│   └── backend/                         ← logs Winston (app.log + error.log)
└── docs/
    ├── INFORME_SISTEMA_COMPLETO.md      ← ESTE DOCUMENTO (actualizar siempre)
    ├── INFORME_SEGURIDAD.md             ← auditoría de seguridad
    ├── INFORME_CAPACIDAD_Y_RENDIMIENTO.md ← stress test y capacidad
    └── INFORME_VERIFACTU.md             ← análisis regulatorio Verifactu
```

---

## 4. ESQUEMA DE BASE DE DATOS

### Tabla `users`
Usuarios registrados del sistema.
```sql
id SERIAL PRIMARY KEY
email VARCHAR(255) UNIQUE NOT NULL
password_hash VARCHAR(255) NOT NULL        -- bcrypt cost 12
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

### Tabla `uploads`
Registro de todas las facturas procesadas.
```sql
id SERIAL PRIMARY KEY
user_id INTEGER REFERENCES users(id)
filename VARCHAR(255) NOT NULL             -- formato: usuario_YYYYMMDD_HHMMSSmmm_HEX.ext
mimetype VARCHAR(100) NOT NULL
size_bytes INTEGER NOT NULL
uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
n8n_sent BOOLEAN DEFAULT false             -- si ya fue enviada a Drive/Sheets
proveedor_nif VARCHAR(20)                  -- CIF/NIF confirmado por el usuario
fecha_emision VARCHAR(20)                  -- formato DD/MM/AAAA normalizado
total_factura VARCHAR(30)                  -- importe normalizado (ej: "141.32")
numero_factura VARCHAR(50)                 -- número de factura (opcional)

-- Índice único: protección contra duplicados a nivel BD
UNIQUE INDEX idx_uploads_unique_invoice ON uploads(user_id, proveedor_nif, fecha_emision, total_factura)
  WHERE proveedor_nif IS NOT NULL AND fecha_emision IS NOT NULL AND total_factura IS NOT NULL
```

### Tabla `known_cifs`
Caché de CIF/NIF confirmados por usuario. Evita re-extraer el CIF de proveedores ya conocidos.
```sql
id SERIAL PRIMARY KEY
user_id INTEGER REFERENCES users(id)       -- AISLADO POR USUARIO (arquitectura multicliente)
proveedor_nombre_norm TEXT NOT NULL        -- nombre normalizado: UPPERCASE, sin tildes, solo alfanum
proveedor_nif TEXT NOT NULL               -- CIF/NIF confirmado por el usuario
confirmations INT DEFAULT 1               -- veces que se ha confirmado este CIF
last_seen TIMESTAMP DEFAULT NOW()
created_at TIMESTAMP DEFAULT NOW()

-- Índice único POR USUARIO: evita contaminación cruzada entre clientes de SETEX
UNIQUE INDEX known_cifs_user_nombre_key ON known_cifs(user_id, proveedor_nombre_norm)
  WHERE user_id IS NOT NULL
```

**Diseño arquitectural importante:** La clave `(user_id, proveedor_nombre_norm)` garantiza que si el cliente A de SETEX tiene un proveedor "Suministros XYZ" con CIF B11111111, y el cliente B tiene otro proveedor diferente también llamado "Suministros XYZ" con CIF B22222222, los datos NO se mezclan. Cada usuario ve solo su caché propia.

### Tabla `google_tokens`
Tokens OAuth2 de Google persistidos en BD para renovación automática.
```sql
id INTEGER PRIMARY KEY DEFAULT 1
refresh_token TEXT
access_token TEXT
expiry_date BIGINT
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```
Los tokens se renuevan automáticamente cada 45 minutos vía `setInterval`. Nunca expiran mientras el servidor esté activo.

### Tabla `allowed_emails`
Whitelist de emails autorizados para registrarse. El registro está cerrado — solo los emails en esta tabla pueden crear cuenta.
```sql
id SERIAL PRIMARY KEY
email VARCHAR(255) UNIQUE NOT NULL
added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
notes VARCHAR(500)
```

### Tabla `audit_logs`
Registro de auditoría completo de acciones del sistema.
```sql
id SERIAL PRIMARY KEY
user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
action VARCHAR(100) NOT NULL              -- LOGIN_SUCCESS, UPLOAD_SUCCESS, REGISTER_BLOCKED, etc.
details JSONB                             -- datos adicionales de la acción
ip_address VARCHAR(45)
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

### Tabla `password_reset_tokens`
Tokens de recuperación de contraseña (expiración 1h, uso único).
```sql
id SERIAL PRIMARY KEY
user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
token_hash VARCHAR(255) NOT NULL          -- SHA-256 del token enviado por email
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
expires_at TIMESTAMP NOT NULL
used BOOLEAN DEFAULT false
```

---

## 5. FLUJO COMPLETO DE UNA FACTURA (ACTUALIZADO)

El flujo anterior era de un paso (subir → guardar). El flujo actual es de **dos pasos con confirmación humana**:

```
PASO 1 — Captura
├── Usuario: saca foto con cámara nativa o sube archivo (JPEG/PNG/PDF)
├── processFile(): renombra con formato usuario_YYYYMMDD_HHMMSS.ext
└── Botón "Enviar" habilitado

PASO 2 — POST /api/upload-preview (OCR + Análisis)
├── Multer: guarda archivo en /app/uploads/
├── Validación magic bytes (anti-spoofing MIME)
├── Promise.all paralelo:
│   ├── extractInvoiceOCR() → GPT-4.1 lectura completa (15 campos)
│   └── extractCIFOnlyOCR() → GPT-4.1 lectura enfocada CIF
│       ├── Recorta top 45% de la imagen (cabecera = zona del emisor)
│       ├── Schema {"chars": ["B","3","9",...]} → fuerza lectura carácter a carácter
│       └── Elimina transposiciones de dígitos (error más frecuente del OCR)
├── Reconciliación CIF:
│   ├── Si ambas lecturas coinciden → CIF confirmado ✓✓
│   ├── Si difieren → dígito de control AEAT como árbitro
│   └── Si ninguna pasa el control → marcado como "incierto" (amarillo en modal)
├── Validación anti-alucinación (blacklist de CIFs inventados por IA)
├── Lookup en known_cifs (WHERE user_id = X AND nombre = Y)
│   └── Si existe → CIF cacheado pre-confirmado (badge "Proveedor conocido")
├── Consulta VIES async (registro fiscal europeo, sin bloquear respuesta)
├── Guardar preview en Redis: setex("preview:{UUID}", 1800s, datos)
└── Respuesta → {preview_id, campos, cif_confident, known_provider, vies_valid}

PASO 3 — Modal de Confirmación (frontend)
├── CIF en verde (borde #68d391) si dígito control correcto + alta confianza
├── CIF en amarillo (borde #d69e2e) si OCR incierto → usuario DEBE revisar
├── Badge "✓ Proveedor conocido" si el CIF viene de la caché
├── Estado VIES actualizado asincrónicamente (consulta API UE)
├── Validación en tiempo real al escribir: NIF / NIE / CIF con algoritmos exactos
│   ├── NIF (12345678Z): módulo 23, tabla TRWAGMYFPDXBNJZSQVHLCKE
│   ├── NIE (X1234567Z): mismo algoritmo, X→0 Y→1 Z→2
│   └── CIF (B12345678): posiciones impares doblar, pares sumar, dígito control
├── Campos editables: CIF/NIF, Fecha, Total, Nº Factura
└── Botones: [✓ Confirmar y guardar] / [✗ Repetir foto]

PASO 4 — POST /api/upload-confirm (Guardado)
├── Recuperar datos de Redis por preview_id
├── Verificar que preview_id pertenece al usuario autenticado
├── Usar valores confirmados/corregidos por el usuario
├── Normalizar fecha (DD/MM/AAAA) y total (decimal punto)
├── Detección de duplicados: SELECT WHERE user_id + nif + fecha + total
├── INSERT en uploads (con numero_factura)
├── UPDATE known_cifs: upsert con (user_id, nombre_norm) → nif confirmado
├── DELETE preview de Redis
├── Respuesta inmediata → "Factura guardada correctamente ✓"
└── BullMQ.add() → worker asíncrono (tras responder al usuario):
    ├── Google Drive: upload del archivo original
    └── Google Sheets: append fila con 16 campos contables
```

---

## 6. SISTEMA ANTI-FALLO DE CIF/NIF (4 CAPAS)

El CIF/NIF del proveedor es el campo más crítico del sistema: sin él la factura no puede deduplicarse ni contabilizarse correctamente. Se implementaron 4 capas independientes:

### Capa 1 — Doble pasada OCR paralela
- **Lectura completa**: GPT-4.1 analiza la imagen entera, extrae 15 campos
- **Lectura enfocada**: segunda llamada paralela, recorta top 45% de la imagen (cabecera del emisor), usa schema `{"chars": ["B","3","9","7","9","3","2","9","4"]}` → el modelo lee carácter a carácter, eliminando transposiciones de dígitos similares (3/8/9/7)
- **Sin coste extra de tiempo**: ambas llamadas son `Promise.all` simultáneas

### Capa 2 — Dígito de control AEAT como árbitro
- Si las dos lecturas difieren, el algoritmo oficial de la AEAT determina cuál es correcta
- Algoritmo: posiciones impares (índices 0,2,4,6) × 2, posiciones pares (1,3,5) suma directa
- Si ninguna pasa → CIF marcado como "incierto" (amarillo en modal)
- Implementado tanto en backend (`validateCIF.js`) como en frontend (validación en tiempo real)

### Capa 3 — Caché `known_cifs` por usuario
- Primera vez que se procesa una factura de "ENI PLENITUDE IBERIA SL" → CIF B39793294 confirmado → guardado en BD
- Segunda factura del mismo proveedor → CIF pre-rellenado directamente desde BD, sin OCR del CIF
- Aislado por `user_id` para evitar contaminación entre empresas cliente de SETEX
- Badge visual "✓ Proveedor conocido" en el modal

### Capa 4 — Validación VIES (Registro Fiscal Europeo)
- API gratuita de la UE: `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/ES/vat/{CIF}`
- Solo aplica a CIFs de entidades (no a NIFs personales — los autónomos no están en VIES)
- No bloqueante: el modal abre inmediatamente, VIES se consulta async y actualiza el badge
- Resultado: "✓ Registrado en VIES · ENI PLENITUDE IBERIA SL" o "⚠ No encontrado en VIES"
- Si VIES falla/timeout → silencio, nunca bloquea el flujo

### Capa 5 (implícita) — Confirmación humana SIEMPRE
- El usuario SIEMPRE ve y puede editar el CIF antes de guardar
- Es el único sistema 100% infalible: si todo lo demás falla, el humano corrige
- Decisión de diseño: preferible 5 segundos de revisión a una factura con CIF incorrecto

---

## 7. AUTENTICACIÓN Y SEGURIDAD

### Autenticación
- **JWT** con secret leído de Docker secret al arrancar (cacheado en memoria, nunca en disco)
- Expiración: 7 días
- El frontend valida la expiración localmente (`isTokenValid()`) antes de cada operación
- Si el token expira durante el uso → `forceLogin()` automático

### Registro
- **Whitelist obligatoria**: solo emails en la tabla `allowed_emails` pueden registrarse
- Contraseña mínima 8 caracteres, bcrypt cost 12
- Registro cerrado al público — gestionado por el administrador con script CLI

### Rate Limiting
- Endpoints de auth: 10 requests / 15 minutos por IP
- Upload preview: 30 requests / 15 minutos por IP (configurable via `UPLOAD_RATE_LIMIT` env)
- Upload confirm: 60 requests / 15 minutos por IP

### Seguridad de archivos
- Validación de magic bytes (JPEG: FFD8FF, PNG: 89504E47, PDF: 25504446)
- Evita subida de archivos maliciosos disfrazados de imágenes
- Archivos rechazados → eliminados del disco inmediatamente

### Cabeceras HTTP (Helmet + Nginx)
- Content-Security-Policy, HSTS (2 años), X-Frame-Options: DENY
- Referrer-Policy, X-Content-Type-Options, Permissions-Policy
- CORS restringido a `https://setex-facturas.es`

### Limpieza automática de archivos huérfanos
- Job `setInterval` cada hora en el backend
- Elimina archivos de `/app/uploads/` con más de 2 horas de antigüedad que NO tienen registro en la BD
- Casos cubiertos: usuario saca foto, ve el modal, cierra el navegador sin confirmar

### Auditoría
- Tabla `audit_logs` registra: LOGIN_SUCCESS, LOGIN_FAILED, REGISTER_BLOCKED, UPLOAD_SUCCESS, UPLOAD_BLOCKED, PASSWORD_RESET, OCR_ENGINE_CHANGED
- IP address, user_id, timestamp, detalles JSON en cada registro

---

## 8. GOOGLE INTEGRATION (DRIVE + SHEETS)

### Autenticación Google
- **Service Account** para Drive y Sheets (permisos permanentes, sin expiración)
- **OAuth2 con refresh_token** persistido en tabla `google_tokens` de PostgreSQL
- Auto-renovación del access_token cada 45 minutos vía `setInterval`
- Los tokens nunca expiran mientras el servidor esté activo (problema histórico de la app en "modo Testing" resuelto — app publicada)

### Google Drive
- Carpeta destino: `1FtLHE4fph-ZzhD9yYueQSQc0dckQ9RLt` ("Test Gestión Facturas")
- Upload streaming del archivo original (no base64)
- Nombre de archivo preservado con formato `usuario_YYYYMMDD_HHMMSSmmm_HEX.ext`

### Google Sheets
- Spreadsheet: `1FTXsm1jWeUom4I8X4pBIWLWD2qawK8bT0q9TqPRqNDM`
- Sheet: "Facturas"
- 16 columnas: fecha subida, usuario, nombre archivo, proveedor nombre, proveedor NIF, receptor nombre, receptor NIF, base imponible, IVA%, cuota IVA, IRPF%, cuota IRPF, total, moneda, forma pago, ¿es factura válida?
- Formato español: fechas DD/MM/AAAA, números con coma decimal

### Modo n8n (alternativo, desactivado)
- Toggle `use_n8n: true` en `features.json` → envía webhook a n8n en lugar de Drive/Sheets directos
- Útil si se quieren automatizaciones adicionales en n8n
- Actualmente en `false` (modo Google APIs directas)

---

## 9. OCR — MOTORES DISPONIBLES

### Motor activo: OpenAI GPT-4.1 Vision
- Modelo: `gpt-4.1`
- Velocidad: 2-5 segundos por factura
- Precisión en campos de texto: ~95%
- Precisión en CIF/NIF (con sistema anti-fallo): ~99%+ (el 1% restante lo corrige el usuario en el modal)
- Optimización: imagen redimensionada a máx. 1536px, JPEG 85% (~300KB vs ~6MB original)
- Schema estricto `json_schema` con 15 campos (incluyendo `numero_factura` añadido)
- Sistema de prompts con instrucciones anti-alucinación explícitas

### Motor listo: Azure Document Intelligence
- Modelo: `prebuilt-invoice`
- Precisión CIF: ~98-99% (modelo entrenado específicamente para facturas)
- Sin alucinaciones (modelo discriminativo, no generativo)
- Coste: $0.0015/página (vs ~$0.004-0.009 GPT-4.1 con doble pasada)
- **Estado**: código completo en `azure.js`, credenciales pendientes
- **Activación**: añadir `azure_di_key.txt` + `azure_di_endpoint.txt` + cambiar `features.json` → restart (sin rebuild)

### Motor desactivado: Google Gemini
- Desactivado en producción — resultados sobreconfiados, falló test de calidad
- Código preservado en `gemini.js` para posibles pruebas futuras

### Cambio de motor en caliente
- Sin rebuild del contenedor: `features.json` está montado como volumen
- Endpoint admin: `POST /api/admin/ocr-engine` con `{"engine": "azure"}` o `{"engine": "openai"}`
- Solo admins (`juliohesuni@gmail.com`, `albertomurimarti@gmail.com`) pueden cambiarlo

---

## 10. PROCESAMIENTO ASÍNCRONO (BullMQ)

### Arquitectura de cola
- **Queue**: `n8n-send` en Redis
- **Concurrencia**: 2 workers simultáneos
- **Reintentos**: 3 intentos con backoff exponencial
- **Modo**: Google APIs directas (Drive + Sheets)

### Flujo del job
1. `/api/upload-confirm` responde al usuario → `n8nQueue.add()` (no espera)
2. Worker recoge el job de Redis
3. Sube archivo a Google Drive
4. Append fila en Google Sheets con 16 campos OCR
5. `UPDATE uploads SET n8n_sent = true`

### Resiliencia
- Si el worker falla 3 veces → job queda en "failed" en Redis para revisión manual
- Si Redis está caído → el upload-confirm falla explícitamente (no silencioso)
- Estado de jobs consultable con `docker exec setex-redis redis-cli KEYS "bull:*"`

---

## 11. FRONTEND — INTERFAZ MÓVIL

### Diseño
- PWA (Progressive Web App) — puede añadirse al escritorio del móvil
- Diseño mobile-first, optimizado para iOS Safari y Android Chrome
- Sin frameworks (Vanilla JS) → carga instantánea, sin dependencias npm en frontend
- Fixes específicos iOS Safari: `-webkit-overflow-scrolling: touch`, `env(safe-area-inset-bottom)`, `font-size: 16px` (evita zoom automático al enfocar inputs), `touch-action: manipulation` (elimina delay 300ms)

### Pantallas
1. **Login** — email + contraseña + "Iniciar sesión"
2. **Registro** — solo para emails en whitelist
3. **Recuperación de contraseña** — email → link con token 1h → nueva contraseña
4. **Pantalla principal** — dos botones: "📷 Capturar Foto" / "📄 Subir Archivo"
5. **Modal de confirmación** — revisión y edición de datos OCR antes de guardar
6. **Cámara personalizada** — overlay con guía visual (marco de encuadre), botón "Capturar"

### Cámara
- Intenta acceso a `mediaDevices.getUserMedia()` (cámara trasera, resolución 1920×1080)
- Si no está disponible → fallback al input nativo `capture="environment"`
- Overlay con guía de encuadre (esquinas blancas) para mejorar calidad de foto
- Foto capturada → blob JPEG 92% de calidad

### Nomenclatura de archivos
Formato: `usuario_YYYYMMDD_HHMMSS.ext`
- `usuario`: parte del email antes de @
- Timestamp con precisión de segundos
- Backend añade milisegundos + 3 bytes hex aleatorios (collision-proof en cargas concurrentes)

---

## 12. CONFIGURACIÓN (features.json)

Archivo montado como volumen → cambios con efecto **inmediato sin rebuild**.

```json
{
  "use_n8n": false,
  "google_drive_folder_id": "1FtLHE4fph-ZzhD9yYueQSQc0dckQ9RLt",
  "google_sheets_spreadsheet_id": "1FTXsm1jWeUom4I8X4pBIWLWD2qawK8bT0q9TqPRqNDM",
  "google_sheets_sheet_name": "Facturas",
  "ocr_enabled": true,
  "image_max_resolution": 1536,
  "image_jpeg_quality": 85,
  "ocr_primary_engine": "openai",
  "ocr_gemini_enabled": false,
  "ocr_retry_openai_on_invalid": false
}
```

---

## 13. RENDIMIENTO

Datos del stress test realizado el 2026-03-02:

| Concurrencia | Tasa de éxito | Facturas/min | Estado |
|:---:|:---:|:---:|:---|
| x1 | 100% | 15 | Referencia |
| x3 | **100%** | **58** | **ÓPTIMO** |
| x5 | 73% | 83 | Acceptable |
| x10 | 40% | 122 | Inestable |
| x15+ | 0% | — | Fallo total |

**Cuello de botella**: Sharp (resize de imagen) con límite de 0.5 CPU.
**Fix disponible**: subir CPU del backend a 1.0 en docker-compose → óptimo x5-x7.
**Capacidad actual**: 3.480 facturas/hora en condiciones óptimas (concurrencia x3).

---

## 14. COMANDOS OPERATIVOS

```bash
# Estado general del sistema
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Rebuild + redeploy backend (cuando cambia código fuente)
cd /opt/setex-captu-facture/app
docker compose build backend && docker compose stop backend && docker compose up -d backend

# Rebuild + redeploy frontend (cuando cambia HTML/CSS/JS)
docker compose build frontend && docker compose stop frontend && docker compose up -d frontend

# Solo restart (cuando cambian features.json o secrets — NO recarga env vars)
docker compose stop backend && docker compose up -d backend

# Logs en tiempo real
docker compose logs -f backend
docker compose logs -f frontend

# Estado de la cola BullMQ
docker exec setex-redis redis-cli KEYS "bull:*" | wc -l
docker exec setex-redis redis-cli LLEN bull:n8n-send:wait

# Facturas procesadas por estado
docker exec setex-postgres psql -U setex_user -d setex_db \
  -c "SELECT COUNT(*), n8n_sent FROM uploads GROUP BY n8n_sent;"

# Redis diagnóstico
docker exec setex-redis redis-cli INFO memory
docker exec setex-redis redis-cli CONFIG GET dir

# Gestión de whitelist de emails
/opt/setex-captu-facture/scripts/manage-whitelist.sh

# Ver proveedores conocidos (caché CIF)
docker exec setex-postgres psql -U setex_user -d setex_db \
  -c "SELECT u.email, k.proveedor_nombre_norm, k.proveedor_nif, k.confirmations FROM known_cifs k JOIN users u ON k.user_id = u.id ORDER BY k.confirmations DESC;"
```

---

## 15. ACTIVAR AZURE DOCUMENT INTELLIGENCE (cuando disponible)

Azure DI ofrece 98-99% de precisión en CIF sin necesidad de doble pasada, y es 4x más barato que GPT-4.1.

```bash
# 1. Escribir credenciales (Julio las obtiene de portal.azure.com)
echo "TU_CLAVE_AZURE" > /opt/setex-captu-facture/secrets/azure_di_key.txt
echo "https://TU_ENDPOINT.cognitiveservices.azure.com/" > /opt/setex-captu-facture/secrets/azure_di_endpoint.txt
chmod 644 /opt/setex-captu-facture/secrets/azure_di_key.txt
chmod 644 /opt/setex-captu-facture/secrets/azure_di_endpoint.txt

# 2. Cambiar motor en features.json (efecto inmediato, sin rebuild)
# Editar: "ocr_primary_engine": "azure"

# 3. Restart para recargar secrets
cd /opt/setex-captu-facture/app
docker compose stop backend && docker compose up -d backend
```

**Coste Azure DI**: F0 gratuito hasta 500 páginas/mes. S0: $0.0015/página. Para 1.000 facturas/mes = $1.50/mes (vs ~$9 con GPT-4.1 doble pasada).

---

## 16. PROBLEMAS CONOCIDOS Y ESTADO

| Problema | Severidad | Estado |
|----------|-----------|--------|
| Redis MISCONF disk write | CRÍTICO | **Monitorizar**: si Redis no puede escribir en disco, BullMQ falla. Fix: verificar espacio en `/opt/setex-captu-facture/data/redis/` |
| PaddleOCR instalado sin usar | MEDIO | Pendiente: 3GB en `/opt/setex-captu-facture/ocr-service/` — decisión: integrar o eliminar |
| Admin emails hardcoded | BAJO | `juliohesuni@gmail.com` y `albertomurimarti@gmail.com` en `server.js` — mover a BD o features.json en futuro |
| CSRF protection pendiente | BAJO | Middleware `csrf-csrf` documentado en INFORME_SEGURIDAD.md, pendiente implementar |
| JWT en localStorage | BAJO | Más seguro en httpOnly cookie — pendiente migración |

---

## 17. ROADMAP (PRÓXIMAS MEJORAS)

### Alta prioridad
- [ ] **Historial de facturas**: `GET /api/facturas` — tabla con facturas procesadas filtrable por fecha/proveedor/usuario
- [ ] **Dashboard de estado**: panel admin con cola BullMQ, jobs pendientes, errores, uso de Drive
- [ ] **Activar Azure DI**: cuando Julio consiga tarjeta física o PayPal para registro Azure

### Media prioridad
- [ ] **Exportar CSV/Excel**: descarga de facturas filtradas por período
- [ ] **Notificación de procesamiento**: push/email cuando la factura llega a Drive/Sheets
- [ ] **Reintento manual de jobs fallidos**: endpoint admin para reintentar desde el panel
- [ ] **Multi-empresa mejorado**: tabla `advisory_clients` para agrupar usuarios por empresa cliente de SETEX

### Baja prioridad
- [ ] **Eliminar PaddleOCR o integrarlo**: liberar 3GB de disco
- [ ] **Admin emails a BD**: sacar hardcoded de server.js
- [ ] **CSRF protection**: middleware csrf-csrf
- [ ] **httpOnly cookies**: migrar JWT de localStorage

---

## 18. HISTORIAL DE CAMBIOS

### 2026-04-19 — Fix crítico OCR OpenAI roto + mensaje rojo falso en CIF propio

**Bug crítico OCR (problema raíz, llevaba semanas sin detectar):**
- Logs: `[OCR] OpenAI FALLÓ: OpenAI HTTP 400: Invalid schema for response_format 'invoice_extraction': In context=('properties', 'lineas_iva'), 'oneOf' is not permitted` en TODAS las facturas procesadas hoy (21:51, 21:52, 21:56) y probablemente desde mucho antes
- Causa: OpenAI Structured Outputs (modo `strict: true`) eliminó el soporte de `oneOf`/`anyOf` dentro del schema. El sistema seguía funcionando porque Azure DI cubría el OCR como fallback, pero Azure no extrae NIFs en algunas facturas (`nif=null` consistente en los logs) → CIFs del proveedor y del cliente llegaban vacíos al modal de confirmación
- Fix en `app/backend/src/ocr/openai.js`:
  - `INVOICE_SCHEMA.lineas_iva`: reemplazado `oneOf: [{type:'null'}, {type:'array',...}]` por `type: ['array','null']` con `items` directo (nullable type-array sí está soportado en strict)
  - `extractCIFOnly` (segunda pasada CIF emisor): mismo cambio en `chars` — eliminados `oneOf` + `minItems`/`maxItems` (la longitud 9 ya se valida en JS)
- Test directo en contenedor con la imagen `info_20260419_215632792_bdab76.jpg` que Julio acababa de probar → OpenAI ahora extrae correctamente: `proveedor_nif=B42634044` (Murimarti), `receptor_nif=B04445841` (Proyecto Reguero S.L.U — el cliente), `total=8.744,68`. Antes devolvía nada por el HTTP 400

**Bug UX: mensaje rojo "Dígito de control incorrecto" sobre el propio CIF de empresa:**
- En `showConfirmModal` (`app/frontend/src/app.js`), tras pre-rellenar `confirm-nif` con `userCompanyNif` (factura emitida — emisor=nosotros), se llamaba `updateCIFStatus(nifInput.value)` que ejecuta `validateTaxIdClient`. El algoritmo de validación CIF español es estricto y algunos CIFs reales ya almacenados en BD (introducidos manualmente o sin validación) no pasan el dígito de control → el usuario veía mensaje rojo "✗ Dígito de control incorrecto" sobre su propio CIF que él sabe que es correcto
- Caso concreto detectado en BD: `B42634044` (Autoken / Murimarti, 3 cuentas usan este CIF). Algoritmo: dígitos 4263404 → suma=32 → control esperado='8', real='4' → falla
- Fix: nueva variable `nifIsFromOwnCompany = isVenta && userCompanyNif && nifInput.value === userCompanyNif`. Si true → estilo verde + mensaje "✓ CIF de tu empresa", **NO** se ejecuta `updateCIFStatus`. Si el usuario edita el campo, el listener `input` (línea ~1420) sí ejecuta validación normal sobre el nuevo valor

**Despliegue:**
- `docker cp openai.js → setex-backend:/app/src/ocr/openai.js` + `docker restart setex-backend` (sin downtime real, healthcheck pasa en ~30s)
- `docker cp app.js index.html → setex-frontend:/usr/share/nginx/html/` con cache-buster `app.js?v=20260419-003`
- Verificación: backend `Server running on port 3000`, OCR test directo OK con 5/5 campos extraídos; frontend con 4 ocurrencias de los identificadores nuevos en disco

**Cosas pendientes que han quedado expuestas (para próxima sesión):**
1. CIF inválido `B42634044` en 3 cuentas de BD (test@autoken.es, test1@autoken.es, info@murimarti.com) — el backend debería validar el CIF al registrar y rechazar si no pasa el dígito de control
2. La doble pasada CIF (`extractCIFOnly`) solo se aplica al EMISOR (recorta 65% superior). En facturas emitidas, el CIF del cliente queda solo bajo la pasada principal. Mejora futura: segunda pasada para el RECEPTOR cuando `invoice_type=venta`
3. Sin tests automatizados sobre el OCR — un cambio de schema en una API externa rompió producción de forma silenciosa porque Azure cubrió el agujero. Se necesita un smoke test diario que ejecute `extractInvoice` contra una imagen de muestra y alerte si OpenAI falla

### 2026-04-19 — UX captura: arreglo del "atrás" del navegador, "Repetir foto" → cámara directa, datos de empresa propia desde BD

Tres mejoras quirúrgicas en el flujo de captura/confirmación, todas en el frontend:

**1. Bug del botón "atrás" del navegador en el modal de confirmación:**
- `app/frontend/src/app.js`: el modal `#confirm-modal` no sincronizaba con `history`, así que pulsar "atrás" en el móvil/PC navegaba al historial real y sacaba al usuario fuera de la PWA
- Solución: al abrir el modal se hace `history.pushState({setexModal:'confirm'}, '')` (controlado por flag `_confirmHistoryActive` para no duplicar entradas). Listener global `popstate`: si se dispara con el modal visible → cierra modal + descarta preview/file/upload-btn y deja al usuario en la pantalla principal de captura (NO abre la cámara — UX distinta a "Repetir foto"). `closeConfirmModal()` ahora llama a `history.back()` para limpiar la entrada extra cuando se cierra por flujo normal (Confirmar / Repetir / éxito / duplicado / 401); el handler `popstate` ignora ese caso porque el modal ya está oculto

**2. Botón "✗ Repetir foto" ahora abre la cámara directamente:**
- Antes: el botón `#btn-cancel-invoice` solo llamaba a `closeConfirmModal()` y dejaba al usuario en la pantalla principal con el preview de la foto previa visible — había que pulsar "📷 Capturar Foto" otra vez
- Solución: nueva función `repetirFoto()` que cierra modal, descarta preview/file/upload-btn (`_resetCaptureUI()`) y llama directamente a `capturePhoto()` → `getUserMedia` → overlay de cámara con botón "Capturar". Listener del cancel button cambiado de `closeConfirmModal` a `repetirFoto` (línea 1363)

**3. Datos de la empresa propia (nuestra empresa) desde BD, no del OCR:**
- Petición funcional fundamental: en el modal de confirmación, los campos de "nuestra empresa" (RECEPTOR en compras, EMISOR en ventas) deben pre-rellenarse desde el perfil del usuario logueado (`userCompanyName`/`userCompanyNif` que ya se cargan al login desde `/me/settings`), NO desde lo que el OCR haya leído de la factura
- Cambio en 3 puntos del orden del operador `||` en `showConfirmModal()`:
  - Línea ~920 (venta, emisor=nosotros): `userCompanyName || campos.proveedor_nombre || ''`
  - Línea ~984-985 (compra, receptor=nosotros): `userCompanyName/Nif` primero, OCR como fallback
  - Línea ~992-993 (venta, NIF emisor=nosotros): `userCompanyNif` primero, OCR como fallback
- OCR queda como red de seguridad solo para casos edge (admin sin empresa propia, fallo del endpoint `/me/settings`). El campo sigue siendo editable por el usuario antes de confirmar
- Lógica intacta para: admin con empresa cliente seleccionada (sigue prioritario), receptor en venta = cliente externo (OCR, no es "nuestra empresa"), proveedor en compra = empresa externa (OCR)

**Despliegue sin downtime:**
- `docker cp app.js index.html → setex-frontend:/usr/share/nginx/html/` (nginx sirve estáticos desde disco, no requiere reload)
- Cache-buster `app.js?v=20260414-004` → `app.js?v=20260419-002` para forzar invalidación en navegadores
- Verificación: `curl https://setex-facturas.es/index.html` confirma cache-buster nuevo; `curl /app.js?v=20260419-002` → 200; las nuevas funciones (`repetirFoto`, `_confirmHistoryActive`, `setexModal`) presentes en producción
- No requiere rebuild ni `.env` (bug del `.env` de prod sigue pendiente, pero estos cambios no lo necesitan)

### 2026-04-19 — Defensa en profundidad: nginx captura códigos inesperados del auth_request

- `app/frontend/nginx.conf`: ampliado `error_page` en todas las `location` protegidas por `auth_request` para incluir **429/500/502/503/504** además de 401/403/404. Las cinco `location` afectadas (`/service-worker.js`, `\.(html|js|css)$`, `/api/`, `/`, `/admin-facturas.html`) mapean esos códigos a `@bloqueado` (404 neutro). En `/admin-facturas.html` se mantiene la regla `error_page 401 403 = @admin_login_redirect` para la UX de login, y los códigos nuevos van a `@bloqueado` — no se tolera un loop de redirección si el backend rasca
- Motivo: red de seguridad complementaria al fix del middleware auto-block. Si mañana cualquier middleware futuro (rate limiter por ruta, fail-secure BD → 503, timeouts 502/504) devuelve un código fuera de 200/401/403 en un subrequest, nginx lo capturará limpiamente en vez de emitir 500 opaco. Fallo transitorio del backend → usuario ve página de "no disponible", no un crash visible
- Despliegue sin downtime: `docker cp nginx.conf → setex-frontend` + `nginx -t` (OK) + `nginx -s reload`. Contenedor sigue healthy, sin reinicio
- Smoke tests tras reload: `/`→200, `/index.html`→200, `/admin-facturas.html`→302, `/app.js`→200, `/styles.css`→200, `/admin-facturas.js`→200, `/api/auth/login` (bad creds)→401. Ninguna regresión
- Pendiente no aplicado (requiere ventana de mantenimiento con OK explícito de Julio): reconstruir `.env` de prod desde `.env.example` para que `docker compose build` vuelva a funcionar — actualmente faltan `COMPOSE_PROJECT_NAME`, `CPU_LIMIT_*`, `MEM_LIMIT_*`, `SETEX_BASE_DIR`, `SETEX_DATA_DIR`, etc., por lo que cualquier rebuild/redeploy de prod está condenado a `docker cp` + `docker restart` hasta que se resuelva

### 2026-04-19 — Fix crítico: auto-block rompía el sitio con 500 (nginx auth_request ↔ 429)

- `app/backend/src/server.js` (middleware Capa 2, línea ~438): añadido `if (req.path.startsWith('/api/internal/')) return next()` al inicio. Razón: nginx hace `auth_request /api/internal/check-access|check-admin-page` antes de servir cada recurso; si la IP del cliente caía en auto-block, el middleware devolvía 429, pero nginx `auth_request` solo acepta 200/401/403 y convertía cualquier otro código en **500 Internal Server Error**. Durante los 60 min del bloqueo, el usuario veía 500 en todo (HTML, JS, API), incluido el propio admin. Endpoints internos son idempotentes y sin BD → exceptuarlos es seguro y elimina la raíz del 500
- `app/backend/src/config/security.json`: `auto_block.max_requests` 100 → 400 (alinea con el default del código y reduce falsos positivos); IP admin `94.73.44.64` añadida a `ip_whitelist` como red de seguridad complementaria
- Despliegue: `docker cp server.js + security.json → setex-backend` + `docker restart` (sin `docker compose build` porque el `.env` de prod no tiene todas las vars que el `docker-compose.yml` parametrizado requiere — bug separado ya conocido, pendiente)
- Verificado end-to-end: con IP de subrequest bloqueada, `admin-facturas.html` responde 302 (redirect login) en lugar de 500, y `/api/auth/login` responde 401 en lugar de 500. Antes: crash total del sitio para la IP; ahora: 429 limpio solo en la ruta principal si el usuario real satura, nunca rompe la carga de páginas

### 2026-04-19 — Fase 3 mejoras: IP allowlist + JPEGs en seed + suite E2E reutilizable

Tres mejoras añadidas al PR #7 en respuesta a las preguntas del experto del checklist E2E:

**1. IP allowlist opt-in en Traefik:**
- `app/docker-compose.yml`: nuevo middleware `${SETEX_ROUTER}-ipallow` con `sourceRange` leído de `SETEX_ALLOWED_IPS`. Default `0.0.0.0/0` (inocuo). Se activa añadiéndolo a `SETEX_HTTPS_MIDDLEWARES` — ejemplo para endurecer staging: `SETEX_HTTPS_MIDDLEWARES=setex-stg-auth,setex-stg-ipallow` + `SETEX_ALLOWED_IPS=<ip_pública>/32`
- `app/.env.example`: sección nueva con comentario + ejemplo

**2. Seed genera JPEGs sintéticos + pobla `file_path`:**
- `scripts/staging/seed-staging.js`: usa `sharp` (ya disponible en el contenedor backend) para crear 15 JPEGs 480×360 de colores pastel únicos por índice (HSL→RGB helper). Los archivos se crean en `UPLOADS_DIR` (default `/app/uploads`). El script es idempotente: si el fichero existe en disco, reusa su size; si el INSERT da conflict, UPDATE del `file_path` cuando sea null.
- Permisos: el directorio `data/uploads` se ajustó a uid 1001:1001 (appuser del contenedor) antes del seed
- Resultado: `GET /api/facturas/:id/imagen` devuelve JPEG real en staging sin necesidad de correr OCR ni subir facturas manualmente

**3. Suite E2E reutilizable con aislamiento de rate-limit:**
- `scripts/staging/e2e-tests.sh` (NUEVO): 17 checks con salida coloreada y código 0/1 apto para CI
  - Bloque 1: TLS + Traefik routing (cert LE, BasicAuth ON/OFF, /api/* exento)
  - Bloque 2: auth + RBAC (admin/empresa/sin token; pass correcta/incorrecta)
  - Bloque 3: datos del seed (15 total vs 5 por empresa, aislamiento entre usuarios, imagen real via endpoint, ocr-engine, empresa pendiente)
  - Bloque 4: rate-limit con **email único `ratelimit-$(ts)-$$@test.staging.local`** para no contaminar los tests subsecuentes en runs múltiples
  - Extra: smoke test prod (verifica que staging no rompió nada)
- Validado: **17/17 PASS** en staging actual

**Motivo:** cerrar las recomendaciones del checklist anterior (rate-limit intermitente, endpoint imagen sin file_path, falta de allowlist IP) con soluciones reutilizables que no añaden deuda técnica.

**PR #7 actualizado:** rama `feature/staging-traefik-api-router-and-seed` ahora incluye 2 commits (router /api/ + scripts seed/e2e + IP allowlist + JPEG seed).

### 2026-04-19 — Fase 3 cierre: seed staging + checklist E2E + router API separado

**Completado (Steps 9-10 y segundo PR pendiente):**
- `scripts/staging/seed-staging.js` (NUEVO, Node): seed idempotente con 5 usuarios (2 admin, 3 empresa), 4 `client_companies` (3 activas + 1 pendiente para probar aprobación), 2 allowed_emails, 15 `uploads` sintéticos con distintos IVA/fechas/invoice_type. Safe-guard `NODE_ENV=staging` o aborta. Hashes bcrypt generados en tiempo real.
- `scripts/staging/seed-staging.sh` (NUEVO, Bash wrapper): exige que el contenedor sea `setex-staging-backend` y `NODE_ENV=staging` antes de ejecutar el JS. Ejecuta vía `docker exec -i ... node -` con el script por stdin.
- Seed ejecutado con éxito → 15 uploads insertados. Re-ejecutado para verificar idempotencia → OK (no duplicó)
- Checklist E2E en staging (16 pruebas): HTTPS+cert LE, BasicAuth en raíz, /api sin BasicAuth, health, login OK/KO, RBAC admin vs empresa, aislamiento de facturas por usuario, rate-limit auth, seed correcto, prod sana → **15/16 PASS** (único FAIL contaminado por el propio test de rate-limit, datos OK validados directamente en BD)
- Hallazgo durante E2E: el header `Authorization:Basic` de Traefik BasicAuth y el `Authorization:Bearer` del JWT **no pueden coexistir** en una misma request HTTP. El frontend real sufriría la misma colisión
- Fix aplicado en staging (y en PR pendiente): segundo router Traefik `${SETEX_ROUTER}-api` con `PathPrefix('/api/')` sin middleware, priority 100 (vs 10 del principal). En prod es inocuo porque `SETEX_HTTPS_MIDDLEWARES=""`.
- **Credenciales sembradas (staging only):** password común `Staging2026!` para `admin@staging.setex.local`, `gestor@staging.setex.local`, `empresa1/2/3@staging.setex.local`

**PRs en curso:**
- PR #6 (MERGEADO a develop): `fix: desacoplar hostnames + reordenar initDB + docker-compose parametrizado`
- PR #7 (PENDIENTE): rama `feature/staging-traefik-api-router-and-seed` — URL: https://github.com/Juliohes/Setex-facturas/pull/new/feature/staging-traefik-api-router-and-seed

**Pendiente (Fase 4):**
- Mergear PR #7 a develop
- Merge controlado develop → main con deploy a producción (flujo con aprobación GitHub Actions)

**Motivo:** cerrar el entorno staging al 100% con datos de prueba reproducibles y arreglar en el repo la colisión Basic/Bearer que haría inservible la API real del staging en cuanto el frontend JS hiciera una petición autenticada.

### 2026-04-19 — Fase 3 continuación: Staging operativo en https://staging.setex-facturas.es

**Completado hoy (Steps 6-8 de Fase 3):**
- DNS: registro A `staging.setex-facturas.es` → 72.60.186.89 creado en Hostinger (TTL 300), propagado en Google/Cloudflare/local
- API keys reales creadas para staging (principio de mínimo privilegio):
  - OpenAI: clave dedicada `setex-staging` con permisos restringidos a `chat/completions` + `list models` únicamente; probada con petición real a `gpt-4.1-2025-04-14` (9 tokens, $0.00003)
  - Azure Document Intelligence: recurso nuevo `setex-staging-di` en West Europe, tier F0 gratuito (500 páginas/mes); probado con `prebuilt-invoice` contra PDF de Contoso (status `succeeded`, campos extraídos OK)
  - SMTP: cuenta Mailtrap Sandbox (sandbox.smtp.mailtrap.io:2525), email de test enviado con éxito (`235 2.0.0 OK` + `250 queued`)
- Primer boot staging completado tras corregir 2 bugs pre-existentes (ver sección bugs abajo)
- Certificado Let's Encrypt emitido automáticamente por Traefik (subject `staging.setex-facturas.es`, issuer `R12`, válido hasta 2026-07-18)
- BasicAuth de Traefik verificado funcional (sin credenciales → 401; con credenciales → 200)
- Registro/login vía API verificado: `POST /api/auth/register` responde con validación de negocio correcta (`CIF obligatorio`)
- Producción NO afectada durante todo el proceso (4 contenedores prod siguieron healthy)

**Bugs pre-existentes descubiertos y corregidos en staging (pendientes de PR al repo):**
- `app/backend/src/server.js:169`: `host: 'setex-postgres'` hardcoded (container_name de prod) — rompía staging por EAI_AGAIN al renombrar contenedor vía COMPOSE_PROJECT_NAME. Fix: `host: process.env.POSTGRES_HOST || 'postgres'` (service name genérico, compatible con prod y staging)
- `app/frontend/nginx.conf`: `proxy_pass http://setex-backend:3000` en 3 líneas (106, 140, 157) — mismo problema. Fix: `http://backend:3000`
- `app/backend/src/server.js:211-213`: `ALTER TABLE known_cifs` y 2 `CREATE INDEX` sobre `known_cifs` ejecutaban ANTES del `CREATE TABLE known_cifs` (línea 258). En prod funcionaba por legado; en BD vacía fallaba con `relation "known_cifs" does not exist`. Fix: movidos después del `CREATE TABLE`

**Pendiente (Fase 3 continuación):**
- STEP 9: Script seed para datos sintéticos en staging (usuarios + facturas)
- STEP 10: Checklist de verificación e2e (flujo OCR completo en staging)
- STEP 11: Commit + PR al repo con los 3 fixes + docker-compose parametrizado (rama feature → develop)

**Motivo:** tener un entorno staging real donde validar cambios antes de aplicarlos a producción, con secretos y credenciales completamente independientes (OpenAI/Azure/SMTP separados, BD separada, red Docker separada).

### 2026-04-19 — Fix modal aprobación empresas (CSP) + aprobación manual de 3 pendientes

- `app/frontend/src/admin-facturas.js` (openReviewModal): los botones Aprobar / Rechazar / Vincular / Cerrar del modal de revisión de empresa pendiente usaban `onclick=` inline y eran bloqueados silenciosamente por la CSP (`scriptSrc: 'self'` sin `'unsafe-inline'` en `server.js:396`); reemplazados por `data-review-action` + delegación con `addEventListener` — mismo patrón CSP-safe ya usado en la tabla de empresas (line 583)
- `app/frontend/src/admin-facturas.html`: cache-buster `admin-facturas.js?v=20260414-003` → `v=20260419-001`; rebuild + redeploy del servicio frontend
- BD: aprobadas manualmente empresas pendientes ids 60 ("123"/12345678N), 61 ("murimarti"/B02790388), 62 ("Autoken SL"/B42634044) replicando la transacción del endpoint `POST /api/admin/companies/:id/approve` (update `client_companies` + activación de uploads pending → active + 3 entradas en `company_audit_log` con `admin_id=2` y `action=APPROVED`). Motivo: pruebas internas, se retirarán en unos días
- Sin uploads activados (0 filas) — ninguno de los usuarios de esas empresas había subido documentos aún

### 2026-04-17 — Sesión 23: Fase 0 + Fase 1 — Decisiones arquitectónicas + preparación repo Git

**Fase 1 — Preparación del repositorio Git:**
- `.gitignore` (NUEVO): reglas exhaustivas para excluir secrets/, data/, backups/, logs/, node_modules/, .env, ocr-service/, tests/invoices/, legacy n8n, dumps SQL
- `scripts/audit-secrets.sh` (NUEVO): script de auditoría pre-commit que escanea patrones de secretos hardcoded (API keys, passwords, JWT, URLs con credenciales, claves privadas)
- `app/.env.example` (REESCRITO): documentado con todas las variables de entorno, cero valores reales, indicación de que secretos van en Docker Secrets
- `README.md` (REESCRITO): eliminada API key de n8n hardcoded (FlYgwhZg...) y referencias obsoletas a n8n/xanflatest.com; nuevo README profesional con stack actual, arquitectura, setup, convenciones de commits y estructura del repo
- Auditoría de secretos ejecutada: 3 hallazgos analizados (2 en settings.local.json gitignored, 1 falso positivo en docs), código limpio para primer commit
- Repositorio Git inicializado en VPS, push a GitHub: `github.com/Juliohes/Setex-facturas` (privado)
- Ramas creadas: `main` (producción) + `develop` (staging). Primer commit: 87 archivos, 23.362 líneas (hash 00e51ec)
- Clave SSH ed25519 generada en VPS y vinculada a GitHub (title: "VPS SETEX")
- `git config --global safe.directory /opt/setex-captu-facture` requerido por ownership del directorio en /opt/
- GitHub Pro activado ($4/mes) para branch protection enforced en repo privado
- Branch protection configurada en `main`: require PR, require linear history, do not allow bypassing, no force push, no deletions
- Branch protection configurada en `develop`: require PR, do not allow bypassing, no force push, no deletions
- Prueba de humo ejecutada: push directo a main correctamente rechazado (GH006)
- 2FA activado en cuenta GitHub (authenticator app)
- Push protection a nivel de cuenta GitHub activado (bloquea push con secretos)
- Dependabot alerts + security updates activados en el repo

### 2026-04-17 — Sesión 23 (continuación): Fase 3 — Preparación VPS para dos entornos (EN CURSO)

**Completado:**
- Usuario `deploy` creado (uid=1004, grupo docker, home /home/deploy)
- Estructura `/opt/setex/{prod,staging,shared}` creada, propiedad de deploy
- Deploy Key ed25519 generada para usuario deploy, añadida a GitHub como read-only
- Repo clonado en `/opt/setex/staging/` (rama develop) y `/opt/setex/prod/` (rama main)
- Secretos staging generados (jwt, postgres, redis, backup — todos únicos, diferentes de producción)
- OpenAI/Azure/SMTP en staging con PLACEHOLDER (pendiente de crear keys reales)
- redis.conf staging creado (FLUSHALL/FLUSHDB/DEBUG deshabilitados, maxmemory 128mb)
- Directorios data y logs creados para ambos entornos
- `.env` creado para staging (COMPOSE_PROJECT_NAME=setex-staging, NODE_ENV=staging, recursos reducidos)
- `.env` creado para producción futura (COMPOSE_PROJECT_NAME=setex-prod, listo para Fase 4)
- docker-compose.yml parametrizado con variables de entorno (mismo fichero sirve para prod y staging)
- BasicAuth para Traefik en staging: usuario `setex`, password en `/opt/setex/staging/secrets/basicauth_password.txt`
- Compose validado: `docker compose config` OK, todas las variables resuelven correctamente

**Pendiente (reanudar aquí):**
- PASO 6: Configurar DNS — crear registro A `staging` → 72.60.186.89 en panel Hostinger
- PASO 7: Primer arranque de staging (docker compose build && up -d)
- PASO 8: Verificar certificado Let's Encrypt automático
- PASO 9: Script seed para datos sintéticos en staging
- PASO 10: Checklist de verificación final
- PASO 11: Commit del docker-compose parametrizado al repo via PR

**Fase 0 — Decisiones arquitectónicas:**

- `docs/DECISIONS.md` (NUEVO): documento con 8 decisiones arquitectónicas cerradas para la implementación de Git, CI/CD y staging
- Decisión 1: GitHub Flow + develop (`feature/* → develop → main`)
- Decisión 2: Staging en mismo VPS de producción (72.60.186.89), aislado por Docker
- Decisión 3: PostgreSQL separado para staging (contenedor y red Docker independientes)
- Decisión 4: Datos sintéticos con script seed (reproducible, sin datos reales)
- Decisión 5: Deploy a producción manual controlado con aprobación en GitHub Actions
- Decisión 6: Secretos completamente separados por entorno (`secrets/` vs `secrets-staging/`)
- Decisión 7: API keys separadas para OpenAI y Azure DI (key con tope de gasto + tier Free F0)
- Decisión 8: Usuario dedicado `deploy` con permisos mínimos (grupo docker, sin sudo, `command=` en SSH)
- Incluye: resumen ejecutivo, tabla de riesgos asumidos, 20 preguntas del experto con respuestas
- Motivo: cerrar decisiones críticas antes de tocar código, con criterio de seguridad-primero

### 2026-04-15 — Sesión 22: Retirada de javier.novillo del proyecto

- `app/backend/src/server.js`: eliminado `javier.novillo@setexextremadura.es` de `ADMIN_EMAILS_BOOTSTRAP` y del comentario de admins (línea 634-635)
- BD `users`: `UPDATE is_admin=false` para `javier.novillo@setexextremadura.es` (ID 17) — ya no recibirá notificaciones admin (`sendAdminPendingEmail` filtra por `is_admin=true`)
- BD `allowed_emails`: `DELETE` de su entrada — no podrá volver a registrarse sin reautorización
- BD `users.token_version`: incrementado a 3 — JWTs activos invalidados inmediatamente
- BD `refresh_tokens`: revocados los activos del usuario (fail-secure)
- Motivo: el usuario no debe recibir ningún correo del sistema por ahora

### 2026-04-14 — Sesión 21: Company identity — avatar y color de empresa en header

- `app/frontend/src/index.html`: añadido `#company-chip` al header (avatar circular + nombre de empresa), cache-buster `v=20260414-004`
- `app/frontend/src/styles.css`: estilos `.company-chip`, `.company-avatar`, `.company-name-chip` con animación `chipSlideIn` (cubic-bezier con ligero bounce)
- `app/frontend/src/app.js`: funciones `getCompanyInitials()` (elimina formas jurídicas SL/SA/etc. antes de extraer iniciales), `getCompanyColor()` (hash deterministico del nombre → 1 de 8 colores, estable entre sesiones), `showCompanyIdentity()` (puebla el chip y cambia el `border-top` del main-screen al color de empresa — UI "branded"), `hideCompanyIdentity()` (limpia en logout y cross-tab); `showCompanyIdentity()` llamado desde `loadUserSettings()`; admins no ven el chip

### 2026-04-14 — Sesión 20: Cleanup Scheduler para escala 250 usuarios

- `app/backend/src/server.js`: añadido `startCleanupScheduler()` con 3 funciones independientes:
  - `cleanRefreshTokens()` cada 6h: borra RTs expirados (+1h gracia) y revocados hace >30 días; `LIMIT 5000` por pasada para transacciones cortas
  - `cleanAuditLogs()` cada 24h: eventos operacionales →90 días, eventos de seguridad (LOGIN_FAILED, REGISTER_BLOCKED, etc.) → 365 días; `LIMIT 1000/500` por pasada
  - `cleanLocalDriveFiles()` cada 24h: elimina archivos locales de facturas ya en Drive (`drive_file_id IS NOT NULL`) con 30 días de gracia; actualiza `file_path = NULL` en BD; `LIMIT 200` por pasada
- `app/backend/src/server.js`: limpieza oportunista en login — `DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < NOW()` fire-and-forget (sin impacto en latencia)
- `app/backend/src/server.js` (initDB): 2 nuevos índices — `idx_rt_revoked` (partial index en `revoked=true` para cleanup rápido) e `idx_uploads_drive_cleanup` (partial index para files-on-drive query)
- Scheduler arranca 60s después del boot para no competir con inicialización; logs informativos en cada pasada que borre algo

### 2026-04-14 — Sesión 19: Arquitectura de autenticación profesional (AT en memoria + RT httpOnly)

- `app/frontend/src/auth.js` (NUEVO): módulo centralizado de auth — Access Token en memoria JS (inmune a XSS), Refresh Token en cookie httpOnly SameSite=Strict (inmune a CSRF), rotación de RT con detección de reuso (family_id), BroadcastChannel para logout cross-tab, refresh proactivo 60s antes de expirar
- `app/backend/src/server.js`: tabla `refresh_tokens` (PostgreSQL) con índices; funciones helper `hashToken`, `createRefreshToken`, `revokeTokenFamily`, `setRtCookie`, `setAdminCookie`; `POST /api/auth/refresh` con transacción atómica y detección de reuso; `POST /api/auth/login` modificado — emite AT 15min + RT cookie; `POST /api/auth/logout` modificado — revoca RT en BD + borra cookies; endpoint `/api/auth/register` actualizado — emite AT+RT igual que login (en lugar de JWT 7 días)
- `app/backend/src/server.js`: `refreshLimiter` movido antes de su uso (era `const` definido tras el endpoint que lo usaba → ReferenceError corregido)
- `app/frontend/src/app.js`: eliminadas funciones de localStorage/sessionStorage (`getStoredToken`, `storeToken`, `clearStoredToken`); `token` inicializado en `null`; login/register/logout usan `Auth.handleLoginResponse()` y `Auth.logout()`; todos los `fetch()` autenticados reemplazados por `Auth.apiFetch()`; bloque init usa `Auth.init()` (refresh silencioso) en lugar de leer localStorage; `processFile()` usa `Auth.getUser()` en lugar de decodificar JWT manualmente
- `app/frontend/src/admin-facturas.js`: `getToken()` → `Auth.getToken()`; `authFetch()` → delega a `Auth.apiFetch()`; `doLogin()` usa `Auth.handleLoginResponse()`; `init()` usa `Auth.init()` + logout via `Auth.logout()`; `launchApp()` usa `Auth.getUser()` para email
- `app/frontend/src/index.html`: añadido `<script src="auth.js?v=20260414-003">` antes de `app.js`; cache-buster `app.js` actualizado a `v=20260414-003`
- `app/frontend/src/admin-facturas.html`: añadido `<script src="auth.js?v=20260414-003">` antes de `admin-facturas.js`; cache-buster actualizado a `v=20260414-003`

### 2026-04-14 — Sesión 18: Fix doble login en panel admin

- `admin-facturas.js` línea 12: `getToken()` ahora comprueba `localStorage` Y `sessionStorage` — los usuarios que no marcan "recordar sesión" almacenan el token en sessionStorage, que antes era ignorado por el panel admin
- `admin-facturas.js` `init()`: eliminado el formulario de login incrustado como ruta por defecto; sin token válido redirige a `/?next=admin` (login centralizado de la app principal, que regenera la cookie admin y devuelve al panel)
- `admin-facturas.js` `authFetch()`: añadido manejo de 401 durante el uso del panel (token expirado mid-session) → limpia tokens y redirige a `/?next=admin`
- `admin-facturas.html`: cache-buster actualizado a `?v=20260414-002`

### 2026-04-14 — Sesión 17: Flujo completo de aprobación de empresas (company approval workflow)

- `server.js`: añadida función `requireActiveCompany` — middleware que bloquea endpoints operativos para usuarios con empresa pendiente/desactivada; admins siempre pasan
- `server.js`: `requireActiveCompany` aplicado a 7 endpoints: `upload-preview`, `upload-confirm`, `proveedor/:nif`, `mis-facturas`, `facturas/:id/imagen`, `mis-facturas/export.xlsx`, `vies/:nif`
- `server.js` (initDB): 11 nuevas columnas en `client_companies` (registration_source, requested_by_email, requested_at, reviewed_by, reviewed_at, rejection_reason, linked_to_company_id, nombre_registrado, matching_suggestions), columna `upload_status` en `uploads`, tabla `company_audit_log`, índices GIN pg_trgm en client_companies.nombre
- `server.js`: funciones helper `normalizeCompanyName()`, `findMatchingCompanies()` (pg_trgm + levenshtein), `logCompanyAudit()`, `sendAdminPendingEmail()` para el flujo de aprobación
- `server.js` (POST /api/auth/register): fix crítico de seguridad — empresas nuevas/pendientes ya no reciben JWT al registrarse; devuelve 202 con `pending:true`; calcula matching_suggestions; notifica admins por email; loguea en company_audit_log
- `server.js`: nuevo endpoint `GET /api/company/status` (sin requireActiveCompany) para que usuarios pendientes comprueben si su empresa fue aprobada
- `server.js`: 6 nuevos endpoints admin: `GET /companies/pending`, `GET /companies/:id/detail`, `GET /companies/:id/audit-log`, `POST /companies/:id/approve` (transacción atómica + activa uploads), `POST /companies/:id/reject` (quarantine uploads), `POST /companies/:id/link` (migra usuarios y uploads a empresa destino)
- `index.html`: nueva pantalla `#pending-approval-screen` con botón "Verificar estado" y "Cerrar sesión"
- `app.js`: `showPendingApprovalScreen()`, `checkCompanyStatus()`, manejo de 202 en `register()`, verificación de estado en init al cargar con token guardado, `logout()` cubre pantalla pendiente; cache-buster `?v=20260414-002`
- `admin-facturas.js`: `_empAprobar` reemplazado para usar `POST /admin/companies/:id/approve` con transacción; `_empRechazar` usa `POST /admin/companies/:id/reject` con quarantine y prompt de motivo; nuevo `_empRevisar` abre modal detallado; `openReviewModal()` con matching suggestions, vincular directo, usuarios y uploads pendientes; `_linkToCompany()` para vincular; `escHtml()` helper XSS-safe; cache-buster `?v=20260414-001`
- Docker: rebuild y redeploy backend + frontend; frontend `UNHEALTHY` resuelto con el rebuild; todas las migraciones ejecutadas correctamente

### 2026-04-10 — Sesión 16: Fix panel admin — columna Imagen, filtro CIF completo, fechas por fecha_emision

**Bug 1 RESUELTO — Columna "Imagen" mostraba "—" para todas las facturas:**
- El endpoint `GET /api/admin/facturas` no incluía `u.file_path` en el SELECT de PostgreSQL.
- El frontend (`formatImagen`) comprueba `row.file_path` para mostrar "🖼 Ver". Como el campo nunca llegaba, siempre mostraba el guión.
- Fix: añadido `u.file_path` al SELECT del endpoint `/api/admin/facturas` en `server.js`.

**Bug 2 RESUELTO — Filtro por CIF/Proveedor solo encontraba facturas donde la empresa era EMISORA:**
- El filtro `proveedor` solo buscaba en `u.proveedor_nombre` y `u.proveedor_nif`.
- Si la empresa aparece como RECEPTOR en la factura (facturas emitidas, invoice_type="venta"), no se encontraba.
- Fix: el filtro ahora busca en los 4 campos: `proveedor_nombre OR proveedor_nif OR receptor_nombre OR receptor_nif`.
- Aplicado tanto en `/api/admin/facturas` como en `/api/admin/facturas/export.xlsx`.

**Mejora 3 — Filtro de fechas usa fecha de EMISIÓN de la factura (no fecha de subida):**
- Antes: el filtro "Desde/Hasta" filtraba por `uploaded_at` (fecha en que se subió la imagen).
- Ahora: filtra por `fecha_emision` (fecha que aparece en la factura), que es lo semánticamente correcto.
- Implementación SQL: `TO_DATE(u.fecha_emision, 'DD/MM/YYYY') >= $p::date` con guard regex `^\d{2}/\d{2}/\d{4}$` para evitar errores en filas con fecha_emision NULL o malformada.
- Labels del filtro actualizados a "Fecha factura desde / hasta" para mayor claridad.
- Aplicado en ambos endpoints (consulta y exportación Excel).

**Archivos modificados**: `app/backend/src/server.js`, `app/frontend/src/admin-facturas.html` (cache-buster v20260410-002).

### 2026-04-10 — Sesión 15p: Hardening completo — 15 preguntas de seguridad + protección panel admin

**Respuestas a preguntas de seguridad ejecutadas:**

- **Q1+Q10 mejorado**: `cleanupOrphanFilesRecursive` ahora también borra directorios vacíos tras el ciclo y añade guard `isSymbolicLink()` para prevenir loops infinitos.
- **Q4**: `confidenceLevel` forzado a `'low'` cuando `ocrData.nif_status === 'both_missing'` (ningún motor leyó el NIF) — independientemente de si el proveedor es conocido.
- **Q5**: Confianza OCR ajustada por `nif_status`: `both_missing` → `×0.60`, `single_source` → `×0.85` (ya cubierto), `confirmed` → `×1.15`. Configurado en `ocr/index.js`.
- **Q7**: Eliminadas 3 entradas auto-migradas del `company_catalog` (B39793294, B06352348, 08822280D). Catálogo vuelve a ser 100% admin-curado.
- **Q13**: `nif_status` incluido en la respuesta de `/api/upload` para trazabilidad en frontend.
- **Q15**: Limpieza manual inmediata ejecutada — 11 archivos huérfanos eliminados (previews sin confirmar de tests anteriores). Los 40 restantes estaban en BD y se conservaron.
- **Q2/Q3/Q6/Q8/Q9/Q11/Q12/Q14**: Verificados y confirmados correctos — no requirieron cambios de código.

**Protección del panel admin `/admin-facturas.html`:**

Implementación completa de doble capa de seguridad para el panel de administración:

1. **Cookie httpOnly `setex_admin`**: Seteada en `/api/auth/login` cuando `is_admin=true`. Duración: 8 horas. Flags: `httpOnly` (JS no la puede leer → inmune a XSS), `secure` (solo HTTPS), `sameSite=strict` (no cross-site). El JWT embebido incluye `type: 'admin_page'`, `token_version` y `is_admin`.

2. **nginx protección específica**: `location = /admin-facturas.html` con `auth_request /api/internal/check-admin-page`. Si la cookie no existe o es inválida → `302 redirect /?next=admin`. El HTML del panel nunca se sirve sin sesión admin válida. Headers adicionales: `X-Robots-Tag: noindex` (no indexable por buscadores), `Referrer-Policy: no-referrer` (más estricto que el resto del site).

3. **Endpoint `/api/internal/check-admin-page`**: Verifica (1) horario no bloqueado, (2) cookie presente, (3) JWT firmado con `type=admin_page`, (4) `token_version` y `is_admin` vigentes en BD. Fail-secure: error de BD → 503.

4. **Endpoint `/api/admin/refresh-session`**: Permite a `app.js` regenerar la cookie admin cuando el JWT de localStorage es válido pero la cookie expiró (evita doble login).

5. **Endpoint `/api/auth/logout`**: Borra la cookie httpOnly. Llamado por `admin-facturas.js` al hacer logout (ya que JS no puede borrar cookies httpOnly directamente).

6. **app.js**: Detecta `?next=admin` al cargar. Si hay token válido → llama a refresh-session → redirige a `/admin-facturas.html`. Si no → guarda intención en sessionStorage. Tras login exitoso de admin → redirige automáticamente.

7. **admin-facturas.js**: Logout ahora llama a `POST /api/auth/logout` para borrar la cookie, además de eliminar el token del localStorage.

**SQL ejecutado**: `DELETE FROM company_catalog WHERE notas = 'Migrado automáticamente desde historial'` — 3 filas eliminadas.

**Archivos modificados**: `app/backend/src/server.js`, `app/backend/src/ocr/index.js`, `app/frontend/nginx.conf`, `app/frontend/src/app.js` (v20260410-001), `app/frontend/src/admin-facturas.js` (v20260410-001), `app/frontend/src/index.html`, `app/frontend/src/admin-facturas.html`.

---

### 2026-04-10 — Sesión 15q: Migración dominio xanflatest.com → setex-facturas.es + aviso nif_status en modal

**Migración de dominio completada:**
- `docker-compose.yml`: reglas Traefik `Host()` actualizadas en routers `setex-http` y `setex` → `setex-facturas.es`
- `app/backend/src/server.js`: CORS origin, URL de email de recuperación y texto de email de calidad actualizados
- `app/frontend/nginx.conf`: CSP `connect-src` actualizado en los 5 bloques de cabeceras
- `/docker/n8n/traefik-dynamic/setex.yml`: dominio actualizado. Eliminado router `setex-http` redundante (el redirect HTTP→HTTPS ya está configurado a nivel de entrypoint Traefik).
- Frontend y backend rebuildeados y redesplegados. Let's Encrypt emitió certificado TLS para `setex-facturas.es` (CA: R12, válido hasta 2026-07-09).

**Incidencia ACME resuelta:** El primer intento TLS-ALPN-01 falló porque `setex.yml` aún referenciaba `xanflatest.com` cuando Traefik ejecutó el challenge. Corregido el fichero; Traefik auto-recargó (file watcher activo) y obtuvo el certificado en el segundo intento.

**Verificación post-migración:**
- `dig +short setex-facturas.es A` → `72.60.186.89` ✓
- `https://setex-facturas.es/health` → `healthy` ✓
- HTTP → HTTPS redirect activo ✓
- HSTS, CSP con dominio correcto, X-Frame-Options DENY ✓
- Panel admin: `302 → https://setex-facturas.es/?next=admin` ✓
- Certificado: `CN = setex-facturas.es`, emisor R12 ✓

**Aviso nif_status en modal OCR (app.js v20260410-002):**
- Añadido `nif_status` al objeto `meta` en la llamada a `showConfirmModal()` dentro de `uploadFile()`
- Banner OCR del modal ampliado con dos nuevos casos:
  - `nif_status === 'both_missing'`: banner rojo — "CIF/NIF no detectado por ninguna IA — Verifica e introduce manualmente"
  - `nif_status === 'single_source'`: banner naranja — "CIF/NIF leído por una sola IA — Confirma que es correcto"
- Esto cierra la brecha Q13 pendiente de la sesión 15p: el backend ya devolvía `nif_status` pero el frontend no lo mostraba.

**Archivos modificados**: `app/docker-compose.yml`, `app/backend/src/server.js`, `app/frontend/nginx.conf`, `/docker/n8n/traefik-dynamic/setex.yml`, `app/frontend/src/app.js` (v20260410-002), `app/frontend/src/index.html`.

---

### 2026-04-10 — Sesión 15o: Aplicación de 4 hallazgos prioritarios de la Revisión de Acceso/Aislamiento

**H-001 ALTO resuelto:** Limpieza de archivos huérfanos ahora es **recursiva**. El `setInterval` anterior solo escaneaba `/app/uploads/` (nivel raíz). Multer guarda los archivos en `/app/uploads/{emailPrefix}/` y al confirmar se mueven a `/app/uploads/{emailPrefix}/{nifFolder}/`. Todos los ficheros en subdirectorios eran ignorados permanentemente. Fix: función `cleanupOrphanFilesRecursive()` usando `fs.readdir(dir, { withFileTypes: true })` que desciende en subdirectorios.

**H-002 ALTO resuelto:** Al detectar una factura duplicada en `/api/upload-confirm`, ahora se elimina el fichero físico (`fs.unlink(filePath)`) antes de devolver la respuesta al cliente. Antes solo se borraba la clave Redis del preview, y el archivo quedaba en disco indefinidamente (además de no ser limpiado por H-001).

**MT-001 ALTO resuelto:** Eliminado el bloque de migración `known_cifs → company_catalog` del arranque del servidor. Este bloque se ejecutaba en **cada reinicio** y promovía todos los datos de aprendizaje privados de usuarios (historial OCR por usuario) al catálogo global admin. Con `user_id` ya incorporado en `known_cifs` y el auto-learn eliminado (SEC-006), esta migración ya era un vector de contaminación cross-tenant puro. Sustituido por comentario documentando la decisión.

**OCR-001 ALTO resuelto:** Corregida la lógica de `nifAgree` en `ocr/index.js`. La expresión anterior `!oNif || !aNif || oNif === aNif` devolvía `true` (y por tanto `dual_confirmed: true`) cuando **solo un motor** extraía NIF. Ahora se calcula explícitamente `nifStatus ∈ {confirmed, both_missing, single_source, conflict}`. `dual_confirmed` solo es `true` cuando `nifStatus === 'confirmed'` (ambos motores leyeron el mismo NIF) Y `totalAgree` Y `fechaAgree`. El campo `nif_status` se incluye en el resultado de OCR para trazabilidad.

**Ficheros modificados:** `app/backend/src/server.js`, `app/backend/src/ocr/index.js`

---

### 2026-04-10 — Sesión 15n: Cierre de los 3 hallazgos críticos/altos pendientes

**SEC-001 CRÍTICO resuelto:** Redis password movida de `docker-compose.yml` (texto plano en `command`) a `/opt/setex-captu-facture/secrets/redis.conf` montado como volumen read-only. El valor del hash ya NO aparece en `docker inspect setex-redis`. Healthcheck lee la contraseña del mismo fichero (`grep requirepass`). Redis arrancó con `Configuration loaded` y autentifica correctamente (PONG).

**SEC-006 ALTO resuelto:** Eliminado el auto-learn de `company_catalog` global al confirmar facturas. Los usuarios ahora solo aprenden en su tabla `known_cifs` privada. El catálogo global solo puede ser editado por admins desde el panel. Esto elimina la contaminación cross-tenant donde el primer usuario que ve un proveedor "ganaba" el nombre canónico para todos.

**SEC-019 BAJO resuelto:** Array `ADMIN_EMAILS` hardcoded eliminado del código fuente. Verificado previamente que ambos admins tienen `is_admin=true` en BD. La fuente de verdad ahora es **únicamente** la columna `is_admin` de la tabla `users`. Solo queda `ADMIN_EMAILS_BOOTSTRAP` en `initDB` para la migración idempotente al arrancar.

**Fichero nuevo:** `/opt/setex-captu-facture/secrets/redis.conf` (permisos 644, propiedad root).

### 2026-04-09 — Sesión 15m: Revisión quirúrgica de seguridad — 20 hallazgos, 10 fixes aplicados

**Revisión quirúrgica completa** (`docs/REVISION_QUIRURGICA_SEGURIDAD_2026.md`): 20 hallazgos identificados (2 críticos, 5 altos, 8 medios, 5 bajos).

**Fixes aplicados directamente (sin intervención manual):**
- **SEC-002 CRÍTICO:** `register` JWT ahora incluye `token_version: 1` e `is_admin: false` — la revocación de sesiones por reset de contraseña ya funciona para usuarios recién registrados
- **SEC-003 CRÍTICO funcional:** Corregidas guardias de email que comprobaban `process.env.SMTP_USER` (siempre undefined tras migración a secrets) → ahora usan `smtpUserCached`. **Recuperación de contraseña y notificaciones de calidad ahora funcionan**
- **SEC-004 ALTO:** `authenticateToken` cambiado de fail-open a fail-secure cuando PostgreSQL falla → tokens revocados no quedan activos durante degradación de BD
- **SEC-005 ALTO:** Magic bytes validation ahora rechaza el archivo si el check lanza excepción (antes el catch silencioso permitía pasar el archivo sin validar)
- **SEC-007 MEDIO:** `/api/admin/security/blocked` usa SCAN iterativo en lugar de `KEYS` (consistente con `system-health`)
- **SEC-008 MEDIO:** `requireXHR` añadido a `POST /api/admin/ocr-engine` y `POST /api/admin/retry-failed/:id`
- **SEC-009 MEDIO:** `file_path` eliminado de la respuesta de `GET /api/mis-facturas` (no expone rutas internas del servidor)
- **SEC-010 MEDIO:** `normalizeDate` ahora valida que la fecha existe en el calendario real (rechaza 31/02, 31/04, etc.)
- **SEC-012 MEDIO:** `isRestrictedHour` retorna `false` si `start_hour === end_hour` (evita lockout total permanente accidental)
- **SEC-014 MEDIO:** Rate limiter añadido a `GET /api/vies/:nif` (20 req/min por usuario)

**Pendiente de acción manual (requiere decisión de Julio):**
- **SEC-001 CRÍTICO:** Redis password hardcoded en `docker-compose.yml` command y healthcheck → mover a redis.conf montado como volumen (requiere modificar docker-compose + recrear contenedor Redis)
- **SEC-006 ALTO:** `company_catalog` auto-learn global → contamina datos entre usuarios → eliminar INSERT automático o añadir sistema de quorum
- **SEC-019 BAJO:** Eliminar array `ADMIN_EMAILS` del código una vez que ambos admins confirmen tener `is_admin=true` en BD

**Nuevo documento:** `docs/REVISION_QUIRURGICA_SEGURIDAD_2026.md` con los 20 hallazgos completos en formato quirúrgico (archivo, función, líneas, parche, validación).

### 2026-04-09 — Sesión 15l: Hardening infraestructura completo + emergencia SSH

**Hallazgo crítico de SSH:** 847 intentos de fuerza bruta contra root desde IP 20.25.151.119 (Azure). `PermitRootLogin yes` activo. Acción inmediata tomada.

**Fixes de infraestructura aplicados:**
- **docker-compose.yml** reescrito con todos los hardening:
  - HAL-008: Redis con contraseña `requirepass` — sin acceso sin autenticación
  - HAL-006: SMTP migrado a Docker secrets (`/run/secrets/smtp_user`, `/run/secrets/smtp_pass`)
  - HAL-011: Red `setex_internal` creada — postgres, redis, backend aislados de n8n
  - HAL-012: `extra_hosts: host.docker.internal` eliminado
  - HAL-010: Redis `maxmemory-policy allkeys-lru` (antes `noeviction`)
  - Log rotation Docker: `max-size: 10m, max-file: 5` en todos los servicios
- **queue/index.js**: Lee contraseña Redis desde `/run/secrets/redis_password` automáticamente
- **server.js**: Lee SMTP desde `/run/secrets/smtp_user` y `/run/secrets/smtp_pass`
- **Secrets creados**: `redis_password.txt`, `smtp_user.txt`, `smtp_pass.txt` en `/opt/setex-captu-facture/secrets/`
- **Backups PostgreSQL**: script + cron diario 3:00 AM → `/opt/setex-captu-facture/backups/postgres/` (7 días rolling)
- **Fail2ban configurado**: ban 24h tras 3 intentos fallidos SSH. IP atacante 20.25.151.119 baneada manualmente.
- **Logs comprimidos**: app.log (1.1GB) + error.log (1.1GB) → 26MB comprimidos
- **Winston rotación**: maxsize 50MB, maxFiles 5 (app.log), maxFiles 3 (error.log)

**Pendiente crítico para Julio:**
- **SSH: `PermitRootLogin yes` + contraseña** — el servidor acepta login root por contraseña. HAY 847 INTENTOS FALLIDOS HOY. Debes configurar claves SSH y deshabilitar login por contraseña. Ver guía sección 19, Paso 6.

---

### 2026-04-09 — Sesión 15k: Implementación completa de hardening de seguridad

**Fixes aplicados en código (server.js):**
- HAL-002: `token_version` en JWT y BD — las sesiones se invalidan automáticamente tras cambio de contraseña
- HAL-003: `is_admin BOOLEAN` en tabla `users` — admins promovidos desde BD, ADMIN_EMAILS queda como fallback legacy
- HAL-007: Tokens OAuth de Google eliminados de la BD (`google_tokens` tenía 1 fila con tokens reales no usados)
- HAL-009: `KEYS` reemplazado por `SCAN` iterativo en system-health endpoint
- HAL-017: `LIMIT 10000` añadido a ambos exports XLSX
- HAL-020: `normalizeDate` con validación de rangos de día (1-31) y mes (1-12)
- HAL-021: `Content-Disposition` con `filename*=UTF-8''encodeURIComponent(filename)`
- Logger Winston con rotación automática: maxsize 50MB, maxFiles 5 para app.log, maxFiles 3 para error.log
- Logs comprimidos: 2.1GB → 26MB (app.log.old.gz + error.log.gz en `/opt/setex-captu-facture/logs/backend/`)

**Pendiente urgente para Julio (ver guía paso a paso en este mismo fichero sección 19):**
- HAL-008: Redis sin contraseña — cambio en docker-compose.yml
- HAL-006: SMTP en env vars — cambio en docker-compose.yml
- HAL-011: Red compartida con n8n — cambio en docker-compose.yml
- HAL-012: extra_hosts en backend — cambio en docker-compose.yml
- Rotación de logs Docker (logging config en docker-compose.yml)

---

### 2026-04-09 — Sesión 15j: Auditoría de seguridad completa + fixes P0/triviales aplicados

**Alcance:** Auditoría de seguridad exhaustiva y autorizada. 23 hallazgos identificados (3 críticos, 6 altos, 9 medios, 5 bajos). Informe completo en `docs/INFORME_AUDITORIA_SEGURIDAD_2026.md`.

**Fixes aplicados en esta sesión (P0 + triviales):**

- **HAL-005 CRÍTICO RESUELTO:** Eliminado el `logger.warn/info` que exponía el token de reset de contraseña en claro cuando SMTP no está configurado (`server.js:780-782`). Ahora solo se loguea el hash SHA-256 truncado.
- **HAL-016 RESUELTO:** Añadido `authenticateToken` al endpoint `GET /api/vies/:nif` — ya no es público.
- **HAL-015 RESUELTO:** Eliminado `u.file_path` del SELECT en `GET /api/admin/facturas` — no se expone la ruta interna de archivos.
- **HAL-018 RESUELTO:** Añadido `app.disable('x-powered-by')` — Express no se revela en las cabeceras HTTP.
- **HAL-023 RESUELTO:** `auditLog()` normaliza IPv6 (`::ffff:x.x.x.x` → `x.x.x.x`) antes de insertar en BD.

**Pendiente (acciones P0-P1 urgentes para Julio):**
- **HAL-008:** Redis sin contraseña — añadir `requirepass` en `docker-compose.yml` (30 min)
- **HAL-011:** Red compartida con n8n — crear red `setex_internal` (2-3 horas)
- **HAL-001:** JWT en localStorage → migrar a httpOnly cookies (planificar)

---

### 2026-04-09 — Sesión 15i: Fix botones Acciones en tabla de empresas (CSP)

**Root cause:** El CSP de nginx tiene `script-src 'self'` sin `'unsafe-inline'`. Los handlers `onclick="window._empXxx(...)"` generados dentro de formatters de Tabulator (vía `innerHTML`) son bloqueados silenciosamente por el navegador. Ningún botón de la columna Acciones funcionaba.

**Fix aplicado:**
- Eliminados **todos** los `onclick="..."` inline del JS y HTML (0 coincidencias restantes).
- Acciones column: los botones usan `data-action="ver|aprobar|rechazar|eliminar"` + `data-id`, `data-cif`, `data-nombre` (vía `escAttr` para escape seguro de comillas).
- Event delegation con `document.getElementById('empresas-table').addEventListener('click', ...)`: un solo listener gestiona todos los clics, `e.target.closest('.emp-action')` identifica el botón pulsado.
- Lightbox: `onclick="this.style.display='none'"` movido a `initEmpresaModal()` como `addEventListener('click', ...)`.
- Añadida función `escAttr(s)`: escapa `&`, `"` y `'` para uso seguro en atributos HTML.
- Cache-buster JS bumped a `?v=20260409-004`.
- Frontend reconstruido y redesployado.

---

### 2026-04-09 — Sesión 15h: Cuatro mejoras en panel de empresas

**Cambios implementados:**

#### 1. Fix edición inline — cellEdited no persistía
- El handler `cellEdited` estaba declarado en el constructor de Tabulator en lugar de vincularse con `tableEmpresas.on('cellEdited', ...)`. En Tabulator v6, la forma fiable es vincular el evento DESPUÉS de la creación del objeto. Corregido.
- PersistenceID bumped a `setex-admin-empresas-v5`.

#### 2. Columna "Código" → "ID"
- Renombrado `title: 'Código'` a `title: 'ID'` en la columna `codigo_cliente` de la tabla de empresas.
- La columna ID de la tabla de facturas ya estaba correcta.

#### 3. Registro abierto + empresas "pendiente de revisión"
- **`server.js` initDB**: `ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS pendiente BOOLEAN DEFAULT false`
- **`server.js` registro (`POST /api/auth/register`)**:
  - Eliminado el check de whitelist de empresa activa.
  - Si el CIF no existe en `client_companies` → INSERT automático con `pendiente=true, activa=false`. El usuario puede registrarse e iniciar sesión por primera vez.
  - Si la empresa está desactivada (`activa=false, pendiente=false`) → registro bloqueado.
  - Si la empresa está activa o pendiente → registro permitido.
- **`server.js` login (`POST /api/auth/login`)**:
  - Si empresa `pendiente=true, activa=false` → bloqueo con: "Tu empresa está pendiente de revisión por SETEX."
  - Si empresa `activa=false` (no pendiente) → bloqueo con mensaje de desactivación.
- **`server.js` PUT /api/admin/client-companies/:id**: acepta campo `pendiente`.
- **`server.js` GET /api/admin/client-companies**: incluye `pendiente` en SELECT; ORDER BY pendiente DESC primero.
- **`admin-facturas.html`**: badge naranja en tab "Empresas" con conteo de pendientes; descripción actualizada.
- **`admin-facturas.js`**: badge de estado con 3 variantes (Activa/Inactiva/Pendiente); botones "✓ Aprobar" / "✗ Rechazar" en Acciones para empresas pendientes; función `actualizarBadgePendientes()` actualiza el badge del tab; `_empAprobar` y `_empRechazar`.

#### 4. Galería de facturas por empresa (modal "Ver facturas")
- `window._empVerFacturas(id, cif, nombre)` reemplazado: ya no cambia de tab sino que abre un modal con grid de imágenes.
- Carga hasta 60 facturas de la empresa (via `GET /api/admin/facturas?company_nif=X`), ordenadas por fecha DESC.
- Cada imagen se lazy-carga con IntersectionObserver al entrar en el viewport (blob URL vía `GET /api/admin/facturas/:id/imagen` con JWT).
- Click en imagen → lightbox a pantalla completa. Click en lightbox o ESC → cierra.
- CSS: `.facemp-grid`, `.facemp-card`, `.facemp-img-wrap`, `.badge-activa/inactiva/pendiente`, `#lightbox`.
- **`admin-facturas.html`**: modales `#facemp-modal` y `#lightbox` añadidos.
- Backend y frontend reconstruidos y redesployados (healthy).

---

### 2026-04-11 — Sesión 16d: Company Relationships + OCR Autocorrection

**Nueva tabla: `company_relationships`**
- Registra las relaciones entre cada empresa SETEX (client_cif) y sus contrapartes (proveedores o clientes) según facturas confirmadas.
- Columnas: `id, client_cif, counterparty_nif, counterparty_nombre, counterparty_nombre_norm, relationship_type, confirmations, last_seen, created_at`.
- Índice único parcial: `(client_cif, counterparty_nif) WHERE counterparty_nif IS NOT NULL`.
- Índice GIN trigrama: `counterparty_nombre_norm gin_trgm_ops` para búsqueda fuzzy por nombre.
- Nueva extensión PostgreSQL activada: `fuzzystrmatch` (función `levenshtein` para detección de typos en CIF).

**3 funciones helper añadidas en `server.js`:**
- `getCounterpartyInfo(userCompanyNif, campos, invoiceType)` — determina quién es la contraparte (proveedor en compras, receptor en ventas).
- `lookupCounterparty(clientCif, ocrNif, ocrNombre)` — 3 niveles de búsqueda fuzzy:
  1. CIF exacto → confidence: high
  2. Trigrama nombre ≥ 0.65 → high; ≥ 0.45 → medium
  3. Levenshtein CIF ≤ 1 → high; = 2 → medium
- `saveCompanyRelationship(clientCif, counterpartyNif, counterpartyNombre, type)` — upsert con conteo de confirmaciones.

**Integración en `/api/upload-preview`:**
- Tras calcular `invoiceType`, se llama a `lookupCounterparty` con el NIF/nombre extraído por OCR.
- Si `confidence === 'high'`: se autocorrigen `campos.proveedor_nif/nombre` o `campos.receptor_nif/nombre` antes de guardar en Redis y devolver la respuesta. Campo `ocr_corrected` incluido en la respuesta.
- Si `confidence === 'medium'`: no se modifica nada, se devuelve `suggested_counterparty` para que el usuario decida.

**Integración en `/api/upload-confirm`:**
- Tras el upsert de `known_cifs`, se llama a `saveCompanyRelationship` con los datos definitivos confirmados por el usuario (incluye posibles correcciones manuales del usuario en el modal). El sistema aprende de cada confirmación.

**Frontend (`app.js` + `index.html`):**
- Nuevo `<div id="confirm-relationship-hint">` en el modal de confirmación (bajo el badge de proveedor conocido).
- Si `ocr_corrected`: badge verde "✓ Completado con datos conocidos (N confirmaciones)".
- Si `suggested_counterparty`: chip amarillo clickable "¿Es este proveedor/cliente? [NOMBRE (CIF)]". Al hacer click: rellena automáticamente los campos correspondientes.

**Archivos modificados:** `app/backend/src/server.js`, `app/frontend/src/app.js` (v20260411-002), `app/frontend/src/index.html`.

---

### 2026-04-11 — Sesión 16c: Mejoras panel Empresas + fix color móvil

**Cambios:**
1. **Orden numérico en tab Empresas**: columna ID usa `sorter:'number'` (antes `string` → ordenaba 1,10,11…). `initialSort` actualizado a `codigo_cliente ASC`. `persistenceID` bumpeado a v6 para limpiar caché.
2. **Botón Eliminar fuera de filas**: quitado botón `✕ Eliminar` de la columna Acciones de cada fila. Nuevo botón `🗑 Eliminar` en la barra de herramientas — activa un "modo eliminar" (botón se pone rojo, filas muestran botón eliminar). Segundo click cancela el modo.
3. **Aprobación de empresa pendiente con edición**: al pulsar `✓ Aprobar` en una empresa pendiente, se abre el modal de edición pre-relleno con los datos existentes. El admin puede completar `codigo_cliente` y notas antes de aprobar. El botón del modal cambia a `✓ Aprobar empresa` (verde). Al guardar, se hace PUT con `activa:true, pendiente:false` más los datos editados.
4. **Color banda móvil**: `<meta name="theme-color">` cambiado de `#FF6600` (naranja) a `#667eea` (azul/morado del fondo general de la app).

**Archivos modificados:**
- `app/frontend/src/admin-facturas.js` — cambios 1, 2, 3
- `app/frontend/src/admin-facturas.html` — botón modo-eliminar, cache-buster v20260411-001
- `app/frontend/src/index.html` — theme-color

---

### 2026-04-11 — Sesión 16b: Alta de 57 empresas clientes reales en producción

**Cambios:**
- Insertadas 57 empresas clientes reales en `client_companies` (codigo_cliente 2–58), todas `activa=true`, `pendiente=false`
- Limpieza previa: eliminadas todas las facturas y usuarios de prueba; conservados solo Estudio Inghervi SLU (codigo_cliente=1) y sus 4 facturas reales
- Deduplicados 3 registros duplicados de la lista fuente (CONCEPT REFINISH x3, ANTONIO MORALES BAUTISTA x2, BERNARDO ECENARRO x2)
- CIF normalizado: `45556416v` → `45556416V`
- Limpiado perfil admin Julio (juliohesuni@gmail.com): company_name y company_nif puestos a NULL; is_admin conservado
- company_catalog reducido a 1 entrada (CONDEDU, S.A.U.) a petición del usuario

---

### 2026-04-11 — Sesión 16: Fix `codigo_cliente` en facturas de empresas registradas

**Problema corregido:**
El campo `codigo_cliente` (primera columna del panel de facturas) aparecía en blanco cuando la factura era subida por un usuario cuya `company_nif` no coincidía con ninguna empresa en `client_companies`, aunque el contenido de la factura (proveedor o receptor) sí correspondiera a una empresa registrada.

**Causa raíz:**
El JOIN en `/api/admin/facturas` vinculaba `codigo_cliente` exclusivamente a través de `users.company_nif`. Si el usuario subidor (e.g., el admin Julio con NIF B12345678) no tenía su NIF en `client_companies`, el JOIN fallaba y devolvía NULL aunque la empresa de la factura (e.g., ESTUDIO INGHERVI, B06400980) sí estuviera registrada.

**Solución implementada (`server.js`):**
- Se añade query paralela: `SELECT cif, codigo_cliente FROM client_companies WHERE codigo_cliente IS NOT NULL`
- Se construye un `Map<cif → codigo_cliente>` (ccMap)
- Tras computar `display_empresa_nif` (que ya determina correctamente qué empresa es la de la factura), si `codigo_cliente` sigue siendo NULL, se hace fallback buscando `display_empresa_nif` en el mapa
- Prioridad: JOIN por `users.company_nif` (más fiable) > fallback por contenido de factura

**Archivos modificados:**
- `app/backend/src/server.js` — endpoint `GET /api/admin/facturas`, ~líneas 2257-2300

---

### 2026-04-14 — Sesión 16: Admins multi-empresa + nuevo usuario Javier Novillo

**Cambios implementados:**
- `app/backend/src/server.js` — Migration: columna `client_company_id` en `uploads` (FK a `client_companies`)
- `app/backend/src/server.js` — `ADMIN_EMAILS_BOOTSTRAP` incluye `javier.novillo@setexextremadura.es`
- `app/backend/src/server.js` — `GET /api/me/settings` ahora devuelve `is_admin`
- `app/backend/src/server.js` — Nuevo endpoint `GET /api/client-companies` (lista empresas activas)
- `app/backend/src/server.js` — `POST /api/upload-preview`: admins con `client_company_id` usan esa empresa como contexto OCR (receptor)
- `app/backend/src/server.js` — `POST /api/upload-confirm`: receptor forzado a empresa cliente si admin; `client_company_id` guardado en BD
- `app/frontend/src/index.html` — Selector `<select>` de empresa cliente visible solo para admins
- `app/frontend/src/app.js` — Globals `userIsAdmin`, `clientCompanies`, `selectedClientCompanyId`; función `loadClientCompanies()`; pre-relleno receptor en modal; envío `client_company_id` en upload
- **BD (SQL directo)**: `users` Julio y Alberto → `company_name='Autoken'`; nuevo usuario `javier.novillo@setexextremadura.es` (admin, Setex Extremadura, contraseña bloqueada); añadido a `allowed_emails`

---

### 2026-04-09 — Sesión 15g: Edición inline de celdas en tabla de empresas

**Cambios implementados:**

- **`admin-facturas.js`**:
  - `initEmpresasTable`: columnas `codigo_cliente`, `nombre`, `cif`, `notas` ahora tienen `editor:'input'` de Tabulator v6 → edición inline directa al hacer click sobre la celda.
  - `onEmpresaCellEdited(cell)`: handler `cellEdited` de Tabulator que llama a `PUT /api/admin/client-companies/:id` con el campo modificado. Si hay error (validación local o API), llama a `cell.restoreOldValue()` y muestra toast de error.
  - `showEmpresaToast(msg, type)`: toast flotante verde/rojo (bottom-right) que desaparece a los 2.8s.
  - Columna `activa` (Estado): se activa/desactiva haciendo click directo en el badge (confirm dialog + `cell.getRow().update()`). Sin `editor`, con `cellClick`.
  - Columna Acciones: eliminados botones "✏️ Editar" y "⏸/▶ toggle" (redundantes); quedan solo "📂 Ver facturas" y "✕ Eliminar". Ancho reducido de 270 a 185px.
  - PersistenceID empresas bumped a `setex-admin-empresas-v4`.
- **`admin-facturas.css`**:
  - `.emp-cell-editable`: hover → fondo amarillo claro + borde naranja discontinuo. En edición activa → borde naranja sólido 2px.
  - `.emp-cell-toggle`: cursor pointer + hover verde claro para el badge de estado.
  - Cache-buster añadido: `admin-facturas.css?v=20260409-002`.
- **`admin-facturas.html`**: cache-buster JS bumped a `?v=20260409-002`.
- Frontend reconstruido y redesployado.

---

### 2026-04-09 — Sesión 15f: Campo `codigo_cliente` en empresas + columna ID en facturas

**Cambios implementados:**

- **`server.js` (initDB)**: `ALTER TABLE client_companies ADD COLUMN IF NOT EXISTS codigo_cliente VARCHAR(50) UNIQUE;` — columna única opcional por empresa.
- **`server.js` GET /api/admin/facturas**: añadido `LEFT JOIN client_companies cc ON ...` para incluir `cc.codigo_cliente` en la respuesta de cada factura.
- **`server.js` GET /api/admin/client-companies**: `codigo_cliente` incluido en el SELECT.
- **`server.js` POST /api/admin/client-companies**: acepta y guarda `codigo_cliente`. Error 409 diferenciado para CIF duplicado vs. código duplicado.
- **`server.js` PUT /api/admin/client-companies/:id**: acepta y actualiza `codigo_cliente`.
- **`admin-facturas.html`**: nuevo campo `emp-codigo` en el modal de empresa, entre CIF y Notas.
- **`admin-facturas.js`**:
  - Columna "ID" en facturas: cambiada de `field:'id'` a `field:'codigo_cliente'` con formatter monoespaciado y `—` para facturas sin empresa en la BD. PersistenceID bumped a `setex-admin-facturas-v8`.
  - Columna "Código" añadida como primera columna en la tabla de empresas. PersistenceID bumped a `setex-admin-empresas-v3`.
  - `_empEditar()`: rellena el campo `emp-codigo` con el valor actual.
  - `openNuevaEmpresaModal()`: limpia `emp-codigo`.
  - `saveEmpresa()`: incluye `codigo_cliente` en el body del POST/PUT.
- **`admin-facturas.html`**: cache-buster bumped a `?v=20260409-001`.
- Backend y frontend reconstruidos y redesployados (healthy).

---

### 2026-04-09 — Sesión 15d: Banner de instalación PWA (Android + iOS)

**Cambios implementados:**

- **`index.html`** — lógica completa de install prompt en el bloque `<script>` PWA:
  - `beforeinstallprompt` interceptado con `e.preventDefault()` → guarda el evento → muestra banner a los 1.5s.
  - Detección iOS (`/iphone|ipad|ipod/i`, no Chrome/Firefox en iOS) → muestra banner con instrucciones manuales a los 2s.
  - No se muestra si ya está instalada (`matchMedia('display-mode: standalone')` o `window.navigator.standalone`).
  - Si el usuario cierra (✕), guarda `pwa-install-dismissed` en `localStorage` → no vuelve a aparecer durante 7 días.
  - **Banner Android**: fondo `#2d3748`, logo SETEX SE naranja + TEX blanco, botón naranja "Instalar" → dispara `installEvt.prompt()` → diálogo nativo del sistema → si acepta, el banner desaparece.
  - **Banner iOS**: fondo `#2d3748`, pasos numerados: Compartir → "Añadir a pantalla de inicio" → Añadir.
  - El banner de **actualización** (nueva versión del SW) sigue en `z-index:99999`, el de instalación en `z-index:99998` → no se solapan.

---

### 2026-04-09 — Sesión 15e: Iconos PWA v4 — any + maskable separados, caché corregida

**Causa raíz del icono inconsistente entre móviles:**
1. Cache `immutable` de 30 días → móviles que habían descargado el icono azul no lo actualizaban nunca. Corregido a `max-age=86400` sin `immutable`.
2. El icono `maskable` usaba el mismo PNG que `any` (fondo con esquinas redondeadas). Los launchers Android modernos aplican su forma (círculo, squircle) sobre `maskable` → resultado inconsistente según launcher.
3. Algunos móviles tenían manifest.json cacheado con rutas a versiones anteriores.

**Cambios implementados:**
- 4 iconos nuevos generados con ImageMagick annotate (sin Pango):
  - `icon-192x192-v4.png` / `icon-512x512-v4.png` — `purpose: any` — fondo oscuro con `roundrectangle 80,80`, texto centrado (y≈282).
  - `icon-192x192-v4-maskable.png` / `icon-512x512-v4-maskable.png` — `purpose: maskable` — fondo sólido `#2d3748` sin esquinas, texto centrado en zona segura (80% interior). Los launchers recortan la forma y el fondo rellena limpiamente.
- `manifest.json`: 4 entradas separadas (any×2 + maskable×2). `background_color: #2d3748` para que la zona fuera del safe zone rellene con el mismo color oscuro.
- `nginx.conf`: caché iconos `max-age=86400` (sin `immutable`).
- `index.html`: `apple-touch-icon` apunta a v4.

---

### 2026-04-09 — Sesión 15c: Icono PWA corregido — SETEX multicolor (SE naranja + TEX blanco)

**Cambios implementados:**

- **`icons/icon.svg`**: reescrito. Fondo oscuro `#2d3748` con esquinas redondeadas rx=80. Texto "SETEX" centrado en `<text>` con `<tspan fill="#FF6600">SE</tspan><tspan fill="#ffffff">TEX</tspan>`. Font Helvetica Bold 130px.
- **`icons/icon-512x512.png`**: regenerado con ImageMagick + Pango markup (`-background none pango:'<span font="Helvetica Bold 115">...'`) → fondo oscuro redondeado, SE naranja, TEX blanco.
- **`icons/icon-192x192.png`**: resize del 512 al 192.
- Frontend reconstruido y redesployado (healthy).

---

### 2026-04-09 — Sesión 15b: PWA naranja + bloqueo horario offline + auto-update sin reinstalar

**Cambios implementados:**

**Bloqueo horario en modo offline (PWA instalada):**
- `service-worker.js`: función `isBlockedHours()` con `Intl.DateTimeFormat('es-ES', {timeZone:'Europe/Madrid'})` — si el usuario abre la app sin red entre 00:00 y 06:00, el SW devuelve una página de bloqueo en lugar del caché.
- Página de bloqueo: HTML inline generado por el SW (logo SE/TEX naranja, texto "El servicio está disponible de 06:00 a 00:00"), sin necesidad de fichero externo.
- Con red: el servidor ya devuelve 404 durante las horas bloqueadas → no hay acceso aunque el SW esté activo.
- Sin red + dentro del horario normal: sirve desde caché con normalidad.

**Auto-actualización sin reinstalar:**
- `service-worker.js`: listener `message` escucha `{ type: 'SKIP_WAITING' }` → activa el nuevo SW inmediatamente.
- `index.html`: la función `mostrarBannerActualizacion(worker)` muestra un banner naranja en la parte inferior cuando hay una nueva versión. Botón "Actualizar" envía `SKIP_WAITING` al nuevo SW → `controllerchange` → `window.location.reload()` automático. El usuario solo toca un botón; no necesita reinstalar ni borrar nada.
- `CACHE_NAME` actualizado a `setex-v2` para limpiar cachés anteriores en activate.

**Branding SETEX (SE naranja + TEX blanco):**
- `icons/icon.svg`: color de fondo `#1a73e8` (azul) → `#FF6600` (naranja SETEX).
- `icons/icon-192x192.png` e `icons/icon-512x512.png`: regenerados con ImageMagick con el nuevo color naranja.
- `manifest.json`: `theme_color` `#1a73e8` → `#FF6600`.
- `index.html`: `meta theme-color` → `#FF6600`. Los 3 `<h1>SETEX Facturas</h1>` → `<span class="setex-badge"><span class="se">SE</span><span class="tex">TEX</span></span>`.
- `styles.css`: nueva clase `.setex-badge` (badge oscuro `#2d3748`), `.setex-badge .se { color:#FF6600 }`, `.setex-badge .tex { color:#fff }`. Funciona sobre cualquier fondo.
- `admin-facturas.html`: `.login-logo` y `.logo` del header actualizados con la misma estructura `<span class="se">SE</span><span class="tex">TEX</span>`.
- `admin-facturas.css`: `.login-logo` → badge oscuro con SE naranja y TEX blanco. `.logo` en header → SE naranja, TEX blanco (el header ya era oscuro, sin badge).

---

### 2026-04-09 — Sesión 15: PWA instalable + mejoras UI modal factura + eliminación referencias IA

**Cambios implementados:**

**PWA (Progressive Web App):**
- **`src/manifest.json`** (nuevo): name "Setex Factu Capture", short_name "Setex", display standalone, theme_color #1a73e8, iconos 192px y 512px con purpose any/maskable.
- **`src/service-worker.js`** (nuevo): estrategia network-first para todos los assets estáticos; /api/* nunca cacheado; pre-cache del shell en install; limpieza de versiones antiguas en activate.
- **`src/icons/icon-192x192.png`** (nuevo): PNG 192×192 generado con ImageMagick desde SVG (fondo azul #1a73e8, S blanca).
- **`src/icons/icon-512x512.png`** (nuevo): PNG 512×512 generado con ImageMagick desde SVG.
- **`src/icons/icon.svg`** (nuevo): icono SVG fuente.
- **`index.html`**: añadidos meta tags PWA en `<head>` (manifest, theme-color, apple-mobile-web-app-*) y script de registro del SW antes de `</body>`.
- **`nginx.conf`**: 3 nuevas `location` blocks antes del wildcard `~*`: `= /service-worker.js` (no-cache + Service-Worker-Allowed: /), `= /manifest.json` (caché 1h), `/icons/` (caché 30d immutable). La restricción horaria 00:00-06:00 sigue activa sobre el SW.

**Mejoras UI modal de confirmación de factura:**
- Bloque receptor (nuestra empresa): layout horizontal → vertical.
- Nuevo bloque naranja agrupando Nº Factura + Proveedor + CIF del emisor.
- Auto-corrección error ×1000 de IVA (confusión coma/punto en OCR): función `corregirErrorFactor1000IVA()` en app.js.
- Botón IRPF: eliminado "(autónomo / persona física)".
- Campo IRPF: `align-items:flex-end` para alinear inputs cuando el label hace wrap.
- Mensaje error IVA: simplificado a "Base + IVA - IRPF no cuadra".
- Eliminado mensaje "Analizando factura..." (OCR es síncrono, el spinner lo cubre).

**Eliminación referencias a motores IA:**
- Eliminadas todas las menciones a "OpenAI", "Azure", "doble IA", "doble verificación" del UI.
- "OCR" → "IA" en títulos de modales y textos visibles al usuario.
- Banner de discrepancia: genérico, sin nombrar motores.

**Eliminación VIES + proveedores conocidos por NIF:**
- Eliminado UI de estado VIES del modal.
- Nueva tabla `known_cifs` + endpoint `GET /api/proveedor/:nif`: auto-rellena nombre del proveedor cuando el CIF ya fue confirmado antes por el mismo usuario.
- NIF-based lookup en `/api/upload-preview`: fallback a historial por NIF cuando el nombre no se reconoce.

---

### 2026-04-06 — Sesión 14: Whitelist de empresas clientes + panel de gestión

**Cambios implementados:**

- **Nueva tabla BD `client_companies`**: id, nombre, cif (UNIQUE), activa (bool), notas, created_at, updated_at. Con índices en cif y activa.
- **`server.js` — POST /api/auth/register**: sustituida whitelist `allowed_emails` por `client_companies`. Requiere `company_nif` en el body. Verifica que el CIF está en `client_companies WHERE activa=true`. Error 403 si no autorizado.
- **`server.js` — POST /api/auth/login**: verifica que la empresa del usuario sigue activa. Si `activa=false`, bloquea el login con 403 (excepto ADMIN_EMAILS).
- **4 nuevos endpoints CRUD** `/api/admin/client-companies`: GET (con stats: num_usuarios, total_facturas, ultima_factura), POST (crear), PUT (editar nombre/cif/activa/notas), DELETE (protegido: falla si hay usuarios registrados con ese CIF).
- **`server.js` — GET /api/admin/facturas + export.xlsx**: nuevo filtro `?company_nif=X` que filtra por todos los usuarios de esa empresa.
- **`admin-facturas.js`**: tab Empresas completamente reescrito — nueva Tabulator con columnas Empresa, CIF, Estado (activa/inactiva), Usuarios, Facturas, Última factura, Notas, Acciones. Botones: "Ver facturas" (filtra facturas por CIF de empresa), "Editar", "Activar/Desactivar", "Eliminar".
- **`admin-facturas.js`**: banner "Filtrando facturas de: EMPRESA (CIF)" en tab Facturas cuando se llega desde "Ver facturas". Botón "✕ Ver todas" para limpiar.
- **`admin-facturas.js`**: nuevo modal `#empresa-modal` para crear/editar empresas. Campos: nombre, CIF, notas.
- **`admin-facturas.html`**: tab Empresas con botón "+ Nueva empresa", modal de empresa, banner de filtro activo en tab Facturas. Cache-buster → `?v=20260406-001`.
- **`admin-facturas.css`**: nuevos estilos `.btn-tbl-ok`, `.btn-tbl-danger`, `.btn-tbl-del`.

**Arquitectura de seguridad:**
- Registro: `company_nif` requerido + verificado contra `client_companies`
- Login: empresa del usuario verificada como activa (skip para admins)
- Desactivar empresa → bloquea login de todos sus usuarios inmediatamente
- Eliminar empresa → solo posible si no hay usuarios registrados con ese CIF

---

### 2026-04-06 — Sesión 13: Empresa/contraparte correctas en dashboard + número de factura + recordar sesión

**Cambios implementados:**

- **`server.js` — helpers `normalizeCompanyName()` + `computeDisplayCompanies()`**: lógica de matching en 3 prioridades (CIF exacto → nombre normalizado → invoice_type). Devuelve `display_empresa`, `display_empresa_nif`, `display_contraparte`, `display_contraparte_nif`, `matched_side`, `match_confidence`.
- **`server.js` — POST /api/auth/login**: acepta `remember_me` (boolean). JWT 30 días si true, 1 día si false.
- **`server.js` — POST /api/upload-confirm**: acepta `confirmed_numero_factura` del modal (prioridad sobre OCR).
- **`server.js` — GET /api/admin/facturas**: añadido `numero_factura` al SELECT + se aplica `computeDisplayCompanies()` a cada fila antes de devolver.
- **`server.js` — PUT /api/admin/facturas/:id**: `numero_factura` añadido a campos editables.
- **`server.js` — GET /api/admin/facturas/export.xlsx**: columnas empresa/contraparte computadas + `numero_factura` + `receptor_*` incluidos en el SELECT.
- **`index.html`** (cache-buster v=20260406-001): checkbox "Mantener sesión iniciada" en login + campo `confirm-numero-factura` en modal (editable, antes del proveedor).
- **`app.js`**: helpers `getStoredToken()`, `storeToken()`, `clearStoredToken()` (sessionStorage vs localStorage). Login usa `remember_me`. `showConfirmModal()` rellena `numero_factura`. `confirmUpload()` envía `confirmed_numero_factura`. Columna "Nº Factura" en historial del usuario.
- **`admin-facturas.js`** (persistenceID v7): columnas `empresa_nombre`/`empresa_nif` eliminadas. Nuevas columnas `display_empresa`, `display_empresa_nif`, `display_contraparte`, `display_contraparte_nif` (todas editables). Función `getActualField()` traduce campo display → campo raw correcto según `matched_side`. Columna `numero_factura` añadida (editable).

**Regla de matching**: CIF exacto (alta confianza) → nombre normalizado sin S.L./S.A./tildes (media) → invoice_type como contexto (baja). Si no coincide nada, proveedor = Empresa y receptor = Contraparte.

---

### 2026-04-06 — Sesión 12: Bloqueo total 404 en horario restringido

**Cambios implementados:**

- **`server.js` — middleware restricción horaria**: cambiado de respuesta 503 a 404 durante el horario bloqueado (00:00–06:00 hora de Madrid). El log ahora incluye IP y ruta.

- **`server.js` — GET /api/internal/check-access**: nuevo endpoint interno para nginx `auth_request`. Devuelve 200 si el acceso está permitido, 404 si estamos en horario bloqueado. El middleware global actúa antes que el handler, por lo que la respuesta es coherente en ambas capas.

- **`nginx.conf`**: implementado `auth_request /api/internal/check-access` en los tres bloques de servicio de contenido:
  - `location ~* \.(html|js|css)$` — archivos estáticos
  - `location /api/` — endpoints de API
  - `location /` — SPA fallback
  - El subrequest `/api/internal/check-access` marcado como `internal` (no accesible externamente).
  - `location @bloqueado` devuelve HTML mínimo sin marca de servidor (no menciona nginx ni tecnología).
  - `return 404 ""` ignorado por nginx (sirve página por defecto igualmente) → solución: `default_type text/html` + body HTML explícito.

**Efecto**: durante 00:00–06:00 Madrid, cualquier petición (frontend HTML, JS, CSS o API) devuelve 404 con página genérica sin rastro de tecnología. La web aparece totalmente inexistente. Control de timezone delegado a Node.js (maneja DST correctamente).

---

### 2026-03-31 — Sesión 11: Modal ambas partes editable + dashboard admin IVA/IRPF completo

**Cambios implementados:**

- **`server.js` — GET /api/admin/facturas**: SELECT ampliado con `receptor_nombre`, `receptor_nif`, `base_imponible`, `iva_porcentaje`, `cuota_iva`, `irpf_porcentaje`, `cuota_irpf`, `invoice_type`. El dashboard admin ahora recibe y muestra todos estos campos.

- **`server.js` — POST /api/upload-confirm**: Acepta `confirmed_proveedor_nombre`, `confirmed_receptor_nombre`, `confirmed_receptor_nif`. El INSERT los usa con prioridad sobre los valores del OCR, permitiendo corrección manual de ambas partes desde el modal.

- **`admin-facturas.js`** — nuevas columnas Tabulator (persistenceID v6):
  - `TIPO` (badge ↓ Recibida / ↑ Emitida)
  - `Proveedor / Emisor` (antes: "Proveedor / Cliente")
  - `CIF Emisor` (antes: "CIF Prov/Cliente")
  - `Receptor / Cliente` (nueva, editable)
  - `CIF Receptor` (nueva, editable)
  - `Base Imp.` (nueva, editable)
  - `IVA %` (nueva, editable)
  - `Cuota IVA` (nueva, editable)
  - `IRPF %` (nueva, editable, muestra `—` si 0)
  - `Cuota IRPF` (nueva, editable, muestra `—` si 0)
  - Nuevos formatters: `formatEuroStr()`, `formatPct()`, `formatTipo()`
  - cache-buster: `admin-facturas.js?v=20260331-001`

- **`index.html`** — Modal de confirmación reestructurado (cache-buster v=20260331-007):
  - `#confirm-proveedor`: cambiado de div readonly a INPUT editable
  - Nueva sección `#confirm-receptor-section-label` con:
    - `#confirm-receptor-nombre` (input, nombre del receptor)
    - `#confirm-receptor-nif` (input, NIF/CIF del receptor, monoespaciado)
  - Fondo gris (#f0f4f8) para diferenciar visualmente "nuestra empresa" de la parte externa

- **`app.js`** — `showConfirmModal()` y `confirmUpload()`:
  - Labels adaptan para ambas secciones: "EMISOR (NUESTRA EMPRESA)" / "RECEPTOR / CLIENTE" para venta; "PROVEEDOR / EMISOR" / "RECEPTOR (NUESTRA EMPRESA)" para compra
  - Pre-relleno inteligente: para venta → proveedor se pre-rellena con `userCompanyName`/`userCompanyNif` si OCR lo dejó vacío; para compra → receptor se pre-rellena con datos empresa del usuario
  - `confirmUpload()` envía `confirmed_proveedor_nombre`, `confirmed_receptor_nombre`, `confirmed_receptor_nif` al backend

---

### 2026-03-31 — Sesión 10: Soporte completo IRPF + persona física + dashboard mejorado

**Cambios implementados:**

- **`ocr/openai.js`** — Soporte completo IRPF y NIF/NIE/CIF:
  - SYSTEM_PROMPT ampliado: sección de identificación NIF (persona física), NIE (extranjero), CIF (empresa)
  - `buildInvoicePrompt()`: bloque IRPF completo con todos los labels habituales (`"Ret. IRPF"`, `"R.I.R.P.F."`, `"Retención"`, `"% Ret."`, etc.), todos los tipos (2%, 7%, 15%, 19%, 24%), fórmula Total = Base + IVA − IRPF
  - Pista contextual: si `proveedor_nif` tiene formato NIF/NIE → buscar activamente retención IRPF

- **`ocr/validateIVA.js`** — Nueva Comprobación 5: validación IRPF:
  - Verifica tipos IRPF válidos en España [2, 7, 15, 19, 21, 24]
  - Verifica coherencia: `cuota_irpf = base × irpf_pct` (tolerancia ±0.05€)
  - `mergeLineasIva()` ya existente, sin cambios

- **`frontend/src/index.html`** — Cambios UX (cache-buster `v=20260331-006`):
  - Selector tipo factura INLINE (no overlay) con botones persistentes en upload-area
  - Sección IRPF en modal de confirmación: auto-visible si OCR detecta IRPF o si proveedor es persona física (NIF/NIE)
  - Botón "➕ Añadir retención IRPF" para activar manualmente
  - Botón ✕ para quitar IRPF si se añadió por error

- **`frontend/src/app.js`** — Reescritura completa de lógica tipo factura + dashboard:
  - Eliminado: overlay bloqueante `#type-select-overlay`, funciones `showTypeSelector()`, `hideTypeSelector()`, `selectInvoiceType()`, `pendingCaptureAction`
  - Añadido: `setInvoiceType(type)` — toggle visual inline, siempre visible, sin bloquear flujo
  - `capturePhoto()` → llama directamente a `doCapturePhoto()` sin pasar por selector
  - `showIRPFSection()` / `hideIRPFSection()` — control manual IRPF en modal
  - Auto-show IRPF en modal: si regex NIF (`/^\d{8}[A-Z]$/`) o NIE (`/^[XYZ]\d{7}[A-Z]$/`) → muestra sección IRPF automáticamente
  - **Nuevo `renderHistoryTable()`** con columnas: Nº | PROVEEDOR | TIPO ID | NIF/CIF | FECHA | BASE IMP. | IVA % | CUOTA IVA | IRPF % | CUOTA IRPF | TOTAL | COMPRA/VENTA | ✓ | IMG
  - **Badges tipo identificador**: [NIF] naranja, [NIE] morado, [CIF] azul — detectados por regex
  - **IRPF siempre visible** en tabla (columnas IRPF % y CUOTA IRPF muestran `—` cuando no aplica)
  - **Filas autónomo** (NIF/NIE): fondo naranja suave (#fffaf5/#fff7ed) para distinción visual
  - Helpers: `parseHistoryAmount(v)` — parser robusto formato español, `fmtEur(v)` — formato €, `detectTaxIdType(nif)` — clasificador NIF/NIE/CIF

- **Infraestructura**: frontend `healthy` tras rebuild (estaba `unhealthy` — resuelto)

### 2026-03-31 — Sesión 9: Implementación completa IVA desglosado + selector tipo factura + dual OCR context

**Cambios implementados:**

- **`ocr/validateIVA.js`** — NUEVO MÓDULO (7.7 KB):
  - `validateIVACoherencia(campos)` — validación matemática cruzada: base×tipo≈cuota (±0.05€), base+cuota-irpf≈total (±0.05€), coherencia lineas_iva, tipos IVA válidos España (0/4/5/10/21%)
  - `mergeLineasIva(openaiLineas, azureLineas)` — fusión inteligente de arrays multi-IVA de ambos motores (prioridad Azure si tiene más datos)
  - `parseSpanishAmount(str)` / `parsePercent(str)` — parsers robustos formato español (comas, puntos miles)
  - Tolerancia ±0.05€ para IVA simple, ±0.30€ para multi-IVA

- **`ocr/openai.js`** — REESCRITO COMPLETO:
  - Context `{ invoice_type, empresa_nif, empresa_nombre }` propagado desde server.js al prompt
  - Prompt dinámico `buildInvoicePrompt(context)`: para 'compra' indica quién es el proveedor (membrete superior), para 'venta' indica que el emisor es la propia empresa con NIF conocido
  - JSON Schema strict: `lineas_iva` (null | array {base, porcentaje, cuota}), `numero_factura` añadidos
  - Instrucción matemática en prompt: GPT-4.1 auto-verifica base+cuota_iva-cuota_irpf≈total antes de responder
  - `max_tokens: 1200` (incrementado para lineas_iva)

- **`ocr/azure.js`** — REESCRITO COMPLETO:
  - `locale: 'es-ES'` en POST body → mejora 10-15% en facturas españolas (fechas, importes, nombres)
  - `extractLineasIvaAzure(fields)` — itera `TaxDetails.valueArray` extrayendo Rate, Amount, BaseAmount por tipo de IVA
  - `extractIvaPorcentaje()` — lee TaxRate, TaxDetails (mayor cuota), fallback SubTotal/TotalTax
  - `numero_factura` desde campo `InvoiceId` de Azure DI
  - Swap proveedor/receptor en azure.js también (usando context.empresa_nif + context.invoice_type)
  - Timeout polling extendido a 45s

- **`ocr/index.js`** — REESCRITO COMPLETO:
  - Context propagado a ambos motores en modo dual y single
  - `mergeLineasIva` de validateIVA aplicado en fusión de resultados
  - `numero_factura` fusionado (openai || azure)
  - IVA: Azure prioritario (sin alucinaciones), IRPF solo OpenAI
  - Logs incluyen `lineasIva=${n}` por motor y en resultado fusionado

- **`server.js`** — MÚLTIPLES EDICIONES:
  - `invoice_type` leído desde `req.body.invoice_type` (FormData multer) — 'compra' (defecto) o 'venta'
  - Query user settings ampliada para obtener `company_name` además de `company_nif`
  - `ocrContext = { invoice_type, empresa_nif, empresa_nombre }` construido y pasado a `extractInvoiceOCR()`
  - Swap lógica post-OCR en server.js: si OCR confunde proveedor/receptor pese al context, auto-swap basado en `userCompanyNif`
  - `validateIVACoherencia(campos)` ejecutado tras swap → resultado incluido en preview como `iva_validation`
  - Preview response ampliada: `base_imponible, iva_porcentaje, cuota_iva, lineas_iva, irpf_porcentaje, cuota_irpf, receptor_nombre, receptor_nif, iva_validation`
  - `upload-confirm` acepta correcciones IVA: `confirmed_base_imponible, confirmed_iva_porcentaje, confirmed_cuota_iva, confirmed_irpf_porcentaje, confirmed_cuota_irpf`
  - INSERT incluye ahora 25 parámetros con `numero_factura, lineas_iva (JSONB), iva_validation_ok, iva_warnings (JSONB)`
  - `mis-facturas` devuelve nuevos campos IVA en historial

- **`frontend/src/index.html`** — REESCRITO:
  - `#type-select-overlay` (z-index:3000) — selector "Factura Recibida (📥)" / "Factura Emitida (📤)" antes de capturar
  - `#confirm-modal` ampliado: badge tipo factura, labels dinámicos PROVEEDOR/CLIENTE, sección IVA completa (base, %, cuota), sección IRPF oculta por defecto, tabla `#confirm-lineas-iva` para multi-IVA, `#confirm-iva-calc` cálculo en tiempo real, `#confirm-iva-status`
  - Cache-buster: `app.js?v=20260331-001`

- **`frontend/src/app.js`** — REESCRITO COMPLETO:
  - `selectedInvoiceType` + `pendingCaptureAction` — estado del selector de tipo
  - `showTypeSelector(action)` / `hideTypeSelector()` / `selectInvoiceType(type)` — flujo selector
  - Captura foto y selección archivo ahora pasan por selector de tipo primero
  - `updateIVACalc()` — validación matemática tiempo real en modal: base×%≈cuota, base+cuota-irpf≈total, auto-sugerencia cuota si solo hay base+%
  - `showConfirmModal()` renderiza badge tipo, labels dinámicos, lineas_iva en tabla, resultado iva_validation del backend
  - `confirmUpload()` envía correcciones IVA al backend
  - Historial ampliado: columnas `BASE IMP.`, `IVA %`, `CUOTA IVA`, `IVA OK` (✓/⚠)
  - `uploadFile()` incluye `invoice_type` en FormData

- **BD PostgreSQL** — columnas ya existentes verificadas: `lineas_iva JSONB`, `iva_validation_ok BOOLEAN`, `iva_warnings JSONB`, `invoice_type VARCHAR(20)` (todas presentes)

**Resultado:**
- OCR ahora extrae y valida matemáticamente: base imponible, % IVA, cuota IVA, IRPF, total, multi-IVA
- La selección previa de tipo factura elimina la confusión proveedor/receptor
- Validación cruzada detecta errores de alucinación antes de que el usuario confirme
- Datos guardados en PostgreSQL con coherencia matemática verificada

---

### 2026-03-31 — Sesión 8: Investigación OCR IVA múltiple + Informe técnico
**Cambios implementados:**

- **Nuevo documento**: `docs/INFORME_OCR_IVA_FACTURAS_ESPANOLAS.md` (11 secciones, ~600 líneas)
  - Análisis completo del problema de IVA múltiple (21%+10%+4%) en facturas españolas
  - Gaps identificados en openai.js y azure.js (schema plano, TaxDetails no iterado, locale hint ausente)
  - Propuesta de JSON Schema actualizado con array `lineas_iva` para multi-IVA
  - Propuesta de módulo `validateIVA.js` con validación cruzada matemática
  - Propuesta de función `extractLineasIvaAzure()` para iterar TaxDetails array
  - Análisis de separación proveedor/receptor: causas de confusión + técnicas de prompt engineering
  - Análisis completo de IRPF: tipos (15%, 7%, 2%, 19%), detección implícita, limitaciones Azure DI
  - Limitaciones documentadas por motor: GPT-4.1 (tabla 8 entradas) + Azure DI (tabla 9 entradas)
  - 20 preguntas del experto con respuestas investigadas
  - 10 recomendaciones priorizadas P0/P1/P2 con estimación de esfuerzo
- **Sin cambios de código**: sesión de investigación y planificación, no de implementación

### 2026-03-20 — Sesión 7: Dual AI (OpenAI + Azure DI) + Desconexión Drive/Sheets + Limpieza arquitectónica
**Cambios implementados:**

- **PaddleOCR eliminado**: directorio `/opt/setex-captu-facture/ocr-service/` eliminado (1.8 GB liberados). Archivos `paddleocr.js`, `gemini.js` eliminados.
- **Google Drive + Sheets desconectados completamente**: `googleDrive.js`, `googleSheets.js`, `googleAuth.js`, `formatters.js`, `invoiceWorker.js`, `n8nWorker.js` eliminados. Las facturas se guardan **solo en PostgreSQL** del VPS. No hay procesamiento asíncrono externo.
- **BullMQ eliminado**: `queue/index.js` simplificado a solo conexión Redis (sin Queue/Worker). Redis se mantiene para seguridad (sec:block:*, sec:count:*) y previews OCR (preview:*).
- **Azure DI activado**: secrets `azure_di_key.txt` y `azure_di_endpoint.txt` guardados en `/opt/setex-captu-facture/secrets/`. Endpoint: `https://setex-rg.cognitiveservices.azure.com/`.
- **ocr/index.js reescrito — Sistema Dual AI**: `extractInvoiceOCR()` lanza OpenAI GPT-4.1 + Azure Document Intelligence en `Promise.allSettled` simultáneamente. Función `compareOCRResults()` fusiona los resultados: si coinciden NIF + fecha + total → `dual_confirmed:true` (+15% confianza). Si discrepan → `nif_discrepancy` expuesto para que la lógica existente de dígito control + `extractCIFOnlyOCR` resuelva el árbitro. IRPF siempre de OpenAI (Azure no lo extrae). Modos en features.json: `"dual"` (defecto), `"openai"`, `"azure"`.
- **features.json**: eliminadas claves Drive/Sheets/n8n/gemini. Añadido `ocr_mode: "dual"`.
- **server.js — upload-confirm**: eliminado `n8nQueue.add()`. INSERT ahora incluye `n8n_sent=true` + `procesado_en=NOW()` + `invoice_type` + `ocr_result` con resultado dual completo (openai + azure + merged). ✓ aparece inmediatamente en el historial.
- **server.js — invoice_type**: nueva columna `uploads.invoice_type VARCHAR(10)`. Se detecta automáticamente en upload-preview comparando `users.company_nif` con `proveedor_nif` (venta) y `receptor_nif` (compra).
- **server.js — company_nif**: nueva columna `users.company_nif VARCHAR(20)`. Endpoints `GET/PUT /api/me/profile` para que el usuario configure su CIF de empresa.
- **server.js — system-health**: nuevo endpoint `GET /api/admin/system-health` (solo admin) con estado Redis, PostgreSQL (total uploads, uploads 24h, total users, failed_jobs pendientes), previews activas, IPs bloqueadas y modo OCR activo.
- **server.js — OCR engine**: `VALID_ENGINES` ampliado a `['openai', 'azure', 'dual']`. Admin puede cambiar modo en caliente vía panel.
- **server.js — admin edit**: eliminada sincronización con Google Sheets en `PUT /api/admin/facturas/:id`.
- **app.js**: overlay "Configura tu empresa" en primera sesión (CIF/NIF). Historial muestra badge compra↓/venta↑ por factura. Mensaje OCR actualizado a "Analizando con doble IA (OpenAI + Azure)". `startStatusPolling()` eliminado (procesamiento ya es síncrono — ✓ aparece inmediatamente).
- **index.html**: overlay `#company-nif-overlay` añadido. Cache-buster → `app.js?v=20260320-001`.
- **Frontend health**: `setex-frontend` ahora en estado **healthy** (resuelto).
- **Disco**: 73 GB libres (de 96 GB). Consumo al 25%.

### 2026-03-18 — Sesión 6b: Empresas tab + Todos los campos editables + Sheets sync + CSRF + Responsive + CIF unificado
**Cambios implementados:**

- **security.json**: `max_requests` reducido de 400 a 100 req/5min (estándar OWASP). Efecto inmediato sin rebuild.
- **googleSheets.js**: nueva función `updateRow(rowNumber, fields, spreadsheetId, sheetName)`. `appendRow()` ahora devuelve `rowNumber` parseado del `updatedRange` ("Facturas!A121:P121" → 121). Mapa `DB_TO_SHEETS_KEY` para traducir campos BD a columnas Sheets (incluye `total_factura` → `total`).
- **invoiceWorker.js**: guarda `sheets_row` en `uploads` tras cada append exitoso a Sheets.
- **server.js — initDB**: nuevas columnas `uploads.sheets_row INTEGER` y `users.company_name VARCHAR(255)`.
- **server.js — startup**: migración automática `known_cifs → company_catalog` (ON CONFLICT DO NOTHING — no sobreescribe entradas admin).
- **server.js — `backupSecurityConfig()`**: nueva función que hace backup de security.json a `.bak` antes de cada escritura desde el panel. Llamada en todos los endpoints que modifican security.json.
- **server.js — `requireXHR()`**: middleware CSRF defense. Verifica header `X-Requested-With: XMLHttpRequest` en todos los endpoints admin de estado (POST/PUT/DELETE/PATCH). Con JWT en Authorization header el riesgo CSRF ya es bajo, pero añade defensa en profundidad.
- **server.js — `PUT /api/admin/facturas/:id`**: añadido `requireXHR`. Tras actualizar BD, si el upload tiene `sheets_row`, llama a `updateRow()` en Sheets. Devuelve `sheets_synced: true` si sincronizó.
- **server.js — endpoints de seguridad**: todos los endpoints de escritura (blacklist/whitelist/time) añaden `requireXHR` y llaman a `backupSecurityConfig()`.
- **server.js — endpoints de catálogo**: `POST /catalog` y `DELETE /catalog/:id` añaden `requireXHR`.
- **server.js — `GET /api/admin/facturas`**: incluye `COALESCE(us.company_name, us.email) AS empresa_nombre` y `u.sheets_row`.
- **server.js — `GET /api/admin/facturas/export.csv`**: CSV simplificado con solo 8 columnas (Empresa, Proveedor, CIF, Fecha, Total, IVA%, Cuota IVA, Subido el).
- **server.js — `GET /api/admin/users`**: nuevo endpoint. Lista usuarios con company_name, total_facturas, ultima_factura. Para pestaña Empresas.
- **server.js — `PUT /api/admin/users/:id`**: nuevo endpoint. Actualiza `company_name` del usuario. Con `requireXHR`.
- **server.js — upload-confirm**: tras actualizar known_cifs, también hace UPSERT en company_catalog (aprendizaje global, ON CONFLICT DO NOTHING para no sobreescribir entradas admin).
- **admin-facturas.html**: eliminado hint "✏️ Doble clic en una celda para editar". Añadida pestaña "Empresas" en nav y contenido del tab. Modal de "Renombrar empresa" con input hidden user_id.
- **admin-facturas.js**: reescrito. `authFetch()` helper que añade automáticamente `X-Requested-With` y `Authorization` a todas las llamadas. EDITABLE_FIELDS ahora incluye `irpf_porcentaje`, `cuota_irpf`. Columnas IVA%, Cuota IVA, IRPF%, Cuota IRPF, Moneda ahora usan `makeEditableFormatter()`. Nueva columna "Empresa" (empresa_nombre). Tabulator v2→v3 persistence ID. `responsiveLayout: "collapse"` con prioridades responsive por columna. Tab Empresas: `loadEmpresas()`, `renderEmpresas()`, `openRenameModal()`, `saveRename()`, `initRenameModal()`. Click "Ver facturas" en tarjeta de empresa → filtra tab Facturas.
- **admin-facturas.css**: estilos para `.empresas-grid`, `.empresa-card`, `.empresa-badge-unnamed`. Media queries completas para 1200px, 900px, 768px, 480px. Compatible iOS Safari, Android Chrome, macOS Safari, Linux Firefox.
- **scripts/migrate-uploads.js**: nuevo script para reorganizar archivos históricos de `/uploads/filename` a `/uploads/{email_prefix}/{nif}/filename`. Actualiza `file_path` en BD. Ejecutar con: `docker exec setex-backend node /app/scripts/migrate-uploads.js`.

### 2026-03-18 — Sesión 6: Panel Admin completo + Sistema de Seguridad + Catálogo de Empresas + Mejoras OCR
**Cambios implementados:**

- **Panel Admin (admin-facturas.html)**: rediseño completo con 3 pestañas (Facturas / Catálogo / Seguridad), formulario de login integrado (acceso directo sin pasar por la app principal), modal de edición inline de celdas.
- **Panel Admin (admin-facturas.js)**: reescrito con sistema de tabs, Tabulator 6.3 auto-hosted, `openEditModal()` / `saveEdit()` → `PUT /api/admin/facturas/:id`, gestión de catálogo de empresas y gestión de seguridad IP.
- **Panel Admin (admin-facturas.css)**: añadidos estilos nav-tabs, section-card, data-table, security-grid (2 columnas), ip-list, edit-cell-btn, modal overlay.
- **Tabulator.js**: archivos `tabulator.min.js` (442 KB) y `tabulator.min.css` (29 KB) self-hosted por requerimiento CSP `script-src 'self'`.
- **Sistema de Seguridad (security.json)**: nuevo archivo de configuración dinámica recargado cada 30s sin rebuild. Equivalente .htaccess con: restricción horaria 00:00–06:00 Madrid, whitelist/blacklist de IPs con soporte CIDR, auto-bloqueo por tasa de peticiones (400 req/5min → 60 min bloqueo), límite de 350 usuarios.
- **server.js — Middleware de seguridad**: dos capas middleware: (1) whitelist/blacklist/horario/auto-bloqueo usando Redis `sec:block:{IP}` y `sec:count:{IP}`, (2) mismo middleware sobre `/api/`. Función `ipInList()` con matching CIDR bitwise correcto. Función `isRestrictedHour()` con `Intl.DateTimeFormat` para timezone Europe/Madrid.
- **server.js — 12 nuevos endpoints admin**: GET/POST/DELETE seguridad (whitelist, blacklist, auto-blocked), GET/POST/DELETE catálogo de empresas, PUT facturas/:id (edición inline).
- **server.js — Catálogo de empresas**: tabla `company_catalog` con pg_trgm fuzzy matching (similarity > 0.50). Si el nombre extraído por OCR coincide con una empresa pre-registrada, el CIF se toma del catálogo y se elimina incertidumbre → flujo auto-confirm sin modal.
- **server.js — Auto-confirm mejorado**: `autoConfirm` requiere `!requiresReview && userAutoConfirmPref && (knownProvider || digitCheck === true)`. Fix bug donde `missingFields` y `nifUncertain` se calculaban antes del lookup en known_cifs → añadido bloque de limpieza post-lookup.
- **server.js — Organización de archivos**: `upload-confirm` ahora mueve el archivo a `/uploads/{email_prefix}/{nif}/filename` tras confirmación. Directorio creado con `fs.mkdir recursive`.
- **server.js — Max usuarios**: cap de 350 usuarios en el registro. Configurable en security.json (`max_users`).
- **nginx.conf**: añadido `limit_req_zone` (10 req/s) y `limit_conn_zone` (50 conn/IP) aplicados a `/api/`. Rate limiting hardware-level en el proxy Nginx.
- **openai.js — CIF crop**: crop de la imagen enfocado en CIF ampliado de 45% a 65% de alto para evitar cortar el área del CIF en fotos parciales. Calidad JPEG del crop subida de 92% a 95%. Añadido `.sharpen()` al crop.
- **styles.css — Cámara**: guía de encuadre ampliada de 80%×70% a 92%×82% para dar más visibilidad al área de captura.
- **index.html**: cache-buster actualizado a `app.js?v=20260318-002`.
- **Infraestructura**: pg_trgm extension habilitada en PostgreSQL, tabla `company_catalog` creada con índice GIN. Columna `file_path VARCHAR(500)` añadida a `uploads`.

### 2026-03-17 — Sesión 5: Campos OCR completos en BD + auto-confirm por usuario + exportación CSV + polling + retry admin
**Cambios implementados:**

- **openai.js**: eliminado `forma_pago` del INVOICE_PROMPT, del json_schema properties y del required array. El campo no aportaba valor fiscal y generaba ruido.
- **server.js — initDB**: añadidas columnas con ALTER TABLE IF NOT EXISTS:
  - `users.auto_confirm_enabled BOOLEAN DEFAULT true` — preferencia por usuario
  - `uploads.proveedor_nombre VARCHAR(255)` — nombre legible del emisor
  - `uploads.receptor_nombre VARCHAR(255)` y `receptor_nif VARCHAR(20)` — datos del receptor
  - `uploads.base_imponible`, `iva_porcentaje`, `cuota_iva`, `irpf_porcentaje`, `cuota_irpf` — desglose fiscal completo
  - `uploads.moneda VARCHAR(5)` — divisa (EUR por defecto)
  - `uploads.drive_file_id VARCHAR(100)` — ID del archivo en Google Drive
  - `uploads.procesado_en TIMESTAMP` — timestamp de procesamiento en Drive/Sheets
  - `failed_jobs.retried_at TIMESTAMP` — timestamp de reintento manual
- **server.js — upload-preview**: lee `auto_confirm_enabled` del usuario antes de calcular `autoConfirm`. Si el usuario tiene Auto OFF, nunca se produce auto-confirmación aunque la confianza sea alta.
- **server.js — upload-confirm**: INSERT ampliado con 18 columnas. PostgreSQL es ahora la fuente de verdad primaria con todos los campos OCR como columnas independientes (proveedor_nombre, receptor_nif, receptor_nombre, base_imponible, iva_porcentaje, cuota_iva, irpf_porcentaje, cuota_irpf, moneda).
- **server.js — GET /api/mis-facturas**: SELECT ampliado devuelve proveedor_nombre, receptor_nombre, receptor_nif, base_imponible, moneda, drive_file_id y procesado_en.
- **Nuevo endpoint GET /api/mis-facturas/export.csv**: exporta todas las facturas del usuario como CSV con BOM UTF-8 para compatibilidad Excel. 18 columnas, nombre de archivo con fecha.
- **Nuevo endpoint GET /api/me/settings**: devuelve preferencias del usuario (auto_confirm_enabled).
- **Nuevo endpoint POST /api/me/settings**: actualiza preferencias del usuario con validación y audit log.
- **Nuevo endpoint POST /api/admin/retry-failed/:id**: permite a admins reintentar manualmente un job fallido. Marca `retried_at` para evitar dobles reintento. Re-encola en BullMQ.
- **invoiceWorker.js**: al completar el job, guarda `drive_file_id` y `procesado_en = NOW()` en la tabla uploads. Antes solo actualizaba `n8n_sent`.
- **app.js**: variables globales `autoConfirmUserPref` y `statusPollTimer`. Funciones `loadUserSettings()`, `toggleAutoConfirm()`, `updateAutoConfirmBtn()`, `startStatusPolling()`. showMainScreen() llama a loadUserSettings(). uploadFile() respeta `autoConfirmUserPref`. Tras guardar (auto o manual) arranca polling de 15s × 20 ticks (5 min) para refrescar historial cuando el ⏳ cambia a ✓. loadHistory() muestra proveedor_nombre en lugar del NIF.
- **index.html**: botón ⚡ Auto: ON/OFF en el header junto al botón Salir. Cache-buster actualizado a `app.js?v=20260317-003`.

### 2026-03-17 — Sesión 4b: Historial + failed_jobs + numero_factura eliminado
**Cambios implementados:**
- **Eliminar numero_factura**: campo eliminado del OCR prompt/schema, del modal HTML, del frontend JS y del INSERT en BD. El campo DB se conserva para datos históricos pero ya no se procesa.
- **Historial de facturas**: `GET /api/mis-facturas` devuelve los últimos 50 registros de los últimos 7 días del usuario. Frontend muestra la lista en la pantalla principal con NIF, fecha, total e icono de estado (✓ procesado / ⏳ pendiente). Se refresca automáticamente tras cada factura guardada.
- **Dead letter queue (failed_jobs)**: tabla `failed_jobs` creada con columnas upload_id, user_id, filename, error_message, attempts, job_data. El worker BullMQ guarda ahí las facturas que agotan los 3 reintentos sin éxito. Disponible para revisión manual por admin.
- **Cache-buster**: `app.js?v=20260317-002`

### 2026-03-17 — Sesión 4: Auto-confirm + OCR result en BD + flujo sin modal
**Cambios implementados:**
- **Auto-confirm flow**: facturas con alta confianza se procesan sin que el usuario vea ningún modal
  - Criterios de alta confianza: sin discrepancia entre lecturas OCR + dígito control correcto + proveedor conocido o dígito explícitamente OK
  - Resultado: usuarios que operan con proveedores recurrentes → flujo de 1 solo tap (foto → guardado)
- **Modal solo en casos necesarios**: solo aparece cuando CIF incierto, campos faltantes o dígito control falla
  - Modal actualiza título/descripción dinámicamente según el motivo de revisión
  - Campos faltantes destacados en rojo con placeholder "obligatorio"
- **OCR result en PostgreSQL**: columna `ocr_result JSONB` en tabla `uploads`
  - Permite análisis posterior de calidad OCR, debugging, y mejoras futuras
  - Se guarda siempre que la factura se confirma (manual o auto)
- **confidence_level en BD**: columna `confidence_level VARCHAR(10)` en `uploads` (high/medium/low)
- **Fix crash null NIF**: `campos.proveedor_nif` puede ser null ahora sin romper known_cifs ni VIES
- **VIES solo para CIFs**: VIES se consulta únicamente si el NIF tiene formato empresa (no para NIFs de persona)
- **Campos faltantes → modal** (antes eran error+borrado de archivo): imagen se preserva, usuario puede completar manualmente
- **numero_factura enviado en auto-confirm**: antes se perdía al auto-confirmar
- **known_cifs columna user_id asegurada**: `ALTER TABLE known_cifs ADD COLUMN IF NOT EXISTS user_id` — garantiza que las queries no fallen aunque la tabla existiera antes
- **auditLog mejorado**: registra si fue auto_confirmed o confirmed_by_user + confidence_level
- **Cache-buster frontend**: `app.js?v=20260317-001`

**Estado del flujo tras estos cambios:**
```
OCR (2-5s) → confidence check →
  HIGH: auto-confirm directo → "Factura guardada ✓" (sin modal)
  MEDIUM: modal con campos pre-rellenos → usuario confirma con 1 tap
  LOW (campos faltantes): modal con campos en rojo → usuario completa → confirma
```

### 2026-03-12 — Sesión 3: Sistema anti-fallo CIF + flujo de confirmación
**Cambios implementados:**
- Sistema OCR de doble pasada paralela (`Promise.all` extractInvoiceOCR + extractCIFOnlyOCR)
- Algoritmo dígito de control CIF/NIF (AEAT) en backend y frontend
- Nuevo endpoint `POST /api/upload-preview` (OCR → Redis preview, TTL 30min)
- Nuevo endpoint `POST /api/upload-confirm` (validación → BD → BullMQ)
- Nuevo endpoint `GET /api/vies/:nif` (consulta VIES pública, sin autenticación)
- Modal de confirmación completo en frontend (CIF editable, VIES async, proveedor conocido)
- Tabla `known_cifs` con `user_id` para aislamiento multicliente
- Validación fiscal completa en frontend: NIF (módulo 23), NIE, CIF (dígito control)
- VIES consulta asíncrona (modal abre inmediatamente, badge VIES se actualiza en background)
- Campo `numero_factura` en OCR schema, BD, modal y BullMQ payload
- Fixes iOS Safari: momentum scroll, safe-area, anti-zoom inputs, touch-action
- Rate limiter `confirmLimiter` (60/15min) para `/api/upload-confirm`
- Job limpieza horaria de archivos huérfanos en `/app/uploads/`
- Migración DB: `user_id` a `known_cifs`, nuevo índice único por usuario
- `maxlength="9"` en input CIF del modal

### 2026-04-16 — Limpieza Google Drive/Sheets/n8n + seguridad backups
**Eliminación completa de integraciones obsoletas:**
- Eliminado `retry-failed.js` (utilidad BullMQ — sin uso)
- Eliminado `scripts/renew-oauth2.js` y `renew-oauth2-interactive.js` (renovación OAuth2 Google)
- Eliminado `googleapis` y `bullmq` de `package.json`
- Limpiado `config/index.js`: eliminados defaults `use_n8n`, `google_drive_folder_id`, `google_sheets_*`
- Eliminado `CREATE TABLE google_tokens` de initDB (tabla legacy)
- Eliminado `ALTER TABLE uploads ADD drive_file_id` y `sheets_row` de initDB
- Eliminado índice `idx_uploads_drive_cleanup` de initDB
- Eliminada función `cleanLocalDriveFiles()` del cleanup scheduler
- Eliminado `n8n_sent` del INSERT en upload-confirm (ya no se escribe)
- Migrado filtro admin: `n8n_sent=true/false` → `procesado_en IS NOT NULL / IS NULL`
- Backfill migration: `UPDATE uploads SET procesado_en=uploaded_at WHERE n8n_sent=true AND procesado_en IS NULL`
- Eliminado `drive_file_id` y `n8n_sent` de SELECT en `/api/mis-facturas`
- Eliminado `drive_file_id`, `n8n_sent`, `sheets_row` de SELECT en admin facturas
- Eliminado `Drive ID` y `Enviado` de exports Excel (usuario y admin)
- Eliminado `sheets_row` de RETURNING en PUT admin facturas
- Frontend: eliminados links a Google Drive en `app.js` y `admin-facturas.js`
- Frontend: eliminada referencia a `sheets_synced`, renombrado `.drive-link` → `.img-link`
- Frontend: columna Estado ahora usa `procesado_en` en vez de `n8n_sent`
- Limpiados comentarios n8n en `docker-compose.yml` (red `n8n_default` se mantiene — usada por Traefik)

**Mejoras de seguridad en backups:**
- Backups PostgreSQL ahora cifrados con GPG (AES-256) + verificación de integridad automática
- Passphrase segura en `/opt/setex-captu-facture/secrets/backup_passphrase.txt` (chmod 600)
- Backups antiguos sin cifrar eliminados automáticamente al primer backup cifrado
- Script `backup-download.sh` para descarga local con instrucciones de descifrado
- Logrotate configurado en `/etc/logrotate.d/setex` para watchdog, permissions y backup logs (weekly, 4 rotaciones, maxsize 10M)

### 2026-04-16 — Auditoría sección 19: verificación acciones pendientes
- Verificado Paso 1 (HAL-008): Redis con contraseña operativa — `redis.conf` read-only, password vía Docker secret, NOAUTH confirmado sin credenciales
- Verificado Paso 2 (HAL-006): SMTP migrado a Docker secrets — `smtp_user`/`smtp_pass` en `/run/secrets/`, variables de entorno eliminadas
- Verificado Paso 3 (HAL-011): Red `setex_internal` aislada — Postgres/Redis/Backend solo en red interna, n8n sin acceso
- Verificado Paso 4 (HAL-012): `extra_hosts` eliminado de docker-compose.yml
- Verificado Paso 5: Log rotation Docker activo en los 4 servicios (`json-file` + `max-size`/`max-file`)
- Verificado Paso 6: SSH seguro — `PasswordAuthentication no`, `PermitRootLogin prohibit-password`
- Verificado Paso 7: Backups PostgreSQL automáticos — cron 3:00 AM, 7 backups presentes, último hoy 2026-04-16
- Actualizada tabla de estado en sección 19: los 7 pasos marcados como ✅ Resuelto

### 2026-03-10 — Sesión 2: Fix OAuth2 + retry jobs fallidos
**Cambios implementados:**
- App OAuth2 publicada (de "Testing" a "Published") — refresh_token ya no expira cada 7 días
- Tabla `google_tokens` en PostgreSQL para persistir tokens OAuth2
- Auto-renovación access_token cada 45 minutos via `setInterval`
- Retry de 2 jobs fallidos — facturas procesadas correctamente a Drive + Sheets

### 2026-03-02 — Sesión 1: Auditorías y documentación
**Análisis realizados:**
- Stress test completo (concurrencia x1 a x20) → INFORME_CAPACIDAD_Y_RENDIMIENTO.md
- Auditoría de seguridad completa → INFORME_SEGURIDAD.md
- Análisis regulatorio Verifactu → INFORME_VERIFACTU.md

---

## 19. GUÍA DE HARDENING — ACCIONES PENDIENTES PARA JULIO

Esta sección contiene exactamente qué ejecutar, en qué orden, y por qué. Cada paso es atómico y seguro.

---

### PASO 1 — Redis con contraseña (HAL-008) 🔴 CRÍTICO
**Por qué:** Redis está sin contraseña en una red compartida con n8n. Cualquier proceso de esa red puede leer/escribir datos de sesión, saltarse el rate limiting, y leer previews de facturas en proceso.

**Tiempo estimado: 10 minutos**

**1.1 — Genera una contraseña segura:**
```bash
! openssl rand -hex 32
```
Copia el resultado (ejemplo: `a3f8c2...`). Lo llamaremos `REDIS_PASS`.

**1.2 — Crea el fichero secret:**
```bash
! echo -n "REDIS_PASS_AQUI" > /opt/setex-captu-facture/secrets/redis_password.txt
! chmod 600 /opt/setex-captu-facture/secrets/redis_password.txt
```

**1.3 — Edita `docker-compose.yml`** (`/opt/setex-captu-facture/app/docker-compose.yml`):

En la sección `redis:`, cambia el `command:`:
```yaml
  redis:
    command: redis-server --requirepass REDIS_PASS_AQUI --maxmemory 128mb --maxmemory-policy allkeys-lru --save 60 1
```
(Sustituye `REDIS_PASS_AQUI` por tu contraseña real, o usa la variable via secrets)

En la sección `backend:`, cambia la variable `REDIS_URL`:
```yaml
    environment:
      REDIS_URL: redis://:REDIS_PASS_AQUI@redis:6379
```

En la sección `secrets:` (al final del fichero), añade:
```yaml
secrets:
  redis_password:
    file: /opt/setex-captu-facture/secrets/redis_password.txt
  # ... resto de secrets existentes
```

**1.4 — Redeploy:**
```bash
! cd /opt/setex-captu-facture/app && docker compose stop redis backend && docker compose up -d redis backend && sleep 10 && docker compose logs backend --tail=5
```

**1.5 — Verifica:**
```bash
! docker exec setex-redis redis-cli -a REDIS_PASS_AQUI ping
```
Debe responder `PONG`.

---

### PASO 2 — SMTP a Docker secrets (HAL-006) 🟠 ALTO
**Por qué:** `SMTP_PASS` está en `.env` (texto plano en disco). Docker secrets es más seguro.

**Tiempo estimado: 10 minutos**

**2.1 — Crea los ficheros secret:**
```bash
! echo -n "xanfla95@gmail.com" > /opt/setex-captu-facture/secrets/smtp_user.txt
! echo -n "TU_APP_PASSWORD_GMAIL" > /opt/setex-captu-facture/secrets/smtp_pass.txt
! chmod 600 /opt/setex-captu-facture/secrets/smtp_user.txt /opt/setex-captu-facture/secrets/smtp_pass.txt
```

**2.2 — Edita `docker-compose.yml`**, en la sección `backend:`:

Elimina las líneas:
```yaml
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
```

Añade en la sección `secrets:` del servicio backend:
```yaml
    secrets:
      - smtp_user
      - smtp_pass
      # ... otros secrets existentes
```

Añade en la sección global `secrets:`:
```yaml
  smtp_user:
    file: /opt/setex-captu-facture/secrets/smtp_user.txt
  smtp_pass:
    file: /opt/setex-captu-facture/secrets/smtp_pass.txt
```

**2.3 — Actualiza `server.js`** para leer SMTP desde secrets (yo lo haré cuando confirmes este paso).

---

### PASO 3 — Red interna dedicada (HAL-011) 🟠 ALTO
**Por qué:** Backend, Postgres y Redis están en la misma red que n8n. Si n8n es comprometido, tiene acceso directo a Redis (sin auth) y Postgres.

**Tiempo estimado: 20 minutos (requiere testing)**

**3.1 — Edita `docker-compose.yml`**. Cambia la sección `networks:` al final del fichero:
```yaml
networks:
  n8n_default:
    external: true
  setex_internal:
    driver: bridge
    internal: true
```

**3.2 — Cambia las redes de cada servicio:**

`postgres:` — solo red interna:
```yaml
    networks:
      - setex_internal
```

`redis:` — solo red interna:
```yaml
    networks:
      - setex_internal
```

`backend:` — solo red interna (se comunica con frontend via nginx proxy):
```yaml
    networks:
      - setex_internal
```

`frontend:` — ambas redes (necesita estar en n8n_default para que Traefik lo descubra):
```yaml
    networks:
      - setex_internal
      - n8n_default
```

**3.3 — Redeploy completo:**
```bash
! cd /opt/setex-captu-facture/app && docker compose down && docker compose up -d && sleep 15 && docker compose ps
```

**3.4 — Verifica que el sistema funciona:**
```bash
! curl -sk https://setex-facturas.es/health | head -5
```

**3.5 — Verifica que n8n NO puede alcanzar Redis:**
```bash
! docker exec n8n-n8n-1 redis-cli -h redis ping 2>&1 || echo "✓ Redis NO alcanzable desde n8n"
```

---

### PASO 4 — Eliminar extra_hosts (HAL-012) 🟡 MEDIO
**Por qué:** El backend puede hacer peticiones al host físico (SSRF interno). No hay uso funcional documentado.

**Tiempo estimado: 5 minutos**

**4.1 — Verifica que nada usa `host.docker.internal`:**
```bash
! grep -r "host.docker.internal" /opt/setex-captu-facture/app/backend/src/
```
Si no hay resultados, es seguro eliminarlo.

**4.2 — Edita `docker-compose.yml`**, elimina estas líneas del servicio `backend:`:
```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

**4.3 — Redeploy:**
```bash
! cd /opt/setex-captu-facture/app && docker compose stop backend && docker compose up -d backend
```

---

### PASO 5 — Rotación de logs Docker (limitar logs de contenedores)
**Por qué:** Los logs de Docker (distintos de Winston) no tienen límite. Pueden crecer indefinidamente.

**Tiempo estimado: 5 minutos**

**5.1 — Edita `docker-compose.yml`**, añade a cada servicio (postgres, backend, redis, frontend):
```yaml
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

**5.2 — Redeploy completo para aplicar:**
```bash
! cd /opt/setex-captu-facture/app && docker compose down && docker compose up -d
```

---

### PASO 6 — Verificar SSH (seguridad del servidor)
**Por qué:** Si SSH acepta contraseñas, el servidor puede ser atacado por fuerza bruta.

**6.1 — Verifica la configuración SSH:**
```bash
! grep "PasswordAuthentication\|PubkeyAuthentication\|PermitRootLogin" /etc/ssh/sshd_config
```

**Si `PasswordAuthentication yes`:** Debes cambiarlo a `no` (asegúrate de tener clave SSH configurada primero).

**6.2 — Verifica si hay intentos de fuerza bruta activos:**
```bash
! grep "Failed password\|Invalid user" /var/log/auth.log 2>/dev/null | tail -20
```

---

### PASO 7 — Backups automáticos de PostgreSQL
**Por qué:** Sin backup, un fallo de disco o error humano destruye todos los datos de facturas.

**7.1 — Crea el script de backup:**
```bash
! cat > /opt/setex-captu-facture/scripts/backup-postgres.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/setex-captu-facture/backups/postgres"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
docker exec setex-postgres pg_dump -U setex_user setex_db | gzip > "$BACKUP_DIR/setex_db_$DATE.sql.gz"
# Mantener solo los últimos 7 backups
ls -t "$BACKUP_DIR"/*.sql.gz | tail -n +8 | xargs rm -f 2>/dev/null
echo "Backup completado: setex_db_$DATE.sql.gz"
EOF
chmod +x /opt/setex-captu-facture/scripts/backup-postgres.sh
```

**7.2 — Programa el backup diario con cron:**
```bash
! crontab -e
```
Añade esta línea (backup cada día a las 3:00 AM):
```
0 3 * * * /opt/setex-captu-facture/scripts/backup-postgres.sh >> /opt/setex-captu-facture/logs/backup.log 2>&1
```

**7.3 — Verifica que funciona:**
```bash
! /opt/setex-captu-facture/scripts/backup-postgres.sh
! ls -lh /opt/setex-captu-facture/backups/postgres/
```

---

### ESTADO ACTUAL TRAS IMPLEMENTAR TODO

| Paso | Hallazgo | Estado |
|:---|:---|:---:|
| Paso 1 | Redis con contraseña | ✅ Resuelto (redis.conf read-only + secret, FLUSHALL/DEBUG disabled) |
| Paso 2 | SMTP en Docker secrets | ✅ Resuelto (smtp_user + smtp_pass en /run/secrets/) |
| Paso 3 | Red interna dedicada | ✅ Resuelto (setex_internal aislada, solo frontend en n8n_default) |
| Paso 4 | Eliminar extra_hosts | ✅ Resuelto (HAL-012 eliminado) |
| Paso 5 | Log rotation Docker | ✅ Resuelto (json-file con max-size en los 4 servicios) |
| Paso 6 | SSH sin password auth | ✅ Resuelto (PasswordAuthentication no, PermitRootLogin prohibit-password) |
| Paso 7 | Backups automáticos | ✅ Resuelto (cron diario 3:00 AM, retención 7 días, verificado 2026-04-16) |
| HAL-005 | Reset token en logs | ✅ Resuelto |
| HAL-016 | VIES endpoint público | ✅ Resuelto |
| HAL-015 | file_path en respuesta | ✅ Resuelto |
| HAL-018 | X-Powered-By Express | ✅ Resuelto |
| HAL-023 | IPv6 en audit_logs | ✅ Resuelto |
| HAL-002 | Token version JWT | ✅ Resuelto |
| HAL-003 | is_admin en BD | ✅ Resuelto |
| HAL-007 | OAuth tokens en BD | ✅ Resuelto (tokens eliminados) |
| HAL-009 | KEYS → SCAN Redis | ✅ Resuelto |
| HAL-017 | Export sin límite | ✅ Resuelto |
| HAL-020 | normalizeDate rango | ✅ Resuelto |
| HAL-021 | Content-Disposition | ✅ Resuelto |
| Log rotation app.log | 2.1GB → 26MB + auto-rotate | ✅ Resuelto |

---

### 2026-04-20 — Lote 2026-04-19 commiteado + smoke test diario OCR + auditoría CIFs

**Cierre del lote del 2026-04-19 (rama `fix/ux-captura-y-ocr-openai-schema-2026-04-19`):**
- 5 commits temáticos sobre los 9 ficheros que llevaban días sin commitear (todos ya en producción vía `docker cp`):
  - `fix(ocr)`: openai.js (schema OneOf → type-array nullable) + server.js (bypass /api/internal/* en auto-block) + security.json (max_requests 100→400 + IP whitelist)
  - `feat(ux)`: app.js (history.pushState, repetirFoto cámara directa, empresa pre-rellenada, CIF propio sin mensaje rojo) + index.html (cache-buster v=20260419-003)
  - `fix(admin/nginx)`: admin-facturas.{html,js} (CSP modal aprobación) + nginx.conf (error_page 429/5xx defensa en profundidad) + INFORME (5 entradas)
  - `feat(ocr)` smoke test: scripts/smoke-test-ocr.js + scripts/samples/{.gitignore,README.md}
  - `feat(scripts)` auditoría CIF: scripts/list-invalid-cifs.js
- Push a `origin/fix/ux-captura-y-ocr-openai-schema-2026-04-19` y PR pendiente de creación a `develop`

**Smoke test diario OCR (refuerzo crítico):**
- Razón: el bug del schema OneOf en openai.js permaneció semanas sin detectar porque Azure DI tapaba. Una sola IA activa NO es aceptable.
- `scripts/smoke-test-ocr.js`: lanza una petición real a OpenAI GPT-4.1 (response_format strict, detecta regresiones del schema) y un submit a Azure DI prebuilt-invoice. Lee secrets de `/opt/setex-captu-facture/secrets/`. Exit 1 si CUALQUIERA de los dos motores falla.
- Validación AHORA: smoke test pasa — OpenAI 2.5s, Azure DI 368ms. Ambos motores OK tras el fix.
- Cron instalado en root crontab del HOST: `30 4 * * * SETEX_OCR_LOG=/opt/setex-captu-facture/logs/smoke-ocr.log /usr/bin/node /opt/setex-captu-facture/scripts/smoke-test-ocr.js` (04:30 UTC = 06:30 Madrid verano / 05:30 invierno)
- Factura muestra fija en `scripts/samples/factura-muestra.jpg` (HOST, gitignored — contiene datos fiscales reales)

**Auditoría CIFs en BD (decisión #1=A — sólo informativo):**
- `scripts/list-invalid-cifs.js`: consulta `users.company_nif` y aplica `checkDigitCIF` AEAT (algoritmo duplicado para autocontención).
- Hallazgo en producción (5 cuentas con company_nif): **4 de 5 CIFs fallan AEAT**:
  - id=19 `murimartinvesting@gmail.com` CIF=B02790388 (esperado control 4, real 8)
  - id=20 `test@autoken.es` CIF=B42634044 (esperado 8, real 4)
  - id=21 `test1@autoken.es` CIF=B42634044 (esperado 8, real 4)
  - id=22 `info@murimarti.com` CIF=B42634044 (esperado 8, real 4)
  - id=16 `xanfla95@gmail.com` CIF=B06400980 ✓ válido
- Decisión: `validateCIF.js` mantiene política actual (no rechazo por dígito de control — algunos CIFs históricos legítimos no cumplen el algoritmo). Pendiente decidir si añadir warning visual en el perfil del usuario.

---

### 2026-04-20 — Cierre Fase 0 pre-entrega: backups, hardening, tag v1.0.0, Go/No-Go

**Objetivo:** dejar producción en estado "GO" para entrega al cliente 2026-04-21.

**Hallazgo crítico pre-entrega — backups corruptos:**
- 2 ficheros de 86 B en `/opt/setex/shared/backups/postgres/` (timestamps 14:42 y 19:01 UTC del 2026-04-20, generados durante cutover a containers `setex-prod-*`).
- Causa raíz: `set -euo pipefail` + chequeo `[ -s fichero ]` no detectaban "pipe trivial" — si `pg_dump` fallaba silenciosamente, `gzip` comprimía flujo vacío y `gpg` encriptaba ~86 B "válidos" pero sin contenido útil.
- Eliminados manualmente (descifrado confirmó basura, no gzip válido).

**Hardening `scripts/backup-postgres.sh`:**
- `PIPESTATUS` check explícito — cualquier fallo en pg_dump/gzip/gpg aborta.
- Gate `MIN_BYTES=1024` — archivos sospechosamente pequeños se rechazan.
- Validación real de integridad: descifrar + gunzip + `grep "PostgreSQL database dump"` antes de declarar OK.
- `shopt -s nullglob` para retention — evita fallo con `set -e` cuando no hay matches.
- Verificado con 3 ejecuciones consecutivas (exit=0, integridad OK).

**Backup fresco pre-entrega + replicación offsite:**
- `setex_db_20260420_194226.sql.gz.gpg` (28K, AES-256, integridad header pg_dump verificada).
- Retention local: 7 válidos (23-28K cada uno).
- VPS secundario 72.62.189.27: 11 backups replicados, tamaños coinciden (26407 bytes).

**Smoke OCR con factura muestra fija:**
- Copiada `factura-muestra.jpg` (335 KB) a `/opt/setex/prod/scripts/samples/` (gitignored, datos fiscales reales).
- Verificación: OpenAI 3.05s + Azure DI 322ms + 2ª pasada receptor 3.99s — triple verde.
- Cron diario 04:30 UTC ya no emitirá warning "Sample image not found".

**Go/No-Go formal (sec. 4.6 del MACROPLAN):**
- 9/11 verde, 2 en amarillo documentados:
  - CSRF pospuesto a F1 (módulo listo, cableado requiere tests E2E)
  - BetterStack pendiente (cuenta externa de Julio) — mitigado por watchdog cada 5min + smoke OCR diario + backup diario + offsite diario
  - Credenciales cliente: Julio genera mañana (no bloqueante hoy)
- **Veredicto: GO**.

**Tag Git v1.0.0:**
- Colocado sobre commit `0efed74` en `origin/develop` (incluye PRs #46, #47, #48).
- Tag anotado con changelog completo pusheado.

**PRs mergeados esta sesión (los 3 via rama protegida):**
- #46 `chore(fase-0)`: backup hardening + macroplan + Go/No-Go GO
- #47 `chore(staging)`: scripts seed + suite E2E idempotentes
- #48 `refactor(ui)`: UI sin falsos positivos NIF/OCR (desde sesión paralela Julio)

**Ficheros afectados en prod:**
- `scripts/backup-postgres.sh` — endurecido (PIPESTATUS + MIN_BYTES + validación header)
- `scripts/samples/factura-muestra.jpg` — añadido (gitignored, datos reales)
- `docs/plans/MACROPLAN-SETEX-v2.0.md` — sec. 4.6 Go/No-Go rellenada + sec. 17 P0-7/8/9/10 cerrados + bloque "🔜 SIGUIENTE SESIÓN 2026-04-21"
- `app/frontend/src/{app.js,index.html}` — UI sin falsos positivos NIF, cache-buster `v=20260420-003`

**Estado al cerrar sesión (para retomar mañana):**
- Prod HEAD = tag v1.0.0 = `0efed74`, working trees limpios
- Container `setex-prod-frontend` sirviendo UI nueva (verificado via curl)
- Container `setex-prod-backend` en `setex-prod-backend:latest` (rebuild 19:02 UTC)
- Cron 03:00 UTC usará script hardened en su próxima corrida
- Plan detallado para mañana en MACROPLAN sec. 17 bloque "SIGUIENTE SESIÓN 2026-04-21"

---

*SETEX Captura Facturas · setex-facturas.es*
*Documento de referencia — actualizar con cada sesión de desarrollo*
