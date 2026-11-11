import type { TemplatePage } from './features/template/template.page';
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/listings/listings.page').then((m) => m.ListingsPage),
  },
  {
    path: 'modele',
    loadComponent: () => import('./features/template/template.page').then((m) => m.TemplatePage),
    canDeactivate: [(page: TemplatePage) => page.canLeave()],
  },
  {
    path: 'annonces/nouvelle',
    loadComponent: () => import('./features/listings/add.page').then((m) => m.AddPage),
  },
  {
    path: 'annonces/:id/verifier',
    loadComponent: () => import('./features/listings/edit.page').then((m) => m.EditPage),
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
