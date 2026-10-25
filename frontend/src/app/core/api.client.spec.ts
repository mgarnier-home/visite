import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiClient, ApiError } from './api.client';
import { db } from './db';
import { Fiche, Op } from './api.types';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('ApiClient', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(async () => {
    await db.meta.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function expectReq(url: string) {
    // l'identité est lue en asynchrone avant l'envoi de la requête
    for (let i = 0; i < 50; i++) {
      const found = http.match((r) => r.url === url);
      if (found.length) return found[0];
      await flush();
    }
    throw new Error('aucune requête vers ' + url);
  }

  it('ajoute X-Device-Id', async () => {
    const p = api.exists('abc');
    const req = await expectReq('/api/visits/abc/exists');
    expect(req.request.headers.get('X-Device-Id')).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({ exists: true });
    expect(await p).toEqual({ exists: true });
  });

  it('convertit un 409 en ApiError avec le message du corps', async () => {
    const p = api.create({ code: 'abc', fiche: {} as Fiche });
    const req = await expectReq('/api/visits');
    req.flush({ error: 'code déjà pris' }, { status: 409, statusText: 'Conflict' });
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('code déjà pris');
  });

  it('status 0 pour une erreur réseau', async () => {
    const p = api.state('abc');
    const req = await expectReq('/api/visits/abc');
    req.error(new ProgressEvent('error'));
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it('sendOps poste {ops}', async () => {
    const ops: Op[] = [{ op_id: 'o1', type: 'close_visit', client_ts: 1, payload: {} }];
    const p = api.sendOps('abc', ops);
    const req = await expectReq('/api/visits/abc/ops');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ops });
    req.flush({ seq: 3, results: [] });
    expect((await p).seq).toBe(3);
  });

  it('changes passe since', async () => {
    const p = api.changes('abc', 7);
    const req = await expectReq('/api/visits/abc/changes');
    expect(req.request.params.get('since')).toBe('7');
    req.flush({});
    await p;
  });

  it('exportCsv: ?sep=tab seulement pour tab, réponse blob', async () => {
    const p = api.exportCsv('abc', 'tab');
    const req = await expectReq('/api/visits/abc/export.csv');
    expect(req.request.params.get('sep')).toBe('tab');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
    expect((await p).size).toBe(1);

    const p2 = api.exportCsv('abc', 'semicolon');
    const req2 = await expectReq('/api/visits/abc/export.csv');
    expect(req2.request.params.has('sep')).toBe(false);
    req2.flush(new Blob(['y']));
    await p2;
  });

  it('uploadPhoto envoie un multipart complet (room_id vide pour global)', async () => {
    const p = api.uploadPhoto('abc', {
      id: 'p1', room_id: null, taken_at: '2026-10-25T14:35:20+02:00', blob: new Blob(['j'], { type: 'image/jpeg' }),
    });
    const req = await expectReq('/api/visits/abc/photos');
    const fd = req.request.body as FormData;
    expect(fd.get('id')).toBe('p1');
    expect(fd.get('room_id')).toBe('');
    expect(fd.get('taken_at')).toBe('2026-10-25T14:35:20+02:00');
    expect((fd.get('file') as File).name).toBe('p1.jpg');
    req.flush(null, { status: 201, statusText: 'Created' });
    await p;
  });

  it('photoUrl contient ?d=', () => {
    expect(api.photoUrl('abc', 'p 1', 'dev')).toBe('/api/visits/abc/photos/p%201?d=dev');
  });

  it('getTemplate / putTemplate', async () => {
    const p = api.getTemplate();
    (await expectReq('/api/template')).flush({ version: 1, packing_list: '', sections: [] });
    expect((await p).version).toBe(1);
    const p2 = api.putTemplate({ version: 2, packing_list: '', sections: [] });
    const r = await expectReq('/api/template');
    expect(r.request.method).toBe('PUT');
    r.flush({ version: 2, packing_list: '', sections: [] });
    await p2;
  });
});
