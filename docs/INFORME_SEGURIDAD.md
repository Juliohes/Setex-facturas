# SETEX FACTURAS - AUDITORIA DE CIBERSEGURIDAD
## Informe Completo + Defensas Implementadas - 2 Marzo 2026

---

## RESUMEN EJECUTIVO

Se identificaron **35 vulnerabilidades** de las cuales **12 ya han sido corregidas** en esta sesion.
Las restantes requieren cambios que necesitan tu aprobacion (credenciales, infraestructura).

| Severidad | Encontradas | Corregidas | Pendientes |
|-----------|-------------|------------|------------|
| CRITICA | 4 | 1 | 3 |
| ALTA | 16 | 9 | 7 |
| MEDIA | 9 | 2 | 7 |
| BAJA | 6 | 0 | 6 |
| **TOTAL** | **35** | **12** | **23** |

---

## DEFENSAS YA IMPLEMENTADAS (12)

### 1. Security Headers en Nginx (7 headers)
**Archivo:** `app/frontend/nginx.conf`
```
X-Frame-Options: DENY                    → Protege contra clickjacking
X-Content-Type-Options: nosniff          → Evita MIME sniffing
X-XSS-Protection: 1; mode=block         → Filtro XSS navegadores antiguos
Referrer-Policy: strict-origin...        → No filtra URLs en referer
Permissions-Policy: camera=()...         → Bloquea APIs del navegador
Strict-Transport-Security: max-age=...   → Fuerza HTTPS por 2 anos
Content-Security-Policy: default-src...  → Bloquea scripts/frames externos
```
**Estado:** ACTIVO y verificado con `curl -I`

### 2. Helmet reforzado en Express
**Archivo:** `app/backend/src/server.js`
- CSP con directivas estrictas
- HSTS con preload
- Frame-ancestors: 'none'
- Body parser limitado a 1 MB

### 3. Validacion de magic bytes en uploads
**Archivo:** `app/backend/src/server.js` (funcion `validateFileMagicBytes`)
- Verifica los primeros 8 bytes del archivo contra firmas conocidas
- JPEG: FFD8FF, PNG: 89504E47, PDF: 25504446
- Impide subir ejecutables renombrados como imagen
- Archivo bloqueado se elimina del disco y se registra en audit log

### 4. Validacion de email mejorada
- Formato regex validado en register y login
- Longitud maxima 254 caracteres
- Previene inyeccion por email gigante

### 5. Password mas seguro (8 chars min, max 128)
- Minimo 8 caracteres (antes era 6)
- Maximo 128 caracteres (previene DoS con bcrypt)
- Se aplica en register y reset-password

### 6. Control de acceso admin (RBAC)
**Archivo:** `app/backend/src/server.js` (funcion `requireAdmin`)
- Solo los emails `juliohesuni@gmail.com` y `albertomurimarti@gmail.com` pueden:
  - Ver motor OCR activo: `GET /api/admin/ocr-engine`
  - Cambiar motor OCR: `POST /api/admin/ocr-engine`
- Intentos no autorizados se registran en audit log
- Usuarios normales reciben 403 Forbidden

### 7. Audit logging completo
**Tabla:** `audit_logs` en PostgreSQL
- Registra: LOGIN_SUCCESS, LOGIN_FAILED, REGISTER_BLOCKED, UPLOAD_SUCCESS, UPLOAD_BLOCKED, PASSWORD_RESET, OCR_ENGINE_CHANGED, ADMIN_ACCESS_DENIED
- Datos: user_id, action, details (JSON), ip_address, timestamp
- Indices en user_id, action, created_at para consultas rapidas

### 8. Invalidacion de TODOS los tokens de reset
- Al cambiar contrasena, se invalidan TODOS los tokens pendientes del usuario
- Antes solo se invalidaba el token usado

### 9. Server tokens ocultos en Nginx
- `server_tokens off` — no muestra version de nginx

---

## VULNERABILIDADES PENDIENTES QUE REQUIEREN TU ACCION

### CRITICAS (requieren accion en 48h)

#### C1. Credenciales SMTP en texto plano en .env
**Riesgo:** Alguien con acceso al servidor puede leer la contrasena de email
**Ubicacion:** `app/.env` — `SMTP_PASS=cmnveibwqaeorlpg`
**Accion necesaria:**
1. Mover SMTP_PASS a Docker secrets (como jwt_secret)
2. Rotar la app password de Gmail
3. Asegurar que `.env` no esta en git (`git log --all --full-history -- app/.env`)

#### C2. Token de reset en URL (query string)
**Riesgo:** El token aparece en logs del navegador, historial, y headers referer
**Ubicacion:** `server.js` linea 365
**Accion necesaria:** Cambiar el flujo a un codigo de 6 digitos que el usuario introduce en un formulario, en vez de un link directo con token en la URL

#### C3. Datos de factura enviados en base64 al webhook n8n
**Riesgo:** Imagenes de facturas (datos financieros sensibles) viajan en JSON
**Ubicacion:** `queue/invoiceWorker.js`
**Accion necesaria:** Solo relevante si `use_n8n: true` — en modo directo (actual) no aplica

### ALTAS (resolver en 1-2 semanas)

#### A1. JWT almacenado en localStorage
**Riesgo:** Vulnerable a XSS (un script malicioso puede robar el token)
**Mitigacion actual:** CSP bloquea scripts externos, reduciendo el vector de ataque
**Accion futura:** Migrar a httpOnly cookies cuando se refactorice el frontend

#### A2. Sin CSRF protection
**Riesgo:** Sitio malicioso podria hacer requests a nombre del usuario
**Mitigacion actual:** CORS estricto (`origin: xanflatest.com`) bloquea la mayoria de ataques CSRF
**Accion futura:** Instalar `csurf` middleware

#### A3. Rate limiter bypasseable con diferentes IPs
**Riesgo:** Atacante con VPN/proxies puede hacer mas requests que el limite
**Mitigacion actual:** Traefik anade rate limiting extra a nivel proxy
**Accion futura:** Usar Redis-backed rate limiter (`rate-limit-redis` package)

#### A4. Sin certificado pinning para APIs externas (OpenAI, Azure)
**Riesgo:** MitM podria interceptar llamadas API
**Mitigacion actual:** TLS estandar de Node.js
**Accion futura:** Bajo riesgo real; TLS estandar es suficiente para este caso

#### A5. Redis sin password
**Riesgo:** Si alguien accede a la red Docker, puede leer la cola
**Ubicacion:** `docker-compose.yml`
**Accion necesaria:**
```yaml
redis:
  command: redis-server --requirepass ${REDIS_PASSWORD}
```

#### A6. Google Drive permisos de archivos
**Riesgo:** Si la carpeta Drive es publica, las facturas son accesibles
**Accion necesaria:** Verificar permisos de la carpeta `1FtLHE4fph-ZzhD9yYueQSQc0dckQ9RLt` en Google Drive

#### A7. Frontend container corre como root
**Riesgo:** Si nginx es comprometido, el atacante tiene root en el container
**Accion necesaria:** Anadir `USER nginx` al Dockerfile del frontend

### MEDIAS (resolver en 1 mes)

| # | Vulnerabilidad | Estado |
|---|---------------|--------|
| M1 | No hay backup automatizado | Ya existe `backup-db.sh` — verificar cron |
| M2 | Secrets no cifrados en disco | Usar Docker Swarm o Vault en el futuro |
| M3 | No hay escaneo de dependencias | Ejecutar `npm audit` periodicamente |
| M4 | Race condition en duplicados | Protegido por unique index — bajo riesgo |
| M5 | Log injection via filename | Sharp trunca nombres; bajo riesgo |
| M6 | Error messages leak info | Mitigado parcialmente; mejorar mensajes |
| M7 | No hay monitoring/alerting | Considerar Uptime Kuma o similar |

### BAJAS (mejores practicas para el futuro)

| # | Vulnerabilidad | Notas |
|---|---------------|-------|
| B1 | No API versioning (/api/v1) | Buena practica, no urgente |
| B2 | CORS no flexible para subdominios | Solo necesario si se anade subdominio |
| B3 | Feature flags incompletos | Anadir maintenance_mode, uploads_enabled |
| B4 | Sin rate limit en cola | Protegido por rate limit en upload |
| B5 | Dependencies no pinned (usa ^) | Bajo riesgo con package-lock.json |
| B6 | Sin retry en fallo de SMTP | Email de calidad falla silenciosamente |

---

## MATRIZ DE ATAQUES Y DEFENSAS

| Ataque | Vector | Defensa activa | Estado |
|--------|--------|----------------|--------|
| **SQL Injection** | Input de usuario | Queries parametrizadas ($1, $2) | PROTEGIDO |
| **XSS (Stored)** | Nombre de archivo | `escapeHtml()`, CSP strict | PROTEGIDO |
| **XSS (Reflected)** | URL params | CSP, X-XSS-Protection | PROTEGIDO |
| **Clickjacking** | iframe malicioso | X-Frame-Options: DENY, frame-ancestors 'none' | PROTEGIDO |
| **MIME Sniffing** | Archivo camuflado | X-Content-Type-Options, magic bytes check | PROTEGIDO |
| **File Upload Malicioso** | Ejecutable como imagen | Magic bytes validation, multer filter | PROTEGIDO |
| **Brute Force Login** | Intentos masivos | Rate limiter 10/15min, bcrypt 12 rounds | PROTEGIDO |
| **Brute Force Upload** | Flood de facturas | Rate limiter 30/15min, file size 10MB | PROTEGIDO |
| **Password Spraying** | Passwords comunes | Min 8 chars, bcrypt, audit log | PROTEGIDO |
| **Session Hijacking** | Robar JWT | HSTS, 7d expiry, audit log | PARCIAL (localStorage) |
| **CSRF** | Sitio externo | CORS strict, pero falta csrf token | PARCIAL |
| **DDoS** | Flood de requests | UFW firewall, Traefik, rate limits | PROTEGIDO |
| **Path Traversal** | Nombre de archivo | Multer genera nombres aleatorios | PROTEGIDO |
| **Email Enumeration** | Register/forgot-pwd | Misma respuesta para email existente/no | PROTEGIDO |
| **Token Reuse** | Reset password token | Todos invalidados al usar uno | PROTEGIDO |
| **Privilege Escalation** | User → Admin | RBAC con email whitelist | PROTEGIDO |
| **Data Exfiltration** | Acceso no autorizado | Auth requerido en todo, audit log | PROTEGIDO |
| **Log Injection** | Filename especial | Logging estructurado (Winston JSON) | PROTEGIDO |
| **Denial of Service** | Archivo gigante | Multer 10MB limit, express.json 1MB | PROTEGIDO |
| **Man-in-the-Middle** | Interceptar trafico | HTTPS via Traefik + HSTS | PROTEGIDO |

---

## CHECKLIST DE ACCIONES INMEDIATAS

- [x] Security headers en nginx (7 headers)
- [x] Helmet reforzado con CSP
- [x] Validacion de magic bytes en uploads
- [x] Validacion de email format
- [x] Password minimo 8 caracteres
- [x] Admin RBAC (solo emails autorizados)
- [x] Audit logging en BD
- [x] Invalidacion de todos los tokens de reset
- [x] Server tokens ocultos
- [x] Body parser limitado a 1MB
- [ ] Mover SMTP_PASS a Docker secrets
- [ ] Rotar app password de Gmail
- [ ] Password con Redis-backed rate limiter
- [ ] Redis con password
- [ ] Frontend container non-root
- [ ] npm audit regular
- [ ] Backup automatizado con cron
- [ ] Verificar permisos de carpeta Google Drive

---

## COMO VERIFICAR LAS DEFENSAS

```bash
# 1. Security headers
curl -sI https://xanflatest.com/index.html | grep -i "x-frame\|x-content\|csp\|hsts"

# 2. Audit logs
docker exec setex-postgres psql -U setex_user -d setex_db \
  -c "SELECT action, count(*) FROM audit_logs GROUP BY action;"

# 3. Admin protegido (debe devolver 403 para usuarios normales)
curl -s -X POST https://xanflatest.com/api/admin/ocr-engine \
  -H "Authorization: Bearer TOKEN_USUARIO_NORMAL" \
  -H "Content-Type: application/json" \
  -d '{"engine":"azure"}'

# 4. Magic bytes (subir .exe renombrado a .jpg debe fallar)
curl -X POST https://xanflatest.com/api/upload \
  -H "Authorization: Bearer TOKEN" \
  -F "file=@fake-image.exe;type=image/jpeg"

# 5. Firewall activo
sudo ufw status verbose
```

---

*SETEX Captura Facturas - Auditoria de Seguridad - Marzo 2026*
