import { expectProviderError } from '../../../test/provider-assertions.js';
import type { Answer, Questions } from '../decision.types.js';
import { checkAnswers, levelArray, textOnly } from './adapter-support.js';

const questions: Questions = {
  yes: { type: 'noul', instructions: 'Yes?' },
  pick: { type: 'choice', instructions: 'Pick', options: { a: 'A', b: 'B' } },
  rate: { type: 'score', instructions: 'Rate', levels: ['0', '1'] },
};

const valid: Record<string, Answer> = {
  yes: { type: 'noul', probability: 0.4, confidence: 0.6 },
  pick: { type: 'choice', choice: 'a', confidence: 0.7, probabilities: { a: 0.7, b: 0.3 } },
  rate: { type: 'score', score: 0.5, confidence: 0.5, probabilities: [0.5, 0.5] },
};

const check = (answers: Record<string, Answer | undefined>) =>
  Promise.resolve().then(() => checkAnswers('gemini', questions, answers));

describe('checkAnswers', () => {
  it('returns exactly the answers that were asked for', async () => {
    expect(await check({ ...valid, extra: valid.yes })).toEqual(valid);
  });

  it('rejects a confidence outside 0..1', async () => {
    await expectProviderError(
      check({ ...valid, yes: { type: 'noul', probability: 0.4, confidence: 1.2 } }),
      'invalid_response',
      /confidence is out of range/,
    );
  });

  it('rejects a yes/no probability that is not finite', async () => {
    await expectProviderError(
      check({ ...valid, yes: { type: 'noul', probability: Number.NaN, confidence: 0.5 } }),
      'invalid_response',
      /probability is out of range/,
    );
  });

  it('rejects a score distribution with a negative entry', async () => {
    await expectProviderError(
      check({
        ...valid,
        rate: { type: 'score', score: 0, confidence: 0.5, probabilities: [1.1, -0.1] },
      }),
      'invalid_response',
      /score distribution is invalid/,
    );
  });
});

describe('levelArray', () => {
  it('orders a keyed distribution by level and fills gaps with zero', () => {
    expect(levelArray({ '2': 0.5, '0': 0.5 }, 4)).toEqual([0.5, 0, 0.5, 0]);
  });
});

describe('textOnly', () => {
  it('passes a string through', () => {
    expect(textOnly('jev', 'plain')).toBe('plain');
  });

  it('concatenates text blocks', () => {
    expect(
      textOnly('jev', [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab');
  });

  it('rejects any media block', async () => {
    await expectProviderError(
      Promise.resolve().then(() =>
        textOnly('openai', [{ type: 'audio', data: 'x', mimeType: 'audio/wav' }]),
      ),
      'rejected',
      'OpenAI Decisions rejected the request (media input is not supported)',
    );
  });
});
