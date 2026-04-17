

# INFORME COMPLETO: SISTEMA VERIFACTU

## Investigacion exhaustiva para la implementacion en SETEX Captura Facturas

---

## INDICE

1. Que es Verifactu
2. Marco legal completo
3. A quien aplica y excepciones
4. Requisitos tecnicos del SIF
5. Hash chain (encadenamiento)
6. Formato XML y esquemas XSD
7. Firma electronica (XMLDSig)
8. Conexion con la AEAT (API/Web Services)
9. Codigo QR y marca VERI*FACTU
10. Como lo implementan Holded, Sage, A3 y otros
11. Timeline y estado actual (marzo 2026)
12. Regimen sancionador
13. Requisitos del SIF (Sistema Informatico de Facturacion)
14. Arquitectura recomendada para SETEX
15. Esquema de base de datos propuesto
16. Dependencias tecnicas
17. Implementaciones open source
18. Implicaciones especificas para SETEX
19. Fuentes y documentacion oficial
20. Resumen ejecutivo

---

## 1. QUE ES VERIFACTU

**Nombre oficial:** VERI*FACTU (tambien escrito Verifactu o VeriFactu).

**Definicion:** Es un sistema regulatorio espanol que obliga a que todos los programas informaticos de facturacion (SIF - Sistema Informatico de Facturacion) generen registros de facturacion inalterables, trazables y, en su modalidad principal, que sean enviados automaticamente a la Agencia Estatal de Administracion Tributaria (AEAT) en tiempo real o cuasi-real.

**Objetivo declarado:** Combatir el fraude fiscal eliminando el uso de "software de doble uso" -- programas que permiten llevar una contabilidad B, eliminar facturas, o manipular registros de ventas sin dejar rastro.

**Contexto europeo:** Espana se une a una tendencia europea de control fiscal digital. Italia ya tiene el Sistema di Interscambio (SDI) desde 2019, Portugal tiene el SAF-T, y Francia prepara su facturacion electronica obligatoria. Verifactu es la respuesta espanola a este movimiento continental.

**Dos modalidades de funcionamiento:**

| Modalidad | Descripcion | Envio a AEAT |
|-----------|-------------|--------------|
| **VERI*FACTU** | El SIF envia los registros de facturacion a la AEAT de forma automatica e inmediata tras emitir cada factura | SI, automatico |
| **NO VERI*FACTU** | El SIF cumple todos los requisitos tecnicos (hash chain, inalterabilidad) pero NO envia automaticamente. Los registros se conservan localmente y se ponen a disposicion de la AEAT cuando esta los requiera en una inspeccion | NO, bajo demanda |

**Diferencia clave:** En ambas modalidades, el software debe garantizar la integridad e inalterabilidad de los registros. La diferencia es solo si se transmiten en tiempo real o se conservan para inspeccion. La AEAT incentiva fuertemente la modalidad VERI*FACTU (envio automatico) porque le da visibilidad inmediata sobre las operaciones.

---

## 2. MARCO LEGAL COMPLETO

### 2.1 Jerarquia normativa

```
Nivel 1 (Ley):
  Ley 11/2021, de 9 de julio, de medidas de prevencion
  y lucha contra el fraude fiscal
  → Modifico el articulo 29.2.j) de la Ley 58/2003
    General Tributaria (LGT)

Nivel 2 (Real Decreto):
  Real Decreto 1007/2023, de 5 de diciembre
  → Reglamento que establece los requisitos de los SIF
  → Publicado en el BOE el 6 de diciembre de 2023
  → BOE-A-2023-24840

Nivel 3 (Orden Ministerial):
  Orden Ministerial tecnica (desarrollo del RD)
  → Define las especificaciones tecnicas concretas:
    esquemas XSD, URLs de endpoints, formato exacto
    del hash, protocolos de comunicacion
  → Estado: en tramite / pendiente de publicacion
    definitiva a fecha de mayo 2025
```

### 2.2 Articulos clave del RD 1007/2023

**Articulo 1 -- Objeto:** Establece los requisitos que deben adoptar los SIF que soporten procesos de facturacion de empresarios y profesionales.

**Articulo 2 -- Ambito de aplicacion:** Define quienes estan obligados (ver seccion 3).

**Articulo 4 -- Requisitos de los SIF:** El sistema debe garantizar integridad, conservacion, accesibilidad, legibilidad, trazabilidad e inalterabilidad de los registros.

**Articulo 5 -- Registro de facturacion de alta:** Define los campos obligatorios de cada registro.

**Articulo 6 -- Registro de facturacion de anulacion:** Define como registrar la anulacion de una factura.

**Articulo 7 -- Huella o hash:** Establece el uso de SHA-256 y el encadenamiento.

**Articulo 8 -- Envio a la AEAT:** Define la modalidad VERI*FACTU de envio automatico.

**Articulo 9 -- Declaracion responsable:** El fabricante del SIF debe declarar que su software cumple los requisitos.

**Articulo 11 -- Factura verificable:** Las facturas deben incluir QR y marca VERI*FACTU.

**Disposicion transitoria unica:** Establece los plazos de adaptacion.

---

## 3. A QUIEN APLICA Y EXCEPCIONES

### 3.1 Obligados

Todos los contribuyentes que desarrollen actividades economicas y deban expedir facturas:

- **Contribuyentes del Impuesto sobre Sociedades (IS)** -- Todas las sociedades mercantiles (S.L., S.A., etc.)
- **Contribuyentes del IRPF con actividades economicas** -- Autonomos y profesionales
- **Contribuyentes del IRNR con establecimiento permanente** -- No residentes que operen en Espana

### 3.2 Excepciones

| Excluidos | Motivo |
|-----------|--------|
| Empresas ya en el SII | Ya reportan en tiempo real a la AEAT (facturacion > 6M euros o inscritos voluntariamente) |
| Regimenes forales (Pais Vasco) | Tienen su propio sistema: **TicketBAI** |
| Regimenes forales (Navarra) | Tienen su propio sistema foral navarro |
| Regimen de agricultura, ganaderia y pesca | Exentos por la naturaleza simplificada de su facturacion |
| Contribuyentes acogidos al SII voluntariamente | Al estar en SII, no necesitan Verifactu |

### 3.3 Nota sobre el SII vs Verifactu

El SII (Suministro Inmediato de Informacion) es el sistema previo que ya existia para grandes empresas. Verifactu extiende conceptualmente la misma idea de reporte en tiempo real, pero:

- **SII:** Obligatorio para empresas con facturacion > 6M euros. Envia datos de facturas emitidas y recibidas. No exige hash chain ni inalterabilidad del software.
- **Verifactu:** Para TODOS los demas. Exige inalterabilidad del software (hash chain) ADEMAS del envio de datos.

---

## 4. REQUISITOS TECNICOS DEL SIF

### 4.1 Los seis pilares del SIF

El RD 1007/2023 establece que todo Sistema Informatico de Facturacion debe garantizar:

1. **Integridad:** Los registros no pueden ser alterados sin que la alteracion sea detectable
2. **Conservacion:** Los registros deben conservarse durante todo el periodo de prescripcion tributaria (minimo 4 anos, en la practica 5-6 para estar seguros)
3. **Accesibilidad:** Los registros deben poder exportarse en formato estandar legible por la AEAT
4. **Legibilidad:** Los datos deben ser comprensibles sin necesidad del software original
5. **Trazabilidad:** Cada operacion sobre un registro debe quedar documentada
6. **Inalterabilidad:** No debe ser tecnica ni funcionalmente posible eliminar o modificar registros sin dejar huella

### 4.2 Registros de facturacion

El SIF genera dos tipos de registros:

**Registro de facturacion de ALTA:**
Se crea cada vez que se emite una factura. Contiene todos los datos fiscales y es el registro principal.

**Registro de facturacion de ANULACION:**
Se crea cuando se anula una factura previamente registrada. No se puede simplemente "borrar" una factura; hay que crear un registro de anulacion que se encadena igual que los de alta.

### 4.3 Campos obligatorios del registro de alta

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| NIF obligado tributario | String(15) | CIF/NIF del emisor de la factura |
| Nombre/razon social | String(120) | Nombre del emisor |
| Numero serie factura | String(60) | Identificador unico de la factura |
| Fecha de expedicion | Date | Fecha de emision de la factura |
| Tipo de factura | Enum | F1 (completa), F2 (simplificada), F3 (emitida en sustitucion de simplificadas), R1-R5 (rectificativas) |
| NIF del destinatario | String(15) | CIF/NIF del receptor (obligatorio en F1) |
| Nombre destinatario | String(120) | Nombre del receptor |
| Descripcion operaciones | String(500) | Texto descriptivo de la operacion |
| Clave de regimen IVA | Enum | 01 (general), 02 (exportacion), 05 (rec. equivalencia), etc. |
| Calificacion operacion | Enum | S1 (sujeta - no exenta), S2 (sujeta - no exenta - IS), N1 (no sujeta art. 7), N2 (no sujeta por reglas localizacion), E1-E6 (exenta) |
| Base imponible | Decimal(12,2) | Importe base |
| Tipo impositivo | Decimal(5,2) | Porcentaje de IVA (21%, 10%, 4%, 0%) |
| Cuota repercutida | Decimal(12,2) | Importe del IVA |
| Cuota total | Decimal(12,2) | Suma de todas las cuotas |
| Importe total | Decimal(12,2) | Total factura |
| Hash (huella) | String(64) | SHA-256 del registro |
| Hash anterior | String(64) | Hash del registro precedente en la cadena |
| Fecha/hora/huso generacion | DateTime+TZ | Momento exacto de generacion del registro |
| ID Sistema Informatico | Varios campos | Nombre SIF, version, NIF fabricante, numero instalacion |

### 4.4 Tipos de factura reconocidos

| Codigo | Tipo |
|--------|------|
| F1 | Factura completa (art. 6 y 7 del Reglamento de Facturacion) |
| F2 | Factura simplificada (ticket) |
| F3 | Factura emitida en sustitucion de facturas simplificadas |
| R1 | Factura rectificativa por art. 80.1, 80.2 y 80.6 LIVA |
| R2 | Factura rectificativa en caso de concurso de acreedores (art. 80.3) |
| R3 | Factura rectificativa por deuda incobrable (art. 80.4) |
| R4 | Factura rectificativa por otros supuestos |
| R5 | Factura rectificativa en facturas simplificadas |

### 4.5 Requisitos de NO manipulacion

El SIF NO puede ofrecer:
- Funcion para eliminar facturas sin generar registro de anulacion
- Funcion para modificar datos fiscales de facturas ya registradas sin rectificativa
- Doble numeracion o series de facturacion ocultas
- Modo "borrador" que no genere registro si luego se confirma
- Opcion de "resetear" la cadena de hashes
- Ninguna funcionalidad que facilite la llevanza de contabilidad B

---

## 5. HASH CHAIN (ENCADENAMIENTO)

### 5.1 Concepto

El encadenamiento de registros mediante hashes es el mecanismo tecnico central de Verifactu. Es el mismo principio que utiliza blockchain: cada registro contiene el hash del registro anterior, formando una cadena que hace imposible insertar, eliminar o modificar un registro intermedio sin romper toda la cadena.

### 5.2 Algoritmo

**SHA-256** (Secure Hash Algorithm 256 bits). Produce un hash de 64 caracteres hexadecimales.

### 5.3 Campos que entran en el calculo del hash

Segun el RD 1007/2023 y la documentacion tecnica de la AEAT, los campos que se concatenan para calcular el hash son:

```
1. IDEmisorFactura (NIF del obligado tributario)
2. NumSerieFactura (numero y serie de la factura)
3. FechaExpedicionFactura (fecha de expedicion)
4. TipoFactura (F1, F2, R1, etc.)
5. CuotaTotal (cuota total del impuesto)
6. ImporteTotal (importe total de la factura)
7. Huella del registro anterior (hash anterior en la cadena)
8. FechaHoraHusoGenRegistro (timestamp de generacion)
```

### 5.4 Formato de concatenacion

Los campos se concatenan en un orden especifico con un separador definido en la Orden Ministerial tecnica. El formato probable (a confirmar con la OM definitiva) es:

```
IDEmisorFactura=B12345678&NumSerieFactura=2024/001&FechaExpedicionFactura=15-01-2024&TipoFactura=F1&CuotaTotal=210.00&ImporteTotal=1210.00&Huella=a1b2c3...&FechaHoraHusoGenRegistro=2024-01-15T10:30:00+01:00
```

### 5.5 Implementacion en pseudocodigo

```javascript
const crypto = require('crypto');

/**
 * Calcula el hash SHA-256 de un registro de facturacion Verifactu.
 *
 * NOTA: El formato exacto de concatenacion (separadores, orden de campos,
 * formato de fechas y decimales) lo define la Orden Ministerial tecnica.
 * Este codigo es ilustrativo. DEBES usar la especificacion oficial exacta.
 *
 * @param {Object} registro - Datos del registro de facturacion
 * @param {string} hashAnterior - Hash del registro anterior ('' si es el primero)
 * @returns {string} Hash SHA-256 en hexadecimal (64 chars)
 */
function calcularHashVerifactu(registro, hashAnterior) {
  const campos = [
    `IDEmisorFactura=${registro.nifEmisor}`,
    `NumSerieFactura=${registro.numSerieFactura}`,
    `FechaExpedicionFactura=${registro.fechaExpedicion}`,
    `TipoFactura=${registro.tipoFactura}`,
    `CuotaTotal=${registro.cuotaTotal.toFixed(2)}`,
    `ImporteTotal=${registro.importeTotal.toFixed(2)}`,
    `Huella=${hashAnterior}`,
    `FechaHoraHusoGenRegistro=${registro.timestampGeneracion}`,
  ];

  const cadena = campos.join('&');
  return crypto.createHash('sha256').update(cadena, 'utf8').digest('hex');
}

// Ejemplo de cadena:
// Registro 1 (primer registro de la cadena):
const hash1 = calcularHashVerifactu({
  nifEmisor: 'B12345678',
  numSerieFactura: '2024/001',
  fechaExpedicion: '15-01-2024',
  tipoFactura: 'F1',
  cuotaTotal: 210.00,
  importeTotal: 1210.00,
  timestampGeneracion: '2024-01-15T10:30:00+01:00',
}, '');  // <-- cadena vacia porque es el primer registro

// Registro 2 (encadenado al primero):
const hash2 = calcularHashVerifactu({
  nifEmisor: 'B12345678',
  numSerieFactura: '2024/002',
  fechaExpedicion: '16-01-2024',
  tipoFactura: 'F2',
  cuotaTotal: 42.00,
  importeTotal: 242.00,
  timestampGeneracion: '2024-01-16T09:15:00+01:00',
}, hash1);  // <-- hash del registro 1

// Registro 3 (encadenado al segundo):
const hash3 = calcularHashVerifactu({
  nifEmisor: 'B12345678',
  numSerieFactura: '2024/003',
  fechaExpedicion: '17-01-2024',
  tipoFactura: 'F1',
  cuotaTotal: 84.00,
  importeTotal: 484.00,
  timestampGeneracion: '2024-01-17T14:00:00+01:00',
}, hash2);  // <-- hash del registro 2
```

### 5.6 Propiedades de la cadena

```
Cadena intacta (normal):
  R1 [hash_1] --> R2 [hash_2(datos + hash_1)] --> R3 [hash_3(datos + hash_2)]

Si alguien elimina R2:
  R1 [hash_1] --> R3 [hash_3(datos + hash_2)]
  ERROR: hash_2 no existe, la cadena esta rota

Si alguien modifica R2:
  R1 [hash_1] --> R2' [hash_2'(datos_modificados + hash_1)] --> R3 [hash_3(datos + hash_2)]
  ERROR: hash_2' != hash_2, R3 apunta a un hash que no coincide

Si alguien inserta un registro entre R1 y R2:
  R1 [hash_1] --> R_nuevo [hash_x(datos + hash_1)] --> R2 [hash_2(datos + hash_1)]
  ERROR: R2 sigue apuntando a hash_1, no a hash_x
```

### 5.7 Cadena por serie de facturacion

Cada serie de facturacion mantiene su propia cadena de hashes. Si una empresa usa varias series (por ejemplo, "A-" para facturas nacionales y "B-" para intracomunitarias), cada serie tiene su cadena independiente.

---

## 6. FORMATO XML Y ESQUEMAS XSD

### 6.1 Estructura general

La AEAT define esquemas XSD que determinan la estructura exacta del XML. Los mensajes se envian envueltos en SOAP (Simple Object Access Protocol).

**Tipos de mensaje:**

| Mensaje | Funcion |
|---------|---------|
| RegFactuSistemaFacturacion | Envio de registros de alta (facturas nuevas) |
| AnulacionSistemaFacturacion | Envio de registros de anulacion |
| ConsultaFactuSistemaFacturacion | Consulta de registros enviados |
| RespuestaRegFactuSistemaFacturacion | Respuesta de la AEAT al envio |

### 6.2 XML completo de ejemplo -- Registro de alta

```xml
<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:sif="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd">

  <soapenv:Header/>

  <soapenv:Body>
    <sif:RegFactuSistemaFacturacion>

      <!-- === CABECERA === -->
      <sif:Cabecera>
        <sif:ObligadoEmision>
          <sif:NombreRazon>SETEX Servicios Tecnologicos S.L.</sif:NombreRazon>
          <sif:NIF>B12345678</sif:NIF>
        </sif:ObligadoEmision>
        <!-- S = sistema VERI*FACTU, N = sistema NO VERI*FACTU -->
        <sif:RemisionVoluntaria>S</sif:RemisionVoluntaria>
        <sif:RemisionRequerimiento/>
      </sif:Cabecera>

      <!-- === REGISTROS DE FACTURA (puede haber varios en un envio) === -->
      <sif:RegistroFactura>
        <sif:RegistroAlta>

          <!-- Identificacion de la factura -->
          <sif:IDFactura>
            <sif:IDEmisorFactura>B12345678</sif:IDEmisorFactura>
            <sif:NumSerieFactura>2024/001</sif:NumSerieFactura>
            <sif:FechaExpedicionFactura>15-01-2024</sif:FechaExpedicionFactura>
          </sif:IDFactura>

          <!-- Nombre/razon social del emisor -->
          <sif:NombreRazonEmisor>SETEX Servicios Tecnologicos S.L.</sif:NombreRazonEmisor>

          <!-- Tipo de factura -->
          <sif:TipoFactura>F1</sif:TipoFactura>

          <!-- Datos del destinatario -->
          <sif:Destinatarios>
            <sif:IDDestinatario>
              <sif:NombreRazon>Cliente Ejemplo S.A.</sif:NombreRazon>
              <sif:NIF>A87654321</sif:NIF>
            </sif:IDDestinatario>
          </sif:Destinatarios>

          <!-- Descripcion de la operacion -->
          <sif:DescripcionOperacion>Servicios de consultoria tecnologica enero 2024</sif:DescripcionOperacion>

          <!-- Desglose fiscal -->
          <sif:Desglose>
            <sif:DetalleDesglose>
              <sif:ClaveRegimen>01</sif:ClaveRegimen>
              <sif:CalificacionOperacion>S1</sif:CalificacionOperacion>
              <sif:TipoImpositivo>21.00</sif:TipoImpositivo>
              <sif:BaseImponible>1000.00</sif:BaseImponible>
              <sif:CuotaRepercutida>210.00</sif:CuotaRepercutida>
            </sif:DetalleDesglose>
          </sif:Desglose>

          <!-- Totales -->
          <sif:CuotaTotal>210.00</sif:CuotaTotal>
          <sif:ImporteTotal>1210.00</sif:ImporteTotal>

          <!-- === HUELLA (hash) === -->
          <sif:Huella>
            <sif:FechaHoraHusoGenRegistro>2024-01-15T10:30:00+01:00</sif:FechaHoraHusoGenRegistro>
            <sif:Hash>a3f2b8c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1</sif:Hash>
            <sif:HashAlgoritmo>SHA-256</sif:HashAlgoritmo>
          </sif:Huella>

          <!-- === ENCADENAMIENTO === -->
          <sif:Encadenamiento>
            <!-- Si es el PRIMER registro de la cadena: -->
            <sif:PrimerRegistro>S</sif:PrimerRegistro>
            <!-- Si NO es el primero, en lugar de PrimerRegistro: -->
            <!--
            <sif:RegistroAnterior>
              <sif:IDEmisorFactura>B12345678</sif:IDEmisorFactura>
              <sif:NumSerieFactura>2023/150</sif:NumSerieFactura>
              <sif:FechaExpedicionFactura>31-12-2023</sif:FechaExpedicionFactura>
              <sif:Hash>f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9</sif:Hash>
            </sif:RegistroAnterior>
            -->
          </sif:Encadenamiento>

          <!-- === SISTEMA INFORMATICO === -->
          <sif:SistemaInformatico>
            <sif:NombreRazon>Desarrollador Software S.L.</sif:NombreRazon>
            <sif:NIF>B11111111</sif:NIF>
            <sif:NombreSistemaInformatico>SETEX Facturacion</sif:NombreSistemaInformatico>
            <sif:IdSistemaInformatico>SETEX-FAC</sif:IdSistemaInformatico>
            <sif:Version>1.0.0</sif:Version>
            <sif:NumeroInstalacion>001</sif:NumeroInstalacion>
            <sif:TipoUsoPosibleSoloVerifactu>S</sif:TipoUsoPosibleSoloVerifactu>
            <sif:TipoUsoPosibleMultiOT>N</sif:TipoUsoPosibleMultiOT>
            <sif:IndicadorMultiplesOT>N</sif:IndicadorMultiplesOT>
          </sif:SistemaInformatico>

        </sif:RegistroAlta>
      </sif:RegistroFactura>

    </sif:RegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>
```

### 6.3 XML de ejemplo -- Registro de anulacion

```xml
<sif:RegistroFactura>
  <sif:RegistroAnulacion>
    <sif:IDFactura>
      <sif:IDEmisorFactura>B12345678</sif:IDEmisorFactura>
      <sif:NumSerieFactura>2024/001</sif:NumSerieFactura>
      <sif:FechaExpedicionFactura>15-01-2024</sif:FechaExpedicionFactura>
    </sif:IDFactura>
    <sif:SinRegistroPrevio>N</sif:SinRegistroPrevio>
    <sif:GeneradoPor>E</sif:GeneradoPor> <!-- E=Emisor -->
    <sif:Huella>
      <sif:FechaHoraHusoGenRegistro>2024-02-01T09:00:00+01:00</sif:FechaHoraHusoGenRegistro>
      <sif:Hash>b1c2d3e4f5...</sif:Hash>
      <sif:HashAlgoritmo>SHA-256</sif:HashAlgoritmo>
    </sif:Huella>
    <sif:Encadenamiento>
      <sif:RegistroAnterior>
        <sif:Hash>a3f2b8c1d4...</sif:Hash>
      </sif:RegistroAnterior>
    </sif:Encadenamiento>
    <sif:SistemaInformatico>
      <!-- mismos datos del SIF -->
    </sif:SistemaInformatico>
  </sif:RegistroAnulacion>
</sif:RegistroFactura>
```

### 6.4 Respuesta de la AEAT

```xml
<sif:RespuestaRegFactuSistemaFacturacion>
  <sif:EstadoEnvio>Correcto</sif:EstadoEnvio>
  <!-- O bien: -->
  <!-- <sif:EstadoEnvio>ParcialmenteCorrecto</sif:EstadoEnvio> -->
  <!-- <sif:EstadoEnvio>Incorrecto</sif:EstadoEnvio> -->
  <sif:RespuestaLinea>
    <sif:IDFactura>
      <sif:NumSerieFactura>2024/001</sif:NumSerieFactura>
    </sif:IDFactura>
    <sif:EstadoRegistro>Correcto</sif:EstadoRegistro>
    <sif:CodigoErrorRegistro/>
    <sif:DescripcionErrorRegistro/>
    <sif:CSV>AEAT-CSV-XXXX-YYYY</sif:CSV>
  </sif:RespuestaLinea>
</sif:RespuestaRegFactuSistemaFacturacion>
```

### 6.5 Donde obtener los XSD oficiales

Los esquemas XSD se publican en la sede electronica de la AEAT. La URL base es:
```
https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/
```

Archivos XSD esperados:
- `SuministroLR.xsd` -- Esquema principal de suministro de registros
- `TiposSIF.xsd` -- Tipos de datos comunes
- `RespuestaSuministro.xsd` -- Esquema de respuestas

---

## 7. FIRMA ELECTRONICA (XMLDSIG)

### 7.1 Que es XMLDSig

XML Digital Signature es el estandar W3C para firmar documentos XML. Verifactu requiere que los envios SOAP a la AEAT esten firmados digitalmente, garantizando:
- **Autenticacion:** Se sabe quien envia (el certificado identifica al emisor)
- **Integridad:** El mensaje no ha sido alterado en transito
- **No repudio:** El emisor no puede negar haber enviado el mensaje

### 7.2 Tipo de certificado requerido

| Tipo | Valido para Verifactu | Emisor tipico |
|------|----------------------|---------------|
| Certificado de persona juridica | SI | FNMT, Camerfirma, Firmaprofesional |
| Certificado de representante | SI | FNMT, Camerfirma |
| Certificado de sello electronico | SI | FNMT |
| Certificado de persona fisica | SI (si es el titular) | FNMT, DNIe |
| Certificado no cualificado | NO | - |

**El mas comun:** Certificado de persona juridica de la FNMT (Fabrica Nacional de Moneda y Timbre). Es el mismo que ya usan las empresas para presentar impuestos por Internet.

### 7.3 Formato del certificado

- **PKCS#12 (.p12 / .pfx):** Contiene certificado + clave privada, protegido por contrasena
- La AEAT acepta certificados en formato X.509 v3

### 7.4 Implementacion de la firma

```javascript
const { SignedXml } = require('xml-crypto');
const fs = require('fs');
const forge = require('node-forge');

/**
 * Firma un documento XML SOAP para envio a la AEAT.
 *
 * @param {string} xmlString - El XML SOAP completo sin firmar
 * @param {string} p12Path - Ruta al archivo .p12/.pfx del certificado
 * @param {string} p12Password - Contrasena del .p12
 * @returns {string} XML firmado
 */
function firmarXMLParaAEAT(xmlString, p12Path, p12Password) {
  // 1. Leer el certificado PKCS#12
  const p12Buffer = fs.readFileSync(p12Path);
  const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);

  // 2. Extraer clave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);

  // 3. Extraer certificado
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certificate = certBags[forge.pki.oids.certBag][0].cert;
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const certBase64 = Buffer.from(certDer, 'binary').toString('base64');

  // 4. Crear la firma XMLDSig
  const sig = new SignedXml();

  // Algoritmo de firma: RSA-SHA256
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';

  // Referencia: firmar el Body del SOAP
  sig.addReference(
    "//*[local-name(.)='Body']",
    [
      'http://www.w3.org/2001/10/xml-exc-c14n#'  // Canonicalizacion exclusiva
    ],
    'http://www.w3.org/2001/04/xmlenc#sha256'     // Digest SHA-256
  );

  // Clave de firma
  sig.signingKey = privateKeyPem;

  // Informacion del certificado en la firma
  sig.keyInfoProvider = {
    getKeyInfo: function() {
      return `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`;
    }
  };

  // 5. Calcular y aplicar la firma
  sig.computeSignature(xmlString, {
    prefix: 'ds',
    location: { reference: "//*[local-name(.)='Header']", action: 'append' }
  });

  return sig.getSignedXml();
}
```

### 7.5 Renovacion de certificados

Los certificados de la FNMT caducan cada 2-4 anos. El SIF debe:
- Alertar cuando el certificado este proximo a caducar (30 dias antes)
- Permitir la actualizacion del certificado sin perder la cadena de hashes
- Registrar en el log el cambio de certificado

---

## 8. CONEXION CON LA AEAT (API/WEB SERVICES)

### 8.1 Protocolo

**SOAP sobre HTTPS con autenticacion mutua TLS (mTLS)**

Esto significa:
1. El cliente (tu software) presenta su certificado electronico al servidor de la AEAT
2. El servidor de la AEAT presenta su certificado al cliente
3. Ambas partes verifican mutuamente la identidad
4. Se establece un canal cifrado TLS
5. Se envian los mensajes SOAP firmados por ese canal

### 8.2 Endpoints

| Entorno | Proposito | URL base |
|---------|-----------|----------|
| **Pruebas** | Desarrollo y testing | `https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/` |
| **Produccion** | Envios reales | `https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/` |

**Servicios web disponibles:**

| Servicio | Endpoint (relativo) | Funcion |
|----------|---------------------|---------|
| Alta de registros | `/SistemaFacturacion/RegistroFacturacion` | Enviar registros de facturas nuevas |
| Anulacion | `/SistemaFacturacion/AnulacionFacturacion` | Enviar registros de anulacion |
| Consulta | `/SistemaFacturacion/ConsultaFacturacion` | Consultar registros previamente enviados |

**Nota importante:** Las URLs exactas pueden diferir. La AEAT publica los WSDL (Web Services Description Language) que contienen las URLs definitivas. Verificar en la sede electronica.

### 8.3 Implementacion del cliente SOAP con mTLS

```javascript
const https = require('https');
const fs = require('fs');
const { DOMParser } = require('xmldom');

/**
 * Envia un registro de facturacion firmado a la AEAT.
 *
 * @param {string} xmlFirmado - XML SOAP firmado completo
 * @param {string} p12Path - Ruta al certificado .p12
 * @param {string} p12Password - Contrasena del certificado
 * @param {boolean} esProduccion - true=produccion, false=pruebas
 * @returns {Promise<Object>} Respuesta de la AEAT parseada
 */
async function enviarRegistroAEAT(xmlFirmado, p12Path, p12Password, esProduccion) {

  // Leer certificado PKCS#12 para mTLS
  const p12Buffer = fs.readFileSync(p12Path);

  // Seleccionar endpoint
  const host = esProduccion
    ? 'www1.agenciatributaria.gob.es'
    : 'prewww1.aeat.es';
  const path = '/wlpl/TIKE-CONT/ws/SistemaFacturacion/RegistroFacturacion';

  const options = {
    hostname: host,
    port: 443,
    path: path,
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(xmlFirmado, 'utf-8'),
      'SOAPAction': 'RegistroFacturacion',
    },
    // Autenticacion mutua TLS
    pfx: p12Buffer,
    passphrase: p12Password,
    // Verificar certificado del servidor AEAT
    rejectUnauthorized: true,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`AEAT HTTP ${res.statusCode}: ${body}`));
          return;
        }
        try {
          const respuesta = parsearRespuestaAEAT(body);
          resolve(respuesta);
        } catch (parseErr) {
          reject(new Error(`Error parseando respuesta AEAT: ${parseErr.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('Timeout conectando con AEAT'));
    });

    req.write(xmlFirmado);
    req.end();
  });
}

/**
 * Parsea la respuesta XML de la AEAT.
 */
function parsearRespuestaAEAT(xmlRespuesta) {
  const doc = new DOMParser().parseFromString(xmlRespuesta, 'text/xml');

  const estadoEnvio = doc.getElementsByTagNameNS('*', 'EstadoEnvio')[0]?.textContent;
  const csv = doc.getElementsByTagNameNS('*', 'CSV')[0]?.textContent;

  const lineas = doc.getElementsByTagNameNS('*', 'RespuestaLinea');
  const resultados = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    resultados.push({
      numSerie: linea.getElementsByTagNameNS('*', 'NumSerieFactura')[0]?.textContent,
      estado: linea.getElementsByTagNameNS('*', 'EstadoRegistro')[0]?.textContent,
      codigoError: linea.getElementsByTagNameNS('*', 'CodigoErrorRegistro')[0]?.textContent,
      descripcionError: linea.getElementsByTagNameNS('*', 'DescripcionErrorRegistro')[0]?.textContent,
    });
  }

  return {
    estadoEnvio,  // 'Correcto', 'ParcialmenteCorrecto', 'Incorrecto'
    csv,          // Codigo Seguro de Verificacion
    registros: resultados,
  };
}
```

### 8.4 Manejo de errores y reintentos

```javascript
const Queue = require('bullmq').Queue;

// Cola de reintentos para envios a AEAT
const aeatQueue = new Queue('aeat-verifactu', {
  connection: { host: 'localhost', port: 6379 },
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 60000,  // 1 min, 2 min, 4 min, 8 min, 16 min
    },
    removeOnComplete: { age: 86400 * 30 },  // Conservar 30 dias
    removeOnFail: false,  // NUNCA eliminar los fallidos
  },
});

// Si el envio falla, encolar para reintento
async function enviarConReintentos(registroId, xmlFirmado) {
  try {
    const respuesta = await enviarRegistroAEAT(xmlFirmado, ...);
    await actualizarEstadoRegistro(registroId, 'ACEPTADO', respuesta);
    return respuesta;
  } catch (error) {
    // Encolar para reintento
    await aeatQueue.add('reenviar', {
      registroId,
      xmlFirmado,
      intentoOriginal: new Date().toISOString(),
      error: error.message,
    });
    await actualizarEstadoRegistro(registroId, 'PENDIENTE_REENVIO', { error: error.message });
  }
}
```

### 8.5 Envio por lotes

La AEAT permite enviar varios registros de facturacion en un solo mensaje SOAP (dentro de multiples nodos `<RegistroFactura>`). Esto es eficiente para:
- Envios acumulados por corte de conexion
- Alta inicial de registros historicos
- Procesos por lotes nocturnos en modo NO VERI*FACTU

Limite tipico: hasta 1.000 registros por envio (confirmar con la documentacion AEAT actualizada).

---

## 9. CODIGO QR Y MARCA VERI*FACTU

### 9.1 Marca obligatoria en las facturas

Toda factura emitida por un sistema en modalidad VERI*FACTU debe incluir visualmente:

**Texto obligatorio:** "Factura verificable en la sede electronica de la AEAT" o alternativamente "VERI*FACTU"

**Codigo QR:** Que al escanearlo con un movil permita verificar que la factura ha sido reportada a Hacienda.

### 9.2 Contenido del QR

El codigo QR contiene una URL que apunta a un servicio de verificacion de la AEAT. Los parametros de la URL permiten identificar univocamente la factura:

```
https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR
  ?nif=B12345678
  &numserie=2024/001
  &fecha=15012024
  &importe=1210.00
```

**Parametros:**
| Parametro | Formato | Descripcion |
|-----------|---------|-------------|
| nif | String | NIF del emisor |
| numserie | String | Numero y serie de la factura |
| fecha | DDMMYYYY | Fecha de expedicion |
| importe | Decimal | Importe total con 2 decimales |

### 9.3 Implementacion del generador de QR

```javascript
const QRCode = require('qrcode');

/**
 * Genera la URL de verificacion AEAT para una factura.
 */
function generarURLVerificacionAEAT(factura) {
  const baseURL = 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR';

  // Formatear fecha a DDMMYYYY
  const [dia, mes, anyo] = factura.fechaExpedicion.split(/[\/\-\.]/);
  const fechaFormateada = dia.padStart(2, '0') + mes.padStart(2, '0') + anyo;

  const params = new URLSearchParams({
    nif: factura.nifEmisor,
    numserie: factura.numSerieFactura,
    fecha: fechaFormateada,
    importe: factura.importeTotal.toFixed(2),
  });

  return `${baseURL}?${params.toString()}`;
}

/**
 * Genera el codigo QR como imagen base64 PNG.
 * Para incluir en facturas PDF, emails, etc.
 */
async function generarQRVerifactu(factura) {
  const url = generarURLVerificacionAEAT(factura);

  // Generar QR como base64 PNG
  const qrBase64 = await QRCode.toDataURL(url, {
    width: 200,
    margin: 2,
    errorCorrectionLevel: 'M',  // Nivel medio de correccion
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  // Generar QR como buffer PNG (para insertar en PDF)
  const qrBuffer = await QRCode.toBuffer(url, {
    width: 200,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  return {
    url,              // URL de verificacion
    base64: qrBase64, // Para mostrar en HTML: <img src="data:image/png;base64,...">
    buffer: qrBuffer,  // Para insertar en PDF con pdfkit
  };
}

/**
 * Genera un PDF de factura con marca VERI*FACTU y QR.
 */
async function generarPDFFacturaVerifactu(factura, datosEmpresa) {
  const PDFDocument = require('pdfkit');
  const { url, buffer: qrBuffer } = await generarQRVerifactu(factura);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const buffers = [];
  doc.on('data', buffers.push.bind(buffers));

  // ... (contenido normal de la factura: cabecera, lineas, totales) ...

  // Marca VERI*FACTU al pie
  doc.moveDown(2);
  doc.fontSize(8)
     .fillColor('#666666')
     .text('Factura verificable en la sede electronica de la AEAT', {
       align: 'center'
     })
     .text('VERI*FACTU', { align: 'center', underline: true });

  // QR en la esquina inferior derecha
  doc.image(qrBuffer, doc.page.width - 150, doc.page.height - 150, {
    width: 100,
    height: 100,
  });

  doc.end();

  return new Promise(resolve => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
  });
}
```

### 9.4 Que ve el consumidor final

Cuando un cliente recibe una factura con marca VERI*FACTU y escanea el QR con su movil:
1. Se abre el navegador con la URL de la AEAT
2. La AEAT muestra si esa factura consta en sus registros
3. El consumidor puede verificar que el comercio declaro la venta

Este es un mecanismo de control social: el ciudadano puede verificar que el comerciante no le esta dando una factura "fuera de sistema".

---

## 10. COMO LO IMPLEMENTAN HOLDED, SAGE, A3 Y OTROS

### 10.1 Holded

**Tipo:** SaaS cloud puro (no hay instalacion local).

**Enfoque de implementacion:**
- Holded gestiona todo de forma transparente en sus servidores
- El usuario emite facturas como siempre; Holded genera el registro, calcula el hash, firma y envia a la AEAT en background
- El certificado electronico del usuario se sube a Holded (almacenado cifrado)
- Las facturas generadas desde Holded ya incluyen automaticamente el QR y la marca VERI*FACTU
- El encadenamiento de hashes se mantiene en la base de datos de Holded (por empresa/usuario)

**Consideraciones:**
- Al ser cloud, el usuario confia en Holded para la custodia del certificado
- Holded actua como intermediario (el SIF es el propio Holded, no el ordenador del usuario)
- El NIF del fabricante del SIF es el de Holded, no el del usuario

### 10.2 Software DELSOL (Contasol, Factusol)

**Tipo:** Software de escritorio con opcion cloud.

**Enfoque:**
- La generacion del registro y el calculo del hash se hacen localmente en el ordenador del usuario
- El envio SOAP a la AEAT se hace desde la propia aplicacion
- El certificado .p12 esta en la maquina del usuario
- La cadena de hashes se almacena en la base de datos local (Firebird/SQLite)
- Para la version cloud, el enfoque es similar a Holded

### 10.3 Sage (Sage 50, Sage 200)

**Tipo:** Mixto (on-premise y cloud).

**Enfoque Sage 50 (on-premise):**
- Modulo Verifactu integrado en la actualizacion del producto
- El hash chain se almacena en la base de datos local de Sage
- El certificado se configura en la aplicacion
- El envio se hace directamente desde el PC del usuario

**Enfoque Sage Business Cloud (SaaS):**
- Similar a Holded, gestion centralizada en la nube

### 10.4 A3 Software (Wolters Kluwer)

**Tipo:** On-premise con componentes cloud.

**Enfoque:**
- a3factura y a3asesor integran Verifactu en sus actualizaciones
- Para despachos profesionales (asesorias): un unico SIF que gestiona multiples empresas clientes
- Cada empresa cliente tiene su propia cadena de hashes
- Wolters Kluwer proporciona el certificado de sello electronico para los envios

### 10.5 Patron comun a todos

Independientemente del producto, todos implementan los mismos componentes:

```
Componentes minimos de un SIF conforme a Verifactu:

1. GENERADOR DE REGISTROS
   - Captura los datos fiscales de cada factura
   - Genera el timestamp de creacion
   - Valida que no falten campos obligatorios

2. MODULO DE HASH CHAIN
   - Calcula SHA-256 segun especificacion AEAT
   - Recupera el hash del ultimo registro de la misma serie
   - Encadena el nuevo registro
   - Almacena de forma atomica (transaccion DB)

3. GENERADOR XML
   - Construye el XML conforme a los XSD de la AEAT
   - Valida contra XSD antes de enviar

4. MODULO DE FIRMA
   - Lee el certificado .p12/.pfx
   - Firma XMLDSig el mensaje SOAP
   - Gestiona la caducidad del certificado

5. CLIENTE SOAP/HTTPS
   - Mutual TLS con la AEAT
   - Envio del XML firmado
   - Recepcion y parseo de la respuesta
   - Cola de reintentos ante fallos

6. GENERADOR QR
   - Construye la URL de verificacion
   - Genera la imagen QR
   - Inserta QR + marca en las facturas

7. ALMACEN DE REGISTROS
   - Base de datos con todos los registros
   - Estado de envio (pendiente/aceptado/rechazado)
   - Historial de intentos de envio
   - Capacidad de consulta y exportacion
```

---

## 11. TIMELINE Y ESTADO ACTUAL (MARZO 2026)

### 11.1 Cronologia legislativa

| Fecha | Evento |
|-------|--------|
| 10 julio 2021 | Publicacion de la Ley 11/2021 Antifraude que habilita el desarrollo reglamentario |
| 6 diciembre 2023 | Publicacion del RD 1007/2023 en el BOE |
| 7 diciembre 2023 | Entrada en vigor del RD 1007/2023 |

### 11.2 Plazos establecidos por el RD 1007/2023

| Fecha | Obligacion |
|-------|------------|
| **1 julio 2025** | Los **fabricantes de software** deben tener sus productos adaptados y conformes. Fecha limite para que los SIF comercializados cumplan todos los requisitos tecnicos. |
| **1 enero 2026** | Todos los **obligados tributarios** deben usar un SIF conforme. A partir de esta fecha, emitir facturas con software no conforme es sancionable. |

### 11.3 Estado real a fecha de mi conocimiento (mayo 2025)

A fecha de mayo de 2025, la situacion era:

- **RD 1007/2023:** Publicado y en vigor.
- **Orden Ministerial tecnica:** La orden que detalla las especificaciones tecnicas concretas (XSD definitivos, URLs exactas de endpoints, formato preciso de concatenacion para el hash, etc.) estaba en fase avanzada de tramitacion pero no habia sido publicada como definitiva en el BOE.
- **Entornos de pruebas AEAT:** La AEAT habia puesto a disposicion documentacion tecnica preliminar y estaba preparando los entornos de pruebas.
- **Sector software:** Los principales fabricantes (Holded, Sage, A3, Contasol, etc.) estaban en diferentes grados de preparacion, con algunos ya mostrando funcionalidades Verifactu en versiones beta.
- **Posibles aplazamientos:** Habia voces en el sector pidiendo un aplazamiento de las fechas, argumentando que sin la Orden Ministerial definitiva era dificil completar las implementaciones.

### 11.4 LO QUE DEBES VERIFICAR AHORA (marzo 2026)

**CRITICO -- Mi informacion termina en mayo 2025. Los siguientes puntos pudieron haber cambiado:**

1. **Se mantuvo la fecha del 1 enero 2026?** Es posible que se haya aplazado. Consulta:
   - BOE: `https://www.boe.es` -- buscar "verifactu" o "1007/2023"
   - AEAT: `https://sede.agenciatributaria.gob.es`
   - Noticias del sector: buscar "verifactu aplazamiento 2026"

2. **Se publico la Orden Ministerial tecnica?** Sin ella no se pueden conocer los detalles exactos de implementacion.

3. **Estan operativos los endpoints de la AEAT?** Tanto el entorno de pruebas como el de produccion.

4. **Hay ya un proceso de homologacion?** Es posible que la AEAT haya creado un proceso formal para certificar que un SIF cumple los requisitos.

5. **Ha habido moratorias o periodos de gracia?** Es comun que se establezca un periodo transitorio donde las sanciones no se apliquen inmediatamente.

**Para verificar, ejecuta manualmente en un navegador:**
```
https://sede.agenciatributaria.gob.es/Sede/iva/facturacion-registro/sistemas-informaticos-facturacion-verifactu.html
https://www.agenciatributaria.es/AEAT.internet/Inicio/La_Agencia_Tributaria/Campanas/Sistemas_informaticos_de_facturacion_y_Veri_factu/
https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840
```

---

## 12. REGIMEN SANCIONADOR

### 12.1 Sanciones para fabricantes de software

| Infraccion | Sancion | Base legal |
|-----------|---------|------------|
| Fabricar, producir y comercializar SIF y sistemas que no cumplan los requisitos del RD 1007/2023 | **150.000 EUR por ejercicio fiscal** | Art. 201 bis LGT (anadido por Ley 11/2021) |
| Fabricar, producir y comercializar SIF que permitan la manipulacion de datos de facturacion | **150.000 EUR por ejercicio fiscal** | Art. 201 bis LGT |
| Tener en el SIF funcionalidades no documentadas que permitan llevar contabilidad B | **150.000 EUR por ejercicio fiscal** | Art. 201 bis LGT |

**Nota critica:** Esta sancion se aplica POR CADA EJERCICIO FISCAL en que se produce la infraccion. Si comercializas software no conforme durante 3 anos, serian 450.000 EUR.

### 12.2 Sanciones para usuarios (empresas/autonomos)

| Infraccion | Sancion | Base legal |
|-----------|---------|------------|
| Utilizar un SIF que no cumple los requisitos | **50.000 EUR por ejercicio fiscal** | Art. 201 bis LGT |
| No tener instalado un SIF conforme cuando es obligatorio | **50.000 EUR por ejercicio fiscal** | Art. 201 bis LGT |
| Alteracion o destruccion de registros de facturacion | Sancion como infraccion tributaria grave (150% de la cuota defraudada) | Art. 201 bis LGT + regimen general |

### 12.3 Sanciones por facturas individuales

| Infraccion | Sancion |
|-----------|---------|
| Factura emitida sin cumplir requisitos formales Verifactu (sin QR, sin hash, etc.) | Hasta **150 EUR por factura** |
| Maximo trimestral | **6.000 EUR por trimestre** |
| Maximo anual implicito | **24.000 EUR por ano** |

### 12.4 Graduacion de sanciones

La LGT establece criterios de graduacion:
- **Reincidencia:** Comision de la misma infraccion en los 4 ejercicios anteriores
- **Perjuicio economico:** En proporcion a la cuota defraudada
- **Conformidad:** Reduccion del 30% si se acepta la sancion sin recurso
- **Pronto pago:** Reduccion adicional del 25% si se paga en periodo voluntario

### 12.5 Resumen de riesgo para SETEX

```
SI SETEX se usa solo internamente (una empresa, tu propio negocio):
  Riesgo: 50.000 EUR/ejercicio como usuario de SIF no conforme

SI SETEX se comercializa a terceros (SaaS para otros):
  Riesgo: 150.000 EUR/ejercicio como FABRICANTE de SIF no conforme
  + los clientes reciben sus propias sanciones de 50.000 EUR
  + responsabilidad reputacional y posibles demandas civiles
```

---

## 13. REQUISITOS COMPLETOS DEL SIF

### 13.1 Declaracion responsable del fabricante

El fabricante del SIF debe presentar ante la AEAT una declaracion responsable que certifique:
- El nombre comercial del SIF
- La version
- Que cumple TODOS los requisitos del RD 1007/2023
- Si opera en modalidad VERI*FACTU, NO VERI*FACTU, o ambas
- Los datos del fabricante (NIF, razon social)

Esta declaracion se presenta **antes de comercializar o poner en uso** el SIF.

### 13.2 Registro de eventos (log de auditoria)

El SIF debe mantener un registro de eventos que documente:
- Cada inicio y cierre del sistema
- Cada registro de facturacion generado
- Cada envio a la AEAT y su resultado
- Cada error o incidencia
- Cualquier operacion de mantenimiento del sistema
- Cambios de configuracion relevantes

Este log NO puede ser eliminado ni modificado por el usuario.

### 13.3 Exportacion de datos

El SIF debe poder exportar todos los registros de facturacion en un formato estandar que la AEAT pueda leer, para su uso en:
- Inspecciones tributarias
- Requerimientos de informacion
- Auditorias

### 13.4 Lo que el SIF no puede hacer (prohibiciones explicitas)

1. **No puede** permitir la emision de facturas sin generar simultaneamente el registro de facturacion
2. **No puede** tener una funcion de "borrar factura" sin registro de anulacion
3. **No puede** ofrecer modo "offline" que permita emitir facturas sin que se incorporen luego a la cadena
4. **No puede** permitir series de facturacion no declaradas
5. **No puede** tener funcionalidades ocultas o no documentadas (funciones de acceso privilegiado para manipular datos)
6. **No puede** interrumpir el encadenamiento de hashes sin razon justificada y documentada

### 13.5 Multiempresa / Multiserie

Si el SIF gestiona varias empresas (como un software de asesorias):
- Cada empresa tiene su propia cadena de hashes independiente
- Cada empresa tiene sus propias series de facturacion
- El envio a la AEAT se hace con el certificado de cada empresa

Si una empresa usa varias series de facturacion:
- Cada serie mantiene su propia cadena de hashes
- El primer registro de cada serie es independiente

---

## 14. ARQUITECTURA RECOMENDADA PARA SETEX

### 14.1 Situacion actual de SETEX

Segun la memoria del proyecto:
```
SETEX actual:
  Usuario sube imagen/PDF de factura
  -> OCR (GPT-4.1) extrae datos
  -> Respuesta al usuario con datos extraidos
  -> BullMQ (background) -> Google Drive + Google Sheets
```

### 14.2 Pregunta fundamental: SETEX emite o recibe facturas?

**Esto es CRITICO para determinar el alcance de Verifactu:**

- **Si SETEX solo CAPTURA/DIGITALIZA facturas RECIBIDAS** (es decir, el usuario recibe facturas de sus proveedores y las sube para digitalizarlas): Verifactu NO aplica directamente a SETEX como SIF, porque Verifactu regula la EMISION de facturas, no la recepcion. Sin embargo, SETEX podria VERIFICAR facturas recibidas usando el QR.

- **Si SETEX tambien EMITE facturas** (el usuario crea facturas para enviar a sus clientes): Verifactu aplica COMPLETAMENTE y SETEX debe ser un SIF conforme.

### 14.3 Arquitectura propuesta (si SETEX emite facturas)

```
ARQUITECTURA SETEX CON VERIFACTU
=================================

[CAPA FRONTEND -- app.js existente]
  |
  | (1) Usuario crea/edita factura
  | (2) Confirma emision
  |
  v
[CAPA BACKEND -- server.js existente]
  |
  +-- POST /api/invoices/emit (nueva ruta)
  |     |
  |     | (3) Validar datos fiscales
  |     | (4) Asignar numero de serie
  |     |
  |     v
  +-- [MODULO VERIFACTU -- src/verifactu/]
  |     |
  |     | (5) Generar registro de facturacion
  |     | (6) Calcular hash SHA-256
  |     | (7) Encadenar con hash anterior
  |     | (8) Almacenar en tabla verifactu_registros (PostgreSQL)
  |     | (9) Construir XML SOAP
  |     | (10) Firmar con XMLDSig
  |     |
  |     v
  +-- [COLA AEAT -- BullMQ]
  |     |
  |     | (11) Enviar a AEAT via SOAP/HTTPS (mTLS)
  |     | (12) Procesar respuesta
  |     | (13) Actualizar estado en DB
  |     | (14) Reintentar si falla
  |     |
  |     v
  +-- [GENERADOR PDF]
  |     |
  |     | (15) Generar QR con URL de verificacion
  |     | (16) Insertar QR + marca VERI*FACTU en PDF
  |     | (17) Guardar PDF
  |     |
  |     v
  +-- [COLA EXISTENTE -- BullMQ]
        |
        | (18) Subir PDF a Google Drive (flujo existente)
        | (19) Registrar en Google Sheets (flujo existente)
```

### 14.4 Estructura de archivos propuesta

```
app/backend/src/
  |-- server.js              (existente, anadir ruta /api/invoices/emit)
  |-- verifactu/
  |     |-- index.js          (orquestador principal)
  |     |-- hashChain.js      (calculo SHA-256 y encadenamiento)
  |     |-- xmlBuilder.js     (generacion XML conforme a XSD)
  |     |-- xmlSigner.js      (firma XMLDSig)
  |     |-- aeatClient.js     (cliente SOAP mTLS para la AEAT)
  |     |-- qrGenerator.js    (generacion QR y URL verificacion)
  |     |-- pdfGenerator.js   (factura PDF con QR y marca)
  |     |-- validator.js      (validacion de datos fiscales)
  |     |-- constants.js      (tipos factura, regimenes IVA, etc.)
  |     |-- migrations/
  |     |     |-- 001_create_verifactu_tables.sql
  |     |-- xsd/
  |           |-- SuministroLR.xsd    (descargado de AEAT)
  |           |-- TiposSIF.xsd
  |-- queue/
  |     |-- aeatWorker.js     (worker BullMQ para envios a AEAT)
  |     |-- invoiceWorker.js  (existente, sin cambios)
  |-- config/
        |-- features.json     (existente, anadir toggles Verifactu)
```

### 14.5 Configuracion en features.json

```json
{
  "verifactu_enabled": false,
  "verifactu_mode": "VERIFACTU",
  "verifactu_environment": "test",
  "verifactu_nif_fabricante": "BXXXXXXXX",
  "verifactu_nombre_sif": "SETEX Facturacion",
  "verifactu_version_sif": "1.0.0",
  "verifactu_numero_instalacion": "001",
  "verifactu_cert_path": "/run/secrets/aeat_cert.p12",
  "verifactu_cert_password_secret": "aeat_cert_password"
}
```

### 14.6 Arquitectura propuesta (si SETEX solo recibe facturas)

Si SETEX solo digitaliza facturas recibidas, la integracion con Verifactu es mucho mas ligera:

```
SETEX COMO VERIFICADOR DE FACTURAS RECIBIDAS
=============================================

[FLUJO ACTUAL - sin cambios]
  Usuario sube factura
  -> OCR (GPT-4.1) extrae datos
  -> Respuesta al usuario

[NUEVO - opcional, valor anadido]
  -> Si la factura tiene QR VERI*FACTU
     -> Leer URL del QR
     -> Consultar AEAT: la factura esta reportada?
     -> Informar al usuario:
        "VERIFICADA por AEAT" o "NO encontrada en AEAT"

  -> Almacenar NIF proveedor, numero factura, fecha, importe
     para posible cruce con modelo 303/390
```

---

## 15. ESQUEMA DE BASE DE DATOS PROPUESTO

### 15.1 Tabla principal: verifactu_registros

```sql
-- Tabla principal de registros de facturacion Verifactu
CREATE TABLE verifactu_registros (
  id                    SERIAL PRIMARY KEY,

  -- === TIPO DE REGISTRO ===
  tipo_registro         VARCHAR(10) NOT NULL CHECK (tipo_registro IN ('ALTA', 'ANULACION')),

  -- === IDENTIFICACION DE LA FACTURA ===
  nif_emisor            VARCHAR(15) NOT NULL,
  nombre_emisor         VARCHAR(120) NOT NULL,
  num_serie_factura     VARCHAR(60) NOT NULL,
  fecha_expedicion      DATE NOT NULL,

  -- === DATOS FISCALES ===
  tipo_factura          VARCHAR(5) NOT NULL CHECK (tipo_factura IN (
                          'F1','F2','F3','R1','R2','R3','R4','R5'
                        )),
  descripcion           TEXT,
  clave_regimen         VARCHAR(5) NOT NULL DEFAULT '01',
  calificacion_op       VARCHAR(5),

  -- === DESTINATARIO ===
  nif_destinatario      VARCHAR(15),
  nombre_destinatario   VARCHAR(120),

  -- === IMPORTES ===
  base_imponible        DECIMAL(12,2),
  tipo_impositivo       DECIMAL(5,2),
  cuota_repercutida     DECIMAL(12,2),
  cuota_total           DECIMAL(12,2) NOT NULL,
  importe_total         DECIMAL(12,2) NOT NULL,

  -- === HASH CHAIN ===
  hash                  VARCHAR(64) NOT NULL,
  hash_anterior         VARCHAR(64),          -- NULL solo para el primer registro de la serie
  timestamp_generacion  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  es_primer_registro    BOOLEAN NOT NULL DEFAULT FALSE,

  -- === SISTEMA INFORMATICO ===
  sif_nombre            VARCHAR(30) NOT NULL DEFAULT 'SETEX',
  sif_version           VARCHAR(15) NOT NULL,
  sif_nif_fabricante    VARCHAR(15) NOT NULL,
  sif_id                VARCHAR(30) NOT NULL DEFAULT 'SETEX-FAC',
  sif_num_instalacion   VARCHAR(10) NOT NULL DEFAULT '001',

  -- === ENVIO A AEAT ===
  estado_envio          VARCHAR(25) NOT NULL DEFAULT 'PENDIENTE'
                        CHECK (estado_envio IN (
                          'PENDIENTE',           -- Generado, aun no enviado
                          'ENVIADO',             -- En transito a AEAT
                          'ACEPTADO',            -- AEAT acepto el registro
                          'RECHAZADO',           -- AEAT rechazo el registro
                          'PENDIENTE_REENVIO',   -- Fallo la conexion, reintentando
                          'ERROR_PERMANENTE'     -- Error que no se puede resolver con reintentos
                        )),
  fecha_envio           TIMESTAMPTZ,
  fecha_respuesta_aeat  TIMESTAMPTZ,
  csv_aeat              VARCHAR(50),           -- Codigo Seguro Verificacion devuelto por AEAT
  codigo_error_aeat     VARCHAR(20),
  descripcion_error_aeat TEXT,
  respuesta_aeat_raw    JSONB,
  intentos_envio        INTEGER NOT NULL DEFAULT 0,
  proximo_reintento     TIMESTAMPTZ,

  -- === QR ===
  url_verificacion      TEXT,
  qr_generado           BOOLEAN NOT NULL DEFAULT FALSE,

  -- === ANULACION (solo para tipo_registro='ANULACION') ===
  registro_anulado_id   INTEGER REFERENCES verifactu_registros(id),
  motivo_anulacion      TEXT,

  -- === RELACIONES ===
  upload_id             INTEGER,               -- FK a tabla uploads existente
  user_id               INTEGER,               -- FK a tabla users existente

  -- === METADATOS ===
  serie_facturacion     VARCHAR(20),           -- Serie a la que pertenece (para cadenas independientes)
  xml_enviado           TEXT,                   -- XML SOAP completo enviado (para auditoria)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- === CONSTRAINTS ===
  UNIQUE(nif_emisor, num_serie_factura, fecha_expedicion)
);

-- Indices para consultas frecuentes
CREATE INDEX idx_vf_hash ON verifactu_registros(hash);
CREATE INDEX idx_vf_hash_anterior ON verifactu_registros(hash_anterior);
CREATE INDEX idx_vf_estado ON verifactu_registros(estado_envio);
CREATE INDEX idx_vf_fecha ON verifactu_registros(fecha_expedicion);
CREATE INDEX idx_vf_nif_emisor ON verifactu_registros(nif_emisor);
CREATE INDEX idx_vf_serie ON verifactu_registros(serie_facturacion, id);
CREATE INDEX idx_vf_tipo ON verifactu_registros(tipo_registro);
```

### 15.2 Tabla de log de eventos (auditoria)

```sql
-- Log de eventos del SIF (obligatorio segun RD 1007/2023)
CREATE TABLE verifactu_eventos (
  id                SERIAL PRIMARY KEY,
  tipo_evento       VARCHAR(30) NOT NULL,
  -- Tipos: 'INICIO_SISTEMA', 'CIERRE_SISTEMA', 'REGISTRO_GENERADO',
  --        'ENVIO_AEAT', 'RESPUESTA_AEAT', 'ERROR', 'CAMBIO_CONFIG',
  --        'CAMBIO_CERTIFICADO', 'EXPORTACION_DATOS'
  descripcion       TEXT NOT NULL,
  registro_id       INTEGER REFERENCES verifactu_registros(id),
  datos_adicionales JSONB,
  ip_origen         VARCHAR(45),
  user_id           INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_vf_eventos_tipo ON verifactu_eventos(tipo_evento);
CREATE INDEX idx_vf_eventos_fecha ON verifactu_eventos(created_at);

-- IMPORTANTE: Esta tabla NO debe tener DELETE ni UPDATE
-- Solo INSERT. Esto es un requisito del reglamento.
REVOKE DELETE, UPDATE ON verifactu_eventos FROM appuser;
GRANT INSERT, SELECT ON verifactu_eventos TO appuser;
GRANT USAGE, SELECT ON SEQUENCE verifactu_eventos_id_seq TO appuser;
```

### 15.3 Tabla de certificados

```sql
-- Gestion de certificados electronicos
CREATE TABLE verifactu_certificados (
  id                SERIAL PRIMARY KEY,
  nif_titular       VARCHAR(15) NOT NULL,
  nombre_titular    VARCHAR(120),
  tipo_certificado  VARCHAR(20) NOT NULL, -- 'PERSONA_JURIDICA', 'REPRESENTANTE', 'SELLO'
  emisor            VARCHAR(120),         -- 'FNMT', 'Camerfirma', etc.
  numero_serie      VARCHAR(100),
  fecha_emision     DATE,
  fecha_caducidad   DATE NOT NULL,
  huella_sha256     VARCHAR(64),          -- Hash del certificado para verificacion
  esta_activo       BOOLEAN NOT NULL DEFAULT TRUE,
  ruta_archivo      VARCHAR(255),         -- Ruta al .p12 (cifrado en disco)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 16. DEPENDENCIAS TECNICAS

### 16.1 Paquetes npm necesarios

```json
{
  "dependencies": {
    "xml2js": "^0.6.2",
    "xml-crypto": "^6.0.0",
    "xmldom": "^0.6.0",
    "qrcode": "^1.5.4",
    "node-forge": "^1.3.1",
    "pdfkit": "^0.15.0",
    "fast-xml-parser": "^4.4.0"
  }
}
```

**Descripcion de cada paquete:**

| Paquete | Uso en Verifactu | Alternativa |
|---------|-----------------|-------------|
| `xml2js` | Construccion de XML SOAP y parseo de respuestas | `fast-xml-parser` (mas rapido) |
| `xml-crypto` | Firma XMLDSig de los mensajes SOAP | `xmldsigjs` |
| `xmldom` | DOM parser para manipulacion XML | `@xmldom/xmldom` |
| `qrcode` | Generacion de codigos QR | `qr-image` |
| `node-forge` | Lectura de certificados .p12/.pfx, criptografia | `openssl` via child_process |
| `pdfkit` | Generacion de facturas PDF con QR | `puppeteer` (mas pesado) |
| `fast-xml-parser` | Parseo rapido de XML (alternativa/complemento a xml2js) | `xml2js` |

### 16.2 Certificado AEAT

Para el entorno de pruebas se puede usar un certificado de prueba de la FNMT. Para produccion se necesita un certificado real:

**Obtener certificado de la FNMT:**
1. Ir a `https://www.sede.fnmt.gob.es/certificados`
2. Solicitar certificado de representante de persona juridica
3. Acudir a una oficina de registro con la documentacion
4. Descargar el certificado (.p12)
5. Almacenarlo de forma segura (Docker secret)

---

## 17. IMPLEMENTACIONES OPEN SOURCE

### 17.1 Repositorios a buscar en GitHub

No pude ejecutar las busquedas automatizadas por restricciones del entorno. Te recomiendo buscar manualmente:

**Busquedas recomendadas:**
```
https://github.com/search?q=verifactu&type=repositories&s=updated
https://github.com/search?q=verifactu+javascript&type=repositories
https://github.com/search?q=verifactu+node&type=repositories
https://github.com/search?q=verifactu+python&type=repositories
https://github.com/search?q=ticketbai&type=repositories&s=stars
https://www.npmjs.com/search?q=verifactu
https://www.npmjs.com/search?q=ticketbai
```

### 17.2 TicketBAI como referencia tecnica

TicketBAI (sistema vasco, operativo desde 2022) es la mejor referencia open source porque:
- La arquitectura es practicamente identica a Verifactu
- Lleva anos en produccion (mas maduro)
- Hay mas implementaciones disponibles
- Los conceptos son los mismos: hash chain, XML firmado, QR, envio a la hacienda foral

**Diferencias TicketBAI vs Verifactu:**
| Aspecto | TicketBAI | Verifactu |
|---------|-----------|-----------|
| Ambito territorial | Pais Vasco (Bizkaia, Gipuzkoa, Araba) | Resto de Espana (territorio comun) |
| Destinatario envio | Haciendas forales | AEAT |
| Esquemas XML | Propios de cada diputacion | De la AEAT |
| Formato firma | XAdES | XMLDSig |
| Funcionando desde | 2022 | 2025/2026 |

### 17.3 Librerias de Facturae

El formato **Facturae** (factura electronica espanola) tiene librerias maduras que pueden reutilizarse parcialmente:
- **node-facturae** (npm) -- Generacion de facturas en formato Facturae 3.2.2
- **pyFacturae** (Python) -- Version Python
- Estas librerias manejan la estructura XML de facturas espanolas y la firma electronica, que son habilidades reutilizables para Verifactu

---

## 18. IMPLICACIONES ESPECIFICAS PARA SETEX

### 18.1 Analisis de la situacion de SETEX

Segun la memoria del proyecto, SETEX es actualmente un sistema de **captura y digitalizacion de facturas recibidas**:
- El usuario sube una imagen/PDF de una factura que ha recibido
- OCR extrae los datos
- Los datos se guardan en Google Sheets y el archivo en Google Drive

**Por tanto, SETEX en su forma actual NO es un SIF porque NO emite facturas.** Verifactu regula los sistemas que EMITEN facturas, no los que las reciben.

### 18.2 Escenarios posibles

**Escenario A -- SETEX sigue siendo solo captura de facturas recibidas:**
- No necesita cumplir Verifactu como SIF
- Oportunidad: anadir verificacion de facturas recibidas (leer QR, consultar AEAT)
- Valor anadido: alertar al usuario si una factura recibida NO esta en el sistema AEAT

**Escenario B -- SETEX evoluciona a emitir facturas:**
- Necesita cumplir Verifactu completamente
- Debe implementar toda la arquitectura descrita en la seccion 14
- Requiere declaracion responsable como fabricante de SIF

**Escenario C -- SETEX como plataforma completa de facturacion:**
- Captura de facturas recibidas (actual) + emision de facturas (nuevo)
- Maxima complejidad pero tambien maximo valor de mercado
- Compite directamente con Holded, Contasol, etc.

### 18.3 Recomendacion

Si el plan es evolucionar SETEX hacia la emision de facturas, mi recomendacion es:

1. **Corto plazo (ahora):** Finalizar y estabilizar la captura de facturas con OCR (el proyecto actual)
2. **Medio plazo (3-6 meses):** Investigar el estado real de Verifactu (confirmar fechas, descargar XSD, probar entorno de pruebas AEAT)
3. **Largo plazo (6-12 meses):** Implementar el modulo de emision de facturas con cumplimiento Verifactu completo

### 18.4 Quick win inmediato: verificacion de facturas recibidas

Sin necesidad de ser un SIF, SETEX puede anadir valor verificando las facturas que recibe:

```javascript
// src/verifactu/verifier.js
// Verifica si una factura recibida esta reportada en AEAT via QR

const https = require('https');

/**
 * Verifica una factura en la AEAT.
 * Usa los datos extraidos por OCR para consultar si el proveedor
 * reporto esa factura al sistema Verifactu.
 *
 * @param {Object} datosFactura - Datos extraidos por OCR
 * @returns {Promise<Object>} Estado de verificacion
 */
async function verificarFacturaEnAEAT(datosFactura) {
  const { cif_proveedor, num_factura, fecha, total } = datosFactura;

  if (!cif_proveedor || !num_factura || !fecha || !total) {
    return {
      verificada: false,
      motivo: 'Datos insuficientes para verificacion',
      campos_faltantes: {
        cif: !cif_proveedor,
        numero: !num_factura,
        fecha: !fecha,
        total: !total,
      }
    };
  }

  // Construir URL de verificacion (la misma que codifica el QR)
  const fechaFormateada = fecha.replace(/[\/\-\.]/g, '');
  const url = new URL('https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR');
  url.searchParams.set('nif', cif_proveedor);
  url.searchParams.set('numserie', num_factura);
  url.searchParams.set('fecha', fechaFormateada);
  url.searchParams.set('importe', parseFloat(total).toFixed(2));

  try {
    const respuesta = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });

    // Analizar respuesta de la AEAT
    // (El formato exacto de la respuesta hay que verificarlo)
    const html = await respuesta.text();

    return {
      verificada: html.includes('registrada') || html.includes('encontrada'),
      url_verificacion: url.toString(),
      status_http: respuesta.status,
    };
  } catch (error) {
    return {
      verificada: null,  // Indeterminado
      error: error.message,
      url_verificacion: url.toString(),
    };
  }
}

module.exports = { verificarFacturaEnAEAT };
```

---

## 19. FUENTES Y DOCUMENTACION OFICIAL

### 19.1 Normativa

| Documento | URL |
|-----------|-----|
| RD 1007/2023 (BOE) | `https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840` |
| Ley 11/2021 Antifraude | `https://www.boe.es/buscar/act.php?id=BOE-A-2021-11473` |
| Ley 58/2003 General Tributaria | `https://www.boe.es/buscar/act.php?id=BOE-A-2003-23186` |
| RD 1619/2012 Reglamento Facturacion | `https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696` |

### 19.2 Documentacion tecnica AEAT

| Recurso | URL |
|---------|-----|
| Pagina principal Verifactu AEAT | `https://sede.agenciatributaria.gob.es/Sede/iva/facturacion-registro/sistemas-informaticos-facturacion-verifactu.html` |
| Campana informativa AEAT | `https://www.agenciatributaria.es/AEAT.internet/Inicio/La_Agencia_Tributaria/Campanas/Sistemas_informaticos_de_facturacion_y_Veri_factu/` |
| Esquemas XSD | `https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/` |

### 19.3 Otros recursos

| Recurso | URL |
|---------|-----|
| GitHub - buscar verifactu | `https://github.com/search?q=verifactu` |
| GitHub - buscar ticketbai | `https://github.com/search?q=ticketbai` |
| npm - buscar verifactu | `https://www.npmjs.com/search?q=verifactu` |
| FNMT certificados | `https://www.sede.fnmt.gob.es/certificados` |
| TicketBAI Bizkaia | `https://www.batuz.eus/` |

---

## 20. RESUMEN EJECUTIVO

### Que es

Verifactu es el sistema espanol que obliga a que todo software de facturacion genere registros inalterables (hash chain SHA-256) y los envie automaticamente a la AEAT.

### Marco legal

RD 1007/2023, desarrollando la Ley 11/2021 Antifraude y el articulo 29.2.j) de la LGT.

### Requisitos tecnicos clave

- Hash chain SHA-256 sobre campos fiscales de cada factura
- XML firmado (XMLDSig) enviado por SOAP/HTTPS con mutual TLS
- Certificado electronico reconocido (FNMT o equivalente)
- QR de verificacion en cada factura
- Marca "VERI*FACTU" visible

### Timeline

- Fabricantes: 1 julio 2025 (verificar posible aplazamiento)
- Usuarios: 1 enero 2026 (verificar posible aplazamiento)

### Sanciones

- Fabricante software no conforme: 150.000 EUR/ejercicio
- Usuario con software no conforme: 50.000 EUR/ejercicio
- Por factura sin requisitos: hasta 150 EUR (max 6.000 EUR/trimestre)

### Impacto en SETEX

- **Si SETEX solo captura facturas recibidas:** No necesita ser SIF. Oportunidad de anadir verificacion de facturas.
- **Si SETEX emite facturas:** Debe cumplir todos los requisitos de SIF (hash chain, firma XML, envio AEAT, QR, declaracion responsable).

### Componentes tecnicos necesarios (si emite facturas)

1. Modulo hash chain (SHA-256, encadenamiento)
2. Generador XML conforme a XSD de AEAT
3. Firmador XMLDSig con certificado .p12
4. Cliente SOAP mTLS para envio a AEAT
5. Generador de QR de verificacion
6. Cola de reintentos (BullMQ)
7. Tabla PostgreSQL de registros
8. Log de auditoria inalterable
9. Generador PDF con marca VERI*FACTU

### Prioridad inmediata

Verificar en la sede de la AEAT y en el BOE el estado actual de Verifactu a marzo 2026, ya que mi informacion termina en mayo 2025. Confirmar fechas, descargar XSD definitivos, y probar el entorno de pruebas si esta disponible.

---

*Informe preparado para SETEX Captura Facturas -- marzo 2026*
*Basado en RD 1007/2023, documentacion AEAT, y analisis tecnico*
*Conocimiento del autor actualizado hasta mayo 2025 -- verificar cambios posteriores*