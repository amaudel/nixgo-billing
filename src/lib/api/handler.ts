import { ZodError } from "zod";
import { ApiError, errorResponse, logUnexpected } from "./errors";

const MAX_BODY_BYTES = 256 * 1024;

/** Envuelve un handler: todo error sale como { error: { code, message } } sin filtrar detalles internos. */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    if (error instanceof ZodError) return errorResponse(validationError(error));
    logUnexpected("unhandled", error);
    return errorResponse(new ApiError(500, "internal_error", "Error interno"));
  }
}

export function validationError(error: ZodError): ApiError {
  return new ApiError(
    422,
    "validation_error",
    "La petición no es válida",
    // Solo ruta y mensaje: nunca se devuelve el valor recibido.
    error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}

/** Lee y parsea el cuerpo JSON con un límite de tamaño (también sin Content-Length confiable). */
export async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Cuerpo demasiado grande");

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Cuerpo demasiado grande");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "El cuerpo no es JSON válido");
  }
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return Response.json(body, { status: init.status ?? 200, headers: init.headers });
}
