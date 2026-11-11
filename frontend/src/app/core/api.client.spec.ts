import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiClient, ApiError } from './api.client';
import { Op } from './api.types';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('ApiClient', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  async function expectReq(url: string) {
    // la requête part après un tour de boucle (appel asynchrone)
    for (let i = 0; i < 50; i++) {
      const found = http.match((r) => r.url === url);
      if (found.length) return found[0];
      await flush();
    }
    throw new Error('aucune requête vers ' + url);
  }

  it('ajoute X-Device-Id', async () => {
    const p = api.getListing('l1');
    const req = await expectReq('/api/listings/l1');
    expect(req.request.headers.get('X-Device-Id')).toMatch(/^[0-9a-f-]{36}$/);
    req.flush({ id: 'l1' });
    expect((await p).id).toBe('l1');
  });

  it('convertit un 409 en ApiError avec le message et le corps (id du doublon)', async () => {
    const p = api.createListing('https://x');
    const req = await expectReq('/api/listings');
    expect(req.request.body).toEqual({ text: 'https://x' });
    req.flush({ id: 'l9', error: 'annonce déjà suivie' }, { status: 409, statusText: 'Conflict' });
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('annonce déjà suivie');
    expect(err.body).toEqual({ id: 'l9', error: 'annonce déjà suivie' });
  });

  it('listings : liste, patch, refresh, suppression, URL de photo', async () => {
    const p = api.listListings();
    (await expectReq('/api/listings')).flush([]);
    expect(await p).toEqual([]);

    const p2 = api.patchListing('l 1', { notes: 'n' });
    const r2 = await expectReq('/api/listings/l%201');
    expect(r2.request.method).toBe('PATCH');
    expect(r2.request.body).toEqual({ notes: 'n' });
    r2.flush({ id: 'l 1' });
    await p2;

    const p3 = api.refreshListing('l1');
    const r3 = await expectReq('/api/listings/l1/refresh');
    expect(r3.request.method).toBe('POST');
    r3.flush({ id: 'l1' });
    await p3;

    const p4 = api.deleteListing('l1');
    const r4 = await expectReq('/api/listings/l1');
    expect(r4.request.method).toBe('DELETE');
    r4.flush(null, { status: 204, statusText: 'No Content' });
    expect(await p4).toBeUndefined();

    expect(api.listingPhotoUrl('l1', 'p 1')).toBe('/api/listings/l1/photos/p%201');
  });

  it('status 0 pour une erreur réseau', async () => {
    const p = api.state('abc');
    const req = await expectReq('/api/listings/abc/visit');
    req.error(new ProgressEvent('error'));
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it('sendOps poste {ops}', async () => {
    const ops: Op[] = [{ op_id: 'o1', type: 'set_rating', client_ts: 1, payload: {} }];
    const p = api.sendOps('abc', ops);
    const req = await expectReq('/api/listings/abc/visit/ops');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ops });
    req.flush({ seq: 3, results: [] });
    expect((await p).seq).toBe(3);
  });

  it('changes passe since', async () => {
    const p = api.changes('abc', 7);
    const req = await expectReq('/api/listings/abc/visit/changes');
    expect(req.request.params.get('since')).toBe('7');
    req.flush({});
    await p;
  });

  it('exportCsv: ?sep=tab seulement pour tab, réponse blob', async () => {
    const p = api.exportCsv('abc', 'tab');
    const req = await expectReq('/api/listings/abc/visit/export.csv');
    expect(req.request.params.get('sep')).toBe('tab');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
    expect((await p).size).toBe(1);

    const p2 = api.exportCsv('abc', 'semicolon');
    const req2 = await expectReq('/api/listings/abc/visit/export.csv');
    expect(req2.request.params.has('sep')).toBe(false);
    req2.flush(new Blob(['y']));
    await p2;
  });

  it('uploadPhoto envoie un multipart complet (room_id vide pour global)', async () => {
    const p = api.uploadPhoto('abc', {
      id: 'p1', room_id: null, taken_at: '2026-10-25T14:35:20+02:00', blob: new Blob(['j'], { type: 'image/jpeg' }),
    });
    const req = await expectReq('/api/listings/abc/visit/photos');
    const fd = req.request.body as FormData;
    expect(fd.get('id')).toBe('p1');
    expect(fd.get('room_id')).toBe('');
    expect(fd.get('taken_at')).toBe('2026-10-25T14:35:20+02:00');
    expect((fd.get('file') as File).name).toBe('p1.jpg');
    req.flush(null, { status: 201, statusText: 'Created' });
    await p;
  });

  it('photoUrl contient ?d=', () => {
    expect(api.photoUrl('abc', 'p 1', 'dev')).toBe('/api/listings/abc/visit/photos/p%201?d=dev');
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
