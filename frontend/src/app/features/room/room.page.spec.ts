import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api.client';
import { Point, VisitState } from '../../core/api.types';
import { getDeviceId } from '../../core/device-id';
import { LocalStore } from '../../core/local-store';
import { SyncService, SyncStatus } from '../../core/sync.service';
import { provideAppIcons } from '../../shared/icons';
import { RoomPage } from './room.page';

const point = (id: string, room_id: string, over: Partial<Point> = {}): Point =>
  ({ id, room_id, label: `Point ${id}`, type: 'note', options: [], weight: 1, position: 0, ...over });

function makeState(closed = false): VisitState {
  return {
    seq: 1,
    me: { number: 1 },
    visit: { code: 'maison-x', closed_at: closed ? '2026-10-25T10:00:00Z' : null, fiche: { address: 'x' } },
    rooms: [
      { id: 'r2', name: 'Cuisine', dir_name: 'cuisine', kind: 'room', position: 2, hidden: false },
      { id: 'r1', name: 'Salon', dir_name: 'salon', kind: 'room', position: 1, hidden: false },
      { id: 'r3', name: 'Cave', dir_name: 'cave', kind: 'room', position: 3, hidden: true },
      { id: 'r4', name: 'Garage', dir_name: 'garage', kind: 'room', position: 4, hidden: false },
    ],
    points: [
      point('p1', 'r1', { type: 'case' }),
      point('p2', 'r1', { position: 1 }),
      point('c1', 'r2'),
    ],
    questions: [{ id: 'q1', room_id: 'r1', text: 'Quel chauffage ?', position: 0 }],
    shared: [
      { target_id: 'q1', field: 'answer', value: 'Gaz', updated_at: 1, author: 2 },
      { target_id: 'r1', field: 'area_m2', value: 20, updated_at: 1, author: 2 },
    ],
    ratings: [],
    comments: [{ room_id: 'r1', text: 'Lumineux', updated_at: 1 }],
    photos: [
      { id: 'ph-local', room_id: 'r1', author: 1, taken_at: 'x' },
      { id: 'ph-remote', room_id: 'r1', author: 2, taken_at: 'x' },
      { id: 'ph-other', room_id: 'r2', author: 1, taken_at: 'x' },
    ],
  } as unknown as VisitState;
}

describe('RoomPage', () => {
  const state = signal<VisitState | null>(null);
  const status = signal<SyncStatus>({ online: true, pendingOps: 0, pendingPhotos: 0, error: null });
  const sync = { state, status, dispatch: vi.fn(), addPhoto: vi.fn() };
  const api = { photoUrl: vi.fn() };
  const store = { pendingPhotos: vi.fn() };
  const snack = { open: vi.fn() };
  let params: BehaviorSubject<ParamMap>;

  beforeEach(() => {
    vi.resetAllMocks();
    params = new BehaviorSubject(convertToParamMap({ roomId: 'r1' }));
    sync.dispatch.mockResolvedValue(undefined);
    api.photoUrl.mockImplementation((c: string, id: string, d: string) => `/api/${c}/${id}?d=${d}`);
    store.pendingPhotos.mockResolvedValue([{ id: 'ph-local', code: 'maison-x', room_id: 'r1', taken_at: 'x', blob: new Blob(['x']) }]);
    URL.createObjectURL = vi.fn(() => 'blob:local');
    URL.revokeObjectURL = vi.fn();
    state.set(makeState());
    TestBed.configureTestingModule({
      imports: [RoomPage],
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: ApiClient, useValue: api },
        { provide: LocalStore, useValue: store },
        { provide: MatSnackBar, useValue: snack },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params, parent: { paramMap: new BehaviorSubject(convertToParamMap({ code: 'maison-x' })) } },
        },
        provideAppIcons(),
      ],
    });
  });

  async function setup() {
    await getDeviceId(); // chauffe le cache : la page le lit au premier tick
    const fixture = TestBed.createComponent(RoomPage);
    fixture.detectChanges();
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      TestBed.inject(ApplicationRef).tick();
      fixture.detectChanges();
    }
  };
  const q = <T extends HTMLElement>(el: HTMLElement, sel: string) => el.querySelector(sel) as T;

  it('affiche les points de la pièce, ses questions et ses valeurs', async () => {
    const { el } = await setup();
    expect(q(el, '[data-test=room-name]').textContent).toContain('Salon');
    expect(el.querySelectorAll('app-point-card').length).toBe(2);
    expect(q<HTMLTextAreaElement>(el, '[data-test=answer]').value).toBe('Gaz');
    expect(q<HTMLTextAreaElement>(el, '[data-test=comment]').value).toBe('Lumineux');
    expect(q<HTMLInputElement>(el, '[data-test=area]').value).toBe('20');
  });

  it('affiche l\'auteur d\'une réponse partagée, rien pour une réponse vide', async () => {
    const { fixture, el } = await setup();
    expect(q(el, '.question [data-test=answer-author]').textContent?.trim()).toBe('P2');
    const s = makeState();
    s.shared[0] = { ...s.shared[0], value: '' };
    state.set(s);
    await settle(fixture);
    expect(el.querySelector('.question [data-test=answer-author]')).toBeNull();
  });

  it('un clic sur un bouton de note dispatche set_rating ; une case dispatche set_shared value', async () => {
    const { el } = await setup();
    const cards = el.querySelectorAll('app-point-card');
    (cards[0].querySelectorAll('[data-test=choice]')[1] as HTMLButtonElement).click(); // Problème
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'p1', field: 'value', value: 'problem' });
    (cards[1].querySelectorAll('[data-test=choice]')[3] as HTMLButtonElement).click(); // 4
    expect(sync.dispatch).toHaveBeenCalledWith('set_rating', { point_id: 'p2', value: 4 });
  });

  it('la réponse est enregistrée à la perte du focus, seulement si elle a changé', async () => {
    const { el } = await setup();
    const answer = q<HTMLTextAreaElement>(el, '[data-test=answer]');
    answer.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).not.toHaveBeenCalled();
    answer.value = 'Électrique';
    answer.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q1', field: 'answer', value: 'Électrique' });
  });

  it('commentaire et surface : enregistrés à la perte du focus si modifiés', async () => {
    const { el } = await setup();
    const comment = q<HTMLTextAreaElement>(el, '[data-test=comment]');
    comment.dispatchEvent(new Event('blur'));
    comment.value = 'Sombre';
    comment.dispatchEvent(new Event('blur'));
    const area = q<HTMLInputElement>(el, '[data-test=area]');
    area.dispatchEvent(new Event('blur'));
    area.value = '22,5';
    area.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).toHaveBeenCalledTimes(2);
    expect(sync.dispatch).toHaveBeenCalledWith('set_comment', { room_id: 'r1', text: 'Sombre' });
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'r1', field: 'area_m2', value: 22.5 });
  });

  it('surface décimale : affichée avec une virgule, rétablie avec une virgule', async () => {
    const withArea = makeState();
    withArea.shared.find((v) => v.target_id === 'r1' && v.field === 'area_m2')!.value = 22.5;
    state.set(withArea);
    const { el } = await setup();
    const area = q<HTMLInputElement>(el, '[data-test=area]');
    expect(area.value).toBe('22,5');
    area.value = ',';
    area.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(area.value).toBe('22,5'));
  });

  it('surface : une virgule seule n\'envoie rien et rétablit la valeur affichée', async () => {
    const { el } = await setup();
    const area = q<HTMLInputElement>(el, '[data-test=area]');
    area.value = ',';
    area.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(area.value).toBe('20'));
    expect(sync.dispatch).not.toHaveBeenCalled();
  });

  it('« Posée » dispatche set_shared asked', async () => {
    const { el } = await setup();
    q<HTMLInputElement>(el, '[data-test=asked] input').click();
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q1', field: 'asked', value: true });
  });

  it('« Suivante » mène à la pièce visible suivante, « Précédente » est désactivée en première', async () => {
    const { el } = await setup();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    expect(q<HTMLButtonElement>(el, '[data-test=prev]').disabled).toBe(true);
    q<HTMLButtonElement>(el, '[data-test=next]').click();
    expect(nav).toHaveBeenCalledWith(['/v', 'maison-x', 'room', 'r2']);
  });

  it('un changement de paramètre vers la pièce suivante réaffiche la nouvelle pièce', async () => {
    const { fixture, el } = await setup();
    params.next(convertToParamMap({ roomId: 'r2' }));
    await settle(fixture);
    expect(q(el, '[data-test=room-name]').textContent).toContain('Cuisine');
    expect(el.querySelectorAll('app-point-card').length).toBe(1);
    // r3 est cachée : la suivante de r2 est r4
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    q<HTMLButtonElement>(el, '[data-test=next]').click();
    expect(nav).toHaveBeenCalledWith(['/v', 'maison-x', 'room', 'r4']);
  });

  it('renommer : valeur nettoyée, vide refusée', async () => {
    const { fixture, el } = await setup();
    q<HTMLButtonElement>(el, '[data-test=rename]').click();
    fixture.detectChanges();
    const input = q<HTMLInputElement>(el, '[data-test=rename-input]');
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    q<HTMLButtonElement>(el, '[data-test=rename-confirm]').click();
    expect(sync.dispatch).not.toHaveBeenCalled();
    input.value = '  Séjour ';
    input.dispatchEvent(new Event('input'));
    q<HTMLButtonElement>(el, '[data-test=rename-confirm]').click();
    expect(sync.dispatch).toHaveBeenCalledWith('rename_room', { room_id: 'r1', name: 'Séjour' });
  });

  it('photos : blob local si encore en file, sinon photoUrl', async () => {
    const { el } = await setup();
    const srcs = Array.from(el.querySelectorAll<HTMLImageElement>('[data-test=thumb]')).map((i) => i.getAttribute('src'));
    expect(srcs).toEqual(['blob:local', `/api/maison-x/ph-remote?d=${await getDeviceId()}`]);
  });

  it('révoque l\'URL locale à la destruction', async () => {
    const { fixture } = await setup();
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local');
  });

  it('visite clôturée : tout est désactivé', async () => {
    state.set(makeState(true));
    const { el } = await setup();
    const controls = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-test=choice], [data-test=add-point], [data-test=add-question], [data-test=hide], [data-test=photo-btn], [data-test=rename]'));
    expect(controls.length).toBeGreaterThan(5);
    expect(controls.every((b) => b.disabled)).toBe(true);
    expect(q<HTMLTextAreaElement>(el, '[data-test=answer]').disabled).toBe(true);
    expect(q<HTMLTextAreaElement>(el, '[data-test=comment]').disabled).toBe(true);
    expect(q<HTMLInputElement>(el, '[data-test=area]').disabled).toBe(true);
  });

  it('une erreur de photo est signalée dans un snackbar', async () => {
    sync.addPhoto.mockRejectedValue(new Error('x'));
    const { fixture } = await setup();
    const page = fixture.componentInstance as unknown as { addPhoto(b: Blob): Promise<void> };
    const blob = new Blob(['x']);
    await page.addPhoto(blob);
    expect(sync.addPhoto).toHaveBeenCalledWith('r1', blob);
    expect(snack.open).toHaveBeenCalledWith('Photo non enregistrée', 'OK', expect.anything());
  });

  it('« + Point » (constat) dispatche add_point avec les options découpées', async () => {
    const { fixture, el } = await setup();
    q<HTMLButtonElement>(el, '[data-test=add-point]').click();
    await settle(fixture);
    const body = document.body;
    const confirm = q<HTMLButtonElement>(body, '[data-test=confirm]');
    const label = q<HTMLInputElement>(body, '[data-test=point-label]');
    label.value = 'Revêtement';
    label.dispatchEvent(new Event('input'));
    q<HTMLInputElement>(body, '[data-test=type-constat] input').click();
    await settle(fixture);
    expect(confirm.disabled).toBe(true); // options requises
    const options = q<HTMLInputElement>(body, '[data-test=point-options]');
    options.value = ' Parquet, Carrelage ,';
    options.dispatchEvent(new Event('input'));
    await settle(fixture);
    confirm.click();
    await vi.waitFor(() => expect(sync.dispatch).toHaveBeenCalled());
    expect(sync.dispatch).toHaveBeenCalledWith('add_point', {
      id: expect.any(String), room_id: 'r1', label: 'Revêtement', type: 'constat', options: ['Parquet', 'Carrelage'],
    });
  });

  it('« Masquer la pièce » demande confirmation, dispatche hide_room puis revient aux pièces', async () => {
    const { fixture, el } = await setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    q<HTMLButtonElement>(el, '[data-test=hide]').click();
    await settle(fixture);
    expect(sync.dispatch).not.toHaveBeenCalled();
    q<HTMLButtonElement>(document.body, '[data-test=confirm]').click();
    await vi.waitFor(() => expect(sync.dispatch).toHaveBeenCalledWith('hide_room', { room_id: 'r1' }));
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith(['/v', 'maison-x', 'rooms']));
  });

  it('navigation sans perte de focus : la réponse saisie est enregistrée pour l\'ancienne question', async () => {
    const { el } = await setup();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const answer = q<HTMLTextAreaElement>(el, '[data-test=answer]');
    answer.value = 'Pompe à chaleur';
    answer.dispatchEvent(new Event('input'));
    q<HTMLButtonElement>(el, '[data-test=next]').click();
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q1', field: 'answer', value: 'Pompe à chaleur' });
  });

  it('changement de pièce par l\'URL : le commentaire en cours est enregistré pour l\'ancienne pièce', async () => {
    const { fixture, el } = await setup();
    const comment = q<HTMLTextAreaElement>(el, '[data-test=comment]');
    comment.value = 'À revoir';
    comment.dispatchEvent(new Event('input'));
    params.next(convertToParamMap({ roomId: 'r2' }));
    await settle(fixture);
    expect(sync.dispatch).toHaveBeenCalledWith('set_comment', { room_id: 'r1', text: 'À revoir' });
    expect(q<HTMLTextAreaElement>(el, '[data-test=comment]').value).toBe('');
  });

  it('destruction de la page : le commentaire en cours est enregistré', async () => {
    const { fixture, el } = await setup();
    const comment = q<HTMLTextAreaElement>(el, '[data-test=comment]');
    comment.value = 'Humide';
    comment.dispatchEvent(new Event('input'));
    fixture.destroy();
    expect(sync.dispatch).toHaveBeenCalledWith('set_comment', { room_id: 'r1', text: 'Humide' });
  });

  it('application masquée ou fermée avec un champ actif : le brouillon est enregistré', async () => {
    const { fixture, el } = await setup();
    const comment = q<HTMLTextAreaElement>(el, '[data-test=comment]');
    comment.value = 'Humide';
    comment.dispatchEvent(new Event('input'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(fixture);
    expect(sync.dispatch).toHaveBeenCalledWith('set_comment', { room_id: 'r1', text: 'Humide' });
    visibility.mockRestore();

    sync.dispatch.mockClear();
    const answer = q<HTMLTextAreaElement>(el, '[data-test=answer]');
    answer.value = 'Fioul';
    answer.dispatchEvent(new Event('input'));
    window.dispatchEvent(new Event('pagehide'));
    await settle(fixture);
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q1', field: 'answer', value: 'Fioul' });
  });

  it('retour au premier plan : rien n\'est envoyé ; après destruction, plus d\'écoute', async () => {
    const { fixture, el } = await setup();
    const comment = q<HTMLTextAreaElement>(el, '[data-test=comment]');
    comment.value = 'Humide';
    comment.dispatchEvent(new Event('input'));
    document.dispatchEvent(new Event('visibilitychange')); // visible
    expect(sync.dispatch).not.toHaveBeenCalled();
    fixture.destroy();
    sync.dispatch.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    expect(sync.dispatch).not.toHaveBeenCalled();
  });

  it('échec d\'enregistrement : le brouillon est gardé à l\'écran', async () => {
    sync.dispatch.mockRejectedValue(new Error('quota'));
    const { fixture, el } = await setup();
    const comment = q<HTMLTextAreaElement>(el, '[data-test=comment]');
    comment.value = 'Humide';
    comment.dispatchEvent(new Event('input'));
    await settle(fixture); // comme dans l'appli : l'affichage suit la saisie
    comment.dispatchEvent(new Event('blur'));
    await settle(fixture);
    expect(snack.open).toHaveBeenCalled();
    expect(q<HTMLTextAreaElement>(el, '[data-test=comment]').value).toBe('Humide');
  });

  it('une réponse distante n\'écrase pas le champ en cours de saisie', async () => {
    const { fixture, el } = await setup();
    const answer = q<HTMLTextAreaElement>(el, '[data-test=answer]');
    answer.focus();
    answer.value = 'Électrique';
    answer.dispatchEvent(new Event('input'));
    const s = makeState();
    s.shared = s.shared.map((v) => (v.field === 'answer' ? { ...v, value: 'Fioul', author: 3 } : v));
    state.set(s);
    await settle(fixture);
    expect(answer.value).toBe('Électrique');
    answer.dispatchEvent(new Event('blur'));
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q1', field: 'answer', value: 'Électrique' });
  });

  it('masquage : pas de navigation si hide_room échoue', async () => {
    sync.dispatch.mockRejectedValue(new Error('plein'));
    const { fixture, el } = await setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    q<HTMLButtonElement>(el, '[data-test=hide]').click();
    await settle(fixture);
    q<HTMLButtonElement>(document.body, '[data-test=confirm]').click();
    await vi.waitFor(() => expect(snack.open).toHaveBeenCalled());
    expect(nav).not.toHaveBeenCalled();
  });
});
