import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api.client';
import { Listing } from '../../core/api.types';
import { provideAppIcons } from '../../shared/icons';
import { EditPage } from './edit.page';

const listing = (over: Partial<Listing> = {}): Listing =>
  ({
    id: 'l1', source: 'bienici', url: 'https://www.bienici.com/a', status: 'contact', title: 'Maison 5 pièces',
    property_type: 'Maison', price_eur: 345000, rooms: 5, bedrooms: null, living_area_m2: 118.5, city: 'Vertou',
    postal_code: '44120', description: 'Au calme', features: ['garden'], photos: [{ id: 'p', position: 0 }],
    ...over,
  }) as Listing;

async function setup(l: Listing, confirm = true, loadFails = false) {
  const open = vi.fn(() => ({ afterClosed: () => of(confirm) }));
  const api = {
    getListing: loadFails ? vi.fn().mockRejectedValue(new Error('x')) : vi.fn().mockResolvedValue(l),
    patchListing: vi.fn().mockResolvedValue(l),
    deleteListing: vi.fn().mockResolvedValue(undefined),
    listingPhotoUrl: (id: string, p: string) => `/p/${id}/${p}`,
  };
  TestBed.configureTestingModule({
    imports: [EditPage],
    providers: [
      provideRouter([]),
      { provide: ApiClient, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'l1' }) } } },
      { provide: MatDialog, useValue: { open } },
      provideAppIcons(),
    ],
  });
  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(EditPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const field = (k: string) => el.querySelector<HTMLInputElement>(`[data-test="field-${k}"]`)!;
  const click = async (sel: string) => {
    el.querySelector<HTMLElement>(sel)!.click();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { api, open, navigate, fixture, el, field, click };
}

describe('EditPage', () => {
  it('préremplit les champs, « Non indiqué » pour un champ vide', async () => {
    const s = await setup(listing());
    expect(s.field('title').value).toBe('Maison 5 pièces');
    expect(s.field('price_eur').value).toBe('345000');
    expect(s.field('living_area_m2').value).toBe('118,5');
    expect(s.field('bedrooms').value).toBe('');
    expect(s.field('bedrooms').placeholder).toBe('Non indiqué');
    expect(s.el.querySelector('[data-test=source]')!.textContent).toContain("Bien'ici");
    expect(s.el.querySelector('[data-test=manual-banner]')).toBeNull();
  });

  it('manual : bandeau', async () => {
    const s = await setup(listing({ source: 'manual', photos: [] }));
    expect(s.el.querySelector('[data-test=manual-banner]')!.textContent).toContain("Ce site n'est pas lu automatiquement");
  });

  it('« Visite planifiée » ouvre date et heure', async () => {
    const s = await setup(listing());
    expect(s.el.querySelector('app-date-time-input')).toBeNull();
    await s.click('[data-test="status-planned"]');
    expect(s.el.querySelector('app-date-time-input')).not.toBeNull();
  });

  it('« Visite planifiée » : enregistrer exige une date, puis se débloque', async () => {
    const s = await setup(listing());
    await s.click('[data-test="status-planned"]');
    const save = s.el.querySelector<HTMLButtonElement>('[data-test=save]')!;
    expect(save.disabled).toBe(true);
    (s.fixture.componentInstance as unknown as { setVisit(v: string): void }).setVisit('2030-12-25T14:30:00.000Z');
    s.fixture.detectChanges();
    expect(save.disabled).toBe(false);
  });

  it('« Ajouter à la liste » : un seul PATCH puis la fiche', async () => {
    const s = await setup(listing());
    s.field('price_eur').value = '300000';
    s.field('price_eur').dispatchEvent(new Event('input'));
    await s.click('[data-test="status-mail"]');
    await s.click('[data-test="feature-pool"]');
    await s.click('[data-test=save]');
    expect(s.api.patchListing).toHaveBeenCalledTimes(1);
    const [id, body] = s.api.patchListing.mock.calls[0];
    expect(id).toBe('l1');
    expect(body).toMatchObject({ price_eur: 300000, status: 'mail', rooms: 5, bedrooms: null, living_area_m2: 118.5 });
    expect(body.features).toEqual(['garden', 'pool']);
    expect(s.navigate).toHaveBeenCalledWith(['/annonces', 'l1'], { replaceUrl: true });
  });

  it('« Annuler » confirme, supprime et revient à l\'accueil', async () => {
    const s = await setup(listing());
    await s.click('[data-test=cancel]');
    expect(s.api.deleteListing).toHaveBeenCalledWith('l1');
    expect(s.navigate).toHaveBeenCalledWith(['/']);
  });

  it('après l\'enregistrement, « Annuler » ne supprime rien', async () => {
    const s = await setup(listing());
    await s.click('[data-test=save]');
    await (s.fixture.componentInstance as unknown as { cancel(): Promise<void> }).cancel();
    expect(s.api.deleteListing).not.toHaveBeenCalled();
    expect(s.open).not.toHaveBeenCalled();
  });

  it('pendant l\'enregistrement, « Annuler » ne fait rien', async () => {
    const s = await setup(listing());
    s.api.patchListing.mockReturnValue(new Promise(() => undefined));
    s.el.querySelector<HTMLElement>('[data-test=save]')!.click();
    s.fixture.detectChanges();
    expect(s.el.querySelector<HTMLButtonElement>('[data-test=cancel]')!.disabled).toBe(true);
    expect(s.el.querySelector<HTMLButtonElement>('[data-test=back]')!.disabled).toBe(true);
    await (s.fixture.componentInstance as unknown as { cancel(): Promise<void> }).cancel();
    expect(s.api.deleteListing).not.toHaveBeenCalled();
    expect(s.open).not.toHaveBeenCalled();
  });

  it('erreur de chargement : la flèche va à l\'accueil sans supprimer', async () => {
    const s = await setup(listing(), true, true);
    await s.click('[data-test=back]');
    expect(s.api.deleteListing).not.toHaveBeenCalled();
    expect(s.open).not.toHaveBeenCalled();
    expect(s.navigate).toHaveBeenCalledWith(['/']);
  });

  it('« Annuler » refusé : rien ne bouge', async () => {
    const s = await setup(listing(), false);
    await s.click('[data-test=cancel]');
    expect(s.api.deleteListing).not.toHaveBeenCalled();
  });

  it('statut « Visite planifiée » : visit_at est envoyé', async () => {
    const s = await setup(listing());
    await s.click('[data-test="status-planned"]');
    (s.fixture.componentInstance as unknown as { setVisit(v: string): void }).setVisit('2030-12-25T14:30:00+01:00');
    s.fixture.detectChanges();
    await s.click('[data-test=save]');
    expect(s.api.patchListing.mock.calls[0][1]).toMatchObject({ status: 'planned', visit_at: '2030-12-25T14:30:00+01:00' });
  });

  it('PATCH en échec : message save-error, pas de navigation', async () => {
    const s = await setup(listing());
    s.api.patchListing.mockRejectedValue(new Error('Réseau indisponible'));
    await s.click('[data-test=save]');
    expect(s.el.querySelector('[data-test=save-error]')!.textContent).toContain('Réseau indisponible');
    expect(s.navigate).not.toHaveBeenCalled();
  });
});
