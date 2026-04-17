# Whitelist — Gestión de Emails Autorizados

Gestiona la lista de emails que pueden registrarse en SETEX.
Solo los emails en `allowed_emails` pueden crear cuenta.

## Qué hacer

$ARGUMENTS

Sin argumentos → muestra la lista completa de emails autorizados.

## Acciones disponibles

Interpreta el argumento:

### Ver lista completa (sin argumento)
```bash
docker exec setex-postgres psql -U postgres -d facturas -c \
  "SELECT email, created_at FROM allowed_emails ORDER BY created_at DESC;"
```

### Añadir un email → `add email@ejemplo.com`
```bash
docker exec setex-postgres psql -U postgres -d facturas -c \
  "INSERT INTO allowed_emails (email) VALUES ('EMAIL') ON CONFLICT DO NOTHING;"
```
Confirma que se añadió:
```bash
docker exec setex-postgres psql -U postgres -d facturas -c \
  "SELECT email, created_at FROM allowed_emails WHERE email='EMAIL';"
```

### Eliminar un email → `remove email@ejemplo.com`
⚠️ CONFIRMAR antes de ejecutar. Pregunta: "¿Seguro que quieres eliminar EMAIL de la whitelist?"
```bash
docker exec setex-postgres psql -U postgres -d facturas -c \
  "DELETE FROM allowed_emails WHERE email='EMAIL';"
```
Nota: eliminar de whitelist NO borra el usuario si ya existe en `users`.

### Verificar si un email está autorizado → `check email@ejemplo.com`
```bash
docker exec setex-postgres psql -U postgres -d facturas -c \
  "SELECT
    (SELECT COUNT(*) FROM allowed_emails WHERE email='EMAIL') as en_whitelist,
    (SELECT COUNT(*) FROM users WHERE email='EMAIL') as registrado;"
```

### Ver emails registrados que NO están en whitelist → `orphans`
```bash
docker exec setex-postgres psql -U postgres -d facturas -c \
  "SELECT u.email, u.created_at FROM users u
   LEFT JOIN allowed_emails a ON a.email = u.email
   WHERE a.email IS NULL;"
```

## Reglas
- Siempre confirmar antes de eliminar un email
- Si el email ya tiene cuenta → eliminarlo de whitelist NO revoca acceso inmediatamente
- Para revocar acceso completo → también eliminar de `users` (pedir confirmación explícita)
