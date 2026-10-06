import { z } from "zod";
import { authenticate } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { fileResponse } from "@/lib/api/file-response";
import { handle } from "@/lib/api/handler";
import { presentInvoice } from "@/lib/invoices/presenter";
import { invoiceServiceDeps } from "@/lib/invoices/runtime";
import { getInvoiceDocument } from "@/lib/invoices/service";

export function GET(request: Request, ctx: RouteContext<"/api/v1/invoices/[id]/ride">) {
  return handle(async () => {
    const tenant = await authenticate(request, "invoices:read");

    const id = z.uuid().safeParse((await ctx.params).id);
    if (!id.success) throw new ApiError(404, "not_found", "Factura no encontrada");

    const { file, invoice } = await getInvoiceDocument(invoiceServiceDeps(), tenant, id.data, "ride");
    return fileResponse(file, presentInvoice(invoice).number, "ride", tenant.rateLimitHeaders);
  });
}
