import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { handle, json, readJsonBody, validationError } from "@/lib/api/handler";
import { createInvoiceSchema, idempotencyKeySchema, listInvoicesQuerySchema } from "@/lib/invoices/schema";
import { presentInvoice, presentInvoiceSummary } from "@/lib/invoices/presenter";
import { invoiceServiceDeps } from "@/lib/invoices/runtime";
import { createInvoice, listInvoices } from "@/lib/invoices/service";

export function POST(request: Request) {
  return handle(async () => {
    const ctx = await authenticate(request, "invoices:write");

    const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key") ?? "");
    if (!key.success) {
      throw new ApiError(422, "idempotency_key_required", "Falta la cabecera Idempotency-Key (1–200 caracteres imprimibles)");
    }

    const parsed = createInvoiceSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw validationError(parsed.error);

    const { invoice, replayed } = await createInvoice(invoiceServiceDeps(), ctx, key.data, parsed.data);

    return json(presentInvoice(invoice), {
      // 202: la autorización del SRI es asíncrona. Un reintento idempotente responde 200.
      status: replayed ? 200 : 202,
      headers: { ...ctx.rateLimitHeaders, ...(replayed ? { "Idempotent-Replayed": "true" } : {}) },
    });
  });
}

export function GET(request: Request) {
  return handle(async () => {
    const ctx = await authenticate(request, "invoices:read");

    const url = new URL(request.url);
    const parsed = listInvoicesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) throw validationError(parsed.error);

    const { invoices, hasMore } = await listInvoices(invoiceServiceDeps(), ctx, parsed.data);
    return json(
      { data: invoices.map(presentInvoiceSummary), hasMore },
      { headers: ctx.rateLimitHeaders },
    );
  });
}
