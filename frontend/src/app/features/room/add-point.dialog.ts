import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { PointType } from '../../core/api.types';

export interface AddPointResult {
  label: string;
  type: PointType;
  options: string[];
}

/** Ajout d'un point : libellé, type et, pour un constat, ses options séparées par des virgules. */
@Component({
  selector: 'app-add-point-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatRadioModule],
  template: `
    <h2 mat-dialog-title>Ajouter un point</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full">
        <mat-label>Libellé</mat-label>
        <input matInput data-test="point-label" required autocomplete="off" [formControl]="label" />
      </mat-form-field>
      <mat-radio-group [value]="type()" (change)="type.set($event.value)" aria-label="Type de point">
        <mat-radio-button value="note" data-test="type-note">Note de 1 à 5</mat-radio-button>
        <mat-radio-button value="case" data-test="type-case">OK / Problème</mat-radio-button>
        <mat-radio-button value="constat" data-test="type-constat">Constat (choix)</mat-radio-button>
      </mat-radio-group>
      @if (type() === 'constat') {
        <mat-form-field appearance="outline" class="full">
          <mat-label>Options, séparées par des virgules</mat-label>
          <input matInput data-test="point-options" autocomplete="off" [formControl]="options" />
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Annuler</button>
      <button mat-flat-button type="button" data-test="confirm" [disabled]="!valid()" (click)="confirm()">Ajouter</button>
    </mat-dialog-actions>
  `,
  styles: `
    .full { width: 100%; }
    mat-radio-group { display: flex; flex-direction: column; margin-bottom: 8px; }
  `,
})
export class AddPointDialog {
  private readonly ref = inject<MatDialogRef<AddPointDialog, AddPointResult>>(MatDialogRef);

  protected readonly label = new FormControl('', { nonNullable: true });
  protected readonly options = new FormControl('', { nonNullable: true });
  protected readonly type = signal<PointType>('note');
  private readonly typedLabel = toSignal(this.label.valueChanges, { initialValue: '' });
  private readonly typedOptions = toSignal(this.options.valueChanges, { initialValue: '' });

  private readonly parsedOptions = computed(() =>
    this.typedOptions().split(',').map((o) => o.trim()).filter((o) => o !== ''),
  );
  protected readonly valid = computed(
    () => this.typedLabel().trim() !== '' && (this.type() !== 'constat' || this.parsedOptions().length > 0),
  );

  protected confirm(): void {
    if (!this.valid()) return;
    const type = this.type();
    this.ref.close({
      label: this.label.value.trim(),
      type,
      options: type === 'constat' ? this.parsedOptions() : [],
    });
  }
}
