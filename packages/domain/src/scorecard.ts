import { z } from 'zod';

// A scorecard is a set of weighted skills. Each skill is judged two ways:
//   1. an anchored rubric (ordered levels, each with a description), and
//   2. atomic behaviours: single observable actions that either happen in a turn or do not.
// The rubric produces the number; the behaviours produce the evidence and the coaching.
//
// The schemas below are the single definition of a valid scorecard. The API validates
// requests with them and both apps take their types from them.

const Id = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'must be lowercase letters, digits and underscores');
const Text = z.string().trim().min(1).max(600);
const Name = z.string().trim().min(1).max(80);

export const RubricLevelSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  description: Text,
});
export type RubricLevel = z.infer<typeof RubricLevelSchema>;

export const BehaviorPolaritySchema = z.enum(['positive', 'negative']);
export type BehaviorPolarity = z.infer<typeof BehaviorPolaritySchema>;

export const BehaviorSchema = z.strictObject({
  id: Id,
  name: Name,
  // A statement that is true or false of ONE employee turn, e.g. "The employee restates the problem".
  statement: Text,
  // positive: something the employee should do. negative: something they should not do.
  polarity: BehaviorPolaritySchema,
  // A critical negative behaviour raises a flag on the whole call when detected.
  critical: z.boolean(),
  // The situation in which a positive behaviour is expected. null means "expected on every call".
  expectedWhen: Text.nullable(),
  // Coach-authored advice shown when the behaviour is missed (positive) or detected (negative).
  tip: Text,
});
export type Behavior = z.infer<typeof BehaviorSchema>;

// What a skill is judged from.
//   verbal  what was said: the transcript. Always available.
//   vocal   how it sounded: an audio clip of each employee turn.
//   visual  what was visible: video frames of each employee turn.
// A skill whose channel a call does not have is left unassessed and drops out of that
// call's weighted score, so one scorecard serves transcript, audio and video calls.
export const ChannelSchema = z.enum(['verbal', 'vocal', 'visual']);
export type Channel = z.infer<typeof ChannelSchema>;
export const CHANNELS = ChannelSchema.options;
export const CHANNEL_LABELS: Readonly<Record<Channel, string>> = {
  verbal: 'Transcript',
  vocal: 'Audio',
  visual: 'Video',
};

export const SkillSchema = z.strictObject({
  id: Id,
  name: Name,
  description: Text,
  channel: ChannelSchema,
  weight: z.number().min(0).max(100),
  enabled: z.boolean(),
  levels: z.array(RubricLevelSchema).min(2).max(10),
  behaviors: z.array(BehaviorSchema).max(12),
});
export type Skill = z.infer<typeof SkillSchema>;

export const ScorecardDefinitionSchema = z.strictObject({
  name: Name,
  description: z.string().trim().max(600),
  skills: z.array(SkillSchema).min(1).max(12),
});
export type ScorecardDefinition = z.infer<typeof ScorecardDefinitionSchema>;

// Versions are immutable. Publishing an edit creates the next version, and every run,
// evaluation and coach review records the version it was made against.
export interface ScorecardVersion {
  readonly id: string;
  readonly scorecardId: string;
  readonly version: number;
  readonly definition: ScorecardDefinition;
  readonly createdAt: string;
}

export interface ScorecardVersionSummary {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
}

export interface ActiveScorecard extends ScorecardVersion {
  readonly versions: ReadonlyArray<ScorecardVersionSummary>;
}

export const enabledSkills = (definition: ScorecardDefinition): ReadonlyArray<Skill> =>
  definition.skills.filter((skill) => skill.enabled && skill.weight > 0);

// Cross-field rules the structural schema cannot express. Returns human-readable problems.
export const scorecardProblems = (definition: ScorecardDefinition): ReadonlyArray<string> => {
  const problems: string[] = [];
  const skillIds = new Set<string>();
  const behaviorIds = new Set<string>();
  for (const skill of definition.skills) {
    if (skillIds.has(skill.id)) problems.push(`Skill id "${skill.id}" is used more than once`);
    skillIds.add(skill.id);
    const labels = new Set(skill.levels.map((level) => level.label.trim().toLowerCase()));
    if (labels.size !== skill.levels.length)
      problems.push(`${skill.name}: rubric level labels must be distinct`);
    for (const behavior of skill.behaviors) {
      if (behaviorIds.has(behavior.id))
        problems.push(`Behaviour id "${behavior.id}" is used more than once`);
      behaviorIds.add(behavior.id);
      if (behavior.critical && behavior.polarity !== 'negative') {
        problems.push(`${behavior.name}: only negative behaviours can be critical`);
      }
      if (behavior.polarity === 'negative' && behavior.expectedWhen !== null) {
        problems.push(`${behavior.name}: negative behaviours have no "expected when"`);
      }
    }
  }
  if (enabledSkills(definition).length === 0)
    problems.push('At least one skill must be enabled with a weight above zero');
  return problems;
};

const level = (label: string, description: string): RubricLevel => ({ label, description });

const positive = (
  id: string,
  name: string,
  statement: string,
  expectedWhen: string | null,
  tip: string,
): Behavior => ({ id, name, statement, polarity: 'positive', critical: false, expectedWhen, tip });

const negative = (
  id: string,
  name: string,
  statement: string,
  tip: string,
  critical = false,
): Behavior => ({
  id,
  name,
  statement,
  polarity: 'negative',
  critical,
  expectedWhen: null,
  tip,
});

export const DEFAULT_SCORECARD_ID = 'support-quality';

export const defaultScorecard: ScorecardDefinition = {
  name: 'Support call quality',
  description:
    'How well a support employee listens, tells the truth, protects the account, resolves the issue and communicates.',
  skills: [
    {
      id: 'empathy',
      name: 'Empathy & active listening',
      description: 'Recognises how the customer feels and responds to what they actually said.',
      channel: 'verbal',
      weight: 20,
      enabled: true,
      levels: [
        level(
          'Dismissive',
          'Ignores or contradicts what the customer said; shows no recognition of how they feel.',
        ),
        level(
          'Minimal',
          'A token acknowledgement, then straight back to script; the customer has to repeat themselves.',
        ),
        level(
          'Adequate',
          'Polite and responsive, but the acknowledgement is generic and the problem is not played back.',
        ),
        level(
          'Strong',
          "Names the customer's situation or feeling specifically and responds to what they actually said.",
        ),
        level(
          'Exceptional',
          "Consistently reflects the customer's words and priorities, repairs any misstep, and leaves them feeling heard.",
        ),
      ],
      behaviors: [
        positive(
          'acknowledges_emotion',
          'Acknowledges the emotion',
          'The employee explicitly acknowledges how the customer feels, the pressure they are under, or the effort they have already made.',
          'The customer has expressed frustration, worry, urgency or another clear emotion.',
          'Name the feeling or the stakes before moving to the fix. One specific sentence is enough.',
        ),
        positive(
          'restates_problem',
          'Restates the problem',
          "The employee restates or summarises the customer's problem in their own words to confirm understanding.",
          'The customer has described the problem they need help with.',
          'Play the problem back and ask whether you have it right before you start troubleshooting.',
        ),
        positive(
          'owns_mistake',
          'Owns a mistake',
          'The employee apologises for, or takes ownership of, a mistake or poor experience without deflecting blame.',
          'The customer has pointed out a mistake by the employee or the company, or described a poor experience the company caused.',
          'Own the miss plainly ("I got that wrong"), then say what you will do differently.',
        ),
        negative(
          'dismisses_customer',
          'Dismisses the customer',
          'The employee dismisses, contradicts or talks past what the customer just said, for example by repeating a step the customer already tried or sending them elsewhere without looking.',
          'When a customer says they already tried something, treat it as information: skip the step and look deeper.',
        ),
      ],
    },
    {
      id: 'accuracy',
      name: 'Accuracy & honesty',
      description:
        'Gives correct, consistent information and is honest about what is uncertain or outside their control.',
      channel: 'verbal',
      weight: 20,
      enabled: true,
      levels: [
        level(
          'Misleading',
          'Gives wrong information or guarantees that the call shows to be false, and does not correct them.',
        ),
        level(
          'Unreliable',
          'Several unsupported claims or contradictions; corrections come only when the customer pushes.',
        ),
        level(
          'Mostly accurate',
          'Generally correct, with one notable unsupported claim or a gap the customer has to probe.',
        ),
        level(
          'Accurate',
          'Information is correct and consistent; limits and uncertainty are stated when asked.',
        ),
        level(
          'Precise',
          "Correct, consistent, and proactively clear about what is known, unknown and outside the employee's control.",
        ),
      ],
      behaviors: [
        positive(
          'sets_honest_expectations',
          'Sets honest expectations',
          'The employee is explicit about what they cannot guarantee, do not know, or do not control.',
          'The customer has asked for a guarantee, a timeframe, or certainty about an outcome.',
          'Separate what you control from what you do not: "I can guarantee X; Y depends on Z."',
        ),
        positive(
          'corrects_error',
          'Corrects their own error',
          'The employee corrects something inaccurate or unsupported that they said earlier in the call.',
          'The employee has said something inaccurate or made a promise they could not support.',
          'Correct yourself out loud as soon as you notice. A visible correction builds more trust than a quiet one.',
        ),
        negative(
          'unsupported_promise',
          'Makes an unsupported promise',
          'The employee guarantees an outcome or timeframe that is outside their control or that contradicts what they said earlier.',
          'Replace guarantees with a range and the reason behind it.',
        ),
        negative(
          'wrong_information',
          'States something wrong',
          'The employee asserts a cause, policy or fact that contradicts information the customer has already given in the call.',
          'Check your assumption against what the customer has told you before stating a cause.',
        ),
      ],
    },
    {
      id: 'security',
      name: 'Security & verification',
      description: 'Verifies identity before touching the account and refuses to bend that rule.',
      channel: 'verbal',
      weight: 20,
      enabled: true,
      levels: [
        level(
          'Breach',
          'Changes or exposes account access or personal details with no identity verification.',
        ),
        level(
          'Risky',
          'Offers to skip verification, or verifies only after acting on the account.',
        ),
        level('Partial', 'Verifies, but incompletely or inconsistently across the call.'),
        level('Sound', 'Verifies identity before accessing or changing the account.'),
        level(
          'Exemplary',
          'Verifies before acting, explains why, and protects the account when asked to bend the rules.',
        ),
      ],
      behaviors: [
        positive(
          'verifies_identity',
          'Verifies identity',
          'The employee asks the customer to prove their own identity with security details, or confirms that the security details the customer gave match the account.',
          'The employee needs to access, discuss or change account-specific information.',
          "Verify before you open the account, and say why: it is for the customer's protection.",
        ),
        negative(
          'unverified_change',
          'Unverified account change',
          'The employee makes, or offers to make, a change to account access, credentials or contact details without verifying the identity of the person affected.',
          'No verification, no change. Offer the verified route instead of the shortcut.',
          true,
        ),
      ],
    },
    {
      id: 'resolution',
      name: 'Resolution & ownership',
      description: 'Moves the issue to a clear resolution or a specific, owned next step.',
      channel: 'verbal',
      weight: 25,
      enabled: true,
      levels: [
        level('Unresolved', 'No fix and no plan; the customer is left where they started.'),
        level('Weak next step', 'A vague or unowned follow-up with no timeframe.'),
        level('Partial', 'Some progress, but part of the issue is still open or unowned.'),
        level(
          'Resolved',
          'The issue is fixed, or has a specific next step with an owner and a timeframe.',
        ),
        level(
          'Resolved and proactive',
          'Fixed and confirmed with the customer, with future problems anticipated and prevented.',
        ),
      ],
      behaviors: [
        positive(
          'investigates',
          'Investigates before acting',
          'The employee asks a specific diagnostic question, or reports checking records or logs, to find the cause of the problem.',
          'The customer has described a problem whose cause is not yet established.',
          'Ask one diagnostic question, or check the record, before proposing a fix.',
        ),
        positive(
          'delivers_fix',
          'Delivers the fix',
          'The employee states that the fix, or the action the customer asked for, has now been carried out.',
          'The call has reached the point where the fix or the requested action could be carried out.',
          'Say explicitly when the fix is done so the customer knows the state has changed.',
        ),
        positive(
          'owned_next_step',
          'Gives an owned next step',
          'The employee commits to a specific next step with an owner, a timeframe or a reference number.',
          'Part of the issue cannot be completed during the call, or follow-up is needed.',
          'Close every open item with who, what and when, plus a reference the customer can quote.',
        ),
      ],
    },
    {
      id: 'communication',
      name: 'Clear communication',
      description:
        'Uses plain language, confirms the details that matter and closes with a summary.',
      channel: 'verbal',
      weight: 15,
      enabled: true,
      levels: [
        level('Confusing', 'The customer cannot tell what is happening or what to do.'),
        level(
          'Often unclear',
          'Jargon, missing steps or contradictions force the customer to ask again.',
        ),
        level('Understandable', 'The customer can follow, but key details are not confirmed.'),
        level('Clear', 'Plain language, one step at a time, with key details confirmed.'),
        level(
          'Exceptionally clear',
          'Explains the why as well as the what, confirms details back, and closes with a summary.',
        ),
      ],
      behaviors: [
        positive(
          'explains_reasoning',
          'Explains the why',
          'The employee gives the reason behind a step, a diagnosis or a decision in plain language.',
          "The employee has taken or proposed an action on the customer's issue.",
          'Add the reason to the instruction: "I\'m doing X because Y."',
        ),
        positive(
          'confirms_details',
          'Confirms key details',
          'The employee reads back or confirms a key detail such as a reference number, amount, date or timeframe.',
          'The call involves a reference number, amount, date or commitment the customer needs to keep.',
          'Read reference numbers, amounts and dates back once.',
        ),
        positive(
          'summarises_outcome',
          'Summarises the outcome',
          'The employee recaps the call as a whole: what has been done and what happens next.',
          'The call is wrapping up or has ended.',
          'End with a two-line recap: what changed, and what happens next.',
        ),
      ],
    },
    {
      id: 'vocal_delivery',
      name: 'Vocal delivery',
      description:
        'How the employee sounds: calm, warm and steady rather than rushed, flat or irritated.',
      channel: 'vocal',
      weight: 10,
      enabled: true,
      levels: [
        level('Abrasive', 'Sounds irritated, sarcastic or condescending.'),
        level('Tense', 'Sounds rushed, impatient or flat, as if reading a script.'),
        level('Neutral', 'Even and professional, without warmth.'),
        level('Warm', 'Calm, friendly and unhurried.'),
        level('Reassuring', 'Calm and warm, with a tone that actively steadies the listener.'),
      ],
      behaviors: [
        positive(
          'calm_pace',
          'Speaks calmly',
          'The employee speaks at a calm, unhurried pace.',
          null,
          'Slow down by a beat, especially right after the customer raises their voice.',
        ),
        negative(
          'irritated_tone',
          'Sounds irritated',
          'The employee sounds irritated, impatient or condescending.',
          'Notice the moment your tone tightens. Pause, breathe, then answer.',
        ),
      ],
    },
    {
      id: 'visual_presence',
      name: 'On-camera presence',
      description:
        'What the customer would see: whether the employee is facing them and paying attention. This measures attention, not cheerfulness.',
      channel: 'visual',
      weight: 10,
      enabled: true,
      levels: [
        level('Disengaged', 'Turned away, slumped, or visibly doing something else.'),
        level('Distracted', 'Frequently looking away from the camera or at another screen.'),
        level('Neutral', 'Facing the camera, but it is unclear whether they are paying attention.'),
        level('Attentive', 'Facing the camera with steady attention, whatever their expression.'),
        level(
          'Engaged',
          'Facing the camera and visibly responsive to what is said, for example nodding.',
        ),
      ],
      behaviors: [
        positive(
          'faces_camera',
          'Faces the camera',
          'The employee is facing the camera and looking towards it.',
          null,
          'Put the call window directly under the camera so looking at the customer reads as eye contact.',
        ),
        negative(
          'looks_away',
          'Looks away',
          'The employee is looking away from the camera, at another screen, or appears distracted.',
          'If you need to read something, say so first: "I\'m looking at your account now."',
        ),
      ],
    },
  ],
};
