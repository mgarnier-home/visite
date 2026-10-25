import { Fiche, Point, SharedField, VisitState } from './api.types';

/** Frais de notaire estimés : 7,5 % du prix. */
export function notaryFees(price: number): number {
  return price * 0.075;
}

/** Prix au m² habitable ; null si prix ou surface manquants (ou surface ≤ 0). */
export function pricePerM2(f: Fiche): number | null {
  if (f.price_eur === null || f.living_area_m2 === null || f.living_area_m2 <= 0) return null;
  return f.price_eur / f.living_area_m2;
}

/** Âge du bien à l'année donnée ; null si l'année de construction est inconnue. */
export function buildingAge(f: Fiche, year: number): number | null {
  return f.construction_year === null ? null : year - f.construction_year;
}

function visibleRoomIds(s: VisitState): Set<string> {
  return new Set(s.rooms.filter(r => !r.hidden).map(r => r.id));
}

/** Valeurs partagées indexées par cible et champ (la dernière l'emporte). */
function sharedIndex(s: VisitState): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const v of s.shared) m.set(key(v.target_id, v.field), v.value);
  return m;
}

function key(targetId: string, field: SharedField): string {
  return `${targetId}|${field}`;
}

/** Somme des travaux saisis sur les points des pièces visibles. */
export function totalWorks(s: VisitState): number {
  const visible = visibleRoomIds(s);
  const shared = sharedIndex(s);
  let total = 0;
  for (const p of s.points) {
    if (!visible.has(p.room_id)) continue;
    const v = shared.get(key(p.id, 'works_eur'));
    if (typeof v === 'number') total += v;
  }
  return total;
}

/** Prix + frais de notaire + travaux ; null sans prix. */
export function realPrice(s: VisitState): number | null {
  const price = s.visit.fiche.price_eur;
  if (price === null) return null;
  return price + notaryFees(price) + totalWorks(s);
}

/** Mon score pondéré (sur 5, au dixième) sur les notes de la pièce récapitulatif ; N/A exclus. */
export function weightedScore(s: VisitState): number | null {
  const summary = s.rooms.find(r => !r.hidden && r.kind === 'summary');
  if (!summary) return null;
  const ratings = new Map(s.ratings.map(r => [r.point_id, r.value]));
  let sum = 0;
  let weights = 0;
  for (const p of s.points) {
    if (p.room_id !== summary.id || p.type !== 'note') continue;
    const value = ratings.get(p.id);
    if (value === undefined || value === null) continue;
    sum += value * p.weight;
    weights += p.weight;
  }
  if (weights === 0) return null;
  return Math.round((sum / weights) * 10) / 10;
}

/** Points bloquants des pièces visibles, par position de pièce puis de point. */
export function blockingPoints(s: VisitState): Point[] {
  const roomPos = new Map(s.rooms.filter(r => !r.hidden).map(r => [r.id, r.position]));
  const shared = sharedIndex(s);
  return s.points
    .filter(p => roomPos.has(p.room_id) && shared.get(key(p.id, 'blocking')) === true)
    .sort((a, b) => roomPos.get(a.room_id)! - roomPos.get(b.room_id)! || a.position - b.position);
}

/** Questions des pièces visibles pas encore posées. */
export function unaskedCount(s: VisitState): number {
  const visible = visibleRoomIds(s);
  const shared = sharedIndex(s);
  return s.questions.filter(q => visible.has(q.room_id) && shared.get(key(q.id, 'asked')) !== true)
    .length;
}
