// SHIM — retrocompatibilidad durante Strangler-Fig refactor
// Re-exporta desde la nueva ubicación domain/validators/nif.js
// Tras completar refactor (paso 22), eliminar este shim.
module.exports = require('../domain/validators/nif');
