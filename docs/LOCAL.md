# Probar Nixgo Billing en tu computadora

Guía paso a paso para correr todo **en local** (Supabase en Docker + la app). No usa tus proyectos de Supabase en la nube ni emite facturas reales: el proveedor es `mock`.

## Alternativa sin Docker: un proyecto Supabase de pruebas en la nube
Si no puedes o no quieres instalar Docker, usa un proyecto Supabase **nuevo, vacío y dedicado a pruebas** (nunca uno con datos reales, como el de otra app).

1. `npx supabase login` (abre el navegador: entra con la cuenta que tiene el proyecto de pruebas).
2. `npx supabase link --project-ref TU_REF` (el ref es el código de la URL del dashboard; pide la contraseña de la base que pusiste al crear el proyecto).
3. `npx supabase db push` → aplica las 5 migraciones.
4. Dashboard → **Authentication → Users → Add user**: crea tu usuario (correo + contraseña, marcando "Auto confirm user").
5. Dashboard → **SQL Editor**: pega `supabase/dev-setup-hosted.sql` cambiando `TU_CORREO` por el de tu usuario → Run. Crea la empresa demo, el establecimiento y el punto de emisión.
6. Dashboard → **Project Settings → API**: copia la URL, la clave publishable (o anon) y la secret (o service_role) a `.env.local`. **Nunca pegues la secret en un chat ni la subas a Git.**
7. Dashboard → **Authentication → Sign In / Providers**: desactiva "Allow new users to sign up" (el panel no tiene auto-registro).
8. Sigue desde el **paso 5** (arrancar y entrar) de esta guía, con tu correo y contraseña.

Si `db push` se queda colgado o falla por la conexión (por ejemplo en `Initialising login role…`), alternativa: abre `supabase/all-migrations.sql` (las 5 migraciones juntas, dentro de una transacción), pégalo completo en el **SQL Editor** y pulsa Run.

## Antes de empezar (ruta con Docker)
- **Docker Desktop** instalado y **abierto** (que diga "running").
- **Node.js 20.19 o superior** (`node -v`).
- Este repositorio, en la rama `claude/loving-clarke-7dcsup`.

## 1. Instalar dependencias
```bash
git fetch origin && git checkout claude/loving-clarke-7dcsup
npm install
```

## 2. Levantar Supabase local
```bash
npx supabase start
```
La primera vez descarga imágenes de Docker (varios minutos). Al terminar imprime direcciones y claves.

## 3. Crear las tablas y los datos de prueba
```bash
npx supabase db reset
```
Aplica las 5 migraciones de `supabase/migrations/` y luego `supabase/seed.sql`, que crea:

| Qué | Valor |
|---|---|
| Usuario del panel | `admin@local.test` / `dev-password-123` |
| Empresa | EMPRESA DEMO S.A. (RUC ficticio `1790000000001`), proveedor `mock` en pruebas y producción |
| Tu rol | administrador de esa empresa (no de plataforma) |
| Establecimiento / punto de emisión | `001` / `001` |

> El seed es solo para la base **local**. Nunca lo ejecutes en un proyecto Supabase real.

## 4. Configurar la app
```bash
cp .env.example .env.local
npx supabase status
```
En `.env.local` completa tres variables con lo que muestra `status`:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la clave "Publishable" (en versiones antiguas del CLI: "anon key") |
| `SUPABASE_SERVICE_ROLE_KEY` | la clave "Secret" (en versiones antiguas: "service_role key") |

`.env.local` no se sube a Git. Esas claves son de tu base local; no sirven para nada fuera de tu PC.

## 5. Arrancar la app y entrar
```bash
npm run dev
```
Abre http://localhost:3000/login y entra con `admin@local.test` / `dev-password-123`. Deberías ver el panel con "Empresa Demo".

## 6. Crear una API key
1. Menú **API keys**.
2. Empresa: *Empresa Demo* · Aplicación: *prueba* · Ambiente: **Pruebas** → **Crear clave**.
3. Copia la clave (`nb_test_…`). **Se muestra una sola vez.**

## 7. Pedir una factura
En otra terminal (reemplaza la clave):
```bash
KEY="nb_test_PEGA_AQUI_TU_CLAVE"

curl -i -X POST http://localhost:3000/api/v1/invoices \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: prueba-001" \
  -H "Content-Type: application/json" \
  -d '{
    "establishmentCode": "001",
    "emissionPointCode": "001",
    "externalReference": "pago_1",
    "customer": { "identificationType": "cedula", "identification": "0912345678", "legalName": "Juan Pérez", "email": "juan@example.com" },
    "items": [ { "description": "Suscripción mensual", "quantity": 1, "unitPrice": 25, "taxRate": 15 } ]
  }'
```
**Esperado:** `HTTP/1.1 202`, `"status": "processing"`, `"number": "001-001-000000001"` y `"total": 28.75`.

## 8. Comprobar la idempotencia y las consultas
```bash
# Mismo comando otra vez (misma Idempotency-Key) → 200 + cabecera "Idempotent-Replayed: true", MISMO id, sin factura nueva.
# Misma clave con otro cuerpo (cambia, p. ej., unitPrice a 30) → 422 "idempotency_conflict".

curl -s http://localhost:3000/api/v1/invoices -H "Authorization: Bearer $KEY"          # lista
curl -s http://localhost:3000/api/v1/invoices/ID_DE_LA_FACTURA -H "Authorization: Bearer $KEY"
curl -i http://localhost:3000/api/v1/invoices                                           # sin clave → 401
```
En el panel, **Facturas** debe mostrar la factura (estado "En proceso").

## 9. Ver la base de datos
Supabase Studio: http://127.0.0.1:54323 → Table Editor → `invoices`, `invoice_items`, `billing_events`, `idempotency_keys`.
Comprueba que `api_keys` guarda solo `key_hash` (nunca la clave completa).

## 9b. Crear empresas y usuarios desde el panel
Con una cuenta de **administrador de plataforma** (ver `docs/DATABASE.md#bootstrap`) ves el botón **Nueva empresa** en *Empresas*. Dentro de cada empresa puedes crear establecimientos, puntos de emisión y agregar usuarios que **ya tengan cuenta** (se crean en Supabase → Authentication → Users). Un administrador de empresa solo ve y administra la suya. En un proyecto que ya tenías, aplica antes `supabase/migrations/20261005000007_organization_admin_functions.sql` en el SQL Editor.

## 10. Probar los webhooks (Fase 2)
Los webhooks los envía el proveedor cuando el SRI responde. Con el proveedor `mock` los simulamos nosotros, firmándolos como lo haría el proveedor.

1. Asegúrate de que `.env.local` tiene `MOCK_WEBHOOK_SECRET=dev-only-mock-secret` (viene de `.env.example`). Si lo cambias, reinicia `npm run dev`.
2. **Base de datos:** la migración `…000006_webhook_processing.sql` debe estar aplicada. En un proyecto nuevo, `all-migrations.sql` ya la incluye. En uno que ya tenías, pega **solo** `supabase/migrations/20261005000006_webhook_processing.sql` en el SQL Editor.
3. Con una API key de pruebas:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\probar-webhook.ps1 -Key nb_test_TU_CLAVE
```
Crea una factura, intenta autorizarla con avisos falsos (deben rechazarse con 401), la autoriza con un aviso firmado y comprueba que repetir el aviso no hace nada.

## 11. Probar la reconciliación (Fase 2)
Si se pierde un webhook, la factura se queda "en proceso". La reconciliación se la pregunta al proveedor. En desarrollo el proveedor falso autoriza lo que le consultes.

1. Aplica en el SQL Editor `supabase/migrations/20261005000008_reconciliation.sql` (pega el **contenido** del archivo).
2. En `.env.local` agrega una línea con un secreto de **16 o más caracteres** (inventa uno largo), por ejemplo `CRON_SECRET=un-secreto-largo-de-prueba-123`, y reinicia `npm run dev`.
3. Ejecuta:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\probar-reconciliacion.ps1 -Key nb_test_TU_CLAVE -CronSecret un-secreto-largo-de-prueba-123
```
En producción se programará un cron que llame a `/api/cron/reconcile` con `Authorization: Bearer <CRON_SECRET>` cada pocos minutos.

## 12. Probar RIDE y XML, y el detalle de factura (Fase 2)
```powershell
powershell -ExecutionPolicy Bypass -File scripts\probar-documentos.ps1 -Key nb_test_TU_CLAVE
```
Crea una factura, comprueba que sin autorizar no hay comprobante (409), la autoriza con un webhook firmado y descarga el PDF y el XML simulados (el PDF queda en tu carpeta temporal; abre `ride-prueba.pdf`). En el panel, entra a **Facturas** y haz clic en el número de una factura: verás sus datos, ítems, totales, historial y los botones de descarga cuando esté autorizada.

## Si algo falla
- **401 con una clave recién creada** o **500 `internal_error`**: copia las líneas `[api] …` de la terminal donde corre `npm run dev` (no incluyen secretos) y compártelas.
- **El login no funciona**: ejecuta `npx supabase db reset` otra vez y revisa que `.env.local` tenga las 3 variables.
- **Puertos ocupados**: `npx supabase stop` y vuelve a `start`.
- Para empezar de cero: `npx supabase db reset` (borra todo y recrea el seed).
- Al terminar: `npx supabase stop`.

## Qué se está verificando aquí
Esta prueba cubre lo que **no** se pudo verificar en el entorno de desarrollo remoto: que el código (`auth.ts`, `repository.ts`, el panel de API keys y el login) funciona contra el Supabase real (PostgREST + Auth), no solo contra Postgres plano.
