import { Directive, ElementRef, computed, inject, input } from '@angular/core';

export type NumericMode = 'integer' | 'decimal';

const MAX_DECIMALS = 2;

/**
 * Ne garde que les chiffres ; en mode `decimal`, garde aussi le premier séparateur (`,` ou `.`)
 * et au plus 2 décimales.
 */
export function sanitizeNumeric(raw: string, mode: NumericMode): string {
  let integerPart = '';
  let separator = '';
  let decimals = '';
  for (const c of raw) {
    if (c >= '0' && c <= '9') {
      if (separator === '') integerPart += c;
      else if (decimals.length < MAX_DECIMALS) decimals += c;
    } else if (mode === 'decimal' && (c === ',' || c === '.') && separator === '') {
      separator = c;
    }
  }
  return integerPart + separator + decimals;
}

/** Nombre d'une saisie filtrée (`,` → `.`) ; `null` si la saisie est vide ou n'est pas un nombre. */
export function parseNumeric(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Limite un champ texte à un nombre entier ou décimal : frappe, collage et saisie du clavier virtuel. */
@Directive({
  selector: 'input[appNumeric]',
  host: {
    '[attr.inputmode]': 'inputMode()',
    autocomplete: 'off',
    '(beforeinput)': 'onBeforeInput($event)',
    '(input)': 'onInput()',
    '(paste)': 'onPaste($event)',
  },
})
export class NumericDirective {
  readonly appNumeric = input.required<NumericMode>();
  protected readonly inputMode = computed(() => (this.appNumeric() === 'integer' ? 'numeric' : 'decimal'));
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  /** Refuse un caractère interdit avant son insertion. */
  protected onBeforeInput(event: InputEvent): void {
    if (event.data && sanitizeNumeric(event.data, this.appNumeric()) !== event.data) {
      event.preventDefault();
    }
  }

  /** Dernier filet : une valeur qui aurait échappé à `beforeinput` (clavier virtuel, glisser-déposer). */
  protected onInput(): void {
    this.apply(this.el.value);
  }

  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    const { value, selectionStart, selectionEnd } = this.el;
    const start = selectionStart ?? value.length;
    const end = selectionEnd ?? value.length;
    this.apply(value.slice(0, start) + pasted + value.slice(end));
  }

  /** Remplace la valeur par sa version filtrée ; prévient les formulaires seulement si elle a changé. */
  private apply(raw: string): void {
    const clean = sanitizeNumeric(raw, this.appNumeric());
    if (clean === this.el.value) return;
    this.el.value = clean;
    this.el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
