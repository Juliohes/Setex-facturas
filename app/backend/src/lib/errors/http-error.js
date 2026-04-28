// Errores HTTP con statusCode preasignado. Todos derivan de AppError para que
// el error-handler global pueda serializar respuestas sin leak de stack trace.
'use strict';

const { AppError } = require('./app-error');

class AuthError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, 401);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Prohibido') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 404);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflicto de recurso', details = null) {
    super(message, 409, details);
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Demasiadas peticiones', retryAfter = 60) {
    super(message, 429, { retryAfter });
  }
}

class UnprocessableEntityError extends AppError {
  constructor(message = 'Entidad no procesable', details = null) {
    super(message, 422, details);
  }
}

class BadGatewayError extends AppError {
  constructor(message = 'Error en servicio externo', details = null) {
    super(message, 502, details);
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Servicio no disponible', details = null) {
    super(message, 503, details);
  }
}

module.exports = {
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  UnprocessableEntityError,
  BadGatewayError,
  ServiceUnavailableError,
};
