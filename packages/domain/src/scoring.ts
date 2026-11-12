import { buildCoaching } from './coaching.js';
import { SCORING_METHOD } from './method.js';
import type {
  BehaviorResult,
  CustomerJourney,
  EvaluationBody,
  JourneyArc,
  JourneyPoint,
  JourneyShift,
  Moment,
  RiskResult,
  ScoringState,
  SkillResult,
  Stage,
  TranscriptTurn,
} from './evaluation.js';
import { enabledSkills, type Behavior, type ScorecardDefinition, type Skill } from './scorecard.js';
import { RISK_LABELS, sentimentToValence } from './signals.js';

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export const normalizeLevel = (expectedLevel: number, levelCount: number): number =>
  levelCount < 2 ? 0 : round((expectedLevel / (levelCount - 1)) * 100, 1);

export const mostLikelyLevel = (probabilities: ReadonlyArray<number>): number => {
  let best = 0;
  probabilities.forEach((probability, index) => {
    if (probability > (probabilities[best] ?? 0)) best = index;
  });
  return best;
};

// Probability on the most likely level and its immediate neighbours.
export const adjacentMass = (probabilities: ReadonlyArray<number>): number => {
  const top = mostLikelyLevel(probabilities);
  return (probabilities[top - 1] ?? 0) + (probabilities[top] ?? 0) + (probabilities[top + 1] ?? 0);
};

export interface WeightedSkill {
  readonly weight: number;
  readonly normalizedScore: number;
  readonly observability: number;
  readonly confidence: number;
  // false when the skill needs a channel (audio, video) this call does not have.
  readonly assessed?: boolean;
}

// Evidence-weighted mean. Each skill counts in proportion to weight x observability, so a
// skill the call has not reached yet neither helps nor hurts the live score.
//
// A skill whose channel the call does not have (a vocal skill on a transcript-only call)
// is left out altogether, of the score and of coverage. Coverage answers "how much of
// what this call could show has it shown?", and a transcript can never show tone.
export const weightedOverall = (
  all: ReadonlyArray<WeightedSkill>,
): {
  readonly overallScore: number | null;
  readonly coverage: number;
  readonly confidence: number;
} => {
  const skills = all.filter((skill) => skill.assessed !== false);
  const totalWeight = skills.reduce((sum, skill) => sum + skill.weight, 0);
  if (totalWeight <= 0) return { overallScore: null, coverage: 0, confidence: 0 };
  const effective = skills.reduce(
    (sum, skill) => sum + skill.weight * clamp01(skill.observability),
    0,
  );
  const coverage = effective / totalWeight;
  if (coverage < SCORING_METHOD.minCoverage)
    return { overallScore: null, coverage: round(coverage, 3), confidence: 0 };
  const score = skills.reduce(
    (sum, skill) => sum + skill.weight * clamp01(skill.observability) * skill.normalizedScore,
    0,
  );
  const confidence = skills.reduce(
    (sum, skill) => sum + skill.weight * clamp01(skill.observability) * skill.confidence,
    0,
  );
  return {
    overallScore: round(score / effective, 1),
    coverage: round(coverage, 3),
    confidence: round(confidence / effective, 3),
  };
};

// The probability that a behaviour happened in one turn, read from the skill's channel:
// the transcript for verbal skills, the turn's audio or frames for the others.
const tagFor = (
  skill: Skill,
  behaviorId: string,
  state: ScoringState,
  turnId: string,
): number | undefined =>
  skill.channel === 'verbal'
    ? state.tags[turnId]?.[behaviorId]
    : state.media[turnId]?.[skill.channel]?.tags[behaviorId];

const composeBehavior = (
  skill: Skill,
  behavior: Behavior,
  state: ScoringState,
  employeeTurnIds: ReadonlyArray<string>,
  stage: Stage,
  assessed: boolean,
): BehaviorResult => {
  let probability = 0;
  const turnIds: string[] = [];
  for (const turnId of employeeTurnIds) {
    const tagged = tagFor(skill, behavior.id, state, turnId);
    if (tagged === undefined) continue;
    if (tagged > probability) probability = tagged;
    if (tagged >= SCORING_METHOD.detectThreshold) turnIds.push(turnId);
  }
  const base = {
    behaviorId: behavior.id,
    skillId: skill.id,
    name: behavior.name,
    statement: behavior.statement,
    polarity: behavior.polarity,
    critical: behavior.critical,
    tip: behavior.tip,
    probability: round(probability, 3),
    turnIds,
  };
  if (!assessed) return { ...base, expected: null, status: 'not_assessed' };
  if (behavior.polarity === 'negative') {
    return { ...base, expected: null, status: turnIds.length > 0 ? 'violated' : 'clear' };
  }
  // An always-expected behaviour can only be called "missed" once the call is over.
  const expected =
    behavior.expectedWhen === null
      ? stage === 'final'
        ? 1
        : null
      : (state.expected[behavior.id] ?? null);
  const status =
    turnIds.length > 0
      ? 'demonstrated'
      : expected !== null && expected >= SCORING_METHOD.expectedThreshold
        ? 'missed'
        : 'not_applicable';
  return { ...base, expected: expected === null ? null : round(expected, 3), status };
};

const classifyArc = (points: ReadonlyArray<JourneyPoint>): JourneyArc => {
  const start = mean(points.slice(0, 2).map((point) => point.valence));
  const end = mean(points.slice(-2).map((point) => point.valence));
  const low = Math.min(...points.map((point) => point.valence));
  if (low <= -0.35 && end >= 0.2) return 'recovered';
  if (end - start >= 0.35) return 'improved';
  if (end - start <= -0.35) return 'declined';
  const average = mean(points.map((point) => point.valence));
  return average >= 0.2
    ? 'steady_positive'
    : average <= -0.2
      ? 'steady_negative'
      : 'steady_neutral';
};

export const composeJourney = (
  state: ScoringState,
  turns: ReadonlyArray<TranscriptTurn>,
): CustomerJourney | null => {
  const points: JourneyPoint[] = [];
  turns.forEach((turn, turnIndex) => {
    const reading = turn.speaker === 'customer' ? state.customer[turn.id] : undefined;
    if (!reading) return;
    // Words and voice are read independently. When both exist they count equally, and
    // both are kept so a coach can see when they disagree.
    const voice = state.media[turn.id]?.voice;
    const sentiment = voice ? (reading.sentiment + voice.sentiment) / 2 : reading.sentiment;
    points.push({
      turnId: turn.id,
      turnIndex,
      sentiment: round(sentiment, 2),
      textSentiment: round(reading.sentiment, 2),
      voiceSentiment: voice ? round(voice.sentiment, 2) : null,
      mixedSignal: voice
        ? Math.abs(voice.sentiment - reading.sentiment) >= SCORING_METHOD.mixedSignalLevels
        : false,
      valence: round(sentimentToValence(sentiment), 3),
      confidence: reading.sentimentConfidence,
      emotion: reading.emotion,
      emotionConfidence: reading.emotionConfidence,
    });
  });
  if (points.length === 0) return null;
  const shifts: JourneyShift[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const delta = round(to.valence - from.valence, 3);
    if (Math.abs(delta) < SCORING_METHOD.shiftThreshold) continue;
    shifts.push({
      turnId: to.turnId,
      fromTurnId: from.turnId,
      delta,
      direction: delta > 0 ? 'up' : 'down',
      employeeTurnIds: turns
        .slice(from.turnIndex + 1, to.turnIndex)
        .filter((turn) => turn.speaker === 'employee')
        .map((turn) => turn.id),
    });
  }
  const low = points.reduce(
    (lowest, point) => (point.valence < lowest.valence ? point : lowest),
    points[0]!,
  );
  return {
    points,
    arc: classifyArc(points),
    startValence: points[0]!.valence,
    endValence: points.at(-1)!.valence,
    lowTurnId: low.turnId,
    shifts,
  };
};

const composeRisk = (state: ScoringState): RiskResult | null => {
  if (!state.risk) return null;
  const level = mostLikelyLevel(state.risk.probabilities);
  return {
    score: normalizeLevel(state.risk.expectedLevel, RISK_LABELS.length),
    level,
    label: RISK_LABELS[level] ?? RISK_LABELS[0],
    confidence: state.risk.confidence,
  };
};

// Turn raw readings into the evaluation a coach reads. Pure: the same state always
// composes to the same evaluation, so stored readings can be re-composed after a
// threshold change without calling a provider again.
export const composeEvaluation = (
  definition: ScorecardDefinition,
  state: ScoringState,
  turns: ReadonlyArray<TranscriptTurn>,
  stage: Stage,
): EvaluationBody => {
  const employeeTurnIds = turns
    .filter((turn) => turn.speaker === 'employee')
    .map((turn) => turn.id);
  const skills: SkillResult[] = [];
  for (const skill of enabledSkills(definition)) {
    const base = {
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      channel: skill.channel,
      weight: skill.weight,
      levels: skill.levels,
    };
    const behaviors = (assessed: boolean) =>
      skill.behaviors.map((behavior) =>
        composeBehavior(skill, behavior, state, employeeTurnIds, stage, assessed),
      );

    if (skill.channel === 'verbal') {
      const reading = state.skills[skill.id];
      if (!reading) continue;
      skills.push({
        ...base,
        assessed: true,
        expectedLevel: round(reading.expectedLevel, 2),
        level: mostLikelyLevel(reading.probabilities),
        normalizedScore: normalizeLevel(reading.expectedLevel, skill.levels.length),
        confidence: reading.confidence,
        probabilities: reading.probabilities,
        observability: round(clamp01(reading.observability ?? 1), 3),
        behaviors: behaviors(true),
      });
      continue;
    }

    // A vocal or visual skill is a property of each utterance, so it is rated once per
    // employee turn on that turn's clip and the turn ratings are averaged. With no clips
    // the skill is unassessed: observability 0 removes it from the weighted score.
    const channel = skill.channel;
    const perTurn = employeeTurnIds.flatMap((turnId) => {
      const reading = state.media[turnId]?.[channel]?.skills[skill.id];
      return reading ? [reading] : [];
    });
    if (perTurn.length === 0) {
      skills.push({
        ...base,
        assessed: false,
        expectedLevel: 0,
        level: 0,
        normalizedScore: 0,
        confidence: 0,
        probabilities: skill.levels.map(() => 0),
        observability: 0,
        behaviors: behaviors(false),
      });
      continue;
    }
    const expectedLevel = mean(perTurn.map((reading) => reading.expectedLevel));
    const probabilities = skill.levels.map((_, level) =>
      round(mean(perTurn.map((reading) => reading.probabilities[level] ?? 0)), 3),
    );
    skills.push({
      ...base,
      assessed: true,
      expectedLevel: round(expectedLevel, 2),
      level: mostLikelyLevel(probabilities),
      normalizedScore: normalizeLevel(expectedLevel, skill.levels.length),
      confidence: round(mean(perTurn.map((reading) => reading.confidence)), 3),
      probabilities,
      observability: 1,
      behaviors: behaviors(true),
    });
  }

  const order = new Map(turns.map((turn, index) => [turn.id, index]));
  const moments: Moment[] = skills
    .flatMap((skill) =>
      skill.behaviors.flatMap((behavior) =>
        behavior.turnIds.map((turnId) => ({
          turnId,
          behaviorId: behavior.behaviorId,
          skillId: skill.skillId,
          name: behavior.name,
          polarity: behavior.polarity,
          critical: behavior.critical,
          probability: round(
            (skill.channel === 'verbal'
              ? state.tags[turnId]?.[behavior.behaviorId]
              : state.media[turnId]?.[skill.channel]?.tags[behavior.behaviorId]) ?? 0,
            3,
          ),
        })),
      ),
    )
    .sort((a, b) => (order.get(a.turnId) ?? 0) - (order.get(b.turnId) ?? 0));

  const journey = composeJourney(state, turns);
  const coaching = buildCoaching(skills, journey, stage);
  const channels = (['verbal', 'vocal', 'visual'] as const).filter(
    (channel) =>
      channel === 'verbal' ||
      skills.some((skill) => skill.channel === channel && skill.assessed) ||
      (channel === 'vocal' &&
        Object.values(state.media).some((reading) => reading.voice !== undefined)),
  );
  return {
    stage,
    turnCount: turns.length,
    channels,
    ...weightedOverall(skills),
    skills,
    moments,
    journey,
    risk: composeRisk(state),
    coaching,
    needsReview: coaching.reviewReasons.length > 0,
  };
};
