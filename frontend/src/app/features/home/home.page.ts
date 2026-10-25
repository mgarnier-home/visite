import { Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiClient, ApiError } from '../../core/api.client';
import { BackgroundSyncService } from '../../core/background-sync.service';
import { CODE_RE, normalizeCode } from '../../core/code';
import { VisitRow } from '../../core/db';
import { LocalStore, PendingDataError } from '../../core/local-store';
import { normalizeCodeWhileTyping } from '../code-typing';

@Component({
  selector: 'app-home-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
})
export class HomePage implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly store = inject(LocalStore);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly background = inject(BackgroundSyncService);

  protected readonly code = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly visits = signal<VisitRow[]>([]);
  /** Opérations et photos pas encore envoyées, par visite. */
  protected readonly pending = signal<ReadonlyMap<string, number>>(new Map());

  constructor() {
    // un envoi en arrière-plan vient de traiter une visite : compteurs à relire
    effect(() => {
      if (this.background.revision() > 0) untracked(() => void this.refreshPending());
    });
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const [visits, pending] = await Promise.all([this.store.listVisits(), this.readPending()]);
    this.visits.set(visits);
    this.pending.set(pending);
  }

  private async refreshPending(): Promise<void> {
    this.pending.set(await this.readPending());
  }

  /** Compteurs indisponibles : les derniers connus restent affichés. */
  private readPending(): Promise<ReadonlyMap<string, number>> {
    return this.store.pendingCounts().catch(() => this.pending());
  }

  protected pendingText(code: string): string | null {
    const n = this.pending().get(code) ?? 0;
    if (n === 0) return null;
    return `${n} ${n > 1 ? 'modifications' : 'modification'} en attente`;
  }

  protected onCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const typed = normalizeCodeWhileTyping(input.value);
    input.value = typed;
    this.code.set(typed);
    this.error.set('');
  }

  protected canJoin(): boolean {
    return !this.busy() && CODE_RE.test(normalizeCode(this.code()));
  }

  protected async join(): Promise<void> {
    const code = normalizeCode(this.code());
    if (!CODE_RE.test(code) || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      // Déjà sur cet appareil : l'état local (et ses modifications en attente) fait foi.
      if (await this.store.getState(code)) {
        await this.router.navigate(['/v', code]);
        return;
      }
      await this.api.join(code);
      const state = await this.api.state(code);
      await this.store.saveState(code, state);
      await this.router.navigate(['/v', code]);
    } catch (e) {
      this.error.set(this.joinMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  private joinMessage(e: unknown): string {
    if (e instanceof ApiError) {
      if (e.status === 404) return 'Aucune visite avec ce code';
      if (e.status === 0) return 'Il faut du réseau pour rejoindre une visite';
    }
    return 'Impossible de rejoindre la visite pour l\'instant';
  }

  protected async remove(code: string): Promise<void> {
    try {
      await this.store.removeVisit(code);
      await this.refresh();
    } catch (e) {
      const message =
        e instanceof PendingDataError
          ? 'Des modifications ne sont pas encore envoyées : impossible de retirer cette visite pour l\'instant'
          : 'Impossible de retirer cette visite';
      this.snackBar.open(message, undefined, { duration: 6000 });
    }
  }
}
