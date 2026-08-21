// ── Indicador de progreso orientativo durante el procesado de la factura ─────
// Barra parcial sobre .upload-area con frases rotativas. El % es una ESTIMACIÓN
// visual (el backend no emite eventos de progreso): avanza linealmente hasta
// 99% y solo llega a 100% cuando llega la respuesta real del servidor.
// Interruptor de seguridad: PROGRESO_HABILITADO = false → flujo idéntico al anterior.
'use strict';

var PROGRESO_HABILITADO = true;

// Fases orientativas. `hasta` = % límite de la fase.
var FASES = [
    { hasta: 15, frases: ['Subiendo tu factura…', 'Enviando la imagen…'] },
    { hasta: 70, frases: ['Leyendo los datos de la factura…', 'Reconociendo texto e importes…'] },
    { hasta: 90, frases: ['Verificando CIF e importes…', 'Comprobando la coherencia del IVA…'] },
    { hasta: 99, frases: ['Preparando la revisión…', 'Casi listo, puede tardar unos segundos más…'] }
];

// Núcleo puro (sin DOM) — testeable con node --test.
// opciones: { ahora: fn→ms, duracionTotal: ms para llegar a 99%, intervaloFrase: ms }
function crearNucleoProgreso(opciones) {
    opciones = opciones || {};
    var ahora = opciones.ahora || function () { return Date.now(); };
    var duracionTotal = opciones.duracionTotal || 45000;
    var intervaloFrase = opciones.intervaloFrase || 2500;
    var t0 = ahora();

    return {
        // Estado actual: { porcentaje (0-99), frase }. Nunca 100 sin completar().
        estado: function () {
            var transcurrido = Math.max(0, ahora() - t0);
            var pct = Math.min(99, Math.floor((transcurrido / duracionTotal) * 99));
            var fase = null;
            for (var i = 0; i < FASES.length; i++) {
                if (pct < FASES[i].hasta) { fase = FASES[i]; break; }
            }
            if (!fase) fase = FASES[FASES.length - 1];
            var idxFrase = Math.floor(transcurrido / intervaloFrase) % fase.frases.length;
            return { porcentaje: pct, frase: fase.frases[idxFrase] };
        },
        // Estado final real (respuesta recibida).
        completado: function () {
            return { porcentaje: 100, frase: '' };
        }
    };
}

// Capa DOM — solo existe en navegador.
if (typeof document !== 'undefined') {
    var _timerId = null;
    var _closeTimeoutId = null;
    var _nucleo = null;

    function _overlay() { return document.getElementById('progress-overlay'); }

    function _pintar() {
        if (!_nucleo) return;
        var overlay = _overlay();
        if (!overlay || overlay.hidden) return;
        var estado = _nucleo.estado();
        var fill = overlay.querySelector('.progress-bar-fill');
        var fraseEl = overlay.querySelector('.progress-frase');
        var box = overlay.querySelector('.progress-box');
        if (fill) fill.style.width = estado.porcentaje + '%';
        if (fraseEl) fraseEl.textContent = estado.frase;
        if (box) box.setAttribute('aria-valuenow', String(estado.porcentaje));
    }

    window.Progreso = {
        iniciar: function () {
            if (!PROGRESO_HABILITADO) return;
            var overlay = _overlay();
            if (!overlay) return;
            this._detenerTimers();
            _nucleo = crearNucleoProgreso();
            var fill = overlay.querySelector('.progress-bar-fill');
            if (fill) fill.style.width = '0%';
            overlay.hidden = false;
            _pintar();
            _timerId = setInterval(_pintar, 200);
        },
        finalizar: function () {
            if (!PROGRESO_HABILITADO) return;
            this._detenerTimers();
            var overlay = _overlay();
            if (!overlay || overlay.hidden) return;
            var fill = overlay.querySelector('.progress-bar-fill');
            var box = overlay.querySelector('.progress-box');
            if (fill) fill.style.width = '100%';           // 100% solo con respuesta real
            if (box) box.setAttribute('aria-valuenow', '100');
            var self = this;
            _closeTimeoutId = setTimeout(function () {
                overlay.hidden = true;                      // cierre ≤ 200 ms tras respuesta
                self._detenerTimers();
            }, 150);
        },
        abortar: function () {
            this._detenerTimers();
            var overlay = _overlay();
            if (overlay) overlay.hidden = true;             // cierre inmediato en error
        },
        _detenerTimers: function () {
            if (_timerId) { clearInterval(_timerId); _timerId = null; }
            if (_closeTimeoutId) { clearTimeout(_closeTimeoutId); _closeTimeoutId = null; }
        }
    };
}

// Export para tests (node --test). En navegador queda window.Progreso.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { crearNucleoProgreso: crearNucleoProgreso, FASES: FASES, PROGRESO_HABILITADO: PROGRESO_HABILITADO };
}
