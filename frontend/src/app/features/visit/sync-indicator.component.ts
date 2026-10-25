import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SyncService } from '../../core/sync.service';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** État de la synchronisation : à jour, éléments en attente ou hors ligne. */
@Component({
  selector: 'app-sync-indicator',
  imports: [MatIconModule],
  template: `
    <div class="sync" data-test="sync-indicator">
      <mat-icon [svgIcon]="icon()" />
      <span data-test="sync-label">{{ label() }}</span>
    </div>
    @if (pendingText()) {
      <div class="detail" data-test="sync-pending">{{ pendingText() }}</div>
    }
    @if (status().error) {
      <div class="detail error" role="alert" data-test="sync-error">{{ status().error }}</div>
    }
  `,
  styles: `
    .sync { display: flex; align-items: center; gap: 8px; font: var(--mat-sys-body-medium); }
    .detail { font: var(--mat-sys-body-small); }
    .error { color: var(--mat-sys-error); }
  `,
})
export class SyncIndicatorComponent {
  protected readonly status = inject(SyncService).status;

  private readonly pending = computed(() => this.status().pendingOps + this.status().pendingPhotos);
  private readonly pendingLabel = computed(
    () =>
      `${plural(this.status().pendingOps, 'modification', 'modifications')} et ` +
      `${plural(this.status().pendingPhotos, 'photo', 'photos')} en attente`,
  );

  protected readonly icon = computed(() => {
    if (!this.status().online) return 'cloud_off';
    return this.pending() === 0 ? 'cloud_done' : 'sync';
  });
  protected readonly label = computed(() => {
    if (!this.status().online) return 'Hors ligne';
    return this.pending() === 0 ? 'Synchronisé' : this.pendingLabel();
  });
  /** Hors ligne, les éléments en attente restent signalés sous le libellé. */
  protected readonly pendingText = computed(() =>
    !this.status().online && this.pending() > 0 ? this.pendingLabel() : '',
  );
}
