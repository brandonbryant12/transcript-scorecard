import type {
  CoachBehaviorLabel,
  CoachReview,
  ReviewInput,
  ScorecardDefinition,
} from '../../core/models';

/** A rating as the form holds it: a level index as text, "na", or "" for not answered yet. */
export type LevelChoice = string;
export const NOT_APPLICABLE = 'na';

export interface ReviewFormModel {
  notes: string;
  ratings: { skillId: string; level: LevelChoice; note: string }[];
  behaviors: { behaviorId: string; label: CoachBehaviorLabel | '' }[];
}

/**
 * Builds the form for a scorecard, filled from the coach's saved review when there is one.
 * The form has one entry per enabled skill and one per behaviour, in scorecard order, so
 * the template can address them by position.
 */
export function buildReviewModel(
  definition: ScorecardDefinition,
  existing: CoachReview | null,
): ReviewFormModel {
  const skills = definition.skills.filter((skill) => skill.enabled && skill.weight > 0);
  const ratings = new Map(existing?.ratings.map((rating) => [rating.skillId, rating]));
  const labels = new Map(existing?.behaviors.map((item) => [item.behaviorId, item.label]));
  return {
    notes: existing?.notes ?? '',
    ratings: skills.map((skill) => {
      const saved = ratings.get(skill.id);
      return {
        skillId: skill.id,
        // A saved rating is a level or an explicit "not applicable" (null). A skill with
        // no saved rating has not been answered yet.
        level: !saved ? '' : saved.level === null ? NOT_APPLICABLE : String(saved.level),
        note: saved?.note ?? '',
      };
    }),
    behaviors: skills.flatMap((skill) =>
      skill.behaviors.map((behavior) => ({
        behaviorId: behavior.id,
        label: labels.get(behavior.id) ?? ('' as const),
      })),
    ),
  };
}

/** How many skills the coach has given a rubric level (not N/A, not blank). */
export function ratedSkillCount(model: ReviewFormModel): number {
  return model.ratings.filter((rating) => /^\d+$/.test(rating.level)).length;
}

/** The request body for saving the form. N/A is sent as a null level; unanswered skills are left out. */
export function toReviewInput(
  model: ReviewFormModel,
  callId: string,
  coachName: string,
  submit: boolean,
): ReviewInput {
  return {
    callId,
    coachName: coachName.trim(),
    notes: model.notes,
    ratings: model.ratings
      .filter((rating) => rating.level !== '')
      .map((rating) => ({
        skillId: rating.skillId,
        level: rating.level === NOT_APPLICABLE ? null : Number(rating.level),
        note: rating.note.trim(),
      })),
    behaviors: model.behaviors.flatMap((item) =>
      item.label === '' ? [] : [{ behaviorId: item.behaviorId, label: item.label }],
    ),
    submit,
  };
}
