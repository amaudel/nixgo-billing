# Base de datos

Migraciones en `supabase/migrations/` (orden cronológico, inmutables una vez aplicadas):

1. `…000001_core_schema.sql` — enums, tablas, índices, triggers, `next_sequential`.
2. `…000002_rls.sql` — funciones de autorización, privilegios mínimos y políticas RLS.
3. `…000003_dashboard_functions.sql` — `dashboard_stats`, `organization_overview` (security invoker).

> Estado de verificación: sintaxis validada con el parser de Postgres (pglast). **Aún no ejecutadas contra una base real**: correr `supabase start` / `supabase db reset` y revisar errores antes de usar.

## Entidades

| Tabla | Propósito |
|---|---|
| `organizations` | Empresa: RUC, razón social, ambiente, estado, `tax_config` (sin secretos) |
| `organization_provider_configs` | Por empresa+ambiente: proveedor, `provider_company_ref`, `certificate_ref` (solo referencias) |
| `organization_users` | Membresía y rol por empresa |
| `platform_admins` | Administradores globales de la plataforma |
| `establishments`, `emission_points` | Establecimientos y puntos de emisión; secuencial por punto (`current_sequence` solo se modifica con `next_sequential()`; el panel no tiene permiso sobre esa columna) |
| `customers` | Clientes por empresa |
| `invoices`, `invoice_items`, `electronic_documents` | Facturas, líneas y URLs de XML/RIDE |
| `billing_events` | Auditoría append-only (trigger impide UPDATE/DELETE) |
| `api_keys` | Credenciales de apps consumidoras (solo hash) |
| `idempotency_keys` | Deduplicación de `POST /invoices` |
| `webhook_events` | Historial/idempotencia de webhooks (`unique(provider,event_id)`) |

### Diferencias respecto al borrador inicial (intencionales)

- `emission_points`, `invoice_items`, `electronic_documents` llevan `organization_id` (denormalizado) para RLS barato y FK compuestas que garantizan aislamiento.
- `platform_admin` no está en `org_role`: es global, vive en `platform_admins`.
- `invoices` añade `environment`, `source_application`, `external_reference`, `idempotency_key`, `rejection_reason`, `updated_at`.
- Notas de crédito: sin tabla propia aún; `document_type` ya contempla `credit_note`. Se diseña en la Fase 3.
- La lista de `identification_type` es provisional y debe validarse con la ficha técnica vigente del SRI.

## Modelo de acceso (RLS)

- Todas las tablas tienen RLS activo. `anon` no tiene privilegios.
- `authenticated`: lectura de lo propio; escritura solo en establecimientos, puntos de emisión (org admin), clientes (admin/billing) y miembros (org admin).
- Facturas, ítems, eventos, idempotencia, webhooks y empresas: **escritura solo con service role**.
- `api_keys.key_hash` no es legible para `authenticated` (privilegio por columna).
- Tablas nuevas nacen sin acceso (`alter default privileges`): conceder explícitamente y añadir políticas.

## Bootstrap

Con la BD vacía y un usuario creado en Supabase Auth, en el SQL Editor (service role / rol postgres):

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'tu-correo@dominio.com';
```

Empresas, establecimientos, puntos de emisión y vínculos `organization_users` se crean por ahora con SQL o service role; el alta desde el panel llega en la Fase 1.
