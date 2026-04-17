# REVISIÓN QUIRÚRGICA — ACCESO, AISLAMIENTO Y FUGAS
## Áreas: horizontal · vertical · multi-tenant · uploads · exports · OCR · Drive/n8n
**Fecha:** 2026-04-10 | Revisión #2 sobre código en producción
**Estado:** H-001 ✅ | H-002 ✅ | MT-001 ✅ | OCR-001 ✅ (aplicados 2026-04-10 sesión 15o)

---

## RESUMEN

| Severidad | Cantidad |
|-----------|----------|
| Alta      | 5        |
| Media     | 7        |
| Baja      | 3        |
| Info      | 2        |

Ningún hallazgo crítico de acceso horizontal entre usuarios. Los endpoints de lectura/escritura de facturas están correctamente aislados por `user_id`. Los problemas identificados se concentran en: limpieza de ficheros físicos (archivo acumulable en disco), datos de aprendizaje OCR que escapan del aislamiento tenant, y lógica de reconciliación dual que produce `dual_confirmed:true` con datos incompletos.

---

## ÁREA 1 — CONTROL DE ACCESO HORIZONTAL

### H-001
**Archivo:** `app/backend/src/server.js`  
**Función:** Limpieza de archivos huérfanos (`setInterval`)  
**Líneas:** 2727–2748  
**Categoría:** uploads / acumulación indefinida de ficheros  
**Severidad:** Alta  
**Prioridad:** Inmediata  

**Problema:**
El limpiador de archivos huérfanos solo escanea el directorio raíz `/app/uploads/` con `fs.readdir()` **no recursivo**:

```javascript
// LÍNEA 2730 — NO recursivo
const files = await fs.readdir(uploadsDir).catch(() => []);
```

Sin embargo, multer guarda los archivos en **subdirectorios por usuario**:
```javascript
// LÍNEA 414-417 — directorio destino del multer
const dir = `/app/uploads/${emailPrefix}`;
```

Y en `upload-confirm` se mueven a una estructura más profunda:
```javascript
// LÍNEA 1513
const destDir = `/app/uploads/${emailPrefix}/${nifFolder}`;
```

**Resultado:** Los archivos en `/app/uploads/julio/B12345678/factura.jpg` **nunca son escaneados** por el limpiador. Cualquier archivo que no llegue a ser confirmado (preview expirado, conexión cortada, duplicado rechazado, etc.) se acumula indefinidamente en el disco del servidor.

**Riesgo real:**
- **Fuga de datos en disco:** ficheros con datos fiscales (facturas de proveedores reales con importes, NIFs, etc.) que el sistema considera "rechazados" pero que permanecen en disco permanentemente.
- **Denegación de servicio:** disco del VPS (actualmente con ~10GB libres) puede llenarse con archivos huérfanos de previews no confirmados.
- **Acumulación garantizada:** cada factura duplicada, cada upload donde el usuario cierra el navegador sin confirmar, cada fallo de red tras subir pero antes de confirmar → un archivo permanente en disco.

**Parche — limpieza recursiva:**

```javascript
// Reemplazar el setInterval de limpieza con versión recursiva
async function cleanOrphanFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  let deleted = 0;
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      deleted += await cleanOrphanFiles(fullPath); // recursión
    } else if (!entry.name.startsWith('.')) {
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat || stat.mtimeMs > twoHoursAgo) continue;
      const exists = await pool.query(
        'SELECT 1 FROM uploads WHERE filename = $1',
        [entry.name]
      );
      if (exists.rows.length === 0) {
        await fs.unlink(fullPath).catch(() => {});
        deleted++;
      }
    }
  }
  return deleted;
}

setInterval(async () => {
  try {
    const deleted = await cleanOrphanFiles('/app/uploads');
    if (deleted > 0) logger.info(`[Cleanup] ${deleted} archivo(s) huérfano(s) eliminados`);
  } catch (err) {
    logger.warn('[Cleanup] Error:', err.message);
  }
}, 60 * 60 * 1000);
```

**Validación:** Subir una factura sin confirmar (cerrar el navegador antes de hacer click en "Guardar"). Esperar 2+ horas. El archivo debe desaparecer del directorio `/app/uploads/{user}/`.

---

### H-002
**Archivo:** `app/backend/src/server.js`  
**Función:** `POST /api/upload-confirm` — detección de duplicado  
**Líneas:** 1520–1524  
**Categoría:** uploads / fuga de fichero  
**Severidad:** Alta  
**Prioridad:** Urgente  

**Problema:**
Cuando se detecta una factura duplicada, el preview de Redis se borra correctamente, pero el **archivo físico NO se elimina**:

```javascript
// LÍNEAS 1520–1524
if (dupCheck.rows.length > 0) {
  await redisClient.del(`preview:${preview_id}`);
  // ← archivo preview.filePath SIGUE EN DISCO
  return res.json({ success: false, duplicate: true, ... });
}
```

El archivo estaba en `preview.filePath` (accesible desde el objeto preview leído de Redis). No se llama a `fs.unlink(preview.filePath)`.

**Riesgo real:** Cada intento de subir una factura duplicada deja una copia del documento (imagen JPEG/PNG/PDF) acumulada en disco sin referencia en BD. Combinado con H-001, estos archivos nunca se limpian.

**Parche:**

```diff
if (dupCheck.rows.length > 0) {
  await redisClient.del(`preview:${preview_id}`);
+  // Borrar el archivo físico del duplicado rechazado
+  fs.unlink(preview.filePath).catch(e =>
+    logger.warn(`[Cleanup] No se pudo borrar duplicado: ${e.message}`)
+  );
  return res.json({ success: false, duplicate: true, ... });
}
```

**Validación:** Subir la misma factura dos veces. Verificar que el segundo archivo no existe en disco tras recibir el mensaje de duplicado.

---

### H-003
**Archivo:** `app/backend/src/server.js`  
**Función:** Tabla `uploads` — sin endpoint de borrado para el usuario  
**Líneas:** N/A (ausencia de endpoint)  
**Categoría:** acceso horizontal / GDPR  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
No existe ningún endpoint `DELETE /api/facturas/:id` para que un usuario elimine sus propias facturas. Una vez confirmada una factura, el usuario no puede:
- Eliminarla del historial
- Rectificar un error de NIF que ya fue guardado
- Ejercer el derecho de supresión (GDPR Art. 17)

Los únicos que pueden borrar registros son los administradores.

**Riesgo:** Sin este control, los usuarios no pueden corregir datos incorrectos ni ejercer derechos GDPR. Esto no es un vector de ataque, pero es una brecha de control de acceso horizontal legítima (el usuario no tiene control sobre sus propios datos).

**Parche propuesto:**

```javascript
app.delete('/api/facturas/:id', authenticateToken, requireXHR, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'ID inválido' });
  try {
    // Solo puede borrar el propietario (aislamiento horizontal garantizado por user_id)
    const r = await pool.query(
      'SELECT file_path FROM uploads WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Factura no encontrada' });
    // Borrar archivo físico si existe
    if (r.rows[0].file_path) {
      const safePath = path.resolve(r.rows[0].file_path);
      if (safePath.startsWith('/app/uploads/')) {
        await fs.unlink(safePath).catch(() => {});
      }
    }
    await pool.query('DELETE FROM uploads WHERE id = $1', [id]);
    auditLog('UPLOAD_DELETED', { upload_id: id }, req.user.userId, req.ip);
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete factura error:', err);
    res.status(500).json({ error: 'Error al eliminar la factura' });
  }
});
```

---

## ÁREA 2 — CONTROL DE ACCESO VERTICAL

### V-001
**Archivo:** `app/backend/src/server.js`  
**Función:** `PUT /api/admin/users/:id`  
**Líneas:** 2644–2659  
**Categoría:** autorización vertical / escalada de privilegios  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
El endpoint de admin para actualizar usuarios solo permite modificar `company_name`. Sin embargo, no hay ningún endpoint para promover a admin ni para revocar admin a un usuario. La única forma de añadir un admin es directamente en PostgreSQL.

Este no es en sí mismo un problema de seguridad (es más seguro que tener un endpoint de escalada), pero significa que si un admin pierde acceso o es comprometido, no hay forma de revocar `is_admin` desde la propia aplicación.

**Riesgo:** Si la cuenta de un admin es comprometida, solo es posible revocar el acceso con acceso directo a PostgreSQL. No hay UI ni API para hacerlo.

**Recomendación:** Añadir al endpoint `PUT /api/admin/users/:id` la capacidad de modificar `is_admin` (con un guard extra: un admin no puede revocarse a sí mismo):

```javascript
// En PUT /api/admin/users/:id, añadir:
if (req.body.is_admin !== undefined) {
  if (id === req.user.userId) {
    return res.status(400).json({ error: 'No puedes modificar tu propio estado de administrador.' });
  }
  updates.push(`is_admin = $${p++}`);
  params.push(!!req.body.is_admin);
  // Incrementar token_version para revocar sesiones activas del usuario afectado
  updates.push(`token_version = token_version + 1`);
}
```

---

### V-002
**Archivo:** `app/backend/src/server.js`  
**Función:** `GET /api/admin/users`  
**Líneas:** 2625–2641  
**Categoría:** exposición de datos entre tenants (admin)  
**Severidad:** Baja  
**Prioridad:** Baja  

**Problema:**
El endpoint de admin devuelve la lista completa de todos los usuarios con sus emails, nombres de empresa, total de facturas e importe total. Esto es correcto para un administrador SETEX, pero existe un riesgo de escenario futuro: si en el futuro se añade un rol "admin de empresa" (manager de una empresa cliente) sin revisión cuidadosa, podría filtrar datos de otras empresas.

**Estado actual:** La autorización está correctamente restringida a `is_admin=true`. No es un problema en la implementación actual.

**Recomendación:** Documentar explícitamente que este endpoint devuelve datos de TODOS los usuarios del sistema y que cualquier nuevo rol sub-admin debe excluirlo o filtrarlo.

---

## ÁREA 3 — AISLAMIENTO MULTI-TENANT

### MT-001
**Archivo:** `app/backend/src/server.js`  
**Función:** `start()` → migración `known_cifs → company_catalog`  
**Líneas:** 2681–2700  
**Categoría:** multi-tenant / fuga de datos privados al scope global  
**Severidad:** Alta  
**Prioridad:** Urgente  

**Problema:**
En cada arranque del servidor, se ejecuta una migración que copia registros de `known_cifs` (tabla de aprendizaje privada POR USUARIO) al `company_catalog` (catálogo GLOBAL compartido entre todos los usuarios):

```javascript
// LÍNEAS 2681–2698 — ejecutado en cada startup
INSERT INTO company_catalog (proveedor_nombre, proveedor_nombre_norm, proveedor_nif, ...)
SELECT proveedor_nombre_norm, proveedor_nombre_norm, proveedor_nif, 'Migrado automáticamente'
FROM known_cifs
WHERE proveedor_nif IS NOT NULL ...
ON CONFLICT (proveedor_nif) DO NOTHING
```

Esta migración:
1. **No filtra por `user_id`**: toma registros de TODOS los usuarios
2. **Ejecuta en cada restart** (idempotente por `ON CONFLICT DO NOTHING`)
3. **Promueve datos privados a scope global** sin el conocimiento ni consentimiento del usuario
4. Aunque `ON CONFLICT DO NOTHING` evita sobrescribir, el **primer usuario que aprenda un NIF** define el nombre canónico global para todos

**Riesgo real:**
- Si el usuario A aprende `B12345678 → "Empresa del usuario A S.L."` (nombre interno que solo usa A), ese nombre aparece en el catálogo global para todos.
- Si el usuario A tiene un registro `known_cifs` con un NIF erróneo (ej. confusión OCR confirmada erróneamente), ese NIF incorrecto queda en el catálogo global.
- Cada restart potencialmente añade nuevas entradas privadas al catálogo global.

**Parche:**
La migración original tenía sentido cuando `known_cifs` era global (antes de añadir `user_id`). Ahora que el aprendizaje es por usuario, esta migración debe **eliminarse**:

```diff
-  // Migración: unificar known_cifs → company_catalog (solo inserta si el NIF no existe)
-  try {
-    await pool.query(`
-      INSERT INTO company_catalog (...)
-      SELECT ...
-      FROM known_cifs
-      ...
-      ON CONFLICT (proveedor_nif) DO NOTHING
-    `);
-    logger.info('[Migration] known_cifs → company_catalog OK');
-  } catch (err) {
-    logger.warn('[Migration] known_cifs→catalog:', err.message);
-  }
```

**Validación:** Verificar que tras eliminar la migración y reiniciar, `company_catalog` no crece con nuevas entradas. La tabla solo debe crecer cuando un admin añade entradas manualmente desde el panel.

---

### MT-002
**Archivo:** `app/backend/src/server.js`  
**Función:** `POST /api/upload-preview` → lookup company_catalog (fase 3)  
**Líneas:** 1201–1216  
**Categoría:** multi-tenant / confianza excesiva en datos globales  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
El catálogo global `company_catalog` tiene **máxima prioridad** en la resolución de CIF durante el preview, por encima del historial privado del usuario:

```javascript
// LÍNEAS 1201–1216 — company_catalog tiene prioridad 1 (máxima)
const catalogRes = await pool.query(
  `SELECT proveedor_nif, proveedor_nombre
   FROM company_catalog
   WHERE similarity(proveedor_nombre_norm, $1) > 0.50  // similitud fuzzy 50%
   ORDER BY similarity(proveedor_nombre_norm, $1) DESC
   LIMIT 1`,
  [nombreNorm]
);
if (catalogRes.rows.length > 0) {
  campos.proveedor_nif = catalogRes.rows[0].proveedor_nif;
  knownProvider = true;  // ← marca como "conocido" → NO pedirá revisión
}
```

Esto significa que si el catálogo global tiene un NIF incorrecto para un proveedor (sea por migración de MT-001, por un admin que cometió un error, o por datos antiguos del auto-learn ya eliminado), el sistema:
1. Sobreescribe el NIF leído por el OCR
2. Marca el proveedor como `knownProvider=true`
3. Reduce la probabilidad de que el usuario vea el modal de revisión (puede auto-confirmar)

**Relación con MT-001:** Si la migración de startup añadió nombres con errores tipográficos (la migración usa `proveedor_nombre_norm` como nombre canónico, que es la versión normalizada sin tildes), y el threshold fuzzy de 0.50 hace un match, datos equivocados se imponen sobre la lectura OCR.

**Parche:**
La jerarquía debería ser: `known_cifs del usuario` (priority 1) → `company_catalog admin` (priority 2). El catálogo global no debería **sobrescribir** el historial privado del usuario:

```diff
// Cambiar el orden de lookups: usuario primero, catálogo global como fallback
// 1º) Historial del usuario (confirmaciones previas)
const knownRes = await pool.query(
  'SELECT proveedor_nif FROM known_cifs WHERE user_id = $1 AND proveedor_nombre_norm = $2 ...',
  [userInfo.userId, nombreNorm]
);
if (knownRes.rows.length > 0) {
  campos.proveedor_nif = knownRes.rows[0].proveedor_nif;
  knownProvider = true;
}

// 2º) Catálogo admin (solo si el usuario no tiene historial propio)
if (!knownProvider) {
  const catalogRes = await pool.query(
    `SELECT proveedor_nif FROM company_catalog WHERE similarity(...) > 0.50 ...`
  );
  if (catalogRes.rows.length > 0) {
    campos.proveedor_nif = catalogRes.rows[0].proveedor_nif;
    // knownProvider = true; ← NO marcar como "conocido" desde catálogo global
    // El catálogo sugiere el NIF pero no suprime la revisión manual
  }
}
```

---

### MT-003
**Archivo:** `app/backend/src/server.js`  
**Función:** `POST /api/upload-confirm` — `confirmed_receptor_nif` sin validación  
**Líneas:** 1612  
**Categoría:** multi-tenant / integridad de datos  
**Severidad:** Media  
**Prioridad:** Baja  

**Problema:**
El `confirmed_receptor_nif` enviado por el usuario en la confirmación no pasa por `validateSpanishTaxId()`, solo por `cleanNifVal()` que únicamente limpia caracteres:

```javascript
// LÍNEA 1532 — solo limpieza de caracteres, sin validación de formato
const cleanNifVal = (v) => v ? String(v).toUpperCase().replace(/[^A-Z0-9]/g, '') || null : null;

// LÍNEA 1612 — receptor_nif va directo a BD sin validar
cleanNifVal(confirmed_receptor_nif || campos.receptor_nif || ocrFull.receptor_nif),
```

En contraste, `confirmed_nif` (proveedor) sí es validado (líneas 1436–1439):
```javascript
const cifCheck = validateSpanishTaxId(finalNif);
if (!cifCheck.valid) return res.status(400).json({ error: `CIF/NIF inválido: ...` });
```

**Riesgo real:** Un usuario puede guardar cualquier string alfanumérico como su `receptor_nif` (ej: "FAKE123", "XXXXXXXX"). Aunque esto no afecta a otros usuarios directamente (el `receptor_nif` es solo metadato de su propia factura), datos incorrectos en el campo receptor pueden producir:
- Matching incorrecto en la lógica `computeDisplayCompanies`
- Falsos positivos/negativos en los informes del admin cuando filtra por `company_nif`

**Parche:**

```diff
// En upload-confirm, tras calcular finalNif, añadir:
const finalReceptorNif = cleanNifVal(confirmed_receptor_nif || campos.receptor_nif || ocrFull.receptor_nif);
if (finalReceptorNif) {
  const recCheck = validateSpanishTaxId(finalReceptorNif);
  if (!recCheck.valid && recCheck.severity === 'blacklist') {
    // Solo rechazar si está en la lista negra de alucinaciones; formatos inusuales se permiten
    logger.warn(`[Confirm] receptor_nif sospechoso rechazado: ${finalReceptorNif}`);
    // No bloquear la factura, pero limpiar el campo
    // (el receptor puede ser un NIE extranjero, etc.)
  }
}
```

---

## ÁREA 4 — SUBIDA DE ARCHIVOS Y PREVIEWS TEMPORALES

### UP-001
**Archivo:** `app/backend/src/server.js`  
**Función:** `POST /api/upload-preview` → tiempo de vida del fichero físico  
**Líneas:** 1333, 1349  
**Categoría:** uploads / fuga de datos en disco  
**Severidad:** Media  
**Prioridad:** Alta  

**Problema:**
El preview en Redis tiene TTL de 30 minutos (`setex(..., 1800, ...)`), pero el **archivo físico no tiene TTL**. Cuando el preview expira en Redis, el usuario recibe 410 si intenta confirmar. Pero el archivo JPEG/PNG/PDF sigue en disco.

El limpiador de huérfanos tiene un umbral de 2 horas (`Date.now() - 2 * 60 * 60 * 1000`) y (antes de la corrección de H-001) solo escanea el directorio raíz.

**Escenario problemático:**
1. Usuario sube factura → archivo guardado en `/app/uploads/julio/factura.jpg`
2. Preview en Redis con TTL 30 min
3. Usuario no confirma en 30 min → preview expira
4. El archivo queda en disco sin entrada en BD ni en Redis
5. El limpiador (con H-001 corregido) lo borraría en 2 horas como huérfano

**Tras la corrección H-001:** el archivo sería borrado correctamente a las 2 horas.
**Sin H-001:** el archivo es permanente.

Este hallazgo documenta la dependencia entre UP-001 y H-001: UP-001 es el vector, H-001 es el mecanismo de contención. Sin H-001 corregido, UP-001 es un problema de fuga de datos.

**No requiere parche adicional** si H-001 es corregido. Solo requiere que el TTL del limpiador (2 horas) sea >= TTL del preview Redis (30 min), lo cual ya se cumple.

---

### UP-002
**Archivo:** `app/backend/src/server.js`  
**Función:** No existe endpoint `DELETE /api/upload-preview/{id}`  
**Categoría:** uploads / gestión del ciclo de vida  
**Severidad:** Baja  
**Prioridad:** Baja  

**Problema:**
No existe un endpoint que permita al usuario cancelar explícitamente un preview y limpiar el archivo de forma inmediata. Cuando el usuario decide no confirmar (hace click en "Cancelar" en el modal), el frontend simplemente descarta el `preview_id` localmente, pero:
- El preview permanece en Redis hasta que expire (30 min)
- El archivo permanece en disco hasta el limpiador de huérfanos (2 horas)

**Riesgo:** Bajo. Los datos son del propio usuario. Pero el archivo con datos fiscales de terceros (nombre y NIF del proveedor en el JPEG) permanece en un servidor externo durante hasta 2 horas más de lo necesario.

**Parche recomendado:**

```javascript
app.delete('/api/upload-preview/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const raw = await redisClient.get(`preview:${id}`);
    if (!raw) return res.json({ success: true }); // ya expirado, no error
    const preview = JSON.parse(raw);
    // Solo puede cancelar el propietario del preview
    if (preview.userInfo.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Sin acceso' });
    }
    await redisClient.del(`preview:${id}`);
    await fs.unlink(preview.filePath).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al cancelar preview' });
  }
});
```

---

## ÁREA 5 — EXPORTACIONES Y DESCARGAS

### EX-001
**Archivo:** `app/backend/src/server.js`  
**Función:** `GET /api/mis-facturas/export.xlsx` y `/api/admin/facturas/export.xlsx`  
**Líneas:** 1752–1841, 2165–2287  
**Categoría:** exports / fuga de datos  
**Severidad:** Media  
**Prioridad:** Alta  

**Problema:**
Ambos exports generan el XLSX **en memoria** usando `ExcelJS` y lo escriben directamente al `res` (stream). Para 10.000 facturas con todos sus campos, el workbook puede consumir 100–300 MB de RAM del backend durante la generación.

Con el límite de memoria de 512 MB del contenedor:
- 2 exports concurrentes de 10K facturas pueden agotar la RAM
- Node.js puede ser terminado por OOM Killer, causando un outage completo de la aplicación

**Parche — añadir Content-Length estimado y timeout:**

No existe una solución perfecta sin cambiar la librería. Las mitigaciones viables:
1. **Reducir el LIMIT**: De 10000 a 2000 (reduce RAM en 5×)
2. **Serializar exports**: Mutex en Redis para max 1 export concurrente por usuario
3. **Rate limit específico para exports**:

```javascript
const exportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 minutos
  max: 2,                    // 2 exports por usuario en 5 min
  keyGenerator: (req) => String(req.user?.userId || req.ip),
  message: { error: 'Demasiadas exportaciones. Espera unos minutos.' }
});
app.get('/api/mis-facturas/export.xlsx', authenticateToken, exportLimiter, async (req, res) => {
```

---

### EX-002
**Archivo:** `app/backend/src/server.js`  
**Función:** `GET /api/admin/facturas/export.xlsx`  
**Líneas:** 2165–2287  
**Categoría:** exports admin / fuga de datos entre tenants  
**Severidad:** Baja  
**Prioridad:** Baja  

**Problema:**
El export admin incluye `usuario_email` de cada factura. No hay ninguna redacción de datos. Si en el futuro se añade un rol de "gestor de empresa" con acceso parcial al panel admin, este endpoint expondría los emails de usuarios de otras empresas.

**Estado actual:** Solo accesible a `is_admin=true`. Correcto para los admins SETEX.

**Recomendación:** Documentar que este endpoint devuelve PII de todos los usuarios y debe mantenerse restringido a `is_admin=true` sin excepciones. Añadir comentario explícito en el código.

---

## ÁREA 6 — OCR: RECONCILIACIÓN Y TRAZABILIDAD

### OCR-001
**Archivo:** `app/backend/src/ocr/index.js`  
**Función:** `compareOCRResults()` → lógica `nifAgree`  
**Líneas:** 112, 115  
**Categoría:** OCR / confianza inflada  
**Severidad:** Alta  
**Prioridad:** Alta  

**Problema:**
La variable `nifAgree` (que contribuye a `dual_confirmed`) es `true` cuando **cualquiera de los dos NIFs está ausente**:

```javascript
// LÍNEA 112
const nifAgree = !oNif || !aNif || oNif === aNif;
//               ↑ true si OpenAI no leyó NIF
//                        ↑ true si Azure no leyó NIF
```

Esto significa que `dual_confirmed = true` cuando:
- OpenAI lee `B12345678` y Azure no lee ningún NIF → `nifAgree = true`
- Azure lee `B12345678` y OpenAI no lee ningún NIF → `nifAgree = true`
- Solo uno de los dos motores encontró el NIF y el otro no lo vio

**Efecto cascada en la lógica de preview:**
```javascript
// SERVER.JS LÍNEA 1278
const cifConfident = !nifUncertain && digitCheck !== false;
// SERVER.JS LÍNEA 1286
const autoConfirm = !requiresReview && userAutoConfirmPref && (knownProvider || digitCheck === true);
```

Un NIF confirmado solo por un motor pero con `dual_confirmed=true` puede pasar a `autoConfirm=true` si el dígito de control es correcto. La factura se guarda sin que el usuario la revise, con un NIF que solo un motor leyó.

**Riesgo real:** Una factura puede ser auto-confirmada con un NIF que solo OpenAI leyó (Azure no lo encontró), presentando la fiabilidad visual de una confirmación dual que en realidad no ocurrió.

**Parche:**

```diff
// LÍNEA 112 en ocr/index.js
-const nifAgree = !oNif || !aNif || oNif === aNif;
+// nifAgree = true SOLO si ambos motores encontraron el NIF Y coinciden
+// Si uno no encontró el NIF, no es "acuerdo" sino "ausencia de datos" → dual_confirmed no aplica al NIF
+const nifAgreement = (!oNif && !aNif)   // ambos no encontraron → neutral
+  ? 'both_missing'
+  : (oNif && aNif && oNif === aNif)      // ambos encontraron y coinciden → acuerdo real
+  ? 'confirmed'
+  : (oNif && aNif && oNif !== aNif)      // ambos encontraron pero discrepan → desacuerdo
+  ? 'conflict'
+  : 'single_source';                     // solo uno encontró
+const nifAgree = nifAgreement === 'confirmed' || nifAgreement === 'both_missing';

// Usar nifAgreement en el resultado para trazabilidad
// En el objeto devuelto:
nif_agreement: nifAgreement,  // 'confirmed' | 'both_missing' | 'conflict' | 'single_source'
```

**En server.js, ajustar auto-confirm para single_source:**
```javascript
// No auto-confirmar si el NIF solo fue leído por un motor (aunque pase dígito de control)
const nifSingleSource = ocrData?.nif_agreement === 'single_source';
const autoConfirm = !requiresReview && userAutoConfirmPref
  && (knownProvider || (digitCheck === true && !nifSingleSource));
```

**Validación:** Procesar una factura donde Azure no extrae el NIF pero OpenAI sí. Verificar que `dual_confirmed=false` o que `nif_agreement='single_source'` y que no se auto-confirma.

---

### OCR-002
**Archivo:** `app/backend/src/ocr/index.js`  
**Función:** `compareOCRResults()` → `es_factura_valida` OR  
**Líneas:** 152  
**Categoría:** OCR / clasificación incorrecta de documentos  
**Severidad:** Media  
**Prioridad:** Media  

**Problema:**
La fusión de `es_factura_valida` usa OR lógico:

```javascript
// LÍNEA 152
es_factura_valida: openaiRes.es_factura_valida !== false || azureRes.es_factura_valida !== false,
```

Si OpenAI detecta que NO es una factura (`es_factura_valida: false`) pero Azure no lo detecta (retorna `undefined` o `true`), el resultado merged considera que SÍ es una factura válida.

**Escenario:** Un usuario sube un ticket de supermercado. OpenAI correctamente lo rechaza como "no es factura con CIF registrado". Azure retorna un resultado con campos parciales (amount, date) pero sin `es_factura_valida: false`. El merged devuelve `es_factura_valida: true`, la imagen pasa a procesarse como factura.

**Parche:**

```diff
-es_factura_valida: openaiRes.es_factura_valida !== false || azureRes.es_factura_valida !== false,
+// Si AMBOS tienen opinión explícita, se requiere consenso. Si solo uno opina, ese manda.
+es_factura_valida: openaiRes.es_factura_valida === false && azureRes.es_factura_valida === false
+  ? false  // ambos dicen que no es factura → rechazar
+  : openaiRes.es_factura_valida !== false && azureRes.es_factura_valida !== false,
+  // en caso de desacuerdo → conservador: rechazar para revisión
```

---

### OCR-003
**Archivo:** `app/backend/src/ocr/index.js`  
**Función:** `amountsAgree()` → tolerancia 2%  
**Líneas:** 86  
**Categoría:** OCR / trazabilidad de importes  
**Severidad:** Baja  
**Prioridad:** Baja  

**Problema:**
La tolerancia del 2% para considerar que dos importes "coinciden" puede ocultar discrepancias significativas en facturas de alto valor:

```javascript
// LÍNEA 86
return Math.abs(fa - fb) / max < 0.02; // 2% tolerancia
```

| Factura | OpenAI | Azure | Diferencia | ¿Acuerdo? |
|---------|--------|-------|-----------|-----------|
| €1.000 | 1000 | 1018 | €18 | ✅ (1.8%) |
| €50.000 | 50000 | 50900 | €900 | ✅ (1.8%) |
| €100.000 | 100000 | 101900 | €1.900 | ✅ (1.9%) |

Una discrepancia de €1.900 en una factura de €100.000 se considera "de acuerdo" y no se alerta al usuario.

**Parche — umbral absoluto + porcentual:**

```diff
function amountsAgree(a, b) {
  const fa = normalizeToFloat(a);
  const fb = normalizeToFloat(b);
  if (fa == null || fb == null) return true;
  if (fa === 0 && fb === 0) return true;
  const max = Math.max(Math.abs(fa), Math.abs(fb));
  if (max === 0) return true;
-  return Math.abs(fa - fb) / max < 0.02;
+  const absDiff = Math.abs(fa - fb);
+  const relDiff = absDiff / max;
+  // Acuerdo si diferencia < 2% Y < €5 absoluto
+  // Esto evita falsos "acuerdos" en facturas de alto valor
+  return relDiff < 0.02 && absDiff < 5.0;
}
```

---

## ÁREA 7 — GOOGLE DRIVE Y N8N

### GN-001
**Archivo:** `app/backend/src/server.js`  
**Función:** `start()` → migración `known_cifs → company_catalog`  
**Categoría:** info / estado de Drive/n8n  
**Severidad:** Info  

**Estado actual:**
- `use_n8n: false` en `features.json` → el webhook n8n está completamente desactivado
- El worker de Drive/Sheets (`invoiceWorker.js`) **no existe** en el contenedor actual (directorio `queue/` solo contiene `index.js`)
- El campo `n8n_sent = true` se escribe directamente en el INSERT de `upload-confirm` (línea 1600)
- Los secrets `google_sa_key`, `azure_di_key`, `azure_di_endpoint` existen como ficheros pero pueden ser placeholders

**No hay vectores de ataque activos en Drive/n8n.** El único riesgo residual es que si se activa `use_n8n: true` en `features.json` (cambio instantáneo sin rebuild), el backend intentaría llamar a `invoiceWorker.js` que no existe.

**Verificar:**
```bash
cat /opt/setex-captu-facture/secrets/google_sa_key.json | head -3
# Si retorna {"type": "service_account"...} → credenciales reales, proteger
# Si retorna "INSERTAR_AQUI" → placeholder, sin riesgo
```

---

### GN-002
**Archivo:** `app/backend/src/ocr/index.js`  
**Función:** `getSecret()` — empresa_nif enviado a APIs externas  
**Categoría:** privacidad / datos a terceros  
**Severidad:** Baja  

**Problema:**
El NIF de la empresa del usuario (`empresa_nif`) se incluye en el prompt enviado a OpenAI y Azure DI para contextualizar el OCR:

```javascript
// ocr/openai.js línea ~50
`- Nuestro NIF conocido es: ${empresa_nif} (${empresa_nombre}).`
```

Esto significa que el NIF fiscal de la empresa del usuario (dato sensible) se envía a servidores de OpenAI y Microsoft Azure como parte del contexto del prompt, junto con la imagen de la factura.

**Contexto:** Esto es funcional y necesario para que la IA desambigüe correctamente emisor/receptor. Pero implica que datos personales/empresariales españoles salen del servidor a terceros en EEUU, lo cual tiene implicaciones GDPR (RGPD).

**Recomendación (no urgente):** Verificar que el contrato de datos con OpenAI y Azure cubre el procesamiento de NIFs españoles como datos personales y que el DPA (Data Processing Agreement) está firmado. Documentar en la política de privacidad de SETEX que los documentos son procesados por APIs de IA de terceros.

---

## PLAN DE ACCIÓN

### Aplicar inmediatamente (esta sesión)
| ID | Código | Descripción | Esfuerzo |
|----|--------|-------------|----------|
| 1 | H-001 | Limpieza recursiva de archivos huérfanos | 30 min |
| 2 | H-002 | Borrar archivo físico en detección de duplicado | 10 min |
| 3 | MT-001 | Eliminar migración `known_cifs → company_catalog` del startup | 15 min |
| 4 | OCR-001 | Cambiar `nifAgree` para distinguir `single_source` de confirmación real | 45 min |

### Planificar próximo sprint
| ID | Código | Descripción | Esfuerzo |
|----|--------|-------------|----------|
| 5 | OCR-002 | Lógica `es_factura_valida` más conservadora | 30 min |
| 6 | MT-002 | Cambiar jerarquía: known_cifs primero, catalog como sugerencia | 45 min |
| 7 | EX-001 | Rate limiter en endpoints de export XLSX | 20 min |
| 8 | V-001 | Endpoint para promover/revocar admin con invalidación de sesión | 1h |
| 9 | H-003 | Endpoint DELETE /api/facturas/:id para el usuario | 45 min |
| 10 | UP-002 | Endpoint DELETE /api/upload-preview/:id para cancelación explícita | 30 min |

### Backlog
| ID | Código | Descripción |
|----|--------|-------------|
| 11 | OCR-003 | Tolerancia absoluta+relativa en amountsAgree |
| 12 | MT-003 | Validar receptor_nif con lista negra de alucinaciones |
| 13 | GN-001 | Verificar si google_sa_key.json tiene credenciales reales |
| 14 | GN-002 | DPA con OpenAI/Azure para RGPD |

---

*Revisión #2 — SETEX Captura Facturas · xanflatest.com · 2026-04-10*
