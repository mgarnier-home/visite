import { Injectable, signal } from '@angular/core';
import { Listing } from './api.types';

/** Annonce de la visite ouverte : posée par le shell, lue par les onglets (prix du Bilan). */
@Injectable({ providedIn: 'root' })
export class CurrentListing {
  readonly listing = signal<Listing | null>(null);
}
