import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import { BackgroundSyncService } from './core/background-sync.service';

describe('App', () => {
  const background = { start: vi.fn() };

  beforeEach(async () => {
    background.start.mockReset();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: BackgroundSyncService, useValue: background }],
    }).compileComponents();
  });

  it('démarre l\'envoi en arrière-plan des visites non ouvertes', () => {
    TestBed.createComponent(App);
    expect(background.start).toHaveBeenCalledTimes(1);
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render a router-outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });

  it('should expose indexedDB through fake-indexeddb', () => {
    expect(globalThis.indexedDB).toBeDefined();
  });
});
