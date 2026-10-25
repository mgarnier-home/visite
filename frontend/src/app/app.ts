import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BackgroundSyncService } from './core/background-sync.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('frontend');

  constructor() {
    // modifications des visites non ouvertes (accueil, appli relancée) : envoyées en arrière-plan
    inject(BackgroundSyncService).start();
  }
}
