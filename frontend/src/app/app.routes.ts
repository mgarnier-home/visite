import type { TemplatePage } from './features/template/template.page';
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage) },
  {
    path: 'template',
    loadComponent: () => import('./features/template/template.page').then((m) => m.TemplatePage),
    canDeactivate: [(page: TemplatePage) => page.canLeave()],
  },
  { path: 'new', loadComponent: () => import('./features/create/create.page').then((m) => m.CreatePage) },
  {
    path: 'v/:code',
    loadComponent: () => import('./features/visit/visit-shell.page').then((m) => m.VisitShellPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'rooms' },
      {
        path: 'rooms',
        loadComponent: () => import('./features/visit/rooms-tab.component').then((m) => m.RoomsTabComponent),
      },
      {
        path: 'questions',
        loadComponent: () => import('./features/visit/questions-tab.component').then((m) => m.QuestionsTabComponent),
      },
      {
        path: 'fiche',
        loadComponent: () => import('./features/visit/fiche-tab.component').then((m) => m.FicheTabComponent),
      },
      {
        path: 'bilan',
        loadComponent: () => import('./features/visit/summary-tab.component').then((m) => m.SummaryTabComponent),
      },
      {
        path: 'room/:roomId',
        loadComponent: () => import('./features/room/room.page').then((m) => m.RoomPage),
      },
    ],
  },
];
