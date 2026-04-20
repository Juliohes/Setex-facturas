# Playbook de emergencias — SETEX

Procedimientos que esperamos no usar nunca, pero que cuando hagan falta hay que ejecutar bien y rápido.

## Producción caída — el sitio no responde

1. Verifica capa por capa, de afuera hacia adentro:

```bash
# DNS
dig +short setex-facturas.es

# Conectividad TLS
echo | openssl s_client -servername setex-facturas.es -connect setex-facturas.es:443 2>/dev/null | openssl x509 -noout -dates

# Traefik está escuchando
sudo ss -tlnp | grep ':443'

# Containers prod up
docker ps --filter "name=setex-" --format "table {{.Names}}\t{{.Status}}"

# Healthchecks
docker inspect setex-backend --format '{{.State.Health.Status}}'
docker inspect setex-frontend --format '{{.State.Health.Status}}'
```

2. Si un container está unhealthy:

```bash
docker compose -f /opt/setex/prod/app/docker-compose.yml logs <servicio> --tail 100
docker compose -f /opt/setex/prod/app/docker-compose.yml restart <servicio>
```

3. Si el problema persiste, revierte al último commit conocido bueno:

```bash
cd /opt/setex/prod
git log --oneline -5
git reset --hard <hash-commit-bueno>
docker compose -f app/docker-compose.yml build backend
docker compose -f app/docker-compose.yml stop backend frontend
docker compose -f app/docker-compose.yml up -d backend frontend
```

4. Si nada funciona, restaura desde backup (siguiente sección).

## Restaurar la BD desde backup GPG cifrado

Los backups están en `/opt/setex/shared/backups/postgres/` (post-cutover) o `/opt/setex-captu-facture/backups/postgres/` (pre-cutover). La passphrase está en `/opt/setex/prod/secrets/backup_passphrase.txt`.

```bash
# 1. Localizar el backup más reciente o uno concreto
ls -lt /opt/setex/shared/backups/postgres/ | head -10

# 2. Descifrar a tmp
BACKUP=/opt/setex/shared/backups/postgres/setex_db_YYYYMMDD_HHMMSS.sql.gz.gpg
PASS=$(sudo cat /opt/setex/prod/secrets/backup_passphrase.txt)
sudo gpg --batch --yes --passphrase "$PASS" --decrypt "$BACKUP" > /tmp/restore.sql.gz

# 3. Verificar el sql descomprimido
gunzip -t /tmp/restore.sql.gz

# 4. PARAR el backend para que no escriba durante el restore
docker compose -f /opt/setex/prod/app/docker-compose.yml stop backend

# 5. Restaurar — esto BORRA y recrea las tablas
gunzip -c /tmp/restore.sql.gz | docker exec -i setex-prod-postgres psql -U setex_user -d setex_db

# 6. Verificar conteo de filas razonable
docker exec setex-prod-postgres psql -U setex_user -d setex_db -c "
  SELECT 'users' AS t, COUNT(*) FROM users
  UNION ALL SELECT 'uploads', COUNT(*) FROM uploads;"

# 7. Limpiar y arrancar
shred -u /tmp/restore.sql.gz
docker compose -f /opt/setex/prod/app/docker-compose.yml start backend
```

**Antes de cualquier restore, hacer un dump del estado actual** por si hay que volver:

```bash
docker exec setex-prod-postgres pg_dump -U setex_user setex_db | gzip > /tmp/pre-restore-$(date +%Y%m%d-%H%M%S).sql.gz
```

## Recuperar un commit borrado por accidente

Git mantiene los commits 30 días en el reflog aunque borres la rama:

```bash
cd /opt/setex-captu-facture
git reflog | head -20  # localizar el hash
git checkout -b recovery-$(date +%Y%m%d) <hash>
```

Si el commit estaba en GitHub, también queda en eventos del repo durante 90 días. Contacto: GitHub support con el hash.

## Push forzoso accidental a main / develop

Branch protection lo bloquea. Si por algún motivo lograste hacer force push y borraste commits buenos:

1. Nunca cierres la sesión que tenga el reflog.
2. `git reflog` para ver hashes anteriores.
3. PR de restauración:

```bash
git checkout -b recovery/restore-main-YYYY-MM-DD <hash-bueno>
git push --set-upstream origin recovery/restore-main-YYYY-MM-DD
gh pr create --base main --title "recovery: restaurar main al estado <hash>"
```

## Secretos comprometidos

Si crees que un secreto (API key, contraseña BD, JWT) ha quedado expuesto:

1. **Rota inmediatamente**:

```bash
# JWT: invalida todas las sesiones
docker exec setex-prod-postgres psql -U setex_user -d setex_db -c "UPDATE users SET token_version = token_version + 1;"
# Y genera secret nuevo
openssl rand -base64 64 > /opt/setex/prod/secrets/jwt_secret.txt
chmod 644 /opt/setex/prod/secrets/jwt_secret.txt
docker compose -f /opt/setex/prod/app/docker-compose.yml restart backend

# OpenAI: rotar en https://platform.openai.com/api-keys
# Azure: rotar en portal Azure Cognitive Services
# SMTP: rotar password en Google Workspace
```

2. **Audita el historial git** para confirmar que no se commiteó:

```bash
cd /opt/setex-captu-facture
bash scripts/audit-secrets.sh
```

3. **Si fue commiteado**: usar `git filter-repo` (NO `filter-branch`) para reescribir historial, y force-push protegido.

## OCR fallando — usuarios no pueden subir facturas

```bash
# Ver últimos errores
docker compose -f /opt/setex/prod/app/docker-compose.yml logs backend --tail 100 | grep -E "OCR|OpenAI|Azure"

# Ejecutar smoke test manual
node /opt/setex/prod/scripts/smoke-test-ocr.js

# Si OpenAI falla: comprobar saldo y status
curl -s https://status.openai.com/api/v2/status.json | jq .

# Si Azure falla: comprobar status
curl -s https://status.azure.com/en-us/status

# Mientras tanto, conmutar a single-engine
sudo sed -i 's/"ocr_mode": "dual"/"ocr_mode": "openai"/' /opt/setex/prod/app/backend/src/config/features.json
# (volume-mounted → efecto inmediato sin restart)
```

## Quién/qué tocar si todo arde

1. **Julio (mantenedor único)** — juliohesuni@gmail.com
2. **Hostinger** — panel VPS https://hpanel.hostinger.com (reset, snapshot, consola web)
3. **GitHub** — https://github.com/Juliohes/Setex-facturas (issues, security)
4. **Let's Encrypt** — los certs se renuevan solos vía Traefik. Si caducan, `docker compose restart traefik`.

## Hard reset total (último recurso)

Si nada funciona y necesitas devolver el sitio a un estado conocido:

```bash
# 1. Backup ACTUAL (por si el reset rompe algo más)
docker exec setex-prod-postgres pg_dump -U setex_user setex_db | gzip > /tmp/last-good-$(date +%Y%m%d-%H%M%S).sql.gz

# 2. Down todo
cd /opt/setex/prod/app
docker compose down

# 3. Reset al último commit estable
cd /opt/setex/prod
git fetch origin
git reset --hard origin/main

# 4. Re-build y up
cd app
docker compose build
docker compose up -d

# 5. Restaurar el último backup conocido
# (ver sección "Restaurar la BD desde backup GPG")
```
