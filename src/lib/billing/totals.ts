import type { InvoiceItem, InvoiceTotals } from "./types";

/**
 * Cálculo PROVISIONAL de totales, en aritmética entera (centavos) para evitar errores de coma
 * flotante. Redondeo "half up" por línea. Las reglas de redondeo y de base imponible del SRI se
 * validarán contra la ficha técnica vigente en src/lib/tax/ecuador/ antes de producción.
 *
 * Convención: subtotal = base después de descuentos; total = subtotal + impuesto.
 */

export interface ItemInput {
  sku?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
}

export class TotalsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalsError";
  }
}

// (sin literales 0n: el target de TS es ES2017)
const ZERO = BigInt(0);
const TWO = BigInt(2);
const BPS = BigInt(10_000); // tarifa: hasta 2 decimales (centésimas de punto porcentual)
const GROSS_DIVISOR = BigInt(10_000_000_000); // micro² (1e12) → centavos (1e2)

const toScaled = (value: number, scale: number) => BigInt(Math.round(value * scale));

/** a / b redondeado half-up (solo para a >= 0, b > 0). */
function divRound(a: bigint, b: bigint): bigint {
  return (a * TWO + b) / (b * TWO);
}

const toMoney = (cents: bigint) => Number(cents) / 100;

export function computeTotals(inputs: ItemInput[]): { items: InvoiceItem[]; totals: InvoiceTotals } {
  let subtotal = ZERO;
  let discount = ZERO;
  let tax = ZERO;

  const items = inputs.map((input, index): InvoiceItem => {
    // quantity y unitPrice en micro-unidades → bruto en micro² → centavos (÷ 1e10)
    const gross = divRound(toScaled(input.quantity, 1e6) * toScaled(input.unitPrice, 1e6), GROSS_DIVISOR);
    const lineDiscount = toScaled(input.discount, 100);
    if (lineDiscount > gross) {
      throw new TotalsError(`items[${index}]: el descuento supera el valor de la línea`);
    }
    const base = gross - lineDiscount;
    const lineTax = divRound(base * toScaled(input.taxRate, 100), BPS);

    subtotal += base;
    discount += lineDiscount;
    tax += lineTax;

    return {
      sku: input.sku,
      description: input.description,
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      discount: toMoney(lineDiscount),
      taxRate: input.taxRate,
      taxAmount: toMoney(lineTax),
      total: toMoney(base + lineTax),
    };
  });

  return {
    items,
    totals: {
      subtotal: toMoney(subtotal),
      discount: toMoney(discount),
      tax: toMoney(tax),
      total: toMoney(subtotal + tax),
    },
  };
}
