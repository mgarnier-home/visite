import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
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

  it('limite la partie entière à 9 chiffres', () => {
    expect(sanitizeNumeric('12345678901', 'integer')).toBe('123456789');
    expect(sanitizeNumeric('1234567890,55', 'decimal')).toBe('123456789,55');
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

  it('bloque un second séparateur, sauf s\'il remplace le premier', () => {
    const { dec } = setup();
    dec.value = '12,5';
    dec.setSelectionRange(4, 4);
    expect(beforeInput(dec, '.').defaultPrevented).toBe(true);
    dec.setSelectionRange(2, 3);
    expect(beforeInput(dec, '.').defaultPrevented).toBe(false);
  });

  it('composition : la valeur n\'est filtrée qu\'à compositionend', () => {
    const { int } = setup();
    int.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const event = new InputEvent('beforeinput', { data: 'ab', inputType: 'insertCompositionText', isComposing: true, cancelable: true, bubbles: true });
    int.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    int.value = 'a1b';
    int.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }));
    expect(int.value).toBe('a1b');
    int.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(int.value).toBe('1');
  });

  it('garde le curseur à l\'endroit de l\'insertion quand un caractère est filtré', () => {
    const { int } = setup();
    int.value = '12x34';
    int.setSelectionRange(3, 3);
    int.dispatchEvent(new Event('input'));
    expect(int.value).toBe('1234');
    expect(int.selectionStart).toBe(2);
  });

  it('colle « 12,5 m² » dans un champ décimal', () => {
    const { dec } = setup();
    const paste = new Event('paste', { cancelable: true, bubbles: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '12,5 m²' } });
    dec.dispatchEvent(paste);
    expect(dec.value).toBe('12,5');
  });

  const paste = (input: HTMLInputElement, text: string) => {
    const event = new Event('paste', { cancelable: true, bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    input.dispatchEvent(event);
  };

  it('collage écrit en code : un `change` part à la sortie du champ', () => {
    const { dec } = setup();
    const changes: Event[] = [];
    dec.addEventListener('change', (e) => changes.push(e));
    paste(dec, '12,5 m²');
    expect(changes.length).toBe(0);
    dec.dispatchEvent(new Event('blur'));
    expect(dec.value).toBe('12,5');
    expect(changes.length).toBe(1);
    dec.dispatchEvent(new Event('blur'));
    expect(changes.length).toBe(1);
  });

  it('collage suivi d\'un `change` natif : pas de second `change` à la sortie', () => {
    const { dec } = setup();
    const changes: Event[] = [];
    dec.addEventListener('change', (e) => changes.push(e));
    paste(dec, '7');
    dec.dispatchEvent(new Event('change'));
    dec.dispatchEvent(new Event('blur'));
    expect(changes.length).toBe(1);
  });

  it('collage sans effet : aucun `change` à la sortie', () => {
    const { int } = setup();
    const changes: Event[] = [];
    int.addEventListener('change', (e) => changes.push(e));
    paste(int, 'abc');
    int.dispatchEvent(new Event('blur'));
    expect(changes.length).toBe(0);
  });

  it('collage via execCommand (saisie native) : la valeur nettoyée est insérée, sans `change` de rattrapage', () => {
    const { dec } = setup();
    const exec = vi.fn((_cmd: string, _ui: boolean, text: string) => {
      dec.value = text;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    try {
      const changes: Event[] = [];
      dec.addEventListener('change', (e) => changes.push(e));
      paste(dec, '12,5 m²');
      dec.dispatchEvent(new Event('blur'));
      expect(exec).toHaveBeenCalledWith('insertText', false, '12,5');
      expect(dec.value).toBe('12,5');
      expect(changes.length).toBe(0);
    } finally {
      delete (document as unknown as Record<string, unknown>)['execCommand'];
    }
  });

  it('composition interrompue : la sortie du champ réactive le filtrage', () => {
    const { int } = setup();
    int.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    int.dispatchEvent(new Event('blur'));
    int.value = 'x';
    int.dispatchEvent(new Event('input'));
    expect(int.value).toBe('');
  });
});
