import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../core/api.client';
import { VisitState } from '../../core/api.types';
import { SyncService } from '../../core/sync.service';
import { provideAppIcons } from '../../shared/icons';
import { SummaryTabComponent } from './summary-tab.component';

function makeState(over: { creator?: boolean; closed?: boolean; unasked?: boolean; rated?: boolean } = {}): VisitState {
  const rated = over.rated ?? true;
  return {
    seq: 1,
    me: { number: 1 },
    visit: {
      code: 'maison-x',
      is_creator: over.creator ?? true,
      closed_at: over.closed ? 'x' : null,
      fiche: { address: 'x', price_eur: 200000 },
    },
    rooms: [
      { id: 'r1', name: 'Salon', dir_name: 'salon', kind: 'room', position: 1, hidden: false },
      { id: 'r9', name: 'Bilan', dir_name: 'bilan', kind: 'summary', position: 9, hidden: false },
    ],
    points: [
      { id: 'p1', room_id: 'r1', label: 'Humidité', type: 'case', options: [], weight: 1, position: 1 },
      { id: 's1', room_id: 'r9', label: 'Quartier', type: 'note', options: [], weight: 4, position: 1 },
      { id: 's2', room_id: 'r9', label: 'Prix', type: 'note', options: [], weight: 1, position: 2 },
    ],
    questions: [{ id: 'q1', room_id: 'r1', text: 'Chauffage ?', position: 1 }],
    shared: [
      { target_id: 'p1', field: 'blocking', value: true, updated_at: 1, author: 2 },
      { target_id: 'p1', field: 'works_eur', value: 5000, updated_at: 1, author: 2 },
      ...(over.unasked === false ? [{ target_id: 'q1', field: 'asked', value: true, updated_at: 1, author: 1 }] : []),
    ],
    ratings: rated
      ? [
          { point_id: 's1', value: 4, updated_at: 1 },
          { point_id: 's2', value: 5, updated_at: 1 },
        ]
      : [],
    comments: [],
    photos: [],
  } as unknown as VisitState;
}

describe('SummaryTabComponent', () => {
  const state = signal<VisitState | null>(null);
  const sync = { state, dispatch: vi.fn() };
  const api = { exportCsv: vi.fn() };
  const snack = { open: vi.fn() };
  const dialog = { open: vi.fn() };
  const writeText = vi.fn();

  function setup(s = makeState()) {
    state.set(s);
    const fixture = TestBed.createComponent(SummaryTabComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const text = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const click = (el: HTMLElement, sel: string) => (el.querySelector(sel) as HTMLElement).click();
  const flushAll = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sync.dispatch.mockResolvedValue(undefined);
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    TestBed.configureTestingModule({
      imports: [SummaryTabComponent],
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: ApiClient, useValue: api },
        { provide: MatSnackBar, useValue: snack },
        { provide: MatDialog, useValue: dialog },
        provideRouter([]),
        provideAppIcons(),
      ],
    });
  });

  it('affiche les points du récapitulatif avec leur poids et mon score', () => {
    const { el } = setup();
    expect(el.querySelectorAll('app-point-card').length).toBe(2);
    expect(el.querySelector('app-point-card')?.textContent).toContain('Quartier');
    expect(text(el, '[data-test=score]')).toBe('Mon score : 4,2 / 5');
  });

  it('score absent : « Mon score : — »', () => {
    const { el } = setup(makeState({ rated: false }));
    expect(text(el, '[data-test=score]')).toBe('Mon score : —');
  });

  it('noter un point dispatche set_rating', () => {
    const { el } = setup();
    const first = el.querySelector('app-point-card') as HTMLElement;
    const buttons = Array.from(first.querySelectorAll('button')).filter((b) => b.textContent?.trim() === '2');
    buttons[0].click();
    expect(sync.dispatch).toHaveBeenCalledWith('set_rating', { point_id: 's1', value: 2 });
  });

  it('liste les points bloquants (pièce — libellé), sinon « Aucun point bloquant »', () => {
    const { el } = setup();
    expect(Array.from(el.querySelectorAll('[data-test=blocking] li')).map((l) => l.textContent?.trim())).toEqual([
      'Salon — Humidité',
    ]);
    const s = makeState();
    s.shared = [];
    const { el: el2 } = setup(s);
    expect(text(el2, '[data-test=no-blocking]')).toBe('Aucun point bloquant');
  });

  it('affiche le total des travaux et le prix réel', () => {
    const { el } = setup();
    expect(text(el, '[data-test=works]')?.replace(/\s/g, ' ')).toContain('5 000');
    // 200 000 + 15 000 + 5 000
    expect(text(el, '[data-test=real-price]')?.replace(/\s/g, ' ')).toContain('220 000');
  });

  it('alerte sur les questions non posées avec lien vers l\'onglet Questions, absente à 0', () => {
    const { el } = setup();
    expect(text(el, '[data-test=unasked]')).toContain('1 question non posée');
    expect(el.querySelector('[data-test=unasked] a')?.getAttribute('href')).toBe('/v/maison-x/questions');
    expect(setup(makeState({ unasked: false })).el.querySelector('[data-test=unasked]')).toBeNull();
  });

  it('« Copier pour Sheets » appelle exportCsv(code, tab) puis le presse-papiers', async () => {
    api.exportCsv.mockResolvedValue(new Blob(['a\tb']));
    writeText.mockResolvedValue(undefined);
    const { el } = setup();
    click(el, '[data-test=copy]');
    await flushAll();
    expect(api.exportCsv).toHaveBeenCalledWith('maison-x', 'tab');
    expect(writeText).toHaveBeenCalledWith('a\tb');
    expect(snack.open).toHaveBeenCalledWith('Copié dans le presse-papiers', 'OK', expect.anything());
  });

  it('copie impossible : message', async () => {
    api.exportCsv.mockResolvedValue(new Blob(['x']));
    writeText.mockRejectedValue(new Error('refusé'));
    const { el } = setup();
    click(el, '[data-test=copy]');
    await flushAll();
    expect(snack.open).toHaveBeenCalledWith('Copie impossible', 'OK', expect.anything());
  });

  it('« Exporter le CSV » télécharge <code>.csv puis révoque l\'URL', async () => {
    api.exportCsv.mockResolvedValue(new Blob(['x']));
    URL.createObjectURL = vi.fn(() => 'blob:csv');
    URL.revokeObjectURL = vi.fn();
    let downloaded = '';
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    const { el } = setup();
    click(el, '[data-test=export]');
    await flushAll();
    expect(api.exportCsv).toHaveBeenCalledWith('maison-x', 'semicolon');
    expect(downloaded).toBe('maison-x.csv');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv');
    spy.mockRestore();
  });

  it('hors ligne : « Il faut du réseau pour exporter » pour l\'export et la copie', async () => {
    api.exportCsv.mockRejectedValue(new ApiError(0, 'réseau'));
    const { el } = setup();
    click(el, '[data-test=export]');
    await flushAll();
    click(el, '[data-test=copy]');
    await flushAll();
    expect(snack.open).toHaveBeenCalledTimes(2);
    expect(snack.open).toHaveBeenNthCalledWith(1, 'Il faut du réseau pour exporter', 'OK', expect.anything());
    expect(snack.open).toHaveBeenNthCalledWith(2, 'Il faut du réseau pour exporter', 'OK', expect.anything());
  });

  it('« Clôturer la visite » absent pour un non-créateur', () => {
    expect(setup(makeState({ creator: false })).el.querySelector('[data-test=close]')).toBeNull();
  });

  it('« Clôturer la visite » demande confirmation puis dispatche close_visit', async () => {
    const { el } = setup();
    click(el, '[data-test=close]');
    await flushAll();
    expect(dialog.open).toHaveBeenCalled();
    expect(sync.dispatch).toHaveBeenCalledWith('close_visit', {});
  });

  it('confirmation refusée : rien n\'est envoyé', async () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
    const { el } = setup();
    click(el, '[data-test=close]');
    await flushAll();
    expect(sync.dispatch).not.toHaveBeenCalled();
  });

  it('visite clôturée : clôture et notes désactivées, export et copie actifs', () => {
    const { el } = setup(makeState({ closed: true }));
    expect((el.querySelector('[data-test=close]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('[data-test=export]') as HTMLButtonElement).disabled).toBe(false);
    expect((el.querySelector('[data-test=copy]') as HTMLButtonElement).disabled).toBe(false);
    expect((el.querySelector('app-point-card button') as HTMLButtonElement).disabled).toBe(true);
  });
});
