/**
 * Documentos de MENTIRA del proveedor mock. El PDF es válido pero lleva una marca de simulado:
 * no es un RIDE real ni tiene valor tributario.
 */
const esc = (s: string) => s.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7E]/g, "?");

export function buildMockPdf(lines: string[]): Uint8Array {
  const body = lines.map((line, i) => `${i === 0 ? "" : "0 -20 Td\n"}(${esc(line)}) Tj`).join("\n");
  const stream = `BT\n/F1 14 Tf\n72 740 Td\n${body}\nET`;

  // Solo ASCII: longitud en caracteres == longitud en bytes (necesario para el xref).
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildMockXml(documentId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<comprobanteSimulado documento="${xmlEscape(documentId)}" aviso="SIMULADO - sin valor tributario"/>\n`;
}
