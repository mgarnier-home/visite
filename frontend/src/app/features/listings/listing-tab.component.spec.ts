import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../core/api.client';
import { Listing, ListingStatus } from '../../core/api.types';
import { CurrentListing } from '../../core/current-listing';
import { provideAppIcons } from '../../shared/icons';
import { ListingTabComponent } from './listing-tab.component';

const make = (status: ListingStatus, over: Partial<Listing> = {}): Listing =>
  ({
    id: 'l1', source: 'bienici', url: 'https://www.bienici.com/annonce/1', status,
    created_at: '2026-11-03T08:00:00Z', mail_sent_at: '2026-11-05T09:00:00Z',
    visit_at: '2026-11-14T10:30:00+01:00', visited_at: '2026-11-14T16:00:00+01:00',
    fetched_at: '2026-11-03T08:00:00Z', removed_at: null, fetch_error: '', notes: 'Agent sympa',
    title: '', property_type: 'Maison', price_eur: 345000, living_area_m2: 118, land_area_m2: 820,
    rooms: 5, bedrooms: 3, bathrooms: 1, shower_rooms: 1, toilets: 2, parking: 1, floor: null,
    construction_year: 1978, dpe: 'D', ges: 'E', heating: '', city: 'Vertou', postal_code: '44120',
    description: 'Belle maison', agency: 'Agence XYZ', agent_phone: '02 40 00 00 00', agent_email: 'a@x.fr',
    features: ['Jardin', 'Terrasse'], photos: [{ id: 'p1', position: 0 }, { id: 'p2', position: 1 }], ...over,
  }) as Listing;

describe('ListingTabComponent', () => {
  const api = {
    patchListing: vi.fn(),
    refreshListing: vi.fn(),
    deleteListing: vi.fn(),
    getListing: vi.fn(),
    listingPhotoUrl: (id: string, p: string) => `/p/${id}/${p}`,
  };
  const snack = { open: vi.fn() };
  const dialog = { open: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    dialog.open.mockReturnValue({ afterClosed: () => of(true) });
    api.patchListing.mockImplementation(async (_id: string, f: object) => ({ ...current(), ...f }));
    api.getListing.mockImplementation(async () => current());
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: MatSnackBar, useValue: snack },
        { provide: MatDialog, useValue: dialog },
        provideRouter([]),
        provideAppIcons(),
      ],
    });
  });

  const current = () => TestBed.inject(CurrentListing).listing()!;
  async function setup(status: ListingStatus, over: Partial<Listing> = {}) {
    TestBed.inject(CurrentListing).listing.set(make(status, over));
    const fixture = TestBed.createComponent(ListingTabComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, settle };
  }
  const q = (el: HTMLElement, sel: string) => el.querySelector<HTMLElement>(sel);
  const text = (el: HTMLElement, sel: string) => q(el, sel)?.textContent?.replace(/\s+/g, ' ').trim();
  const stepText = (s: Element) =>
    [...s.children].map((c) => c.textContent?.trim()).filter(Boolean).join(' ');
  const btn = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent?.trim() === label);

  it('frise : les étapes jusqu\'au statut courant portent leur date', async () => {
    const { el } = await setup('mail');
    const steps = [...el.querySelectorAll('[data-test=step]')].map(stepText);
    expect(steps).toEqual(['À contacter 3 nov', 'Mail envoyé 5 nov', 'Visite planifiée', 'Visite effectuée']);
  });

  it('frise : la visite planifiée affiche date et heure', async () => {
    const { el } = await setup('planned');
    expect(stepText(q(el, '[data-test=step]:nth-child(3)')!)).toBe('Visite planifiée 14 nov 10:30');
  });

  it('prix, prix au m² et ligne de caractéristiques', async () => {
    const { el } = await setup('contact');
    expect(text(el, '[data-test=price]')?.replace(/\s/g, ' ')).toBe('345 000 €');
    expect(text(el, '[data-test=price-m2]')?.replace(/\s/g, ' ')).toBe('2 924 €/m²');
    expect(text(el, '[data-test=specs]')).toBe('Maison · 5 p · 3 ch · 118 m²');
  });

  it('prix au m² absent sans surface', async () => {
    const { el } = await setup('contact', { living_area_m2: null });
    expect(q(el, '[data-test=price-m2]')).toBeNull();
  });

  it('caractéristiques absentes : « Non indiqué »', async () => {
    const { el } = await setup('contact', { heating: '', floor: null });
    const spec = (k: string) =>
      [...el.querySelectorAll('[data-test=spec]')].find((d) => d.querySelector('dt')?.textContent?.trim() === k)
        ?.querySelector('dd')?.textContent?.trim();
    expect(spec('Chauffage')).toBe('Non indiqué');
    expect(spec('Étages')).toBe('Non indiqué');
    expect(spec('Pièces')).toBe('5');
    expect(spec('DPE / GES')).toBe('D / E');
  });

  it('sans photo : emplacement', async () => {
    const { el } = await setup('contact', { photos: [] });
    expect(q(el, '[data-test=no-photo]')).not.toBeNull();
    expect(q(el, '[data-test=photo-count]')).toBeNull();
  });

  it('photos : compteur « 1 / N »', async () => {
    const { el } = await setup('contact');
    expect(el.querySelectorAll('[data-test=photos] img').length).toBe(2);
    expect(text(el, '[data-test=photo-count]')).toBe('1 / 2');
  });

  describe('bloc d\'action', () => {
    it('contact : Mail envoyé patche le statut, Planifier ouvre la date', async () => {
      const { el, settle, fixture } = await setup('contact');
      expect(btn(el, 'Planifier la visite')).toBeDefined();
      btn(el, 'Mail envoyé')!.click();
      await settle();
      expect(api.patchListing).toHaveBeenCalledWith('l1', { status: 'mail' });
      expect(current().status).toBe('mail');
      expect(text(fixture.nativeElement, '[data-test=card]')).toContain('En attente de réponse');
    });

    it('mail : Planifier et Revenir à « À contacter »', async () => {
      const { el, settle } = await setup('mail');
      expect(btn(el, 'Planifier la visite')).toBeDefined();
      btn(el, 'Revenir à « À contacter »')!.click();
      await settle();
      expect(api.patchListing).toHaveBeenCalledWith('l1', { status: 'contact' });
    });

    it('planned : Visite effectuée, Changer la date', async () => {
      const { el, settle } = await setup('planned');
      expect(btn(el, 'Changer la date')).toBeDefined();
      expect(text(el, '[data-test=card]')).toContain('14 novembre');
      btn(el, 'Visite effectuée')!.click();
      await settle();
      expect(api.patchListing).toHaveBeenCalledWith('l1', { status: 'done' });
    });

    it('done : lien vers le bilan, Revenir à « Visite planifiée »', async () => {
      const { el, settle } = await setup('done');
      expect(btn(el, 'Voir le bilan')?.getAttribute('href')).toBe('/annonces/l1/bilan');
      btn(el, 'Revenir à « Visite planifiée »')!.click();
      await settle();
      expect(api.patchListing).toHaveBeenCalledWith('l1', { status: 'planned' });
    });

    it('dropped : Remettre dans la liste (contact), pas d\'Écarter', async () => {
      const { el, settle } = await setup('dropped');
      expect(btn(el, 'Écarter')).toBeUndefined();
      btn(el, 'Remettre dans la liste')!.click();
      await settle();
      expect(api.patchListing).toHaveBeenCalledWith('l1', { status: 'contact' });
    });

    it('Planifier la visite : date requise, puis PATCH visit_at et status planned', async () => {
      const { el, settle, fixture } = await setup('mail');
      btn(el, 'Planifier la visite')!.click();
      await settle();
      expect(q(el, 'app-date-time-input')).not.toBeNull();
      const save = btn(el, 'Enregistrer') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      (fixture.componentInstance as unknown as { setVisit(v: string): void }).setVisit('2026-11-20T09:00:00+01:00');
      fixture.detectChanges();
      expect((btn(el, 'Enregistrer') as HTMLButtonElement).disabled).toBe(false);
      btn(el, 'Enregistrer')!.click();
      await settle();
      expect(api.patchListing).toHaveBeenCalledWith('l1', { visit_at: '2026-11-20T09:00:00+01:00', status: 'planned' });
      expect(q(el, 'app-date-time-input')).toBeNull();
    });

    it('échec du PATCH : message, annonce inchangée', async () => {
      api.patchListing.mockRejectedValue(new ApiError(0, 'Réseau indisponible'));
      const { el, settle } = await setup('contact');
      btn(el, 'Mail envoyé')!.click();
      await settle();
      expect(snack.open).toHaveBeenCalledWith(expect.stringContaining('Réseau indisponible'), 'OK', expect.anything());
      expect(current().status).toBe('contact');
    });
  });

  describe('notes', () => {
    it('enregistrées par PATCH à la sortie du champ, si modifiées', async () => {
      const { el, settle } = await setup('contact');
      const area = q(el, 'textarea') as HTMLTextAreaElement;
      area.dispatchEvent(new Event('blur'));
      await settle();
      expect(api.patchListing).not.toHaveBeenCalled();
      area.value = 'Prix négociable';
      area.dispatchEvent(new Event('input'));
      area.dispatchEvent(new Event('blur'));
      await settle();
      expect(api.patchListing).toHaveBeenCalledWith('l1', { notes: 'Prix négociable' });
      expect(current().notes).toBe('Prix négociable');
    });
  });

  it('notes non validées par un blur : envoyées à la destruction', async () => {
    const { fixture, el } = await setup('contact');
    const area = q(el, 'textarea') as HTMLTextAreaElement;
    area.value = 'Rappeler lundi';
    area.dispatchEvent(new Event('input'));
    fixture.destroy();
    expect(api.patchListing).toHaveBeenCalledWith('l1', { notes: 'Rappeler lundi' });
  });

  describe('rafraîchir', () => {
    it('absent en saisie manuelle', async () => {
      const { el } = await setup('contact', { source: 'manual' });
      expect(btn(el, 'Rafraîchir')).toBeUndefined();
    });

    it('succès : annonce mise à jour partout', async () => {
      api.refreshListing.mockResolvedValue(make('contact', { price_eur: 330000 }));
      const { el, settle } = await setup('contact');
      btn(el, 'Rafraîchir')!.click();
      await settle();
      expect(api.refreshListing).toHaveBeenCalledWith('l1');
      expect(current().price_eur).toBe(330000);
      expect(text(el, '[data-test=price]')?.replace(/\s/g, ' ')).toBe('330 000 €');
    });

    it('502 : message du serveur', async () => {
      api.refreshListing.mockRejectedValue(new ApiError(502, 'Le site ne répond pas'));
      api.getListing.mockResolvedValue(make('contact', { fetch_error: 'site injoignable' }));
      const { el, settle } = await setup('contact');
      btn(el, 'Rafraîchir')!.click();
      await settle();
      expect(text(el, '[data-test=refresh-error]')).toBe('Le site ne répond pas');
      expect(api.getListing).toHaveBeenCalledWith('l1');
      expect(text(el, '[data-test=fetch-error]')).toBe('Dernière récupération en échec : site injoignable');
    });
  });

  it('bandeaux : annonce retirée et récupération en échec', async () => {
    const { el } = await setup('contact', { removed_at: '2026-11-10T08:00:00Z', fetch_error: 'site injoignable' });
    expect(text(el, '[data-test=removed]')).toBe('Annonce retirée du site le 10 nov');
    expect(text(el, '[data-test=fetch-error]')).toBe('Dernière récupération en échec : site injoignable');
    const none = await setup('contact');
    expect(none.el.querySelector('[data-test=removed]')).toBeNull();
  });

  it('Écarter : PATCH dropped, pour tout statut sauf dropped', async () => {
    for (const s of ['contact', 'mail', 'planned', 'done'] as ListingStatus[]) {
      expect(btn((await setup(s)).el, 'Écarter')).toBeDefined();
    }
    const { el, settle } = await setup('mail');
    btn(el, 'Écarter')!.click();
    await settle();
    expect(api.patchListing).toHaveBeenCalledWith('l1', { status: 'dropped' });
  });

  it('Supprimer : confirmation, suppression puis retour à l\'accueil', async () => {
    api.deleteListing.mockResolvedValue(undefined);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const { el, settle } = await setup('contact');
    btn(el, 'Supprimer')!.click();
    await settle();
    expect(dialog.open).toHaveBeenCalled();
    expect(api.deleteListing).toHaveBeenCalledWith('l1');
    expect(nav).toHaveBeenCalledWith('/');
  });

  it('Supprimer refusé : rien ne part', async () => {
    dialog.open.mockReturnValue({ afterClosed: () => of(undefined) });
    const { el, settle } = await setup('contact');
    btn(el, 'Supprimer')!.click();
    await settle();
    expect(api.deleteListing).not.toHaveBeenCalled();
  });

  describe('file des PATCH', () => {
    it('notes en cours d\'envoi puis « Mail envoyé » : les deux PATCH partent, dans l\'ordre', async () => {
      let release!: () => void;
      api.patchListing.mockImplementationOnce(
        (_id: string, f: object) => new Promise((r) => (release = () => r({ ...current(), ...f }))),
      );
      const { el, settle } = await setup('contact');
      const area = q(el, 'textarea') as HTMLTextAreaElement;
      area.value = 'Prix négociable';
      area.dispatchEvent(new Event('input'));
      area.dispatchEvent(new Event('blur'));
      await settle();
      btn(el, 'Mail envoyé')!.click();
      await settle();
      expect(api.patchListing).toHaveBeenCalledTimes(1);
      release();
      await new Promise((r) => setTimeout(r));
      await settle();
      expect(api.patchListing.mock.calls.map((c) => c[1])).toEqual([{ notes: 'Prix négociable' }, { status: 'mail' }]);
      expect(current().status).toBe('mail');
      expect(current().notes).toBe('Prix négociable');
    });
  });

  describe('date de visite invalide', () => {
    it('saisie valide puis invalide : « Enregistrer » désactivé, aucun PATCH avec l\'ancienne date', async () => {
      const { el, settle } = await setup('planned');
      btn(el, 'Changer la date')!.click();
      await settle();
      const time = q(el, '[data-test=time]') as HTMLInputElement;
      time.value = '2575';
      time.dispatchEvent(new Event('input'));
      await settle();
      const save = btn(el, 'Enregistrer') as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      save.click();
      await settle();
      expect(api.patchListing).not.toHaveBeenCalled();
    });
  });

  describe('relecture de l\'annonce', () => {
    const visible = () => {
      const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      return spy;
    };

    it('à l\'entrée sur l\'onglet et au retour au premier plan', async () => {
      const { settle } = await setup('contact');
      await settle();
      expect(api.getListing).toHaveBeenCalledTimes(1);
      api.getListing.mockResolvedValue(make('mail', { price_eur: 1 }));
      const spy = visible();
      await settle();
      spy.mockRestore();
      expect(api.getListing).toHaveBeenCalledTimes(2);
      expect(current().status).toBe('mail');
    });

    it('ne remplace pas un brouillon de notes en cours de saisie', async () => {
      const { el, settle } = await setup('contact');
      const area = q(el, 'textarea') as HTMLTextAreaElement;
      area.value = 'brouillon';
      area.dispatchEvent(new Event('input'));
      api.getListing.mockResolvedValue(make('mail', { notes: 'ailleurs' }));
      const spy = visible();
      await settle();
      spy.mockRestore();
      expect(current().status).toBe('mail');
      expect(current().notes).toBe('Agent sympa');
    });

    it('annonce introuvable : marque l\'annonce comme supprimée', async () => {
      api.getListing.mockRejectedValue(new ApiError(404, 'annonce introuvable'));
      const { settle } = await setup('contact');
      await settle();
      expect(TestBed.inject(CurrentListing).deleted()).toBe(true);
    });
  });
});
