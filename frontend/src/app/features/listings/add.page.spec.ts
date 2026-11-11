import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../core/api.client';
import { detectSource } from '../../core/listing';
import { provideAppIcons } from '../../shared/icons';
import { AddPage } from './add.page';

describe('detectSource', () => {
  it('suit la règle du backend', () => {
    expect(detectSource('Voir https://www.bienici.com/annonce/1.')).toBe('bienici');
    expect(detectSource('https://jinka.fr/x)')).toBe('jinka');
    expect(detectSource('https://app.jinka.fr/x')).toBe('jinka');
    expect(detectSource('https://www.leboncoin.fr/ad/1')).toBe('manual');
    expect(detectSource('https://evilbienici.com/x')).toBe('manual');
    expect(detectSource('http://www.bienici.com/x')).toBeNull();
    expect(detectSource('rien ici')).toBeNull();
  });
});

async function setup(create: ReturnType<typeof vi.fn> = vi.fn()) {
  TestBed.configureTestingModule({
    imports: [AddPage],
    providers: [{ provide: ApiClient, useValue: { createListing: create } }, provideRouter([]), provideAppIcons()],
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture: ComponentFixture<AddPage> = TestBed.createComponent(AddPage);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const type = (v: string) => {
    const ta = el.querySelector<HTMLTextAreaElement>('[data-test=text]')!;
    ta.value = v;
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const submit = () => el.querySelector<HTMLButtonElement>('[data-test=submit]')!;
  const detected = () => el.querySelector('[data-test=detected]')!.textContent!.trim();
  return { fixture, el, type, submit, detected, navigate };
}

describe('AddPage', () => {
  it.each([
    ['Super https://www.bienici.com/annonce/1', "Lien Bien'ici repéré"],
    ['https://jinka.fr/a/2', 'Lien Jinka repéré'],
    ['https://www.leboncoin.fr/ad/3', 'Lien Leboncoin : saisie manuelle'],
    ['pas de lien', "Aucun lien Leboncoin, Jinka ou Bien'ici dans ce texte"],
  ])('repère « %s »', async (text, message) => {
    const s = await setup();
    s.type(text);
    expect(s.detected()).toBe(message);
  });

  it('désactive « Récupérer l\'annonce » sans lien', async () => {
    const s = await setup();
    expect(s.submit().disabled).toBe(true);
    s.type('https://www.leboncoin.fr/ad/3');
    expect(s.submit().disabled).toBe(false);
  });

  it('succès : va sur la vérification', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'abc' });
    const s = await setup(create);
    s.type('https://www.leboncoin.fr/ad/3');
    s.submit().click();
    await s.fixture.whenStable();
    expect(create).toHaveBeenCalledWith('https://www.leboncoin.fr/ad/3');
    expect(s.navigate).toHaveBeenCalledWith(['/annonces', 'abc', 'verifier']);
  });

  it('pendant l\'appel : bouton désactivé et « Récupération… »', async () => {
    const s = await setup(vi.fn().mockReturnValue(new Promise(() => undefined)));
    s.type('https://www.leboncoin.fr/ad/3');
    s.submit().click();
    s.fixture.detectChanges();
    expect(s.submit().disabled).toBe(true);
    expect(s.submit().textContent).toContain('Récupération…');
  });

  it('409 : annonce déjà suivie avec lien', async () => {
    const s = await setup(vi.fn().mockRejectedValue(new ApiError(409, 'x', { id: 'old', error: 'x' })));
    s.type('https://www.leboncoin.fr/ad/3');
    s.submit().click();
    await s.fixture.whenStable();
    s.fixture.detectChanges();
    expect(s.el.querySelector('[data-test=error]')!.textContent).toContain('Cette annonce est déjà suivie');
    expect(s.el.querySelector('[data-test=error] a')!.getAttribute('href')).toBe('/annonces/old');
  });

  it('502 : message du serveur, texte conservé', async () => {
    const s = await setup(vi.fn().mockRejectedValue(new ApiError(502, 'Bien\'ici ne répond pas', { error: 'Bien\'ici ne répond pas' })));
    s.type('https://www.leboncoin.fr/ad/3');
    s.submit().click();
    await s.fixture.whenStable();
    s.fixture.detectChanges();
    expect(s.el.querySelector('[data-test=error]')!.textContent).toContain('Bien\'ici ne répond pas');
    expect(s.el.querySelector<HTMLTextAreaElement>('[data-test=text]')!.value).toBe('https://www.leboncoin.fr/ad/3');
    expect(s.submit().disabled).toBe(false);
  });
});
