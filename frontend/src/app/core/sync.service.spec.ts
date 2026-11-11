import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api.client';
import { CurrentListing } from './current-listing';
import { Op, OpResult, OpsResponse, VisitState } from './api.types';
import { localIsoWithOffset, SyncService } from './sync.service';

const ID = 'l1';

function baseState(seq = 5): VisitState {
  return {
    seq,
    me: { number: 1 },
    visit: { code: ID, created_at: '2026-10-25T10:00:00Z', packing_list: '', participants: 1 },
    rooms: [{ id: 'r1', name: 'Salon', dir_name: 'salon', kind: 'room', position: 0, hidden: false }],
    points: [{ id: 'p1', room_id: 'r1', label: 'Note', type: 'note', options: [], weight: 1, position: 0, important: true }],
    questions: [], shared: [], ratings: [], comments: [], photos: [],
  };
}

const applied = (ops: Op[]): OpsResponse => ({
  seq: 99, results: ops.map((o) => ({ op_id: o.op_id, result: 'applied' })),
});

class FakeApi {
  sendOps = vi.fn(async (_id: string, ops: Op[]): Promise<OpsResponse> => applied(ops));
  uploadPhoto = vi.fn(async (_id: string, _p: { id: string }): Promise<void> => undefined);
  changes = vi.fn(async (_id: string, since: number): Promise<VisitState> => ({ ...baseState(since), rooms: [], points: [] }));
  state = vi.fn(async (_id: string): Promise<VisitState> => baseState());
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
  let svc: SyncService;
  let rejected: OpResult[];
  let notices: string[];

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    api = new FakeApi();
    TestBed.configureTestingModule({ providers: [{ provide: ApiClient, useValue: api }] });
    svc = TestBed.inject(SyncService);
    rejected = [];
    notices = [];
    svc.rejected$.subscribe((r) => rejected.push(r));
    svc.notices$.subscribe((n) => notices.push(n));
    await svc.open(ID);
    api.state.mockClear();
  });

  afterEach(() => {
    svc.close();
    vi.useRealTimers();
  });

  it('open charge l\'état du serveur', () => {
    expect(svc.state()?.visit.code).toBe(ID);
    expect(svc.status()).toEqual({ sending: false, error: null });
  });

  it('dispatch applique l\'opération tout de suite puis appelle sendOps une fois', async () => {
    let release!: (r: OpsResponse) => void;
    api.sendOps.mockImplementationOnce(() => new Promise((res) => (release = res)));
    const done = svc.dispatch('set_rating', { point_id: 'p1', value: 4 });
    expect(svc.state()?.ratings).toEqual([{ point_id: 'p1', value: 4, updated_at: expect.any(Number) }]);
    expect(svc.status().sending).toBe(true);
    await vi.waitFor(() => expect(api.sendOps).toHaveBeenCalledTimes(1));
    const [id, ops] = api.sendOps.mock.calls[0];
    expect(id).toBe(ID);
    expect(ops).toHaveLength(1);
    release(applied(ops));
    await done;
    expect(svc.status().sending).toBe(false);
    expect(api.sendOps).toHaveBeenCalledTimes(1);
    expect(api.state).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it('dispatch add_room ajoute un note_point_id et crée le point note localement', async () => {
    await svc.dispatch('add_room', { id: 'r2', name: 'Cave', from_section_id: null });
    const op = api.sendOps.mock.calls[0][1][0];
    const noteId = (op.payload as { note_point_id: string }).note_point_id;
    expect(noteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(svc.state()?.points.find((p) => p.room_id === 'r2')).toMatchObject({ id: noteId, type: 'note' });
  });

  for (const status of [0, 500]) {
    it(`sendOps en échec (status ${status}) : notice et état rechargé`, async () => {
      api.sendOps.mockRejectedValueOnce(new ApiError(status, 'boum'));
      api.state.mockResolvedValueOnce({ ...baseState(8), ratings: [] });
      await svc.dispatch('set_rating', { point_id: 'p1', value: 4 });
      expect(notices).toEqual(['Modification non enregistrée : boum']);
      expect(api.state).toHaveBeenCalledWith(ID);
      expect(svc.state()?.seq).toBe(8);
      expect(svc.state()?.ratings).toEqual([]);
      expect(svc.status().sending).toBe(false);
    });
  }

  it('sendOps et state() en échec : erreur persistante, le poll suivant recharge l\'état complet', async () => {
    api.sendOps.mockRejectedValueOnce(new ApiError(0, 'Réseau indisponible'));
    api.state.mockRejectedValueOnce(new ApiError(0, 'Réseau indisponible'));
    await svc.dispatch('set_rating', { point_id: 'p1', value: 4 });
    expect(svc.status().error).toContain('Modifications non enregistrées');
    expect(svc.state()?.ratings).toHaveLength(1); // valeur optimiste encore affichée
    api.state.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.state).toHaveBeenCalledTimes(1);
    expect(api.changes).not.toHaveBeenCalled();
    expect(svc.state()?.ratings).toEqual([]);
    expect(svc.status().error).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.changes).toHaveBeenCalledTimes(1); // retour au fonctionnement normal
  });

  it('opération rejetée : rejected$ émet et l\'état est rechargé', async () => {
    api.sendOps.mockImplementationOnce(async (_id, ops) => ({
      seq: 6, results: [{ op_id: ops[0].op_id, result: 'rejected', reason: 'not_found' }],
    }));
    await svc.dispatch('set_rating', { point_id: 'p1', value: 4 });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe('not_found');
    expect(api.state).toHaveBeenCalledTimes(1);
    expect(notices).toEqual(['Une modification a été refusée (élément introuvable)']);
  });

  it('addPhoto appelle uploadPhoto puis changes', async () => {
    const calls: string[] = [];
    api.uploadPhoto.mockImplementation(async () => { calls.push('upload'); });
    api.changes.mockImplementation(async (_id, since) => { calls.push('changes'); return baseState(since + 1); });
    await svc.addPhoto('r1', new Blob(['x']));
    expect(calls).toEqual(['upload', 'changes']);
    const p = api.uploadPhoto.mock.calls[0][1] as { id: string; room_id: string | null; taken_at: string };
    expect(p.room_id).toBe('r1');
    expect(p.taken_at).toMatch(/[+-]\d\d:\d\d$/);
    expect(api.changes).toHaveBeenCalledWith(ID, 5);
    expect(svc.state()?.seq).toBe(6);
  });

  it('addPhoto en échec : message, rien en attente', async () => {
    api.uploadPhoto.mockRejectedValueOnce(new ApiError(500, 'disque plein'));
    await svc.addPhoto(null, new Blob(['x']));
    expect(notices).toEqual(['Photo non envoyée : disque plein']);
    expect(api.changes).not.toHaveBeenCalled();
    expect(svc.state()?.photos).toEqual([]);
    expect(svc.status().sending).toBe(false);
  });

  it('récupère les changements toutes les 5 s tant que la visite est ouverte', async () => {
    await vi.advanceTimersByTimeAsync(4999);
    expect(api.changes).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.changes).toHaveBeenCalledTimes(1);
    expect(api.changes).toHaveBeenCalledWith(ID, 5);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.changes).toHaveBeenCalledTimes(2);
    svc.close();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.changes).toHaveBeenCalledTimes(2);
  });

  it('une récupération en échec garde l\'état et affiche l\'erreur, puis réessaie', async () => {
    api.changes.mockRejectedValueOnce(new ApiError(0, 'Réseau indisponible'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(svc.status().error).toContain('Réseau indisponible');
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.changes).toHaveBeenCalledTimes(2);
    expect(svc.status().error).toBeNull();
  });

  it('404 de la récupération : annonce marquée supprimée, plus aucune récupération', async () => {
    api.changes.mockRejectedValue(new ApiError(404, 'annonce introuvable'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(TestBed.inject(CurrentListing).deleted()).toBe(true);
    expect(svc.status().error).toBeNull();
    await vi.advanceTimersByTimeAsync(20000);
    expect(api.changes).toHaveBeenCalledTimes(1);
  });

  it('dispatch sans visite ouverte échoue', async () => {
    svc.close();
    await expect(svc.dispatch('set_rating', { point_id: 'p1', value: 1 })).rejects.toThrow();
  });
});
