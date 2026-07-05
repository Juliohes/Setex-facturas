// Validación CIF emisor/receptor vs usuario logueado — vanilla JS.
// Espejo de app/backend/src/lib/invoice-cif-validator.js. Mantén sincronizados.
// Expone window.SetexCifValidator = { validateInvoiceCifs, normalizeNif, normalizeNombre }
(function (global) {
    'use strict';

    function normalizeNif(s) {
        return String(s || '')
            .toUpperCase()
            .replace(/[\s\-.]/g, '')
            .replace(/^ES/, '');
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
        normalizeNombre: normalizeNombre
    };
})(typeof window !== 'undefined' ? window : this);
