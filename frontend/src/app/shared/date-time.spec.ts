import { describe, expect, it } from 'vitest';
import { combineDateTime, isValidTime, normalizeTime, splitDateTime } from './date-time';

const offsetOf = (iso: string) => {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(iso)!;
  return (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3]));
};

describe('combineDateTime', () => {
  it('combine la date et l\'heure en RFC 3339 local', () => {
    const iso = combineDateTime(new Date(2026, 9, 25), '14:30')!;
    expect(iso).toMatch(/^2026-10-25T14:30:00[+-]\d{2}:\d{2}$/);
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 25, 14, 30]);
  });

  it('heure vide : minuit', () => {
    expect(combineDateTime(new Date(2026, 9, 25), '')).toMatch(/^2026-10-25T00:00:00/);
  });

  it('heure invalide ou date nulle : null', () => {
    expect(combineDateTime(new Date(2026, 9, 25), '25:00')).toBeNull();
    expect(combineDateTime(null, '14:30')).toBeNull();
  });

  it('chaque date porte le décalage de sa propre date', () => {
    for (const d of [new Date(2026, 0, 15), new Date(2026, 6, 15)]) {
      const iso = combineDateTime(d, '12:00')!;
      // « 0 - x » et non « -x » : en UTC, -0 serait différent de +0 pour toBe.
      expect(offsetOf(iso)).toBe(0 - new Date(2026, d.getMonth(), 15, 12, 0).getTimezoneOffset());
    }
  });
});

describe('splitDateTime', () => {
  it('relit la date et l\'heure locales', () => {
    const iso = combineDateTime(new Date(2026, 9, 25), '14:30');
    const { date, time } = splitDateTime(iso);
    expect([date?.getFullYear(), date?.getMonth(), date?.getDate()]).toEqual([2026, 9, 25]);
    expect(time).toBe('14:30');
  });

  it('null ou illisible : vide', () => {
    expect(splitDateTime(null)).toEqual({ date: null, time: '' });
    expect(splitDateTime('n\'importe quoi')).toEqual({ date: null, time: '' });
  });
});

describe('normalizeTime', () => {
  it('ne garde que les chiffres et insère « : » après deux chiffres', () => {
    expect(normalizeTime('1430')).toBe('14:30');
    expect(normalizeTime('14')).toBe('14');
    expect(normalizeTime('143')).toBe('14:3');
    expect(normalizeTime('14h30')).toBe('14:30');
    expect(normalizeTime('14:30:55')).toBe('14:30');
    expect(normalizeTime('abc')).toBe('');
  });

  it('complète un « : » après un seul chiffre', () => {
    expect(normalizeTime('9:30')).toBe('09:30');
  });
});

describe('isValidTime', () => {
  it('accepte 00:00 à 23:59', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('2575')).toBe(false);
    expect(isValidTime('12:60')).toBe(false);
    expect(isValidTime('')).toBe(false);
  });
});
