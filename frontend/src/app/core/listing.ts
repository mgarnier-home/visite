import { Listing, ListingSource, ListingStatus } from './api.types';

export const STATUS_ORDER: ListingStatus[] = ['contact', 'mail', 'planned', 'done', 'dropped'];

export const STATUS_LABELS: Record<ListingStatus, string> = {
  contact: 'À contacter',
  mail: 'Mail envoyé',
  planned: 'Visite planifiée',
  done: 'Visite effectuée',
  dropped: 'Écartée',
};

export const SOURCE_LABELS: Record<string, string> = {
  bienici: "Bien'ici",
  jinka: 'Jinka',
  manual: 'Saisie manuelle',
};

export const sourceLabel = (s: ListingSource): string => SOURCE_LABELS[s] ?? s;

export function specsLine(l: Listing): string {
  return [
    l.property_type,
    l.rooms != null && `${l.rooms} p`,
    l.bedrooms != null && `${l.bedrooms} ch`,
    l.living_area_m2 != null && `${l.living_area_m2} m²`,
  ].filter(Boolean).join(' · ');
}

function parisParts(iso: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...opts }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((p) => [p.type, p.value.replace(/\.$/, '')]));
}

/** « 14 nov » (avec l'année si ce n'est pas celle de `now`). */
function day(iso: string, now: Date): string {
  const p = parisParts(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  const sameYear = p['year'] === parisParts(now.toISOString(), { year: 'numeric' })['year'];
  return `${p['day']} ${p['month']}${sameYear ? '' : ' ' + p['year']}`;
}

export function nextStepLine(l: Listing, now: Date): string {
  if (l.status === 'planned' && l.visit_at) {
    const p = parisParts(l.visit_at, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return `${p['weekday'][0].toUpperCase()}${p['weekday'].slice(1)}. ${day(l.visit_at, now)} · ${p['hour']}:${p['minute']}`;
  }
  if (l.status === 'mail' && l.mail_sent_at) return `Envoyé le ${day(l.mail_sent_at, now)}`;
  if (l.status === 'done' && l.visited_at) return `Visitée le ${day(l.visited_at, now)}`;
  return `Ajoutée le ${day(l.created_at, now)}`;
}

const hostIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Source d'un texte partagé : même règle que `scrape.FindURL` côté serveur ; `null` sans lien https. */
export function detectSource(text: string): ListingSource | null {
  const raw = text.match(/https:\/\/\S+/)?.[0].replace(/[.,;:!?)\]>"']+$/, '');
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  return hostIs(host, 'bienici.com') ? 'bienici' : hostIs(host, 'jinka.fr') ? 'jinka' : 'manual';
}
