# DB — Consultas PostgreSQL SETEX

Ejecuta consultas útiles sobre la base de datos de facturas.

## Qué consultar

$ARGUMENTS

Sin argumentos → muestra un resumen general de la base de datos.

## Consultas disponibles

Interpreta el argumento y ejecuta la consulta correspondiente:

### Resumen general (sin argumento)
```sql
-- Estadísticas generales
SELECT
  (SELECT COUNT(*) FROM uploads) as total_facturas,
  (SELECT COUNT(*) FROM uploads WHERE n8n_sent=true) as procesadas,
  (SELECT COUNT(*) FROM uploads WHERE n8n_sent=false) as pendientes,
  (SELECT COUNT(*) FROM users) as usuarios_total,
  (SELECT MAX(created_at) FROM uploads) as ultima_factura,
  (SELECT pg_size_pretty(pg_database_size('facturas'))) as tamano_bd;
```

### `usuarios` o `users`
```sql
SELECT id, email, created_at,
  (SELECT COUNT(*) FROM uploads WHERE user_id=users.id) as facturas
FROM users
ORDER BY created_at DESC;
```

### `facturas` o `uploads`
```sql
SELECT id, user_id, file_name, proveedor_nombre, proveedor_nif,
  fecha_emision, total_factura, iva_porcentaje,
  ocr_engine, n8n_sent, created_at
FROM uploads
ORDER BY created_at DESC
LIMIT 20;
```

### `pendientes`
```sql
SELECT id, user_id, file_name, proveedor_nif, total_factura, created_at
FROM uploads
WHERE n8n_sent = false
ORDER BY created_at ASC;
```

### `duplicados`
```sql
SELECT proveedor_nif, fecha_emision, total_factura, COUNT(*) as intentos
FROM uploads
GROUP BY proveedor_nif, fecha_emision, total_factura
HAVING COUNT(*) > 1
ORDER BY intentos DESC;
```

### `logs` o `audit`
```sql
SELECT id, user_id, action, ip_address, created_at, details
FROM audit_logs
ORDER BY created_at DESC
LIMIT 30;
```

### `whitelist`
```sql
SELECT email, created_at FROM allowed_emails ORDER BY created_at DESC;
```

### `schema` o `tablas`
```sql
SELECT table_name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;
```

### `reset-tokens`
```sql
SELECT u.email, r.token, r.expires_at, r.used
FROM password_reset_tokens r
JOIN users u ON u.id = r.user_id
WHERE r.expires_at > NOW()
ORDER BY r.expires_at DESC;
```

## Cómo ejecutar las consultas

```bash
docker exec setex-postgres psql -U postgres -d facturas -c "CONSULTA_SQL"
```

## Reglas de seguridad

- NUNCA ejecutar UPDATE, DELETE o DROP sin confirmación EXPLÍCITA de Julio
- Si el argumento parece una operación destructiva → pedir confirmación antes
- Para consultas custom → mostrar primero el SQL y pedir aprobación
- Datos sensibles (tokens, passwords) → nunca mostrarlos completos en el output
