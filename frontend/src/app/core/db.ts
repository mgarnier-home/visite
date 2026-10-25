import Dexie, { Table } from 'dexie';
import { Op, VisitState } from './api.types';

export interface MetaRow { key: string; value: unknown }
export interface VisitRow { code: string; state: VisitState }
export interface OutboxRow { seq?: number; op_id: string; code: string; op: Op }
export interface PhotoRow {
  id: string; code: string; room_id: string | null; taken_at: string; blob: Blob;
}

export class VisiteDb extends Dexie {
  meta!: Table<MetaRow, string>;
  visits!: Table<VisitRow, string>;
  outbox!: Table<OutboxRow, number>;
  photos!: Table<PhotoRow, string>;

  constructor() {
    super('visite');
    this.version(1).stores({
      meta: 'key',
      visits: 'code',
      // seq auto-incrémenté : conserve l'ordre d'insertion
      outbox: '++seq, &op_id, code',
      photos: 'id, code',
    });
  }
}

export const db = new VisiteDb();
