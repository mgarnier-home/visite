import { Component, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SyncService } from '../../core/sync.service';

/** État de la synchronisation : envoi en cours, à jour ou erreur de mise à jour. */
@Component({
  selector: 'app-sync-indicator',
  imports: [MatIconModule],
  template: `
    <div class="sync" data-test="sync-indicator">
      <mat-icon [svgIcon]="status().sending ? 'sync' : 'cloud_done'" />
      <span data-test="sync-label">{{ status().sending ? 'Envoi…' : 'Synchronisé' }}</span>
    </div>
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
}
