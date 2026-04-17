# SETEX Facturas - Guia de Administracion

---

## WHITELIST DE EMAILS (CLIENTES AUTORIZADOS)

Solo los emails que esten en esta lista pueden registrarse en la aplicacion.

### Ver la lista de emails autorizados

```bash
/opt/setex-captu-facture/scripts/manage-whitelist.sh list
```

### Anadir un nuevo cliente

```bash
/opt/setex-captu-facture/scripts/manage-whitelist.sh add correo@ejemplo.com "Nota opcional"
```

### Quitar un cliente

```bash
/opt/setex-captu-facture/scripts/manage-whitelist.sh remove correo@ejemplo.com
```

### Comprobar si un email esta autorizado

```bash
/opt/setex-captu-facture/scripts/manage-whitelist.sh check correo@ejemplo.com
```

### Ver ayuda completa

```bash
/opt/setex-captu-facture/scripts/manage-whitelist.sh help
```

---

## VER USUARIOS REGISTRADOS

```bash
docker exec setex-postgres psql -U setex_user -d setex_db -c "SELECT id, email, created_at FROM users ORDER BY created_at DESC;"
```

---

## RECUPERACION DE CONTRASENA

Se ha implementado exitosamente un sistema profesional de recuperacion de contrasena por email en la aplicacion SETEX Facturas.

---

## 📋 ¿QUÉ SE HA IMPLEMENTADO?

### Backend (Node.js/Express)

1. **Nueva tabla en PostgreSQL**: `password_reset_tokens`
   - Almacena tokens de recuperación de forma segura (hasheados con SHA-256)
   - Tokens expiran en 1 hora
   - Soporte para marcar tokens como "usados"
   - Índices optimizados para consultas rápidas

2. **Nuevos endpoints API**:
   - `POST /api/auth/forgot-password` - Solicitar recuperación de contraseña
   - `POST /api/auth/reset-password` - Restablecer contraseña con token

3. **Configuración de email (Nodemailer)**:
   - Soporte para Gmail, Outlook, SendGrid, Mailgun, Amazon SES
   - Envío de emails profesionales con HTML
   - Configuración flexible vía variables de entorno

### Frontend (HTML/CSS/JavaScript)

1. **Nuevos formularios**:
   - Formulario "¿Olvidaste tu contraseña?" en pantalla de login
   - Página dedicada para restablecer contraseña
   - Validación de contraseñas (mínimo 6 caracteres)
   - Confirmación de contraseña

2. **Mensajes de feedback**:
   - Mensajes de éxito (verde)
   - Mensajes de error (rojo)
   - Redirección automática después de cambiar contraseña

---

## 🚀 CÓMO CONFIGURAR EL ENVÍO DE EMAILS

### Paso 1: Crear archivo .env

En el directorio `/opt/setex-captu-facture/app/`, crea un archivo llamado `.env`:

```bash
cd /opt/setex-captu-facture/app
nano .env
```

### Paso 2: Configurar credenciales SMTP

**Opción A: Usando Gmail** (Recomendado para inicio)

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-contraseña-de-aplicacion
```

**IMPORTANTE para Gmail**:
1. Habilita "Verificación en 2 pasos" en tu cuenta de Gmail
2. Ve a: https://myaccount.google.com/apppasswords
3. Crea una "Contraseña de aplicación" (selecciona "Correo" y "Otro")
4. Usa esa contraseña de 16 caracteres en `SMTP_PASS`

**Opción B: Usando Outlook/Hotmail**

```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu-email@outlook.com
SMTP_PASS=tu-contraseña
```

**Opción C: Usando SendGrid** (Profesional - Gratuito hasta 100 emails/día)

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=TU-API-KEY-DE-SENDGRID
```

### Paso 3: Reiniciar el contenedor backend

```bash
cd /opt/setex-captu-facture/app
docker compose restart backend
```

### Paso 4: Verificar configuración

Revisa los logs para confirmar que el email se configuró correctamente:

```bash
docker logs setex-backend --tail 20
```

Deberías ver:
```
{"level":"info","message":"Email transporter configured successfully","timestamp":"..."}
```

Si no está configurado, verás:
```
{"level":"warn","message":"SMTP not configured - password reset emails will not be sent","timestamp":"..."}
```

---

## 📖 CÓMO USAR LA RECUPERACIÓN DE CONTRASEÑA

### Para Usuarios Finales

1. **Olvidé mi contraseña**:
   - Ve a https://xanflatest.com
   - Haz clic en "¿Olvidaste tu contraseña?"
   - Ingresa tu email
   - Haz clic en "Enviar"

2. **Revisa tu email**:
   - Busca un email de "SETEX Facturas"
   - Haz clic en el botón "Restablecer Contraseña"
   - O copia el enlace en tu navegador

3. **Crea nueva contraseña**:
   - Ingresa tu nueva contraseña (mínimo 6 caracteres)
   - Confirma la contraseña
   - Haz clic en "Restablecer"

4. **¡Listo!**:
   - Serás redirigido al login
   - Inicia sesión con tu nueva contraseña

---

## 🔍 CÓMO VER USUARIOS REGISTRADOS

Para consultar los usuarios registrados en la base de datos:

```bash
docker exec setex-postgres psql -U setex_user -d setex_db -c "SELECT id, email, created_at FROM users ORDER BY created_at DESC;"
```

**IMPORTANTE**: Las contraseñas están hasheadas con bcrypt y **NO se pueden ver**. Esto es correcto por seguridad.

Para ver tokens de recuperación activos:

```bash
docker exec setex-postgres psql -U setex_user -d setex_db -c "SELECT id, user_id, created_at, expires_at, used FROM password_reset_tokens WHERE expires_at > NOW() ORDER BY created_at DESC;"
```

---

## 🛠️ SOLUCIÓN DE PROBLEMAS COMUNES

### Problema 1: "Error de conexión" al intentar login

**Causa**: Rate limiting activado (máximo 5 intentos cada 15 minutos)

**Solución**: Esperar 15 minutos o reiniciar el backend:
```bash
docker compose restart backend
```

### Problema 2: "Credenciales inválidas"

**Causa**: Contraseña incorrecta

**Soluciones**:
1. Usa el sistema de recuperación de contraseña
2. Registra un usuario nuevo
3. Como administrador, puedes resetear la contraseña manualmente (ver sección siguiente)

### Problema 3: No llega el email de recuperación

**Causas posibles**:

1. **SMTP no configurado**:
   - Revisa los logs: `docker logs setex-backend --tail 20`
   - Configura el archivo `.env` (ver sección anterior)

2. **Email en carpeta de spam**:
   - Revisa la carpeta de spam/correo no deseado

3. **Credenciales SMTP incorrectas**:
   - Verifica que SMTP_USER y SMTP_PASS sean correctos
   - Para Gmail, usa "Contraseña de aplicación", no tu contraseña normal

4. **Email bloqueado por el proveedor**:
   - Algunos proveedores bloquean envíos desde IPs nuevas
   - Considera usar SendGrid (gratuito hasta 100 emails/día)

### Problema 4: Frontend "unhealthy"

**Causa**: El healthcheck está mal configurado (problema conocido)

**Solución**: El frontend SÍ está funcionando. Para arreglar el healthcheck:

```bash
# Editar docker-compose.yml y agregar/modificar el healthcheck del frontend
# O simplemente ignorar el warning (no afecta la funcionalidad)
```

---

## 👨‍💻 RESETEAR CONTRASEÑA MANUALMENTE (ADMINISTRADOR)

Si necesitas resetear la contraseña de un usuario manualmente sin email, crea un script:

### Opción 1: Generar token manualmente

```bash
# 1. Generar token de recuperación para un usuario
docker exec setex-backend node -e "
const crypto = require('crypto');
const token = crypto.randomBytes(32).toString('hex');
console.log('Token:', token);
console.log('URL:', 'https://xanflatest.com/reset-password?token=' + token);
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
console.log('Hash (para BD):', tokenHash);
"

# 2. Insertar el token en la BD (sustituye USER_ID y TOKEN_HASH)
docker exec setex-postgres psql -U setex_user -d setex_db -c "
INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
VALUES (1, 'TOKEN_HASH_AQUI', NOW() + INTERVAL '1 hour');
"

# 3. Envía la URL al usuario por WhatsApp, Telegram, etc.
```

### Opción 2: Cambiar contraseña directamente (más rápido)

```bash
# Generar hash bcrypt de la nueva contraseña
docker exec setex-backend node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('nuevaContraseña123', 12).then(hash => console.log(hash));
"

# Copiar el hash y ejecutar (sustituye HASH y USER_ID):
docker exec setex-postgres psql -U setex_user -d setex_db -c "
UPDATE users SET password_hash = 'HASH_BCRYPT_AQUI' WHERE id = 1;
"
```

---

## 📊 ESTRUCTURA DE LA BASE DE DATOS

### Tabla `users`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL | ID único del usuario |
| email | VARCHAR(255) | Email (único) |
| password_hash | VARCHAR(255) | Hash bcrypt de la contraseña |
| created_at | TIMESTAMP | Fecha de registro |

### Tabla `password_reset_tokens`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | SERIAL | ID único del token |
| user_id | INTEGER | ID del usuario (FK) |
| token_hash | VARCHAR(255) | Hash SHA-256 del token |
| created_at | TIMESTAMP | Fecha de creación |
| expires_at | TIMESTAMP | Fecha de expiración (1 hora) |
| used | BOOLEAN | Si el token ya fue usado |

**Índices**:
- `idx_reset_token_hash` en `token_hash` (búsqueda rápida)
- `idx_reset_expires` en `expires_at` (limpieza automática)

---

## 🔐 SEGURIDAD IMPLEMENTADA

1. **Tokens seguros**:
   - Generados con crypto.randomBytes (32 bytes)
   - Hasheados con SHA-256 antes de guardar en BD
   - No se almacenan tokens en texto plano

2. **Expiración automática**:
   - Tokens expiran en 1 hora
   - Se limpian automáticamente de la BD

3. **Uso único**:
   - Los tokens se marcan como "usados" después de cambiar la contraseña
   - No se pueden reutilizar

4. **Rate limiting**:
   - Máximo 5 intentos cada 15 minutos
   - Protección contra ataques de fuerza bruta

5. **Privacidad**:
   - No se revela si un email existe en el sistema
   - Siempre retorna el mismo mensaje de éxito

6. **Contraseñas hasheadas**:
   - bcrypt con 12 rounds (muy seguro)
   - Imposible descifrar contraseñas

---

## 📁 ARCHIVOS MODIFICADOS/CREADOS

### Backend
- ✅ [app/backend/package.json](app/backend/package.json) - Agregado nodemailer
- ✅ [app/backend/src/server.js](app/backend/src/server.js) - Endpoints y configuración

### Frontend
- ✅ [app/frontend/src/index.html](app/frontend/src/index.html) - Formularios
- ✅ [app/frontend/src/app.js](app/frontend/src/app.js) - Lógica JavaScript
- ✅ [app/frontend/src/styles.css](app/frontend/src/styles.css) - Estilos

### Configuración
- ✅ [app/docker-compose.yml](app/docker-compose.yml) - Variables SMTP
- ✅ [app/.env.example](app/.env.example) - Plantilla de configuración

### Documentación
- ✅ RECUPERACION_CONTRASENA.md (este archivo)

---

## 🎯 PRÓXIMOS PASOS OPCIONALES

1. **Personalizar el email**:
   - Edita el template HTML en [server.js:215-235](app/backend/src/server.js#L215-L235)
   - Agrega logo de la empresa
   - Cambia colores corporativos

2. **Agregar verificación de email en registro**:
   - Similar al flujo de recuperación de contraseña
   - Envía email de confirmación al registrarse

3. **Mejorar el healthcheck del frontend**:
   - Editar docker-compose.yml
   - Configurar healthcheck correcto para nginx

4. **Notificaciones de seguridad**:
   - Enviar email al cambiar contraseña exitosamente
   - Alertar si hay muchos intentos fallidos

---

## 📞 SOPORTE

Si tienes problemas o preguntas:

1. **Revisa los logs**:
   ```bash
   docker logs setex-backend --tail 50
   docker logs setex-frontend --tail 50
   ```

2. **Verifica la configuración**:
   ```bash
   docker exec setex-backend env | grep SMTP
   ```

3. **Prueba los endpoints manualmente**:
   ```bash
   # Desde dentro del contenedor
   docker exec -it setex-backend sh
   wget -O- --post-data='{"email":"test@test.com"}' \
        --header='Content-Type: application/json' \
        http://localhost:3000/api/auth/forgot-password
   ```

---

## ✨ CONCLUSIÓN

¡Sistema de recuperación de contraseña implementado exitosamente! 🎉

**Características**:
- ✅ Recuperación por email automática
- ✅ Tokens seguros con expiración
- ✅ Interfaz de usuario profesional
- ✅ Soporte para múltiples proveedores de email
- ✅ Seguridad robusta (bcrypt, SHA-256, rate limiting)
- ✅ Logs detallados para debugging

**Estado actual**:
- ✅ Backend desplegado y funcionando
- ✅ Frontend actualizado
- ✅ Base de datos con nueva tabla
- ⚠️ SMTP pendiente de configurar (requiere credenciales del usuario)

Para habilitar el envío de emails, simplemente sigue la sección "CÓMO CONFIGURAR EL ENVÍO DE EMAILS" de este documento.

---

**Desarrollado profesionalmente con ❤️ por Claude Sonnet 4.5**

*Última actualización: 2026-02-01*
