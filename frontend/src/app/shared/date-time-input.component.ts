import { Component, forwardRef, input } from '@angular/core';
import { AbstractControl, ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { combineDateTime, isValidTime, normalizeTime, splitDateTime } from './date-time';

const timeValidator = (c: AbstractControl): ValidationErrors | null =>
  c.value === '' || isValidTime(c.value) ? null : { time: true };

/**
 * Date (JJ/MM/AAAA, calendrier) et heure (HH:MM, 24 h) pour un instant RFC 3339 local.
 * Valeur : `string | null`. N'émet rien tant que la date ou l'heure est invalide.
 */
@Component({
  selector: 'app-date-time-input',
  imports: [ReactiveFormsModule, MatDatepickerModule, MatFormFieldModule, MatIconModule, MatInputModule],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateTimeInputComponent), multi: true }],
  template: `
    <div class="group" role="group" [attr.aria-label]="label()">
      <mat-form-field appearance="outline" class="date">
        <mat-label>Date (JJ/MM/AAAA)</mat-label>
        <input
          matInput
          data-test="date"
          autocomplete="off"
          [matDatepicker]="picker"
          [formControl]="dateCtrl"
          (dateChange)="emit()"
          (blur)="onTouched()"
        />
        <mat-datepicker-toggle matIconSuffix [for]="picker">
          <mat-icon matDatepickerToggleIcon svgIcon="calendar_month" />
        </mat-datepicker-toggle>
        <mat-datepicker #picker />
        @if (dateCtrl.hasError('matDatepickerParse')) {
          <mat-error>Date invalide</mat-error>
        }
      </mat-form-field>
      <mat-form-field appearance="outline" class="time">
        <mat-label>Heure (HH:MM)</mat-label>
        <input
          matInput
          data-test="time"
          inputmode="numeric"
          maxlength="5"
          placeholder="HH:MM"
          autocomplete="off"
          [formControl]="timeCtrl"
          (input)="onTimeInput($event)"
          (blur)="onTimeBlur()"
        />
        @if (timeCtrl.hasError('time')) {
          <mat-error>Heure invalide</mat-error>
        }
      </mat-form-field>
    </div>
  `,
  styles: `
    .group {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .date {
      flex: 3 1 180px;
    }
    .time {
      flex: 2 1 120px;
    }
  `,
})
export class DateTimeInputComponent implements ControlValueAccessor {
  /** Libellé accessible du groupe (les deux champs ont leur propre libellé). */
  readonly label = input('');

  protected readonly dateCtrl = new FormControl<Date | null>(null);
  protected readonly timeCtrl = new FormControl<string>('', { nonNullable: true, validators: [timeValidator] });

  private onChange: (v: string | null) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(iso: string | null): void {
    const { date, time } = splitDateTime(iso);
    this.dateCtrl.setValue(date, { emitEvent: false });
    this.timeCtrl.setValue(time, { emitEvent: false });
  }

  registerOnChange(fn: (v: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    for (const c of [this.dateCtrl, this.timeCtrl]) {
      if (disabled) c.disable({ emitEvent: false });
      else c.enable({ emitEvent: false });
    }
  }

  protected onTimeInput(event: Event): void {
    this.timeCtrl.setValue(normalizeTime((event.target as HTMLInputElement).value));
  }

  protected onTimeBlur(): void {
    this.onTouched();
    this.emit();
  }

  /** Émet la valeur combinée ; rien si la date est illisible ou l'heure invalide. */
  protected emit(): void {
    if (this.dateCtrl.hasError('matDatepickerParse') || this.timeCtrl.invalid) return;
    this.onChange(combineDateTime(this.dateCtrl.value, this.timeCtrl.value));
  }
}
