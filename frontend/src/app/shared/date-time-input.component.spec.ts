import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideAppIcons } from './icons';
import { DateTimeInputComponent } from './date-time-input.component';
import { splitDateTime } from './date-time';

@Component({
  imports: [FormsModule, DateTimeInputComponent],
  template: `<app-date-time-input label="Visite" [ngModel]="value()" (ngModelChange)="emitted.push($event)" />`,
})
class Host {
  readonly value = signal<string | null>(null);
  readonly emitted: (string | null)[] = [];
}

describe('DateTimeInputComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host], providers: [provideAppIcons()] });
  });

  async function setup(initial: string | null = null) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.value.set(initial);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const dateInput = el.querySelector<HTMLInputElement>('[data-test=date]')!;
    const timeInput = el.querySelector<HTMLInputElement>('[data-test=time]')!;
    const typeDate = async (v: string) => {
      dateInput.value = v;
      dateInput.dispatchEvent(new Event('input'));
      dateInput.dispatchEvent(new Event('change'));
      dateInput.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const typeTime = async (v: string, blur = true) => {
      timeInput.value = v;
      timeInput.dispatchEvent(new Event('input'));
      if (blur) timeInput.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, el, dateInput, timeInput, typeDate, typeTime, emitted: fixture.componentInstance.emitted };
  }

  it('date tapée puis heure : émet un instant qui redonne 25/10/2026 14:30', async () => {
    const { typeDate, typeTime, emitted } = await setup();
    await typeDate('25/10/2026');
    await typeTime('1430');
    const last = emitted[emitted.length - 1]!;
    const { date, time } = splitDateTime(last);
    expect([date?.getDate(), date?.getMonth(), date?.getFullYear()]).toEqual([25, 9, 2026]);
    expect(time).toBe('14:30');
  });

  it('heure vide : minuit', async () => {
    const { typeDate, emitted } = await setup();
    await typeDate('25/10/2026');
    expect(emitted[emitted.length - 1]).toMatch(/^2026-10-25T00:00:00/);
  });

  it('heure filtrée à la frappe', async () => {
    const { typeTime, timeInput } = await setup();
    await typeTime('14h3x0', false);
    expect(timeInput.value).toBe('14:30');
    expect(timeInput.getAttribute('inputmode')).toBe('numeric');
    expect(timeInput.getAttribute('maxlength')).toBe('5');
    expect(timeInput.getAttribute('placeholder')).toBe('HH:MM');
  });

  it('heure invalide : « Heure invalide » et rien d\'émis', async () => {
    const { el, typeDate, typeTime, emitted } = await setup();
    await typeDate('25/10/2026');
    const before = emitted.length;
    await typeTime('2575');
    expect(el.textContent).toContain('Heure invalide');
    expect(emitted.length).toBe(before);
  });

  it('date illisible : « Date invalide » et rien d\'émis', async () => {
    const { el, typeDate, emitted } = await setup();
    await typeDate('32/13/2026');
    expect(el.textContent).toContain('Date invalide');
    expect(emitted).toEqual([]);
  });

  it('effacer la date émet null', async () => {
    const { typeDate, emitted } = await setup('2026-10-25T14:30:00+01:00');
    await typeDate('');
    expect(emitted[emitted.length - 1]).toBeNull();
  });

  it('affiche la valeur reçue', async () => {
    const { dateInput, timeInput } = await setup('2026-10-25T14:30:00+01:00');
    const { time } = splitDateTime('2026-10-25T14:30:00+01:00');
    expect(dateInput.value).toMatch(/^2[56]\/10\/2026$/);
    expect(timeInput.value).toBe(time);
  });

  it.each(['25/10/26', '25', '25/10'])('date incomplète « %s » : « Date invalide » et rien d\'émis', async (text) => {
    const { el, typeDate, emitted } = await setup();
    await typeDate(text);
    expect(el.textContent).toContain('Date invalide');
    expect(emitted).toEqual([]);
  });
});
