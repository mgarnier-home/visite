import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Dossier de données neuf pour chaque lancement. La configuration est aussi chargée par les
// processus de test : ils héritent de la variable posée ici par le processus principal.
process.env['E2E_DATA_DIR'] ??= mkdtempSync(join(tmpdir(), 'visite-e2e-'));
const dataDir = process.env['E2E_DATA_DIR'];
process.env['E2E_PHOTOS_DIR'] ??= join(dataDir, 'photos');

const port = 8099;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  globalTeardown: './e2e/global-teardown.ts',
  // la récupération des changements a lieu toutes les 5 s
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${port}`,
    // le service worker est désactivé : le hors-ligne repose sur la file IndexedDB de l'appli
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: '../bin/visite',
    url: `http://localhost:${port}/version`,
    reuseExistingServer: false,
    timeout: 30_000,
    stderr: 'ignore',
    env: {
      VISITE_SERVER_PORT: String(port),
      VISITE_DB_PATH: join(dataDir, 'visite.db'),
      VISITE_PHOTOS_DIR: process.env['E2E_PHOTOS_DIR'],
    },
  },
});
