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
  const s = String(str).trim().replace(/[€$\s]/g, '');
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
 * Parsea un porcentaje al entero visible (21, 10, 4) — NO al decimal 0.21.
 * parsePercent() convierte para cálculo matemático; este para comparar/mostrar.
 * Acepta "21", "21,0", "21.0", "21%", 0.21 → 21. Devuelve null si no parseable.
 */
function parseRateEntero(raw) {
  if (raw == null) return null;
  const clean = String(raw).replace(',', '.').replace('%', '').trim();
  const n = parseFloat(clean);
  if (!Number.isFinite(n)) return null;
  return n < 1 && n > 0 ? n * 100 : n;   // 0.21 → 21; 21 → 21; 0 → 0 (exento)
}

/** Formatea un número a importe español "1.234,56". */
function fmtAmountEs(n) {
  return Number.isFinite(n)
    ? n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
}

/**
 * Completa por aritmética los huecos de cada tramo IVA (fix multi-IVA 2026-07-03):
 *   - base ausente y cuota+% presentes (% > 0)  → base  = cuota ÷ (%/100)
 *   - cuota ausente y base+% presentes          → cuota = base × %/100
 *   - cuota ausente y % = 0 (tramo exento)      → cuota = "0,00"
 * Necesario porque Azure DI prebuilt-invoice NO devuelve BaseAmount por tramo
 * (schema oficial 2024-11-30-ga: TaxDetails solo trae Amount y Rate).
 * Muta y devuelve el mismo array para poder encadenar.
 */
function fillDerivedBases(lineas) {
  if (!Array.isArray(lineas)) return lineas;
  for (const l of lineas) {
    if (!l) continue;
    const pct = parseRateEntero(l.porcentaje);
    if (pct == null) continue;
    const base  = parseSpanishAmount(l.base);
    const cuota = parseSpanishAmount(l.cuota);
    if (cuota == null && pct === 0) {
      l.cuota = '0,00';
    } else if (cuota == null && base != null) {
      l.cuota = fmtAmountEs(Math.round(base * pct) / 100);
    }
    if (base == null && pct > 0) {
      const c = parseSpanishAmount(l.cuota);
      if (c != null) l.base = fmtAmountEs(Math.round((c / (pct / 100)) * 100) / 100);
    }
  }
  return lineas;
}

/**
 * Elimina artefactos "fila resumen" del desglose (fix multi-IVA 2026-07-04).
 * Azure DI a veces emite una entrada extra en TaxDetails SIN tipo cuya cuota
 * es la SUMA de las demás (la línea "Total IVA" del pie de la factura).
 * Detectado empíricamente en la validación E2E de staging. Si hay ≥2 tramos
 * tipados y una línea sin tipo cuya cuota ≈ Σ cuotas tipadas (±0,05€), es la
 * fila resumen: se descarta. Devuelve un array nuevo (no muta).
 */
function dropResumenArtifacts(lineas) {
  if (!Array.isArray(lineas)) return lineas;
  const typed   = lineas.filter(l => parseRateEntero(l && l.porcentaje) != null);
  const untyped = lineas.filter(l => parseRateEntero(l && l.porcentaje) == null);
  if (typed.length < 2 || untyped.length === 0) return lineas;

  const sumCuotas = typed.reduce((acc, l) => acc + (parseSpanishAmount(l.cuota) || 0), 0);
  const sumBases  = typed.reduce((acc, l) => acc + (parseSpanishAmount(l.base)  || 0), 0);
  const keepUntyped = untyped.filter(l => {
    const c = parseSpanishAmount(l && l.cuota);
    const b = parseSpanishAmount(l && l.base);
    const esResumenCuota = c != null && Math.abs(c - sumCuotas) <= 0.05;
    const esResumenBase  = b != null && sumBases > 0 && Math.abs(b - sumBases) <= 0.05;
    return !(esResumenCuota || esResumenBase);
  });
  return typed.concat(keepUntyped);
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
 *
 * 2026-04-21 super-tarea multi-IVA: el nuevo schema incluye `productos: []`
 * dentro de cada línea. Al fusionar, si un lado tiene productos y el otro no,
 * preservamos los productos. Si ambos tienen, priorizamos OpenAI (mejor lectura
 * de descripciones en español). Dedupe por "descripcion+importe" exacto para
 * evitar líneas repetidas cuando ambos OCR detectan los mismos productos.
 */
function mergeLineasIva(openaiLineas, azureLineas) {
  const o = Array.isArray(openaiLineas) ? openaiLineas : [];
  const a = Array.isArray(azureLineas)  ? azureLineas  : [];

  if (o.length === 0 && a.length === 0) return null;
  if (o.length === 0) return normalizeProductos(a);
  if (a.length === 0) return normalizeProductos(o);

  // Construir índice por porcentaje NUMÉRICO normalizado para cruzar tramos
  // entre motores. Fix 2026-07-03: antes se indexaba por string literal y
  // "21" (OpenAI) ≠ "21,0" (Azure) NO cruzaba → el mismo tramo se duplicaba
  // y las sumas de bases/cuotas salían dobladas en facturas multi-IVA.
  const keyOf = (l) => {
    const r = parseRateEntero(l && l.porcentaje);
    return r == null ? null : String(Math.round(r * 10) / 10); // "21", "10", "0"
  };

  const byPct = new Map();
  for (const l of a) {
    const k = keyOf(l);
    if (k != null) byPct.set(k, { ...l, productos: Array.isArray(l.productos) ? l.productos : [] });
  }

  for (const l of o) {
    const k = keyOf(l);
    if (k == null) continue;
    const existing = byPct.get(k);
    const oProds = Array.isArray(l.productos) ? l.productos : [];
    if (!existing) {
      // Tramo solo visto por OpenAI
      byPct.set(k, { ...l, productos: oProds });
      continue;
    }
    // Tramo visto por ambos: preferir base/cuota de Azure (más exacto) y
    // productos fusionados con OpenAI prioritario en descripciones.
    const mergedProds = mergeProductos(oProds, existing.productos);
    byPct.set(k, {
      base:       existing.base       || l.base,
      porcentaje: existing.porcentaje || l.porcentaje,
      cuota:      existing.cuota      || l.cuota,
      productos:  mergedProds
    });
  }

  const merged = Array.from(byPct.values());
  return merged.length > 0 ? merged : null;
}

/** Normaliza productos: asegura que cada línea tiene array productos (aunque vacío). */
function normalizeProductos(lineas) {
  return lineas.map(l => ({
    ...l,
    productos: Array.isArray(l.productos) ? l.productos : []
  }));
}

/** Fusiona dos arrays de productos dedupeando por descripcion+importe. */
function mergeProductos(prodsA, prodsB) {
  const seen = new Set();
  const out = [];
  const push = (p) => {
    if (!p || !p.descripcion) return;
    const key = `${String(p.descripcion).trim().toLowerCase()}|${p.importe || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      descripcion: String(p.descripcion).substring(0, 120),
      importe:     p.importe || null
    });
  };
  // OpenAI prioritario (mejor descripciones españolas)
  for (const p of (prodsA || [])) push(p);
  for (const p of (prodsB || [])) push(p);
  return out;
}

/**
 * Normaliza un array de lineas_iva recibido del usuario (modal de comprobación o
 * panel admin) y devuelve un objeto con el array saneado + agregados recalculados.
 *
 * Super-tarea multi-IVA 2026-04-21 parte 2/7: el usuario puede editar líneas
 * individuales en la UI de comprobación. Esta función:
 *   1. Valida que cada línea tiene base/porcentaje/cuota como strings no vacíos.
 *   2. Normaliza productos a [] (nunca null) y trimea descripciones a 120 chars.
 *   3. Recalcula base_imponible = SUMA de bases, cuota_iva = SUMA de cuotas.
 *   4. Elige iva_porcentaje = porcentaje del tramo con mayor cuota (consistencia
 *      con lo que muestra el panel admin como "tipo dominante").
 *
 * Devuelve { lineas, base, cuota, porcentaje, errors }.
 *   - lineas: array normalizado listo para JSON.stringify a BD
 *   - base/cuota/porcentaje: strings en formato español listos para columnas
 *     agregadas (base_imponible/cuota_iva/iva_porcentaje)
 *   - errors: array de strings con problemas detectados (no bloqueantes —
 *     decide el llamante si aceptar o rechazar el payload)
 *
 * Si el array es null/vacío o todas las líneas son inválidas, devuelve
 * { lineas: null, base: null, cuota: null, porcentaje: null, errors: [...] }
 * para que el llamante caiga al flujo mono-IVA.
 */
function normalizeConfirmedLineasIva(rawLineas) {
  const errors = [];
  if (!Array.isArray(rawLineas) || rawLineas.length === 0) {
    return { lineas: null, base: null, cuota: null, porcentaje: null, errors };
  }

  const fmtAmount = (n) => Number.isFinite(n)
    ? n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;
  const fmtPct = (n) => Number.isFinite(n)
    ? (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')
    : null;

  const cleanLineas = [];
  let sumBase = 0;
  let sumCuota = 0;
  let dominantRate = null;
  let dominantCuota = -1;

  // parseRateEntero es ahora helper de módulo (compartido con mergeLineasIva
  // y fillDerivedBases) — misma semántica que la versión inline anterior.

  for (let i = 0; i < rawLineas.length; i++) {
    const l = rawLineas[i] || {};
    const baseNum = parseSpanishAmount(l.base);
    const cuotaNum = parseSpanishAmount(l.cuota);
    const pctNum = parseRateEntero(l.porcentaje);

    if (baseNum == null || cuotaNum == null || pctNum == null) {
      errors.push(`línea ${i}: base/porcentaje/cuota vacíos o no parseables`);
      continue; // línea inválida — fuera del desglose
    }

    const productos = Array.isArray(l.productos) ? l.productos : [];
    const cleanProductos = [];
    for (const p of productos) {
      if (!p || !p.descripcion) continue;
      const desc = String(p.descripcion).trim().substring(0, 120);
      if (!desc) continue;
      const imp = p.importe != null ? String(p.importe).trim() : null;
      cleanProductos.push({ descripcion: desc, importe: imp || null });
    }

    cleanLineas.push({
      base:       fmtAmount(baseNum),
      porcentaje: fmtPct(pctNum),
      cuota:      fmtAmount(cuotaNum),
      productos:  cleanProductos,
    });

    sumBase += baseNum;
    sumCuota += cuotaNum;
    if (cuotaNum > dominantCuota) {
      dominantCuota = cuotaNum;
      dominantRate = pctNum;
    }
  }

  if (cleanLineas.length === 0) {
    errors.push('ninguna línea válida — no se puede reconstruir desglose');
    return { lineas: null, base: null, cuota: null, porcentaje: null, errors };
  }

  return {
    lineas: cleanLineas,
    base:   fmtAmount(sumBase),
    cuota:  fmtAmount(sumCuota),
    porcentaje: fmtPct(dominantRate),
    errors,
  };
}

module.exports = {
  validateIVACoherencia,
  mergeLineasIva,
  parseSpanishAmount,
  parsePercent,
  parseRateEntero,
  fillDerivedBases,
  dropResumenArtifacts,
  normalizeConfirmedLineasIva,
};
