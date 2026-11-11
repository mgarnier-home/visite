import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ApiClient, ApiError } from '../../core/api.client';
import { formatEur } from '../../core/format';
import { Listing, ListingStatus } from '../../core/api.types';
import { CurrentListing } from '../../core/current-listing';
import { day, dayTime, sourceLabel, specsLine, STATUS_LABELS } from '../../core/listing';
import { onPageHidden } from '../../core/page-hidden';
import { DateTimeInputComponent } from '../../shared/date-time-input.component';
import { ConfirmDialog } from '../room/confirm.dialog';

const STEPS: ListingStatus[] = ['contact', 'mail', 'planned', 'done'];
const eur = new Intl.NumberFormat('fr-FR');
const NA = 'Non indiqué';

/** Onglet Annonce (maquette 4) : suivi du statut, caractéristiques, contact, notes. */
@Component({
  selector: 'app-listing-tab',
  imports: [FormsModule, RouterLink, MatButtonModule, MatIconModule, DateTimeInputComponent],
  templateUrl: './listing-tab.component.html',
  styleUrl: './listing-tab.component.scss',
})
export class ListingTabComponent {
  private readonly api = inject(ApiClient);
  private readonly current = inject(CurrentListing);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  protected readonly l = this.current.listing;
  protected readonly now = new Date();
  protected readonly planning = signal(false);
  protected readonly busy = signal(false);
  protected readonly refreshError = signal('');
  protected readonly showDescription = signal(false);
  protected readonly visitAt = signal<string | null>(null);
  protected readonly photoIndex = signal(0);

  private notesDraft: string | null = null;

  constructor() {
    onPageHidden(() => void this.saveNotes());
    // navigation sans blur (retour du navigateur, lien Accueil) : le brouillon part quand même
    inject(DestroyRef).onDestroy(() => void this.saveNotes());
  }

  protected readonly statusLabels = STATUS_LABELS;

  protected readonly steps = computed(() => {
    const l = this.l();
    if (!l) return [];
    const dates = [l.created_at, l.mail_sent_at, l.visit_at, l.visited_at];
    const idx = STEPS.indexOf(l.status);
    return STEPS.map((s, i) => ({
      status: s,
      label: STATUS_LABELS[s],
      current: i === idx,
      reached: i <= idx,
      date: i > idx || !dates[i] ? '' : i === 2 ? dayTime(dates[i]!, this.now) : day(dates[i]!, this.now),
    }));
  });

  protected readonly pricePerM2 = computed(() => {
    const l = this.l();
    return l?.price_eur != null && l.living_area_m2 ? `${eur.format(Math.round(l.price_eur / l.living_area_m2))} €/m²` : '';
  });
  protected readonly specs = computed(() => (this.l() ? specsLine(this.l()!) : ''));
  protected readonly place = computed(() => {
    const l = this.l();
    if (!l) return '';
    const city = [l.city, l.postal_code && `(${l.postal_code})`].filter(Boolean).join(' ');
    return [city, l.land_area_m2 != null && `terrain ${eur.format(l.land_area_m2)} m²`].filter(Boolean).join(' · ');
  });
  protected readonly characteristics = computed(() => {
    const l = this.l();
    if (!l) return [];
    const n = (v: number | null, unit = '') => (v == null ? NA : `${eur.format(v)}${unit}`);
    const bath = [l.bathrooms != null && `${l.bathrooms}`, l.shower_rooms != null && `${l.shower_rooms} salle d’eau`]
      .filter(Boolean).join(' + ');
    return [
      ['Pièces', n(l.rooms)], ['Chambres', n(l.bedrooms)],
      ['Salles de bain', bath || NA], ['WC', n(l.toilets)],
      ['Surface habitable', n(l.living_area_m2, ' m²')], ['Terrain', n(l.land_area_m2, ' m²')],
      ['Garage / parking', n(l.parking)], ['Année', l.construction_year == null ? NA : `${l.construction_year}`],
      ['DPE / GES', [l.dpe, l.ges].filter(Boolean).join(' / ') || NA], ['Chauffage', l.heating || NA],
      ['Équipements', l.features.join(', ') || NA], ['Étages', n(l.floor)],
    ].map(([k, v]) => ({ k, v }));
  });

  protected readonly card = computed(() => {
    const l = this.l();
    if (!l) return null;
    const at = (iso: string | null) => (iso ? ` le ${day(iso, this.now)}` : '');
    switch (l.status) {
      case 'contact':
        return { kicker: 'Prochaine étape', title: 'Contacter l’agence', text: 'Une fois le mail envoyé, passe l’annonce à l’étape suivante pour garder la date.' };
      case 'mail':
        return { kicker: `Mail envoyé${at(l.mail_sent_at)}`, title: 'En attente de réponse', text: 'Quand l’agence répond, saisis la date de visite.' };
      case 'planned':
        return { kicker: 'Visite planifiée', title: l.visit_at ? this.longDate(l.visit_at) : '', text: 'Sur place, tout se passe dans les onglets Pièces, Questions et Bilan.' };
      case 'done':
        return { kicker: `Visite effectuée${at(l.visited_at)}`, title: 'Visite terminée', text: 'Le bilan reprend notes, travaux et prix réel. La visite reste modifiable.' };
      default:
        return { kicker: 'Annonce écartée', title: 'Hors de la liste', text: 'Elle reste consultable dans « Écartées » sur l’accueil.' };
    }
  });

  private longDate(iso: string): string {
    const f = (o: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...o }).format(new Date(iso));
    const d = f({ weekday: 'long', day: 'numeric', month: 'long' });
    return `${d[0].toUpperCase()}${d.slice(1)} · ${f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
  }

  protected readonly formatEur = formatEur;
  protected source(l: Listing): string { return sourceLabel(l.source); }
  protected date(iso: string): string { return day(iso, this.now); }
  protected photoUrl(l: Listing, id: string): string { return this.api.listingPhotoUrl(l.id, id); }

  protected onScroll(e: Event): void {
    const el = e.target as HTMLElement;
    this.photoIndex.set(Math.round(el.scrollLeft / (el.clientWidth || 1)));
  }

  /** Envoie `fields` ; l'annonce renvoyée remplace celle que voient tous les onglets. */
  protected async patch(fields: Partial<Listing>): Promise<boolean> {
    const l = this.l();
    if (!l || this.busy()) return false;
    this.busy.set(true);
    try {
      this.current.listing.set(await this.api.patchListing(l.id, fields));
      return true;
    } catch (e) {
      this.snack.open(`Modification non enregistrée : ${e instanceof ApiError ? e.message : 'erreur'}`, 'OK', { duration: 5000 });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected setStatus(status: ListingStatus): void {
    this.planning.set(false);
    void this.patch({ status });
  }

  protected plan(change: boolean): void {
    this.visitAt.set(change ? (this.l()?.visit_at ?? null) : null);
    this.planning.set(true);
  }

  protected setVisit(v: string | null): void {
    this.visitAt.set(v);
  }

  protected async savePlan(): Promise<void> {
    const visitAt = this.visitAt();
    if (visitAt && (await this.patch({ visit_at: visitAt, status: 'planned' }))) this.planning.set(false);
  }

  protected onNotes(value: string): void {
    this.notesDraft = value;
  }

  protected async saveNotes(): Promise<void> {
    const draft = this.notesDraft;
    if (draft === null || draft === this.l()?.notes) return;
    if (await this.patch({ notes: draft })) this.notesDraft = null;
  }

  protected async refresh(): Promise<void> {
    const l = this.l();
    if (!l || this.busy()) return;
    this.busy.set(true);
    this.refreshError.set('');
    try {
      this.current.listing.set(await this.api.refreshListing(l.id));
    } catch (e) {
      this.refreshError.set(e instanceof ApiError ? e.message : 'Rafraîchissement impossible');
      // le serveur a gardé fetch_error : on relit l'annonce pour afficher le bandeau
      try {
        this.current.listing.set(await this.api.getListing(l.id));
      } catch {
        // le message inline suffit
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const l = this.l();
    if (!l) return;
    const ok = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: { title: 'Supprimer l’annonce', message: 'Supprimer cette annonce et toute sa visite ? Cette action est définitive.', confirmLabel: 'Supprimer' },
        })
        .afterClosed(),
    );
    if (!ok) return;
    try {
      await this.api.deleteListing(l.id);
    } catch (e) {
      this.snack.open(`Suppression impossible : ${e instanceof ApiError ? e.message : 'erreur'}`, 'OK', { duration: 5000 });
      return;
    }
    void this.router.navigateByUrl('/');
  }
}
