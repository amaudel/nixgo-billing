import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { fileResponse } from "@/lib/api/file-response";
import { handle } from "@/lib/api/handler";
import { formatInvoiceNumber } from "@/lib/data/format";
import { loadInvoiceForPanel } from "@/lib/invoices/panel";
import { invoiceServiceDeps } from "@/lib/invoices/runtime";
import { downloadDocument } from "@/lib/invoices/service";
import { createClient } from "@/lib/supabase/server";

const kindSchema = z.enum(["ride", "xml"]);

/** Descarga desde el panel: la sesión del usuario (y RLS) decide si puede ver la factura. */
export function GET(_request: Request, ctx: RouteContext<"/invoices/[id]/[kind]">) {
  return handle(async () => {
    const params = await ctx.params;
    const id = z.uuid().safeParse(params.id);
    const kind = kindSchema.safeParse(params.kind);
    if (!id.success || !kind.success) throw new ApiError(404, "not_found", "No encontrado");

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new ApiError(401, "unauthorized", "Inicia sesión");

    const found = await loadInvoiceForPanel(supabase, id.data);
    if (!found || !found.organization) throw new ApiError(404, "not_found", "Factura no encontrada");
    const { invoice, organization } = found;

    const file = await downloadDocument(
      invoiceServiceDeps(),
      { organizationId: invoice.organization_id, ruc: organization.ruc, environment: invoice.environment },
      { status: invoice.status, provider: invoice.provider, providerDocumentId: invoice.provider_document_id },
      kind.data,
    );
    const number = formatInvoiceNumber(found.establishmentCode, found.emissionPointCode, invoice.sequential);
    return fileResponse(file, number === "—" ? null : number, kind.data);
  });
}
