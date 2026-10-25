import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { SyncService } from '../../core/sync.service';
import { PhotoButtonComponent, photoErrorMessage } from '../../shared/photo-button.component';
import { AddRoomDialog } from './add-room.dialog';

@Component({
  selector: 'app-rooms-tab',
  imports: [RouterLink, MatButtonModule, MatIconModule, PhotoButtonComponent],
  templateUrl: './rooms-tab.component.html',
  styleUrl: './rooms-tab.component.scss',
})
export class RoomsTabComponent {
  private readonly sync = inject(SyncService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  private readonly state = this.sync.state;
  protected readonly code = computed(() => this.state()?.visit.code ?? '');
  protected readonly closed = computed(() => !!this.state()?.visit.closed_at);
  protected readonly packingList = computed(() => this.state()?.visit.packing_list.trim() ?? '');

  /** Pièces visibles par position, avec les points remplis (ma note, N/A compris, ou valeur partagée). */
  protected readonly rooms = computed(() => {
    const s = this.state();
    if (!s) return [];
    const rated = new Set(s.ratings.map((r) => r.point_id));
    const shared = new Set(
      s.shared.filter((v) => v.field === 'value' && v.value !== null && v.value !== undefined).map((v) => v.target_id),
    );
    const total = new Map<string, number>();
    const filled = new Map<string, number>();
    for (const p of s.points) {
      total.set(p.room_id, (total.get(p.room_id) ?? 0) + 1);
      if (rated.has(p.id) || shared.has(p.id)) filled.set(p.room_id, (filled.get(p.room_id) ?? 0) + 1);
    }
    return s.rooms
      .filter((r) => !r.hidden)
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ id: r.id, name: r.name, filled: filled.get(r.id) ?? 0, total: total.get(r.id) ?? 0 }));
  });

  protected async addRoom(): Promise<void> {
    const result = await firstValueFrom(this.dialog.open(AddRoomDialog, { width: '400px' }).afterClosed());
    if (!result) return;
    try {
      await this.sync.dispatch('add_room', {
        id: crypto.randomUUID(),
        name: result.name,
        from_section_id: result.from_section_id,
      });
    } catch {
      this.snack.open('Pièce non enregistrée', 'OK', { duration: 5000 });
    }
  }

  protected async addGlobalPhoto(blob: Blob): Promise<void> {
    try {
      await this.sync.addPhoto(null, blob);
    } catch (e) {
      this.snack.open(photoErrorMessage(e), 'OK', { duration: 5000 });
    }
  }

  protected photoFailed(e: unknown): void {
    this.snack.open(photoErrorMessage(e), 'OK', { duration: 5000 });
  }
}
