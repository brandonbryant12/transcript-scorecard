import { Pipe, PipeTransform } from '@angular/core';

/** Turns a transcript turn id into what a person would call it: "turn-12" -> "Turn 12". */
export function formatTurnLabel(turnId: string): string {
  const match = /(\d+)$/.exec(turnId);
  return match ? `Turn ${Number(match[1])}` : turnId;
}

@Pipe({ name: 'turnLabel' })
export class TurnLabelPipe implements PipeTransform {
  transform(turnId: string): string {
    return formatTurnLabel(turnId);
  }
}
