import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom, map } from 'rxjs';
import { ApiClient } from '../../core/api.client';
import { OpType, SharedField } from '../../core/api.types';
import { getDeviceId } from '../../core/device-id';
import { LocalStore } from '../../core/local-store';
import { SyncService } from '../../core/sync.service';
import { PhotoButtonComponent, photoErrorMessage } from '../../shared/photo-button.component';
import { AddPointDialog } from './add-point.dialog';
import { AddQuestionDialog } from './add-question.dialog';
import { ConfirmDialog } from './confirm.dialog';
import { PointCardComponent } from './point-card.component';

type SharedMap = Partial<Record<SharedField, unknown>>;
type AuthorMap = Partial<Record<SharedField, number>>;

/** Écran d'une pièce : points, questions, commentaire privé et photos. */
@Component({
  selector: 'app-room-page',
  imports: [RouterLink, MatButtonModule, MatCheckboxModule, MatIconModule, PhotoButtonComponent, PointCardComponent],
  templateUrl: './room.page.html',
  styleUrl: './room.page.scss',
})
export class RoomPage {
  private readonly sync = inject(SyncService);
  private readonly api = inject(ApiClient);
  private readonly store = inject(LocalStore);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly state = this.sync.state;
  // la page est réutilisée quand seule la pièce change : on lit les paramètres de façon réactive
  protected readonly roomId = toSignal(this.route.paramMap.pipe(map((p) => p.get('roomId') ?? '')), { initialValue: '' });
  private readonly parentCode = toSignal(
    (this.route.parent ?? this.route).paramMap.pipe(map((p) => p.get('code') ?? '')),
    { initialValue: '' },
  );
  protected readonly code = computed(() => this.parentCode() || this.state()?.visit.code || '');
  protected readonly closed = computed(() => !!this.state()?.visit.closed_at);

  private readonly visibleRooms = computed(() =>
    (this.state()?.rooms ?? []).filter((r) => !r.hidden).sort((a, b) => a.position - b.position),
  );
  protected readonly room = computed(() => this.visibleRooms().find((r) => r.id === this.roomId()) ?? null);
  private readonly index = computed(() => this.visibleRooms().findIndex((r) => r.id === this.roomId()));
  private readonly prevRoom = computed(() => (this.index() > 0 ? this.visibleRooms()[this.index() - 1] : null));
  private readonly nextRoom = computed(() => {
    const i = this.index();
    return i >= 0 ? (this.visibleRooms()[i + 1] ?? null) : null;
  });
  protected readonly hasPrev = computed(() => this.prevRoom() !== null);
  protected readonly hasNext = computed(() => this.nextRoom() !== null);

  /** Valeurs partagées et auteurs, par cible (point, question ou pièce). */
  private readonly sharedByTarget = computed(() => {
    const values = new Map<string, SharedMap>();
    const authors = new Map<string, AuthorMap>();
    for (const v of this.state()?.shared ?? []) {
      values.set(v.target_id, { ...values.get(v.target_id), [v.field]: v.value });
      authors.set(v.target_id, { ...authors.get(v.target_id), [v.field]: v.author });
    }
    return { values, authors };
  });

  protected readonly points = computed(() => {
    const s = this.state();
    const id = this.roomId();
    if (!s) return [];
    const ratings = new Map(s.ratings.map((r) => [r.point_id, r.value]));
    const { values, authors } = this.sharedByTarget();
    return s.points
      .filter((p) => p.room_id === id)
      .sort((a, b) => a.position - b.position)
      .map((point) => ({
        point,
        rating: ratings.has(point.id) ? (ratings.get(point.id) as number | null) : undefined,
        shared: values.get(point.id) ?? {},
        authors: authors.get(point.id) ?? {},
      }));
  });

  protected readonly questions = computed(() => {
    const s = this.state();
    const id = this.roomId();
    if (!s) return [];
    const { values } = this.sharedByTarget();
    return s.questions
      .filter((q) => q.room_id === id)
      .sort((a, b) => a.position - b.position)
      .map((question) => {
        const shared = values.get(question.id) ?? {};
        return {
          question,
          asked: shared['asked'] === true,
          answer: typeof shared['answer'] === 'string' ? shared['answer'] : '',
        };
      });
  });

  protected readonly comment = computed(
    () => this.state()?.comments.find((c) => c.room_id === this.roomId())?.text ?? '',
  );
  protected readonly area = computed<number | null>(() => {
    const v = this.sharedByTarget().values.get(this.roomId())?.['area_m2'];
    return typeof v === 'number' ? v : null;
  });

  // --- renommage
  protected readonly renaming = signal(false);
  protected readonly draftName = signal('');

  // --- photos
  private readonly deviceId = signal('');
  /** URL d'objet des photos encore en file d'envoi, par identifiant. */
  private pendingUrls = new Map<string, string>();
  private readonly pendingSig = signal<ReadonlyMap<string, string>>(new Map());
  /** Photos dont la présence en file a été vérifiée (évite d'afficher une URL serveur inutile). */
  private readonly checked = signal<ReadonlySet<string>>(new Set());
  private refreshToken = 0;
  private destroyed = false;

  protected readonly photos = computed(() => {
    const code = this.code();
    const device = this.deviceId();
    const pending = this.pendingSig();
    const checked = this.checked();
    if (!device) return [];
    return (this.state()?.photos ?? [])
      .filter((p) => p.room_id === this.roomId() && checked.has(p.id))
      .map((p) => ({ id: p.id, src: pending.get(p.id) ?? this.api.photoUrl(code, p.id, device) }));
  });

  constructor() {
    void getDeviceId().then((id) => this.deviceId.set(id), () => undefined);
    effect(() => {
      const code = this.code();
      const ids = (this.state()?.photos ?? []).map((p) => p.id);
      this.sync.status(); // la file change quand une photo est envoyée
      if (code) void this.refreshPending(code, ids);
    });
    // navigation par l'URL, retour arrière : les brouillons de la pièce quittée sont enregistrés
    effect(() => {
      this.roomId();
      untracked(() => void this.flush());
    });
    inject(DestroyRef).onDestroy(() => {
      void this.flush();
      this.destroyed = true;
      this.refreshToken++;
      for (const url of this.pendingUrls.values()) URL.revokeObjectURL(url);
      this.pendingUrls.clear();
    });
  }

  private async refreshPending(code: string, ids: string[]): Promise<void> {
    const token = ++this.refreshToken;
    let rows: Awaited<ReturnType<LocalStore['pendingPhotos']>>;
    try {
      rows = await this.store.pendingPhotos(code);
    } catch {
      rows = [];
    }
    if (this.destroyed || token !== this.refreshToken) return;
    const next = new Map<string, string>();
    for (const row of rows) {
      next.set(row.id, this.pendingUrls.get(row.id) ?? URL.createObjectURL(row.blob));
    }
    for (const [id, url] of this.pendingUrls) if (!next.has(id)) URL.revokeObjectURL(url);
    this.pendingUrls = next;
    this.pendingSig.set(new Map(next));
    this.checked.set(new Set(ids));
  }

  protected goTo(room: { id: string } | null): void {
    if (!room) return;
    void this.flush();
    void this.router.navigate(['/v', this.code(), 'room', room.id]);
  }
  protected goPrev(): void {
    this.goTo(this.prevRoom());
  }
  protected goNext(): void {
    this.goTo(this.nextRoom());
  }

  /** Envoie une opération ; l'échec (stockage local plein) est signalé. */
  private async run(type: OpType, payload: object): Promise<boolean> {
    try {
      await this.sync.dispatch(type, payload);
      return true;
    } catch {
      this.snack.open('Modification non enregistrée', 'OK', { duration: 5000 });
      return false;
    }
  }

  protected setShared(targetId: string, field: SharedField, value: unknown): Promise<boolean> {
    return this.run('set_shared', { target_id: targetId, field, value });
  }
  protected rate(pointId: string, value: number | null): Promise<boolean> {
    return this.run('set_rating', { point_id: pointId, value });
  }

  protected setAsked(questionId: string, asked: boolean): Promise<boolean> {
    return this.setShared(questionId, 'asked', asked);
  }
  // --- brouillons : texte saisi pas encore enregistré, clé `answer:<id>`, `comment:<roomId>` ou `area:<roomId>`
  private readonly drafts = signal<Readonly<Record<string, string>>>({});

  /** Valeur affichée : le brouillon s'il existe (la synchro ne l'écrase pas), sinon l'état. */
  protected shown(key: string, fromState: string | number | null): string {
    return this.drafts()[key] ?? String(fromState ?? '');
  }
  protected answerKey(questionId: string): string {
    return `answer:${questionId}`;
  }
  protected roomKey(kind: 'comment' | 'area'): string {
    return `${kind}:${this.roomId()}`;
  }

  protected onInput(key: string, event: Event): void {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (input instanceof HTMLInputElement && input.validity.badInput) {
      this.dropDraft(key); // saisie partielle invalide : rien à enregistrer
      return;
    }
    this.drafts.update((d) => ({ ...d, [key]: input.value }));
  }

  /** Perte du focus : enregistre le brouillon, ou la valeur du champ si aucun brouillon n'existe. */
  protected onBlur(key: string, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (input instanceof HTMLInputElement && input.validity.badInput) return Promise.resolve();
    if (!(key in this.drafts())) this.drafts.update((d) => ({ ...d, [key]: input.value }));
    return this.flushKey(key);
  }

  private dropDraft(key: string): void {
    this.drafts.update((d) => {
      const { [key]: _removed, ...rest } = d;
      return rest;
    });
  }

  /** Enregistre un brouillon (avec l'identifiant de SA pièce) s'il diffère de l'état, puis l'efface. */
  private async flushKey(key: string): Promise<void> {
    const text = this.drafts()[key];
    if (text === undefined) return;
    const sep = key.indexOf(':');
    const kind = key.slice(0, sep);
    const id = key.slice(sep + 1);
    const s = this.state();
    if (kind === 'answer') {
      const current = s?.shared.find((v) => v.target_id === id && v.field === 'answer')?.value;
      if (text !== (typeof current === 'string' ? current : '')) await this.setShared(id, 'answer', text);
    } else if (kind === 'comment') {
      const current = s?.comments.find((c) => c.room_id === id)?.text ?? '';
      if (text !== current) await this.run('set_comment', { room_id: id, text });
    } else if (kind === 'area') {
      const raw = text.trim();
      const value = raw === '' ? null : Number(raw);
      const current = s?.shared.find((v) => v.target_id === id && v.field === 'area_m2')?.value;
      const currentNum = typeof current === 'number' ? current : null;
      if ((value === null || (Number.isFinite(value) && value >= 0)) && value !== currentNum) {
        await this.setShared(id, 'area_m2', value);
      }
    }
    if (this.drafts()[key] === text) this.dropDraft(key);
  }

  /** Enregistre tous les brouillons (changement de pièce, masquage, destruction). */
  private flush(): Promise<unknown> {
    return Promise.all(Object.keys(this.drafts()).map((k) => this.flushKey(k)));
  }

  protected startRename(): void {
    this.draftName.set(this.room()?.name ?? '');
    this.renaming.set(true);
  }
  protected async confirmRename(): Promise<void> {
    const name = this.draftName().trim();
    if (!name) return;
    this.renaming.set(false);
    if (name !== this.room()?.name) await this.run('rename_room', { room_id: this.roomId(), name });
  }

  protected async addPoint(): Promise<void> {
    const result = await firstValueFrom(this.dialog.open(AddPointDialog, { width: '400px' }).afterClosed());
    if (!result) return;
    await this.run('add_point', {
      id: crypto.randomUUID(),
      room_id: this.roomId(),
      label: result.label,
      type: result.type,
      options: result.options,
    });
  }

  protected async addQuestion(): Promise<void> {
    const text = await firstValueFrom(this.dialog.open(AddQuestionDialog, { width: '400px' }).afterClosed());
    if (!text) return;
    await this.run('add_question', { id: crypto.randomUUID(), room_id: this.roomId(), text });
  }

  protected async hideRoom(): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Masquer la pièce',
            message: `Masquer « ${this.room()?.name ?? ''} » ? Elle disparaîtra de la liste des pièces.`,
            confirmLabel: 'Masquer',
          },
        })
        .afterClosed(),
    );
    if (!ok) return;
    await this.flush();
    if (await this.run('hide_room', { room_id: this.roomId() })) {
      void this.router.navigate(['/v', this.code(), 'rooms']);
    }
  }

  protected async addPhoto(blob: Blob): Promise<void> {
    try {
      await this.sync.addPhoto(this.roomId(), blob);
    } catch (e) {
      this.photoFailed(e);
    }
  }
  protected photoFailed(e: unknown): void {
    this.snack.open(photoErrorMessage(e), 'OK', { duration: 5000 });
  }
}
