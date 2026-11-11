import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../../core/api.client';
import { Listing, ListingStatus } from '../../core/api.types';
import { sourceLabel, STATUS_LABELS } from '../../core/listing';
import { DateTimeInputComponent } from '../../shared/date-time-input.component';
import { formatNumeric, NumericDirective, NumericMode, parseNumeric } from '../../shared/numeric.directive';
import { ConfirmDialog } from '../room/confirm.dialog';

type NumKey = keyof { [K in keyof Listing as Listing[K] extends number | null ? K : never]: 1 };
type TextKey = keyof { [K in keyof Listing as Listing[K] extends string ? K : never]: 1 };

interface FieldDef<K> { key: K; label: string; mode?: NumericMode }
const NUMBERS: FieldDef<NumKey>[] = [
  { key: 'price_eur', label: 'Prix (€)', mode: 'integer' },
  { key: 'rooms', label: 'Pièces', mode: 'integer' },
  { key: 'bedrooms', label: 'Chambres', mode: 'integer' },
  { key: 'bathrooms', label: 'Salles de bain', mode: 'integer' },
  { key: 'shower_rooms', label: "Salles d'eau", mode: 'integer' },
  { key: 'toilets', label: 'WC', mode: 'integer' },
  { key: 'living_area_m2', label: 'Surface habitable (m²)', mode: 'decimal' },
  { key: 'land_area_m2', label: 'Terrain (m²)', mode: 'decimal' },
  { key: 'parking', label: 'Garage / parking', mode: 'integer' },
  { key: 'floor', label: 'Étage', mode: 'integer' },
  { key: 'construction_year', label: 'Année de construction', mode: 'integer' },
];
const TEXTS: FieldDef<TextKey>[] = [
  { key: 'title', label: 'Titre' },
  { key: 'property_type', label: 'Type' },
  { key: 'dpe', label: 'DPE' },
  { key: 'ges', label: 'GES' },
  { key: 'heating', label: 'Chauffage' },
  { key: 'city', label: 'Ville' },
  { key: 'postal_code', label: 'Code postal' },
  { key: 'agency', label: 'Agence' },
];
const FEATURES: [string, string][] = [
  ['garden', 'Jardin'], ['terrace', 'Terrasse'], ['balcony', 'Balcon'], ['pool', 'Piscine'],
  ['cellar', 'Cave'], ['fireplace', 'Cheminée'], ['elevator', 'Ascenseur'], ['garage', 'Garage'],
];
const START: ListingStatus[] = ['contact', 'mail', 'planned'];

@Component({
  selector: 'app-edit-page',
  imports: [FormsModule, MatButtonModule, MatIconModule, DateTimeInputComponent, NumericDirective],
  templateUrl: './edit.page.html',
  styleUrl: './edit.page.scss',
})
export class EditPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';

  protected readonly listing = signal<Listing | null>(null);
  protected readonly loadError = signal(false);
  protected readonly saveError = signal('');
  protected readonly busy = signal(false);
  /** Une fois l'annonce enregistrée, plus aucune annulation possible (retour arrière du navigateur). */
  protected readonly saved = signal(false);
  protected readonly values = signal<Record<string, string>>({});
  protected readonly features = signal<string[]>([]);
  protected readonly status = signal<ListingStatus>('contact');
  protected readonly visitAt = signal<string | null>(null);

  protected readonly numbers = NUMBERS;
  protected readonly texts = TEXTS;
  protected readonly featureDefs = FEATURES;
  protected readonly start = START.map((s) => ({ status: s, label: STATUS_LABELS[s] }));
  protected readonly manual = computed(() => this.listing()?.source === 'manual');
  protected readonly sourceLine = computed(() => {
    const l = this.listing();
    return l ? (l.source === 'manual' ? 'Saisie manuelle' : `${sourceLabel(l.source)} · récupéré à l'instant`) : '';
  });
  protected readonly canSave = computed(() => !this.busy() && (this.status() !== 'planned' || !!this.visitAt()));

  constructor() {
    this.api.getListing(this.id).then(
      (l) => {
        const values: Record<string, string> = {};
        for (const f of NUMBERS) values[f.key] = formatNumeric(l[f.key]);
        for (const f of TEXTS) values[f.key] = l[f.key] ?? '';
        this.values.set(values);
        this.features.set(l.features ?? []);
        this.listing.set(l);
      },
      () => this.loadError.set(true),
    );
  }

  protected photo(photoId: string): string {
    return this.api.listingPhotoUrl(this.id, photoId);
  }

  protected set(key: string, e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.values.update((v) => ({ ...v, [key]: value }));
  }

  protected toggle(feature: string): void {
    this.features.update((f) => (f.includes(feature) ? f.filter((x) => x !== feature) : [...f, feature]));
  }

  protected setVisit(v: string | null): void {
    this.visitAt.set(v);
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    const v = this.values();
    const patch: Record<string, unknown> = { status: this.status(), features: this.features() };
    for (const f of NUMBERS) patch[f.key] = parseNumeric(v[f.key]);
    for (const f of TEXTS) patch[f.key] = v[f.key].trim();
    if (this.status() === 'planned') patch['visit_at'] = this.visitAt();
    this.busy.set(true);
    this.saveError.set('');
    try {
      await this.api.patchListing(this.id, patch as Partial<Listing>);
      this.saved.set(true);
      await this.router.navigate(['/annonces', this.id], { replaceUrl: true });
    } catch (e) {
      this.saveError.set(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      this.busy.set(false);
    }
  }

  /** Flèche de retour : simple sortie si rien n'a été chargé, sinon annulation confirmée. */
  protected back(): Promise<unknown> | void {
    return this.listing() ? this.cancel() : this.router.navigate(['/']);
  }

  protected async cancel(): Promise<void> {
    if (this.busy() || this.saved()) return;
    const ok = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: "Annuler l'ajout",
            message: "L'annonce récupérée sera supprimée de la liste.",
            confirmLabel: 'Supprimer',
          },
        })
        .afterClosed(),
    );
    if (!ok) return;
    try {
      await this.api.deleteListing(this.id);
      await this.router.navigate(['/']);
    } catch (e) {
      this.saveError.set(e instanceof Error ? e.message : 'Suppression impossible');
    }
  }
}
