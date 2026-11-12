import type { CustomerJourney, JourneyPoint } from '../../core/models';
import { journeyGeometry } from './journey-geometry';

const BOX = { width: 120, height: 60, padding: 10 };

function point(turnId: string, valence: number): JourneyPoint {
  return {
    turnId,
    turnIndex: 0,
    sentiment: 2 + valence * 2,
    textSentiment: 2 + valence * 2,
    voiceSentiment: null,
    mixedSignal: false,
    valence,
    confidence: 0.9,
    emotion: 'neutral',
    emotionConfidence: 0.9,
  };
}

function journey(points: JourneyPoint[], shifts: CustomerJourney['shifts'] = []): CustomerJourney {
  return {
    points,
    arc: 'recovered',
    startValence: points[0].valence,
    endValence: points[points.length - 1].valence,
    lowTurnId: points[0].turnId,
    shifts,
  };
}

describe('journeyGeometry', () => {
  it('spreads marks across the width with positive sentiment at the top', () => {
    const geometry = journeyGeometry(
      journey([point('turn-2', -1), point('turn-4', 0), point('turn-6', 1)]),
      BOX,
    );
    expect(geometry.marks.map((mark) => [mark.x, mark.y])).toEqual([
      [10, 50],
      [60, 30],
      [110, 10],
    ]);
    expect(geometry.neutralY).toBe(30);
    expect(geometry.line).toBe('10,50 60,30 110,10');
    expect(geometry.marks.map((mark) => mark.tone)).toEqual(['bad', 'neutral', 'good']);
  });

  it('centres a single mark', () => {
    const geometry = journeyGeometry(journey([point('turn-2', 0.5)]), BOX);
    expect(geometry.marks[0].x).toBe(60);
  });

  it('places each shift on the turn it landed on and skips unknown turns', () => {
    const geometry = journeyGeometry(
      journey(
        [point('turn-2', -1), point('turn-4', 1)],
        [
          {
            turnId: 'turn-4',
            fromTurnId: 'turn-2',
            delta: 2,
            direction: 'up',
            employeeTurnIds: ['turn-3'],
          },
          {
            turnId: 'turn-99',
            fromTurnId: 'turn-4',
            delta: -1,
            direction: 'down',
            employeeTurnIds: [],
          },
        ],
      ),
      BOX,
    );
    expect(geometry.shifts).toEqual([{ turnId: 'turn-4', x: 110, y: 10, direction: 'up' }]);
  });
});
