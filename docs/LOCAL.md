# Probar Nixgo Billing en tu computadora

Guía paso a paso para correr todo **en local** (Supabase en Docker + la app). No usa tus proyectos de Supabase en la nube ni emite facturas reales: el proveedor es `mock`.

## Antes de empezar
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

## Si algo falla
- **401 con una clave recién creada** o **500 `internal_error`**: copia las líneas `[api] …` de la terminal donde corre `npm run dev` (no incluyen secretos) y compártelas.
- **El login no funciona**: ejecuta `npx supabase db reset` otra vez y revisa que `.env.local` tenga las 3 variables.
- **Puertos ocupados**: `npx supabase stop` y vuelve a `start`.
- Para empezar de cero: `npx supabase db reset` (borra todo y recrea el seed).
- Al terminar: `npx supabase stop`.

## Qué se está verificando aquí
Esta prueba cubre lo que **no** se pudo verificar en el entorno de desarrollo remoto: que el código (`auth.ts`, `repository.ts`, el panel de API keys y el login) funciona contra el Supabase real (PostgREST + Auth), no solo contra Postgres plano.
