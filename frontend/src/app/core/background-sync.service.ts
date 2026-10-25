import { DestroyRef, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { LocalStore } from './local-store';
import { RETRY_DELAYS, SyncPusher } from './sync-push';
import { SYNC_TIMERS, SyncService } from './sync.service';

/**
 * Envoi en arrière-plan des opérations et photos des visites qui ne sont pas ouvertes
 * (retour à l'accueil, application fermée puis relancée). Mêmes règles que SyncService
 * (SyncPusher) ; la visite ouverte reste à SyncService, et un passage attend la fin de sa
 * dernière boucle : les deux ne travaillent jamais en même temps sur la même visite.
 * Déclenché au démarrage, au retour du réseau, au retour au premier plan et à la fermeture
 * d'une visite ; nouvel essai avec délai croissant après un échec.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundSyncService {
  private readonly pusher = inject(SyncPusher);
  private readonly store = inject(LocalStore);
  private readonly sync = inject(SyncService);
  private readonly timers = inject(SYNC_TIMERS);
  private readonly document = inject(DOCUMENT);

  private readonly revisionSig = signal(0);
  /** Change après chaque visite traitée : les compteurs « en attente » sont à relire. */
  readonly revision = this.revisionSig.asReadonly();

  private started = false;
  private running: Promise<void> | null = null;
  private followUp = false;
  private timer: unknown = null;
  private attempt = 0;
  private closedSub: Subscription | null = null;

  private readonly onOnline = () => this.trigger();
  private readonly onVisibility = () => {
    if (this.document.visibilityState === 'visible') this.trigger();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Branche les déclencheurs et lance un premier passage. Sans effet si déjà démarré. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.document.defaultView?.addEventListener('online', this.onOnline);
    this.document.addEventListener('visibilitychange', this.onVisibility);
    this.closedSub = this.sync.closed$.subscribe(() => this.trigger());
    this.trigger();
  }

  /** Retire déclencheurs et minuterie ; un passage en cours se termine. */
  stop(): void {
    this.started = false;
    this.document.defaultView?.removeEventListener('online', this.onOnline);
    this.document.removeEventListener('visibilitychange', this.onVisibility);
    this.closedSub?.unsubscribe();
    this.closedSub = null;
    this.clearTimer();
  }

  /** Résolue quand aucun passage n'est en cours. */
  whenIdle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** Lance un passage, ou en programme un seul de plus si un passage est en cours. */
  private trigger(): void {
    if (!this.started) return;
    if (this.running) {
      this.followUp = true;
      return;
    }
    this.clearTimer();
    this.running = this.loop();
  }

  private async loop(): Promise<void> {
    let ok: boolean;
    do {
      this.followUp = false;
      ok = await this.pass();
    } while (this.followUp && this.started);
    // dans la même tâche synchrone que le dernier test de followUp : aucun déclenchement perdu
    this.running = null;
    if (ok) {
      this.attempt = 0;
    } else if (this.started) {
      const delay = RETRY_DELAYS[Math.min(this.attempt, RETRY_DELAYS.length - 1)];
      this.attempt++;
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.trigger();
      }, delay);
    }
  }

  /** Un passage sur toutes les visites en attente non ouvertes ; faux si l'une a échoué. */
  private async pass(): Promise<boolean> {
    let ok = true;
    try {
      await this.sync.settled();
      const codes = [...(await this.store.pendingCounts()).keys()];
      for (const code of codes) {
        if (this.sync.isOpen(code)) continue;
        const ctx = { code, alive: () => this.started && !this.sync.isOpen(code) };
        try {
          await this.pusher.pushOps(ctx);
          if (ctx.alive()) await this.pusher.pushPhotos(ctx);
        } catch {
          ok = false; // passagère ou non : gardé en file, nouvel essai plus tard
        }
        this.revisionSig.update((n) => n + 1);
      }
    } catch {
      ok = false;
    }
    return ok;
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
}
