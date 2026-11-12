import {
  agreementStats,
  behaviorAgreement,
  calibration,
  PROVIDER_ORDER,
  type BehaviorStatus,
  type CoachBehaviorLabel,
  type CoachReview,
  type Disagreement,
  type Evaluation,
  type LevelPair,
  type ProviderAgreement,
  type SkillAgreement,
  type ValidationReport,
} from '@scorecard/domain';

// How an AI behaviour status reads in a coach's vocabulary.
const asCoachLabel = (status: BehaviorStatus): CoachBehaviorLabel =>
  status === 'demonstrated' || status === 'violated'
    ? 'yes'
    : status === 'not_applicable'
      ? 'na'
      : 'no';

interface SkillPair extends LevelPair {
  readonly skillId: string;
  readonly skillName: string;
  readonly coachLabel: string;
  readonly aiLabel: string;
}

// Pair a coach's ratings with one AI evaluation of the same call, skill by skill. A skill
// is compared only when both rated it on a rubric with the same number of levels; a
// rating made against an older, differently shaped rubric is left out, not coerced.
export const pairSkills = (review: CoachReview, evaluation: Evaluation): ReadonlyArray<SkillPair> =>
  review.ratings.flatMap((rating) => {
    const skill = evaluation.skills.find((item) => item.skillId === rating.skillId);
    if (!skill || !skill.assessed || rating.level === null || rating.level >= skill.levels.length) {
      return [];
    }
    return [
      {
        skillId: skill.skillId,
        skillName: skill.name,
        coach: rating.level,
        coachLabel: skill.levels[rating.level]!.label,
        ai: skill.level,
        aiLabel: skill.levels[skill.level]!.label,
        aiExpected: skill.expectedLevel,
        levels: skill.levels.length,
        confidence: skill.confidence,
      },
    ];
  });

// The coach's overall score on the same weights the AI used, over the skills they rated.
const coachOverall = (review: CoachReview, evaluation: Evaluation): number | null => {
  let weight = 0;
  let total = 0;
  for (const rating of review.ratings) {
    const skill = evaluation.skills.find((item) => item.skillId === rating.skillId);
    if (!skill || !skill.assessed || rating.level === null) continue;
    if (rating.level >= skill.levels.length) continue;
    weight += skill.weight;
    total += skill.weight * (rating.level / (skill.levels.length - 1)) * 100;
  }
  return weight > 0 ? total / weight : null;
};

const round = (value: number): number => Math.round(value * 100) / 100;

export const buildValidationReport = (
  reviews: ReadonlyArray<CoachReview>,
  evaluations: ReadonlyArray<Evaluation>,
  calls: ReadonlyArray<{ readonly id: string; readonly subject: string }>,
): ValidationReport => {
  const subjects = new Map(calls.map((call) => [call.id, call.subject]));
  const providers: ProviderAgreement[] = [];

  for (const provider of PROVIDER_ORDER) {
    const byCall = new Map(
      evaluations
        .filter((evaluation) => evaluation.provider === provider)
        .map((evaluation) => [evaluation.callId, evaluation]),
    );
    const pairs: SkillPair[] = [];
    const disagreements: Disagreement[] = [];
    const behaviorPairs: Array<{ coach: CoachBehaviorLabel; ai: CoachBehaviorLabel }> = [];
    const overallErrors: number[] = [];
    const comparedCalls = new Set<string>();
    let model = '';

    for (const review of reviews) {
      const evaluation = byCall.get(review.callId);
      if (!evaluation) continue;
      const reviewPairs = pairSkills(review, evaluation);
      if (reviewPairs.length === 0) continue;
      comparedCalls.add(review.callId);
      model = evaluation.model;
      pairs.push(...reviewPairs);
      for (const pair of reviewPairs) {
        if (pair.coach === pair.ai) continue;
        disagreements.push({
          callId: review.callId,
          subject: subjects.get(review.callId) ?? review.callId,
          coachName: review.coachName,
          skillId: pair.skillId,
          skillName: pair.skillName,
          coachLevel: pair.coach,
          coachLabel: pair.coachLabel,
          aiLevel: pair.ai,
          aiLabel: pair.aiLabel,
          aiExpected: pair.aiExpected,
          confidence: pair.confidence,
        });
      }
      const coachScore = coachOverall(review, evaluation);
      if (coachScore !== null && evaluation.overallScore !== null) {
        overallErrors.push(evaluation.overallScore - coachScore);
      }
      const aiBehaviors = new Map(
        evaluation.skills.flatMap((skill) =>
          skill.behaviors.map((behavior) => [behavior.behaviorId, behavior.status] as const),
        ),
      );
      for (const label of review.behaviors) {
        const status = aiBehaviors.get(label.behaviorId);
        if (status && status !== 'not_assessed')
          behaviorPairs.push({ coach: label.label, ai: asCoachLabel(status) });
      }
    }
    if (pairs.length === 0) continue;

    const skillIds = [...new Set(pairs.map((pair) => pair.skillId))];
    const skills: SkillAgreement[] = skillIds.map((skillId) => {
      const forSkill = pairs.filter((pair) => pair.skillId === skillId);
      return { skillId, name: forSkill[0]!.skillName, ...agreementStats(forSkill) };
    });
    providers.push({
      provider,
      model,
      calls: comparedCalls.size,
      all: agreementStats(pairs),
      skills,
      overall: {
        n: overallErrors.length,
        mae: overallErrors.length
          ? round(
              overallErrors.reduce((sum, error) => sum + Math.abs(error), 0) / overallErrors.length,
            )
          : 0,
        bias: overallErrors.length
          ? round(overallErrors.reduce((sum, error) => sum + error, 0) / overallErrors.length)
          : 0,
      },
      behaviors: behaviorAgreement(behaviorPairs),
      calibration: calibration(pairs),
      // The biggest misses first; among equals, the ones the AI was most sure about.
      disagreements: disagreements
        .sort(
          (a, b) =>
            Math.abs(b.coachLevel - b.aiLevel) - Math.abs(a.coachLevel - a.aiLevel) ||
            b.confidence - a.confidence,
        )
        .slice(0, 25),
    });
  }

  // Where two coaches rated the same call, their agreement with each other is the
  // ceiling: an AI cannot be expected to agree with coaches more than they agree.
  const humanPairs: LevelPair[] = [];
  const byCall = new Map<string, CoachReview[]>();
  for (const review of reviews)
    byCall.set(review.callId, [...(byCall.get(review.callId) ?? []), review]);
  const levelCounts = new Map(
    evaluations.flatMap((evaluation) =>
      evaluation.skills.map((skill) => [skill.skillId, skill.levels.length] as const),
    ),
  );
  for (const [first, second] of byCall.values()) {
    if (!first || !second) continue;
    for (const rating of first.ratings) {
      const other = second.ratings.find((item) => item.skillId === rating.skillId);
      const levels = levelCounts.get(rating.skillId);
      if (!other || levels === undefined || rating.level === null || other.level === null) continue;
      if (rating.level >= levels || other.level >= levels) continue;
      humanPairs.push({
        coach: rating.level,
        ai: other.level,
        aiExpected: other.level,
        levels,
        confidence: 1,
      });
    }
  }

  return {
    submittedReviews: reviews.length,
    reviewedCalls: new Set(reviews.map((review) => review.callId)).size,
    totalCalls: calls.length,
    coaches: [...new Set(reviews.map((review) => review.coachName))].sort(),
    humanBaseline: humanPairs.length > 0 ? agreementStats(humanPairs) : null,
    providers,
  };
};
