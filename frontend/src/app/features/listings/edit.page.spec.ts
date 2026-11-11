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

async function setup(l: Listing, confirm = true) {
  const api = {
    getListing: vi.fn().mockResolvedValue(l),
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
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(confirm) }) } },
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
  return { api, navigate, fixture, el, field, click };
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
    expect(s.navigate).toHaveBeenCalledWith(['/annonces', 'l1']);
  });

  it('« Annuler » confirme, supprime et revient à l\'accueil', async () => {
    const s = await setup(listing());
    await s.click('[data-test=cancel]');
    expect(s.api.deleteListing).toHaveBeenCalledWith('l1');
    expect(s.navigate).toHaveBeenCalledWith(['/']);
  });

  it('« Annuler » refusé : rien ne bouge', async () => {
    const s = await setup(listing(), false);
    await s.click('[data-test=cancel]');
    expect(s.api.deleteListing).not.toHaveBeenCalled();
  });
});
