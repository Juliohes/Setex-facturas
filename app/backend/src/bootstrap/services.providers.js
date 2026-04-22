// Registra los services como factories DI. Cada service recibe las deps que
// declara en su destructuring ({ pool, usersRepo, ... }).
'use strict';

const { asFunction, asValue, Lifetime } = require('awilix');

const { createAuditLogger } = require('../services/audit/audit.service');
const { makeTokenVerificationService } = require('../services/auth/token-verification.service');
const { makeRefreshTokenService } = require('../services/auth/refresh-token.service');
const { makePasswordResetTokenService } = require('../services/auth/password-reset-token.service');
const { makeDeduplicationService } = require('../services/invoices/deduplication.service');
const { makeCounterpartyResolverService } = require('../services/invoices/counterparty-resolver.service');
const { makeInvoicePersistService } = require('../services/invoices/invoice-persist.service');
const { makeOcrOrchestrationService } = require('../services/invoices/ocr-orchestration.service');
const { createOcrEngines, pickPrimary } = require('../factories/ocr-engine.factory');
const { createMailPort } = require('../factories/email-transport.factory');
const { makePasswordResetEmailService } = require('../services/email/password-reset.service');
const { makeApprovalNotificationService } = require('../services/email/approval-notification.service');
const { makeIpListManagerService } = require('../services/security/ip-list-manager.service');
const { makeAutoBlockService } = require('../services/security/auto-block.service');
const { validateVIES } = require('../services/viesValidator');

async function registerServices(container) {
  // OCR engines array se construye una vez con features actuales.
  const features = container.resolve('features');
  const readSecret = container.resolve('readSecret');
  const logger = container.resolve('logger');
  const ocrEngines = createOcrEngines({ features, readSecret, logger });

  container.register({
    // audit — el service existente espera { pool }
    auditService: asFunction(({ pool }) => createAuditLogger({ pool }))
      .singleton(),

    // auth
    tokenVerificationService: asFunction(makeTokenVerificationService).singleton(),
    refreshTokenService: asFunction(makeRefreshTokenService).singleton(),
    passwordResetTokenService: asFunction(makePasswordResetTokenService).singleton(),

    // invoices
    deduplicationService: asFunction(makeDeduplicationService).singleton(),
    counterpartyResolver: asFunction(makeCounterpartyResolverService).singleton(),
    invoicePersistService: asFunction(makeInvoicePersistService).singleton(),

    // ocr
    ocrEngines: asValue(ocrEngines),
    ocrPrimary: asValue(pickPrimary(ocrEngines, features)),
    ocrOrchestration: asFunction(({ features: f, logger: l }) =>
      makeOcrOrchestrationService({ engines: ocrEngines, features: f, logger: l })
    ).singleton(),

    // mail
    mail: asFunction(async ({ logger: l, env }) =>
      createMailPort({ logger: l, defaultFrom: env.SMTP_FROM || env.SMTP_USER })
    ).singleton(),
    passwordResetEmailService: asFunction(({ mail, env, logger: l }) =>
      makePasswordResetEmailService({
        mail,
        baseUrl: env.APP_BASE_URL || 'https://setex-facturas.es',
        defaultFrom: env.SMTP_FROM || env.SMTP_USER,
        logger: l,
      })
    ).singleton(),
    approvalNotificationService: asFunction(({ mail, env, logger: l }) =>
      makeApprovalNotificationService({
        mail,
        baseUrl: env.APP_BASE_URL || 'https://setex-facturas.es',
        defaultFrom: env.SMTP_FROM || env.SMTP_USER,
        logger: l,
      })
    ).singleton(),

    // security
    ipListManager: asFunction(({ logger: l }) =>
      makeIpListManagerService({ configPath: '/app/src/config/security.json', logger: l })
    ).singleton(),
    loadSecurityConfig: asFunction(({ ipListManager }) => () => ipListManager.load()).singleton(),
    autoBlockService: asFunction(({ cache, logger: l }) =>
      makeAutoBlockService({ cache, logger: l })
    ).singleton(),

    // vies
    viesValidator: asValue({ validate: validateVIES }),

    // admin email provider (lista de admins para approval-notification)
    adminEmailsProvider: asFunction(({ usersRepo }) => async () => {
      if (!usersRepo?.listAdmins) return [];
      const admins = await usersRepo.listAdmins().catch(() => []);
      return admins.map((a) => a.email).filter(Boolean);
    }).singleton(),

    // ── Deps opcionales registradas como null para satisfacer Awilix PROXY ──
    // Controllers que las listan en su destructuring con default esperan que el
    // container las resuelva aunque no estén activas. Round 16+ reemplazará
    // con implementaciones reales (p.ej. excelService real para exportar XLSX).
    excelService: asValue(null),
    fileUploader: asValue(null),
    authLimiter: asValue(null),
    uploadLimiter: asValue(null),
    confirmLimiter: asValue(null),
    refreshLimiter: asValue(null),
    viesLimiter: asValue(null),
  });
}

module.exports = { registerServices };
