import { Pipe, PipeTransform } from '@angular/core';
import type { ScoringProvider } from '../../core/models';
import { providerLabel } from '../../core/provider-meta';

@Pipe({ name: 'providerLabel' })
export class ProviderLabelPipe implements PipeTransform {
  transform(provider: ScoringProvider): string {
    return providerLabel(provider);
  }
}
