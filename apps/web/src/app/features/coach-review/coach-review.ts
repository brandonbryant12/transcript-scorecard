import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { firstValueFrom, forkJoin } from 'rxjs';
import { errorMessage } from '../../core/api/api-error';
import { CallsApi } from '../../core/api/calls-api';
import type { CallTranscript } from '../../core/models';
import { ReviewsApi } from '../../core/api/reviews-api';
import { ScorecardApi } from '../../core/api/scorecard-api';
import { BrowserStorage } from '../../core/browser-storage';
import type { CoachReview, Evaluation, ReviewQueueItem } from '../../core/models';
import { Transcript } from '../../shared/transcript/transcript';
import { StateMessage } from '../../shared/ui/state-message';
import { ReviewComparison } from './review-comparison';
import { ReviewForm } from './review-form';
import { ReviewFormModel, buildReviewModel, toReviewInput } from './review-form-model';

const COACH_NAME_KEY = 'scorecard.coach-name';
const EMPTY_FORM: ReviewFormModel = { notes: '', ratings: [], behaviors: [] };

/**
 * Ground-truth capture. A coach reads a call and rates it on the active scorecard without
 * seeing what the AI made of it. Nothing the AI produced is fetched or shown here until
 * the coach's review is submitted; only then are the two put side by side.
 */
@Component({
  selector: 'app-coach-review',
  imports: [Transcript, StateMessage, ReviewForm, ReviewComparison],
  templateUrl: './coach-review.html',
  styleUrl: './coach-review.css',
})
export class CoachReviewPage {
  private readonly callsApi = inject(CallsApi);
  private readonly reviewsApi = inject(ReviewsApi);
  private readonly scorecardApi = inject(ScorecardApi);
  private readonly storage = inject(BrowserStorage);

  protected readonly queue = this.reviewsApi.queueResource();
  protected readonly scorecard = this.scorecardApi.activeResource();

  protected readonly coachName = signal(this.storage.read(COACH_NAME_KEY) ?? '');
  protected readonly selectedCallId = signal<string | null>(null);
  protected readonly call = signal<CallTranscript | null>(null);
  /** The coach's saved review of the selected call, if any. */
  protected readonly saved = signal<CoachReview | null>(null);
  /** The review as it was when the call was opened: what the form starts from. */
  private readonly opened = signal<{ readonly review: CoachReview | null } | null>(null);
  /** The AI's evaluation; only ever loaded after the review is submitted. */
  protected readonly revealed = signal<{ readonly evaluation: Evaluation | null } | null>(null);

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedNotice = signal<string | null>(null);

  protected readonly queueItems = computed<ReviewQueueItem[]>(() =>
    this.queue.hasValue() ? this.queue.value() : [],
  );
  protected readonly definition = computed(() =>
    this.scorecard.hasValue() ? this.scorecard.value().definition : null,
  );
  /**
   * The form's data. It is rebuilt when a call is opened or the scorecard arrives, and
   * is the coach's to edit in between; saving does not reset it.
   */
  protected readonly formModel = linkedSignal<ReviewFormModel>(() => {
    const definition = this.definition();
    const opened = this.opened();
    return definition && opened ? buildReviewModel(definition, opened.review) : EMPTY_FORM;
  });
  protected readonly scorecardVersion = computed(() =>
    this.scorecard.hasValue() ? this.scorecard.value().version : null,
  );
  protected readonly loadError = computed(() => {
    const cause = this.queue.error() ?? this.scorecard.error();
    return cause ? errorMessage(cause) : null;
  });
  protected readonly trimmedName = computed(() => this.coachName().trim());
  protected readonly blockedReason = computed(() =>
    this.trimmedName() === '' ? 'Enter your name to save a review.' : null,
  );
  protected readonly isSubmitted = computed(() => this.saved()?.status === 'submitted');

  protected reviewedByMe(item: ReviewQueueItem): boolean {
    return this.trimmedName() !== '' && item.coaches.includes(this.trimmedName());
  }

  protected updateCoachName(name: string): void {
    this.coachName.set(name);
    this.storage.write(COACH_NAME_KEY, name);
    // A different coach has a different review of the same call.
    const callId = this.selectedCallId();
    if (callId !== null) void this.open(callId);
  }

  /** Loads a call for review: its transcript and this coach's saved review, nothing else. */
  protected async open(callId: string): Promise<void> {
    this.selectedCallId.set(callId);
    this.loading.set(true);
    this.error.set(null);
    this.savedNotice.set(null);
    this.revealed.set(null);
    try {
      const { call, reviews } = await firstValueFrom(
        forkJoin({
          call: this.callsApi.transcript(callId),
          reviews: this.reviewsApi.forCall(callId),
        }),
      );
      if (this.selectedCallId() !== callId) return;
      const mine = reviews.find((review) => review.coachName === this.trimmedName()) ?? null;
      this.call.set(call);
      this.saved.set(mine);
      this.opened.set({ review: mine });
      if (mine?.status === 'submitted') await this.reveal(callId);
    } catch (cause) {
      this.error.set(errorMessage(cause));
    } finally {
      this.loading.set(false);
    }
  }

  protected save(submit: boolean): Promise<void> {
    const callId = this.selectedCallId();
    if (callId === null || this.blockedReason() !== null) return Promise.resolve();
    return this.persist(callId, submit);
  }

  private async persist(callId: string, submit: boolean): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    this.savedNotice.set(null);
    try {
      const review = await firstValueFrom(
        this.reviewsApi.save(toReviewInput(this.formModel(), callId, this.trimmedName(), submit)),
      );
      this.saved.set(review);
      this.savedNotice.set(submit ? null : 'Draft saved.');
      this.queue.reload();
      if (review.status === 'submitted') await this.reveal(callId);
      else this.revealed.set(null);
    } catch (cause) {
      this.error.set(errorMessage(cause));
    } finally {
      this.saving.set(false);
    }
  }

  /** The one place an AI result is fetched, reached only once a review is submitted. */
  private async reveal(callId: string): Promise<void> {
    const detail = await firstValueFrom(this.callsApi.get(callId));
    if (this.selectedCallId() === callId) this.revealed.set({ evaluation: detail.evaluation });
  }
}
