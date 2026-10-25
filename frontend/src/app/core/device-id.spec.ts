import { db } from './db';
import { getDeviceId, resetDeviceIdCache } from './device-id';

describe('getDeviceId', () => {
  beforeEach(async () => {
    await db.meta.clear();
    resetDeviceIdCache();
  });

  it('crée un UUID et le persiste dans meta', async () => {
    const id = await getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await db.meta.get('device_id'))?.value).toBe(id);
  });

  it('relit l’identifiant existant', async () => {
    await db.meta.put({ key: 'device_id', value: 'existant' });
    expect(await getDeviceId()).toBe('existant');
  });

  it('appels concurrents : même identifiant', async () => {
    const ids = await Promise.all([getDeviceId(), getDeviceId(), getDeviceId()]);
    expect(new Set(ids).size).toBe(1);
  });
});
