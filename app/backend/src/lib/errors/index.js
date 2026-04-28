// Barrel de errores del backend. Los consumidores importan desde aquí:
//   const { AppError, ValidationError, NotFoundError } = require('../../lib/errors');
'use strict';

const { AppError } = require('./app-error');
const { ValidationError } = require('./validation-error');
const {
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  UnprocessableEntityError,
  BadGatewayError,
  ServiceUnavailableError,
} = require('./http-error');

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  UnprocessableEntityError,
  BadGatewayError,
  ServiceUnavailableError,
};
