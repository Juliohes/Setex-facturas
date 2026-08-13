# SETEX · El frontend que hace la foto

Hiperdocumento de transferencia · v1.0

Especificación completa y autocontenida de la interfaz de usuario final de SETEX Captura de Facturas: la PWA con la que un cliente fotografía una factura, la IA la lee, él corrige y guarda. Todo lo necesario para reconstruirla en otra aplicación sin volver a leer el código original.

| Campo | Valor |
| --- | --- |
| Origen | `/opt/setex/prod/app/frontend/src` |
| Alcance | Solo usuario final |
| Stack actual | Vanilla JS · sin bundler |
| Superficie | 3.507 líneas propias |
| Fecha | 2026-08-01 |
| Backend pareja | Express 4.18 · Node 20 |

---

## Índice

1. [Alcance e inventario de ficheros](#01--alcance-e-inventario-de-ficheros)
2. [Arquitectura de carga y ejecución](#02--arquitectura-de-carga-y-ejecución)
3. [Sistema de diseño](#03--sistema-de-diseño)
4. [Mapa de pantallas y máquina de estados](#04--mapa-de-pantallas-y-máquina-de-estados)
5. [Autenticación — el módulo más portable](#05--autenticación--el-módulo-más-portable)
6. [Pantalla principal de captura](#06--pantalla-principal-de-captura)
7. [Cámara y detección de documento](#07--cámara-y-detección-de-documento)
8. [Subida y lectura por IA](#08--subida-y-lectura-por-ia)
9. [Modal de confirmación — anatomía completa](#09--modal-de-confirmación--anatomía-completa)
10. [Motor fiscal en cliente](#10--motor-fiscal-en-cliente)
11. [Validación de identidad fiscal](#11--validación-de-identidad-fiscal)
12. [Guardado definitivo](#12--guardado-definitivo)
13. [Historial y visor de imagen](#13--historial-y-visor-de-imagen)
14. [PWA, instalación y actualización](#14--pwa-instalación-y-actualización)
15. [Contrato API completo del usuario final](#15--contrato-api-completo-del-usuario-final)
16. [Microcopy literal](#16--microcopy-literal)
17. [Comportamiento móvil y accesibilidad](#17--comportamiento-móvil-y-accesibilidad)
18. [Trampas conocidas y qué no replicar](#18--trampas-conocidas-y-qué-no-replicar)
19. [Checklist de paridad](#19--checklist-de-paridad)
20. [Las cinco preguntas del experto](#20--las-cinco-preguntas-del-experto)

---

## 01 · Alcance e inventario de ficheros

Este documento cubre **exclusivamente la aplicación del usuario final**: la persona de la empresa cliente que abre la app en el móvil, fotografía una factura y la guarda. El panel de administración (`admin-facturas.*`, `admin-login.*`, Tabulator) queda **fuera de alcance** por petición expresa.

### Ficheros que componen la app de usuario

| Fichero | Líneas | Rol | ¿Migra? |
| --- | ---: | --- | --- |
| `index.html` | 487 | Todas las pantallas y modales del usuario, más el bloque PWA inline | Sí — es la fuente de la estructura |
| `app.js` | 2.354 | Toda la lógica: auth UI, cámara, OCR, modal, motor fiscal, historial | Sí — es el núcleo funcional |
| `styles.css` | 152 | Design system global + cámara + chip de empresa + fixes iOS | Sí — ver §03 |
| `auth.js` | 211 | Access Token en memoria + Refresh Token cookie, `apiFetch` | Sí — portable tal cual |
| `cif-validator.js` | 124 | Algoritmo AEAT + coherencia emisor/receptor. Espejo del backend | Sí — portable tal cual |
| `service-worker.js` | 141 | Cache network-first + bloqueo horario offline 00:00–06:00 | Sí, con revisión (ver §18) |
| `manifest.json` | 38 | Manifiesto PWA, iconos v5 + maskable | Sí |
| `favicon-app.svg`, `icons/*` | — | Identidad visual: 192/512 px normal y maskable | Copiar binarios |
| `opencv.js` | ~8,9 MB | Vendor. Runtime WASM para detección de contorno de papel | Reevaluar — ver §07 y §18 |
| `jscanify.js` | ~7,6 KB | Vendor. Wrapper sobre OpenCV: contorno + recorte en perspectiva | Reevaluar con lo anterior |
| `pdf.min.js`, `pdf.worker.min.js` | ~1,4 MB | Vendor PDF.js. **Cargados en disco pero no referenciados por `index.html`** | No migrar sin justificar |
| `tabulator.min.*` | — | Solo panel admin | No — fuera de alcance |

> **Dato de partida**
>
> El código propio del usuario final son **3.507 líneas** repartidas en 7 ficheros. Todo lo demás es vendor. No hay framework, no hay bundler, no hay paso de build: los ficheros se sirven tal cual desde Nginx con un query string de cache-busting (`app.js?v=20260727-001`).

---

## 02 · Arquitectura de carga y ejecución

### Orden de scripts — es significativo

```html
<script src="auth.js?v=20260414-004"></script>         <!-- define window.Auth -->
<script src="cif-validator.js?v=20260713-001"></script> <!-- define window.SetexCifValidator -->
<script src="app.js?v=20260727-001"></script>          <!-- consume ambos, engancha listeners -->
<script> /* bloque PWA inline: SW + banners de instalación */ </script>
```

`app.js` no espera a `DOMContentLoaded`: se ejecuta al final del `<body>`, cuando el DOM ya está completo, y engancha listeners directamente con `document.getElementById(...).addEventListener(...)`. Todo el estado vive en variables de módulo en el ámbito global del script.

### Estado global de la aplicación

| Variable | Tipo | Significado |
| --- | --- | --- |
| `token` | string\|null | Espejo del Access Token. La fuente real es `Auth`; esta copia solo sirve de guarda |
| `selectedFile` | File\|null | Fichero renombrado listo para subir |
| `currentPreviewId` | string\|null | Identificador del preview en Redis. Sin él no se puede confirmar |
| `userCompanyName` / `userCompanyNif` | string\|null | Identidad fiscal del usuario. Base de toda validación cruzada |
| `userIsAdmin` / `userIsTechAdmin` | boolean | Ocultan el chip de empresa y muestran el botón de prueba respectivamente |
| `selectedInvoiceType` | `'compra'`\|`'venta'` | Recibida o Emitida. Por defecto `'compra'` |
| `historyAllFacturas` / `historyShowAll` | array / boolean | Cache del historial y estado de «ver más» |
| `cameraStream` | MediaStream\|null | Debe pararse pista a pista al cerrar la cámara |
| `docScanner`, `docScanActive`, `docScanLoopTimer` | — | Estado de la detección de documento en vivo |
| `flashOn` | boolean | Estado de la linterna. Se enciende sola al abrir la cámara |
| `modoPruebaCapturaActivo` | boolean | Desvía la siguiente captura a `/api/test-captura` (solo soporte técnico) |
| `_confirmHistoryActive` | boolean | Marca que el modal empujó una entrada en `history` |
| `_summarySyncing` | boolean | Guarda anti-bucle del resumen bidireccional (§10) |

> **Recomendación de migración**
>
> Este estado es exactamente el modelo de datos de un store. Al portar a un framework, conviértelo en dos slices: *sesión* (token, empresa, roles) y *captura en curso* (fichero, previewId, tipo, campos, tramos). El resto — cámara, flash, escáner — es estado local del componente de cámara y no debe subir al store.

### Entorno de servidor que la app asume

- `API_URL = window.location.origin + '/api'`. Mismo origen siempre; no hay CORS.
- Nginx sirve estáticos y hace de proxy inverso a Express en `/api/`.
- CSP estricta: `script-src 'self'`. **No se pueden cargar scripts de CDN** ni ejecutar `eval` en la app de usuario. Todo vendor va autoalojado.
- `Permissions-Policy: camera=(self)` — la cámara solo funciona en el propio origen.
- Límite de subida en Nginx: `client_max_body_size 10M`.
- Todas las peticiones pasan por un *auth_request* interno de control horario: fuera de la ventana permitida, Nginx devuelve un 404 neutro para HTML, JS, CSS y `/api/`.

---

## 03 · Sistema de diseño

No hay tokens declarados: los valores están literalmente escritos en el CSS y, en gran medida, en atributos `style` inline dentro del HTML y de plantillas de `app.js`. Esta tabla es la extracción de ese sistema implícito, y es lo primero que hay que formalizar en la app nueva.

### Paleta

| Color | Hex | Uso |
| --- | --- | --- |
| Marca app (inicio) | `#667eea` | Gradiente de marca, foco de inputs, enlaces |
| Marca app (fin) | `#764ba2` | Cierre del gradiente |
| Naranja SETEX | `#FF6600` | «SE» del logotipo, instalar, actualizar |
| Slate badge | `#2d3748` | Fondo del logotipo, banners |
| Éxito | `#38a169` | Bordes y acentos de confirmación |
| Error | `#e53e3e` | Bordes y acentos de error |
| Aviso | `#d69e2e` | Bordes y acentos de advertencia |
| Recibida | `#2b6cb0` | Identidad de factura de compra |
| Emitida | `#6b46c1` | Identidad de factura de venta |

### Tokens propuestos

| Token propuesto | Valor | Dónde se usa hoy |
| --- | --- | --- |
| `--brand-grad` | `linear-gradient(135deg,#667eea,#764ba2)` | Fondo de `body` y botón primario |
| `--brand` | `#667eea` | Borde superior de tarjeta, foco de inputs, enlaces, `theme-color` del HTML |
| `--setex-orange` | `#FF6600` | «SE» del logotipo, botón de instalar, banner de actualización, `theme_color` del manifiesto |
| `--surface-card` | `linear-gradient(160deg,#fafafa,#f5f5f5 50%,#f0f0f0)` | Fondo de `.screen` |
| `--ink-1 / 2 / 3` | `#2d3748` / `#4a5568` / `#718096` | h1 / h2 / texto secundario |
| `--ink-faint` | `#a0aec0`, `#cbd5e0` | Placeholders, guiones de «sin dato» |
| `--line` | `#e2e8f0` | Bordes de input y separadores |
| `--ok` / `--ok-bg` | `#276749` / `#c6f6d5` | Mensajes `.success`, validaciones correctas |
| `--warn` / `--warn-bg` | `#975a16` / `#fefcbf` | Mensajes `.warning`, duplicados |
| `--bad` / `--bad-bg` | `#9b2c2c` / `#fed7d7` | Mensajes `.error`, campos obligatorios sin leer |
| `--iva-box` | borde `#bee3f8` · fondo `#ebf8ff` · texto `#2b6cb0` | Cuadro de desglose de IVA |
| `--irpf-box` | borde `#fbd38d` · fondo `#fffaf0` · texto `#c05621` | Cuadro de retención IRPF y sección de empresa detectada |
| `--resumen-box` | borde y texto `#1a365d` · fondo `#fff` | Cuadro de resumen final |

### Tipografía, formas y elevación

- **Familia única:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`. No hay webfonts (la CSP los bloquearía).
- **Escala:** h1 `1.6em` · h2 `1.2em` · cuerpo `16px` · etiquetas de campo `11px/700` con `letter-spacing .05em` en mayúsculas · microtexto `10px`–`13px`.
- **Radios:** `12px` tarjeta · `8px` inputs, botones y cajas · `6px` elementos internos · `20px`–`999px` píldoras · `50px` botón de captura.
- **Sombras:** tarjeta `0 8px 30px rgba(0,0,0,.15)` · hover de botón `0 4px 12px rgba(0,0,0,.15)` · chip de empresa `0 2px 10px {colorEmpresa}55`.
- **Movimiento:** el único gesto es `chipFadeUp .35s cubic-bezier(.34,1.56,.64,1)` y el `translateY(-1px)` de hover en botones. Hoy **no** se respeta `prefers-reduced-motion`: corregir al migrar.
- **Contenedor:** `#app { width:90%; max-width:600px }` centrado vertical y horizontalmente. Es una app de una sola columna, diseñada para móvil en vertical.

### El logotipo, literal

```html
<span class="setex-badge"><span class="se">SE</span><span class="tex">TEX</span></span>
```

```css
.setex-badge { background:#2d3748; padding:2px 10px 3px; border-radius:7px;
               font-weight:900; letter-spacing:.05em; line-height:1.4; }
.setex-badge .se  { color:#FF6600; }
.setex-badge .tex { color:#ffffff; }
```

Aparece en la cabecera de todas las pantallas, en los dos banners de instalación y en la página offline del service worker. Es el único elemento de marca: mantenerlo idéntico.

### Identidad de empresa generada

El chip de empresa del encabezado toma un **color determinista** derivado del nombre, de una paleta de 8 pares. La misma empresa recibe siempre el mismo color, y ese color tiñe también el borde superior de la tarjeta principal.

```js
let h = 0;
for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
return palette[Math.abs(h) % palette.length];

// palette (par claro/oscuro para el gradiente):
// azul #4299e1/#2b6cb0 · verde #48bb78/#276749 · naranja #ed8936/#c05621
// morado #9f7aea/#6b46c1 · teal #38b2ac/#285e61 · rojo #e53e3e/#9b2c2c
// ámbar #d69e2e/#975a16 · índigo #667eea/#434190
```

Existe también `getCompanyInitials()`, que descarta formas jurídicas (`SL`, `SA`, `SLU`, `CB`…) para generar dos iniciales. **Está definida pero no se usa** en la versión actual: el chip muestra el nombre completo con elipsis. Consérvala si en la app nueva quieres un avatar.

---

## 04 · Mapa de pantallas y máquina de estados

Son cinco pantallas mutuamente excluyentes dentro de un mismo documento, más tres capas superpuestas. El cambio de pantalla se hace conmutando `style.display`; no hay router.

| Id | Pantalla | Se muestra cuando |
| --- | --- | --- |
| `#auth-screen` | Login / Registro / Recuperar | Estado por defecto del HTML. Sin sesión válida |
| `#reset-password-screen` | Nueva contraseña | La URL trae `?token=…`. Se decide antes de intentar restaurar sesión |
| `#pending-approval-screen` | Empresa pendiente de verificación | Registro con `202 {pending:true}`, o `/api/company/status → 'pending'` |
| `#main-screen` | Captura + historial | Sesión restaurada y empresa activa |
| `#camera-overlay` | Visor de cámara a pantalla completa | `z-index:1000`, `position:fixed` |
| `#confirm-modal` | Confirmación de datos extraídos | `z-index:2000`, con scroll propio |
| `#test-captura-modal` | Prueba de flujo sin guardar | `z-index:1100`, solo soporte técnico |

### Secuencia de arranque

```
carga app.js
   │
   ├─ setInvoiceType('compra')            → estado visual inicial del selector
   ├─ define window.__authOnLogout        → callback global de expulsión de sesión
   │
   ├─ ¿URL tiene ?token=…?
   │     SÍ → mostrar #reset-password-screen y PARAR
   │     NO ↓
   │
   ├─ await Auth.init()                   → POST /api/auth/refresh con cookie httpOnly
   │
   ├─ ¿URL tiene ?next=admin?
   │     SÍ → limpiar la URL con replaceState
   │          ¿sesión && is_admin? → location = '/admin-facturas.html'
   │          si no → sessionStorage.postLoginRedirect = 'admin'; mostrar login
   │
   └─ ¿sesión restaurada?
         SÍ → GET /api/company/status
                'pending'  → #pending-approval-screen
                otro/error → showMainScreen()
         NO → #auth-screen (ya visible por defecto)
```

### Transiciones dentro de la pantalla de acceso

- `#link-register` → muestra registro. `#link-login-from-register` vuelve.
- `#link-forgot` → muestra recuperación y **limpia** `#forgot-message`. `#link-login-from-forgot` vuelve.
- Login correcto → si `sessionStorage.postLoginRedirect === 'admin'` y el usuario es admin, redirige al panel; si no, `showMainScreen()`.
- Registro con empresa aprobada → devuelve `accessToken` y entra directo.
- Registro con empresa pendiente → `202`, pantalla de espera, **sin token**.

`showMainScreen()` oculta las otras tres pantallas y dispara siempre dos cargas en paralelo: `loadUserSettings()` y `loadHistory()`.

### Pantalla de empresa pendiente

Tiene dos botones: *Cerrar sesión* y *Verificar estado*. El segundo llama a `/api/company/status`; si la empresa ya está activa, la app **cierra sesión a propósito** y pide re-login para que el servidor emita cookies nuevas, insertando este aviso encima del formulario: «¡Tu empresa fue aprobada! Inicia sesión para acceder.» Si no hay sesión activa (caso de recién registrado), el botón devuelve directamente al login.

---

## 05 · Autenticación — el módulo más portable

> **Migrar tal cual**
>
> `auth.js` es un módulo autocontenido, sin dependencias y sin acoplamiento al DOM. Cópialo íntegro a la app nueva. Su diseño de seguridad es correcto y volver a escribirlo solo introduce riesgo.

### Modelo

- **Access Token**: 15 minutos, vive *solo en una variable de módulo*. Nunca en `localStorage` ni `sessionStorage` — inmune a XSS.
- **Refresh Token**: cookie `httpOnly`, `SameSite=Strict`, 7 días con «mantener sesión» o 1 día sin ella. El JavaScript nunca lo ve.
- **Rotación** en cada uso con detección de reutilización: si un RT se usa dos veces, el servidor revoca la familia completa.
- **Refresco proactivo**: `REFRESH_MARGIN_MS = 60_000`. Si al token le queda menos de un minuto, se renueva antes de la petición.
- **Anti-estampida**: `_refreshPromise` asegura un único refresh en vuelo aunque haya diez peticiones concurrentes.
- **Multi-pestaña**: `BroadcastChannel('setex_auth_v2')`. Un logout en una pestaña limpia el estado en todas.

### Superficie pública

| Método | Devuelve | Contrato |
| --- | --- | --- |
| `Auth.init()` | `Promise<boolean>` | Intenta restaurar sesión desde la cookie. Llamar una vez por carga de página |
| `Auth.isLoggedIn()` | `boolean` | Hay Access Token en memoria |
| `Auth.getToken()` | `string\|null` | Solo para casos que lo necesiten explícitamente |
| `Auth.getUser()` | `{id,email,is_admin}\|null` | Decodificado del payload del JWT *sin verificar firma* — solo para UI |
| `Auth.handleLoginResponse(data)` | `void` | Guarda el AT tras login o registro |
| `Auth.apiFetch(url, opts)` | `Promise<Response>` | El único cliente HTTP autenticado de la app |
| `Auth.logout()` | `Promise<void>` | Revoca en servidor, limpia estado, avisa a otras pestañas |
| `window.__authOnLogout` | callback | Lo define la app: qué hacer cuando la sesión muere |

### Comportamiento de `apiFetch`

```
apiFetch(url, opts)
   │
   ├─ _ensureFreshToken()  ── ¿quedan >60 s? ── no ──► POST /api/auth/refresh
   │        │                                             │
   │        └─ sin token válido ──────────────────────────┘ falla
   │                 └──► __authOnLogout() + Response 401 sintética
   │                      { error: "Sesión caducada. Por favor, inicia sesión de nuevo." }
   │
   ├─ fetch con  Authorization: Bearer <at>
   │             X-Requested-With: XMLHttpRequest
   │             credentials: 'include'
   │
   └─ ¿status 401? ──► refresh silencioso ──► reintento único
                            │                      └─ 401 otra vez → __authOnLogout()
                            └─ falla ─────────────► __authOnLogout()
```

> **No romper esto al migrar**
>
> La cabecera `X-Requested-With: XMLHttpRequest` es obligatoria: el backend la exige (`requireXHR`) en las rutas mutantes como defensa anti-CSRF. Y `credentials: 'include'` es lo que hace viajar la cookie de refresco. Un cliente HTTP nuevo que omita cualquiera de las dos *parecerá* funcionar hasta que caduque el primer token.

### Formularios de acceso — reglas de validación en cliente

| Formulario | Campos | Validación local |
| --- | --- | --- |
| Login | `#login-email`, `#login-password`, `#login-remember` | Ninguna. Error del servidor vía `alert()` |
| Registro | nombre empresa, CIF empresa, email, contraseña | Los cuatro obligatorios. CIF se normaliza en vivo a mayúsculas sin espacios ni guiones y se avisa si no supera el dígito de control AEAT — **aviso, no bloqueo** |
| Recuperar | `#forgot-email` | No vacío. Respuesta siempre neutra: «Si el email existe, recibirás instrucciones» |
| Restablecer | nueva + confirmación | Ambas presentes, iguales, **mínimo 6 caracteres**. Al terminar, redirige a `/` tras 2 s |

> **Incoherencia a corregir**
>
> El registro pide «mínimo 8 caracteres» en el *placeholder*, pero el restablecimiento valida contra 6. Unifica el mínimo en la app nueva y hazlo coincidir con lo que valide el servidor.

---

## 06 · Pantalla principal de captura

### Anatomía, de arriba abajo

1. **Cabecera**: logotipo + «Facturas» y botón rojo *Salir*.
2. **Chip de empresa**: segunda fila, píldora con gradiente determinista y el nombre de la empresa. Se oculta para administradores. Si el CIF guardado no supera el algoritmo AEAT aparece un ⚠ con `title` explicativo.
3. **Selector de tipo**: dos botones a mitad de ancho, siempre visibles. `📥 Factura Recibida` (`compra`, activa por defecto) y `📤 Factura Emitida` (`venta`).
4. **Acciones**: *📷 Capturar Foto* (primario) y *📄 Subir Archivo* (secundario). Un tercer botón *🧪 Probar flujo (sin guardar)* aparece solo para soporte técnico.
5. **Previsualización**: nombre de fichero, tamaño en KB y píldora del tipo elegido.
6. **Enviar**: verde, deshabilitado hasta que haya fichero.
7. **Zona de mensajes** `#message`: éxito, aviso o error.
8. **Historial plegable**: cabecera con contador y tabla (§13).

### Estados visuales del selector de tipo

| Botón | Estado | Estilo |
| --- | --- | --- |
| Recibida | Activo | fondo `#ebf8ff`, borde `#4299e1`, texto `#2b6cb0`, halo `0 0 0 2px #4299e1` |
| Emitida | Activo | fondo `#f0fff4`, borde `#48bb78`, texto `#276749`, halo `0 0 0 2px #48bb78` |
| Cualquiera | Inactivo | fondo `#f7fafc`, borde `#e2e8f0`, texto `#a0aec0`, sin halo |

Tras guardar con éxito, el tipo **vuelve a `compra`** automáticamente. Es deliberado: la inmensa mayoría de capturas son facturas recibidas.

### Renombrado de fichero antes de subir

Todo fichero — venga de cámara o del selector — se reenvasa con un nombre determinista antes de salir del navegador:

```
{usuario}_{YYYYMMDD}_{HHMMSS}{.ext}
// usuario = parte local del email; ext = la original en minúsculas, o .jpg
// ejemplo: mgarcia_20260801_154207.jpg
```

Los `<input type="file">` aceptan `image/*,application/pdf` para el selector y `image/*` con `capture="environment"` para el respaldo de cámara.

---

## 07 · Cámara y detección de documento

### Apertura, con degradación en cascada

```
capturePhoto()
   │
   └─ ¿navigator.mediaDevices.getUserMedia?
         SÍ → getUserMedia({ video:{ facingMode:'environment',
                                     width:{ideal:1920}, height:{ideal:1080} } })
                │
                ├─ éxito → video.srcObject = stream
                │          overlay display:flex
                │          setupFlashButton(track)
                │          on 'loadedmetadata' (once) → startDocScanLoop()
                │
                └─ error → click en <input capture="environment">   (cámara nativa del SO)
         NO  → click en <input capture="environment">
```

### Composición del visor

- Barra superior negra translúcida con el aviso «⚠️ No debe salir sombras ni brillos.» en `#fbd38d`, y una `×` de cierre.
- `<video autoplay playsinline muted>` a pantalla completa con `object-fit: cover`. `playsinline` es obligatorio o iOS abre el reproductor a pantalla completa.
- `<canvas id="camera-scan-overlay">` superpuesto y transparente: solo dibuja el contorno detectado.
- Guía estática: rectángulo al 92 % × 82 % con cuatro esquinas gruesas blancas.
- Fila inferior: botón *Capturar* blanco redondeado y, a su lado, el botón de linterna 🔦 circular.

### Detección en vivo (jscanify + OpenCV.js)

- **Carga perezosa obligatoria.** Los ~9 MB de OpenCV solo se descargan al abrir la cámara, nunca en el arranque.
- Espera de runtime WASM mediante `cv.then(...)`, *no* asignando `cv.onRuntimeInitialized`. Es un arreglo real de una condición de carrera: el callback se dispara una sola vez y, si el runtime ya terminó, asignarlo después no lo ejecuta nunca. `cv.then()` comprueba `calledRun` internamente. Hay además un tiempo máximo de 15 s.
- Bucle cada **400 ms** sobre una copia reducida a **480 px** de ancho; el contorno se reescala al tamaño nativo antes de dibujarlo en verde `#48bb78` con grosor 6.
- `img.delete()` en cada iteración: sin eso, el heap de WASM crece hasta reventar.
- Si algo falla en la carga o en la detección, se registra un `console.warn` y se sigue con la captura estándar. **El módulo es puramente aditivo y jamás puede impedir hacer la foto.**

### Captura

Al pulsar *Capturar*, si hay escáner se intenta `extractPaper()` a resolución nativa completa, que recorta y corrige la perspectiva. Si falla o no hay escáner, se dibuja el fotograma entero. En ambos casos: `canvas.toBlob(..., 'image/jpeg', 0.92)` y se construye un `File` llamado `captura.jpg`, que después pasa por el renombrado de §06.

### Linterna

- Se controla con `track.applyConstraints({ advanced:[{ torch:true }] })`.
- El botón **solo se muestra si `track.getCapabilities().torch` lo confirma**. Soportado en Chrome Android y en Safari iOS 17.4+; no en Firefox Android.
- Se enciende **automáticamente** al abrir la cámara. El usuario puede apagarla.
- Un fallo al conmutar se traga con `console.warn`: no puede romper la captura.

> **Limpieza obligatoria**
>
> `closeCamera()` debe hacer las tres cosas, en este orden: parar el bucle de escaneo y limpiar el canvas, recorrer `stream.getTracks()` llamando a `stop()` en cada una, y resetear el botón de linterna. Omitir el `stop()` deja el LED de la cámara encendido y la linterna activa: es el fallo más visible y más denunciable de una app de cámara.

---

## 08 · Subida y lectura por IA

### Petición

```
POST /api/upload-preview          multipart/form-data
  file          → File (imagen o PDF, ≤10 MB por límite de Nginx)
  invoice_type  → 'compra' | 'venta'

Cabeceras que pone Auth.apiFetch:
  Authorization: Bearer <access token>
  X-Requested-With: XMLHttpRequest
  credentials: include
// No fijar Content-Type: el navegador debe generar el boundary.
```

Durante la llamada el botón *Enviar* queda deshabilitado y `#message` se vacía. El servidor optimiza la imagen a 1536 px / JPEG 85 %, ejecuta el OCR dual y responde en unos 2–5 segundos; el usuario espera, es una llamada síncrona.

> **Hueco de experiencia a cubrir**
>
> Hoy **no se muestra ningún indicador de progreso** durante esos segundos: el botón simplemente se apaga. En la app nueva, un estado de carga explícito («Leyendo la factura…») es la mejora de percepción más barata que existe en todo este flujo.

### Respuesta y campos que consume la interfaz

| Campo | Tipo | Uso en la interfaz |
| --- | --- | --- |
| `preview` | boolean | Discriminante: si falta, se trata como error |
| `preview_id` | string | Se guarda en `currentPreviewId`. Caduca en Redis a los **30 min** |
| `campos.proveedor_nombre` / `proveedor_nif` | string\|null | Sección superior del modal |
| `campos.receptor_nombre` / `receptor_nif` | string\|null | Sección de receptor |
| `campos.numero_factura` | string\|null | Campo opcional monoespaciado |
| `campos.fecha_emision` | string\|null | Formato `DD/MM/AAAA` |
| `campos.total` | string\|null | Formato español con coma decimal |
| `campos.base_imponible` / `iva_porcentaje` / `cuota_iva` | string\|null | Vista mono-IVA |
| `campos.lineas_iva` | array\|null | **≥2 elementos activa la vista multi-IVA** |
| `campos.irpf_porcentaje` / `cuota_irpf` | string | Por defecto `'0,0'` y `'0,00'` |
| `missing_fields` | string[] | Pinta en rojo los campos no leídos y cambia el título del modal |
| `cif_confident` | boolean | Verde si sí, ámbar si no |
| `known_provider` | boolean | Muestra «✓ Proveedor conocido — CIF verificado anteriormente» |
| `nif_status` | `'confirmed'\|'single_source'\|'both_missing'\|'conflict'` | Solo `both_missing` genera banner rojo |
| `iva_validation` | `{valid,errors,warnings}` | Estado inicial del cuadro de IVA |
| `ocr_corrected` | object\|null | «✓ Completado con datos conocidos (*n* confirmaciones)» |
| `suggested_counterparty` | `{field,nombre,nif}`\|null | Botón «¿Es este proveedor/cliente?» que autorrellena |
| `invoice_type` | string | Confirmación del tipo; manda sobre la selección local |
| `dual_confirmed`, `ocr_discrepancy`, `vies_valid`, `vies_nombre`, `nif_uncertain`, `confidence`, `auto_confirm`, `requires_review`, `cif_validation`, `user_company` | varios | **Se reciben y en su mayoría no se pintan hoy.** Material disponible para mejorar la interfaz nueva |

### Identidad propia: la IA no manda

> **Regla de negocio, no fallo**
>
> El servidor **sobrescribe deliberadamente** el lado propio de la factura con los datos del registro del usuario: en una factura *recibida* fuerza receptor = tu empresa; en una *emitida* fuerza emisor = tu empresa. El nombre y el CIF de quien hace la foto se conocen con certeza desde la base de datos y nunca dependen de lo que lea la IA. La app nueva debe respetarlo y no «corregirlo».

---

## 09 · Modal de confirmación — anatomía completa

Es la pieza central del producto y donde vive casi toda la complejidad. Fondo `rgba(0,0,0,.75)`, tarjeta de 500 px con borde superior verde de 4 px, scroll propio.

### Bloques, en orden

1. **Encabezado adaptativo.** Sin campos que falten: «Confirma los datos» en verde `#276749`. Con `missing_fields`: «Completa los datos que faltan» en rojo `#c53030` y otra descripción.
2. **Píldora de tipo** — `📥 Factura Recibida` o `📤 Factura Emitida`.
3. **Banner de OCR** — solo si `nif_status === 'both_missing'`.
4. **Empresa en la factura** (caja ámbar): nº de factura, nombre y CIF/NIF, con estado de validación y estado VIES.
5. **Receptor** (caja gris): nombre y CIF/NIF.
6. **Fecha y Total** en dos columnas.
7. **Cuadro 1 — Desglose IVA por tramos**, plegable.
8. **Cuadro 2 — Retención IRPF**, plegable.
9. **Cuadro 3 — Resumen**, fijo, siempre visible.
10. **Mensajes, avisos de CIF y banner de descuadre.**
11. **✓ Confirmar y guardar**, declaración responsable, **✗ Repetir foto**.

### Etiquetas que cambian según el tipo de factura

| Elemento | Recibida (`compra`) | Emitida (`venta`) |
| --- | --- | --- |
| `#confirm-proveedor-section-label` | EMPRESA EN LA FACTURA (IA) | DATOS DEL EMISOR |
| `#confirm-proveedor-label` | PROVEEDOR / EMISOR | EMISOR (NUESTRA EMPRESA) |
| `#confirm-nif-label` | CIF / NIF PROVEEDOR | CIF / NIF EMISOR |
| `#confirm-receptor-section-label` | RECEPTOR (NUESTRA EMPRESA) | RECEPTOR / CLIENTE |

### Mapa completo de identificadores

| Id | Tipo | Regla |
| --- | --- | --- |
| `#confirm-numero-factura` | texto, 50 | Opcional. Monoespaciado |
| `#confirm-proveedor` | texto, 255 | Editable siempre |
| `#confirm-nif` | texto, 9 | Mayúsculas forzadas, sin separadores, monoespaciado 18 px, `letter-spacing:3px` |
| `#confirm-cif-status` | salida | «✓ NIF personal» / «✓ NIE» / «✓ CIF» / vacío |
| `#confirm-vies-status` | salida | Consulta asíncrona al registro europeo |
| `#confirm-known-badge` | salida | Proveedor ya confirmado antes |
| `#confirm-relationship-hint` | salida | Autocompletado o sugerencia con botón |
| `#confirm-receptor-nombre` / `#confirm-receptor-nif` | texto | Prerrellenados con tu empresa en facturas recibidas |
| `#confirm-fecha` | texto, 10 | `DD/MM/AAAA`. **Obligatorio** |
| `#confirm-total` | texto, 20 | Total con IVA. **Obligatorio**. Vinculado al resumen |
| `#confirm-base`, `#confirm-iva-pct`, `#confirm-cuota-iva` | texto | Vista mono-IVA |
| `#confirm-lineas-iva-blocks` | contenedor | Vista multi-IVA generada por JS |
| `#confirm-irpf-pct`, `#confirm-cuota-irpf` | texto | Retención. `#btn-remove-irpf` los vacía y pliega el cuadro |
| `#confirm-lineas-iva-summary` | contenedor | Base y Cuota IVA de solo lectura; IRPF y Total editables |
| `#confirm-descuadre-banner` | aviso | Se muestra si la aritmética no cuadra. **Avisa, no bloquea** |
| `#confirm-cif-validation` | avisos | Rojos bloqueantes / amarillos informativos |
| `#btn-confirm-invoice` | botón | Se deshabilita solo ante errores bloqueantes de CIF |
| `#confirm-consent` | texto legal | Declaración responsable — ver §16 |
| `#btn-cancel-invoice` | botón | «✗ Repetir foto»: cierra, descarta y **reabre la cámara** |

### Semáforo del campo CIF

| Condición | Borde | Fondo | Extra |
| --- | --- | --- | --- |
| Emitida y coincide con tu CIF registrado | `#68d391` | `#f0fff4` | «✓ CIF de tu empresa», sin validar algoritmo |
| Está en `missing_fields` | `#e53e3e` | `#fff5f5` | Placeholder «Introduce el CIF/NIF (obligatorio)» |
| `cif_confident === false` | `#d69e2e` | `#fffff0` | — |
| Leído con confianza | `#68d391` | `#f0fff4` | — |

Cuando el usuario edita el campo, el semáforo se **limpia** y se revalida en vivo; si escribe un CIF de 9 caracteres con forma de sociedad, se dispara `lookupProveedorPorNIF` y el nombre se autorrellena desde su propio historial.

### Política de plegado de los cuadros

> **Regla vigente**
>
> Los cuadros de IVA e IRPF se abren **únicamente si hay anomalía**: `box.open = tieneAnomaliaTramos()` y `box.open = tieneAnomaliaIrpf()`. Si las cuentas cuadran, el usuario ve un modal corto y firma. La atención se reserva para lo que está mal. Es una decisión de diseño consciente y merece conservarse.

### Botón atrás del navegador

Al abrir el modal se hace `history.pushState({setexModal:'confirm'}, '')`. El `popstate` cierra el modal, descarta la previsualización y deja al usuario en la pantalla de captura — **sin salir de la PWA y sin reabrir la cámara**, que es lo que distingue «atrás» de «Repetir foto». Al cerrar por flujo normal se llama a `history.back()` para limpiar la entrada extra.

---

## 10 · Motor fiscal en cliente

Es la parte con más reglas de negocio de todo el frontend, y la que más caro sale reescribir de memoria. Cada regla de aquí responde a un error real observado en producción.

### Análisis de importes en formato español

Hay **tres** analizadores con comportamientos distintos. No los unifiques sin comprobar cada uso:

| Función | Usado en | Particularidad |
| --- | --- | --- |
| `parseAmount` | Validación de IVA | Con coma y punto, gana el separador que aparezca más a la derecha. Con solo coma, si hay exactamente 3 decimales la trata como separador de miles |
| `parseHistoryAmount` | Historial | Igual, pero sin la heurística de los 3 dígitos |
| `parseSummaryNum` | Resumen y tramos | Simplificado: borra todos los puntos y convierte la coma en punto. Devuelve `0` —no `null`— si no parsea |

Formateo de salida: `toLocaleString('es-ES', {minimumFractionDigits:2, maximumFractionDigits:2})`.

### Los cuatro tipos de IVA

```js
const IVA_RATES_VALIDOS = [21, 10, 4, 0];

snapToValidIvaRate(raw)
  → normaliza coma/punto/%, admite decimal (0.21 → 21)
  → devuelve el válido MÁS CERCANO, como cadena
  → '' si no parsea

// Casos reales corregidos:  "211" → 21   "9,5" → 10   "3" → 4   "0,21" → 21
```

Se aplica al renderizar, al perder el foco y **otra vez antes de enviar**. La triple aplicación es intencionada: la última es la que garantiza que el backend nunca recibe un tipo inventado.

### Tramos: deduplicación y tope

`dedupeAndCapTramos()` conserva la **primera** aparición de cada porcentaje ya normalizado, descarta los no parseables y corta en **4 tramos** — uno por tipo posible. El caso típico que resuelve es el OCR leyendo dos veces el mismo tramo.

`firstAvailableRate()` alimenta el botón «➕ Añadir tramo al *N*%». Cuando los cuatro están usados, el botón se sustituye por: «Ya tienes los 4 tipos de IVA posibles (21, 10, 4 y 0).»

### Coherencia aritmética

```
CUOTA = BASE × IVA% / 100          por tramo y en mono-IVA
TOTAL = BASE + CUOTA_IVA − CUOTA_IRPF

Tolerancias:
  COHERENCIA_TOL_EUR = 0,02 €   → coherencia de tramos y de IRPF
  TOL                = 0,05 €   → validación general de updateIVACalc
```

El recálculo es bidireccional y respeta el foco del usuario:

- Cambia **base** o **porcentaje** → se recalcula la **cuota**.
- Cambia la **cuota** → se recalcula la **base** (solo si el porcentaje > 0).
- `if (document.activeElement === elDestino) return;` — **nunca se pisa el campo que el usuario está escribiendo**. Esta guarda es la diferencia entre un formulario usable y uno que pelea contra quien lo rellena.

### El cuadro Resumen y su sincronización bidireccional

```
tramos multi-IVA ─┐
                  ├─► suma ─► #summary-base      (solo lectura)
mono-IVA        ─┘           #summary-cuota-iva  (solo lectura)

#summary-cuota-irpf  ◄──────►  #confirm-cuota-irpf     editable, se muestra en negativo
#summary-total       ◄──────►  #confirm-total          editable

Total = Base + Cuota IVA − |Cuota IRPF|
Editar el Total NO recalcula lo demás: permite cuadre manual.
```

> **Trampa de implementación**
>
> La sincronización cruzada exige dos guardas o entra en bucle infinito: `_summarySyncing`, que marca las escrituras programáticas para que los *listeners* las ignoren, y `_topLevelSummaryListenersWired`, que garantiza que los *listeners* de los campos superiores se conectan una sola vez aunque el resumen se vuelva a renderizar. En un framework reactivo esto se resuelve con un único valor derivado — y es una de las razones más fuertes para migrar a uno.

### Detección de anomalías

| Función | Devuelve `true` cuando… |
| --- | --- |
| `tieneAnomaliaTramos()` | Vista multi visible sin tramos · algún tramo con base, cuota o porcentaje vacío · algún valor no numérico · `\|cuota − base×%/100\| > 0,02`. En mono: los tres campos vacíos **no** son anomalía; uno solo vacío, sí |
| `tieneAnomaliaIrpf()` | Solo uno de los dos campos relleno · valores no numéricos · base total ≤ 0 · `\|cuota IRPF − base×%/100\| > 0,02`. Ambos vacíos: sin anomalía |

### Corrección del error ×1000

```
corregirErrorFactor1000IVA(campos)   // se ejecuta ANTES de pintar nada

Origen: el OCR lee "1,230" (= 1,23 €) como separador de miles → 1230 €
Detección: ratio entre valor leído y valor esperado en (950, 1050)
Acción: dividir entre 1000 y reformatear con coma decimal
Se aplica primero a cuota_iva y después, con la cuota ya corregida, al total.
```

### Aviso de descuadre

`updateIVACalc()` mantiene una bandera explícita `hasError` y controla **siempre** la visibilidad del banner — nunca lo deja «fantasma» de un cálculo anterior. El texto del cuadro de IVA alterna entre «✓ Correcto» y «⚠ Revisar». El descuadre **no impide guardar**: avisa, y quien firma es el usuario.

---

## 11 · Validación de identidad fiscal

### Reconocimiento de formato

| Tipo | Expresión | Significado | Distintivo |
| --- | --- | --- | --- |
| NIF | `/^\d{8}[A-Z]$/` | Persona física española | Badge ámbar |
| NIE | `/^[XYZ]\d{7}[A-Z]$/` | Extranjero residente | Badge morado |
| CIF | `/^[A-Z]\d{7}[A-Z0-9]$/` | Sociedad | Badge azul |

Que el proveedor sea NIF o NIE es una **señal de negocio**, no solo cosmética: implica persona física, así que el cuadro de IRPF se muestra automáticamente y la fila del historial se tiñe de naranja suave.

### Dígito de control AEAT

```
checkDigitCIF(taxId)  →  true | false | null   // null = no aplica (NIF, NIE u otro formato)

1. Limpiar espacios, guiones y puntos; mayúsculas
2. Exigir forma  [A-Z] + 7 dígitos + [A-Z0-9]
3. Posiciones impares (0,2,4,6): ×2 y sumar dígitos del resultado si ≥10
4. Posiciones pares (1,3,5): sumar tal cual
5. control = (10 − (suma % 10)) % 10
6. Si la primera letra ∈ NPQRSW → el control es letra: 'JABCDEFGHI'[control]
   Si no                        → el control es el propio dígito
```

> **Uso correcto**
>
> Es una **señal de confianza, nunca un motivo de rechazo**. Se usa para avisar al registrarse y para marcar con ⚠ el chip de empresa. Existen CIFs reales en uso que no superan el dígito de control estricto; bloquear por esto rompería altas legítimas. Este fichero es **espejo del backend** (`domain/validators/nif.js`): si tocas uno, toca el otro.

### Coherencia emisor / receptor

`validateInvoiceCifs()` compara lo que hay en la factura con la identidad registrada del usuario y devuelve `{errors, warnings, blocking}`. Solo los errores deshabilitan el botón de guardar.

| Código | Nivel | Condición |
| --- | --- | --- |
| `SAME_EMISOR_RECEPTOR` | bloquea | Emisor y receptor con el mismo CIF: nadie se factura a sí mismo |
| `EMISOR_MISMATCH` | bloquea | Factura emitida cuyo emisor no eres tú |
| `RECEPTOR_MISMATCH` | bloquea | Factura recibida que no va dirigida a ti |
| `EMISOR_NAME_DIFFERS` | avisa | CIF correcto, nombre distinto: probable variación tipográfica |
| `RECEPTOR_NAME_DIFFERS` | avisa | Ídem del lado receptor |

La comparación de nombres normaliza acentos, puntuación y formas jurídicas (`SL`, `SLU`, `SA`, `SCOOP`, `CB`, «sociedad limitada», «sociedad anónima») antes de comparar. La de CIFs quita separadores y el prefijo `ES`.

> **Defensa en profundidad**
>
> El servidor repite exactamente esta validación al guardar y puede responder `{cif_mismatch:true, errors:[…]}`. La interfaz pinta esos errores del servidor con el mismo componente que los locales y vuelve a bloquear el botón. Mantén ambas capas: la del cliente es experiencia de usuario, la del servidor es seguridad.

### Registro europeo VIES

Consulta asíncrona y no bloqueante solo para formatos CIF. Estados: «Consultando registro fiscal europeo…» → «✓ Registrado en VIES · *nombre*» · «⚠ No encontrado en VIES (puede ser PYME sin registro UE)» · o silencio si hay error o tiempo agotado. Límite: **10 consultas por minuto**.

---

## 12 · Guardado definitivo

### Preparación del envío

1. El CIF se normaliza: mayúsculas, sin espacios, guiones ni puntos.
2. Se comprueba localmente que hay **CIF, fecha y total**; si falta alguno: «CIF/NIF, fecha y total son obligatorios».
3. El botón se deshabilita y pasa a decir «Guardando…».
4. El porcentaje de IVA mono pasa por `snapToValidIvaRate` una última vez.
5. Los tramos se leen del DOM y pasan por `dedupeAndCapTramos`.

```
POST /api/upload-confirm     application/json
{
  preview_id, confirmed_nif, confirmed_fecha, confirmed_total,
  confirmed_numero_factura,
  confirmed_proveedor_nombre, confirmed_receptor_nombre, confirmed_receptor_nif,
  confirmed_base_imponible, confirmed_iva_porcentaje, confirmed_cuota_iva,
  confirmed_irpf_porcentaje, confirmed_cuota_irpf,
  confirmed_lineas_iva          // [{base, porcentaje, cuota}] o null en mono-IVA
}
```

Si se envían tramos, el servidor recalcula base, cuota y tipo dominante como suma y **los tramos tienen prioridad** sobre los campos agregados.

### Respuestas y qué hace la interfaz con cada una

| Respuesta | Código | Comportamiento |
| --- | --- | --- |
| `{success:true, invoice_type}` | 200 | Cierra el modal · «Factura guardada correctamente ✓ (Emitida\|Recibida)» · limpia fichero, previsualización y ambos inputs · vuelve el tipo a `compra` · recarga el historial |
| `{duplicate:true, error}` | 200 | Cierra el modal y muestra el mensaje del servidor como aviso ámbar |
| `{cif_mismatch:true, errors}` | 200 | Pinta los errores del servidor y mantiene el botón bloqueado. **No** cierra el modal |
| `{error}` | 400 | Mensaje de error en el modal. Faltan datos o CIF inválido |
| `{error}` | 403 | El preview no pertenece a este usuario → forzar login |
| `{error}` | 410 | **Preview caducado en Redis**: «La sesión de vista previa ha expirado. Vuelve a subir la factura» |
| — | 401 / 403 | Cierra modal, `forceLogin()`, alerta de sesión expirada |
| Excepción de red | — | «Error de conexión. Comprueba tu internet.» |

En el bloque `finally` el botón recupera su texto y se **revalida** el estado de bloqueo — nunca se rehabilita a ciegas, porque un descuadre de CIF debe seguir bloqueando.

> **Caso que hay que manejar mejor**
>
> El 410 por preview caducado es real: 30 minutos de vida en Redis y un modal que el usuario puede dejar abierto. Hoy solo se muestra el texto del error dentro del modal. En la app nueva, ese código debería ofrecer directamente *Volver a subir la misma foto*, conservando el fichero en memoria en lugar de obligar a repetirla.

---

## 13 · Historial y visor de imagen

Sección plegable con contador («*n* facturas»). El servidor devuelve los **últimos 7 días, máximo 50 registros**. Sin datos: «Sin facturas en los últimos 7 días». Se muestran **3 filas** y un botón «Ver más facturas» que revela el resto.

### Las 15 columnas

| # | Columna | Formato |
| ---: | --- | --- |
| 1 | Nº | Id interno, gris tenue |
| 2 | Nº FACTURA | Monoespaciado, centrado |
| 3 | PROVEEDOR / CLIENTE | Máx. 140 px con elipsis y `title` completo |
| 4 | TIPO ID | Distintivo NIF / NIE / CIF |
| 5 | NIF / CIF | Monoespaciado, normalizado |
| 6 | FECHA | Tal cual llega |
| 7 | BASE IMP. | Euros, alineado a la derecha |
| 8 | IVA % | Negrita, centrado |
| 9 | CUOTA IVA | Euros |
| 10 | IRPF % | Naranja si existe; guion si es 0 |
| 11 | CUOTA IRPF | Naranja si existe |
| 12 | TOTAL | Negrita |
| 13 | COMPRA/VENTA | `↑ Emitida` / `↓ Recibida` |
| 14 | ✓ | ✓ verde si el cálculo fiscal es correcto, ⚠ rojo si hay inconsistencia, guion si no consta |
| 15 | IMG | 🖼 pulsable si hay imagen |

Filas alternadas `#fff`/`#fafbfc`, salvo proveedores autónomos (NIF o NIE), que usan `#fffaf5`/`#fff7ed`. Ausencia de dato = guion `#cbd5e0`. Ancho mínimo de tabla 860 px con scroll horizontal propio.

### Visor de imagen

Abre una capa a pantalla completa `rgba(0,0,0,.85)`. La imagen **no se pone como `src` directo**: se descarga con `Auth.apiFetch` —porque requiere token— se convierte a *blob*, se crea una URL de objeto y se libera con `URL.revokeObjectURL` en `onload`. Se cierra al pulsar la × o el fondo. Si falla: «No se pudo cargar la imagen».

> **Deuda a no replicar**
>
> El historial se construye concatenando cadenas HTML e inyectando con `innerHTML`, y los valores del servidor **no se escapan** — mientras que el modal sí tiene `escapeHtmlSimple()`. El riesgo hoy es limitado porque el contenido procede del OCR de tu propia factura, pero es una inyección de HTML autoinfligida esperando a ocurrir. En la app nueva, renderiza por nodos o escapa siempre. El botón de imagen además usa `onclick` inline, que dejará de funcionar en cuanto se endurezca la CSP.

---

## 14 · PWA, instalación y actualización

### Manifiesto

```json
{
  "name": "Setex Factu Capture",
  "short_name": "Setex",
  "description": "Captura y gestión de facturas con IA",
  "start_url": "/",  "scope": "/",
  "display": "standalone",  "orientation": "portrait",
  "background_color": "#2d3748",  "theme_color": "#FF6600",  "lang": "es",
  "icons": [ 192 any, 512 any, 192 maskable, 512 maskable ]
}
```

Ojo con la discrepancia deliberada: el `theme_color` del manifiesto es el naranja `#FF6600`, pero el `<meta name="theme-color">` del HTML es `#667eea`. Decide un único valor al migrar.

### Service worker

- `CACHE_NAME = 'setex-v2'`. Precache de `/`, `/index.html`, `/app.js`, `/manifest.json`. Los iconos se cachean bajo demanda.
- Estrategia **network-first** con respaldo en caché. `/api/*` **nunca** se cachea. Solo se interceptan peticiones `GET`.
- En `activate` se borran todas las cachés con otro nombre y se reclama el control de los clientes.
- Mensaje `{type:'SKIP_WAITING'}` para activar la versión nueva a petición del usuario.
- **Bloqueo horario también sin red**: entre las 00:00 y las 06:00 de Europa/Madrid, si no hay conexión, devuelve un 503 con una página de marca completa que anuncia el horario de servicio 06:00–00:00.

### Ciclo de actualización

```
register('/service-worker.js')
   └─ 'updatefound' → nuevo worker → statechange
         └─ state==='installed' && ya hay controller
               └─ banner naranja fijo abajo:
                  "Nueva versión disponible — toca para aplicar"  [Actualizar]
                        └─ postMessage SKIP_WAITING
'controllerchange' → window.location.reload()
```

### Invitación a instalar

| Plataforma | Disparador | Retraso | Contenido |
| --- | --- | --- | --- |
| Android / Chrome / Edge | `beforeinstallprompt` capturado con `preventDefault` | 1,5 s | Logotipo, «Instalar app», «Accede directamente desde tu pantalla de inicio», botón naranja *Instalar* y ✕ |
| iOS Safari | Detección por *user agent*, excluyendo Chrome y Firefox en iOS | 2 s | Instrucciones de 3 pasos: Compartir ⎋ → «Añadir a pantalla de inicio» → Añadir |

Ninguno de los dos aparece si la app ya corre en modo *standalone*. El descarte se recuerda en `localStorage['pwa-install-dismissed']` y **silencia el banner 7 días**.

---

## 15 · Contrato API completo del usuario final

| Método y ruta | Auth | Entrada | Salida | Límite |
| --- | --- | --- | --- | --- |
| `POST /api/auth/register` | — | `{email,password,company_name,company_nif}` | `{accessToken,expiresIn,user}` · `202 {pending:true,message,user}` | 10/15 min |
| `POST /api/auth/login` | — | `{email,password,remember_me}` | `{accessToken,expiresIn:900,user:{id,email}}` + cookie de refresco | 10/15 min |
| `POST /api/auth/refresh` | cookie | — | `{accessToken,expiresIn}` | 60/15 min |
| `POST /api/auth/logout` | cookie | — | — | — |
| `POST /api/auth/forgot-password` | — | `{email}` | Respuesta neutra siempre | 10/15 min |
| `POST /api/auth/reset-password` | — | `{token,newPassword}` | `{ok}` o error | 10/15 min |
| `GET /api/company/status` | Bearer | — | `{status:'active'\|'pending'\|'no_company'\|'not_found', company_name?, company_nif?}` | — |
| `GET /api/me/settings` | Bearer | — | `{auto_confirm_enabled, company_nif, company_name, company_nif_aeat_warning, is_admin, is_tech_admin}` | — |
| `POST /api/upload-preview` | Bearer | `multipart: file, invoice_type` | Objeto completo de previsualización (§08) | 30/15 min |
| `POST /api/upload-confirm` | Bearer | JSON de campos confirmados (§12) | `{success}` · `{duplicate}` · `{cif_mismatch}` · 410 caducado | 60/15 min |
| `GET /api/proveedor/:nif` | Bearer | NIF en la ruta | `{found:boolean, nombre?}` | 60/15 min |
| `GET /api/vies/:nif` | Bearer | CIF en la ruta | `{valid:true\|false\|null, nombre, reason?}` | 10/min |
| `GET /api/mis-facturas` | Bearer | — | `{facturas:[…]}` — 7 días, máx. 50 | — |
| `GET /api/facturas/:id/imagen` | Bearer | — | Binario en línea, solo del propietario | — |
| `POST /api/test-captura` | Bearer + soporte técnico | `multipart: file` | `{aviso,tiempo_ms,ocr_engine,dual_confirmed,confidence,campos}` — no persiste nada | 30/15 min |

Además de los límites de la aplicación, Nginx aplica **10 peticiones/segundo por IP** con ráfaga de 20 y un máximo de **50 conexiones simultáneas** por IP. Superarlos devuelve `429`.

### Campos de cada factura del historial

```
id, proveedor_nombre, proveedor_nif, receptor_nombre, receptor_nif,
numero_factura, fecha_emision, total_factura, moneda,
base_imponible, iva_porcentaje, cuota_iva, irpf_porcentaje, cuota_irpf,
lineas_iva, iva_validation_ok, iva_warnings,
confidence_level, invoice_type, uploaded_at, procesado_en

// file_path se eliminó deliberadamente de la respuesta: exponía rutas internas.
```

---

## 16 · Microcopy literal

Los textos son parte del producto y están validados con el cliente. Trasládalos **palabra por palabra**; si algo hay que reescribir, que sea una decisión explícita.

### Acceso

- «Iniciar Sesión» · «Mantener sesión iniciada» · «Entrar»
- «¿No tienes cuenta? Regístrate» · «¿Olvidaste tu contraseña?»
- «El registro está disponible solo para usuarios autorizados.»
- «⚠ Ese CIF no supera el algoritmo de validación AEAT. Puedes continuar, pero revisa si hay algún error de transcripción.»
- «Ingresa tu email y te enviaremos instrucciones para restablecer tu contraseña.»
- «Si el email existe, recibirás instrucciones de recuperación»
- «¡Contraseña actualizada exitosamente! Redirigiendo al login...»

### Empresa pendiente

- «Empresa pendiente de verificación»
- «Tu empresa está siendo revisada por el equipo de **SETEX**. Recibirás acceso completo una vez que sea aprobada.»
- «Tu solicitud fue recibida. Un administrador revisará tu empresa en breve.»
- «Si tienes dudas, contacta con el administrador de SETEX.»
- «¡Tu empresa fue aprobada! Inicia sesión para acceder.»

### Captura

- «📥 Factura Recibida» · «📤 Factura Emitida»
- «📷 Capturar Foto» · «📄 Subir Archivo» · «Enviar»
- «📋 Historial de facturas» · «Ver más facturas» · «Sin facturas en los últimos 7 días»
- Cámara: «⚠️ No debe salir sombras ni brillos.» · «Capturar»

### Confirmación

- «Confirma los datos» / «Completa los datos que faltan»
- «Revisa que la información extraída es correcta. Puedes corregir cualquier campo antes de guardar.»
- «La IA no pudo leer algún campo. Introduce los datos manualmente o cancela para repetir la foto.»
- «⚠ **CIF/NIF no detectado por ninguna IA** — Verifica e introduce manualmente el CIF o NIF del proveedor antes de confirmar.»
- «✓ Proveedor conocido — CIF verificado anteriormente»
- «🧾 Esta factura tiene **varios tipos de IVA**. Revisa y ajusta cada tramo por separado.»
- «⚠ Revisar este tramo: la cuota no cuadra con BASE × IVA % ÷ 100.»
- «⚠ Los importes no cuadran. Revisa Base, IVA, IRPF y Total antes de guardar.»
- «✕ Quitar IRPF» · «➕ Añadir tramo al *N*%» · «✕ Eliminar tramo»
- «Ya tienes los 4 tipos de IVA posibles (21, 10, 4 y 0).»
- «✓ Confirmar y guardar» · «Guardando...» · «✗ Repetir foto»
- «Corrige los errores indicados antes de guardar» (*title* del botón bloqueado)

> **Texto legal — no alterar**
>
> «Al confirmar, declaro que he revisado los datos y que son correctos y veraces.»
>
> Va en rojo `#c53030` sobre `#fff5f5`, centrado, **debajo** del botón de guardar. Es la declaración responsable que traslada al usuario la veracidad de los datos: su presencia, su posición y su redacción son deliberadas.

### Resultados

- «Factura guardada correctamente ✓ (Recibida)» / «(Emitida)»
- «CIF/NIF, fecha y total son obligatorios»
- «Error de conexión. Comprueba tu internet.» · «Error de conexión. Comprueba tu conexión a internet.» *(dos variantes; unificar)*
- «Tu sesión ha expirado. Por favor, inicia sesión de nuevo.»
- «El servicio está disponible de 06:00 a 00:00. Vuelve más tarde.» *(página offline)*

---

## 17 · Comportamiento móvil y accesibilidad

### Arreglos móviles que hay que conservar

| Regla | Problema que resuelve |
| --- | --- |
| `#confirm-modal input { font-size:16px !important }` | iOS hace zoom automático al enfocar un input de menos de 16 px |
| `touch-action: manipulation` | Elimina el retardo de 300 ms al tocar |
| `-webkit-tap-highlight-color: transparent` | Quita el destello azul del toque |
| `padding-bottom: max(20px, env(safe-area-inset-bottom))` | Muesca del iPhone |
| `-webkit-overflow-scrolling: touch` | Scroll con inercia en iOS |
| `<video playsinline>` | Evita que iOS abra el reproductor a pantalla completa |
| `inputmode="numeric" / "decimal"` | Teclado numérico en los campos de importe |
| Ocultar el marcador nativo de `<details>` | Flecha propia con rotación coherente entre navegadores |

### Estado de accesibilidad — sincero

> **Lo que falta hoy**
>
> - Los modales no atrapan el foco, no son `role="dialog"` ni `aria-modal`, y no se cierran con `Esc`.
> - Los mensajes de error y éxito no son regiones activas: un lector de pantalla no los anuncia.
> - No hay estado de foco visible propio: se hereda el del navegador y en algunos botones se pierde.
> - El botón de linterna tiene `aria-label` — es el único elemento con etiqueta accesible explícita.
> - Los distintivos de estado dependen solo del color y del emoji; falta texto alternativo.
> - No se respeta `prefers-reduced-motion`.
> - La tabla del historial no tiene `<caption>` ni `scope` en las cabeceras.

Ninguna de estas carencias impide funcionar, y por eso llevan ahí desde el principio. Una app nueva que las arrastre está eligiendo arrastrarlas: todas se resuelven en la primera implementación por una fracción de lo que cuesta añadirlas después.

---

## 18 · Trampas conocidas y qué no replicar

| Punto | Situación actual | Recomendación |
| --- | --- | --- |
| **Peso de OpenCV.js** | 8,9 MB para dibujar un contorno y recortar. Carga perezosa, pero cuando entra, entra entera | Medir cuánto aporta al acierto del OCR. Si el recorte no mejora la lectura, quitarlo libera el 99 % del peso del frontend. Si aporta, considerar una compilación WASM reducida solo con los módulos usados |
| **PDF.js sin usar** | 1,4 MB en disco, nunca referenciado desde `index.html` | No migrar. Si en el futuro hace falta previsualizar PDF, se añade entonces |
| **Estilos inline** | La mayor parte del diseño vive en atributos `style` del HTML y en plantillas de cadena | Extraer a tokens y componentes. Es la tarea que más reduce el coste de mantenimiento futuro |
| **HTML sin escapar en el historial** | Los valores del servidor se concatenan sin escape; el modal sí escapa | Escapar siempre, o renderizar por nodos. Ver §13 |
| **`onclick` inline** | En el botón de imagen del historial y en la × del visor | Sustituir por delegación de eventos: son incompatibles con una CSP sin `unsafe-inline` |
| **Elementos legacy ocultos** | `#irpf-section`, `#irpf-toggle-row`, `#btn-toggle-irpf` y `#confirm-iva-calc` existen solo para no romper *listeners* | Eliminarlos en la app nueva y quitar las referencias correspondientes |
| **Sincronización manual bidireccional** | Dos banderas globales evitan bucles infinitos entre resumen y campos superiores | Sustituir por estado derivado. Es donde un framework reactivo se paga solo |
| **Errores por `alert()`** | Los fallos de login usan el diálogo nativo del navegador | Llevar al mismo componente de mensajes que el resto de la app |
| **Fallos silenciados** | Varios `catch {}` vacíos: ajustes de usuario, historial, búsqueda de proveedor, VIES | Silenciar de cara al usuario está bien, pero registrar siempre. Un fallo repetido de `/api/me/settings` hoy es invisible y deja a la app sin identidad de empresa — y por tanto sin validación cruzada de CIF |
| **Doble analizador de importes** | Tres funciones con reglas ligeramente distintas | Unificar en una, con pruebas sobre los casos reales: `1.234,56`, `1234,56`, `1,230`, `1234.56`, `1,5` |
| **Cache-busting manual** | `?v=YYYYMMDD-NNN` a mano en cada cambio; olvidarlo sirve la versión antigua | Hash de contenido automático en el build |
| **Bloqueo horario en el service worker** | La franja 00:00–06:00 está codificada en el cliente y duplica la del servidor | Mantener la del servidor como autoridad; la del cliente solo como cortesía offline, y leyendo la franja desde configuración |

---

## 19 · Checklist de paridad

La app nueva está a la altura de la actual cuando estas afirmaciones son ciertas y verificadas en un móvil real, no solo en el emulador.

### Sesión

- [ ] El token de acceso nunca aparece en `localStorage` ni `sessionStorage`.
- [ ] Diez peticiones simultáneas con el token a punto de caducar producen **un** refresco, no diez.
- [ ] Un 401 se recupera solo, con un único reintento.
- [ ] Cerrar sesión en una pestaña la cierra en todas.
- [ ] Todas las peticiones autenticadas llevan `X-Requested-With` y `credentials:'include'`.

### Captura

- [ ] Cerrar la cámara apaga el LED y la linterna, siempre.
- [ ] Denegar el permiso de cámara cae al selector nativo sin bloquear al usuario.
- [ ] Sin OpenCV disponible, la foto se hace igual.
- [ ] El fichero enviado lleva el nombre `{usuario}_{fecha}_{hora}{.ext}`.
- [ ] El tipo de factura viaja en el `multipart` y vuelve confirmado.

### Motor fiscal

- [ ] Un IVA leído como «211» llega al servidor como «21».
- [ ] Dos tramos idénticos se colapsan en uno; nunca se envían más de cuatro.
- [ ] Editar la base recalcula la cuota, y viceversa, **sin pisar el campo enfocado**.
- [ ] El total del resumen y el total superior nunca divergen.
- [ ] Una cuota mil veces mayor de lo esperado se corrige antes de mostrarse.
- [ ] El banner de descuadre aparece y desaparece con exactitud, sin quedarse pegado.
- [ ] Los cuadros solo se abren solos cuando hay anomalía.

### Identidad fiscal

- [ ] Emisor y receptor con el mismo CIF bloquean el guardado.
- [ ] Una factura recibida que no va dirigida a tu CIF bloquea el guardado.
- [ ] Un nombre distinto con CIF correcto solo avisa.
- [ ] Un CIF que no supera el dígito AEAT avisa, pero jamás impide continuar.
- [ ] Los errores devueltos por el servidor se pintan igual que los locales.

### Flujo completo

- [ ] Guardar limpia fichero, previsualización, ambos inputs y devuelve el tipo a Recibida.
- [ ] Un duplicado se comunica y cierra el modal.
- [ ] Un preview caducado (30 min) se explica y ofrece salida.
- [ ] El botón atrás cierra el modal sin salir de la app.
- [ ] «Repetir foto» descarta y reabre la cámara; «atrás» descarta y no la reabre.

### PWA

- [ ] Instalable en Android y con instrucciones correctas en iOS.
- [ ] El descarte del banner dura 7 días.
- [ ] Una versión nueva ofrece actualizar y recarga sola al aplicarla.
- [ ] `/api/*` nunca se sirve desde caché.

---

## 20 · Las cinco preguntas del experto

### 1. ¿Framework o vanilla en la app nueva?

**Framework, y por una razón concreta:** el modal de confirmación. Todo lo demás de esta app se sostiene sin problema en JavaScript plano, pero la sincronización bidireccional entre tramos, campos superiores y resumen ya necesita dos banderas globales para no entrar en bucle, y cada nueva regla fiscal empeora ese nudo. Con estado derivado, el resumen deja de ser código y pasa a ser una expresión. Recomendación concreta: **Svelte o Vue** por tamaño de paquete —la app se usa en móvil, con datos móviles y a veces en un almacén— y porque su modelo de reactividad encaja con formularios. React es defendible si el equipo ya lo domina; lo que no es defendible es reescribir el motor fiscal a mano por tercera vez.

### 2. ¿Qué se hace con los 8,9 MB de OpenCV?

**Se decide con datos, y hoy no los hay.** El experimento es barato: durante dos semanas, enviar en la subida una marca de si el recorte se aplicó, y comparar la tasa de campos que el usuario tiene que corregir con recorte y sin él. Si la diferencia es pequeña, se elimina y el frontend adelgaza un 99 %. Si es grande, la biblioteca se queda pero conviene compilar una versión de OpenCV solo con `imgproc`, que baja a un orden de 1–2 MB. Mientras tanto, la carga perezosa actual ya es la mitigación correcta: quien no abre la cámara no descarga nada.

### 3. ¿Qué hay que arreglar sí o sí durante la migración?

Tres cosas, en este orden. **Escapar el HTML del historial** — es la única deuda con cara de seguridad. **Registrar los `catch` silenciosos**: si `/api/me/settings` falla, la app se queda sin CIF de empresa y toda la validación cruzada de §11 deja de funcionar en silencio, que es exactamente el modo de fallo que nadie detecta. Y **accesibilidad mínima en los modales**: `role`, atrapar el foco y cerrar con `Esc`. Las tres cuestan horas ahora y semanas después.

### 4. ¿El bloqueo horario 00:00–06:00 debe seguir en el cliente?

**Como cortesía sí, como control no.** La autoridad es y debe seguir siendo el *auth_request* de Nginx, que ya devuelve 404 fuera de horario para HTML, JS, CSS y API. La copia del service worker solo existe para que un usuario sin cobertura vea una explicación en lugar de una app rota, y eso tiene valor. Lo que sí conviene cambiar es que la franja está escrita a mano en el service worker: si el cliente decide ampliar el horario, hoy hay que tocar código y publicar. Debería leerse de la configuración del servidor y cachearse.

### 5. ¿Qué falta en el producto que este frontend ya podría dar?

El servidor ya envía datos que la interfaz recibe y tira: `dual_confirmed`, `ocr_discrepancy`, `confidence`, `vies_nombre` y `requires_review`. Con eso se puede construir un indicador de confianza por campo — marcar en ámbar los que los dos motores leyeron distinto, en lugar de presentarlos todos con la misma autoridad. Es la mejora de calidad de dato más grande disponible sin tocar el backend, y encaja con la política de §09: llamar la atención solo sobre lo dudoso. La segunda es más simple y más urgente: **un indicador de progreso durante los 2–5 segundos del OCR**. Hoy el usuario ve un botón apagado y no sabe si la app está pensando o rota.

---

**SETEX · Captura de Facturas** — Hiperdocumento del frontend de usuario final, v1.0, 1 de agosto de 2026. Extraído de `/opt/setex/prod/app/frontend/src`. Alcance: usuario final. El panel de administración se documenta aparte.

Este documento describe el comportamiento observado en el código de producción en la fecha indicada. Cualquier cambio posterior en `app.js`, `index.html` o los contratos de la API invalida las secciones correspondientes.
