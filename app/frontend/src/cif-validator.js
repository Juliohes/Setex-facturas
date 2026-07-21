// Validación CIF emisor/receptor vs usuario logueado — vanilla JS.
// Espejo de app/backend/src/lib/invoice-cif-validator.js. Mantén sincronizados.
// checkDigitCIF es espejo de app/backend/src/domain/validators/nif.js — mismo
// algoritmo AEAT, mismo fix 2026-07-13 (letras siempre-letra: NPQRSW).
// Expone window.SetexCifValidator = { validateInvoiceCifs, normalizeNif, normalizeNombre, checkDigitCIF }
(function (global) {
    'use strict';

    function normalizeNif(s) {
        return String(s || '')
            .toUpperCase()
            .replace(/[\s\-.]/g, '')
            .replace(/^ES/, '');
    }

    /**
     * Valida el dígito de control de un CIF español (algoritmo AEAT).
     * Retorna true/false, o null si no aplica (NIF, NIE u otro formato).
     * Solo señal de confianza, NUNCA usar para bloquear/rechazar de forma dura.
     */
    function checkDigitCIF(taxId) {
        if (!taxId || typeof taxId !== 'string') return null;
        const clean = taxId.toUpperCase().replace(/[\s\-.]/g, '');
        if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(clean)) return null;

        const digits = clean.slice(1, 8).split('').map(Number);
        const control = clean[8];

        let sumOdd = 0;
        for (const i of [0, 2, 4, 6]) {
            const d = digits[i] * 2;
            sumOdd += d >= 10 ? Math.floor(d / 10) + (d % 10) : d;
        }
        const sumEven = digits[1] + digits[3] + digits[5];
        const unit = (sumOdd + sumEven) % 10;
        const checkNum = (10 - unit) % 10;
        const checkLetters = 'JABCDEFGHI';

        if ('NPQRSW'.includes(clean[0])) {
            return control === checkLetters[checkNum];
        }
        return control === String(checkNum);
    }

    function normalizeNombre(s) {
        return String(s || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036F]/g, '')
            .replace(/[.,;:()"'`´]/g, '')
            .replace(/\b(s\.?l\.?u?\.?|s\.?a\.?(?:\s|$)|s\.?coop\.?|c\.?b\.?|sociedad limitada(?: unipersonal)?|sociedad anonima)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function validateInvoiceCifs(args) {
        const invoiceType    = args.invoiceType;
        const emisorNif      = args.emisorNif;
        const emisorNombre   = args.emisorNombre;
        const receptorNif    = args.receptorNif;
        const receptorNombre = args.receptorNombre;
        const userNif        = args.userNif;
        const userNombre     = args.userNombre;

        const errors = [];
        const warnings = [];

        const eN = normalizeNif(emisorNif);
        const rN = normalizeNif(receptorNif);
        const uN = normalizeNif(userNif);

        if (eN && rN && eN === rN) {
            errors.push({
                field: 'both',
                code: 'SAME_EMISOR_RECEPTOR',
                message: 'El CIF del emisor y del receptor no pueden ser idénticos. Una empresa no puede emitirse facturas a sí misma.'
            });
        }

        if (uN) {
            if (invoiceType === 'venta') {
                if (eN && eN !== uN) {
                    errors.push({
                        field: 'emisor',
                        code: 'EMISOR_MISMATCH',
                        message: 'El CIF del emisor leído en la factura (' + emisorNif + ') no coincide con el de tu empresa (' + userNif + '). Esta factura no parece emitida por ti.'
                    });
                }
                if (eN && eN === uN && userNombre && emisorNombre &&
                    normalizeNombre(emisorNombre) !== normalizeNombre(userNombre)) {
                    warnings.push({
                        field: 'emisor',
                        code: 'EMISOR_NAME_DIFFERS',
                        message: 'El nombre del emisor en la factura ("' + emisorNombre + '") difiere del registrado en tu empresa ("' + userNombre + '"). El CIF coincide, así que probablemente sea solo variación tipográfica.'
                    });
                }
            } else if (invoiceType === 'compra') {
                if (rN && rN !== uN) {
                    errors.push({
                        field: 'receptor',
                        code: 'RECEPTOR_MISMATCH',
                        message: 'El CIF del receptor leído en la factura (' + receptorNif + ') no coincide con el de tu empresa (' + userNif + '). Esta factura no parece dirigida a ti.'
                    });
                }
                if (rN && rN === uN && userNombre && receptorNombre &&
                    normalizeNombre(receptorNombre) !== normalizeNombre(userNombre)) {
                    warnings.push({
                        field: 'receptor',
                        code: 'RECEPTOR_NAME_DIFFERS',
                        message: 'El nombre del receptor en la factura ("' + receptorNombre + '") difiere del registrado en tu empresa ("' + userNombre + '"). CIF coincide.'
                    });
                }
            }
        }

        return { errors: errors, warnings: warnings, blocking: errors.length > 0 };
    }

    global.SetexCifValidator = {
        validateInvoiceCifs: validateInvoiceCifs,
        normalizeNif: normalizeNif,
        normalizeNombre: normalizeNombre,
        checkDigitCIF: checkDigitCIF
    };
})(typeof window !== 'undefined' ? window : this);
