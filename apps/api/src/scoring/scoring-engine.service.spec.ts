import {
  defaultScorecard,
  emptyScoringState,
  estimateProviderCostUsd,
  type ScoringProvider,
  type TranscriptTurn,
} from '@scorecard/domain';
import type { DecisionClient } from '../decisions/decision-client.service.js';
import type {
  Answer,
  DecisionInput,
  DecisionResult,
  Questions,
} from '../decisions/decision.types.js';
import { ProviderError } from '../decisions/provider.error.js';
import {
  MAX_QUESTIONS_PER_REQUEST,
  ScoringEngine,
  type RequestRecord,
  type ScoreInput,
} from './scoring-engine.service.js';
import type { TurnMedia } from './question-plan.js';

// A well-formed answer for any question: yes 0.8, the middle rubric level, the first option.
const answerAll = (questions: Questions): Record<string, Answer> =>
  Object.fromEntries(
    Object.entries(questions).map(([key, question]): [string, Answer] => {
      if (question.type === 'noul')
        return [key, { type: 'noul', probability: 0.8, confidence: 0.8 }];
      if (question.type === 'choice') {
        const [first] = Object.keys(question.options);
        return [
          key,
          { type: 'choice', choice: first!, confidence: 0.9, probabilities: { [first!]: 0.9 } },
        ];
      }
      const middle = Math.floor(question.levels.length / 2);
      return [
        key,
        {
          type: 'score',
          score: middle,
          confidence: 0.7,
          probabilities: question.levels.map((_, level) => (level === middle ? 1 : 0)),
        },
      ];
    }),
  );

type Decide = (
  provider: ScoringProvider,
  input: DecisionInput,
  questions: Questions,
  signal?: AbortSignal,
) => Promise<DecisionResult>;

const fakeClient = (decide?: Decide) => {
  const mock = vi.fn<Decide>(
    decide ??
      (async (_provider, _input, questions) => ({
        model: 'fake-model',
        answers: answerAll(questions),
        inputTokens: 100,
        outputTokens: 5,
      })),
  );
  return { client: { decide: mock } as unknown as DecisionClient, decide: mock };
};

const turnsOf = (count: number): TranscriptTurn[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `turn-${index + 1}`,
    speaker: index % 2 === 0 ? 'customer' : 'employee',
    text: `line ${index + 1}`,
    startSeconds: index * 5,
  }));

const input = (overrides: Partial<ScoreInput> = {}): ScoreInput => ({
  provider: 'gemini',
  call: { subject: 'Billing', customerName: 'Maya', agentName: 'Jordan' },
  definition: defaultScorecard,
  turns: turnsOf(4),
  state: emptyScoringState,
  stage: 'final',
  ...overrides,
});

describe('ScoringEngine', () => {
  it('asks every planned question once in a single request for a short call', async () => {
    const { client, decide } = fakeClient();
    const output = await new ScoringEngine(client).score(input());
    expect(decide).toHaveBeenCalledTimes(1);
    const [provider, transcript, questions] = decide.mock.calls[0]!;
    expect(provider).toBe('gemini');
    expect(typeof transcript).toBe('string');
    expect(Object.keys(questions)).toHaveLength(output.usage.questions);
    expect(output.usage.requests).toBe(1);
  });

  it('splits transcript questions into requests of at most MAX_QUESTIONS_PER_REQUEST', async () => {
    const { client, decide } = fakeClient();
    // 30 employee turns x 16 verbal behaviours alone is 480 tag questions.
    const output = await new ScoringEngine(client).score(input({ turns: turnsOf(60) }));
    const sizes = decide.mock.calls.map(([, , questions]) => Object.keys(questions).length);
    expect(sizes.length).toBe(Math.ceil(output.usage.questions / MAX_QUESTIONS_PER_REQUEST));
    expect(sizes.length).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_QUESTIONS_PER_REQUEST);
    const keys = decide.mock.calls.flatMap(([, , questions]) => Object.keys(questions));
    expect(new Set(keys).size).toBe(output.usage.questions);
    // Every chunk is asked against the same transcript.
    expect(new Set(decide.mock.calls.map(([, transcript]) => transcript)).size).toBe(1);
  });

  it('totals usage across requests and prices it for the provider', async () => {
    const { client } = fakeClient();
    const output = await new ScoringEngine(client).score(
      input({ provider: 'jev', turns: turnsOf(60) }),
    );
    const requests = output.usage.requests;
    expect(output.usage).toMatchObject({
      inputTokens: 100 * requests,
      outputTokens: 5 * requests,
      estimatedCostUsd: estimateProviderCostUsd('jev', 100 * requests, 5 * requests),
    });
    expect(output.model).toBe('fake-model');
  });

  it('folds the answers into new readings and composes the evaluation', async () => {
    const { client } = fakeClient();
    const output = await new ScoringEngine(client).score(input({ stage: 'provisional' }));
    expect(Object.keys(output.state.tags)).toEqual(['turn-2', 'turn-4']);
    expect(Object.keys(output.state.customer)).toEqual(['turn-1', 'turn-3']);
    expect(output.body.stage).toBe('provisional');
    expect(output.body.turnCount).toBe(4);
    expect(output.body.overallScore).not.toBeNull();
  });

  it('calls onStart, then onRequest once per successful request', async () => {
    const { client } = fakeClient();
    const events: string[] = [];
    const records: RequestRecord[] = [];
    const output = await new ScoringEngine(client).score(
      input({
        turns: turnsOf(60),
        onStart: () => {
          events.push('start');
        },
        onRequest: (record) => {
          events.push('request');
          records.push(record);
        },
      }),
    );
    expect(events[0]).toBe('start');
    expect(records).toHaveLength(output.usage.requests);
    expect(records.every((record) => record.ok && record.model === 'fake-model')).toBe(true);
    expect(records.reduce((sum, record) => sum + record.questionCount, 0)).toBe(
      output.usage.questions,
    );
    expect(records[0]).toMatchObject({ inputTokens: 100, outputTokens: 5 });
  });

  it('records a failed request and fails the whole pass', async () => {
    const failure = new ProviderError('gemini', 'rate_limit');
    let call = 0;
    const { client } = fakeClient(async (_provider, _input, questions) => {
      call += 1;
      if (call === 2) throw failure;
      return {
        model: 'fake-model',
        answers: answerAll(questions),
        inputTokens: 100,
        outputTokens: 5,
      };
    });
    const records: RequestRecord[] = [];
    await expect(
      new ScoringEngine(client).score(
        input({ turns: turnsOf(60), onRequest: (record) => void records.push(record) }),
      ),
    ).rejects.toBe(failure);
    const failed = records.filter((record) => !record.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      model: null,
      estimatedCostUsd: 0,
    });
    expect(records.filter((record) => record.ok).length).toBeGreaterThan(0);
  });

  it('passes the abort signal through to the client', async () => {
    const { client, decide } = fakeClient();
    const controller = new AbortController();
    await new ScoringEngine(client).score(input({ signal: controller.signal }));
    expect(decide.mock.calls[0]![3]).toBe(controller.signal);
  });

  it('refuses an empty transcript', async () => {
    const { client, decide } = fakeClient();
    await expect(new ScoringEngine(client).score(input({ turns: [] }))).rejects.toThrow(
      'Cannot score an empty transcript',
    );
    expect(decide).not.toHaveBeenCalled();
  });

  describe('media lane', () => {
    const media: Record<string, TurnMedia> = {
      'turn-2': {
        audio: { mimeType: 'audio/wav', data: 'QQ==' },
        frames: [{ mimeType: 'image/jpeg', data: 'Rg==' }],
      },
      'turn-3': { audio: { mimeType: 'audio/wav', data: 'QQ==' } },
    };

    it('sends one extra request per clip for a provider that takes media', async () => {
      const { client, decide } = fakeClient();
      const output = await new ScoringEngine(client).score(input({ media }));
      const blockRequests = decide.mock.calls.filter(([, request]) => Array.isArray(request));
      // turn-2 audio and frames, turn-3 customer voice.
      expect(blockRequests).toHaveLength(3);
      expect(output.usage.requests).toBe(4);
      expect(output.body.channels).toEqual(['verbal', 'vocal', 'visual']);
      expect(output.state.media['turn-3']?.voice).toBeDefined();
    });

    it('skips media for a provider without media support', async () => {
      const { client, decide } = fakeClient();
      const output = await new ScoringEngine(client).score(input({ provider: 'openai', media }));
      expect(decide).toHaveBeenCalledTimes(1);
      expect(typeof decide.mock.calls[0]![1]).toBe('string');
      expect(output.body.channels).toEqual(['verbal']);
      expect(
        output.body.skills.filter((skill) => !skill.assessed).map((skill) => skill.skillId),
      ).toEqual(['vocal_delivery', 'visual_presence']);
    });
  });
});
