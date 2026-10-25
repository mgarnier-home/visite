import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { compressImage } from '../core/image';

/** Message affiché quand l'enregistrement local d'une photo échoue. */
export function photoErrorMessage(e: unknown): string {
  const err = e as { name?: unknown; message?: unknown } | null;
  const quota = err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message ?? ''));
  return quota ? 'Stockage plein, photo non enregistrée' : 'Photo non enregistrée';
}

/** Bouton « prendre une photo » : ouvre l'appareil photo, compresse, émet le JPEG obtenu. */
@Component({
  selector: 'app-photo-button',
  imports: [MatButtonModule, MatIconModule],
  template: `
    <button mat-stroked-button type="button" class="photo-btn" data-test="photo-btn" [disabled]="disabled()" (click)="fileInput.click()">
      <mat-icon svgIcon="photo_camera" />
      <ng-content>Photo</ng-content>
    </button>
    <input #fileInput type="file" accept="image/*" capture="environment" hidden data-test="photo-input" (change)="onChange($event)" />
  `,
  styles: '.photo-btn { min-height: 48px; }',
})
export class PhotoButtonComponent {
  readonly disabled = input(false);
  /** Photo compressée (JPEG). */
  readonly photo = output<Blob>();
  /** La compression a échoué. */
  readonly failed = output<unknown>();


  protected async onChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // remis à zéro pour pouvoir choisir deux fois le même fichier
    input.value = '';
    if (!file) return;
    try {
      this.photo.emit(await compressImage(file));
    } catch (e) {
      this.failed.emit(e);
    }
  }
}
