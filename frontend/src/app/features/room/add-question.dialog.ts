import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

/** Saisie du texte d'une question ; se ferme sur le texte nettoyé. */
@Component({
  selector: 'app-add-question-dialog',
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Ajouter une question</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full">
        <mat-label>Question</mat-label>
        <input matInput data-test="question-text" required autocomplete="off" [formControl]="text" />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Annuler</button>
      <button mat-flat-button type="button" data-test="confirm" [disabled]="!valid()" (click)="confirm()">Ajouter</button>
    </mat-dialog-actions>
  `,
  styles: '.full { width: 100%; }',
})
export class AddQuestionDialog {
  private readonly ref = inject<MatDialogRef<AddQuestionDialog, string>>(MatDialogRef);
  protected readonly text = new FormControl('', { nonNullable: true });
  private readonly typed = toSignal(this.text.valueChanges, { initialValue: '' });
  protected readonly valid = computed(() => this.typed().trim() !== '');

  protected confirm(): void {
    if (this.valid()) this.ref.close(this.text.value.trim());
  }
}
