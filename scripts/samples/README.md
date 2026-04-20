# scripts/samples/ — fuera del repo

Coloca aquí una factura JPG/PDF fija que el smoke test diario (`scripts/smoke-test-ocr.js`)
usará para verificar que OpenAI GPT-4.1 y Azure DI siguen respondiendo correctamente.

Nombre por defecto: `factura-muestra.jpg`. Se puede cambiar con la variable de entorno
`SETEX_OCR_SAMPLE`.

**Privacidad**: este directorio está en `.gitignore` para evitar que facturas reales
con datos fiscales/personales acaben en GitHub. No publicar.
