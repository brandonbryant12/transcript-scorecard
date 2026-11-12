import { Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module.js';
import { LiveModule } from '../live/live.module.js';
import { GeminiLiveModel } from './gemini-live.model.js';
import { PracticeController } from './practice.controller.js';
import { PracticeGateway } from './practice.gateway.js';
import { REALTIME } from './realtime-model.js';

// Voice practice against an AI customer. Swapping the real-time voice model means
// providing a different class for the REALTIME token; nothing else here changes.
@Module({
  imports: [LiveModule, DecisionsModule],
  controllers: [PracticeController],
  providers: [{ provide: REALTIME, useClass: GeminiLiveModel }, PracticeGateway],
  exports: [REALTIME],
})
export class PracticeModule {}
