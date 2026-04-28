// Register controller. Crea usuario con password hashed + asigna empresa cliente.
// Si el CIF no está catalogado → crea registro pendiente y notifica a admins.
'use strict';

const bcrypt = require('bcrypt');

function makeRegisterController({
  usersRepo,
  clientCompaniesRepo,
  approvalNotificationService,
  auditService,
  logger,
  adminEmailsProvider,
} = {}) {
  if (!usersRepo) throw new Error('register.controller: "usersRepo" required');

  return async function registerController(req, res) {
    const { email, password, company_nif, company_name } = req.body; // validated Zod
    const ip = req.ip;

    const existing = await usersRepo.findByEmail(email);
    if (existing) {
      await auditService?.log?.({ action: 'REGISTER_FAILED', details: { email, reason: 'email_taken' }, ip });
      return res.status(409).json({ error: 'Ya existe una cuenta con este email' });
    }

    const cleanNif = String(company_nif).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await usersRepo.create({
      email,
      passwordHash,
      companyName: company_name,
      companyNif: cleanNif,
      isAdmin: false,
    });

    let pendingCompany = null;
    if (clientCompaniesRepo?.findByCif && clientCompaniesRepo?.createPending) {
      const existingCompany = await clientCompaniesRepo.findByCif(cleanNif);
      if (!existingCompany) {
        pendingCompany = await clientCompaniesRepo.createPending({
          nombre: company_name,
          cif: cleanNif,
          requestedByEmail: email,
        });
      }
    }

    if (pendingCompany && approvalNotificationService) {
      const adminEmails = (await adminEmailsProvider?.()) || [];
      await approvalNotificationService.notifyPending({
        adminEmails,
        pendingCompany,
        requestedByEmail: email,
      }).catch((err) => logger?.warn?.('approval notification failed', { message: err.message }));
    }

    await auditService?.log?.({
      action: 'REGISTER_SUCCESS',
      details: { email, company_nif: cleanNif, pending: !!pendingCompany },
      userId: user.id,
      ip,
    });

    res.status(201).json({
      user: { id: user.id, email: user.email },
      pending: !!pendingCompany,
      message: pendingCompany
        ? 'Registro completado. Tu empresa está pendiente de aprobación por un administrador.'
        : 'Registro completado. Ya puedes iniciar sesión.',
    });
  };
}

module.exports = { makeRegisterController };
