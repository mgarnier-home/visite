import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api.client';
import { Op, OpResult, OpsResponse, VisitState } from './api.types';
import { db } from './db';
import { LocalStore } from './local-store';
import { localIsoWithOffset, SyncService } from './sync.service';

const CODE = 'maison-1';

function baseState(): VisitState {
  return {
    seq: 5,
    me: { number: 1 },
    visit: {
      code: CODE, is_creator: true, created_at: '2026-10-25T10:00:00Z', closed_at: null,
      fiche: {
        address: 'rue A', price_eur: null, living_area_m2: null, floor_area_m2: null,
        land_area_m2: null, visit_at: null, agent_name: null, agent_phone: null,
        agent_email: null, construction_year: null, dpe_energy: null, dpe_ges: null,
        rooms_count: null, bedrooms_count: null, listing_url: null, heating_type: null,
      },
      packing_list: '', participants: 1,
    },
    rooms: [{ id: 'r1', name: 'Salon', dir_name: 'salon', kind: 'room', position: 0, hidden: false }],
    points: [{ id: 'p1', room_id: 'r1', label: 'Note', type: 'note', options: [], weight: 1, position: 0 }],
    questions: [], shared: [], ratings: [], comments: [], photos: [],
  };
}

function emptyChanges(seq: number): VisitState {
  return { ...baseState(), seq, rooms: [], points: [] };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const applied = (ops: Op[]): OpsResponse => ({
  seq: 99, results: ops.map((o) => ({ op_id: o.op_id, result: 'applied' })),
});

/** Faux ApiClient : chaque méthode est un vi.fn, les appels sont tracés dans l'ordre. */
class FakeApi {
  calls: string[] = [];
  sendOps = vi.fn(async (_code: string, ops: Op[]): Promise<OpsResponse> => applied(ops));
  uploadPhoto = vi.fn(async (_code: string, _p: { id: string }): Promise<void> => undefined);
  changes = vi.fn(async (_code: string, since: number): Promise<VisitState> => emptyChanges(since));
  state = vi.fn(async (_code: string): Promise<VisitState> => baseState());
}

describe('localIsoWithOffset', () => {
  const d = new Date(Date.UTC(2026, 9, 25, 12, 35, 20, 789));

  it('formate l\'heure locale avec un décalage positif', () => {
    expect(localIsoWithOffset(d, 120)).toBe('2026-10-25T14:35:20+02:00');
  });

  it('formate l\'heure locale avec un décalage négatif non entier', () => {
    expect(localIsoWithOffset(d, -210)).toBe('2026-10-25T09:05:20-03:30');
  });

  it('utilise UTC+00:00 pour un décalage nul et change de jour si besoin', () => {
    expect(localIsoWithOffset(d, 0)).toBe('2026-10-25T12:35:20+00:00');
    expect(localIsoWithOffset(d, 720)).toBe('2026-10-26T00:35:20+12:00');
  });

  it('lit par défaut le fuseau du téléphone', () => {
    const spy = vi.spyOn(d, 'getTimezoneOffset').mockReturnValue(-60);
    expect(localIsoWithOffset(d)).toBe('2026-10-25T13:35:20+01:00');
    spy.mockReturnValue(300);
    expect(localIsoWithOffset(d)).toBe('2026-10-25T07:35:20-05:00');
  });
});

describe('SyncService', () => {
  let api: FakeApi;
  let store: LocalStore;
  let svc: SyncService;
  let rejected: OpResult[];
  let notices: string[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    await Promise.all([db.meta.clear(), db.visits.clear(), db.outbox.clear(), db.photos.clear()]);
    api = new FakeApi();
    for (const [name, fn] of [['ops', api.sendOps], ['changes', api.changes], ['state', api.state]] as const) {
      fn.mockImplementation(wrap(name, fn.getMockImplementation()!) as never);
    }
    api.uploadPhoto.mockImplementation(wrapPhoto(api.uploadPhoto.getMockImplementation()!));
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    store = TestBed.inject(LocalStore);
    svc = TestBed.inject(SyncService);
    rejected = [];
    notices = [];
    svc.rejected$.subscribe((r) => rejected.push(r));
    svc.notices$.subscribe((n) => notices.push(n));
    await store.saveState(CODE, baseState());
  });

  afterEach(() => {
    svc.close();
    vi.useRealTimers();
  });

  /** Enrobe une implémentation pour tracer l'appel ; les tests remplacent ensuite l'implémentation via `impl`. */
  const impls = new Map<string, (...a: any[]) => Promise<unknown>>();
  function wrap(name: string, f: (...a: any[]) => Promise<unknown>) {
    impls.set(name, f);
    return (...a: any[]) => { api.calls.push(name); return impls.get(name)!(...a); };
  }
  function wrapPhoto(f: (...a: any[]) => Promise<void>) {
    impls.set('photo', f);
    return (...a: any[]) => { api.calls.push(`photo:${a[1].id}`); return impls.get('photo')!(...a) as Promise<void>; };
  }
  function impl(name: 'ops' | 'photo' | 'changes' | 'state', f: (...a: any[]) => Promise<unknown>) {
    impls.set(name, f);
  }

  async function openIdle() {
    await svc.open(CODE);
    await svc.whenIdle();
    api.calls = [];
    for (const fn of [api.sendOps, api.uploadPhoto, api.changes, api.state]) fn.mockClear();
  }

  it('open rejette une visite absente du stockage local', async () => {
    await expect(svc.open('inconnue')).rejects.toThrow();
    expect(svc.state()).toBeNull();
  });

  it('open charge l\'état local et lance un premier cycle', async () => {
    await svc.open(CODE);
    expect(svc.state()?.visit.code).toBe(CODE);
    await svc.whenIdle();
    expect(api.changes).toHaveBeenCalledWith(CODE, 5);
    expect(svc.status()).toEqual({ online: true, pendingOps: 0, pendingPhotos: 0, error: null });
  });

  it('dispatch met à jour state() immédiatement ; pendingOps passe à 0 après un cycle réussi', async () => {
    await openIdle();
    const d = deferred<OpsResponse>();
    impl('ops', () => d.promise);
    await svc.dispatch('set_rating', { point_id: 'p1', value: 4 });
    expect(svc.state()?.ratings).toEqual([{ point_id: 'p1', value: 4, updated_at: expect.any(Number) }]);
    expect(svc.status().pendingOps).toBe(1);
    expect((await store.getState(CODE))?.ratings[0].value).toBe(4);
    const [, ops] = api.sendOps.mock.calls[0];
    d.resolve(applied(ops));
    await svc.whenIdle();
    expect(svc.status().pendingOps).toBe(0);
    expect(await store.pendingOps(CODE)).toEqual([]);
  });

  it('dispatch add_room ajoute un note_point_id et crée le point note localement', async () => {
    await openIdle();
    impl('ops', async () => ({ seq: 6, results: [] }));
    await svc.dispatch('add_room', { id: 'r2', name: 'Cave', from_section_id: null });
    const [op] = await store.pendingOps(CODE);
    const noteId = (op.payload as { note_point_id: string }).note_point_id;
    expect(noteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(svc.state()?.points.find((p) => p.room_id === 'r2')).toMatchObject({ id: noteId, type: 'note' });

    await svc.dispatch('add_room', { id: 'r3', name: 'Grenier', from_section_id: null, note_point_id: 'n3' });
    const ops = await store.pendingOps(CODE);
    expect((ops[1].payload as { note_point_id: string }).note_point_id).toBe('n3');
  });

  it('échec réseau : l\'opération reste, nouvel essai à 1 s puis 2 s, délai remis à 1 s après succès', async () => {
    await openIdle();
    impl('ops', async () => { throw new ApiError(0, 'Réseau indisponible'); });
    await svc.dispatch('set_rating', { point_id: 'p1', value: 3 });
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(1);
    expect(svc.status().pendingOps).toBe(1);
    expect(api.changes).not.toHaveBeenCalled(); // le cycle s'arrête à l'échec

    await vi.advanceTimersByTimeAsync(999);
    expect(api.sendOps).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(api.sendOps).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(3);
    expect(svc.status().pendingOps).toBe(1);

    // succès au 4 s suivant, puis nouvelle panne : le délai repart à 1 s
    impl('ops', async (_c: string, ops: Op[]) => applied(ops));
    await vi.advanceTimersByTimeAsync(4000);
    await svc.whenIdle();
    expect(svc.status().pendingOps).toBe(0);
    impl('ops', async () => { throw new ApiError(503, 'indisponible'); });
    await svc.dispatch('set_rating', { point_id: 'p1', value: 5 });
    await svc.whenIdle();
    const n = api.sendOps.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(n + 1);
    expect(svc.status().error).toContain('503');
  });

  it('erreur 4xx sur un lot : les opérations sont gardées, erreur affichée, nouvel essai', async () => {
    await openIdle();
    impl('ops', async () => { throw new ApiError(400, 'lot invalide'); });
    await svc.dispatch('set_rating', { point_id: 'p1', value: 3 });
    await svc.whenIdle();
    expect(svc.status().pendingOps).toBe(1);
    expect(svc.status().error).toMatch(/400/);
    expect(api.changes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(2);
  });

  it('envoie par lots de 500', async () => {
    for (let i = 0; i < 501; i++) {
      await store.enqueue(CODE, { op_id: `o${i}`, type: 'set_rating', client_ts: i, payload: { point_id: 'p1', value: 1 } });
    }
    await svc.open(CODE);
    await svc.whenIdle();
    expect(api.sendOps.mock.calls.map((c) => c[1].length)).toEqual([500, 1]);
    expect(svc.status().pendingOps).toBe(0);
  });

  it('rejected : rejected$ et notices$ émettent, state() rechargé, opérations restantes réappliquées', async () => {
    await openIdle();
    const d = deferred<void>();
    impl('ops', () => d.promise.then(() => ({ seq: 9, results: [] }))); // rien n'est accepté au départ
    await svc.dispatch('set_comment', { room_id: 'r1', text: 'refusé' });
    await svc.dispatch('set_rating', { point_id: 'p1', value: 2 });
    const [first, second] = await store.pendingOps(CODE);
    impl('ops', async () => ({
      seq: 9, results: [{ op_id: first.op_id, result: 'rejected', reason: 'closed' }],
    }));
    const server = { ...baseState(), seq: 9, visit: { ...baseState().visit, closed_at: '2026-10-25T11:00:00Z' } };
    impl('state', async () => server);
    impl('changes', async (_c: string, since: number) => ({ ...emptyChanges(since), visit: server.visit }));
    d.resolve();
    await svc.whenIdle();

    expect(rejected).toEqual([{ op_id: first.op_id, result: 'rejected', reason: 'closed' }]);
    expect(notices).toEqual(['Une modification a été refusée (visite clôturée)']);
    expect(api.state).toHaveBeenCalledWith(CODE);
    const s = svc.state()!;
    expect(s.visit.closed_at).toBe('2026-10-25T11:00:00Z');
    expect(s.comments).toEqual([]); // l'op rejetée a disparu de l'affichage
    expect(s.ratings.map((r) => r.value)).toEqual([2]); // l'op encore en attente est réappliquée
    expect((await store.pendingOps(CODE)).map((o) => o.op_id)).toEqual([second.op_id]);
    expect((await store.getState(CODE))?.visit.closed_at).toBe('2026-10-25T11:00:00Z');
    expect(api.changes).toHaveBeenCalledWith(CODE, 9);
  });

  it('le rechargement après un rejet garde les photos encore en file', async () => {
    await openIdle();
    impl('ops', async () => { throw new ApiError(0, 'hors ligne'); });
    impl('photo', async () => { throw new ApiError(503, 'indisponible'); });
    await svc.dispatch('set_comment', { room_id: 'r1', text: 'x' });
    await svc.whenIdle();
    await svc.addPhoto('r1', new Blob(['jpeg']));
    await svc.whenIdle();
    const photoId = svc.state()!.photos[0].id;
    impl('ops', async (_c: string, ops: Op[]) => ({
      seq: 6, results: ops.map((o) => ({ op_id: o.op_id, result: 'rejected', reason: 'invalid' })),
    }));
    svc.kick();
    await svc.whenIdle();
    expect(api.state).toHaveBeenCalledTimes(1);
    expect(notices).toEqual(['Une modification a été refusée (données invalides)']);
    expect(svc.state()!.photos).toEqual([expect.objectContaining({ id: photoId, room_id: 'r1', author: 1 })]);
    expect((await store.getState(CODE))?.photos.map((p) => p.id)).toEqual([photoId]);
  });

  it('addPhoto : la photo apparaît aussitôt dans state() et part après les opérations', async () => {
    await openIdle();
    impl('ops', async () => { throw new ApiError(0, 'hors ligne'); });
    await svc.dispatch('set_rating', { point_id: 'p1', value: 4 });
    await svc.whenIdle();
    await svc.addPhoto('r1', new Blob(['jpeg']));
    await svc.whenIdle();
    const photo = svc.state()!.photos[0];
    expect(photo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/), room_id: 'r1', author: 1,
      taken_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/),
    });
    expect(svc.status().pendingPhotos).toBe(1);
    expect(api.uploadPhoto).not.toHaveBeenCalled(); // bloquée derrière les opérations en échec

    api.calls = [];
    impl('ops', async (_c: string, ops: Op[]) => applied(ops));
    svc.kick();
    await svc.whenIdle();
    expect(api.calls).toEqual(['ops', `photo:${photo.id}`, 'changes']);
    const sent = api.uploadPhoto.mock.calls[0][1] as unknown as { id: string; room_id: string; taken_at: string; blob: Blob };
    expect(sent).toMatchObject({ id: photo.id, room_id: 'r1', taken_at: photo.taken_at });
    // le Blob traverse fake-indexeddb (clonage structuré de jsdom) : on vérifie seulement sa présence
    expect(sent).toHaveProperty('blob');
    expect(svc.status()).toMatchObject({ pendingOps: 0, pendingPhotos: 0 });
    expect(svc.state()!.photos.map((p) => p.id)).toEqual([photo.id]);
  });

  it('photo 409 : retirée de la file, de l\'affichage, avec un message', async () => {
    await openIdle();
    impl('photo', async () => { throw new ApiError(409, 'la visite est clôturée'); });
    await svc.addPhoto(null, new Blob(['jpeg']));
    await svc.whenIdle();
    expect(await store.pendingPhotos(CODE)).toEqual([]);
    expect(svc.status().pendingPhotos).toBe(0);
    expect(svc.state()!.photos).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('la visite est clôturée');
    expect(api.changes).toHaveBeenCalledTimes(1); // le cycle continue
  });

  it('photo 5xx : gardée, cycle arrêté, nouvel essai à 1 s', async () => {
    await openIdle();
    impl('photo', async () => { throw new ApiError(502, 'passerelle'); });
    await svc.addPhoto('r1', new Blob(['jpeg']));
    await svc.whenIdle();
    expect(svc.status().pendingPhotos).toBe(1);
    expect(svc.state()!.photos).toHaveLength(1);
    expect(api.changes).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
    impl('photo', async () => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await svc.whenIdle();
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(svc.status().pendingPhotos).toBe(0);
  });

  it('une valeur locale en attente n\'est pas écrasée par un changes plus ancien', async () => {
    await openIdle();
    impl('ops', async () => ({ seq: 6, results: [] })); // le serveur ne répond pas pour l'op : elle reste
    impl('changes', async () => ({
      ...emptyChanges(7),
      ratings: [{ point_id: 'p1', value: 2, updated_at: 1 }],
      comments: [{ room_id: 'r1', text: 'du serveur', updated_at: 1 }],
    }));
    await svc.dispatch('set_rating', { point_id: 'p1', value: 4 });
    await svc.whenIdle();
    const s = svc.state()!;
    expect(s.seq).toBe(7);
    expect(s.ratings.map((r) => r.value)).toEqual([4]);
    expect(s.comments.map((c) => c.text)).toEqual(['du serveur']);
    expect((await store.getState(CODE))?.ratings[0].value).toBe(4);
    expect(svc.status().pendingOps).toBe(1);
  });

  it('un seul cycle à la fois : des kick pendant un cycle donnent un seul cycle de plus', async () => {
    await openIdle();
    let inFlight = 0;
    let maxInFlight = 0;
    const gates: Array<() => void> = [];
    impl('ops', (_c: string, ops: Op[]) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<OpsResponse>((res) => gates.push(() => { inFlight--; res(applied(ops)); }));
    });
    await svc.dispatch('set_rating', { point_id: 'p1', value: 1 });
    await vi.waitFor(() => expect(gates).toHaveLength(1));
    svc.kick();
    svc.kick();
    await svc.dispatch('set_comment', { room_id: 'r1', text: 'b' });
    expect(api.sendOps).toHaveBeenCalledTimes(1);
    gates[0]();
    await vi.waitFor(() => expect(gates).toHaveLength(2));
    expect(maxInFlight).toBe(1);
    gates[1]();
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
    expect(api.changes).toHaveBeenCalledTimes(2); // le cycle en cours + exactement un cycle de suite
    expect(svc.status().pendingOps).toBe(0);
  });

  it('récupère les changements toutes les 5 s, en ligne et au premier plan', async () => {
    await openIdle();
    await vi.advanceTimersByTimeAsync(4999);
    expect(api.changes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await svc.whenIdle();
    expect(api.changes).toHaveBeenCalledTimes(1);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await vi.advanceTimersByTimeAsync(5000);
    await svc.whenIdle();
    expect(api.changes).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await svc.whenIdle();
    expect(api.changes).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });

  it('suit les événements online / offline', async () => {
    await openIdle();
    window.dispatchEvent(new Event('offline'));
    expect(svc.status().online).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(svc.status().online).toBe(true);
    await svc.whenIdle();
    expect(api.changes).toHaveBeenCalledTimes(1);
  });

  it('close() arrête les minuteries et les écouteurs', async () => {
    await openIdle();
    expect(vi.getTimerCount()).toBe(1);
    svc.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(svc.state()).toBeNull();
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    await svc.whenIdle();
    expect(api.changes).not.toHaveBeenCalled();
    await expect(svc.dispatch('set_rating', { point_id: 'p1', value: 1 })).rejects.toThrow();
  });
});
