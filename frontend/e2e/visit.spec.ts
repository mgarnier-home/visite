import { Browser, BrowserContext, Locator, Page, expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PHOTO = join(__dirname, 'fixtures', 'photo.jpg');
const PHOTOS_DIR = process.env['E2E_PHOTOS_DIR'] ?? '';

const KITCHEN = 'Cuisine';
const BRIGHTNESS = 'Luminosité';
const WATER = "Pression d'eau et temps d'arrivée de l'eau chaude";
const EQUIPPED = 'La cuisine est-elle vendue équipée ?';
const REDONE = 'La cuisine a-t-elle été refaite ?';

let counter = 0;
/** Code de visite unique pour chaque test. */
function uniqueCode(): string {
  return `e2e-${Date.now()}-${++counter}`;
}

interface Participants {
  contextA: BrowserContext;
  contextB: BrowserContext;
  a: Page;
  b: Page;
}

/** Deux appareils : A crée la visite, B la rejoint par l'accueil. */
async function startVisit(browser: Browser, code: string): Promise<Participants> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await createVisit(a, code);
  await joinVisit(b, code);
  return { contextA, contextB, a, b };
}

async function createVisit(page: Page, code: string, excludedRooms: string[] = []): Promise<void> {
  await page.goto('/new');
  await page.locator('[data-test=code]').fill(code);
  await expect(page.getByText('Code disponible')).toBeVisible();
  await page.locator('[data-test=address]').fill(`12 rue des Tests (${code})`);
  // les cases des pièces apparaissent une fois le modèle chargé, toutes cochées
  await expect(page.locator('[data-test=room-option]').first()).toBeVisible();
  for (const name of excludedRooms) {
    await page.getByRole('checkbox', { name, exact: true }).uncheck();
  }
  await page.locator('[data-test=submit]').click();
  await expect(page).toHaveURL(new RegExp(`/v/${code}/rooms$`));
}

async function joinVisit(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Code de la visite').fill(code);
  await page.locator('[data-test=join]').click();
  await expect(page).toHaveURL(new RegExp(`/v/${code}/rooms$`));
}

async function openRoom(page: Page, name: string): Promise<void> {
  await page.locator('[data-test=room]').filter({ hasText: name }).click();
  await expect(page.locator('[data-test=room-name]')).toHaveText(name);
}

function pointCard(page: Page, label: string): Locator {
  return page
    .locator('app-point-card')
    .filter({ has: page.locator('[data-test=label]').getByText(label, { exact: true }) });
}

function choice(card: Locator, label: string): Locator {
  return card.locator('[data-test=choice]').getByText(label, { exact: true });
}

function question(page: Page, text: string): Locator {
  return page.locator('article.question').filter({ hasText: text });
}

function syncLabel(page: Page): Locator {
  return page.locator('[data-test=sync-label]');
}

/** Attend l'acquittement par le serveur de l'envoi d'opérations déclenché par `action`. */
async function sent(page: Page, action: () => Promise<void>): Promise<void> {
  const response = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/ops') && r.ok(),
  );
  await action();
  await response;
}

/** Attend une récupération des changements commencée après cet appel. */
async function nextPull(page: Page): Promise<void> {
  const request = await page.waitForRequest((r) => r.url().includes('/changes'));
  const response = await request.response();
  expect(response?.ok()).toBe(true);
}

async function answer(page: Page, questionText: string, text: string): Promise<void> {
  const field = question(page, questionText).locator('[data-test=answer]');
  await field.fill(text);
  await field.blur();
}

test.describe('visite à deux participants', () => {
  let p: Participants;

  test.afterEach(async () => {
    await p?.contextA.close();
    await p?.contextB.close();
  });

  test('notes are hidden between participants', async ({ browser }) => {
    const code = uniqueCode();
    p = await startVisit(browser, code);
    const { a, b } = p;
    await openRoom(a, KITCHEN);
    await openRoom(b, KITCHEN);

    await sent(a, () => choice(pointCard(a, BRIGHTNESS), '5').click());
    await sent(b, () => choice(pointCard(b, BRIGHTNESS), '2').click());

    // une récupération postérieure aux deux envois ne fait pas apparaître la note de l'autre
    await Promise.all([nextPull(a), nextPull(b)]);
    const cardA = pointCard(a, BRIGHTNESS);
    const cardB = pointCard(b, BRIGHTNESS);
    await expect(choice(cardA, '5')).toHaveAttribute('aria-pressed', 'true');
    await expect(cardA.locator('[data-test=choice][aria-pressed=true]')).toHaveCount(1);
    await expect(choice(cardB, '2')).toHaveAttribute('aria-pressed', 'true');
    await expect(cardB.locator('[data-test=choice][aria-pressed=true]')).toHaveCount(1);

    await a.locator('[data-test=back]').click();
    await a.getByRole('tab', { name: 'Bilan' }).click();
    const downloadPromise = a.waitForEvent('download');
    await a.locator('[data-test=export]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${code}.csv`);
    const csv = readFileSync(await download.path(), 'utf8');
    const rows = csv.split(/\r?\n/).map((line) => line.split(';'));
    const header = rows[0];
    const row = rows.find((r) => r[1] === KITCHEN && r[2] === BRIGHTNESS);
    expect(row).toBeDefined();
    expect(row?.[header.indexOf('P1')]).toBe('5');
    expect(row?.[header.indexOf('P2')]).toBe('2');
  });

  test('shared answer propagates', async ({ browser }) => {
    p = await startVisit(browser, uniqueCode());
    const { a, b } = p;
    await openRoom(a, KITCHEN);
    await openRoom(b, KITCHEN);

    const text = 'Oui, four et plaques de 2020';
    await sent(a, () => answer(a, EQUIPPED, text));

    const onB = question(b, EQUIPPED);
    await expect(onB.locator('[data-test=answer]')).toHaveValue(text, { timeout: 10_000 });
    await expect(onB.getByText('P1', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('shared notes propagate, on a room and on the visit', async ({ browser }) => {
    p = await startVisit(browser, uniqueCode());
    const { a, b } = p;
    await openRoom(a, KITCHEN);
    await openRoom(b, KITCHEN);

    const roomNotes = 'Hotte à changer';
    await sent(a, async () => {
      await a.locator('[data-test=room-notes]').fill(roomNotes);
      await a.locator('[data-test=room-notes]').blur();
    });
    await expect(b.locator('[data-test=room-notes]')).toHaveValue(roomNotes, { timeout: 10_000 });
    await expect(b.locator('[data-test=room-notes-author]')).toHaveText('P1', { timeout: 10_000 });

    // B n'a pas créé la visite : seules les notes de la fiche lui sont modifiables.
    await a.getByRole('tab', { name: 'Fiche' }).click();
    await b.getByRole('tab', { name: 'Fiche' }).click();
    const visitNotes = 'Demander les diagnostics à l\'agent';
    await sent(b, async () => {
      await b.locator('[data-test=visit-notes]').fill(visitNotes);
      await b.locator('[data-test=visit-notes]').blur();
    });
    await expect(a.locator('[data-test=visit-notes]')).toHaveValue(visitNotes, { timeout: 10_000 });
    await expect(a.locator('[data-test=visit-notes-author]')).toHaveText('P2', { timeout: 10_000 });
  });

  test('secondary questions are shown below the toggle, even answered ones stay hidden until shown', async ({ browser }) => {
    p = await startVisit(browser, uniqueCode());
    const { a, b } = p;
    const OPEN_KITCHEN = 'Peut-on ouvrir la cuisine sur le séjour';
    await openRoom(a, KITCHEN);
    await openRoom(b, KITCHEN);

    await expect(question(a, EQUIPPED)).toBeVisible();
    await expect(question(a, OPEN_KITCHEN)).toHaveCount(0);
    await expect(a.locator('[data-test=area]')).toHaveCount(0);
    await a.locator('[data-test=toggle-secondary]').click();
    await expect(a.locator('[data-test=area]')).toBeVisible();
    await sent(a, () => answer(a, OPEN_KITCHEN, 'Non, mur porteur'));

    // répondue par A, elle reste masquée chez B tant qu'il n'affiche pas les questions secondaires :
    // trois points, deux questions et la surface
    const toggleB = b.locator('[data-test=toggle-secondary]');
    await expect(toggleB).toHaveText('Afficher les questions secondaires (6)');
    await nextPull(b);
    await expect(question(b, OPEN_KITCHEN)).toHaveCount(0);
    await toggleB.click();
    await expect(question(b, OPEN_KITCHEN).locator('[data-test=answer]')).toHaveValue('Non, mur porteur', { timeout: 10_000 });
  });

  test('offline edits sync on reconnect', async ({ browser }) => {
    p = await startVisit(browser, uniqueCode());
    const { a, b, contextB } = p;
    await openRoom(a, KITCHEN);
    await openRoom(b, KITCHEN);

    await contextB.setOffline(true);
    await expect(syncLabel(b)).toHaveText('Hors ligne');
    await choice(pointCard(b, WATER), 'OK').click();
    const text = 'Oui, en 2019, factures disponibles';
    await answer(b, REDONE, text);
    await expect(b.locator('[data-test=sync-pending]')).toHaveText(
      '2 modifications et 0 photo en attente',
    );

    await contextB.setOffline(false);
    await expect(syncLabel(b)).toHaveText('Synchronisé');

    const water = pointCard(a, WATER);
    await expect(choice(water, 'OK')).toHaveAttribute('aria-pressed', 'true');
    await expect(water.locator('[data-test=author]')).toHaveText('P2');
    await expect(question(a, REDONE).locator('[data-test=answer]')).toHaveValue(text);
  });

  test('offline photo uploads later', async ({ browser }) => {
    const code = uniqueCode();
    p = await startVisit(browser, code);
    const { b, contextB } = p;
    await openRoom(b, KITCHEN);

    await contextB.setOffline(true);
    await expect(syncLabel(b)).toHaveText('Hors ligne');
    await b.locator('[data-test=photo-input]').setInputFiles(PHOTO);
    await expect(b.locator('[data-test=sync-pending]')).toHaveText(
      '0 modification et 1 photo en attente',
    );
    await expect(b.locator('[data-test=thumb]')).toHaveCount(1);

    await contextB.setOffline(false);
    await expect(syncLabel(b)).toHaveText('Synchronisé');

    const dir = join(PHOTOS_DIR, code, 'cuisine');
    const files = () => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    };
    await expect.poll(files).toHaveLength(1);
    expect(files()[0]).toMatch(/^\d{8}-\d{6}-[0-9a-f]{8}\.jpg$/);
  });

  test('rooms can be excluded at creation', async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    p = { contextA, contextB, a: await contextA.newPage(), b: await contextB.newPage() };
    const { a } = p;
    await createVisit(a, uniqueCode(), ['Garage']);

    const rooms = a.locator('[data-test=room]');
    await expect(rooms.filter({ hasText: 'Cuisine' })).toBeVisible();
    await expect(rooms.filter({ hasText: 'Garage' })).toHaveCount(0);
    const other = rooms.filter({ hasText: 'Autres questions' });
    await expect(other.locator('[data-test=progress]')).toHaveText('0 / 3 posées');
    const general = rooms.filter({ hasText: 'Questions générales' });
    await expect(general.locator('[data-test=progress]')).toHaveText('0 / 15 posées');

    await openRoom(a, 'Autres questions');
    await expect(question(a, 'Garage : La fibre est-elle raccordée ?')).toBeVisible();
  });

  test('closed visit is read-only', async ({ browser }) => {
    p = await startVisit(browser, uniqueCode());
    const { a, b } = p;
    await openRoom(b, KITCHEN);

    await a.getByRole('tab', { name: 'Bilan' }).click();
    await sent(a, async () => {
      await a.locator('[data-test=close]').click();
      await a.locator('[data-test=confirm]').click();
    });
    await expect(a.locator('[data-test=closed-banner]')).toBeVisible();

    await expect(b.locator('[data-test=closed-banner]')).toBeVisible();
    for (const selector of ['rename', 'add-point', 'add-question', 'hide', 'photo-btn']) {
      await expect(b.locator(`[data-test=${selector}]`)).toBeDisabled();
    }
    const choices = b.locator('[data-test=choice]');
    expect(await choices.count()).toBeGreaterThan(0);
    for (const c of await choices.all()) await expect(c).toBeDisabled();
    await expect(b.locator('[data-test=answer]').first()).toBeDisabled();
    await expect(b.locator('[data-test=comment]')).toBeDisabled();
    await expect(b.locator('[data-test=room-notes]')).toBeDisabled();
  });
});
