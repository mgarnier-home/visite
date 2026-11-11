import { DestroyRef, DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ApiClient } from './api.client';
import { Op, OpResult, OpType, VisitState } from './api.types';
import { applyOp, mergeChanges } from './reducer';

export interface SyncStatus {
  sending: boolean;
  error: string | null;
}

/** Récupération périodique des changements (ms). */
const POLL_DELAY = 5000;

const REASON_LABELS: Record<NonNullable<OpResult['reason']>, string> = {
  forbidden: 'action non autorisée',
  not_found: 'élément introuvable',
  invalid: 'données invalides',
};

const IDLE_STATUS: SyncStatus = { sending: false, error: null };

/** Heure locale du téléphone en RFC 3339 avec son décalage UTC, à la seconde près. */
export function localIsoWithOffset(d: Date, offsetMinutes = -d.getTimezoneOffset()): string {
  const shifted = new Date(d.getTime() + offsetMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const abs = Math.abs(offsetMinutes);
  const sign = offsetMinutes < 0 ? '-' : '+';
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Visite ouverte : chaque opération est envoyée tout de suite (affichée sans attendre la réponse),
 * les changements des autres participants sont récupérés toutes les 5 s. Pas de file locale :
 * en cas d'échec, l'état du serveur est rechargé et l'utilisateur prévenu.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(ApiClient);
  private readonly document = inject(DOCUMENT);

  private readonly stateSig = signal<VisitState | null>(null);
  private readonly statusSig = signal<SyncStatus>(IDLE_STATUS);
  private readonly rejectedSubject = new Subject<OpResult>();
  private readonly noticesSubject = new Subject<string>();

  readonly state = this.stateSig.asReadonly();
  readonly status = this.statusSig.asReadonly();
  readonly rejected$: Observable<OpResult> = this.rejectedSubject.asObservable();
  /** Messages à afficher à l'utilisateur (modification refusée ou non enregistrée, photo non envoyée). */
  readonly notices$: Observable<string> = this.noticesSubject.asObservable();

  private id: string | null = null;
  /** Incrémenté à chaque open/close : le résultat d'une session précédente est ignoré. */
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Envois en cours, exécutés l'un après l'autre pour garder l'ordre des opérations. */
  private queue: Promise<unknown> = Promise.resolve();
  private inFlight = 0;

  private readonly onVisibility = () => {
    if (this.document.visibilityState === 'visible') void this.poll(this.generation, true);
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /** Charge l'état de la visite (déjà rejointe) et démarre la récupération périodique. */
  async open(id: string): Promise<void> {
    this.close();
    const generation = this.generation;
    const full = await this.api.state(id);
    if (generation !== this.generation) return; // fermée ou rouverte entre-temps
    this.id = id;
    this.stateSig.set(full);
    this.document.addEventListener('visibilitychange', this.onVisibility);
    this.schedulePoll(generation);
  }

  close(): void {
    this.generation++;
    this.id = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.document.removeEventListener('visibilitychange', this.onVisibility);
    this.inFlight = 0;
    this.stateSig.set(null);
    this.statusSig.set(IDLE_STATUS);
  }

  /** Applique l'opération à l'affichage, l'envoie, et recharge l'état si le serveur ne l'a pas prise. */
  async dispatch(type: OpType, payload: object): Promise<void> {
    const id = this.requireOpen();
    const generation = this.generation;
    let body = payload;
    if (type === 'add_room' && !(payload as { note_point_id?: unknown }).note_point_id) {
      body = { ...payload, note_point_id: crypto.randomUUID() };
    }
    const op: Op = { op_id: crypto.randomUUID(), type, client_ts: Date.now(), payload: body };
    this.stateSig.update((s) => (s ? applyOp(s, op) : s));
    await this.send(generation, async () => {
      try {
        const res = await this.api.sendOps(id, [op]);
        const refused = res.results.find((r) => r.op_id === op.op_id && r.result === 'rejected');
        if (!refused) return;
        if (generation !== this.generation) return;
        this.rejectedSubject.next(refused);
        this.noticesSubject.next(
          `Une modification a été refusée (${refused.reason ? REASON_LABELS[refused.reason] : 'raison inconnue'})`,
        );
      } catch (e) {
        if (generation !== this.generation) return;
        this.noticesSubject.next(`Modification non enregistrée : ${messageOf(e)}`);
      }
      await this.reload(id, generation);
    });
  }

  /** Envoie une photo prise sur le téléphone, puis récupère les changements pour l'afficher. */
  async addPhoto(roomId: string | null, blob: Blob): Promise<void> {
    const id = this.requireOpen();
    const generation = this.generation;
    const photo = { id: crypto.randomUUID(), room_id: roomId, taken_at: localIsoWithOffset(new Date()), blob };
    await this.send(generation, async () => {
      try {
        await this.api.uploadPhoto(id, photo);
        await this.pull(id, generation);
      } catch (e) {
        if (generation === this.generation) this.noticesSubject.next(`Photo non envoyée : ${messageOf(e)}`);
      }
    });
  }

  /** Résolue quand plus aucun envoi n'est en cours. */
  async whenIdle(): Promise<void> {
    await this.queue;
  }

  private send(generation: number, run: () => Promise<void>): Promise<void> {
    this.inFlight++;
    this.patchStatus({ sending: true });
    const job = this.queue.then(run).finally(() => {
      if (generation !== this.generation) return;
      if (--this.inFlight === 0) this.patchStatus({ sending: false });
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** État complet du serveur ; en cas d'échec on garde l'affichage, la récupération périodique reprendra. */
  private async reload(id: string, generation: number): Promise<void> {
    try {
      const full = await this.api.state(id);
      if (generation === this.generation) this.stateSig.set(full);
    } catch {
      // rien : le prochain cycle de récupération signalera le problème
    }
  }

  private async pull(id: string, generation: number): Promise<void> {
    const current = this.stateSig();
    if (generation !== this.generation || !current) return;
    const changes = await this.api.changes(id, current.seq);
    const latest = this.stateSig();
    if (generation === this.generation && latest) this.stateSig.set(mergeChanges(latest, changes));
  }

  private schedulePoll(generation: number): void {
    this.timer = setTimeout(() => void this.poll(generation), POLL_DELAY);
  }

  /** Un cycle de récupération ; sans effet si la page est cachée ou si un envoi est en cours. */
  private async poll(generation: number, once = false): Promise<void> {
    if (generation !== this.generation || !this.id) return;
    if (this.inFlight === 0 && this.document.visibilityState !== 'hidden') {
      try {
        await this.pull(this.id, generation);
        if (generation === this.generation) this.patchStatus({ error: null });
      } catch (e) {
        if (generation === this.generation) this.patchStatus({ error: `Mise à jour impossible : ${messageOf(e)}` });
      }
    }
    if (!once && generation === this.generation) this.schedulePoll(generation);
  }

  private requireOpen(): string {
    if (!this.id) throw new Error('Aucune visite ouverte');
    return this.id;
  }

  private patchStatus(patch: Partial<SyncStatus>): void {
    this.statusSig.update((s) => ({ ...s, ...patch }));
  }
}
