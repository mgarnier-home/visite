import { rmSync } from 'node:fs';

/** Supprime le dossier de données temporaire créé par la configuration. */
export default function globalTeardown(): void {
  const dir = process.env['E2E_DATA_DIR'];
  if (dir) rmSync(dir, { recursive: true, force: true });
}
