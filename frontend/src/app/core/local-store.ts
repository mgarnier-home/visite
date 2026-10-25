import { Injectable } from '@angular/core';
import { Op, VisitState } from './api.types';
import { db, PhotoRow, VisitRow } from './db';

const reloadKey = (code: string) => `reload:${code}`;

/** Levée quand on supprime une visite qui a encore des données non synchronisées. */
export class PendingDataError extends Error {
  constructor(code: string) {
    super(`Données en attente de synchronisation pour la visite ${code}`);
    this.name = 'PendingDataError';
  }
}

/** Persistance locale (IndexedDB) : états, file d'opérations et photos en attente. */
@Injectable({ providedIn: 'root' })
export class LocalStore {
  async saveState(code: string, state: VisitState): Promise<void> {
    await db.visits.put({ code, state });
  }

  async getState(code: string): Promise<VisitState | undefined> {
    return (await db.visits.get(code))?.state;
  }

  listVisits(): Promise<VisitRow[]> {
    return db.visits.toArray();
  }

  async enqueue(code: string, op: Op): Promise<void> {
    await db.outbox.add({ op_id: op.op_id, code, op });
  }

  /** Opérations en attente, dans l'ordre d'insertion (clé auto-incrémentée). */
  async pendingOps(code: string): Promise<Op[]> {
    const rows = await db.outbox.where('code').equals(code).sortBy('seq');
    return rows.map((r) => r.op);
  }

  /** Met l'opération en file et enregistre le nouvel état dans une même transaction. */
  async enqueueWithState(code: string, op: Op, state: VisitState): Promise<void> {
    await db.transaction('rw', db.outbox, db.visits, async () => {
      await db.outbox.add({ op_id: op.op_id, code, op });
      await db.visits.put({ code, state });
    });
  }

  async ackOps(opIds: string[]): Promise<void> {
    await db.outbox.where('op_id').anyOf(opIds).delete();
  }

  async addPhoto(rec: PhotoRow): Promise<void> {
    await db.photos.put(rec);
  }

  /** Enregistre la photo en attente et le nouvel état dans une même transaction. */
  async addPhotoWithState(rec: PhotoRow, state: VisitState): Promise<void> {
    await db.transaction('rw', db.photos, db.visits, async () => {
      await db.photos.put(rec);
      await db.visits.put({ code: rec.code, state });
    });
  }

  pendingPhotos(code: string): Promise<PhotoRow[]> {
    return db.photos.where('code').equals(code).toArray();
  }

  /** Nombre d'opérations et de photos en attente, par visite (seulement celles qui en ont). */
  async pendingCounts(): Promise<Map<string, number>> {
    // clés d'index seulement : ni les opérations ni les photos ne sont chargées
    const [ops, photos] = await Promise.all([
      db.outbox.orderBy('code').keys(),
      db.photos.orderBy('code').keys(),
    ]);
    const counts = new Map<string, number>();
    for (const code of [...ops, ...photos] as string[]) counts.set(code, (counts.get(code) ?? 0) + 1);
    return counts;
  }

  async ackPhoto(id: string): Promise<void> {
    await db.photos.delete(id);
  }

  /** Un rejet du serveur impose de recharger l'état complet de la visite (persistant). */
  async markReloadNeeded(code: string): Promise<void> {
    await db.meta.put({ key: reloadKey(code), value: true });
  }

  async isReloadNeeded(code: string): Promise<boolean> {
    return (await db.meta.get(reloadKey(code)))?.value === true;
  }

  async clearReloadNeeded(code: string): Promise<void> {
    await db.meta.delete(reloadKey(code));
  }

  async removeVisit(code: string): Promise<void> {
    await db.transaction('rw', [db.visits, db.outbox, db.photos, db.meta], async () => {
      const pending =
        (await db.outbox.where('code').equals(code).count()) +
        (await db.photos.where('code').equals(code).count());
      if (pending > 0) throw new PendingDataError(code);
      await db.visits.delete(code);
      await db.meta.delete(reloadKey(code));
    });
  }
}
