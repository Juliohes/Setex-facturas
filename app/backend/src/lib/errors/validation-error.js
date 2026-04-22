// Error de validación con detalle estructurado compatible con Zod:
// details = array de { path: string[], message: string, code?: string }
// El middleware validate.js convierte ZodError → ValidationError.
'use strict';

const { AppError } = require('./app-error');

class ValidationError extends AppError {
  constructor(message = 'Validación fallida', details = null) {
    super(message, 400, details);
  }

  static fromZod(zodError) {
    const details = zodError.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
      code: issue.code,
    }));
    return new ValidationError('Validación fallida', details);
  }
}

module.exports = { ValidationError };
