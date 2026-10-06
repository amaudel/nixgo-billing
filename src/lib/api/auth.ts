import "server-only";
import { z } from "zod";
import type { BillingEnvironment } from "@/lib/billing/types";
import { hashApiKey, parseBearerApiKey } from "@/lib/security/api-keys";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/env";
import { ApiError, logUnexpected } from "./errors";
import { apiRateLimiter } from "./rate-limit";

export type ApiScope = "invoices:read" | "invoices:write";

/** Identidad ya resuelta de una petición autenticada con API key. */
export interface ApiContext {
  organizationId: string;
  ruc: string;
  apiKeyId: string;
  applicationName: string;
  environment: BillingEnvironment;
  scopes: string[];
  /** Cabeceras de límite de peticiones para añadir a la respuesta. */
  rateLimitHeaders: Record<string, string>;
}

const rowSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  application_name: z.string(),
  environment: z.enum(["test", "production"]),
  scopes: z.array(z.string()),
  status: z.enum(["active", "revoked"]),
  last_used_at: z.string().nullable(),
  organizations: z.object({
    ruc: z.string(),
    status: z.enum(["active", "suspended", "inactive"]),
  }),
});

const LAST_USED_INTERVAL_MS = 60_000;

/** nb_test_… → test; nb_live_… → production. */
function environmentOfKey(key: string): BillingEnvironment {
  return key.startsWith("nb_live_") ? "production" : "test";
}

/**
 * Autentica la petición por API key y resuelve organización + ambiente.
 * Mensajes deliberadamente genéricos: no revelan si una clave existe, está revocada o a qué
 * empresa pertenece.
 */
export async function authenticate(request: Request, requiredScope: ApiScope): Promise<ApiContext> {
  if (!isSupabaseConfigured()) {
    throw new ApiError(503, "service_unavailable", "Servicio no disponible");
  }
  const key = parseBearerApiKey(request.headers.get("authorization"));
  if (!key) throw new ApiError(401, "unauthorized", "API key ausente o inválida");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("api_keys")
    .select("id, organization_id, application_name, environment, scopes, status, last_used_at, organizations!inner(ruc, status)")
    .eq("key_hash", hashApiKey(key))
    .maybeSingle();
  if (error) throw new Error(`api_keys: ${error.message}`);

  const parsed = rowSchema.safeParse(data);
  if (!parsed.success || parsed.data.status !== "active" || parsed.data.environment !== environmentOfKey(key)) {
    throw new ApiError(401, "unauthorized", "API key ausente o inválida");
  }
  const row = parsed.data;

  if (row.organizations.status !== "active") {
    throw new ApiError(403, "forbidden", "La empresa no está activa");
  }
  if (!row.scopes.includes(requiredScope)) {
    throw new ApiError(403, "forbidden", "La API key no tiene permiso para esta operación");
  }

  const limit = apiRateLimiter.check(row.id);
  const rateLimitHeaders = {
    "X-RateLimit-Limit": String(limit.limit),
    "X-RateLimit-Remaining": String(limit.remaining),
  };
  if (!limit.allowed) {
    throw new ApiError(429, "rate_limited", "Demasiadas peticiones", undefined, {
      ...rateLimitHeaders,
      "Retry-After": String(limit.retryAfter),
    });
  }

  // Mejor esfuerzo y como mucho una vez por minuto: nunca debe romper la petición.
  const lastUsed = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (Date.now() - lastUsed > LAST_USED_INTERVAL_MS) {
    const { error: touchError } = await admin
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("organization_id", row.organization_id);
    if (touchError) logUnexpected("api_keys.last_used_at", touchError);
  }

  return {
    organizationId: row.organization_id,
    ruc: row.organizations.ruc,
    apiKeyId: row.id,
    applicationName: row.application_name,
    environment: row.environment,
    scopes: row.scopes,
    rateLimitHeaders,
  };
}
