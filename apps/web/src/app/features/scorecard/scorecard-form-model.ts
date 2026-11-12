import type { BehaviorPolarity, Channel, ScorecardDefinition } from '../../core/models';

export interface BehaviorForm {
  /** Empty for a behaviour added in this session; it gets an id when the form is saved. */
  id: string;
  name: string;
  statement: string;
  polarity: BehaviorPolarity;
  critical: boolean;
  /** Blank means "expected on every call". */
  expectedWhen: string;
  tip: string;
}

export interface SkillForm {
  id: string;
  name: string;
  description: string;
  channel: Channel;
  weight: number;
  enabled: boolean;
  levels: { label: string; description: string }[];
  behaviors: BehaviorForm[];
}

export interface ScorecardFormModel {
  name: string;
  description: string;
  skills: SkillForm[];
}

/** A mutable copy of a scorecard for editing; the published definition is never touched. */
export function toFormModel(definition: ScorecardDefinition): ScorecardFormModel {
  return {
    name: definition.name,
    description: definition.description,
    skills: definition.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      channel: skill.channel,
      weight: skill.weight,
      enabled: skill.enabled,
      levels: skill.levels.map((level) => ({ ...level })),
      behaviors: skill.behaviors.map((behavior) => ({
        ...behavior,
        expectedWhen: behavior.expectedWhen ?? '',
      })),
    })),
  };
}

/** Turns a name into an id: lowercase letters, digits and underscores, starting with a letter. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    // Decomposing leaves the accents behind as separate marks; drop them.
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  return slug;
}

/** Makes an id unique among those taken by appending _2, _3 and so on. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const root = base === '' ? 'item' : base;
  if (!taken.has(root)) return root;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${root.slice(0, 40 - String(suffix).length - 1)}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The definition to publish. Text is trimmed, new behaviours get ids from their names, and
 * the fields that only apply to one polarity are cleared for the other.
 */
export function toDefinition(model: ScorecardFormModel): ScorecardDefinition {
  const taken = new Set(
    model.skills.flatMap((skill) => skill.behaviors.map((behavior) => behavior.id)),
  );
  taken.delete('');
  return {
    name: model.name.trim(),
    description: model.description.trim(),
    skills: model.skills.map((skill) => ({
      id: skill.id,
      name: skill.name.trim(),
      description: skill.description.trim(),
      channel: skill.channel,
      weight: Number.isFinite(Number(skill.weight)) ? Number(skill.weight) : 0,
      enabled: skill.enabled,
      levels: skill.levels.map((level) => ({
        label: level.label.trim(),
        description: level.description.trim(),
      })),
      behaviors: skill.behaviors.map((behavior) => {
        let id = behavior.id;
        if (id === '') {
          id = uniqueId(slugify(behavior.name), taken);
          taken.add(id);
        }
        const positive = behavior.polarity === 'positive';
        const expectedWhen = behavior.expectedWhen.trim();
        return {
          id,
          name: behavior.name.trim(),
          statement: behavior.statement.trim(),
          polarity: behavior.polarity,
          critical: positive ? false : behavior.critical,
          expectedWhen: positive && expectedWhen !== '' ? expectedWhen : null,
          tip: behavior.tip.trim(),
        };
      }),
    })),
  };
}

/** Each skill's share of the enabled weight, by skill id. Disabled skills have no share. */
export function weightShares(model: ScorecardFormModel): ReadonlyMap<string, number> {
  const weightOf = (skill: SkillForm) =>
    skill.enabled ? Math.max(0, Number(skill.weight) || 0) : 0;
  const total = model.skills.reduce((sum, skill) => sum + weightOf(skill), 0);
  return new Map(model.skills.map((skill) => [skill.id, total > 0 ? weightOf(skill) / total : 0]));
}

export function newBehavior(): BehaviorForm {
  return {
    id: '',
    name: '',
    statement: '',
    polarity: 'positive',
    critical: false,
    expectedWhen: '',
    tip: '',
  };
}
