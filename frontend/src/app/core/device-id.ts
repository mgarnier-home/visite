const KEY = 'device_id';
let memory: string | null = null;

/** Identifiant stable de l'appareil, gardé dans localStorage (en mémoire si le stockage est refusé). */
export function getDeviceId(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved;
    const id = memory ?? crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return (memory ??= crypto.randomUUID());
  }
}
