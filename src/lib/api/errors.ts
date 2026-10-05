import { redactSecrets } from "@/lib/security/sanitize";

/** Códigos estables de la API pública (ver docs/INTEGRATION.md). */
export type ApiErrorCode =
  | "invalid_json"
  | "invalid_webhook"
  | "payload_too_large"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "idempotency_key_required"
  | "idempotency_conflict"
  | "rate_limited"
  | "provider_not_configured"
  | "provider_not_implemented"
  | "provider_error"
  | "service_unavailable"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorResponse(error: ApiError): Response {
  return Response.json(
    { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
    { status: error.status, headers: error.headers },
  );
}

/** Registro de errores inesperados: sin cuerpo de la petición ni cabeceras, y con secretos ocultos. */
export function logUnexpected(scope: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api] ${scope}:`, redactSecrets(message));
}
