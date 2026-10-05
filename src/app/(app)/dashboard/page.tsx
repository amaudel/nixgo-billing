import { StatusBadge } from "@/components/status-badge";
import { PageHeader, StatCard } from "@/components/ui";
import { getDashboardStats } from "@/lib/data/dashboard";
import { formatMoney } from "@/lib/data/format";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const stats = await getDashboardStats(supabase);
  const { byStatus } = stats;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Resumen de las empresas a las que tienes acceso" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Empresas activas" value={stats.active_organizations} />
        <StatCard label="Facturas hoy" value={stats.today_count} />
        <StatCard label="Facturas del mes" value={stats.month_count} />
        <StatCard label="Monto autorizado (mes)" value={formatMoney(stats.month_authorized_total)} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-700">Estado de las facturas del mes</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Autorizadas" value={byStatus.authorized} />
        <StatCard label="Pendientes" value={byStatus.pending + byStatus.processing} hint="Pendientes + procesando" />
        <StatCard label="Rechazadas" value={byStatus.rejected} />
        <StatCard label="Errores" value={byStatus.failed} />
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        Leyenda: <StatusBadge status="authorized" /> <StatusBadge status="processing" />{" "}
        <StatusBadge status="pending" /> <StatusBadge status="rejected" /> <StatusBadge status="failed" />
      </div>
    </>
  );
}
