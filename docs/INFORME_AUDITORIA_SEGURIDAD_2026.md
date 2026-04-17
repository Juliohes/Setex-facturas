# INFORME DE AUDITORÍA DE SEGURIDAD — SETEX CAPTURA FACTURAS
## Auditoría Autorizada, Exhaustiva y Defensiva
**Clasificación:** CONFIDENCIAL — Uso interno exclusivo  
**Fecha:** 2026-04-09  
**Scope:** Sistema completo en producción (xanflatest.com)  
**Metodología:** Revisión de código fuente, análisis de configuración, modelado de amenazas (STRIDE), OWASP Top 10 + extras  
**Auditores:** Claude Code — actuando como Principal Security Engineer + Lead DevSecOps Auditor + Senior Application Security Architect  

---

## A. RESUMEN EJECUTIVO

El sistema SETEX Captura Facturas es una aplicación SaaS en producción con un stack moderno (Node.js, PostgreSQL, Redis, Docker, Traefik) que captura, procesa mediante OCR y almacena facturas digitales. La auditoría reveló **23 hallazgos** distribuidos en 4 niveles de severidad.

**No se encontraron vulnerabilidades de inyección activa** (SQL injection, XSS directo, command injection). La aplicación usa consultas parametrizadas, validación de inputs y CSP estricta. Sin embargo, existen problemas estructurales de diseño de seguridad que, en cadena, podrían comprometer completamente la plataforma.

### Distribución de hallazgos

| Severidad | Cantidad | Descripción breve |
|:---:|:---:|:---|
| 🔴 CRÍTICO | 3 | Reset token en logs, Redis sin auth, JWT en localStorage |
| 🟠 ALTO | 6 | OAuth tokens sin cifrar, SMTP en env vars, red compartida n8n, admin hardcoded, trust proxy, VIES público |
| 🟡 MEDIO | 9 | CSRF incompleto, SSRF interno, exports sin límite, file_path expuesto, KEYS en Redis, sin MFA, preview size, allowed_emails obsoleto, auto-block bypass |
| 🟢 BAJO | 5 | X-Powered-By, error messages, normalizeDate, session no revocable, audit_log sin IP forward |

### Postura general de seguridad: **MODERADA** ⚠️

El sistema tiene una buena base: CSP estricta, magic bytes validation, bcrypt rounds=12, rate limiting multicapa, audit_logs, validación anti-alucinación de CIFs, path traversal prevention. Las brechas detectadas son principalmente de arquitectura de secretos y configuración de infraestructura, no de lógica de aplicación.

**Riesgo más urgente:** Un atacante con acceso a la red Docker interna (p.ej. comprometiendo n8n) puede leer tokens OAuth de Google Drive y preview data con NIFs y totales de facturas directamente de Redis sin contraseña.

---

## B. INFORME TÉCNICO COMPLETO

---

### B.1 ARQUITECTURA Y SUPERFICIE DE ATAQUE

**Stack:**
```
Internet → Traefik (HTTPS) → nginx (frontend, :80) → backend (Express, :3000)
                                                    → setex-postgres (:5432)
                                                    → setex-redis (:6379)
```

**Red Docker:** Todos los servicios comparten `n8n_default`, la misma red que aloja n8n y Traefik. Esto significa que n8n (que ejecuta workflows configurables por usuario) puede acceder directamente a Redis y, si PostgreSQL está accesible en esa red, también a la base de datos.

**Superficie de ataque identificada:**
- 18 endpoints HTTP documentados (11 autenticados, 4 admin, 3 públicos)
- 1 endpoint interno nginx (`/api/internal/check-access`)
- Redis en puerto 6379 sin autenticación en red compartida
- PostgreSQL expuesto en red interna (pendiente verificar si publica puerto)
- `extra_hosts: host.docker.internal:host-gateway` → backend puede alcanzar el host físico

---

### B.2 AUTENTICACIÓN Y GESTIÓN DE SESIONES

#### HAL-001 🔴 CRÍTICO — JWT almacenado en localStorage

**Evidencia:** `app/frontend/src/app.js` — el token JWT se guarda en `localStorage` y `sessionStorage` tras el login.

**Riesgo técnico:** Si un atacante consigue ejecutar JavaScript en el contexto de la página (XSS, extensión maliciosa, ataque de cadena de suministro a dependencias), puede extraer el JWT de `localStorage` y usarlo indefinidamente hasta su expiración (1-30 días). `localStorage` es accesible por cualquier script del mismo origen.

**Impacto de negocio:** Sesión completa robada → acceso a facturas de la empresa, posibilidad de subir facturas falsas.

**Mitigación:** Migrar a `httpOnly` cookies con `SameSite=Strict` o `Lax`. El JWT no es accesible por JavaScript con esta configuración. Requiere cambios en frontend y backend (middleware de cookie en Express).

**Esfuerzo:** Medio (3-4 horas, cambio en 3 ficheros: server.js, app.js, nginx.conf)

---

#### HAL-002 🟠 ALTO — Sin revocación de sesiones activas

**Evidencia:** No existe endpoint `/api/auth/logout` ni tabla de tokens invalidados. Al cambiar contraseña, se invalidan reset tokens pero NO las sesiones JWT activas existentes.

**Riesgo:** Si un usuario cambia contraseña por sospecha de robo, las sesiones abiertas (30 días) siguen válidas.

**Mitigación:** Añadir columna `token_version` (integer) en tabla `users`. Incluir `token_version` en el payload JWT. En `authenticateToken`, verificar que `token.token_version === user.token_version`. Al cambiar contraseña, incrementar `token_version` → todos los JWT anteriores fallan automáticamente.

**Esfuerzo:** Bajo (2 horas)

---

#### HAL-003 🟠 ALTO — ADMIN_EMAILS hardcoded en código fuente

**Evidencia:** `server.js:487` — `const ADMIN_EMAILS = ['juliohesuni@gmail.com', 'albertomurimarti@gmail.com'];`

**Riesgo:** 
1. Los emails de administrador están en el código fuente → cualquiera con acceso al repo los conoce
2. Cambiar un admin requiere rebuild + redeploy (no operativo en caliente)
3. Si un atacante registra esos emails (si no están registrados aún), o los reutiliza en un ataque de ingeniería social, puede entender la estructura de acceso

**Mitigación:** Añadir columna `is_admin BOOLEAN DEFAULT false` en tabla `users`. Usar `requireAdmin` basado en BD. Migración simple: `UPDATE users SET is_admin = true WHERE email IN ('juliohesuni@gmail.com', 'albertomurimarti@gmail.com')`.

**Esfuerzo:** Bajo (1-2 horas)

---

#### HAL-004 🟡 MEDIO — Sin autenticación multifactor (MFA)

**Evidencia:** No existe MFA para ningún rol, incluido administrador.

**Riesgo:** Un admin con contraseña comprometida → control total de la plataforma (cambio de motor OCR, acceso a todas las facturas de todos los clientes, aprobación de empresas).

**Mitigación:** Implementar TOTP (Google Authenticator) para cuentas admin usando `speakeasy` npm package. Solo requerido para `ADMIN_EMAILS` (o el futuro `is_admin = true`). Bajo impacto en UX para usuarios normales.

**Esfuerzo:** Medio (4-6 horas)

---

### B.3 SECRETOS Y CONFIGURACIÓN

#### HAL-005 🔴 CRÍTICO — Token de reset de contraseña expuesto en logs

**Evidencia:** `server.js:780-782`:
```javascript
} else {
  logger.warn(`Password reset requested but email not configured. Token: ${resetToken}`);
  logger.info(`Reset URL (email not configured): ${resetUrl}`);
}
```

**Riesgo:** Cuando SMTP no está configurado (o falla), el token de reset **en claro** (64 caracteres hex, equivalente a la contraseña temporal) se escribe en los logs de aplicación. Cualquier persona con acceso a `docker logs setex-backend` puede tomar control de cualquier cuenta con una simple petición a `/api/auth/forgot-password`.

**Impacto:** CRÍTICO. Compromiso de cualquier cuenta de usuario, incluidos administradores.

**Mitigación inmediata:** Eliminar AMBAS líneas `logger.warn/info` que exponen el token. Si se necesita debug, loguear solo el hash SHA-256 del token (`tokenHash`), nunca el token en claro.

```javascript
// SEGURO — loguear solo el hash, nunca el token
logger.warn(`Password reset requested but email not configured. Token hash: ${tokenHash.substring(0,16)}...`);
```

**Esfuerzo:** Trivial (2 minutos) — ACCIÓN INMEDIATA REQUERIDA

---

#### HAL-006 🟠 ALTO — Credenciales SMTP en variables de entorno (no Docker secrets)

**Evidencia:** `docker-compose.yml`:
```yaml
environment:
  SMTP_USER: xanfla95@gmail.com
  SMTP_PASS: ${SMTP_PASS}
```

**Riesgo:** `SMTP_PASS` viene de `.env` (texto plano en disco) y se inyecta como variable de entorno. Las variables de entorno son accesibles a cualquier proceso en el contenedor (`/proc/1/environ`), visibles en `docker inspect`, y logueadas por muchos sistemas de orquestación. Los Docker secrets (`/run/secrets/`) son más seguros: montados en tmpfs, no expuestos en `docker inspect`.

**Mitigación:** Migrar `SMTP_USER` y `SMTP_PASS` a Docker secrets, igual que `jwt_secret` y `openai_api_key`. Crear archivos en `/opt/setex-captu-facture/secrets/smtp_user` y `smtp_pass`. Actualizar `docker-compose.yml` y leer en `server.js` con `readSecret('smtp_user')`.

**Esfuerzo:** Bajo (1 hora)

---

#### HAL-007 🟠 ALTO — OAuth tokens de Google almacenados sin cifrar en PostgreSQL

**Evidencia:** Tabla `google_tokens` en PostgreSQL almacena `access_token` y `refresh_token` en texto plano.

**Riesgo:** Si la base de datos es comprometida (dump, acceso directo a `setex-postgres`), los tokens OAuth de Google Drive dan acceso completo a la carpeta de Drive donde se almacenan facturas de todos los clientes.

**Mitigación:** Cifrar los tokens antes de guardarlos con AES-256-GCM usando el `jwt_secret` como KDF (HKDF). Descifrar al leer. Alternativamente, si solo se usan Service Account keys (no OAuth user tokens), la tabla `google_tokens` puede quedar vacía/obsoleta.

**Esfuerzo:** Medio (3-4 horas)

---

### B.4 REDIS — BASE DE DATOS TEMPORAL

#### HAL-008 🔴 CRÍTICO — Redis sin autenticación en red compartida con n8n

**Evidencia:** `docker-compose.yml` — `redis://redis:6379` sin `requirepass`. La red `n8n_default` incluye n8n y Traefik.

**Riesgo:** Cualquier proceso en la misma red Docker puede:
1. **Leer previews OCR**: `KEYS preview:*` → datos de facturas en proceso (NIF, totales, nombres de empresa)
2. **Manipular auto-block**: `DEL sec:block:X.X.X.X` → eliminar bloqueos de IPs
3. **Leer/escribir contadores de seguridad**: `sec:count:*` → bypass de rate limiting
4. **Leer BullMQ queue**: jobs pendientes con datos de facturas
5. **Inyectar jobs maliciosos**: si BullMQ está activo, añadir jobs con payloads falsos

n8n ejecuta workflows con acceso HTTP configurable — un workflow malicioso o comprometido puede conectarse a Redis directamente.

**Mitigación inmediata:**
```yaml
# docker-compose.yml
redis:
  command: redis-server --requirepass ${REDIS_PASSWORD}

# backend:
environment:
  REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
```

**Esfuerzo:** Bajo (30 minutos) — ACCIÓN URGENTE

---

#### HAL-009 🟡 MEDIO — Uso de KEYS en Redis (bloqueo en producción)

**Evidencia:** `server.js:1973, 1980`:
```javascript
const keys = await redisClient.keys('preview:*');
const keys = await redisClient.keys('sec:block:*');
```

**Riesgo:** El comando `KEYS` en Redis es O(N) y **bloquea el event loop de Redis** mientras escanea todas las keys. Con muchos previews activos o IPs bloqueadas, esto puede causar latencia elevada o timeouts en todos los demás comandos Redis (incluyendo BullMQ).

**Mitigación:** Reemplazar con `SCAN` iterativo:
```javascript
async function redisCount(pattern) {
  let count = 0, cursor = '0';
  do {
    const [next, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = next; count += keys.length;
  } while (cursor !== '0');
  return count;
}
```

**Esfuerzo:** Bajo (30 minutos)

---

#### HAL-010 🟡 MEDIO — Preview data en Redis sin límite de tamaño

**Evidencia:** `server.js:1266` — `redisClient.setex(`preview:${previewId}`, 1800, JSON.stringify(previewData))`. El objeto `previewData` incluye `ocr_dual_full` con resultados completos de dos motores OCR (potencialmente 20-50KB por preview).

**Riesgo:** Un usuario malicioso puede subir 30 imágenes en 15 minutos (límite de rate), generando previews de ~50KB cada uno → 1.5MB en Redis. Multiplicado por varios usuarios concurrentes, esto puede agotar la RAM de Redis (configurada sin `maxmemory` explícito).

**Mitigación:** Establecer `maxmemory` en Redis con política `allkeys-lru`. Reducir el tamaño del preview eliminando `ocr_dual_full` del objeto Redis y guardándolo solo en PostgreSQL tras confirmación.

**Esfuerzo:** Bajo (1 hora)

---

### B.5 INFRAESTRUCTURA DOCKER Y RED

#### HAL-011 🟠 ALTO — Red compartida con n8n: superficie de movimiento lateral

**Evidencia:** `docker-compose.yml`:
```yaml
networks:
  default:
    name: n8n_default
    external: true
```

**Riesgo STRIDE (Lateral Movement):** Todos los contenedores SETEX (backend, postgres, redis, frontend) están en la misma red que n8n y Traefik. Un atacante que comprometa n8n puede:
- Conectarse a Redis directamente (sin auth — HAL-008)
- Intentar conexiones a `setex-postgres:5432`
- Hacer peticiones al backend en `setex-backend:3000` sin pasar por Traefik ni nginx
- Bypass del control horario (time-based 404 blocking) accediendo directamente al backend

**Mitigación:** Crear una red interna dedicada `setex_internal` para la comunicación entre servicios SETEX. Solo el contenedor `setex-frontend` (que actúa de proxy) necesita estar en `n8n_default` para que Traefik lo alcance.

```yaml
networks:
  setex_internal:
    driver: bridge
    internal: true  # No tiene acceso a internet ni a otras redes
  n8n_default:
    external: true

services:
  backend:
    networks: [setex_internal]  # Solo internal
  postgres:
    networks: [setex_internal]  # Solo internal
  redis:
    networks: [setex_internal]  # Solo internal
  frontend:
    networks: [setex_internal, n8n_default]  # Bridge hacia Traefik
```

**Esfuerzo:** Medio (2-3 horas, requiere testing post-cambio)

---

#### HAL-012 🟡 MEDIO — `extra_hosts: host.docker.internal` — SSRF interno

**Evidencia:** `docker-compose.yml` — el backend tiene acceso a `host.docker.internal` que resuelve a la IP del host físico.

**Riesgo (SSRF):** Si algún endpoint del backend acepta una URL del usuario y hace una petición HTTP interna (actualmente no encontrado, pero la capacidad existe), podría alcanzar servicios del host físico (localhost del VPS: paneles de administración, SSH, otros servicios en puertos no publicados).

**Mitigación:** Eliminar `extra_hosts` a menos que exista una necesidad funcional documentada. Verificar si algún worker o función del backend necesita `host.docker.internal` — si no, eliminarlo.

**Esfuerzo:** Trivial (5 minutos)

---

#### HAL-013 🟠 ALTO — `trust proxy: 1` sin segmentación de red verificada

**Evidencia:** `server.js` — `app.set('trust proxy', 1)`. La IPs de los clientes se extraen de `X-Forwarded-For`.

**Riesgo:** Con `trust proxy: 1`, Express confía en el primer proxy de la cadena para proporcionar la IP real del cliente. Si un atacante puede inyectar una cabecera `X-Forwarded-For` antes de Traefik (p.ej. desde la red interna), puede spoofear su IP y bypassar el rate limiting por IP, el auto-block y el sistema de whitelist/blacklist.

**Verificación necesaria:** Confirmar que Traefik siempre sobreescribe `X-Forwarded-For` (no lo añade). Si Traefik añade la IP real al final pero no elimina la cabecera original, puede haber spoofing.

**Mitigación:** Usar `trust proxy` con la IP específica de Traefik en lugar de `1`:
```javascript
app.set('trust proxy', 'uniquelocal');  // o la IP del contenedor Traefik
```

**Esfuerzo:** Bajo (1 hora, requiere prueba)

---

### B.6 SEGURIDAD DE APLICACIÓN

#### HAL-014 🟡 MEDIO — CSRF mitigation incompleta

**Evidencia:** `server.js:1894-1901` — `requireXHR` middleware verifica `X-Requested-With: XMLHttpRequest`. Se aplica en endpoints de estado (POST/PUT/DELETE) pero **no está aplicado en todos los endpoints críticos**.

**Análisis:** La mitigación `requireXHR` es una defensa válida como segunda capa, pero no es un CSRF token real. Browsers modernos con CORS permiten que ciertos tipos de peticiones (`application/json`) sean bloqueadas por CORS, pero con JWT en Authorization header el riesgo CSRF ya está mitigado por CORS en la mayoría de casos.

**Riesgo real:** Bajo-Medio — el header `Authorization: Bearer <token>` no puede ser enviado automáticamente por un sitio malicioso en un CSRF clásico. Sin embargo, si se migra a cookies (HAL-001), el riesgo CSRF escala a CRÍTICO sin protección adicional.

**Mitigación:** Si se implementa HAL-001 (cookies httpOnly), añadir también `csrf-csrf` middleware con Double Submit Cookie pattern. Por ahora, verificar que `requireXHR` se aplica en todos los endpoints POST/PUT/DELETE admin.

**Esfuerzo:** Bajo (si ya hay cookies: 2-3 horas para csrf-csrf)

---

#### HAL-015 🟡 MEDIO — `file_path` interno expuesto en respuestas de API admin

**Evidencia:** `server.js:2046` — la columna `file_path` se incluye en la respuesta de `GET /api/admin/facturas`:
```sql
SELECT ... u.file_path FROM uploads u ...
```

**Riesgo:** La respuesta expone rutas del sistema de archivos interno como `/app/uploads/usuario/B12345678/archivo.jpg`. Un administrador comprometido (o una sesión admin secuestrada) obtiene información precisa del layout del sistema de archivos para planificar ataques de path traversal u otros vectores.

**Mitigación:** Eliminar `file_path` de la respuesta de la API. Si el admin necesita descargar la imagen, usar el endpoint dedicado `/api/admin/facturas/:id/imagen` que ya tiene validación de path traversal.

**Esfuerzo:** Trivial (10 minutos)

---

#### HAL-016 🟡 MEDIO — Endpoint VIES público sin autenticación

**Evidencia:** `server.js:1863-1876`:
```javascript
app.get('/api/vies/:nif', async (req, res) => {  // SIN authenticateToken
```

**Riesgo:** Cualquier persona sin cuenta puede usar `/api/vies/B12345678` para verificar CIFs españoles en el sistema VIES de la UE. Esto:
1. Expone la capacidad de hacer reconocimiento de empresas
2. Genera tráfico hacia la API VIES (posible rate limiting externo)
3. Permite fuzzing de CIFs para identificar empresas registradas en VIES

**Mitigación:** Añadir `authenticateToken` al endpoint. Los usuarios legítimos ya tienen token cuando usan el sistema.

**Esfuerzo:** Trivial (1 línea)

---

#### HAL-017 🟡 MEDIO — Export XLSX sin paginación ni límite de filas

**Evidencia:** `server.js:1682` — `GET /api/mis-facturas/export.xlsx` recupera TODAS las facturas del usuario sin límite. `server.js:2086` — `GET /api/admin/facturas/export.xlsx` similar.

**Riesgo:** Un usuario con miles de facturas puede generar exportaciones que agoten la memoria del proceso Node.js (generación de Excel en memoria con ExcelJS). DoS suave: `x10` usuarios exportando simultáneamente con datasets grandes.

**Mitigación:** Añadir `LIMIT 10000` a la consulta de exportación. Para datasets mayores, implementar exportación asíncrona (genera fichero, notifica por email) usando BullMQ.

**Esfuerzo:** Bajo (30 minutos para añadir LIMIT)

---

#### HAL-018 🟡 BAJO — `X-Powered-By: Express` expone tecnología del servidor

**Evidencia:** Helmet no desactiva `X-Powered-By` explícitamente, y aunque Helmet por defecto sí lo hace si se usa `helmet()` completo, verificar que el header no aparece en las respuestas.

**Verificación:**
```bash
curl -I https://xanflatest.com/api/health | grep -i powered
```

**Mitigación:** Verificar que está desactivado. Si no: `app.disable('x-powered-by')` antes de los middlewares.

**Esfuerzo:** Trivial

---

#### HAL-019 🟡 MEDIO — `allowed_emails` tabla obsoleta sin documentación

**Evidencia:** La tabla `allowed_emails` existe en el schema pero ningún endpoint del backend la consulta. Fue reemplazada por `client_companies`.

**Riesgo:** Confusión operacional. Un operador puede añadir emails a `allowed_emails` pensando que dará acceso, cuando en realidad el sistema ya no la consulta.

**Mitigación:** Eliminar la tabla con una migración, o documentar explícitamente en el schema que está obsoleta con un comentario SQL `-- OBSOLETA: no usada desde 2026-03-XX`.

**Esfuerzo:** Trivial

---

#### HAL-020 🟢 BAJO — `normalizeDate` regex acepta fechas ambiguas

**Evidencia:** `server.js:1413`:
```javascript
const m = String(d).trim().match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
```

**Riesgo:** Para `03/04/2026`, el regex acepta tanto DD/MM/YYYY como MM/DD/YYYY, dependiendo del motor OCR. No hay validación de rangos de día/mes. Una fecha `32/13/2026` pasaría el regex y se almacenaría.

**Mitigación:** Añadir validación de rangos: día 1-31, mes 1-12. Dado que el sistema opera en España, asumir siempre DD/MM/YYYY y validarlo explícitamente.

**Esfuerzo:** Bajo (30 minutos)

---

### B.7 SEGURIDAD DE ARCHIVOS Y OCR

#### HAL-021 🟢 BAJO — Falta validación de `Content-Disposition` en descarga de imágenes

**Evidencia:** `server.js:1648-1649`:
```javascript
res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
```

**Riesgo:** Si `filename` contiene caracteres especiales (comillas, punto y coma), el header `Content-Disposition` puede malformarse. Aunque el nombre de archivo se genera internamente (no del user input), un edge case podría causar comportamiento inesperado.

**Mitigación:** Usar `encodeURIComponent(filename)` en el parámetro `filename*` del header:
```javascript
res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
```

**Esfuerzo:** Trivial

---

#### HAL-022 🟡 MEDIO — Auto-block bypass potencial vía IPs de la red interna

**Evidencia:** `server.js:330-333` — el auto-block y rate limiting se saltan para IPs en la whitelist. La red interna Docker (172.x.x.x) no está explícitamente en la whitelist, pero `trust proxy: 1` podría causar confusión sobre qué IP se usa para conteo.

**Riesgo:** Si `req.ip` resuelve a una IP interna de Docker (p.ej. la IP del nginx container) debido a una configuración incorrecta de `trust proxy`, todos los requests del nginx container compartirían el mismo contador de rate limit, potencialmente bloqueando el servicio para todos los usuarios.

**Mitigación:** Verificar con `docker logs setex-backend | grep "X-Real-IP"` que las IPs registradas son IPs reales de clientes, no IPs de Docker.

---

#### HAL-023 🟢 BAJO — Audit log sin `req.ip` normalizada para IPv6

**Evidencia:** `server.js:306` — `const ip = (req.ip || '').replace(/^::ffff:/, '')`. Esta normalización se aplica en los middlewares de seguridad pero NO en la función `auditLog`, que recibe `req.ip` directamente.

**Riesgo:** Los logs de auditoría pueden contener `::ffff:192.168.1.1` (IPv4 mapped to IPv6) en lugar de `192.168.1.1`, dificultando las búsquedas forenses.

**Mitigación:** Normalizar `req.ip` en la función `auditLog`:
```javascript
async function auditLog(action, details, userId, ip) {
  const cleanIp = (ip || '').replace(/^::ffff:/, '') || null;
  // ...
}
```

**Esfuerzo:** Trivial (5 minutos)

---

## C. MATRIZ DE RIESGOS

| ID | Hallazgo | Componente | Tipo (STRIDE) | Evidencia | Impacto Técnico | Impacto Negocio | Probabilidad | Severidad | Prioridad | Mitigación | Esfuerzo |
|:---|:---|:---|:---|:---|:---|:---|:---:|:---:|:---:|:---|:---:|
| HAL-001 | JWT en localStorage | Frontend (app.js) | Information Disclosure | localStorage accesible por JS | Sesión robada por XSS/extensión | Acceso a facturas de empresa | Media | 🔴 CRÍTICO | P1 | httpOnly cookies | Medio |
| HAL-002 | Sin revocación de sesiones | Backend auth | Elevation of Privilege | No hay logout endpoint | JWT activo post-cambio de pwd | Sesión persistente tras compromiso | Baja | 🟠 ALTO | P2 | token_version en JWT | Bajo |
| HAL-003 | ADMIN_EMAILS hardcoded | server.js:487 | Information Disclosure | Código fuente | Reconocimiento de admins | Ingeniería social dirigida | Media | 🟠 ALTO | P2 | is_admin en BD | Bajo |
| HAL-004 | Sin MFA | Auth system | Elevation of Privilege | No existe TOTP/OTP | Cuenta admin comprometida | Control total plataforma | Baja | 🟡 MEDIO | P3 | TOTP con speakeasy | Medio |
| HAL-005 | Reset token en logs | server.js:780 | Information Disclosure | logger.warn/info con token | Cualquier cuenta comprometible | CRÍTICO: acceso a todas las cuentas | Alta | 🔴 CRÍTICO | P0 | Eliminar log lines | Trivial |
| HAL-006 | SMTP en env vars | docker-compose.yml | Information Disclosure | environment: SMTP_PASS | Credenciales Gmail expuestas | Acceso al correo corporativo | Baja | 🟠 ALTO | P2 | Docker secrets | Bajo |
| HAL-007 | OAuth tokens sin cifrar | PostgreSQL google_tokens | Information Disclosure | Texto plano en BD | Acceso a Google Drive | Fuga de facturas de todos los clientes | Baja | 🟠 ALTO | P2 | AES-256-GCM | Medio |
| HAL-008 | Redis sin auth | docker-compose.yml | Spoofing/Tampering | redis://redis:6379 | Leer/manipular todos los datos Redis | Bypass rate limiting, leer facturas en proceso | Alta | 🔴 CRÍTICO | P0 | requirepass | Trivial |
| HAL-009 | KEYS en Redis | server.js:1973,1980 | Denial of Service | keys('preview:*') | Bloqueo Redis bajo carga | Indisponibilidad plataforma | Media | 🟡 MEDIO | P3 | SCAN iterativo | Bajo |
| HAL-010 | Preview data grande | server.js:1266 | Denial of Service | JSON completo en Redis | RAM Redis agotada | Caída del servicio | Baja | 🟡 MEDIO | P3 | maxmemory + reducir payload | Bajo |
| HAL-011 | Red compartida n8n | docker-compose.yml | Lateral Movement | n8n_default network | Acceso Redis/PG desde n8n | Fuga masiva de datos | Media | 🟠 ALTO | P1 | Red interna dedicada | Medio |
| HAL-012 | extra_hosts SSRF | docker-compose.yml | Server-Side Request Forgery | host.docker.internal | Acceso a servicios del host | Compromiso del host físico | Baja | 🟡 MEDIO | P2 | Eliminar extra_hosts | Trivial |
| HAL-013 | trust proxy IP spoof | server.js | Spoofing | X-Forwarded-For | Bypass rate limit/blacklist | Ataques de fuerza bruta sin límite | Baja | 🟠 ALTO | P2 | trust proxy específico | Bajo |
| HAL-014 | CSRF incompleto | server.js requireXHR | Cross-Site Request Forgery | Sin CSRF tokens | Bajo riesgo actual (JWT) | Crítico si se migra a cookies | Baja | 🟡 MEDIO | P3 | csrf-csrf tras cookies | Bajo |
| HAL-015 | file_path en respuesta API | server.js:2046 | Information Disclosure | SELECT file_path | Layout sistema de archivos | Reconocimiento pre-ataque | Baja | 🟡 MEDIO | P2 | Eliminar del SELECT | Trivial |
| HAL-016 | VIES endpoint público | server.js:1863 | Information Disclosure | Sin authenticateToken | Reconocimiento de empresas | Uso indebido de la API | Media | 🟡 MEDIO | P2 | Añadir authenticateToken | Trivial |
| HAL-017 | Export sin límite | server.js:1682,2086 | Denial of Service | Sin LIMIT en SELECT | OOM Node.js bajo carga | Indisponibilidad plataforma | Baja | 🟡 MEDIO | P3 | LIMIT 10000 | Trivial |
| HAL-018 | X-Powered-By Express | Express config | Information Disclosure | Header HTTP | Stack fingerprinting | Ataques dirigidos a CVEs Express | Media | 🟢 BAJO | P4 | app.disable | Trivial |
| HAL-019 | allowed_emails obsoleta | PostgreSQL | Confusion/Tampering | Tabla sin uso | Error operacional | Accesos incorrectamente concedidos | Baja | 🟡 MEDIO | P3 | DROP TABLE o comentar | Trivial |
| HAL-020 | normalizeDate regex | server.js:1413 | Tampering | Regex sin validación rango | Fechas inválidas en BD | Errores contables | Baja | 🟢 BAJO | P4 | Validar día/mes rango | Bajo |
| HAL-021 | Content-Disposition filename | server.js:1648 | Tampering | Header sin encode | Malformación de header | Menor | Baja | 🟢 BAJO | P4 | encodeURIComponent | Trivial |
| HAL-022 | Auto-block bypass IPs internas | server.js middleware | Spoofing | trust proxy + IPs Docker | Rate limit incorrecto | Bloqueo falso positivo | Baja | 🟡 MEDIO | P3 | Verificar y documentar | Bajo |
| HAL-023 | audit_log IPv6 no normalizada | server.js:490 | Information Disclosure | req.ip sin normalizar | Logs con formato inconsistente | Dificultad forense | Baja | 🟢 BAJO | P4 | Normalizar en auditLog() | Trivial |

---

## D. MATRIZ DE ROLES Y PERMISOS

### Roles del sistema

| Rol | Identificación | Acceso concedido | Acceso denegado |
|:---|:---|:---|:---|
| **Admin** | Email en `ADMIN_EMAILS` | Todas las facturas, gestión empresas, OCR engine, system health, retry failed, usuarios | — (acceso total) |
| **Usuario activo** | JWT válido + empresa `activa=true` | Subir facturas, ver sus propias facturas, exportar sus facturas, perfil propio | Facturas de otros usuarios, panel admin, configuración global |
| **Usuario pendiente** | JWT válido (primer registro) + empresa `pendiente=true, activa=false` | Solo su primer JWT (login siguiente bloqueado) | Subir facturas en sesión siguiente |
| **Anónimo** | Sin JWT | `/health`, `/api/vies/:nif` ⚠️ | Todo lo demás |

### Análisis de privilegios

**Escalada vertical identificada:** No hay camino de escalada de usuario normal a admin. El único vector es comprometer una de las dos cuentas admin (HAL-001, HAL-005).

**Segregación horizontal:** Correcta. `WHERE user_id = $1` en todos los endpoints de usuario. El admin puede ver datos de todos los usuarios por diseño (esperado).

**Privilegios admin excesivos:** El admin tiene acceso a `file_path` interno (HAL-015) y puede descargar cualquier imagen de factura. Esto es probablemente intencional pero no documentado como requisito de negocio.

---

## E. MATRIZ DE FLUJOS CRÍTICOS

### Flujo 1: Subida y procesamiento de factura

```
Usuario → POST /api/upload-preview
    ├─ authenticateToken ✅
    ├─ uploadLimiter (30/15min) ✅
    ├─ multer (10MB, MIME whitelist) ✅
    ├─ validateFileMagicBytes ✅ (anti MIME spoofing)
    ├─ OCR (OpenAI/Azure/dual) → datos extraídos
    ├─ validateSpanishTaxId (anti-alucinación) ✅
    ├─ Redis setex preview:UUID (1800s) ← SIN AUTH ⚠️ HAL-008
    └─ Response → preview_id al frontend

Usuario → POST /api/upload-confirm
    ├─ authenticateToken ✅
    ├─ confirmLimiter (60/15min) ✅
    ├─ Redis get preview:UUID → verificar preview.userInfo.userId === req.user.userId ✅
    ├─ validateSpanishTaxId (confirmación final) ✅
    ├─ dupCheck (unique constraint) ✅
    ├─ INSERT uploads (parameterized) ✅
    └─ auditLog ✅
```

**Vectores de riesgo en este flujo:**
- Preview data accesible desde Redis sin auth (HAL-008)
- OCR dual puede incluir datos sensibles en respuesta JSON (limitado a campos de factura)

---

### Flujo 2: Autenticación y sesión

```
POST /api/auth/login
    ├─ authLimiter (10/15min) ✅
    ├─ isValidEmail ✅
    ├─ SELECT users WHERE email = $1 (parameterized) ✅
    ├─ bcrypt.compare (rounds=12) ✅
    ├─ client_companies check (activa/pendiente) ✅
    ├─ JWT sign (1d/30d) → localStorage ⚠️ HAL-001
    └─ auditLog ✅

POST /api/auth/forgot-password
    ├─ authLimiter ✅
    ├─ token = randomBytes(32) ✅
    ├─ stored: SHA-256(token) ✅
    ├─ expiry: 1 hora ✅
    ├─ SMTP send ✅ (si configurado)
    └─ logger.info(resetUrl) 🔴 HAL-005 (si SMTP no configurado)
```

---

### Flujo 3: Acceso admin a datos

```
GET /api/admin/facturas
    ├─ authenticateToken ✅
    ├─ requireAdmin (ADMIN_EMAILS check) ⚠️ HAL-003
    ├─ Query parametrizada con filtros ✅
    ├─ computeDisplayCompanies ✅
    └─ file_path incluido en respuesta ⚠️ HAL-015
```

---

### Flujo 4: Control horario (time-based 404)

```
nginx: auth_request → /api/internal/check-access
    ├─ loadSecurityConfig() (security.json) ✅
    ├─ isRestrictedHour() → 403 si 00:00-06:00
    └─ nginx convierte 403 → @bloqueado → 404 personalizado ✅

BYPASS conocido: acceso directo al backend en puerto 3000
    ├─ Puerto 3000 NO publicado (docker-compose) ✅
    └─ Solo accesible desde red n8n_default ⚠️ HAL-011
```

---

## F. CHECKLIST OPERATIVA DE SEGURIDAD

### F.1 Acciones P0 (Hoy — antes de continuar operaciones)

- [ ] **HAL-005 FIX:** Eliminar `logger.warn` y `logger.info` con `resetToken`/`resetUrl` en `server.js:780-782`. Solo loguear el hash.
- [ ] **HAL-008 FIX:** Añadir `requirepass` a Redis + actualizar `REDIS_URL` en backend.
- [ ] Verificar que nadie ha hecho `GET /api/auth/forgot-password` con SMTP desactivado en producción. Revisar logs: `docker logs setex-backend | grep "Reset URL"`

### F.2 Acciones P1 (Esta semana)

- [ ] **HAL-011:** Crear red Docker `setex_internal` separada de `n8n_default`
- [ ] **HAL-001:** Planificar migración JWT → httpOnly cookies (no bloquea, pero planificar)
- [ ] Verificar `X-Powered-By` no aparece en respuestas: `curl -I https://xanflatest.com/api/health`
- [ ] Verificar `trust proxy` — revisar logs para confirmar IPs reales

### F.3 Acciones P2 (Próximas 2 semanas)

- [ ] **HAL-006:** Migrar SMTP_USER/SMTP_PASS a Docker secrets
- [ ] **HAL-003:** Migrar ADMIN_EMAILS a columna `is_admin` en BD
- [ ] **HAL-016:** Añadir `authenticateToken` a `/api/vies/:nif`
- [ ] **HAL-015:** Eliminar `file_path` de respuesta `/api/admin/facturas`
- [ ] **HAL-012:** Eliminar `extra_hosts: host.docker.internal` si no hay uso funcional documentado
- [ ] **HAL-002:** Implementar `token_version` para revocación de sesiones
- [ ] **HAL-007:** Evaluar si `google_tokens` está activa (Service Account vs OAuth). Si SA, vaciar tabla. Si OAuth, cifrar.

### F.4 Acciones P3 (Próximo mes)

- [ ] **HAL-017:** Añadir `LIMIT 10000` a exports XLSX
- [ ] **HAL-009:** Reemplazar `KEYS` con `SCAN` en health endpoint
- [ ] **HAL-019:** Eliminar tabla `allowed_emails` o documentarla como obsoleta
- [ ] **HAL-022:** Documentar y verificar comportamiento de IPs internas Docker
- [ ] **HAL-010:** Establecer `maxmemory` en Redis (`docker-compose.yml`: `command: redis-server --maxmemory 64mb --maxmemory-policy allkeys-lru`)

### F.5 Acciones P4 (Hardening continuo)

- [ ] **HAL-004:** Implementar TOTP para cuentas admin
- [ ] **HAL-001:** Completar migración a httpOnly cookies
- [ ] **HAL-014:** Tras migración a cookies, añadir `csrf-csrf` middleware
- [ ] **HAL-020:** Mejorar `normalizeDate` con validación de rangos
- [ ] **HAL-021:** Mejorar `Content-Disposition` con `filename*` RFC 5987
- [ ] **HAL-023:** Normalizar IPv6 en `auditLog()`

---

## G. BACKLOG DE HARDENING

### G.1 INMEDIATO (hoy, < 1 hora en total)

| Tarea | Fichero | Impacto |
|:---|:---|:---|
| Eliminar reset token de logs | `server.js:780-782` | 🔴 Elimina exposición de credenciales |
| Redis `requirepass` | `docker-compose.yml` | 🔴 Protege datos de sesión y rate limiting |
| Añadir `authenticateToken` a VIES | `server.js:1863` | 🟡 Elimina endpoint público |
| Eliminar `file_path` del SELECT admin facturas | `server.js:2046` | 🟡 Elimina info interna de rutas |

### G.2 CORTO PLAZO (esta semana, < 1 día en total)

| Tarea | Fichero(s) | Impacto |
|:---|:---|:---|
| Red Docker interna `setex_internal` | `docker-compose.yml` | 🟠 Aislamiento lateral |
| `is_admin` en BD (reemplaza hardcoded) | `server.js`, PostgreSQL | 🟠 Gestión segura de admins |
| Migrar SMTP a Docker secrets | `docker-compose.yml`, `server.js` | 🟠 Secretos seguros |
| `extra_hosts` eliminado | `docker-compose.yml` | 🟡 Elimina SSRF interno |
| `token_version` para revocación | `server.js`, `users` table | 🟠 Sesiones revocables |

### G.3 MEDIO PLAZO (próximas 2-3 semanas)

| Tarea | Fichero(s) | Impacto |
|:---|:---|:---|
| JWT → httpOnly cookies | `server.js`, `app.js` | 🔴 Elimina robo de sesión por XSS |
| Cifrar OAuth tokens | `server.js`, PostgreSQL | 🟠 Protege credenciales Google |
| CSRF tokens con csrf-csrf | `server.js` | 🟡 Protección CSRF real (tras cookies) |
| TOTP para admins | `server.js`, `app.js` | 🟡 MFA para rol crítico |
| Export XLSX con LIMIT | `server.js:1682,2086` | 🟡 Prevención DoS |
| KEYS → SCAN en Redis | `server.js:1973,1980` | 🟡 Estabilidad Redis bajo carga |

### G.4 ESTRUCTURAL (próximo trimestre)

| Tarea | Impacto | Decisión |
|:---|:---|:---|
| Separar red interna de n8n (definitivo) | Aislamiento completo del sistema | Alta prioridad si n8n crece |
| Gestión de secretos con Vault/Infisical | Rotación automática, auditía de acceso a secretos | Si escala a más servicios |
| WAF (ModSecurity o Cloudflare) delante de Traefik | Protección a nivel de red adicional | Si se detectan ataques activos |
| Vulnerability scanning automatizado en CI/CD | Detección continua | Si se implementa pipeline CI/CD |
| Penetration test externo | Verificación independiente | Anualmente o tras grandes cambios |

---

## PUNTUACIÓN FINAL DE SEGURIDAD

| Dominio | Puntuación | Notas |
|:---|:---:|:---|
| Autenticación y autorización | 6/10 | Buena base, faltan MFA y revocación |
| Gestión de secretos | 4/10 | Redis sin auth, reset token en logs son críticos |
| Infraestructura Docker | 5/10 | Red compartida n8n es el mayor riesgo |
| Seguridad de aplicación | 8/10 | Muy buena: CSP, magic bytes, parameterized queries, audit logs |
| Seguridad de datos | 6/10 | OAuth tokens sin cifrar, JWT en localStorage |
| Operaciones y logging | 7/10 | Buena auditoría, IPv6 menor issue, reset token fuga |
| **PUNTUACIÓN GLOBAL** | **6.0/10** | **MODERADA — Mejorable con esfuerzo bajo-medio** |

---

*Informe generado el 2026-04-09. Válido para el estado del sistema en esa fecha.*  
*Las puntuaciones de probabilidad y severidad pueden cambiar con el tiempo y deben revisarse periódicamente.*  
*Próxima auditoría recomendada: tras implementar las acciones P0-P1, o en 90 días.*
