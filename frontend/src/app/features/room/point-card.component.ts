import { Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Point, SharedField } from '../../core/api.types';
import { PointMenuComponent } from './point-menu.component';

interface Choice {
  label: string;
  /** Valeur émise : note (1-5, null pour N/A) ou texte (case / constat). */
  value: number | string | null;
}

/** Carte d'un point : saisie de ma note ou de la valeur partagée, bloquant et travaux. */
@Component({
  selector: 'app-point-card',
  imports: [MatIconModule, PointMenuComponent],
  templateUrl: './point-card.component.html',
  styleUrl: './point-card.component.scss',
})
export class PointCardComponent {
  readonly point = input.required<Point>();
  /** Ma note : `undefined` = pas notée, `null` = N/A. */
  readonly myRating = input<number | null | undefined>(undefined);
  readonly shared = input<Partial<Record<SharedField, unknown>>>({});
  readonly authors = input<Partial<Record<SharedField, number>>>({});
  readonly disabled = input(false);
  /** Affiche le poids du point (onglet Bilan). */
  readonly showWeight = input(false);

  readonly rate = output<number | null>();
  readonly setValue = output<string>();
  readonly setBlocking = output<boolean>();
  readonly setWorks = output<number | null>();

  protected readonly isNote = computed(() => this.point().type === 'note');

  protected readonly choices = computed<Choice[]>(() => {
    const p = this.point();
    if (p.type === 'note') {
      const notes: Choice[] = [1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: n }));
      return [...notes, { label: 'N/A', value: null }];
    }
    if (p.type === 'case') {
      return [
        { label: 'OK', value: 'ok' },
        { label: 'Problème', value: 'problem' },
        { label: 'N/A', value: 'na' },
      ];
    }
    return [...p.options.map((o) => ({ label: o, value: o })), { label: 'N/A', value: 'na' }];
  });

  protected readonly sharedValue = computed(() => this.shared()['value']);
  protected readonly valueAuthor = computed(() =>
    this.sharedValue() == null ? undefined : this.authors()['value'],
  );
  protected readonly blocking = computed(() => this.shared()['blocking'] === true);
  protected readonly works = computed(() => {
    const w = this.shared()['works_eur'];
    return typeof w === 'number' ? w : null;
  });

  protected isSelected(c: Choice): boolean {
    if (this.isNote()) return this.myRating() !== undefined && this.myRating() === c.value;
    return this.sharedValue() === c.value;
  }

  protected pick(c: Choice): void {
    if (this.isNote()) this.rate.emit(c.value as number | null);
    else this.setValue.emit(c.value as string);
  }
}
