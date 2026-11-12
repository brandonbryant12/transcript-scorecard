import { Controller, Get } from '@nestjs/common';
import type { PracticeScenario } from '@scorecard/domain';
import { publicScenarios } from './scenarios.js';

@Controller('practice')
export class PracticeController {
  // The scenarios a practice call can be started with. The customer's private brief
  // stays on the server.
  @Get('scenarios')
  scenarios(): PracticeScenario[] {
    return publicScenarios();
  }
}
