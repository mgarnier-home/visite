import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Fiche } from '../../core/api.types';
import { buildingAge, notaryFees, pricePerM2, realPrice } from '../../core/compute';
import { formatEur } from '../../core/format';
import { SyncService } from '../../core/sync.service';
import { DateTimeInputComponent } from '../../shared/date-time-input.component';
import { NumericDirective, NumericMode, parseNumeric } from '../../shared/numeric.directive';

type FicheKind = 'text' | 'eur' | 'number' | 'integer' | 'dpe' | 'datetime' | 'tel' | 'email' | 'url';
interface FicheField {
  name: keyof Fiche;
  label: string;
  kind: FicheKind;
}

/** Classes énergétiques du DPE (même liste que la création, sans importer la page). */
const DPE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

/** Fiche du bien : lecture seule, ou formulaire pour le créateur de la visite. */
@Component({
  selector: 'app-fiche-tab',
  imports: [FormsModule, DateTimeInputComponent, NumericDirective],
  templateUrl: './fiche-tab.component.html',
  styleUrl: './fiche-tab.component.scss',
})
export class FicheTabComponent {
  private readonly sync = inject(SyncService);
  private readonly snack = inject(MatSnackBar);
  private readonly state = this.sync.state;

  protected readonly dpeClasses = DPE_CLASSES;
  protected readonly fields: FicheField[] = [
    { name: 'address', label: 'Adresse', kind: 'text' },
    { name: 'price_eur', label: 'Prix (€)', kind: 'eur' },
    { name: 'visit_at', label: 'Date et heure de la visite', kind: 'datetime' },
    { name: 'living_area_m2', label: 'Surface habitable (m²)', kind: 'number' },
    { name: 'floor_area_m2', label: 'Surface au sol (m²)', kind: 'number' },
    { name: 'land_area_m2', label: 'Terrain (m²)', kind: 'number' },
    { name: 'rooms_count', label: 'Nombre de pièces', kind: 'integer' },
    { name: 'bedrooms_count', label: 'Nombre de chambres', kind: 'integer' },
    { name: 'construction_year', label: 'Année de construction', kind: 'integer' },
    { name: 'dpe_energy', label: 'DPE énergie', kind: 'dpe' },
    { name: 'dpe_ges', label: 'DPE GES', kind: 'dpe' },
    { name: 'heating_type', label: 'Type de chauffage', kind: 'text' },
    { name: 'listing_url', label: 'Annonce (lien)', kind: 'url' },
    { name: 'agent_name', label: "Nom de l'agent", kind: 'text' },
    { name: 'agent_phone', label: "Téléphone de l'agent", kind: 'tel' },
    { name: 'agent_email', label: "E-mail de l'agent", kind: 'email' },
  ];

  protected readonly byName = Object.fromEntries(this.fields.map((f) => [f.name, f])) as Record<keyof Fiche, FicheField>;

  protected readonly fiche = computed(() => this.state()?.visit.fiche ?? null);
  protected readonly editable = computed(() => !!this.state()?.visit.is_creator);
  protected readonly closed = computed(() => !!this.state()?.visit.closed_at);

  protected readonly computedRows = computed(() => {
    const s = this.state();
    if (!s) return [];
    const f = s.visit.fiche;
    const perM2 = pricePerM2(f);
    const age = buildingAge(f, new Date().getFullYear());
    const real = realPrice(s);
    return [
      { id: 'price-m2', label: 'Prix au m²', value: perM2 === null ? '—' : `${formatEur(perM2)}/m²` },
      {
        id: 'notary',
        label: 'Frais de notaire (≈ 7,5 %)',
        value: f.price_eur === null ? '—' : formatEur(notaryFees(f.price_eur)),
      },
      { id: 'age', label: 'Âge du bâtiment', value: age === null ? '—' : `${age} ans` },
      { id: 'real-price', label: 'Prix réel', value: real === null ? '—' : formatEur(real) },
    ];
  });

  /** Valeur de lecture seule d'un champ. */
  protected display(field: FicheField): string {
    const v = this.fiche()?.[field.name] ?? null;
    if (v === null || v === '') return '—';
    if (field.kind === 'eur') return formatEur(v as number);
    if (field.kind === 'datetime') {
      const d = new Date(v as string);
      return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
    }
    return String(v);
  }

  protected link(field: FicheField): string | null {
    const v = this.fiche()?.[field.name];
    if (typeof v !== 'string' || v === '') return null;
    if (field.kind === 'tel') return `tel:${v}`;
    if (field.kind === 'email') return `mailto:${v}`;
    // sans schéma http(s), le lien serait relatif à l'application : on préfixe https://
    if (field.kind === 'url') return /^https?:\/\//i.test(v) ? v : `https://${v}`;
    return null;
  }

  /** Valeur initiale d'un champ de saisie. */
  protected inputValue(field: FicheField): string {
    const v = this.fiche()?.[field.name] ?? null;
    return v === null ? '' : String(v);
  }

  protected inputType(kind: FicheKind): string {
    switch (kind) {
      case 'text':
        return 'text';
      default:
        return kind;
    }
  }

  /** Mode du filtre numérique d'un champ, `null` si le champ n'est pas numérique. */
  protected numericMode(kind: FicheKind): NumericMode | null {
    switch (kind) {
      case 'eur':
      case 'integer':
        return 'integer';
      case 'number':
        return 'decimal';
      default:
        return null;
    }
  }

  /** Champ modifié : envoie `set_fiche` si la valeur valide diffère de l'état, sinon restaure l'affichage. */
  protected async onChange(field: FicheField, event: Event): Promise<void> {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    const next = this.parse(field, el);
    if (next === undefined) el.value = this.inputValue(field);
    else await this.save(field, next);
  }

  /** Date et heure de la visite modifiées (le composant n'émet que des valeurs valides). */
  protected async onDateTime(field: FicheField, next: string | null): Promise<void> {
    const current = this.fiche()?.[field.name] ?? null;
    if (next === current || this.sameInstant(next, current)) return;
    await this.save(field, next);
  }

  private async save(field: FicheField, next: string | number | null): Promise<void> {
    const current = this.fiche()?.[field.name] ?? null;
    if (next === current) return;
    try {
      await this.sync.dispatch('set_fiche', { fields: { [field.name]: next } });
    } catch {
      this.snack.open('Modification non enregistrée', 'OK', { duration: 5000 });
    }
  }

  /** Valeur à envoyer ; `undefined` si la saisie est invalide (ignorée). */
  private parse(field: FicheField, el: HTMLInputElement | HTMLSelectElement): string | number | null | undefined {
    const raw = el.value.trim();
    switch (field.kind) {
      case 'eur':
      case 'number':
      case 'integer': {
        if (raw === '') return null;
        return parseNumeric(raw) ?? undefined; // « , » seul : saisie ignorée
      }
      case 'text':
        if (field.name === 'address' && raw === '') return undefined; // l'adresse est obligatoire
        return raw === '' ? null : raw;
      default:
        return raw === '' ? null : raw;
    }
  }

  private sameInstant(next: string | null, current: unknown): boolean {
    return typeof next === 'string' && typeof current === 'string' && new Date(next).getTime() === new Date(current).getTime();
  }
}
