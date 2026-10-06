import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { handle, json, validationError } from "@/lib/api/handler";
import { getBillingProvider } from "@/lib/billing/providers";
import { isSupabaseConfigured } from "@/lib/env";
import { createInvoiceRepository } from "@/lib/invoices/repository";
import { reconcileStaleInvoices } from "@/lib/invoices/reconcile";

const querySchema = z.object({
  olderThanMinutes: z.coerce.number().int().min(0).max(10_080).default(10),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Comparación en tiempo constante (se comparan hashes para igualar longitudes). */
function secretMatches(received: string, expected: string): boolean {
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Trabajo de sistema (cron): reconcilia facturas atascadas en 'processing'.
 * Protegido con CRON_SECRET (`Authorization: Bearer …`, el formato que usa Vercel Cron).
 * Sin secreto configurado (o demasiado corto) el endpoint queda cerrado.
 */
async function run(request: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET ?? "";
    if (secret.length < 16) throw new ApiError(503, "service_unavailable", "Reconciliación no configurada");
    const received = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
    if (!secretMatches(received, secret)) throw new ApiError(401, "unauthorized", "No autorizado");
    if (!isSupabaseConfigured()) throw new ApiError(503, "service_unavailable", "Servicio no disponible");

    const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw validationError(query.error);

    const summary = await reconcileStaleInvoices(
      { repo: createInvoiceRepository(), getProvider: getBillingProvider },
      query.data,
    );
    return json(summary);
  });
}

export const GET = run;
export const POST = run;
