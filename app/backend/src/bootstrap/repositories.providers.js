// Registra los 10 repositorios en el container. Todos siguen el patrón
// class { constructor(pool) }, por lo que usamos asClass(...).classic() para
// que Awilix inyecte `pool` por argumento posicional.
'use strict';

const { asClass, Lifetime } = require('awilix');

const UsersRepository = require('../repositories/users.repo');
const UploadsRepository = require('../repositories/uploads.repo');
const ClientCompaniesRepository = require('../repositories/client-companies.repo');
const AuditRepository = require('../repositories/audit.repo');
const AuthTokensRepository = require('../repositories/auth-tokens.repo');
const KnownCifsRepository = require('../repositories/known-cifs.repo');
const CompanyCatalogRepository = require('../repositories/company-catalog.repo');
const CompanyAuditLogRepository = require('../repositories/company-audit-log.repo');
const FailedJobsRepository = require('../repositories/failed-jobs.repo');

function registerRepositories(container) {
  container.register({
    usersRepo: asClass(UsersRepository, { lifetime: Lifetime.SINGLETON }).classic(),
    uploadsRepo: asClass(UploadsRepository, { lifetime: Lifetime.SINGLETON }).classic(),
    clientCompaniesRepo: asClass(ClientCompaniesRepository, { lifetime: Lifetime.SINGLETON }).classic(),
    auditRepo: asClass(AuditRepository, { lifetime: Lifetime.SINGLETON }).classic(),
    authTokensRepo: asClass(AuthTokensRepository, { lifetime: Lifetime.SINGLETON }).classic(),
    knownCifsRepo: asClass(KnownCifsRepository, { lifetime: Lifetime.SINGLETON }).classic(),
    companyCatalogRepo: asClass(CompanyCatalogRepository, { lifetime: Lifetime.SINGLETON }).classic(),
    companyAuditLogRepo: asClass(CompanyAuditLogRepository, { lifetime: Lifetime.SINGLETON }).classic(),
    failedJobsRepo: asClass(FailedJobsRepository, { lifetime: Lifetime.SINGLETON }).classic(),
  });
}

module.exports = { registerRepositories };
