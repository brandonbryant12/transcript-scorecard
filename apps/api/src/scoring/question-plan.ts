import {
  EMOTIONS,
  enabledSkills,
  RISK_LEVELS,
  SENTIMENT_LEVELS,
  type ChannelReading,
  type CustomerReading,
  type LevelReading,
  type ScorecardDefinition,
  type ScoringState,
  type Skill,
  type Stage,
  type TranscriptTurn,
  type TurnMediaReading,
} from '@scorecard/domain';
import type { Answer, InputBlock, Question } from '../decisions/decision.types.js';

// What an answer means once it comes back. Question keys are short and opaque (the
// model never sees them); the target says where the answer belongs.
export type Target =
  | { readonly kind: 'skill'; readonly skillId: string }
  | { readonly kind: 'observability'; readonly skillId: string }
  | { readonly kind: 'expected'; readonly behaviorId: string }
  | { readonly kind: 'tag'; readonly turnId: string; readonly behaviorId: string }
  | { readonly kind: 'sentiment'; readonly turnId: string }
  | { readonly kind: 'emotion'; readonly turnId: string }
  | { readonly kind: 'risk' }
  // Readings taken from one turn's audio clip or video frames.
  | {
      readonly kind: 'clip_skill';
      readonly turnId: string;
      readonly channel: 'vocal' | 'visual';
      readonly skillId: string;
    }
  | {
      readonly kind: 'clip_tag';
      readonly turnId: string;
      readonly channel: 'vocal' | 'visual';
      readonly behaviorId: string;
      // How several answers about one behaviour in one turn (one per video frame) become
      // the turn's reading.
      readonly combine: 'max' | 'mean';
    }
  | { readonly kind: 'voice'; readonly turnId: string };

export interface PlannedQuestion {
  readonly key: string;
  readonly question: Question;
  readonly target: Target;
}

export interface CallContext {
  readonly subject: string;
  readonly customerName: string;
  readonly agentName: string;
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

// The shared input every question is asked against. Each turn is one line with a
// bracketed label, so a question can point at exactly one turn. Turn text is flattened
// to a single line, which stops transcript content from forging a label of its own.
export const renderTranscript = (
  call: CallContext,
  turns: ReadonlyArray<TranscriptTurn>,
  stage: Stage,
): string =>
  [
    `Customer support call about: ${oneLine(call.subject)}`,
    `EMPLOYEE is ${oneLine(call.agentName)}, the support employee being assessed. CUSTOMER is ${oneLine(call.customerName)}.`,
    stage === 'final'
      ? 'This is the complete call.'
      : 'The call is still in progress. This is the transcript so far.',
    '',
    ...turns.map(
      (turn) =>
        `[${turn.id}] ${turn.speaker === 'employee' ? 'EMPLOYEE' : 'CUSTOMER'}: ${oneLine(turn.text)}`,
    ),
  ].join('\n');

const focus = (turnId: string): string =>
  `Focus on the single turn labelled [${turnId}]; treat every other turn as context only.`;

// Build the questions for one scoring pass.
//
// Turn lane   One yes/no question per (new employee turn x behaviour) and a sentiment and
//             emotion reading per new customer turn. A turn is read once: anything already
//             in `state` is not asked again, so the cost of this lane grows with the
//             length of the call, not with its square.
// Call lane   Asked on every pass against the call so far: one rubric score per skill, one
//             "can this skill be fairly judged?" gate per skill, one "was this behaviour
//             called for?" check per conditional behaviour, and escalation risk.
export const planQuestions = (
  definition: ScorecardDefinition,
  turns: ReadonlyArray<TranscriptTurn>,
  state: ScoringState,
  stage: Stage,
): ReadonlyArray<PlannedQuestion> => {
  const planned: PlannedQuestion[] = [];
  // Only verbal skills are judged from the transcript. Vocal and visual skills are read
  // from clips by `planMediaRequests`.
  const skills = enabledSkills(definition).filter((skill) => skill.channel === 'verbal');
  const behaviors = skills.flatMap((skill) => skill.behaviors);

  skills.forEach((skill, index) => {
    planned.push({
      key: `s_${index}`,
      target: { kind: 'skill', skillId: skill.id },
      question: {
        type: 'score',
        instructions:
          `Rate the EMPLOYEE on "${skill.name}": ${skill.description} ` +
          (stage === 'final'
            ? 'Judge only what the transcript shows.'
            : 'Judge only what the transcript shows so far; do not guess how the call will end.') +
          ' Choose the level whose description fits best.',
        levels: skill.levels.map((level) => `${level.label}: ${level.description}`),
      },
    });
    planned.push({
      key: `o_${index}`,
      target: { kind: 'observability', skillId: skill.id },
      question: {
        type: 'noul',
        instructions:
          stage === 'final'
            ? `Did this call give the EMPLOYEE a real opportunity to show "${skill.name}" (${skill.description})? Answer no only if nothing in the call called for this skill.`
            : `The call is still in progress. Has it progressed far enough to fairly judge the EMPLOYEE on "${skill.name}" (${skill.description})? ` +
              'Answer yes only if the employee has already had a real opportunity to show this skill.',
      },
    });
  });

  behaviors.forEach((behavior, index) => {
    if (behavior.polarity !== 'positive' || behavior.expectedWhen === null) return;
    planned.push({
      key: `e_${index}`,
      target: { kind: 'expected', behaviorId: behavior.id },
      question: {
        type: 'noul',
        instructions: `Has this situation come up at any point in the call${stage === 'final' ? '' : ' so far'}? Situation: ${behavior.expectedWhen}`,
      },
    });
  });

  planned.push({
    key: 'risk',
    target: { kind: 'risk' },
    question: {
      type: 'score',
      instructions:
        'If the call ended right now, how likely is the CUSTOMER to escalate, complain, or stop using the company?',
      levels: [...RISK_LEVELS],
    },
  });

  turns.forEach((turn, turnIndex) => {
    if (turn.speaker === 'employee') {
      if (state.tags[turn.id]) return;
      behaviors.forEach((behavior, behaviorIndex) => {
        planned.push({
          key: `t_${turnIndex}_${behaviorIndex}`,
          target: { kind: 'tag', turnId: turn.id, behaviorId: behavior.id },
          question: {
            type: 'noul',
            instructions: `${focus(turn.id)} Is this statement true of that turn? Statement: ${behavior.statement}`,
          },
        });
      });
      return;
    }
    if (state.customer[turn.id]) return;
    planned.push({
      key: `c_${turnIndex}_s`,
      target: { kind: 'sentiment', turnId: turn.id },
      question: {
        type: 'score',
        instructions: `${focus(turn.id)} How does the CUSTOMER feel in that turn?`,
        levels: [...SENTIMENT_LEVELS],
      },
    });
    planned.push({
      key: `c_${turnIndex}_e`,
      target: { kind: 'emotion', turnId: turn.id },
      question: {
        type: 'choice',
        instructions: `${focus(turn.id)} Which emotion best describes the CUSTOMER in that turn?`,
        options: EMOTIONS,
      },
    });
  });

  return planned;
};

// One turn's captured media. Audio is a complete, self-describing clip (WAV); frames are
// still images sampled about a second apart.
export interface TurnMedia {
  readonly audio?: { readonly mimeType: string; readonly data: string } | undefined;
  readonly frames?: ReadonlyArray<{ readonly mimeType: string; readonly data: string }> | undefined;
}

export interface MediaRequest {
  readonly blocks: ReadonlyArray<InputBlock>;
  readonly questions: ReadonlyArray<PlannedQuestion>;
}

// The media lane. Each clip gets a request of its own, holding exactly one turn's media,
// so a question never has to say which of several recordings it means and one clip cannot
// colour the reading of another. The clip is read once and never re-sent.
//
//   employee turn + audio   vocal skills: a rubric rating and the behaviours, by ear
//   employee turn + frames  visual skills: the same, by eye
//   customer turn + audio   sentiment from the sound of the voice, to set beside the words
//
// Two choices here come from measurement (docs/research/modalities/NOTES.md):
//
// 1. A clip travels with one line saying whose voice or picture it is, and nothing of
//    the transcript. Putting the turn's words beside its audio pulled the reading towards
//    the words: an angry voice saying something neutral dropped from 0.79 to 0.31 on
//    "sounds irritated". The words are already read by the transcript lane.
// 2. A yes/no behaviour is asked of each video frame separately and combined in code.
//    Asked of a whole set of frames, a brief lapse is averaged away: looking away in two
//    frames of six scored 0.33; asked frame by frame it scored 0.87. The rubric is asked
//    once over the set, where an overall impression is what is wanted.
export const planMediaRequests = (
  definition: ScorecardDefinition,
  turns: ReadonlyArray<TranscriptTurn>,
  state: ScoringState,
  media: Readonly<Record<string, TurnMedia>>,
): ReadonlyArray<MediaRequest> => {
  const requests: MediaRequest[] = [];
  const enabled = enabledSkills(definition);
  const vocalSkills = enabled.filter((skill) => skill.channel === 'vocal');
  const visualSkills = enabled.filter((skill) => skill.channel === 'visual');
  const rubric = (skill: Skill, lead: string, judge: string): Question => ({
    type: 'score',
    instructions: `${lead} Rate "${skill.name}": ${skill.description} ${judge} Choose the level whose description fits best.`,
    levels: skill.levels.map((level) => `${level.label}: ${level.description}`),
  });

  turns.forEach((turn, turnIndex) => {
    const captured = media[turn.id];
    if (!captured) return;
    const read = state.media[turn.id];
    const speaker = turn.speaker === 'employee' ? 'EMPLOYEE' : 'CUSTOMER';
    const clip: ReadonlyArray<InputBlock> = captured.audio
      ? [
          {
            type: 'text',
            text: `The attached audio clip is one turn of a customer support call, spoken by the ${speaker}.`,
          },
          { type: 'audio', ...captured.audio },
        ]
      : [];

    if (turn.speaker === 'customer') {
      if (clip.length === 0 || read?.voice) return;
      requests.push({
        blocks: clip,
        questions: [
          {
            key: `m_${turnIndex}_voice`,
            target: { kind: 'voice', turnId: turn.id },
            question: {
              type: 'score',
              instructions:
                'Listen to the attached audio clip of the CUSTOMER. Judging by the sound of their voice (tone, pace and emphasis) rather than the words, how does the customer feel?',
              levels: [...SENTIMENT_LEVELS],
            },
          },
        ],
      });
      return;
    }

    if (clip.length > 0 && !read?.vocal && vocalSkills.length > 0) {
      const lead = 'Listen to the attached audio clip of the EMPLOYEE.';
      const questions: PlannedQuestion[] = [];
      vocalSkills.forEach((skill, skillIndex) => {
        questions.push({
          key: `m_${turnIndex}_a_s${skillIndex}`,
          target: { kind: 'clip_skill', turnId: turn.id, channel: 'vocal', skillId: skill.id },
          question: rubric(
            skill,
            lead,
            'Judge only how the employee sounds in this clip, not the words they chose.',
          ),
        });
        skill.behaviors.forEach((behavior, behaviorIndex) => {
          questions.push({
            key: `m_${turnIndex}_a_s${skillIndex}b${behaviorIndex}`,
            target: {
              kind: 'clip_tag',
              turnId: turn.id,
              channel: 'vocal',
              behaviorId: behavior.id,
              combine: 'max',
            },
            question: {
              type: 'noul',
              instructions: `${lead} Is this statement true of how they sound in the clip? Statement: ${behavior.statement}`,
            },
          });
        });
      });
      requests.push({ blocks: clip, questions });
    }

    const frames = captured.frames ?? [];
    if (frames.length > 0 && !read?.visual && visualSkills.length > 0) {
      const questions: PlannedQuestion[] = [];
      visualSkills.forEach((skill, skillIndex) => {
        questions.push({
          key: `m_${turnIndex}_v_s${skillIndex}`,
          target: { kind: 'clip_skill', turnId: turn.id, channel: 'visual', skillId: skill.id },
          question: rubric(
            skill,
            'Look at the attached video frames of the EMPLOYEE, taken about a second apart during one turn of the call.',
            'Judge only what is visible across the frames.',
          ),
        });
        skill.behaviors.forEach((behavior, behaviorIndex) => {
          frames.forEach((_, frameIndex) => {
            questions.push({
              key: `m_${turnIndex}_v_s${skillIndex}b${behaviorIndex}f${frameIndex}`,
              target: {
                kind: 'clip_tag',
                turnId: turn.id,
                channel: 'visual',
                behaviorId: behavior.id,
                // A problem seen in any frame happened; a good habit should hold across them.
                combine: behavior.polarity === 'negative' ? 'max' : 'mean',
              },
              question: {
                type: 'noul',
                instructions: `Look only at the image labelled Frame ${frameIndex + 1}. Is this statement true of what is visible in that frame? Statement: ${behavior.statement}`,
              },
            });
          });
        });
      });
      requests.push({
        blocks: [
          {
            type: 'text',
            text: `The attached images are video frames of the EMPLOYEE during one turn of a customer support call, taken about a second apart.`,
          },
          ...frames.flatMap((frame, frameIndex): InputBlock[] => [
            { type: 'text', text: `\nFrame ${frameIndex + 1}:` },
            { type: 'image', ...frame },
          ]),
        ],
        questions,
      });
    }
  });
  return requests;
};

// Fold a batch of answers into the readings. Turn-level readings accumulate; call-level
// readings are replaced by the newest pass.
export const applyAnswers = (
  state: ScoringState,
  planned: ReadonlyArray<PlannedQuestion>,
  answers: Readonly<Record<string, Answer>>,
): ScoringState => {
  const tags: Record<string, Record<string, number>> = { ...state.tags };
  const customer: Record<string, CustomerReading> = { ...state.customer };
  const skills = { ...state.skills };
  const expected = { ...state.expected };
  const observability: Record<string, number> = {};
  const partialCustomer: Record<string, Partial<CustomerReading>> = {};
  const media: Record<string, TurnMediaReading> = { ...state.media };
  const clip = (
    turnId: string,
    channel: 'vocal' | 'visual',
  ): { skills: Record<string, LevelReading>; tags: Record<string, number> } => {
    const existing: ChannelReading | undefined = media[turnId]?.[channel];
    return { skills: { ...existing?.skills }, tags: { ...existing?.tags } };
  };
  const clipTags = new Map<
    string,
    { target: Extract<Target, { kind: 'clip_tag' }>; probabilities: number[] }
  >();
  let risk = state.risk;

  for (const { key, target } of planned) {
    const answer = answers[key];
    if (!answer) continue;
    if (target.kind === 'skill' && answer.type === 'score') {
      skills[target.skillId] = {
        expectedLevel: answer.score,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        observability: null,
      };
    } else if (target.kind === 'observability' && answer.type === 'noul') {
      observability[target.skillId] = answer.probability;
    } else if (target.kind === 'expected' && answer.type === 'noul') {
      expected[target.behaviorId] = answer.probability;
    } else if (target.kind === 'tag' && answer.type === 'noul') {
      tags[target.turnId] = { ...tags[target.turnId], [target.behaviorId]: answer.probability };
    } else if (target.kind === 'sentiment' && answer.type === 'score') {
      partialCustomer[target.turnId] = {
        ...partialCustomer[target.turnId],
        sentiment: answer.score,
        sentimentConfidence: answer.confidence,
      };
    } else if (target.kind === 'emotion' && answer.type === 'choice') {
      partialCustomer[target.turnId] = {
        ...partialCustomer[target.turnId],
        emotion: answer.choice,
        emotionConfidence: answer.confidence,
      };
    } else if (target.kind === 'risk' && answer.type === 'score') {
      risk = {
        expectedLevel: answer.score,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      };
    } else if (target.kind === 'clip_skill' && answer.type === 'score') {
      const reading = clip(target.turnId, target.channel);
      reading.skills[target.skillId] = {
        expectedLevel: answer.score,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
      };
      media[target.turnId] = { ...media[target.turnId], [target.channel]: reading };
    } else if (target.kind === 'clip_tag' && answer.type === 'noul') {
      // Several answers can describe one behaviour in one turn (one per video frame).
      // They are gathered here and combined once all of them are in.
      const key = `${target.turnId}|${target.channel}|${target.behaviorId}`;
      const gathered = clipTags.get(key) ?? { target, probabilities: [] };
      gathered.probabilities.push(answer.probability);
      clipTags.set(key, gathered);
    } else if (target.kind === 'voice' && answer.type === 'score') {
      media[target.turnId] = {
        ...media[target.turnId],
        voice: { sentiment: answer.score, confidence: answer.confidence },
      };
    }
  }

  for (const { target, probabilities } of clipTags.values()) {
    const reading = clip(target.turnId, target.channel);
    reading.tags[target.behaviorId] =
      target.combine === 'max'
        ? Math.max(...probabilities)
        : probabilities.reduce((sum, probability) => sum + probability, 0) / probabilities.length;
    media[target.turnId] = { ...media[target.turnId], [target.channel]: reading };
  }
  for (const [skillId, probability] of Object.entries(observability)) {
    const reading = skills[skillId];
    if (reading) skills[skillId] = { ...reading, observability: probability };
  }
  for (const [turnId, reading] of Object.entries(partialCustomer)) {
    if (reading.sentiment === undefined || reading.emotion === undefined) continue;
    customer[turnId] = {
      sentiment: reading.sentiment,
      sentimentConfidence: reading.sentimentConfidence ?? 0,
      emotion: reading.emotion,
      emotionConfidence: reading.emotionConfidence ?? 0,
    };
  }
  return { tags, customer, skills, expected, risk, media };
};
