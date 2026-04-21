# Tests multi-IVA — Super-tarea cliente SETEX 2026-04-21

Parte 6/7 de la super-tarea multi-IVA. Garantiza que el refactor mantiene la coherencia del desglose en todas las capas.

## Componentes

### 1. Tests unitarios puros · `test-helper-unit.js`

Ejecutable Node sin dependencias externas. Cubre `normalizeConfirmedLineasIva` y `mergeLineasIva` con 25 casos:

- null / array vacío → lineas null
- 1 tramo válido → línea única + agregados correctos
- 3 tramos hostelería (21% + 10% + 4%) → sumas correctas + pct dominante
- línea inválida → descarte con warning
- todo inválido → errors + lineas null
- formato inglés "100.00" → parseado
- porcentaje entero "21" → normalizado "21,0"
- descripción truncada a 120 chars
- productos missing → normalizado a []
- merger null+null, OpenAI+empty, tramos distintos, dedup por descripcion+importe

**Ejecución:**
```bash
node tests/multi-iva/test-helper-unit.js
```

Salida: `25 pasaron · 0 fallaron`. Exit code 0 si todos pasan, 1 si alguno falla.

Integración CI recomendada (pendiente parte 7): añadir al job `ci.yml` como check post-lint.

### 2. Playwright spec · `../e2e/specs/04-admin-desglose.spec.js`

3 tests E2E contra staging:

- Login admin + listado API expone `lineas_iva` en response
- Columna "Desglose" renderiza badge `🧾 N tramos` y abre modal con ≥2 bloques
- PUT `/api/admin/facturas/:id` con `lineas_iva` recalcula agregados (base + cuota + iva_porcentaje dominante) + restaura estado original

El 2º test se `skip` automáticamente si no hay facturas multi-IVA en staging (no falla — avisa).

**Ejecución:**
```bash
cd tests/e2e
npm install                                    # una vez
npm run install:browsers                       # una vez
export SETEX_E2E_HTTP_BASIC_USER=setex
export SETEX_E2E_HTTP_BASIC_PASSWORD=<ask Julio>
npx playwright test specs/04-admin-desglose
```

### 3. Smoke manual con factura real (cuando Julio tenga una)

Cuando tengas una foto/PDF de factura **real multi-IVA** (hostelería, ferretería, servicios mixtos con 21%+10%+4%):

**Flujo completo de validación:**

1. Copiar la factura a `tests/e2e/fixtures/factura-multi-iva.jpg` (NO commitear — está en .gitignore)

2. Subir a staging como usuario normal (`empresa1@staging.setex.local` / `Staging2026!`):
   ```
   https://staging.setex-facturas.es
   → Login → Subir factura
   ```

3. Verificar en el modal de comprobación (parte 3/7):
   - ¿Aparece el banner `🧾 Esta factura tiene varios tipos de IVA`?
   - ¿Hay N bloques (uno por tramo)?
   - ¿Cada bloque tiene inputs `IVA %` / `BASE TRAMO` / `CUOTA TRAMO` editables?
   - ¿Hay productos listados dentro de cada tramo? (si el OCR los detectó)
   - ¿El resumen auto-calcula Σ bases, Σ cuotas, tipo dominante?
   - Editar algo → ¿se recalcula el resumen?
   - Confirmar → ¿toast verde "factura guardada"?

4. Verificar en admin (parte 4/7):
   ```
   https://staging.setex-facturas.es/admin-facturas.html
   → Login admin (admin@staging.setex.local)
   ```
   - ¿Aparece la factura recién subida con badge `🧾 N tramos` en la columna Desglose?
   - Click en el badge → ¿se abre el modal con los N bloques?
   - Editar un tramo → Guardar → ¿fila Tabulator se actualiza sin recargar?
   - Volver a abrir el modal → ¿conserva los cambios?

5. Verificar en Excel (parte 5/7):
   - Descargar Excel desde el panel admin
   - Abrir el fichero → debe tener **2 hojas**: `Facturas` y `Desglose IVA`
   - Hoja `Desglose IVA` debe tener 1 fila por tramo de esa factura
   - Columna `Productos del tramo` debe concatenar las descripciones con ` · `

6. Verificar en BD (opcional, solo si sabes SQL):
   ```bash
   docker exec setex-staging-postgres psql -U setex_user -d setex_db \
     -c "SELECT id, base_imponible, iva_porcentaje, cuota_iva, lineas_iva \
         FROM uploads ORDER BY id DESC LIMIT 1;" | cat
   ```
   - `lineas_iva` JSONB debe contener el array con productos
   - `base_imponible` = suma de bases de los tramos
   - `cuota_iva` = suma de cuotas de los tramos
   - `iva_porcentaje` = el del tramo con mayor cuota

**Reporte:** tras smoke OK, notificar a Julio que la parte 7/7 (deploy prod + tag v1.1.0) puede proceder.

## Histórico

- **2026-04-21 parte 6/7**: tests unitarios (25 OK) + spec Playwright + doc smoke manual. Smoke con factura real pendiente de que Julio tenga una. PR #59 draft consolida partes 1-6.
