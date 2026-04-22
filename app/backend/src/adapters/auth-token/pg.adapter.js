// Adapter PostgreSQL de AuthTokenPort. Wrappea el AuthTokensRepository
// (Round 6) para cumplir la forma del port. Permite que services usen el
// port como abstracción limpia, y que tests inyecten un adapter in-memory.
'use strict';

const { assertAuthTokenPort } = require('../../ports/auth-token.port');

function createPgAuthTokenAdapter({ authTokensRepo, logger } = {}) {
  if (!authTokensRepo) throw new Error('auth-token pg.adapter: "authTokensRepo" required');

  const adapter = {
    name: 'pg-auth-token',
    saveRefreshToken: (rec) => authTokensRepo.saveRefreshToken(rec),
    findRefreshToken: (id) => authTokensRepo.findRefreshToken(id),
    rotateRefreshToken: (id, replacedBy) =>
      authTokensRepo.rotateRefreshToken({
        oldHash: id,
        newHash: replacedBy,
        familyId: null,
        userId: null,
        expiresAt: null,
      }),
    revokeAllRefreshTokens: (userId) => authTokensRepo.revokeAllForUser(userId),
    savePasswordResetToken: (rec) => authTokensRepo.savePasswordResetToken(rec),
    findPasswordResetToken: (hash) => authTokensRepo.findPasswordResetToken(hash),
    consumePasswordResetToken: (hash) => authTokensRepo.consumePasswordResetToken(hash),
  };

  return assertAuthTokenPort(adapter);
}

module.exports = { createPgAuthTokenAdapter };
