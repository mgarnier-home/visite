import { Browser, BrowserContext, Locator, Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const KITCHEN = 'Cuisine';
const BRIGHTNESS = 'Luminosité';
const EQUIPPED = 'La cuisine est-elle vendue équipée ?';

let counter = 0;
/** Lien Leboncoin unique (saisie manuelle : aucun appel à un site externe). */
function uniqueLink(): string {
  return `https://www.leboncoin.fr/ad/ventes_immobilieres/${Date.now()}${++counter}`;
}

interface Participants {
  contextA: BrowserContext;
  contextB: BrowserContext;
  a: Page;
  b: Page;
  id: string;
}

/** Ajoute une annonce manuelle (prix 300000, 4 chambres) puis la vérifie, avec le statut de départ demandé. */
async function addListing(page: Page, link: string, planned = true): Promise<string> {
  await page.goto('/annonces/nouvelle');
  await page.locator('[data-test=text]').fill(`Maison à voir ${link}`);
  await page.locator('[data-test=submit]').click();
  await expect(page).toHaveURL(/\/annonces\/[^/]+\/verifier$/);
  const id = page.url().split('/').slice(-2)[0];
  await page.locator('[data-test=field-price_eur]').fill('300000');
  await page.locator('[data-test=field-bedrooms]').fill('4');
  if (planned) {
    await page.locator('[data-test=status-planned]').click();
    await page.locator('[data-test=date]').fill('25/12/2030');
    await page.locator('[data-test=time]').fill('1430');
    await page.locator('[data-test=time]').blur();
  }
  await page.locator('[data-test=save]').click();
  await expect(page).toHaveURL(new RegExp(`/annonces/${id}/annonce$`));
  return id;
}

/** Deux appareils (deux contextes, donc deux device_id) sur les pièces d'une annonce neuve. */
async function startVisit(browser: Browser): Promise<Participants> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const id = await addListing(a, uniqueLink());
  await a.goto(`/annonces/${id}/pieces`);
  await b.goto(`/annonces/${id}/pieces`);
  await expect(a.locator('[data-test=room]').first()).toBeVisible();
  await expect(b.locator('[data-test=room]').first()).toBeVisible();
  return { contextA, contextB, a, b, id };
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

test.describe('suivi des annonces', () => {
  test('add, verify, then listed under planned visits', async ({ page }) => {
    const id = await addListing(page, uniqueLink());
    await expect(page.locator('[data-test=price]')).toContainText('300');
    await page.goto('/');
    const group = page.locator('section.group').filter({ hasText: 'Visite planifiée' });
    await expect(group.locator('[data-test=card]')).toHaveCount(1);
    await expect(group.locator('[data-test=card]')).toHaveAttribute('href', `/annonces/${id}`);
  });

  test('the same link pasted twice is refused', async ({ page }) => {
    const link = uniqueLink();
    await addListing(page, link, false);
    await page.goto('/annonces/nouvelle');
    await page.locator('[data-test=text]').fill(link);
    await page.locator('[data-test=submit]').click();
    await expect(page.locator('[data-test=error]')).toContainText('Cette annonce est déjà suivie');
  });

  test('done status, edited room notes persist, then deletion', async ({ page }) => {
    const id = await addListing(page, uniqueLink());
    await page.getByRole('button', { name: 'Visite effectuée' }).click();
    await expect(page.getByRole('link', { name: 'Voir le bilan' })).toBeVisible();

    await page.goto(`/annonces/${id}/pieces`);
    await openRoom(page, KITCHEN);
    await sent(page, async () => {
      await page.locator('[data-test=room-notes]').fill('Plan de travail abîmé');
      await page.locator('[data-test=room-notes]').blur();
    });
    await page.reload();
    await expect(page.locator('[data-test=room-notes]')).toHaveValue('Plan de travail abîmé');

    await page.goto(`/annonces/${id}/annonce`);
    await page.getByRole('button', { name: 'Supprimer' }).click();
    await page.locator('[data-test=confirm]').click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator(`[data-test=card][href="/annonces/${id}"]`)).toHaveCount(0);
  });
});

test.describe('visite à deux participants', () => {
  let p: Participants;

  test.afterEach(async () => {
    await p?.contextA.close();
    await p?.contextB.close();
  });

  test('notes are hidden between participants', async ({ browser }) => {
    p = await startVisit(browser);
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
    await expect(a).toHaveURL(/\/pieces$/);
    await a.getByRole('tab', { name: 'Bilan' }).click();
    await expect(a).toHaveURL(/\/bilan$/);
    const downloadPromise = a.waitForEvent('download');
    await a.locator('[data-test=export]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${p.id}.csv`);
    const csv = readFileSync(await download.path(), 'utf8');
    const rows = csv.split(/\r?\n/).map((line) => line.split(';'));
    const header = rows[0];
    const row = rows.find((r) => r[1] === KITCHEN && r[2] === BRIGHTNESS);
    expect(row).toBeDefined();
    expect(row?.[header.indexOf('P1')]).toBe('5');
    expect(row?.[header.indexOf('P2')]).toBe('2');
  });

  test('shared answer propagates', async ({ browser }) => {
    p = await startVisit(browser);
    const { a, b } = p;
    await openRoom(a, KITCHEN);
    await openRoom(b, KITCHEN);

    const text = 'Oui, four et plaques de 2020';
    await sent(a, () => answer(a, EQUIPPED, text));

    const onB = question(b, EQUIPPED);
    await expect(onB.locator('[data-test=answer]')).toHaveValue(text, { timeout: 10_000 });
    await expect(onB.getByText('P1', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('shared room notes propagate', async ({ browser }) => {
    p = await startVisit(browser);
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
  });

  test('secondary questions stay hidden until shown', async ({ browser }) => {
    p = await startVisit(browser);
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
});
