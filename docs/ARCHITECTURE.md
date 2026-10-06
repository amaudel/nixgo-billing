# Arquitectura

## Visión

```
 NidoCerca · Restaurantes · Veterinarias · otras apps
                     │  Bearer nb_live_… + Idempotency-Key
                     ▼
            ┌─────────────────────┐
            │  NIXGO BILLING API  │  /api/v1/*        (Next.js route handlers)
            │  auth · tenant ·    │
            │  validación · audit │
            └─────────┬───────────┘
                      │  interfaz BillingProvider
              ┌───────┴────────┐
              ▼                ▼
        MockProvider    FactuplanProvider  ──►  SRI
     (dev / tests)       (stub en Fase 0)       (futuro: SecurityData, directo SRI)
```

## Capas y reglas de dependencia

| Capa | Ruta | Puede depender de |
|---|---|---|
| UI (panel) | `src/app/(app)`, `src/components` | `lib/data`, `lib/supabase/server` |
| API pública | `src/app/api/v1/*` (route handlers finos) → `lib/api` (auth, errores, límite) → `lib/invoices` (servicio + repositorio) | `lib/billing`, `lib/security`, `lib/supabase/admin` |
| Dominio | `src/lib/billing/*` | nada externo |
| Adaptadores | `src/lib/billing/providers/*` | solo dominio |
| Fiscal Ecuador | `src/lib/tax/ecuador/*` | dominio |

Solo `providers/` conoce proveedores concretos. Cambiar de proveedor = nueva clase que implemente `BillingProvider` + registrarla en `providers/index.ts` + configurarla por empresa.

## Multi-tenancy

- Una **organización** (empresa con RUC) es la unidad de aislamiento.
- **Panel:** el usuario se autentica con Supabase Auth; todas las consultas usan su sesión, así que **RLS** filtra por las empresas a las que pertenece (`organization_users`). `platform_admin` (tabla `platform_admins`) ve todo.
- **API:** la API key identifica organización + aplicación + ambiente. El backend usa service role (salta RLS), por lo que **cada consulta debe filtrar por `organization_id`** de la key. Las FK compuestas en la BD impiden referenciar filas de otra empresa aunque el código se equivoque.
- Proveedor y referencias de certificado se configuran **por empresa y ambiente** (`organization_provider_configs`).

## Flujo de emisión (implementado en la Fase 1 contra `mock`)

1. App cliente `POST /api/v1/invoices` con `Idempotency-Key`.
2. Autenticar key → resolver organización/ambiente → validar con Zod.
3. Idempotencia: misma clave + mismo cuerpo ⇒ devolver la respuesta original; mismo clave + otro cuerpo ⇒ 422.
4. `create_invoice_draft` (una transacción): reclama la clave, resuelve establecimiento/punto de la empresa, upsert del cliente, secuencial atómico, factura `pending` + ítems + evento `invoice.created`. Si algo falla, todo se revierte.
5. `provider.createInvoice()` → `processing`. Si el proveedor falla, la factura queda `pending` (502) y **reintentar con la misma `Idempotency-Key` la reanuda**; al proveedor se le propaga el id de la factura como clave de idempotencia.
6. Webhook del proveedor → `POST /api/webhooks/[provider]` (firma verificada sobre el cuerpo crudo, validado, idempotente por `(provider, event_id)`) → `authorized` / `rejected`. Todo ocurre en `process_webhook_event` (una transacción); la factura se localiza por `(provider, provider_document_id)`. (Implementado en la Fase 2 contra `mock`.)
7. Cada paso escribe en `billing_events` (append-only, sanitizado).
8. **Reconciliación** (`/api/cron/reconcile`): si el webhook se pierde, las facturas en `processing` con más de N minutos se consultan con `provider.getInvoice()` y se aplican con la misma función que los webhooks (`src/lib/invoices/reconcile.ts`). `provider.getInvoice` del mock es sin estado y autoriza todo documento mock, para ver el ciclo completo en desarrollo.

## Decisiones clave

- **Next.js route handlers** en lugar de un servicio aparte: simple, un solo despliegue en Vercel.
- **Roles:** `platform_admin` es global (tabla propia); `organization_admin`, `billing_user`, `viewer` son por empresa (`org_role`).
- **Escrituras de facturación solo desde backend** (service role); los usuarios del panel no insertan facturas directamente.
- **Dinero:** `numeric(14,2)`; nunca `float` en BD. Los totales se calculan en centavos con `BigInt` (`src/lib/billing/totals.ts`); las reglas de redondeo/base del SRI son **provisionales** hasta validarlas en `src/lib/tax/ecuador/`.
- **El servicio no conoce Supabase:** `lib/invoices/service.ts` depende de la interfaz `InvoiceRepository`; la implementación real (`repository.ts`, service role) se inyecta, lo que permite probarlo con un repositorio en memoria.
- **Secuencial con Factuplan:** Factuplan calcula su propio secuencial y clave de acceso (ver `docs/FACTUPLAN.md`); al implementarlo habrá que decidir cómo convive con `next_sequential()`.
- **Zona horaria:** fechas de negocio en `America/Guayaquil`.
