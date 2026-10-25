import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage) },
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
        path: 'room/:roomId',
        loadComponent: () => import('./features/room/room.page').then((m) => m.RoomPage),
      },
    ],
  },
];
