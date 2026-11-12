import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import {
  ScoringProviderSchema,
  type CallDetail,
  type CallSummary,
  type CallTranscript,
  type ScoringProvider,
} from '@scorecard/domain';
import { CallsService } from './calls.service.js';

@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get()
  list(): Promise<CallSummary[]> {
    return this.calls.list();
  }

  // The transcript on its own, for blind coach review: the response carries no evaluation.
  @Get(':id/transcript')
  async transcript(@Param('id') id: string): Promise<CallTranscript> {
    const call = await this.calls.findTranscript(id);
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  // `provider` picks whose evaluation to return; without it, the most recent one.
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Query('provider', { schema: ScoringProviderSchema.optional() }) provider?: ScoringProvider,
  ): Promise<CallDetail> {
    const call = await this.calls.findDetail(id, provider);
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }
}
