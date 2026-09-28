/**
 * Shared error taxonomy mapped to stable HTTP responses.
 * See design "Error Handling" section.
 */

export type ErrorCode =
  | "AuthenticationError"
  | "AuthorizationError"
  | "ValidationError"
  | "ConflictError"
  | "PersistenceError"
  | "NotFoundError"
  | "ModuleUnavailableError";

const HTTP_STATUS: Record<ErrorCode, number> = {
  AuthenticationError: 401,
  AuthorizationError: 403,
  ValidationError: 422,
  ConflictError: 409,
  PersistenceError: 500,
  NotFoundError: 404,
  ModuleUnavailableError: 404,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, field?: string) {
    super(message);
    this.name = code;
    this.code = code;
    this.field = field;
    this.httpStatus = HTTP_STATUS[code];
  }

  /** Structured body returned to clients: { code, message, field? }. */
  toBody(): { code: ErrorCode; message: string; field?: string } {
    return this.field
      ? { code: this.code, message: this.message, field: this.field }
      : { code: this.code, message: this.message };
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Authentication required") {
    super("AuthenticationError", message);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Action is not permitted") {
    super("AuthorizationError", message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super("ValidationError", message, field);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, field?: string) {
    super("ConflictError", message, field);
  }
}

export class PersistenceError extends AppError {
  constructor(message = "Persistence failed") {
    super("PersistenceError", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NotFoundError", message);
  }
}

export class ModuleUnavailableError extends AppError {
  constructor(moduleKey: string) {
    super("ModuleUnavailableError", `Module '${moduleKey}' is not available`);
  }
}
