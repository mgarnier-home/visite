import { Injectable } from '@angular/core';
import { Op, VisitState } from './api.types';
import { db, PhotoRow, VisitRow } from './db';

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

  async ackOps(opIds: string[]): Promise<void> {
    await db.outbox.where('op_id').anyOf(opIds).delete();
  }

  async addPhoto(rec: PhotoRow): Promise<void> {
    await db.photos.put(rec);
  }

  pendingPhotos(code: string): Promise<PhotoRow[]> {
    return db.photos.where('code').equals(code).toArray();
  }

  async ackPhoto(id: string): Promise<void> {
    await db.photos.delete(id);
  }

  async removeVisit(code: string): Promise<void> {
    await db.transaction('rw', db.visits, db.outbox, db.photos, async () => {
      const pending =
        (await db.outbox.where('code').equals(code).count()) +
        (await db.photos.where('code').equals(code).count());
      if (pending > 0) throw new PendingDataError(code);
      await db.visits.delete(code);
    });
  }
}
