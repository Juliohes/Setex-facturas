// Re-export del async-handler ubicado en lib/. Algunos middleware/routes prefieren
// importarlo desde middleware/ por proximidad conceptual.
'use strict';

const { asyncHandler } = require('../lib/async-handler');

module.exports = { asyncHandler };
