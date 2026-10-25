import { beforeEach, describe, expect, it } from 'vitest';
import { Op, VisitState } from './api.types';
import { db } from './db';
import { LocalStore, PendingDataError } from './local-store';

const state = (code: string) => ({ seq: 1, visit: { code } }) as unknown as VisitState;
const op = (id: string): Op => ({ op_id: id, type: 'hide_room', client_ts: 1, payload: { room_id: 'r' } });

describe('LocalStore', () => {
  let store: LocalStore;

  beforeEach(async () => {
    await Promise.all([db.meta.clear(), db.visits.clear(), db.outbox.clear(), db.photos.clear()]);
    store = new LocalStore();
  });

  it('enregistre et relit un état, liste les visites', async () => {
    await store.saveState('a', state('a'));
    await store.saveState('b', state('b'));
    expect((await store.getState('a'))?.visit.code).toBe('a');
    expect(await store.getState('zz')).toBeUndefined();
    expect((await store.listVisits()).map((v) => v.code).sort()).toEqual(['a', 'b']);
  });

  it('pendingOps rend l\'ordre d\'insertion, par visite', async () => {
    await store.enqueue('a', op('z'));
    await store.enqueue('b', op('m'));
    await store.enqueue('a', op('c'));
    await store.enqueue('a', op('k'));
    expect((await store.pendingOps('a')).map((o) => o.op_id)).toEqual(['z', 'c', 'k']);
  });

  it('ackOps supprime par op_id', async () => {
    await store.enqueue('a', op('1'));
    await store.enqueue('a', op('2'));
    await store.ackOps(['1']);
    expect((await store.pendingOps('a')).map((o) => o.op_id)).toEqual(['2']);
  });

  it('gère les photos en attente', async () => {
    const rec = { id: 'p1', code: 'a', room_id: null, taken_at: 't', blob: new Blob(['x']) };
    await store.addPhoto(rec);
    expect((await store.pendingPhotos('a')).map((p) => p.id)).toEqual(['p1']);
    expect(await store.pendingPhotos('b')).toEqual([]);
    await store.ackPhoto('p1');
    expect(await store.pendingPhotos('a')).toEqual([]);
  });

  it('removeVisit refuse s\'il reste une opération', async () => {
    await store.saveState('a', state('a'));
    await store.enqueue('a', op('1'));
    await expect(store.removeVisit('a')).rejects.toBeInstanceOf(PendingDataError);
    expect(await store.getState('a')).toBeDefined();
  });

  it('removeVisit refuse s\'il reste une photo', async () => {
    await store.saveState('a', state('a'));
    await store.addPhoto({ id: 'p1', code: 'a', room_id: null, taken_at: 't', blob: new Blob(['x']) });
    await expect(store.removeVisit('a')).rejects.toBeInstanceOf(PendingDataError);
  });

  it('removeVisit supprime une visite sans données en attente', async () => {
    await store.saveState('a', state('a'));
    await store.removeVisit('a');
    expect(await store.getState('a')).toBeUndefined();
  });
});
