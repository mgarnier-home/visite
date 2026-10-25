/** Normalisation « à la frappe » : ne retire pas les tirets finaux (sinon impossible de taper « maison-x »). */
export function normalizeCodeWhileTyping(input: string): string {
  return input.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-');
}
