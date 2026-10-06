# Base de datos

Migraciones en `supabase/migrations/` (orden cronológico, inmutables una vez aplicadas):

1. `…000001_core_schema.sql` — enums, tablas, índices, triggers, `next_sequential`.
2. `…000002_rls.sql` — funciones de autorización, privilegios mínimos y políticas RLS.
3. `…000003_dashboard_functions.sql` — `dashboard_stats`, `organization_overview` (security invoker).
4. `…000004_emission_points_sequence_guard.sql` — privilegios por columna: el panel no puede tocar `current_sequence`.
5. `…000005_invoice_api_functions.sql` — funciones de la API (solo `service_role`): `create_invoice_draft` (reserva atómica: idempotencia + cliente + secuencial + factura + ítems + evento; todo o nada), `invoice_detail`, `invoice_list`, `apply_provider_result` (solo transiciona facturas `pending`/`processing`). Todas reciben `organization_id` y ambiente explícitos.
6. `…000006_webhook_processing.sql` — índice único `(provider, provider_document_id)`, `webhook_events.organization_id/invoice_id` y `process_webhook_event` (idempotente, atómica, solo service role; la empresa se deduce de la factura, nunca del cuerpo del webhook).
7. `…000007_organization_admin_functions.sql` — `create_organization` (empresa + proveedor `mock` de pruebas, atómico), `find_user_id_by_email` y `user_emails` (SECURITY DEFINER, solo service role: único acceso a `auth.users`).
8. `…000008_reconciliation.sql` — `invoices_to_reconcile` (solo service role): facturas `processing` con documento del proveedor y más de N minutos sin cambios, más antiguas primero; reaplicar `processing` renueva `updated_at` y las manda al final de la cola.
9. `…000009_provider_config.sql` — `set_provider_config` (solo service role): upsert por empresa y ambiente de proveedor y referencias; **rechaza `production` + `mock`**; registra el cambio en `billing_events` (quién y qué, sin los valores de las referencias).

> Estado de verificación: las 5 migraciones se aplican y se prueban en un Postgres 16 plano con `supabase/tests/run.sh` (emula roles y `auth` de Supabase; corre en CI): aislamiento RLS entre empresas e idempotencia/atomicidad de la API de facturas. Las migraciones también se aplicaron en un proyecto Supabase real de pruebas (vía `supabase/all-migrations.sql`) y la API funcionó contra él. **Pendiente:** probar concurrencia real sobre una misma `Idempotency-Key`.

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
| `idempotency_keys` | Deduplicación de `POST /invoices`. La clave se guarda como `<ambiente>:<Idempotency-Key>` (test y producción no se mezclan) |
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

Empresas (administrador de plataforma), establecimientos, puntos de emisión y vínculos `organization_users` (administrador de cada empresa) se crean desde el panel, en `/organizations`. Las cuentas de usuario se crean en Supabase → Authentication → Users; el panel solo vincula cuentas existentes.
