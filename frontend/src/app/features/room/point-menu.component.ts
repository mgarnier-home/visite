import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

/** Menu ⋯ d'un point : point bloquant et coût des travaux. */
@Component({
  selector: 'app-point-menu',
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatSlideToggleModule],
  template: `
    <button mat-icon-button type="button" class="menu-btn" data-test="menu-btn" aria-label="Options du point"
      [disabled]="disabled()" [matMenuTriggerFor]="menu">
      <mat-icon svgIcon="more_vert" />
    </button>
    <mat-menu #menu="matMenu">
      <!-- les clics dans le panneau ne doivent pas le fermer -->
      <div class="panel" (click)="$event.stopPropagation()" (keydown)="onKeydown($event)" role="presentation">
        <mat-slide-toggle data-test="blocking-toggle" [checked]="blocking()" [disabled]="disabled()"
          (change)="blockingChange.emit($event.checked)">Point bloquant</mat-slide-toggle>
        <label class="works">
          <span>Travaux (€)</span>
          <input type="number" inputmode="numeric" min="0" step="1" data-test="works-input"
            [value]="works() ?? ''" [disabled]="disabled()" (change)="onWorks($event)" />
        </label>
      </div>
    </mat-menu>
  `,
  styles: `
    .menu-btn { width: 48px; height: 48px; }
    .panel { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; min-width: 240px; }
    mat-slide-toggle { min-height: 48px; display: flex; align-items: center; }
    .works { display: flex; flex-direction: column; gap: 4px; font: var(--mat-sys-label-large); }
    .works input { min-height: 48px; box-sizing: border-box; padding: 0 12px; font: var(--mat-sys-body-large); }
  `,
})
export class PointMenuComponent {
  readonly blocking = input(false);
  readonly works = input<number | null>(null);
  readonly disabled = input(false);
  readonly blockingChange = output<boolean>();
  /** Entier ≥ 0, ou `null` quand le champ est vide. */
  readonly worksChange = output<number | null>();

  /** Le menu détourne flèches, Entrée, espace et recherche par lettre ; Échap et Tab doivent le traverser. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Tab') return;
    event.stopPropagation();
  }

  protected onWorks(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.validity.badInput) return; // saisie partielle invalide : on ne l'interprète pas
    const raw = input.value.trim();
    if (raw === '') {
      this.worksChange.emit(null);
      return;
    }
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) {
      this.worksChange.emit(n);
    } else {
      input.value = String(this.works() ?? ''); // saisie refusée : on restaure la valeur
    }
  }
}
