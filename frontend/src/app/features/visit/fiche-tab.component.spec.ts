import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fiche, VisitState } from '../../core/api.types';
import { SyncService } from '../../core/sync.service';
import { provideAppIcons } from '../../shared/icons';
import { FicheTabComponent } from './fiche-tab.component';

function makeState(over: { creator?: boolean; closed?: boolean } = {}, fiche: Partial<Fiche> = {}): VisitState {
  return {
    seq: 1,
    me: { number: 1 },
    visit: {
      code: 'maison-x',
      is_creator: over.creator ?? true,
      closed_at: over.closed ? 'x' : null,
      fiche: {
        address: '12 rue des Lilas', price_eur: 200000, living_area_m2: 100, floor_area_m2: null,
        land_area_m2: null, visit_at: null, agent_name: 'Alice', agent_phone: '0102030405',
        agent_email: 'a@b.fr', construction_year: 2000, dpe_energy: 'C', dpe_ges: null, rooms_count: null,
        bedrooms_count: null, listing_url: 'https://exemple.fr/annonce', heating_type: null, ...fiche,
      },
    },
    rooms: [], points: [], questions: [], shared: [], ratings: [], comments: [], photos: [],
  } as unknown as VisitState;
}

describe('FicheTabComponent', () => {
  const state = signal<VisitState | null>(null);
  const sync = { state, dispatch: vi.fn() };
  const snack = { open: vi.fn() };

  function setup(s = makeState()) {
    state.set(s);
    const fixture = TestBed.createComponent(FicheTabComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const text = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const field = <T extends HTMLElement>(el: HTMLElement, name: string) => el.querySelector<T>(`[data-field=${name}]`)!;
  const change = (input: HTMLInputElement | HTMLSelectElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('change'));
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sync.dispatch.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [FicheTabComponent],
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: MatSnackBar, useValue: snack },
        provideAppIcons(),
      ],
    });
  });

  it('non-créateur : texte en lecture seule, aucun champ de saisie', () => {
    const { el } = setup(makeState({ creator: false }));
    expect(el.querySelectorAll('input, select, textarea').length).toBe(0);
    expect(text(el, '[data-field=address]')).toContain('12 rue des Lilas');
  });

  it('liens tel:, mailto: et annonce dans un nouvel onglet', () => {
    const { el } = setup(makeState({ creator: false }));
    expect(el.querySelector('a[href="tel:0102030405"]')).not.toBeNull();
    expect(el.querySelector('a[href="mailto:a@b.fr"]')).not.toBeNull();
    const link = el.querySelector('a[href="https://exemple.fr/annonce"]')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('annonce sans schéma : lien en https://, texte affiché inchangé', () => {
    const { el } = setup(makeState({ creator: false }, { listing_url: 'exemple.fr/annonce' }));
    const link = el.querySelector('[data-field=listing_url] a')!;
    expect(link.getAttribute('href')).toBe('https://exemple.fr/annonce');
    expect(link.textContent?.trim()).toBe('exemple.fr/annonce');
    const { el: el2 } = setup(makeState({}, { listing_url: 'www.exemple.fr' }));
    expect(Array.from(el2.querySelectorAll('.links a')).map((a) => a.getAttribute('href'))).toContain(
      'https://www.exemple.fr',
    );
    const { el: el3 } = setup(makeState({ creator: false }, { listing_url: 'http://exemple.fr' }));
    expect(el3.querySelector('[data-field=listing_url] a')!.getAttribute('href')).toBe('http://exemple.fr');
  });

  it('champs calculés : prix au m², frais de notaire, âge, prix réel', () => {
    const { el } = setup(makeState({ creator: false }));
    const norm = (sel: string) => text(el, sel)!.replace(/\s/g, ' ');
    expect(norm('[data-test=price-m2]')).toContain('2 000');
    expect(norm('[data-test=notary]')).toContain('15 000');
    expect(norm('[data-test=age]')).toContain(`${new Date().getFullYear() - 2000} ans`);
    expect(norm('[data-test=real-price]')).toContain('215 000');
    expect(el.textContent).toContain('Frais de notaire (≈ 7,5 %)');
  });

  it('champs calculés absents sans données : « — »', () => {
    const { el } = setup(makeState({ creator: false }, { price_eur: null, construction_year: null }));
    expect(text(el, '[data-test=price-m2]')).toContain('—');
    expect(text(el, '[data-test=age]')).toContain('—');
    expect(text(el, '[data-test=real-price]')).toContain('—');
  });

  it('créateur : un changement dispatche set_fiche une seule fois', () => {
    const { el } = setup();
    change(field<HTMLInputElement>(el, 'agent_name'), 'Bob');
    expect(sync.dispatch).toHaveBeenCalledTimes(1);
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { agent_name: 'Bob' } });
  });

  it('créateur : valeur inchangée, rien n\'est envoyé', () => {
    const { el } = setup();
    change(field<HTMLInputElement>(el, 'agent_name'), 'Alice');
    change(field<HTMLInputElement>(el, 'price_eur'), '200000');
    expect(sync.dispatch).not.toHaveBeenCalled();
  });

  it('nombres : vide → null, valeur négative ignorée', () => {
    const { el } = setup();
    change(field<HTMLInputElement>(el, 'price_eur'), '');
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { price_eur: null } });
    sync.dispatch.mockClear();
    change(field<HTMLInputElement>(el, 'living_area_m2'), '-5');
    expect(sync.dispatch).not.toHaveBeenCalled();
  });

  it('nombres entiers (pièces, chambres, année) : pas de 1, décimale refusée avec un message', () => {
    const { fixture, el } = setup();
    for (const name of ['rooms_count', 'bedrooms_count', 'construction_year']) {
      const input = field<HTMLInputElement>(el, name);
      expect(input.getAttribute('step')).toBe('1');
      expect(input.getAttribute('inputmode')).toBe('numeric');
    }
    expect(field<HTMLInputElement>(el, 'living_area_m2').getAttribute('step')).toBe('any');
    change(field<HTMLInputElement>(el, 'rooms_count'), '2.5');
    fixture.detectChanges();
    expect(sync.dispatch).not.toHaveBeenCalled();
    expect(text(el, '[data-test=error-rooms_count]')).toBe('Nombre entier attendu');
    change(field<HTMLInputElement>(el, 'rooms_count'), '4');
    fixture.detectChanges();
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { rooms_count: 4 } });
    expect(el.querySelector('[data-test=error-rooms_count]')).toBeNull();
  });

  it('DPE : sélection d\'une classe et retour à « — »', () => {
    const { el } = setup();
    change(field<HTMLSelectElement>(el, 'dpe_ges'), 'B');
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { dpe_ges: 'B' } });
    change(field<HTMLSelectElement>(el, 'dpe_energy'), '');
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { dpe_energy: null } });
  });

  it('visit_at : datetime-local converti en RFC 3339 avec décalage', () => {
    const { el } = setup();
    change(field<HTMLInputElement>(el, 'visit_at'), '2026-10-25T14:30');
    const call = sync.dispatch.mock.calls[0];
    expect(call[0]).toBe('set_fiche');
    expect(call[1].fields.visit_at).toMatch(/^2026-10-25T14:30:00[+-]\d{2}:\d{2}$/);
  });

  it('visite clôturée : champs désactivés', () => {
    const { el } = setup(makeState({ closed: true }));
    const inputs = Array.from(el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.disabled)).toBe(true);
  });
});
