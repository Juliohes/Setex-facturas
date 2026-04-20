# Guía de Usuario — SETEX Captura de Facturas

> **Bienvenido/a** a SETEX, tu aplicación web para capturar facturas con IA.
> Esta guía cubre todo lo esencial para empezar a usarla en 2 minutos.

---

## 🔑 1. Acceso a la aplicación

**URL de producción**: [https://setex-facturas.es](https://setex-facturas.es)

Las **credenciales iniciales** (email + contraseña) se te han entregado por canal seguro.

### Primer acceso
1. Entra en la URL.
2. Introduce tu email y contraseña.
3. Haz clic en "Iniciar sesión".

### Si olvidas tu contraseña
1. En la pantalla de login, haz clic en "¿Olvidaste tu contraseña?".
2. Introduce tu email. Recibirás un enlace de recuperación (válido 1 hora).
3. Sigue el enlace y establece una nueva contraseña.

---

## 📷 2. Subir una factura

La aplicación está optimizada para **móvil**: puedes fotografiar la factura directamente o subir un fichero desde la galería o ordenador.

### Paso a paso

1. **Elige el tipo de factura** arriba:
   - 📥 **Factura recibida** (compra) — la empresa te envía esa factura a ti
   - 📤 **Factura emitida** (venta) — tú has emitido esa factura a un cliente

2. **Captura o sube el fichero**:
   - **📷 Capturar Foto** → usa la cámara del dispositivo (ideal móvil)
   - **📄 Subir Archivo** → selecciona PDF o imagen (JPG/PNG) de hasta 10 MB

3. **Espera 3-6 segundos** mientras la IA extrae los datos:
   - Número de factura, fecha, NIF/CIF del proveedor
   - Base imponible, IVA, IRPF (si aplica), total
   - Razón social del proveedor y del cliente

4. **Revisa y confirma**:
   - Aparece un modal con los campos rellenados automáticamente
   - Repasa que todo sea correcto; si algo está mal, **edita el campo** manualmente
   - Haz clic en **"Confirmar y guardar"**

5. **Listo** — la factura se guarda en tu historial y queda disponible para consulta.

### ¿Qué pasa si la IA se equivoca?

Puede ocurrir en facturas con:
- Fotografía borrosa o con reflejos
- Formato muy inusual
- Texto manuscrito o impresora con tinta clara

En todos los casos puedes **editar los campos manualmente** antes de confirmar. La IA nunca guarda nada sin tu aprobación explícita.

---

## 📋 3. Ver el historial

En la pantalla principal, debajo del botón de subida, verás tus facturas recientes. Haz clic en cualquiera para ver el detalle completo.

---

## ⚠️ 4. Mensajes comunes

| Mensaje | Qué significa |
|---|---|
| "El CIF ... no coincide con ninguna empresa registrada" | El CIF que tienes en tu perfil no está registrado en SETEX. Verifícalo en tu perfil o contáctanos. |
| "Esta factura ya ha sido registrada" | La misma factura (mismo NIF + fecha + total) ya está en tu historial |
| "Tipo de archivo no permitido" | Solo se aceptan PDF, JPG y PNG |
| "El archivo supera el límite" | Máximo 10 MB por fichero |
| "Demasiados intentos. Espera unos minutos" | Protección anti-abuso. Espera 15 min e inténtalo de nuevo |

---

## 🔒 5. Seguridad de tus datos

- La aplicación usa **HTTPS con TLS 1.2+** (comunicación cifrada end-to-end).
- Tu contraseña se guarda con **bcrypt (cost 12)** — nadie puede recuperarla, ni siquiera nosotros.
- Los ficheros se almacenan en el servidor cifrado y solo son accesibles por ti.
- Hacemos **backups cifrados diarios** con verificación de integridad automática.
- **Registramos todas las acciones sobre tus datos** (audit log para cumplimiento RGPD).

### Tus derechos (RGPD)

- **Acceso**: puedes descargar todos tus datos en formato JSON desde tu perfil (endpoint `/api/me/export`).
- **Supresión**: puedes solicitar el borrado de tu cuenta y todas tus facturas (endpoint `/api/me/account` DELETE) o por email.

Tiempo de respuesta garantizado: **< 30 días** (objetivo operativo: < 7 días).

---

## 📞 6. Soporte

Si la aplicación no funciona como esperas:

1. Recarga la página (Ctrl + F5 / Cmd + Shift + R).
2. Comprueba tu conexión a internet.
3. Si persiste, **contacta**: [juliohesuni@gmail.com](mailto:juliohesuni@gmail.com)

**Tiempo medio de respuesta**: menos de 24h en días laborables.

**Incidencias críticas** (la aplicación no es accesible): respondemos lo antes posible en horario 9:00-20:00 Madrid.

---

## 🌙 7. Ventana de mantenimiento diaria

Por razones de seguridad operativa, la aplicación **puede estar temporalmente inaccesible** entre las **00:00 y 06:00 (hora Madrid)**. Si accedes en ese horario, es normal recibir una página 404.

> Esta ventana se eliminará en próximas actualizaciones (mes 2) — se sustituirá por rate limiting adaptativo que no bloquea usuarios legítimos.

---

## 📅 8. Próximas mejoras programadas

En las próximas 4 semanas iremos introduciendo (sin impacto visible en producción):
- Tests automatizados y CI/CD más robusto.
- Monitorización avanzada con alertas proactivas.
- Autenticación multifactor opcional (passkeys / biométrica).
- Preparación a normativa Verifactu española.
- Telemetría de calidad del OCR (para detectar degradaciones antes de que te afecten).

Cualquier cambio con impacto visible se comunicará previamente con ventana de mantenimiento acordada.

---

**Versión**: 1.0 — 2026-04-21
**Mantenedor**: Julio Hesuni — juliohesuni@gmail.com
