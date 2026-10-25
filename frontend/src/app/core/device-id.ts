import { db } from './db';

const KEY = 'device_id';
let cached: Promise<string> | null = null;

async function loadOrCreate(): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const row = await db.meta.get(KEY);
    if (typeof row?.value === 'string') return row.value;
    const id = crypto.randomUUID();
    await db.meta.put({ key: KEY, value: id });
    return id;
  });
}

/** Identifiant stable de l'appareil ; les appels concurrents partagent la même promesse. */
export function getDeviceId(): Promise<string> {
  if (!cached) {
    cached = loadOrCreate().catch((e) => {
      cached = null; // permet une nouvelle tentative après un échec
      throw e;
    });
  }
  return cached;
}

/** Réservé aux tests. */
export function resetDeviceIdCache(): void {
  cached = null;
}
