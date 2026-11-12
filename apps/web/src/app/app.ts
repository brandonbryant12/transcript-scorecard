import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { errorMessage } from './core/api/api-error';
import { HealthStore } from './core/api/health-store';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly hint: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { path: '/live', label: 'Live studio', hint: 'Replay a call and watch it scored' },
  { path: '/practice', label: 'Practice call', hint: 'Talk to an AI customer' },
  { path: '/calls', label: 'Calls', hint: 'Evaluations and evidence' },
  { path: '/coach-review', label: 'Coach review', hint: 'Capture ground truth' },
  { path: '/validation', label: 'Validation', hint: 'AI against coaches' },
  { path: '/runs', label: 'Runs', hint: 'Batch scoring and cost' },
  { path: '/spend', label: 'Spend', hint: 'Model API spending ledger' },
  { path: '/scorecard', label: 'Scorecard', hint: 'Skills and behaviours' },
];

/** The application shell: navigation on the side, the routed feature beside it. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Injecting the store here loads provider availability once, at startup.
  private readonly health = inject(HealthStore);

  protected readonly navItems = NAV_ITEMS;
  protected readonly healthError = computed(() => {
    const cause = this.health.error();
    return cause ? errorMessage(cause) : null;
  });

  protected retryHealth(): void {
    this.health.reload();
  }
}
