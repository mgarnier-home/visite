import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../core/api.client';
import { Template } from '../../core/api.types';
import { provideAppIcons } from '../../shared/icons';
import { TemplatePage } from './template.page';

const makeTemplate = (version = 3): Template => ({
  version,
  packing_list: 'Mètre',
  sections: [
    {
      id: 's1', name: 'Cuisine', kind: 'room', position: 0,
      points: [{ id: 'p1', label: 'Hotte', type: 'note', options: [], weight: 1, position: 0 }],
      questions: [{ id: 'q1', text: 'Année ?', position: 0 }],
    },
    { id: 's2', name: 'Salon', kind: 'room', position: 1, points: [], questions: [] },
    { id: 's3', name: 'Jardin', kind: 'topic', position: 2, points: [], questions: [] },
  ],
});

describe('TemplatePage', () => {
  const api = { getTemplate: vi.fn(), putTemplate: vi.fn() };
  const snack = { open: vi.fn() };
  const dialog = { open: vi.fn() };
  let fixture: ComponentFixture<TemplatePage>;
  let loader: HarnessLoader;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(sel: string) => el().querySelector<T>(`[data-test=${sel}]`)!;
  const all = (sel: string) => Array.from(el().querySelectorAll<HTMLElement>(`[data-test=${sel}]`));

  async function settle() {
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function click(target: HTMLElement) {
    target.click();
    await settle();
  }
  async function type(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
    target.value = value;
    target.dispatchEvent(new Event('input'));
    await settle();
  }
  async function setup(template: Template | null = makeTemplate()) {
    if (template) api.getTemplate.mockResolvedValue(template);
    fixture = TestBed.createComponent(TemplatePage);
    loader = TestbedHarnessEnvironment.loader(fixture);
    fixture.detectChanges();
    await settle();
    return fixture;
  }
  const confirmDialog = (answer: boolean | undefined) =>
    dialog.open.mockReturnValue({ afterClosed: () => of(answer) });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [TemplatePage],
      providers: [
        provideRouter([]),
        provideAppIcons(),
        { provide: ApiClient, useValue: api },
        { provide: MatSnackBar, useValue: snack },
        { provide: MatDialog, useValue: dialog },
      ],
    });
  });

  it('enregistre en envoyant la version chargée puis adopte le modèle renvoyé', async () => {
    await setup();
    await type(q<HTMLTextAreaElement>('packing-list'), 'Mètre, lampe');
    expect(q<HTMLButtonElement>('save').disabled).toBe(false);
    api.putTemplate.mockResolvedValue({ ...makeTemplate(4), packing_list: 'Mètre, lampe' });
    await click(q('save'));
    expect(api.putTemplate).toHaveBeenCalledTimes(1);
    const body = api.putTemplate.mock.calls[0][0] as Template;
    expect(body.version).toBe(3);
    expect(body.packing_list).toBe('Mètre, lampe');
    expect(snack.open).toHaveBeenCalledWith('Modèle enregistré', undefined, expect.anything());
    expect(q<HTMLButtonElement>('save').disabled).toBe(true);
  });

  it('409 : affiche le message et recharge le modèle', async () => {
    await setup();
    await type(q<HTMLInputElement>('section-name'), 'Cuisine équipée');
    api.putTemplate.mockRejectedValue(new ApiError(409, 'conflict'));
    api.getTemplate.mockResolvedValue(makeTemplate(5));
    await click(q('save'));
    expect(snack.open).toHaveBeenCalledWith('Le modèle a été modifié ailleurs', undefined, expect.anything());
    expect(api.getTemplate).toHaveBeenCalledTimes(2);
    expect(q<HTMLInputElement>('section-name').value).toBe('Cuisine');
  });

  it('400 : affiche « Modèle invalide » et conserve les modifications', async () => {
    await setup();
    await type(q<HTMLInputElement>('section-name'), 'Cuisine équipée');
    api.putTemplate.mockRejectedValue(new ApiError(400, 'invalid'));
    await click(q('save'));
    expect(snack.open).toHaveBeenCalledWith('Modèle invalide', undefined, expect.anything());
    expect(api.getTemplate).toHaveBeenCalledTimes(1);
    expect(q<HTMLInputElement>('section-name').value).toBe('Cuisine équipée');
  });

  it('un constat sans option désactive « Enregistrer »', async () => {
    await setup();
    await click(q('point-add'));
    await type(all('point-label')[1] as HTMLInputElement, 'Type de sol');
    expect(q<HTMLButtonElement>('save').disabled).toBe(false);
    const selects = await loader.getAllHarnesses(MatSelectHarness.with({ selector: '[data-test=point-type]' }));
    await selects[1].clickOptions({ text: 'Constat' });
    await settle();
    expect(q<HTMLButtonElement>('save').disabled).toBe(true);
    expect(q('option-input')).toBeTruthy();
  });

  it('hors ligne : page désactivée', async () => {
    api.getTemplate.mockRejectedValue(new ApiError(0, 'réseau'));
    await setup(null);
    expect(el().textContent).toContain('Il faut du réseau pour modifier le modèle');
    expect(all('save').length).toBe(0);
  });

  it('descendre une section recalcule les positions de 0 à n dans le corps envoyé', async () => {
    await setup();
    await click(all('section-down')[0]);
    api.putTemplate.mockResolvedValue(makeTemplate(4));
    await click(q('save'));
    const body = api.putTemplate.mock.calls[0][0] as Template;
    expect(body.sections.map((s) => [s.id, s.position])).toEqual([['s2', 0], ['s1', 1], ['s3', 2]]);
  });

  it('supprimer une section (après confirmation) la retire du corps envoyé', async () => {
    await setup();
    confirmDialog(true);
    await click(all('section-remove')[1]);
    api.putTemplate.mockResolvedValue(makeTemplate(4));
    await click(q('save'));
    const body = api.putTemplate.mock.calls[0][0] as Template;
    expect(body.sections.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(body.sections[1].position).toBe(1);
  });

  it('refuser la confirmation conserve la section', async () => {
    await setup();
    confirmDialog(undefined);
    await click(all('section-remove')[1]);
    expect(all('section').length).toBe(3);
    expect(q<HTMLButtonElement>('save').disabled).toBe(true);
  });

  it('garde de sortie : confirme seulement s\'il y a des modifications', async () => {
    await setup();
    expect(await fixture.componentInstance.canLeave()).toBe(true);
    expect(dialog.open).not.toHaveBeenCalled();
    await type(q<HTMLInputElement>('section-name'), 'Autre');
    confirmDialog(false);
    expect(await fixture.componentInstance.canLeave()).toBe(false);
    expect(dialog.open.mock.calls[0][1].data.title).toBe('Quitter sans enregistrer ?');
    confirmDialog(true);
    expect(await fixture.componentInstance.canLeave()).toBe(true);
  });

  it('« Annuler les modifications » restaure la copie chargée', async () => {
    await setup();
    await type(q<HTMLInputElement>('section-name'), 'Autre');
    await click(q('cancel'));
    expect(q<HTMLInputElement>('section-name').value).toBe('Cuisine');
    expect(q<HTMLButtonElement>('save').disabled).toBe(true);
  });

  it('vider puis retaper le poids : pas de coercition à 0, le poids saisi part dans le PUT', async () => {
    const t = makeTemplate();
    t.sections[2] = { ...t.sections[2], kind: 'summary', points: [{ id: 'p9', label: 'Prix', type: 'note', options: [], weight: 1, position: 0 }] };
    await setup(t);
    const weight = q<HTMLInputElement>('point-weight');
    await type(weight, '');
    expect(weight.value).toBe('');
    expect(q('weight-error')).toBeTruthy();
    expect(q<HTMLButtonElement>('save').disabled).toBe(true);
    await type(weight, '2.5');
    expect(el().querySelector('[data-test=weight-error]')).toBeNull();
    api.putTemplate.mockResolvedValue(makeTemplate(4));
    await click(q('save'));
    const body = api.putTemplate.mock.calls[0][0] as Template;
    expect(body.sections[2].points[0].weight).toBe(2.5);
  });

  it('quitter le type Bilan remet les poids à 1 : plus de blocage invisible', async () => {
    const t = makeTemplate();
    t.sections[2] = { ...t.sections[2], kind: 'summary', points: [{ id: 'p9', label: 'Prix', type: 'note', options: [], weight: 1, position: 0 }] };
    await setup(t);
    await type(q<HTMLInputElement>('point-weight'), '0');
    expect(q<HTMLButtonElement>('save').disabled).toBe(true);
    const selects = await loader.getAllHarnesses(MatSelectHarness.with({ selector: '[data-test=section-kind]' }));
    await selects[2].clickOptions({ text: 'Thème' });
    await settle();
    expect(q<HTMLButtonElement>('save').disabled).toBe(false);
    api.putTemplate.mockResolvedValue(makeTemplate(4));
    await click(q('save'));
    expect((api.putTemplate.mock.calls[0][0] as Template).sections[2].points[0].weight).toBe(1);
  });

  it('les champs sont désactivés pendant l\'enregistrement', async () => {
    await setup();
    await type(q<HTMLInputElement>('section-name'), 'Autre');
    let release!: (t: Template) => void;
    api.putTemplate.mockReturnValue(new Promise<Template>((r) => (release = r)));
    q('save').click();
    fixture.detectChanges();
    expect(q<HTMLInputElement>('section-name').disabled).toBe(true);
    release(makeTemplate(4));
    await settle();
    expect(q<HTMLInputElement>('section-name').disabled).toBe(false);
  });

  describe('saisie de poids invalide puis suppression', () => {
    async function withInvalidWeight() {
      const t = makeTemplate();
      t.sections[2] = { ...t.sections[2], kind: 'summary', points: [{ id: 'p9', label: 'Prix', type: 'note', options: [], weight: 1, position: 0 }] };
      await setup(t);
      await type(q<HTMLInputElement>('point-weight'), '');
      expect(q<HTMLButtonElement>('save').disabled).toBe(true);
    }

    it('supprimer le point débloque « Enregistrer »', async () => {
      await withInvalidWeight();
      await click(all('point-remove')[1]);
      expect(q<HTMLButtonElement>('save').disabled).toBe(false);
    });

    it('supprimer la section débloque « Enregistrer »', async () => {
      await withInvalidWeight();
      confirmDialog(true);
      await click(all('section-remove')[2]);
      expect(q<HTMLButtonElement>('save').disabled).toBe(false);
    });
  });
});
