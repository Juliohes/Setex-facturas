# REVISIÓN QUIRÚRGICA DE SEGURIDAD — SETEX Captura Facturas
## Principal Security Code Reviewer · Lead DevSecOps · Senior AppSec Architect
**Fecha:** 2026-04-09 | **Versión analizada:** producción en xanflatest.com

---

## RESUMEN EJECUTIVO

| Severidad | Cantidad | Estado |
|-----------|----------|--------|
| Crítica   | 2        | ⚠️ Acción inmediata |
| Alta      | 5        | ⚠️ Acción urgente |
| Media     | 8        | 📋 Planificar sprint |
| Baja      | 5        | 📝 Backlog técnico |

**Total: 20 hallazgos.**

La base del sistema es sólida. La sesión anterior implementó la mayoría de las mejoras más urgentes (Redis con contraseña, aislamiento de red, SMTP en secrets, rotación de logs, SSH con clave, fail2ban). Los hallazgos que siguen son los problemas que **aún existen en el código** tras esos cambios, identificados línea a línea.

---

## HALLAZGOS

---

### Hallazgo SEC-001
**Archivo:** `app/docker-compose.yml`  
**Bloque:** `redis.command`  
**Líneas:** 87–89  
**Categoría:** secretos / infraestructura  
**Severidad:** Crítica  
**Prioridad:** Inmediata  

**Problema:**
La contraseña de Redis está en texto plano dentro del campo `command` del servicio Redis:

```yaml
command: >
  redis-server
  --requirepass 3b0e7329ab68a522e5b5da9a6cc5db046ca95cf8c35eb31203791298475dbab2
```

Cualquiera con acceso al fichero `docker-compose.yml` (git, backup, despliegue CI/CD, `docker inspect`) puede leer la contraseña Redis sin restricción.

**Riesgo real:**
- `docker inspect setex-redis` expone el comando completo con la contraseña en el JSON de inspect, accesible para cualquier proceso con acceso al socket Docker.
- Si el fichero docker-compose.yml se sube a un repositorio (incluso privado), la credencial queda en el histórico git para siempre.
- El healthcheck (línea 97) también incluye la contraseña en claro en el comando.

**Parche propuesto — Redis con config file (evita la contraseña en la línea de comando):**

1. Crear `/opt/setex-captu-facture/secrets/redis.conf`:
```
requirepass CONTRASEÑA_AQUI
maxmemory 128mb
maxmemory-policy allkeys-lru
save 60 1
```
Con permisos `chmod 600`, propiedad de root.

2. En `docker-compose.yml`, montar el fichero y eliminar la contraseña del `command`:
```yaml
redis:
  command: redis-server /etc/redis/redis.conf
  volumes:
    - /opt/setex-captu-facture/data/redis:/data
    - /opt/setex-captu-facture/secrets/redis.conf:/etc/redis/redis.conf:ro
  healthcheck:
    test: ["CMD-SHELL", "redis-cli -a $(cat /etc/redis/redis.conf | grep requirepass | awk '{print $2}') ping | grep -q PONG"]
```

Así la contraseña no aparece en `command`, `docker inspect`, ni en `docker ps`.

**Validación:** `docker inspect setex-redis | grep -i requirepass` debe retornar vacío.

---

### Hallazgo SEC-002
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `register()` → `jwt.sign()`  
**Líneas:** 684  
**Categoría:** autenticación / revocación de sesiones  
**Severidad:** Crítica  
**Prioridad:** Inmediata  

**Problema:**
El endpoint de registro emite un JWT sin incluir `token_version` ni `is_admin`:

```javascript
// LÍNEA 684 — JWT del registro (incompleto)
const token = jwt.sign({ userId: result.rows[0].id, email }, jwtSecretCached, { expiresIn: '7d' });
```

En contraste, el endpoint de login (líneas 755–761) sí incluye ambos campos:

```javascript
const tokenPayload = {
  userId: user.id,
  email: user.email,
  is_admin: user.is_admin || ADMIN_EMAILS.includes(user.email),
  token_version: user.token_version || 1,
};
```

**Riesgo real:**
1. **Revocación rota:** El middleware `authenticateToken` verifica token_version en la BD SOLO `if (user.token_version !== undefined)` (línea 454). El JWT del registro no tiene `token_version`, así que el check se omite completamente. Si un atacante obtiene el token de registro de un usuario nuevo y ese usuario cambia su contraseña, el token del atacante **sigue siendo válido durante 7 días** sin importar el reset.
2. **is_admin no verificado:** Si se añade un usuario como admin y luego ese usuario se registra (nuevo dispositivo), el JWT no tiene `is_admin`. `requireAdmin` comprueba `req.user.is_admin === true` que será `undefined`, cayendo al fallback ADMIN_EMAILS. Si el nuevo admin no está en ADMIN_EMAILS, no tendrá acceso admin hasta que haga login.

**Parche — alinear register con login:**

```diff
-    const token = jwt.sign({ userId: result.rows[0].id, email }, jwtSecretCached, { expiresIn: '7d' });
+    const registerPayload = {
+      userId: result.rows[0].id,
+      email,
+      is_admin: false,
+      token_version: 1,
+    };
+    const token = jwt.sign(registerPayload, jwtSecretCached, { expiresIn: '7d' });
```

**Validación:** Tras un registro, hacer un password-reset del mismo usuario y verificar que el token de registro devuelve 403 en cualquier endpoint autenticado.

---

### Hallazgo SEC-003
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `sendQualityEmail()` y `POST /api/auth/forgot-password`  
**Líneas:** 564, 805  
**Categoría:** funcionalidad rota post-hardening / secretos  
**Severidad:** Alta  
**Prioridad:** Inmediata  

**Problema:**
Tras la migración de SMTP a Docker secrets (HAL-006), las variables de entorno `SMTP_USER` y `SMTP_PASS` fueron eliminadas del `docker-compose.yml`. Sin embargo, dos funciones siguen comprobando `process.env.SMTP_USER` como guardia:

```javascript
// LÍNEA 564 — Notificaciones de calidad
async function sendQualityEmail(userEmail, filename, issues) {
  if (!emailTransporter || !process.env.SMTP_USER) return; // SIEMPRE RETORNA — SMTP_USER es undefined
```

```javascript
// LÍNEA 805 — Recuperación de contraseña
if (emailTransporter && process.env.SMTP_USER) {  // SIEMPRE FALSE — va al else
```

La función `initEmailTransporter()` SÍ lee correctamente desde `/run/secrets/smtp_user` y configura `emailTransporter`. Pero las guardias posteriores comprueban la variable de entorno que ya no existe, bloqueando el envío.

**Consecuencia real:**
- **Recuperación de contraseña completamente rota.** Los usuarios que olviden su contraseña no reciben el email de reset. El sistema guarda el token en BD pero nunca lo envía.
- Las notificaciones de calidad de imagen tampoco se envían.

**Parche:**

```diff
// sendQualityEmail (línea 564)
-  if (!emailTransporter || !process.env.SMTP_USER) return;
+  if (!emailTransporter) return;

// forgot-password (línea 805)
-  if (emailTransporter && process.env.SMTP_USER) {
+  if (emailTransporter) {
```

También en el `from:` de los emails (líneas 569, 808) que usan `process.env.SMTP_USER`:

```diff
// línea 569 y 808
-  from: `"SETEX Facturas" <${process.env.SMTP_USER}>`,
+  from: `"SETEX Facturas" <${smtpUserCached}>`,
```

Para esto, guardar el valor leído en `initEmailTransporter`:

```javascript
let smtpUserCached = null;  // añadir al scope del módulo

async function initEmailTransporter() {
  let smtpUser = process.env.SMTP_USER;
  // ... leer secrets ...
  smtpUserCached = smtpUser;  // cachear para usar en from:
```

**Validación:** `docker compose restart backend` → ejecutar `POST /api/auth/forgot-password` con un email existente → verificar que llega el email.

---

### Hallazgo SEC-004
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `authenticateToken()`  
**Líneas:** 465–468  
**Categoría:** autenticación / fail-open  
**Severidad:** Alta  
**Prioridad:** Urgente  

**Problema:**
Cuando el check de `token_version` contra la BD falla por error de base de datos, el middleware permite la petición de todas formas (fail-open):

```javascript
// LÍNEAS 465–468
} catch (dbErr) {
  // En error de BD, permitir la petición (fail open) — no bloqueamos al usuario
  logger.warn('token_version DB check error:', dbErr.message);
}
```

**Riesgo real:**
Si la base de datos PostgreSQL se vuelve inestable (overload, restart, failover), el sistema acepta TODOS los JWTs, incluidos los revocados. Un atacante con un token robado y antiguo podría provocar una degradación de PostgreSQL (DoS selectivo a pg) para usar tokens ya invalidados.

**Contexto:**
El comment dice "no bloqueamos al usuario" pero la decisión correcta en un sistema de facturación con datos sensibles es "fail secure": si no puedes verificar si el token es válido, rechazarlo es más seguro que aceptarlo.

**Parche — fail-secure:**

```diff
} catch (dbErr) {
-  // En error de BD, permitir la petición (fail open) — no bloqueamos al usuario
-  logger.warn('token_version DB check error:', dbErr.message);
+  logger.error('token_version DB check failed — rejecting request (fail-secure):', dbErr.message);
+  return res.status(503).json({ error: 'Servicio temporalmente no disponible. Inténtalo en unos segundos.' });
}
```

Si esto es demasiado agresivo para la UX, una alternativa intermedia es aplicar fail-secure solo a rutas de escritura (POST/PUT/DELETE/PATCH) y fail-open solo a GETs de lectura. Pero para un producto con datos fiscales, fail-secure total es lo correcto.

**Validación:** Simular error de BD con `docker pause setex-postgres` y verificar que los endpoints protegidos devuelven 503, no 200.

---

### Hallazgo SEC-005
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `POST /api/upload-preview` → validación magic bytes  
**Líneas:** 1040–1051  
**Categoría:** uploads / bypass de validación  
**Severidad:** Alta  
**Prioridad:** Urgente  

**Problema:**
El bloque de validación magic bytes captura la excepción y continúa sin rechazar el archivo:

```javascript
// LÍNEAS 1040–1051
try {
  const validMagic = await validateFileMagicBytes(filePath, req.file.mimetype);
  if (!validMagic) {
    // ... rechazar ...
  }
} catch (magicErr) {
  logger.warn('Magic bytes validation error', { error: magicErr.message });
  // ← CONTINÚA PROCESANDO EL ARCHIVO sin validar los magic bytes
}
```

**Riesgo real:**
Si `validateFileMagicBytes` lanza una excepción (error de I/O, disco lleno, descriptor de fichero agotado), el archivo pasa directamente a OCR sin validación MIME. Esto podría permitir la subida de ficheros con MIME spoofing (ej. un ejecutable con extensión `.jpg`) cuando el sistema está bajo presión de disco.

**Parche:**

```diff
} catch (magicErr) {
  logger.warn('Magic bytes validation error — rejecting file as precaution', { error: magicErr.message });
+  fs.unlink(filePath).catch(() => {});
+  return res.status(400).json({ error: 'No se pudo verificar el tipo de archivo. Inténtalo de nuevo.' });
}
```

**Validación:** Saturar el disco temporalmente y verificar que los uploads son rechazados en lugar de procesados sin validar.

---

### Hallazgo SEC-006
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `upload-confirm` → `company_catalog` auto-learn  
**Líneas:** 1615–1621  
**Categoría:** multi-tenant / contaminación de datos  
**Severidad:** Alta  
**Prioridad:** Urgente  

**Problema:**
Cuando un usuario confirma una factura, el sistema aprende automáticamente el par (nombre, NIF) del proveedor y lo inserta en la tabla **global** `company_catalog`:

```javascript
// LÍNEAS 1615–1621
await pool.query(`
  INSERT INTO company_catalog (proveedor_nombre, proveedor_nombre_norm, proveedor_nif, notas)
  VALUES ($1, $2, $3, 'Aprendido automáticamente')
  ON CONFLICT (proveedor_nif) DO NOTHING   // ← "primer usuario que llega, gana"
`, [campos.proveedor_nombre.trim().substring(0, 255), nombreNorm, finalNif]);
```

La cláusula `ON CONFLICT DO NOTHING` significa que el **primer usuario que suba una factura de un proveedor nuevo define el nombre canónico para TODOS los demás usuarios.**

**Riesgo real:**
1. Un usuario con acceso legítimo puede contaminar intencionalmente el catálogo global enviando un nombre de empresa incorrecto asociado a un NIF real. A partir de ese momento, todos los demás usuarios ven el nombre contaminado.
2. En el endpoint de preview (líneas 1201–1215), el catálogo global tiene **máxima prioridad** sobre el historial del propio usuario. Si el catálogo global tiene datos incorrectos, no hay forma de que un usuario individual lo corrija para sí mismo.
3. Escenario de ataque: usuario A sube una factura de "Empresa Falsa S.L." con CIF B12345678. Desde ese momento, cuando usuario B suba una factura del mismo CIF (que es "Mercadona S.A."), el sistema le sugerirá "Empresa Falsa S.L." como nombre del proveedor.

**Parche:**

```diff
// Opción 1 (mínima): eliminar el auto-learn al catálogo global — solo guardar en known_cifs del usuario
- await pool.query(`
-   INSERT INTO company_catalog (proveedor_nombre, proveedor_nombre_norm, proveedor_nif, notas)
-   VALUES ($1, $2, $3, 'Aprendido automáticamente')
-   ON CONFLICT (proveedor_nif) DO NOTHING
- `, [campos.proveedor_nombre.trim().substring(0, 255), nombreNorm, finalNif]);

// Opción 2 (mejor UX): auto-learn al catálogo global solo si hay ≥ N usuarios distintos
// que confirman el mismo par (NIF, nombre) — necesita tabla de staging y lógica de quorum.
// Umbral recomendado: 3 usuarios distintos.
```

**Validación:** Verificar que tras la confirmación de una factura, `company_catalog` solo crece si lo añade un admin desde el panel, no automáticamente.

---

### Hallazgo SEC-007
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `GET /api/admin/security/blocked`  
**Líneas:** 2433  
**Categoría:** Redis / rendimiento  
**Severidad:** Media  
**Prioridad:** Alta  

**Problema:**
Este endpoint usa `redisClient.keys()` directamente en lugar del helper `redisCountPattern()` basado en SCAN que fue implementado precisamente para evitar este patrón:

```javascript
// LÍNEA 2433 — KEYS bloquea Redis
const keys = await redisClient.keys('sec:block:*');
```

En `system-health` se usa correctamente el helper SCAN (línea 2061). La inconsistencia crea una regresión: un admin que lista IPs bloqueadas con muchas IPs en Redis puede bloquear el servidor completo.

**Parche:**

```diff
app.get('/api/admin/security/blocked', authenticateToken, requireAdmin, async (_req, res) => {
  try {
-   const keys = await redisClient.keys('sec:block:*');
-   const blocked = keys.map(k => ({ ip: k.replace('sec:block:', '') }));
+   const blocked = [];
+   let cursor = '0';
+   do {
+     const [next, keys] = await redisClient.scan(cursor, 'MATCH', 'sec:block:*', 'COUNT', '100');
+     cursor = next;
+     for (const k of keys) blocked.push({ ip: k.replace('sec:block:', '') });
+   } while (cursor !== '0');
    res.json({ blocked });
```

**Validación:** Con >10.000 entradas en Redis, verificar que el endpoint responde sin timeout ni impacto en latencia del resto del sistema.

---

### Hallazgo SEC-008
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `POST /api/admin/ocr-engine`  
**Líneas:** 1989  
**Categoría:** CSRF / autorización  
**Severidad:** Media  
**Prioridad:** Alta  

**Problema:**
El endpoint de cambio de motor OCR no tiene el middleware `requireXHR` que sí tienen otros endpoints de escritura admin:

```javascript
// LÍNEA 1989 — falta requireXHR
app.post('/api/admin/ocr-engine', authenticateToken, requireAdmin, (req, res) => {
```

En comparación, endpoints similares como `PUT /api/admin/facturas/:id` (línea 2290) sí usan `requireXHR`.

También le falta `requireXHR` a `POST /api/admin/retry-failed/:id` (línea 1919).

**Riesgo real:**
Con JWT en localStorage, el riesgo CSRF real es bajo (el fetch cross-origin no puede incluir el token automáticamente). Sin embargo, la inconsistencia viola el principio de defensa en profundidad y podría ser explotable si en el futuro se migra a cookies.

**Parche:**

```diff
-app.post('/api/admin/ocr-engine', authenticateToken, requireAdmin, (req, res) => {
+app.post('/api/admin/ocr-engine', authenticateToken, requireAdmin, requireXHR, (req, res) => {

-app.post('/api/admin/retry-failed/:id', authenticateToken, requireAdmin, async (req, res) => {
+app.post('/api/admin/retry-failed/:id', authenticateToken, requireAdmin, requireXHR, async (req, res) => {
```

**Validación:** Llamar al endpoint sin cabecera `X-Requested-With: XMLHttpRequest` → debe devolver 403.

---

### Hallazgo SEC-009
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `GET /api/mis-facturas`  
**Líneas:** 1694  
**Categoría:** exposición de información  
**Severidad:** Media  
**Prioridad:** Alta  

**Problema:**
El endpoint de historial de facturas del usuario devuelve el campo `file_path` que contiene rutas absolutas del sistema de archivos interno del contenedor:

```javascript
// LÍNEA 1694 — file_path retornado al cliente
drive_file_id, file_path
```

Esto expone al cliente: `/app/uploads/julio/B12345678/setex_invoice_2024...jpg`.

**Riesgo real:**
- Revela la estructura interna de directorios del contenedor.
- Revela el NIF de la empresa del usuario (está en la ruta de directorio).
- Podría usarse para ataques de path traversal si otros endpoints confían ciegamente en este valor.

**Parche:**

```diff
- drive_file_id, file_path
+ drive_file_id
```

Para servir la imagen, el frontend usa el endpoint `/api/facturas/:id/imagen` que ya valida que el `file_path` es interno. El campo `file_path` no necesita estar en la respuesta del historial.

**Validación:** Verificar en el JSON de respuesta de `/api/mis-facturas` que no aparece el campo `file_path`.

---

### Hallazgo SEC-010
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `normalizeDate()`  
**Líneas:** 1478–1488  
**Categoría:** validación de datos / integridad  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
La función `normalizeDate` valida rangos básicos pero no valida que la combinación día/mes sea un calendario real:

```javascript
// LÍNEAS 1482–1487
const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) {
  return String(d).trim(); // retorna el original
}
return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
```

Fechas como `31/02/2024` (no existe), `31/04/2024` (no existe), `29/02/2023` (2023 no es bisiesto) se normalizan y guardan en BD sin error.

**Riesgo real:**
- Facturas con fecha `31/02/2024` nunca serán detectadas como duplicadas si se re-sube la misma factura con fecha `28/02/2024` (fechas distintas en la clave de duplicados).
- Datos incorrectos en los informes contables.

**Parche:**

```diff
function normalizeDate(d) {
  if (!d) return '';
  const m = String(d).trim().match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (!m) return String(d).trim();
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10), year = parseInt(m[3], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return String(d).trim();
  }
+  // Validar que la fecha existe en el calendario
+  const testDate = new Date(year, month - 1, day);
+  if (testDate.getFullYear() !== year || testDate.getMonth() !== month - 1 || testDate.getDate() !== day) {
+    logger.warn(`[Date] Fecha de calendario inválida: ${d} → devuelto original`);
+    return String(d).trim();
+  }
  return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
}
```

---

### Hallazgo SEC-011
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `PUT /api/admin/facturas/:id`  
**Líneas:** 2290–2319  
**Categoría:** autorización / inyección  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
El endpoint de edición de facturas admin construye la cláusula SET del UPDATE concatenando nombres de campo del array `EDITABLE`:

```javascript
// LÍNEAS 2304–2309
const setClauses = Object.keys(updates).map((f, i) => `${f} = $${i + 1}`);
const values = [...Object.values(updates), id];
await pool.query(
  `UPDATE uploads SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING id, sheets_row`,
  values
);
```

El nombre del campo `f` proviene de `Object.keys(updates)`, que a su vez proviene de iterar el array `EDITABLE` (línea 2294). Los valores están parametrizados correctamente. Sin embargo, si `EDITABLE` se modifica inadvertidamente para incluir un campo no deseado, o si `req.body` incluye un campo que coincide con algo no en EDITABLE (el código filtra correctamente), la construcción del SQL con el nombre de columna en texto plano es frágil.

En la práctica actual el riesgo es bajo porque `EDITABLE` es un array literal hardcoded y solo se iteran sus elementos. Pero es un patrón que merece reforzarse.

**Parche (hardening adicional):**

```diff
// Doble validación: verificar que cada campo está en EDITABLE antes de usar en SQL
for (const field of EDITABLE) {
  if (req.body[field] !== undefined) updates[field] = req.body[field] || null;
}
// El código ya hace esto — no hay vector de inyección real en la implementación actual.
// Añadir solo como documentación explícita de la intención de seguridad:
const safeUpdates = {};
for (const [key, val] of Object.entries(updates)) {
  if (EDITABLE.includes(key)) safeUpdates[key] = val; // redundante pero explícito
}
```

---

### Hallazgo SEC-012
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `isRestrictedHour()`  
**Líneas:** 80–88  
**Categoría:** lógica de acceso / denegación de servicio involuntaria  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
Si `start_hour === end_hour`, la condición de la función produce un bloqueo total permanente:

```javascript
// LÍNEA 87
return start_hour < end_hour
  ? (h >= start_hour && h < end_hour)
  : (h >= start_hour || h < end_hour);  // con start=end=6: h>=6 || h<6 → SIEMPRE TRUE
```

Con `start_hour=6` y `end_hour=6`, la expresión se evalúa a `h >= 6 || h < 6` que es siempre verdadero. La aplicación queda completamente bloqueada.

**Riesgo real:** Un admin que accidentalmente ponga el mismo valor en start y end (error de UI, copy-paste) bloquea el sitio para todos los usuarios.

**Parche:**

```diff
// LÍNEA 38 — validar al escribir la configuración
app.patch('/api/admin/security/time', authenticateToken, requireAdmin, requireXHR, (req, res) => {
  const { enabled, start_hour, end_hour } = req.body || {};
+  if (start_hour !== undefined && end_hour !== undefined && parseInt(start_hour, 10) === parseInt(end_hour, 10)) {
+    return res.status(400).json({ error: 'start_hour y end_hour no pueden ser iguales (causaría bloqueo permanente).' });
+  }

// También en isRestrictedHour como fallback:
function isRestrictedHour(cfg) {
  if (!cfg?.time_restriction?.enabled) return false;
  const { start_hour = 0, end_hour = 6, timezone = 'Europe/Madrid' } = cfg.time_restriction;
+  if (start_hour === end_hour) return false; // configuración inválida → no restringir
```

---

### Hallazgo SEC-013
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `GET /api/mis-facturas`  
**Líneas:** 1686–1706  
**Categoría:** exposición de datos / información sensible  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
La consulta del historial de facturas del usuario no tiene ningún límite de tiempo configurable y está hardcoded a los últimos 7 días con LIMIT 50. Sin embargo, el export XLSX usa LIMIT 10000 sin filtro de tiempo. El usuario puede exportar todas sus facturas históricas de golpe.

El problema más relevante es que el endpoint devuelve `ocr_result` (campo JSONB) que contiene los resultados brutos de AMBOS motores OCR (OpenAI + Azure), incluyendo todo el texto OCR completo extraído de la factura. Este texto puede incluir datos que el propio usuario no quiere en la respuesta de la API (bancarios, personales, etc.).

Verificar que `ocr_result` no se devuelve en `GET /api/mis-facturas`:

```javascript
// LÍNEA 1689–1700 — ocr_result no aparece en el SELECT, correcto ✓
SELECT id, proveedor_nombre, proveedor_nif, ...
       drive_file_id, file_path  // ← file_path sí aparece (ver SEC-009)
FROM uploads WHERE user_id = $1 ...
```

Confirmado: `ocr_result` no se devuelve en el listado. Solo `file_path` es el campo problemático (ya documentado en SEC-009).

**Hallazgo real: falta de paginación en el historial.** Con 50 facturas el sistema es seguro. Si se cambia el LIMIT en el futuro, la carga por usuario puede ser significativa.

**Recomendación:** Añadir paginación (`offset`/`limit` por query param) y mantener el máximo en 100 por página.

---

### Hallazgo SEC-014
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `GET /api/vies/:nif` — sin rate limit  
**Líneas:** 1936–1948  
**Categoría:** rate limiting / abuso de API externa  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
El endpoint de consulta VIES tiene `authenticateToken` pero no tiene ningún rate limiter específico. Un usuario autenticado puede llamarlo en bucle para:
1. Enumerar todos los CIFs españoles válidos contra el servicio VIES de la UE.
2. Consumir cuota del servicio VIES (que tiene limitaciones por IP de origen).

```javascript
// LÍNEA 1936 — falta rate limiter
app.get('/api/vies/:nif', authenticateToken, async (req, res) => {
```

**Parche:**

```diff
+const viesLimiter = rateLimit({
+  windowMs: 60 * 1000,   // 1 minuto
+  max: 20,               // 20 consultas/minuto por usuario
+  keyGenerator: (req) => String(req.user?.userId || req.ip),
+  standardHeaders: true,
+  message: { error: 'Demasiadas consultas VIES. Espera un momento.' }
+});

-app.get('/api/vies/:nif', authenticateToken, async (req, res) => {
+app.get('/api/vies/:nif', authenticateToken, viesLimiter, async (req, res) => {
```

---

### Hallazgo SEC-015
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `GET /api/admin/facturas` — LIMIT inconsistente  
**Líneas:** 2131  
**Categoría:** datos / DOS  
**Severidad:** Media  
**Prioridad:** Baja  

**Problema:**
El endpoint admin de listado usa LIMIT 5000 (línea 2131), mientras que el export XLSX usa LIMIT 10000 (línea 2204). Esta inconsistencia puede confundir a los operadores: el panel muestra 5000 facturas pero el export tiene 10000.

Además, `LIMIT 5000` sin `OFFSET` ni cursores impide la paginación real.

**Parche:**

Añadir paginación real con parámetros de query:
```javascript
const page = Math.max(1, parseInt(req.query.page || '1', 10));
const pageSize = Math.min(500, Math.max(1, parseInt(req.query.page_size || '100', 10)));
const offset = (page - 1) * pageSize;
// ... query con LIMIT $p OFFSET $p+1
```

---

### Hallazgo SEC-016
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `ipInRange()`  
**Líneas:** 63–74  
**Categoría:** acceso / bypass  
**Severidad:** Baja  
**Prioridad:** Media  

**Problema:**
La función `ipInRange` solo implementa CIDR para IPv4. No maneja rangos CIDR IPv6. Con `trust proxy 1`, si Traefik enruta conexiones IPv6, la IP extraída puede ser IPv6 pura (no `::ffff:x.x.x.x`) y los checks de whitelist/blacklist con notación CIDR IPv4 fallarán silenciosamente:

```javascript
// La función retorna false para IPv6 en rangos CIDR → IP queda fuera de whitelist/blacklist
function ipInRange(ip, range) {
  if (!range.includes('/')) return ip === range; // exacto funciona para IPv6
  try {
    const [net, bits] = range.split('/');
    // ... lógica solo IPv4 ...
  }
}
```

**Riesgo real:** Una IP en la blacklist definida como `1.2.3.0/24` no bloquearía `::ffff:1.2.3.45`. El strip de `::ffff:` en la capa de middleware (línea 343) mitiga esto parcialmente.

**Parche mínimo:** Añadir en `loadSecurityConfig` una nota explícita de que las listas solo funcionan para IPv4, y en `ipInRange` descartar IPs que no parezcan IPv4 cuando el rango es CIDR:

```javascript
function ipInRange(ip, range) {
  if (!ip || !range || typeof range !== 'string' || range.startsWith('_')) return false;
  // Si la IP no parece IPv4 y el rango es CIDR IPv4, retornar false explícitamente
  if (range.includes('/') && ip.includes(':')) return false; // IPv6 vs CIDR IPv4
  if (!range.includes('/')) return ip === range;
  // ... resto de la lógica ...
}
```

---

### Hallazgo SEC-017
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `POST /api/auth/login` → `SELECT *`  
**Líneas:** 706  
**Categoría:** exposición de datos / código defensivo  
**Severidad:** Baja  
**Prioridad:** Baja  

**Problema:**
La consulta de login usa `SELECT *`:

```javascript
// LÍNEA 706
const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
```

Esto trae todos los campos de la tabla `users` (incluyendo `password_hash`, `token_version`, `is_admin`, `company_nif`, `company_name`, `created_at`, `auto_confirm_enabled`). El hash de contraseña queda en memoria hasta que el objeto es garbage-collected.

**Riesgo real:** Bajo en la implementación actual. Si se añade un campo sensible futuro (e.g., `mfa_secret`), se expondría automáticamente en la memoria del proceso de login.

**Parche:**

```diff
-const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
+const result = await pool.query(
+  'SELECT id, email, password_hash, is_admin, token_version, company_nif, auto_confirm_enabled FROM users WHERE email = $1',
+  [email]
+);
```

---

### Hallazgo SEC-018
**Archivo:** `app/docker-compose.yml`  
**Bloque:** `redis.healthcheck`  
**Líneas:** 97  
**Categoría:** secretos en logs  
**Severidad:** Baja  
**Prioridad:** Baja  

**Problema:**
El healthcheck de Redis incluye la contraseña en texto plano en el comando:

```yaml
# LÍNEA 97
test: ["CMD-SHELL", "redis-cli -a 3b0e7329ab68a522e5b5da9a6cc5db046ca95cf8c35eb31203791298475dbab2 ping | grep -q PONG"]
```

`docker inspect setex-redis` o `docker events` pueden revelar este comando con la contraseña.

**Parche:** Si se implementa el config-file propuesto en SEC-001, el healthcheck puede leer la contraseña del fichero:

```yaml
test: ["CMD-SHELL", "redis-cli -a $(grep requirepass /etc/redis/redis.conf | awk '{print $2}') ping | grep -q PONG"]
```

---

### Hallazgo SEC-019
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** Constante `ADMIN_EMAILS`  
**Líneas:** 546–547  
**Categoría:** autorización / hardcoded credentials  
**Severidad:** Baja  
**Prioridad:** Baja  

**Problema:**
El array `ADMIN_EMAILS` con los emails de admins sigue hardcoded en el código fuente:

```javascript
// LÍNEAS 546–547
const ADMIN_EMAILS = ['juliohesuni@gmail.com', 'albertomurimarti@gmail.com'];
const ADMIN_EMAILS_BOOTSTRAP = ADMIN_EMAILS;
```

El comentario en la línea 545 indica que es temporal ("TODO: eliminar cuando todos los admins hayan vuelto a hacer login"). Una vez que ambos admins hayan iniciado sesión con el nuevo sistema (is_admin en BD), este array puede y debe eliminarse.

**Condición de eliminación:** Ambos admins deben tener `is_admin = true` en BD. Verificar con:
```sql
SELECT email, is_admin FROM users WHERE email = ANY(ARRAY['juliohesuni@gmail.com', 'albertomurimarti@gmail.com']);
```

Una vez confirmado, eliminar el array y limpiar los fallbacks en `requireAdmin` y en el JWT del login.

---

### Hallazgo SEC-020
**Archivo:** `app/backend/src/server.js`  
**Bloque / función:** `export.xlsx` (usuario y admin)  
**Líneas:** 1834, 2280  
**Categoría:** headers HTTP  
**Severidad:** Baja  
**Prioridad:** Baja  

**Problema:**
Los exports XLSX usan `Content-Disposition` con `filename=` sin codificación RFC 5987:

```javascript
// LÍNEA 1834 y 2280
res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
```

El nombre del fichero es generado internamente (formato `facturas_2024-01-15.xlsx`) así que no hay riesgo de inyección de headers. Sin embargo, es inconsistente con los endpoints de imagen (línea 1721) que sí usan `filename*=UTF-8''${encodeURIComponent()}`.

**Parche (cosmético):**
```diff
-res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
+res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
```

---

## MATRIZ DE PRIORIDADES

| ID | Severidad | Descripción | Esfuerzo | Impacto |
|----|-----------|-------------|----------|---------|
| SEC-001 | Crítica | Redis password en docker-compose.yml command | Bajo (1h) | Muy Alto |
| SEC-002 | Crítica | Register JWT sin token_version ni is_admin | Bajo (30min) | Muy Alto |
| SEC-003 | Alta | Emails rotos por check process.env.SMTP_USER | Bajo (30min) | Muy Alto |
| SEC-004 | Alta | authenticateToken fail-open en error de BD | Bajo (20min) | Alto |
| SEC-005 | Alta | Magic bytes validation error → bypass silencioso | Bajo (20min) | Alto |
| SEC-006 | Alta | company_catalog global auto-learn → contaminación cross-tenant | Medio (2h) | Alto |
| SEC-007 | Media | KEYS en lugar de SCAN en security/blocked | Bajo (30min) | Medio |
| SEC-008 | Media | requireXHR ausente en ocr-engine y retry-failed | Bajo (15min) | Bajo |
| SEC-009 | Media | file_path expuesto en /api/mis-facturas | Bajo (10min) | Medio |
| SEC-010 | Media | normalizeDate acepta fechas de calendario inválidas | Bajo (30min) | Medio |
| SEC-011 | Media | UPDATE admin con nombres de columna en texto plano | Bajo (20min) | Bajo |
| SEC-012 | Media | isRestrictedHour lockout si start=end | Bajo (30min) | Alto (DoS) |
| SEC-013 | Media | Falta paginación en historial admin | Medio (2h) | Medio |
| SEC-014 | Media | Sin rate limit en /api/vies/:nif | Bajo (20min) | Medio |
| SEC-015 | Media | LIMIT inconsistente admin listado vs export | Bajo (1h) | Bajo |
| SEC-016 | Baja | ipInRange no maneja IPv6 con CIDR | Medio (2h) | Bajo |
| SEC-017 | Baja | SELECT * en login | Bajo (15min) | Bajo |
| SEC-018 | Baja | Redis password en healthcheck command | Bajo (20min) | Bajo |
| SEC-019 | Baja | ADMIN_EMAILS hardcoded (pendiente de eliminar) | Bajo (1h) | Bajo |
| SEC-020 | Baja | Content-Disposition sin RFC 5987 en exports | Bajo (15min) | Mínimo |

---

## PLAN DE ACCIÓN RECOMENDADO

### Sprint inmediato (esta semana)
1. **SEC-002** — Añadir token_version e is_admin al JWT de registro (30 min, CRÍTICO)
2. **SEC-003** — Corregir guardias de email SMTP (30 min, CRÍTICO funcional)
3. **SEC-004** — Cambiar fail-open a fail-secure en authenticateToken (20 min)
4. **SEC-005** — Rechazar archivo cuando magic bytes lanza excepción (20 min)
5. **SEC-007** — Reemplazar KEYS por SCAN en security/blocked (30 min)
6. **SEC-008** — Añadir requireXHR a ocr-engine y retry-failed (15 min)
7. **SEC-009** — Eliminar file_path de /api/mis-facturas (10 min)
8. **SEC-012** — Guardia start=end en isRestrictedHour (30 min)

**Total sprint inmediato: ~3.5 horas**

### Sprint siguiente (próxima semana)
9. **SEC-001** — Redis password a config file (require rebuild de compose)
10. **SEC-006** — Eliminar auto-learn global de company_catalog
11. **SEC-010** — Validación calendario en normalizeDate
12. **SEC-014** — Rate limit en /api/vies/:nif
13. **SEC-019** — Eliminar ADMIN_EMAILS una vez ambos admins hayan hecho login

### Backlog (cuando haya tiempo)
14. SEC-013 — Paginación en historial admin
15. SEC-015 — LIMIT consistente en admin
16. SEC-016 — IPv6 en ipInRange
17. SEC-017 — SELECT específico en login
18. SEC-018 — Redis password en healthcheck (resuelto por SEC-001)
19. SEC-020 — RFC 5987 en Content-Disposition exports

---

## QUÉ ESTÁ BIEN (No tocar)

- ✅ Helmet con CSP estricta, HSTS 2 años, X-Frame-Options DENY
- ✅ Parametrización SQL en todos los endpoints (sin SQLi)
- ✅ Magic bytes validation para MIME spoofing (correcto, ver SEC-005 para el catch)
- ✅ bcrypt factor 12 en passwords
- ✅ crypto.randomBytes(32) para reset tokens (no Math.random)
- ✅ SHA-256 de tokens antes de guardar en BD
- ✅ Respuesta genérica en forgot-password (no revela si el email existe)
- ✅ Unique constraint en BD para duplicados (no solo en código)
- ✅ auditLog en todas las operaciones sensibles
- ✅ CORS restringido a xanflatest.com
- ✅ Red Docker interna para postgres/redis (aislados de n8n_default)
- ✅ SMTP en Docker secrets (/run/secrets/)
- ✅ JWT secret en Docker secrets
- ✅ token_version en BD para revocación de sesiones tras reset de contraseña
- ✅ is_admin en BD (no solo en JWT)
- ✅ SCAN en lugar de KEYS en system-health
- ✅ Validación CIF/NIF con dígito de control + lista negra de alucinaciones
- ✅ Detección de duplicados con normalización numérica correcta
- ✅ Path traversal protegido en /api/facturas/:id/imagen (línea 1719-1720)
- ✅ HTML escaping en emails (escapeHtml)
- ✅ Rotación de logs Winston + límites Docker json-file
- ✅ fail2ban con SSH hardening
- ✅ Redis password (aunque necesita mejora per SEC-001)

---

*Documento generado: 2026-04-09 · Revisión quirúrgica línea a línea del código en producción*
