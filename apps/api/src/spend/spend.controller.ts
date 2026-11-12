import { Controller, Get, Query } from '@nestjs/common';
import { SpendDaysSchema, type SpendSummary } from '@scorecard/domain';
import { SpendService } from './spend.service.js';

// What has been spent on the decision APIs, and at what rates: the request ledger summed
// across every run.
@Controller('spend')
export class SpendController {
  constructor(private readonly spend: SpendService) {}

  @Get()
  summary(@Query('days', { schema: SpendDaysSchema }) days: number): Promise<SpendSummary> {
    return this.spend.summary(days);
  }
}
