import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { ApiClient } from '../../core/api.client';
import { TemplateSection } from '../../core/api.types';

export interface AddRoomResult {
  name: string;
  from_section_id: string | null;
}

@Component({
  selector: 'app-add-room-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>Ajouter une pièce</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="name">
        <mat-label>Nom de la pièce</mat-label>
        <input matInput data-test="room-name" required autocomplete="off" [formControl]="name" />
      </mat-form-field>
      <mat-radio-group [value]="choice()" (change)="choice.set($event.value)" aria-label="Contenu de la pièce">
        <mat-radio-button value="" data-test="choice-empty">Pièce vide</mat-radio-button>
        @for (s of sections(); track s.id) {
          <mat-radio-button [value]="s.id">{{ s.name }}</mat-radio-button>
        }
      </mat-radio-group>
      @if (sections().length === 0 && loaded()) {
        <p class="hint">Hors ligne : seule une pièce vide est possible</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Annuler</button>
      <button mat-flat-button type="button" data-test="confirm" [disabled]="!valid()" (click)="confirm()">Ajouter</button>
    </mat-dialog-actions>
  `,
  styles: `
    .name { width: 100%; }
    mat-radio-group { display: flex; flex-direction: column; }
    .hint { font: var(--mat-sys-body-small); }
  `,
})
export class AddRoomDialog {
  private readonly ref = inject<MatDialogRef<AddRoomDialog, AddRoomResult>>(MatDialogRef);
  private readonly api = inject(ApiClient);

  protected readonly name = new FormControl('', { nonNullable: true });
  private readonly typedName = toSignal(this.name.valueChanges, { initialValue: '' });
  protected readonly valid = computed(() => this.typedName().trim() !== '');
  protected readonly choice = signal('');
  protected readonly sections = signal<TemplateSection[]>([]);
  /** Le chargement du modèle est terminé (réussi ou non). */
  protected readonly loaded = signal(false);

  constructor() {
    void this.loadTemplate();
  }

  private async loadTemplate(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const template = await this.api.getTemplate();
      this.sections.set(
        template.sections
          .filter((s) => s.kind === 'room' || s.kind === 'per_bedroom')
          .sort((a, b) => a.position - b.position),
      );
    } catch {
      // hors ligne ou serveur injoignable : seule la pièce vide est proposée
    } finally {
      this.loaded.set(true);
    }
  }

  protected confirm(): void {
    if (!this.valid()) return;
    this.ref.close({ name: this.name.value.trim(), from_section_id: this.choice() || null });
  }
}
