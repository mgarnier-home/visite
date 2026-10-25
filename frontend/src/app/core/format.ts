const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Montant en euros sans décimale (« 215 000 € »). */
export function formatEur(amount: number): string {
  return eur.format(amount);
}

/** Score avec une décimale et la virgule française (« 4,2 »). */
export function formatScore(score: number): string {
  return decimal.format(score);
}
