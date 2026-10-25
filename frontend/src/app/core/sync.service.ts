import { DestroyRef, DOCUMENT, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ApiClient, ApiError } from './api.client';
import { Op, OpResult, OpType, VisitState } from './api.types';
import { LocalStore } from './local-store';
import { applyOp, mergeChanges } from './reducer';

export interface SyncStatus {
  online: boolean;
  pendingOps: number;
  pendingPhotos: number;
  error: string | null;
}

/** Minuteries utilisées par la synchronisation ; remplaçables (tests). */
export interface SyncTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const SYNC_TIMERS = new InjectionToken<SyncTimers>('SYNC_TIMERS', {
  providedIn: 'root',
  // lus à chaque appel : les minuteries simulées de Vitest sont prises en compte
  factory: () => ({
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }),
});

/** Délais de nouvelle tentative après un échec (ms), plafonnés au dernier. */
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
/** Récupération périodique des changements (ms). */
const POLL_DELAY = 5000;
const MAX_BATCH_OPS = 500;
/** 1 Mo par lot, moins l'enveloppe `{"ops":[]}`. */
const MAX_BATCH_BYTES = 1_000_000 - 16;

const REASON_LABELS: Record<NonNullable<OpResult['reason']>, string> = {
  closed: 'visite clôturée',
  forbidden: 'action non autorisée',
  not_found: 'élément introuvable',
  invalid: 'données invalides',
};

const IDLE_STATUS: SyncStatus = { online: true, pendingOps: 0, pendingPhotos: 0, error: null };

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

/** Réseau, 5xx, 408, 429 : l'erreur est passagère, on réessaiera. */
function isTransient(status: number): boolean {
  return status === 0 || status >= 500 || status === 408 || status === 429;
}

/** Premier lot à envoyer : 500 opérations et 1 Mo au plus, au moins une opération. */
function takeBatch(ops: Op[]): Op[] {
  const encoder = new TextEncoder();
  let bytes = 0;
  let n = 0;
  while (n < ops.length && n < MAX_BATCH_OPS) {
    const size = encoder.encode(JSON.stringify(ops[n])).length + 1;
    if (n > 0 && bytes + size > MAX_BATCH_BYTES) break;
    bytes += size;
    n++;
  }
  return ops.slice(0, n);
}

type Stage = 'ops' | 'photos' | 'changes';

function failureMessage(e: unknown, stage: Stage): string {
  if (!(e instanceof ApiError)) {
    return `Erreur de synchronisation : ${e instanceof Error ? e.message : String(e)}`;
  }
  if (e.status === 0) return 'Serveur injoignable ; nouvel essai automatique.';
  if (isTransient(e.status)) return `Serveur indisponible (erreur ${e.status}) ; nouvel essai automatique.`;
  if (stage === 'ops') {
    return `Le serveur a refusé l'envoi des modifications (erreur ${e.status} : ${e.message}) ; ` +
      'elles sont conservées et seront renvoyées.';
  }
  return `Mise à jour impossible (erreur ${e.status} : ${e.message}) ; nouvel essai automatique.`;
}

/**
 * Synchronisation d'une visite ouverte : file d'opérations et de photos vers le serveur,
 * récupération des changements. Seul composant à parler au réseau pour la visite ouverte.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(ApiClient);
  private readonly store = inject(LocalStore);
  private readonly timers = inject(SYNC_TIMERS);
  private readonly document = inject(DOCUMENT);

  private readonly stateSig = signal<VisitState | null>(null);
  private readonly statusSig = signal<SyncStatus>(IDLE_STATUS);
  private readonly rejectedSubject = new Subject<OpResult>();
  private readonly noticesSubject = new Subject<string>();

  readonly state = this.stateSig.asReadonly();
  readonly status = this.statusSig.asReadonly();
  readonly rejected$: Observable<OpResult> = this.rejectedSubject.asObservable();
  /** Messages à afficher à l'utilisateur (opérations refusées, photos abandonnées). */
  readonly notices$: Observable<string> = this.noticesSubject.asObservable();

  private code: string | null = null;
  /** Incrémenté à chaque open/close : un cycle d'une session précédente devient inerte. */
  private generation = 0;
  private running: Promise<void> | null = null;
  private followUp = false;
  private timer: unknown = null;
  private attempt = 0;
  /** Un rejet a été reçu mais l'état complet n'a pas encore pu être rechargé. */
  private reloadNeeded = false;
  /** Sérialise les modifications de l'état (dispatch, addPhoto, fusions du cycle). */
  private mutations: Promise<unknown> = Promise.resolve();

  private readonly onOnline = () => {
    this.patchStatus({ online: true });
    this.kick();
  };
  private readonly onOffline = () => this.patchStatus({ online: false });
  private readonly onVisibility = () => {
    if (this.document.visibilityState === 'visible') this.kick();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /** Ouvre une visite déjà présente dans le stockage local et démarre la synchronisation. */
  async open(code: string): Promise<void> {
    this.close();
    const generation = this.generation;
    const saved = await this.store.getState(code);
    if (generation !== this.generation) return; // fermée ou rouverte entre-temps
    if (!saved) throw new Error(`Visite ${code} absente du stockage local`);
    this.code = code;
    this.stateSig.set(saved);
    this.patchStatus({ online: this.isOnline(), error: null });
    const win = this.document.defaultView;
    win?.addEventListener('online', this.onOnline);
    win?.addEventListener('offline', this.onOffline);
    this.document.addEventListener('visibilitychange', this.onVisibility);
    await this.refreshCounts(code, generation);
    this.kick();
  }

  /** Arrête la synchronisation : minuteries et écouteurs retirés, état vidé. */
  close(): void {
    this.generation++;
    this.code = null;
    this.clearTimer();
    const win = this.document.defaultView;
    win?.removeEventListener('online', this.onOnline);
    win?.removeEventListener('offline', this.onOffline);
    this.document.removeEventListener('visibilitychange', this.onVisibility);
    this.running = null;
    this.followUp = false;
    this.attempt = 0;
    this.reloadNeeded = false;
    this.stateSig.set(null);
    this.statusSig.set(IDLE_STATUS);
  }

  /** Applique une opération localement, la met en file d'envoi et lance un cycle. */
  async dispatch(type: OpType, payload: object): Promise<void> {
    const code = this.requireOpen();
    const generation = this.generation;
    let body = payload;
    if (type === 'add_room' && !(payload as { note_point_id?: unknown }).note_point_id) {
      body = { ...payload, note_point_id: crypto.randomUUID() };
    }
    const op: Op = { op_id: crypto.randomUUID(), type, client_ts: Date.now(), payload: body };
    await this.mutate(async () => {
      const current = this.stateSig();
      if (generation !== this.generation || !current) throw new Error('Visite fermée');
      const next = applyOp(current, op);
      this.stateSig.set(next);
      // file d'abord : une opération enregistrée n'est jamais perdue
      await this.store.enqueue(code, op);
      await this.store.saveState(code, next);
    });
    await this.refreshCounts(code, generation);
    this.kick();
  }

  /** Enregistre une photo prise sur le téléphone ; visible tout de suite, envoyée plus tard. */
  async addPhoto(roomId: string | null, blob: Blob): Promise<void> {
    const code = this.requireOpen();
    const generation = this.generation;
    const id = crypto.randomUUID();
    const takenAt = localIsoWithOffset(new Date());
    await this.mutate(async () => {
      const current = this.stateSig();
      if (generation !== this.generation || !current) throw new Error('Visite fermée');
      const next: VisitState = {
        ...current,
        photos: [...current.photos, { id, room_id: roomId, author: current.me.number, taken_at: takenAt }],
      };
      this.stateSig.set(next);
      await this.store.addPhoto({ id, code, room_id: roomId, taken_at: takenAt, blob });
      await this.store.saveState(code, next);
    });
    await this.refreshCounts(code, generation);
    this.kick();
  }

  /** Lance un cycle maintenant, ou en programme un seul de plus si un cycle est en cours. */
  kick(): void {
    if (!this.code) return;
    if (this.running) {
      this.followUp = true;
      return;
    }
    this.clearTimer();
    const run = this.loop(this.code, this.generation).finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
  }

  /** Résolue quand aucun cycle n'est en cours. */
  whenIdle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async loop(code: string, generation: number): Promise<void> {
    let ok: boolean;
    do {
      this.followUp = false;
      ok = await this.cycle(code, generation);
    } while (this.followUp && generation === this.generation);
    if (generation !== this.generation) return;
    if (ok) {
      this.attempt = 0;
      this.schedule(POLL_DELAY, () => {
        if (this.isOnline() && this.document.visibilityState === 'visible') this.kick();
      });
    } else {
      const delay = RETRY_DELAYS[Math.min(this.attempt, RETRY_DELAYS.length - 1)];
      this.attempt++;
      this.schedule(delay, () => this.kick());
    }
  }

  /** Un cycle complet ; faux en cas d'échec (le cycle s'arrête à la première erreur). */
  private async cycle(code: string, generation: number): Promise<boolean> {
    let stage: Stage = 'ops';
    try {
      await this.pushOps(code, generation);
      stage = 'photos';
      await this.pushPhotos(code, generation);
      stage = 'changes';
      await this.pullChanges(code, generation);
      if (generation === this.generation) this.patchStatus({ error: null });
      return true;
    } catch (e) {
      if (generation === this.generation) {
        const silent = e instanceof ApiError && e.status === 0 && !this.isOnline();
        this.patchStatus({ error: silent ? null : failureMessage(e, stage) });
      }
      return false;
    }
  }

  /** Étape 1 : opérations par lots ; en cas de rejet, rechargement complet de l'état. */
  private async pushOps(code: string, generation: number): Promise<void> {
    for (;;) {
      const pending = await this.store.pendingOps(code);
      if (generation !== this.generation || pending.length === 0) break;
      const batch = takeBatch(pending);
      const res = await this.api.sendOps(code, batch);
      if (generation !== this.generation) return;
      const sent = new Set(batch.map((o) => o.op_id));
      const done = res.results.filter((r) => sent.has(r.op_id));
      if (done.length === 0) break; // aucun résultat : les opérations restent en file
      await this.store.ackOps(done.map((r) => r.op_id));
      await this.refreshCounts(code, generation);
      for (const r of done.filter((d) => d.result === 'rejected')) {
        this.reloadNeeded = true;
        this.rejectedSubject.next(r);
        this.noticesSubject.next(
          `Une modification a été refusée (${r.reason ? REASON_LABELS[r.reason] : 'raison inconnue'})`,
        );
      }
    }
    if (!this.reloadNeeded || generation !== this.generation) return;
    const full = await this.api.state(code);
    await this.mutate(async () => {
      if (generation !== this.generation) return;
      const [pending, photos] = await Promise.all([this.store.pendingOps(code), this.store.pendingPhotos(code)]);
      if (generation !== this.generation) return;
      // l'état du serveur ignore les photos pas encore envoyées : on les remet
      const known = new Set(full.photos.map((x) => x.id));
      const local = photos
        .filter((x) => !known.has(x.id))
        .map((x) => ({ id: x.id, room_id: x.room_id, author: full.me.number, taken_at: x.taken_at }));
      const base: VisitState = { ...full, photos: [...full.photos, ...local] };
      await this.commit(code, pending.reduce(applyOp, base));
      this.reloadNeeded = false;
    });
  }

  /** Étape 2 : photos une par une ; une erreur définitive (4xx) abandonne la photo. */
  private async pushPhotos(code: string, generation: number): Promise<void> {
    const photos = await this.store.pendingPhotos(code);
    for (const p of photos) {
      if (generation !== this.generation) return;
      try {
        await this.api.uploadPhoto(code, { id: p.id, room_id: p.room_id, taken_at: p.taken_at, blob: p.blob });
      } catch (e) {
        if (!(e instanceof ApiError) || isTransient(e.status)) throw e;
        await this.store.ackPhoto(p.id);
        await this.mutate(async () => {
          const current = this.stateSig();
          if (generation !== this.generation || !current) return;
          await this.commit(code, { ...current, photos: current.photos.filter((x) => x.id !== p.id) });
        });
        this.noticesSubject.next(`Une photo n'a pas pu être envoyée et a été abandonnée (${e.message})`);
        await this.refreshCounts(code, generation);
        continue;
      }
      await this.store.ackPhoto(p.id);
      await this.refreshCounts(code, generation);
    }
  }

  /** Étape 3 : changements depuis seq, fusion, puis réapplication des opérations en attente. */
  private async pullChanges(code: string, generation: number): Promise<void> {
    const since = this.stateSig()?.seq ?? 0;
    const changes = await this.api.changes(code, since);
    await this.mutate(async () => {
      const current = this.stateSig();
      if (generation !== this.generation || !current) return;
      const pending = await this.store.pendingOps(code);
      if (generation !== this.generation) return;
      await this.commit(code, pending.reduce(applyOp, mergeChanges(current, changes)));
    });
  }

  private async commit(code: string, next: VisitState): Promise<void> {
    this.stateSig.set(next);
    await this.store.saveState(code, next);
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutations.then(fn, fn);
    this.mutations = run.catch(() => undefined);
    return run;
  }

  private async refreshCounts(code: string, generation: number): Promise<void> {
    const [ops, photos] = await Promise.all([this.store.pendingOps(code), this.store.pendingPhotos(code)]);
    if (generation === this.generation) this.patchStatus({ pendingOps: ops.length, pendingPhotos: photos.length });
  }

  private requireOpen(): string {
    if (!this.code) throw new Error('Aucune visite ouverte');
    return this.code;
  }

  private isOnline(): boolean {
    return this.document.defaultView?.navigator.onLine ?? true;
  }

  private patchStatus(patch: Partial<SyncStatus>): void {
    this.statusSig.update((s) => ({ ...s, ...patch }));
  }

  private schedule(ms: number, fn: () => void): void {
    this.clearTimer();
    this.timer = this.timers.set(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
}
