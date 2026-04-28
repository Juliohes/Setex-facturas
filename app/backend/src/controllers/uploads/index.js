// Barrel de uploads controllers.
'use strict';

const { makePreviewController } = require('./preview.controller');
const { makeConfirmController } = require('./confirm.controller');
const { makeListMineController } = require('./list-mine.controller');
const { makeImageController } = require('./image.controller');
const { makeProveedorController } = require('./proveedor.controller');
const { makeExportXlsxController } = require('./export-xlsx.controller');

module.exports = {
  makePreviewController,
  makeConfirmController,
  makeListMineController,
  makeImageController,
  makeProveedorController,
  makeExportXlsxController,
};
