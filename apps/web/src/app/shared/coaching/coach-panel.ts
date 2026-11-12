import { Component, input } from '@angular/core';
import type { CoachingSummary } from '../../core/models';
import { CoachPoint } from './coach-point';

/**
 * What a coach would say about the call: what went well, what to work on, the one skill
 * to focus on next, and why a person should double-check the evaluation.
 */
@Component({
  selector: 'app-coach-panel',
  imports: [CoachPoint],
  templateUrl: './coach-panel.html',
  styleUrl: './coach-panel.css',
})
export class CoachPanel {
  readonly coaching = input.required<CoachingSummary>();
}
