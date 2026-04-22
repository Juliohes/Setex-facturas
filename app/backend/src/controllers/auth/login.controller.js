// Login controller. Thin: valida DTO (Zod en middleware) → invoca servicios →
// serializa DTO. Fiel al comportamiento de server.js líneas ~1040-1134:
//   1. Busca usuario por email
//   2. Compara bcrypt password
//   3. Si no admin, verifica empresa activa/no-pendiente
//   4. Emite access token + refresh token (cookie httpOnly)
//   5. Audit log + rate-limit
'use strict';

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

function setRefreshCookie(res, token, expiresAt) {
  res.cookie('rt', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    expires: expiresAt,
    path: '/api/auth',
  });
}

function makeLoginController({
  usersRepo,
  clientCompaniesRepo,
  refreshTokenService,
  auditService,
  jwtSecret,
  logger,
} = {}) {
  if (!usersRepo || !refreshTokenService || !jwtSecret) {
    throw new Error('login.controller: deps requeridas faltantes');
  }

  return async function loginController(req, res) {
    const { email, password } = req.body; // validado por Zod loginSchema
    const ip = req.ip;

    const user = await usersRepo.findByEmail(email);
    if (!user) {
      await auditService?.log?.({ action: 'LOGIN_FAILED', details: { email, reason: 'user_not_found' }, ip });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await auditService?.log?.({ action: 'LOGIN_FAILED', details: { email, reason: 'bad_password' }, userId: user.id, ip });
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (user.company_nif && !user.is_admin && clientCompaniesRepo?.findByCif) {
      const cleanNif = String(user.company_nif).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const company = await clientCompaniesRepo.findByCif(cleanNif);
      if (!company) {
        await auditService?.log?.({ action: 'LOGIN_BLOCKED', details: { email, reason: 'company_not_found', company_nif: user.company_nif }, userId: user.id, ip });
        return res.status(403).json({
          error: `El CIF ${user.company_nif} asociado a tu cuenta no coincide con ninguna empresa registrada en SETEX. Revisa que tu CIF sea correcto en tu perfil, o contacta con el administrador.`,
        });
      }
      if (company.pendiente && !company.activa) {
        await auditService?.log?.({ action: 'LOGIN_BLOCKED', details: { email, reason: 'company_pending', company_nif: user.company_nif }, userId: user.id, ip });
        return res.status(403).json({ error: 'Tu empresa está pendiente de revisión por SETEX. Recibirás acceso una vez que sea aprobada por un administrador.' });
      }
      if (!company.activa) {
        await auditService?.log?.({ action: 'LOGIN_BLOCKED', details: { email, reason: 'company_deactivated', company_nif: user.company_nif }, userId: user.id, ip });
        return res.status(403).json({ error: 'El acceso de tu empresa ha sido desactivado. Contacta al administrador de SETEX.' });
      }
    }

    const atPayload = {
      userId: user.id,
      email: user.email,
      is_admin: user.is_admin === true,
      token_version: user.token_version || 1,
    };
    const accessToken = jwt.sign(atPayload, jwtSecret, { expiresIn: '15m' });

    const { token: refreshToken, expiresAt } = await refreshTokenService.issue({
      userId: user.id,
      email: user.email,
    });
    setRefreshCookie(res, refreshToken, expiresAt);

    await auditService?.log?.({ action: 'LOGIN_SUCCESS', details: { email }, userId: user.id, ip });

    res.json({
      accessToken,
      expiresIn: 900,
      user: { id: user.id, email: user.email, is_admin: user.is_admin === true },
    });
  };
}

module.exports = { makeLoginController };
