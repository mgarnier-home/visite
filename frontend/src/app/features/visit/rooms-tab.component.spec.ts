import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiClient } from '../../core/api.client';
import { Point, VisitState } from '../../core/api.types';
import { SyncService } from '../../core/sync.service';
import { provideAppIcons } from '../../shared/icons';
import { RoomsTabComponent } from './rooms-tab.component';

const point = (id: string, room_id: string): Point =>
  ({ id, room_id, label: id, type: 'note', options: [], weight: 1, position: 0, important: true });

function makeState(over: { closed?: boolean; packing?: string } = {}): VisitState {
  const points = Array.from({ length: 9 }, (_, i) => point(`p${i}`, 'r1'));
  return {
    seq: 1,
    me: { number: 1 },
    visit: {
      code: 'maison-x',
      closed_at: over.closed ? '2026-10-25T10:00:00Z' : null,
      packing_list: over.packing ?? '',
      fiche: { address: '12 rue des Lilas' },
    },
    rooms: [
      { id: 'r2', name: 'Cuisine', dir_name: 'cuisine', kind: 'room', position: 2, hidden: false },
      { id: 'r1', name: 'Salon', dir_name: 'salon', kind: 'room', position: 1, hidden: false },
      { id: 'r3', name: 'Cave', dir_name: 'cave', kind: 'room', position: 3, hidden: true },
    ],
    points: [...points, point('c1', 'r2')],
    questions: [],
    // p0 : ma note ; p1 : N/A (null) ; p2 : valeur partagée ; p3 : valeur partagée vide (non remplie)
    ratings: [
      { point_id: 'p0', value: 4, updated_at: 1 },
      { point_id: 'p1', value: null, updated_at: 1 },
    ],
    shared: [
      { target_id: 'p2', field: 'value', value: 'ok', updated_at: 1, author: 2 },
      { target_id: 'p3', field: 'value', value: null, updated_at: 1, author: 2 },
      { target_id: 'c1', field: 'blocking', value: true, updated_at: 1, author: 2 },
    ],
    comments: [],
    photos: [],
  } as unknown as VisitState;
}

describe('RoomsTabComponent', () => {
  const state = signal<VisitState | null>(null);
  const sync = { state, dispatch: vi.fn(), addPhoto: vi.fn() };
  const api = { getTemplate: vi.fn() };
  const snack = { open: vi.fn() };

  function setup(s: VisitState) {
    state.set(s);
    TestBed.configureTestingModule({
      imports: [RoomsTabComponent],
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: ApiClient, useValue: api },
        { provide: MatSnackBar, useValue: snack },
        provideRouter([]),
        provideAppIcons(),
      ],
    });
    const fixture = TestBed.createComponent(RoomsTabComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  // le dialogue vit dans l'overlay : il faut un tick de l'application, pas seulement de la fixture
  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      await fixture.whenStable();
      TestBed.inject(ApplicationRef).tick();
      fixture.detectChanges();
    }
  };

  beforeEach(() => {
    vi.resetAllMocks();
    api.getTemplate.mockResolvedValue({
      version: 1,
      packing_list: '',
      sections: [
        { id: 's-sum', name: 'Bilan', kind: 'summary', position: 9, points: [], questions: [] },
        { id: 's-kitchen', name: 'Cuisine type', kind: 'room', position: 1, points: [], questions: [] },
        { id: 's-topic', name: 'Sujet', kind: 'topic', position: 2, points: [], questions: [] },
      ],
    });
  });

  it('affiche remplis / total, N/A et valeur partagée comptés, pièces cachées exclues, triées', () => {
    const { el } = setup(makeState());
    const rooms = Array.from(el.querySelectorAll('[data-test=room]'));
    expect(rooms.map((r) => r.querySelector('.name')?.textContent)).toEqual(['Salon', 'Cuisine']);
    expect(rooms[0].querySelector('[data-test=progress]')?.textContent?.trim()).toBe('3 / 9');
    expect(rooms[1].querySelector('[data-test=progress]')?.textContent?.trim()).toBe('0 / 1');
    expect(rooms[0].getAttribute('href')).toBe('/v/maison-x/room/r1');
  });

  it('affiche 2 / 9 pour une pièce avec deux points remplis', () => {
    const s = makeState();
    s.shared = [];
    const { el } = setup(s);
    expect(el.querySelector('[data-test=progress]')?.textContent?.trim()).toBe('2 / 9');
  });

  it('affiche N / M posées pour une pièce sans point, les autres gardent remplis / total', () => {
    const s = makeState();
    s.rooms.push({ id: 'r4', name: 'Sujet', dir_name: 'sujet', kind: 'topic', position: 4, hidden: false } as VisitState['rooms'][number]);
    s.questions = ['q1', 'q2', 'q3'].map((id) => ({ id, room_id: 'r4', text: id })) as unknown as VisitState['questions'];
    s.shared = [
      { target_id: 'q1', field: 'asked', value: true, updated_at: 1, author: 2 },
      { target_id: 'q2', field: 'asked', value: false, updated_at: 1, author: 2 },
    ] as unknown as VisitState['shared'];
    const { el } = setup(s);
    const progress = Array.from(el.querySelectorAll('[data-test=room]')).map((r) =>
      r.querySelector('[data-test=progress]')?.textContent?.trim(),
    );
    expect(progress).toEqual(['2 / 9', '0 / 1', '1 / 3 posées']);
  });

  it('masque « À emporter » quand la liste est vide, l\'affiche sinon', () => {
    expect(setup(makeState()).el.querySelector('[data-test=packing]')).toBeNull();
    TestBed.resetTestingModule();
    const { el } = setup(makeState({ packing: 'Mètre\nLampe' }));
    expect(el.querySelector('[data-test=packing]')?.textContent).toContain('Mètre');
  });

  it('le dialogue d\'ajout appelle dispatch(add_room) avec la section choisie', async () => {
    const { fixture, el } = setup(makeState());
    (el.querySelector('[data-test=add-room]') as HTMLButtonElement).click();
    await settle(fixture);
    const overlay = document.body;
    // seules les sections room / per_bedroom sont proposées
    const radios = Array.from(overlay.querySelectorAll('mat-radio-button')).map((r) => r.textContent?.trim());
    expect(radios).toEqual(['Pièce vide', 'Cuisine type']);

    const name = overlay.querySelector('[data-test=room-name]') as HTMLInputElement;
    const confirm = overlay.querySelector('[data-test=confirm]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    name.value = '  Cuisine d\'été ';
    name.dispatchEvent(new Event('input'));
    (overlay.querySelectorAll('mat-radio-button input')[1] as HTMLInputElement).click();
    await settle(fixture);
    confirm.click();
    // afterClosed n'émet qu'après l'animation de fermeture
    await vi.waitFor(() => expect(sync.dispatch).toHaveBeenCalled());
    expect(sync.dispatch).toHaveBeenCalledWith('add_room', {
      id: expect.any(String),
      name: 'Cuisine d\'été',
      from_section_id: 's-kitchen',
    });
  });

  it('hors ligne, seule la pièce vide est proposée avec une explication', async () => {
    api.getTemplate.mockRejectedValue(new Error('réseau'));
    const { fixture, el } = setup(makeState());
    (el.querySelector('[data-test=add-room]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(document.body.querySelectorAll('mat-radio-button').length).toBe(1);
    expect(document.body.textContent).toContain('Hors ligne : seule une pièce vide est possible');
    const name = document.body.querySelector('[data-test=room-name]') as HTMLInputElement;
    name.value = 'Garage';
    name.dispatchEvent(new Event('input'));
    await settle(fixture);
    (document.body.querySelector('[data-test=confirm]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(sync.dispatch).toHaveBeenCalled());
    expect(sync.dispatch).toHaveBeenCalledWith('add_room', { id: expect.any(String), name: 'Garage', from_section_id: null });
  });

  it('visite clôturée : ajout et photo désactivés', () => {
    const { el } = setup(makeState({ closed: true }));
    expect((el.querySelector('[data-test=add-room]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('[data-test=photo-btn]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('signale un stockage plein à l\'enregistrement d\'une photo globale', async () => {
    const quota = new Error('full');
    quota.name = 'QuotaExceededError';
    sync.addPhoto.mockRejectedValueOnce(quota).mockRejectedValueOnce(new Error('autre'));
    const { fixture } = setup(makeState());
    const tab = fixture.componentInstance as unknown as { addGlobalPhoto(b: Blob): Promise<void> };
    const blob = new Blob(['x']);
    await tab.addGlobalPhoto(blob);
    expect(sync.addPhoto).toHaveBeenCalledWith(null, blob);
    expect(snack.open).toHaveBeenLastCalledWith('Stockage plein, photo non enregistrée', 'OK', expect.anything());
    await tab.addGlobalPhoto(blob);
    expect(snack.open).toHaveBeenLastCalledWith('Photo non enregistrée', 'OK', expect.anything());
  });
});
