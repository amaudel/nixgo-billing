import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import {
  ProviderNotImplementedError,
  WebhookSignatureError,
  type BillingProvider,
} from "@/lib/billing/providers/types";
import { INVOICE_STATUSES, type ProviderName } from "@/lib/billing/types";
import { redactSecrets } from "@/lib/security/sanitize";

export type WebhookOutcome = "applied" | "unchanged" | "duplicate" | "ignored" | "not_found";

export interface WebhookRepository {
  /** Todo en una transacción: ver process_webhook_event en las migraciones. */
  processEvent(input: {
    provider: ProviderName;
    eventId: string;
    eventType: string;
    payload: unknown;
    providerDocumentId?: string;
    status?: (typeof INVOICE_STATUSES)[number];
    accessKey?: string;
    authorizationNumber?: string;
    authorizedAt?: string;
    rejectionReason?: string;
  }): Promise<WebhookOutcome>;
}

export interface WebhookDeps {
  repo: WebhookRepository;
  getProvider: (name: ProviderName) => BillingProvider;
}

/** Lo que exigimos de CUALQUIER proveedor tras verificar su firma (el contenido no es de fiar). */
const verifiedSchema = z.object({
  eventId: z.string().min(1).max(200),
  eventType: z.string().min(1).max(100),
  providerDocumentId: z.string().min(1).max(200).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  result: z
    .object({
      accessKey: z.string().min(1).max(100).optional(),
      authorizationNumber: z.string().min(1).max(100).optional(),
      authorizedAt: z.iso.datetime({ offset: true }).optional(),
      rejectionReason: z.string().min(1).max(1000).optional(),
    })
    .optional(),
});

/**
 * Recibe un webhook: verifica la firma sobre el cuerpo CRUDO, valida el contenido, sanitiza el
 * payload y lo procesa de forma idempotente. La empresa nunca se toma del cuerpo del webhook:
 * se deduce de la factura que referencia el documento del proveedor (dentro de la base de datos).
 */
export async function receiveWebhook(
  deps: WebhookDeps,
  name: ProviderName,
  rawBody: string,
  headers: Headers,
): Promise<{ outcome: WebhookOutcome }> {
  const provider = deps.getProvider(name);

  let verified;
  try {
    verified = await provider.verifyWebhook(rawBody, headers);
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      throw new ApiError(401, "unauthorized", "Firma inválida");
    }
    if (error instanceof ProviderNotImplementedError) {
      throw new ApiError(501, "provider_not_implemented", "El proveedor aún no está disponible");
    }
    if (error instanceof SyntaxError) {
      throw new ApiError(400, "invalid_webhook", "El cuerpo no es JSON válido");
    }
    throw error;
  }

  const parsed = verifiedSchema.safeParse(verified);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_webhook", "El evento no tiene el formato esperado");
  }
  const event = parsed.data;

  const outcome = await deps.repo.processEvent({
    provider: name,
    eventId: event.eventId,
    eventType: event.eventType,
    // Regla de seguridad: nada se guarda sin pasar por redactSecrets().
    payload: redactSecrets(verified.payload),
    providerDocumentId: event.providerDocumentId,
    status: event.status,
    accessKey: event.result?.accessKey,
    authorizationNumber: event.result?.authorizationNumber,
    authorizedAt: event.result?.authorizedAt,
    rejectionReason: event.result?.rejectionReason,
  });

  // El proveedor reintentará: puede que el aviso haya llegado antes de que guardáramos el id.
  if (outcome === "not_found") {
    throw new ApiError(404, "not_found", "Documento no encontrado (se espera un reintento)");
  }
  return { outcome };
}
