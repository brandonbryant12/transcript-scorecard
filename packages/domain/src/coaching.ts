import type {
  BehaviorResult,
  CoachingFocus,
  CoachingPoint,
  CoachingSummary,
  CustomerJourney,
  SkillResult,
  Stage,
} from './evaluation.js';
import { SCORING_METHOD } from './method.js';

// Coaching is assembled, never generated. A decision model returns probabilities, not
// prose, so every sentence a coach reads here was written by a person in the scorecard:
// behaviour names, tips and rubric level descriptions. The code only decides which of
// those sentences this call has earned.

const OBSERVABLE = SCORING_METHOD.observableThreshold;
const MAX_POINTS = 3;

const impactOf = (
  behavior: BehaviorResult,
  journey: CustomerJourney | null,
): CoachingPoint['impact'] => {
  if (!journey) return null;
  for (const shift of journey.shifts) {
    if (!shift.employeeTurnIds.some((turnId) => behavior.turnIds.includes(turnId))) continue;
    if (shift.direction === 'up' && behavior.polarity === 'positive') return 'sentiment_up';
    if (shift.direction === 'down' && behavior.polarity === 'negative') return 'sentiment_down';
  }
  return null;
};

const point = (
  kind: CoachingPoint['kind'],
  skill: SkillResult,
  behavior: BehaviorResult,
  detail: string,
  journey: CustomerJourney | null,
): CoachingPoint => ({
  kind,
  skillId: skill.skillId,
  skillName: skill.name,
  behaviorId: behavior.behaviorId,
  title: behavior.name,
  detail,
  turnIds: behavior.turnIds,
  impact: impactOf(behavior, journey),
});

interface Ranked {
  readonly rank: number;
  readonly point: CoachingPoint;
}

const top = (ranked: ReadonlyArray<Ranked>): ReadonlyArray<CoachingPoint> =>
  [...ranked]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_POINTS)
    .map((item) => item.point);

const pickFocus = (skills: ReadonlyArray<SkillResult>): CoachingFocus | null => {
  const candidates = skills.filter(
    (skill) => skill.observability >= OBSERVABLE && skill.level < skill.levels.length - 1,
  );
  if (candidates.length === 0) return null;
  // The biggest lever is the skill losing the most weighted points, not simply the lowest.
  const focus = candidates.reduce((best, skill) =>
    skill.weight * (100 - skill.normalizedScore) > best.weight * (100 - best.normalizedScore)
      ? skill
      : best,
  );
  const next = focus.levels[focus.level + 1]!;
  return {
    skillId: focus.skillId,
    skillName: focus.name,
    levelLabel: focus.levels[focus.level]!.label,
    nextLevelLabel: next.label,
    nextLevelDescription: next.description,
  };
};

export const buildCoaching = (
  skills: ReadonlyArray<SkillResult>,
  journey: CustomerJourney | null,
  stage: Stage,
): CoachingSummary => {
  const strengths: Ranked[] = [];
  const opportunities: Ranked[] = [];
  const flags: CoachingPoint[] = [];
  const reviewReasons: string[] = [];

  for (const skill of skills) {
    if (!skill.assessed) continue;
    for (const behavior of skill.behaviors) {
      if (behavior.status === 'demonstrated') {
        const item = point('strength', skill, behavior, behavior.statement, journey);
        strengths.push({
          rank: skill.weight * behavior.probability + (item.impact ? 100 : 0),
          point: item,
        });
      } else if (behavior.status === 'violated') {
        const item = point(
          behavior.critical ? 'flag' : 'opportunity',
          skill,
          behavior,
          behavior.tip,
          journey,
        );
        if (behavior.critical) flags.push(item);
        else
          opportunities.push({ rank: 200 + skill.weight + (item.impact ? 100 : 0), point: item });
      } else if (behavior.status === 'missed') {
        const item = point('opportunity', skill, behavior, behavior.tip, journey);
        opportunities.push({ rank: skill.weight * (behavior.expected ?? 1), point: item });
      }
    }

    if (skill.observability < OBSERVABLE) continue;
    const top = skill.level;
    const nearby =
      (skill.probabilities[top - 1] ?? 0) +
      (skill.probabilities[top] ?? 0) +
      (skill.probabilities[top + 1] ?? 0);
    if (nearby < SCORING_METHOD.reviewAdjacentMass) {
      reviewReasons.push(
        `Uncertain on ${skill.name}: the model is split between distant rubric levels`,
      );
    }
    // The rubric and the behaviours are asked independently. When they contradict each
    // other, one of them is wrong, and a person should decide which.
    const violated = skill.behaviors.some((behavior) => behavior.status === 'violated');
    // One slip that the employee repairs can still earn a top rating; a repeated one cannot.
    const repeated = skill.behaviors.some(
      (behavior) => behavior.status === 'violated' && behavior.turnIds.length > 1,
    );
    const positives = skill.behaviors.filter((behavior) => behavior.polarity === 'positive');
    const allDemonstrated =
      positives.length > 0 && positives.every((behavior) => behavior.status === 'demonstrated');
    if (repeated && skill.level >= skill.levels.length - 1) {
      reviewReasons.push(
        `${skill.name} is rated at the top level despite a repeated problem behaviour`,
      );
    } else if (allDemonstrated && !violated && skill.level <= 1 && stage === 'final') {
      reviewReasons.push(
        `${skill.name} is rated low although every expected behaviour was detected`,
      );
    }
  }
  for (const flag of flags) reviewReasons.unshift(`Critical behaviour detected: ${flag.title}`);

  const observable = skills.filter((skill) => skill.observability >= OBSERVABLE);
  const strongest = observable.reduce<SkillResult | null>(
    (best, skill) => (best === null || skill.normalizedScore > best.normalizedScore ? skill : best),
    null,
  );
  const focus = pickFocus(skills);
  const headline =
    flags.length > 0
      ? `Critical: ${flags[0]!.title}`
      : strongest === null
        ? 'Listening for the first scoreable moments'
        : focus === null || focus.skillId === strongest.skillId
          ? `Strongest on ${strongest.name}`
          : `Strongest on ${strongest.name}; biggest lever is ${focus.skillName}`;

  return {
    headline,
    strengths: top(strengths),
    opportunities: top(opportunities),
    flags,
    focus,
    reviewReasons,
  };
};
