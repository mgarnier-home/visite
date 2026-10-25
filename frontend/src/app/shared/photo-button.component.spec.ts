import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { provideAppIcons } from './icons';
import { PhotoButtonComponent } from './photo-button.component';

// vi.mock sur import relatif n'est pas pris en charge : on simule les API du navigateur
// utilisées par le vrai compressImage.
const compressed = new Blob(['jpeg'], { type: 'image/jpeg' });
const createImageBitmapMock = vi.fn();
class FakeOffscreenCanvas {
  getContext() {
    return { drawImage: vi.fn() };
  }
  convertToBlob() {
    return Promise.resolve(compressed);
  }
}

describe('PhotoButtonComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    createImageBitmapMock.mockReset();
    createImageBitmapMock.mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() });
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    TestBed.configureTestingModule({ providers: [provideAppIcons()] });
  });

  function setup() {
    const fixture = TestBed.createComponent(PhotoButtonComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const photos: Blob[] = [];
    const failures: unknown[] = [];
    fixture.componentInstance.photo.subscribe((b) => photos.push(b));
    fixture.componentInstance.failed.subscribe((e) => failures.push(e));
    const input = el.querySelector('[data-test=photo-input]') as HTMLInputElement;
    const choose = async (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(photos.length + failures.length).toBeGreaterThan(0));
    };
    return { fixture, el, input, photos, failures, choose };
  }

  it('compresse le fichier choisi et émet le Blob obtenu', async () => {
    const { photos, choose, input } = setup();
    const file = new File(['raw'], 'p.heic');
    await choose(file);
    expect(createImageBitmapMock).toHaveBeenCalledWith(file);
    expect(photos).toEqual([compressed]);
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.accept).toBe('image/*');
  });

  it('émet failed quand la compression échoue', async () => {
    const err = new Error('boom');
    createImageBitmapMock.mockRejectedValue(err);
    const { photos, failures, choose } = setup();
    await choose(new File(['raw'], 'p.jpg'));
    expect(photos).toEqual([]);
    expect(failures).toEqual([err]);
  });

  it('remet la valeur de l\'input à zéro après le choix', async () => {
    const { input, choose } = setup();
    let value = 'C:\\fakepath\\p.jpg';
    Object.defineProperty(input, 'value', { get: () => value, set: (v: string) => (value = v), configurable: true });
    await choose(new File(['raw'], 'p.jpg'));
    expect(value).toBe('');
  });

  it('désactive le bouton quand disabled est vrai', () => {
    const fixture = TestBed.createComponent(PhotoButtonComponent);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('[data-test=photo-btn]') as HTMLButtonElement).disabled).toBe(true);
  });
});
