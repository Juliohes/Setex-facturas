// Clase raíz de errores del backend. Todo error propio del dominio/infra
// hereda de AppError → el error-handler global puede distinguirlos de errores
// nativos (TypeError, SyntaxError...) para decidir status y payload.
'use strict';

class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

module.exports = { AppError };
