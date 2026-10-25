import { MatDateFormats, MAT_DATE_LOCALE } from '@angular/material/core';
import { provideDateFnsAdapter } from '@angular/material-date-fns-adapter';
import { fr } from 'date-fns/locale';
import { Provider } from '@angular/core';
import { localIsoWithOffset } from '../core/sync.service';

const pad = (n: number) => String(n).padStart(2, '0');

/** Formats de la date : saisie et affichage `dd/MM/yyyy`. */
export const DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: 'dd/MM/yyyy' },
  display: {
    dateInput: 'dd/MM/yyyy',
    monthYearLabel: 'LLL yyyy',
    dateA11yLabel: 'PP',
    monthYearA11yLabel: 'LLLL yyyy',
  },
};

/** Adaptateur `date-fns` en français, partagé par l'application et les tests. */
export function provideFrenchDates(): Provider[] {
  return [provideDateFnsAdapter(DATE_FORMATS), { provide: MAT_DATE_LOCALE, useValue: fr }];
}

/** Heure `HH:MM` sur 24 h, de 00:00 à 23:59. */
export function isValidTime(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** Ne garde que chiffres et `:`, insère `:` après deux chiffres, au plus `HH:MM`. */
export function normalizeTime(raw: string): string {
  let kept = raw.replace(/[^\d:]/g, '');
  if (kept.indexOf(':') === 1) kept = `0${kept}`; // « 9:30 » devient « 09:30 »
  const digits = kept.replace(/:/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/**
 * Date (jour calendaire local) et heure `HH:MM` en RFC 3339 avec le décalage de cette date.
 * Heure vide : 00:00. `null` si la date est nulle ou l'heure invalide.
 */
export function combineDateTime(date: Date | null, time: string): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  if (time !== '' && !isValidTime(time)) return null;
  const [h, m] = time === '' ? [0, 0] : time.split(':').map(Number);
  return localIsoWithOffset(new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m));
}

/** Jour et heure locaux d'un instant RFC 3339 ; vide si nul ou illisible. */
export function splitDateTime(iso: string | null): { date: Date | null; time: string } {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return { date: null, time: '' };
  return { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
