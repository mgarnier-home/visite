import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api.client';
import { Op, OpResult, OpsResponse, VisitState } from './api.types';
import { db } from './db';
import { LocalStore } from './local-store';
import { localIsoWithOffset, SYNC_TIMERS, SyncService } from './sync.service';

const CODE = 'maison-1';
const OTHER = 'maison-2';

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
    points: [{ id: 'p1', room_id: 'r1', label: 'Note', type: 'note', options: [], weight: 1, position: 0, important: true }],
    questions: [], shared: [], ratings: [], comments: [], photos: [],
  };
}

function emptyChanges(seq: number, code = CODE): VisitState {
  const base = baseState();
  return { ...base, seq, visit: { ...base.visit, code }, rooms: [], points: [] };
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
  changes = vi.fn(async (code: string, since: number): Promise<VisitState> => emptyChanges(since, code));
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
    await vi.waitFor(() => expect(api.sendOps).toHaveBeenCalledTimes(1));
    const [, ops] = api.sendOps.mock.calls[0];
    d.resolve(applied(ops));
    await svc.whenIdle();
    expect(svc.status().pendingOps).toBe(0);
    expect(await store.pendingOps(CODE)).toEqual([]);
  });

  it('dispatch add_room ajoute un note_point_id et crée le point note localement', async () => {
    await openIdle();
    impl('ops', () => new Promise(() => undefined)); // envoi en suspens : les opérations restent en file
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
    impl('ops', async () => { throw new ApiError(0, 'hors ligne'); }); // rien n'est accepté au départ
    await svc.dispatch('set_comment', { room_id: 'r1', text: 'refusé' });
    await svc.whenIdle();
    await svc.dispatch('set_rating', { point_id: 'p1', value: 2 });
    await svc.whenIdle();
    const [first, second] = await store.pendingOps(CODE);
    // 1er lot : seule la première a un résultat (rejet) ; la seconde part au lot suivant
    impl('ops', async (_c: string, ops: Op[]) => (ops.some((o) => o.op_id === first.op_id)
      ? { seq: 9, results: [{ op_id: first.op_id, result: 'rejected', reason: 'closed' }] }
      : applied(ops)));
    let pendingAtReload: string[] = [];
    impl('state', async () => {
      pendingAtReload = (await store.pendingOps(CODE)).map((o) => o.op_id);
      return server;
    });
    const server = { ...baseState(), seq: 9, visit: { ...baseState().visit, closed_at: '2026-10-25T11:00:00Z' } };
    impl('changes', async (_c: string, since: number) => ({ ...emptyChanges(since), visit: server.visit }));
    api.sendOps.mockClear();
    svc.kick();
    await svc.whenIdle();

    expect(rejected).toEqual([{ op_id: first.op_id, result: 'rejected', reason: 'closed' }]);
    expect(notices).toEqual(['Une modification a été refusée (visite clôturée)']);
    expect(api.state).toHaveBeenCalledWith(CODE);
    const s = svc.state()!;
    expect(s.visit.closed_at).toBe('2026-10-25T11:00:00Z');
    expect(s.comments).toEqual([]); // l'op rejetée a disparu de l'affichage
    expect(pendingAtReload).toEqual([second.op_id]); // rechargement avant l'envoi du lot suivant
    expect(s.ratings.map((r) => r.value)).toEqual([2]); // l'op encore en attente a été réappliquée
    expect(api.sendOps.mock.calls.map((c) => c[1].map((o) => o.op_id))).toEqual([[first.op_id, second.op_id], [second.op_id]]);
    expect(await store.pendingOps(CODE)).toEqual([]);
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
    const d = deferred<VisitState>();
    impl('changes', () => d.promise);
    svc.kick();
    await vi.waitFor(() => expect(api.changes).toHaveBeenCalledTimes(1));
    // pendant que changes est en vol : une modification locale qui ne partira pas tout de suite
    impl('ops', async () => { throw new ApiError(0, 'hors ligne'); });
    await svc.dispatch('set_rating', { point_id: 'p1', value: 4 });
    d.resolve({
      ...emptyChanges(7),
      ratings: [{ point_id: 'p1', value: 2, updated_at: 1 }],
      comments: [{ room_id: 'r1', text: 'du serveur', updated_at: 1 }],
    });
    await svc.whenIdle();
    const s = svc.state()!;
    expect(s.seq).toBe(7);
    expect(s.ratings.map((r) => r.value)).toEqual([4]);
    expect(s.comments.map((c) => c.text)).toEqual(['du serveur']);
    expect((await store.getState(CODE))?.ratings[0].value).toBe(4);
    expect(svc.status().pendingOps).toBe(1);
  });

  it('lot sans résultat : échec passager, ni photos ni changes, nouvel essai', async () => {
    await openIdle();
    impl('ops', async () => ({ seq: 6, results: [] }));
    await svc.dispatch('add_room', { id: 'r2', name: 'Cave', from_section_id: null });
    await svc.addPhoto('r2', new Blob(['jpeg']));
    await svc.whenIdle();
    expect(api.uploadPhoto).not.toHaveBeenCalled();
    expect(api.changes).not.toHaveBeenCalled();
    expect(svc.status()).toMatchObject({ pendingOps: 1, pendingPhotos: 1 });
    expect(svc.status().error).not.toBeNull();
    impl('ops', async (_c: string, ops: Op[]) => applied(ops));
    svc.kick();
    await svc.whenIdle();
    expect(api.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(svc.status()).toMatchObject({ pendingOps: 0, pendingPhotos: 0, error: null });
  });

  it('les délais de nouvel essai plafonnent à 30 s', async () => {
    await openIdle();
    impl('ops', async () => { throw new ApiError(0, 'hors ligne'); });
    await svc.dispatch('set_rating', { point_id: 'p1', value: 3 });
    await svc.whenIdle();
    for (const [i, delay] of [1000, 2000, 4000, 8000, 16000, 30000, 30000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(api.sendOps).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      await svc.whenIdle();
      expect(api.sendOps).toHaveBeenCalledTimes(i + 2);
    }
  });

  it('le rechargement dû à un rejet survit à une fermeture', async () => {
    await openIdle();
    impl('ops', async (_c: string, ops: Op[]) => ({
      seq: 6, results: ops.map((o) => ({ op_id: o.op_id, result: 'rejected', reason: 'closed' })),
    }));
    impl('state', async () => { throw new ApiError(0, 'hors ligne'); });
    await svc.dispatch('set_comment', { room_id: 'r1', text: 'refusé' });
    await svc.whenIdle();
    expect(api.state).toHaveBeenCalledTimes(1);
    expect(await store.pendingOps(CODE)).toEqual([]);
    expect((await store.getState(CODE))?.comments).toHaveLength(1); // effet encore affiché

    svc.close();
    impl('state', async () => ({ ...baseState(), seq: 8 }));
    await svc.open(CODE);
    await svc.whenIdle();
    expect(api.state).toHaveBeenCalledTimes(2);
    expect(svc.state()!.comments).toEqual([]);
    expect((await store.getState(CODE))?.comments).toEqual([]);
    expect(await store.isReloadNeeded(CODE)).toBe(false);

    // une fois rechargé, plus de rechargement aux cycles suivants
    svc.kick();
    await svc.whenIdle();
    expect(api.state).toHaveBeenCalledTimes(2);
  });

  it('dispatch : si le stockage échoue, rien n\'est affiché ni mis en file et l\'erreur remonte', async () => {
    await openIdle();
    const quota = new DOMException('plein', 'QuotaExceededError');
    vi.spyOn(store, 'enqueueWithState').mockRejectedValueOnce(quota);
    await expect(svc.dispatch('set_rating', { point_id: 'p1', value: 4 })).rejects.toBe(quota);
    expect(svc.state()!.ratings).toEqual([]);
    expect(await store.pendingOps(CODE)).toEqual([]);
    expect((await store.getState(CODE))?.ratings).toEqual([]);
    expect(svc.status().pendingOps).toBe(0);
    // une fusion ultérieure n'y fait pas réapparaître l'entrée fantôme
    svc.kick();
    await svc.whenIdle();
    expect(svc.state()!.ratings).toEqual([]);
  });

  it('addPhoto : si le stockage échoue, la photo n\'apparaît pas et l\'erreur remonte', async () => {
    await openIdle();
    const quota = new DOMException('plein', 'QuotaExceededError');
    vi.spyOn(store, 'addPhotoWithState').mockRejectedValueOnce(quota);
    await expect(svc.addPhoto('r1', new Blob(['jpeg']))).rejects.toBe(quota);
    expect(svc.state()!.photos).toEqual([]);
    expect(await store.pendingPhotos(CODE)).toEqual([]);
    expect((await store.getState(CODE))?.photos).toEqual([]);
  });

  it('un kick juste à la fin d\'un cycle n\'est pas perdu', async () => {
    await openIdle();
    const timers = TestBed.inject(SYNC_TIMERS);
    const original = timers.set.bind(timers);
    // au moment où le cycle programme sa minuterie (fin de cycle), un kick arrive en microtâche
    vi.spyOn(timers, 'set').mockImplementationOnce((fn, ms) => {
      queueMicrotask(() => svc.kick());
      return original(fn, ms);
    });
    svc.kick();
    await svc.whenIdle();
    await vi.waitFor(() => expect(api.changes).toHaveBeenCalledTimes(2));
    await svc.whenIdle();
  });

  describe('fermeture ou changement de visite pendant un appel', () => {
    beforeEach(async () => {
      await store.saveState(OTHER, { ...baseState(), seq: 40, visit: { ...baseState().visit, code: OTHER } });
    });

    async function expectOtherUntouched() {
      // laisse l'ancien cycle aller au bout (chaque lecture IndexedDB cède la main)
      for (let i = 0; i < 20; i++) await store.pendingOps('aucune');
      await svc.whenIdle();
      expect(svc.state()!.visit.code).toBe(OTHER);
      expect(svc.state()!.seq).toBe(40);
      expect((await store.getState(OTHER))?.seq).toBe(40);
      expect(rejected).toEqual([]);
      expect(notices).toEqual([]);
    }

    it('sendOps en vol : rien n\'est acquitté, aucune émission, aucune étape suivante', async () => {
      await openIdle();
      const d = deferred<OpsResponse>();
      impl('ops', () => d.promise);
      await svc.dispatch('set_comment', { room_id: 'r1', text: 'x' });
      await vi.waitFor(() => expect(api.sendOps).toHaveBeenCalledTimes(1));
      await svc.open(OTHER);
      const [op] = await store.pendingOps(CODE);
      d.resolve({ seq: 9, results: [{ op_id: op.op_id, result: 'rejected', reason: 'closed' }] });
      await d.promise;
      await expectOtherUntouched();
      expect((await store.pendingOps(CODE)).map((o) => o.op_id)).toEqual([op.op_id]);
      expect(await store.isReloadNeeded(CODE)).toBe(false);
      expect(api.state).not.toHaveBeenCalled();
      expect(api.changes.mock.calls.map((c) => c[0])).toEqual([OTHER]);
    });

    it('uploadPhoto en vol : la photo reste en file et dans l\'état enregistré', async () => {
      await openIdle();
      const d = deferred<void>();
      impl('photo', () => d.promise);
      await svc.addPhoto('r1', new Blob(['jpeg']));
      await vi.waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledTimes(1));
      await svc.open(OTHER);
      d.reject(new ApiError(409, 'la visite est clôturée'));
      await d.promise.catch(() => undefined);
      await expectOtherUntouched();
      expect(await store.pendingPhotos(CODE)).toHaveLength(1);
      expect((await store.getState(CODE))?.photos).toHaveLength(1);
      expect(api.changes.mock.calls.map((c) => c[0])).toEqual([OTHER]);
    });

    it('uploadPhoto réussi après fermeture : la photo est quand même acquittée', async () => {
      await openIdle();
      const d = deferred<void>();
      impl('photo', () => d.promise);
      await svc.addPhoto('r1', new Blob(['jpeg']));
      await vi.waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledTimes(1));
      await svc.open(OTHER);
      d.resolve(); // 201 : la photo est sur le serveur
      await d.promise;
      await expectOtherUntouched();
      expect(await store.pendingPhotos(CODE)).toEqual([]);
      expect(api.changes.mock.calls.map((c) => c[0])).toEqual([OTHER]);
    });

    it('changement de visite pendant le recomptage qui suit un rejet : émissions pour la seule session courante', async () => {
      await openIdle();
      const sessions: Array<string | undefined> = [];
      svc.rejected$.subscribe(() => sessions.push(svc.state()?.visit.code));
      svc.notices$.subscribe(() => sessions.push(svc.state()?.visit.code));
      const gate = deferred<void>();
      let counting = false;
      const original = store.pendingPhotos.bind(store);
      impl('ops', async (_c: string, ops: Op[]) => {
        // le prochain pendingPhotos est celui du recomptage qui suit l'acquittement
        vi.spyOn(store, 'pendingPhotos').mockImplementationOnce(async (code: string) => {
          counting = true;
          await gate.promise;
          return original(code);
        });
        return { seq: 6, results: ops.map((o) => ({ op_id: o.op_id, result: 'rejected', reason: 'closed' })) };
      });
      await svc.dispatch('set_comment', { room_id: 'r1', text: 'x' });
      await vi.waitFor(() => expect(counting).toBe(true));
      await svc.open(OTHER);
      gate.resolve();
      for (let i = 0; i < 20; i++) await store.pendingOps('aucune');
      await svc.whenIdle();
      expect(sessions).toEqual([CODE, CODE]); // rejet + message, émis avant le changement
      expect(svc.state()!.visit.code).toBe(OTHER);
      expect((await store.getState(OTHER))?.seq).toBe(40);
      expect(api.state).not.toHaveBeenCalled();
      expect(await store.isReloadNeeded(CODE)).toBe(true); // rechargement dû à la réouverture
    });

    it('changes en vol : ni le signal ni les états enregistrés ne sont modifiés', async () => {
      await openIdle();
      const d = deferred<VisitState>();
      impl('changes', (code: string, since: number) => (code === CODE ? d.promise : Promise.resolve(emptyChanges(since, code))));
      svc.kick();
      await vi.waitFor(() => expect(api.changes).toHaveBeenCalledTimes(1));
      await svc.open(OTHER);
      await svc.whenIdle();
      d.resolve({ ...emptyChanges(50), comments: [{ room_id: 'r1', text: 'tard', updated_at: 1 }] });
      await d.promise;
      await expectOtherUntouched();
      expect(svc.state()!.comments).toEqual([]);
      expect((await store.getState(CODE))?.seq).toBe(5);
      expect(api.changes.mock.calls).toEqual([[CODE, 5], [OTHER, 40]]);
    });
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

  it('écriture perdante (LWW) : l\'expéditeur reprend la valeur gagnante renvoyée par changes', async () => {
    await openIdle();
    // le serveur garde la valeur plus récente de P2 et lui donne un nouveau seq (6 > 5)
    impl('changes', async (_code: string, since: number) => ({
      ...emptyChanges(since === 5 ? 6 : since),
      shared: since === 5 ? [{ target_id: 'p1', field: 'value', value: 'de P2', updated_at: 200, author: 2 }] : [],
    }));
    await svc.dispatch('set_shared', { target_id: 'p1', field: 'value', value: 'de moi' });
    expect(svc.state()!.shared[0].value).toBe('de moi');
    await svc.whenIdle();
    expect(api.sendOps).toHaveBeenCalledTimes(1);
    expect(api.changes).toHaveBeenCalledWith(CODE, 5);
    const s = svc.state()!;
    expect(s.seq).toBe(6);
    expect(s.shared).toEqual([{ target_id: 'p1', field: 'value', value: 'de P2', updated_at: 200, author: 2 }]);
    expect((await store.getState(CODE))?.shared[0].value).toBe('de P2');
  });

  it('close() signale la visite fermée, isOpen suit la visite ouverte, settled attend la dernière boucle', async () => {
    const closed: string[] = [];
    svc.closed$.subscribe((c) => closed.push(c));
    await openIdle();
    expect(svc.isOpen(CODE)).toBe(true);
    expect(svc.isOpen(OTHER)).toBe(false);
    const d = deferred<OpsResponse>();
    impl('ops', () => d.promise);
    await svc.dispatch('set_rating', { point_id: 'p1', value: 3 });
    await vi.waitFor(() => expect(api.sendOps).toHaveBeenCalledTimes(1));
    svc.close();
    expect(closed).toEqual([CODE]);
    expect(svc.isOpen(CODE)).toBe(false);
    let settled = false;
    void svc.settled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // l'envoi de la session fermée est encore en vol
    d.resolve(applied([]));
    await vi.waitFor(() => expect(settled).toBe(true));
    svc.close();
    expect(closed).toEqual([CODE]); // rien d'ouvert : pas de nouveau signal
  });
});
