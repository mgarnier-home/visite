import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Point, SharedField } from '../../core/api.types';
import { provideAppIcons } from '../../shared/icons';
import { PointCardComponent } from './point-card.component';

const mk = (type: Point['type'], options: string[] = []): Point =>
  ({ id: 'p1', room_id: 'r1', label: 'Sol', type, options, weight: 1, position: 0, important: true });

@Component({
  imports: [PointCardComponent],
  template: `<app-point-card
    [point]="point()" [myRating]="myRating()" [shared]="shared()" [authors]="authors()" [disabled]="disabled()"
    (rate)="rate($event)" (setValue)="setValue($event)" (setBlocking)="setBlocking($event)" (setWorks)="setWorks($event)" />`,
})
class HostComponent {
  point = signal<Point>(mk('note'));
  myRating = signal<number | null | undefined>(undefined);
  shared = signal<Partial<Record<SharedField, unknown>>>({});
  authors = signal<Partial<Record<SharedField, number>>>({});
  disabled = signal(false);
  rate = vi.fn();
  setValue = vi.fn();
  setBlocking = vi.fn();
  setWorks = vi.fn();
}

describe('PointCardComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideAppIcons()] }));

  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, host: fixture.componentInstance, el };
  }
  const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('[data-test=choice]'));

  it('note : 6 boutons (1 à 5 + N/A), un clic sur « 4 » émet rate(4)', () => {
    const { el, host } = setup();
    expect(buttons(el).map((b) => b.textContent?.trim())).toEqual(['1', '2', '3', '4', '5', 'N/A']);
    buttons(el)[3].click();
    expect(host.rate).toHaveBeenCalledWith(4);
    buttons(el)[5].click();
    expect(host.rate).toHaveBeenLastCalledWith(null);
  });

  it('note : état sélectionné visible (aria-pressed), N/A pour null, rien pour undefined', () => {
    const { fixture, el, host } = setup();
    const pressed = () => buttons(el).map((b) => b.getAttribute('aria-pressed'));
    expect(pressed()).toEqual(['false', 'false', 'false', 'false', 'false', 'false']);
    host.myRating.set(2);
    fixture.detectChanges();
    expect(pressed()).toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
    host.myRating.set(null);
    fixture.detectChanges();
    expect(pressed()).toEqual(['false', 'false', 'false', 'false', 'false', 'true']);
  });

  it('case : OK / Problème / N/A, un clic sur « Problème » émet setValue(problem)', () => {
    const { fixture, el, host } = setup();
    host.point.set(mk('case'));
    fixture.detectChanges();
    expect(buttons(el).map((b) => b.textContent?.trim())).toEqual(['OK', 'Problème', 'N/A']);
    buttons(el)[1].click();
    expect(host.setValue).toHaveBeenCalledWith('problem');
    buttons(el)[0].click();
    expect(host.setValue).toHaveBeenLastCalledWith('ok');
    buttons(el)[2].click();
    expect(host.setValue).toHaveBeenLastCalledWith('na');
  });

  it('constat : une pastille par option + N/A, valeur = texte de l\'option ou na', () => {
    const { fixture, el, host } = setup();
    host.point.set(mk('constat', ['Parquet', 'Carrelage']));
    host.shared.set({ value: 'Carrelage' });
    host.authors.set({ value: 2 });
    fixture.detectChanges();
    expect(buttons(el).map((b) => b.textContent?.trim())).toEqual(['Parquet', 'Carrelage', 'N/A']);
    expect(buttons(el).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    buttons(el)[0].click();
    expect(host.setValue).toHaveBeenCalledWith('Parquet');
    buttons(el)[2].click();
    expect(host.setValue).toHaveBeenLastCalledWith('na');
  });

  it('affiche « P<n> » sous une valeur partagée, rien sinon', () => {
    const { fixture, el, host } = setup();
    host.point.set(mk('case'));
    fixture.detectChanges();
    expect(el.querySelector('[data-test=author]')).toBeNull();
    host.shared.set({ value: 'ok' });
    host.authors.set({ value: 2 });
    fixture.detectChanges();
    expect(el.querySelector('[data-test=author]')?.textContent?.trim()).toBe('P2');
  });

  it('bloquant : icône drapeau et libellé « Bloquant »', () => {
    const { fixture, el, host } = setup();
    expect(el.querySelector('[data-test=blocking]')).toBeNull();
    host.shared.set({ blocking: true });
    fixture.detectChanges();
    expect(el.querySelector('[data-test=blocking]')?.textContent).toContain('Bloquant');
  });

  it('désactivé : tous les boutons le sont', () => {
    const { fixture, el, host } = setup();
    host.disabled.set(true);
    fixture.detectChanges();
    expect(buttons(el).every((b) => b.disabled)).toBe(true);
    expect((el.querySelector('[data-test=menu-btn]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('menu : le bouton « Point bloquant » émet setBlocking, « Travaux » vide émet null', async () => {
    const { fixture, el, host } = setup();
    host.shared.set({ blocking: false, works_eur: 500 });
    fixture.detectChanges();
    (el.querySelector('[data-test=menu-btn]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const toggle = document.body.querySelector('[data-test=blocking-toggle] button') as HTMLButtonElement;
    toggle.click();
    expect(host.setBlocking).toHaveBeenCalledWith(true);

    const works = document.body.querySelector('[data-test=works-input]') as HTMLInputElement;
    expect(works.value).toBe('500');
    works.value = '';
    works.dispatchEvent(new Event('change'));
    expect(host.setWorks).toHaveBeenLastCalledWith(null);
    works.value = '1200';
    works.dispatchEvent(new Event('change'));
    expect(host.setWorks).toHaveBeenLastCalledWith(1200);
    works.value = ',';
    works.dispatchEvent(new Event('change'));
    expect(host.setWorks).toHaveBeenCalledTimes(2);
    expect(works.value).toBe('500');
  });

  it('menu : un montant collé dans « Travaux » est envoyé à la sortie du champ', async () => {
    const { fixture, el, host } = setup();
    (el.querySelector('[data-test=menu-btn]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const works = document.body.querySelector('[data-test=works-input]') as HTMLInputElement;
    const paste = new Event('paste', { cancelable: true, bubbles: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '1 500 €' } });
    works.dispatchEvent(paste);
    expect(host.setWorks).not.toHaveBeenCalled();
    works.dispatchEvent(new Event('blur'));
    expect(host.setWorks).toHaveBeenCalledWith(1500);
  });

  it('menu : Échap, même depuis le champ Travaux, ferme le menu', async () => {
    const { fixture, el } = setup();
    (el.querySelector('[data-test=menu-btn]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const works = document.body.querySelector('[data-test=works-input]') as HTMLInputElement;
    expect(works).not.toBeNull();
    works.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.body.querySelector('[data-test=works-input]')).toBeNull());
  });
});
