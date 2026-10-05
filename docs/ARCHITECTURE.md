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
| API pública | `src/app/api/v1/*` (Fase 1) | `lib/billing`, `lib/security`, `lib/supabase/admin` |
| Dominio | `src/lib/billing/*` | nada externo |
| Adaptadores | `src/lib/billing/providers/*` | solo dominio |
| Fiscal Ecuador | `src/lib/tax/ecuador/*` | dominio |

Solo `providers/` conoce proveedores concretos. Cambiar de proveedor = nueva clase que implemente `BillingProvider` + registrarla en `providers/index.ts` + configurarla por empresa.

## Multi-tenancy

- Una **organización** (empresa con RUC) es la unidad de aislamiento.
- **Panel:** el usuario se autentica con Supabase Auth; todas las consultas usan su sesión, así que **RLS** filtra por las empresas a las que pertenece (`organization_users`). `platform_admin` (tabla `platform_admins`) ve todo.
- **API:** la API key identifica organización + aplicación + ambiente. El backend usa service role (salta RLS), por lo que **cada consulta debe filtrar por `organization_id`** de la key. Las FK compuestas en la BD impiden referenciar filas de otra empresa aunque el código se equivoque.
- Proveedor y referencias de certificado se configuran **por empresa y ambiente** (`organization_provider_configs`).

## Flujo de emisión (objetivo, Fase 1+)

1. App cliente `POST /api/v1/invoices` con `Idempotency-Key`.
2. Autenticar key → resolver organización/ambiente → validar con Zod.
3. Idempotencia: misma clave + mismo cuerpo ⇒ devolver la respuesta original; mismo clave + otro cuerpo ⇒ 422.
4. Reservar secuencial (`next_sequential`, atómico) y guardar factura `pending`.
5. `provider.createInvoice()` → estado `processing`.
6. Webhook del proveedor (firma verificada, idempotente por `event_id`) → `authorized` / `rejected`.
7. Cada paso escribe en `billing_events` (append-only, sanitizado).

## Decisiones clave

- **Next.js route handlers** en lugar de un servicio aparte: simple, un solo despliegue en Vercel.
- **Roles:** `platform_admin` es global (tabla propia); `organization_admin`, `billing_user`, `viewer` son por empresa (`org_role`).
- **Escrituras de facturación solo desde backend** (service role); los usuarios del panel no insertan facturas directamente.
- **Dinero:** `numeric(14,2)`; nunca `float` en BD.
- **Zona horaria:** fechas de negocio en `America/Guayaquil`.
