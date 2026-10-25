import { TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { APP_ICON_PATHS, provideAppIcons } from './icons';

const NAMES = ['add', 'delete', 'photo_camera', 'cloud_done', 'cloud_off', 'sync', 'check', 'close', 'warning', 'flag', 'more_vert', 'chevron_left', 'chevron_right', 'edit', 'visibility_off', 'download', 'content_copy', 'lock', 'home', 'settings', 'call', 'mail', 'link', 'drag_indicator', 'arrow_back'];

describe('provideAppIcons', () => {
  it('enregistre exactement les icônes prévues', () => {
    expect(Object.keys(APP_ICON_PATHS).sort()).toEqual([...NAMES].sort());
  });

  it.each(NAMES)('résout l\'icône %s', async (name) => {
    TestBed.configureTestingModule({ providers: [provideAppIcons()] });
    TestBed.inject(MatIconRegistry);
    const svg = await firstValueFrom(TestBed.inject(MatIconRegistry).getNamedSvgIcon(name));
    expect(svg.querySelector('path')).not.toBeNull();
    expect(svg.getAttribute('fill')).toBe('currentColor');
  });
});
