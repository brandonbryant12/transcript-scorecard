import { Routes } from '@angular/router';

/** Every feature is its own lazily loaded chunk. */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'live' },
  {
    path: 'live',
    title: 'Live studio · Scorecard',
    loadComponent: () => import('./features/live-studio/live-studio').then((m) => m.LiveStudio),
  },
  {
    path: 'practice',
    title: 'Practice call · Scorecard',
    loadComponent: () => import('./features/practice/practice').then((m) => m.Practice),
  },
  {
    path: 'calls',
    title: 'Calls · Scorecard',
    loadComponent: () => import('./features/calls/calls').then((m) => m.Calls),
  },
  {
    path: 'coach-review',
    title: 'Coach review · Scorecard',
    loadComponent: () =>
      import('./features/coach-review/coach-review').then((m) => m.CoachReviewPage),
  },
  {
    path: 'validation',
    title: 'Validation · Scorecard',
    loadComponent: () => import('./features/validation/validation').then((m) => m.Validation),
  },
  {
    path: 'runs',
    title: 'Runs · Scorecard',
    loadComponent: () => import('./features/runs/runs').then((m) => m.Runs),
  },
  {
    path: 'scorecard',
    title: 'Scorecard editor · Scorecard',
    loadComponent: () =>
      import('./features/scorecard/scorecard-editor').then((m) => m.ScorecardEditor),
  },
  { path: '**', redirectTo: 'live' },
];
