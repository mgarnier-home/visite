import type { TemplatePage } from './features/template/template.page';
import { Routes } from '@angular/router';

// Pas de route '' avant la page d'accueil (tâche 9).
export const routes: Routes = [
  {
    path: 'modele',
    loadComponent: () => import('./features/template/template.page').then((m) => m.TemplatePage),
    canDeactivate: [(page: TemplatePage) => page.canLeave()],
  },
  {
    path: 'annonces/:id',
    loadComponent: () => import('./features/visit/visit-shell.page').then((m) => m.VisitShellPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'pieces' },
      {
        path: 'pieces',
        loadComponent: () => import('./features/visit/rooms-tab.component').then((m) => m.RoomsTabComponent),
      },
      {
        path: 'questions',
        loadComponent: () => import('./features/visit/questions-tab.component').then((m) => m.QuestionsTabComponent),
      },
      {
        path: 'bilan',
        loadComponent: () => import('./features/visit/summary-tab.component').then((m) => m.SummaryTabComponent),
      },
      {
        path: 'piece/:roomId',
        loadComponent: () => import('./features/room/room.page').then((m) => m.RoomPage),
      },
    ],
  },
];
