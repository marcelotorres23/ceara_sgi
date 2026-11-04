/**
 * Erros de dominio. Mensagens em pt-BR (chegam ao usuario), codigos em ingles.
 * Erro sempre diz o que fazer, conforme tom de voz da secao 4.5.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly detalhe?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sessao expirada. Entre novamente para continuar.') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Seu perfil nao permite esta acao.') {
    super(403, 'FORBIDDEN', message);
  }
}

/** Violacao de segregacao de funcoes - sempre auditada com severidade SOD_VIOLATION. */
export class SodViolationError extends AppError {
  constructor(
    message: string,
    readonly regra: string,
  ) {
    super(403, 'SOD_VIOLATION', message, { regra });
  }
}

export class NotFoundError extends AppError {
  constructor(recurso: string) {
    super(404, 'NOT_FOUND', `${recurso} nao encontrado.`);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, detalhe?: unknown) {
    super(400, 'VALIDATION_ERROR', message, detalhe);
  }
}

/** Transicao de estado invalida. Nunca silenciosa - 422, conforme secao 6.2. */
export class InvalidTransitionError extends AppError {
  constructor(de: string, para: string) {
    super(422, 'INVALID_TRANSITION', `Transicao de ${de} para ${para} nao e permitida.`, { de, para });
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}
