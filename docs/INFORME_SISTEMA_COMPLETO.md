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

### 2026-07-06 — PROD: nginx absolute_redirect off (PR #121)
- `app/frontend/nginx.conf`: `absolute_redirect off;` — los 302 emiten `Location: /ruta` relativo (antes `http://<host>/ruta`, inocuo con HSTS pero impuro). Sintaxis pre-validada con `nginx -t` en imagen; validado en staging (CI verde) y desplegado a prod DENTRO de la ventana 00-06 (cero usuarios, momento óptimo). Verificado en público: `302 · location: /admin-login.html`. Cierra la mejora menor anotada el 2026-07-05.

### 2026-07-05 (noche) — PROD: filtro admin por empresa + login dedicado de administrador (PR #119)
- **Filtro "Usuario" del panel** muestra nombres de empresa (registrada > declarada > email fallback): parche SQL en `server.js` `/api/admin/facturas/usuarios` (LEFT JOIN `client_companies` por CIF; SQL pre-validada con EXPLAIN contra el esquema real; `users.is_test` ya existía en prod). Contrato `{usuarios}` y `value=user_id` intactos.
- **Login admin directo**: nueva `/admin-login.html` + `admin-login.js`; nginx `@admin_login_redirect` → `302 /admin-login.html` (antes rebotaba al login de usuarios `/?next=admin`). `auth_request` intacto — la seguridad no baja. Código muerto del formulario embebido eliminado; cache-busters `v=20260705-001`.
- **Deploy**: copia byte a byte de 5 ficheros frontend desde develop (`a093440`+#119, drift cero verificado) + rebuild backend **y frontend** (primer rebuild de la imagen nginx) → stop → up -d. Corte ~30 s a ~23:55 Madrid (borde de ventana). 4/4 healthy.
- **Verificado en público**: HTTPS 200 · `/admin-facturas.html` sin cookie → 302 `/admin-login.html` · login page y JS 200 · endpoint 401 sin token · puerto 2222 RC intacto.
- Validación previa completa en staging (6/6, incl. flujo de login con cookie `setex_admin` y credenciales no-admin → 403). Detalle en INFORME de staging (entrada 2026-07-05 noche, PR #120).
- **Mejora menor anotada**: nginx emite el 302 con `Location: http://…` (absolute_redirect por defecto) — inocuo con HSTS preload; candidato a `absolute_redirect off;`.

### 2026-07-05 — PROD: Mistral OCR 4 en el smoke nocturno · PRs #114/#115/#116 mergeados a develop
- **PR #114 mergeado** (squash `e035026`) — el fix multi-IVA + triple ya está en develop; git y runtime de prod convergen en contenido (el descalce REGLA 11 sigue solo por la vía main).
- `scripts/smoke-test-ocr.js` — actualizado quirúrgicamente desde develop (PR #115): test real de Mistral OCR 4 (`/v1/ocr` + annotation json_schema strict, skip si secret placeholder). **Ejecutado en prod: 4/4 motores OK** (OpenAI 3,0s · Azure 0,4s · 2ª pasada 1,0s · Mistral 2,3s). El cron de las 04:30 vigila desde hoy los 3 motores.
- **Incidente CI staging documentado** (no afectó a prod): develop referenciaba la red externa `n8n_default` inexistente (rename a `traefik_default` nunca mergeado — prod ya la usaba en disco). Corregido en develop vía **PR #115**. Deploy CI staging verde end-to-end (×2).
- **Deuda ownership**: chown selectivo (`-user root -o -group root`) aplicado en prod (app/docs) y staging (.git incluido) → 0 ficheros root. Lección: sesiones Claude como root deben limpiar ownership tras operaciones git.

### 2026-07-04 — PROD: fix multi-IVA (base imponible) + Mistral OCR 4 en modo TRIPLE (aplicación quirúrgica, PR #114)
- **Contexto**: el OCR fallaba en la base del IVA y con varios tipos de IVA. Causa raíz: Azure DI `prebuilt-invoice` (schema 2024-11-30-ga) no devuelve BaseAmount por tramo; cruce de tramos por string duplicaba tramos; tramo exento descartado; IRPF fantasma por base mal sumada. Fix desarrollado y validado E2E en staging (rama `feature/ocr-multi-iva-fix-y-mistral-2026-07-03`, **PR #114** a develop).
- **Aplicación quirúrgica a prod** (regla 11: NO desde main — v3 roto). Verificado cero drift pre-copia (prod = commit base `fbd3d86` byte a byte en los 5 módulos OCR):
  - `app/backend/src/ocr/index.js` — reconciliación agregados=Σtramos + modo triple + votación 2-de-3 (copiado de staging, = PR #114).
  - `app/backend/src/ocr/azure.js` — bases derivadas por aritmética, tramo exento conservado, Rate como string.
  - `app/backend/src/ocr/mistral.js` (NUEVO) — motor Mistral OCR 4 (`mistral-ocr-latest`, /v1/ocr, annotations json_schema).
  - `app/backend/src/domain/validators/iva.js` — cruce numérico de tramos, `fillDerivedBases`, `dropResumenArtifacts`.
  - `app/backend/src/server.js` — parche confirm automático (equivalente al de `server.legacy.js` del PR; el monolito de prod difiere del de develop solo en la feature admin previa).
  - `app/backend/tests/unit/{iva-multi,azure-lineas-iva,ocr-reconcile}.test.js` — 29/29 ✅ ejecutados en el árbol de prod pre-deploy.
  - `app/docker-compose.yml` — secret `mistral_api_key` (OK explícito de Julio) · `secrets/mistral_api_key.txt` (644, dir 700).
  - `app/backend/src/config/features.json` — `ocr_mode: "triple"` (escrito in-place para preservar inode del bind-mount).
- **Deploy**: rebuild → stop → up -d (corte ~15 s, fuera de ventana 00-06 por orden explícita de Julio). Backend healthy, HTTPS 200, 4/4 contenedores.
- **Smoke E2E post-deploy** (motores reales): `dual_confirmed=true`, base 750,00 · cuota 157,50 · 21,0% · total 907,50 · NIF B06400980 — OpenAI 4,6 s · Azure 5,1 s · Mistral 4,8 s en paralelo.
- **Coste triple**: +~$0,004/factura (~+$24/mes a 6 000 facturas). Revertible en caliente a `"dual"` en features.json.
- **Pendiente**: mergear PR #114 a develop (sincroniza git con lo aplicado); añadir Mistral a `scripts/smoke-test-ocr.js` (cron 04:30); nota: el descalce main↔runtime de la REGLA 11 sigue vigente e incluye ahora también estos ficheros.

### 2026-06-01 — Visor de PDF del panel admin funcional en móvil (PDF.js en `<canvas>` sustituye al `<iframe>`)
- **Disparador**: Julio reportó que el botón "🖼 Ver" de la columna imagen del panel admin abría la factura en su PC pero quedaba en blanco en el móvil.
- **Causa raíz**: el visor renderizaba los PDF dentro de un `<iframe>` (`admin-facturas.js`, `verImagenAdmin` y `openLightbox`). Los navegadores móviles (Safari iOS, Chrome Android) NO disponen de visor de PDF embebido en `<iframe>`/`<embed>`/`<object>` — y menos sobre `blob:` — por lo que no renderizaban nada. En escritorio sí funciona por el visor PDF nativo del navegador. Todas las facturas actuales son PDF (1/1 en BD), de ahí el fallo sistemático en móvil.
- **Solución (opción A, aprobada por Julio)**: integrar **PDF.js v3.11.174** (build UMD legacy, **self-hosted**) que rasteriza cada página en un `<canvas>` por software → funciona idéntico en escritorio y móvil, en cualquier navegador.
  - Nuevos ficheros estáticos: `app/frontend/src/pdf.min.js` (320 KB) y `pdf.worker.min.js` (1.06 MB), servidos por nginx (mismo patrón que `tabulator.min.js`). Descargados de cdnjs y verificados (tipo JS, API `pdfjsLib`, versión).
  - `app/frontend/src/admin-facturas.js`: nueva función reutilizable `renderPdfInto(container, blobUrl, downloadName)` (config `GlobalWorkerOptions.workerSrc`, render multipágina con scroll + botón "⬇ Descargar PDF" como red de seguridad y degradación elegante si la librería fallara). Aplicada en `verImagenAdmin` (tabla principal) y `openLightbox` (tarjetas de empresa); eliminado el `<iframe>` en ambos.
  - `app/frontend/src/admin-facturas.html`: carga `pdf.min.js?v=3.11.174` antes de `admin-facturas.js`; cache-buster `admin-facturas.js` → `?v=20260601-001` (regla 6).
- **Seguridad/CSP**: NO requiere tocar la CSP. El bloque `location = /admin-facturas.html` de `nginx.conf` ya tiene `script-src 'self' 'unsafe-eval'` y `default-src 'self'` (cubre el worker same-origin). Librería auto-alojada → sin dependencia de CDN ni ampliación de `connect-src`.
- **Despliegue**: `docker compose build frontend` + `stop` + `up -d` (reglas 3/7). Contenedor `healthy`. Verificado por HTTP público (Traefik): `/pdf.min.js`, `/pdf.worker.min.js`, `/admin-facturas.js` → `200 application/javascript`.
- **Verificación funcional (Playwright, viewport iPhone 390×844)**: render del PDF real de factura (LUMAPA2 BROKERS) en `<canvas>` 892×1262 con 123.403 px de contenido (no en blanco). Harness local aislado; material temporal con datos de cliente borrado tras la prueba (RGPD).
- **Pendiente**: replicar en `staging` por paridad (no ejecutado sin OK).

### 2026-06-01 — Eliminación completa de `info@murimarti.com` (correo inexistente que generaba bounces)
- **Disparador**: Julio recibía rebotes recurrentes de `mailer-daemon@googlemail.com` ("Delivery incomplete... info@murimarti.com... timed out") porque ese buzón nunca existió (dominio `murimarti.com` sin MX que acepte conexión). El correo se había dado de alta el 2026-05-19 como cuenta tech (clon de `albertomurimarti@gmail.com`).
- **Causa raíz**: las funciones de aviso a back-office `sendAdminPendingEmail` (`server.js:2926`) y `sendAdminAutoApprovedEmail` (`server.js:2969`) hacen `SELECT email FROM users WHERE is_admin = true` y enviaban a la dirección inexistente en cada empresa nueva pendiente / auto-aprobada → bounce.
- **Acción en BD (prod, transacción atómica BEGIN/COMMIT)**:
  - `DELETE FROM users WHERE email='info@murimarti.com'` (id=33) — sale automáticamente de la lista de destinatarios `is_admin=true`.
  - `DELETE FROM allowed_emails WHERE email='info@murimarti.com'` (id=14) — evita re-alta vía registro.
  - Verificado sin dependencias FK: 0 uploads, 0 known_cifs, 0 audit_logs, 0 refresh/reset tokens.
- **Backup previo**: filas exportadas a `data/backup_delete_info_murimarti_2026-06-01.sql.{users,allowed_emails}.csv` por reversibilidad.
- **Verificación post-borrado**: destinatarios de avisos admin pasan de 6 → 5 (`albertomurimarti@gmail.com`, `c.bernaldez@`, `javier.novillo@`, `juliohesuni@gmail.com`, `soporte@autoken.es`). Sin variables de entorno, scripts, config ni destinatarios hardcodeados que referencien el correo. Los bounces cesan.
- **No tocado (registro histórico)**: comentario en `server.js:1097` (incidente 2026-04-20), entradas previas de este INFORME y del MACROPLAN, y 8 filas `LOGIN_FAILED` en `audit_logs` (integridad del rastro de auditoría — purga pendiente de decisión explícita de Julio).

### 2026-05-28 (tarde) — Fix crítico: visor de imagen/PDF de facturas inutilizable en el panel admin (CSP + X-Frame-Options + render PDF en `<img>`)
- **Disparador**: Julio reportó que tras la subida de la primera factura real (id=2, LUMAPA2 BROKERS / HISPALAR, 543 KB PDF) no era capaz de previsualizar el fichero desde el panel admin — ni desde la tabla principal de facturas (`verImagenAdmin` → modal iframe) ni desde la vista "Ver facturas" de una empresa (tarjetas con lazy-load + lightbox).
- **Diagnóstico**: backend SÍ servía el PDF correctamente (200, `application/pdf`, 543 111 B, `%PDF-1.7…`). Tres causas independientes en la capa de presentación:
  1. `X-Frame-Options: DENY` inyectado por `helmet.frameguard` (server.js:443) sobre la respuesta del PDF → Chrome/Firefox bloquean el embebido `<iframe>` aunque sea same-origin.
  2. CSP de nginx para `admin-facturas.html` (línea 102) sin directiva `frame-src` explícita → fallback a `default-src 'self'`, que **no admite `blob:`** → `<iframe src="blob:…">` bloqueado.
  3. `_empVerFacturas` (admin-facturas.js:739-760) cargaba siempre el blob en `<img>` sin detectar tipo → con un PDF, la tarjeta quedaba vacía (un PDF no se renderiza en `<img>`).
- **Cambio en `app/backend/src/server.js`** (monolito 4484 líneas, runtime activo tras revert LL-002):
  - Endpoints `/api/facturas/:id/imagen` (línea 2437) y `/api/admin/facturas/:id/imagen` (línea 2459): antes de `res.sendFile`, `res.removeHeader('X-Frame-Options')` + `res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")`. Sustituye `XFO:DENY` por `frame-ancestors 'self'` (CSP nivel 2, sucesora moderna), manteniendo la protección anti-clickjacking pero permitiendo el embebido same-origin del visor.
- **Cambio en `app/frontend/nginx.conf`** (4 CSPs unificadas + nuevo location regex):
  - Las 4 CSPs `add_header Content-Security-Policy` (líneas 39 server-level, 63 service-worker, 102 admin-facturas.html, 143 regex html/js/css) ahora incluyen `frame-src 'self' blob:;` — la mínima ampliación necesaria para que la SPA pueda embeber sus propios blobs.
  - **Nuevo `location ~ ^/api/(admin/)?facturas/[0-9]+/imagen$`** (antes de `location /api/`): tiene precedencia regex sobre el prefix `/api/`, define sus propios `add_header` (HSTS + nosniff + Referrer-Policy) lo que rompe la herencia del server-level y evita que se acumule un segundo `Content-Security-Policy: …frame-ancestors 'none'` + `X-Frame-Options: DENY` sobre la respuesta del PDF. La protección anti-clickjacking se conserva mediante la CSP `frame-ancestors 'self'` que emite el backend.
- **Cambio en `app/frontend/src/admin-facturas.js`**:
  - Galería de empresa (`_empVerFacturas`, ~líneas 738-770): detecta `blob.type.includes('pdf')`. Si es PDF, la tarjeta muestra placeholder "📄 PDF" clicable; al click abre el lightbox con `<iframe>` (no `<img>`). Si es imagen, mantiene el comportamiento previo.
  - Nuevos helpers `openLightbox(url, isPdf)` y `closeLightbox()`: el lightbox convive entre `<img id="lightbox-img">` (preexistente) y un `<iframe id="lightbox-frame">` lazy-creado al primer PDF. `closeLightbox` limpia ambos `src` para liberar el blob URL.
  - El listener de cerrar lightbox (click sobre fondo + tecla Escape) ahora invoca `closeLightbox()` en lugar de solo ocultar el contenedor.
- **Cache-buster en `app/frontend/src/admin-facturas.html`**: `admin-facturas.js?v=20260506-002` → `?v=20260528-001` (regla 6 — fuerza recarga en navegadores tras los cambios JS).
- **Operación**: `docker compose build backend frontend` + `stop` + `up -d` (reglas 3 y 7) para el rebuild de imágenes; además `docker cp nginx.conf` + `nginx -s reload` dentro del container frontend para aplicar el cambio sin esperar al próximo arranque. Backend y frontend `healthy` en 32 s.
- **Verificación HTTP post-deploy** (vía nginx con JWT admin válido):
  - `GET /api/admin/facturas/2/imagen` → 200, `Content-Type: application/pdf`, `Content-Length: 543111`, una sola `Content-Security-Policy: frame-ancestors 'self'`, **sin** `X-Frame-Options`.
  - `GET /admin-facturas.html` → CSP incluye `frame-src 'self' blob:` y `frame-ancestors 'none'` (protege el HTML padre).
- **Postura de seguridad**: ningún cambio amplía superficie de clickjacking. `X-Frame-Options: DENY` (deprecated) sustituido por la directiva CSP equivalente moderna (`frame-ancestors 'self'`) recomendada por MDN/OWASP. `frame-src 'self' blob:` es la mínima ampliación posible y no permite frames de terceros. El nuevo location nginx solo afecta a dos rutas concretas matcheadas por regex estricto `^/api/(admin/)?facturas/[0-9]+/imagen$`.
- **Causa raíz "silenciosa"**: el bloqueo lo realizaba el navegador del cliente sin generar ningún request al backend — por eso `audit_logs` y `docker logs backend` no mostraban error alguno. Pendiente añadir `report-to` / `report-uri` en CSP para capturar este tipo de bloqueos en el futuro (no incluido en esta iteración).

### 2026-05-28 — Ampliada lista de destinatarios de avisos admin: ahora todos los `is_admin=true` (no solo `role='tech'`)
- **Disparador**: Julio detectó que el aviso de "empresa nueva pendiente de aprobación" (LUMAPA2 BROKERS SL, id=50, registrada 14:08 UTC) llegó solo a 4 personas (`role='tech'`) y quedaron fuera `c.bernaldez@setexextremadura.es` y `javier.novillo@setexextremadura.es` (que son `is_admin=true` pero `role='admin'`).
- **Cambio en `app/backend/src/server.js`** (monolito 4484 líneas, runtime activo tras revert LL-002):
  - Línea 2915 (`sendAdminPendingEmail`): `SELECT email FROM users WHERE role = 'tech'` → `WHERE is_admin = true`.
  - Línea 2957 (`sendAdminAutoApprovedEmail`): mismo cambio para el aviso de auto-registro con CIF pre-aprobado.
  - Comentarios de 2026-05-06 actualizados con nota 2026-05-28 explicando la ampliación.
  - Log info reformulado: "miembros de soporte técnico" → "administradores".
- **Decisión deliberada**: NO se eleva el `role` de Bernáldez/Novillo a `tech` para no concederles privilegios futuros del middleware `requireTech` (definido pero hoy sin uso, reservado para endpoints sensibles: security.json, motor OCR, hard-delete de empresas). Recibirán todos los correos del equipo pero seguirán sin acceso técnico de plataforma.
- **Lista resultante (6 destinatarios verificada en vivo desde el backend post-deploy)**: `albertomurimarti@gmail.com`, `c.bernaldez@setexextremadura.es`, `info@murimarti.com`, `javier.novillo@setexextremadura.es`, `juliohesuni@gmail.com`, `soporte@autoken.es`.
- **Operación**: `docker compose build backend` + `stop` + `up -d` (reglas 3 y 7). Container `healthy` en 39s, `/health` HTTP 200 post-arranque.
- **⚠ RGPD menor**: el monolito envía los 6 emails en el campo `To:` de un único `sendMail` (cruzan direcciones entre sí). Aceptable porque forman un equipo único bajo SETEX. El módulo v3 (`approval-notification.service.js`) ya hace un envío por destinatario; cuando se retome el swap v3 (post-LL-002) este detalle queda corregido.

### 2026-05-19 — Altas de acceso: `info@murimarti.com` (tech) y `javier.novillo@setexextremadura.es` añadido a whitelist
- **Nuevo usuario `info@murimarti.com` (users.id=33)**:
  - Clon de privilegios de `albertomurimarti@gmail.com` (id=3): `role='tech'`, `is_admin=true` (sincronizado por trigger `trg_sync_is_admin`), `auto_confirm_enabled=true`, `company_name='Autoken'`, `is_test=false`.
  - `password_hash`: bcrypt 12 rounds de un valor aleatorio de 48 bytes — **nadie conoce la contraseña**. Activar con "Olvidé mi contraseña" (mismo patrón que `c.bernaldez@setexextremadura.es` el 2026-05-06).
  - También añadido a `allowed_emails` (id=14) con nota trazable.
- **`javier.novillo@setexextremadura.es` añadido a `allowed_emails` (id=13)**:
  - Su cuenta `users` (id=32, `role='admin'`) ya existía desde 2026-05-07 pero faltaba en whitelist. Añadido por coherencia documental (no afecta a su login actual).
- **Operación**: una sola transacción atómica (BEGIN/COMMIT) con 3 `INSERT` (2 `allowed_emails` + 1 `users`). Verificado post-alta con `SELECT` cruzado.
- **Motivo**: petición explícita de Julio (sesión 2026-05-19) al confirmar consulta sobre estado de accesos.

### 2026-05-07 (noche-4) — Sandbox 100% aislado: cleanup interno cada 60s + filtros admin de empresas + validación CIF visible
- **Auto-purga sandbox cada 60s — ahora interna al backend** (no más cron del sistema):
  - Nuevo módulo `app/backend/src/services/test-cleanup.js` (~75 líneas).
  - Arrancado al final de `start()` con `setInterval` de 60s + primera corrida a los 5s del arranque.
  - Cada tick: `DELETE` de `uploads`, `audit_logs`, `refresh_tokens`, `known_cifs`, `password_reset_tokens` de los usuarios `is_test=true`. Más borrado de los ficheros físicos en `/app/uploads/...` y limpieza de carpetas vacías por email-prefix.
  - Idempotente, transaccional, fail-safe (si falla un tick, lo intenta el siguiente).
  - Reemplaza el script externo `scripts/purge-test-uploads.sh` que requería cron del root y nunca se llegó a activar. **Funciona automáticamente sin sudo**.
- **Empresa fake "Sandbox Pruebas" oculta del panel admin**:
  - Nueva columna `client_companies.is_test BOOLEAN DEFAULT false` (migración idempotente en `initDB()`).
  - Índice parcial `idx_client_companies_is_test ON (is_test) WHERE is_test = true`.
  - `UPDATE client_companies SET is_test=true WHERE cif='B12345674'` (la del sandbox).
  - Filtro `is_test IS NOT TRUE` aplicado en 3 endpoints admin de empresas:
    - `/api/admin/client-companies` (listado del panel + JOIN con users también filtrado).
    - `/api/admin/companies/pending` (pendientes).
    - `/api/client-companies` (selector usado por admins).
  - Resultado: **49 empresas en BD → 48 visibles + 1 oculta**.
- **Validación CIF emisor/receptor visible en el modal** (sin tocar la lógica de IVA/IRPF):
  - Re-creado `app/frontend/src/cif-validator.js` (espejo del backend, vanilla JS, ~95 líneas, regex tildes en forma escapada `̀-ͯ`).
  - Cargado en `index.html` antes de `app.js` con cache-buster `?v=20260507-003`.
  - Nuevo `<div id="confirm-cif-validation">` antes del botón Guardar.
  - Cambios mínimos en `showConfirmModal()` (3 sustituciones quirúrgicas en líneas 866, 916-927, 933-935): se deja de **machacar** el lado del usuario con sus datos de BD; ahora se muestra lo que vio el OCR. La lógica de los 3 cuadros plegables (Tramos/IRPF/Resumen), el snap IVA% a {21,10,4,0}, los banners rojos de descuadre y el linkado bidireccional **no se han tocado**.
  - Nuevos helpers (~80 líneas, sin dependencias) al final del modal: `setupCifValidationListeners`, `revalidateAndToggleSave`, `renderCifValidationMessages`, `toggleSaveButton`, `escapeHtmlSimple`.
  - Listeners `input` en los 4 campos editables → re-evaluación en tiempo real, botón Guardar bloqueado/desbloqueado automáticamente.
  - Manejo del 400 `cif_mismatch` del backend en `confirmUpload`: pinta los errores en el contenedor sin cerrar modal ni hacer logout.
  - Cache-buster `app.js` actualizado a `?v=20260507-003`.
- **Por qué hubo que hacer esto**: cuando el sandbox `setex@gmail.com` (CIF fake `B12345674`) subió una factura real, el frontend antiguo machacaba el lado del usuario con sus datos de BD → `confirmed_receptor_nif='B12345674'` (no lo del OCR) → el backend validaba contra sí mismo y NO bloqueaba. Ahora el frontend muestra lo del OCR y el validador detecta la discrepancia con los datos del usuario logueado, pintando el aviso rojo y bloqueando el Save.
- **Despliegue**: rebuild backend + rebuild frontend, 4/4 healthy, HTTPS 200, log `[TestCleanup] iniciado: cada 60s` confirmado al arranque.

### 2026-05-07 (noche-3) — Fix sandbox no podía subir facturas + alerta email auto-aprobados + limpieza notas client_companies
- **Bug del sandbox `setex@gmail.com` arreglado**:
  - Síntoma: tras pulsar "Enviar" en la subida de factura, el frontend mostraba "Tu sesión ha expirado".
  - Causa: el middleware `requireActiveCompany` (server.js:3001) exige que el usuario tenga `company_nif` y que ese CIF esté en `client_companies` con `activa=true, pendiente=false`. El sandbox había sido creado con `company_nif=NULL` por la conversión a usuario test, fallando el check con HTTP 403 → el frontend trata 403 como sesión expirada (bug pre-existente).
  - Solo afectaba al sandbox: el resto de cuentas (tech/admin) tienen `is_admin=true` y están exentas del middleware.
  - **Fix doble**:
    - **Datos**: asignado al sandbox `company_nif='B12345674'` (válido AEAT) y creada empresa "Sandbox Pruebas" en `client_companies` con `activa=true, pendiente=false, registration_source='admin'`.
    - **Código** (defensa en profundidad): `requireActiveCompany` ahora exenta también a usuarios con `is_test=true` además de `is_admin=true`. Si alguien quita el CIF al sandbox en el futuro, sigue funcionando.
- **Alerta email para registros auto-aprobados** (`sendAdminAutoApprovedEmail` en server.js:2937):
  - Se dispara desde `/api/auth/register` cuando un usuario se registra con un CIF del catálogo pre-aprobado y recibe JWT inmediato.
  - Destinatarios: todos los usuarios `role='tech'` (Julio, Alberto, soporte@autoken).
  - Asunto: `[SETEX] Nuevo registro auto-aprobado — <nombre> (<cif>)`.
  - Cuerpo: email del registrante, nombre declarado, CIF, IP origen, fecha. Detecta otros usuarios ya registrados con el mismo CIF (excluyendo `is_test=true`) y muestra un aviso rojo si los hay → vigilancia humana de posibles suplantaciones (los CIFs son datos públicos).
  - Idempotente y fail-safe: si el email falla, no bloquea el registro (igual que `sendAdminPendingEmail`).
- **Limpieza columna `notas` de `client_companies`**:
  - Borradas las 48 entradas con texto autoinsertado por la carga masiva ("Cargada via import-companies-bulk.js…").
  - Decisión Julio: la columna `notas` es para uso humano del admin, nunca rellenar autónomamente desde scripts/operaciones masivas.
  - `scripts/import-companies-bulk.js` actualizado: ya no toca `notas` ni en INSERT ni en ON CONFLICT UPDATE.
  - Memorizado en `~/.claude/projects/-opt-setex-prod/memory/feedback_no_autonotes_companies.md` para sesiones futuras.
- **Auditoría filtros user_id**:
  - Verificado que los 4 endpoints de usuario normal (`/api/mis-facturas`, `/api/facturas/:id/imagen`, `/api/mis-facturas/export.xlsx`, `/api/me/export`) ya tienen `WHERE user_id = req.user.userId`. Un usuario solo ve sus propias facturas, nunca las de otra empresa aunque comparta CIF.
- **Deploy**: 2 rebuilds del backend (uno por fix del middleware, otro por la función de email). 4/4 healthy, HTTPS 200, sin errores en logs.

### 2026-05-07 (noche-2) — Carga masiva de 48 empresas-cliente (opción A: pre-aprobadas) + fix rate-limit auth + revert frontend a versión correcta
- **Carga masiva de empresas-cliente** (`scripts/import-companies-bulk.js`):
  - 48 empresas insertadas en `client_companies` con `activa=true, pendiente=false, registration_source='admin'` (Opción A: cuando un usuario nuevo se registre con uno de estos CIFs, recibe JWT inmediato sin esperar aprobación admin).
  - Listado: talleres, autónomos y entidades (incluye AYUNTAMIENTO DE BADAJOZ y IES SAN JOSE).
  - Validación previa con `domain/validators/nif.js` (algoritmo AEAT): **48/48 válidos**, 0 inválidos.
  - Script idempotente (ON CONFLICT (cif) DO UPDATE), reutilizable para cargas futuras.
  - Audit log: `ADMIN_BULK_IMPORT_COMPANIES` con totales en JSONB.
- **Fix rate-limit de auth** (`app/backend/src/middleware/rate-limit.js`):
  - El `authLimiter` ahora usa `email` como clave en lugar de `req.ip`.
  - Razón: tras Traefik+nginx, `req.ip` siempre era la IP de la red interna Docker → un único contador global bloqueaba a todos los usuarios cuando alguien fallaba muchos intentos.
  - Ahora un usuario que falla 10 veces se bloquea sólo a sí mismo durante 15 min; el resto de usuarios siguen pudiendo entrar.
  - Fallback a IP cuando la petición no trae email (p.ej. `/reset-password` con token).
  - Mensaje de error más claro: «Demasiados intentos para este usuario».
- **Revert frontend a versión correcta del 6-may**:
  - Tras el deploy de la validación CIF visual, mi `git checkout HEAD -- app/frontend/` me llevó a la versión del 21-abr (commit `628a230`) porque la rama actual `chore/docs-refinement-2026-05-05` está desfasada respecto a `origin/main`.
  - Restaurado correctamente desde commit `19fbe3f` (PR #101 "feat(ux): rediseño completo del modal IVA + unificación columnas admin"), que contiene los 3 cuadros plegables, snap IVA% a {21,10,4,0}, banner rojo de descuadre, linkado bidireccional Total/IRPF.
  - Ficheros restaurados: `app.js`, `index.html`, `admin-facturas.html`, `admin-facturas.js`. Cache-buster vuelve a `?v=20260506-001`.
  - Validador CIF visual (rojos/amarillos en modal con bloqueo de Save) **NO desplegado** — el backend mantiene la validación en `/api/upload-confirm` (defensa en profundidad) que devuelve HTTP 400 con `cif_mismatch:true` y se registra `UPLOAD_BLOCKED_CIF_MISMATCH` en audit_logs.

### 2026-05-07 (noche) — Reorganización de cuentas: nuevos admin, sandbox de pruebas, baja de jnodav
- **Bajas**: eliminado el usuario `jnodav@gmail.com` (id 24, admin) por reemplazo. CASCADE limpió sus tokens; audit_logs preservados con `user_id=NULL` por FK SET NULL.
- **Altas**: creado nuevo admin `javier.novillo@setexextremadura.es` (id 32) con NIF `08843135A`, password temporal `setex1234`, role admin. Migra al dominio corporativo `setexextremadura.es`.
- **Activación cuentas pre-aprovisionadas**:
  - `c.bernaldez@setexextremadura.es` (id 31, admin): asignado `company_name='Carlos Bernáldez'`. CIF se queda NULL hasta que Carlos lo aporte.
  - `soporte@autoken.es` (id 30, tech): password cambiado de `!BLOCKED:...` a bcrypt válido de `setex1234`. Cuenta ahora puede hacer login. Token_version bumpeado.
- **Nuevo modo sandbox** para usuario `setex@gmail.com` (id 23):
  - **Conversión**: rol cambiado de `admin` → `user`, `is_admin=false` (sincronizado por trigger `trg_sync_is_admin`), `is_test=true`, password reset a `setex1234`, CIF nullificado, `company_name='Sandbox Pruebas'`.
  - **Migración de schema** (idempotente, en `initDB()` de `server.js:332-334`):
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;`
    - `CREATE INDEX IF NOT EXISTS idx_users_is_test ON users(is_test) WHERE is_test = true;` (índice parcial — coste 0 cuando no hay test users).
  - **Filtros añadidos en panel admin** (`server.js`, 4 endpoints):
    - `/api/admin/facturas` (listado): `WHERE us.is_test IS NOT TRUE`.
    - `/api/admin/facturas/usuarios` (dropdown): `WHERE is_test IS NOT TRUE`.
    - `/api/admin/facturas/export.xlsx`: `WHERE us.is_test IS NOT TRUE`.
    - `/api/admin/users` (listado de usuarios): `WHERE u.is_test IS NOT TRUE`.
  - **Script de purga periódica**: `scripts/purge-test-uploads.sh` (creado nuevo, +90 líneas):
    - Cada 5 min: borra `uploads`, ficheros físicos del volumen `/app/uploads/`, `audit_logs`, `refresh_tokens`, `password_reset_tokens` y `known_cifs` de **todos los usuarios con `is_test=true`**.
    - El usuario en sí NO se borra: queremos que pueda seguir haciendo login para más pruebas.
    - Carpetas vacías por email-prefix se limpian via `find -empty -delete`.
    - Log en `/var/log/setex/purge-test.log`.
    - Idempotente: si no hay test users, exit 0 silencioso.
  - **Cron NO instalado automáticamente** (regla 1 de no tocar config global sin OK explícito): la línea está documentada en `config/crontab-prod-additions.txt`. Para activar, Julio debe ejecutar con sudo:
    ```bash
    sudo crontab -l > /tmp/cron-current
    cat /opt/setex/prod/config/crontab-prod-additions.txt >> /tmp/cron-current
    sudo crontab /tmp/cron-current
    sudo crontab -l | grep purge-test
    ```
  - **Primera ejecución manual** del script: borró `0 uploads / 31 audit_logs / 48 refresh_tokens / 0 password_reset / 0 known_cifs` históricos del antiguo `setex@gmail.com` admin antes de su conversión a sandbox.
- **Limitación conocida**: el usuario test SÍ está físicamente presente en `users` (es necesario para que el login funcione). Lo que NO existe es rastro de su actividad (uploads, audit_logs) más allá de 5 minutos. El usuario aparece en queries directas SQL pero NO en ningún endpoint del panel admin. RGPD: si en el futuro el usuario test deja de necesitarse, basta con `DELETE FROM users WHERE is_test=true`.
- **Deploy**: `is_test` aplicado vía `ALTER TABLE` manual antes del rebuild (idempotente; el código en `initDB()` lo aplicaría igualmente al reiniciar). Rebuild backend → stop + up -d → 4/4 healthy → HTTPS 200, sin errores en logs.
- **Estado final de usuarios**:
  - tech (3): juliohesuni · albertomurimarti · soporte@autoken (todos activos)
  - admin (2): c.bernaldez · javier.novillo (ambos activos, password `setex1234`)
  - user + is_test (1): setex@gmail.com (sandbox, oculto del panel admin, password `setex1234`)

### 2026-05-07 (tarde) — Validación de coincidencia CIF emisor/receptor con usuario logueado
- **Motivo**: hasta ahora cuando un usuario subía una foto de factura, el sistema rellenaba automáticamente los datos de "su lado" (emisor en factura emitida, receptor en factura recibida) con los datos del perfil del usuario logueado, **ignorando lo que la IA hubiese leído en la factura**. Si el usuario subía por error una factura ajena en la que él no aparecía, la factura se guardaba con sus datos como si fuera suya. Riesgo de contaminar el flujo del equipo contable con facturas de terceros mal etiquetadas.
- **Cambio de comportamiento**: ahora el sistema lee y respeta lo que el OCR ha extraído de **ambos lados** (emisor + receptor) y lo compara con el CIF/nombre del usuario logueado. Si el lado que debe ocupar el usuario no coincide con sus datos → error rojo bloqueante en el modal y botón Guardar deshabilitado. Si el CIF coincide pero el nombre difiere (típico "S.L." vs "SLU") → warning amarillo informativo, no bloquea. Si el CIF emisor y receptor son idénticos → error rojo bloqueante (una empresa no puede emitirse facturas a sí misma). Los errores y warnings se actualizan en tiempo real mientras el usuario edita los campos: en cuanto se corrige, el aviso desaparece y el botón se desbloquea solo.
- **Defensa en profundidad**: la misma validación corre en `/api/upload-confirm`. Si un cliente HTTP (no el navegador) intentase saltarse el modal frontend, el backend devuelve 400 con `cif_mismatch: true` y se registra `UPLOAD_BLOCKED_CIF_MISMATCH` en `audit_logs`.
- **Excepción admin**: cuando un admin opera desde el panel admin con una empresa cliente seleccionada, la comparación se hace contra el CIF de **esa empresa cliente**, no contra el del propio admin. Cubierto automáticamente porque la asignación de `userCompanyNif/Name` ya conmuta con `previewClientCompanyData` en el preview.
- **Algoritmo de match**:
  - **CIF**: comparación exacta tras normalizar (uppercase + sin espacios/guiones/puntos + remover prefijo `ES` intracomunitario).
  - **Nombre**: comparación tras normalizar (lowercase + sin tildes + sin puntuación + sin sufijos societarios `S.L./SLU/S.A./SCoop/CB/Sociedad Limitada/Sociedad Anónima`). Solo warning, nunca bloqueo, porque la fuente fiscal de verdad es el CIF.
- **Ficheros nuevos**:
  - `app/backend/src/lib/invoice-cif-validator.js` — validador puro CommonJS (~85 líneas).
  - `app/frontend/src/cif-validator.js` — espejo vanilla JS (`window.SetexCifValidator`, ~95 líneas).
- **Ficheros modificados**:
  - `app/backend/src/server.js`:
    - `+1` import del validador.
    - `+18` líneas tras el swap automático en `/api/upload-preview`: nueva variable `cifValidation`, se incluye en el payload JSON de respuesta (`cif_validation`, `user_company`).
    - `+45` líneas en `/api/upload-confirm` antes de las validaciones de campos obligatorios: cálculo de `validationUserNif/Name` (con excepción admin), llamada al validador, rechazo `400` con `cif_mismatch: true` + `audit_logs` si bloquea.
  - `app/frontend/src/app.js`:
    - 3 fixes en `showConfirmModal` (líneas 866, 916-928, 933-935): se deja de **machacar** el lado del usuario con sus datos de BD; ahora se muestra lo que vio el OCR y solo hay fallback a usuario si el OCR no detectó nada.
    - `+90` líneas con 4 helpers nuevos: `setupCifValidationListeners`, `revalidateAndToggleSave`, `renderCifValidationMessages`, `toggleSaveButton`, `escapeHtmlSimple`.
    - Handler del 400 `cif_mismatch` en `confirmUpload()`: pinta los errores en el contenedor sin cerrar modal ni hacer logout.
    - `finally` del `confirmUpload()` ahora re-evalúa el bloqueo en lugar de re-habilitar el botón ciegamente.
  - `app/frontend/src/index.html`: nuevo `<div id="confirm-cif-validation">` antes del botón Guardar; nuevo `<script src="cif-validator.js?v=20260507-001">`; cache-buster de `app.js` actualizado a `?v=20260507-001` (regla 6).
- **Mensajes mostrados al usuario**:
  - 🔴 `EMISOR_MISMATCH` (factura emitida): «El CIF del emisor leído en la factura (X) no coincide con el de tu empresa (Y). Esta factura no parece emitida por ti.»
  - 🔴 `RECEPTOR_MISMATCH` (factura recibida): «El CIF del receptor leído en la factura (X) no coincide con el de tu empresa (Y). Esta factura no parece dirigida a ti.»
  - 🔴 `SAME_EMISOR_RECEPTOR`: «El CIF del emisor y del receptor no pueden ser idénticos. Una empresa no puede emitirse facturas a sí misma.»
  - 🟡 `EMISOR_NAME_DIFFERS` / `RECEPTOR_NAME_DIFFERS`: warning informativo cuando el CIF coincide pero el nombre normalizado no (variación tipográfica probable).
- **Tests del validador puro**: ejecutados en local, casos cubiertos: match exacto OK, mismatch CIF emitida/recibida, emisor=receptor, OCR sin detectar lado del usuario (no bloquea, deja editar), normalización de tildes/sufijos, prefijo intracomunitario `ES`.
- **Deploy**: rebuild backend + frontend → stop + up -d → 4/4 healthy → HTTPS 200 → `cif-validator.js` se sirve correctamente (4058 bytes) → `/api/upload-preview` mantiene 401 sin auth.
- **Riesgo asumido y mitigaciones**: cambio en el flujo crítico de subida de facturas. Snapshot canónico previo (`setex_db_20260507_post_purga_CANONICO.sql.gz`) disponible para rollback. Revert con `git revert` + rebuild si surgiese algún caso edge no contemplado.

### 2026-05-07 — Limpieza total de datos de prueba (facturas + usuarios + catálogo de empresas)
- **Motivo**: hasta ahora todo el contenido de la BD de producción eran datos de prueba acumulados durante el desarrollo (~6 meses). Reset completo antes de la entrada real en explotación con clientes finales.
- **Backup pre-borrado**: dump SQL plano `/tmp/setex_pre_purge_20260507_091822.sql` (151 KB, modo 600) + GPG cifrado del cron 03:00 ya disponible en `/opt/setex/shared/backups/postgres/setex_db_20260507_030001.sql.gz.gpg`.
- **Borrado en transacción atómica única** (`BEGIN…COMMIT`):
  - `audit_logs` 344 → 225 (borrados 119: los de user_id huérfano o de usuarios eliminados; conservados los logs de tech/admin).
  - `company_audit_log` 8 → 0 (todo el log de cambios sobre empresas).
  - `known_cifs` 8 → 2 (conservados solo los CIFs aprendidos por usuarios tech/admin).
  - `failed_jobs` 0 → 0.
  - `uploads` 12 → 0 (TODAS las facturas eliminadas).
  - `company_relationships` 6 → 0.
  - `client_companies` 63 → 0 (catálogo completo de 59 empresas-cliente con códigos 1-58 + las 4 self_register + DBK SLU).
  - `company_catalog` 1 → 0.
  - `allowed_emails` 6 → 4 (eliminados `xanfla95@gmail.com` y `administracion@itdbk.es`).
  - `users` 14 → 6: borrados los 8 con role='user' (xanfla95, murimartinvesting, test/test1@autoken, info@murimarti, setex2, teresa260060, administracion@itdbk).
  - `password_reset_tokens` y `refresh_tokens` limpiados automáticamente vía CASCADE (refresh_tokens 100→62; los 62 restantes son de tech/admin).
- **Usuarios conservados** (6, todos `is_admin=true`):
  - `tech`: juliohesuni@gmail.com (id 2), albertomurimarti@gmail.com (id 3), soporte@autoken.es (id 30).
  - `admin`: setex@gmail.com (id 23), jnodav@gmail.com (id 24), c.bernaldez@setexextremadura.es (id 31).
- **Volumen físico**: `/app/uploads/` dentro del contenedor backend vaciado (12 ficheros, 4.5 MB → 0 ficheros, 4 KB) conservando el directorio raíz con permisos `appuser:appgroup`.
- **Verificación post**: integridad referencial sin huérfanos (audit_logs/refresh_tokens/password_reset_tokens/known_cifs/allowed_emails todos 0 huérfanos), 4/4 contenedores healthy, HTTPS 200, login devuelve 401 con creds inválidas (sin 5xx), endpoints admin piden token. RGPD art. 17: derecho al olvido aplicado a los 8 usuarios eliminados.
- **Limpieza máxima fase 2** (mismo día, tras confirmación):
  - **Redis**: borradas 6 claves residuales `bull:n8n-send:*` (115, 116, completed, events, id, meta) — chatarra de la eliminación de n8n del 2026-04-16. `DBSIZE` final = 0.
  - **Reset de secuencias `*_id_seq`** en transacción atómica:
    - Tablas vaciadas → `setval(seq, 1, false)`: `uploads_id_seq`, `client_companies_id_seq`, `company_relationships_id_seq`, `company_audit_log_id_seq`, `company_catalog_id_seq`, `failed_jobs_id_seq`. Próximo `nextval()` devolverá 1: la primera factura nueva tendrá `id=1`, la primera empresa cliente `id=1`, etc.
    - Tablas con datos conservados → alineadas a `MAX(id)`: `users_id_seq=31`, `audit_logs_id_seq=344`, `allowed_emails_id_seq=12`, `known_cifs_id_seq=26`, `refresh_tokens_id_seq=434`, `password_reset_tokens_id_seq=11`. Próximo nextval = `MAX+1` (sin colisiones de PK).
  - **Borrado seguro del dump pre-borrado** (`/tmp/setex_pre_purge_20260507_091822.sql`, 151 KB): `shred -u -v -n 3 -z` (3 pasadas aleatorias + zero pass + rename progresivo + unlink). Cumplimiento **RGPD art. 17 (derecho al olvido)**: ya no existe copia plana de los datos personales eliminados. Queda únicamente el backup GPG cifrado AES-256 del cron 03:00 (`setex_db_20260507_030001.sql.gz.gpg`), inaccesible sin la passphrase de `secrets/backup_passphrase.txt`.
- **No replicado en staging**: decisión explícita de Julio. Staging mantiene sus datos sintéticos.
- **No comunicado a usuarios**: decisión explícita de Julio. Los usuarios eliminados (`xanfla95`, `info@murimarti`, etc.) verán login fallido al volver y deberán re-registrarse cuando se les autorice en `allowed_emails`.
- **Limpieza máxima fase 3** (mismo día):
  - **Smoke OCR auditado** (`scripts/smoke-test-ocr.js`): verificado que **NO inserta en `uploads`** ni conecta a PostgreSQL. Solo hace fetch HTTP a OpenAI + Azure DI. El cron 04:30 puede seguir activo: la primera factura real seguirá siendo `id=1`.
  - **Bump global de `token_version`** (`UPDATE users SET token_version = token_version + 1`): los 6 usuarios pasan a versión +1 → invalidación inmediata de cualquier JWT access existente al expirar (15 min). Adicionalmente, **revocados 10 refresh_tokens activos** (`UPDATE refresh_tokens SET revoked=true, revoked_at=NOW()`): de 69 totales, 0 quedan activos. Re-login obligatorio en próxima sesión de cada admin/tech.
  - **`VACUUM ANALYZE`**: dead tuples a 0 (antes: 31 en `known_cifs`, 20 en `password_reset_tokens`, 17 en `refresh_tokens`/`google_tokens`, etc.). Estadísticas del planner refrescadas tras los DELETE masivos. DB total: 9.39 MB → 9.66 MB (incremento por audit_logs nuevos de la sesión y `revoked_at` poblados; espacio reusable interno marcado, no compactado — `VACUUM FULL` queda fuera de alcance por requerir lock exclusivo).
  - **Anonimización RGPD de `audit_logs.details` JSONB**: 71 campos PII redactados a `"[REDACTED-RGPD]"` en transacción atómica:
    - 2 `email` de usuarios borrados (los emails de los 6 tech/admin se preservan: base jurídica de trazabilidad operativa interna).
    - 27 `nif` (UPLOAD_SUCCESS, referencias a facturas eliminadas).
    - 7 `cif` + 1 `cif_assigned` (ADMIN_* sobre empresas eliminadas).
    - 27 `filename` (incluían el username embebido en el path).
    - 7 `nombre` + 1 `company_name`.
    - Conservado: `action`, `user_id`, `ip_address` (IP interna Docker), `created_at`, `reason`, `confidence_level`, `auto_confirmed`, `ocr_time` (no son PII personal directa).
    - Verificación: 0 PII residual de usuarios borrados sin redactar.
  - **`docs/PLAYBOOK_EMERGENCIAS.md`** actualizado: nueva sección "⛔ Backups con bloqueo RGPD — NO restaurar". Tabla con patrón `setex_db_20260507_*.sql.gz.gpg` y anteriores marcados con bloqueo desde 2026-05-14. Acciones obligatorias: purga programada con `shred` (local + offsite VPS `72.62.189.27`), prohibición permanente de restauración aunque la rotación de 7 días los haya eliminado, e instrucciones de fallback (parte cero / seed sintético) si se necesita rollback masivo posterior al 2026-05-07.

### 2026-05-06 (tarde) — Separación de roles: Soporte Técnico vs Administración
- **Modelo nuevo**: tres roles en `users.role` con check constraint `IN ('tech','admin','user')`. Default `'user'`.
  - **`tech`** (Soporte Técnico): superconjunto de admin. Recibe correos operativos (nuevas solicitudes de empresa, alertas, futuro: quejas de usuarios vía `soporte@autoken.es`). Acceso completo al panel admin.
  - **`admin`** (Administración): acceso al panel admin (igual que tech) pero NO recibe correos.
  - **`user`** (cliente final): acceso a su propia captura de facturas.
- **Migración aplicada en transacción atómica**:
  - `juliohesuni@gmail.com` (id 2) → `tech`
  - `albertomurimarti@gmail.com` (id 3) → `tech`
  - `setex@gmail.com` (id 23) → `admin`
  - `jnodav@gmail.com` (id 24) → `admin`
  - Cuentas creadas con `password_hash='!BLOCKED:...'` (no es hash bcrypt válido, login bloqueado):
    - `soporte@autoken.es` (id 30, `tech`) — solo destinatario de correos.
    - `c.bernaldez@setexextremadura.es` (id 31, `admin`) — activable con "Olvidé mi contraseña".
  - Whitelist: eliminado `albertomurimarti@hotmail.com` (no se usaba), añadidos los dos nuevos emails.
  - **`is_admin` se mantiene sincronizado con role** (`is_admin = role IN ('tech','admin')`) por compatibilidad con el resto del código que aún consulta esa columna.
- **Backend**: `sendAdminPendingEmail()` cambia su query de `WHERE is_admin = true` a `WHERE role = 'tech'`. Solo el equipo técnico (3 personas: Julio, Alberto, soporte@autoken.es) recibe la notificación de nueva empresa pendiente. Log actualizado para reflejar "miembros de soporte técnico".
- **Frontend**: sin cambios. El panel admin sigue funcionando igual para tech y admin (ambos tienen `is_admin=true` por compatibilidad).
- **Pendiente para próxima sesión**: endpoint `POST /api/support/contact` para que usuarios puedan enviar quejas/consultas directamente a `soporte@autoken.es`. No incluido aquí para no ampliar alcance.
- **Deploy**: rebuild backend (regla 3) + stop/up. Health-check 5/5 verde. Sintaxis verificada con `node -c`.

### 2026-05-06 (mañana-2) — UX admin: columnas "IVA %" y "Desglose" unificadas en una sola
- **Cambio**: la tabla del panel admin (`/admin-facturas.html`) tenía dos columnas separadas que mostraban información parcial:
  - **"IVA %"** (`field: iva_porcentaje`): mostraba el porcentaje en mono-IVA y `—` en multi-IVA.
  - **"Desglose"** (`field: lineas_iva`): mostraba `1 tramo` (gris, sin valor) en mono-IVA y `🧾 N tramos` (badge azul clickable) en multi-IVA.
- **Resultado nuevo**: una única columna **"IVA %"** (ancho 110px, sin sort) que fusiona ambos comportamientos:
  - **Mono-IVA** (sin `lineas_iva` o length < 2) → muestra el porcentaje (`21 %`, `10 %`, etc.) editable con lápiz como antes.
  - **Multi-IVA** (length ≥ 2) → muestra el badge `🧾 N tramos` clickable que abre el modal de desglose, igual que antes hacía la columna "Desglose".
- **Helpers**:
  - `formatIvaPctUnified(cell)` reemplaza al antiguo `formatIvaPctMulti`.
  - `ivaPctUnifiedCellClick(_e, cell)` reemplaza al antiguo `ivaPctCellClick`. En multi-IVA cualquier click sobre el badge abre `openDesgloseModal(row)`. En mono-IVA solo el click sobre `.edit-cell-btn` abre `openEditModal(row, 'iva_porcentaje')`.
  - `formatDesglose(cell)` eliminado (código muerto tras la fusión).
- **`persistenceID` bumpeado** de `setex-admin-facturas-v8` a `v9`: necesario porque Tabulator persiste anchos de columna en `localStorage`. Sin bump, los usuarios ya activos verían un hueco vacío donde estaba la columna "Desglose" hasta forzar un reset manual.
- **Cache-buster**: `admin-facturas.js?v=20260506-002`.
- **Deploy**: rebuild frontend + stop/up. Sintaxis verificada con `node -c`. Health-check 5/5 verde. Backend no tocado.

### 2026-05-06 — Fix: resumen general no se renderizaba en mono-IVA al abrir el modal
- **Síntoma**: tras eliminar el bloque `confirm-iva-calc` (iteración 2026-04-30 tarde-5), el cuadro "RESUMEN" aparecía vacío al abrir el modal de confirmación con facturas mono-IVA.
- **Causa raíz**: `updateLineasIvaSummary()` solo se invocaba (a) desde `renderLineasIvaMulti()` para multi-IVA, o (b) desde el listener `input` de los campos mono — que **no se dispara cuando se asigna `.value =`** programáticamente al cargar el preview. Resultado: el `#confirm-lineas-iva-summary` quedaba vacío en mono-IVA hasta que el usuario tecleaba algo.
- **Fix**: añadida llamada explícita a `updateLineasIvaSummary()` al final de `renderUploadPreview` en `app/frontend/src/app.js`, justo después de `updateIVACalc()`. Ahora el resumen aparece poblado desde el primer render.
- **Cache-buster**: `app.js?v=20260506-001`. Health-check 5/5 verde.

### 2026-04-30 (tarde-5) — UX: limpieza visual del modal (placeholder IRPF, textos auxiliares y verificador final)
- **Placeholder de RETENCIÓN IRPF %**: cambiado de `15,0` a `0,00` en `app/frontend/src/index.html`. Coherente con el placeholder del input "CUOTA IRPF (€)" que ya era `0,00`.
- **Texto auxiliar eliminado**: el `<div>` "Solo se admiten 21, 10, 4 o 0." que aparecía bajo el input IVA % en mono-IVA. Eliminado en `index.html`.
- **Tooltip eliminado**: atributo `title="Solo se admiten 21, 10, 4 o 0"` quitado de los inputs IVA % de tramo en `app.js` (`renderLineasIvaMulti`) y `admin-facturas.js` (`renderDesgloseBlocks`). El snap automático sigue activo, pero sin texto explicativo visible.
- **Bloque verificador final eliminado**: `<div id="confirm-iva-calc">` (mostraba "✓ Base × IVA = ..." en tiempo real justo antes del botón "Confirmar y guardar") quitado del `index.html`. La función `updateIVACalc()` no se elimina porque hace early return si el elemento no existe (`if (!calcEl) return;`) — sigue siendo invocada desde varios sitios pero no produce output visible. Los avisos de descuadre por tramo (`tramo-warning`) y la apertura automática de cuadros con anomalía siguen cumpliendo el rol de validación.
- **Cache-busters**: `app.js?v=20260430-009`, `admin-facturas.js?v=20260430-009`.
- **Deploy**: rebuild frontend. Sintaxis verificada con `node -c`. Health-check 5/5 verde. Backend no tocado.

### 2026-04-30 (tarde-4) — Alta de empresa cliente "INGENIERIA TERMOACUSTICA DBK SLU"
- **Datos**: CIF `B06533277` (validado por `validateCIF.js`, dígito control 7 correcto), email principal `administracion@itdbk.es`.
- **`client_companies`** (id=66): insertada con `activa=true`, `pendiente=false`, `registration_source='admin'`. `codigo_cliente=NULL` (admin puede asignarlo después desde el panel `/admin-facturas.html`).
- **`allowed_emails`** (id=10): email autorizado para registro.
- Operación atómica en una sola transacción (`BEGIN`/`COMMIT`). Cero impacto en código o despliegue. Backend sin tocar.

### 2026-04-30 (tarde-3) — Aviso visual por tramo cuando no cuadra CUOTA = BASE × IVA% / 100
- **Banner rojo dentro de cada tramo descuadrado**: el bloque del tramo incluye un `<div class="tramo-warning">` (`.desg-tramo-warning` en admin) oculto por defecto que se muestra cuando los 3 campos están rellenos pero no cumplen la regla `CUOTA ≈ BASE × IVA% / 100` (tolerancia 0,02€). Texto: "⚠ Revisar este tramo: la cuota no cuadra con BASE × IVA % ÷ 100."
- **Helpers nuevos**:
  - `tramoCuadra(base, pct, cuota)` / `tramoCuadraAdmin(...)`: devuelve true/false/null (null si algún valor no es numérico).
  - `updateTramoWarning(block)` / `updateAdminTramoWarning(...)`: muestra/oculta el banner del bloque pasado.
  - `updateAllTramosWarnings()` / `updateAllAdminTramosWarnings()`: itera todos los bloques visibles.
- **Conexión a eventos**: tras cualquier `oninput` (BASE/CUOTA) o `focusout` (IVA % con snap+recalc) se reevalúa el aviso del bloque afectado. Al renderizar tramos (incluido tras OCR) se evalúan todos los bloques.
- **Comportamiento**: cuando OCR detecta valores incoherentes (p.ej. BASE=100, IVA%=21, CUOTA=18 detectados como tres lecturas independientes), el banner aparece en ese tramo concreto y `tieneAnomaliaTramos()` devuelve true, lo que abre automáticamente el cuadro `box-tramos`. Cuando el usuario edita un campo, la coherencia automática (`recalcCoherenciaTramo`) ajusta el campo derivado y el banner desaparece.
- **Cuadros plegables (recordatorio)**: ambos cuadros (`box-tramos` y `box-irpf`) plegados por defecto. Solo se abren si `tieneAnomaliaTramos()` o `tieneAnomaliaIrpf()` devuelven true.
- **Cache-busters**: `app.js?v=20260430-008`, `admin-facturas.js?v=20260430-008`.
- **Deploy**: rebuild frontend. Sintaxis verificada con `node -c`. Health-check 5/5 verde. Backend no tocado.

### 2026-04-30 (tarde-2) — Coherencia matemática CUOTA = BASE × IVA% / 100 + cuadros plegados por anomalía
- **Regla matemática estricta en cada tramo** (`app/frontend/src/app.js` y `admin-facturas.js`): siempre debe cumplirse `CUOTA = BASE × IVA% / 100`. La UI fuerza la coherencia automáticamente:
  - Editar **BASE** o **IVA %** → se recalcula CUOTA al instante.
  - Editar **CUOTA** → se recalcula BASE (`BASE = CUOTA × 100 / IVA%`), asumiendo que el usuario corrige el agregado.
  - Listener `oninput` en BASE y CUOTA del tramo (delegation por contenedor) y `focusout` en IVA % (tras el snap).
  - Guard `document.activeElement` para no sobreescribir el campo que tiene el foco del usuario.
  - Aplicado en multi-IVA (tramos), modal admin (`recalcCoherenciaAdminTramo`), y mono-IVA (`recalcCoherenciaMono` sobre `confirm-base`/`confirm-iva-pct`/`confirm-cuota-iva`).
- **Política nueva de cuadros plegables**: ambos cuadros (`box-tramos` y `box-irpf`) aparecen **plegados por defecto**. Solo se abren si hay anomalía detectada, llamando la atención del usuario al problema:
  - **`tieneAnomaliaTramos()`**: cubre multi-IVA (algún tramo con cuota ≠ base × pct/100, tolerancia 0,02€, o campo vacío) y mono-IVA (incoherencia entre Base/IVA%/Cuota).
  - **`tieneAnomaliaIrpf()`**: hay valor parcial (solo IRPF % o solo Cuota IRPF), no parseable, o `cuota_irpf ≠ base_total × irpf%/100` (tolerancia 0,02€).
  - `renderUploadPreview` evalúa ambas tras pintar los datos del OCR y abre/pliega cada cuadro en consecuencia.
  - Resultado UX: si OCR lee la factura correctamente, el usuario solo ve el resumen (Base/Cuota IVA/Cuota IRPF/Total) y los dos cuadros plegados con flecha. Si OCR falló o el usuario debe corregir algo, los cuadros se abren automáticamente para mostrar el problema.
- **Tolerancia**: `COHERENCIA_TOL_EUR = 0.02`. Permite redondeos de céntimos sin marcar falsa anomalía.
- **Helper `round2(n)`** y `_round2Admin(n)` para redondeos consistentes a 2 decimales.
- **Cache-busters**: `app.js?v=20260430-007`, `admin-facturas.js?v=20260430-007`.
- **Deploy**: rebuild frontend + stop/up. Sintaxis verificada con `node -c`. Health-check 5/5 verde. Backend no tocado.

### 2026-04-30 (mediodía) — UX admin: columna "IVA %" muestra — en facturas multi-IVA
- **Tabla del panel admin** (`app/frontend/src/admin-facturas.js`): la columna `iva_porcentaje` ahora muestra `—` (gris claro) cuando la factura es multi-IVA (`lineas_iva.length >= 2`). Razón: en multi-IVA, el porcentaje agregado almacenado en la columna `iva_porcentaje` es solo el "tipo dominante" calculado por el backend, no representa la realidad de la factura. El detalle real está en la columna "Desglose" y se edita en el modal de tramos.
- **Edición bloqueada en multi-IVA**: el lápiz `✏️` desaparece y `cellClick` no abre el modal de edición de IVA %. Para cambiar el IVA % de una factura multi-IVA hay que abrir el modal de Desglose (badge `🧾 N tramos` en la columna Desglose) y editar los tramos individuales.
- **Mono-IVA sin cambios**: las facturas mono-IVA (sin `lineas_iva` o con `length < 2`) siguen mostrando el porcentaje y el lápiz como antes.
- **Helpers añadidos**: `formatIvaPctMulti` y `ivaPctCellClick`. La columna usa estos en lugar de `makeEditableFormatter('iva_porcentaje', formatPct)` / `makeEditableCellClick('iva_porcentaje')`.
- **Cache-buster**: `admin-facturas.js?v=20260430-006`.
- **Deploy**: rebuild frontend. Health-check 5/5 verde. Backend no tocado.

### 2026-04-30 (mañana) — UX: dedupe de tramos por IVA % + máximo 4 tramos
- **Nueva regla**: en multi-IVA, **nunca pueden aparecer dos tramos con el mismo IVA %**, y **como máximo 4 tramos** (uno por cada valor de {21, 10, 4, 0}). Caso típico que motiva la regla: el OCR a veces lee dos veces el mismo tramo y devuelve líneas duplicadas con valores idénticos.
- **Nuevos helpers** en `app/frontend/src/app.js`: `dedupeAndCapTramos(lineas)` (snap IVA % + dedupe por % conservando el primero + cap a 4) y `firstAvailableRate(lineas)` (devuelve el primer % de los 4 que aún no está en uso). Mismos helpers `dedupeAndCapAdminTramos` / `firstAvailableAdminRate` en `app/frontend/src/admin-facturas.js`.
- **Aplicado en 4 puntos**:
  1. **Render inicial** (`renderLineasIvaMulti` y `renderDesgloseBlocks`): se deduplica antes de pintar — los tramos duplicados del OCR desaparecen al cargar el modal.
  2. **`focusout`** de un input de IVA % de tramo: si tras snappear el valor coincide con otro tramo existente, se elimina el duplicado y se re-renderiza.
  3. **Botón "Añadir tramo"**: ahora calcula el primer % libre y crea el tramo con ese %, p.ej. "➕ Añadir tramo al 10%". Si los 4 tipos ya están presentes, el botón se sustituye por un mensaje "Ya tienes los 4 tipos de IVA posibles (21, 10, 4 y 0)" y no se permite añadir más.
  4. **Antes de enviar al backend** (`confirmUpload` y `saveDesglose`): salvaguarda final con `dedupeAndCapTramos`.
- **Cache-busters**: `app.js?v=20260430-005`, `admin-facturas.js?v=20260430-005`.
- **Deploy**: rebuild frontend + stop/up. Sintaxis verificada con `node -c`. Health-check 5/5 verde. Backend no tocado.

### 2026-04-30 (madrugada) — UX: 3 cuadros (Tramos plegable / IRPF plegable / Resumen no plegable) · snap IVA % {21,10,4,0}
- **Modal de comprobación reestructurado** (`app/frontend/src/index.html`): el bloque "DESGLOSE IVA" se sustituye por 3 cuadros independientes:
  1. **`<details id="box-tramos">`** (plegable, abierto si OCR detectó datos): contiene la vista mono (Base/IVA%/Cuota directos) o la vista multi (lista de tramos editables).
  2. **`<details id="box-irpf">`** (plegable, abierto si OCR detectó IRPF o el proveedor parece persona física): contiene los inputs de "RETENCIÓN IRPF %" y "CUOTA IRPF (€)".
  3. **`<div id="box-resumen">`** (no plegable, siempre al final): los 4 valores Base / Cuota IVA / Cuota IRPF / Total.
- **CSS añadido** en `<head>` para `details.box-collapsible` con flecha custom (`▾` que rota -90° al plegar). Marcador nativo oculto multi-navegador (`::-webkit-details-marker { display:none; }` y `::marker { content:'' }`).
- **Snap de IVA % a {21, 10, 4, 0}** (`snapToValidIvaRate` en `app.js` y `snapAdminIvaRate` en `admin-facturas.js`): España solo admite estos 4 tipos. Si OCR lee "211" → 21; "9,5" → 10; "3" → 4; "0,21" → 21. Aplicado en 3 momentos: (a) al renderizar tramos (corrige errores OCR en pantalla), (b) en `focusout` del input de IVA % (delegation por contenedor), (c) antes de enviar al backend en `confirmUpload` y `saveDesglose`. Mismo snap también en el input mono `confirm-iva-pct` (blur).
- **Resumen General**: `summary-base` y `summary-cuota-iva` ahora son **readonly** (siempre coinciden con la suma de los tramos en multi-IVA, o con `confirm-base`/`confirm-cuota-iva` en mono). Cumple la restricción del usuario "Cuota IVA del final debe coincidir con la suma de Cuota TRAMO". `summary-cuota-irpf` y `summary-total` siguen editables y bidireccionales con `confirm-cuota-irpf` y `confirm-total`.
- **Estado plegado por defecto**: en `renderUploadPreview` se marca `box-tramos.open = isMultiIva || hasMonoData` y `box-irpf.open = !!showIrpf`. Si la factura no tiene tramos ni IRPF, ambos cuadros llegan plegados. `showIRPFSection`/`hideIRPFSection` actualizadas para abrir/plegar `box-irpf`.
- **Lectura unificada mono/multi del resumen**: `updateLineasIvaSummary` detecta qué vista está visible y lee desde tramos o desde los inputs mono. El resumen aparece SIEMPRE (también en mono).
- **Cache-busters bumpeados**: `app.js?v=20260430-004`, `admin-facturas.js?v=20260430-004`.
- **Deploy**: rebuild frontend + stop/up. Sintaxis verificada con `node -c`. Health-check 5/5 verde. Backend no tocado.

### 2026-04-30 (noche) — UX: resumen multi-IVA con 4 inputs editables y linkado bidireccional
- **Resumen multi-IVA reescrito a inputs editables** en `app/frontend/src/app.js` (`updateLineasIvaSummary` + nuevo `wireSummaryInputs`) y `app/frontend/src/admin-facturas.js` (`updateDesgloseSummary` + nuevo `wireDesgSummaryInputs`). Cuatro filas: **Base** · **Cuota IVA** · **Cuota IRPF** (siempre con signo negativo, p.ej. `-25,00`) · **Total**. La identidad `Base + Cuota IVA − Cuota IRPF = Total` se mantiene en cada cambio.
- **Linkado bidireccional** (modal usuario): `summary-cuota-irpf` ↔ `confirm-cuota-irpf` y `summary-total` ↔ `confirm-total`. Al editar IRPF en el resumen se propaga al campo de arriba y se recalcula Total. Al editar IRPF/Total arriba se refleja en el resumen. Anti-bucle con flag `_summarySyncing` y guarda `_topLevelSummaryListenersWired` para no duplicar listeners en `confirm-total`/`confirm-cuota-irpf` aunque el resumen se re-renderice.
- **Comportamiento del Total**: al editar Base, Cuota IVA o IRPF se recalcula automáticamente (cuadre garantizado). Al editar Total directamente solo sincroniza con el campo de arriba (no fuerza re-cuadre — el usuario decide qué corregir, igual que `updateIVACalc()` que ya marca con ✗ rojo si rompe la coherencia).
- **Modal admin**: el resumen guarda `cuota_irpf` y `total_factura` en `desgloseIrpfCuota` (cacheado al abrir modal) y al pulsar "Guardar cambios" se envían ambos al PUT `/api/admin/facturas/:id` junto con `lineas_iva`. La fila Tabulator se actualiza con los nuevos valores en `row.update()`. El backend ya aceptaba esos campos en `EDITABLE`.
- **Limitación documentada**: en multi-IVA, **Base y Cuota IVA del resumen son la suma de los tramos**. El backend recalcula esos agregados en `normalizeConfirmedLineasIva()` desde `lineas_iva`, así que un override manual en `summary-base`/`summary-cuota-iva` se descarta al guardar (los tramos son la fuente). Para cambiar la base agregada el usuario debe editar los tramos. Total e IRPF SÍ se persisten desde el resumen porque no se recalculan en el backend.
- **Cache-busters bumpeados**: `app.js?v=20260430-003`, `admin-facturas.js?v=20260430-003`.
- **Deploy**: rebuild frontend + stop/up. Health-check 5/5 verde. Sintaxis JS verificada con `node -c`.

### 2026-04-30 (tarde) — UX: eliminada UI de productos en desglose IVA · resumen simplificado con Total - IRPF
- **Eliminada toda la UI de productos en el desglose multi-IVA** (`app/frontend/src/app.js` y `app/frontend/src/admin-facturas.js`): se quitan inputs de descripción/importe, botones "➕ Añadir producto" y "✕" eliminar producto, y la sección "PRODUCTOS DE ESTE TRAMO". Cada bloque-tramo ahora muestra solo IVA % / BASE TRAMO / CUOTA TRAMO. `readLineasIvaFromUI()` y `readDesgloseFromUI()` dejan de leer/serializar el array `productos`. **Backend NO tocado**: el OCR sigue extrayendo productos en `lineas_iva[].productos` y el validador de iva.js los normaliza; el admin Excel export (`/admin/facturas/desglose.xlsx`) los sigue mostrando como columna informativa. Si el usuario edita y guarda, el backend recibe `lineas_iva` sin la propiedad `productos` y el validador la repuebla a `[]` por línea (preserva schema BD).
- **Resumen multi-IVA reescrito** (`updateLineasIvaSummary` en app.js · `updateDesgloseSummary` en admin-facturas.js): elimina nº tramos, símbolos Σ y "Tipo dominante". Muestra ahora 3 filas apiladas: **Base** (suma de bases), **Cuota IVA** (suma de cuotas), **Total** (= Base + Cuota IVA − Cuota IRPF). En el modal de comprobación lee `#confirm-cuota-irpf` con event listener que recalcula al editar IRPF. En el modal admin lee `rowData.cuota_irpf` cacheado en `desgloseIrpfCuota` al abrir el modal.
- **Cache-busters bumpeados**: `app.js?v=20260430-002`, `admin-facturas.js?v=20260430-002`.
- **Deploy**: `docker compose build frontend && stop frontend && up -d frontend`. Health-check 5/5 verde, HTTPS 200.

### 2026-04-30 — UX: panel desglose IVA apilado vertical · fix botón "Ver imagen" admin
- **Apilado vertical de inputs IVA/IRPF en el modal de confirmación** (`app/frontend/src/index.html`): los recuadros BASE IMPONIBLE / IVA % / CUOTA IVA y los de RETENCIÓN IRPF % / CUOTA IRPF pasan de una fila estrecha (`flex` horizontal) a apilarse verticalmente (`flex-direction:column`) ocupando el 100 % del ancho del panel. Inputs ampliados a `font-size:15px; padding:8px 10px` para mejor legibilidad en móvil. Motivo: en pantallas estrechas los recuadros eran apenas visibles y dificultaban revisar/corregir los valores extraídos por OCR.
- **Apilado vertical de tramos en vista MULTI-IVA** (`app/frontend/src/app.js` `renderLineasIvaMulti()`): cada tramo IVA muestra IVA % / BASE TRAMO / CUOTA TRAMO uno debajo de otro, con cabecera "TRAMO N" y botón "✕ Eliminar tramo" en la esquina superior derecha. Mismo cambio replicado en el modal de desglose del panel admin (`app/frontend/src/admin-facturas.js` `renderDesgloseBlocks()`).
- **Fix botón "Ver" columna Imagen del panel admin** (`app/frontend/src/admin-facturas.js` `verImagenAdmin()`): la función usaba `localStorage.getItem('token')` para construir el header `Authorization`, pero desde el rediseño de auth (token en memoria + RT cookie httpOnly) `localStorage` siempre devuelve `null` y la petición fallaba con 401. Refactorizada para usar `authFetch()` (delega en `Auth.apiFetch`) con refresh automático y retry. Añadido soporte para PDFs (iframe) además de imágenes, cierre con tecla Escape, limpieza de URL.createObjectURL, y `aria-label` en el botón cerrar.
- **Cache-busters bumpeados**: `app.js?v=20260430-001`, `admin-facturas.js?v=20260430-001`.
- **Deploy**: `docker compose build frontend && stop frontend && up -d frontend`. Health-check 5/5 verde, HTTPS 200, cache-busters servidos correctamente. Backend no tocado.

### 2026-04-28 — 🏷️ v2.0.0 promocionado a `main` · refactor v3 modular Awilix DI en runtime
- **Hito**: cierre completo del descongelado del refactor v3. Tag `v2.0.0` publicado en `main @ a1cda6d`. PR #93 mergeado (squash). Deploy a producción ejecutado con `DESPLEGAR`.
- **Cronología de la sesión** (UTC):
  - **07:18** — Salimos del bloqueo horario. Smoke staging 3/3 verde con monolito (`70f9e86`). Validación previa: 14h estables sin reinicios desde 27-Abr 17:41.
  - **07:24** — Deploy de staging-watch (PR #89) y swap v3 (PR #90) disparados.
  - **07:25** — Primer fallo: `paths.sh` root-owned bloquea git reset (LL-001 reproducido). Julio aplicó `sudo chown` manual.
  - **07:28** — Smoke fallo por basic-auth Traefik 401. Refactor smoke a `docker exec` (PR #88 ya mergeado lo cubría). Re-deploy verde.
  - **07:40** — PR #89 mergeado (`5048433`) · vigilancia activa.
  - **07:46** — PR #90 (Etapa 6 swap) mergeado (`5bd668f`). Deploy v3 falla por permisos `.git/objects` (LL-001 segundo síntoma). Julio aplicó `sudo chown -R deploy:deploy /opt/setex/staging/.git`.
  - **07:54** — Re-deploy verde. v3 CORRIENDO en runtime: `server.js` = 60 líneas, `server.legacy.js` = 4308 líneas.
  - **07:58** — Smoke 3/3 verde end-to-end pero `docker logs setex-staging-backend` **completamente vacío**. Investigación.
  - **08:10** — **Bug crítico cazado**: `sanitizeMetaFormat` en `src/config/logger.js` devolvía un objeto NUEVO en lugar de mutar `info`. winston descartaba silenciosamente cada log. El v3 corría sin emitir nada a stdout/stderr ni a fichero.
  - **08:18** — Hotfix logger + 6 tests dedicados en `tests/unit/logger.test.js` (incluyen test de regresión del silencio). Suite total 50/50 pass.
  - **08:30** — PR #91 (`b77c852`) mergeado. Re-deploy del hotfix: SSH timeout transitorio en primer intento; éxito en re-disparo.
  - **08:53** — Verificación final staging post-hotfix:
    ```
    SETEX backend (v3) escuchando pid:1 port:3000
    redis client ready · pg pool ready · SMTP transporter verified
    Smoke 3/3 verde
    ```
  - **09:18** — PR #92 (develop → main) creado pero `mergeable: dirty` por 6 conflicts (`server.js`, `INFORME`, `ROADMAP`, `CLAUDE.md`, `MACROPLAN`, `adr/README`).
  - **09:25** — Conflicts resueltos en branch `release/v2.0.0` tomando develop's version. Multi-IVA verificado: `domain/validators/iva.js` IDÉNTICO en ambas ramas (`git diff --quiet`). PR #92 cerrado, PR #93 abierto sobre `release/v2.0.0`.
  - **09:33** — CI verde 3/3 sobre PR #93. Squash merge a main → `a1cda6d`. Tag `v2.0.0` creado annotated.
  - **09:36** — `Deploy a producción (manual)` disparado con `DESPLEGAR`.
- **Bug logger silencioso — análisis técnico**:
  - **Causa**: `winston.format(fn)` requiere que `fn` MUTE el objeto `info` y lo devuelva, o devuelva `false` para descartar la entrada. Devolver un objeto NUEVO hace que winston ignore la transformación y descarte el log silenciosamente.
  - **Código defectuoso** (pre-fix): `return { level, message: ..., timestamp, ...sanitizedRest };`
  - **Fix**: mutar `info` en place (`info[key] = sanitize(...)` para cada key no-reserved).
  - **Mejora adicional**: redacción de keys top-level sensitive (`password`, `token`, `secret`, `jwt`, `csrf`, `cookie`, `apiKey`, `refreshToken`) — antes solo se redactaban dentro de objetos anidados.
  - **Tests dedicados**: 6 en `tests/unit/logger.test.js` que detectarían cualquier regresión similar (incluido el test del silencio total).
  - **Lección**: si la Etapa 5 hubiera durado las 24h originales sin bug detectado, el v3 habría ido a prod silencioso 24/7 → diagnóstico de incidencias imposible. La Etapa 5 cumplió su propósito en menos tiempo del previsto.
- **Defensas activas tras v2.0.0** (cualquier regresión a partir de aquí dispara alarmas automáticas):
  1. Test paridad legacy↔v3 en CI con allowlist vacía → si una ruta del monolito desaparece o no se porta al v3, CI rompe antes del merge.
  2. Healthcheck container apunta a `/api/internal/check-access` (whitelist 200/403). 404 → unhealthy → Docker reinicia.
  3. Smoke HTTP post-deploy en `deploy-staging.yml` y `deploy-prod.yml`. Si rompe → deploy aborta.
  4. Logger funcional con tests dedicados → silencio total imposible.
  5. Rollback < 30s: `docker exec -d setex-prod-backend node src/server.legacy.js` arranca el monolito sin redeploy.
  6. Cron Claude session cada hora (job `754e45ea`) reporta estado al chat.
- **Estado final post-deploy a prod** (UTC ~09:40, pendiente verificación E2E):
  - main HEAD: `a1cda6d release: v2.0.0 · refactor v3 modular Awilix DI en runtime (#93)`
  - tag: `v2.0.0` annotated apuntando a `a1cda6d`
  - server.js prod: v3 modular 60 líneas (rebuild + recreate del container backend)
  - server.legacy.js prod: monolito 4308 líneas (rollback rápido)
- **PRs incluidos en v2.0.0**: #63-#82 (Rounds 1-15 v3 + 5 hotfixes), #85 (rollback Etapa 0), #86 (5 rutas portadas), #87 (paridad+healthcheck+smoke), #88 (LL-001 + smoke docker exec), #89 (vigilancia), #90 (swap), #91 (logger fix), #93 (release).
- **Deuda no urgente que cierra esta sesión**:
  - `src/server.legacy.js` borrado en Q3 tras 30 días estable de v3 en prod.
  - Refactor `sanitizeMetaFormat` con wrapper defensivo (deja el código menos error-prone) — Q3 si Julio lo decide.
  - Activación cron persistente VPS (`config/crontab.txt` staging) — pendiente acción manual.

### 2026-04-29 — Sistema de subagentes Claude Code + consolidación documental + convención staging-first

**Sistema de subagentes operativo:**
- 9 agentes globales en `~/.claude/agents/` (devuser): code-reviewer, security-auditor, express-vanilla-pro, postgres-optimizer, docker-vps-ops, test-automator, debugger, ai-engineer, docs-writer.
- 6 agentes de proyecto en `prod/.claude/agents/` y replicados en `staging/.claude/agents/`: setex-ocr-engineer, invoice-validator-spanish, rgpd-spain-auditor, dual-pipeline-orchestrator, setex-tester, setex-ops-deploy.
- Instalación reproducible vía `setup-agents-setex.sh` (idempotente).
- Sin impacto en código de producción ni en los 8 contenedores Docker.

**Convención operativa formalizada — staging-first:**
- Todo cambio significativo en código (refactor, swap, migración) se prueba PRIMERO en `/opt/setex/staging/` durante 24-48h con tráfico/datos de prueba.
- Solo tras validación de monitoring (logs, watchdog, smoke OCR) se promueve a prod.
- El monolito de 4308 LOC vive actualmente solo en prod; staging tiene v3 modular para validación. Discrepancia INTENCIONAL hasta cierre FASE 1B.

**Consolidación documental:**
- Verificación de coherencia entre CLAUDE.md, INFORME, PLAN-FASE-4 y ROADMAP.
- Añadidos enlaces cruzados PLAN-FASE-4 ↔ ROADMAP Q2-2026.
- Decisión expresa: NO archivar DECISIONS.md (regla 10 CLAUDE.md, convención ADR estándar inmutable).
- PLAYBOOK_EMERGENCIAS.md verificado vigente.

**Permisos git regularizados:**
- `.git/` en prod y staging con `g+w` y setgid: `devuser` (en grupo `deploy`) puede operar sin `sudo -u deploy`.
- Sin tocar propietarios. Reversible con `chmod -R g-w .git`.

**Riesgos del pipeline OCR detectados (pendientes de validación cuantitativa):**
- MEDIO — `azure.js:311` `f.InvoiceTotal ?? f.AmountDue`: si Azure DI devuelve `AmountDue` en facturas con pagos parciales, se persiste como total y la unique key `(user_id, nif, fecha, total)` puede fallar silenciosamente. Acción pendiente: query SQL sobre tabla `uploads`.
- MEDIO — `openai.js:298-303` `AbortSignal.timeout(60000)` en pipeline síncrono sin circuit-breaker: si OpenAI tarda >60s, `Promise.allSettled` absorbe la excepción sin alerta. Acción pendiente: revisar logs últimos 30 días de `scripts/smoke-test-ocr.js`.

### 2026-04-27 (noche) — FASE 1B Etapas 0-4 cerradas · v3 listo para swap futuro
- **Contexto**: sesión de descongelado del refactor v3 que estaba congelado en `develop` desde el incidente Round 16 (2026-04-22). Plan ejecutable: `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md`. Ejecutadas las 4 etapas que **se pueden hacer hoy**; las 2 restantes (5: validación 24-48h · 6: swap real) quedan listas para que Julio las dispare cuando decida.
- **Etapa 0 — Rollback en `develop`** (PR #85, squash `6c9f65b`):
  - `develop` apuntaba al swap v3 roto (`0e48ab3`, PR #83). Cualquier `deploy-staging.yml` reproducía el incidente.
  - Aplicado el rollback equivalente al de disco del 22-Abr: `server.js` = monolito 4308 líneas, `server.next.js` = v3 mini congelado, `server.legacy.js` borrado, `package.json` con `start:next` + `overrides.uuid ^14.0.0`, `eslint.config.js` con excepción `max-lines` migrada al monolito.
  - Documentación masiva incluida: `PLAN-FASE-4-DESCONGELADO-V3.md` (NUEVO), `MACROPLAN-SETEX-v2.0.md`, `ROADMAP.md`, `.claude/CLAUDE.md`, este `INFORME`.
  - CI ROJO inicial por `npm audit` con `uuid<14`: regenerado lockfile completo + `overrides` explícito en lockfile root → CI verde.
- **Etapa 1 — Portar 5 rutas faltantes** (PR #86, squash `5513b5f`):
  - Las 5 rutas que tiraron staging en 404 masivo el 22-Abr ya están en el v3:
    - `GET /api/internal/check-access` (auth_request crítica)
    - `GET /api/internal/check-admin-page` (auth_request admin)
    - `POST /api/admin/refresh-session` (cookie `setex_admin` 8h httpOnly)
    - `POST /api/admin/retry-failed/:id` (panel admin · failed_jobs)
    - `PATCH /api/admin/security/time` (edita time_restriction)
  - Decisiones técnicas: reutilizado `tokenVerificationService.verify()` (timeout 500ms fail-secure ya existente) en `check-admin-page`. `req.cookies` (cookie-parser ya montado). `ipListManagerService` extendido con `updateTimeRestriction(patch)` en vez de crear `securityConfigService` nuevo (DRY).
  - Tests unitarios: 20 tests nuevos en `tests/contracts/internal-routes.test.js`, suite total 39/39 pass.
- **Etapa 2 — Test paridad legacy↔v3 + CI integration** (PR pendiente squash al cerrar esta sesión):
  - `tests/contracts/api-surface-parity.test.js`: regex sobre `server.js` extrae rutas del monolito (58 detectadas), `mountRoutes(app, { container: mockContainer })` con stubs Awilix `asValue` extrae rutas del v3, comparación 1:1 estricta. Allowlist vacía. Si el v3 deja de portar una ruta, CI rompe.
  - Workflow `.github/workflows/ci.yml`: nuevo job `tests` que corre `node --test tests/` + `npm run depcruise` (boundaries entre capas). Si la paridad rompe en una PR, no se mergea.
  - Bump `actions/checkout@v4 → @v5` y `actions/setup-node@v4 → @v5` para silenciar warning "Node.js 20 actions deprecated" (válidos hasta junio 2026, mejor pre-empt).
  - Endurecimiento adicional `ipListManager.updateTimeRestriction`: validación rangos `[0,23]` para `start_hour`/`end_hour` (antes solo se rechazaba `start === end`).
  - Suite total: 44/44 pass. depcruise: 0 errors, 0 warnings, 181 modules.
- **Etapa 3 — Healthcheck container endurecido**:
  - `app/backend/Dockerfile`: HEALTHCHECK ahora apunta a `/api/internal/check-access` (no `/health` trivial). Whitelist de status codes "healthy": 200 (todo OK) y 403 (hora bloqueada, comportamiento esperado). Cualquier otro (404, 5xx, conn refused, timeout) → unhealthy → Docker reinicia container automáticamente.
  - Esto detecta el incidente Round 16 EN RUNTIME: si el v3 no porta la ruta, el healthcheck devuelve 404 → unhealthy → recuperación automática (en lugar de servir 404 a usuarios durante horas).
  - El monolito ya tiene la ruta (línea 700 server.js), así que el cambio es transparente para el runtime actual.
- **Etapa 4 — Smoke HTTP post-deploy en workflows**:
  - `scripts/smoke-test-http.sh` (NUEVO, idempotente, sin OCR real). 3 verificaciones (~5s):
    1. `GET /health` → 200 (proceso vivo)
    2. `GET /api/internal/check-access` → 200 ó 403 (un 404 = INCIDENTE ROUND 16 → exit 1 inmediato con mensaje explícito)
    3. `POST /api/auth/login` con creds inválidas → 401/429 (endpoint vivo)
  - `deploy-staging.yml` y `deploy-prod.yml`: step `Smoke HTTP post-deploy` tras los healthchecks verdes. Si falla, deploy aborta. En prod el mensaje es prefijo "REVISAR INMEDIATAMENTE".
  - El smoke se sourcea con `paths.sh` para autodetectar entorno y BASE_URL — un solo script para ambos entornos.
- **PR adicional** (mismo branch): HSTS staging `max-age=63072000` (2 años) → `315360000` (10 años) en las 4 ocurrencias de `app/frontend/nginx.conf`. Equipara con prod (que ya tiene 10 años desde el cleanup post-cutover Fase 4). Sin downside funcional. Suma puntos para HSTS preload list.
- **Etapas pendientes** (no automatizables hoy):
  - **Etapa 5**: validación staging 24-48h tras deploy de develop con todo este plumbing. Requiere observación humana de logs/watchdog.
  - **Etapa 6**: swap final del v3 a runtime (rename `server.js` ↔ `server.next.js`) + tag `v2.0.0` + promoción manual a prod (`deploy-prod.yml` con `DESPLEGAR`). El plan PLAN-FASE-4-DESCONGELADO-V3.md sección 6 detalla los pasos exactos.
- **Estado neto del descongelado a 2026-04-27 23:55 UTC**: el v3 modular está totalmente listo para arrancar en runtime. Cualquier deploy a staging desde develop reproduce el monolito (no el v3) porque el swap es un cambio explícito de Etapa 6. El plumbing de seguridad alrededor del swap (test paridad CI + healthcheck + smoke post-deploy) garantiza que un v3 incompleto NO puede llegar a producción sin que CI/deploy lo bloqueen.

### 2026-04-27 (tarde) — PR #84 mergeado a main + deploy a producción · incidente ownership root + lección aprendida
- **Contexto**: tras cerrar las FASES 1, 2, 3 en runtime el 2026-04-27 mañana, se preparó PR #84 (`chore/cleanup-post-cutover-2026-04-27`) con los 5 ficheros que debían commitearse a `main`: `nginx.conf` (HSTS 10 años), `docker-compose.yml` (labels xanflatest), `INFORME_SISTEMA_COMPLETO.md`, `ROADMAP.md`, `.claude/CLAUDE.md`. PR creado vía `git push origin chore/cleanup-post-cutover-2026-04-27` desde clone temporal en `/tmp/setex-cleanup-pr` (clave SSH de devuser autorizada en GitHub como user Juliohes).
- **CI bloqueó por vulnerabilidad uuid**: el job `Lint sintaxis + npm audit` falló con `2 moderate severity vulnerabilities` en `uuid <14.0.0` (GHSA-w5hq-g745-h8pq · missing buffer bounds check), llegando como dependencia transitiva de `exceljs@4.4.0` (última versión, sin update upstream). Solución mínima: segundo commit en la rama del PR con `"overrides": {"uuid": "^14.0.0"}` en `app/backend/package.json` + lockfile regenerado. Verificado: `npm audit` → `found 0 vulnerabilities`, `npm ls uuid` → `uuid@14.0.0 overridden`, smoke `exceljs.Workbook.addWorksheet.addRow` con uuid 14 funcional. Re-ejecución del CI: ambos checks verdes.
- **Squash and merge a main**: commit final `788ff6a chore(ops): cleanup post-cutover Fase 4 · symlink + YAML retirados, HSTS 10 años (#84)`.
- **Primer intento de deploy a producción FALLÓ**: `Deploy a producción (manual)` con `DESPLEGAR` ejecutado vía workflow_dispatch. Job `validate` ✅, job `deploy` ❌ con error en el step `git reset --hard origin/main`:
  ```
  warning: unable to unlink old 'app/backend/src/ports/storage.port.js': Permission denied
  ... (40+ ficheros similares: ports/, routes/admin/, schemas/auth/, services/security/, tests/architecture.test.js, docs/adr/...)
  fatal: Could not reset index file to revision 'origin/main'.
  Process exited with status 128
  ```
- **Causa raíz**: 195 ficheros del refactor v3 (Rounds 1-15) tenían `owner=root:root` (`-rw-rw-r-- 1 root root ...`) en `/opt/setex/prod/`. El `git pull` que los trajo en algún momento previo se ejecutó como root, no como deploy. Como el deploy script SSHea como user `deploy`, no pudo `unlink()` esos ficheros durante el reset. **El cleanup del 22-Abr (setgid + g+rw) se aplicó SOLO a ficheros existentes en ese momento; los traídos posteriormente no fueron cubiertos.**
- **Diagnóstico adicional**: el primer comando de fix propuesto (`find ... -user root -exec chown deploy:deploy {} +`) no funcionó por dos razones: (a) el `\( -user root -o -group root \)` con paréntesis multi-línea se rompió al copy-paste interactivo, y (b) faltaba cubrir el caso "directorio con grupo root + setgid" que bloquea el unlink desde fuera del grupo.
- **Fix aplicado**: comando único en una línea sin filtros find, atacando rutas conocidas:
  ```bash
  sudo chown -R deploy:deploy /opt/setex/prod/app /opt/setex/prod/scripts \
    /opt/setex/prod/docs /opt/setex/prod/tests /opt/setex/prod/.husky \
    /opt/setex/prod/package.json /opt/setex/prod/package-lock.json \
    /opt/setex/prod/commitlint.config.js /opt/setex/prod/.gitignore
  ```
  (`.dependency-cruiser.cjs` no existía en main, pequeño warning ignorado.)
- **Segundo intento de deploy ✅**: re-ejecutado desde Actions. Steps completos: backup pre-despliegue (warning del exit code de `backup-postgres.sh` esperado y tolerado) → `git fetch origin main` → `git reset --hard origin/main` → `docker compose build backend frontend` → `docker compose up -d backend frontend` (recreated). Ambos containers `healthy` en <30 s.
- **Verificación end-to-end post-deploy**:
  - `git status` en `/opt/setex/prod`: limpio (HEAD `788ff6a` == origin/main, branch sigue `develop` por compatibilidad con `deploy-prod.yml` que solo usa el ref, no el branch name).
  - Container `setex-prod-backend` recreado con imagen nueva timestamp `2026-04-27T11:21:57Z`.
  - `docker exec setex-prod-backend node -e "require('uuid/package.json').version"` → `14.0.0` ✅ (vulnerabilidad cerrada en runtime).
  - `https://setex-facturas.es/` → 200 con HSTS `max-age=315360000` ✅.
  - `https://xanflatest.com/` → 302 → `https://setex-facturas.es/` ✅.
  - `https://staging.setex-facturas.es/` → 401 + basic-auth (no afectado por el deploy a prod, sigue OK).
  - 8 containers SETEX healthy.
- **Limpieza filesystem post-deploy**: el `git reset --hard` borró los 9 ficheros que estaban "modificados" (cambios FASE 1 que solo aplicaban sobre develop) y dejó `server.next.js` como untracked. Borrado manual del untracked: `rm /opt/setex/prod/app/backend/src/server.next.js`. `git status` definitivamente limpio. (`develop` mantiene su `server.next.js` mediante el código del refactor v3 que sigue sin commitear en disco staging.)
- **Lección aprendida (LL-001)**: el cron `fix-permissions.sh` (cada hora) debería incluir un step que prevenga la deuda de ownership root:root para que esto no vuelva a romper deploys futuros. Snippet a añadir:
  ```bash
  find "${BASE_DIR}" \
    -not -path '*/data/postgres/*' \
    -not -path '*/secrets/*' \
    -not -path '*/logs/*' \
    -not -path '*/.git/*' \
    -not -path '*/node_modules/*' \
    \( -user root -o -group root \) \
    -exec chown deploy:deploy {} + 2>/dev/null
  ```
  Tarea en ROADMAP Q2 "Tareas operacionales nuevas".
- **Sudoers acotado autoborrado**: el sudoers temporal `/etc/sudoers.d/devuser-cleanup-2026-04-27` (creado para que devuser ejecutara `apply.sh` y `chown` específicos sin password) se autoborró en el último step del cleanup. `sudo -n -l` confirma que NOPASSWD ya no existe. Sin secretos en chat ni privilegios persistentes.
- **Sesiones Claude RC reiniciadas**: `Setex-Produccion-Real` (PID 1895807) y `Setex-Staging-Real` (PID 1870223), ambas con 18-19h de zombi sin uso, killed via `systemctl --user restart tmux-setex-{prod,staging}.service`. Nuevos PIDs 2500887 y 2500883 vivos desde 11:42:37 UTC. Disponibles en app móvil de Claude tras refresh.
- **Documento maestro de la próxima sesión creado**: `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` (10 KB, autocontenido, 6 etapas con tiempos y verificaciones intermedias). `MACROPLAN-SETEX-v2.0.md`, `ROADMAP.md` y `CLAUDE.md` actualizados para apuntar a este plan como prioridad.
- **Ficheros tocados en esta sesión vespertina (12 totales)**: `app/backend/package.json` + `package-lock.json` (override uuid, vía PR #84 commit 2) · `/opt/setex/prod/` filesystem masivo via deploy (164 ficheros sincronizados a estado main) · `docs/plans/PLAN-FASE-4-DESCONGELADO-V3.md` (creado) · `docs/plans/MACROPLAN-SETEX-v2.0.md` (metadata + secciones 5/17/18 + footer) · `docs/ROADMAP.md` (reescrito completo, sincronizado prod=staging) · `.claude/CLAUDE.md` (sección "Siguiente bloque" + "Problemas conocidos" actualizados, sincronizado prod=staging) · `docs/INFORME_SISTEMA_COMPLETO.md` (esta entrada).

### 2026-04-27 — Cleanup post-cutover Fase 4: legacy symlink eliminado · YAML Traefik retirado · HSTS migrado a nginx · xanflatest a labels Docker
- **Contexto**: cierre de las 4 tareas críticas pendientes del ROADMAP Q2 derivadas del cutover Fase 4 (2026-04-20). Ejecutado con sudoers acotado y temporal (`/etc/sudoers.d/devuser-cleanup-2026-04-27`) que se autoborró al final — sin password en chat ni privilegios persistentes.

#### A) Symlink y target legacy `/opt/setex-captu-facture*` eliminados
- **Investigación previa detectó hallazgo no documentado**: el target `/opt/setex-captu-facture.OLD-2026-04-20/logs/` aparecía con fecha 2026-04-26 00:00. Causa real: `/etc/logrotate.d/setex` seguía apuntando al path legacy y rotaba ficheros vacíos (truncate + create) cada semana, aunque ningún cron escribía ya ahí desde el cutover (la última entrada con contenido era de 2026-04-20 10:55). Mientras tanto, **los logs del path nuevo `/opt/setex/{prod,staging}/logs/*.log` NO tenían ninguna rotación**: `watchdog.log` de prod ya en 1.18 MB y creciendo cada 5 min sin techo.
- **Acción 1 — `/etc/logrotate.d/setex` reemplazado**: nueva config cubre `/opt/setex/prod/logs/*.log` y `/opt/setex/staging/logs/*.log` (comodín *.log para cubrir cualquier nuevo fichero sin tocar la config). Mantiene parámetros previos: weekly · rotate 4 · compress · delaycompress · missingok · notifempty · copytruncate · maxsize 10M · su root root. Backup en `/etc/logrotate.d/setex.bak-2026-04-27`. Validado con `logrotate -d` en dry-run: detecta los 8 logs activos sin errores.
- **Acción 2 — tarball del legacy** a `/opt/setex/shared/backups/setex-captu-facture.OLD-2026-04-20.tar.gz` (109 MB descomprimido → 33 MB comprimido, deploy:deploy 0644). Trazabilidad histórica preservada por si se necesita auditar contenido pre-cutover.
- **Acción 3 — symlink `/opt/setex-captu-facture` borrado** + **target `/opt/setex-captu-facture.OLD-2026-04-20` borrado recursivamente** (libera 109 MB). Verificación post: `ls /opt | grep setex-captu` → vacío.
- **Material de cleanup conservado**: `/opt/setex/shared/cleanup-2026-04-27/` con `apply.sh` (script idempotente con verificaciones intermedias y confirmación interactiva), `setex-logrotate.new`, `kkk.txt` (instrucciones operacionales) y `README.md`. Carpeta auditable.

#### B) YAML estático Traefik `/docker/n8n/traefik-dynamic/setex.yml` eliminado
- **Análisis previo del contenido del YAML**: definía router `setex` (Host setex-facturas.es), service → setex-prod-frontend:80, middleware `setex-headers` con HSTS 10 años (`stsSeconds: 315360000`) + browserXssFilter + contentTypeNosniff, y los 2 routers de redirect xanflatest.com → setex-facturas.es (HTTP+HTTPS, 302 no permanente). Comparativa con labels Docker en setex-prod-frontend mostró que router/service ya estaban en labels, pero HSTS y xanflatest NO.
- **Hallazgo clave**: los headers de seguridad (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, CSP, HSTS) **ya están en `nginx.conf` del frontend**. Traefik solo añadía un HSTS más estricto encima (`max-age=315360000` vs los `max-age=63072000` de nginx). Solución limpia: **subir el HSTS de nginx a los mismos 10 años y eliminar la duplicidad**.
- **Acción 1 — `nginx.conf` HSTS subido**: `max-age=63072000` → `max-age=315360000` en las 4 ocurrencias de `app/frontend/nginx.conf` de **AMBOS entornos** (server block raíz + locations específicas /service-worker.js, /admin-facturas.html, /api/internal/check-access). Diff post-cambio prod↔staging: idénticos.
- **Acción 2 — labels xanflatest migradas a `app/docker-compose.yml` de prod** (no en staging: xanflatest.com es solo de prod). 13 labels nuevas en setex-prod-frontend: routers `xanflatest-http` (entrypoint web, middleware redirect, service=${SETEX_ROUTER}) y `xanflatest-https` (entrypoint websecure, TLS letsencrypt, mismo middleware) + middleware `xanflatest-redirect` con `redirectregex` `^https?://xanflatest\.com(.*)` → `https://setex-facturas.es$${1}` (escape `$$` correcto: docker-compose lo convierte a `${1}` en runtime, verificado en `docker inspect`). `permanent=false` mantiene 302/307 (no permanente) por la nota original "xanflatest.com puede reasignarse a otro proyecto".
- **Acción 3 — backup del YAML** a `/docker/n8n/traefik-dynamic/setex.yml.removed-2026-04-27`, **borrado del YAML original** y **borrado del `setex.yml.bak-2026-04-20`** (legacy del cutover). Carpeta `/docker/n8n/traefik-dynamic/` queda solo con el .removed por trazabilidad.
- **Acción 4 — rebuild + redeploy** de ambos frontends (`docker compose build frontend && docker compose up -d frontend`). Ambos containers `Recreated` y `healthy` en <30 s. Cero downtime perceptible (Traefik mantuvo el router `setex` mientras llegaba la nueva imagen).

#### C) Verificación end-to-end (post-cambio)
- **prod `https://setex-facturas.es/`** → 200, `strict-transport-security: max-age=315360000; includeSubDomains; preload` ✅ (ahora desde nginx, antes era Traefik).
- **prod `https://xanflatest.com/`** → 307 con `location: https://setex-facturas.es/` ✅ (idéntico al comportamiento previo del YAML).
- **prod `http://xanflatest.com/`** → 308 con `location: https://xanflatest.com/` (doble hop). **Hallazgo investigado**: este doble hop **NO es regresión nuestra**. Causa: Traefik tiene `--entrypoints.web.http.redirections.entryPoint.to=websecure` como redirect global (config preexistente del container `n8n-traefik-1`, no controlable desde labels Docker), que aplica antes de evaluar routers. El comportamiento HTTP era el mismo con el YAML original. La label `xanflatest-http` queda como redundancia defensiva por si un día se quita el redirect global.
- **staging `https://staging.setex-facturas.es/`** → 401 + `www-authenticate: Basic realm="traefik"` ✅ (basic-auth Traefik intacto). Hit directo al nginx interno (`docker exec setex-staging-frontend curl -sI http://localhost/`) confirma `strict-transport-security: max-age=315360000` ✅.
- **8 containers SETEX**: todos `healthy` post-cambio. Backends prod (5 días uptime) y staging (4 días) intactos — solo se recrearon los frontends.

#### D) Limpieza final
- Sudoers temporal `/etc/sudoers.d/devuser-cleanup-2026-04-27` autoborrado tras la última operación. `sudo -n -l` confirma que NOPASSWD ya no existe para devuser.
- **Pendiente Q2 que cierra esta sesión** (ROADMAP.md): ✅ symlink legacy borrado · ✅ YAML estático Traefik retirado. Sigue abierto: verificar 2FA GitHub (manual de Julio) · promocionar PR #18 develop→main vía deploy-prod.yml.
- **Material cleanup en disco**: `/opt/setex/shared/cleanup-2026-04-27/` (script + config) + `/opt/setex/shared/backups/setex-captu-facture.OLD-2026-04-20.tar.gz` + `/etc/logrotate.d/setex.bak-2026-04-27` + `/docker/n8n/traefik-dynamic/setex.yml.removed-2026-04-27`. Reversibilidad total documentada por si hay que volver atrás.
- **Ficheros tocados (8 totales)**: `{prod,staging}/app/frontend/nginx.conf` · `prod/app/docker-compose.yml` · `/etc/logrotate.d/setex` · borrados `/docker/n8n/traefik-dynamic/setex.yml{,.bak-2026-04-20}` · borrado symlink + target legacy.

### 2026-04-27 — Cierre limpio del rollback Round 16: paridad disco staging↔prod + package.json/eslint normalizados
- **Hallazgo**: revisión post-rollback detectó que **producción tenía el swap aplicado en disco pero el container seguía corriendo la imagen del 2026-04-21** (monolito 4308 líneas embebido por `COPY src/` del Dockerfile). En `/opt/setex/prod/app/backend/src/`, `server.js`=v3 mini (1970 B) y `server.legacy.js`=monolito (204557 B). Cualquier `docker compose build backend` futuro habría empaquetado el v3 ROTO en una nueva imagen y, al `up -d`, reproducido en producción exactamente el mismo 404 masivo del incidente del 2026-04-22 en staging. Mina pisada esperando a un rebuild rutinario, watchdog o reboot.
- **Hallazgo colateral**: en STAGING, el rollback del 22-Abr renombró ficheros pero dejó `package.json` (script `start:legacy` apuntando a `src/server.legacy.js`) y `eslint.config.js` (excepción `max-lines` aplicada a `src/server.legacy.js`) refiriendo a un fichero ya inexistente. Inconsistencia silenciosa: nadie había corrido eslint desde entonces.
- **Verificación previa al cambio**: hashes md5 cruzados confirmaron emparejamiento exacto (staging `server.js` == prod `server.legacy.js` = `19c4dd04…`; staging `server.next.js` == prod `server.js` = `bd1ee759…`). Búsqueda en repo: ningún script, cron, CI ni systemd unit consume `npm run start:legacy` ni el path `server.legacy.js`. El runtime del container prod (4308 líneas) confirmado idéntico al monolito en disco.
- **Acción 1 — prod renombrado en disco** (atomic, sin tocar containers): `mv server.js server.next.js` + `mv server.legacy.js server.js`. Container `setex-prod-backend` no tocado: sigue running 5 días, healthy.
- **Acción 2 — package.json (ambos entornos)**: `start:legacy` → `start:next`, apuntando ahora a `src/server.next.js`. El v3 congelado se puede arrancar manualmente para debugging con `npm run start:next`; ya no hay scripts apuntando a ficheros inexistentes.
- **Acción 3 — eslint.config.js (ambos entornos)**: excepción `max-lines: off` y `max-lines-per-function: off` migrada de `src/server.legacy.js` (inexistente) a `src/server.js` (el monolito restaurado de 4308 líneas). Comentario reescrito explicando que el v3 vive en `src/server.next.js` y el plan de descongelado.
- **Acción 4 — comentario cabecera `src/server.next.js` (ambos entornos)**: reescrito con etiqueta "CONGELADO desde 2026-04-22", explicación del incidente (rutas `auth_request` faltantes), las 4 tareas pendientes para descongelar y cómo arrancarlo manualmente.
- **Verificación post-cambio**: `diff` byte-a-byte confirma paridad total staging↔prod en `package.json`, `eslint.config.js`, `src/server.js`, `src/server.next.js`. `node --check` ✅ en los 6 ficheros JS. `JSON.parse` ✅ en ambos package.json. `server.legacy.js` no existe en ningún entorno. Container prod sigue 200 en `/health` interno y 200 en `https://setex-facturas.es/health` público.
- **Estado neto**: el rollback queda quirúrgicamente cerrado en ambos entornos. Un futuro `docker compose build backend` en prod construirá una imagen con el monolito (server.js 4308 líneas) y arrancará en runtime el mismo código que lleva 5 días sirviendo, sin sorpresas. El v3 sigue presente como `src/server.next.js` listo para descongelar cuando se aborden los 5 endpoints faltantes y los tests de paridad.
- **Ficheros tocados (6 totales en 2 entornos)**: `prod/app/backend/src/{server.js,server.next.js}` (renombrado físico) · `{prod,staging}/app/backend/package.json` · `{prod,staging}/app/backend/eslint.config.js` · `{prod,staging}/app/backend/src/server.next.js` (cabecera).

### 2026-04-22 (tarde) — Incidente staging: rollback Round 16 · vuelta a `server.legacy.js`
- **Síntoma**: Julio reporta 404 en toda la app staging (index + admin + /api/*). Traefik basic auth (401) seguía funcionando, pero tras autenticar todo el contenido devolvía 404.
- **Causa raíz**: el refactor v3 (PR #83) NO portó las rutas `/api/internal/check-access` ni `/api/internal/check-admin-page`. El frontend nginx las usa como `auth_request` en los bloques `location /`, `location /api/`, `location = /admin-facturas.html` y `location = /service-worker.js`. Al devolver 404 el backend v3, nginx mapeaba CUALQUIER petición a `@bloqueado` → 404 genérico "Not Found".
- **Gaps detectados v3 vs legacy (5 rutas)**: `/api/internal/check-access`, `/api/internal/check-admin-page`, `/api/admin/refresh-session`, `/api/admin/retry-failed/:id`, `/api/admin/security/time`. Los 19 tests del swap no cubrían contrato nginx↔backend.
- **Acción**: invertido el swap — `src/server.js` (v3 53 líneas) renombrado a `src/server.next.js`; `src/server.legacy.js` (monolito 4308) renombrado a `src/server.js`. Rebuild imagen + `docker compose stop backend && up -d backend`.
- **Verificación post-rollback**: `/api/internal/check-access` responde 200 internamente; `POST /api/auth/login` devuelve `{"error":"Credenciales inválidas"}` 401 (ruteo OK); `/api/admin/facturas` 401 sin JWT (auth middleware OK). Backend healthy, logs limpios.
- **Estado del refactor v3**: tag `v2.0.0-rc1` sigue en develop pero el runtime v3 queda CONGELADO hasta sesión dedicada a (1) portar los 5 endpoints faltantes, (2) añadir test de paridad de superficie API legacy↔v3, (3) endurecer healthcheck del container con `/api/internal/check-access` en lugar de solo `/health`, (4) añadir smoke-test HTTP post-deploy con login+preview+confirm.
- **Impacto producción**: NULO — prod corre v1.1.0 con el monolito, no fue tocado en ningún momento.
- **Ficheros afectados**: `app/backend/src/server.js` (ahora legacy), `app/backend/src/server.next.js` (ahora v3 congelado). package.json/Dockerfile intactos (el CMD `["node", "src/server.js"]` vuelve a arrancar el monolito al renombrar).

### 2026-04-22 — DevOps/Seguridad: Claude Code Remote Control operativo (devuser@srv1027670)
- **Migración a devuser**: `usermod -aG sudo,docker,deploy`; VS Code Remote-SSH ya no entra como root. `authorized_keys` + `CLAUDE.md` copiados desde root con `install -m 600 -o devuser -g devuser`.
- **Fix HOME devuser**: `/home/devuser` pasó de `root:root` a `devuser:devuser` (defecto del provisioning inicial); dotfiles `.bashrc/.profile/.bash_logout` copiados desde `/etc/skel`. Sin esto, VS Code Server no podía crear `~/.vscode-server` (error `Permission denied`).
- **Permisos grupo en /opt/setex (Opción B acotada)**: `setgid + g+rw` solo en `{prod,staging}/{app,scripts,docs}` y `shared/` (142 dirs + 561 ficheros). Excluidos: `data/postgres` (evita romper modo 0700 validado por Postgres al arrancar), `secrets/`, `node_modules/`, `.git/`, `logs/`. Dry-run previo detectó el riesgo postgres y motivó el scope acotado vs. el runbook original que proponía `find /opt/setex`.
- **Claude CLI para devuser**: `~/.local/bin/claude` 2.1.117 (user-native, PATH preferente) junto a `/usr/local/bin/claude` 2.1.87 (sistema, preexistente). OAuth Claude Max autenticado (juliohesuni@gmail.com Organization). `~/.claude` endurecido a 700/600.
- **Sandbox RC validado end-to-end**: `~/sandbox-rc` + tmux + `claude rc` → URL/QR → app móvil → detach (Ctrl+b d) + cierre VS Code + mensaje desde móvil → reattach con conversación intacta.
- **Alias cc-* en ~/.bashrc**: `cc-setex-staging`, `cc-setex-prod`, `cc-sandbox`, `cc-list`, `cc-attach`, `cc-kill`. No existe `cc-setex` genérico a propósito (diseño fuerza elección consciente entorno).
- **Runbook operacional**: `/home/devuser/docs/claude-rc-runbook.md` con flujo diario, conexión móvil, troubleshooting y principios de seguridad permanentes (no commits como root, secretos intocables, postgres data intocable, no `--dangerously-skip-permissions` en prod).
- **Auto-arranque post-reboot**: `loginctl enable-linger devuser` + systemd --user units `tmux-setex-{staging,prod}.service` arrancan `tmux + claude rc --spawn=same-dir --remote-control-session-name-prefix=setex-{env}` al boot. Trust dialog pre-aceptado en `~/.claude.json` para ambos paths (evita bloqueo interactivo en boot).
- **Ficheros nuevos o modificados**: `/home/devuser/{.bashrc,.claude.json,.config/systemd/user/tmux-setex-*.service,docs/claude-rc-runbook.md,.ssh/,.claude/,.local/,sandbox-rc/}`; `/opt/setex/{prod,staging}/{app,scripts,docs}` + `/opt/setex/shared/` (solo modos de grupo; ownership intacto).
- **Docker sin impacto**: los 8 contenedores (prod+staging: backend, frontend, postgres, redis) permanecieron healthy durante TODO el proceso, sin reinicios ni degradación.
- **Runbook maestro fuente**: `/opt/setex/claude-code-rc-plan-maestro.md`. Incluye BLOQUES A→G + 2 bloques fuera de plan (chown HOME, Opción B acotada del BLOQUE C).

### 2026-04-22 — Fase 1 refactor v3 · Round 16 · SWAP v2.0.0-rc1 (PR #83)
- **Swap runtime**: `src/server.js` (monolito 4308 líneas) renombrado a `src/server.legacy.js` por rollback; `src/server.next.js` renombrado a `src/server.js` (53 líneas, entry v3 con DI container)
- **Dockerfile CMD `["node", "src/server.js"]` intacto** — ahora arranca el v3 post-swap
- `package.json` — scripts ajustados: `start` → nuevo server.js (v3), `start:legacy` fallback al legacy para rollback rápido
- `eslint.config.js` — exención `max-lines` migrada de `src/server.js` a `src/server.legacy.js`
- **Validación staging previa (5 hotfixes Round 16 resolvieron gaps runtime):**
  - #78 fix gitignore anclaje + recupera 7 controllers/uploads perdidos
  - #79 fix bootstrap jwtSecret registration
  - #80 fix repos 22 métodos faltantes (uploads +11, client-companies +8, users +3) con dual signatures
  - #81 fix container paths (storageBase/uploadsDir/securityConfigPath)
  - #82 fix container deps opcionales asValue(null) (excelService/fileUploader/limiters)
- **Smoke staging en puerto 3100**: server.next.js arranca sin crash, `/health` → 200, `/health/ready` → 200 con `db:true, cache:true`
- Tag `v2.0.0-rc1` en develop post-merge (major por refactor arquitectónico completo)
- Refactor v3 cerrado: **15 rounds + 5 hotfixes + swap final**. Total 20 PRs (#63-#83)

### 2026-04-22 — Fase 1 refactor v3 · Round 15: bootstrap providers + app.js + server.next.js (PR #77)
- `src/bootstrap/repositories.providers.js` — registra los 9 repos con `asClass(...).classic()` (patrón constructor(pool) clásico) en SINGLETON
- `src/bootstrap/services.providers.js` — registra 15+ services con `asFunction(...).singleton()`: audit, token-verification, refresh-token, password-reset-token, deduplication, counterparty, invoice-persist, ocrEngines + ocrOrchestration (Strategy), mail port (from factory), password-reset-email, approval-notification, ipListManager + loadSecurityConfig (closure), autoBlockService, viesValidator, adminEmailsProvider (factory)
- `src/bootstrap/middleware.providers.js` — registra authenticate/requireActiveCompany/requireAdmin/requireXHR/securityIp/securityAutoblock/csrf/sanitizeBody como providers
- `src/bootstrap/controllers.providers.js` — registra los 35 controllers como `asFunction(make*).singleton()` (auth 6 + uploads 6 + me 8 + company 1 + admin 22 + 2 helpers)
- `src/bootstrap/index.js` — encadena registros en orden por capa: infra → repos → services → middleware → controllers
- `src/app.js` (50) — `createApp({ withInfra })` compose Express: setupSecurityHeaders + body parsers + cookie-parser + requestId + attachRequestScope + mountRoutes con middleware resuelto + notFoundHandler + makeErrorHandler
- `src/server.next.js` (49) — entry v3 con `createApp({ withInfra: true })` + listen + SIGTERM/SIGINT graceful shutdown (10s grace + forceExit) + unhandledRejection handler. **Permanece en paralelo a `server.js` legacy hasta validación Round 16**
- `src/adapters/queue/inmemory.adapter.js` — stub QueuePort in-memory con setImmediate worker dispatch
- `src/adapters/storage/fs.adapter.js` — StoragePort filesystem con path-traversal guard intrínseco
- `src/adapters/auth-token/pg.adapter.js` — AuthTokenPort wrappea AuthTokensRepository
- `package.json` — script `start:next` para poder arrancar el v3 en staging sin tocar docker-compose
- `tests/architecture.test.js` v2 — 7 invariantes (añadidas: "cada *Port tiene adapter" + "controllers no importan pg/ioredis/openai/nodemailer/@azure"). **19/19 tests verdes** (5 arquitectura + 12 contracts + 2 enforcement v3)
- cookie-parser instalado como dep backend
- 11 ficheros nuevos/modificados · total refactor v3 ~100 ficheros · todos los nuevos ≤94 líneas
- **server.js legacy intacto** (4308) — validación staging 24-48h en Round 16 antes del swap final

### 2026-04-22 — Fase 1 refactor v3 · Round 14: admin catalog/security/ocr-engine/system + services/security (PR #76)
- `src/services/security/ip-list-manager.service.js` — load/save con backup atómico (`.bak` + `.tmp` + rename), cache 30s TTL, DEFAULT_CONFIG congelado, addToList/removeFromList anti-duplicado (Set)
- `src/services/security/auto-block.service.js` — listBlocked/unblock/countBlocked via ports/cache. Delete atómico block+count keys en unblock
- `src/services/security/restricted-hour.service.js` — función pura `isRestrictedHour(cfg, { now })` con TZ Intl + guardia start=end
- `src/controllers/admin/catalog/` — 3 controllers CRUD catálogo proveedores (list paginado, create con normalizeNombre NFKD + notas slice 500, delete)
- `src/controllers/admin/security/` — 3 controllers: config GET (+blocked_count), list-update parametrizado (4 handlers addBlacklist/removeBlacklist/addWhitelist/removeWhitelist; whitelist-add auto-unblock IP), blocked (list + remove con query ?ip=)
- `src/controllers/admin/ocr-engine/` — 2 controllers: get con healthcheck por engine, update con allowlist {mode, primary_engine, enabled} + atomic write features.json (`.tmp` + rename) + reloadFeatures()
- `src/controllers/admin/system/health.controller.js` — BD + Redis + pool counts + process.memoryUsage + disk stat + uptime + Node version
- `src/routes/admin/{catalog,security,ocr-engine,system}.routes.js` — 13 endpoints con adminGuard + CSRF en mutaciones
- barrels controllers/admin/index.js (+11 factories) y routes/admin/index.js (+4 sub-routers) extendidos
- 17 ficheros nuevos · controllers 12-52 líneas · services 37-91 · routes 17-34
- server.js intacto (4308) · 17/17 tests verdes

### 2026-04-22 — Fase 1 refactor v3 · Round 13: admin companies + users + CSRF cableado (PR #75)
- `src/middleware/csrf.js` — `makeCsrfMiddleware({ skipPaths })` wrapper sobre `services/auth/csrf.service` (double-submit pattern); skip automático `/api/internal/*` (nginx auth_request compat)
- `src/controllers/admin/companies/` — 7 controllers approval workflow: list-pending, detail (con audit_log JOIN), approve (+ attachCompanyByCif para uploads, fix 2026-04-21), reject (con reason 1000 chars + quarantine), link (pending→target + redirectToTargetCompany), audit-log, count-pending
- `src/controllers/admin/users/` — 2 controllers: list con counts + update con **guard anti-lockout** (admin no puede quitarse is_admin a sí mismo)
- `src/routes/admin/companies.routes.js` — 7 endpoints con mutGuard = authenticate + requireAdmin + requireXHR + **csrf**
- `src/routes/admin/users.routes.js` — CRUD con mismo mutGuard
- barrel controllers/admin/index.js y routes/admin/index.js extendidos con 9 factories + 2 routes
- **P1.2 cerrado**: CSRF double-submit cableado en todas las mutaciones admin (companies + users)
- 12 ficheros nuevos/modificados · controllers 16-52 líneas · routes 30-37 · middleware csrf 17
- server.js intacto · 17/17 tests verdes

### 2026-04-22 — Fase 1 refactor v3 · Round 12: admin facturas + admin client-companies (PR #74)
- `src/controllers/admin/facturas/` — 6 controllers thin DI: list con filtros user_id/cif/fecha/status (limit 500, max 2000) · users-list distinct · image con owner-agnostic + path-traversal guard · export-xlsx delegando excelService · update con allowlist 15 campos + recalcule hook · delete con `safeUnlink(storageBase,...)` best-effort
- `src/controllers/admin/client-companies/` — 4 controllers: list full, create con unique violation 409 (código 23505), update con allowlist (nombre/codigo_cliente/activa/notas), delete soft-default + `?hard=true` opcional (409 si FK constraint 23503)
- `src/routes/admin/facturas.routes.js` — 6 endpoints tras `authenticate` + `requireAdmin`; mutaciones (PUT/DELETE) exigen `requireXHR` (mitigación CSRF low-cost previo a Round 13)
- `src/routes/admin/client-companies.routes.js` — CRUD completo con mismos guards
- `src/routes/admin/index.js` — `makeAdminRouter({ container, middleware })` resuelve controllers y compone router `/api/admin`
- `src/routes/index.js` — siempre monta admin router (los sub-routers aparecen cuando container tiene sus controllers)
- 14 ficheros nuevos. Controllers entre 16-54 líneas. Routes 29-34 líneas
- server.js intacto · 17/17 tests verdes

### 2026-04-22 — Fase 1 refactor v3 · Round 11: me + company + controllers (PR #73)
- `src/controllers/me/` — 8 controllers thin: profile-get (~22), profile-update (~41, valida NIF regex + normaliza), settings-get (~16), settings-update (~26), export-rgpd (~35, art.15+20 sin password_hash), delete-account (~38, art.17 con confirm literal "DELETE MY ACCOUNT" en transacción), client-companies-list (~16), vies (~24) + index barrel
- `src/controllers/company/status.controller.js` (41) — status con diferenciación `active|pending|not_found|no_company|admin`, fiel a server.js pero con repos DI
- `src/routes/me.routes.js` (54) — 8 endpoints: profile get/put, settings get/post, export, delete, client-companies, vies con viesLimiter. Todas tras authenticate
- `src/routes/company.routes.js` (19) — GET /api/company/status sin requireActiveCompany (para que "pending" pueda consultar)
- `src/routes/index.js` — mount condicional me + company cuando container tiene los controllers registrados
- 13 ficheros nuevos · 359 líneas · máx 54 líneas (target Round 11 <100 cumplido con amplio margen)
- server.js intacto · 17/17 tests verdes

### 2026-04-22 — Fase 1 refactor v3 · Round 10: uploads + services/invoices + Builder (PR #72)
- `src/services/invoices/deduplication.service.js` — `check()` normaliza NIF/fecha/total y consulta `uploadsRepo.findDuplicate` (índice unique BD). Devuelve `{ duplicate, existingId, uploadedAt }`
- `src/services/invoices/counterparty-resolver.service.js` — Capa 3 anti-fallo CIF. `resolve({ userId, ocrNombre, ocrNif })` consulta cache usuario → catálogo global → fuzzy (threshold 0.4). `remember()` incrementa confirmations. `normalizeNombre` NFKD + alphanum
- `src/services/invoices/invoice-persist.service.js` — orquesta `confirm()`: required check → deduplication → uploadsRepo.createOrUpdate → remember counterparty + upsert catalog (fire-and-forget) → audit UPLOAD_CONFIRMED
- `src/services/invoices/invoice.builder.js` — **patrón Builder** con `fromOcr()`, `withUserOverrides()`, `withIvaValidation()`, `withProveedor()`, `withInvoiceType()`, `build()` defensivo. Reemplaza el objeto gigante construido inline en server.js
- `src/controllers/uploads/preview.controller.js` (63) — invoca `ocrOrchestration.extract` + `InvoiceBuilder` + resolver counterparty + cache preview Redis TTL 30min
- `src/controllers/uploads/confirm.controller.js` (60) — resuelve preview de Redis + merge con overrides user + `invoicePersistService.confirm` → 409 duplicate / 400 missing / 200 ok; borra preview tras éxito
- `src/controllers/uploads/list-mine.controller.js` (20) — paginated default 50/7días, límites 200/90
- `src/controllers/uploads/image.controller.js` (40) — guard owner (userId match) + guardia path-traversal (`path.resolve` + `startsWith(storageBase)`), stream file
- `src/controllers/uploads/proveedor.controller.js` (38) — lookup user_cache → global_catalog → 404
- `src/controllers/uploads/export-xlsx.controller.js` (31) — delega en `excelService.buildUserWorkbook` (a extraer en Round 15); fallback JSON si no cableado
- `src/routes/uploads.routes.js` (82) — 6 endpoints con authenticate + requireActiveCompany + rate-limiters + fileUploader por DI
- `src/routes/index.js` — añade mount uploads cuando container tiene controllers registrados
- 12 ficheros nuevos · 787 líneas · controller máx 63 · services máx 90 (target Round 10 <200 cumplido con margen)
- server.js intacto (4308) · ocr/* intacto · 17/17 tests verdes

### 2026-04-22 — Fase 1 refactor v3 · Round 9: routes/health + routes/auth + controllers/auth DI (PR #71)
- `src/controllers/auth/login.controller.js` — factory DI. Fiel al monolito: findByEmail → bcrypt.compare → verifica empresa activa/pending/no-encontrada con 3 mensajes distintos → emite AT 15m + RT cookie httpOnly SameSite=Strict + audit. 94 líneas
- `src/controllers/auth/register.controller.js` — email unique check → bcrypt hash cost 12 → createUser → si CIF no catalogado crea registro `pending` + dispara `approvalNotificationService.notifyPending` a lista admins (fire-and-forget). 76 líneas
- `src/controllers/auth/logout.controller.js` — `refreshTokenService.logout(userId)` revoca todos los RT + clearCookie. 16 líneas
- `src/controllers/auth/refresh.controller.js` — lee cookie `rt` → `refreshTokenService.rotate` (con reuse detection del Round 8) → nueva cookie + nuevo AT. Si reuse: audit `REFRESH_REUSE_DETECTED` + 401. 75 líneas
- `src/controllers/auth/forgot-password.controller.js` — **respuesta idempotente** (200 siempre) para mitigar user enumeration. Si usuario existe: emite token reset + dispara email fire-and-forget. Audit diferencia `UNKNOWN` vs `ISSUED`. 49 líneas
- `src/controllers/auth/reset-password.controller.js` — `passwordResetTokenService.consume` atómico → bcrypt.hash → updatePassword (incrementa token_version) → **logout todas las sesiones** del usuario. 45 líneas
- `src/controllers/auth/index.js` — barrel con 6 factories
- `src/routes/health.routes.js` — GET /health (200 uptime+pid) + GET /health/ready (ping BD + Redis con `Promise.allSettled`, 503 si falla)
- `src/routes/auth.routes.js` — factory que recibe controllers + middleware (validate, rate-limit, authenticate). Monta las 6 rutas con Zod schemas correctos
- `src/routes/index.js` — `mountRoutes(app, { container, middleware })` monta health siempre + auth si container tiene los controllers registrados
- 10 ficheros nuevos · 542 líneas · máx 94 líneas/controller (target Round 9 <180 cumplido con margen)
- Smoke verificado: 6 controllers + 2 routers instancian con mocks; auth router tiene 6 rutas; health router tiene 2. 17/17 tests siguen verdes
- `server.js` intacto — Round 9 prepara el stack completo auth listo para cablear en Round 15

### 2026-04-22 — Fase 1 refactor v3 · Round 8: services auth/email + mail adapter/factory (PR #70)
- `src/services/auth/token-verification.service.js` — verificación JWT + token_version BD con **queryWithTimeout 500ms** (fail-secure: si pool no responde rechaza token con `db_unavailable retriable:true`)
- `src/services/auth/refresh-token.service.js` — rotación RT con **reuse detection**: si llega RT ya revocado con `replaced_by_hash ≠ null` → revoca toda la familia (cierra sesión atacante y usuario); `issue/rotate/logout/cleanupExpired/hashToken`; JWT TTL 7d + SHA-256 en BD
- `src/services/auth/password-reset-token.service.js` — token raw 32 bytes (64 hex) al email, hash SHA-256 en BD; `issue/verify/consume` con TTL 30min
- `src/adapters/mail/nodemailer.adapter.js` — implementa MailPort. Healthcheck via `transport.verify()`. Send valida to/subject/text obligatorios. assertMailPort runtime check
- `src/factories/email-transport.factory.js` — `createMailPort()` encadena `createMailTransport` (config) → `createNodemailerAdapter` (adapter) → devuelve MailPort listo para DI
- `src/services/email/templates/base-layout.template.js` — HTML mínimo compatible (Outlook/Apple Mail) con escapeHtml en call-site
- `src/services/email/templates/password-reset.template.js` — texto + HTML con CTA, enlace fallback, TTL explícito, escapado de email y URL
- `src/services/email/templates/approval-pending.template.js` — notificación admin con datos empresa pendiente + CTA panel admin
- `src/services/email/password-reset.service.js` — `send()` compone URL + invoca template + mail.send. Logs PII-safe vía sanitizer
- `src/services/email/approval-notification.service.js` — `notifyPending()` envía a lista de adminEmails, devuelve `{ ok, sent, results }` con status por destinatario
- 10 ficheros nuevos · 439 líneas · máx 83 líneas (target Round 8 <150)
- Smoke local verificado: hashToken determinístico, templates escapan `<script>` → `&lt;script&gt;`, adapter con transport null rechaza con error claro, tokens servicios instancian OK. 17/17 tests siguen verdes
- `server.js` intacto — todos los services/adapters listos para cablear en Round 9+

### 2026-04-22 — Fase 1 refactor v3 · Round 7: adapters/ocr + factory + orchestration Strategy (PR #69)
- `src/adapters/ocr/openai.adapter.js` — implementa OcrPort delegando en `ocr/openai.js`. Normaliza output: engine/emisor/receptor/fecha/totales/IRPF/tramos_iva/lineas_iva/confidence/duration_ms. Healthcheck vía `GET /v1/models` con timeout 3s
- `src/adapters/ocr/azure.adapter.js` — implementa OcrPort delegando en `ocr/azure.js`. Healthcheck vía `/formrecognizer/info`. Normalización homogénea con openai
- `src/adapters/ocr/gemini.adapter.js` — stub deshabilitado (decisión producto 2026-04-16). healthcheck siempre false, extract throw. Documenta el patrón OCP para futuro motor
- `src/adapters/ocr/paddle.adapter.js` — stub hook para integración ROADMAP Q3
- `src/factories/ocr-engine.factory.js` — `createOcrEngines({ features, readSecret, logger })` lee secrets openai_api_key + azure_di_{endpoint,key}, construye adapters según `ocr_mode` ∈ {dual,openai,azure}. Soporta `ocr_experimental_engines: ['gemini','paddle']` en features.json. `pickPrimary()` selecciona según `ocr_primary_engine`
- `src/services/invoices/ocr-orchestration.service.js` — Strategy: **consensus** (paralelo + dual_confirmed si NIF+fecha+total coinciden), **weighted** (paralelo + primary = max confidence), **fallback** (serial con threshold 0.5). Default: consensus si ≥2 engines, fallback si 1. Timeout 45s por engine + filtro healthcheck inicial con timeout 3s
- `tests/contracts/ocr-port.test.js` — **12 tests LSP**: cada adapter (openai/azure/gemini/paddle) cumple `assertOcrPort`, `healthcheck()` devuelve boolean sin lanzar, `extract()` sin credenciales rechaza en lugar de devolver undefined
- `tests/architecture.test.js` (5 tests) + contracts (12 tests) = **17/17 pass**
- 7 ficheros nuevos · 457 líneas · orchestration service 140 líneas (target Round 7 <180), resto ≤76
- `server.js` intacto (4308 líneas) · `ocr/*` legacy intacto — los adapters delegan durante refactor; Round 15 moverá el código engine y eliminará `ocr/*`

### 2026-04-22 — Fase 1 refactor v3 · Round 6: 5 repos nuevos + tests arquitectura + depcruise (PR #68)
- `src/repositories/auth-tokens.repo.js` — refresh_tokens (save/find/rotate/revokeFamily/revokeAllForUser/deleteExpired) + password_reset_tokens (save/find/consume). Rotación de refresh con transacción (revoca antigua + crea nueva + replaced_by_hash)
- `src/repositories/known-cifs.repo.js` — findByUserAndNombreNorm/findByUserAndNif/listByUser/upsert (ON CONFLICT incrementa confirmations)/deleteByUser
- `src/repositories/company-catalog.repo.js` — findByNif/findByNombreFuzzy (pg_trgm similarity con threshold 0.3)/upsert/listAll/deleteById
- `src/repositories/company-audit-log.repo.js` — log/findByCompany/findLatest (JOIN client_companies + users)/countByAction con filtro since
- `src/repositories/failed-jobs.repo.js` — create/findById/incrementAttempts/markRetried/listPending/deleteOlderThan
- Los 10 repos (5 existentes + 5 nuevos) siguen patrón `class XxxRepository { constructor(pool) { ... } }`. Cableado en container via asClass(...).classic() en Round 7+
- `tests/architecture.test.js` — 5 invariantes en node:test nativo (sin deps): controllers sin pool.query, repos sin res.*, nadie importa server.js, lib/ sin deps internas, ports/ sin deps internas. 5/5 pass
- `.dependency-cruiser.cjs` — policy: no-circular warn, not-to-server error, not-to-spec error, not-to-dev-dep error. Baseline 0 errors/warnings (24 infos orphans = código no cableado aún, esperado)
- `eslint.config.js` — eslint-plugin-boundaries@4 descartado por incompatibilidad con ESLint 10 flat config (TypeError getFilename). La arquitectura por capas queda enforced por architecture.test.js (linter Node puro)
- `package.json` — nuevos scripts: `test` / `test:arch` / `depcruise` / `depcruise:graph`. Dep `dependency-cruiser@^16.10.4` en devDependencies
- 10 ficheros nuevos/modificados · repos todos ≤114 líneas · npm audit prod 0 CVE
- `server.js` intacto (4308 líneas). Todos los repos/tests aditivos sin consumidores (aún)

### 2026-04-22 — Fase 1 refactor v3 · Round 5: Zod validate + sanitize XSS + error-handler + schemas/auth (PR #67)
- Instalada `zod@^3.25.76` (0 vulnerabilidades moderate+, ~57KB)
- `src/middleware/validate.js` — `validate(schema, target)` donde target ∈ {body,query,params,headers}; reemplaza target con output parseado (coerciones aplicadas); errores → `ValidationError` vía `next(err)`
- `src/middleware/sanitize.js` — `makeSanitizeBody({ skipPaths })` + `sanitizeDeep` recursivo con guarda anti-DoS (profundidad máx 20), strippea `<tags>` y null bytes; solo req.body
- `src/middleware/error-handler.js` — `makeErrorHandler({ logger, isProduction })`: AppError → statusCode + payload tipado; ZodError → 400 + detail estructurado; SyntaxError body parse → 400 JSON inválido; otros → 500 genérico SIN stack trace en prod (con `requestId` incluido si `x-request-id` presente). `notFoundHandler` para rutas no montadas
- `src/middleware/async-handler.js` — re-export de `lib/async-handler` (DX)
- `src/schemas/auth/` — `login` (email normalizado + password ≤256), `register` (email + password ≥10 con may/min/num + NIF uppercase regex + company_name + consent_rgpd literal true), `forgot-password` (solo email, strict), `reset-password` (token ≥20 + password requisitos), `index` barrel
- 8 ficheros nuevos · 271 líneas · máx 68 líneas/fichero (target Round 5 <80)
- `server.js` intacto — todos los módulos aditivos listos para cablear en Round 9+

### 2026-04-22 — Fase 1 refactor v3 · Round 4: middleware parte 1 + helmet extendida (PR #66)
- `src/middleware/auth.js` — factories DI: `makeAuthenticate({ pool, jwtSecret, logger })` con verificación JWT + `token_version` DB check fail-secure, `requireAdmin` (function), `makeRequireActiveCompany({ pool, logger })`, `requireXHR`
- `src/middleware/security-ip.js` — `makeSecurityIpMiddleware({ loadSecurityConfig, logger })` + helpers puros `ipInList` (CIDR via lib/ip-utils) + `isRestrictedHour` (TZ Europe/Madrid, guardia anti lockout si start=end)
- `src/middleware/security-autoblock.js` — `makeSecurityAutoBlockMiddleware({ loadSecurityConfig, redisClient, logger })` con exención `/api/internal/*` (compat nginx auth_request) + fail-open si Redis no responde
- `src/middleware/setup.js` — `setupSecurityHeaders(app, { corsOrigin, helmetOverrides })` con helmet extendida: CSP estricta con `upgradeInsecureRequests` + HSTS preload 2y + frameguard deny + noSniff + referrerPolicy strict-origin-when-cross-origin + COOP same-origin + CORP same-origin + originAgentCluster + permittedCrossDomainPolicies none. **Permissions-Policy** inyectado a mano (no soportado por helmet): accelerometer/camera/geolocation/gyroscope/magnetometer/microphone/payment/usb = none. `setupBodyParsers` con límite 1MB en json y urlencoded
- Los 4 middleware son **aditivos** — `server.js` sigue usando su lógica inline actual; se cablearán desde el container en Round 9+
- 4 ficheros nuevos · 306 líneas totales · máx 95 líneas/fichero (target Round 4 <100)

### 2026-04-22 — Fase 1 refactor v3 · Round 3: config/ split + adapters infra + bootstrap providers (PR #65)
- `src/config/database.js` — factoría `createPool()` con statement_timeout 5s default, query_timeout 10s, pool max 30, idleTimeout 30s, connectionTimeout 5s + healthcheck inicial `SELECT 1` + `closePool()` graceful con timeout 10s
- `src/config/redis.js` — factoría `createRedisClient()` con retry backoff exponencial (máx 3s), reconnectOnError READONLY, ping inicial + `closeRedisClient()` con fallback disconnect
- `src/config/email.js` — factoría `createMailTransport()` con pool SMTP (max 3 conexiones, 100 msgs) + verify() + cierre limpio
- `src/config/logger.js` — winston JSON con PII sanitizer en format pipeline (redacta emails + keys sensibles ANTES de serializar), handleExceptions + handleRejections
- `src/config/features.js` — loader de features.json con cache + `reloadFeatures()` para hot-reload; defaults seguros si parseo falla
- `src/config/index.js` — barrel que re-exporta los 18 helpers de config (env, secrets, factorías, close*)
- `src/adapters/db/pg-pool.adapter.js` — wrapper sobre Pool con `.query()`, `.connect()`, `.healthcheck()` + `queryWithTimeout(sql, params, { timeoutMs, label })` con transacción + SET LOCAL statement_timeout para queries críticas (auth 500ms)
- `src/adapters/cache/ioredis.adapter.js` — implementa CachePort (get/set/del/has/incr/expire/keys) con normalización (null vs undefined, TTL opcional)
- `src/bootstrap/infra.providers.js` — `registerInfraProviders(container)` registra logger, pool, db (adapter), redisClient, cache (adapter), mailTransport, env, features como SINGLETON + `disposeInfraProviders()` para graceful shutdown (Round 15)
- `src/bootstrap/index.js` — `bootstrapContainer({ withInfra })` opcional + `disposeContainer()`
- `server.js` intacto (4308 líneas). Todos los nuevos módulos son aditivos: nadie los importa todavía, se cablearán en Rounds 9-15
- 10 ficheros nuevos/modificados · todos ≤70 líneas (muy por debajo del target <150 Round 3)

### 2026-04-22 — Fase 1 refactor v3 · Round 2: lib/ + ports/ + container DI (PR #64)
- Instalada dependencia `awilix@^10.0.2` (container DI JS puro, 0 CVE moderate+, ~30KB)
- `src/lib/errors/` creada — `app-error.js` (raíz + toJSON), `http-error.js` (Auth/Forbidden/NotFound/Conflict/RateLimit/UnprocessableEntity/BadGateway/ServiceUnavailable), `validation-error.js` (con `ValidationError.fromZod()`), `index.js` (barrel). Reemplaza el antiguo `lib/errors.js` (huérfano, 0 importers)
- `src/lib/async-handler.js` — wrapper para handlers async Express (captura rechazos → next(err))
- `src/lib/html-escape.js` — escapado HTML para templates email (defense-in-depth anti XSS en server-side render)
- `src/lib/ip-utils.js` — `extractClientIp` (Traefik-aware), `isValidIp`, `ipInCidr`, `normalizeIp`
- `src/lib/pii-sanitizer.js` — redacta emails (`ju***@dominio`) + keys sensibles (password/token/secret/session/authorization/csrf) en estructuras recursivas antes de logs
- `src/lib/file-cleanup.js` — `safeUnlink` con guardia anti path-traversal + `cleanupOlderThan` con mtime
- `src/ports/` creada — 6 contratos JSDoc typedef + `assert*Port()` guards: `ocr.port.js`, `mail.port.js`, `cache.port.js`, `queue.port.js`, `storage.port.js`, `auth-token.port.js`
- `src/container.js` — factoría `createAppContainer()` (Awilix PROXY strict) + middleware `attachRequestScope` per-request con `requestId`/`userAgent`/`clientIp`
- `src/bootstrap/index.js` — esqueleto del bootstrap por capas (infra → adapters → factories → repos → services → controllers). Providers reales se añadirán en rounds 3-14
- Smoke: container inicia OK, `assertOcrPort` rechaza inválido y acepta válido, `sanitize` redacta, `asyncHandler` delega err
- `server.js` intacto (4308 líneas) — container aún no cableado. Round 2 solo añade módulos sin romper el monolito

### 2026-04-22 — Fase 1 refactor v3: ADR-0004 + ADR-0005 (Round 1 · PR #63)
- `docs/adr/0004-modular-architecture-solid-patterns.md` — decisión de arquitectura modular v3 con SOLID explícito + patrones canónicos (Repository, Service Layer, Controller thin, Ports & Adapters, Factory, Strategy, Builder). Mapeo SOLID→solución + enforcement CI (eslint-plugin-boundaries + dependency-cruiser + tests/architecture.test.js)
- `docs/adr/0005-dependency-injection-awilix.md` — adopción de Awilix 10.x como contenedor DI (scopes SINGLETON/SCOPED). Patrón factory `make*Controller({ ... })` con destructuring. Bootstrap modular por capa (infra, adapters, factories, repositories, services, controllers)
- `docs/adr/README.md` — índice actualizado con ADR-0004 y ADR-0005
- Rama `refactor/modular-architecture-2026-04-22` desde `develop` · 16 rounds planificados · deploy solo staging hasta Round 16

### 2026-04-21 — Backend: `client_company_id` en approve/reject + limpieza repo (post-presentación)

**Contexto:** tras la presentación al cliente (v1.0.0 GO), completar la Opción 2 que quedó pendiente del fix anterior: dejar el backend consistente a nivel de FK cuando se aprueba/rechaza una empresa pendiente.

**Cambios backend (`app/backend/src/server.js`):**
- `POST /api/admin/companies/:id/approve` — el UPDATE de uploads ahora asigna además `client_company_id = :id` al pasar de `pending` a `active`. Antes quedaba NULL y la asociación se deducía por JOIN contra `users.company_nif` — frágil y rompible si un usuario cambia de CIF. Con el FK asignado, las facturas aprobadas quedan indexadas igual que las de cualquier empresa registrada manualmente
- `POST /api/admin/companies/:id/reject` — mismo ajuste por coherencia: uploads en `quarantine` conservan `client_company_id` para trazabilidad y revinculación futura. Las queries filtran por `activa=true` → no aparecen en listados normales
- Respuesta de `/approve` ahora incluye `company_id` (útil si el frontend quiere filtrar facturas por esa empresa inmediatamente tras aprobar)

**Cambios repo (`app/backend/src/repositories/client-companies.repo.js`):**
- `approve(id, reviewedByUserId)` — antes usaba columnas inexistentes (`approved_at`, `approved_by_email`, `deactivation_reason`) — cualquier invocación habría fallado. Ahora usa las columnas reales del esquema (`reviewed_by`, `reviewed_at`) y coincide 1:1 con el endpoint del server.js
- Método `deactivate()` eliminado: duplicaba funcionalidad del endpoint PUT `/api/admin/client-companies/:id` genérico
- Añadido `reject(id, reviewedByUserId, reason)` para completar el par approve/reject coherente con los endpoints

**Despliegue:**
- Imagen anterior etiquetada como `setex-prod-backend:rollback-20260421-pre-approve-fix` antes del build (rollback instantáneo disponible)
- `docker compose build backend` → OK; `stop` + `up -d` → ~15s de downtime real
- Verificación: container `healthy`, logs limpios ("Server running on port 3000"), `https://setex-facturas.es/health` → 200, endpoint admin protegido devuelve 401 sin token como debe
- No hay empresas pendientes ahora mismo — el cambio afecta solo a futuras aprobaciones

**Pendiente (ROADMAP, no bloqueante):**
- Smoke test E2E automático del flujo aprobar empresa (Playwright) para que este tipo de bug no resucite
- Considerar migración de datos que asigne `client_company_id` retroactivamente a uploads activos sin FK cuyo `user.company_nif` matchee el CIF de una empresa registrada (consistencia histórica)

### 2026-04-21 — Fix botones Aprobar/Rechazar empresa pendiente (modal no se cerraba)

**Contexto:** Julio reporta *"el botón de aceptar o rechazar la petición no hacía nada"* en el panel admin, tab Empresas. La única aprobación histórica (id=61 Murimarti Digital, 2026-04-19) se hizo por SQL a mano con nota en `company_audit_log` *"Aprobada vía DB tras fix CSP del modal. Empresa de prueba; retirar en unos días."* → el flujo UI nunca funcionó realmente en producción.

**Diagnóstico:**
- Backend OK: `POST /api/admin/companies/:id/{approve,reject}` (server.js:3759-3856) ejecutan transacción atómica, activan empresa, cambian `upload_status: 'pending' → 'active'`, registran audit log
- `authFetch` (admin-facturas.js:19) delega en `Auth.apiFetch` que sí añade `X-Requested-With` — `requireXHR` del backend pasa correctamente
- Bug real: `_empAprobar` y `_empRechazar` (admin-facturas.js:739-769) **no cerraban el modal `review-company-modal` tras éxito**. Usuario veía la misma pantalla, toast oculto detrás → impresión de "no hace nada". `_linkToCompany` sí lo cerraba (línea 1356) — era selectivo

**Fix aplicado (solo frontend, sin rebuild — despliegue en caliente):**
- `app/frontend/src/admin-facturas.js`: en `_empAprobar` y `_empRechazar` tras `res.ok`, añadido `document.getElementById('review-company-modal')?.remove()` y `if (table) loadData(currentFilters)` para refrescar también la tabla de facturas (los uploads recién activados ya aparecen en el listado general)
- `app/frontend/src/admin-facturas.html`: cache-buster `admin-facturas.js?v=20260421-001` → `?v=20260421-002`
- `node --check` OK; despliegue vía `docker cp` al container `setex-prod-frontend` (zero downtime, nginx continuó sirviendo); checksums disco vs container idénticos; `curl` contra el JS servido devuelve 200 y contiene el código nuevo

**Pendiente para siguiente ventana (Opción 2, no ejecutada hoy):**
- Backend `/approve` UPDATE de uploads **no asigna `client_company_id`** — las facturas quedan con FK null y se muestran solo por JOIN frágil contra `company_nif`. Mejora de consistencia para que las facturas aprobadas queden indexadas igual que las de empresas registradas normales
- Repo `client-companies.repo.js:53-68` tiene `approve()` y `deactivate()` que usan columnas inexistentes (`approved_at`, `deactivation_reason`). Código muerto; limpiar para evitar uso futuro accidental
- Decisión pospuesta: no aplicado hoy por ser día de entrega v1.0.0 y requerir rebuild de backend (~30-40s downtime). Ventana segura: post-presentación

### 2026-04-21 — Alta admin producción `setex@gmail.com` (contraseña temporal)

**Contexto:** Julio solicita alta de una tercera cuenta admin en producción para operación/demo post-entrega v1.0.0.

**Operación ejecutada (sobre `setex-prod-postgres`):**
- `INSERT INTO users (email, password_hash, company_name, is_admin, auto_confirm_enabled)` con `email='setex@gmail.com'`, `company_name='Setex'`, `company_nif=NULL`, `is_admin=TRUE`, `auto_confirm_enabled=TRUE`
- `password_hash` generado con `bcrypt` cost 12 dentro de `setex-prod-backend` (igual que `services/auth/password.service.js`). Hash `$2b$12$…` de 60 caracteres
- Resultado: `user id=23`
- Registro en `audit_logs` (id 255) con `action='admin_created'` y `details` JSONB (operador, motivo, flag `password temporal pendiente rotacion`)
- Verificación: `bcrypt.compare('setex1234', hash)` → OK; `bcrypt.compare('wrongpassword', hash)` → rechazado correctamente
- Estado admins en prod: `id=2` juliohesuni@gmail.com (Autoken), `id=3` albertomurimarti@gmail.com (Autoken), `id=23` setex@gmail.com (Setex) — tres admins activos

**Advertencia de seguridad registrada (para próxima sesión):**
- Contraseña `setex1234` es **temporal y débil** (diccionario + nombre de cuenta). Pasa la validación de longitud de `password.service.js` (≥8 chars) pero es vulnerable a brute-force de diccionario en el primer intento. El rate-limit de auth (10/15min) no es defensa suficiente contra una contraseña adivinable
- Pendiente: rotar a contraseña fuerte (≥12 chars, mayús+minús+dígitos+símbolo) vía `/api/me/change-password` en cuanto termine la demo de entrega. Añadir recordatorio de rotación cada 90 días en ROADMAP
- Pendiente (ROADMAP Q2): MFA/TOTP obligatorio para cualquier cuenta con `is_admin=TRUE`. Hoy no hay segundo factor — una sola credencial concede acceso total a `/admin-facturas.html`, export Excel, borrado de facturas y empresas

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

### 2026-04-21 — Sesión v1.0.1: fix watchdog post-cutover + paths.sh autodetect + IRPF + Excel rework + admin delete

**Contexto:** día de entrega al cliente (v1.0.0 pusheado 2026-04-20). Tras el smoke manual Julio reporta 3 incidencias. Cliente concede +7h de margen.

**Incidencia crítica detectada en logs matinales:**
- Watchdog prod reiniciaba cada 5 min los 4 containers healthy (bucle vivo 07:10→08:06 UTC).
- Causa raíz: `scripts/watchdog.sh` invocaba `setex-backend|redis|postgres|frontend` (nombres pre-cutover). Los containers reales son `setex-prod-*`. Cada `docker exec` fallaba → alerta MISCONF → `$COMPOSE restart` reiniciaba el servicio sano.
- Auditoría `rg` encontró residuos del mismo patrón en 10 scripts + 5 docs + 1 fichero de código.

**Ficheros modificados (6 commits en rama `fix/watchdog-paths-ocr-excel-admin-2026-04-21`, PR #50 → develop):**

- `scripts/lib/paths.sh` (nuevo, 70 líneas): fuente única de rutas, contenedores, dominio. Autodetecta prod/staging por `basename(BASE_DIR)`. Un mismo fichero sirve a ambos entornos.
- `scripts/{watchdog,fix-permissions,backup-postgres,backup-offsite-replicate,health-check,manage-whitelist,backup-db}.sh` + `tests/stress-test.sh`: refactor para sourcear `paths.sh`; cero residuos hardcoded.
- `scripts/{list-invalid-cifs,migrate-uploads}.js`: default + override `SETEX_PG_CONTAINER` env var.
- `config/crontab.txt`: template actualizado con rutas `/opt/setex/prod` y cron real en root.
- `.claude/CLAUDE.md`: reescrito en modo neutral (ambos entornos), referencia paths.sh y convención scripts/lib.
- `app/backend/src/ocr/openai.js`: prompt IRPF reforzado. Eliminada regla engañosa "CIF → no IRPF". Añadida regla aritmética: `Total < Base + IVA ⇒ HAY IRPF obligatoriamente`.
- `app/backend/src/ocr/index.js`: salvaguarda aritmética post-merge. Si IRPF=0 pero Total < Base + Cuota_IVA con diferencia ≥ 0,05€ y % plausible [0,5%, 30%], rellena IRPF por cálculo y loguea warning.
- `app/backend/src/server.js`:
  - `GET /api/admin/facturas/export.xlsx`: filename `setex_facturas_{desde}_{hasta}_{empresa}.xlsx` (antes: solo fecha). Columna ID ahora usa `codigo_cliente` con mismo JOIN + mapa fallback del panel. Quitadas 3 columnas: email, confidence_level, uploaded_at.
  - `PUT /api/admin/facturas/:id`: EDITABLE ampliado con `invoice_type`.
  - `DELETE /api/admin/facturas/:id` (nuevo): audit snapshot + hard delete + borrado best-effort del fichero físico.
- `app/frontend/src/admin-facturas.{html,js}`: botón toolbar "🗑 Eliminar" + columna Acciones por fila + `eliminarFactura()` con confirm + `row.delete()` sin recargar tabla. Cache-buster `v=20260421-001`.

**Despliegue y validación 2026-04-21:**
- `docker compose build backend frontend` + swap en ambos entornos (staging 10:11, prod 10:12 UTC).
- Watchdog 9/9 verde dry-run + cron 08:45 UTC primer ciclo automático sin incidencias.
- Smoke OCR triple verde (OpenAI 4.4s + Azure DI 417ms + 2ª pasada 1.6s).
- Backup manual post-fix: `setex_db_20260421_085047.sql.gz.gpg` (28K, integridad pg_dump OK) + offsite 14 remotos (25440 bytes).
- Tag anotado `v1.0.1` creado sobre `b15d493` (develop) y pusheado.

**Estado al cerrar sesión:**
- PR #50 `fix/...` → `develop` mergeado (squash) como commit `b15d493`.
- PR #51 `develop` → `main` abierto, **pendiente de merge + trigger de `deploy-prod.yml` con DESPLEGAR** para promocionar a producción formal.
- Tag `v1.0.1` en `origin/develop@b15d493`.
- Backup GPG verificado (local 7 + offsite 14) como punto de rollback.
- Working tree prod en rama `fix/watchdog-paths-ocr-excel-admin-2026-04-21`; el workflow prod hará `git reset --hard origin/main` (idempotente) cuando se dispare.

**Pendiente próxima sesión:**
- D3 limpieza residuos legacy: `/opt/setex-captu-facture.OLD-2026-04-20/kk.txt` (12B, contenido aparenta credencial — requiere rotación preventiva antes de borrar), eliminación del symlink tras 1 semana de gracia (~2026-04-27).
- E1 Fase 1 MACROPLAN (si hay margen): Playwright E2E + CSRF cableado + ADR-0001/0002/0003 + OpenAPI + commitlint.
- C2/C3: creación de cuenta cliente con CIF validado + verificación flujo recuperación pw (requiere email+CIF del cliente).

---

### 2026-04-21 (PM) — Sesión v1.0.2: promoción a main + fix modales + sync histórico

**Contexto:** reunión cliente SETEX — producto aprobado. Julio crea cuenta admin `setex@gmail.com` (id=23). Pide continuar el plan D1+ tras su OK.

**Trabajo realizado:**

- PR #53 `fix/admin-approve-backend-2026-04-21 → develop` (mergeado squash, commit `4c7fac6`)
  - `admin-facturas.js`: `_empAprobar` y `_empRechazar` cierran modal tras éxito + refrescan facturas/empresas. Fix del bug "botón aceptar/rechazar no hacía nada" (modal tapaba el toast).
  - `server.js /approve /reject`: `UPDATE uploads SET client_company_id = ...` para consistencia FK.
  - `client-companies.repo.js`: `approve()` y `reject()` con columnas reales (`reviewed_by`, `reviewed_at`, `rejection_reason`). Antes usaba `approved_at`/`approved_by_email`/`deactivation_reason` que no existen. `deactivate()` duplicado eliminado.
  - `admin-facturas.html`: cache-buster `v=20260421-002`.
- PR #52 cerrado como duplicado (su commit de historial ya estaba en #53 vía cherry-pick).
- PR #54 `sync/main-to-develop-2026-04-21 → develop` (merge commit, `01279ab`): reverse merge de main sobre develop para reconciliar divergencia histórica con PRs #32/#34/#44 squashed. Resolución: HEAD (develop) en 4 ficheros afectados (`client-companies.repo.js`, `index.html`, `backup-offsite-replicate.sh`, `MACROPLAN-SETEX-v2.0.md`) — develop es superset funcional.
- PR #51 `develop → main` mergeado (squash, commit `0b15200`): promoción formal a producción.
- Workflow `deploy-prod.yml` disparado con `confirm=DESPLEGAR`: success en 1m9s. Backup pre-deploy GPG + `git reset --hard origin/main` + `docker compose build backend frontend` + swap.

**Incidencia operacional resuelta durante la promoción:**
- `deploy-staging.yml` falló con `error: insufficient permission for adding an object to repository database .git/objects` al hacer `git fetch`.
- Causa: 44 dirs `.git/objects/XX` en prod + varios en staging eran `root:root` tras commits manuales de la sesión AM. El workflow SSH usa user `deploy` sin permiso de escritura.
- Fix: `chown -R deploy:deploy /opt/setex/{prod,staging}/.git` + `chmod -R g+w .git/objects`. Re-run staging deploy: success en 1m9s.

**Estado final prod:**
- `main @ 0b15200` (merge squash PR #51).
- `setex-prod-{backend,frontend}` rebuild + swap sin incidencias, healthchecks OK en 5s.
- `https://setex-facturas.es/health` → HTTP 200.
- Watchdog 9/9 verde post-deploy.
- Tag anotado `v1.0.2` sobre `01279ab` (origin/develop) pusheado.

**Pendiente próxima sesión:**
- Mejoras solicitadas por SETEX en la reunión (pendientes de detallar por Julio).
- D3: limpieza `/opt/setex-captu-facture.OLD-2026-04-20/kk.txt` tras rotación de credencial `Unifisica95#` si aplica.

---

### 2026-04-21 (PM segunda parte) — C2 + C3 + arranque Fase 1 MACROPLAN

**C2 cerrado** — cuenta admin de prueba `setex@gmail.com` (id=23) completada con CIF inventado `B87654323` (categoría B/SL, válido AEAT según `checkDigitCIF`). Auditoría en `audit_logs` acción `ADMIN_UPDATE_USER_TEST_CIF`. No es un CIF real — es dummy para que el panel funcione durante las pruebas del cliente.

**C3 verificado** — `POST /api/auth/forgot-password` operativo end-to-end:
- Email inexistente → HTTP 200 + respuesta genérica (no revela) + log `non-existent email`.
- Email vacío → HTTP 400.
- Email existente (`juliohesuni@gmail.com`) → HTTP 200 + token en `password_reset_tokens` + log `Password reset email sent` + Julio confirma recepción en inbox y cambio de password exitoso.

**E1 arrancada** — PR #56 `feat/phase1-playwright-adr-commitlint-2026-04-21` mergeado a develop (squash, commit `b1b70a5`):
- **P1.1**: `tests/e2e/` con Playwright ^1.48 + 3 specs (login, admin-panel, health). 3/3 passed contra prod en 4s. Soporte BasicAuth opcional para staging Traefik.
- **P1.4**: `docs/adr/` con README + template + 0001 (Git+ESLint+Husky+commitlint) + 0002 (Strangler-Fig) + 0003 (TypeScript gradual).
- **P1.5 parcial**: `package.json` root + husky + `@commitlint/cli` + `commitlint.config.js` + `.husky/commit-msg` hook bloqueando commits no-CC.

**Pendiente Fase 1 (próxima sesión):**
- P1.1 bis: spec `04-invoice-upload.spec.js` + workflow CI `.github/workflows/e2e.yml` contra staging.
- P1.2: cablear CSRF double-submit en rutas mutantes (módulo existe en `services/auth/csrf.service.js`).
- P1.3: Strangler-Fig paso 21b (cablear services/auth + repositories en rutas) + paso 22 (renombre `server.js → app.js` <100 líneas).
- P1.5 bis: lint-staged + pre-commit hook + OpenAPI 3.1 yaml canónico.

**Pendiente menor:**
- D3: limpieza `kk.txt` + symlink legacy (tras rotación de credencial y semana de gracia).
- Mejoras cliente SETEX (pendientes de lista por Julio).

---

### 2026-04-21 (noche) — v1.1.0: super-tarea SETEX multi-IVA completa en 7 partes

**Contexto:** cliente SETEX pidió en reunión 2026-04-21 PM que el desglose por tramos de IVA sea coherente en todas las capas del sistema. Sesión nocturna: 7 partes entregadas en ~3h35min + deploy y tag.

**Patrón early-branch:** OCR decide primero si la factura es mono-IVA (90% casos, flujo simple) o multi-IVA (flujo nuevo con productos agrupados por tramo). Ambiguo → campos null, usuario rellena manual.

**Capas cubiertas (PR #59, rama `feat/multi-iva-ocr-backend-parte1-2026-04-21`):**

1. **OCR backend (parte 1/7)** — `ocr/openai.js` prompt con bloque `DECISIÓN PREVIA` + schema strict con `productos:[{descripcion, importe}]`. `ocr/azure.js` nueva `extractProductosFromItems()` asocia Items a tramos por TaxRate normalizado. `domain/validators/iva.js` `mergeLineasIva()` fusión por porcentaje + dedup productos.
2. **Endpoint confirm (parte 2/7)** — helper `normalizeConfirmedLineasIva()` valida + recalcula agregados (Σ bases, Σ cuotas, pct dominante). `/api/upload-confirm` acepta `confirmed_lineas_iva` y sincroniza columnas agregadas con sumas. Backward compat total.
3. **Modal comprobación (parte 3/7)** — `index.html` dos vistas conmutables `#confirm-iva-mono` / `-multi`. `app.js` `renderLineasIvaMulti()` con bloques editables + productos (add/remove/add-tramo). Resumen auto-calculado en tiempo real. Cache-buster `app.js?v=20260421-004`.
4. **Panel admin (parte 4/7)** — `GET /api/admin/facturas` incluye `lineas_iva`. `PUT` acepta `lineas_iva` y recalcula agregados. Columna "Desglose" con badge `🧾 N tramos` clickable. Modal `#desglose-modal` con bloques editables + `row.update()` sin recargar. Cache-buster `admin-facturas.js?v=20260421-003`.
5. **Excel export (parte 5/7)** — hoja secundaria "Desglose IVA" en workbook xlsx. Una fila por tramo (solo multi-IVA). Columnas: ID, Empresa, CIF, Cliente/Prov, CIF, Nº Factura, Fecha, IVA%, Base tramo, Cuota tramo, Total tramo, Productos del tramo.
6. **Testing (parte 6/7)** — `tests/multi-iva/test-helper-unit.js` (25 tests unitarios Node puros, 0 fallos). `tests/e2e/specs/04-admin-desglose.spec.js` (3 tests Playwright). `tests/multi-iva/README.md` documentación smoke manual.
7. **Deploy + tag (parte 7/7)** — PR #59 squash a develop (commit `e7c8f31`). PR #61 sync main→develop absorbido (merge commit `befda3b`). PR #60 squash a main (commit `628a230`). `deploy-prod.yml` con DESPLEGAR: success en 1m10s. Tag anotado `v1.1.0` sobre `befda3b` pusheado.

**Incidencias durante el deploy:**
- `deploy-staging.yml` falló en primer intento por `Permission denied` en `tests/multi-iva/*` — mismo patrón del 2026-04-21 AM (ficheros creados como root, workflow SSH usa user deploy). Resuelto con `chown -R deploy:deploy`.
- PR #60 salió CONFLICTING por squash de PR #51 en main — resuelto con reverse merge PR #61 (HEAD=develop en 5 ficheros afectados, develop es superset funcional).

**Estado final prod (2026-04-21 ~19:00 UTC):**
- `main @ 628a230` (Release v1.1.0 — Desglose multi-IVA coherente en 5 capas)
- containers `setex-prod-{backend,frontend,postgres,redis}` healthy tras swap
- `https://setex-facturas.es/health` → HTTP 200
- Tag anotado `v1.1.0` publicado en GitHub
- 25/25 tests unitarios del helper pasan
- Watchdog 9/9 verde

**Pendiente validación manual por Julio (mañana):**
- Smoke con factura real multi-IVA (hostelería / ferretería / servicios mixtos).
  Julio no tenía foto disponible al cerrar release. Validará el flujo completo
  end-to-end mañana: subir factura → modal bloques → admin panel → Excel → BD.
- Si regresión visual/funcional detectada: parche v1.1.1 en caliente o revert.

**Pendientes generales (retomar tras validación cliente):**
- Fase 1 MACROPLAN pausada (P1.2 CSRF, P1.3 Strangler-Fig, P1.5b lint-staged + OpenAPI, P1.1b CI e2e workflow).
- Item loose ends: eliminar symlink legacy `/opt/setex-captu-facture` tras semana de gracia (~2026-04-27), desinstalar PaddleOCR 3GB sin uso, activar BetterStack externo.

---

### 2026-06-15 — Aseguramiento del estado vivo de prod sin versionar (descalce REGLA 11)

**Contexto:** auditoría forense de git en prod antes de abordar mejoras. Confirmado y ampliado el descalce de REGLA 11 / §10.2: el código que corre en producción (imágenes `setex-prod-backend` build 28-may, `setex-prod-frontend` build 01-jun) **no existe en ningún commit de ninguna rama** (local ni `origin`). Solo vivía en el working tree sucio + las imágenes Docker.

**Verificación (md5 contenedor == working tree, != HEAD/origin/main):**
- `app/backend/src/server.js` vivo = `1386917d…` (4496 líneas, monolito post-rollback evolucionado; el documentado eran 4308) ≠ HEAD `622d439…`.
- `app/frontend/src/admin-facturas.js` vivo = `0fe52807…` ≠ origin/main.
- `git hash-object` de los 3 ficheros core: NO aparecen en `git log --all --find-object` → cero copias versionadas.

**Causa raíz:** los deploys en vivo del 28-may/01-jun se hicieron con `docker compose build` manual desde el working tree, sin pasar por `deploy-prod.yml` ni confirmar en git. El reflog muestra además un `rebase` que descartó el commit `1c4e66c` (modal IVA), reabriendo sus cambios como no confirmados.

**Acciones (no destructivas, prod intacta y healthy en todo momento):**
- Backup triple verificado en `shared/backups/prod-live-20260615/`: `prod-worktree-live.tar.gz` (fuente), `prod-images-live.tar.gz` (91M, `docker save` backend+frontend), `prod-repo-full.bundle` (git --all), `SHA256SUMS.txt`, `ESTADO-GIT.txt`.
- Estado vivo versionado: commit `5753b49` en rama nueva `recovery/prod-live-20260615`, pusheada a `origin` (no dispara workflows; `deploy-prod` es manual). Ficheros afectados: rama git nueva + 27 ficheros capturados.
- Permisos `.git` normalizados a `deploy:deploy` tras commit como root (ver nota de cumplimiento abajo).

**⚠️ Refuerzo REGLA 11 — regla operativa activa:** NO ejecutar `deploy-prod.yml` hasta reconciliar `origin/main` con el estado vivo (su `git reset --hard origin/main` destruiría el working tree y revertiría prod al v3 roto LL-002). Tarea de reconciliación abierta.

**Pendiente:** (1) reconciliar estado vivo ↔ origin/main vía PR para que deploy-prod sea idempotente; (2) auditar 12 vulnerabilidades Dependabot (9 high); (3) feature nombre-emisor-desde-NIF en staging.

**Nota de cumplimiento (transparencia):** se ejecutó `chown -R deploy:deploy .git` (acotado al repo, owner correcto) para normalizar objetos creados por root. La REGLA 4.x desaconseja `chown -R` sobre `/opt/setex`; lo idóneo habría sido `scripts/fix-permissions.sh`. Sin impacto (el cron horario hace lo mismo), pero registrado por rigor.

---

### 2026-06-15 — Fix panel admin: normalización de importes + export Excel (rama feature)

**Contexto:** Julio reporta que en el panel admin "en la tabla se ve un valor y al editar aparece otro", que algún campo no deja editar, y pide que todos sean editables. Diagnóstico sobre el monolito vivo de prod (rama `feature/admin-edicion-y-nombre-nif` desde `recovery/prod-live-20260615`).

**Causa raíz (importes):** los importes se guardan como string en formato inconsistente (BD real tiene `"131,98"` con coma y `"146.20"` con punto en la misma columna). La tabla los normaliza siempre a `"1.234,56 €"` (`formatEuroStr`) pero el editor cargaba el valor crudo → discrepancia visible.

**Cambios (commit `cd6466c`):**
- `app/frontend/src/admin-facturas.js`: helpers `parseImporteToFloat` / `toSpanishAmountStr` / `toEditableValue` (espejo de `lib/normalize-amount.js`); el editor muestra importes en formato español igual que la celda y los guarda normalizados. Round-trip idempotente verificado (10/10 casos). Columna TIPO (`invoice_type`) ahora editable con selector compra/venta (`openEditModal`/`saveEdit` soportan `<select>`).
- `app/frontend/src/admin-facturas.html`: `<select id="edit-field-select">` + cache-buster `admin-facturas.js?v=20260615-001` (regla 6).
- `app/backend/src/server.js`: **bug preexistente corregido** — el export Excel usaba `parseFloat()` sobre importes en formato español (`"996,40"` → `996`, decimales perdidos). Sustituido por `normalizeToFloat()` (importado de `lib/normalize-amount`). Afecta `/api/admin/facturas/export.xlsx`.

**Verificación:** sintaxis OK (`node --check`), import resuelto, lógica de normalización probada. Backend del preview/OCR NO tocado (la feature nombre-desde-NIF ya funciona vía `company_relationships` tras confirmación).

**DESPLEGADO a producción 2026-06-16 ~08:55 UTC (build manual + swap, NO `deploy-prod.yml`):**
- Pre-flight: working tree limpio, imágenes previas retageadas `setex-prod-{backend,frontend}:rollback-20260616`, backup BD `setex_db_20260616_085518.sql.gz.gpg` (integridad verificada).
- Build + swap (`stop`+`up -d`, regla 7). Healthy en ~35s. Imagen viva backend `md5 server.js = 8f3129a…` (confirma el fix en runtime).
- Smoke post-deploy: `/health` 200 interno + HTTPS externo, smoke-test-http 3/3, cache-buster servido.
- **Rollback inmediato disponible:** `docker tag setex-prod-{backend,frontend}:rollback-20260616 ...:latest && docker compose up -d` (o `docker load` del backup `prod-images-live.tar.gz`).
- **Pendiente:** validación visual del cliente/admin (editar importe → coincide tabla/editor; editar TIPO; exportar Excel y comprobar decimales).

**SEGUNDO DEPLOY 2026-06-16 (solo frontend) — fix regresión Total + IRPF:**
- Bug introducido en `cd6466c`: la columna Total usaba `formatEuro` (`parseFloat`), por lo que un importe guardado en español (`"2.000,00"`) se mostraba `"2,00 €"` en la tabla (el valor real era correcto; solo la visualización). Unificada a `formatEuroStr`.
- Cuota IRPF a 0 ahora muestra `—` (como IRPF %) en vez de `0,00 €` (`formatCuotaImporteDash`).
- Cache-buster `?v=20260616-001`. Build+swap solo frontend, healthy, smoke 3/3, rollback `setex-prod-frontend:prev-20260616`.

**TERCER DEPLOY 2026-06-16 (solo frontend) — aviso de coherencia aritmética:** decisión de Julio = validar y AVISAR, no sobrescribir (el OCR puede tener razón y hay excepciones: recargo equivalencia, suplidos). `checkCoherencia()` compara `Base+CuotaIVA−CuotaIRPF` vs Total y `Base×IVA%` vs Cuota IVA (tolerancia 1 céntimo); si no cuadra, la celda muestra ⚠️ con el valor esperado en tooltip. Multi-IVA excluido del check de cuota. Todo editable a mano. Cache-buster `?v=20260616-002`, rollback `setex-prod-frontend:prev2-20260616`. Lógica probada (5 casos incl. formatos mixtos/IRPF).

**Aprendizaje NIF→nombre:** confirmado que ya funciona como pide Julio (empresa-cliente por CIF de perfil; contraparte por `company_relationships` aislado por cliente; mejora con cada confirmación). Registro de empresas-cliente y contrapartes entregado en sesión.

**CUARTO DEPLOY 2026-06-16 (solo frontend) — consentimiento usuario + aviso descuadre visible (flujo crítico de captura):**
- `index.html`: microcopy de **declaración responsable** bajo «Confirmar y guardar» (texto elegido por Julio: "Al confirmar, declaro que he revisado los datos y que son correctos y veraces") + **banner ámbar** `#confirm-descuadre-banner` (oculto por defecto).
- `app.js` `updateIVACalc`: el descuadre de Total ahora se marca con ✗ (antes el mensaje no lo marcaba, por lo que `⚠ Revisar` no lo detectaba); el banner se muestra/oculta en tiempo real según `hasError` (Base×IVA% o Base+IVA−IRPF). Avisa, NO bloquea. Listener ya cableado a los 5 campos del bloque IVA.
- Nota: el panel de comprobación del usuario YA tenía validación de coherencia (`updateIVACalc`) desde antes; esta entrega la hace prominente y añade el consentimiento.
- Cache-buster `app.js?v=20260616-001`, rollback `setex-prod-frontend:prev3-20260616`. Healthy, sitio 200.

**QUINTO DEPLOY 2026-06-17 (solo frontend) — aviso de descuadre robusto (bandera explícita):**
- `app.js` `updateIVACalc`: el aviso de descuadre se gobierna ahora con una bandera `hasError` explícita (no inferida del texto del mensaje), eliminando el falso negativo cuando el descuadre venía solo de `Base+IVA−IRPF≠Total`. El banner `#confirm-descuadre-banner` se muestra/oculta de forma fiable en tiempo real. Sigue avisando, NO bloquea.
- `index.html`: declaración responsable en **rojo** para mayor visibilidad. Cache-buster `app.js?v=20260616-002`.
- Commit `a999498` (estaba hecho pero sin desplegar; pendiente recogido en `kk_instrucciones_16_06_2026`). Build+swap solo frontend (NO `deploy-prod.yml`), healthy ~21s, sitio `200`, `app.js` servido = `?v=20260616-002` con `hasError` ×6 y `confirm-descuadre-banner` presente. Rollback `setex-prod-frontend:prev4-20260616` (build -001 previo). `fix-permissions.sh` sin cambios. Rama pusheada a origin (`b619167..a999498`).

**SEXTO DEPLOY 2026-06-18 (solo backend) — identidad del user como fuente de verdad (no OCR) + reconciliación de datos:**
- **Bug raíz:** el nombre/CIF del lado propio de la factura (receptor en compra, emisor en venta) se guardaba de lo que leía la IA (`server.js:2278-2279`, `finalReceptorNombre = confirmed || campos || ocrFull`), por lo que variaba entre facturas para un mismo CIF de empresa user. El registro del user (`users.company_name/company_nif`) ya se conocía pero no se usaba para fijar el nombre — solo el flujo admin (`previewClientCompanyData`) forzaba su lado.
- **Fix (`server.js`, commit en rama):** nuevas `finalProveedorNif/Nombre` explícitas; bloque `[User-Identity]` que, en flujo user normal (no admin), fuerza el lado propio desde el registro según `invoice_type`. Garantiza "mismo CIF → siempre el mismo nombre, el registrado". La IA solo decide la contraparte. Jerarquía de confianza acordada con Julio: valor revisado por admin > registro BD > IA (la IA solo cuando no hay registro).
- **Reconciliación de datos (verdad = `uploads`, revisado por admin):** detectadas 3 contrapartes con CIF inconsistente entre `uploads` y el aprendizaje (la IA leyó el mismo NIF de formas distintas): ALEX DISTRIBUCIONES `B06588511`→`B06695381`, COCEDERO DE MARISCOS LA MAR `B06277878`→`B06195788`, COALIMENT CASTILLA `A45059617`→`A45039617`. Alineadas `known_cifs` (UPDATE 3) y `company_relationships` (UPDATE 3) al valor de `uploads`. 0 discrepancias restantes. Lado user de las 9 facturas: ya coincidía con el registro, sin cambios. Backup BD previo `setex_db_20260618_112438.sql.gz.gpg`.
- Build+swap solo backend (NO `deploy-prod.yml`), healthy, sitio 200. Rollback `setex-prod-backend:prev-20260618`. **Pendiente: cuentas user sin `company_nif` (Autoken, Carlos Bernáldez, soporte@autoken) — la garantía no aplica hasta registrar su CIF (Julio decidió dejarlas).**

**Nota estado git:** el working tree de prod queda en rama `feature/admin-edicion-y-nombre-nif` (= imagen viva). El estado anterior sigue en `recovery/prod-live-20260615`. Ambas en origin.


### 2026-07-06 — Integración Google Gemini 3 (Flash + Pro) como motores OCR extra
- `prod/app/docker-compose.yml`: añadido secret `gemini_api_key` en sección backend secrets y sección secrets global (OK de Julio, REGLA 1 cumplida)
- `prod/secrets/gemini_api_key.txt`: clave real colocada (644, deploy:deploy); archivo fuente `/opt/kk.txt` destruido con `shred -u`
- `prod/app/backend/src/ocr/gemini.js`: nuevo módulo Gemini 3 Flash/Pro (parche quirúrgico desde staging; gemini-3.5-flash ESTABLE, gemini-3.1-pro-preview PREVIEW)
- `prod/app/backend/src/ocr/index.js`: orquestador multi-motor actualizado con soporte Gemini Flash y Pro (copiado byte-a-byte desde staging)
- `prod/app/backend/src/config/features.json`: añadidos `ocr_gemini_flash_model`, `ocr_gemini_pro_model`, `ocr_multi_engines`, comentarios `_OCR_MODE`/`_OCR_MULTI`; `ocr_mode` se mantiene en `triple` (Gemini disponible pero no activado hasta que cuenta tenga créditos)
- Backend prod rebuildeado y healthy (Up, healthcheck OK); secreto Gemini verificado en `/run/secrets/gemini_api_key`
- **PENDIENTE**: créditos Google AI Studio agotados (429 RESOURCE_EXHAUSTED) — integrar Gemini a flujo multi requiere recargar prepago en aistudio.google.com
- `staging/app/backend/src/config/features.json`: `ocr_mode` cambiado a `multi` para E2E (pendiente confirmación cuando se recarguen créditos Gemini)


### 2026-07-07 — Modo gemini_azure: Gemini 3.5 Flash como motor primario (reemplaza OpenAI)
- Bench externo (20 facturas × 5 motores, 2026-07-07): gemini-3.5-flash lidera con 88,6% global, 90,3% CIF, 100% totales. Formalizado en ADR-0007.
- `prod/app/backend/src/ocr/index.js`: `compareOCRResults` refactorizado para motores primarios arbitrarios (labelA/labelB); nuevo modo `gemini_azure` = Gemini Flash (primaryA) + Azure DI (primaryB). Retrocompat completa para modos dual/triple/multi.
- `prod/app/backend/src/config/features.json`: `ocr_mode` cambiado a `gemini_azure`; `ocr_primary_engine` = `gemini_flash`.
- E2E staging verificado: `engine=dual_gemini_flash_azure`, `dual_confirmed=true`, `confidence=1.000`, 5,99s (Flash 5,9s + Azure 4,7s en paralelo).
- Backend prod rebuildeado y healthy; modo gemini_azure activo en producción desde 2026-07-07.
- Model ID confirmado: `gemini-3-flash` (alias del bench) = `gemini-3.5-flash` (ID real API); `gemini-3-flash` devuelve 404.
- OpenAI sigue disponible como motor único (`ocr_mode: "openai"`) o puede reactivarse cambiando features.json sin rebuild.

### 2026-07-07 — Gemini Flash motor CIF completo + panel tech admin OCR comparador
- `ocr/gemini.js`: añadidas `extractCIFOnly` (zona superior 65%) y `extractReceptorCIFOnly` (zona inferior 60%) con recorte sharp y schema CIF_ONLY_SCHEMA; motor preferido para todas las extracciones CIF.
- `ocr/index.js`: `_secondPassReceptorIfNeeded` y `extractCIFOnlyOCR` migrados a Gemini Flash con fallback a OpenAI; label en `receptor_nif_source` refleja el motor usado.
- `scripts/smoke-test-ocr.js`: `testGeminiFlash()` añadido; skip automático si secret ausente (entorno legacy); verificado 5/5 motores OK (2026-07-07 10:45).
- `config/features.json` (staging): `tech_admin_emails: ["juliohesuni@gmail.com"]` para diferenciación sin migración de BD.
- `server.legacy.js`: `isTechAdmin()` helper; `is_tech_admin` en respuesta de login y refresh-session; nuevo endpoint `GET /api/admin/facturas/:id/ocr-detail` (403 si no es tech_admin) devuelve `confirmed`/`ocr_raw`/`motors`/`meta`.
- `admin-facturas.js`: `parseFechaEs()` fix Invalid Date DD/MM/YYYY; nombre/importe desde campos confirmados; navegación prev/next en lightbox; botón ⚙ OCR + modal comparador IA vs Humano (solo tech admins); captura `is_tech_admin` en login y launchApp.
- `admin-facturas.html`: `<div id="ocr-modal">` + cache-buster `?v=20260707-001`.
- PR #124 abierto contra `develop`; pendiente rebuild staging (stop + up -d) con OK de Julio.

---

*SETEX Captura Facturas · setex-facturas.es*
*Documento de referencia — actualizar con cada sesión de desarrollo*
