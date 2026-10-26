import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Fiche, VisitState } from '../../core/api.types';
import { SyncService } from '../../core/sync.service';
import { provideAppIcons } from '../../shared/icons';
import { FicheTabComponent } from './fiche-tab.component';

function makeState(
  over: { creator?: boolean; closed?: boolean; notes?: string } = {},
  fiche: Partial<Fiche> = {},
): VisitState {
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
    rooms: [], points: [], questions: [], ratings: [], comments: [], photos: [],
    shared: over.notes === undefined ? [] : [{ target_id: 'maison-x', field: 'notes', value: over.notes, updated_at: 1, author: 2 }],
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

  it('non-créateur : texte en lecture seule, aucun champ de saisie hormis les notes', () => {
    const { el } = setup(makeState({ creator: false }));
    expect(el.querySelectorAll('input, select, textarea:not([data-test=visit-notes])').length).toBe(0);
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

  it('nombres : vide → null, virgule décimale lue comme un point', () => {
    const { el } = setup();
    change(field<HTMLInputElement>(el, 'price_eur'), '');
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { price_eur: null } });
    sync.dispatch.mockClear();
    change(field<HTMLInputElement>(el, 'living_area_m2'), '85,5');
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { living_area_m2: 85.5 } });
    sync.dispatch.mockClear();
    change(field<HTMLInputElement>(el, 'living_area_m2'), ',');
    expect(sync.dispatch).not.toHaveBeenCalled();
  });

  it('surface décimale : affichée avec une virgule, en saisie comme en lecture', () => {
    const { el } = setup(makeState({}, { living_area_m2: 85.5 }));
    expect(field<HTMLInputElement>(el, 'living_area_m2').value).toBe('85,5');
    const { el: el2 } = setup(makeState({ creator: false }, { living_area_m2: 85.5 }));
    expect(text(el2, '[data-field=living_area_m2]')).toContain('85,5');
  });

  it('nombre collé dans un champ vide : envoyé à la sortie du champ', () => {
    const { el } = setup(makeState({}, { living_area_m2: null }));
    const input = field<HTMLInputElement>(el, 'living_area_m2');
    const paste = new Event('paste', { cancelable: true, bubbles: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '85,5 m²' } });
    input.dispatchEvent(paste);
    expect(sync.dispatch).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { living_area_m2: 85.5 } });
  });

  it('champs numériques : texte filtré (entier pour prix, pièces, chambres, année ; décimal pour les surfaces)', () => {
    const { el } = setup();
    for (const name of ['price_eur', 'rooms_count', 'bedrooms_count', 'construction_year']) {
      const input = field<HTMLInputElement>(el, name);
      expect(input.type).toBe('text');
      expect(input.getAttribute('inputmode')).toBe('numeric');
    }
    for (const name of ['living_area_m2', 'floor_area_m2', 'land_area_m2']) {
      const input = field<HTMLInputElement>(el, name);
      expect(input.type).toBe('text');
      expect(input.getAttribute('inputmode')).toBe('decimal');
    }
    change(field<HTMLInputElement>(el, 'rooms_count'), '4');
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { rooms_count: 4 } });
  });

  it('DPE : sélection d\'une classe et retour à « — »', () => {
    const { el } = setup();
    change(field<HTMLSelectElement>(el, 'dpe_ges'), 'B');
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { dpe_ges: 'B' } });
    change(field<HTMLSelectElement>(el, 'dpe_energy'), '');
    expect(sync.dispatch).toHaveBeenCalledWith('set_fiche', { fields: { dpe_energy: null } });
  });

  it('visit_at : date et heure tapées, envoyées en RFC 3339 avec décalage', async () => {
    const { fixture, el } = setup();
    await fixture.whenStable();
    const type = (sel: string, v: string) => {
      const input = el.querySelector<HTMLInputElement>(`[data-field=visit_at] ${sel}`)!;
      input.value = v;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('change'));
      input.dispatchEvent(new Event('blur'));
    };
    type('[data-test=date]', '25/10/2026');
    type('[data-test=time]', '1430');
    const calls = sync.dispatch.mock.calls.filter((c) => 'visit_at' in c[1].fields);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[calls.length - 1][0]).toBe('set_fiche');
    expect(calls[calls.length - 1][1].fields.visit_at).toMatch(/^2026-10-25T14:30:00[+-]\d{2}:\d{2}$/);
  });

  it('visit_at inchangée : aucun envoi', async () => {
    const { fixture, el } = setup(makeState({}, { visit_at: '2026-10-25T14:30:00+01:00' }));
    await fixture.whenStable();
    const time = el.querySelector<HTMLInputElement>('[data-field=visit_at] [data-test=time]')!;
    time.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).not.toHaveBeenCalled();
  });

  it('visit_at stockée avec des secondes : sortie du champ heure sans envoi', async () => {
    const { fixture, el } = setup(makeState({}, { visit_at: '2026-10-25T14:30:45+01:00' }));
    await fixture.whenStable();
    el.querySelector<HTMLInputElement>('[data-field=visit_at] [data-test=time]')!.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).not.toHaveBeenCalled();
  });

  it('notes : modifiables par un participant non créateur, envoyées à la perte du focus si modifiées', () => {
    const { el } = setup(makeState({ creator: false, notes: 'Rappeler l\'agent' }));
    const notes = el.querySelector<HTMLTextAreaElement>('[data-test=visit-notes]')!;
    expect(notes.value).toBe('Rappeler l\'agent');
    // affichées en premier, avant les champs du bien
    expect(notes.compareDocumentPosition(field(el, 'address')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notes.disabled).toBe(false);
    expect(text(el, '[data-test=visit-notes-author]')).toBe('P2');
    notes.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).not.toHaveBeenCalled();
    notes.value = 'Rappeler l\'agent lundi';
    notes.dispatchEvent(new Event('input'));
    notes.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'maison-x', field: 'notes', value: 'Rappeler l\'agent lundi' });
  });

  it('notes : une modification distante n\'écrase pas la saisie en cours', () => {
    const { fixture, el } = setup(makeState({ notes: 'A' }));
    const notes = el.querySelector<HTMLTextAreaElement>('[data-test=visit-notes]')!;
    notes.value = 'B';
    notes.dispatchEvent(new Event('input'));
    state.set(makeState({ notes: 'C' }));
    fixture.detectChanges();
    expect(notes.value).toBe('B');
  });

  it('notes : la saisie en cours est enregistrée quand l\'application passe en arrière-plan et à la destruction', () => {
    const { fixture, el } = setup();
    const notes = el.querySelector<HTMLTextAreaElement>('[data-test=visit-notes]')!;
    notes.value = 'Parking';
    notes.dispatchEvent(new Event('input'));
    window.dispatchEvent(new Event('pagehide'));
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'maison-x', field: 'notes', value: 'Parking' });
    sync.dispatch.mockClear();
    notes.value = 'Parking devant';
    notes.dispatchEvent(new Event('input'));
    fixture.destroy();
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'maison-x', field: 'notes', value: 'Parking devant' });
  });

  it('notes : échec d\'enregistrement signalé, saisie gardée', async () => {
    sync.dispatch.mockRejectedValue(new Error('x'));
    const { fixture, el } = setup();
    const notes = el.querySelector<HTMLTextAreaElement>('[data-test=visit-notes]')!;
    notes.value = 'Parking';
    notes.dispatchEvent(new Event('input'));
    notes.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(snack.open).toHaveBeenCalled());
    fixture.detectChanges();
    expect(notes.value).toBe('Parking');
  });

  it('visite clôturée : champs désactivés', async () => {
    const { fixture, el } = setup(makeState({ closed: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    const inputs = Array.from(el.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'));
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((i) => i.disabled)).toBe(true);
    expect(el.querySelector<HTMLTextAreaElement>('[data-test=visit-notes]')?.disabled).toBe(true);
  });
});
