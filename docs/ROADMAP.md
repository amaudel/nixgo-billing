# Roadmap

## Fase 0 — Fundación ✅
Repo, Next.js + TS + Tailwind, estructura, Supabase preparado (migraciones + RLS), auth, dashboard/empresas/facturas (solo lectura), `BillingProvider`, `MockBillingProvider`, stub `FactuplanProvider`, documentación.

**Verificado:** migraciones y RLS con dos empresas se prueban en un Postgres plano con `supabase/tests/run.sh` (bootstrap que emula roles y `auth`; también corre en CI). **Pendiente:** repetirlo contra Supabase real (`supabase start`) antes de producción.

## Fase 1 — API y multi-tenancy operativo (en curso)
- [x] Gestión de API keys en el panel (crear/revocar, mostrar una vez) — `/api-keys`.
- [x] Auth por key, resolución de tenant, rate limiting (en memoria), errores uniformes.
- [x] `POST /api/v1/invoices`, `GET /api/v1/invoices`, `GET /api/v1/invoices/:id` con idempotencia, contra `MockBillingProvider`.
- [x] Tests: aislamiento RLS, atomicidad/idempotencia en SQL, servicio con repositorio en memoria.
- [x] Capa HTTP→PostgREST verificada contra un proyecto Supabase real de pruebas (2026-10-05): `scripts/probar-api.ps1`, 17/17 (auth, creación 202, idempotencia 200/422, validación, consulta, aislamiento 404).
- [ ] Probar concurrencia real sobre la misma `Idempotency-Key` y verificar `supabase/seed.sql` con el login local (Docker).
- [ ] Alta de empresas, establecimientos, puntos de emisión, usuarios y configuración de proveedor desde el panel (hoy: SQL/service role, ver `docs/DATABASE.md`).
- [ ] `GET /api/v1/invoices/:id/ride|xml` (depende del detalle del proveedor; Fase 2).

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
