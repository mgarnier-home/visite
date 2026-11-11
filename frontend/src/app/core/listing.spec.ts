import { describe, expect, it } from 'vitest';
import { Listing } from './api.types';
import { nextStepLine, specsLine, STATUS_ORDER } from './listing';

const base = (over: Partial<Listing>): Listing =>
  ({
    status: 'contact', created_at: '2026-11-09T08:00:00Z', mail_sent_at: null, visit_at: null,
    visited_at: null, property_type: 'Maison', rooms: 5, bedrooms: 3, living_area_m2: 118,
    land_area_m2: null, ...over,
  }) as Listing;

const now = new Date('2026-11-11T12:00:00Z');

describe('specsLine', () => {
  it('assemble les segments présents', () => {
    expect(specsLine(base({}))).toBe('Maison · 5 p · 3 ch · 118 m²');
  });
  it('omet chambres et surface absentes', () => {
    expect(specsLine(base({ bedrooms: null, living_area_m2: null }))).toBe('Maison · 5 p');
  });
});

describe('nextStepLine', () => {
  it('contact : date d\'ajout', () => {
    expect(nextStepLine(base({}), now)).toBe('Ajoutée le 9 nov');
  });
  it('mail : date d\'envoi', () => {
    expect(nextStepLine(base({ status: 'mail', mail_sent_at: '2026-11-08T09:00:00Z' }), now)).toBe('Envoyé le 8 nov');
  });
  it('planned : jour et heure de Paris', () => {
    expect(nextStepLine(base({ status: 'planned', visit_at: '2026-11-14T09:30:00Z' }), now)).toBe('Sam. 14 nov · 10:30');
  });
  it('done : date de visite', () => {
    expect(nextStepLine(base({ status: 'done', visited_at: '2026-11-14T09:30:00Z' }), now)).toBe('Visitée le 14 nov');
  });
});

it('STATUS_ORDER', () => {
  expect(STATUS_ORDER).toEqual(['contact', 'mail', 'planned', 'done', 'dropped']);
});
