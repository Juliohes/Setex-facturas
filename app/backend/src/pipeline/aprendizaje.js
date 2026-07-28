// src/pipeline/aprendizaje.js
// Gap "aprendizaje continuo" (2026-07-28): que v2 mejore con lo que ya se
// sabe, en vez de releer cada factura desde cero como si fuera la primera
// vez. Dos mecanismos, ambos sobre infraestructura YA EXISTENTE (no se
// inventa nada nuevo, se conecta al pipeline v2):
//
// 1. Proveedor conocido (known_cifs / company_relationships, tablas de v1
//    sin cambios): si el NIF que ha resuelto el árbitro ya coincide con un
//    proveedor que este usuario (o esta empresa cliente) ha confirmado
//    antes, se prefiere el nombre EXACTO ya aprendido sobre cómo lo haya
//    leído la IA esta vez — reduce alucinaciones de nombre en proveedores
//    recurrentes (la mayoría de las facturas reales, en la práctica).
//
// 2. Ejemplos verificados (few-shot desde eval/facturas/*/ground_truth.json):
//    busca facturas YA VERIFICADAS POR HUMANO del MISMO proveedor para
//    ofrecerlas como ejemplo real en una re-extracción dirigida. Es la
//    única forma realista de "la IA aprende de sus correcciones" sin
//    reentrenar ningún modelo — reentrenar Gemini/GPT-4/Azure/Mistral no es
//    viable a la escala de este proyecto (decisión documentada 2026-07-28).
'use strict';

const fs = require('fs');
const path = require('path');

const EVAL_FACTURAS_DIR = process.env.EVAL_FACTURAS_DIR || '/app/eval/facturas';

function normalizarNif(nif) {
  return String(nif || '').toUpperCase().replace(/[\s\-.]/g, '');
}

/**
 * Busca un proveedor ya conocido por NIF: primero por usuario (known_cifs),
 * luego por empresa cliente (company_relationships). Nunca lanza — un fallo
 * de BD se trata como "no se sabe nada" (fail-safe: la IA sigue decidiendo
 * con lo que lea, el aprendizaje es un extra, no una dependencia dura).
 *
 * @param {import('pg').Pool} pool
 * @param {string} nif
 * @param {{userId?: number, empresaNif?: string}} [opts]
 * @returns {Promise<{nombre: string, fuente: 'known_cifs'|'company_relationships', confirmaciones: number} | null>}
 */
async function buscarProveedorConocido(pool, nif, { userId, empresaNif } = {}) {
  const nifNorm = normalizarNif(nif);
  if (!nifNorm || !pool) return null;
  try {
    if (userId) {
      const r = await pool.query(
        `SELECT proveedor_nombre, confirmations FROM known_cifs
          WHERE user_id = $1 AND proveedor_nif = $2 AND proveedor_nombre IS NOT NULL
          ORDER BY confirmations DESC, last_seen DESC LIMIT 1`,
        [userId, nifNorm]
      );
      if (r.rows.length > 0) {
        return { nombre: r.rows[0].proveedor_nombre, fuente: 'known_cifs', confirmaciones: r.rows[0].confirmations };
      }
    }
    if (empresaNif) {
      const r = await pool.query(
        `SELECT counterparty_nombre, confirmations FROM company_relationships
          WHERE client_cif = $1 AND counterparty_nif = $2 AND counterparty_nombre IS NOT NULL
          ORDER BY confirmations DESC, last_seen DESC LIMIT 1`,
        [empresaNif, nifNorm]
      );
      if (r.rows.length > 0) {
        return { nombre: r.rows[0].counterparty_nombre, fuente: 'company_relationships', confirmaciones: r.rows[0].confirmations };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Busca hasta `limite` facturas YA VERIFICADAS del mismo proveedor (por NIF)
 * en el dataset de verdad (eval/facturas/). Solo cuenta un campo si tiene
 * verificado:true — un ground truth a medio revisar no es un ejemplo fiable
 * (regla del propio dataset, ver eval/README.md). Nunca lanza.
 *
 * @param {string} nif
 * @param {{limite?: number}} [opts]
 * @returns {Array<{factura_id: string, campos_verificados: object}>}
 */
function buscarEjemplosVerificados(nif, { limite = 2 } = {}) {
  const nifNorm = normalizarNif(nif);
  if (!nifNorm) return [];
  let ids;
  try {
    ids = fs.readdirSync(EVAL_FACTURAS_DIR);
  } catch {
    return []; // dataset no disponible en este entorno — no es un error, solo "sin ejemplos"
  }

  const ejemplos = [];
  for (const id of ids) {
    if (ejemplos.length >= limite) break;
    if (id === 'sintetica-ejemplo') continue;
    const ruta = path.join(EVAL_FACTURAS_DIR, id, 'ground_truth.json');
    let gt;
    try { gt = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { continue; }

    const nifCampo = gt.campos && gt.campos['emisor.nif'];
    if (!nifCampo || !nifCampo.verificado || !nifCampo.valor) continue;
    if (normalizarNif(nifCampo.valor) !== nifNorm) continue;

    const camposVerificados = {};
    for (const [campo, valor] of Object.entries(gt.campos || {})) {
      if (Array.isArray(valor)) continue; // desglose_iva: se omite del ejemplo por simplicidad
      if (valor && valor.verificado) camposVerificados[campo] = valor.valor;
    }
    if (Object.keys(camposVerificados).length === 0) continue;

    ejemplos.push({ factura_id: id, campos_verificados: camposVerificados });
  }
  return ejemplos;
}

/**
 * Construye el bloque de texto a añadir a un prompt de (re)extracción, a
 * partir de lo aprendido. Devuelve '' si no hay nada que aportar (caso
 * normal: primera vez que se ve a este proveedor) — nunca altera el prompt
 * base sin una señal real.
 */
function construirPistaAprendizaje({ proveedorConocido, ejemplosVerificados } = {}) {
  const partes = [];
  if (proveedorConocido) {
    partes.push(
      `Dato ya confirmado en facturas anteriores de este mismo proveedor: su nombre ` +
      `exacto es "${proveedorConocido.nombre}" (confirmado ${proveedorConocido.confirmaciones} ` +
      `vez/veces). Si el nombre que lees en esta imagen es parecido pero no idéntico, usa ` +
      `este nombre ya confirmado en vez de arriesgarte con una lectura distinta.`
    );
  }
  if (ejemplosVerificados && ejemplosVerificados.length > 0) {
    partes.push('Ejemplo verificado por humano de una factura ANTERIOR de este mismo proveedor (para comparar el formato, NO copiar estos valores en la factura actual):');
    ejemplosVerificados.forEach((ej) => partes.push(JSON.stringify(ej.campos_verificados)));
  }
  return partes.join('\n');
}

module.exports = {
  buscarProveedorConocido,
  buscarEjemplosVerificados,
  construirPistaAprendizaje,
  normalizarNif,
};
