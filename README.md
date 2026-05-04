# SETEX Captura de Facturas

Sistema web de captura y procesamiento de facturas con OCR inteligente, diseñado para asesorías contables y fiscales.

**Dominio:** setex-facturas.es  
**Estado:** En produccion

---

## Stack

| Capa | Tecnologia |
|------|-----------|
| Frontend | HTML5 + CSS3 + Vanilla JavaScript |
| Backend | Node.js 20 + Express 4 |
| Base de datos | PostgreSQL 15 |
| Cache/seguridad | Redis 7 |
| OCR primario | OpenAI GPT-4.1 Vision |
| OCR secundario | Azure Document Intelligence |
| Proxy/HTTPS | Traefik + Let's Encrypt |
| Infraestructura | Docker Compose (4 contenedores) |
| Servidor | VPS Ubuntu 24.04 |

---

## Arquitectura

```
Internet (HTTPS)
      |
  Traefik (443/80)
      |
setex-frontend (Nginx) --> setex-backend (Node.js + Express)
                                |
                      +---------+---------+
                      |                   |
              setex-postgres       setex-redis
              (PostgreSQL 15)      (Redis 7)
```

Todos los contenedores en red Docker interna aislada. Solo el frontend expuesto via Traefik.

---

## Requisitos previos

- Docker 24+ y Docker Compose v2
- Acceso SSH al servidor
- Cuentas de API: OpenAI y Azure Document Intelligence

---

## Primeros pasos

### 1. Clonar el repositorio

```bash
git clone git@github.com:Juliohes/setex-captu-facture.git
cd setex-captu-facture
```

### 2. Configurar secretos

Crear el directorio `secrets/` con los siguientes archivos (uno por linea, sin salto final):

```
secrets/
  jwt_secret.txt          # Clave para firmar JWT (generar con: openssl rand -hex 32)
  postgres_password.txt   # Contraseña de PostgreSQL
  openai_api_key.txt      # API key de OpenAI
  azure_di_key.txt        # API key de Azure Document Intelligence
  azure_di_endpoint.txt   # Endpoint de Azure DI (URL completa)
  smtp_user.txt           # Email para envio SMTP
  smtp_pass.txt           # Contraseña del email SMTP
  redis_password.txt      # Contraseña de Redis
  redis.conf              # Config Redis con requirepass
  backup_passphrase.txt   # Passphrase para cifrado de backups GPG
```

Permisos: `chmod 644 secrets/*.txt`

### 3. Configurar variables de entorno

```bash
cp app/.env.example app/.env
# Editar app/.env con los valores adecuados
```

### 4. Levantar servicios

```bash
cd app
docker compose build
docker compose up -d
```

### 5. Verificar

```bash
docker compose ps
# Todos los contenedores deben estar healthy/running
```

---

## Desarrollo

### Flujo Git

```
feature/* --> develop (staging automatico) --> main (produccion con aprobacion)
```

- `main` = produccion (sagrado, nunca roto)
- `develop` = staging (staging.setex-facturas.es)
- `feature/*` = ramas de trabajo, merge a develop via PR

### Convenciones de commits

Usamos [Conventional Commits](https://www.conventionalcommits.org/):

```
tipo(alcance): descripcion corta

Cuerpo opcional con mas detalle.
```

**Tipos:**
- `feat` — nueva funcionalidad
- `fix` — correccion de bug
- `refactor` — reestructuracion sin cambiar comportamiento
- `docs` — documentacion
- `security` — cambios de seguridad
- `perf` — mejora de rendimiento
- `chore` — mantenimiento (deps, config, scripts)

**Ejemplos:**
```
feat(ocr): anadir soporte para facturas en PDF multipagina
fix(auth): corregir expiracion de refresh token en edge case
security(uploads): validar magic bytes antes de procesar imagen
```

### Rebuild tras cambios de codigo

```bash
cd /opt/setex-captu-facture/app
docker compose build backend && docker compose stop backend && docker compose up -d backend
```

### Cambios en features.json (OCR)

No requiere rebuild. El archivo esta volume-mounted y se lee en cada request.

---

## Estructura del repositorio

```
setex-captu-facture/
|-- app/
|   |-- backend/
|   |   |-- Dockerfile
|   |   |-- package.json
|   |   +-- src/
|   |       |-- server.js              # Logica principal del backend
|   |       |-- config/
|   |       |   |-- features.json      # Toggles OCR (editable en caliente)
|   |       |   +-- index.js           # Loader de configuracion
|   |       |-- ocr/
|   |       |   |-- index.js           # Orquestador multi-motor
|   |       |   |-- openai.js          # GPT-4.1 Vision
|   |       |   |-- azure.js           # Azure Document Intelligence
|   |       |   |-- gemini.js          # Gemini (desactivado)
|   |       |   |-- validateCIF.js     # Validador anti-alucinaciones
|   |       |   +-- validateIVA.js     # Validador coherencia IVA
|   |       |-- services/
|   |       |   +-- viesValidator.js   # Validacion VIES (NIF europeo)
|   |       +-- queue/
|   |           +-- index.js           # Conexion Redis
|   |-- frontend/
|   |   |-- Dockerfile
|   |   |-- nginx.conf
|   |   +-- src/                       # HTML, JS, CSS
|   |-- docker-compose.yml
|   +-- .env.example
|-- scripts/
|   |-- audit-secrets.sh               # Auditoria pre-commit de secretos
|   |-- backup-postgres.sh             # Backup cifrado de BD
|   |-- health-check.sh                # Verificacion de servicios
|   |-- watchdog.sh                    # Monitor de contenedores
|   +-- fix-permissions.sh             # Correccion de permisos
|-- config/
|   +-- crontab.txt                    # Tareas programadas
|-- docs/
|   |-- DECISIONS.md                   # Decisiones arquitectonicas
|   |-- INFORME_SISTEMA_COMPLETO.md    # Documentacion completa del sistema
|   |-- INFORME_SEGURIDAD.md           # Auditoria de seguridad
|   +-- ...                            # Otros informes
|-- tests/
|   |-- generate-invoices.py           # Generador de facturas de test
|   |-- stress-test.py                 # Test de carga basico
|   +-- stress-test-full.py            # Test de carga completo
|-- .claude/
|   |-- CLAUDE.md                      # Instrucciones del proyecto para Claude
|   +-- commands/                      # Comandos personalizados
|-- .gitignore
+-- README.md
```

---

## Documentacion

| Documento | Contenido |
|-----------|-----------|
| `docs/INFORME_SISTEMA_COMPLETO.md` | Fuente de verdad del producto completo |
| `docs/DECISIONS.md` | Decisiones arquitectonicas (Git, CI/CD, staging) |
| `docs/INFORME_SEGURIDAD.md` | Auditoria de seguridad implementada |
| `docs/INFORME_VERIFACTU.md` | Analisis regulatorio Verifactu para Espana |
| `docs/INFORME_CAPACIDAD_Y_RENDIMIENTO.md` | Resultados de stress test |

---

## Seguridad

- Secretos via Docker Secrets (`/run/secrets/`), nunca en codigo ni en `.env`
- Helmet.js + CSP headers
- Rate limiting configurable (auth + uploads)
- Validacion de archivos por magic bytes (fail-secure)
- bcrypt 12 rounds para passwords
- JWT con token_version para revocacion inmediata
- Access Token en memoria + Refresh Token en cookie httpOnly
- Deteccion de reuso de Refresh Token (revocacion de familia)
- Red Docker interna aislada
- fail2ban + firewall UFW
- Auditoria completa (tabla audit_logs)

---

## Licencia

Proyecto privado. Todos los derechos reservados.
