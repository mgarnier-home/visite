import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { ApiClient, ApiError } from '../../core/api.client';
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
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    SyncIndicatorComponent,
  ],
  templateUrl: './visit-shell.page.html',
  styleUrl: './visit-shell.page.scss',
})
export class VisitShellPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiClient);
  private readonly store = inject(LocalStore);
  private readonly sync = inject(SyncService);
  private readonly snack = inject(MatSnackBar);
  protected readonly code = inject(ActivatedRoute).snapshot.paramMap.get('code') ?? '';

  protected readonly phase = signal<Phase>('loading');
  private destroyed = false;

  protected readonly title = computed(() => this.sync.state()?.visit.fiche.address.trim() || this.code);
  protected readonly closed = computed(() => !!this.sync.state()?.visit.closed_at);
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
  }

  async ngOnInit(): Promise<void> {
    try {
      if (!(await this.store.getState(this.code))) {
        // première ouverture sur cet appareil : rejoindre et récupérer l'état (réseau requis)
        await this.api.join(this.code);
        await this.store.saveState(this.code, await this.api.state(this.code));
      }
      if (this.destroyed) return;
      await this.sync.open(this.code);
      if (!this.destroyed) this.phase.set('ready');
    } catch (e) {
      if (this.destroyed) return;
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
