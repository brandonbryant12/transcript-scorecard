import { Controller, Get } from '@nestjs/common';
import type { ValidationReport } from '@scorecard/domain';
import { CallsService } from '../calls/calls.service.js';
import { EvaluationsService } from '../evaluations/evaluations.service.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { buildValidationReport } from './validation-report.js';

// How well the AI agrees with coaches: every submitted review set against the newest
// final evaluation of the same call from each provider.
@Controller('validation')
export class ValidationController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly evaluations: EvaluationsService,
    private readonly calls: CallsService,
  ) {}

  @Get()
  async report(): Promise<ValidationReport> {
    const [reviews, evaluations, calls] = await Promise.all([
      this.reviews.listSubmitted(),
      this.evaluations.latestFinalDocuments(),
      this.calls.list(),
    ]);
    return buildValidationReport(reviews, evaluations, calls);
  }
}
