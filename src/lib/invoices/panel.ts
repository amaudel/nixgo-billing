import "server-only";
import { z } from "zod";
import { INVOICE_STATUSES } from "@/lib/billing/types";
import { createClient } from "@/lib/supabase/server";

type SessionClient = Awaited<ReturnType<typeof createClient>>;

const invoiceRow = z.object({
  id: z.string(),
  organization_id: z.string(),
  establishment_id: z.string(),
  emission_point_id: z.string(),
  customer_id: z.string(),
  sequential: z.number().nullable(),
  issue_date: z.string(),
  status: z.enum(INVOICE_STATUSES),
  environment: z.enum(["test", "production"]),
  provider: z.enum(["mock", "factuplan"]).nullable(),
  provider_document_id: z.string().nullable(),
  currency: z.string(),
  subtotal: z.number(),
  discount: z.number(),
  tax: z.number(),
  total: z.number(),
  access_key: z.string().nullable(),
  sri_authorization_number: z.string().nullable(),
  sri_authorized_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  external_reference: z.string().nullable(),
  source_application: z.string().nullable(),
  created_at: z.string(),
});

/**
 * Factura + datos relacionados leídos con la SESIÓN del usuario: RLS decide qué ve. Consultas
 * separadas (sin embebidos) para no depender de cómo resuelva PostgREST las FK compuestas.
 * Devuelve null si no existe o el usuario no tiene acceso.
 */
export async function loadInvoiceForPanel(supabase: SessionClient, invoiceId: string) {
  const { data } = await supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!data) return null;
  const invoice = invoiceRow.parse(data);

  const [est, point, customer, org] = await Promise.all([
    supabase.from("establishments").select("code").eq("id", invoice.establishment_id).eq("organization_id", invoice.organization_id).maybeSingle(),
    supabase.from("emission_points").select("code").eq("id", invoice.emission_point_id).eq("organization_id", invoice.organization_id).maybeSingle(),
    supabase
      .from("customers")
      .select("identification_type, identification, legal_name, email")
      .eq("id", invoice.customer_id)
      .eq("organization_id", invoice.organization_id)
      .maybeSingle(),
    supabase.from("organizations").select("ruc, legal_name, trade_name").eq("id", invoice.organization_id).maybeSingle(),
  ]);

  return {
    invoice,
    establishmentCode: (est.data as { code: string } | null)?.code ?? null,
    emissionPointCode: (point.data as { code: string } | null)?.code ?? null,
    customer: customer.data as { identification_type: string; identification: string; legal_name: string; email: string | null } | null,
    organization: org.data as { ruc: string; legal_name: string; trade_name: string | null } | null,
  };
}
