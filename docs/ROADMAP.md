# Roadmap

## Fase 0 — Fundación ✅
Repo, Next.js + TS + Tailwind, estructura, Supabase preparado (migraciones + RLS), auth, dashboard/empresas/facturas (solo lectura), `BillingProvider`, `MockBillingProvider`, stub `FactuplanProvider`, documentación.

**Verificado:** migraciones y RLS con dos empresas se prueban en un Postgres plano con `supabase/tests/run.sh` (bootstrap que emula roles y `auth`; también corre en CI). **Pendiente:** repetirlo contra Supabase real (`supabase start`) antes de producción.

## Fase 1 — API y multi-tenancy operativo
- Alta de empresas, establecimientos, puntos de emisión y usuarios desde el panel.
- Gestión de API keys (crear/revocar, mostrar una vez).
- Middleware de API: auth por key, resolución de tenant, rate limiting, errores uniformes.
- `POST/GET /api/v1/invoices` con idempotencia, contra `MockBillingProvider`.
- Tests de aislamiento entre empresas (RLS + API).

## Fase 2 — Webhooks y ciclo de vida
- `POST /api/webhooks/factuplan`, `webhook_events`, reconciliación vía `getInvoice`.
- Detalle de factura (eventos, RIDE, XML) y configuración de empresa.

## Fase 3 — Factuplan real (sandbox)
- Completar `docs/FACTUPLAN.md` con la documentación oficial.
- Implementar `FactuplanProvider`; certificados por empresa (estrategia A); notas de crédito.
- Pruebas end-to-end en sandbox. Sin facturas reales hasta aprobación explícita.

## Fase 4 — Producción
- CSP con nonces, monitoreo, backups, alertas de expiración de certificados, métricas.

## Fase 5 — Opcional
- Segundo proveedor (Security Data) o integración directa con el SRI (`src/lib/tax/ecuador/`), con custodia propia de certificados (estrategia B).
