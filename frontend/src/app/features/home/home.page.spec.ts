import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiClient, ApiError } from '../../core/api.client';
import { VisitState } from '../../core/api.types';
import { LocalStore, PendingDataError } from '../../core/local-store';
import { HomePage } from './home.page';

registerLocaleData(localeFr);

const stateOf = (code: string) =>
  ({ seq: 1, visit: { code, fiche: { address: '12 rue des Lilas', visit_at: '2026-11-02T10:30:00+01:00' } } }) as unknown as VisitState;

describe('HomePage', () => {
  const api = { join: vi.fn(), state: vi.fn() };
  const store = { saveState: vi.fn(), getState: vi.fn(), listVisits: vi.fn(), removeVisit: vi.fn() };
  const navigate = vi.fn();
  const snack = { open: vi.fn() };

  async function setup(visits: { code: string; state: VisitState }[] = []) {
    store.listVisits.mockResolvedValue(visits);
    TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: LocalStore, useValue: store },
        provideRouter([]),
        { provide: MatSnackBar, useValue: snack },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);
    const fixture = TestBed.createComponent(HomePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  async function join(fixture: Awaited<ReturnType<typeof setup>>, typed: string) {
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = typed;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('[data-test=join]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('rejoint avec le code normalisé, enregistre l\'état puis navigue', async () => {
    api.join.mockResolvedValue({ number: 2 });
    api.state.mockResolvedValue(stateOf('maison-x'));
    const fixture = await setup();
    await join(fixture, ' Maison-X ');
    expect(api.join).toHaveBeenCalledWith('maison-x');
    expect(api.state).toHaveBeenCalledWith('maison-x');
    expect(store.saveState).toHaveBeenCalledWith('maison-x', stateOf('maison-x'));
    expect(navigate).toHaveBeenCalledWith(['/v', 'maison-x']);
  });

  it('visite déjà enregistrée localement : navigue sans écraser l\'état local', async () => {
    store.getState.mockResolvedValue(stateOf('maison-x'));
    const fixture = await setup();
    await join(fixture, 'maison-x');
    expect(store.getState).toHaveBeenCalledWith('maison-x');
    expect(api.join).not.toHaveBeenCalled();
    expect(api.state).not.toHaveBeenCalled();
    expect(store.saveState).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/v', 'maison-x']);
  });

  it('affiche un message sur 404', async () => {
    api.join.mockRejectedValue(new ApiError(404, 'not found'));
    const fixture = await setup();
    await join(fixture, 'inconnu');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Aucune visite avec ce code');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('affiche un message hors ligne', async () => {
    api.join.mockRejectedValue(new ApiError(0, 'réseau'));
    const fixture = await setup();
    await join(fixture, 'inconnu');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Il faut du réseau pour rejoindre une visite',
    );
  });

  it('liste les visites locales avec adresse et date', async () => {
    const fixture = await setup([{ code: 'maison-x', state: stateOf('maison-x') }]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('12 rue des Lilas');
    expect(text).toContain('2026');
  });

  it('retire une visite', async () => {
    store.removeVisit.mockResolvedValue(undefined);
    const fixture = await setup([{ code: 'maison-x', state: stateOf('maison-x') }]);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-test=remove]')!.click();
    await fixture.whenStable();
    expect(store.removeVisit).toHaveBeenCalledWith('maison-x');
  });

  it('prévient quand des données sont en attente', async () => {
    store.removeVisit.mockRejectedValue(new PendingDataError('maison-x'));
    const fixture = await setup([{ code: 'maison-x', state: stateOf('maison-x') }]);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-test=remove]')!.click();
    await fixture.whenStable();
    expect(snack.open).toHaveBeenCalledWith(
      'Des modifications ne sont pas encore envoyées : impossible de retirer cette visite pour l\'instant',
      undefined,
      expect.anything(),
    );
  });
});
