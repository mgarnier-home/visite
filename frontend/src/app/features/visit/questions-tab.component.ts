import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { onPageHidden } from '../../core/page-hidden';
import { SyncService } from '../../core/sync.service';

/** Questions des pièces visibles, groupées par pièce. */
@Component({
  selector: 'app-questions-tab',
  imports: [MatCheckboxModule, MatSlideToggleModule],
  templateUrl: './questions-tab.component.html',
  styleUrl: './questions-tab.component.scss',
})
export class QuestionsTabComponent {
  private readonly sync = inject(SyncService);
  private readonly snack = inject(MatSnackBar);

  private readonly state = this.sync.state;
  protected readonly closed = computed(() => !!this.state()?.visit.closed_at);
  protected readonly unaskedOnly = signal(false);
  /** Réponses saisies pas encore enregistrées, par identifiant de question. */
  private readonly drafts = signal<Readonly<Record<string, string>>>({});

  private readonly all = computed(() => {
    const s = this.state();
    if (!s) return [];
    const asked = new Map<string, boolean>();
    const answers = new Map<string, string>();
    for (const v of s.shared) {
      if (v.field === 'asked') asked.set(v.target_id, v.value === true);
      else if (v.field === 'answer') answers.set(v.target_id, typeof v.value === 'string' ? v.value : '');
    }
    return s.rooms
      .filter((r) => !r.hidden)
      .sort((a, b) => a.position - b.position)
      .map((room) => ({
        room,
        questions: s.questions
          .filter((q) => q.room_id === room.id)
          .sort((a, b) => a.position - b.position)
          .map((question) => ({
            question,
            asked: asked.get(question.id) === true,
            answer: answers.get(question.id) ?? '',
          })),
      }))
      .filter((g) => g.questions.length > 0);
  });

  protected readonly total = computed(() => this.all().reduce((n, g) => n + g.questions.length, 0));

  protected readonly groups = computed(() => {
    if (!this.unaskedOnly()) return this.all();
    return this.all()
      .map((g) => ({ room: g.room, questions: g.questions.filter((q) => !q.asked) }))
      .filter((g) => g.questions.length > 0);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => void this.flush());
    onPageHidden(() => void this.flush());
  }

  /** Brouillon s'il existe (la synchro ne l'écrase pas), sinon la réponse de l'état. */
  protected shown(id: string, fromState: string): string {
    return this.drafts()[id] ?? fromState;
  }

  protected onInput(id: string, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.drafts.update((d) => ({ ...d, [id]: value }));
  }

  protected onBlur(id: string, event: Event): Promise<void> {
    if (!(id in this.drafts())) {
      const value = (event.target as HTMLTextAreaElement).value;
      this.drafts.update((d) => ({ ...d, [id]: value }));
    }
    return this.flushOne(id);
  }

  protected setAsked(id: string, asked: boolean): Promise<boolean> {
    return this.setShared(id, 'asked', asked);
  }

  private async setShared(id: string, field: 'asked' | 'answer', value: boolean | string): Promise<boolean> {
    try {
      await this.sync.dispatch('set_shared', { target_id: id, field, value });
      return true;
    } catch {
      this.snack.open('Modification non enregistrée', 'OK', { duration: 5000 });
      return false;
    }
  }

  /** Enregistre le brouillon s'il diffère de l'état, puis l'efface ; gardé si l'enregistrement échoue. */
  private async flushOne(id: string): Promise<void> {
    const text = this.drafts()[id];
    if (text === undefined) return;
    const current = this.state()?.shared.find((v) => v.target_id === id && v.field === 'answer')?.value;
    if (text !== (typeof current === 'string' ? current : '') && !(await this.setShared(id, 'answer', text))) return;
    if (this.drafts()[id] === text) {
      this.drafts.update((d) => {
        const { [id]: _removed, ...rest } = d;
        return rest;
      });
    }
  }

  private flush(): Promise<unknown> {
    return Promise.all(Object.keys(this.drafts()).map((id) => this.flushOne(id)));
  }
}
