import { DestroyRef, DOCUMENT, inject } from '@angular/core';

/**
 * Appelle callback quand l'application passe en arrière-plan (`visibilitychange` → hidden)
 * ou que la page est quittée (`pagehide`) : c'est la dernière occasion d'enregistrer un
 * brouillon avant que le système ne tue la PWA. À appeler dans un contexte d'injection ;
 * les écouteurs sont retirés à la destruction.
 */
export function onPageHidden(callback: () => void): void {
  const document = inject(DOCUMENT);
  const win = document.defaultView;
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') callback();
  };
  document.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', callback);
  inject(DestroyRef).onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    win?.removeEventListener('pagehide', callback);
  });
}
