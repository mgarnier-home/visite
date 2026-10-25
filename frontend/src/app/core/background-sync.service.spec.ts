import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api.client';
import { Op, OpsResponse, VisitState } from './api.types';
import { BackgroundSyncService } from './background-sync.service';
import { db } from './db';
import { LocalStore } from './local-store';
import { SyncService } from './sync.service';

const A = 'maison-a';
const B = 'maison-b';

const op = (id: string): Op => ({ op_id: id, type: 'set_rating', client_ts: 1, payload: { point_id: 'p', value: 1 } });
const applied = (ops: Op[]): OpsResponse => ({ seq: 9, results: ops.map((o) => ({ op_id: o.op_id, result: 'applied' })) });
const photo = (id: string, code: string) => ({ id, code, room_id: null, taken_at: 'x', blob: new Blob(['x']) });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

describe('BackgroundSyncService', () => {
  let api: { sendOps: ReturnType<typeof vi.fn>; uploadPhoto: ReturnType<typeof vi.fn>; calls: string[] };
  let store: LocalStore;
  let sync: { isOpen: ReturnType<typeof vi.fn>; settled: ReturnType<typeof vi.fn>; closed$: { subscribe: (fn: (c: string) => void) => { unsubscribe(): void } }; emitClosed: (c: string) => void };
  let svc: BackgroundSyncService;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await Promise.all([db.meta.clear(), db.visits.clear(), db.outbox.clear(), db.photos.clear()]);
    const calls: string[] = [];
    api = {
      calls,
      sendOps: vi.fn(async (code: string, ops: Op[]) => {
        calls.push(`ops:${code}:${ops.map((o) => o.op_id).join(',')}`);
        return applied(ops);
      }),
      uploadPhoto: vi.fn(async (code: string, p: { id: string }) => {
        calls.push(`photo:${code}:${p.id}`);
      }),
    };
    const listeners: ((c: string) => void)[] = [];
    sync = {
      isOpen: vi.fn(() => false),
      settled: vi.fn(async () => undefined),
      closed$: { subscribe: (fn) => (listeners.push(fn), { unsubscribe: () => undefined }) },
      emitClosed: (c) => listeners.forEach((fn) => fn(c)),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: SyncService, useValue: sync },
      ],
    });
    store = TestBed.inject(LocalStore);
    svc = TestBed.inject(BackgroundSyncService);
  });

  afterEach(() => {
    svc.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('au démarrage, envoie les opérations puis les photos de chaque visite en attente', async () => {
    await store.enqueue(A, op('a1'));
    await store.enqueue(A, op('a2'));
    await store.addPhoto(photo('ph-a', A));
    await store.enqueue(B, op('b1'));
    svc.start();
    await svc.whenIdle();
    expect(api.calls).toEqual(['ops:maison-a:a1,a2', 'photo:maison-a:ph-a', 'ops:maison-b:b1']);
    expect(await store.pendingCounts()).toEqual(new Map());
    expect(svc.revision()).toBeGreaterThan(0);
  });

  it('ne touche pas à la visite ouverte (SyncService s\'en charge)', async () => {
    sync.isOpen.mockImplementation((c: string) => c === A);
    await store.enqueue(A, op('a1'));
    await store.enqueue(B, op('b1'));
    svc.start();
    await svc.whenIdle();
    expect(api.calls).toEqual(['ops:maison-b:b1']);
    expect((await store.pendingOps(A)).length).toBe(1);
  });

  it('attend la fin de la dernière boucle de SyncService avant de commencer', async () => {
    const last = deferred<void>();
    sync.settled.mockReturnValue(last.promise);
    await store.enqueue(A, op('a1'));
    svc.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.sendOps).not.toHaveBeenCalled();
    last.resolve();
    await svc.whenIdle();
    expect(api.calls).toEqual(['ops:maison-a:a1']);
  });

  it('visite ouverte pendant l\'envoi : la réponse n\'est pas acquittée, l\'envoi s\'arrête', async () => {
    const res = deferred<OpsResponse>();
    api.sendOps.mockImplementation(() => res.promise);
    await store.enqueue(A, op('a1'));
    await store.addPhoto(photo('ph-a', A));
    svc.start();
    await vi.waitFor(() => expect(api.sendOps).toHaveBeenCalledTimes(1));
    sync.isOpen.mockImplementation((c: string) => c === A);
    res.resolve(applied([op('a1')]));
    await svc.whenIdle();
    expect((await store.pendingOps(A)).length).toBe(1);
    expect(api.uploadPhoto).not.toHaveBeenCalled();
  });

  it('se relance sur online, au retour au premier plan et à la fermeture d\'une visite', async () => {
    svc.start();
    await svc.whenIdle();
    await store.enqueue(A, op('a1'));
    window.dispatchEvent(new Event('online'));
    await svc.whenIdle();
    expect(api.calls).toEqual(['ops:maison-a:a1']);

    await store.enqueue(A, op('a2'));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await svc.whenIdle();
    expect(api.calls).toEqual(['ops:maison-a:a1', 'ops:maison-a:a2']);

    await store.enqueue(B, op('b1'));
    sync.emitClosed(B);
    await svc.whenIdle();
    expect(api.calls.at(-1)).toBe('ops:maison-b:b1');
  });

  it('échec réseau : gardé en file, nouvel essai à 1 s puis 2 s', async () => {
    api.sendOps.mockRejectedValue(new ApiError(0, 'hors ligne'));
    await store.enqueue(A, op('a1'));
    svc.start();
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(api.sendOps).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(2);
    api.sendOps.mockImplementation(async (_c: string, ops: Op[]) => applied(ops));
    await vi.advanceTimersByTimeAsync(2000);
    await svc.whenIdle();
    expect(await store.pendingCounts()).toEqual(new Map());
  });

  it('une visite en échec n\'empêche pas l\'envoi des autres', async () => {
    api.sendOps.mockImplementation(async (code: string, ops: Op[]) => {
      if (code === A) throw new ApiError(503, 'indisponible');
      return applied(ops);
    });
    await store.enqueue(A, op('a1'));
    await store.enqueue(B, op('b1'));
    svc.start();
    await svc.whenIdle();
    expect(await store.pendingCounts()).toEqual(new Map([[A, 1]]));
  });

  it('rejet ou photo refusée (4xx) : retirés de la file, rechargement complet noté pour l\'ouverture', async () => {
    api.sendOps.mockImplementation(async (_c: string, ops: Op[]) => ({
      seq: 9, results: ops.map((o) => ({ op_id: o.op_id, result: 'rejected', reason: 'closed' })),
    }));
    api.uploadPhoto.mockRejectedValue(new ApiError(409, 'visite clôturée'));
    await store.enqueue(A, op('a1'));
    await store.addPhoto(photo('ph-b', B));
    svc.start();
    await svc.whenIdle();
    expect(await store.pendingCounts()).toEqual(new Map());
    expect(await store.isReloadNeeded(A)).toBe(true);
    expect(await store.isReloadNeeded(B)).toBe(true);
  });

  it('un seul passage à la fois : un déclenchement pendant un passage en donne un seul de plus', async () => {
    const res = deferred<OpsResponse>();
    api.sendOps.mockImplementationOnce(() => res.promise);
    await store.enqueue(A, op('a1'));
    svc.start();
    await vi.waitFor(() => expect(api.sendOps).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('online'));
    await store.enqueue(B, op('b1'));
    res.resolve(applied([op('a1')]));
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(2);
    expect(api.calls).toEqual(['ops:maison-b:b1']);
  });

  it('stop() retire les écouteurs et la minuterie', async () => {
    api.sendOps.mockRejectedValue(new ApiError(0, 'hors ligne'));
    await store.enqueue(A, op('a1'));
    svc.start();
    await svc.whenIdle();
    svc.stop();
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(1);
  });
});
