const TZ = "America/Guayaquil";

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria de Ecuador, no la del servidor. */
export function todayInEcuador(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function monthStartInEcuador(now = new Date()): string {
  return `${todayInEcuador(now).slice(0, 7)}-01`;
}

export function formatMoney(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("es-EC", { style: "currency", currency }).format(value);
}

/** 001-001-000000123 */
export function formatInvoiceNumber(
  establishment?: string | null,
  emissionPoint?: string | null,
  sequential?: number | null,
): string {
  if (!establishment || !emissionPoint || sequential == null) return "—";
  return `${establishment}-${emissionPoint}-${String(sequential).padStart(9, "0")}`;
}
