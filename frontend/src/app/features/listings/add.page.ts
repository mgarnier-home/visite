import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ApiClient, ApiError } from '../../core/api.client';
import { detectSource } from '../../core/listing';

const DETECTED: Record<string, string> = {
  bienici: "Lien Bien'ici repéré",
  jinka: 'Lien Jinka repéré',
  manual: 'Lien Leboncoin : saisie manuelle',
};

@Component({
  selector: 'app-add-page',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <header class="top">
      <a mat-icon-button routerLink="/" aria-label="Fermer"><mat-icon svgIcon="close" /></a>
      <h1>Ajouter une annonce</h1>
    </header>
    <main>
      <p class="hint">
        Dans l'appli Leboncoin, Jinka ou Bien'ici, touche « Partager », copie, puis colle ici. Le lien est repéré tout seul.
      </p>
      <label for="share">Texte partagé ou lien</label>
      <textarea id="share" data-test="text" rows="6" [value]="text()" (input)="onInput($event)"></textarea>
      <div class="detected" data-test="detected" [class.none]="!source()">
        @if (source()) {
          <mat-icon svgIcon="check" />
        }
        {{ message() }}
      </div>
      @if (error(); as e) {
        <div class="error" role="alert" data-test="error">
          {{ e.message }}
          @if (e.existingId) {
            <a [routerLink]="['/annonces', e.existingId]">Ouvrir sa fiche</a>
          }
        </div>
      }
    </main>
    <footer>
      <a mat-stroked-button routerLink="/">Annuler</a>
      <button mat-flat-button type="button" data-test="submit" [disabled]="!source() || busy()" (click)="submit()">
        {{ busy() ? 'Récupération…' : "Récupérer l'annonce" }}
      </button>
    </footer>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100dvh; max-width: 640px; margin: 0 auto; }
    .top { display: flex; align-items: center; gap: 4px; padding: 8px 8px 8px 4px; }
    h1 { margin: 0; font: var(--mat-sys-title-large); }
    main { display: flex; flex-direction: column; gap: 12px; padding: 8px 16px; flex-grow: 1; }
    .hint { margin: 0; color: var(--mat-sys-on-surface-variant); font: var(--mat-sys-body-medium); }
    label { font: var(--mat-sys-label-large); color: var(--mat-sys-primary); }
    textarea {
      box-sizing: border-box; width: 100%; padding: 12px; resize: none; font: inherit; font-size: 15px;
      border: 2px solid var(--mat-sys-primary); border-radius: 6px;
      background: var(--mat-sys-surface-container-lowest); color: var(--mat-sys-on-surface);
    }
    .detected {
      display: flex; align-items: center; gap: 8px; padding: 12px; border-radius: 12px;
      background: var(--mat-sys-surface-container); font: var(--mat-sys-label-large);
      mat-icon { color: var(--mat-sys-primary); }
      &.none { color: var(--mat-sys-on-surface-variant); }
    }
    .error {
      padding: 12px; border-radius: 12px; background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
      a { margin-left: 8px; color: inherit; font-weight: 500; }
    }
    footer { display: flex; gap: 12px; padding: 16px; border-top: 1px solid var(--mat-sys-outline-variant); }
    footer > * { height: 48px; }
    footer a { flex: 1; }
    footer button { flex: 2; }
  `,
})
export class AddPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<{ message: string; existingId?: string } | null>(null);
  protected readonly source = computed(() => detectSource(this.text()));
  protected readonly message = computed(
    () => DETECTED[this.source() ?? ''] ?? "Aucun lien Leboncoin, Jinka ou Bien'ici dans ce texte",
  );

  protected onInput(e: Event): void {
    this.text.set((e.target as HTMLTextAreaElement).value);
    this.error.set(null);
  }

  protected async submit(): Promise<void> {
    if (!this.source() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const l = await this.api.createListing(this.text());
      // page quittée pendant la récupération : l'annonce est créée, on ne force pas la navigation
      if (!this.destroyed) await this.router.navigate(['/annonces', l.id, 'verifier']);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const id = (err?.body as { id?: string } | undefined)?.id;
      this.error.set(
        err?.status === 409 && id
          ? { message: 'Cette annonce est déjà suivie', existingId: id }
          : { message: err?.message || 'Impossible de récupérer l\'annonce' },
      );
    } finally {
      this.busy.set(false);
    }
  }
}
