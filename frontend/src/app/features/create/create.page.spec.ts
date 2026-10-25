import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiError } from '../../core/api.client';
import { VisitState } from '../../core/api.types';
import { LocalStore } from '../../core/local-store';
import { CreatePage } from './create.page';

describe('CreatePage', () => {
  const api = { exists: vi.fn(), create: vi.fn() };
  const store = { saveState: vi.fn() };
  const navigate = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    api.exists.mockResolvedValue({ exists: false });
    TestBed.configureTestingModule({
      imports: [CreatePage],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: LocalStore, useValue: store },
        provideRouter([]),
      ],
    });
  });
  afterEach(() => vi.useRealTimers());

  const type = (el: HTMLElement, sel: string, value: string) => {
    const input = el.querySelector(sel) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }, ms = 0) {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function setup() {
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);
    const fixture = TestBed.createComponent(CreatePage);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const submit = () => el.querySelector('[data-test=submit]') as HTMLButtonElement;
    return { fixture, el, submit };
  }

  it('désactive la création tant que l\'adresse est vide, puis tant que le code est vérifié ou pris', async () => {
    const { fixture, el, submit } = setup();
    expect(submit().disabled).toBe(true);

    type(el, '[data-test=code]', 'Maison X');
    await settle(fixture);
    // adresse vide : toujours désactivé
    expect(submit().disabled).toBe(true);

    type(el, '[data-test=address]', '12 rue des Lilas');
    fixture.detectChanges();
    // vérification en attente (debounce 300 ms)
    expect(api.exists).not.toHaveBeenCalled();
    expect(submit().disabled).toBe(true);

    await settle(fixture, 300);
    expect(api.exists).toHaveBeenCalledWith('maison-x');
    expect(el.textContent).toContain('Code disponible');
    expect(submit().disabled).toBe(false);
  });

  it('refuse un code déjà pris', async () => {
    api.exists.mockResolvedValue({ exists: true });
    const { fixture, el, submit } = setup();
    type(el, '[data-test=address]', '12 rue des Lilas');
    type(el, '[data-test=code]', 'pris');
    await settle(fixture, 300);
    expect(el.textContent).toContain('Code déjà pris');
    expect(submit().disabled).toBe(true);
  });

  it('crée la visite, enregistre l\'état et navigue', async () => {
    const created = { seq: 1 } as unknown as VisitState;
    api.create.mockResolvedValue(created);
    const { fixture, el, submit } = setup();
    type(el, '[data-test=address]', '12 rue des Lilas');
    type(el, '[data-test=price]', '250000');
    type(el, '[data-test=code]', 'maison-x');
    await settle(fixture, 300);
    submit().click();
    await settle(fixture);
    const req = api.create.mock.calls[0][0];
    expect(req.code).toBe('maison-x');
    expect(req.fiche.address).toBe('12 rue des Lilas');
    expect(req.fiche.price_eur).toBe(250000);
    expect(req.fiche.living_area_m2).toBeNull();
    expect(req.fiche.dpe_energy).toBeNull();
    expect(store.saveState).toHaveBeenCalledWith('maison-x', created);
    expect(navigate).toHaveBeenCalledWith(['/v', 'maison-x']);
  });

  it('affiche « Ce code est déjà pris » sur 409', async () => {
    api.create.mockRejectedValue(new ApiError(409, 'conflict'));
    const { fixture, el, submit } = setup();
    type(el, '[data-test=address]', '12 rue des Lilas');
    type(el, '[data-test=code]', 'maison-x');
    await settle(fixture, 300);
    submit().click();
    await settle(fixture);
    expect(el.textContent).toContain('Ce code est déjà pris');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('affiche le message hors ligne à la création', async () => {
    api.create.mockRejectedValue(new ApiError(0, 'réseau'));
    const { fixture, el, submit } = setup();
    type(el, '[data-test=address]', 'x');
    type(el, '[data-test=code]', 'maison-x');
    await settle(fixture, 300);
    submit().click();
    await settle(fixture);
    expect(el.textContent).toContain('Il faut du réseau pour créer une visite');
  });

  it('ignore la réponse tardive d\'un code précédent', async () => {
    let resolveOld!: (v: { exists: boolean }) => void;
    api.exists.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    const { fixture, el, submit } = setup();
    type(el, '[data-test=address]', 'x');
    type(el, '[data-test=code]', 'abc');
    await settle(fixture, 300);
    expect(api.exists).toHaveBeenCalledWith('abc');
    type(el, '[data-test=code]', 'abcd');
    resolveOld({ exists: false });
    await settle(fixture);
    expect(el.textContent).not.toContain('Code disponible');
    expect(submit().disabled).toBe(true);
    await settle(fixture, 300);
    expect(api.exists).toHaveBeenLastCalledWith('abcd');
    expect(submit().disabled).toBe(false);
  });

  it('navigue quand la visite est créée mais que l\'enregistrement local échoue', async () => {
    api.create.mockResolvedValue({ seq: 1 } as unknown as VisitState);
    store.saveState.mockRejectedValue(new Error('quota'));
    const { fixture, el, submit } = setup();
    type(el, '[data-test=address]', 'x');
    type(el, '[data-test=code]', 'maison-x');
    await settle(fixture, 300);
    submit().click();
    await settle(fixture);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/v', 'maison-x']);
  });

  it('refuse un nombre négatif', async () => {
    const { fixture, el, submit } = setup();
    type(el, '[data-test=address]', 'x');
    type(el, '[data-test=code]', 'maison-x');
    type(el, '[data-test=price]', '-5');
    (el.querySelector('[data-test=price]') as HTMLInputElement).dispatchEvent(new Event('blur'));
    await settle(fixture, 300);
    expect(submit().disabled).toBe(true);
    expect(el.textContent).toContain('Doit être positif ou nul');
  });
});
