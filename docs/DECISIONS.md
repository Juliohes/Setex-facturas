# DECISIONS.md — Decisiones Arquitectónicas Fase 0
## SETEX Captura de Facturas · Preparación para Git + CI/CD + Staging
## Fecha: 2026-04-17

---

## RESUMEN EJECUTIVO

Se cierran 8 decisiones arquitectónicas previas a la implementación de Git, CI/CD y staging para SETEX.
El criterio general ha sido: **seguridad primero, simplicidad operativa segundo, coste tercero**.
Se adopta GitHub Flow + develop como flujo git, staging en el mismo VPS con aislamiento total por Docker,
PostgreSQL separado con datos sintéticos, deploy a producción con aprobación manual en GitHub Actions,
secretos y API keys completamente separados por entorno, y usuario dedicado `deploy` con permisos mínimos.
El diseño soporta la entrada de 1-2 colaboradores sin cambios estructurales.
Todas las decisiones priorizan el principio de mínimo privilegio y blast radius acotado.

---

## DECISIÓN 1 — Flujo Git

**Decisión:** GitHub Flow + develop

**Opciones evaluadas:**
- GitFlow clásico → descartado (ramas `release/*` y `hotfix/*` diseñadas para múltiples versiones en paralelo, ceremonia innecesaria para un solo producto en producción)
- GitHub Flow puro (solo `main`) → descartado (sin CI/CD ni tests automatizados, merge directo a `main` es asumir que todo funciona sin red de seguridad)
- **GitHub Flow + develop → seleccionado**

**Justificación técnica:**
- `main` = reflejo exacto de producción. Sagrado, nunca roto.
- `develop` = rama de integración. Staging apunta aquí. Buffer de validación antes de producción.
- `feature/*` = ramas cortas de trabajo, merge a `develop` vía Pull Request.
- Simplicidad suficiente para un desarrollador solo, pero con la estructura necesaria para 1-2 colaboradores futuros sin cambiar nada.
- El flujo completo: `feature/* → develop (staging automático) → main (producción con aprobación)`.

---

## DECISIÓN 2 — Ubicación del entorno staging

**Decisión:** Mismo VPS de producción (72.60.186.89)

**Opciones evaluadas:**
- Mismo VPS → seleccionado
- Segundo VPS (72.62.189.27) → descartado
- VPS nuevo dedicado → descartado (coste sin justificación)

**Justificación técnica:**
- Staging debe parecerse a producción lo máximo posible: mismo hardware, misma configuración, mismo entorno operativo.
- Un solo servidor = un solo Traefik, un solo pipeline, una sola gestión de seguridad (fail2ban, firewall, SSH).
- Staging con recursos limitados (0.25 CPU, 256MB por contenedor) no impacta a producción en un VPS de 2 vCPU / 8 GB RAM.
- El segundo VPS tiene apps de prueba personales: mezclar staging de producción con proyectos no relacionados es un antipatrón (limpieza accidental, contaminación de recursos).
- Docker proporciona aislamiento suficiente: redes separadas, volúmenes independientes, sin visibilidad cruzada.
- El segundo VPS queda como reserva estratégica si en el futuro staging necesita separarse.

---

## DECISIÓN 3 — Estrategia de base de datos en staging

**Decisión:** PostgreSQL separado (contenedor independiente)

**Opciones evaluadas:**
- Compartida (mismo PostgreSQL, distinta DB) → descartado (un `DROP DATABASE` equivocado compromete producción; riesgo inaceptable con colaboradores futuros)
- Réplica streaming → descartado (sobreingeniería; staging necesita escritura, réplica es read-only)
- **Separada → seleccionado**

**Justificación técnica:**
- Contenedor `setex-staging-postgres` en red Docker propia (`setex_staging_internal`), sin visibilidad a la red de producción.
- Credenciales propias, volumen de datos independiente.
- Límites de recursos: 0.25 CPU, 256MB RAM (suficiente para staging de un solo usuario).
- Impacto en el VPS: ~100-150MB RAM extra sobre 8 GB disponibles = despreciable.
- Aislamiento total: ninguna operación en staging puede afectar datos de producción.

---

## DECISIÓN 4 — Fuente de datos en staging

**Decisión:** Datos sintéticos con script seed

**Opciones evaluadas:**
- Vacío (crear datos manualmente) → descartado (lento, tedioso, no reproducible)
- Anonimizados de producción → descartado (riesgo de filtración si el script falla; deuda de mantenimiento del script de anonimización; volumen de datos de prod insuficiente para justificar el esfuerzo)
- **Sintéticos (seed) → seleccionado**

**Justificación técnica:**
- Script `seed.js` que genera 50-100 facturas con casuísticas diversas: NIF español, NIF intracomunitario, facturas sin IVA, duplicados intencionados, CIFs alucinados, campos vacíos.
- Reproducible: destruir y recrear staging en 30 segundos con datos idénticos.
- Seguro: los datos nunca existieron, cero riesgo de filtración incluso con colaboradores.
- Evolutivo: cada caso raro descubierto en producción se añade al seed, convirtiéndolo en una suite de pruebas implícita.
- Sin deuda de mantenimiento: el seed evoluciona con el código, no requiere sincronización con el esquema de producción.

---

## DECISIÓN 5 — Política de aprobación de despliegues a producción

**Decisión:** Manual controlado con aprobación en GitHub

**Opciones evaluadas:**
- Automático (merge a `main` → deploy directo) → descartado (sin tests automatizados, deploy automático a producción es una bomba de relojería)
- Manual total (SSH + docker compose a mano) → descartado (no escala con colaboradores, sin trazabilidad, propenso a errores humanos)
- **Manual controlado → seleccionado**

**Justificación técnica:**
- Flujo: PR de `develop` → `main` → GitHub Actions ejecuta lint + build → requiere aprobación manual (environment `production` con protection rules) → aprobación con un clic → deploy automático al VPS.
- Último checkpoint humano antes de producción: revisar el build, comprobar staging una última vez.
- Trazabilidad completa: quién aprobó, cuándo, qué commit exacto se desplegó.
- ~30 segundos de fricción por deploy = precio bajo por la seguridad que aporta.
- Cuando haya tests automatizados con buena cobertura, se puede reconsiderar el deploy automático.

---

## DECISIÓN 6 — Gestión de secretos entre entornos

**Decisión:** Secretos completamente separados

**Opciones evaluadas:**
- Reutilizar secretos entre entornos → descartado (un leak en staging compromete producción; colaboradores con acceso a staging tendrían las llaves de prod; viola principio de mínimo privilegio)
- **Separar completamente → seleccionado**

**Justificación técnica:**
- Dos directorios independientes:
  - `/opt/setex-captu-facture/secrets/` → producción (ya existe)
  - `/opt/setex-captu-facture/secrets-staging/` → staging (nuevo)
- Cada entorno con su propio: `jwt_secret`, `postgres_password`, `redis_password`, `smtp_user`, `smtp_pass`, `backup_passphrase`.
- Blast radius acotado: staging comprometido = impacto cero en producción.
- Colaboradores futuros con acceso a staging no pueden forjar tokens ni conectarse a la BD de producción.
- Aplica a secretos internos del sistema. Las API keys externas (OpenAI, Azure) se tratan en la decisión 7.

---

## DECISIÓN 7 — Cuentas de APIs externas en staging

**Decisión:** API keys separadas para OpenAI y Azure

**Opciones evaluadas:**
- Mismas keys → descartado (staging consume cuota de producción; rate limits compartidos; leak en staging compromete la cuenta real)
- **Keys separadas → seleccionado**

**Justificación técnica:**
- **OpenAI:** segunda API key en la misma organización, con límite de gasto independiente ($5-10/mes para staging). Creación: 30 segundos, coste: 0€ de setup.
- **Azure Document Intelligence:** segundo recurso en la misma suscripción, tier Free F0 (500 páginas/mes gratis). Creación: 2 minutos, coste: 0€.
- Rate limits aislados: un seed masivo en staging no throttlea producción.
- Presupuesto controlado: tope de gasto independiente para staging.
- Seguridad: colaboradores no acceden a la key de producción.
- Monitorización limpia: consumo staging vs producción claramente separado en dashboards.

---

## DECISIÓN 8 — Usuario de despliegue en el VPS

**Decisión:** Usuario dedicado `deploy` con permisos mínimos

**Opciones evaluadas:**
- root → descartado (key SSH filtrada = control total del VPS; cualquier error en el pipeline ejecuta lo que sea; viola principio de mínimo privilegio)
- **Usuario dedicado → seleccionado**

**Justificación técnica:**
- Usuario: `deploy`
- Grupo: `docker` (ejecuta `docker compose` sin sudo)
- Home: `/home/deploy`
- SSH: key ed25519 exclusiva para GitHub Actions, sin passphrase
- Shell: `/bin/bash`
- Permisos: solo lectura+ejecución en `/opt/setex-captu-facture/app/`
- Sin sudoers, sin acceso a `/opt/setex-captu-facture/secrets/` (los secretos están montados en contenedores via docker-compose, `deploy` no necesita leerlos directamente)
- Restricción adicional: `command=` en `authorized_keys` limita qué comandos puede ejecutar la key SSH, incluso si es robada.
- Blast radius máximo si la key se filtra: reiniciar contenedores Docker. No puede instalar paquetes, modificar firewall, tocar SSH config ni acceder a secretos.

---

## RIESGOS ASUMIDOS

| # | Decisión | Riesgo asumido | Mitigación |
|---|----------|----------------|------------|
| 1 | GitHub Flow + develop | Sin protección de rama en GitHub sin plan de pago (repos privados gratuitos no tienen branch protection completa) | Disciplina de equipo + reglas de PR documentadas; upgrade a GitHub Team ($4/user/mes) cuando entren colaboradores |
| 2 | Staging en mismo VPS | Staging puede consumir recursos que necesita producción | Límites estrictos de CPU/RAM en docker-compose staging (0.25 CPU, 256MB por contenedor) |
| 3 | PostgreSQL separado | ~150MB extra de RAM en el VPS | Despreciable sobre 8 GB. Monitorizable. |
| 4 | Datos sintéticos | Seed puede no cubrir todas las casuísticas de producción | El seed se enriquece con cada caso raro descubierto en prod. Con el tiempo converge a cobertura completa. |
| 5 | Deploy con aprobación | Julio es single point of failure para aprobar deploys | Aceptable mientras es el único desarrollador. Cuando entren colaboradores, se puede añadir un segundo aprobador. |
| 6 | Secretos separados | Doble juego de secretos que mantener | Se genera una sola vez. Solo cambian si hay rotación. Coste de gestión mínimo. |
| 7 | API keys separadas | Dos keys que monitorizar | Alertas de billing configurables tanto en OpenAI como en Azure. Una sola revisión mensual. |
| 8 | Usuario deploy | La key SSH de deploy, aunque restringida con `command=`, permite reiniciar contenedores | `command=` limita el blast radius al mínimo necesario. Rotación de key periódica recomendada (cada 6 meses). |

---

## PREGUNTAS DEL EXPERTO

Las siguientes preguntas identifican gaps que deben resolverse antes de iniciar la implementación. Están ordenadas por impacto.

### Infraestructura y red

**1. ¿Cómo se va a aislar la red Docker de staging de la de producción?**
Se crearán redes Docker independientes: `setex_internal` (producción, ya existe) y `setex_staging_internal` (staging, nueva). Los contenedores de staging no tendrán visibilidad a la red de producción ni viceversa. Traefik, que vive fuera de ambas redes, será el único punto que conecta a ambas para rutear los subdominios correspondientes. En la práctica, Traefik necesitará estar conectado a ambas redes Docker para poder enrutar a los frontends de cada entorno.

**2. ¿Staging usará el mismo Traefik o uno propio?**
El mismo Traefik. Añadir un segundo Traefik consumiría recursos sin beneficio. Traefik ya soporta múltiples backends: se añaden labels Docker al frontend de staging para que `staging.setex-facturas.es` apunte a `setex-staging-frontend`. Un solo punto de entrada HTTPS, dos backends. Esto requiere que el DNS de `staging.setex-facturas.es` apunte a la misma IP (72.60.186.89).

**3. ¿Cómo se protege staging.setex-facturas.es contra acceso público?**
Autenticación básica (basicAuth) en Traefik para el subdominio de staging. Así cualquier acceso a `staging.setex-facturas.es` requiere usuario/contraseña antes de llegar al frontend. Alternativa: IP whitelisting si todos los desarrolladores tienen IP fija. Recomendación: basicAuth porque las IPs domésticas cambian.

**4. ¿El compose de staging será un archivo separado o una extensión del de producción?**
Archivo separado (`docker-compose.staging.yml`) en un directorio propio (`/opt/setex-captu-facture/staging/`). Compartir el compose con producción mediante profiles o extends introduce riesgo de `docker compose down` accidental que baje ambos entornos. Separación total = operaciones independientes.

**5. ¿Cómo se gestionan los puertos internos para evitar colisiones entre staging y producción?**
Los contenedores de staging usarán puertos internos distintos dentro de su red Docker, o — preferiblemente — no expondrán puertos al host en absoluto. Traefik rutea por nombre de contenedor/red, no por puerto del host. Así eliminamos colisiones de puertos por diseño.

### CI/CD y deploy

**6. ¿Cómo se almacena la key SSH de deploy en GitHub Actions?**
Como GitHub Actions Secret (`DEPLOY_SSH_KEY`). Nunca en el código, nunca en el compose, nunca en un archivo del repo. GitHub cifra los secrets con libsodium y solo se inyectan en el runner durante la ejecución del workflow.

**7. ¿Qué pasa si el deploy a staging falla (build roto, contenedor que no arranca)?**
El workflow de GitHub Actions debe verificar la salud del contenedor después del deploy (`docker compose ps`, health check). Si falla, el workflow falla y se notifica. Staging roto no afecta a producción. Opcionalmente, rollback automático al commit anterior en staging.

**8. ¿Se necesita un docker-compose.staging.yml completamente nuevo o se puede derivar del de producción?**
Nuevo, derivado manualmente. Copiar y adaptar: nombres de contenedores (`setex-staging-*`), red (`setex_staging_internal`), volúmenes, secretos, labels de Traefik, y límites de recursos. No usar `extends` ni includes dinámicos para evitar acoplamiento.

**9. ¿Cómo se maneja el cache-buster del frontend en staging?**
El cache-buster (`?v=YYYYMMDD-NNN`) debe actualizarse automáticamente en el pipeline de staging. Opción: el workflow de GitHub Actions inyecta el hash del commit como versión (`?v=${GITHUB_SHA:0:8}`), eliminando la gestión manual.

### Seguridad

**10. ¿Se aplicarán las 34 medidas de seguridad existentes también a staging?**
Sí, todas. Staging debe ser un espejo de producción en configuración de seguridad: helmet, rate limiting, magic bytes, bcrypt, JWT con token_version, audit_logs. La única diferencia son los secretos y las API keys. Si staging tiene menor seguridad que producción, los bugs de seguridad se escaparán.

**11. ¿La restricción horaria (404 de 00:00 a 06:00) se aplica también a staging?**
No. Staging debe estar disponible en cualquier momento para pruebas. La configuración de `security.json` de staging desactivará la restricción horaria.

**12. ¿Cómo se rotan los secretos de staging si se comprometen?**
Regenerar los archivos en `/opt/setex-captu-facture/secrets-staging/`, `docker compose -f docker-compose.staging.yml stop && up -d`. Procedimiento idéntico al de producción pero sin impacto en usuarios reales.

**13. ¿Se implementa fail2ban independiente para staging o el existente cubre ambos?**
El fail2ban del VPS es a nivel de host, cubre ambos entornos. El rate limiting a nivel de aplicación (Express) se configura en cada entorno independientemente. Staging puede tener rate limits más relajados para facilitar pruebas.

### Datos y backups

**14. ¿El script de backup cubre staging o solo producción?**
Solo producción. Staging contiene datos sintéticos regenerables con el seed. Hacer backup de staging es desperdiciar espacio y CPU de cifrado. Si staging se corrompe, se recrea con el seed en 30 segundos.

**15. ¿El seed.js se ejecuta automáticamente al levantar staging o manualmente?**
Automáticamente como parte del pipeline de CI/CD. El workflow puede incluir un paso `docker exec setex-staging-backend node seed.js` tras levantar los contenedores, o el `initDB()` de staging puede llamar al seed si la base de datos está vacía. Recomendación: ejecución condicional (solo si la tabla `uploads` está vacía) para no borrar datos de pruebas manuales.

### Git

**16. ¿Cómo se inicializa el repo desde el código existente en el VPS?**
`git init` en `/opt/setex-captu-facture/`, `.gitignore` bien configurado (excluir `secrets/`, `node_modules/`, `uploads/`, `*.env`, `ocr-service/venv/`), commit inicial con todo el código actual, push a GitHub como repo privado. El código actual se convierte en el primer commit de `main`.

**17. ¿Se hace limpieza del código antes del commit inicial o se commitea el estado actual?**
Commitear el estado actual tal cual. La limpieza (refactoring de server.js, eliminar PaddleOCR si se decide, etc.) se hace en ramas `feature/*` posteriores con trazabilidad completa. El primer commit es una foto fiel del estado de producción funcionando.

**18. ¿Qué política de `.gitignore` se aplica?**
Excluir: `secrets/`, `secrets-staging/`, `node_modules/`, `uploads/`, `*.env`, `.env*`, `ocr-service/venv/`, `*.log`, volúmenes de datos Docker. Incluir: todo el código fuente, docker-compose files, configuración (features.json, nginx.conf), documentación, scripts de backup/seed.

**19. ¿Se protegerá la rama `main` con branch protection rules?**
Sí, en cuanto sea técnicamente posible. Con GitHub Free en repos privados hay limitaciones, pero las reglas básicas (require PR, no direct push, require status checks to pass) son suficientes. Si entran colaboradores, upgrade a GitHub Team ($4/user/mes) para protection rules completas.

**20. ¿Cómo se sincronizan cambios hechos directamente en el VPS (hotfixes de emergencia)?**
Protocolo de emergencia: si hay que parchear producción directamente en el VPS, el cambio se hace, se documenta, y luego se replica como commit en una rama `hotfix/*` → merge a `main` y `develop`. Nunca dejar el VPS y el repo desincronizados más de 24 horas.

---

*Documento generado el 2026-04-17 · SETEX Captura de Facturas · Fase 0 completada*
