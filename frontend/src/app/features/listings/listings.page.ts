import { Component, computed, inject, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { map } from 'rxjs';
import { ApiClient } from '../../core/api.client';
import { Listing, ListingStatus } from '../../core/api.types';
import { nextStepLine, sourceLabel, specsLine, STATUS_LABELS, STATUS_ORDER } from '../../core/listing';

/** Ordre des sections sur téléphone (maquette 1) : le plus urgent d'abord. */
const PHONE_ORDER: ListingStatus[] = ['planned', 'mail', 'contact', 'done'];

@Component({
  selector: 'app-listings-page',
  imports: [NgTemplateOutlet, RouterLink, MatButtonModule, MatIconModule],
  templateUrl: './listings.page.html',
  styleUrl: './listings.page.scss',
})
export class ListingsPage {
  private readonly api = inject(ApiClient);

  protected readonly listings = signal<Listing[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly showDropped = signal(false);
  protected readonly desktop = toSignal(
    inject(BreakpointObserver).observe('(min-width: 1024px)').pipe(map((s) => s.matches)),
    { initialValue: false },
  );
  protected readonly now = new Date();

  protected readonly groups = computed(() => {
    const order = this.desktop() ? STATUS_ORDER.filter((s) => s !== 'dropped') : PHONE_ORDER;
    return order.map((status) => ({
      status,
      label: STATUS_LABELS[status],
      items: this.listings().filter((l) => l.status === status),
    }));
  });
  protected readonly dropped = computed(() => this.listings().filter((l) => l.status === 'dropped'));
  protected readonly tracked = computed(() => this.listings().length - this.dropped().length);

  constructor() {
    this.api.listListings().then(
      (l) => this.listings.set(l),
      () => this.error.set(true),
    ).finally(() => this.loading.set(false));
  }

  protected photo(l: Listing): string | null {
    return l.photos.length ? this.api.listingPhotoUrl(l.id, l.photos[0].id) : null;
  }
  protected price(l: Listing): string {
    return l.price_eur == null ? 'Prix inconnu' : `${new Intl.NumberFormat('fr-FR').format(l.price_eur)} €`;
  }
  protected place(l: Listing): string {
    return [l.city, l.land_area_m2 != null && `terrain ${new Intl.NumberFormat('fr-FR').format(l.land_area_m2)} m²`]
      .filter(Boolean).join(' · ');
  }
  protected readonly source = sourceLabel;
  protected readonly specs = specsLine;
  protected readonly next = (l: Listing) => nextStepLine(l, this.now);
}
