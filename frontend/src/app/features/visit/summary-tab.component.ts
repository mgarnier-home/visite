import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ApiClient, ApiError } from '../../core/api.client';
import { OpType, SharedField } from '../../core/api.types';
import { blockingPoints, realPrice, totalWorks, unaskedCount, weightedScore } from '../../core/compute';
import { formatEur, formatScore } from '../../core/format';
import { SyncService } from '../../core/sync.service';
import { ConfirmDialog } from '../room/confirm.dialog';
import { PointCardComponent } from '../room/point-card.component';

type SharedMap = Partial<Record<SharedField, unknown>>;

/** Attente maximale de la synchro avant un export (ms). */
const SYNC_WAIT_MS = 10_000;
/** Délai avant de révoquer l'URL d'un téléchargement (Firefox Android la lit après le clic). */
const REVOKE_DELAY_MS = 40_000;
const PENDING_WARNING = 'Des modifications de cet appareil ne sont pas encore envoyées';
type AuthorMap = Partial<Record<SharedField, number>>;

/** Bilan : notes pondérées, points bloquants, coût réel, export et clôture. */
@Component({
  selector: 'app-summary-tab',
  imports: [RouterLink, MatButtonModule, MatIconModule, PointCardComponent],
  templateUrl: './summary-tab.component.html',
  styleUrl: './summary-tab.component.scss',
})
export class SummaryTabComponent {
  private readonly sync = inject(SyncService);
  private readonly api = inject(ApiClient);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  private readonly state = this.sync.state;
  protected readonly code = computed(() => this.state()?.visit.code ?? '');
  protected readonly closed = computed(() => !!this.state()?.visit.closed_at);
  protected readonly isCreator = computed(() => !!this.state()?.visit.is_creator);

  protected readonly points = computed(() => {
    const s = this.state();
    const summary = s?.rooms.find((r) => !r.hidden && r.kind === 'summary');
    if (!s || !summary) return [];
    const ratings = new Map(s.ratings.map((r) => [r.point_id, r.value]));
    const values = new Map<string, SharedMap>();
    const authors = new Map<string, AuthorMap>();
    for (const v of s.shared) {
      values.set(v.target_id, { ...values.get(v.target_id), [v.field]: v.value });
      authors.set(v.target_id, { ...authors.get(v.target_id), [v.field]: v.author });
    }
    return s.points
      .filter((p) => p.room_id === summary.id)
      .sort((a, b) => a.position - b.position)
      .map((point) => ({
        point,
        rating: ratings.has(point.id) ? (ratings.get(point.id) as number | null) : undefined,
        shared: values.get(point.id) ?? {},
        authors: authors.get(point.id) ?? {},
      }));
  });

  protected readonly scoreText = computed(() => {
    const s = this.state();
    const score = s ? weightedScore(s) : null;
    return `Mon score : ${score === null ? '—' : `${formatScore(score)} / 5`}`;
  });

  protected readonly blocking = computed(() => {
    const s = this.state();
    if (!s) return [];
    const names = new Map(s.rooms.map((r) => [r.id, r.name]));
    return blockingPoints(s).map((p) => ({ id: p.id, text: `${names.get(p.room_id) ?? ''} — ${p.label}` }));
  });

  protected readonly worksText = computed(() => {
    const s = this.state();
    return formatEur(s ? totalWorks(s) : 0);
  });
  protected readonly realPriceText = computed(() => {
    const s = this.state();
    const real = s ? realPrice(s) : null;
    return real === null ? '—' : formatEur(real);
  });
  protected readonly unasked = computed(() => {
    const s = this.state();
    return s ? unaskedCount(s) : 0;
  });

  private async run(type: OpType, payload: object): Promise<void> {
    try {
      await this.sync.dispatch(type, payload);
    } catch {
      this.snack.open('Modification non enregistrée', 'OK', { duration: 5000 });
    }
  }

  protected setShared(targetId: string, field: SharedField, value: unknown): Promise<void> {
    return this.run('set_shared', { target_id: targetId, field, value });
  }
  protected rate(pointId: string, value: number | null): Promise<void> {
    return this.run('set_rating', { point_id: pointId, value });
  }

  /**
   * Envoie d'abord les modifications de cet appareil (attente bornée), puis récupère l'export ;
   * en cas d'échec, signale l'erreur et renvoie null. pending : il reste des modifications non
   * envoyées, absentes de l'export.
   */
  private async fetchCsv(sep: 'semicolon' | 'tab'): Promise<{ blob: Blob; pending: boolean } | null> {
    await this.flushSync();
    const { pendingOps, pendingPhotos } = this.sync.status();
    const pending = pendingOps + pendingPhotos > 0;
    try {
      return { blob: await this.api.exportCsv(this.code(), sep), pending };
    } catch (e) {
      const offline = e instanceof ApiError && e.status === 0;
      this.snack.open(offline ? 'Il faut du réseau pour exporter' : 'Export impossible', 'OK', { duration: 5000 });
      return null;
    }
  }

  /** Lance un cycle de synchro et attend sa fin, au plus SYNC_WAIT_MS. */
  private async flushSync(): Promise<void> {
    this.sync.kick();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, SYNC_WAIT_MS)));
    try {
      await Promise.race([this.sync.whenIdle().catch(() => undefined), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private warnPending(prefix = ''): void {
    this.snack.open(`${prefix}${PENDING_WARNING} : l'export ne les contient pas`, 'OK', { duration: 8000 });
  }

  protected async exportCsv(): Promise<void> {
    const res = await this.fetchCsv('semicolon');
    if (!res) return;
    const url = URL.createObjectURL(res.blob);
    // Lien attaché au document le temps du clic : certains navigateurs ignorent un lien détaché.
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.code()}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    if (res.pending) this.warnPending();
  }

  protected async copyForSheets(): Promise<void> {
    const res = await this.fetchCsv('tab');
    if (!res) return;
    try {
      await navigator.clipboard.writeText(await res.blob.text());
    } catch {
      this.snack.open('Copie impossible', 'OK', { duration: 5000 });
      return;
    }
    if (res.pending) this.warnPending('Copié dans le presse-papiers. ');
    else this.snack.open('Copié dans le presse-papiers', 'OK', { duration: 3000 });
  }

  protected async closeVisit(): Promise<void> {
    const ok = await firstValueFrom(
      this.dialog
        .open(ConfirmDialog, {
          data: {
            title: 'Clôturer la visite',
            message: 'Une fois clôturée, la visite ne pourra plus être modifiée. Continuer ?',
            confirmLabel: 'Clôturer',
          },
        })
        .afterClosed(),
    );
    if (ok) await this.run('close_visit', {});
  }
}
