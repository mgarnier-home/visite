import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ApiClient, ApiError } from '../../core/api.client';
import { PointType, SectionKind, Template, TemplateSection } from '../../core/api.types';
import { ConfirmDialog } from '../room/confirm.dialog';

const clone = <T>(value: T): T => structuredClone(value);

/** Éditeur du modèle de visite (écran 5) : sections, points, questions et liste « À emporter ». */
@Component({
  selector: 'app-template-page',
  imports: [
    CdkDrag, CdkDragHandle, CdkDropList, RouterLink, MatButtonModule, MatChipsModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule,
  ],
  templateUrl: './template.page.html',
  styleUrl: './template.page.scss',
})
export class TemplatePage implements OnInit {
  private readonly api = inject(ApiClient);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly kinds: { value: SectionKind; label: string }[] = [
    { value: 'room', label: 'Pièce' },
    { value: 'per_bedroom', label: 'Chambre (répétée)' },
    { value: 'topic', label: 'Thème' },
    { value: 'summary', label: 'Bilan' },
  ];
  protected readonly types: { value: PointType; label: string }[] = [
    { value: 'note', label: 'Note' },
    { value: 'case', label: 'Case' },
    { value: 'constat', label: 'Constat' },
  ];

  protected readonly loading = signal(true);
  protected readonly offline = signal(false);
  protected readonly loadError = signal(false);
  protected readonly saving = signal(false);
  private readonly loaded = signal<Template | null>(null);
  protected readonly draft = signal<Template | null>(null);

  protected readonly dirty = computed(() => {
    const draft = this.draft();
    const loaded = this.loaded();
    return draft !== null && loaded !== null && JSON.stringify(draft) !== JSON.stringify(loaded);
  });

  protected readonly valid = computed(() => {
    const draft = this.draft();
    if (!draft) return false;
    return draft.sections.every(
      (s) =>
        s.name.trim() !== '' &&
        s.questions.every((q) => q.text.trim() !== '') &&
        s.points.every(
          (p) =>
            p.label.trim() !== '' &&
            p.weight > 0 &&
            (p.type !== 'constat' || p.options.length > 0),
        ),
    );
  });

  protected readonly canSave = computed(() => this.dirty() && this.valid() && !this.saving());

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(false);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.offline.set(true);
      this.loading.set(false);
      return;
    }
    try {
      const template = await this.api.getTemplate();
      this.offline.set(false);
      this.loaded.set(clone(template));
      this.draft.set(clone(template));
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) this.offline.set(true);
      else this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Appliquée par le garde de sortie : confirme l'abandon des modifications non enregistrées. */
  async canLeave(): Promise<boolean> {
    if (!this.dirty()) return true;
    const ok = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: { title: 'Quitter sans enregistrer ?', message: 'Les modifications du modèle seront perdues.', confirmLabel: 'Quitter' },
        })
        .afterClosed(),
    );
    return ok === true;
  }

  private edit(change: (t: Template) => void): void {
    const next = clone(this.draft()!);
    change(next);
    this.draft.set(next);
  }

  protected setPackingList(value: string): void {
    this.edit((t) => (t.packing_list = value));
  }

  // --- sections ---
  protected addSection(): void {
    this.edit((t) =>
      t.sections.push({ id: crypto.randomUUID(), name: '', kind: 'room', position: t.sections.length, points: [], questions: [] }),
    );
  }

  protected setSectionName(si: number, name: string): void {
    this.edit((t) => (t.sections[si].name = name));
  }

  protected setSectionKind(si: number, kind: SectionKind): void {
    this.edit((t) => (t.sections[si].kind = kind));
  }

  protected async removeSection(si: number): Promise<void> {
    const section = this.draft()!.sections[si];
    const ok = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Supprimer la section ?',
            message: `« ${section.name || 'Sans nom'} » et son contenu seront supprimés du modèle.`,
            confirmLabel: 'Supprimer',
          },
        })
        .afterClosed(),
    );
    if (ok !== true) return;
    this.edit((t) => t.sections.splice(si, 1));
  }

  protected dropSection(event: CdkDragDrop<TemplateSection[]>): void {
    this.moveSection(event.previousIndex, event.currentIndex);
  }

  protected moveSection(from: number, to: number): void {
    this.edit((t) => moveItemInArray(t.sections, from, to));
  }

  // --- points ---
  protected addPoint(si: number): void {
    this.edit((t) => {
      const points = t.sections[si].points;
      points.push({ id: crypto.randomUUID(), label: '', type: 'note', options: [], weight: 1, position: points.length });
    });
  }

  protected setPointLabel(si: number, pi: number, label: string): void {
    this.edit((t) => (t.sections[si].points[pi].label = label));
  }

  protected setPointType(si: number, pi: number, type: PointType): void {
    this.edit((t) => {
      const point = t.sections[si].points[pi];
      point.type = type;
      if (type !== 'constat') point.options = [];
    });
  }

  protected setPointWeight(si: number, pi: number, raw: string): void {
    const weight = raw.trim() === '' ? 0 : Number(raw);
    this.edit((t) => (t.sections[si].points[pi].weight = Number.isFinite(weight) ? weight : 0));
  }

  protected addOption(si: number, pi: number, event: MatChipInputEvent): void {
    const option = event.value.trim();
    event.chipInput.clear();
    if (option === '') return;
    this.edit((t) => {
      const options = t.sections[si].points[pi].options;
      if (!options.includes(option)) options.push(option);
    });
  }

  protected removeOption(si: number, pi: number, oi: number): void {
    this.edit((t) => t.sections[si].points[pi].options.splice(oi, 1));
  }

  protected removePoint(si: number, pi: number): void {
    this.edit((t) => t.sections[si].points.splice(pi, 1));
  }

  protected dropPoint(si: number, event: CdkDragDrop<unknown>): void {
    this.movePoint(si, event.previousIndex, event.currentIndex);
  }

  protected movePoint(si: number, from: number, to: number): void {
    this.edit((t) => moveItemInArray(t.sections[si].points, from, to));
  }

  // --- questions ---
  protected addQuestion(si: number): void {
    this.edit((t) => {
      const questions = t.sections[si].questions;
      questions.push({ id: crypto.randomUUID(), text: '', position: questions.length });
    });
  }

  protected setQuestionText(si: number, qi: number, text: string): void {
    this.edit((t) => (t.sections[si].questions[qi].text = text));
  }

  protected removeQuestion(si: number, qi: number): void {
    this.edit((t) => t.sections[si].questions.splice(qi, 1));
  }

  protected dropQuestion(si: number, event: CdkDragDrop<unknown>): void {
    this.moveQuestion(si, event.previousIndex, event.currentIndex);
  }

  protected moveQuestion(si: number, from: number, to: number): void {
    this.edit((t) => moveItemInArray(t.sections[si].questions, from, to));
  }

  // --- enregistrement ---
  protected cancel(): void {
    this.draft.set(clone(this.loaded()!));
  }

  /** Copie à envoyer : positions recalculées de 0 à n, textes nettoyés. */
  private payload(): Template {
    const t = clone(this.draft()!);
    t.sections.forEach((s, si) => {
      s.position = si;
      s.name = s.name.trim();
      s.points.forEach((p, pi) => {
        p.position = pi;
        p.label = p.label.trim();
      });
      s.questions.forEach((q, qi) => {
        q.position = qi;
        q.text = q.text.trim();
      });
    });
    return t;
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    this.saving.set(true);
    try {
      const saved = await this.api.putTemplate(this.payload());
      this.loaded.set(clone(saved));
      this.draft.set(clone(saved));
      this.notify('Modèle enregistré');
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 409) {
        this.notify('Le modèle a été modifié ailleurs');
        await this.load();
      } else if (status === 400) {
        this.notify('Modèle invalide');
      } else if (status === 0) {
        this.notify('Il faut du réseau pour modifier le modèle');
      } else {
        this.notify('Impossible d\'enregistrer le modèle pour l\'instant');
      }
    } finally {
      this.saving.set(false);
    }
  }

  private notify(message: string): void {
    this.snack.open(message, undefined, { duration: 6000 });
  }
}
