# Backup — Copia de Seguridad del Sistema SETEX

Crea o gestiona backups de los datos críticos del sistema.

## Qué hacer

$ARGUMENTS

Sin argumentos → crea un backup completo de BD + configuración.

## Datos a respaldar

| Dato | Crítico | Dónde está |
|------|---------|-----------|
| PostgreSQL (facturas, usuarios) | ⭐⭐⭐ CRÍTICO | Docker volume |
| features.json (config) | ⭐⭐ ALTO | `/opt/setex-captu-facture/app/backend/src/config/` |
| secrets/ (credenciales) | ⭐⭐⭐ CRÍTICO | `/opt/setex-captu-facture/secrets/` |
| .env | ⭐⭐ ALTO | `/opt/setex-captu-facture/app/` |
| Uploads (imágenes facturas) | ⭐ MEDIO | `/opt/setex-captu-facture/data/uploads/` |

## Backup completo

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/backups/setex_$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

echo "1. Backup PostgreSQL..."
docker exec setex-postgres pg_dump -U postgres facturas > "$BACKUP_DIR/postgres_$TIMESTAMP.sql"
gzip "$BACKUP_DIR/postgres_$TIMESTAMP.sql"
echo "   ✅ BD: $BACKUP_DIR/postgres_$TIMESTAMP.sql.gz"

echo "2. Backup configuración..."
cp /opt/setex-captu-facture/app/backend/src/config/features.json "$BACKUP_DIR/features.json"
echo "   ✅ features.json"

echo "3. Resumen del backup..."
ls -lah "$BACKUP_DIR/"
echo "Backup completado en: $BACKUP_DIR"
```

⚠️ NO hacer backup de `secrets/` en texto plano → ya deben estar en un gestor de contraseñas externo.

## Verificar backup de BD

```bash
# Verificar que el .sql.gz es válido
zcat /opt/backups/setex_*/postgres_*.sql.gz | head -20
```

## Restaurar backup (SOLO si Julio lo confirma explícitamente)

```bash
# PELIGROSO — destruye los datos actuales
# Confirmar con Julio antes de ejecutar
# docker exec -i setex-postgres psql -U postgres -d facturas < backup.sql
```

## Automatización (recomendado)

Para backups automáticos diarios, crear un cron:
```bash
# Cada día a las 3:00 AM
0 3 * * * /opt/setex-captu-facture/scripts/backup.sh >> /opt/setex-captu-facture/logs/backup.log 2>&1
```

Mencionar a Julio que no hay backup automático configurado actualmente — es un riesgo P1.
