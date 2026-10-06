import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { handle, json } from "@/lib/api/handler";
import { presentInvoice } from "@/lib/invoices/presenter";
import { invoiceServiceDeps } from "@/lib/invoices/runtime";
import { getInvoice } from "@/lib/invoices/service";

export function GET(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]">) {
  return handle(async () => {
    const tenant = await authenticate(request, "invoices:read");

    // Un id mal formado responde igual que uno inexistente (404), sin pistas.
    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) throw new ApiError(404, "not_found", "Factura no encontrada");

    const invoice = await getInvoice(invoiceServiceDeps(), tenant, id.data);
    return json(presentInvoice(invoice), { headers: tenant.rateLimitHeaders });
  });
}
