// Uploads routes. Monta los 6 endpoints de facturas del usuario:
//   POST /api/upload-preview            preview + OCR (requiere empresa activa)
//   POST /api/upload-confirm            confirma preview + persiste (rate-limit)
//   GET  /api/mis-facturas              últimas facturas del user
//   GET  /api/facturas/:id/imagen       imagen original (guard owner)
//   GET  /api/mis-facturas/export.xlsx  export Excel
//   GET  /api/proveedor/:nif            lookup contraparte
'use strict';

const express = require('express');
const { asyncHandler } = require('../lib/async-handler');

function makeUploadsRoutes({
  previewController,
  confirmController,
  listMineController,
  imageController,
  proveedorController,
  exportXlsxController,
  authenticate,
  requireActiveCompany,
  uploadLimiter,
  confirmLimiter,
  fileUploader,
} = {}) {
  if (!previewController || !confirmController) {
    throw new Error('uploads.routes: controllers de preview/confirm requeridos');
  }

  const router = express.Router();
  const apply = (mw) => (mw ? [mw] : []);

  router.post(
    '/upload-preview',
    ...apply(authenticate),
    ...apply(requireActiveCompany),
    ...apply(uploadLimiter),
    ...apply(fileUploader),
    asyncHandler(previewController)
  );

  router.post(
    '/upload-confirm',
    ...apply(authenticate),
    ...apply(requireActiveCompany),
    ...apply(confirmLimiter),
    asyncHandler(confirmController)
  );

  router.get(
    '/mis-facturas',
    ...apply(authenticate),
    ...apply(requireActiveCompany),
    asyncHandler(listMineController)
  );

  router.get(
    '/mis-facturas/export.xlsx',
    ...apply(authenticate),
    ...apply(requireActiveCompany),
    asyncHandler(exportXlsxController)
  );

  router.get(
    '/facturas/:id/imagen',
    ...apply(authenticate),
    ...apply(requireActiveCompany),
    asyncHandler(imageController)
  );

  router.get(
    '/proveedor/:nif',
    ...apply(authenticate),
    ...apply(requireActiveCompany),
    ...apply(confirmLimiter),
    asyncHandler(proveedorController)
  );

  return router;
}

module.exports = { makeUploadsRoutes };
