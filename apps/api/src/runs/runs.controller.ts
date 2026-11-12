import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  StartRunSchema,
  type RunDetail,
  type RunSummary,
  type StartRunInput,
} from '@scorecard/domain';
import { CredentialsService } from '../decisions/credentials.service.js';
import { RunProcessor } from './run-processor.service.js';
import { RunsService } from './runs.service.js';

@Controller('runs')
export class RunsController {
  private readonly logger = new Logger(RunsController.name);

  constructor(
    private readonly runs: RunsService,
    private readonly processor: RunProcessor,
    private readonly credentials: CredentialsService,
  ) {}

  @Get()
  list(): Promise<RunSummary[]> {
    return this.runs.list();
  }

  // Accepts the run and returns at once; scoring continues in the background and the
  // client follows it with GET /runs/:id.
  @Post()
  @HttpCode(202)
  async start(@Body({ schema: StartRunSchema }) input: StartRunInput): Promise<RunDetail> {
    const provider = input.provider ?? this.credentials.defaultProvider;
    // Fail before anything is persisted if the provider has no key.
    this.credentials.keyFor(provider);
    const run = await this.runs.createBatch(provider, input.callIds);
    void this.processor
      .process(run)
      .catch((cause) => this.logger.error(`Run ${run.runId} failed`, cause));
    return this.findOne(run.runId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<RunDetail> {
    const run = await this.runs.findDetail(id);
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }
}
