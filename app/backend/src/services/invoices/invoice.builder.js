// Invoice builder — compone el shape final de una factura desde OCR + correcciones
// manuales + validaciones. Aplica patrón Builder para evitar objetos con 20+ props
// construidos inline.
'use strict';

class InvoiceBuilder {
  constructor() {
    this.data = {
      emisor_nombre: null,
      emisor_nif: null,
      receptor_nombre: null,
      receptor_nif: null,
      numero_factura: null,
      fecha_emision: null,
      base_imponible: null,
      iva_porcentaje: null,
      cuota_iva: null,
      irpf_porcentaje: null,
      irpf_cuota: null,
      total_factura: null,
      moneda: 'EUR',
      invoice_type: 'compra',
      lineas_iva: [],
      iva_validation_ok: null,
      iva_warnings: null,
      ocr_result: null,
      confidence_level: null,
    };
  }

  fromOcr(ocrResult) {
    const o = ocrResult || {};
    this.data.emisor_nombre = o.emisor_nombre ?? null;
    this.data.emisor_nif = o.emisor_nif ?? null;
    this.data.receptor_nombre = o.receptor_nombre ?? null;
    this.data.receptor_nif = o.receptor_nif ?? null;
    this.data.numero_factura = o.numero_factura ?? null;
    this.data.fecha_emision = o.fecha ?? null;
    this.data.base_imponible = o.base_imponible ?? null;
    this.data.cuota_iva = o.cuota_iva ?? null;
    this.data.irpf_porcentaje = o.irpf_pct ?? null;
    this.data.irpf_cuota = o.irpf_cuota ?? null;
    this.data.total_factura = o.total ?? null;
    this.data.lineas_iva = Array.isArray(o.lineas_iva) ? o.lineas_iva : [];
    this.data.ocr_result = o.raw ?? o;
    this.data.confidence_level = typeof o.confidence === 'number'
      ? (o.confidence >= 0.85 ? 'high' : o.confidence >= 0.5 ? 'medium' : 'low')
      : null;
    return this;
  }

  withUserOverrides(overrides = {}) {
    for (const key of Object.keys(overrides)) {
      if (key in this.data && overrides[key] !== undefined) {
        this.data[key] = overrides[key];
      }
    }
    return this;
  }

  withIvaValidation({ ok, warnings = null }) {
    this.data.iva_validation_ok = !!ok;
    this.data.iva_warnings = warnings;
    return this;
  }

  withProveedor({ nombre, nif }) {
    this.data.emisor_nombre = nombre;
    this.data.emisor_nif = nif;
    return this;
  }

  withInvoiceType(type) {
    if (type === 'venta' || type === 'compra') this.data.invoice_type = type;
    return this;
  }

  build() {
    // Copia defensiva: evita que el caller mute el estado del builder.
    return JSON.parse(JSON.stringify(this.data));
  }
}

module.exports = { InvoiceBuilder };
