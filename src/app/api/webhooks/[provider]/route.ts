import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { handle, json, readRawBody } from "@/lib/api/handler";
import { getBillingProvider } from "@/lib/billing/providers";
import { isSupabaseConfigured } from "@/lib/env";
import { createWebhookRepository } from "@/lib/webhooks/repository";
import { receiveWebhook } from "@/lib/webhooks/service";

const providerSchema = z.enum(["mock", "factuplan"]);

/**
 * Webhooks de proveedores. No usa API keys ni cookies: la autenticidad la da la FIRMA del
 * proveedor, verificada sobre el cuerpo crudo por su adaptador.
 */
export function POST(request: Request, ctx: RouteContext<"/api/webhooks/[provider]">) {
  return handle(async () => {
    const provider = providerSchema.safeParse((await ctx.params).provider);
    if (!provider.success) throw new ApiError(404, "not_found", "Proveedor desconocido");
    if (!isSupabaseConfigured()) throw new ApiError(503, "service_unavailable", "Servicio no disponible");

    const rawBody = await readRawBody(request);
    const { outcome } = await receiveWebhook(
      { repo: createWebhookRepository(), getProvider: getBillingProvider },
      provider.data,
      rawBody,
      request.headers,
    );
    return json({ received: true, outcome });
  });
}
