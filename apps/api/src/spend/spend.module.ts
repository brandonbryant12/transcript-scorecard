import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderRequestEntity } from '../runs/provider-request.entity.js';
import { SpendController } from './spend.controller.js';
import { SpendService } from './spend.service.js';

// Read-only: the ledger is written by the runs module, this module only sums it.
@Module({
  imports: [TypeOrmModule.forFeature([ProviderRequestEntity])],
  controllers: [SpendController],
  providers: [SpendService],
})
export class SpendModule {}
