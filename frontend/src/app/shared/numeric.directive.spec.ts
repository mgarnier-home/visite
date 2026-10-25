import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { NumericDirective, parseNumeric, sanitizeNumeric } from './numeric.directive';

describe('sanitizeNumeric', () => {
  it('garde les chiffres', () => {
    expect(sanitizeNumeric('12a3', 'integer')).toBe('123');
    expect(sanitizeNumeric('-5', 'integer')).toBe('5');
    expect(sanitizeNumeric('1e5', 'integer')).toBe('15');
    expect(sanitizeNumeric('1,5', 'integer')).toBe('15');
  });

  it('mode décimal : un seul séparateur, deux décimales au plus', () => {
    expect(sanitizeNumeric('1 234,50 €', 'decimal')).toBe('1234,50');
    expect(sanitizeNumeric('1,2,3', 'decimal')).toBe('1,23');
    expect(sanitizeNumeric('3.14159', 'decimal')).toBe('3.14');
    expect(sanitizeNumeric('', 'decimal')).toBe('');
  });
});

describe('parseNumeric', () => {
  it('convertit la virgule et traite le vide comme null', () => {
    expect(parseNumeric('1234,50')).toBe(1234.5);
    expect(parseNumeric(' 85.5 ')).toBe(85.5);
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric(',')).toBeNull();
  });
});

@Component({
  imports: [NumericDirective],
  template: `
    <input data-test="int" appNumeric="integer" />
    <input data-test="dec" [appNumeric]="mode()" />
  `,
})
class HostComponent {
  readonly mode = signal<'integer' | 'decimal'>('decimal');
}

describe('NumericDirective', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      int: el.querySelector('[data-test=int]') as HTMLInputElement,
      dec: el.querySelector('[data-test=dec]') as HTMLInputElement,
    };
  }
  const beforeInput = (input: HTMLInputElement, data: string) => {
    const event = new InputEvent('beforeinput', { data, inputType: 'insertText', cancelable: true, bubbles: true });
    input.dispatchEvent(event);
    return event;
  };

  it('pose inputmode et autocomplete', () => {
    const { int, dec } = setup();
    expect(int.getAttribute('inputmode')).toBe('numeric');
    expect(dec.getAttribute('inputmode')).toBe('decimal');
    expect(int.getAttribute('autocomplete')).toBe('off');
  });

  it('refuse la frappe d\'un caractère interdit', () => {
    const { int, dec } = setup();
    expect(beforeInput(int, 'e').defaultPrevented).toBe(true);
    expect(beforeInput(int, ',').defaultPrevented).toBe(true);
    expect(beforeInput(int, '7').defaultPrevented).toBe(false);
    expect(beforeInput(dec, ',').defaultPrevented).toBe(false);
    expect(beforeInput(dec, '-').defaultPrevented).toBe(true);
  });

  it('nettoie une valeur saisie malgré tout (clavier virtuel)', () => {
    const { int } = setup();
    int.value = 'e';
    int.dispatchEvent(new Event('input'));
    expect(int.value).toBe('');
  });

  it('colle « 12,5 m² » dans un champ décimal', () => {
    const { dec } = setup();
    const paste = new Event('paste', { cancelable: true, bubbles: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '12,5 m²' } });
    dec.dispatchEvent(paste);
    expect(dec.value).toBe('12,5');
  });
});
