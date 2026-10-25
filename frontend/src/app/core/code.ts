export const CODE_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/** Normalise la saisie d'un code de visite (minuscules, espaces → tirets, caractères invalides retirés). */
export function normalizeCode(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}
