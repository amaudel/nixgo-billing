# Guía de integración para aplicaciones consumidoras

> **Contrato objetivo (Fase 1).** Los endpoints aún no existen; este documento fija el diseño.

Una app consumidora (p. ej. NidoCerca) solo necesita Nixgo Billing. **No** debe saber cómo funciona Factuplan ni el SRI, cómo se firma el XML ni dónde está el certificado.

## Autenticación

```
Authorization: Bearer nb_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Claves `nb_test_…` operan en el ambiente de pruebas; `nb_live_…` en producción.
- Cada clave pertenece a una empresa y una aplicación. Se muestra una sola vez al crearla; guárdala como secreto de servidor (nunca en frontend).

## Crear factura

```http
POST /api/v1/invoices
Authorization: Bearer nb_live_xxxxxx
Idempotency-Key: nidocerca_payment_92839
Content-Type: application/json
```

```json
{
  "establishmentCode": "001",
  "emissionPointCode": "001",
  "issueDate": "2026-10-05",
  "externalReference": "payment_92839",
  "customer": {
    "identificationType": "cedula",
    "identification": "0912345678",
    "legalName": "Juan Pérez",
    "email": "juan@example.com"
  },
  "items": [
    { "sku": "PLAN-PRO", "description": "Suscripción mensual", "quantity": 1, "unitPrice": 25.0, "discount": 0, "taxRate": 15 }
  ]
}
```

> Los valores de `identificationType` y `taxRate` están sujetos a la especificación vigente del SRI; se confirmarán al implementar `src/lib/tax/ecuador/`.

Respuesta `202 Accepted` (la autorización es asíncrona):

```json
{ "id": "6f1c…", "status": "processing", "number": "001-001-000000123" }
```

## Idempotencia

`Idempotency-Key` es obligatorio. Reintentar con la misma clave y el mismo cuerpo devuelve la factura original (no crea otra). La misma clave con un cuerpo distinto responde `422`.

## Consultar estado

```
GET /api/v1/invoices/:id        → { status, accessKey, authorization: { number, authorizedAt }, rejectionReason }
GET /api/v1/invoices/:id/ride   → PDF
GET /api/v1/invoices/:id/xml    → XML
```

Estados: `draft`, `pending`, `processing`, `authorized`, `rejected`, `failed`, `voided`. Haz *polling* con backoff o (futuro) suscríbete a webhooks de Nixgo hacia tu app.

## Errores

JSON uniforme `{ "error": { "code": "…", "message": "…" } }`. `401` key inválida/revocada · `403` sin permiso · `404` no existe (también si pertenece a otra empresa) · `422` validación/idempotencia · `429` rate limit · `5xx` reintentar con la misma `Idempotency-Key`.

## Otros endpoints previstos

`GET /api/v1/invoices` · `POST /api/v1/credit-notes` · `GET|POST /api/v1/customers` · `GET /api/v1/organizations/:id`
