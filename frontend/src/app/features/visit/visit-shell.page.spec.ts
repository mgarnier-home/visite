import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiClient, ApiError } from '../../core/api.client';
import { VisitState } from '../../core/api.types';
import { LocalStore } from '../../core/local-store';
import { SyncService, SyncStatus } from '../../core/sync.service';
import { provideAppIcons } from '../../shared/icons';
import { VisitShellPage } from './visit-shell.page';

const stateOf = (address: string, closed = false) =>
  ({ seq: 1, visit: { code: 'maison-x', closed_at: closed ? 'x' : null, fiche: { address } } }) as unknown as VisitState;

describe('VisitShellPage', () => {
  const state = signal<VisitState | null>(null);
  const status = signal<SyncStatus>({ online: true, pendingOps: 0, pendingPhotos: 0, error: null });
  let notices: Subject<string>;
  const sync = { state, status, open: vi.fn(), close: vi.fn(), notices$: undefined as unknown };
  const api = { join: vi.fn(), state: vi.fn() };
  const store = { getState: vi.fn(), saveState: vi.fn() };
  const snack = { open: vi.fn() };
  let params: BehaviorSubject<ParamMap>;

  beforeEach(() => {
    vi.resetAllMocks();
    notices = new Subject<string>();
    params = new BehaviorSubject(convertToParamMap({ code: 'maison-x' }));
    sync.notices$ = notices.asObservable();
    state.set(stateOf('12 rue des Lilas'));
    status.set({ online: true, pendingOps: 0, pendingPhotos: 0, error: null });
    sync.open.mockResolvedValue(undefined);
    store.getState.mockResolvedValue(stateOf('12 rue des Lilas'));
    TestBed.configureTestingModule({
      imports: [VisitShellPage],
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: ApiClient, useValue: api },
        { provide: LocalStore, useValue: store },
        { provide: MatSnackBar, useValue: snack },
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        provideAppIcons(),
      ],
    });
  });

  async function setup() {
    const fixture = TestBed.createComponent(VisitShellPage);
    fixture.detectChanges();
    // ngOnInit est asynchrone et le framework ne l'attend pas
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const text = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.trim();

  it('ouvre la synchronisation, affiche l\'adresse et les quatre onglets, ferme à la destruction', async () => {
    const { fixture, el } = await setup();
    expect(sync.open).toHaveBeenCalledWith('maison-x');
    expect(api.join).not.toHaveBeenCalled();
    expect(text(el, '[data-test=title]')).toBe('12 rue des Lilas');
    expect(Array.from(el.querySelectorAll('a[mat-tab-link]')).map((a) => a.textContent?.trim())).toEqual([
      'Pièces', 'Questions', 'Fiche', 'Bilan',
    ]);
    fixture.destroy();
    expect(sync.close).toHaveBeenCalled();
  });

  it('affiche le code quand l\'adresse est vide', async () => {
    state.set(stateOf(''));
    const { el } = await setup();
    expect(text(el, '[data-test=title]')).toBe('maison-x');
  });

  it('première ouverture : rejoint, récupère et enregistre l\'état avant d\'ouvrir', async () => {
    store.getState.mockResolvedValue(undefined);
    const full = stateOf('x');
    api.join.mockResolvedValue({ number: 2 });
    api.state.mockResolvedValue(full);
    await setup();
    expect(api.join).toHaveBeenCalledWith('maison-x');
    expect(store.saveState).toHaveBeenCalledWith('maison-x', full);
    expect(sync.open).toHaveBeenCalledWith('maison-x');
  });

  it('première ouverture hors ligne : message et lien vers l\'accueil', async () => {
    store.getState.mockResolvedValue(undefined);
    api.join.mockRejectedValue(new ApiError(0, 'réseau'));
    const { el } = await setup();
    expect(el.textContent).toContain('Il faut du réseau pour ouvrir cette visite la première fois');
    expect(el.querySelector('a[href="/"]')).not.toBeNull();
    expect(sync.open).not.toHaveBeenCalled();
  });

  it('code inconnu (404) : « Aucune visite avec ce code »', async () => {
    store.getState.mockResolvedValue(undefined);
    api.join.mockRejectedValue(new ApiError(404, 'not found'));
    const { el } = await setup();
    expect(el.textContent).toContain('Aucune visite avec ce code');
  });

  it('affiche les notices de synchronisation dans un snackbar, jusqu\'à la destruction', async () => {
    const { fixture } = await setup();
    notices.next('Une modification a été refusée (visite clôturée)');
    expect(snack.open).toHaveBeenCalledWith('Une modification a été refusée (visite clôturée)', 'OK', expect.anything());
    fixture.destroy();
    notices.next('autre');
    expect(snack.open).toHaveBeenCalledTimes(1);
  });

  it('visite clôturée : bandeau avec cadenas', async () => {
    state.set(stateOf('x', true));
    const { el } = await setup();
    expect(text(el, '[data-test=closed-banner]')).toContain('Visite clôturée');
  });

  it('rouvre la visite quand le code change et ignore le résultat périmé de l\'ancien code', async () => {
    store.getState.mockResolvedValue(undefined);
    let resolveA!: (v: { number: number }) => void;
    api.join.mockImplementation((c: string) =>
      c === 'a' ? new Promise((r) => (resolveA = r)) : Promise.resolve({ number: 2 }),
    );
    api.state.mockResolvedValue(stateOf('b'));
    params.next(convertToParamMap({ code: 'a' }));
    const fixture = TestBed.createComponent(VisitShellPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    params.next(convertToParamMap({ code: 'b' }));
    await new Promise((r) => setTimeout(r));
    resolveA({ number: 1 });
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sync.open).toHaveBeenCalledTimes(1);
    expect(sync.open).toHaveBeenCalledWith('b');
    expect(store.saveState).toHaveBeenCalledTimes(1);
    expect(store.saveState.mock.calls[0][0]).toBe('b');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a[mat-tab-link]')?.getAttribute('href')).toBe('/v/b/rooms');
  });

  describe('indicateur de synchronisation', () => {
    it('Synchronisé quand rien n\'est en attente', async () => {
      const { el } = await setup();
      expect(text(el, '[data-test=sync-label]')).toBe('Synchronisé');
    });

    it('accorde les pluriels des éléments en attente', async () => {
      const { fixture, el } = await setup();
      status.set({ online: true, pendingOps: 1, pendingPhotos: 1, error: null });
      fixture.detectChanges();
      expect(text(el, '[data-test=sync-label]')).toBe('1 modification et 1 photo en attente');
      status.set({ online: true, pendingOps: 3, pendingPhotos: 2, error: null });
      fixture.detectChanges();
      expect(text(el, '[data-test=sync-label]')).toBe('3 modifications et 2 photos en attente');
    });

    it('Hors ligne, et l\'erreur est affichée dessous', async () => {
      const { fixture, el } = await setup();
      status.set({ online: false, pendingOps: 0, pendingPhotos: 0, error: 'Serveur injoignable' });
      fixture.detectChanges();
      expect(text(el, '[data-test=sync-label]')).toBe('Hors ligne');
      expect(text(el, '[data-test=sync-error]')).toBe('Serveur injoignable');
    });
  });
});
