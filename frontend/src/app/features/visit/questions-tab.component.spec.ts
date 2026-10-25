import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VisitState } from '../../core/api.types';
import { SyncService } from '../../core/sync.service';
import { provideAppIcons } from '../../shared/icons';
import { QuestionsTabComponent } from './questions-tab.component';

function makeState(closed = false): VisitState {
  return {
    seq: 1,
    me: { number: 1 },
    visit: { code: 'maison-x', closed_at: closed ? 'x' : null, fiche: { address: 'x' } },
    rooms: [
      { id: 'r2', name: 'Cuisine', dir_name: 'cuisine', kind: 'room', position: 2, hidden: false },
      { id: 'r1', name: 'Salon', dir_name: 'salon', kind: 'room', position: 1, hidden: false },
      { id: 'r3', name: 'Cave', dir_name: 'cave', kind: 'room', position: 3, hidden: true },
    ],
    points: [],
    questions: [
      { id: 'q2', room_id: 'r1', text: 'Quel chauffage ?', position: 2 },
      { id: 'q1', room_id: 'r1', text: 'Quelle isolation ?', position: 1 },
      { id: 'q3', room_id: 'r2', text: 'Hotte ?', position: 1 },
      { id: 'q4', room_id: 'r3', text: 'Humidité ?', position: 1 },
    ],
    shared: [
      { target_id: 'q1', field: 'asked', value: true, updated_at: 1, author: 2 },
      { target_id: 'q2', field: 'answer', value: 'Gaz', updated_at: 1, author: 2 },
    ],
    ratings: [],
    comments: [],
    photos: [],
  } as unknown as VisitState;
}

describe('QuestionsTabComponent', () => {
  const state = signal<VisitState | null>(null);
  const sync = { state, dispatch: vi.fn() };
  const snack = { open: vi.fn() };

  function setup(s = makeState()) {
    state.set(s);
    const fixture = TestBed.createComponent(QuestionsTabComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const texts = (el: HTMLElement, sel: string) => Array.from(el.querySelectorAll(sel)).map((e) => e.textContent?.trim());

  beforeEach(() => {
    vi.resetAllMocks();
    sync.dispatch.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      imports: [QuestionsTabComponent],
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: MatSnackBar, useValue: snack },
        provideAppIcons(),
      ],
    });
  });

  it('groupe les questions des pièces visibles par pièce, triées par position', () => {
    const { el } = setup();
    expect(texts(el, '[data-test=room-name]')).toEqual(['Salon', 'Cuisine']);
    expect(texts(el, '[data-test=question-text]')).toEqual(['Quelle isolation ?', 'Quel chauffage ?', 'Hotte ?']);
  });

  it('le filtre « Non posées seulement » masque les questions posées et les pièces vides', () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-test=unasked-only] button') as HTMLElement).click();
    fixture.detectChanges();
    expect(texts(el, '[data-test=question-text]')).toEqual(['Quel chauffage ?', 'Hotte ?']);
    const s = makeState();
    s.shared.push({ target_id: 'q3', field: 'asked', value: true, updated_at: 1, author: 1 } as never);
    state.set(s);
    fixture.detectChanges();
    expect(texts(el, '[data-test=room-name]')).toEqual(['Salon']);
  });

  it('« Posée » dispatche set_shared asked', () => {
    const { el } = setup();
    (el.querySelectorAll('[data-test=asked] input')[1] as HTMLInputElement).click();
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q2', field: 'asked', value: true });
  });

  it('la réponse est enregistrée à la perte du focus, seulement si elle a changé', async () => {
    const { fixture, el } = setup();
    const answer = el.querySelectorAll<HTMLTextAreaElement>('[data-test=answer]')[1]; // q2, « Gaz »
    answer.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(sync.dispatch).not.toHaveBeenCalled();
    answer.value = 'Électrique';
    answer.dispatchEvent(new Event('input'));
    answer.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(sync.dispatch).toHaveBeenCalledTimes(1);
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q2', field: 'answer', value: 'Électrique' });
  });

  it('échec d\'enregistrement de la réponse : le brouillon est gardé, renvoyé au blur suivant', async () => {
    sync.dispatch.mockRejectedValueOnce(new Error('quota'));
    const { fixture, el } = setup();
    const answer = el.querySelectorAll<HTMLTextAreaElement>('[data-test=answer]')[1]; // q2, « Gaz »
    answer.value = 'Électrique';
    answer.dispatchEvent(new Event('input'));
    fixture.detectChanges(); // comme dans l'appli : l'affichage suit la saisie
    answer.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(snack.open).toHaveBeenCalledWith('Modification non enregistrée', 'OK', expect.anything());
    expect(el.querySelectorAll<HTMLTextAreaElement>('[data-test=answer]')[1].value).toBe('Électrique');
    answer.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(sync.dispatch).toHaveBeenCalledTimes(2);
    expect(sync.dispatch).toHaveBeenLastCalledWith('set_shared', { target_id: 'q2', field: 'answer', value: 'Électrique' });
  });

  it('application masquée ou fermée avec une réponse en cours : elle est enregistrée', async () => {
    const { fixture, el } = setup();
    const answers = el.querySelectorAll<HTMLTextAreaElement>('[data-test=answer]');
    answers[0].value = 'Bonne';
    answers[0].dispatchEvent(new Event('input'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await fixture.whenStable();
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q1', field: 'answer', value: 'Bonne' });
    visibility.mockRestore();

    sync.dispatch.mockClear();
    answers[2].value = 'Oui';
    answers[2].dispatchEvent(new Event('input'));
    window.dispatchEvent(new Event('pagehide'));
    await fixture.whenStable();
    expect(sync.dispatch).toHaveBeenCalledWith('set_shared', { target_id: 'q3', field: 'answer', value: 'Oui' });
    fixture.destroy();
  });

  it('visite clôturée : cases et réponses désactivées', () => {
    const { el } = setup(makeState(true));
    expect(el.querySelector<HTMLInputElement>('[data-test=asked] input')?.disabled).toBe(true);
    expect(el.querySelector<HTMLTextAreaElement>('[data-test=answer]')?.disabled).toBe(true);
  });
});
