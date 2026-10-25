import { Component, ElementRef, forwardRef, input, viewChild } from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  FormControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { combineDateTime, provideFrenchDates, isValidTime, normalizeTime, splitDateTime } from './date-time';

const timeValidator = (c: AbstractControl): ValidationErrors | null =>
  c.value === '' || isValidTime(c.value) ? null : { time: true };

/**
 * Date (JJ/MM/AAAA, calendrier) et heure (HH:MM, 24 h) pour un instant RFC 3339 local.
 * Valeur : `string | null`. N'émet rien tant que la date ou l'heure est invalide.
 */
@Component({
  selector: 'app-date-time-input',
  imports: [ReactiveFormsModule, MatDatepickerModule, MatFormFieldModule, MatIconModule, MatInputModule],
  providers: [
    // Adaptateur chargé avec le composant, pas dans le bundle initial.
    provideFrenchDates(),
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => DateTimeInputComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => DateTimeInputComponent), multi: true },
  ],
  template: `
    <div class="group" role="group" [attr.aria-label]="label()">
      <mat-form-field appearance="outline" class="date">
        <mat-label>Date (JJ/MM/AAAA)</mat-label>
        <input
          matInput
          data-test="date"
          autocomplete="off"
          #dateEl
          [matDatepicker]="picker"
          [formControl]="dateCtrl"
          (input)="checkDate()"
          (dateChange)="onDateChange()"
          (blur)="onTouched()"
        />
        <mat-datepicker-toggle matIconSuffix [for]="picker">
          <mat-icon matDatepickerToggleIcon svgIcon="calendar_month" />
        </mat-datepicker-toggle>
        <mat-datepicker #picker />
        @if (dateCtrl.invalid) {
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
    :host {
      display: block;
    }
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
export class DateTimeInputComponent implements ControlValueAccessor, Validator {
  /** Libellé accessible du groupe (les deux champs ont leur propre libellé). */
  readonly label = input('');

  private readonly dateEl = viewChild.required<ElementRef<HTMLInputElement>>('dateEl');
  private dateTextBad = false;

  protected readonly dateCtrl = new FormControl<Date | null>(null, {
    validators: [() => (this.dateTextBad ? { dateText: true } : null)],
  });
  protected readonly timeCtrl = new FormControl<string>('', { nonNullable: true, validators: [timeValidator] });

  private onChange: (v: string | null) => void = () => undefined;
  private onValidatorChange: () => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(iso: string | null): void {
    const { date, time } = splitDateTime(iso);
    this.dateCtrl.setValue(date, { emitEvent: false });
    this.timeCtrl.setValue(time, { emitEvent: false });
    this.dateTextBad = false;
    this.dateCtrl.updateValueAndValidity({ emitEvent: false });
  }

  validate(): ValidationErrors | null {
    return this.dateCtrl.invalid || this.timeCtrl.invalid ? { dateTime: true } : null;
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
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
    this.onValidatorChange();
  }

  protected onTimeBlur(): void {
    this.onTouched();
    this.emit();
  }

  protected onDateChange(): void {
    this.checkDate();
    this.emit();
  }

  /** Texte de la date : exactement JJ/MM/AAAA et lisible par le calendrier, sinon invalide. */
  protected checkDate(): void {
    const text = this.dateEl().nativeElement.value.trim();
    this.dateTextBad = (text !== '' && !/^\d{2}\/\d{2}\/\d{4}$/.test(text)) || this.dateCtrl.hasError('matDatepickerParse');
    this.dateCtrl.updateValueAndValidity({ emitEvent: false });
    this.onValidatorChange();
  }

  /** Émet la valeur combinée ; rien si la date est illisible ou l'heure invalide. */
  protected emit(): void {
    if (this.dateCtrl.invalid || this.timeCtrl.invalid) return;
    this.onChange(combineDateTime(this.dateCtrl.value, this.timeCtrl.value));
  }
}
