// src/ocr/validateIVA.js
// Validación matemática de campos de IVA en facturas españolas.
// Detecta inconsistencias entre base_imponible, iva_porcentaje, cuota_iva y total.
// Tolerancia ±0,05€ — cubre redondeos de diferentes softwares de facturación.
'use strict';

const TOLERANCIA = 0.05; // 5 céntimos — suficiente para redondeos contables
const TIPOS_IVA_ESPANA = [0, 4, 5, 10, 21]; // exento, superreducido, reducido+, reducido, general

/**
 * Parsea un importe en formato español "1.234,56" o inglés "1,234.56" a float.
 * Devuelve null si no se puede parsear o el valor es vacío.
 */
function parseSpanishAmount(str) {
  if (str == null) return null;
  let s = String(str).trim().replace(/[€$\s]/g, '');
  if (!s || s === '' || s === 'null') return null;

  const hasComma = s.includes(',');
  const hasDot   = s.includes('.');
  let val;

  if (hasComma && hasDot) {
    // Ambos separadores — el último es el decimal
    val = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? parseFloat(s.replace(/\./g, '').replace(',', '.'))  // español: 1.234,56
      : parseFloat(s.replace(/,/g, ''));                    // inglés:  1,234.56
  } else if (hasComma) {
    const after = s.split(',').pop() || '';
    // 3 dígitos tras coma → separador de miles (1,234); resto → decimal español (144,40)
    val = after.length === 3
      ? parseFloat(s.replace(/,/g, ''))
      : parseFloat(s.replace(',', '.'));
  } else {
    val = parseFloat(s);
  }

  return isNaN(val) ? null : val;
}

/**
 * Parsea un porcentaje de IVA en cualquier formato → decimal (ej: "21,0" → 0.21).
 * Devuelve null si no se puede parsear.
 */
function parsePercent(str) {
  if (str == null) return null;
  const clean = String(str).replace(',', '.').replace('%', '').trim();
  const n = parseFloat(clean);
  if (isNaN(n)) return null;
  // Si el valor es >= 1 asumimos que es porcentaje entero (21 → 0.21)
  // Si es < 1 asumimos que ya es decimal (0.21 → 0.21)
  return n < 1 ? n : n / 100;
}

/**
 * Valida la coherencia matemática de los campos de IVA.
 *
 * Comprobaciones:
 *   1. base_imponible × iva_porcentaje ≈ cuota_iva (±0,05€)
 *   2. base_imponible + cuota_iva − cuota_irpf ≈ total (±0,05€)
 *   3. Si lineas_iva: coherencia interna de cada línea + suma de bases/cuotas
 *   4. Tipos de IVA válidos en España (0%, 4%, 5%, 10%, 21%)
 *
 * @param {object} campos - Campos del OCR (base_imponible, iva_porcentaje, cuota_iva, total, irpf…)
 * @returns {{ valid: boolean, warnings: string[], errors: string[], desglose: object }}
 */
function validateIVACoherencia(campos) {
  const warnings = [];
  const errors   = [];

  const base      = parseSpanishAmount(campos.base_imponible);
  const cuotaIva  = parseSpanishAmount(campos.cuota_iva);
  const total     = parseSpanishAmount(campos.total);
  const cuotaIrpf = parseSpanishAmount(campos.cuota_irpf) || 0;
  const ivaPct    = parsePercent(campos.iva_porcentaje);
  const lineas    = Array.isArray(campos.lineas_iva) ? campos.lineas_iva : [];
  const esMulti   = lineas.length > 1;

  // ── Comprobación 1: base × tipo ≈ cuota_iva ────────────────────────────────
  if (base !== null && cuotaIva !== null && ivaPct !== null) {
    const cuotaEsperada = Math.round(base * ivaPct * 100) / 100;
    const diff = Math.abs(cuotaEsperada - cuotaIva);
    if (diff > TOLERANCIA && !esMulti) {
      // IVA múltiple tiene tolerancia mayor porque base/cuota son suma de varias líneas
      errors.push(
        `IVA inconsistente: ${campos.base_imponible} × ${campos.iva_porcentaje}% = ${cuotaEsperada.toFixed(2)}€ ≠ cuota_iva ${campos.cuota_iva} (diff: ${diff.toFixed(2)}€)`
      );
    } else if (diff > 0.30 && esMulti) {
      // Con IVA múltiple, toleramos hasta 30 céntimos (sumas de redondeos)
      warnings.push(`IVA mixto: cuota total ${campos.cuota_iva}€ difiere ${diff.toFixed(2)}€ vs cálculo simple`);
    }
  }

  // ── Comprobación 2: base + cuota_iva − cuota_irpf ≈ total ─────────────────
  if (base !== null && cuotaIva !== null && total !== null) {
    const totalCalculado = Math.round((base + cuotaIva - cuotaIrpf) * 100) / 100;
    const diff = Math.abs(totalCalculado - total);
    const tolTotal = esMulti ? 0.30 : TOLERANCIA;
    if (diff > tolTotal) {
      errors.push(
        `Total inconsistente: base(${campos.base_imponible}) + IVA(${campos.cuota_iva}) - IRPF(${campos.cuota_irpf || '0,00'}) = ${totalCalculado.toFixed(2)}€ ≠ total(${campos.total}) (diff: ${diff.toFixed(2)}€)`
      );
    }
  }

  // ── Comprobación 3: líneas de IVA múltiple ─────────────────────────────────
  if (esMulti) {
    let sumaBases  = 0;
    let sumaCuotas = 0;

    for (const linea of lineas) {
      const lb  = parseSpanishAmount(linea.base);
      const lc  = parseSpanishAmount(linea.cuota);
      const lp  = parsePercent(linea.porcentaje);

      if (lb === null || lc === null) continue;
      sumaBases  += lb;
      sumaCuotas += lc;

      // Coherencia interna de cada línea
      if (lp !== null) {
        const cuotaEsp = Math.round(lb * lp * 100) / 100;
        if (Math.abs(cuotaEsp - lc) > TOLERANCIA) {
          warnings.push(
            `Línea IVA ${linea.porcentaje}%: ${linea.base} × ${linea.porcentaje}% ≠ ${linea.cuota} (diff: ${Math.abs(cuotaEsp - lc).toFixed(2)}€)`
          );
        }
      }

      // Tipo de IVA válido en España
      if (lp !== null) {
        const pctNum = Math.round(lp * 100);
        if (!TIPOS_IVA_ESPANA.includes(pctNum)) {
          warnings.push(`Tipo IVA inusual en línea: ${linea.porcentaje}% (tipos válidos: 0%, 4%, 5%, 10%, 21%)`);
        }
      }
    }

    // Verificar que la suma de líneas ≈ totales
    if (base !== null && Math.abs(sumaBases - base) > 0.10) {
      warnings.push(`Suma bases IVA (${sumaBases.toFixed(2)}€) ≠ base_imponible total (${campos.base_imponible})`);
    }
    if (cuotaIva !== null && Math.abs(sumaCuotas - cuotaIva) > 0.10) {
      warnings.push(`Suma cuotas IVA (${sumaCuotas.toFixed(2)}€) ≠ cuota_iva total (${campos.cuota_iva})`);
    }
  }

  // ── Comprobación 4: tipo de IVA válido en España ───────────────────────────
  if (ivaPct !== null && !esMulti) {
    const pctNum = Math.round(ivaPct * 100);
    if (!TIPOS_IVA_ESPANA.includes(pctNum)) {
      warnings.push(`Tipo IVA inusual: ${campos.iva_porcentaje}% (tipos válidos: 0%, 4%, 5%, 10%, 21%)`);
    }
  }

  // ── Comprobación 5: tipo IRPF razonable ────────────────────────────────────
  if (cuotaIrpf > 0) {
    const TIPOS_IRPF = [2, 7, 15, 19, 21, 24]; // tipos habituales en España
    const irpfPctVal = parsePercent(campos.irpf_porcentaje);
    if (irpfPctVal !== null) {
      const irpfPctNum = Math.round(irpfPctVal * 100);
      if (!TIPOS_IRPF.includes(irpfPctNum)) {
        warnings.push(`Tipo IRPF inusual: ${campos.irpf_porcentaje}% (habituales: 2%, 7%, 15%, 19%, 21%, 24%)`);
      }
      // Verificar que la cuota IRPF = base × % IRPF (tolerancia ±0,05€)
      if (base !== null) {
        const cuotaIrpfEsp = Math.round(base * irpfPctVal * 100) / 100;
        const diffIrpf = Math.abs(cuotaIrpfEsp - cuotaIrpf);
        if (diffIrpf > TOLERANCIA) {
          warnings.push(
            `IRPF inconsistente: ${campos.base_imponible} × ${campos.irpf_porcentaje}% = ${cuotaIrpfEsp.toFixed(2)}€ ≠ cuota_irpf ${campos.cuota_irpf} (diff: ${diffIrpf.toFixed(2)}€)`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    desglose: {
      base_parseada:  base,
      cuota_parseada: cuotaIva,
      total_parseado: total,
      irpf_parseado:  cuotaIrpf,
      tipo_decimal:   ivaPct,
      es_multi_iva:   esMulti,
    }
  };
}

/**
 * Fusiona dos arrays de lineas_iva (OpenAI y Azure) tomando el más completo.
 * Prioridad: el que tenga más líneas (Azure si tiene TaxDetails; OpenAI si detectó más).
 */
function mergeLineasIva(openaiLineas, azureLineas) {
  const o = Array.isArray(openaiLineas) ? openaiLineas : [];
  const a = Array.isArray(azureLineas)  ? azureLineas  : [];

  if (o.length === 0 && a.length === 0) return null;
  if (o.length === 0) return a;
  if (a.length === 0) return o;

  // Si coinciden en número de líneas, preferir Azure (sin alucinaciones)
  if (o.length === a.length) return a;

  // Tomar el que tiene más líneas (más detalle)
  return a.length > o.length ? a : o;
}

module.exports = { validateIVACoherencia, mergeLineasIva, parseSpanishAmount, parsePercent };
