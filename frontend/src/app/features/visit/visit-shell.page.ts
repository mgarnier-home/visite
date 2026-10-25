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
import { LocalStore } from '../../core/local-store';
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
  private readonly store = inject(LocalStore);
  private readonly sync = inject(SyncService);
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  protected readonly code = signal('');

  protected readonly phase = signal<Phase>('loading');
  private destroyed = false;
  /** Jeton de la dernière ouverture : le résultat d'un code précédent est ignoré. */
  private token = 0;

  protected readonly title = computed(() => this.sync.state()?.visit.fiche.address.trim() || this.code());
  protected readonly closed = computed(() => !!this.sync.state()?.visit.closed_at);
  protected readonly unasked = computed(() => {
    const s = this.sync.state();
    return s ? unaskedCount(s) : 0;
  });
  protected readonly tabs = [
    { path: 'rooms', label: 'Pièces' },
    { path: 'questions', label: 'Questions' },
    { path: 'fiche', label: 'Fiche' },
    { path: 'bilan', label: 'Bilan' },
  ];

  constructor() {
    this.sync.notices$
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe((message) => this.snack.open(message, 'OK', { duration: 5000 }));
    // le composant est réutilisé quand seul le code change (/v/a -> /v/b)
    this.route.paramMap.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((params) => {
      void this.openVisit(params.get('code') ?? '');
    });
  }

  private async openVisit(code: string): Promise<void> {
    const token = ++this.token;
    const stale = () => this.destroyed || token !== this.token;
    this.code.set(code);
    this.phase.set('loading');
    try {
      if (!(await this.store.getState(code))) {
        // première ouverture sur cet appareil : rejoindre et récupérer l'état (réseau requis)
        await this.api.join(code);
        const full = await this.api.state(code);
        if (stale()) return;
        await this.store.saveState(code, full);
      }
      if (stale()) return;
      await this.sync.open(code);
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
  }
}
