import { Component, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { ApiClient, ApiError } from '../../core/api.client';
import { unaskedCount } from '../../core/compute';
import { CurrentListing } from '../../core/current-listing';
import { SyncService } from '../../core/sync.service';
import { SyncIndicatorComponent } from './sync-indicator.component';

type Phase = 'loading' | 'ready' | 'network' | 'notfound' | 'error';

@Component({
  selector: 'app-visit-shell-page',
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    MatBadgeModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    SyncIndicatorComponent,
  ],
  templateUrl: './visit-shell.page.html',
  styleUrl: './visit-shell.page.scss',
})
export class VisitShellPage implements OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly current = inject(CurrentListing);
  private readonly sync = inject(SyncService);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  protected readonly id = signal('');

  protected readonly phase = signal<Phase>('loading');
  protected readonly deleted = this.current.deleted;
  private destroyed = false;
  /** Jeton de la dernière ouverture : le résultat d'un code précédent est ignoré. */
  private token = 0;

  protected readonly title = computed(() => {
    const l = this.current.listing();
    if (!l) return '';
    return l.title.trim() || [l.property_type, l.city].filter(Boolean).join(' · ') || 'Annonce';
  });
  protected readonly unasked = computed(() => {
    const s = this.sync.state();
    return s ? unaskedCount(s) : 0;
  });
  protected readonly tabs = [
    { path: 'annonce', label: 'Annonce' },
    { path: 'pieces', label: 'Pièces' },
    { path: 'questions', label: 'Questions' },
    { path: 'bilan', label: 'Bilan' },
  ];

  constructor() {
    this.sync.notices$
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((message) => this.snack.open(message, 'OK', { duration: 5000 }));
    // le composant est réutilisé quand seul l'id change (/annonces/a -> /annonces/b)
    this.route.paramMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((params) => {
      void this.openVisit(params.get('id') ?? '');
    });
  }

  private async openVisit(id: string): Promise<void> {
    const token = ++this.token;
    const stale = () => this.destroyed || token !== this.token;
    this.id.set(id);
    this.phase.set('loading');
    this.current.listing.set(null);
    this.current.deleted.set(false);
    try {
      const listing = await this.api.getListing(id);
      if (stale()) return;
      this.current.listing.set(listing);
      await this.api.join(id);
      if (stale()) return;
      await this.sync.open(id);
      if (!stale()) this.phase.set('ready');
    } catch (e) {
      if (stale()) return;
      if (e instanceof ApiError && e.status === 0) this.phase.set('network');
      else if (e instanceof ApiError && e.status === 404) this.phase.set('notfound');
      else this.phase.set('error');
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.sync.close();
    this.current.listing.set(null);
    this.current.deleted.set(false);
  }
}
