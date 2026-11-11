import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BreakpointObserver } from '@angular/cdk/layout';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api.client';
import { Listing, ListingStatus } from '../../core/api.types';
import { provideAppIcons } from '../../shared/icons';
import { ListingsPage } from './listings.page';

const listing = (status: ListingStatus, over: Partial<Listing> = {}): Listing =>
  ({
    id: `l-${status}`, source: 'bienici', status, created_at: '2026-11-09T08:00:00Z',
    mail_sent_at: '2026-11-08T09:00:00Z', visit_at: '2026-11-14T09:30:00Z', visited_at: '2026-11-14T09:30:00Z',
    removed_at: null, property_type: 'Maison', price_eur: 345000, rooms: 5, bedrooms: 3,
    living_area_m2: 118, land_area_m2: 820, city: 'Vertou', photos: [], ...over,
  }) as Listing;

let fixture: ComponentFixture<ListingsPage>;

async function setup(width: 'phone' | 'desktop', listings: Listing[]) {
  const matches = new BehaviorSubject({ matches: width === 'desktop', breakpoints: {} });
  const api = {
    listListings: vi.fn().mockResolvedValue(listings),
    listingPhotoUrl: (id: string, p: string) => `/p/${id}/${p}`,
  };
  TestBed.configureTestingModule({
    imports: [ListingsPage],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: BreakpointObserver, useValue: { observe: () => matches } },
      provideRouter([]),
      provideAppIcons(),
    ],
  });
  fixture = TestBed.createComponent(ListingsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const all = (over: Partial<Record<ListingStatus, Partial<Listing>>> = {}) =>
  (['contact', 'mail', 'planned', 'done', 'dropped'] as ListingStatus[]).map((s) => listing(s, over[s]));
const titles = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-test="group-title"]')].map((h) => [...h.children].map((c) => c.textContent!.trim()).join(' '));

describe('ListingsPage', () => {
  it('téléphone : sections dans l\'ordre de la maquette, écartées repliées', async () => {
    const el = await setup('phone', all());
    expect(titles(el)).toEqual(['Visite planifiée 1', 'Mail envoyé 1', 'À contacter 1', 'Visite effectuée 1']);
    const toggle = el.querySelector('[data-test="dropped-toggle"]') as HTMLButtonElement;
    expect(toggle.textContent).toContain('Écartées (1)');
    expect(el.querySelectorAll('[data-test="card"]').length).toBe(4);
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-test="card"]').length).toBe(5);
  });

  it('ordinateur : 4 colonnes dans l\'ordre de STATUS_ORDER', async () => {
    const el = await setup('desktop', all());
    expect(titles(el)).toEqual(['À contacter 1', 'Mail envoyé 1', 'Visite planifiée 1', 'Visite effectuée 1']);
  });

  it('carte : lien, photo ou case neutre, annonce retirée', async () => {
    const el = await setup('phone', [
      listing('contact', { photos: [{ id: 'ph1', position: 0 }] }),
      listing('mail', { removed_at: '2026-11-10T00:00:00Z' }),
    ]);
    const cards = [...el.querySelectorAll('[data-test="card"]')] as HTMLAnchorElement[];
    const withPhoto = cards.find((c) => c.getAttribute('href') === '/annonces/l-contact')!;
    expect(withPhoto.querySelector('img')!.getAttribute('src')).toBe('/p/l-contact/ph1');
    const noPhoto = cards.find((c) => c.getAttribute('href') === '/annonces/l-mail')!;
    expect(noPhoto.querySelector('img')).toBeNull();
    expect(noPhoto.querySelector('mat-icon')).not.toBeNull();
    expect(noPhoto.textContent).toContain('Annonce retirée');
    expect(withPhoto.textContent).not.toContain('Annonce retirée');
    expect(withPhoto.textContent).toContain("Bien'ici");
    expect(withPhoto.textContent).toContain('Vertou · terrain 820 m²');
  });

  it('bouton Ajouter une annonce et lien modèle', async () => {
    const el = await setup('phone', []);
    const add = el.querySelector('[data-test="add"]') as HTMLAnchorElement;
    expect(add.getAttribute('href')).toBe('/annonces/nouvelle');
    expect(add.textContent).toContain('Ajouter une annonce');
    expect(el.querySelector('a[href="/modele"]')).not.toBeNull();
  });

  it('chargement : « Chargement… » sans compteur', async () => {
    TestBed.configureTestingModule({
      imports: [ListingsPage],
      providers: [
        { provide: ApiClient, useValue: { listListings: () => new Promise(() => undefined) } },
        { provide: BreakpointObserver, useValue: { observe: () => new BehaviorSubject({ matches: false, breakpoints: {} }) } },
        provideRouter([]),
        provideAppIcons(),
      ],
    });
    const f = TestBed.createComponent(ListingsPage);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-test=loading]')!.textContent).toContain('Chargement…');
    expect(el.querySelector('.count')).toBeNull();
  });

  it('erreur : « Réessayer » relance le chargement', async () => {
    const listListings = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue([listing('contact')]);
    TestBed.configureTestingModule({
      imports: [ListingsPage],
      providers: [
        { provide: ApiClient, useValue: { listListings, listingPhotoUrl: () => '' } },
        { provide: BreakpointObserver, useValue: { observe: () => new BehaviorSubject({ matches: false, breakpoints: {} }) } },
        provideRouter([]),
        provideAppIcons(),
      ],
    });
    const f = TestBed.createComponent(ListingsPage);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-test=load-error]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-test=retry]')!.click();
    await f.whenStable();
    f.detectChanges();
    expect(listListings).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-test=load-error]')).toBeNull();
    expect(el.querySelectorAll('[data-test=card]').length).toBe(1);
  });
});
