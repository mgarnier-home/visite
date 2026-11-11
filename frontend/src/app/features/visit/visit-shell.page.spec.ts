import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiClient, ApiError } from '../../core/api.client';
import { Listing, VisitState } from '../../core/api.types';
import { CurrentListing } from '../../core/current-listing';
import { SyncService, SyncStatus } from '../../core/sync.service';
import { provideAppIcons } from '../../shared/icons';
import { VisitShellPage } from './visit-shell.page';

const stateOf = () =>
  ({
    seq: 1,
    visit: { code: 'maison-x' },
    rooms: [{ id: 'r1', name: 'Salon', dir_name: 'salon', kind: 'room', position: 1, hidden: false }],
    questions: [
      { id: 'q1', room_id: 'r1', text: 'a', position: 1 },
      { id: 'q2', room_id: 'r1', text: 'b', position: 2 },
    ],
    shared: [{ target_id: 'q2', field: 'asked', value: true, updated_at: 1, author: 1 }],
  }) as unknown as VisitState;

const listingOf = (over: Partial<Listing> = {}) =>
  ({ id: 'maison-x', title: '', property_type: 'Maison', city: 'Lyon', price_eur: 250000, ...over }) as Listing;

describe('VisitShellPage', () => {
  const state = signal<VisitState | null>(null);
  const status = signal<SyncStatus>({ sending: false, error: null });
  let notices: Subject<string>;
  const sync = { state, status, open: vi.fn(), close: vi.fn(), notices$: undefined as unknown };
  const api = { getListing: vi.fn(), join: vi.fn() };
  const snack = { open: vi.fn() };
  let params: BehaviorSubject<ParamMap>;

  beforeEach(() => {
    vi.resetAllMocks();
    notices = new Subject<string>();
    params = new BehaviorSubject(convertToParamMap({ id: 'maison-x' }));
    sync.notices$ = notices.asObservable();
    state.set(stateOf());
    status.set({ sending: false, error: null });
    sync.open.mockResolvedValue(undefined);
    api.getListing.mockResolvedValue(listingOf());
    api.join.mockResolvedValue({ number: 1 });
    TestBed.configureTestingModule({
      imports: [VisitShellPage],
      providers: [
        { provide: SyncService, useValue: sync },
        { provide: ApiClient, useValue: api },
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
    // l'ouverture est asynchrone et le framework ne l'attend pas
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }
  const text = (el: HTMLElement, sel: string) => el.querySelector(sel)?.textContent?.trim();

  it('charge l\'annonce, rejoint, ouvre la synchronisation, affiche quatre onglets, ferme à la destruction', async () => {
    const { fixture, el } = await setup();
    expect(api.getListing).toHaveBeenCalledWith('maison-x');
    expect(api.join).toHaveBeenCalledWith('maison-x');
    expect(sync.open).toHaveBeenCalledWith('maison-x');
    expect(TestBed.inject(CurrentListing).listing()?.price_eur).toBe(250000);
    expect(text(el, '[data-test=title]')).toBe('Maison · Lyon');
    expect(Array.from(el.querySelectorAll('a[mat-tab-link]')).map((a) => a.textContent?.replace(/\d+$/, '').trim())).toEqual([
      'Annonce', 'Pièces', 'Questions', 'Bilan',
    ]);
    fixture.destroy();
    expect(sync.close).toHaveBeenCalled();
    expect(TestBed.inject(CurrentListing).listing()).toBeNull();
  });

  it('le titre de l\'annonce prime sur « type · ville »', async () => {
    api.getListing.mockResolvedValue(listingOf({ title: 'Belle maison' }));
    const { el } = await setup();
    expect(text(el, '[data-test=title]')).toBe('Belle maison');
  });

  it('badge des questions non posées sur l\'onglet Questions, masqué à 0', async () => {
    const { fixture, el } = await setup();
    const badge = () => el.querySelectorAll('a[mat-tab-link]')[2].querySelector('.mat-badge-content');
    expect(badge()?.textContent?.trim()).toBe('1');
    expect(el.querySelectorAll('a[mat-tab-link]')[1].querySelector('.mat-badge-content')).toBeNull();
    state.set({ ...stateOf(), shared: [] , questions: [] } as unknown as VisitState);
    fixture.detectChanges();
    const b = badge();
    expect(!b || b.closest('.mat-badge-hidden') !== null || b.parentElement?.classList.contains('mat-badge-hidden')).toBe(true);
  });

  it('réseau absent : message et lien vers l\'accueil', async () => {
    api.getListing.mockRejectedValue(new ApiError(0, 'réseau'));
    const { el } = await setup();
    expect(el.textContent).toContain('Il faut du réseau pour ouvrir cette visite');
    expect(el.querySelector('a[href="/"]')).not.toBeNull();
    expect(sync.open).not.toHaveBeenCalled();
  });

  it('annonce supprimée par quelqu\'un d\'autre : message et lien vers l\'accueil', async () => {
    const { fixture, el } = await setup();
    TestBed.inject(CurrentListing).deleted.set(true);
    fixture.detectChanges();
    expect(text(el, '[data-test=deleted]')).toContain('Cette annonce a été supprimée');
    expect(el.querySelector('[data-test=deleted] a[href="/"]')).not.toBeNull();
    expect(el.querySelector('router-outlet')).toBeNull();
  });

  it('annonce inconnue (404) : message dédié', async () => {
    api.getListing.mockRejectedValue(new ApiError(404, 'not found'));
    const { el } = await setup();
    expect(el.textContent).toContain('Aucune annonce avec cet identifiant');
  });

  it('affiche les notices de synchronisation dans un snackbar, jusqu\'à la destruction', async () => {
    const { fixture } = await setup();
    notices.next('Modification non enregistrée : boum');
    expect(snack.open).toHaveBeenCalledWith('Modification non enregistrée : boum', 'OK', expect.anything());
    fixture.destroy();
    notices.next('autre');
    expect(snack.open).toHaveBeenCalledTimes(1);
  });

  it('rouvre la visite quand l\'id change et ignore le résultat périmé de l\'ancien', async () => {
    let resolveA!: (v: Listing) => void;
    api.getListing.mockImplementation((id: string) =>
      id === 'a' ? new Promise((r) => (resolveA = r)) : Promise.resolve(listingOf({ id })),
    );
    params.next(convertToParamMap({ id: 'a' }));
    const fixture = TestBed.createComponent(VisitShellPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    params.next(convertToParamMap({ id: 'b' }));
    await new Promise((r) => setTimeout(r));
    resolveA(listingOf({ id: 'a' }));
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sync.open).toHaveBeenCalledTimes(1);
    expect(sync.open).toHaveBeenCalledWith('b');
    expect(TestBed.inject(CurrentListing).listing()?.id).toBe('b');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a[mat-tab-link]')?.getAttribute('href')).toBe('/annonces/b/annonce');
  });

  describe('indicateur de synchronisation', () => {
    it('Synchronisé au repos, Envoi… pendant un envoi', async () => {
      const { fixture, el } = await setup();
      expect(text(el, '[data-test=sync-label]')).toBe('Synchronisé');
      status.set({ sending: true, error: null });
      fixture.detectChanges();
      expect(text(el, '[data-test=sync-label]')).toBe('Envoi…');
    });

    it('affiche l\'erreur de mise à jour', async () => {
      const { fixture, el } = await setup();
      status.set({ sending: false, error: 'Mise à jour impossible : x' });
      fixture.detectChanges();
      expect(text(el, '[data-test=sync-error]')).toBe('Mise à jour impossible : x');
    });
  });
});
