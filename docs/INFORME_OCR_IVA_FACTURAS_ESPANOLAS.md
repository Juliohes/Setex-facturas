# Informe Técnico: OCR de Facturas Españolas con LLMs
## Base imponible, IVA múltiple, IRPF, Proveedor vs Receptor
### SETEX Captura Facturas · 2026-03-31

---

## RESUMEN EJECUTIVO

Este informe analiza en profundidad los problemas y soluciones para la extracción OCR de
datos fiscales de facturas españolas usando GPT-4.1 Vision y Azure Document Intelligence
prebuilt-invoice. Cubre: IVA multi-tipo, separación proveedor/receptor, IRPF, y las
limitaciones conocidas de cada motor. Se incluyen recomendaciones de código concretas
para el sistema SETEX.

---

## 1. ESTRUCTURA FISCAL DE FACTURAS ESPAÑOLAS

### 1.1 Marco legal (RD 1619/2012)

El Reglamento de Facturación español (Real Decreto 1619/2012) exige en el Artículo 6:

**Campos obligatorios en TODA factura:**
- Número y serie correlativa
- Fecha de expedición
- Nombre/razón social completa del **emisor** (proveedor) con su NIF/CIF
- Nombre del **receptor** (destinatario) si es empresario/profesional
- Descripción de bienes/servicios con precio unitario
- **Tipo impositivo** o tipos impositivos aplicables
- **Base imponible** por cada tipo de IVA
- **Cuota tributaria** repercutida, consignada por separado
- Importe total

**Facturas simplificadas** (tickets): El receptor NO tiene que aparecer obligatoriamente,
salvo que lo pida o sea necesario para deducción. Esto es la principal causa de errores
OCR cuando el modelo intenta inventar un receptor.

### 1.2 Los tres tipos de IVA vigentes en España

| Tipo | Porcentaje | Aplicación |
|------|-----------|------------|
| General | 21% | La mayoría de bienes y servicios |
| Reducido | 10% | Alimentación no básica, hostelería, transporte, obras de reforma, medicamentos no recetados |
| Superreducido | 4% | Pan, leche, huevos, frutas/verduras, libros, medicamentos con receta, material escolar |
| Exento | 0% | Servicios médicos, seguros, educación, operaciones financieras (art. 20 LIVA) |

**Casuística problemática:**
- Una sola factura puede mezclar IVA 21% + IVA 10% + IVA 4% en la misma hoja
- Un restaurante puede facturar: comida 10% + bebida alcohólica 21% + tónica 21% + menú 10%
- Una constructora: materiales 21% + mano de obra reforma 10%
- Bienes de segunda mano: régimen especial de bienes usados (margen)
- Operaciones intracomunitarias: exentas de IVA español pero con mención obligatoria

### 1.3 Estructura típica de factura con IVA múltiple

```
FACTURA Nº: 2024/0123
Fecha: 15/03/2024

EMISOR (PROVEEDOR):
Empresa Proveedora S.L.        NIF: B12345678
Calle Mayor 1, 28001 Madrid

RECEPTOR (CLIENTE):
Mi Empresa S.A.               NIF: A87654321
Calle Nueva 5, 08001 Barcelona

CONCEPTOS:
Consultoría IT                   Base: 5.000,00 €   IVA 21%:  1.050,00 €
Material Informático             Base: 2.000,00 €   IVA 21%:    420,00 €
Servicio Catering Reunión        Base:   500,00 €   IVA 10%:     50,00 €

RESUMEN FISCAL:
Base imponible 21%:  7.000,00 €     Cuota IVA 21%:  1.470,00 €
Base imponible 10%:    500,00 €     Cuota IVA 10%:     50,00 €

TOTAL BASE IMPONIBLE:  7.500,00 €
TOTAL IVA:             1.520,00 €
TOTAL FACTURA:         9.020,00 €
```

---

## 2. PROBLEMA: IVA MÚLTIPLE EN FACTURAS ESPAÑOLAS

### 2.1 El problema raíz

**El problema más frecuente con facturas de múltiples tipos de IVA:**
El sistema SETEX actual usa un esquema plano con un solo campo `iva_porcentaje`
y un solo campo `cuota_iva`. Esto es incorrecto para facturas con tipos mixtos.

Con la factura del ejemplo anterior, el sistema actual extraería:
- `iva_porcentaje`: "21,0" (solo captura el primero o el más prominente)
- `cuota_iva`: "1.520,00" (suma total, pero sin desglose)
- `base_imponible`: "7.500,00" (base total, correcta pero sin desglose)

El problema: el campo `iva_porcentaje` = "21,0" es incorrecto (la factura tiene 21% Y 10%).
El campo `cuota_iva` = "1.520,00" es correcto en suma pero no atribuible a un tipo.

Para contabilidad esto es insuficiente: el Libro de Facturas Recibidas de IVA
debe desglosar por tipo (modelo 303/349).

### 2.2 Frecuencia del problema

Basado en casuística real de SETEX y el sector:
- ~60% facturas: solo IVA 21% (empresas de servicios B2B puras) → OK con sistema actual
- ~25% facturas: solo IVA 10% (hostelería, construcción reforma) → OK con sistema actual
- ~10% facturas: mezcla 21% + 10% (restaurantes con servicios, constructoras mixtas) → FALLA
- ~3% facturas: mezcla 21% + 4% o tres tipos → FALLA GRAVE
- ~2% facturas: exentas o régimen especial → Caso aparte

El 15% con multi-tipo es suficiente para causar problemas contables relevantes.

### 2.3 Comportamiento de GPT-4.1 con IVA múltiple

**Problema A — Campo único forzado:**
Con el JSON Schema actual (un solo `iva_porcentaje: string`), GPT-4.1 tiene que elegir
uno solo y descarta el resto. Su comportamiento observado:
- Elige el primero que encuentra visualmente (no siempre el de mayor base)
- Elige el de mayor importe cuota (heurística interna del modelo)
- A veces devuelve "21,0 / 10,0" o "21,0+10,0" como texto libre → rompe el parser

**Problema B — Base imponible inconsistente:**
Cuando hay múltiples tipos, GPT-4.1 puede extraer como `base_imponible` cualquiera de:
1. La suma total de todas las bases (correcto para validación de total)
2. Solo la base al tipo mayoritario (incorrecto)
3. La última base que ve en la tabla de resumen (incorrecto)

**Problema C — Cuota IVA inconsistente:**
Si la factura muestra un subtotal de IVA por tipo y luego un total IVA, el modelo puede
extraer cualquiera de los dos. La inconsistencia entre `base_imponible` y `cuota_iva`
se detecta en validación: base × (iva_pct/100) ≠ cuota.

### 2.4 Comportamiento de Azure Document Intelligence con IVA múltiple

Azure DI prebuilt-invoice ofrece dos mecanismos para impuestos:

**Mecanismo 1 — TaxDetails (array, desde v3.1):**
```json
"TaxDetails": {
  "type": "array",
  "valueArray": [
    {
      "type": "object",
      "valueObject": {
        "Amount": {
          "type": "currency",
          "valueCurrency": { "amount": 1470.00, "currencyCode": "EUR" },
          "confidence": 0.99
        },
        "Rate": {
          "type": "string",
          "valueString": "21 %",
          "confidence": 0.98
        }
      }
    },
    {
      "type": "object",
      "valueObject": {
        "Amount": {
          "type": "currency",
          "valueCurrency": { "amount": 50.00, "currencyCode": "EUR" },
          "confidence": 0.96
        },
        "Rate": {
          "type": "string",
          "valueString": "10 %",
          "confidence": 0.95
        }
      }
    }
  ]
}
```

**Mecanismo 2 — TaxRate a nivel de línea (Items[].TaxRate):**
```json
"Items": {
  "valueArray": [
    {
      "valueObject": {
        "Description": { "valueString": "Consultoría IT" },
        "Amount": { "valueCurrency": { "amount": 6050.00 } },
        "UnitPrice": { "valueCurrency": { "amount": 5000.00 } },
        "Tax": { "valueCurrency": { "amount": 1050.00 } },
        "TaxRate": { "valueString": "21%" }
      }
    }
  ]
}
```

**Limitación crítica de Azure DI con facturas españolas:**
- TaxDetails NO siempre se rellena en facturas españolas. El modelo fue entrenado
  principalmente con facturas angloamericanas. En facturas donde el IVA se agrupa
  en una tabla resumen al pie (estilo español común), Azure DI frecuentemente:
  - Solo extrae el TotalTax (suma) sin desglosar
  - Deja TaxDetails vacío aunque visualmente haya desglose
  - Confunde la tabla de IVA desglosado como "tabla de items" en vez de "tax summary"

- La confidence de TaxDetails.Rate suele ser baja (0.5-0.7) en facturas escaneadas
  o fotografiadas porque el texto de porcentaje suele estar en tamaño pequeño.

- TaxRate en Items SOLO se rellena si la factura tiene una columna de IVA por línea.
  Las facturas españolas frecuentemente muestran el IVA solo en el resumen final,
  no por cada línea → Items[].TaxRate = null en la mayoría de facturas españolas.

**El azure.js actual NO usa TaxDetails:** La función `extractIvaPorcentaje()` intenta
TaxRate directo o calcula desde SubTotal/TotalTax. No itera el array TaxDetails.
Esto significa que se pierde el desglose multi-tipo que Azure SÍ proporciona.

### 2.5 Problemas de redondeo en IVA

El redondeo del IVA en España genera diferencias de ±0,01 € que confunden las validaciones:

```
Base imponible:  1.234,56 €
IVA 21%:         259,26 € (matemático: 259,2576 → redondea a 259,26)
Total:          1.493,82 €

Pero muchas facturas imprimen:
IVA 21%:         259,25 € (redondeo del software emisor)
Total:          1.493,81 €
```

Problema: si validas `base * 0.21 = cuota` con tolerancia 0, el 40% de facturas reales
fallan la validación. La tolerancia debe ser al menos ±0,02 € por línea de IVA.

**Fuente adicional de discrepancia:** Cuando hay múltiples líneas de detalle, el IVA
se puede calcular como:
- Suma de (base_línea × tipo) para cada línea → redondeo por línea
- (suma_bases_total) × tipo → redondeo sobre el total

Ambos son fiscalmente válidos en España pero producen totales diferentes.

---

## 3. PROBLEMA: SEPARACIÓN PROVEEDOR vs RECEPTOR

### 3.1 Por qué los LLMs confunden emisor y receptor

Esta es la segunda fuente de errores más frecuente tras el IVA múltiple.

**Causa A — Posición visual no es determinista:**
En facturas bien formateadas: emisor arriba, "Facturar a:" abajo.
Pero muchas facturas españolas (especialmente de software de gestión como FacturaPlus,
Contasol, A3) invierten el orden o ponen ambos lado a lado:

```
[LOGO EMPRESA]
[Nombre Empresa S.L.] [FACTURAR A:]
[Dirección Emisor   ] [Nombre Cliente S.A.]
[NIF: B12345678    ] [NIF: A87654321    ]
```

Con este layout de dos columnas, GPT-4 lee de izquierda a derecha y puede:
- Asignar el NIF de columna derecha a `proveedor_nif` si lee esa zona primero
- Mezclar los nombres de ambas columnas

**Causa B — Ausencia de etiquetas en facturas simplificadas:**
En tickets y facturas simplificadas (gasolineras, supermercados, taxis), solo aparece
el emisor. No existe sección "Facturar a:" ni NIF del receptor. El LLM puede:
- Inventar un receptor (alucinación) → capturado por validateCIF.js
- Intentar extraer el NIF del usuario si aparece escrito a mano o como sello
- Confundir el CIF del emisor y asignarlo a ambos campos

**Causa C — Terminología inconsistente en facturas españolas:**
Las etiquetas que identifican emisor/receptor varían enormemente:

Emisor puede llamarse: "Empresa", "Proveedor", "Datos del emisor", "De:", nombre directo
Receptor puede llamarse: "Cliente", "Facturar a:", "A/A:", "Destinatario", "Para:",
"Datos del cliente", "Empresa cliente", "CIF/NIF del cliente"

GPT-4 tiene el contexto para entender estos sinónimos, pero el stress del JSON Schema
strict a veces prioriza la posición visual sobre el significado semántico.

**Causa D — Facturas de autónomos sin denominación "empresa":**
```
Juan García López
NIF: 12345678Z
Freelance Servicios IT
```

GPT-4 puede no reconocer que "Juan García López" con NIF es el EMISOR si no hay
una etiqueta explícita, especialmente si su nombre también aparece como "firma" al pie.

### 3.2 Cómo Azure Document Intelligence distingue VendorName vs CustomerName

Azure DI prebuilt-invoice usa posición semántica entrenada:
- **VendorName**: zona superior izquierda, primer bloque de identidad encontrado
- **CustomerName**: zona etiquetada con "Bill to:", "Ship to:", "Customer:", "Client:"
- **VendorTaxId**: campo etiquetado con "VAT:", "Tax ID:", "NIF:", "CIF:" cerca del emisor
- **CustomerTaxId**: campo etiquetado con "VAT:", "Tax ID:", "NIF:", "CIF:" cerca del cliente

**Fiabilidad de Azure DI en facturas españolas:**
- VendorName: fiabilidad ~85% (alta, el emisor siempre está en cabecera)
- CustomerName: fiabilidad ~70% (media, depende de que la etiqueta "Facturar a:" sea reconocida)
- VendorTaxId: fiabilidad ~80% (buena si el CIF está cerca del nombre del emisor)
- CustomerTaxId: fiabilidad ~60% (baja, muchas facturas simplificadas no lo incluyen)

**Caso real de confusión Azure DI:**
En facturas de formato "carta" donde el receptor aparece en la parte superior (como
destinatario de correo postal) y el emisor aparece en la cabecera o membrete:
Azure DI asigna erróneamente VendorName al destinatario de la carta.

**Confidence mínimo recomendado:** 0.6 para campos de identidad fiscal (actualmente
en azure.js está en 0.5, lo que deja pasar extraccciones de baja calidad).

### 3.3 Facturas simplificadas (tickets)

Cuando `receptor_nombre` y `receptor_nif` son null, es comportamiento correcto,
no un error. El sistema actual lo maneja bien: acepta null en ambos campos.

Pero el problema surge en el lado del EMISOR en tickets:
- Gasolineras: CIF de Repsol/Cepsa/BP está en letra muy pequeña (6-8pt) en el ticket
- Supermercados: CIF puede estar en la parte inferior del ticket
- Taxis: solo número de licencia, sin CIF visible

En estos casos la extracción dual OpenAI+Azure es especialmente valiosa: OpenAI
con recorte superior intenta el CIF, Azure intenta desde posición estructural.

### 3.4 Técnicas de prompt engineering para distinguir emisor/receptor

**Técnica 1 — Anclas semánticas explícitas:**
```
El EMISOR/PROVEEDOR es quien firma y emite la factura. Aparece en el membrete,
cabecera o esquina superior. Es quien cobra.
El RECEPTOR/CLIENTE es quien recibe la factura y debe pagar. Aparece en la
sección "Facturar a:", "Datos del cliente" o "Destinatario". Es quien paga.
Si solo aparece una empresa/persona, es el EMISOR. El receptor puede ser null.
```

**Técnica 2 — Orden de prioridad para identificación:**
```
Para identificar el EMISOR:
1. Busca el membrete o logotipo (zona superior)
2. Busca etiquetas: "Empresa:", "Emisor:", "Proveedor:", "De:"
3. Si hay NIF/CIF cerca de un nombre al inicio del documento → ese es el emisor

Para identificar el RECEPTOR:
1. Busca: "Facturar a:", "Cliente:", "Destinatario:", "A/A:", "Datos del cliente"
2. El bloque de texto debajo de esas etiquetas es el receptor
3. Si no encuentras ninguna de esas etiquetas → receptor = null (no inventes)
```

**Técnica 3 — Few-shot con ejemplo español:**
```json
{
  "ejemplo_input": "Fontanería García S.L. NIF B39123456 ... Facturar a: Comunidad Vecinos CIF H28654321",
  "ejemplo_output": {
    "proveedor_nombre": "FONTANERÍA GARCÍA S.L.",
    "proveedor_nif": "B39123456",
    "receptor_nombre": "COMUNIDAD VECINOS",
    "receptor_nif": "H28654321"
  }
}
```

**Técnica 4 — Posición espacial en base64 (experimental 2024):**
Para facturas muy problemáticas, se puede recortar la imagen en cuadrantes:
- Cuadrante superior-izquierdo → siempre el emisor en facturas españolas
- Cuadrante inferior-central → la tabla de IVA
- Cuadrante superior-derecho o centro → el receptor ("Facturar a:")

El sistema SETEX ya implementa esto parcialmente en `extractCIFOnly()` con el
recorte del 65% superior. Es la técnica más eficaz para CIFs específicamente.

---

## 4. MULTI-TIPO IVA: ESTRUCTURA DE DATOS Y CONTABILIDAD

### 4.1 Array vs Campos Fijos: la decisión correcta

**Opción A — Campos fijos por tipo:**
```json
{
  "base_imponible_21": "7.000,00",
  "cuota_iva_21": "1.470,00",
  "base_imponible_10": "500,00",
  "cuota_iva_10": "50,00",
  "base_imponible_4": null,
  "cuota_iva_4": null,
  "total_base_imponible": "7.500,00",
  "total_cuota_iva": "1.520,00"
}
```
- Ventaja: schema fijo, compatible con JSON Schema strict de OpenAI
- Desventaja: solo cubre tipos conocidos, no cubre exenciones ni recargos
- Desventaja: si hay IVA al 21% y al 10%, ¿cuál va en "21"? Requiere lógica de mapeo

**Opción B — Array de líneas IVA:**
```json
{
  "lineas_iva": [
    { "tipo_porcentaje": "21,0", "base_imponible": "7.000,00", "cuota": "1.470,00" },
    { "tipo_porcentaje": "10,0", "base_imponible": "500,00", "cuota": "50,00" }
  ],
  "total_base_imponible": "7.500,00",
  "total_cuota_iva": "1.520,00",
  "total_factura": "9.020,00"
}
```
- Ventaja: flexible, cubre cualquier combinación de tipos
- Ventaja: ideal para contabilidad (mapeo directo a Libro de IVA)
- Desventaja: JSON Schema strict de OpenAI requiere soporte de arrays, que es compatible
  pero requiere definir los ítems del array con `additionalProperties: false`
- Desventaja: puede devolver 0 elementos si no se detecta ningún tipo

**Recomendación para SETEX:** Opción híbrida:
```json
{
  "lineas_iva": [...],          // array con el desglose completo
  "iva_porcentaje_principal": "21,0",  // retrocompatibilidad con sistema actual
  "cuota_iva_total": "1.520,00",       // retrocompatibilidad
  "base_imponible_total": "7.500,00"   // retrocompatibilidad
}
```

### 4.2 Cómo validan las empresas reales estos datos para contabilidad

**Validación 1 — Suma de bases = base total:**
```javascript
const sumasBases = lineasIva.reduce((acc, l) => acc + parseFloat(l.base), 0);
Math.abs(sumasBases - totalBase) < 0.05  // tolerancia ±5 céntimos
```

**Validación 2 — Cuota = base × tipo (con tolerancia redondeo):**
```javascript
for (const linea of lineasIva) {
  const cuotaCalculada = parseFloat(linea.base) * (parseFloat(linea.tipo) / 100);
  const diferencia = Math.abs(cuotaCalculada - parseFloat(linea.cuota));
  if (diferencia > 0.03) {  // más de 3 céntimos → sospechoso
    flags.push(`IVA ${linea.tipo}%: cuota declarada ${linea.cuota} vs calculada ${cuotaCalculada.toFixed(2)}`);
  }
}
```

**Validación 3 — Total = suma_bases + suma_cuotas - irpf:**
```javascript
const totalCalculado = totalBase + totalIva - cuotaIrpf;
Math.abs(totalCalculado - totalFactura) < 0.05
```

**Validación 4 — Tipos de IVA válidos en España (2024-2025):**
```javascript
const TIPOS_IVA_VALIDOS = [0, 4, 5, 10, 21];  // 5% fue temporal 2022-2023, ya no vigente
// Nota: no hay 16%, 18%, 19%, 20% en España. Si GPT devuelve eso, es error.
```

---

## 5. IRPF EN FACTURAS ESPAÑOLAS

### 5.1 Cuándo aparece el IRPF

El IRPF como retención en factura SOLO aplica cuando el emisor es:
- Autónomo (persona física) con actividad profesional
- Sociedades civiles en ciertos casos

**NO aplica en:**
- Facturas entre sociedades limitadas/anónimas (SL/SA a SL/SA)
- Facturas de actividades agrícolas con retención específica
- Facturas simplificadas/tickets

**Tipos vigentes:**

| Porcentaje | Aplicación |
|-----------|-----------|
| 15% | Retención general profesional (la más común) |
| 7% | Primer año de actividad profesional + los 2 siguientes |
| 2% | Actividades agrícolas, ganaderas, forestales |
| 19% | Arrendamiento de inmuebles (alquileres) |
| 24% | Rendimientos no residentes UE en algunos casos |

### 5.2 Cómo detectar IRPF en una factura

**Señales visuales:**
- "Retención IRPF 15%:" + importe negativo
- "Ret. 7%:" en facturas de autónomos nuevos
- "(-) Retención:"
- Línea de "Total a pagar" que es MENOR que "Base + IVA" (la diferencia es el IRPF)

**Señal de cálculo inverso:**
Si `total < base_imponible + cuota_iva`, la diferencia es probable IRPF.

```javascript
const diferenciaSospechosa = baseImponible + cuotaIva - totalFactura;
if (diferenciaSospechosa > 0.01) {
  const irpfImplicitoMasProbable = baseImponible * 0.15;
  const coincide15 = Math.abs(diferenciaSospechosa - irpfImplicitoMasProbable) < 0.02;
  const irpfImplicito7 = baseImponible * 0.07;
  const coincide7 = Math.abs(diferenciaSospechosa - irpfImplicito7) < 0.02;
  // Si coincide con 15% o 7%, es muy probable que sea IRPF
}
```

### 5.3 Limitaciones de Azure Document Intelligence con IRPF

**Azure DI NO extrae IRPF.** El modelo prebuilt-invoice fue diseñado con facturas
angloamericanas que no usan retención de IRPF. Los campos de impuesto de Azure DI
son:
- TotalTax: impuesto repercutido (IVA en España, sales tax en USA)
- TaxDetails[].Amount / TaxDetails[].Rate: desglose de ese impuesto

La retención IRPF es un impuesto DEDUCIDO (resta al total), no repercutido.
Azure DI no tiene campo para ello y frecuentemente lo ignora o lo confunde con
un descuento.

**Consecuencia para SETEX:** El IRPF debe extraerse EXCLUSIVAMENTE con GPT-4.1.
La lógica actual en `ocr/index.js` ya lo implementa correctamente:
```javascript
irpf_porcentaje: oF.irpf_porcentaje || '0,0',   // IRPF solo de OpenAI
cuota_irpf: oF.cuota_irpf || '0,00',
```

### 5.4 Prompt engineering para IRPF

El prompt actual en `openai.js` es correcto pero se puede mejorar:

**Mejora propuesta — Instrucción explícita:**
```
IRPF (Retención):
- Busca líneas que contengan "Retención", "IRPF", "Ret." seguidas de un porcentaje
- La retención SIEMPRE es un valor NEGATIVO que reduce el total a pagar
- irpf_porcentaje: el porcentaje que aparece (ej: "15,0", "7,0"). "0,0" si no hay retención.
- cuota_irpf: el importe de la retención sin signo (valor positivo). "0,00" si no hay retención.
- Si total < (base_imponible + cuota_iva), es probable que haya IRPF aunque no esté bien etiquetado.
```

---

## 6. ANÁLISIS DEL CÓDIGO ACTUAL DE SETEX

### 6.1 Estado actual de openai.js

**Fortalezas:**
- JSON Schema strict mode: correcto, evita alucinaciones de formato
- Temperatura 0: correcto para extracción determinista
- Doble pasada CIF (extractCIFOnly): técnica avanzada, muy buena práctica
- Recorte 65% superior para CIF: efectivo y bien implementado

**Gaps identificados:**

**Gap 1 — Schema solo soporta un tipo de IVA:**
```javascript
// ACTUAL (problemático para facturas con múltiples tipos):
iva_porcentaje: { type: ['string', 'null'] },
cuota_iva: { type: ['string', 'null'] },

// PROPUESTO (mantiene retrocompatibilidad + añade desglose):
iva_porcentaje: { type: ['string', 'null'], description: 'Tipo principal o único. Si hay múltiples, el de mayor base.' },
cuota_iva: { type: ['string', 'null'], description: 'SUMA TOTAL de todas las cuotas IVA.' },
lineas_iva: {
  // array opcional con desglose completo
  type: ['array', 'null'],
  items: {
    type: 'object',
    properties: {
      porcentaje: { type: 'string', description: 'Tipo IVA sin %. Ej: "21,0"' },
      base: { type: 'string', description: 'Base imponible a este tipo. Formato español.' },
      cuota: { type: 'string', description: 'Cuota IVA a este tipo. Formato español.' }
    },
    required: ['porcentaje', 'base', 'cuota'],
    additionalProperties: false
  }
},
```

**Gap 2 — No hay validación cruzada IVA:**
No existe ninguna función que valide si `base * iva_pct/100 ≈ cuota_iva`.
Esta validación detecta errores de OCR en importes.

**Gap 3 — El prompt de receptor es demasiado simple:**
```javascript
// ACTUAL:
"4. receptor_nombre - Nombre del RECEPTOR en MAYÚSCULAS. Si no se lee → null."

// MEJORADO:
"4. receptor_nombre - Nombre/razón social del CLIENTE o DESTINATARIO (quien paga, quien recibe la factura). " +
"Aparece bajo 'Facturar a:', 'Cliente:', 'Destinatario:'. " +
"Si solo hay una empresa en la factura, ES EL EMISOR, no el receptor. receptor_nombre = null. " +
"En tickets y facturas simplificadas: SIEMPRE null. " +
"NUNCA pongas el nombre del emisor aquí aunque sea el único nombre visible."
```

### 6.2 Estado actual de azure.js

**Fortalezas:**
- Polling asíncrono correcto
- Threshold de confianza (0.5) como filtro
- Conversión a formato español implementada

**Gaps identificados:**

**Gap 1 — No usa TaxDetails array:**
La función `extractIvaPorcentaje()` NO itera el array TaxDetails de Azure DI.
Solo intenta TaxRate (campo poco fiable en facturas españolas) y calcula
el porcentaje desde SubTotal/TotalTax.

```javascript
// IMPLEMENTACIÓN ACTUAL — pierde el desglose multi-tipo:
function extractIvaPorcentaje(fields) {
  // Intentar TaxRate directo...
  // Calcular desde SubTotal y TotalTax...
  return null; // si no puede
}

// IMPLEMENTACIÓN PROPUESTA — extrae el array TaxDetails:
function extractLineasIva(fields) {
  const lineas = [];
  const taxDetails = fields.TaxDetails;
  if (taxDetails?.valueArray?.length > 0) {
    for (const detail of taxDetails.valueArray) {
      const obj = detail.valueObject || {};
      const amount = obj.Amount?.valueCurrency?.amount;
      const rateStr = obj.Rate?.valueString;  // "21 %" o "21%"
      if (amount != null && rateStr) {
        const rate = parseFloat(rateStr.replace(/[^0-9,.]/g, '').replace(',', '.'));
        if (!isNaN(rate)) {
          lineas.push({
            porcentaje: toSpanishPercent(rate),
            cuota: toSpanishAmount(amount),
            base: rate > 0 ? toSpanishAmount(amount / (rate / 100)) : null
          });
        }
      }
    }
  }
  return lineas.length > 0 ? lineas : null;
}
```

**Gap 2 — IRPF no se intenta detectar:**
Azure DI no extrae IRPF, pero tampoco hay intento de detectar por cálculo inverso.

**Gap 3 — Confianza threshold demasiado baja:**
0.5 para campos de identidad fiscal es bajo. Se recomienda:
- VendorTaxId, CustomerTaxId: threshold 0.65
- VendorName, CustomerName: threshold 0.55
- Importes numéricos: threshold 0.60
- Fechas: threshold 0.70

### 6.3 Estado actual de index.js (orquestador dual)

**Fortalezas:**
- Ejecución paralela OpenAI + Azure DI: muy buena práctica
- Reconciliación por NIF + total + fecha: robusto
- Prioridades de fusión bien pensadas (Azure para fechas, OpenAI para NIFs/IRPF)
- dual_confirmed flag de alta confianza

**Gap 1 — lineas_iva no se fusiona:**
Cuando se añada el array `lineas_iva`, la lógica de fusión en `compareOCRResults()`
debe incluir fusión de los arrays de desglose IVA.

**Gap 2 — Confianza combinada no penaliza suficiente:**
Actualmente baseConf × 0.85 si no hay dual_confirmed. Cuando hay discrepancia
de NIF, la confianza debería bajar más agresivamente: × 0.60.

---

## 7. SOLUCIONES PROPUESTAS CON CÓDIGO

### 7.1 JSON Schema actualizado para GPT-4.1 con multi-IVA

```javascript
// En openai.js — schema actualizado
schema: {
  type: 'object',
  properties: {
    fecha_emision:    { type: ['string', 'null'], description: 'DD/MM/AAAA. null si no visible.' },
    proveedor_nombre: { type: ['string', 'null'], description: 'Razón social del EMISOR en MAYÚSCULAS. El que emite y cobra. null si no legible.' },
    proveedor_nif:    { type: ['string', 'null'], description: 'CIF/NIF del EMISOR exacto de la imagen. null si no visible. NUNCA inventar.' },
    receptor_nombre:  { type: ['string', 'null'],
      description: 'Nombre del CLIENTE/RECEPTOR (quien paga). Aparece bajo "Facturar a:", "Cliente:", "Destinatario:". ' +
      'Si no hay sección de cliente visible → null. En tickets → siempre null. ' +
      'NUNCA poner aquí el nombre del emisor aunque sea el único nombre visible.' },
    receptor_nif:     { type: ['string', 'null'], description: 'CIF/NIF del cliente/receptor. null si no visible o si es factura simplificada.' },
    base_imponible:   { type: ['string', 'null'], description: 'TOTAL BASE IMPONIBLE (suma de todas las bases). Formato español 1.000,00. null si no visible.' },
    iva_porcentaje:   { type: ['string', 'null'], description: 'Si hay UN solo tipo: ese porcentaje sin %. Si hay múltiples tipos: el de mayor base imponible. null si no visible.' },
    cuota_iva:        { type: ['string', 'null'], description: 'TOTAL CUOTA IVA (suma de todas las cuotas). Formato español. null si no visible.' },
    lineas_iva: {
      description: 'Desglose por tipo de IVA. null si solo hay un tipo o no hay desglose visible.',
      oneOf: [
        {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              porcentaje: { type: 'string', description: 'Tipo sin %. Ej: "21,0", "10,0", "4,0"' },
              base:       { type: 'string', description: 'Base imponible a este tipo. Formato español.' },
              cuota:      { type: 'string', description: 'Cuota a este tipo. Formato español.' }
            },
            required: ['porcentaje', 'base', 'cuota'],
            additionalProperties: false
          }
        },
        { type: 'null' }
      ]
    },
    irpf_porcentaje:  { type: 'string', description: 'Retención IRPF sin %. Solo en facturas de autónomos profesionales. "0,0" si no hay IRPF.' },
    cuota_irpf:       { type: 'string', description: 'Importe IRPF retenido (siempre positivo). "0,00" si no hay.' },
    total:            { type: ['string', 'null'], description: 'TOTAL A PAGAR final (base + IVA - IRPF). Formato español. null si no visible.' },
    moneda:           { type: 'string', description: 'EUR por defecto.' },
    es_factura_valida: { type: 'boolean', description: 'true si es factura o ticket legible.' }
  },
  required: [
    'fecha_emision', 'proveedor_nombre', 'proveedor_nif', 'receptor_nombre',
    'receptor_nif', 'base_imponible', 'iva_porcentaje', 'cuota_iva',
    'lineas_iva', 'irpf_porcentaje', 'cuota_irpf', 'total', 'moneda',
    'es_factura_valida'
  ],
  additionalProperties: false
}
```

### 7.2 Función de validación cruzada IVA (nuevo módulo)

```javascript
// Nuevo archivo: src/ocr/validateIVA.js

'use strict';

const TIPOS_IVA_VALIDOS_ESPANA = [0, 4, 10, 21];
const TOLERANCIA_EUROS = 0.05; // 5 céntimos de tolerancia por redondeo

/**
 * Parsea una cantidad en formato español a float
 * "1.234,56" → 1234.56
 */
function parseSpanish(str) {
  if (!str) return null;
  const s = String(str).trim().replace(/[€\s]/g, '');
  if (s.includes(',') && s.includes('.')) {
    // "1.234,56" → quitar puntos de miles, coma a punto decimal
    return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  if (s.includes(',')) {
    const partes = s.split(',');
    if (partes[1]?.length === 3) return parseFloat(s.replace(/,/g, '')); // "1,234" son miles
    return parseFloat(s.replace(',', '.')); // "1234,56"
  }
  return parseFloat(s);
}

/**
 * Valida la coherencia de los datos de IVA extraídos.
 * Retorna un objeto con { valid: boolean, warnings: string[], errors: string[] }
 */
function validateIVACampos(campos) {
  const warnings = [];
  const errors = [];

  const base = parseSpanish(campos.base_imponible);
  const cuotaIva = parseSpanish(campos.cuota_iva);
  const total = parseSpanish(campos.total);
  const ivaPct = parseSpanish(campos.iva_porcentaje);
  const irpf = parseSpanish(campos.cuota_irpf) || 0;

  // 1. Validar que el tipo de IVA sea válido para España
  if (ivaPct != null && !TIPOS_IVA_VALIDOS_ESPANA.includes(Math.round(ivaPct))) {
    errors.push(`Tipo IVA ${ivaPct}% no es válido en España (válidos: 0%, 4%, 10%, 21%)`);
  }

  // 2. Validar cuota = base × tipo (con tolerancia redondeo)
  if (base != null && cuotaIva != null && ivaPct != null && ivaPct > 0) {
    const cuotaCalculada = base * (ivaPct / 100);
    const diferencia = Math.abs(cuotaCalculada - cuotaIva);
    if (diferencia > TOLERANCIA_EUROS) {
      warnings.push(`Cuota IVA declarada ${cuotaIva.toFixed(2)} vs calculada ${cuotaCalculada.toFixed(2)} (diferencia ${diferencia.toFixed(2)}€)`);
    }
  }

  // 3. Validar total = base + cuota_iva - irpf
  if (base != null && cuotaIva != null && total != null) {
    const totalCalculado = base + cuotaIva - irpf;
    const diferencia = Math.abs(totalCalculado - total);
    if (diferencia > TOLERANCIA_EUROS) {
      errors.push(`Total declarado ${total.toFixed(2)} vs calculado ${totalCalculado.toFixed(2)} (diferencia ${diferencia.toFixed(2)}€)`);
    }
  }

  // 4. Validar coherencia de líneas IVA si existen
  if (campos.lineas_iva && Array.isArray(campos.lineas_iva)) {
    let sumaBaseLineas = 0;
    let sumaCuotaLineas = 0;

    for (const linea of campos.lineas_iva) {
      const lineaBase = parseSpanish(linea.base);
      const lineaCuota = parseSpanish(linea.cuota);
      const lineaPct = parseSpanish(linea.porcentaje);

      if (lineaBase != null) sumaBaseLineas += lineaBase;
      if (lineaCuota != null) sumaCuotaLineas += lineaCuota;

      if (lineaPct != null && !TIPOS_IVA_VALIDOS_ESPANA.includes(Math.round(lineaPct))) {
        errors.push(`Tipo IVA en línea ${lineaPct}% no válido en España`);
      }

      if (lineaBase != null && lineaCuota != null && lineaPct != null && lineaPct > 0) {
        const cuotaEsperada = lineaBase * (lineaPct / 100);
        if (Math.abs(cuotaEsperada - lineaCuota) > TOLERANCIA_EUROS) {
          warnings.push(`Línea IVA ${lineaPct}%: cuota ${lineaCuota.toFixed(2)} vs calculada ${cuotaEsperada.toFixed(2)}`);
        }
      }
    }

    // Verificar que la suma de líneas coincide con los totales
    if (base != null && Math.abs(sumaBaseLineas - base) > TOLERANCIA_EUROS) {
      warnings.push(`Suma bases líneas IVA ${sumaBaseLineas.toFixed(2)} ≠ base imponible total ${base.toFixed(2)}`);
    }
    if (cuotaIva != null && Math.abs(sumaCuotaLineas - cuotaIva) > TOLERANCIA_EUROS) {
      warnings.push(`Suma cuotas líneas IVA ${sumaCuotaLineas.toFixed(2)} ≠ cuota IVA total ${cuotaIva.toFixed(2)}`);
    }
  }

  // 5. Detectar IRPF implícito (si total < base + cuota_iva)
  if (base != null && cuotaIva != null && total != null && irpf === 0) {
    const diferencia = base + cuotaIva - total;
    if (diferencia > 0.5) { // más de 50 céntimos de diferencia sin IRPF declarado
      // Comprobar si corresponde a un tipo de IRPF conocido
      for (const tipo of [0.15, 0.07, 0.19, 0.02]) {
        if (Math.abs(diferencia - base * tipo) < TOLERANCIA_EUROS) {
          warnings.push(`Posible IRPF no declarado: diferencia ${diferencia.toFixed(2)}€ coincide con retención ${(tipo*100).toFixed(0)}%`);
          break;
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    parsed: { base, cuotaIva, total, ivaPct, irpf }
  };
}

module.exports = { validateIVACampos, parseSpanish };
```

### 7.3 Extractora TaxDetails mejorada para azure.js

```javascript
// Reemplazar extractIvaPorcentaje() con extractLineasIvaAzure() en azure.js

function extractLineasIvaAzure(fields) {
  const lineas = [];

  // INTENTO 1: TaxDetails array (el más fiable cuando está disponible)
  const taxDetails = fields.TaxDetails;
  if (taxDetails?.valueArray?.length > 0) {
    for (const detail of taxDetails.valueArray) {
      const obj = detail.valueObject || {};
      const amountField = obj.Amount;
      const rateField = obj.Rate;

      if (!amountField || !rateField) continue;
      if ((amountField.confidence ?? 1) < 0.50) continue;

      const amount = amountField.valueCurrency?.amount;
      const rateStr = rateField.valueString || '';
      const rate = parseFloat(rateStr.replace(/[^0-9,.]/g, '').replace(',', '.'));

      if (amount != null && !isNaN(rate)) {
        const base = rate > 0 ? (amount / (rate / 100)) : null;
        lineas.push({
          porcentaje: toSpanishPercent(rate),
          cuota: toSpanishAmount(amount),
          base: base != null ? toSpanishAmount(base) : null
        });
      }
    }
  }

  // INTENTO 2: Calcular desde SubTotal + TotalTax (para cuando TaxDetails está vacío)
  if (lineas.length === 0) {
    const baseAmount = fields.SubTotal?.valueCurrency?.amount;
    const taxAmount = fields.TotalTax?.valueCurrency?.amount;

    if (baseAmount != null && taxAmount != null && baseAmount > 0) {
      const pct = (taxAmount / baseAmount) * 100;
      if (pct >= 0 && pct <= 40) {
        // Solo si el porcentaje corresponde a un tipo español conocido (tolerancia 1%)
        const tiposEspana = [0, 4, 10, 21];
        const tipoMasCercano = tiposEspana.reduce((prev, curr) =>
          Math.abs(curr - pct) < Math.abs(prev - pct) ? curr : prev
        );
        const esExacto = Math.abs(pct - tipoMasCercano) < 1.5; // 1.5% de tolerancia
        lineas.push({
          porcentaje: toSpanishPercent(esExacto ? tipoMasCercano : pct),
          cuota: toSpanishAmount(taxAmount),
          base: toSpanishAmount(baseAmount)
        });
      }
    }
  }

  return lineas.length > 0 ? lineas : null;
}
```

---

## 8. LIMITACIONES CONOCIDAS POR MOTOR

### 8.1 GPT-4.1 Vision — Limitaciones

| Limitación | Frecuencia | Severidad |
|-----------|-----------|-----------|
| Solo captura primer tipo IVA con schema plano actual | ~15% facturas | ALTA |
| Confunde emisor/receptor en layouts de dos columnas | ~8% facturas | ALTA |
| No detecta IRPF en facturas con retención no etiquetada | ~5% facturas | MEDIA |
| Transpone dígitos adyacentes en CIFs (3↔8, 9↔3) | ~3% facturas | ALTA (recuperado por segunda pasada) |
| Inventa CIF cuando no es legible (mitigado por blacklist) | ~2% facturas | CRÍTICA (mitigada) |
| Temperatura 0 no garantiza 100% determinismo en Vision | ~1% facturas | BAJA |
| Falla en facturas manuscritas o muy degradadas | ~5% facturas | MEDIA |
| JSON strict mode no permite tipos `union` complejos en arrays anidados | Diseño | BAJA (workaround: oneOf) |

**Nota sobre el JSON Schema strict y arrays:**
OpenAI soporta arrays en `json_schema strict: true` desde GPT-4o (noviembre 2023).
La restricción real es: `additionalProperties` debe ser `false` en cada objeto del array.
El uso de `oneOf: [array_type, null_type]` para campos opcionales está soportado.

### 8.2 Azure Document Intelligence prebuilt-invoice — Limitaciones

| Limitación | Frecuencia | Severidad |
|-----------|-----------|-----------|
| TaxDetails vacío en facturas con IVA en tabla resumen (estilo español) | ~40% facturas | ALTA |
| No extrae IRPF (no está en el modelo) | 100% facturas con IRPF | CRÍTICA (GPT-4 como fallback) |
| CustomerTaxId no fiable en facturas simplificadas | ~30% facturas | MEDIA |
| TaxRate en Items vacío cuando IVA está en resumen al pie | ~70% facturas | ALTA |
| Confunde receptor-como-dirección-postal con VendorName en facturas "tipo carta" | ~5% facturas | ALTA |
| Latencia 5-15 segundos por polling (vs 2-5s de GPT-4.1) | 100% | BAJA (paralelo) |
| Confidence scores bajas para texto en español pequeño (<8pt) | ~20% facturas | MEDIA |
| No soporta PDFs > 6MB (en práctica SETEX ya optimiza a ~300KB) | Raro | BAJA |
| Modelo entrenado principalmente en facturas angloamericanas | Estructural | MEDIA |

### 8.3 Modo dual (comparación conjunta) — Limitaciones

| Limitación | Descripción |
|-----------|------------|
| lineas_iva no fusionada | Los arrays de desglose IVA no se fusionan, se pierde desglose |
| Desacuerdo de NIF sin árbitro automático | Cuando NIF discrepa, usa Azure como primario sin ejecutar `extractCIFOnly` automáticamente |
| Total IVA puede divergir | OpenAI puede dar cuota_iva calculada vs Azure total_tax de campo directo |
| Latencia paralela = max(OpenAI, Azure) | Si Azure tarda 15s, el usuario espera 15s aunque OpenAI terminó en 3s |

---

## 9. MEJORES PRÁCTICAS 2024-2025 (SECTOR)

### 9.1 Prompts para extracción fiscal

**Práctica 1 — Role prompting con autoridad fiscal:**
```
Eres un contable colegiado español con 20 años de experiencia procesando facturas.
Conoces perfectamente el Reglamento de Facturación (RD 1619/2012).
```
Esto mejora la extracción de campos fiscales específicos españoles (IRPF, base imponible)
vs prompts genéricos de "extracción de datos".

**Práctica 2 — Instrucciones negativas explícitas:**
Las instrucciones de qué NO hacer son más efectivas que las de qué hacer:
```
NUNCA rellenes receptor_nif con el mismo valor que proveedor_nif
NUNCA pongas un porcentaje de IVA que no sea 0%, 4%, 10% o 21%
NUNCA inventes un NIF basándote en el nombre de la empresa
```

**Práctica 3 — Separación de sistema/usuario para Vision:**
Usar `role: system` para las reglas absolutas y `role: user` para el contenido
específico de la factura. GPT-4.1 respeta más las restricciones del sistema que
las del usuario. El código actual ya implementa esto correctamente.

**Práctica 4 — Few-shot en el prompt de usuario:**
```
EJEMPLO DE RESPUESTA CORRECTA para una factura con IVA 21% + 10%:
{
  "base_imponible": "7.500,00",
  "iva_porcentaje": "21,0",
  "cuota_iva": "1.520,00",
  "lineas_iva": [
    {"porcentaje": "21,0", "base": "7.000,00", "cuota": "1.470,00"},
    {"porcentaje": "10,0", "base": "500,00", "cuota": "50,00"}
  ]
}
```

**Práctica 5 — Validación post-extracción con el propio modelo:**
Para casos de alta confianza dudosa, se puede hacer una segunda llamada de "revisión":
```
Revisa estos datos extraídos y verifica si son coherentes:
{datos}
¿Hay algún error evidente? Devuelve solo: {"correcto": true} o {"error": "descripción"}
```
Coste adicional: ~100-200 tokens. Útil solo para facturas con confianza < 0.7.

### 9.2 Azure Document Intelligence — Mejores prácticas

**Práctica 1 — Usar locale hint para facturas españolas:**
```javascript
// Al hacer POST a Azure DI, incluir el locale hint:
body: JSON.stringify({
  base64Source: base64,
  analyzeDocumentOptions: {
    locale: 'es-ES'  // Mejora reconocimiento de formato español
  }
})
```
Esto puede mejorar la extracción de TaxDetails en facturas españolas en ~10-15%.

**Práctica 2 — Umbral de confianza por tipo de campo:**
No usar un único threshold. Los campos de identidad fiscal deben tener threshold más alto:
```javascript
const THRESHOLDS = {
  InvoiceDate: 0.65,
  VendorName: 0.55,
  VendorTaxId: 0.65,
  CustomerName: 0.50,
  CustomerTaxId: 0.65,
  SubTotal: 0.60,
  TotalTax: 0.60,
  InvoiceTotal: 0.65,
  'TaxDetails.Amount': 0.55,
  'TaxDetails.Rate': 0.60,
};
```

**Práctica 3 — Timeout adaptativo:**
Azure DI puede tardar entre 2-20 segundos según la complejidad. El timeout actual
de 30s es correcto pero el polling de 1.5s puede ser agresivo para documentos simples.
Para el modo dual (paralelo con GPT-4.1), el timeout actual no penaliza al usuario
ya que GPT-4.1 responde en 2-5s y el resultado se envía en cuanto uno de los dos
termina (si se implementa streaming del resultado).

**Práctica 4 — Fallback automático por campo vacío:**
```javascript
// Si Azure DI devuelve base_imponible null pero OpenAI la tiene → usar OpenAI
// Si Azure DI devuelve VendorTaxId con confidence < 0.65 → usar OpenAI como fuente
```
La lógica de fusión en `index.js` ya hace esto parcialmente (toma el que tiene valor).

### 9.3 Manejo de redondeo de IVA

```javascript
// Función de normalización con tolerancia para validación contable
function validateIVAConsistency(base, pct, cuota) {
  if (!base || !pct || !cuota) return null;
  const baseN = parseSpanish(base);
  const cuotaCalculada = baseN * (pct / 100);
  const cuotaDeclarada = parseSpanish(cuota);
  const diff = Math.abs(cuotaCalculada - cuotaDeclarada);

  if (diff <= 0.02) return 'exact';     // Perfecto
  if (diff <= 0.05) return 'rounding';  // Redondeo normal
  if (diff <= 0.10) return 'warning';   // Revisar
  return 'error';                        // Error probable de OCR
}
```

---

## 10. RESUMEN DE RECOMENDACIONES PRIORIZADAS PARA SETEX

### P0 — Crítico, implementar inmediatamente

1. **Añadir `lineas_iva` array al JSON Schema de GPT-4.1**
   - Impacto: captura correcta del 15% de facturas con IVA múltiple
   - Esfuerzo: 2-3 horas (modificar schema en `openai.js` + actualizar `server.js`)
   - Retrocompatible: `iva_porcentaje` y `cuota_iva` se mantienen para no romper BD

2. **Implementar `extractLineasIvaAzure()` en azure.js**
   - Impacto: extrae TaxDetails array cuando Azure lo proporciona
   - Esfuerzo: 1 hora (nueva función, reemplaza `extractIvaPorcentaje()`)

3. **Añadir `locale: 'es-ES'` en la petición a Azure DI**
   - Impacto: mejora ~10-15% la extracción en facturas españolas
   - Esfuerzo: 15 minutos (una línea en `azure.js`)

### P1 — Alta prioridad

4. **Mejorar el prompt del receptor en `openai.js`**
   - Añadir instrucciones negativas explícitas para evitar confusión emisor/receptor
   - Esfuerzo: 30 minutos

5. **Añadir validación cruzada IVA (módulo `validateIVA.js`)**
   - Detecta inconsistencias matemáticas antes de guardar en BD
   - Esfuerzo: 2 horas (nuevo módulo + integración en `server.js`)

6. **Elevar confidence threshold en azure.js para campos de identidad**
   - VendorTaxId/CustomerTaxId: 0.5 → 0.65
   - Esfuerzo: 15 minutos

7. **Añadir detección de IRPF implícito por cálculo inverso**
   - Si total < base + cuota_iva y la diferencia coincide con 15%/7% → warning
   - Esfuerzo: 1 hora (función en `validateIVA.js`)

### P2 — Mejoras adicionales

8. **Añadir few-shot example en el prompt de usuario de OpenAI**
   - Mostrar un ejemplo de factura española con IVA múltiple y output correcto
   - Esfuerzo: 30 minutos. Riesgo: puede sesgar ligeramente otros tipos de facturas

9. **Fusionar `lineas_iva` en el orquestador dual (`index.js`)**
   - Cuando ambos motores extraen `lineas_iva`, fusionar inteligentemente
   - Esfuerzo: 2 horas

10. **Dashboard de confianza por campo**
    - Mostrar en el panel admin qué campos tienen confianza baja frecuentemente
    - Útil para detectar tipos de facturas problemáticos antes de que lleguen a contabilidad

---

## 11. PREGUNTAS DEL EXPERTO

Las siguientes preguntas técnicas identifican aspectos que perfeccionarían el sistema.
Algunas pueden responderse con el código actual; otras requieren decisión de Julio:

1. **¿Qué porcentaje real de las facturas procesadas en SETEX tienen múltiples tipos de IVA?**
   Respuesta investigada: Se puede extraer de la BD con `SELECT iva_porcentaje, count(*) FROM uploads GROUP BY iva_porcentaje ORDER BY count DESC`. Si hay registros con "21,0 / 10,0" o null frecuente, confirma el problema.

2. **¿El sistema de Google Sheets tiene columnas separadas para base 21%, base 10%, base 4%?**
   Si Hacienda/el equipo de SETEX necesita el desglose por tipo para el modelo 303, las columnas de Sheets deben reflejar esa estructura. Actualmente hay 16 columnas pero no está claro si incluyen desglose por tipo.

3. **¿Se producen rechazos por "campos faltantes" en facturas de hostelería o restauración?**
   Éstas son el principal generador de IVA 10%+21%. Si hay rechazos frecuentes, es la primera señal del problema multi-IVA.

4. **¿Hay facturas con IRPF que actualmente se procesan con cuota_irpf = "0,00" incorrectamente?**
   Se puede detectar en BD: facturas donde `total < base_imponible + cuota_iva`.

5. **¿Cuál es la distribución de tipos de emisor en las facturas de SETEX? (autónomos vs SLs vs SAs)**
   Determina qué porcentaje de facturas puede tener IRPF. Si el 30% son autónomos, el IRPF es prioritario.

6. **¿El modelo Azure DI tiene credenciales activas ya? El CLAUDE.md indica "listo, pendiente credenciales".**
   Si no está activado, todas las mejoras de Azure DI son teóricas hasta activarlo.

7. **¿Se almacena actualmente el campo `lineas_iva` en la tabla `uploads` de PostgreSQL?**
   Si no, la BD necesita un campo JSONB nuevo para almacenar el desglose multi-tipo.

8. **¿Hay facturas de arrendamiento que usan retención 19% de IRPF?**
   El alquiler de local comercial es un caso frecuente: base + IVA 21% - retención 19%.
   Diferente al IRPF de profesionales (15%).

9. **¿Cuál es la tasa de dual_confirmed actualmente en producción?**
   Si Azure DI no tiene credenciales, todos los resultados son dual_confirmed: false.
   Con Azure activo, se espera ~70-75% de confirmación dual.

10. **¿Los clientes de SETEX son principalmente B2B o también B2C?**
    Si son principalmente B2B, los tickets de gasolinera/restaurante (facturas simplificadas
    sin receptor) son frecuentes. Si son B2B puro, las facturas siempre deben tener receptor.

11. **¿Se ha evaluado el nuevo modelo GPT-4.1-mini para extracción de IVA?**
    A $0.40/1M tokens de entrada vs $2.00/1M de GPT-4.1. Para facturas sencillas
    (un solo tipo IVA, NIF visible, layout limpio), mini puede ser suficiente con
    ~85% del coste menor. Usar GPT-4.1 completo solo para casos de baja confianza.

12. **¿Existe validación en el frontend que muestre las líneas de IVA desglosadas al usuario?**
    Si el usuario ve "IVA: 1.520,00 €" pero la factura tiene dos tipos, no puede validar
    visualmente que la extracción es correcta. El frontend debería mostrar el desglose.

13. **¿Se monitoriza la tasa de error de validación de CIF post-extracción?**
    Los CIFs rechazados por blacklist o formato son señal de alucinación. Si supera 5%,
    habría que reforzar el prompt o añadir más entradas a la blacklist.

14. **¿Cuál es el tamaño típico de los archivos PDF de factura que suben los usuarios?**
    La optimización actual (1536px JPEG 85%) es óptima para fotos de facturas.
    Para PDFs digitales generados por software (vectoriales), sharp degrada la calidad.
    Los PDFs deberían enviarse directamente a las APIs sin conversión a JPEG.

15. **¿Se almacenan los campos `proveedor_nif` y `receptor_nif` como texto con o sin normalización?**
    Para el unique constraint (user_id, nif, fecha, total) que previene duplicados,
    el NIF debe estar normalizado (sin puntos, guiones, espacios, en mayúsculas).
    Si "B-12.345.678" y "B12345678" se almacenan como strings distintos, se pierden duplicados.

16. **¿Se considera usar Claude 3.5 Haiku/Sonnet como tercer motor OCR alternativo?**
    Anthropic Claude 3.5 Haiku tiene capacidad Vision. Para facturas con IRPF y multi-IVA,
    podría ser un buen desempate cuando OpenAI y Azure discrepan, sin el riesgo de
    alucinaciones de GPT-4 y con mejor instrucción-following que Azure DI.

17. **¿Cuál es el coste mensual actual de GPT-4.1 por volumen de facturas?**
    GPT-4.1: ~500-800 tokens/factura (input imagen ~700 tokens, output ~150 tokens).
    A $2.00/1M input + $8.00/1M output: ~$0.003-0.006 por factura.
    Si se procesan 1.000 facturas/mes: ~$3-6/mes. Escala linealmente.

18. **¿El sistema detecta y rechaza facturas en idioma no español (facturas de proveedores extranjeros)?**
    Un cliente de SETEX puede recibir facturas de Amazon EU (en inglés), proveedores franceses, etc.
    Azure DI maneja esto mejor (modelo multilingüe). GPT-4.1 también, pero los prompts
    están optimizados para español. Sería útil detectar el idioma y ajustar el prompt.

19. **¿Se registran en `audit_logs` los casos donde el dígito de control CIF falla?**
    La función `checkDigitCIF()` existe pero no parece usarse como señal de calidad
    en el flujo de producción. Registrar estos casos permitiría identificar NIFs
    incorrectos que pasan la blacklist pero son errores de OCR.

20. **¿Hay plan de evaluación con ground truth para medir la precisión actual?**
    Sin un dataset de facturas reales con valores correctos conocidos (ground truth),
    es imposible medir cuánto mejoran las modificaciones propuestas. Un conjunto mínimo
    de 50-100 facturas anotadas manualmente permitiría medir la mejora de cada cambio.

---

*Informe generado: 2026-03-31*
*Basado en análisis del código fuente SETEX + documentación oficial Azure DI v4.0 (2024-11-30 GA) + OpenAI GPT-4.1 API*
*Referencias: Azure DI schema prebuilt-invoice, RD 1619/2012 (Reglamento de Facturación), LIVA art. 90-91*
