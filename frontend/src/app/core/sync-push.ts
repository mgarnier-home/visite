import { inject, Injectable } from '@angular/core';
import { ApiClient, ApiError } from './api.client';
import { Op, OpResult } from './api.types';
import { PhotoRow } from './db';
import { LocalStore } from './local-store';

/** Délais de nouvelle tentative après un échec (ms), plafonnés au dernier. */
export const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const MAX_BATCH_OPS = 500;
/** 1 Mo par lot, moins l'enveloppe `{"ops":[]}`. */
const MAX_BATCH_BYTES = 1_000_000 - 16;

/** Réseau, 5xx, 408, 429 : l'erreur est passagère, on réessaiera. */
export function isTransient(status: number): boolean {
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

/** Ce que l'appelant fournit à l'envoi d'une visite. */
export interface PushContext {
  code: string;
  /** Faux dès que l'envoi doit s'arrêter (session fermée, visite ouverte ailleurs). */
  alive(): boolean;
  /** Avant chaque lot d'opérations (ex. rechargement complet dû à un rejet). */
  beforeBatch?(): Promise<void>;
  /** Opération refusée par le serveur, déjà acquittée. */
  onRejected?(result: OpResult): void;
  /** Après chaque lot acquitté ou photo envoyée (ex. mise à jour des compteurs). */
  onProgress?(): Promise<void>;
  /**
   * Photo refusée définitivement (4xx) : à retirer de la file. Par défaut, un rechargement
   * complet est noté (l'état enregistré l'affiche encore) puis la photo est retirée.
   */
  dropPhoto?(photo: PhotoRow, error: ApiError): Promise<void>;
}

/**
 * Envoi des opérations et des photos en attente d'une visite, avec les règles communes à la
 * visite ouverte (SyncService) et à l'envoi en arrière-plan des autres visites.
 */
@Injectable({ providedIn: 'root' })
export class SyncPusher {
  private readonly api = inject(ApiClient);
  private readonly store = inject(LocalStore);

  /**
   * Opérations par lots. Un rejet note (de façon persistante) qu'un rechargement complet est
   * dû ; il est noté avant l'acquittement, pour survivre à une fermeture ou à un arrêt.
   */
  async pushOps(ctx: PushContext): Promise<void> {
    const { code } = ctx;
    for (;;) {
      if (ctx.beforeBatch) {
        await ctx.beforeBatch();
        if (!ctx.alive()) return;
      }
      const pending = await this.store.pendingOps(code);
      if (!ctx.alive()) return;
      if (pending.length === 0) return;
      const batch = takeBatch(pending);
      const res = await this.api.sendOps(code, batch);
      if (!ctx.alive()) return; // réponse d'un envoi abandonné : rien n'est acquitté, l'envoi sera refait
      const sent = new Set(batch.map((o) => o.op_id));
      const done = res.results.filter((r) => sent.has(r.op_id));
      // aucun résultat : on ne peut pas avancer (photos, changes) avec des opérations non acquittées
      if (done.length === 0) throw new Error('réponse du serveur sans résultat pour le lot');
      const rejected = done.filter((d) => d.result === 'rejected');
      if (rejected.length > 0) await this.store.markReloadNeeded(code);
      await this.store.ackOps(done.map((r) => r.op_id));
      if (!ctx.alive()) return;
      // émissions sans await depuis le dernier test : elles ne visent que l'envoi courant
      for (const r of rejected) ctx.onRejected?.(r);
      await ctx.onProgress?.();
    }
  }

  /** Photos une par une ; une erreur définitive (4xx) abandonne la photo, une autre arrête l'envoi. */
  async pushPhotos(ctx: PushContext): Promise<void> {
    const { code } = ctx;
    const photos = await this.store.pendingPhotos(code);
    for (const p of photos) {
      if (!ctx.alive()) return;
      try {
        await this.api.uploadPhoto(code, { id: p.id, room_id: p.room_id, taken_at: p.taken_at, blob: p.blob });
      } catch (e) {
        if (!ctx.alive()) return; // envoi abandonné : la photo reste en file
        if (!(e instanceof ApiError) || isTransient(e.status)) throw e;
        await (ctx.dropPhoto ? ctx.dropPhoto(p, e) : this.dropPhoto(code, p));
        if (!ctx.alive()) return;
        continue;
      }
      // 2xx : la photo est sur le serveur ; on l'acquitte même si l'envoi a été abandonné
      await this.store.ackPhoto(p.id);
      if (!ctx.alive()) return;
      await ctx.onProgress?.();
    }
  }

  private async dropPhoto(code: string, p: PhotoRow): Promise<void> {
    await this.store.markReloadNeeded(code);
    await this.store.ackPhoto(p.id);
  }
}
