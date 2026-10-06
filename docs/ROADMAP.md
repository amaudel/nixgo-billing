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
- [x] Panel: alta de empresas (solo admin de plataforma), establecimientos, puntos de emisión y usuarios existentes (admin de la empresa) en `/organizations`.
- [ ] Panel: crear cuentas de usuario/invitaciones (hoy: Supabase → Authentication → Users), cambiar rol/quitar usuarios (requiere proteger al último administrador), editar/desactivar empresas y configurar el proveedor (Fase 2).
- [ ] `GET /api/v1/invoices/:id/ride|xml` (depende del detalle del proveedor; Fase 2).

## Fase 2 — Webhooks y ciclo de vida (en curso)
- [x] (verificado contra un proyecto Supabase real de pruebas el 2026-10-06 con `scripts/probar-webhook.ps1`: 15/15) `POST /api/webhooks/[provider]` (mock operativo; Factuplan responde 501 hasta la Fase 3): firma sobre cuerpo crudo, validación Zod, payload sanitizado, procesamiento idempotente por `(provider, event_id)` en una sola transacción (`process_webhook_event`), estados finales no se pisan, `not_found` → 404 para que el proveedor reintente.
- [x] (verificada contra un proyecto Supabase real el 2026-10-06 con `scripts/probar-reconciliacion.ps1`: 12/12) Reconciliación: `GET|POST /api/cron/reconcile` (protegido con `CRON_SECRET`) pregunta al proveedor por las facturas en `processing` con más de N minutos (10 por omisión) y aplica la respuesta con la misma función transaccional que los webhooks. **Pendiente:** programarlo (Vercel Cron o similar) al desplegar, y definir qué hacer con facturas atascadas por muchas horas.
- [x] (RIDE/XML verificados contra un proyecto Supabase real el 2026-10-06 con `scripts/probar-documentos.ps1`: 14/14) Detalle de factura en el panel (`/invoices/[id]`: datos, ítems, totales, autorización, historial de eventos) y descargas de RIDE/XML: `GET /api/v1/invoices/:id/ride|xml` (API key) y `/invoices/:id/ride|xml` (sesión del panel). Solo facturas **autorizadas** (409 si no). El mock entrega un PDF/XML simulados.
- [x] Configuración de empresa en el panel (`/organizations/[id]`): proveedor, id en el proveedor, referencia y vencimiento del certificado por ambiente (alerta a 30 días / vencido). Solo administrador de plataforma edita; el administrador de la empresa solo ve. Producción no acepta mock y exige confirmación; cada cambio queda auditado.
- [~] Factuplan: el SDK oficial (`factuplan@0.21.0`) se leyó el 2026-10-06 y resolvió el esquema y firma de webhooks (con timestamp anti-replay), los endpoints y casi todos los estados. **Siguen abiertas** la idempotencia (el SDK no la usa), semántica de descuentos/pagos y límites (ver `docs/FACTUPLAN.md`, «Abierto»).

## Fase 3 — Factuplan real (sandbox)
- Bloqueada por las **decisiones pendientes** de `docs/FACTUPLAN.md` (la principal: duplicados sin idempotencia) y por tener una cuenta de sandbox (`ak_test_…`) para probarlas.
- Implementar `FactuplanProvider` (create/status/RIDE/XML) y `verifyWebhook` con el esquema `t=…,v1=…`; certificados por empresa (estrategia A); notas de crédito.
- Pruebas end-to-end en sandbox. Sin facturas reales hasta aprobación explícita.

## Fase 4 — Producción
- CSP con nonces, monitoreo, backups, alertas de expiración de certificados, métricas.

## Fase 5 — Opcional
- Segundo proveedor (Security Data) o integración directa con el SRI (`src/lib/tax/ecuador/`), con custodia propia de certificados (estrategia B).
