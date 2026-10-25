import { Directive, ElementRef, computed, inject, input } from '@angular/core';

export type NumericMode = 'integer' | 'decimal';

const MAX_DECIMALS = 2;
/** Garde-fou : au-delà, la valeur n'a aucun sens pour un prix, une surface ou un poids. */
const MAX_INTEGER_DIGITS = 9;

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
      if (separator === '') {
        if (integerPart.length < MAX_INTEGER_DIGITS) integerPart += c;
      }
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
    '(input)': 'onInput($event)',
    '(compositionstart)': 'onCompositionStart()',
    '(compositionend)': 'onCompositionEnd()',
    '(paste)': 'onPaste($event)',
    '(change)': 'onChange()',
    '(blur)': 'onBlur()',
  },
})
export class NumericDirective {
  readonly appNumeric = input.required<NumericMode>();
  protected readonly inputMode = computed(() => (this.appNumeric() === 'integer' ? 'numeric' : 'decimal'));
  private composing = false;
  /** Valeur avant un collage écrit « à la main » : aucun `change` natif ne suivra à la sortie du champ. */
  private valueBeforePaste: string | null = null;
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  /** Refuse un caractère interdit, ou un second séparateur, avant son insertion. */
  protected onBeforeInput(event: InputEvent): void {
    // composition (IME) : le texte provisoire n'est pas annulable, il est filtré à `compositionend`
    if (event.isComposing || event.inputType === 'insertCompositionText' || !event.data) return;
    const mode = this.appNumeric();
    if (sanitizeNumeric(event.data, mode) !== event.data) {
      event.preventDefault();
      return;
    }
    if (mode === 'decimal' && /[,.]/.test(event.data)) {
      const { value, selectionStart, selectionEnd } = this.el;
      const kept = value.slice(0, selectionStart ?? value.length) + value.slice(selectionEnd ?? value.length);
      if (/[,.]/.test(kept)) event.preventDefault();
    }
  }

  /** Dernier filet : une valeur qui aurait échappé à `beforeinput` (clavier virtuel, glisser-déposer). */
  protected onInput(event: Event): void {
    if (this.composing || (event as InputEvent).isComposing) return;
    this.apply(this.el.value, this.el.selectionStart);
  }

  protected onCompositionStart(): void {
    this.composing = true;
  }

  protected onCompositionEnd(): void {
    this.composing = false;
    this.apply(this.el.value, this.el.selectionStart);
  }

  protected onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    const { value, selectionStart, selectionEnd } = this.el;
    const start = selectionStart ?? value.length;
    const end = selectionEnd ?? value.length;
    const raw = value.slice(0, start) + pasted + value.slice(end);
    const mode = this.appNumeric();
    const clean = sanitizeNumeric(raw, mode);
    const position = Math.min(sanitizeNumeric(raw.slice(0, start + pasted.length), mode).length, clean.length);
    // Saisie utilisateur native : `input` et `change` partent d'eux-mêmes et l'annulation reste possible.
    if (this.insertNatively(clean)) {
      this.el.setSelectionRange(position, position);
      return;
    }
    this.valueBeforePaste ??= value;
    this.apply(raw, start + pasted.length);
  }

  /** Les formulaires reçoivent le `change` natif : plus rien à rattraper. */
  protected onChange(): void {
    this.valueBeforePaste = null;
  }

  /** Sortie du champ : rattrape le `change` qu'un collage écrit en code n'a pas déclenché. */
  protected onBlur(): void {
    this.composing = false; // `compositionend` peut ne jamais arriver
    const before = this.valueBeforePaste;
    this.valueBeforePaste = null;
    if (before !== null && before !== this.el.value) {
      this.el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /** Remplace tout le contenu par `text` comme le ferait l'utilisateur ; `false` si le navigateur ne sait pas. */
  private insertNatively(text: string): boolean {
    if (typeof document.execCommand !== 'function') return false;
    this.el.select();
    return document.execCommand('insertText', false, text);
  }

  /**
   * Remplace la valeur par sa version filtrée et garde le curseur au même endroit du texte ;
   * prévient les formulaires seulement si la valeur a changé.
   */
  private apply(raw: string, caret: number | null): void {
    const mode = this.appNumeric();
    const clean = sanitizeNumeric(raw, mode);
    if (clean === this.el.value) return;
    const position = Math.min(sanitizeNumeric(raw.slice(0, caret ?? raw.length), mode).length, clean.length);
    this.el.value = clean;
    this.el.setSelectionRange(position, position);
    this.el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
