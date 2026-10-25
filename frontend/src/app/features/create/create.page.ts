import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Observable, Subject, catchError, from, map, of, switchMap, timer } from 'rxjs';
import { ApiClient, ApiError } from '../../core/api.client';
import { Fiche, VisitState } from '../../core/api.types';
import { CODE_RE, normalizeCode } from '../../core/code';
import { LocalStore } from '../../core/local-store';
import { localIsoWithOffset } from '../../core/sync.service';
import { normalizeCodeWhileTyping } from '../code-typing';

type CodeStatus = 'idle' | 'pending' | 'free' | 'taken' | 'error';

const numberControl = () => new FormControl<number | null>(null, { validators: [Validators.min(0)] });
/** Refuse une valeur décimale (nombre de pièces, de chambres, année). */
const integerValidator = (c: AbstractControl): ValidationErrors | null =>
  c.value === null || c.value === '' || Number.isInteger(c.value) ? null : { integer: true };
const integerControl = () =>
  new FormControl<number | null>(null, { validators: [Validators.min(0), integerValidator] });
const textControl = () => new FormControl<string>('', { nonNullable: true });

/** Classes énergétiques du DPE ; `null` = non renseigné. */
export const DPE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

@Component({
  selector: 'app-create-page',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './create.page.html',
  styleUrl: './create.page.scss',
})
export class CreatePage {
  private readonly api = inject(ApiClient);
  private readonly store = inject(LocalStore);
  private readonly router = inject(Router);

  protected readonly dpeClasses = DPE_CLASSES;
  protected readonly code = signal('');
  protected readonly codeStatus = signal<CodeStatus>('idle');
  protected readonly address = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly form = {
    address: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    price_eur: numberControl(),
    living_area_m2: numberControl(),
    floor_area_m2: numberControl(),
    land_area_m2: numberControl(),
    visit_at: textControl(),
    agent_name: textControl(),
    agent_phone: textControl(),
    agent_email: textControl(),
    construction_year: integerControl(),
    dpe_energy: new FormControl<string | null>(null),
    dpe_ges: new FormControl<string | null>(null),
    rooms_count: integerControl(),
    bedrooms_count: integerControl(),
    listing_url: textControl(),
    heating_type: textControl(),
  };

  private readonly group = new FormGroup(this.form);
  private readonly formValid = toSignal(this.group.statusChanges.pipe(map(() => this.group.valid)), {
    initialValue: false,
  });

  private readonly codeInput$ = new Subject<string>();

  constructor() {
    this.form.address.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((v) => this.address.set(v));
    this.codeInput$
      .pipe(
        // Le délai est dans le switchMap : une réponse tardive d'un code précédent est ignorée.
        switchMap((typed) =>
          timer(300).pipe(
            switchMap((): Observable<CodeStatus> => {
              const code = normalizeCode(typed);
              if (!CODE_RE.test(code)) return of<CodeStatus>('idle');
              return from(this.api.exists(code)).pipe(
                map((r): CodeStatus => (r.exists ? 'taken' : 'free')),
                catchError(() => of<CodeStatus>('error')),
              );
            }),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((status) => this.codeStatus.set(status));
  }

  protected onCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const typed = normalizeCodeWhileTyping(input.value);
    input.value = typed;
    this.code.set(typed);
    this.error.set('');
    this.codeStatus.set(CODE_RE.test(normalizeCode(typed)) ? 'pending' : 'idle');
    this.codeInput$.next(typed);
  }

  protected codeValid(): boolean {
    return CODE_RE.test(normalizeCode(this.code()));
  }

  protected canSubmit(): boolean {
    return (
      !this.busy() &&
      this.address().trim() !== '' &&
      this.formValid() &&
      this.codeValid() &&
      this.codeStatus() === 'free'
    );
  }

  private text(v: string): string | null {
    const t = v.trim();
    return t === '' ? null : t;
  }

  private buildFiche(): Fiche {
    const f = this.form;
    const visitAt = f.visit_at.value ? new Date(f.visit_at.value) : null;
    return {
      address: f.address.value.trim(),
      price_eur: f.price_eur.value,
      living_area_m2: f.living_area_m2.value,
      floor_area_m2: f.floor_area_m2.value,
      land_area_m2: f.land_area_m2.value,
      visit_at: visitAt && !Number.isNaN(visitAt.getTime()) ? localIsoWithOffset(visitAt) : null,
      agent_name: this.text(f.agent_name.value),
      agent_phone: this.text(f.agent_phone.value),
      agent_email: this.text(f.agent_email.value),
      construction_year: f.construction_year.value,
      dpe_energy: f.dpe_energy.value,
      dpe_ges: f.dpe_ges.value,
      rooms_count: f.rooms_count.value,
      bedrooms_count: f.bedrooms_count.value,
      listing_url: this.text(f.listing_url.value),
      heating_type: this.text(f.heating_type.value),
    };
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    const code = normalizeCode(this.code());
    this.busy.set(true);
    this.error.set('');
    try {
      await this.open(code, await this.api.create({ code, fiche: this.buildFiche() }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Réponse d'une création précédente perdue (réseau coupé) : la visite est peut-être la
        // mienne. GET sans join, pour ne jamais devenir participant de la visite d'un autre.
        const mine = await this.ownVisit(code);
        if (mine) {
          await this.open(code, mine);
          return;
        }
        this.codeStatus.set('taken');
        this.error.set('Ce code est déjà pris');
      } else if (e instanceof ApiError && e.status === 0) {
        this.error.set('Il faut du réseau pour créer une visite');
      } else {
        this.error.set('Impossible de créer la visite pour l\'instant');
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** État de la visite si cet appareil en est le créateur, sinon null. */
  private async ownVisit(code: string): Promise<VisitState | null> {
    try {
      const state = await this.api.state(code);
      return state.visit.is_creator ? state : null;
    } catch {
      return null;
    }
  }

  /** Enregistre l'état de la visite créée puis l'ouvre. */
  private async open(code: string, state: VisitState): Promise<void> {
    try {
      await this.store.saveState(code, state);
    } catch {
      // La visite existe côté serveur : réessayer la création donnerait un 409.
      this.error.set('Visite créée, mais l\'enregistrement local a échoué');
    }
    await this.router.navigate(['/v', code]);
  }
}
