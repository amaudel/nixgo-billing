import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { INVOICE_STATUSES } from "@/lib/billing/types";
import { monthStartInEcuador, todayInEcuador } from "./format";

const statsSchema = z.object({
  active_organizations: z.number(),
  today_count: z.number(),
  month_count: z.number(),
  month_authorized_total: z.number(),
  month_by_status: z.record(z.string(), z.number()),
});

export async function getDashboardStats(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("dashboard_stats", {
    p_today: todayInEcuador(),
    p_month_start: monthStartInEcuador(),
  });
  if (error) throw new Error(`dashboard_stats: ${error.message}`);
  const stats = statsSchema.parse(data);
  const byStatus = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, stats.month_by_status[s] ?? 0]));
  return { ...stats, byStatus: byStatus as Record<(typeof INVOICE_STATUSES)[number], number> };
}

const overviewSchema = z.array(
  z.object({
    id: z.string(),
    ruc: z.string(),
    legal_name: z.string(),
    trade_name: z.string().nullable(),
    status: z.enum(["active", "suspended", "inactive"]),
    environment: z.enum(["test", "production"]),
    provider: z.enum(["mock", "factuplan"]).nullable(),
    invoices_month: z.number(),
  }),
);

export async function getOrganizationOverview(supabase: SupabaseClient) {
  const { data, error } = await supabase.rpc("organization_overview", {
    p_month_start: monthStartInEcuador(),
  });
  if (error) throw new Error(`organization_overview: ${error.message}`);
  return overviewSchema.parse(data);
}
