import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage) },
  { path: 'new', loadComponent: () => import('./features/create/create.page').then((m) => m.CreatePage) },
];
