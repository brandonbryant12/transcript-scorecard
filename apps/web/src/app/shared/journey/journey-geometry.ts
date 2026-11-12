import type { CustomerJourney } from '../../core/models';
import { Tone, valenceTone } from '../../core/scoring-labels';

export interface JourneyMark {
  readonly turnId: string;
  readonly x: number;
  readonly y: number;
  readonly tone: Tone;
  readonly emotion: string;
  readonly valence: number;
}

export interface JourneyShiftMark {
  readonly turnId: string;
  readonly x: number;
  readonly y: number;
  readonly direction: 'up' | 'down';
}

export interface JourneyGeometry {
  readonly marks: readonly JourneyMark[];
  /** SVG polyline points joining the marks in call order. */
  readonly line: string;
  /** The y coordinate of neutral sentiment. */
  readonly neutralY: number;
  readonly shifts: readonly JourneyShiftMark[];
}

export interface ChartBox {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}

/**
 * Lays the customer's sentiment out on a chart: one mark per customer turn, evenly
 * spaced in call order, with valence +1 at the top and -1 at the bottom.
 */
export function journeyGeometry(journey: CustomerJourney, box: ChartBox): JourneyGeometry {
  const innerWidth = box.width - box.padding * 2;
  const innerHeight = box.height - box.padding * 2;
  const yFor = (valence: number) => box.padding + ((1 - valence) / 2) * innerHeight;
  const count = journey.points.length;

  const marks = journey.points.map((point, index): JourneyMark => ({
    turnId: point.turnId,
    x: count === 1 ? box.width / 2 : box.padding + (index / (count - 1)) * innerWidth,
    y: yFor(point.valence),
    tone: valenceTone(point.valence),
    emotion: point.emotion,
    valence: point.valence,
  }));
  const byTurn = new Map(marks.map((mark) => [mark.turnId, mark]));

  return {
    marks,
    line: marks.map((mark) => `${round(mark.x)},${round(mark.y)}`).join(' '),
    neutralY: yFor(0),
    shifts: journey.shifts.flatMap((shift): JourneyShiftMark[] => {
      const mark = byTurn.get(shift.turnId);
      return mark
        ? [{ turnId: shift.turnId, x: mark.x, y: mark.y, direction: shift.direction }]
        : [];
    }),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
