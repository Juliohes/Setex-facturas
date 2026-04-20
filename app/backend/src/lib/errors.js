// Clases de error estandarizadas — todos los errores del backend heredan de AppError.
// Permite handler de error global que diferencie ValidationError (400),
// AuthError (401/403), NotFoundError (404), de errores genéricos (500).
'use strict';

class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, details);
  }
}

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

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
};
